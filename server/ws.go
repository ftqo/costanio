package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/chatfilter"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/store"
)

const (
	writeWait     = 10 * time.Second
	pingPeriod    = 50 * time.Second
	maxFrameBytes = 16 << 10
	// sendBuffer sizes the per-connection write queue. A client that can't drain
	// within a few frames is dropped and resyncs anyway, so 16 absorbs a normal
	// burst and more is wasted RAM.
	sendBuffer             = 16
	msgsPerSecond  float64 = 10
	burstAllowance float64 = 20
)

// checkOrigin gates the websocket upgrade by Origin. Same-origin browsers send
// the cookie; cross-origin pages can't read responses, but we block them at the
// handshake anyway. A request with no Origin is a non-browser client and is let
// through: the socket still authenticates it. Everything else must be one of
// ours (ownOrigin).
func (s *Server) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser / same-origin clients
	}
	return s.ownOrigin(origin, r.Host)
}

// ownOrigin reports whether a browser Origin is this deployment's own. Used by
// the websocket handshake and POST /api/token.
//
//   - The Discord Activity iframe runs under https://<app_id>.discordsays.com.
//   - Production (auth.Production: secure cookies or an https base URL, as in
//     cmd/costan's prodLike) trusts only the configured base URL and https for
//     the request's own host, so a network attacker can't downgrade to http.
//   - Dev/localhost accepts http or https for the request's own host.
func (s *Server) ownOrigin(origin, host string) bool {
	if s.discordAppID != "" && origin == "https://"+s.discordAppID+".discordsays.com" {
		return true
	}
	if s.auth != nil {
		if base := strings.TrimSuffix(s.auth.Config.BaseURL, "/"); base != "" && origin == base {
			return true
		}
		if s.auth.Production() {
			return origin == "https://"+host
		}
	}
	return origin == "https://"+host || origin == "http://"+host
}

// Client → server frames.
type clientFrame struct {
	T      string      `json:"t"`
	ID     string      `json:"id,omitempty"`
	Game   string      `json:"game,omitempty"`
	Since  *int        `json:"since,omitempty"`
	Invite string      `json:"invite,omitempty"`
	Cmd    *cmdPayload `json:"cmd,omitempty"`
	Scope  string      `json:"scope,omitempty"`
	Msg    string      `json:"msg,omitempty"`
	Token  string      `json:"token,omitempty"` // first-frame bearer auth (Activity)
	ChatID int64       `json:"chat_id,omitempty"`
}

type cmdPayload struct {
	Type engine.CommandType `json:"type"`
	Data json.RawMessage    `json:"data,omitempty"`
}

// Conn is one websocket client.
type Conn struct {
	srv *Server
	ws  *websocket.Conn
	// ctx is the connection's lifetime context: reads block on it, per-write
	// timeouts derive from it, and closeWS cancels it to unblock any pending
	// Read/Write/Ping (coder/websocket has no SetDeadline).
	ctx    context.Context
	cancel context.CancelFunc
	userID int64
	user   *store.User
	send   chan []byte
	// dropped (cap 1) wakes the write pump to send a resync hint after trySend
	// discards a frame on a full buffer. A dropped `state` frame leaves no seq gap,
	// so without this the client would keep rendering stale data.
	dropped chan struct{}
	done    chan struct{}

	mu     sync.Mutex
	gameID string
	sub    *game.Subscription
	// fwdDone closes when sub's forward goroutine has returned. A re-subscribe
	// waits on it before reading where the old subscription stopped, because
	// until then a frame the forwarder has already taken off the ring may not
	// have reached c.send yet. Written and waited on only by the read pump.
	fwdDone chan struct{}
	// No seat is cached on the connection: lobby.Start rebuilds every seat row
	// and re-deals turn order, so actingSeat reads the seat table when needed.

	limiter   *tokenBucket
	closeOnce sync.Once
	authed    bool // set once a session is resolved (cookie/bearer, or auth frame)
}

// closeWS shuts the underlying socket once. Safe from any goroutine: canceling
// ctx unblocks pending Read/Write/Ping, and CloseNow tears the socket down, which
// unblocks readPump and runs close().
func (c *Conn) closeWS() {
	c.closeOnce.Do(func() {
		c.cancel()
		_ = c.ws.CloseNow()
	})
}

func (c *Conn) following() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gameID
}

// Server-to-client frames are typed structs rather than map[string]any (about
// 2.5x faster to marshal, 4x fewer allocations). Fields are in alphabetical
// json-tag order so output matches the old map encoding byte for byte.
//
// errFrame is the client-bound refusal. The client renders its own copy keyed
// off Code (plus Params), never off Debug.
//
// Debug is English reference text for socket dumps and tooling (see
// docs/user-facing-text.md and docs/protocol.md). It is never localized and
// must not be rendered; it is named `debug` rather than `msg` for that reason.
//
// Params carries variable content as named values, since word order differs
// across languages. See engine.Params.
type errFrame struct {
	Code   string         `json:"code"`
	Debug  string         `json:"debug,omitempty"`
	Params map[string]any `json:"params,omitempty"`
	Ref    string         `json:"ref"`
	T      string         `json:"t"`
}

// maxChatLen bounds a chat message. It reaches the client as a CHAT_LENGTH
// parameter, not inside a sentence.
const maxChatLen = 500

type resyncFrame struct {
	Game string `json:"game"`
	T    string `json:"t"`
}

// pongFrame answers a client `ping`.
//
// Browsers answer websocket protocol pings below script level, so a client
// with a half-open socket sees readyState OPEN and waits forever. An
// application-level ping and its pong (or the lack of one) is how the client
// detects that and redials. Rate-limited like any other frame.
type pongFrame struct {
	T string `json:"t"`
}

// stateFrame carries the authoritative full view on (re)subscribe.
type stateFrame struct {
	Full any    `json:"full"`
	Game string `json:"game"`
	Seq  int    `json:"seq"`
	T    string `json:"t"`
}

// lobbyFrame covers every lobby-channel shape (summary / started / closed) in one
// struct. started/closed are *bool so the key appears only when set.
type lobbyFrame struct {
	Closed  *bool  `json:"closed,omitempty"`
	Game    string `json:"game"`
	Started *bool  `json:"started,omitempty"`
	Summary any    `json:"summary,omitempty"`
	T       string `json:"t"`
}

type chatFrame struct {
	From   string `json:"from"`
	ID     int64  `json:"id"`
	Msg    string `json:"msg"`
	Scope  string `json:"scope"`
	T      string `json:"t"`
	UserID int64  `json:"user_id"`
}

type presenceFrame struct {
	Game       string          `json:"game"`
	Spectators []SpectatorInfo `json:"spectators"`
	T          string          `json:"t"`
}

var trueVal = true

// trySend never blocks; hub broadcasts drop frames to stuck clients (they
// resync on reconnect).
func (c *Conn) trySend(raw []byte) {
	select {
	case c.send <- raw:
	default:
		// Buffer full: this frame is lost. Wake the write pump to send a resync hint.
		// The cap-1 channel coalesces a burst of drops into one resync; a nil channel
		// (hand-built test Conns) skips the signal.
		select {
		case c.dropped <- struct{}{}:
		default:
		}
	}
}

func (c *Conn) sendJSON(frame any) {
	raw, err := json.Marshal(frame)
	if err != nil {
		return
	}
	c.trySend(raw)
}

// sendErr sends a refusal. code is what the client renders from; debug is the
// English reference wording, a developer aid the client must not render.
func (c *Conn) sendErr(ref, code, debug string) {
	c.sendJSON(errFrame{T: "err", Ref: ref, Code: code, Debug: debug})
}

// sendErrParams sends a refusal whose meaning depends on variable content, as
// named parameters the client places according to its own grammar.
func (c *Conn) sendErrParams(ref, code string, params map[string]any, debug string) {
	c.sendJSON(errFrame{T: "err", Ref: ref, Code: code, Params: params, Debug: debug})
}

// handleWS upgrades and runs a connection.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	// Per-IP upgrade rate limit: generous enough for real reconnect loops (tab
	// refresh, network blip) but blocks goroutine/FD exhaustion from floods.
	if !s.wsConnLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "WS_CONNECTION_RATE_LIMITED", "Too many connections")
		return
	}
	// u is resolved from the cookie/bearer by the middleware. The Discord
	// Activity can't set a bearer header on a browser WebSocket, so an
	// unauthenticated upgrade is allowed and must authenticate with a first
	// {"t":"auth","token":...} frame before any other frame is honored.
	u := auth.UserFrom(r.Context())
	// Origin is checked here so the dev/prod/Activity rules apply (checkOrigin);
	// InsecureSkipVerify turns off coder/websocket's own same-origin check, which
	// would reject the Activity iframe and dev http.
	if !s.checkOrigin(r) {
		writeErr(w, http.StatusForbidden, "FORBIDDEN", "Bad origin")
		return
	}
	// Registered before the upgrade, so a connection either exists inside s.bg
	// (and Server.Close joins its goroutines) or is never created. The read loop
	// calls mgr.Get, actor.Do and store.LoadEvents, so it must not run outside s.bg.
	if !s.bg.Enter() {
		writeErr(w, http.StatusServiceUnavailable, "SERVER_SHUTTING_DOWN", "Server restarting")
		return
	}
	defer s.bg.Leave()
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	ws.SetReadLimit(maxFrameBytes)
	ctx, cancel := context.WithCancel(context.Background())
	c := &Conn{
		srv:     s,
		ws:      ws,
		ctx:     ctx,
		cancel:  cancel,
		send:    make(chan []byte, sendBuffer),
		dropped: make(chan struct{}, 1),
		done:    make(chan struct{}),
		limiter: newTokenBucket(s.wsMsgRate, s.wsMsgBurst),
	}
	if u != nil {
		c.user = u
		c.userID = u.ID
		c.authed = true
		s.hub.add(c)
		s.cancelRankedLeave(c.userID) // reconnect within grace keeps them queued
	}
	// Join both pumps before s.bg.Leave (deferred above) can fire. readPump returns
	// when the socket is torn down (DrainConns, a write error, or the peer), and
	// its deferred c.close() closes c.done, which both pumps select on.
	var pumps sync.WaitGroup
	pumps.Add(2)
	go func() { defer pumps.Done(); c.writePump() }()
	go func() { defer pumps.Done(); c.keepalive() }()
	c.readPump()
	pumps.Wait()
}

func (c *Conn) readPump() {
	defer c.close()
	// Liveness comes from the keepalive ping loop, not a read deadline, so an idle
	// watcher isn't dropped. closeWS cancels ctx, so a failed ping or a write-side
	// close unblocks this Read.
	for {
		_, raw, err := c.ws.Read(c.ctx)
		if err != nil {
			return
		}
		if !c.limiter.allow() {
			// Drop the offending frame and tell the client to slow down, but
			// keep the connection: a brief burst shouldn't drop the session.
			c.sendErr("", "FRAME_RATE_LIMITED", "Slow down")
			continue
		}
		var f clientFrame
		if err := json.Unmarshal(raw, &f); err != nil {
			c.sendErr("", "BAD_FRAME_JSON", "Invalid JSON frame")
			continue
		}
		if !c.authed {
			// Only a valid auth frame promotes the connection. Anything else is
			// rejected; the connection stays open but unusable (never added to the
			// hub) until it authenticates or the read deadline closes it.
			if f.T != "auth" || f.Token == "" {
				c.sendErr(f.ID, "AUTH_REQUIRED", "Auth frame required")
				continue
			}
			user, err := c.srv.store.UserBySession(f.Token)
			if err != nil {
				c.sendErr(f.ID, "INVALID_SESSION", "Invalid session")
				continue
			}
			c.user = user
			c.userID = user.ID
			c.authed = true
			c.srv.hub.add(c)
			continue
		}
		switch f.T {
		case "ping":
			// Liveness probe, answered inline with no other effect. See pongFrame.
			c.sendJSON(pongFrame{T: "pong"})
		case "sub":
			c.handleSub(f)
		case "unsub":
			// Stop streaming the current game while keeping the socket open. Seat
			// membership is unchanged, but the game may now have no humans present, so
			// reconcile (it may suspend, then abandon after the grace).
			gid := c.following()
			c.detach()
			if gid != "" {
				c.srv.reconcileGamePresence(gid)
			}
		case "cmd":
			c.handleCmd(f)
		case "chat":
			c.handleChat(f)
		case "report":
			c.handleReport(f)
		case "rematch":
			c.handleRematch(f)
		default:
			c.sendErr(f.ID, "BAD_FRAME_TYPE", "Unknown frame type")
		}
	}
}

func (c *Conn) writePump() {
	// On any write error tear the whole connection down: closing the socket
	// unblocks readPump, which runs close() to drain hub state. Otherwise the hub
	// would keep dropping frames into an undrained buffer until keepalive noticed.
	defer c.closeWS()
	for {
		select {
		case raw := <-c.send:
			if err := c.writeText(raw); err != nil {
				return
			}
		case <-c.dropped:
			// A frame was discarded on a full buffer, so tell the client to resync. The
			// hint is written straight to the socket rather than via c.send, which is what
			// overflowed. Only game state needs this.
			if gid := c.following(); gid != "" {
				raw, err := json.Marshal(resyncFrame{T: "resync", Game: gid})
				if err != nil {
					break
				}
				if err := c.writeText(raw); err != nil {
					return
				}
			}
		case <-c.done:
			// Best-effort graceful close handshake; closeWS (deferred) then tears
			// the socket down. coder/websocket serializes writes, so this is safe.
			_ = c.ws.Close(websocket.StatusNormalClosure, "")
			return
		}
	}
}

// writeText writes one text frame under a per-write timeout derived from the
// connection context, so a stuck socket fails the write (tearing the conn down)
// instead of blocking the pump. Replaces gorilla's SetWriteDeadline.
func (c *Conn) writeText(raw []byte) error {
	ctx, cancel := context.WithTimeout(c.ctx, writeWait)
	defer cancel()
	return c.ws.Write(ctx, websocket.MessageText, raw)
}

// keepalive pings the peer periodically. Ping blocks until readPump reads the
// pong or the timeout elapses; either failure closes the conn.
func (c *Conn) keepalive() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(c.ctx, writeWait)
			err := c.ws.Ping(ctx)
			cancel()
			if err != nil {
				c.closeWS()
				return
			}
		}
	}
}

// close tears the connection down. A dropped player's seat is not auto-passed
// immediately; the turn timer handles stalls, and reconnecting lifts auto.
func (c *Conn) close() {
	gameID := c.following()
	// Resolved from the seat table (see actingSeat), not a seat cached at
	// subscribe time: a stale seat would make MarkSeatAbsent bot and forfeit some
	// other player. A watcher has no row and gets Spectator.
	seat := game.Spectator
	if gameID != "" {
		seat = c.actingSeat(gameID)
	}
	c.srv.hub.remove(c)
	c.srv.scheduleRankedLeave(c.userID) // grace, like a lobby seat, survives a refresh
	c.detach()
	if gameID != "" && seat == game.Spectator {
		// A departing spectator drops off everyone else's watcher list. Seated
		// players leaving go through the seat/presence paths instead.
		c.srv.broadcastPresence(gameID)
	}
	if gameID != "" && c.srv.rematchActive(gameID) {
		// Leaving the post-game screen shrinks the rematch denominator; refresh
		// the tally for whoever's still there.
		c.srv.hub.BroadcastGame(gameID, c.srv.postgameFrame(gameID, false, ""))
	}
	// The socket stays open across in-app navigation, so a close means the site
	// was shut. If the user holds a lobby seat (from the store, not the current
	// subscription), arm a grace leave; it is canceled if any of their
	// connections is alive when the window ends.
	if lobbyID, _ := c.srv.store.ActiveGameForUser(c.userID); lobbyID != "" {
		c.srv.scheduleLobbyLeave(lobbyID, c.userID)
	}
	// If they dropped out of an in-progress game and no other connection of theirs
	// is following it, start the bot-takeover grace. Reconnecting clears it;
	// staying gone a full round hands the seat to a bot and records a forfeit.
	//
	// This checks per-game following rather than hub.Online (see
	// anyHumanPresent): a second tab on the homepage must not keep the seat alive
	// and the game unsuspended.
	if gameID != "" && seat != game.Spectator && !c.srv.hub.FollowingGame(gameID, c.userID) {
		if g, err := c.srv.store.GameByID(gameID); err == nil && g.Status == "active" {
			c.srv.mgr.MarkSeatAbsent(gameID, seat)
			c.srv.reconcileGamePresence(gameID)
		}
	}
	close(c.done)
	c.closeWS()
}

// lobbyLeaveGrace is how long a fully disconnected player keeps their lobby seat:
// long enough for a refresh or brief outage.
const lobbyLeaveGrace = 30 * time.Second

// leaveClock is the timer seam behind the lobby-leave grace window. Production
// uses realLeaveClock (wall time); tests inject a fake to fire the window
// deterministically instead of sleeping out the real duration.
type leaveClock interface {
	AfterFunc(d time.Duration, f func()) leaveTimer
}

// leaveTimer is the subset of *time.Timer the leave path needs. *time.Timer
// satisfies it directly.
type leaveTimer interface{ Stop() bool }

type realLeaveClock struct{}

func (realLeaveClock) AfterFunc(d time.Duration, f func()) leaveTimer { return time.AfterFunc(d, f) }

func lobbyLeaveKey(gameID string, userID int64) string {
	return gameID + ":" + strconv.FormatInt(userID, 10)
}

// scheduleLobbyLeave arms a delayed leave for a user whose connection dropped.
// It's a no-op for games that aren't in the lobby phase (an active game's seat is
// kept for reconnect, not vacated). A later disconnect resets the window; a
// re-subscribe cancels it (see cancelLobbyLeave).
func (s *Server) scheduleLobbyLeave(gameID string, userID int64) {
	g, err := s.store.GameByID(gameID)
	if err != nil || g.Status != "lobby" {
		return
	}
	key := lobbyLeaveKey(gameID, userID)
	s.leaveMu.Lock()
	if t, ok := s.leaving[key]; ok {
		t.Stop()
	}
	s.leaving[key] = s.clock.AfterFunc(lobbyLeaveGrace, func() { s.fireLobbyLeave(gameID, userID, key) })
	s.leaveMu.Unlock()
}

// fireLobbyLeave vacates a lobby seat once the grace window elapses, unless the
// user has any live connection (a reconnect, a completed refresh, another tab).
// Any open socket keeps the seat.
func (s *Server) fireLobbyLeave(gameID string, userID int64, key string) {
	s.leaveMu.Lock()
	delete(s.leaving, key)
	s.leaveMu.Unlock()
	if s.hub.Online(userID) {
		return // still connected somewhere; keep the seat
	}
	u, err := s.store.UserByID(userID)
	if err != nil {
		return
	}
	closed, err := s.lobby.Leave(u, gameID)
	if err != nil {
		return // already started, already gone, etc.; nothing to announce
	}
	s.announceLobbyLeave(gameID, closed)
}

// cancelLobbyLeave aborts a pending lobby leave for a user, called when they
// (re)subscribe to the game, so a refresh or quick return keeps their seat.
func (s *Server) cancelLobbyLeave(gameID string, userID int64) {
	key := lobbyLeaveKey(gameID, userID)
	s.leaveMu.Lock()
	if t, ok := s.leaving[key]; ok {
		t.Stop()
		delete(s.leaving, key)
	}
	s.leaveMu.Unlock()
}

// scheduleRankedLeave arms a delayed drop from the ranked queue for a user whose
// connection closed, with the same grace as a lobby seat. No-op if they aren't
// queued. Canceled on reconnect.
func (s *Server) scheduleRankedLeave(userID int64) {
	if _, queued, _ := s.ranked.Status(userID); !queued {
		return
	}
	s.leaveMu.Lock()
	if t, ok := s.rankedLeaving[userID]; ok {
		t.Stop()
	}
	s.rankedLeaving[userID] = s.clock.AfterFunc(lobbyLeaveGrace, func() { s.fireRankedLeave(userID) })
	s.leaveMu.Unlock()
}

// fireRankedLeave drops the user from the queue once the grace window elapses,
// unless they reconnected somewhere in the meantime.
func (s *Server) fireRankedLeave(userID int64) {
	s.leaveMu.Lock()
	delete(s.rankedLeaving, userID)
	s.leaveMu.Unlock()
	if s.hub.Online(userID) {
		return // came back within the window; keep them queued
	}
	s.ranked.Leave(userID)
}

// cancelRankedLeave aborts a pending ranked-queue grace-leave, called when a
// user's socket (re)connects, so a refresh keeps them in the queue.
func (s *Server) cancelRankedLeave(userID int64) {
	s.leaveMu.Lock()
	if t, ok := s.rankedLeaving[userID]; ok {
		t.Stop()
		delete(s.rankedLeaving, userID)
	}
	s.leaveMu.Unlock()
}

// detach drops the current game subscription.
func (c *Conn) detach() { c.release() }

// release drops the current game subscription and reports where its stream
// stopped: the game, the viewer it was redacted for, and the first seq its
// forwarder had not handed to c.send (-1 with no subscription). It returns only
// once that forwarder has exited, so the position is final.
//
// handleSub resumes a re-subscribe from this position. The client re-subscribes
// after every event burst, so without it frames the forwarder had not read yet
// would be lost (no `ev` frames, only a snapshot covering them).
func (c *Conn) release() (gameID string, viewer engine.PlayerID, resume int) {
	c.mu.Lock()
	sub, gameID, done := c.sub, c.gameID, c.fwdDone
	c.sub, c.gameID, c.fwdDone = nil, "", nil
	c.mu.Unlock()
	c.srv.hub.setFollowing(c, "") // drop out of the game's follower index
	if sub == nil {
		return gameID, game.Spectator, -1
	}
	sub.Close()
	if done != nil {
		<-done // bounded: Close unblocks Next, and trySend never blocks
	}
	return gameID, sub.Viewer, sub.Position()
}

// maxOwedOnFinish bounds how many owed frames the finished-game path replays
// from the store. The real case is a handful; anything past the send buffer
// would be dropped anyway, and the client refetches a long gap over REST.
const maxOwedOnFinish = sendBuffer

// SpectatorInfo identifies a non-seated watcher of a game.
type SpectatorInfo struct {
	UserID int64  `json:"user_id"`
	Name   string `json:"name"`
}

// gameSpectators lists a game's followers who hold no seat, with names, sorted
// by user id for deterministic output.
func (s *Server) gameSpectators(gameID string) []SpectatorInfo {
	followers := s.hub.GameFollowers(gameID)
	seated := seatedUserIDs(s, gameID)
	out := []SpectatorInfo{}
	for uid := range followers {
		if seated[uid] {
			continue
		}
		name := ""
		if u, err := s.store.UserByID(uid); err == nil {
			name = u.Name
		}
		out = append(out, SpectatorInfo{UserID: uid, Name: name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UserID < out[j].UserID })
	return out
}

// broadcastPresence pushes the current spectator list to a game's followers
// (lobby or active) so players can see who is watching.
func (s *Server) broadcastPresence(gameID string) {
	s.hub.BroadcastGame(gameID, presenceFrame{
		T:          "presence",
		Game:       gameID,
		Spectators: s.gameSpectators(gameID),
	})
}

// seatedUserIDs is the set of user ids holding a seat in the game (used to
// distinguish players from spectators among a game's followers).
func seatedUserIDs(srv *Server, gameID string) map[int64]bool {
	out := map[int64]bool{}
	seats, err := srv.store.Seats(gameID)
	if err != nil {
		return out
	}
	for _, s := range seats {
		out[s.UserID] = true
	}
	return out
}

// shouldReclaimOnSub reports whether a (re)subscribing seated player should have
// their seat reclaimed from a bot. A voluntary spectator (seat status "auto")
// returns only via /return, not a page refresh; a disconnected player ("active")
// reclaims.
func shouldReclaimOnSub(seated bool, seatStatus string) bool {
	return seated && seatStatus != "auto"
}

// handleSub follows a game: seated players get their seat's view, others
// spectate. Private games require being seated or knowing the invite code.
func (c *Conn) handleSub(f clientFrame) {
	g, err := c.srv.store.GameByID(f.Game)
	if err != nil {
		c.sendErr(f.ID, "GAME_NOT_FOUND", "No such game")
		return
	}
	seat, seatErr := c.srv.store.SeatForUser(g.ID, c.userID)
	seated := seatErr == nil
	// Whether this is a fresh follow or a re-sub of the same game (reconnect,
	// second tab, the client's post-event refresh). Read before c.detach() below
	// rewrites c.gameID.
	fresh := c.following() != g.ID
	// The game's creator may always follow it, seated or not (e.g. watching their
	// own all-bot table), even if private and regardless of the spectator cap.
	privileged := seated || c.userID == g.CreatedBy
	invited := inviteAdmits(g, f.Invite)
	if !g.Public && !privileged && !invited {
		c.sendErr(f.ID, "PRIVATE_GAME", "Private game")
		return
	}
	if !privileged {
		// Spectating. Guests may only watch via a valid invite (same gating as
		// joining as a player); public games (no invite) require a Discord
		// identity. Seated players and the host are always allowed through above.
		if u, uErr := c.srv.store.UserByID(c.userID); uErr == nil && u.IsGuest && !invited {
			c.sendErr(f.ID, "GUEST_NEEDS_INVITE", "Guests can only spectate via an invite")
			return
		}
		// Cap concurrent spectators per game to bound fan-out. A user already
		// following (reconnect, second tab) is not double-counted.
		//
		// Finished games are exempt: they start no actor, subscription or forwarder,
		// just a scoreboard read, and old watch links (e.g. Discord posts) keep
		// reaching them long after the game.
		if fresh && g.Status != "finished" {
			seatedSet := seatedUserIDs(c.srv, g.ID)
			if c.srv.hub.SpectatorCount(g.ID, seatedSet) >= c.srv.maxSpectators {
				c.sendErr(f.ID, "SPECTATORS_FULL", "This game has reached its spectator limit")
				return
			}
		}
	}

	viewer := game.Spectator
	if seated {
		viewer = engine.PlayerID(seat.No)
	}

	prevGame, prevViewer, resume := c.release()
	c.mu.Lock()
	c.gameID = g.ID
	c.mu.Unlock()
	c.srv.hub.setFollowing(c, g.ID) // index this conn as following g for O(followers) fan-out
	// Following the game again (reconnect, refresh, second tab) cancels any
	// pending leave armed when this user's previous connection dropped.
	c.srv.cancelLobbyLeave(g.ID, c.userID)

	switch g.Status {
	case "lobby":
		sum, err := c.srv.lobby.Summary(g.ID)
		if err != nil {
			// Back out the follow: a conn following a game it never subscribed to would
			// count toward presence, receive broadcasts, and on close mark a seat absent.
			c.detach()
			c.sendErr(f.ID, "INTERNAL", "Summary failed")
			return
		}
		c.sendJSON(lobbyFrame{T: "lobby", Game: g.ID, Summary: c.srv.sanitize(sum, c.userID)})

	case "active":
		a, err := c.srv.mgr.Get(g.ID)
		if err != nil {
			c.detach() // half-attached otherwise; see the lobby branch above
			c.sendErr(f.ID, "INTERNAL", "Game unavailable")
			return
		}
		// A seated player (re)subscribing reclaims their seat from any bot and is
		// marked present so a suspended game resumes; the host counts as present even
		// unseated. This must run before Subscribe builds the view: Suspend() clears
		// the deadlines, so a view built while suspended would have no turn timer.
		// (c.gameID is set above, so reconcileGamePresence sees this connection.)
		if seated || g.CreatedBy == c.userID {
			seatStatus := ""
			if seated {
				seatStatus = seat.Status
			}
			if shouldReclaimOnSub(seated, seatStatus) {
				c.srv.mgr.MarkSeatPresent(g.ID, viewer)
			}
			c.srv.reconcileGamePresence(g.ID)
		}
		// A re-subscribe by the same viewer to the same game carries on from where
		// the old stream stopped (see release), so nothing queued on it is lost.
		// A different viewer (a spectator who took a seat) starts fresh: its
		// redaction class differs and the snapshot is its starting point.
		from := -1
		if prevGame == g.ID && prevViewer == viewer {
			from = resume
		}
		sub, view := a.SubscribeFrom(viewer, from)
		if view == nil {
			// Same back-out, plus a re-reconcile: this branch is downstream of
			// MarkSeatPresent, so the game was told a human had arrived.
			c.detach()
			c.srv.reconcileGamePresence(g.ID)
			c.sendErr(f.ID, "INTERNAL", "Game unavailable")
			return
		}
		done := make(chan struct{})
		c.attach(g.ID, sub, done)
		// Resend `started` on every active subscribe. The start broadcast
		// (handleStart) is fire-and-forget, so a client that reconnected around the
		// start, or holds a stale lobby summary, would otherwise stay in the waiting
		// room.
		c.sendJSON(lobbyFrame{T: "lobby", Game: g.ID, Started: &trueVal})
		// Send the full view (board, turn, timer deadline) on every subscribe. There is
		// no gap-fill fast path: replaying only missed events sends no timer and could
		// leave a stale view until the next event. `since` is ignored; the view is a
		// bounded snapshot.
		//
		// The frame goes through the forwarder because a resumed subscription must
		// first deliver the events before view.Seq; otherwise the client would fold
		// events the snapshot already covers.
		state, err := json.Marshal(stateFrame{T: "state", Game: g.ID, Seq: view.Seq, Full: view})
		if err != nil {
			state = nil
		}
		go func() {
			defer close(done)
			c.forward(g.ID, sub, state, view.Seq)
		}()

	case "finished":
		c.sendJSON(lobbyFrame{T: "lobby", Game: g.ID, Summary: c.srv.sanitize(mustSummary(c.srv, g.ID), c.userID)})
		// One last state frame for this viewer. The winning command's events and the
		// flip to "finished" commit together, so the client's post-burst resync lands
		// here, and without this the HUD would show the state before the winning move.
		// Built per viewer because the post-game board view is spectator-redacted and
		// would hide the viewer's own hand.
		if fv, err := game.BuildViewerView(c.srv.store, g.ID, viewer); err == nil {
			// A re-subscribe that raced the winning command: the old
			// subscription was released with frames still owed (see release),
			// and this path starts no new one to carry them, so they come from
			// the store, ahead of the snapshot that covers them.
			if prevGame == g.ID && prevViewer == viewer && fv.Seq-resume <= maxOwedOnFinish {
				if owed, err := game.StoredEvFrames(c.srv.store, g.ID, viewer, resume, fv.Seq); err == nil {
					for _, raw := range owed {
						c.trySend(raw)
					}
				}
			}
			c.sendJSON(stateFrame{T: "state", Game: g.ID, Seq: fv.Seq, Full: fv})
		}
		// Post-game screen: the scoreboard plus the live rematch tally.
		c.sendJSON(c.srv.postgameFrame(g.ID, true, ""))
		// A new seated human changes the rematch denominator (postgameFrame counts
		// seated human followers), so refresh everyone's tally. Spectators can't move
		// it, and they are the common arrival on old watch links.
		if seated && c.srv.rematchActive(g.ID) {
			c.srv.hub.BroadcastGame(g.ID, c.srv.postgameFrame(g.ID, false, ""))
		}

	case "abandoned":
		// The host closed this table while the client was away. Signal a clean
		// close so the waiting room bounces back to the lobby.
		c.sendJSON(lobbyFrame{T: "lobby", Game: g.ID, Closed: &trueVal})

	default: // paused-error
		c.sendErr(f.ID, "PAUSED", "This game is paused due to an internal error")
	}
	// Only a spectator arriving changes the watcher list, so only that is
	// broadcast. A seated player newly following still needs the list once (the
	// client clears it on every subscription swap). Re-subs send nothing, keeping
	// DB lookups off the hot path.
	switch {
	case viewer == game.Spectator:
		c.srv.broadcastPresence(g.ID)
	case fresh:
		c.sendJSON(presenceFrame{T: "presence", Game: g.ID, Spectators: c.srv.gameSpectators(g.ID)})
	}
}

func (c *Conn) attach(gameID string, sub *game.Subscription, done chan struct{}) {
	c.mu.Lock()
	old, oldDone := c.sub, c.fwdDone
	c.sub = sub
	c.gameID = gameID
	c.fwdDone = done
	c.mu.Unlock()
	c.srv.hub.setFollowing(c, gameID) // keep the follower index in sync (idempotent on re-sub)
	if old != nil {
		// handleSub releases first, so this is defensive; wait all the same, so
		// two forwarders never write to one connection at once.
		old.Close()
		if oldDone != nil {
			<-oldDone
		}
	}
}

// forward pumps redacted actor events to the client until the subscription
// closes. If the channel closed involuntarily (the actor dropped a slow
// consumer, or the game stopped) and this is still the conn's current sub, tell
// the client to resync. A voluntary unsub/re-sub has already replaced c.sub, so
// no hint is sent.
//
// state is the subscription's snapshot frame (nil for none) and stateSeq its
// seq. It is sent between the last frame before stateSeq and the first at or
// after it: immediately for a fresh subscription, after the owed frames for a
// resumed one.
func (c *Conn) forward(gameID string, sub *game.Subscription, state []byte, stateSeq int) {
	flush := func() {
		if state != nil {
			c.trySend(state)
			state = nil
		}
	}
	if sub.Position() >= stateSeq {
		flush()
	}
	for {
		raw, seq, _, ok := sub.Next()
		if !ok {
			// The ring closed (game stopped / sub closed) or we fell behind the
			// shared window (slow consumer). Either way, stop forwarding; the
			// resync hint below covers the involuntary cases.
			break
		}
		if forwardTaken != nil {
			forwardTaken()
		}
		if seq >= stateSeq {
			flush()
		}
		// raw is the shared pre-encoded frame for this viewer's redaction class.
		// trySend drops to a backed-up client, which resyncs.
		c.trySend(raw)
		if seq+1 >= stateSeq {
			flush()
		}
	}
	c.mu.Lock()
	dropped := c.sub == sub && c.gameID == gameID
	c.mu.Unlock()
	if dropped {
		// Still the live subscription, so the client is owed its snapshot even though
		// the stream ended first. A superseded one is not; its successor sends its own.
		flush()
		// Either the actor dropped us or we fell behind the window. Tell the client
		// to resync: it refetches the enriched getGame (full view + EventsSince) and
		// re-subscribes at the live seq, advancing its cursor.
		c.sendJSON(resyncFrame{T: "resync", Game: gameID})
	}
}

// forwardTaken, when non-nil, runs in forward between taking a frame off the
// ring and queueing it. Tests only: it parks a forwarder in the window release
// must wait out. Set before a forwarder starts, never while one runs.
var forwardTaken func()

// actingSeat resolves, from the seat table, which seat this connection may act
// on in the given game right now. Spectator means none, which every caller
// refuses.
//
// It is read live because a seat captured at subscribe time does not survive
// lobby.Start, which rebuilds seat rows and re-deals turn order. Acting on a
// stale seat would be acting as another player. The lookup is one indexed read
// on the read pool, next to a command that is about to write anyway.
func (c *Conn) actingSeat(gameID string) engine.PlayerID {
	seat, err := c.srv.store.SeatForUser(gameID, c.userID)
	if err != nil {
		// ErrNotFound is the normal answer for a spectator. A real read error is
		// logged and the command refused.
		if !errors.Is(err, store.ErrNotFound) {
			slog.Error("seat lookup for command", "game", gameID, "user", c.userID, "err", err)
		}
		return game.Spectator
	}
	return engine.PlayerID(seat.No)
}

func (c *Conn) handleCmd(f clientFrame) {
	if f.Cmd == nil {
		c.sendErr(f.ID, "BAD_FRAME_MISSING_CMD", "Missing cmd")
		return
	}
	gameID := c.following()
	if gameID == "" || f.Game != gameID {
		c.sendErr(f.ID, "NOT_SUBSCRIBED", "Sub to the game first")
		return
	}
	seat := c.actingSeat(gameID)
	if seat == game.Spectator {
		c.sendErr(f.ID, "SPECTATOR_CANNOT_ACT", "Spectators cannot act")
		return
	}
	a, err := c.srv.mgr.Get(gameID)
	if err != nil {
		c.sendErr(f.ID, "INTERNAL", "Game unavailable")
		return
	}
	// The seat comes from the seat table, never the client.
	cmd := engine.Command{Player: seat, Type: f.Cmd.Type, Data: f.Cmd.Data}
	if err := a.Do(cmd); err != nil {
		c.sendErrParams(f.ID, errCode(err), errParams(err), errMessage(err))
	}
}

// errMessage maps a rejected command's error to its English reference wording,
// sent as errFrame.Debug and never rendered. Raw Go error text never reaches a
// client; the engine owns the wording for rules errors, with a generic fallback.
func errMessage(err error) string {
	if errors.Is(err, game.ErrPaused) {
		return "This game is paused due to an internal error"
	}
	if !isRefusal(err) {
		return storageErrorMessage
	}
	return engine.UserError(err)
}

// storageErrorCode is sent when no rule refused the command and the server
// could not carry it out, typically store.AppendEvents failing (full disk, I/O
// error). Nothing was applied and the player may retry. ILLEGAL_MOVE would
// wrongly blame the player.
const storageErrorCode = "STORAGE_ERROR"

// storageErrorMessage is that code's English reference wording (errFrame.Debug,
// a developer aid; the client renders its own copy from the code).
const storageErrorMessage = "The server could not save that move, so nothing changed. Try again"

// isRefusal reports whether an error is one of the rules refusals the engine's
// registry knows about, i.e. something the player did wrong. engine/ruletest
// fails the build on any decide.go sentinel without a registered code, so an
// error with no code is a server failure.
func isRefusal(err error) bool {
	return engine.ErrorCode(err) != ""
}

// errCode is what the client actually renders from. Every registered refusal has
// its own code (engine/errcode.go); anything else is the server failing rather
// than the player, and gets storageErrorCode plus an operator log line.
func errCode(err error) string {
	if errors.Is(err, game.ErrPaused) {
		return "PAUSED"
	}
	if code := engine.ErrorCode(err); code != "" {
		return code
	}
	// Logged: this is the signal that the store is failing under live play, or
	// that a rules refusal slipped through unregistered.
	slog.Error("command failed with no registered refusal; reported as a server-side failure",
		"code", storageErrorCode, "err", err)
	return storageErrorCode
}

// errParams carries a refusal's variable content to the client as named values,
// so it can compose the sentence in its own language and word order.
func errParams(err error) map[string]any {
	p := engine.ErrorParams(err)
	if len(p) == 0 {
		return nil
	}
	// A parameter that is not a JSON-safe scalar (or a flat container of them) is
	// a bug. Drop the params, keep the code, and log it; the client falls back to
	// its generic copy for the code.
	if !engine.ValidParams(p) {
		slog.Error("refusal params are not wire-safe; dropping", "code", errCode(err), "params", p)
		return nil
	}
	return p
}

func (c *Conn) handleChat(f clientFrame) {
	if f.Msg == "" || len(f.Msg) > maxChatLen {
		c.sendErrParams(f.ID, "CHAT_LENGTH", map[string]any{"min": 1, "max": maxChatLen}, "Message must be 1-500 chars")
		return
	}
	scope := f.Scope
	switch {
	case scope == "lobby":
	case len(scope) > 5 && scope[:5] == "game:":
		if c.following() != scope[5:] {
			c.sendErr(f.ID, "NOT_IN_THAT_GAME", "Not in that game")
			return
		}
	default:
		c.sendErr(f.ID, "BAD_CHAT_SCOPE", "Bad scope")
		return
	}
	// Chat requires a linked Discord identity (so every chatter is accountable
	// and DM-able for moderation). Guests / Google-only logins must link first.
	if c.user == nil || c.user.DiscordID == "" {
		c.sendErr(f.ID, "CHAT_LINK_REQUIRED", "Link your Discord account to chat")
		return
	}
	if banned, err := c.srv.store.IsChatBanned(c.userID); err != nil {
		slog.Error("chat ban check", "user", c.userID, "err", err)
	} else if banned {
		c.sendErr(f.ID, "CHAT_BANNED", "Your chat privileges have been revoked")
		return
	}
	// 1 message/second per user (not per connection, so tabs can't bypass it). A
	// throttled message is dropped, not persisted or broadcast.
	//
	// This runs before the language filter. A filter hit persists a row, opens a
	// report and posts a Discord embed, so throttling first limits that to one
	// report per second per user. A throttled message was never shown, so there
	// is nothing to report.
	if !c.srv.chatLimit.allow(strconv.FormatInt(c.userID, 10)) {
		c.sendErr(f.ID, "CHAT_RATE_LIMITED", "One message per second")
		return
	}
	// Automated language filter: a hit drops the message and opens a report for a
	// moderator (see docs/moderation.md). The filter has false positives, so it
	// does not ban.
	//
	// The message is persisted but not broadcast, so a moderator can read it; the
	// report row keys off chat.id.
	if word, hit := chatfilter.Match(f.Msg); hit {
		chatID, err := c.srv.store.SaveFilteredChat(scope, c.userID, f.Msg)
		if err != nil {
			slog.Error("filtered chat save", "scope", scope, "user", c.userID, "err", err)
			c.sendErr(f.ID, "INTERNAL", "Try again later")
			return
		}
		reportID, isNew, err := c.srv.store.CreateFilterReport(c.userID, chatID, scope)
		if err != nil {
			slog.Error("filter report", "chat", chatID, "user", c.userID, "err", err)
		} else if isNew {
			// Best-effort and off the hot path, exactly as handleReport does it:
			// the report is already durably stored.
			slog.Info("language filter opened a report", "report", reportID, "user", c.userID, "word", word)
			c.srv.bg.Go(func() { c.srv.postReportEmbed(reportID) })
		}
		// Not CHAT_BANNED: nothing has been revoked, and the hit may be a false
		// positive.
		c.sendErr(f.ID, "CHAT_FILTERED", "Message not sent. It has been flagged for review")
		return
	}
	id, err := c.srv.store.SaveChat(scope, c.userID, f.Msg)
	if err != nil {
		slog.Error("chat save", "scope", scope, "user", c.userID, "err", err)
		return
	}
	frame := chatFrame{T: "chat", ID: id, Scope: scope, From: c.user.Name, UserID: c.userID, Msg: f.Msg}
	if scope == "lobby" {
		c.srv.hub.Broadcast(frame)
	} else {
		c.srv.hub.BroadcastGame(scope[5:], frame)
	}
}

func mustSummary(s *Server, gameID string) *lobby.Summary {
	sum, err := s.lobby.Summary(gameID)
	if err != nil {
		return nil
	}
	return sum
}
