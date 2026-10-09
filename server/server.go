package server

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/econ"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/lifecycle"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/ranked"
	"github.com/ftqo/costan.io/store"
)

type Server struct {
	store     *store.Store
	auth      *auth.Service
	lobby     *lobby.Lobby
	mgr       *game.Manager
	hub       *Hub
	led       *econ.Ledger
	cosmetics *cosmetics.Service
	ranked    *ranked.Service

	// bg owns every goroutine the Server starts that can reach the store: the
	// matchmaker ticker, the three goroutines behind each live websocket (read
	// pump, write pump, keepalive), and the Discord posters. Close stops and joins
	// it.
	//
	// http.Server.Shutdown does not touch hijacked connections, and Hub.CloseAll
	// waits only for the close frames to be sent, not for the read loops (which
	// call mgr.Get, actor.Do and store.LoadEvents) to exit. Without this a command
	// could still be in the store when it closed. See lifecycle/group.go.
	bg lifecycle.Group

	// rematchWant tracks, per finished game, which users have voted for a
	// rematch on the post-game screen. Ephemeral (in-memory): a rematch is a
	// fleeting post-game decision, not durable state.
	rematchMu   sync.Mutex
	rematchWant map[string]map[int64]bool

	// leaving holds pending lobby-leave timers keyed by "<gameID>:<userID>". A
	// player who disconnects from a waiting room is dropped after a short grace
	// window, canceled if they re-subscribe in time. See scheduleLobbyLeave.
	// clock is the seam tests use to fire the grace window deterministically.
	leaveMu sync.Mutex
	leaving map[string]leaveTimer
	// rankedLeaving holds pending grace-leaves from the ranked queue, keyed by
	// user: a disconnect (tab close / refresh) drops the player from the queue
	// after the same grace window as a lobby seat, canceled if they reconnect.
	// Guarded by leaveMu.
	rankedLeaving map[int64]leaveTimer
	clock         leaveClock

	// suspending holds pending suspend-abandon timers keyed by gameID: a game
	// frozen because no human is connected is abandoned after a grace if nobody
	// returns. Uses the same clock seam as the lobby-leave grace.
	suspendMu  sync.Mutex
	suspending map[string]leaveTimer

	createLimit   *keyedLimiter // game creation per user
	guestLimit    *keyedLimiter // guest minting per IP
	browseLimit   *keyedLimiter // public game-list reads per IP
	avatarLimit   *keyedLimiter // avatar-proxy fetches per IP (generous: pages render many at once)
	chatLimit     *keyedLimiter // chat sends per user (1/sec)
	reportLimit   *keyedLimiter // chat reports per user (~1/10s)
	feedbackLimit *keyedLimiter // feedback form sends per user (~1/min, burst 3)
	refreshLimit  *keyedLimiter // manual "sync roles" per user (~1/min)
	tokenLimit    *keyedLimiter // Activity OAuth token exchange per IP (makes 2 outbound Discord calls)
	wsConnLimit   *keyedLimiter // WebSocket upgrade attempts per IP (generous: real reconnects need bursts)
	mapSaveLimit  *keyedLimiter // map saves per user (~1 save/5s, burst 10)
	// The map tools (lint, randomize, harbors, encode, decode, frame), metered
	// for CPU: they run the validator, fair solver and harbor placer on an
	// arbitrary board, up to ~118 ms of single-core work per call.
	mapToolLimit  *keyedLimiter // map builder tools per user (5/s sustained, burst 60)
	purchaseLimit *keyedLimiter // cosmetic purchases per user (~1/s, burst 5)
	// Event-log reads (GET /api/games/{id} with its log, GET .../replay),
	// metered in events served rather than requests. The live-game read checks
	// them only for callers not in the game; replays check everyone. See
	// Server.allowLog.
	logLimit   *keyedLimiter // per user: the primary meter (identity, so NAT-proof)
	logIPLimit *keyedLimiter // per IP: backstop, since guest sessions are cheap to mint

	// Per-connection websocket frame rate (token bucket). Defaults are
	// generous enough for bursty play; tests may raise them.
	wsMsgRate  float64
	wsMsgBurst float64

	// maxSpectators caps concurrent non-seated watchers per game, bounding the
	// broadcast/memory fan-out of a public game. Tests may lower it.
	maxSpectators int

	// discordAppID, when set, allows the Activity iframe origin
	// (https://<id>.discordsays.com) through the WebSocket origin check.
	discordAppID string

	// activityInstances, when set, is asked who is really connected to a Discord
	// Activity instance before POST /api/activity/lobby seats anyone at that
	// instance's table. See verifyActivityMember for the policy when it is nil.
	activityInstances activityInstanceLister

	// discordGuildID is the community server (DISCORD_GUILD_ID) whose managers
	// may use the admin/moderation interactions. A Manage-Server bit from any
	// other guild, or from a DM, grants nothing. Empty = nobody is an admin.
	discordGuildID string

	// discordPubKey, when set, enables the POST /discord/interactions endpoint
	// (the /setrole slash command). It is the app's Ed25519 public key (hex).
	discordPubKey string

	// discordBot, when set, is the outbound REST client used to post moderation
	// report embeds and to DM warned/banned players. nil when no bot token is
	// configured; moderation then works from the DB only.
	discordBot *discord.Client

	// realIPHeader, when set (e.g. "CF-Connecting-IP"), is the request header the
	// per-IP rate limiters read the client address from instead of RemoteAddr,
	// which behind a proxy is always the proxy. Only safe when all traffic goes
	// through that proxy; on a directly exposed origin a client could forge it.
	// See clientIP.
	realIPHeader string
}

// defaultMaxSpectators bounds concurrent non-seated watchers per game.
const defaultMaxSpectators = 50

// SetDiscordAppID enables the Discord Activity iframe origin in checkOrigin.
func (s *Server) SetDiscordAppID(id string) { s.discordAppID = id }

// activityInstanceLister reads the Discord user ids connected to an Activity
// instance. discord.Client satisfies it; tests stub it.
type activityInstanceLister interface {
	ActivityInstanceUsers(ctx context.Context, appID, instanceID string) ([]string, error)
}

// SetActivityInstances wires the server-side membership check for Activity
// instances (needs the bot token and COSTAN_DISCORD_APP_ID).
func (s *Server) SetActivityInstances(l activityInstanceLister) { s.activityInstances = l }

// SetDiscordGuild names the home guild whose managers may run admin
// interactions (see discordGuildID).
func (s *Server) SetDiscordGuild(id string) { s.discordGuildID = id }

// SetDiscordInteractions enables POST /discord/interactions (the /setrole slash
// command) by supplying the app's Ed25519 public key (hex) for signature checks.
func (s *Server) SetDiscordInteractions(publicKeyHex string) { s.discordPubKey = publicKeyHex }

// SetDiscordBot wires the outbound Discord REST client for moderation posting/DMs.
func (s *Server) SetDiscordBot(c *discord.Client) { s.discordBot = c }

// SetRealIPHeader makes the per-IP rate limiters trust a forwarded client-IP
// header (e.g. "CF-Connecting-IP" behind Cloudflare). Empty = use RemoteAddr.
// Only set this when every request reaches the process through the proxy that
// stamps the header; on a directly reachable origin it lets clients spoof their
// rate-limit identity.
func (s *Server) SetRealIPHeader(name string) { s.realIPHeader = name }

// loadTestSpectatorCap is the per-game spectator ceiling used in load-test mode:
// high enough that broadcast fan-out (the thing the wire test measures) is not
// throttled by the normal anti-abuse cap.
const loadTestSpectatorCap = 1_000_000

// SetLoadTest relaxes the limits that would throttle a wire-capacity load test:
// the per-IP/per-user rate limiters (guest minting, game creation, public
// browse) and the per-game spectator cap. It never touches the per-connection
// websocket frame limiter or the chat limiter. Must be off in production; the
// caller gates it like dev-auth.
func (s *Server) SetLoadTest(on bool) {
	s.createLimit.setDisabled(on)
	s.guestLimit.setDisabled(on)
	s.browseLimit.setDisabled(on)
	s.refreshLimit.setDisabled(on)
	if s.tokenLimit != nil {
		s.tokenLimit.setDisabled(on)
	}
	if s.wsConnLimit != nil {
		s.wsConnLimit.setDisabled(on)
	}
	if s.mapSaveLimit != nil {
		s.mapSaveLimit.setDisabled(on)
	}
	if s.mapToolLimit != nil {
		s.mapToolLimit.setDisabled(on)
	}
	if s.purchaseLimit != nil {
		s.purchaseLimit.setDisabled(on)
	}
	if s.logLimit != nil {
		s.logLimit.setDisabled(on)
	}
	if s.logIPLimit != nil {
		s.logIPLimit.setDisabled(on)
	}
	if on {
		s.maxSpectators = loadTestSpectatorCap
	}
}

// SetSupporterRefresher wires point-of-use supporter re-verification into the
// cosmetics gating path (used when the Discord bot token/guild are configured).
func (s *Server) SetSupporterRefresher(r cosmetics.SupporterRefresher) {
	s.cosmetics.SetRefresher(r)
}

func New(st *store.Store, authSvc *auth.Service, lb *lobby.Lobby, mgr *game.Manager) *Server {
	led := econ.New(st)
	cos := cosmetics.New(st, led)
	// The seat path gates color picks through cosmetics (supporter/ownership +
	// keep-what-you-used); see docs/cosmetics.md §6.3.
	lb.SetColorGate(cos)
	// Starting a game with only bots (no second human) is a supporter perk.
	lb.SetSupporterGate(cos)
	s := &Server{
		store:         st,
		auth:          authSvc,
		lobby:         lb,
		mgr:           mgr,
		hub:           NewHub(),
		led:           led,
		cosmetics:     cos,
		rematchWant:   map[string]map[int64]bool{},
		leaving:       map[string]leaveTimer{},
		rankedLeaving: map[int64]leaveTimer{},
		suspending:    map[string]leaveTimer{},
		clock:         realLeaveClock{},
		createLimit:   newKeyedLimiter(0.05, 5),     // ~3/min sustained, burst 5
		guestLimit:    newKeyedLimiter(0.05, 10),    // per IP
		browseLimit:   newKeyedLimiter(1, 10),       // per IP: 1/s sustained, burst 10
		avatarLimit:   newKeyedLimiter(5, 60),       // per IP: pages render many avatars; cap outbound CDN fetches
		chatLimit:     newKeyedLimiter(1, 1),        // per user: 1 msg/sec, no burst
		reportLimit:   newKeyedLimiter(0.1, 1),      // per user: ~1 report/10s
		feedbackLimit: newKeyedLimiter(1.0/60.0, 3), // per user: ~1/min, burst 3
		refreshLimit:  newKeyedLimiter(1.0/60.0, 1), // per user: ~1 manual role sync/min
		tokenLimit:    newKeyedLimiter(0.05, 10),    // per IP: Activity OAuth exchange (~3/min, burst 10)
		wsConnLimit:   newKeyedLimiter(5, 30),       // per IP: generous for reconnects, blocks upgrade floods
		mapSaveLimit:  newKeyedLimiter(0.2, 10),     // per user: ~1 save/5s, burst 10
		// The lobby frames ~12 gallery boards at once on load (the burst), and an
		// editing session sends a debounced lint and preview per edit. The
		// sustained rate is well above a human and well below a loop.
		mapToolLimit:  newKeyedLimiter(5, 60),
		purchaseLimit: newKeyedLimiter(1, 5), // per user: 1 buy/s, burst 5
		// Units are events, not requests. A finished game's log is roughly a
		// thousand entries, so the per-user burst is a few whole logs and the
		// refill one more every few seconds. A `?since=` gap refetch costs only
		// the gap, so reconnects are effectively unmetered.
		logLimit:      newKeyedLimiter(200, 4000),
		logIPLimit:    newKeyedLimiter(600, 20000),
		wsMsgRate:     msgsPerSecond,
		wsMsgBurst:    burstAllowance,
		maxSpectators: defaultMaxSpectators,
	}
	s.ranked = ranked.NewService(
		lobbyMatcher{lobby: lb, srv: s},
		rankedNotifier{hub: s.hub},
		st,
		func() int64 { return time.Now().Unix() },
	)
	s.bg.Go(func() { s.ranked.Run(s.bg.Stopping(), 2*time.Second) })
	return s
}

// Hub exposes presence for tests and wiring.
func (s *Server) Hub() *Hub { return s.hub }

// connJoinTimeout bounds how long Close waits for websocket goroutines and the
// matchmaker. DrainConns has already torn down every socket, so this is normally
// instant; the bound covers a goroutine stuck on a stalled disk. A timeout is
// logged because Manager.StopAll and store.Close come next.
const connJoinTimeout = 15 * time.Second

// Close stops every goroutine the Server owns and waits for them: the
// matchmaker ticker and the per-connection pumps. Safe to call more than once.
//
// Call it after DrainConns: a read loop parked in ws.Read only wakes when its
// socket is torn down. main's deferred order is srv.Close, mgr.StopAll,
// st.Close: connections, then games, then the store.
func (s *Server) Close() {
	s.bg.Stop()
	if !s.bg.Wait(connJoinTimeout) {
		slog.Warn("timed out joining websocket/matchmaker goroutines; the store may be closed under a live user")
	}
}

// DrainConns close-frames every live websocket so clients reconnect promptly on
// a graceful shutdown/deploy (code 1012 "Service Restart"). Call before the
// process exits; game state is durable and rehydrates on the reconnect.
func (s *Server) DrainConns() { s.hub.CloseAll(websocket.StatusServiceRestart, "server restarting") }

// Handler builds the full route table.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Liveness probe for the container/proxy healthcheck. No auth, no DB.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Auth.
	// Provider login/register: the provider is the {provider} path segment, which
	// HandleAuthStart reads via r.PathValue("provider"). Literal /auth/discord etc.
	// would leave that empty (-> 404), so use the wildcard. The literal GET routes
	// below (e.g. /auth/dev) are more specific and still take precedence.
	mux.HandleFunc("GET /auth/{provider}", s.auth.HandleAuthStart)
	mux.HandleFunc("GET /auth/{provider}/callback", s.auth.HandleAuthCallback)
	// Linking a provider to the logged-in account.
	mux.HandleFunc("GET /auth/{provider}/link", auth.RequireUser(s.auth.HandleAuthStart))
	mux.HandleFunc("DELETE /api/users/me/identities/{provider}", auth.RequireUser(s.auth.HandleUnlink))
	mux.HandleFunc("GET /api/merge/preview", auth.RequireUser(s.auth.HandleMergePreview))
	mux.HandleFunc("POST /api/merge", auth.RequireUser(s.auth.HandleMergeConfirm))
	mux.HandleFunc("POST /auth/logout", s.auth.HandleLogout)
	// Discord Activity OAuth code exchange (Embedded App SDK). Not RequireUser:
	// it establishes the session (and merges a guest if one is present).
	// Rate-limited per IP: each hit makes 2 outbound Discord calls.
	mux.HandleFunc("POST /api/token", func(w http.ResponseWriter, r *http.Request) {
		if !s.tokenLimit.allow(s.rateKey(r)) {
			writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
			return
		}
		if !s.sameSiteJSON(w, r) {
			return
		}
		s.auth.HandleActivityToken(w, r)
	})
	mux.HandleFunc("POST /api/activity/lobby", auth.RequireUser(s.handleActivityLobby))
	mux.HandleFunc("POST /api/activity/participants", auth.RequireUser(s.handleActivityParticipants))
	// Discord slash-command interactions (/setrole). Public: Discord calls it,
	// and the handler verifies the Ed25519 signature. 404s when not configured.
	mux.HandleFunc("POST /discord/interactions", s.handleDiscordInteractions)
	// Dev-only one-click guest login (self-gates to local http; 404 in prod).
	mux.HandleFunc("GET /auth/dev", s.auth.HandleDevLogin)
	mux.HandleFunc("POST /auth/guest", func(w http.ResponseWriter, r *http.Request) {
		if !s.guestLimit.allow(s.rateKey(r)) {
			writeErr(w, http.StatusTooManyRequests, "GUEST_RATE_LIMITED", "Too many guests from this address")
			return
		}
		s.auth.HandleGuest(w, r)
	})

	// Lobby & games.
	mux.HandleFunc("GET /api/games", s.handleBrowse)
	mux.HandleFunc("GET /api/games/live", s.handleLiveGames)
	mux.HandleFunc("POST /api/games", auth.RequireUser(s.handleCreateGame))
	mux.HandleFunc("GET /api/games/{id}", auth.RequireUser(s.handleGetGame))
	mux.HandleFunc("POST /api/games/{id}/join", auth.RequireUser(s.handleJoin))
	mux.HandleFunc("POST /api/games/{id}/leave", auth.RequireUser(s.handleLeave))
	mux.HandleFunc("POST /api/games/{id}/spectate", auth.RequireUser(s.handleSpectate))
	mux.HandleFunc("POST /api/games/{id}/return", auth.RequireUser(s.handleReturn))
	mux.HandleFunc("POST /api/games/{id}/start", auth.RequireUser(s.handleStart))
	mux.HandleFunc("POST /api/games/{id}/reset", auth.RequireUser(s.handleReset))
	mux.HandleFunc("POST /api/games/{id}/config", auth.RequireUser(s.handleUpdateConfig))
	mux.HandleFunc("POST /api/games/{id}/privacy", auth.RequireUser(s.handleSetPrivacy))
	mux.HandleFunc("POST /api/games/{id}/bots", auth.RequireUser(s.handleAddBot))
	mux.HandleFunc("DELETE /api/games/{id}/seats/{seat}", auth.RequireUser(s.handleKick))
	mux.HandleFunc("POST /api/games/{id}/transfer-host", auth.RequireUser(s.handleTransferHost))
	mux.HandleFunc("POST /api/games/{id}/color", auth.RequireUser(s.handleSetSeatColor))
	mux.HandleFunc("POST /api/games/{id}/name", auth.RequireUser(s.handleSetSeatName))
	mux.HandleFunc("POST /api/games/{id}/decoration", auth.RequireUser(s.handleSetSeatDecoration))
	mux.HandleFunc("GET /api/games/{id}/replay", auth.RequireUser(s.handleReplay))
	// The same log folded into one board per event, for a client that wants to
	// watch it. See server/frames.go.
	mux.HandleFunc("GET /api/games/{id}/frames", auth.RequireUser(s.handleGameFrames))
	mux.HandleFunc("POST /api/replay/frames", auth.RequireUser(s.handleReplayFrames))
	// Invite resolution lives off the {id} prefix to avoid a wildcard clash.
	mux.HandleFunc("GET /api/invites/{code}", auth.RequireUser(s.handleInviteResolve))

	// Profiles & social.
	// Same-origin Discord avatar proxy (public): lets avatars load inside the
	// Discord Activity webview, which blocks the direct cross-origin CDN image.
	mux.HandleFunc("GET /api/avatar/{id}/{file}", s.handleAvatarProxy)
	mux.HandleFunc("GET /api/users/me", auth.RequireUser(s.handleMe))
	// The page-load probe: 204 for nobody rather than a 401 (see handleSession).
	mux.HandleFunc("GET /api/session", s.handleSession)
	mux.HandleFunc("PATCH /api/users/me", auth.RequireUser(s.handleUpdateMe))
	mux.HandleFunc("GET /api/users/{id}", s.handleUser)
	mux.HandleFunc("GET /api/users/{id}/matches", s.handleUserMatches)
	mux.HandleFunc("GET /api/matches/{gameId}", s.handleMatchDetail)
	mux.HandleFunc("GET /api/leaderboard", s.handleLeaderboard)
	mux.HandleFunc("GET /api/bots", s.handleBots)
	mux.HandleFunc("GET /api/presets", s.handlePresets)
	mux.HandleFunc("GET /api/presets/{name}/board", auth.RequireUser(s.handlePresetBoard))
	mux.HandleFunc("POST /api/maps", auth.RequireUser(s.handleSaveMap))
	mux.HandleFunc("POST /api/maps/encode", auth.RequireUser(s.handleEncodeMap))
	mux.HandleFunc("POST /api/maps/decode", auth.RequireUser(s.handleDecodeMap))
	mux.HandleFunc("POST /api/maps/frame", auth.RequireUser(s.handleFrameMap))
	mux.HandleFunc("GET /api/maps", auth.RequireUser(s.handleListMaps))
	mux.HandleFunc("GET /api/maps/{id}", auth.RequireUser(s.handleGetMap))
	mux.HandleFunc("DELETE /api/maps/{id}", auth.RequireUser(s.handleDeleteMap))
	mux.HandleFunc("POST /api/maps/lint", auth.RequireUser(s.handleLintMap))
	mux.HandleFunc("POST /api/maps/randomize", auth.RequireUser(s.handleRandomizeMap))
	mux.HandleFunc("POST /api/maps/harbors", auth.RequireUser(s.handleHarborsMap))
	// Deals the map builder's board and persists nothing (server/preview.go).
	// Metered with the other map tools for CPU.
	mux.HandleFunc("POST /api/preview", auth.RequireUser(s.handlePreviewBoard))
	mux.HandleFunc("GET /api/social/friends", auth.RequireUser(s.handleFriends))
	mux.HandleFunc("POST /api/feedback", auth.RequireUser(s.handleFeedback))

	// Ranked matchmaking.
	mux.HandleFunc("POST /api/ranked/queue", auth.RequireUser(s.handleRankedJoin))
	mux.HandleFunc("DELETE /api/ranked/queue", auth.RequireUser(s.handleRankedLeave))
	mux.HandleFunc("GET /api/ranked/queue", auth.RequireUser(s.handleRankedStatus))

	// Cosmetics & currency (presentational only; see docs/cosmetics.md).
	mux.HandleFunc("GET /api/me/wallet", auth.RequireUser(s.handleWallet))
	mux.HandleFunc("GET /api/me/supporter", auth.RequireUser(s.handleSupporter))
	mux.HandleFunc("POST /api/me/supporter/refresh", auth.RequireUser(s.handleRefreshRoles))
	mux.HandleFunc("GET /api/me/loadout", auth.RequireUser(s.handleGetLoadout))
	mux.HandleFunc("PUT /api/me/loadout", auth.RequireUser(s.handlePutLoadout))
	mux.HandleFunc("GET /api/cosmetics", auth.RequireUser(s.handleCosmetics))
	mux.HandleFunc("POST /api/cosmetics/{id}/purchase", auth.RequireUser(s.handlePurchase))
	mux.HandleFunc("GET /api/colors", auth.RequireUser(s.handleColors))

	// Live.
	mux.HandleFunc("GET /ws", s.handleWS)

	// Access log is outermost so its timing covers auth and everything else.
	return logRequests(s.auth.Middleware(mux))
}
