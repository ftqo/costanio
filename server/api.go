package server

import (
	crand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	mrand "math/rand/v2"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strconv"
	"strings"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/namefilter"
	"github.com/ftqo/costan.io/ranked"
	"github.com/ftqo/costan.io/store"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// noStore marks a response as uncacheable. Used on endpoints that expose live
// entitlement state (supporter status, wallet, loadout, colors), so a cache
// cannot keep showing a supporter badge after the role is removed.
func noStore(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-store") }

// writeErr writes a machine-readable error body: {"code":..., "debug":...}.
//
// `code` is the contract: a stable SCREAMING_SNAKE identifier, one per distinct
// condition, and the only field a client may branch on or render from. If two
// call sites need different text on screen, they need different codes.
//
// `debug` is English for curl and the network tab. Clients must not render it;
// they render their own copy keyed off `code` (and `params`, see
// writeErrParams). It is not stable and not translated.
func writeErr(w http.ResponseWriter, status int, code, debug string) {
	writeJSON(w, status, map[string]any{"code": code, "debug": debug})
}

// writeErrParams is writeErr for a condition whose text has variable content (a
// count, a limit, a name). The variable parts travel as named parameters the
// client interpolates into its own copy: {"code":"NAME_TOO_LONG","params":{"max":32},...}.
//
// Values must be JSON scalars or flat containers of scalars, never sentences.
func writeErrParams(w http.ResponseWriter, status int, code string, params map[string]any, debug string) {
	writeJSON(w, status, map[string]any{"code": code, "params": params, "debug": debug})
}

// islandsNeedsSea reports whether err is (or wraps) the engine refusing
// Islands on a map with no open water.
func islandsNeedsSea(err error) bool {
	var mie *engine.MapIssueError
	return errors.As(err, &mie) && mie.IsIslandsNeedsSea()
}

// harbormasterNeedsHarbours reports whether err is (or wraps) the engine
// refusing Harbormaster on a map with too few harbours for its card, and the
// minimum the map needs.
func harbormasterNeedsHarbours(err error) (map[string]any, bool) {
	var mie *engine.MapIssueError
	if !errors.As(err, &mie) || !mie.IsHarbormasterNeedsHarbours() {
		return nil, false
	}
	return map[string]any{"min": mie.Issue.Params["min"]}, true
}

// writeMapRefusal writes the named map/ruleset refusal the lobby and the
// preview share, and reports whether err was one of them.
func writeMapRefusal(w http.ResponseWriter, err error) bool {
	if islandsNeedsSea(err) {
		writeErr(w, http.StatusBadRequest, "ISLANDS_NEEDS_SEA", "Islands needs a map with open sea")
		return true
	}
	if params, ok := harbormasterNeedsHarbours(err); ok {
		writeErrParams(w, http.StatusBadRequest, "HARBORMASTER_NEEDS_HARBOURS", params, "Harbormaster needs a map with at least 2 harbours")
		return true
	}
	return false
}

// lobbyErr maps lobby errors onto API responses.
func lobbyErr(w http.ResponseWriter, err error) {
	// Raw err.Error() is never forwarded: lobby/engine errors carry internal
	// prefixes ("lobby:", "board:"). Each case maps to its own code.
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "GAME_NOT_FOUND", "No such game")
	case errors.Is(err, lobby.ErrRulesetConflict):
		// The pair travels as module keys, not the engine's English reason. The
		// client renders the reason itself from frontend/src/lib/expansionCompat.ts.
		writeErrParams(w, http.StatusBadRequest, "RULESET_CONFLICT", map[string]any{"modules": conflictingModules(err)}, "Those expansions can't be combined")
	case errors.As(err, new(*board.SeatsError)):
		// Checked before BAD_CONFIG, which also wraps it: a host reaches this just by
		// raising max players, so it names the map's ceiling.
		writeErrParams(w, http.StatusBadRequest, "MAP_TOO_SMALL", seatsParams(err), "This map can't seat that many players")
	case writeMapRefusal(w, err):
		// Also before BAD_CONFIG: Islands on an all-land map, or Harbormaster on a map
		// with one harbour, should tell the host which setting to change.
	case errors.Is(err, lobby.ErrBadConfig):
		writeErr(w, http.StatusBadRequest, "BAD_CONFIG", "That game setup isn't valid")
	case errors.Is(err, lobby.ErrBadInvite):
		writeErr(w, http.StatusForbidden, "BAD_INVITE", "That invite code isn't valid")
	case errors.Is(err, lobby.ErrGuestNeedsLink):
		writeErr(w, http.StatusForbidden, "GUEST_NEEDS_LINK", "Guests can only join via an invite link")
	case errors.Is(err, lobby.ErrRankedNoReset):
		writeErr(w, http.StatusConflict, "RANKED_NO_RESET", "A ranked game can't be reset")
	case errors.Is(err, lobby.ErrNotHost):
		writeErr(w, http.StatusForbidden, "NOT_HOST", "Only the host can do that")
	case errors.Is(err, lobby.ErrBadHostTarget):
		writeErr(w, http.StatusUnprocessableEntity, "BAD_HOST_TARGET", "That player can't be made host")
	case errors.Is(err, lobby.ErrSupporterOnly):
		writeErr(w, http.StatusForbidden, "BOT_GAME_SUPPORTER_ONLY", "Starting a game against only bots is a supporter perk")
	case errors.Is(err, cosmetics.ErrNotOwned):
		writeErr(w, http.StatusForbidden, "COLOR_LOCKED", "You don't have that color")
	case errors.Is(err, cosmetics.ErrUnknownColor):
		writeErr(w, http.StatusBadRequest, "BAD_COLOR", "Unknown color")
	case errors.Is(err, cosmetics.ErrUnknownItem), errors.Is(err, cosmetics.ErrWrongSlot):
		writeErr(w, http.StatusBadRequest, "BAD_ITEM", "Unknown decoration")
	case errors.Is(err, lobby.ErrFull):
		writeErr(w, http.StatusConflict, "GAME_FULL", "This game is full")
	case errors.Is(err, lobby.ErrAlreadySeated):
		writeErr(w, http.StatusConflict, "ALREADY_SEATED", "You're already seated in this game")
	case errors.Is(err, lobby.ErrNotSeated):
		writeErr(w, http.StatusConflict, "NOT_SEATED", "You're not seated in this game")
	case errors.Is(err, lobby.ErrNotInLobby):
		writeErr(w, http.StatusConflict, "NOT_IN_LOBBY", "This game is no longer open for changes")
	case errors.Is(err, lobby.ErrCantKickHost):
		writeErr(w, http.StatusConflict, "CANT_KICK_HOST", "The host can't be removed")
	case errors.Is(err, lobby.ErrColorTaken):
		writeErr(w, http.StatusConflict, "COLOR_TAKEN", "That color is too close to another player's")
	case errors.Is(err, lobby.ErrNotEnough):
		writeErr(w, http.StatusConflict, "NOT_ENOUGH_PLAYERS", "You need at least 2 players to start")
	case errors.Is(err, lobby.ErrNotActive):
		writeErr(w, http.StatusConflict, "NOT_ACTIVE", "This game isn't in progress")
	default:
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Something went wrong")
	}
}

// seatsParams is a SeatsError's two numbers, for MAP_TOO_SMALL's copy.
func seatsParams(err error) map[string]any {
	var se *board.SeatsError
	if errors.As(err, &se) {
		return map[string]any{"max": se.Max, "players": se.Players}
	}
	return map[string]any{}
}

// conflictingModules returns every member of the incompatible combination.
// An untyped conflict returns an empty array for the client's generic fallback.
func conflictingModules(err error) []string {
	var ce *engine.ConflictError
	if errors.As(err, &ce) {
		return ce.Modules()
	}
	return []string{}
}

// maxJSONBody caps request bodies on JSON POST handlers (DoS guard).
const maxJSONBody = 64 << 10

// participatesIn reports whether the user is the host of or seated in the game.
// Used to gate access to private games (mirrors the WS sub gate).
func (s *Server) participatesIn(g *store.Game, userID int64) bool {
	if g.CreatedBy == userID {
		return true
	}
	if _, err := s.store.SeatForUser(g.ID, userID); err == nil {
		return true
	}
	return false
}

// sanitize strips the invite code unless the requester is seated (or host).
//
// It copies the summary and blanks one field, so fields added to Summary later
// pass through untouched. The case that matters is a spectator who followed an
// invite link to a private lobby: they pass the WS gate on the code alone
// (handleSub) but are neither host nor seated.
//
// A public table's code is not a secret: the table is listed and joinable
// anyway. Going private mints a fresh code (lobby.SetPrivacy), so a link shared
// while the table was public stops working when it closes.
func (s *Server) sanitize(sum *lobby.Summary, userID int64) *lobby.Summary {
	if sum == nil {
		return nil
	}
	if sum.Game.Public {
		return sum
	}
	if sum.Game.CreatedBy == userID {
		return sum
	}
	for _, seat := range sum.Seats {
		if seat.UserID == userID {
			return sum
		}
	}
	g := *sum.Game
	g.InviteCode = ""
	out := *sum
	out.Game = &g
	return &out
}

// withoutInvites blanks the invite code on any private table in a list response.
//
// Public tables keep theirs so the link can be passed on; going private rotates
// the code (lobby.SetPrivacy). Private tables should not appear in these
// listings at all (ListGames filters on `public`), so this is a second line of
// defence on two unauthenticated endpoints.
//
// It copies rather than clearing in place because Browse() returns a cached
// slice (browseCacheTTL) shared by concurrent requests.
func withoutInvites(sums []*lobby.Summary) []*lobby.Summary {
	out := make([]*lobby.Summary, 0, len(sums))
	for _, sum := range sums {
		if sum == nil || sum.Game == nil || sum.Game.Public {
			out = append(out, sum)
			continue
		}
		g := *sum.Game
		g.InviteCode = ""
		copied := *sum
		copied.Game = &g
		out = append(out, &copied)
	}
	return out
}

func (s *Server) handleBrowse(w http.ResponseWriter, r *http.Request) {
	if !s.browseLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}
	sums, err := s.lobby.Browse()
	if err != nil {
		lobbyErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": withoutInvites(sums)})
}

// handleLiveGames serves the public list of in-progress public games for the
// homepage "live now" spectate section. Private games are never included.
func (s *Server) handleLiveGames(w http.ResponseWriter, r *http.Request) {
	if !s.browseLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}
	sums, err := s.lobby.LiveGames()
	if err != nil {
		lobbyErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": withoutInvites(sums)})
}

func (s *Server) handleCreateGame(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if !s.createLimit.allow(strconv.FormatInt(u.ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "GAME_CREATE_RATE_LIMITED", "Too many games created")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Config  engine.GameConfig `json:"config"`
		Private bool              `json:"private"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	sum, err := s.lobby.Create(u, body.Config, body.Private)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.detachFromOthers(u, sum.Game.ID)
	s.ranked.Leave(u.ID)                  // being in a table and the ranked queue are mutually exclusive
	writeJSON(w, http.StatusCreated, sum) // creator always sees the invite
}

// gameDetail is the GET /api/games/{id} response. For active games it embeds the
// lobby summary (game + seats) and adds the per-viewer live view, the redacted
// event log from `?since` onwards (the whole game by default), and the last 50
// chat lines, so the in-game screen renders from the HTTP response without
// waiting for the websocket. The embedded *lobby.Summary promotes its
// `game`/`seats` fields inline.
type gameDetail struct {
	*lobby.Summary
	View *game.FullView   `json:"view,omitempty"`
	Log  []engine.Event   `json:"log,omitempty"`
	Chat []store.ChatLine `json:"chat,omitempty"`
}

func (s *Server) handleGetGame(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	id := r.PathValue("id")
	g, err := s.store.GameByID(id)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	participant := s.participatesIn(g, u.ID)
	// Holding the invite code authorizes reading a private game, as it does
	// following one over the websocket (handleSub). The two must agree: the game
	// screen fetches this and subscribes, and leaves on a terminal 4xx here. The
	// Discord feed's watch link carries `inv` for this reason.
	invited := inviteAdmits(g, inviteParam(r))
	// Guests may only read a game they're seated in or hold the code for. Every
	// other table, public ones included, is for registered users.
	if u.IsGuest && !participant && !invited {
		writeErr(w, http.StatusForbidden, "LOGIN_REQUIRED_TO_VIEW", "Log in to view this table")
		return
	}
	// Private games disclose nothing unless the requester is the host, seated,
	// or holding the code. sanitize strips the invite from the response for
	// everyone but host and seated, so this never hands the code to someone who
	// did not arrive with it.
	if !g.Public && !participant && !invited {
		writeErr(w, http.StatusForbidden, "PRIVATE_GAME", "Private game")
		return
	}
	sum, err := s.lobby.Summary(id)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	detail := &gameDetail{Summary: s.sanitize(sum, u.ID)}
	if g.Status == "active" {
		// The log is the only unbounded part of this response. Seated players are
		// exempt (see allowLog).
		if !participant && !s.allowLog(w, r, u) {
			return
		}
		n := s.enrichActive(detail, g.ID, u.ID, logSinceParam(r))
		if !participant {
			s.chargeLog(r, u, n)
		}
	}
	writeJSON(w, http.StatusOK, detail)
}

// allowLog gates a response that is about to carry a game's event log, where a
// small request can buy a large answer (a long game's log is hundreds of KB).
// It writes the 429 itself and reports whether to continue.
//
//   - Seated players and the host are exempt at the getGame call site: the
//     client leaves a game when getGame fails, so a limit here must never evict
//     someone from their own table, e.g. a household behind one NAT. Replays
//     have no such hazard and handleReplay meters everyone.
//   - The meter counts events, not requests, charged afterwards (chargeLog). A
//     reconnect asks `?since=<first missing seq>` and pays for the gap only.
//
// The per-user bucket is the primary meter, so shared IPs are not a problem.
// The per-IP bucket is a backstop against minting guest sessions for fresh
// budgets, and is several times more generous than the per-user one.
func (s *Server) allowLog(w http.ResponseWriter, r *http.Request, u *store.User) bool {
	if !s.logLimit.allow(strconv.FormatInt(u.ID, 10)) || !s.logIPLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "LOG_RATE_LIMITED", "Too many event-log requests; try again shortly")
		return false
	}
	return true
}

// chargeLog bills the caller for the events a log-bearing response actually
// carried. Paired with allowLog; see tokenBucket.charge for why the cost is
// settled afterwards instead of being guessed up front.
func (s *Server) chargeLog(r *http.Request, u *store.User, events int) {
	if events <= 0 {
		return
	}
	s.logLimit.charge(strconv.FormatInt(u.ID, 10), float64(events))
	s.logIPLimit.charge(s.rateKey(r), float64(events))
}

// inviteParam reads the `?inv=` invite code off a request. The same key is used
// by the page routes, the REST fetch and the websocket, so one link works for all
// three.
func inviteParam(r *http.Request) string {
	return r.URL.Query().Get("inv")
}

// mayReadOver reports whether this caller may read a game that is over: its log
// or its frames. The rule matches the socket's (handleSub): an invite holder who
// could watch the game live may also watch it back.
func (s *Server) mayReadOver(g *store.Game, r *http.Request, participant bool) bool {
	if participant || g.Public {
		return true
	}
	return inviteAdmits(g, inviteParam(r))
}

// inviteAdmits reports whether a presented invite code admits its holder to g.
// Every gate that honours an invite (handleGetGame, mayReadOver, handleSub)
// uses it.
//
// The empty check matters: public games created before migration 0029 and all
// ranked games have no code, and an empty invite must not match an empty code.
func inviteAdmits(g *store.Game, invite string) bool {
	return invite != "" && invite == g.InviteCode
}

// logSinceParam reads the `?since=` event cursor off a getGame request: the
// first log seq the caller is missing. Absent, negative or unparseable means 0
// (the whole log), which is what a client opening the game wants; the server's
// in-memory ring holds only a short tail (see game.frameRingCap).
func logSinceParam(r *http.Request) int {
	raw := r.URL.Query().Get("since")
	if raw == "" {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// enrichActive fills the live fields for an active game, redacted to the
// requester's seat (spectator if unseated). Best-effort: if the actor can't be
// loaded the fields are omitted and the client falls back to the websocket.
// Redaction uses the same paths as the live stream (View / EventsSince ->
// RedactEvent).
//
// `since` is the first log seq the caller still needs. It reads from SQLite,
// not the actor's broadcast ring, so a client can rebuild the log from event 0.
//
// Returns the number of log events served, which is what the caller is billed
// for (see chargeLog). The rest of the response is bounded.
func (s *Server) enrichActive(d *gameDetail, gameID string, userID int64, since int) int {
	viewer := game.Spectator
	if seat, err := s.store.SeatForUser(gameID, userID); err == nil {
		viewer = engine.PlayerID(seat.No)
	}
	a, err := s.mgr.Get(gameID)
	if err != nil {
		return 0
	}
	view := a.View(viewer)
	if view == nil {
		return 0
	}
	d.View = view
	if log, err := a.EventsSince(viewer, since); err == nil {
		d.Log = log
	}
	if chat, err := s.store.RecentChat("game:"+gameID, 50); err == nil {
		d.Chat = chat
	}
	return len(d.Log)
}

func (s *Server) handleInviteResolve(w http.ResponseWriter, r *http.Request) {
	g, err := s.store.GameByInvite(r.PathValue("code"))
	if err != nil {
		lobbyErr(w, err)
		return
	}
	sum, err := s.lobby.Summary(g.ID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sum) // knowing the code grants access
}

func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Invite string `json:"invite"`
	}
	// An empty body is a valid public join (io.EOF); any other decode error is a
	// malformed request and gets a 400, matching the other body-decoding handlers.
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	sum, err := s.lobby.Join(u, r.PathValue("id"), body.Invite)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.detachFromOthers(u, sum.Game.ID)
	s.ranked.Leave(u.ID) // being in a table and the ranked queue are mutually exclusive
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	s.broadcastPresence(sum.Game.ID) // a spectator taking a seat drops off the watcher list
	writeJSON(w, http.StatusOK, sum)
}

// detachFromOthers removes a user from every table other than keep: a lobby is
// left (the host leaving closes it), and an in-progress seat is handed to a bot
// (they can rejoin), then presence is reconciled (suspending the game if they
// were the last human). Best-effort: failing to detach from one table must not
// fail the join.
func (s *Server) detachFromOthers(u *store.User, keep string) {
	others, err := s.store.SeatedActiveGames(u.ID)
	if err != nil {
		return
	}
	for _, g := range others {
		if g.ID == keep {
			continue
		}
		switch g.Status {
		case "lobby":
			if closed, err := s.lobby.Leave(u, g.ID); err == nil {
				s.announceLobbyLeave(g.ID, closed)
			}
		case "active":
			seat, err := s.store.SeatForUser(g.ID, u.ID)
			if err != nil {
				continue
			}
			if err := s.mgr.LeaveSeat(g.ID, engine.PlayerID(seat.No)); err == nil {
				// Mirror handleLeave: mark the seat as bot-played so observers see
				// "Bot …" and the owner spectates, then refresh rosters. Best-effort
				// (a failed status write must not fail the join being processed).
				_ = s.store.SetSeatStatus(g.ID, seat.No, "auto")
				s.reconcileGamePresence(g.ID)
				s.broadcastRoster(g.ID)
				s.announceLobbyLeave(g.ID, false)
			}
		}
	}
}

func (s *Server) handleLeave(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	id := r.PathValue("id")
	g, err := s.store.GameByID(id)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	if g.Status == "active" {
		seat, err := s.store.SeatForUser(id, u.ID)
		if err != nil {
			lobbyErr(w, err) // spectators aren't seated; client navigates away anyway
			return
		}
		if err := s.mgr.LeaveSeat(id, engine.PlayerID(seat.No)); err != nil {
			lobbyErr(w, err)
			return
		}
		// Mark the seat as voluntarily handed to a bot so every client can render
		// the leaver as a spectator and label the seat "Bot …".
		if err := s.store.SetSeatStatus(id, seat.No, "auto"); err != nil {
			lobbyErr(w, err)
			return
		}
		s.reconcileGamePresence(id) // last human leaving -> suspend
		s.broadcastRoster(id)
		s.announceLobbyLeave(id, false)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	closed, err := s.lobby.Leave(u, id)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.announceLobbyLeave(id, closed)
	w.WriteHeader(http.StatusNoContent)
}

// handleReturn lets a player who used "Leave & Spectate" reclaim their seat from
// the bot now playing it. Only valid while their seat is in the voluntary-leave
// "auto" state; a normal reconnect (an "active" seat) reclaims on its own in the
// websocket sub path.
func (s *Server) handleReturn(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	id := r.PathValue("id")
	g, err := s.store.GameByID(id)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	if g.Status != "active" {
		writeErr(w, http.StatusConflict, "NOT_ACTIVE", "This game isn't in progress")
		return
	}
	seat, err := s.store.SeatForUser(id, u.ID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	if seat.Status != "auto" {
		writeErr(w, http.StatusConflict, "NOT_SPECTATING", "You are not spectating your seat")
		return
	}
	s.mgr.MarkSeatPresent(id, engine.PlayerID(seat.No)) // hand the live seat back from the bot
	if err := s.store.SetSeatStatus(id, seat.No, "active"); err != nil {
		lobbyErr(w, err)
		return
	}
	s.reconcileGamePresence(id) // resume if the game had suspended
	s.broadcastRoster(id)
	w.WriteHeader(http.StatusNoContent)
}

// handleSpectate drops the caller's lobby seat so they keep watching without
// holding a slot. The connection stays subscribed; the refreshed summary shows
// the freed seat to everyone.
func (s *Server) handleSpectate(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	id := r.PathValue("id")
	if err := s.lobby.Spectate(u, id); err != nil {
		lobbyErr(w, err)
		return
	}
	// Broadcast to followers and also return it, so the caller updates without
	// waiting for the websocket echo.
	sum, err := s.lobby.Summary(id)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(id, map[string]any{"t": "lobby", "game": id, "summary": sum})
	s.broadcastPresence(id) // the opting-out player now counts as a spectator
	writeJSON(w, http.StatusOK, sum)
}

// announceLobbyLeave tells a lobby's followers about a departure: a host leaving
// closes the table (everyone bounces out), otherwise the seat list just shrinks.
func (s *Server) announceLobbyLeave(gameID string, closed bool) {
	if closed {
		s.hub.BroadcastGame(gameID, map[string]any{"t": "lobby", "game": gameID, "closed": true})
		return
	}
	if sum, err := s.lobby.Summary(gameID); err == nil {
		s.hub.BroadcastGame(gameID, map[string]any{"t": "lobby", "game": gameID, "summary": sum})
	}
}

// broadcastRoster nudges every follower of a game to refetch its roster (seat
// list + statuses) by sending a resync frame. Used when a seat's control flips
// between a human and a bot mid-game so the "Bot …" label and the spectator UI
// update live for everyone, not just the acting client.
func (s *Server) broadcastRoster(gameID string) {
	s.hub.BroadcastGame(gameID, map[string]any{"t": "resync"})
}

func (s *Server) handleAddBot(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	sum, err := s.lobby.AddBot(u, r.PathValue("id"))
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleKick(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	seat, err := strconv.Atoi(r.PathValue("seat"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "BAD_SEAT", "Bad seat")
		return
	}
	sum, err := s.lobby.KickSeat(u, r.PathValue("id"), seat)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleTransferHost(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		NewHostID int64 `json:"new_host_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	sum, err := s.lobby.TransferHost(u, r.PathValue("id"), body.NewHostID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleSetSeatColor(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Color string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	sum, err := s.lobby.SetSeatColor(u, r.PathValue("id"), body.Color)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, sum)
}

// maxNameLen caps a display name (seat override or account name), in bytes. It
// travels to the client as the `max` param on NAME_REQUIRED / NAME_TOO_LONG so
// the UI writes the limit into its own sentence rather than reading ours.
const maxNameLen = 32

// screenName applies the display-name policy shared by the seat-name and account-
// name endpoints. It returns the sanitized name to store with ok=true when the name
// is acceptable; on any rejection it writes the error response and returns
// ok=false, so the caller just returns. A slur locks the account (mirroring the
// chat auto-ban) and freezes the current name; a reserved impersonation name is
// rejected without locking. allowEmpty lets an empty (post-sanitize) name through:
// the seat-name endpoint uses this, where "" clears the per-seat override.
func (s *Server) screenName(w http.ResponseWriter, userID int64, proposed string, allowEmpty bool) (string, bool) {
	if locked, err := s.store.IsNameLocked(userID); err != nil {
		slog.Error("name lock check", "user", userID, "err", err)
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not update name")
		return "", false
	} else if locked {
		writeErr(w, http.StatusForbidden, "NAME_LOCKED", "Your name is locked; contact a moderator")
		return "", false
	}
	clean, v, word := namefilter.Screen(proposed)
	switch v {
	case namefilter.NameSlur:
		if err := s.store.LockName(userID, "attempted name: "+word, nil); err != nil {
			slog.Error("name lock write", "user", userID, "err", err)
		}
		s.bg.Go(func() { s.postNameLockEmbed(userID, proposed, word) })
		writeErr(w, http.StatusForbidden, "NAME_LOCKED", "Your name is locked; contact a moderator")
		return "", false
	case namefilter.NameReserved:
		writeErr(w, http.StatusBadRequest, "NAME_RESERVED", "That name is reserved")
		return "", false
	case namefilter.NameEmpty:
		if allowEmpty {
			return "", true
		}
		writeErrParams(w, http.StatusBadRequest, "NAME_REQUIRED", map[string]any{"max": maxNameLen}, "Name required (max 32 chars)")
		return "", false
	default:
		// NameOK: fall through to the length check below.
	}
	if len(clean) > maxNameLen {
		writeErrParams(w, http.StatusBadRequest, "NAME_TOO_LONG", map[string]any{"max": maxNameLen}, "Name too long (max 32 chars)")
		return "", false
	}
	return clean, true
}

func (s *Server) handleSetSeatName(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	// allowEmpty: an empty seat name clears the per-seat override (resets to the
	// account default), so it must pass through the filter.
	name, ok := s.screenName(w, u.ID, body.Name, true)
	if !ok {
		return
	}
	sum, err := s.lobby.SetSeatName(u, r.PathValue("id"), name)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, sum)
}

// handleSetSeatDecoration equips the caller's name decoration ("" clears it) and
// broadcasts the rebuilt lobby summary so every seated/spectating player sees the
// change at once. Decoration is loadout-derived, so this updates the account
// loadout just like the cosmetics menu; ownership is gated in the lobby.
func (s *Server) handleSetSeatDecoration(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Decoration string `json:"decoration"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	sum, err := s.lobby.SetSeatDecoration(u, r.PathValue("id"), body.Decoration)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, sum)
}

// handleUpdateMe updates the caller's account settings. Guests have no
// persistent settings (they name themselves per-game in the waiting room).
func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if u.IsGuest {
		writeErr(w, http.StatusForbidden, "GUEST_NO_SETTINGS", "Guests have no settings")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	// Name is a pointer so an absent key can mean "leave it" if this ever grows
	// a second field; today it is the only setting an account carries.
	var body struct {
		Name *string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	// An empty body is still a name update with no name, which is what it has
	// always been: NAME_REQUIRED, not a silent no-op.
	if body.Name == nil {
		body.Name = new(string)
	}
	name := ""
	if body.Name != nil {
		var ok bool
		if name, ok = s.screenName(w, u.ID, *body.Name, false); !ok {
			return
		}
	}
	if body.Name != nil {
		if err := s.store.SetUserName(u.ID, name); err != nil {
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not update name")
			return
		}
		u.Name = name
	}
	s.writeProfile(w, u, true)
}

// maxMapsPerUser caps how many custom maps a single account may store.
const maxMapsPerUser = 200

// maxMapNameLen caps a saved map's name, in bytes. Both limits ride out as the
// `max` param on MAP_LIMIT_REACHED / MAP_NAME_TOO_LONG.
const maxMapNameLen = 60

func (s *Server) handleSaveMap(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if !s.mapSaveLimit.allow(strconv.FormatInt(u.ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "MAP_SAVE_RATE_LIMITED", "Too many map saves")
		return
	}
	existing, err := s.store.ListMapsByUser(u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not check map count")
		return
	}
	if len(existing) >= maxMapsPerUser {
		// A quota, not a rate limit: waiting does not clear it, deleting a map does.
		writeErrParams(w, http.StatusTooManyRequests, "MAP_LIMIT_REACHED", map[string]any{"max": maxMapsPerUser}, "Map limit reached; delete some maps first")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Name  string       `json:"name"`
		Board *board.Board `json:"board"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" || body.Board == nil {
		writeErr(w, http.StatusBadRequest, "MAP_NAME_AND_BOARD_REQUIRED", "Name and board required")
		return
	}
	if len(body.Name) > maxMapNameLen {
		writeErrParams(w, http.StatusBadRequest, "MAP_NAME_TOO_LONG", map[string]any{"max": maxMapNameLen}, "Name too long")
		return
	}
	if err := body.Board.ValidateLayout(); err != nil {
		writeErr(w, http.StatusBadRequest, "MAP_LAYOUT_INVALID", "That map layout isn't valid")
		return
	}
	bj, err := json.Marshal(body.Board)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Encode failed")
		return
	}
	m := &store.Map{Name: body.Name, Board: bj, CreatedBy: u.ID}
	if err := s.store.CreateMap(m); err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not save map")
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) handleListMaps(w http.ResponseWriter, r *http.Request) {
	// Owner-scoped: maps have no share flag, and the lobby picker is the host's own
	// library. ?mine=1 is accepted but redundant.
	u := auth.UserFrom(r.Context())
	maps, err := s.store.ListMapsByUser(u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not list maps")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"maps": maps})
}

func (s *Server) handleGetMap(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	m, err := s.store.MapByID(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "MAP_NOT_FOUND", "No such map")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not load map")
		return
	}
	// Return the same 404 as a missing map so a non-owner cannot tell an id
	// exists (as DeleteMap / ListMapsByUser do).
	if m.CreatedBy != u.ID {
		writeErr(w, http.StatusNotFound, "MAP_NOT_FOUND", "No such map")
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleDeleteMap(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	err := s.store.DeleteMap(r.PathValue("id"), u.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "MAP_NOT_FOUND", "No such map")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not delete map")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleEncodeMap turns a board into a short, shareable map code.
func (s *Server) handleEncodeMap(w http.ResponseWriter, r *http.Request) {
	// Metered for CPU, not for writes: this hands an arbitrary board to the
	// validator, the fair solver or the harbor placer. See mapToolLimit.
	if !s.mapToolLimit.allow(strconv.FormatInt(auth.UserFrom(r.Context()).ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "MAP_TOOL_RATE_LIMITED", "Too many map requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Board *board.Board `json:"board"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Board == nil {
		writeErr(w, http.StatusBadRequest, "BOARD_REQUIRED", "Board required")
		return
	}
	if err := body.Board.ValidateLayout(); err != nil {
		writeErr(w, http.StatusBadRequest, "MAP_LAYOUT_INVALID", "That map layout isn't valid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": board.EncodeBoard(body.Board)})
}

// handleFrameMap computes a board's ocean from its land and returns the framed
// board (the same transform applied at game start to custom maps).
func (s *Server) handleFrameMap(w http.ResponseWriter, r *http.Request) {
	if !s.mapToolLimit.allow(strconv.FormatInt(auth.UserFrom(r.Context()).ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "MAP_TOOL_RATE_LIMITED", "Too many map requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Board *board.Board `json:"board"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Board == nil {
		writeErr(w, http.StatusBadRequest, "BOARD_REQUIRED", "Board required")
		return
	}
	if err := body.Board.ValidateLayout(); err != nil {
		writeErr(w, http.StatusBadRequest, "MAP_LAYOUT_INVALID", "That map layout isn't valid")
		return
	}
	body.Board.Frame()
	writeJSON(w, http.StatusOK, map[string]any{"board": body.Board})
}

// handleDecodeMap turns a map code back into a board.
func (s *Server) handleDecodeMap(w http.ResponseWriter, r *http.Request) {
	if !s.mapToolLimit.allow(strconv.FormatInt(auth.UserFrom(r.Context()).ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "MAP_TOOL_RATE_LIMITED", "Too many map requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		writeErr(w, http.StatusBadRequest, "MAP_CODE_REQUIRED", "Code required")
		return
	}
	b, err := board.DecodeBoard(body.Code)
	if err == nil {
		err = b.ValidateLayout()
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, "BAD_CODE", "That doesn't look like a valid map code")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"board": b})
}

// handleLintMap reports a board's structural and balance issues without
// rejecting it; the builder shows them as warnings. An empty list means clean.
func (s *Server) handleLintMap(w http.ResponseWriter, r *http.Request) {
	if !s.mapToolLimit.allow(strconv.FormatInt(auth.UserFrom(r.Context()).ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "MAP_TOOL_RATE_LIMITED", "Too many map requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Board   *board.Board `json:"board"`
		Ruleset string       `json:"ruleset"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Board == nil {
		writeErr(w, http.StatusBadRequest, "BOARD_REQUIRED", "Board required")
		return
	}
	if err := body.Board.ValidateLayout(); err != nil {
		writeErr(w, http.StatusBadRequest, "MAP_LAYOUT_INVALID", "That map layout isn't valid")
		return
	}
	issues := board.Lint(body.Board)
	// Terrain/ruleset eligibility (gold needs Islands, Islands needs water, ...) is
	// the same gate the lobby applies at creation, so the builder never approves a
	// board Play would reject. Defaults to the base ruleset.
	ruleset := body.Ruleset
	if ruleset == "" {
		ruleset = "base"
	}
	if engine.ValidRuleset(ruleset) {
		issues = append(issues, engine.MapEligibilityIssues(body.Board, ruleset)...)
	}
	for i := range issues {
		if issues[i].Hexes == nil {
			issues[i].Hexes = []board.Hex{}
		}
	}
	if issues == nil {
		issues = []board.Issue{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"issues": issues})
}

// handleRandomizeMap fills the current board shape with a fresh, balanced set of
// resources and number tokens. It strips the board back to its land/sea
// silhouette and runs the same fair solver the engine uses at game start, with a
// non-deterministic seed so each click yields a new layout. Harbors are
// preserved; mode "random" produces a chaotic (only-6/8-separated) layout.
func (s *Server) handleRandomizeMap(w http.ResponseWriter, r *http.Request) {
	if !s.mapToolLimit.allow(strconv.FormatInt(auth.UserFrom(r.Context()).ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "MAP_TOOL_RATE_LIMITED", "Too many map requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Board *board.Board `json:"board"`
		Mode  string       `json:"mode"`
		// Seeds as decimal strings (a uint64 does not survive JSON's float64). `seed`
		// rolls the tiles and `harbor_seed` the ports, so either can be held while
		// re-rolling the other. Absent `seed` picks one; absent `harbor_seed` follows
		// `seed`. The reply includes the seeds used, and the same seeds on the same
		// shape roll the same board.
		Seed       string `json:"seed"`
		HarborSeed string `json:"harbor_seed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Board == nil {
		writeErr(w, http.StatusBadRequest, "BOARD_REQUIRED", "Board required")
		return
	}
	if err := body.Board.ValidateLayout(); err != nil {
		writeErr(w, http.StatusBadRequest, "MAP_LAYOUT_INVALID", "That map layout isn't valid")
		return
	}
	mode := board.BoardFair
	if body.Mode == board.BoardRandom {
		mode = board.BoardRandom
	}
	seed, ok := parseSeedOrPick(body.Seed)
	if !ok {
		writeErr(w, http.StatusBadRequest, "PREVIEW_BAD_SEED", "A seed is a whole number")
		return
	}
	// An absent port seed follows the tile seed (on its own stream), so one
	// number still reproduces a whole board; the second field is an override.
	harborSeed := seed
	if strings.TrimSpace(body.HarborSeed) != "" {
		var ok bool
		if harborSeed, ok = parseSeedOrPick(body.HarborSeed); !ok {
			writeErr(w, http.StatusBadRequest, "PREVIEW_BAD_SEED", "A seed is a whole number")
			return
		}
	}
	b := body.Board.Clone()
	b.StripToShape()
	// Randomize re-rolls ports too; keeping the old ones would leave a new board
	// with the old coastline. Ports are kept or edited with the harbor palette.
	b.Harbors = nil
	// A pure function of (shape, mode, seed): the builder's Generate shows the
	// seed next to the board, and a seed typed back in has to deal that board.
	b.Resolve(mrand.New(mrand.NewPCG(seed, randomizeStream)), mode)
	// Lay ports so the result is a complete board. engine.New runs EnsureHarbors
	// at game start anyway, so this just shows the author what they will get.
	// Ports use their own seed and stream, so re-rolling tiles under a held port
	// seed keeps the coast.
	b.EnsureHarbors(mrand.New(mrand.NewPCG(harborSeed, harborStream)))
	writeJSON(w, http.StatusOK, map[string]any{
		"board":       b,
		"seed":        strconv.FormatUint(seed, 10),
		"harbor_seed": strconv.FormatUint(harborSeed, 10),
	})
}

// PCG streams for the builder's rolls, fixed so a roll is reproducible from its
// seed. They are unrelated to engine.rngFor (these never reach a game). Two
// streams so the same number in both fields does not give correlated tiles and
// ports.
const (
	randomizeStream = 0x9e3779b97f4a7c15
	harborStream    = 0x2545f4914f6cdd1d
)

// parseSeedOrPick reads a seed off the wire: empty picks a random one, digits
// parse as a uint64, anything else is refused (ok == false).
func parseSeedOrPick(raw string) (uint64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		var buf [8]byte
		if _, err := crand.Read(buf[:]); err != nil {
			return 0, false
		}
		return binary.LittleEndian.Uint64(buf[:]), true
	}
	n, err := strconv.ParseUint(raw, 10, 64)
	return n, err == nil
}

// handleHarborsMap lays a fresh port set around a board's coast, replacing any
// it had (the builder's "reroll ports"). Harbor placement lives in the engine,
// so the builder calls this rather than reimplementing it.
func (s *Server) handleHarborsMap(w http.ResponseWriter, r *http.Request) {
	if !s.mapToolLimit.allow(strconv.FormatInt(auth.UserFrom(r.Context()).ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "MAP_TOOL_RATE_LIMITED", "Too many map requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Board *board.Board `json:"board"`
		// The port seed, as on randomize: the same seed on the same coast lays
		// the same ports, and the reply says which one it used.
		Seed string `json:"seed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Board == nil {
		writeErr(w, http.StatusBadRequest, "BOARD_REQUIRED", "Board required")
		return
	}
	if err := body.Board.ValidateLayout(); err != nil {
		writeErr(w, http.StatusBadRequest, "MAP_LAYOUT_INVALID", "That map layout isn't valid")
		return
	}
	seed, ok := parseSeedOrPick(body.Seed)
	if !ok {
		writeErr(w, http.StatusBadRequest, "PREVIEW_BAD_SEED", "A seed is a whole number")
		return
	}
	b := body.Board.Clone()
	b.Harbors = nil
	b.EnsureHarbors(mrand.New(mrand.NewPCG(seed, harborStream)))
	writeJSON(w, http.StatusOK, map[string]any{"board": b, "seed": strconv.FormatUint(seed, 10)})
}

// maxInstanceIDLen bounds a Discord activity instance id. Real ones are a short
// dash-joined id (`i-<snowflake>-...`); the cap is well clear of that and keeps
// an arbitrary 64 KB body out of the activity_games key space.
const maxInstanceIDLen = 128

// validInstanceID checks the client-supplied instance id, which names (and on
// first sight creates) a table: printable ASCII, no spaces, bounded length.
func validInstanceID(id string) bool {
	if id == "" || len(id) > maxInstanceIDLen {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_', r == '.', r == ':':
		default:
			return false
		}
	}
	return true
}

func (s *Server) handleActivityLobby(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	// Metered like POST /api/games: for an unseen instance id this creates a game
	// (lobby.ActivityLobby find-or-creates).
	if !s.createLimit.allow(strconv.FormatInt(u.ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "GAME_CREATE_RATE_LIMITED", "Too many games created")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		InstanceID string `json:"instance_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !validInstanceID(body.InstanceID) {
		writeErr(w, http.StatusBadRequest, "INSTANCE_ID_REQUIRED", "Instance_id required")
		return
	}
	if !s.verifyActivityMember(w, r, u, body.InstanceID) {
		return
	}
	sum, role, err := s.lobby.ActivityLobby(u, body.InstanceID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	if role != "spectator" {
		s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	}
	// Sanitized like every summary that leaves the server: activity tables are
	// private, and the spectator branch must not return the invite code.
	writeJSON(w, http.StatusOK, map[string]any{"summary": s.sanitize(sum, u.ID), "role": role})
}

// sameSiteJSON refuses a state-changing request that a foreign page could have
// made a browser send, and writes the refusal itself.
//
// It guards POST /api/token, which mints a session (and merges a present guest
// into the Discord account). Without it, a page could auto-submit a form with
// an attacker's OAuth code and log the victim in as the attacker (login CSRF);
// SameSite=Lax allows a top-level form POST to set the cookie.
//
//   - Content-Type must be application/json. A form cannot send it, and a
//     cross-origin fetch that does is preflighted, which we never approve.
//   - Origin must be ours (ownOrigin): the site, or the Activity's
//     discordsays.com origin, which the Discord proxy passes through. Browsers
//     always send Origin on a POST, so a missing one is refused.
//
// Other state-changing routes use SameSite=Lax cookies or bearer auth and do
// not need this.
func (s *Server) sameSiteJSON(w http.ResponseWriter, r *http.Request) bool {
	mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mt != "application/json" {
		writeErr(w, http.StatusUnsupportedMediaType, "INVALID_JSON", "Invalid JSON")
		return false
	}
	if origin := r.Header.Get("Origin"); origin == "" || !s.ownOrigin(origin, r.Host) {
		writeErr(w, http.StatusForbidden, "FORBIDDEN", "Bad origin")
		return false
	}
	return true
}

// verifyActivityMember asks Discord whether u is connected to the Activity
// instance it claims, and writes the refusal itself when not.
//
// The instance id is a client-supplied key to a table (the first opener creates
// it, later openers are seated), so knowing an id must not be enough to join.
//
//   - Checker configured (bot token + app id): the user's Discord identity must
//     be listed in the instance, else 403 PRIVATE_GAME. Discord unreachable is a
//     503: fail closed.
//   - No checker in production: 503. That is a misconfiguration (cmd/costan
//     warns at startup).
//   - No checker in local dev: allowed. Dev has no bot token and uses a
//     throwaway database.
func (s *Server) verifyActivityMember(w http.ResponseWriter, r *http.Request, u *store.User, instanceID string) bool {
	if s.activityInstances == nil || s.discordAppID == "" {
		if s.auth != nil && s.auth.Production() {
			slog.Error("activity lobby refused: membership cannot be verified (set DISCORD_BOT_TOKEN and COSTAN_DISCORD_APP_ID)")
			writeErr(w, http.StatusServiceUnavailable, "INTERNAL", "Activity membership cannot be verified")
			return false
		}
		return true
	}
	if u.DiscordID == "" {
		writeErr(w, http.StatusForbidden, "PRIVATE_GAME", "Private game")
		return false
	}
	users, err := s.activityInstances.ActivityInstanceUsers(r.Context(), s.discordAppID, instanceID)
	if errors.Is(err, discord.ErrNoInstance) {
		writeErr(w, http.StatusForbidden, "PRIVATE_GAME", "Private game")
		return false
	}
	if err != nil {
		slog.Warn("activity lobby: membership check failed", "instance", instanceID, "err", err)
		writeErr(w, http.StatusServiceUnavailable, "INTERNAL", "Could not verify Activity membership")
		return false
	}
	if !slices.Contains(users, u.DiscordID) {
		writeErr(w, http.StatusForbidden, "PRIVATE_GAME", "Private game")
		return false
	}
	return true
}

// handleActivityParticipants reconciles the lobby roster against the Discord
// activity's live participant set. Every activity client may POST its view, but
// only the host's report has authority (see lobby.ReconcileActivityParticipants);
// non-authoritative reports are acked with 204 rather than treated as errors.
func (s *Server) handleActivityParticipants(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		InstanceID string   `json:"instance_id"`
		DiscordIDs []string `json:"discord_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !validInstanceID(body.InstanceID) {
		writeErr(w, http.StatusBadRequest, "INSTANCE_ID_REQUIRED", "Instance_id required")
		return
	}
	sum, err := s.lobby.ReconcileActivityParticipants(u, body.InstanceID, body.DiscordIDs)
	if err != nil {
		// A non-host reporter, a started game, or an instance with no game yet are
		// expected; ack quietly rather than return a 4xx.
		if errors.Is(err, lobby.ErrNotHost) || errors.Is(err, lobby.ErrNotInLobby) || errors.Is(err, store.ErrNotFound) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, map[string]any{"summary": sum})
}

func (s *Server) handleUpdateConfig(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var cfg engine.GameConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	sum, err := s.lobby.UpdateConfig(u, r.PathValue("id"), cfg)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleSetPrivacy(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Private bool `json:"private"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	sum, err := s.lobby.SetPrivacy(u, r.PathValue("id"), body.Private)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(sum.Game.ID, map[string]any{"t": "lobby", "game": sum.Game.ID, "summary": sum})
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	id := r.PathValue("id")
	if err := s.lobby.Start(u, id); err != nil {
		lobbyErr(w, err)
		return
	}
	s.hub.BroadcastGame(id, map[string]any{"t": "lobby", "game": id, "started": true})
	// Not r.Context(), which is cancelled when this handler returns. s.bg lets the
	// announcement outlive the request and is joined by Server.Close before the
	// store closes.
	s.bg.Go(func() { s.postGameFeed(id) }) // best-effort game-feed announcement; never blocks the start
	w.WriteHeader(http.StatusNoContent)
}

// handleReset (host only) sends an in-progress game back to a fresh lobby with
// the same roster. Everyone still following the old game is redirected via the
// `next` field (the new lobby's id) and, on a private table, `next_invite`.
func (s *Server) handleReset(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	id := r.PathValue("id")
	present := s.hub.GameFollowers(id)
	sum, err := s.lobby.ResetToLobby(u, id, present)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	// Seated players pass the new lobby's gate on membership, but a spectator of a
	// private table needs the new invite code (recreateLobby mints one). Carry it,
	// as the rematch broadcast does (rematch.go).
	next := map[string]any{"t": "lobby", "game": id, "next": sum.Game.ID}
	if !sum.Game.Public {
		next["next_invite"] = sum.Game.InviteCode
	}
	s.hub.BroadcastGame(id, next)
	w.WriteHeader(http.StatusNoContent)
}

// replayable is every status a game can be over in:
//
//   - "finished": somebody won.
//   - "abandoned": reset to a lobby or torn down. The events stay on disk (see
//     Lobby.ResetToLobby) and are the only record left.
//   - "paused-error": the engine hit an invariant violation and froze the log.
//     That log is the bug report.
//
// All three are terminal, which the replay metering relies on.
var replayable = map[string]bool{"finished": true, "abandoned": true, "paused-error": true}

// replayETagVersion is stamped into every replay validator. Bump it whenever the
// bytes for an unchanged log change (a redaction rule, the event JSON, the
// envelope); otherwise clients revalidate to a 304 and keep the old output.
const replayETagVersion = 1

// replayETag is a replay's cache validator, keyed on:
//
//   - the game;
//   - the log length, so an append invalidates (store.MaxEventSeq is an index
//     seek, so this costs nothing);
//   - the viewer class. Participants get the raw log and everyone else a
//     redacted one, so without this a spectator could revalidate against a
//     participant's copy and be told by a 304 that it was current.
func replayETag(gameID string, participant bool, maxSeq int) string {
	view := "s"
	if participant {
		view = "p"
	}
	return fmt.Sprintf(`"r%d-%s-%s-%d"`, replayETagVersion, view, gameID, maxSeq)
}

// ifNoneMatch reports whether an If-None-Match header covers etag. It accepts the
// comma-separated list and the "*" wildcard the RFC defines, and compares weakly
// (ignoring a W/ prefix on either side), which is what RFC 9110 requires for the
// GET revalidation this serves.
func ifNoneMatch(header, etag string) bool {
	if header == "" {
		return false
	}
	want := strings.TrimPrefix(etag, "W/")
	for cand := range strings.SplitSeq(header, ",") {
		cand = strings.TrimSpace(cand)
		if cand == "*" || strings.TrimPrefix(cand, "W/") == want {
			return true
		}
	}
	return false
}

// handleReplay serves the log of a game that is over. Participants (host or
// seated) get the full unredacted log, including the seed, so they can verify
// the dice against the public commitment and review hidden plays (see
// docs/dice.md). Others get a spectator-redacted view, and private games are
// closed to them.
func (s *Server) handleReplay(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	g, err := s.store.GameByID(r.PathValue("id"))
	if err != nil {
		lobbyErr(w, err)
		return
	}
	if !replayable[g.Status] {
		writeErr(w, http.StatusConflict, "REPLAY_NOT_READY", "Replays are available once the game is over")
		return
	}

	participant := s.participatesIn(g, u.ID)
	if !s.mayReadOver(g, r, participant) {
		writeErr(w, http.StatusForbidden, "PRIVATE_GAME", "Private game")
		return
	}
	// A finished game's log does not change, so offer a validator and answer 304
	// when the caller already has it. This sits ahead of the meter so a caller who
	// has spent their budget can still revalidate a replay they hold; a 304 serves
	// no events.
	maxSeq, err := s.store.MaxEventSeq(g.ID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	etag := replayETag(g.ID, participant, maxSeq)
	if ifNoneMatch(r.Header.Get("If-None-Match"), etag) {
		setReplayCacheHeaders(w, etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	// Always the whole log, read from disk, and metered for everyone including
	// participants. getGame exempts participants only so a limit cannot evict them
	// from a live table; the game here is over, so a 429 just delays a replay. A
	// participant's replay is the full log with no `?since=` cursor, so leaving it
	// unmetered would make it the cheapest amplifier on the server.
	if !s.allowLog(w, r, u) {
		return
	}

	events, err := s.store.LoadEvents(g.ID, 0)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	// Non-participants of a public game spectate (hidden info and the seed
	// stripped); participants get the raw log.
	if !participant {
		for i := range events {
			events[i] = game.RedactEvent(events[i], game.Spectator)
		}
	}
	// Seat control accompanies the log rather than living in it (migration 0028).
	// Each event's src says who made that move; these transitions cover the gaps,
	// including a player taking their seat back from a bot, which emits no event.
	// Empty for games played before it existed.
	//
	// Read before the charge and the cache headers since it can fail: a 500 must
	// not be billed or carry a validator.
	control, err := s.store.SeatControlLog(g.ID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	// Billed after the fact at the real event count, whoever asked.
	//
	// The fairness audit's out-of-band half: what the server committed to
	// beforehand and the roster the seating shuffle was applied to, neither of
	// which is an event. verify/ checks the revealed seed against the commitment
	// and the derived permutation against the rosters. Public: the commitment was
	// broadcast to the lobby and seats are visible to anyone watching.
	//
	// Games created before migration 0030 have empty fields, and verify/ reports
	// them as unauditable.
	audit := map[string]any{"public_seed_commit": g.PublicSeedCommit}
	if g.PreShuffleSeats != "" {
		audit["pre_shuffle_seats"] = json.RawMessage(g.PreShuffleSeats)
	}
	if seats, err := s.store.Seats(g.ID); err == nil {
		final := make([]int64, len(seats))
		for i, st := range seats {
			final[i] = st.UserID
		}
		audit["final_seats"] = final
	}
	s.chargeLog(r, u, len(events))
	setReplayCacheHeaders(w, etag)
	writeJSON(w, http.StatusOK, map[string]any{"game": g.ID, "events": events, "seat_control": control, "audit": audit})
}

// setReplayCacheHeaders marks a replay response revalidatable. Only the 200 and
// the 304 get it, never a refusal, or a stored 403/429 could later be
// revalidated into a 304.
//
// private, because one URL serves different bodies per viewer (see
// replayETag). no-cache, so every read is revalidated with the server.
func setReplayCacheHeaders(w http.ResponseWriter, etag string) {
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	s.writeProfile(w, u, true)
}

// handleSession answers "who am I" for the page-load probe. A visitor with no
// session yet gets 204 rather than /api/users/me's 401, so page loads don't log
// console errors. A signed-in caller (guest or registered) gets the
// /api/users/me profile.
func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if u == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.writeProfile(w, u, true)
}

func (s *Server) handleUser(w http.ResponseWriter, r *http.Request) {
	if !s.browseLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "BAD_USER_ID", "Bad user id")
		return
	}
	u, err := s.store.UserByID(id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "USER_NOT_FOUND", "No such user")
		return
	}
	if err != nil {
		lobbyErr(w, err)
		return
	}
	s.writeProfile(w, u, false)
}

func (s *Server) writeProfile(w http.ResponseWriter, u *store.User, self bool) {
	noStore(w) // carries live supporter status
	stats, err := s.store.StatsFor(u.ID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	seated, _ := s.store.SeatedGameForUser(u.ID)
	if !self && seated.ID != "" {
		// Name someone else's table only if the viewer could open it: private and
		// ranked games disclose nothing to outsiders (handleGetGame, handleSub).
		// handleUser is unauthenticated, so that means public. The owner's own profile
		// keeps it; the abandon guard reads game/game_status off /api/users/me.
		if g, err := s.store.GameByID(seated.ID); err != nil || !g.Public {
			seated = store.SeatedGame{}
		}
	}
	sup, _ := s.cosmetics.SupporterView(u.ID)
	body := map[string]any{
		"id": u.ID, "name": u.Name, "avatar": u.Avatar, "guest": u.IsGuest,
		"stats": stats, "online": s.hub.Online(u.ID),
		// game_status lets the client tell an in-progress game apart from one still
		// in the lobby, so it can warn before a join silently bots an active seat.
		"game": seated.ID, "game_status": seated.Status,
		// Supporter is shown publicly (badge); the loadout is too (cosmetics are
		// meant to be seen). The Pip balance is private (self only).
		"supporter": sup.Active, "supporter_boosting": sup.Boosting,
		"supporter_badge": sup.Badge, "supporter_tier": sup.Tier,
	}
	if loadout, err := s.cosmetics.Loadout(u.ID); err == nil {
		body["loadout"] = loadout
	}
	if self {
		bal, _ := s.led.Balance(u.ID)
		body["pips"] = bal
		if ids, err := s.store.IdentitiesForUser(u.ID); err == nil {
			out := make([]map[string]any, 0, len(ids))
			for _, id := range ids {
				out = append(out, map[string]any{"provider": id.Provider, "name": id.Name})
			}
			body["identities"] = out
		} else {
			// Fail open: still return the profile, but don't silently swallow a DB
			// error.
			slog.Error("identities for profile", "user", u.ID, "err", err)
		}
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	// Public, unauthenticated endpoint with an attacker-controlled ruleset. The
	// ratings_leaderboard index keeps each query a cheap index seek (no full
	// scan/sort), and this per-IP limit caps how fast it can be hammered.
	if !s.browseLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}
	ruleset := r.URL.Query().Get("ruleset")
	if ruleset == "" {
		ruleset = "base"
	}
	// Only ranked rulesets have standings; anything else is a bad request rather
	// than a table of placeholder 1000s.
	if !ranked.IsRuleset(ruleset) {
		writeErr(w, http.StatusBadRequest, "UNKNOWN_RULESET", "That mode has no leaderboard.")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	// Reads the daily snapshot, not live ratings, so standings stay stable for the
	// day (rebuilt every 24h by a background job).
	entries, err := s.store.LeaderboardSnapshot(ruleset, limit)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ruleset": ruleset, "entries": entries})
}

// botPersonalityRow is one personality as the API reports it: who it is, how it
// plays, and its casual four-player record.
//
// Character is English source text that the client does not render; it
// translates by Name (frontend/src/lib/botPersonality.ts). It is a fallback for
// clients that predate a personality.
type botPersonalityRow struct {
	Name      string `json:"name"`
	Character string `json:"character"`
	// Record is this personality's casual four-player results per ruleset.
	// Absent until it has finished such a game. See migration 0033 for why bots
	// are counted by personality rather than by account.
	Record []store.BotStats `json:"record,omitempty"`
}

// handleBots lists the bot personalities and how each is doing. Public and
// unauthenticated: it is a roster of strategies and aggregate win counts, with
// nothing in it about any player.
func (s *Server) handleBots(w http.ResponseWriter, r *http.Request) {
	if !s.browseLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}
	byName := map[string][]store.BotStats{}
	// A stats read failure serves the roster with empty records rather than a 500.
	if rows, err := s.store.AllBotStats(); err == nil {
		for _, b := range rows {
			// Rows are keyed by display name ("Bot Winston"); the roster by personality.
			if p, ok := bot.PersonalityForDisplayName(b.Name); ok {
				byName[p.Name] = append(byName[p.Name], b)
			}
		}
	} else {
		slog.Error("bots: load stats", "err", err)
	}
	ps := bot.Personalities()
	out := make([]botPersonalityRow, 0, len(ps))
	for _, p := range ps {
		out = append(out, botPersonalityRow{Name: p.Name, Character: p.Character, Record: byName[p.Name]})
	}
	writeJSON(w, http.StatusOK, map[string]any{"personalities": out})
}

// handleFriends returns Discord friends with costan accounts plus presence.
func (s *Server) handleFriends(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	friends, err := s.store.FriendsWithAccounts(u.ID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(friends))
	for _, f := range friends {
		gameID, _ := s.store.ActiveGameForUser(f.ID)
		out = append(out, map[string]any{
			"id": f.ID, "name": f.Name, "avatar": f.Avatar,
			"online": s.hub.Online(f.ID), "game": gameID,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"friends": out})
}

// matchSummary is the lightweight list item returned by GET /api/users/{id}/matches.
// The full blob is fetched separately via GET /api/matches/{gameId}.
type matchSummary struct {
	GameID     string            `json:"game_id"`
	Ruleset    string            `json:"ruleset"`
	Ranked     bool              `json:"ranked"`
	FinishedAt int64             `json:"finished_at"`
	Winner     int               `json:"winner"` // seat index
	Players    []matchSummaryRow `json:"players"`
}

type matchSummaryRow struct {
	Seat   int    `json:"seat"`
	UserID int64  `json:"user_id"`
	Name   string `json:"name"`
	IsBot  bool   `json:"is_bot"`
	Color  string `json:"color,omitempty"`
	VP     int    `json:"vp"`
}

func summarize(rec game.MatchRecord) matchSummary {
	vpBySeat := map[int]int{}
	for _, p := range rec.Scoreboard.Players {
		vpBySeat[p.Seat] = p.VP
	}
	rows := make([]matchSummaryRow, 0, len(rec.Seats))
	for _, s := range rec.Seats {
		rows = append(rows, matchSummaryRow{Seat: s.Seat, UserID: s.UserID, Name: s.Name, IsBot: s.IsBot, Color: s.Color, VP: vpBySeat[s.Seat]})
	}
	return matchSummary{GameID: rec.GameID, Ruleset: rec.Ruleset, Ranked: rec.Ranked, FinishedAt: rec.FinishedAt, Winner: rec.Scoreboard.Winner, Players: rows}
}

func (s *Server) handleUserMatches(w http.ResponseWriter, r *http.Request) {
	if !s.browseLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "BAD_USER_ID", "Bad user id")
		return
	}
	var before int64
	if b := r.URL.Query().Get("before"); b != "" {
		before, _ = strconv.ParseInt(b, 10, 64)
	}
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			limit = n
		}
	}
	rows, err := s.store.MatchHistoryForUser(id, before, limit)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	out := make([]matchSummary, 0, len(rows))
	for _, row := range rows {
		var rec game.MatchRecord
		if err := json.Unmarshal([]byte(row.Record), &rec); err != nil {
			continue // skip a corrupt blob rather than failing the whole list
		}
		out = append(out, summarize(rec))
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": out})
}

func (s *Server) handleMatchDetail(w http.ResponseWriter, r *http.Request) {
	if !s.browseLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}
	row, err := s.store.MatchHistoryByGame(r.PathValue("gameId"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "MATCH_NOT_FOUND", "No such match")
		return
	}
	if err != nil {
		lobbyErr(w, err)
		return
	}
	var rec game.MatchRecord
	if err := json.Unmarshal([]byte(row.Record), &rec); err != nil {
		writeErr(w, http.StatusInternalServerError, "BAD_RECORD", "Corrupt match record")
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (s *Server) handlePresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"presets": board.PresetNames()})
}

// handlePresetBoard returns a preset's concrete layout for the map builder to
// start from and edit.
func (s *Server) handlePresetBoard(w http.ResponseWriter, r *http.Request) {
	b, err := board.PresetLayout(r.PathValue("name"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "PRESET_NOT_FOUND", "No such preset")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"board": b})
}

// rateKey is the bucket key every per-IP rate limiter uses: the client address,
// with IPv6 cut to its /64. A /64 is the smallest normal subscriber allocation,
// so the full address would give one client 2^64 buckets. A v4-mapped address
// keys as IPv4.
func (s *Server) rateKey(r *http.Request) string {
	ip := s.clientIP(r)
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	addr = addr.Unmap()
	if addr.Is4() {
		return addr.String()
	}
	p, err := addr.WithZone("").Prefix(64)
	if err != nil {
		return ip
	}
	return p.String()
}

// clientIP is the client's full address, without the port. When a trusted
// real-IP header is configured (SetRealIPHeader, e.g. behind Cloudflare), it
// reads the first entry of that header, falling back to RemoteAddr if it is
// missing or does not parse as an IP.
func (s *Server) clientIP(r *http.Request) string {
	if h := s.realIPHeader; h != "" {
		if v := r.Header.Get(h); v != "" {
			if i := strings.IndexByte(v, ','); i >= 0 {
				v = v[:i]
			}
			if v = strings.TrimSpace(v); net.ParseIP(v) != nil {
				return v
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
