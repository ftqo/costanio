package game

import (
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/econ"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/lifecycle"
	"github.com/ftqo/costan.io/store"
)

// Manager owns the actor registry: starting games, lazy-loading unfinished
// ones after a restart, and routing by game id.
type Manager struct {
	st    *store.Store
	clock Clock

	mu     sync.Mutex
	actors map[string]*Actor
	// loading tracks in-flight Load()s so the slow snapshot decode and replay
	// run without holding m.mu. Concurrent Get(id) callers find the channel,
	// drop the lock and wait on it.
	loading map[string]chan struct{}
	newBot  func(seat engine.PlayerID) CommandSource
	// newSeatBot is the seat-aware bot factory and takes precedence over
	// newBot where both are set. It receives the seat's display name so the bot
	// can be built as that name's personality (bot.PersonalityForDisplayName).
	// It is a separate field so newBot's many callers, which ignore the seat,
	// keep their signature.
	newSeatBot func(seat engine.PlayerID, name string) CommandSource
	botDelay   time.Duration
	idleEvict  time.Duration
	eventCap   int

	// bg owns every goroutine and span of work the Manager starts that can
	// reach the store: the recovery sweep, idle-reaper firings, finished-game
	// reaps and in-flight lazy loads. StopAll stops it and then joins it.
	// lifecycle.Group makes "may I start?" and "you are now being waited for"
	// one atomic step (Enter), which a stop-channel check cannot. See
	// lifecycle/group.go.
	bg lifecycle.Group

	// recoverSweep is the one-shot recovery pass StartReaper launches into bg.
	// A field only so tests can substitute a sweep with controlled timing; nil
	// means recoverFinalization.
	recoverSweep func()
}

// DefaultEventCap is the event-log length past which a Manager force-ends a
// game (see Actor.eventCap). It is a safety net: normal games finish in a few
// hundred to a couple of thousand events, and what reaches it is a table
// nobody can win, typically a bot livelock (bot/simple.go documents three).
// cmd/costan sets 8000 explicitly (COSTAN_GAME_EVENT_CAP).
//
// A force-finish writes an ordinary game_finished with a tiebreak winner and
// flips the row to "finished", so the games row cannot tell it from a real
// win. The log can: a force-finish carries engine.SourceServer, a real win
// the source of the winning seat (TestForceFinishDistinctFromWin).
//
// Callers that treat "finished" as success:
//
//   - sim.RunGame opts out with SetEventCap(0) and keeps its own MaxEvents
//     check, which reports ErrStalemate so stalemates are skipped rather than
//     scored (sim.TestStalemateIsReportedNotScored).
//   - verify.TestJSVerifiesLobbyGame checks the finish event's provenance
//     before auditing.
//   - game.TestManagerReplayMatchesLive sets its own cap (4000) because
//     bot.Simple deadlocks in a minority of games; its assertions hold either
//     way.
//   - game.TestMatchHistoryNotWrittenForBotGames, game.finishedEvents,
//     server.TestE2E and sim.TestConcurrency take the default and do not
//     check; none plays a shape known to livelock.
//   - cmd/costan-demoseed seats bot.NewStrong, which does not have the Simple
//     road livelock.
const DefaultEventCap = 8000

func NewManager(st *store.Store, clock Clock) *Manager {
	if clock == nil {
		clock = realClock{}
	}
	return &Manager{
		st:       st,
		clock:    clock,
		actors:   map[string]*Actor{},
		loading:  map[string]chan struct{}{},
		eventCap: DefaultEventCap,
	}
}

// The games.status values this package reads and writes. They are literals in
// lobby/ too, but the recovery paths here compare them across two files, and a
// typo would silently stop a game loading or recovering.
const (
	statusActive      = "active"
	statusPausedError = "paused-error"
	statusAbandoned   = "abandoned"
)

var ErrGameNotRunning = errors.New("game is not running")

// ErrGameNotPaused refuses a recovery operation on a game that is not frozen.
// Both recovery paths write to a game on an operator's say-so, so each checks
// the game's state rather than trusting the id.
var ErrGameNotPaused = errors.New("game is not paused")

// ErrShuttingDown is returned by Get once StopAll has begun, so no actor (a
// store user with its own goroutine) is installed after StopAll has
// snapshotted the actor map.
var ErrShuttingDown = errors.New("server is shutting down")

// Start creates the initial events for a lobby game and spawns its actor.
func (m *Manager) Start(gameID string, cfg engine.GameConfig, seeds engine.Seeds) error {
	// Canonicalise at creation. Every path that starts a game comes through
	// here and the call is idempotent. It is not in engine.New's module
	// resolution because a persisted game must replay in the module order it
	// was played in.
	cfg.Ruleset = engine.CanonicalRuleset(cfg.Ruleset)
	events, err := engine.New(cfg, seeds)
	if err != nil {
		return err
	}
	// The opening events (seed, board, deck) are the server dealing the game;
	// no seat has acted. This is the only write that bypasses Actor.commit,
	// so it stamps itself.
	engine.StampSource(events, engine.SourceServer)
	if err := m.st.AppendEvents(gameID, events); err != nil {
		return err
	}
	if err := m.st.SetGameStatus(gameID, statusActive); err != nil {
		return err
	}
	_, err = m.Get(gameID)
	return err
}

// Get returns the running actor, lazily loading it if the game is active in
// the store (post-restart resume).
func (m *Manager) Get(gameID string) (*Actor, error) {
	for {
		m.mu.Lock()
		// Checked under m.mu, the lock StopAll takes to snapshot the actor
		// map: either this Get installs its actor before the snapshot (and
		// StopAll stops it), or it sees stopping and installs nothing.
		if m.stopping() {
			m.mu.Unlock()
			return nil, ErrShuttingDown
		}
		if a, ok := m.actors[gameID]; ok {
			m.mu.Unlock()
			return a, nil
		}
		// Another goroutine is loading this game: drop the lock, wait for it,
		// then retry (it will be installed in m.actors, or have failed).
		if ch, loading := m.loading[gameID]; loading {
			m.mu.Unlock()
			<-ch
			continue
		}
		// Reserve the slot so concurrent Get(id) callers wait instead of
		// racing a second Load().
		ch := make(chan struct{})
		m.loading[gameID] = ch
		// Register the load itself, not just its outcome: load() starts the
		// actor loop and snapshot worker, which can write to the store before
		// Get re-checks. Entering bg here puts the load, the re-check and any
		// refusing Stop inside what StopAll joins. Doing it under m.mu matters:
		// StopAll takes m.mu after m.bg.Stop(), so this Enter either wins and is
		// waited for, or loses and refuses.
		if !m.bg.Enter() {
			delete(m.loading, gameID)
			m.mu.Unlock()
			close(ch)
			return nil, ErrShuttingDown
		}
		m.mu.Unlock()

		// Phase 2: the slow snapshot decode and replay run without m.mu.
		a, err := m.load(gameID)

		m.mu.Lock()
		delete(m.loading, gameID)
		// Re-checked after the slow load, since StopAll may have run during
		// it. A refused actor is stopped, not dropped: its loop is already
		// running.
		refused := err == nil && m.stopping()
		if err == nil && !refused {
			m.actors[gameID] = a
		}
		m.mu.Unlock()
		close(ch) // wake any waiters (they re-check m.actors)
		if refused {
			a.Stop()
			m.bg.Leave()
			return nil, ErrShuttingDown
		}
		m.bg.Leave()
		return a, err
	}
}

// beforeLoad, when non-nil, runs at the top of load on the Get caller's
// goroutine. Test-only: it makes a load slow enough to straddle StopAll.
var beforeLoad func()

// load builds the actor (snapshot decode + replay) and wires bot seats. It
// must run outside m.mu; Get reserves the loading slot before calling it.
func (m *Manager) load(gameID string) (*Actor, error) {
	if beforeLoad != nil {
		beforeLoad()
	}
	g, err := m.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != statusActive {
		return nil, fmt.Errorf("%w: status %s", ErrGameNotRunning, g.Status)
	}
	seats, err := m.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	// Only human-owned seats (store status != "bot") can ever forfeit.
	var humans []engine.PlayerID
	seatNames := make(map[engine.PlayerID]string, len(seats))
	// Equipped robber skins, so the robber can wear the skin of whichever seat
	// last moved it. Captured once here so the actor never reads the loadout
	// on a hot path.
	seatRobbers := make(map[engine.PlayerID]string, len(seats))
	// Equipped piece sets, captured here for the same reason. Equipping
	// mid-game takes effect at the next load.
	seatPieces := make(map[engine.PlayerID]string, len(seats))
	for _, s := range seats {
		if s.Status != "bot" {
			humans = append(humans, engine.PlayerID(s.No))
		}
		if s.UserName != "" {
			seatNames[engine.PlayerID(s.No)] = s.UserName
		}
		// Through cosmetics rather than the seat directly, so a bot (which owns
		// nothing) moves a robber that looks like the opposition. See
		// cosmetics.RobberForSeat.
		if r := cosmetics.RobberForSeat(s.Robber, s.Status == "bot"); r != "" {
			seatRobbers[engine.PlayerID(s.No)] = r
		}
		if s.Pieces != "" {
			seatPieces[engine.PlayerID(s.No)] = s.Pieces
		}
	}
	a, err := Load(gameID, m.st, Options{
		Clock:       m.clock,
		OnFinish:    func(winner engine.PlayerID) { m.finish(gameID, winner) },
		OnForfeit:   func(seat engine.PlayerID) { m.recordForfeit(gameID, seat) },
		Bots:        m.botFactory(),
		BotDelay:    m.getBotDelay(),
		Humans:      humans,
		SeatNames:   seatNames,
		SeatRobbers: seatRobbers,
		SeatPieces:  seatPieces,
		EventCap:    m.getEventCap(),
	})
	if err != nil {
		return nil, err
	}
	// Bot seats, and seats a human left to spectate ("auto"), get their
	// command source on every load or the game would stall on them. The
	// display name goes with it, so a lobby bot is rebuilt as the same
	// personality and a reload cannot swap its strategy mid-game.
	if f := m.seatBotFactory(); f != nil {
		for _, seat := range seats {
			if seat.Status == "bot" || seat.Status == "auto" {
				a.SetSeatBot(engine.PlayerID(seat.No), f(engine.PlayerID(seat.No), seat.UserName))
			}
		}
	}
	return a, nil
}

// botFactory reads newBot under the lock (it may be set concurrently via
// SetBotFactory while load() runs outside m.mu).
func (m *Manager) botFactory() func(seat engine.PlayerID) CommandSource {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.newBot
}

// seatBotFactory is the factory every install point calls: the seat-aware one
// where set, otherwise the plain one ignoring the name, and nil when neither
// is configured.
func (m *Manager) seatBotFactory() func(seat engine.PlayerID, name string) CommandSource {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.newSeatBot != nil {
		return m.newSeatBot
	}
	if m.newBot == nil {
		return nil
	}
	f := m.newBot
	return func(seat engine.PlayerID, _ string) CommandSource { return f(seat) }
}

// BotifySeat makes a seat play itself out as a bot on the live actor (used when
// a player forfeits by leaving an in-progress game). The store seat is updated
// separately; this drives the running game. With no bot factory configured the
// seat falls back to auto-pass so the game still progresses.
func (m *Manager) BotifySeat(gameID string, seat engine.PlayerID) error {
	a, err := m.Get(gameID)
	if err != nil {
		return err
	}
	if f := m.seatBotFactory(); f != nil {
		// A takeover uses the human's own name, which maps to no personality,
		// so the factory picks the default strategy: a seat a player walked
		// away from should be played as well as possible.
		a.SetSeatBot(seat, f(seat, m.seatName(gameID, seat)))
	} else {
		a.SetSeatAuto(seat, true)
	}
	return nil
}

// seatName reads a seat's display name for the bot factory. A store error or
// missing seat yields "", which maps to no personality and so to the default
// strategy.
func (m *Manager) seatName(gameID string, seat engine.PlayerID) string {
	seats, err := m.st.Seats(gameID)
	if err != nil {
		return ""
	}
	for _, s := range seats {
		if engine.PlayerID(s.No) == seat {
			return s.UserName
		}
	}
	return ""
}

// LeaveSeat hands a seat to a bot immediately (the player left an active game).
// The store seat is untouched, so the human keeps the seat and can rejoin
// (MarkSeatPresent). Forfeit is recorded lazily when that bot first moves.
func (m *Manager) LeaveSeat(gameID string, seat engine.PlayerID) error {
	if err := m.BotifySeat(gameID, seat); err != nil {
		return err
	}
	// Leaving is a choice, so the seat may now consent on the player's behalf
	// (accept a draw, count toward a claim). See Actor.consentless.
	a, err := m.Get(gameID)
	if err != nil {
		return err
	}
	a.MarkWalkedAway(seat)
	return nil
}

// SuspendGame freezes a running game (no human connected). No-op if not loaded.
func (m *Manager) SuspendGame(gameID string) {
	if a, err := m.Get(gameID); err == nil {
		a.Suspend()
	}
}

// ResumeGame lifts a suspension when a human returns. No-op if not loaded.
func (m *Manager) ResumeGame(gameID string) {
	if a, err := m.Get(gameID); err == nil {
		a.Resume()
	}
}

// MarkSeatAbsent starts the disconnect grace window for a seat in a running game
// (its player's site connection dropped). After a full round the actor escalates
// the seat to a bot. No-op if the game isn't loadable.
func (m *Manager) MarkSeatAbsent(gameID string, seat engine.PlayerID) {
	if a, err := m.Get(gameID); err == nil {
		a.MarkAbsent(seat)
	}
}

// MarkSeatPresent clears a seat's absence on reconnect, handing control back to
// the human if a bot had taken over.
func (m *Manager) MarkSeatPresent(gameID string, seat engine.PlayerID) {
	if a, err := m.Get(gameID); err == nil {
		a.MarkPresent(seat)
	}
}

// recordForfeit persists that the player on the given seat forfeited (the actor
// fires this once, the first time a bot commits a move on a human-owned seat).
func (m *Manager) recordForfeit(gameID string, seat engine.PlayerID) {
	seats, err := m.st.Seats(gameID)
	if err != nil {
		slog.Error("forfeit: load seats", "game", gameID, "err", err)
		return
	}
	for _, s := range seats {
		if engine.PlayerID(s.No) == seat {
			if err := m.st.RecordForfeit(gameID, s.UserID); err != nil {
				slog.Error("record forfeit", "game", gameID, "seat", seat, "err", err)
			}
			return
		}
	}
}

// SetBotFactory wires the bot implementation per seat (kept injectable so
// game does not depend on the bot package). Mixed games (e.g. one strong bot
// vs. several baselines) return different sources per seat.
func (m *Manager) SetBotFactory(f func(seat engine.PlayerID) CommandSource) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.newBot = f
}

// SetSeatBotFactory wires a bot implementation that also sees the seat's
// display name, and takes precedence over SetBotFactory where both are set.
// The server uses it to seat each lobby bot as its name's personality; the
// mapping lives in the caller so game does not import bot.
//
// The name is the seat's display name: "Bot Winston" for a lobby bot, the
// player's own name for a forfeit takeover. A factory must treat an
// unrecognised name as "the default bot", never as an error.
func (m *Manager) SetSeatBotFactory(f func(seat engine.PlayerID, name string) CommandSource) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.newSeatBot = f
}

// SetBotDelay sets how long bot seats pause between actions (0 = instant).
// Applies to actors loaded after this call.
func (m *Manager) SetBotDelay(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.botDelay = d
}

// getBotDelay reads botDelay under the lock (it may be set concurrently via
// SetBotDelay while load() runs outside m.mu).
func (m *Manager) getBotDelay() time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.botDelay
}

// reapEvery is how often the idle sweep runs.
const reapEvery = time.Minute

// SetIdleEvict sets the no-subscriber, no-activity window after which an
// active game's actor is unloaded from memory (rebuilt from the event log on
// the next Get). 0 disables idle eviction. Mirrors SetBotDelay.
func (m *Manager) SetIdleEvict(d time.Duration) {
	m.mu.Lock()
	m.idleEvict = d
	m.mu.Unlock()
}

// SetEventCap sets the maximum event-log length before a game is force-ended.
// 0 disables the cap. Applies to actors loaded after this call.
func (m *Manager) SetEventCap(n int) {
	m.mu.Lock()
	m.eventCap = n
	m.mu.Unlock()
}

// getEventCap reads eventCap under the lock (it may be set concurrently via
// SetEventCap while load() runs outside m.mu).
func (m *Manager) getEventCap() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.eventCap
}

// StartReaper starts the self-rescheduling idle sweep. Call once after
// construction. A zero idleEvict makes each sweep a no-op. It also starts a
// background one-shot sweep that re-finalizes any finished game whose
// stats/ratings were lost to a crash mid-finalize (see recoverFinalization),
// so a backlog never blocks startup.
func (m *Manager) StartReaper() {
	sweep := m.recoverSweep
	if sweep == nil {
		sweep = m.recoverFinalization
	}
	m.bg.Go(sweep)
	m.startReaper()
}

// startReaper begins the self-rescheduling idle sweep. Safe to call once after
// construction; a zero idleEvict makes each sweep a no-op.
func (m *Manager) startReaper() {
	m.clock.AfterFunc(reapEvery, func() {
		// Enter either refuses (shutting down: neither sweep nor reschedule)
		// or makes StopAll wait for this whole callback, so a sweep cannot
		// touch the store after StopAll returns.
		if !m.bg.Enter() {
			return
		}
		defer m.bg.Leave()
		m.sweepIdleOnce()
		m.startReaper()
	})
}

// sweepIdleOnce evicts every actor that is currently evictable. It collects
// candidate IDs under m.mu, then tests and releases each outside the lock;
// m.mu is never held across an actor call.
func (m *Manager) sweepIdleOnce() {
	m.mu.Lock()
	idle := m.idleEvict
	if idle <= 0 {
		m.mu.Unlock()
		return
	}
	now := m.clock.Now()
	candidates := make([]string, 0, len(m.actors))
	for id := range m.actors {
		candidates = append(candidates, id)
	}
	m.mu.Unlock()

	for _, id := range candidates {
		// Re-check existence under the lock; another goroutine may have
		// released the actor already (e.g. finish reaper).
		m.mu.Lock()
		a, ok := m.actors[id]
		m.mu.Unlock()
		if !ok {
			continue
		}
		// Evictable takes the actor loop lock; must be called outside m.mu.
		if a.Evictable(now, idle) {
			m.Release(id) // stops the actor and deletes it from m.actors
		}
	}
}

// finish maps the winning seat to a user and finalizes the game row. Runs on
// the actor loop, or for ForceFinishPaused on the operator's goroutine with no
// actor; either way it must not call back into the actor.
func (m *Manager) finish(gameID string, winner engine.PlayerID) {
	seats, err := m.st.Seats(gameID)
	if err != nil {
		slog.Error("finish: load seats", "game", gameID, "err", err)
		return
	}
	// winner is engine.NoPlayer for a drawn game (an accepted draw offer, or a
	// claim by a player who was not ahead). No seat matches it, so winnerUser
	// stays 0 and the store writes NULL: a finished game with no winner.
	var winnerUser int64
	for _, s := range seats {
		if engine.PlayerID(s.No) == winner {
			winnerUser = s.UserID
		}
	}
	// Idempotent finalization: only the caller that actually transitions the
	// game to 'finished' bumps stats/ratings, so a duplicate finish (reload,
	// replayed finish event) can't double-count.
	won, err := m.st.FinishGameOnce(gameID, winnerUser)
	if err != nil {
		slog.Error("finish: finalize game", "game", gameID, "err", err)
	}
	if won {
		m.finalize(gameID, seats)
	}
	// Reap the finished actor after a grace period to release its goroutine
	// and memory. finish runs on the actor's loop, so Release is scheduled on
	// the clock goroutine; calling it inline would deadlock in a.Stop().
	m.scheduleReap(gameID)
}

// finalize bumps stats and ratings and records the match-history blob for a
// game already marked 'finished'. Shared by the live finish path and the
// startup recovery sweep.
//
// All writes happen in one transaction in store.FinalizeGame. finalize only
// reads to assemble the input, and aborts without writing if a read fails, so
// recoverFinalization retries later. The match row is written in the same
// transaction, so a retry cannot double-count: its presence means the earlier
// attempt committed everything.
func (m *Manager) finalize(gameID string, seats []*store.Seat) {
	g, err := m.st.GameByID(gameID)
	if err != nil {
		slog.Error("finish: load game", "game", gameID, "err", err)
		return
	}
	var winnerUser int64
	if g.Winner != nil {
		winnerUser = *g.Winner
	}
	// One pass builds both played (non-forfeited; used for stat bumps so
	// forfeiters do not count toward win rate) and forfeited (placed last in
	// ranked rating updates).
	var played []*store.Seat
	forfeited := map[int64]bool{}
	for _, s := range seats {
		ff, err := m.st.Forfeited(gameID, s.UserID)
		if err != nil {
			// A forfeit-check failure would misclassify stats/ratings; abort and
			// let recoverFinalization retry the whole finalize atomically.
			slog.Error("finish: forfeited check: aborting finalize for retry", "game", gameID, "user", s.UserID, "err", err)
			return
		}
		if ff {
			forfeited[s.UserID] = true
		} else {
			played = append(played, s)
		}
	}

	// A game with no winner was drawn: agreed by the table, or a claim
	// against bots with nobody ahead. It is a completed outcome.
	drawn := winnerUser == 0

	// The casual mirror counts unranked games seated with exactly
	// store.CasualPlayers. The count comes from seats, not the config:
	// lobby.Start rewrites cfg.Players to the seats that started. It uses seats
	// rather than played so a forfeit does not move a game between mirrors;
	// forfeiters are still excluded from the bumps below.
	casual4 := !g.Ranked && len(seats) == store.CasualPlayers

	in := store.FinalizeInput{Now: m.clock.Now().Unix(), Ruleset: g.Ruleset}
	// Stats use played (forfeiters excluded) to keep win rates honest.
	for _, s := range played {
		in.Stats = append(in.Stats, store.StatBump{
			UserID:  s.UserID,
			Ruleset: g.Ruleset,
			Won:     !drawn && s.UserID == winnerUser,
			Drew:    drawn,
			// Not gated like ratings: stats is the career total and counts
			// casual games. The flag lets the leaderboard split out the ranked
			// record.
			Ranked: g.Ranked,
			// Counts humans and bots alike, as stats does (a bot's row is a
			// per-guest account and inert). Bot strength is tracked by BotStats
			// below, keyed by personality.
			Casual4: casual4,
		})
	}
	// Bot strength, keyed by the personality's display name, over the same
	// population and forfeit rule as the human casual mirror. game does not
	// import bot: the name is stored verbatim and resolved by the reader.
	if casual4 {
		for _, s := range played {
			if s.Status != "bot" {
				continue
			}
			in.BotStats = append(in.BotStats, store.BotStatBump{
				Name:    s.UserName,
				Ruleset: g.Ruleset,
				Won:     !drawn && s.UserID == winnerUser,
				Drew:    drawn,
			})
		}
	}
	// Ratings move only for ranked games. Casual games, including any game
	// with bot seats (always unranked), never affect rating. Ranked updates
	// include every seat (forfeiters rated last) and give each forfeiter an
	// escalating queue strike.
	//
	// A draw is rated as a tie rather than skipped. Skipping made a draw
	// strictly better than a loss for trailing players and let an abandoner
	// escape their strike. Strikes apply however the game ended.
	if g.Ranked {
		for _, s := range seats {
			// Never strike the winner, even if somehow marked forfeited
			// (e.g. a bot-takeover seat that still reached the target VP).
			if forfeited[s.UserID] && s.UserID != winnerUser {
				in.Strikes = append(in.Strikes, s.UserID)
			}
		}
		ids, ranks, err := m.computeRanks(gameID, seats, winnerUser, forfeited)
		if err != nil {
			slog.Error("finish: build ranks: aborting finalize for retry", "game", gameID, "err", err)
			return
		}
		in.RatingUserIDs, in.RatingRanks = ids, ranks
	}
	// Length in turns, from the log, so a game that ended in seconds pays
	// nobody. Read here because finalize owns every read: a failure aborts
	// the whole finalize for a clean retry.
	turns, err := m.st.CountEventsOfType(gameID, string(engine.EvTurnEnded))
	if err != nil {
		slog.Error("finish: count turns: aborting finalize for retry", "game", gameID, "err", err)
		return
	}
	in.Credits = m.matchCredits(gameID, played, turns, len(seats), in.Now)

	// Match-history blob (nil for bot-only games, which are excluded from the
	// recovery sweep). A build failure for a human game aborts before any write.
	row, err := buildMatchRow(m.st, g, seats, in.Now)
	if err != nil {
		slog.Error("finish: build match record: aborting finalize for retry", "game", gameID, "err", err)
		return
	}
	in.Match = row

	if err := m.st.FinalizeGame(in); err != nil {
		// Nothing committed; recoverFinalization re-runs this game on next start.
		slog.Error("finish: finalize game", "game", gameID, "err", err)
	}
}

// matchMinRounds is how many full rounds of turns a game must have run before
// finishing it pays anything (see matchCredits).
const matchMinRounds = 2

// matchCredits is the payout list for one finished game: the match reward
// for each human seat under its daily cap, plus the once-a-day bonus for the
// first game a player finishes.
//
// It builds rows rather than granting them: econ.Ledger writes on its own
// connection while finalize holds a transaction, which deadlocks with
// SetMaxOpenConns(1). So the rules (2+ humans, minimum length, daily cap,
// forfeiters excluded) live here and store.FinalizeGame does the write. The
// idem key is per game and user, so a recovery re-run pays nothing twice.
func (m *Manager) matchCredits(gameID string, played []*store.Seat, turns, seats int, now int64) []store.LedgerCreditInput {
	var humans []*store.Seat
	for _, s := range played {
		if s.Status != "bot" {
			humans = append(humans, s)
		}
	}
	// 2+ humans, so a table of bots is not a Pip faucet.
	if len(humans) < 2 {
		return nil
	}
	// A minimum length, so two accounts cannot end a game immediately and
	// collect the match reward and daily streak. A couple of rounds (one turn
	// per seat each) is the floor. It is well below any threshold that ends a
	// game (engine.SurrenderMinTurns, engine.DrawMinTurns); it only gates the
	// payout.
	if turns < matchMinRounds*max(seats, 2) {
		return nil
	}
	startOfDay := time.Unix(now, 0).UTC().Truncate(24 * time.Hour).Unix()
	today := econ.Day(now)
	var out []store.LedgerCreditInput
	for _, s := range humans {
		n, err := m.st.CountCredits(s.UserID, "match", startOfDay)
		if err != nil {
			// Skip this seat's payout rather than abort: stats and ratings
			// matter more, and the idem key makes a later manual re-run safe.
			slog.Error("finish: count match credits: skipping payout", "game", gameID, "user", s.UserID, "err", err)
			continue
		}
		if n < econ.MatchDailyCap {
			out = append(out, store.LedgerCreditInput{
				UserID:  s.UserID,
				Amount:  econ.MatchPayout,
				Reason:  "match",
				IdemKey: fmt.Sprintf("match:%s:%d", gameID, s.UserID),
			})
		}

		// The daily bonus, on a player's first finished game each day, worth
		// more the longer their streak. Asked on every game: DailyPayoutFor
		// returns 0 once today is paid.
		days, err := m.st.CreditDays(s.UserID, "daily", now-int64(econ.StreakWindow.Seconds()))
		if err != nil {
			slog.Error("finish: read daily streak: skipping bonus", "game", gameID, "user", s.UserID, "err", err)
			continue
		}
		if payout := econ.DailyPayoutFor(days, today); payout > 0 {
			out = append(out, store.LedgerCreditInput{
				UserID: s.UserID,
				Amount: payout,
				Reason: "daily",
				// Per user per day, so later games that day hit the same key
				// and pay nothing.
				IdemKey: fmt.Sprintf("daily:%d:%s", s.UserID, today),
			})
		}
	}
	return out
}

// recoverFinalization re-runs finalization for finished games with no
// match-history row, i.e. a crash between FinishGameOnce and the match-history
// write. On restart such a game is already 'finished', so FinishGameOnce
// reports won=false and finish() would skip it. Bot-only games are excluded by
// the store query. Best-effort; logs and continues on errors.
func (m *Manager) recoverFinalization() {
	if m.stopping() {
		return
	}
	ids, err := m.st.FinishedGamesWithoutMatchHistory()
	if err != nil {
		slog.Error("recover finalization: list games", "err", err)
		return
	}
	for _, id := range ids {
		// Stop early on shutdown rather than making StopAll wait; the sweep is
		// idempotent and re-runs on next start.
		if m.stopping() {
			return
		}
		seats, err := m.st.Seats(id)
		if err != nil {
			slog.Error("recover finalization: load seats", "game", id, "err", err)
			continue
		}
		m.finalize(id, seats)
	}
}

// Recovering a paused game.
//
// An actor never unpauses, and load() refuses rows that are not "active", so
// a paused game stays frozen and its seats get no rating, Pips, match history
// or post-game screen. The two ways out are offline (cmd/costan-recover), not
// player-reachable: an invariant violation is a bug to report with its log
// intact. Both work from the store, because a paused actor refuses commands
// and may have been evicted. Neither resumes play; continuing from a state the
// engine declared impossible risks corruption.

// PausedGames lists the ids of games frozen by an engine invariant violation,
// newest first.
func (m *Manager) PausedGames() ([]string, error) {
	gs, err := m.st.ListGames(statusPausedError, true)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(gs))
	for _, g := range gs {
		ids = append(ids, g.ID)
	}
	return ids, nil
}

// AbandonPaused writes a paused game off: the actor is stopped and the row
// moves to "abandoned", the terminal status the lobby uses for a table that
// never started. Seats are released and no rating or Pips move. Use it when
// the log is too broken to finish, in particular when ForceFinishPaused cannot
// rebuild it.
func (m *Manager) AbandonPaused(gameID string) error {
	if err := m.requirePaused(gameID); err != nil {
		return err
	}
	// Stop the actor before the row moves, so nothing is left holding live
	// state for a game that no longer exists.
	m.Release(gameID)
	return m.st.SetGameStatus(gameID, statusAbandoned)
}

// ForceFinishPaused ends a paused game through the ordinary finish path, so
// ratings and Pips move, the match-history row is written, and the post-game
// screen has a result. The winner is engine.ForceFinish's tiebreak leader (as
// with the event cap), and the finishing event is stamped SourceServer so the
// log still distinguishes it from a real win.
//
// It refuses when the log will not fold (a corrupt log rather than a bad
// command): there is no state to tiebreak, and AbandonPaused is the answer.
func (m *Manager) ForceFinishPaused(gameID string) error {
	if err := m.requirePaused(gameID); err != nil {
		return err
	}
	// The paused actor still owns the snapshot worker, so stop it before
	// appending rather than let it write a snapshot that predates the append.
	m.Release(gameID)
	state, err := rebuild(gameID, m.st)
	if err != nil {
		return err
	}
	if state.Phase != engine.PhaseFinished {
		fin, err := forceFinishEvents(state)
		if err != nil {
			return err
		}
		// The server ending a game nobody can finish. Stamped here because this
		// is one of the two writes that bypass Actor.commit (Start is the other).
		engine.StampSource(fin, engine.SourceServer)
		if err := m.st.AppendEvents(gameID, fin); err != nil {
			return err
		}
		if err := foldAll(state, fin); err != nil {
			return err
		}
	}
	// The normal path from here. FinishGameOnce moves the row out of
	// "paused-error" as readily as out of "active", and finalize does the rest.
	m.finish(gameID, state.Winner)
	return nil
}

// requirePaused checks that gameID is a game frozen by an engine invariant
// violation (see ErrGameNotPaused).
func (m *Manager) requirePaused(gameID string) error {
	g, err := m.st.GameByID(gameID)
	if err != nil {
		return err
	}
	if g.Status != statusPausedError {
		return fmt.Errorf("%w: game %s has status %s", ErrGameNotPaused, gameID, g.Status)
	}
	return nil
}

// forceFinishEvents is engine.ForceFinish under the actor's panic guard: a
// paused game is one the engine has already failed on.
func forceFinishEvents(s *engine.State) (ev []engine.Event, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("force finish panicked: %v", r)
		}
	}()
	return engine.ForceFinish(s)
}

// stopping reports whether StopAll has been called. It is a hint for
// long-running work that wants to give up early, not a gate; anything that
// must be joined uses m.bg.Enter, which tests and registers in one step.
func (m *Manager) stopping() bool { return m.bg.IsStopping() }

// finishedGameGrace is how long a finished game's actor lingers (for late
// reconnects / final-view fetches) before the reaper releases it.
const finishedGameGrace = 30 * time.Second

// scheduleReap arranges for gameID's finished actor to be Released after the
// grace period. It runs on the clock goroutine, off the actor loop, so the
// Release to a.Stop() join does not deadlock.
func (m *Manager) scheduleReap(gameID string) {
	m.clock.AfterFunc(finishedGameGrace, func() {
		// Release stops an actor, which flushes its pending snapshot, so this
		// goroutine is a store user and is joined. During shutdown StopAll
		// stops every actor anyway.
		if !m.bg.Enter() {
			return
		}
		defer m.bg.Leave()
		m.Release(gameID)
	})
}

// applyRatings derives a placement order via computeRanks and feeds it to the
// OpenSkill update in its own transaction. Retained for the backfill/standalone
// path and tests; the live finish path uses computeRanks directly and applies
// the result inside the atomic finalize transaction (store.FinalizeGame).
func (m *Manager) applyRatings(gameID, ruleset string, seats []*store.Seat, winner int64, forfeited map[int64]bool) error {
	userIDs, ranks, err := m.computeRanks(gameID, seats, winner, forfeited)
	if err != nil {
		return err
	}
	if len(userIDs) < 2 {
		return nil
	}
	return m.st.ApplyGameRatings(ruleset, userIDs, ranks, m.clock.Now().Unix())
}

// computeRanks derives a 1st..last placement order (parallel userIDs/ranks
// slices) for the seats, the read-only half of rating application. The winner
// is rank 1. Forfeited seats get VP -1 so they rank last; the rest sort by
// final VP descending, ties sharing a rank. Returns (nil, nil, nil) when fewer
// than two non-bot seats remain. forfeited is empty for casual games.
func (m *Manager) computeRanks(gameID string, seats []*store.Seat, winner int64, forfeited map[int64]bool) ([]int64, []int, error) {
	// Bots never carry a rating. Ranked games only seat queued account
	// holders, so this is a safety net. Match Status == "bot", not IsGuest, so
	// anonymous human guests are still rated.
	rated := seats[:0:0]
	for _, s := range seats {
		if s.Status != "bot" {
			rated = append(rated, s)
		}
	}
	seats = rated
	if len(seats) < 2 {
		return nil, nil, nil
	}
	sb, err := BuildScoreboard(m.st, gameID)
	if err != nil {
		return nil, nil, err
	}
	// Map seat number -> final VP; forfeiters get -1 to sort last.
	vpBySeat := map[int]int{}
	for _, ps := range sb.Players {
		vpBySeat[ps.Seat] = ps.VP
	}
	// A drawn game (winner == 0) is rated as a tie: every seat that played to
	// the end is level, whatever their VP. Ranking by VP would let a draw
	// offer bank a rating win. Forfeiters still rank below.
	if winner == 0 {
		for _, s := range seats {
			vpBySeat[s.No] = 0
		}
	}
	// Forfeited seats get VP -1 so they land at the bottom. The winner keeps
	// their real VP even if listed as forfeited; they rank first regardless.
	for _, s := range seats {
		if forfeited[s.UserID] && s.UserID != winner {
			vpBySeat[s.No] = -1
		}
	}
	// Order seats: winner first, then by VP desc (forfeiters at -1 sort last).
	ordered := make([]*store.Seat, len(seats))
	copy(ordered, seats)
	sort.SliceStable(ordered, func(a, b int) bool {
		if ordered[a].UserID == winner {
			return true
		}
		if ordered[b].UserID == winner {
			return false
		}
		return vpBySeat[ordered[a].No] > vpBySeat[ordered[b].No]
	})
	userIDs := make([]int64, len(ordered))
	ranks := make([]int, len(ordered))
	// -1 cannot be a real VP. The winner (i==0) sets prevVP to their real VP
	// before any forfeiter (also -1) is compared, so there is no false tie.
	prevVP, place := -1, 0
	for i, s := range ordered {
		userIDs[i] = s.UserID
		vp := vpBySeat[s.No]
		switch {
		case i == 0: // the winner (or, in a draw, the first of the tied seats)
			place, prevVP = 1, vp
		case vp == prevVP:
			// tie: same place as previous (place/prevVP unchanged)
		default:
			place = i + 1
			prevVP = vp
		}
		ranks[i] = place
	}
	return userIDs, ranks, nil
}

// Release stops and forgets an actor (e.g. after finish + grace period).
func (m *Manager) Release(gameID string) {
	m.mu.Lock()
	a, ok := m.actors[gameID]
	delete(m.actors, gameID)
	m.mu.Unlock()
	if ok {
		a.Stop()
	}
}

// running reports whether gameID currently has a live actor (test helper for
// the reaper).
func (m *Manager) running(gameID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.actors[gameID]
	return ok
}

// stopAllTimeout bounds how long StopAll waits for actors to flush and exit,
// so an actor stuck on a stalled disk cannot hang shutdown. Events are durable
// per command, so returning early loses no committed state. A var so tests can
// shrink it.
var stopAllTimeout = 15 * time.Second

// StopAll shuts down every actor (server shutdown). It halts the idle reaper,
// refuses further loads (Get returns ErrShuttingDown), joins every actor's
// loop and joins the Manager's own background goroutines.
//
// When it returns without logging a timeout, no goroutine the Manager owns is
// running and none can start: every actor's command loop and snapshot worker,
// the recovery sweep, idle-reaper firings, finished-game reaps and in-flight
// lazy loads. The caller's store.Close depends on this. It covers the Manager
// only; the server's websocket goroutines and main's sweeps have their own
// lifecycle.Groups, joined by Server.Close and main before store.Close. Any new
// goroutine in this package belongs to m.bg.
//
// Both joins are bounded. On a timeout StopAll logs and returns with that
// goroutine still live, and store.Close races it. Committed events are
// durable, and the recovery sweep re-runs whatever it did not finish on the
// next start (match_history is the marker).
func (m *Manager) StopAll() {
	m.bg.Stop()

	m.mu.Lock()
	actors := make([]*Actor, 0, len(m.actors))
	for _, a := range m.actors {
		actors = append(actors, a)
	}
	m.actors = map[string]*Actor{}
	m.mu.Unlock()

	// Separate budgets for the two joins, so a slow actor cannot use up the
	// whole budget and leave the background join unattempted.
	if !joinWithin(stopAllTimeout, func() {
		for _, a := range actors {
			a.Stop()
		}
	}) {
		slog.Warn("StopAll timed out; exiting with actors still stopping", "count", len(actors))
	}
	// The sweep checks stopping() between games, so in practice this is
	// bounded by one finalize transaction. A timeout here means the store is
	// about to close under a live user.
	if !m.bg.Wait(stopAllTimeout) {
		slog.Warn("StopAll timed out joining background work")
	}
}

// joinWithin runs f in a goroutine and reports whether it finished within d.
func joinWithin(d time.Duration, f func()) bool {
	done := make(chan struct{})
	go func() { defer close(done); f() }()
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		return false
	}
}
