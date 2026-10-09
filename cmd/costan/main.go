// Command costan runs the costan backend server.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	_ "net/http/pprof" //nolint:gosec // G108: registers /debug/pprof/*; intentionally exposed and gated behind the COSTAN_PPROF flag
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/econ"
	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/explorers" // register the Explorers ruleset
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"   // register the module
	_ "github.com/ftqo/costan.io/engine/knights"   // register the module
	_ "github.com/ftqo/costan.io/engine/raiders"   // register the module
	_ "github.com/ftqo/costan.io/engine/rivers"    // register the Rivers scenario
	_ "github.com/ftqo/costan.io/engine/scenarios" // register the scenario modules
	_ "github.com/ftqo/costan.io/engine/wagons"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/lifecycle"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/ranked"
	"github.com/ftqo/costan.io/server"
	"github.com/ftqo/costan.io/store"
	"github.com/ftqo/costan.io/supporter"
)

// supporterCheckTTL is how long a point-of-use supporter check is cached before a
// gated action re-pulls roles from Discord. Small so un-boosting locks perks out
// almost immediately, but non-zero so rapid repeat actions don't each hit the API.
const supporterCheckTTL = 15 * time.Second

// supporterSweepEvery is how often the background sweep re-checks active
// supporters who haven't triggered a point-of-use check (heals lapses).
const supporterSweepEvery = 10 * time.Minute

// stipendEvery is how often the monthly-stipend job runs. The grant is idempotent
// per calendar month, so the cadence only bounds how quickly a new supporter (or
// a new month) gets credited.
const stipendEvery = time.Hour

// leaderboardRulesets are the ruleset choices offered on the /leaderboard slash
// command: exactly the ranked queues, which are the only rated rulesets.
var leaderboardRulesets = ranked.Rulesets()

// leaderboardSnapshotEvery is the cadence at which the public leaderboard
// snapshot is rebuilt from live ratings, so standings stay stable for the day.
const leaderboardSnapshotEvery = 24 * time.Hour

// sweepJoinTimeout bounds how long shutdown waits for an in-flight periodic
// sweep, so a stalled disk cannot hang exit. A timeout is logged.
const sweepJoinTimeout = 15 * time.Second

// httpShutdownTimeout bounds how long in-flight plain requests get to finish.
// Websockets are hijacked and closed separately by DrainConns.
//
// The shutdown stages (this, sweepJoinTimeout, server.connJoinTimeout, and
// game.stopAllTimeout twice) must sum to less than TimeoutStopSec in both
// deploy/costan.service and nix/module.nix, or systemd kills the process
// mid-drain. Update both units when changing any of them.
const httpShutdownTimeout = 10 * time.Second

// startSweep runs f on a ticker inside g until g stops, optionally running it
// once immediately (atStart).
//
// Running inside g makes each call joinable: a tick that starts as shutdown
// begins finishes before g.Wait returns, so it cannot race store.Close.
func startSweep(g *lifecycle.Group, interval time.Duration, atStart bool, f func()) {
	g.Go(func() {
		if atStart {
			f()
		}
		t := time.NewTicker(interval)
		defer t.Stop()
		stopping := g.Stopping()
		for {
			select {
			case <-t.C:
				f()
			case <-stopping:
				return
			}
		}
	})
}

func main() {
	var (
		addr      = flag.String("addr", env("COSTAN_ADDR", ":4757"), "listen address")
		dbPath    = flag.String("db", env("COSTAN_DB", "costan.db"), "sqlite database path")
		base      = flag.String("base-url", env("COSTAN_BASE_URL", "http://localhost:4757"), "public base URL")
		secure    = flag.Bool("secure-cookies", env("COSTAN_SECURE_COOKIES", "") != "", "set Secure on cookies (behind TLS)")
		devAuth   = flag.Bool("dev-auth", env("COSTAN_DEV_AUTH", "") != "", "enable GET /auth/dev one-click login for local testing (ignored in production)")
		botDelay  = flag.Duration("bot-delay", envDuration("COSTAN_BOT_DELAY", 1500*time.Millisecond), "pause before each of a bot's actions (e.g. 1500ms; 0 = instant)")
		idleEvict = flag.Duration("game-idle-evict", envDuration("COSTAN_GAME_IDLE_EVICT", 5*time.Minute), "unload an active game from memory after this long with no subscribers and no activity; rebuilt on demand (0 = never)")
		eventCap  = flag.Int("game-event-cap", envInt("COSTAN_GAME_EVENT_CAP", 8000), "force-end a game once its event log exceeds this many events (0 = no cap)")
		loadTest  = flag.Bool("load-test", env("COSTAN_LOADTEST", "") != "", "relax rate limiters for load testing (ignored in production)")
		pprofAddr = flag.String("pprof", env("COSTAN_PPROF", ""), "serve net/http/pprof with block and mutex profiling on this address, e.g. :6771 (dev only; a bare :port binds loopback)")
		allowNew  = flag.Bool("allow-new-db", env("COSTAN_ALLOW_NEW_DB", "") != "", "allow creating a missing sqlite database in production (first boot only)")
	)
	flag.Parse()

	slog.SetDefault(newLogger(*secure))

	// Production means secure cookies or an https base URL, matching
	// auth.secureCookie. Every production guard below uses this.
	prod := prodLike(*secure, *base)

	// pprof on a dedicated address (never the public mux), with block and mutex
	// profiling so lock and DB-connection waits show up.
	//
	// Refused in production (the heap dump contains live session tokens and the
	// profiling has real overhead), and a bare ":port" is pinned to loopback.
	switch {
	case *pprofAddr == "":
	case prod:
		slog.Warn("COSTAN_PPROF ignored in production", "requested", *pprofAddr)
	default:
		bind := pprofBind(*pprofAddr)
		if bind != *pprofAddr {
			slog.Info("pprof bound to loopback", "requested", *pprofAddr, "addr", bind)
		} else if !strings.HasPrefix(bind, "127.0.0.1:") && !strings.HasPrefix(bind, "localhost:") && !strings.HasPrefix(bind, "[::1]:") {
			slog.Warn("pprof is listening off-loopback: /debug/pprof/heap contains live session tokens", "addr", bind)
		}
		runtime.SetBlockProfileRate(1)
		runtime.SetMutexProfileFraction(1)
		go func() {
			slog.Info("pprof listening", "addr", bind, "path", "/debug/pprof/")
			if err := http.ListenAndServe(bind, nil); err != nil { //nolint:gosec // G114: local debug pprof listener, gated behind COSTAN_PPROF; timeouts not needed
				slog.Error("pprof server stopped", "err", err)
			}
		}()
	}

	// store.Open creates a missing database file. In production that would
	// silently serve an empty database after a wrong COSTAN_DB or a botched
	// restore, with every health check passing, so refuse unless
	// COSTAN_ALLOW_NEW_DB is set. The check lives here because tests and tools
	// rely on store.Open creating the file.
	if requireExistingDB(prod, *allowNew) {
		if _, err := os.Stat(*dbPath); err != nil {
			fatal("expected an existing database at "+*dbPath+" (production). Refusing to create an empty one:"+
				" check COSTAN_DB, restore a backup (DEPLOY.md §10), or set COSTAN_ALLOW_NEW_DB=1 for a first boot", err)
		}
	}
	if prod && *allowNew {
		slog.Warn("COSTAN_ALLOW_NEW_DB is set: a missing database will be created empty instead of refused; remove it after the first boot", "db", *dbPath)
	}

	slog.Info("opening store", "db", *dbPath)
	st, err := store.Open(*dbPath)
	if err != nil {
		fatal("open store", err)
	}
	defer st.Close()

	authSvc := &auth.Service{
		Store:   st,
		Secure:  *secure,
		DevAuth: *devAuth,
		Config: auth.Config{
			ClientID:     os.Getenv("DISCORD_CLIENT_ID"),
			ClientSecret: secretEnv("DISCORD_CLIENT_SECRET"),
			BaseURL:      *base,
		},
		Google: auth.GoogleConfig{
			ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
			ClientSecret: secretEnv("GOOGLE_CLIENT_SECRET"),
		},
	}
	if *devAuth {
		slog.Warn("dev-auth enabled: GET /auth/dev mints a registered test session; not for production")
	}

	mgr := game.NewManager(st, nil)
	// Seat each bot as the personality its display name records. An unrecognised
	// name (a forfeit takeover using a human's name, a retired personality)
	// falls back to plain NewStrong.
	mgr.SetSeatBotFactory(func(_ engine.PlayerID, name string) game.CommandSource {
		return bot.NewPersonalityFor(name)
	})
	mgr.SetBotDelay(*botDelay)
	mgr.SetIdleEvict(*idleEvict)
	mgr.SetEventCap(*eventCap)
	mgr.StartReaper()
	slog.Info("bots configured", "type", "strong", "delay", *botDelay)
	defer mgr.StopAll()
	lb := lobby.New(st, mgr)
	srv := server.New(st, authSvc, lb, mgr)
	defer srv.Close()
	srv.StartLobbyReaper()                                  // crash-safe reclaim of deserted lobby seats (lost in-memory grace timers)
	srv.SetDiscordAppID(os.Getenv("COSTAN_DISCORD_APP_ID")) // Activity iframe origin
	// Behind a reverse proxy (Cloudflare/nginx), RemoteAddr is the proxy's address,
	// which would collapse every client into one per-IP rate-limit bucket. Trust a
	// forwarded client-IP header (e.g. CF-Connecting-IP) only when configured;
	// set it only where all traffic arrives via that proxy.
	srv.SetRealIPHeader(os.Getenv("COSTAN_REAL_IP_HEADER"))
	if loadTestEnabled(*loadTest, prod) {
		srv.SetLoadTest(true)
		slog.Warn("load-test mode enabled: rate limiters relaxed; not for production")
	}

	// Discord Activity "Launch" button: register the global PRIMARY_ENTRY_POINT
	// command. Needs only a bot token and the app id, independent of supporter
	// sync. Idempotent.
	if token, appID := secretEnv("DISCORD_BOT_TOKEN"), os.Getenv("COSTAN_DISCORD_APP_ID"); token != "" && appID != "" {
		dc := discord.Client{Token: token}
		// Server-side check that an Activity opener is really in the call they
		// name (POST /api/activity/lobby). Without it a production server
		// refuses Activity tables rather than trusting the client's instance id.
		srv.SetActivityInstances(dc)
		if err := dc.EnsureEntryPointCommand(context.Background(), appID); err != nil {
			slog.Warn("discord: register Activity Launch command failed", "err", err)
		} else {
			slog.Info("discord Activity Launch command registered")
		}
		// The named /play + /costanio commands that also open the Activity.
		if err := dc.RegisterActivityCommands(context.Background(), appID); err != nil {
			slog.Warn("discord: register /play + /costanio failed", "err", err)
		} else {
			slog.Info("discord /play + /costanio commands registered")
		}
	}

	if prod && os.Getenv("COSTAN_DISCORD_APP_ID") != "" && secretEnv("DISCORD_BOT_TOKEN") == "" {
		slog.Warn("COSTAN_DISCORD_APP_ID set without DISCORD_BOT_TOKEN: POST /api/activity/lobby will refuse every opener")
	}

	// Discord role sync (pull-based; no gateway), enabled when a bot token and
	// guild are configured. Roles are read over REST on login, re-checked when a
	// perk is used, and swept periodically to catch lapses.
	var supRef *supporter.Refresher
	if token, guild := secretEnv("DISCORD_BOT_TOKEN"), os.Getenv("DISCORD_GUILD_ID"); token != "" && guild != "" {
		// Role-to-kind mapping is the union of the env allowlist and the DB
		// (/setrole), so the env var is optional.
		supCfg, err := supporter.ParseConfig(os.Getenv("DISCORD_SUPPORTER_ROLE_IDS"))
		if err != nil {
			fatal("parse DISCORD_SUPPORTER_ROLE_IDS", err)
		}
		dc := discord.Client{Token: token, GuildID: guild}
		supRef = supporter.NewRefresher(supCfg, dc, st, supporterCheckTTL)
		srv.SetSupporterRefresher(supRef)
		botClient := dc // value copy; has Token + GuildID
		srv.SetDiscordBot(&botClient)
		authSvc.SetRoleSync(supRef.Refresh)         // re-pull roles on login (reflects /setrole)
		supRef.SetOnChange(srv.PushSupporterUpdate) // push status live to the user's own connections
		slog.Info("discord supporter sync enabled", "envRoles", len(supCfg.Roles), "mode", "pull")

		// Slash commands: enable the interactions webhook (needs the app's Ed25519
		// public key) and register the guild command set in one idempotent PUT.
		if pubKey := os.Getenv("DISCORD_PUBLIC_KEY"); pubKey != "" {
			srv.SetDiscordInteractions(pubKey)
			srv.SetDiscordGuild(guild) // admin interactions count only from this guild
			if appID := os.Getenv("COSTAN_DISCORD_APP_ID"); appID != "" {
				if err := dc.RegisterGuildCommands(context.Background(), appID, leaderboardRulesets); err != nil {
					slog.Warn("discord: register guild commands failed", "err", err)
				} else {
					slog.Info("discord guild commands registered")
				}
			}
		}
	}

	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// Cap how long a slow client can take to send a full request body
		// (WebSocket conns are hijacked at upgrade and manage their own
		// deadlines, so this does not bound long-lived game streams).
		ReadTimeout: 30 * time.Second,
	}

	go func() {
		slog.Info("listening", "addr", *addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("http server", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// The periodic sweeps write to the store. sweeps joins them on shutdown; the
	// deferred Wait runs before st.Close because defers unwind in reverse.
	var sweeps lifecycle.Group
	defer func() {
		if !sweeps.Wait(sweepJoinTimeout) {
			slog.Warn("timed out joining background sweeps")
		}
	}()

	// Periodically purge expired sessions (lazy per-request expiry alone leaves
	// rows to accumulate).
	startSweep(&sweeps, time.Hour, false, func() {
		if n, err := st.SweepExpiredSessions(); err != nil {
			slog.Error("session sweep", "err", err)
		} else if n > 0 {
			slog.Info("session sweep", "removed", n)
		}
	})

	// Daily leaderboard snapshot: rebuild the public leaderboard from live ratings
	// once per day. Checks at startup and then hourly, rebuilding only when a
	// full interval has elapsed, so restarts never force an early refresh.
	startSweep(&sweeps, time.Hour, true, func() {
		if did, err := st.RefreshLeaderboardSnapshotIfDue(time.Now().Unix(), int64(leaderboardSnapshotEvery/time.Second)); err != nil {
			slog.Error("leaderboard snapshot", "err", err)
		} else if did {
			slog.Info("leaderboard snapshot refreshed")
		}
	})

	// Background supporter sweep: re-pull roles for active supporters who haven't
	// been checked recently, so a lapse is caught even without a point-of-use hit.
	if supRef != nil {
		startSweep(&sweeps, supporterSweepEvery, false, func() {
			if n, err := supRef.Sweep(context.Background(), supporterSweepEvery); err != nil {
				slog.Error("supporter sweep", "err", err)
			} else if n > 0 {
				slog.Info("supporter sweep", "refreshed", n)
			}
		})
	}

	// Monthly supporter stipend: econ.StipendPayout Pips per active supporter per
	// calendar month. Idempotent per (user, month), so the hourly run only makes
	// new supporters and rollovers land promptly. Runs at startup, then hourly.
	led := econ.New(st)
	// Every new account starts with econ.SignupPayout Pips. The grant is keyed
	// on the user id, so wiring it to every login path (guest, Discord, Google)
	// pays exactly once per account.
	authSvc.SetSignupGrant(func(userID int64) error {
		_, err := led.Signup(userID)
		return err
	})
	grantStipends := func() {
		ids, err := st.ActiveSupporters()
		if err != nil {
			slog.Error("stipend: list active supporters", "err", err)
			return
		}
		for _, id := range ids {
			if _, err := led.Stipend(id); err != nil {
				slog.Error("stipend grant", "user", id, "err", err)
			}
		}
	}
	startSweep(&sweeps, stipendEvery, true, grantStipends)

	<-stop
	sweeps.Stop()
	slog.Info("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), httpShutdownTimeout)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		slog.Error("http shutdown", "err", err)
	} // stop accepting new conns; does not touch hijacked websockets
	// Close-frame the live websockets (1012 Service Restart) so clients reconnect
	// immediately through the proxy. Game state is durable per command.
	srv.DrainConns()
	// Actors flush on StopAll (deferred); events are already durable per command.
}

// newLogger builds the process logger: human-readable text in dev, JSON in prod
// (secure cookies, so a real deployment). Level is INFO unless COSTAN_LOG_LEVEL
// overrides it (DEBUG, WARN, ...).
func newLogger(prod bool) *slog.Logger {
	level := slog.LevelInfo
	if v := os.Getenv("COSTAN_LOG_LEVEL"); v != "" {
		_ = level.UnmarshalText([]byte(v)) // bad value: keep INFO
	}
	opts := &slog.HandlerOptions{Level: level}
	if prod {
		return slog.New(slog.NewJSONHandler(os.Stderr, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stderr, opts))
}

// fatal logs an error and exits non-zero, in the structured log format.
// Deferred cleanups don't run; it is only used before serving starts.
func fatal(msg string, err error) {
	slog.Error(msg, "err", err)
	os.Exit(1)
}

// loadTestEnabled gates load-test mode: requested and not a production
// deployment. prod must come from prodLike (which also counts an https base
// URL), not the raw -secure-cookies flag.
func loadTestEnabled(envSet, prod bool) bool {
	return envSet && !prod
}

// prodLike reports whether this is a real deployment, and is what every
// dev-only feature is gated on. It duplicates auth.secureCookie's (unexported)
// rule: the explicit flag or an https base URL.
func prodLike(secure bool, baseURL string) bool {
	return secure || strings.HasPrefix(strings.ToLower(baseURL), "https://")
}

// pprofBind pins a host-less listen address (":6771") to loopback; net/http
// would otherwise bind every interface. An address with an explicit host is
// left as written, and the caller warns if it is off-loopback.
func pprofBind(addr string) string {
	if strings.HasPrefix(addr, ":") {
		return "127.0.0.1" + addr
	}
	return addr
}

// requireExistingDB reports whether startup must refuse to create the database.
// On in production, off in dev (./dev.sh uses a fresh temp DB), and overridden
// for a first boot by COSTAN_ALLOW_NEW_DB, which should then be removed.
func requireExistingDB(prod, allowNew bool) bool {
	return prod && !allowNew
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// secretEnv reads a secret from the file named by <KEY>_FILE if that is set,
// otherwise from <KEY> directly. The _FILE form is how the systemd unit delivers
// secrets: ExecStartPre SOPS-decrypts them into the tmpfs RuntimeDirectory
// (/run/costan), so the plaintext is a root-only file in RAM rather than an
// environment variable. A trailing newline is trimmed. A missing or unreadable
// secret file is fatal, so a broken setup cannot silently disable login.
func secretEnv(key string) string {
	if path := os.Getenv(key + "_FILE"); path != "" {
		b, err := os.ReadFile(path) //nolint:gosec // G703: path is from an operator-set *_FILE env var, not user input
		if err != nil {
			fatal("read secret file for "+key, err)
		}
		return strings.TrimRight(string(b), "\r\n")
	}
	return os.Getenv(key)
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		slog.Warn("invalid duration env var, using fallback", "key", key, "value", v, "fallback", fallback)
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
		slog.Warn("invalid int env var, using fallback", "key", key, "value", v, "fallback", fallback)
	}
	return fallback
}
