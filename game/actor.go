package game

import (
	"bytes"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/store"
	"github.com/ftqo/costan.io/timings"
)

const snapshotEvery = 50

// frameRingCap is how many recent encoded broadcast frames the shared per-game
// ring retains. A subscriber further behind than this is dropped and resynced.
// The window is shared across all subscribers, so memory is O(window) per game.
//
// Kept short: the ring only absorbs a briefly busy writePump. It is not a
// history; nothing reads history from it (Subscribe starts at the live
// NextSeq), and a client that falls behind refetches the gap from the store
// (GET /api/games/{id}?since=).
const frameRingCap = 100

// snapshotVersion prefixes snapshot blobs. rebuild() rejects any blob whose
// first byte differs and replays that game from seq 0 instead, so a bump costs
// one full replay per live game and nothing else (snapshots are an
// optimization; see docs/storage.md).
//
// Bump whenever decoding an old blob with the new binary could produce a wrong
// state rather than an obviously absent one. gob writes nothing for a zero
// value, so a field added to engine.State or to any Ext reachable through
// State.Ext decodes silently as its zero. Bump when that zero is wrong: a
// remaining count that reads "empty", a sentinel that reads as seat 0, a hex
// that reads as the board centre, an ext that reads as never initialised. A
// zero that the fold can detect and repair (engine.ExtRestorer, for nil maps)
// does not need a bump.
//
// The version belongs to the whole binary, not to one change, so do not write
// "this avoided a bump" in other comments; another change in the same release
// may bump it anyway.
//
// History:
//   - 3: Knights commodity supply (zero would read as empty stacks).
//   - 5: State.PublicSeed. Resuming from a snapshot never re-applies
//     game_created, so an old blob would roll off seed 0 and fail the audit.
//   - 6: fishGround.Hex (zero is the board centre, not "unknown").
//   - 7: Fishermen and Caravans seed their ext at board time, so an older blob
//     restores with an empty State.Ext and the views show no camels or
//     wayposts; and deriveGrounds now skips harbour sea hexes.
//   - 8: scenarios.FishExt.Total replaced by .Tiles (public tile count), and the
//     Caravans vote reshaped (CamelBid piles renamed, BidRes and Reason added).
//   - 9: CaravansExt's Arrows, ArrowCorner and Chains became slices and gained
//     Oases and CamelSupply; FishExt gained Lakes and BootSupply. An array does
//     not decode into a slice; the replayed board ext folds through the legacy
//     UnmarshalJSON rules.
const snapshotVersion = 9

// Clock abstracts time for tests.
type Clock interface {
	AfterFunc(d time.Duration, f func()) Timer
	Now() time.Time
}

type Timer interface {
	Stop() bool
	Reset(d time.Duration) bool
}

type realClock struct{}

func (realClock) AfterFunc(d time.Duration, f func()) Timer { return realTimer{time.AfterFunc(d, f)} }
func (realClock) Now() time.Time                            { return time.Now() }

type realTimer struct{ t *time.Timer }

func (rt realTimer) Stop() bool                 { return rt.t.Stop() }
func (rt realTimer) Reset(d time.Duration) bool { return rt.t.Reset(d) }

// PausedEvent is broadcast (never persisted) when the engine hits an
// invariant violation and the game freezes for investigation.
const PausedEvent engine.EventType = "game_paused_error"

// Subscription is one viewer's cursor into the game's shared frame ring. Each
// broadcast event is encoded at most twice (full and redacted) in the actor
// and appended to the ring; each subscriber hands the shared []byte to its
// connection's writePump. A subscriber that falls behind the retained window
// resyncs (full view + EventsSince) and re-subscribes.
type Subscription struct {
	Viewer engine.PlayerID
	rd     *ringReader
	actor  *Actor
}

// Next blocks until the next frame for this subscriber is ready and returns its
// shared wire bytes plus seq. behind==true means the cursor fell off the ring
// (slow consumer) and the caller must resync; ok==false with behind==false means
// the game stopped or the subscription was closed.
func (s *Subscription) Next() (raw []byte, seq int, behind, ok bool) {
	if s.rd == nil { // Subscribe failed (actor already stopped)
		return nil, 0, false, false
	}
	return s.rd.next()
}

// Position is the seq this subscription would deliver next: every frame before
// it has been returned by Next. Once the subscription is closed and its reader
// has returned for the last time, this is exactly where a successor must resume
// for the client to miss nothing (see SubscribeFrom).
func (s *Subscription) Position() int {
	if s.rd == nil {
		return -1
	}
	return s.rd.position()
}

// Close stops the subscriber's reader (unblocking a parked Next) and drops it
// from the actor's set so presence/broadcast no longer track it.
func (s *Subscription) Close() {
	if s.rd != nil {
		s.rd.stop()
	}
	s.actor.unsubscribe(s)
}

// Actor owns one game: it is the only goroutine that touches the state.
type Actor struct {
	ID string

	st       *store.Store
	clock    Clock
	reqs     chan func()
	quit     chan struct{}
	quitOnce sync.Once
	done     chan struct{}
	// goroutines counts every goroutine this actor owns: the command loop and
	// the snapshot worker. Stop waits on this rather than done, because the
	// worker may still be writing to the store after the loop exits.
	goroutines sync.WaitGroup
	onFinish   func(winner engine.PlayerID)
	onForfeit  func(seat engine.PlayerID)
	bots       func(engine.PlayerID) CommandSource
	botDelay   time.Duration

	// legal memoizes the per-state-version legal-target set so it is computed
	// once per state and reused across every viewer's view build at that version.
	legal legalCache

	// tick reschedules bot/auto-seat play between bounded batches.
	tick chan struct{}
	// release fires when a bot's pacing delay elapses. Bots pause before each
	// action: when a bot becomes the seat to act, runAutoSeats arms a delay
	// (botArmed) and only the release tick, handled with botReleasing set, lets
	// it act. botArmed coalesces repeated arming into one timer.
	release      chan struct{}
	botArmed     bool
	botReleasing bool

	// ring is the shared, seq-tagged buffer of encoded broadcast frames. It has
	// its own lock: the loop writes it, per-connection forwarders read it.
	ring *frameRing

	// Background snapshot writer: the loop encodes a seq-stamped snapshot and
	// hands it off so SaveSnapshot's fsync stays off the commit-to-broadcast
	// path. snapNext holds the latest queued snapshot (coalesced); snapWake
	// nudges the worker.
	snapMu   sync.Mutex
	snapNext *snapPending
	snapWake chan struct{}

	// Loop-owned.
	state     *engine.State
	subs      map[*Subscription]struct{}
	autoSeats map[engine.PlayerID]bool
	// walkedAway are seats whose player chose to hand them over (left to
	// spectate), as opposed to seats a disconnect escalated to a bot.
	// autoSeats does not distinguish the two, but consent does: a player who
	// walked away has given up their say, a disconnected player has not. See
	// consentless.
	walkedAway map[engine.PlayerID]bool
	botSeats   map[engine.PlayerID]CommandSource
	// absentSince records, for each disconnected seat still in its grace window,
	// the turn count when it went absent. After a full round the seat escalates
	// to a bot (see escalateAbsent).
	absentSince map[engine.PlayerID]int
	// turnsCompleted counts turn-ended events applied since this actor loaded.
	// It is session-local: the grace window is measured from load, and
	// restoring it from the log would expire every absent seat's grace on
	// reload. The log-folded game length is engine.State.TurnsCompleted, which
	// the concede thresholds read.
	turnsCompleted int

	// emptyDrains counts consecutive drainStaleBatch passes that resolved
	// nothing. See maxEmptyDrains.
	emptyDrains int
	timer       Timer
	// seatDeadlines maps each seat currently owing an action to when its visible
	// budget runs out and the decision it owes. Several entries during
	// simultaneous phases (discard on 7, module picks), one during a normal
	// turn, none when untimed. The single Go timer fires a short buffer past the
	// earliest deadline. Never persisted, so replay is unaffected.
	seatDeadlines map[engine.PlayerID]seatTimer
	// timerGen identifies the current arming of the turn timer. Every arming
	// and clear bumps it, and the callback carries the value it was armed
	// under, so a firing that lost the race to a player's command is dropped on
	// the loop. Otherwise a callback parked on reqs while the loop re-armed for
	// the same seat would auto-play the seat's fresh turn. Dropping it is safe:
	// rescheduleTimer always re-arms to the earliest remaining deadline. A
	// clock-based check would not work with the fake test clock.
	timerGen int
	// suspendedRemaining holds each on-clock seat's leftover budget (and the
	// decision it owed) at suspension, so Resume restores the time actually
	// left instead of a fresh budget. Disconnect time never counts against a
	// player, and reconnecting cannot reset the countdown. Nil except between
	// Suspend and Resume.
	suspendedRemaining map[engine.PlayerID]remainingBudget
	// offerTimer auto-cancels an open table trade offer that no one acts on, so a
	// stale offer can't linger for the rest of a (possibly long) turn. offerDeadline
	// is when it visibly expires (zero when no offer stands); clients count down to it.
	offerTimer    Timer
	offerDeadline time.Time
	// drawTimer/drawDeadline expire an open draw offer. Turn end clears it too,
	// but with TurnTimerSec == 0 nothing forces a turn to end, and while one
	// offer stands nobody else can make one.
	drawTimer    Timer
	drawDeadline time.Time
	paused       bool
	// suspended freezes all autonomous progress (bot/auto moves, timeout
	// auto-plays, offer expiry) while no human is connected. Lifted by Resume.
	suspended bool
	// humanSeats are seats owned by humans (not original bots) at load. Only
	// these can forfeit; original bots never do.
	humanSeats map[engine.PlayerID]bool
	// robberBy is the seat that most recently moved the robber, or nil before
	// the first move. Derived from the log, never written to it.
	robberBy *engine.PlayerID
	// seatRobbers maps each seat to its player's equipped robber skin ("" for
	// none), captured at load like seatNames, so a mid-game change applies at
	// the next load.
	seatRobbers map[engine.PlayerID]string
	// seatPieces maps each seat to its player's equipped piece set ("" for the
	// stock buildings). Captured at load like seatRobbers and read-only after,
	// so the actor never reaches into the loadout on a hot path.
	seatPieces map[engine.PlayerID]string
	// seatNames maps each seat to its player's display name, captured at load.
	// Read-only after construction; stamped into every view so spectators render
	// real names. Lobby metadata, never persisted to the event log.
	seatNames map[engine.PlayerID]string
	// forfeited records human seats a bot has already moved for, so the forfeit
	// fires at most once per seat.
	forfeited map[engine.PlayerID]bool
	// controlNow is the last seat_control value written for each seat, so
	// noteControl records transitions rather than one row per re-subscribe.
	// Session-local dedupe key; the persisted rows are the record.
	controlNow map[engine.PlayerID]string
	// lastActivity is the clock time of the most recent successfully committed
	// event batch. Initialized to load time and updated on every commit. Used
	// by Evictable to detect idle actors eligible for unloading.
	lastActivity time.Time
	// eventCap, when positive, triggers engine.ForceFinish once state.NextSeq
	// exceeds this value. Zero disables the cap.
	eventCap int
}

// seatTimer is one seat's live countdown: when its visible budget runs out and
// the decision kind it was armed for. The kind lets armTimer preserve an
// in-flight countdown only while the same decision is outstanding, while still
// granting a fresh budget when the same seat advances to a different decision
// (e.g. roll -> main).
type seatTimer struct {
	deadline time.Time
	kind     engine.DecisionKind
	// decisions is the module obligations the seat owed when this was armed,
	// sorted as PendingDeciders returns them. A seat that resolves one
	// obligation but still owes another has a different decision and is
	// re-armed.
	decisions []string
}

// sameDecisionAs reports whether this countdown was armed for the decision the
// seat owes now. Kind alone is not enough: two different module obligations
// are both DecisionModule.
func (st seatTimer) sameDecisionAs(d engine.Decider) bool {
	return st.kind == d.Kind && slices.Equal(st.decisions, d.Decisions)
}

// remainingBudget is a seat's leftover countdown captured at suspension: how much
// visible budget was left and which decision it was for. Resume turns it back into
// a deadline (now + remaining) only if the seat still owes the same decision.
type remainingBudget struct {
	remaining time.Duration
	kind      engine.DecisionKind
	decisions []string
}

// turnTimerBuffer is timings.TurnTimerBuffer, aliased for the call sites below.
const turnTimerBuffer = timings.TurnTimerBuffer

// inactivityFloor is timings.InactivityFloor, aliased for the call sites below.
const inactivityFloor = timings.InactivityFloor

// budgetFor returns the visible turn budget for a decision given the configured
// per-turn seconds. A non-positive turnTimerSec means untimed (zero); the
// lobby rejects that, but a game restored from an older log could carry one.
// Caps clamp below the full budget, never above it. Module decisions are sized
// by the obligations owed; see timings.ModuleCap.
func budgetFor(d engine.Decider, turnTimerSec int) time.Duration {
	if turnTimerSec <= 0 {
		// A blocking module decision gets its cap regardless: the table cannot
		// proceed without it, so leaving it unclocked would freeze the game.
		if d.Kind == engine.DecisionModule {
			return timings.ModuleCap(d.Decisions)
		}
		return 0
	}
	full := time.Duration(turnTimerSec) * time.Second
	capped := full
	switch d.Kind {
	case engine.DecisionRoll:
		capped = timings.RollCap
	case engine.DecisionDiscard:
		capped = timings.DiscardCap
	case engine.DecisionRobber:
		capped = timings.RobberCap
	case engine.DecisionModule:
		capped = timings.ModuleCap(d.Decisions)
	case engine.DecisionSetup:
		capped = timings.SetupCap
	case engine.DecisionSetupRoad:
		capped = timings.SetupRoadCap
	case engine.DecisionNone:
		return 0
	default:
		// DecisionMain (and any future kind) keeps the full main-turn budget.
	}
	// Every cap is a base for a Normal table; a longer table timer scales it
	// (timings.Scaled) before the clamp to the turn.
	capped = timings.Scaled(capped, turnTimerSec)
	if capped < full {
		return capped
	}
	return full
}

func (a *Actor) offerLifetime() time.Duration { return offerLifetimeFor(a.state.Config.TurnTimerSec) }

func offerLifetimeFor(turnTimerSec int) time.Duration {
	return timings.OfferLifetimeFor(turnTimerSec)
}

// CommandSource produces commands for a seat the way a player would. Bots
// plug in here (see the bot package).
type CommandSource interface {
	Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool)
}

type Options struct {
	Clock    Clock
	OnFinish func(winner engine.PlayerID)
	// OnForfeit fires once when a seat is taken over by a bot because its player
	// stayed disconnected for a full round. Used to record the forfeit.
	OnForfeit func(seat engine.PlayerID)
	// Bots installs a bot command source on a seat that escalates after its
	// player disconnects. Nil (sims/tests) falls back to plain auto-pass.
	Bots func(engine.PlayerID) CommandSource
	// BotDelay paces bot seats: the actor waits this long before each bot
	// action instead of bursting through the turn. Zero means instant (sims
	// and tests).
	BotDelay time.Duration
	// Humans lists seats owned by humans at load (store status != "bot"). Only
	// these can forfeit; original bots never do.
	Humans []engine.PlayerID
	// SeatNames maps each seat to its player's display name (lobby metadata),
	// so every view, including a spectator's, can render real names.
	SeatNames map[engine.PlayerID]string
	// SeatRobbers maps each seat to its player's equipped robber skin (lobby
	// metadata, same as SeatNames), so the robber can be drawn wearing the skin
	// of whichever seat last moved it.
	SeatRobbers map[engine.PlayerID]string
	// SeatPieces maps each seat to its player's equipped piece set (lobby
	// metadata, same as SeatNames), so every viewer draws each seat's buildings
	// out of that seat's own art. Absent or "" is the stock set.
	SeatPieces map[engine.PlayerID]string
	// EventCap, when positive, force-finishes the game (engine.ForceFinish)
	// once NextSeq exceeds it, bounding runaway logs. Zero disables the cap.
	EventCap int
}

// Load rebuilds the actor from the store (snapshot + event tail) and starts
// its loop.
func Load(id string, st *store.Store, opts Options) (*Actor, error) {
	if opts.Clock == nil {
		opts.Clock = realClock{}
	}
	state, err := rebuild(id, st)
	if err != nil {
		return nil, err
	}
	a := &Actor{
		ID:            id,
		st:            st,
		clock:         opts.Clock,
		reqs:          make(chan func()),
		quit:          make(chan struct{}),
		done:          make(chan struct{}),
		tick:          make(chan struct{}, 1),
		release:       make(chan struct{}, 1),
		onFinish:      opts.OnFinish,
		onForfeit:     opts.OnForfeit,
		bots:          opts.Bots,
		botDelay:      opts.BotDelay,
		state:         state,
		ring:          newFrameRing(frameRingCap),
		snapWake:      make(chan struct{}, 1),
		subs:          map[*Subscription]struct{}{},
		autoSeats:     map[engine.PlayerID]bool{},
		walkedAway:    map[engine.PlayerID]bool{},
		botSeats:      map[engine.PlayerID]CommandSource{},
		seatDeadlines: map[engine.PlayerID]seatTimer{},
		absentSince:   map[engine.PlayerID]int{},
		humanSeats:    humanSet(opts.Humans),
		seatNames:     opts.SeatNames,
		seatRobbers:   opts.SeatRobbers,
		seatPieces:    opts.SeatPieces,
		forfeited:     map[engine.PlayerID]bool{},
		controlNow:    map[engine.PlayerID]string{},
		lastActivity:  opts.Clock.Now(),
		eventCap:      opts.EventCap,
	}
	a.seedRobberBy()
	a.seedControl()
	a.goroutines.Add(2)
	go func() { defer a.goroutines.Done(); a.loop() }()
	go func() { defer a.goroutines.Done(); a.snapshotWorker() }()
	// A log that ends in a win while the row is still "active" is a
	// finalization that never happened (FinishGameOnce errored, or the process
	// died before the status write). Nothing else would ever finalize it:
	// commands return ErrGameFinished, a finished actor is not Evictable, and
	// recoverFinalization only sees rows already marked finished. Fire it here;
	// FinishGameOnce is idempotent.
	if state.Phase == engine.PhaseFinished && a.onFinish != nil {
		a.onFinish(state.Winner)
	}
	return a, nil
}

// seedRobberBy recovers which seat last moved the robber from the event log.
// Loading replays only events after the latest snapshot, so an older robber
// move would otherwise be lost and the robber would revert to the stock skin.
// Best-effort: a read or decode failure leaves the stock art.
func (a *Actor) seedRobberBy() {
	e, err := a.st.LastEventOfType(a.ID, string(engine.EvRobberMoved))
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			slog.Error("load last robber mover", "game", a.ID, "err", err)
		}
		return
	}
	var d engine.RobberMovedData
	if err := json.Unmarshal(e.Data, &d); err != nil {
		slog.Error("decode last robber mover", "game", a.ID, "err", err)
		return
	}
	p := d.Player
	a.robberBy = &p
}

func humanSet(seats []engine.PlayerID) map[engine.PlayerID]bool {
	m := make(map[engine.PlayerID]bool, len(seats))
	for _, s := range seats {
		m[s] = true
	}
	return m
}

func rebuild(id string, st *store.Store) (*engine.State, error) {
	state := engine.Empty()
	since := 0
	if seq, blob, err := st.LoadLatestSnapshot(id); err == nil {
		// Decode into a zero State, not engine.Empty(). gob omits zero-valued
		// fields, and Empty() pre-sets Cur/Winner/holders to NoPlayer (-1), so a
		// Cur of 0 would come back as -1. InitMaps then restores the maps gob
		// drops when empty.
		snap := &engine.State{}
		if len(blob) > 1 && blob[0] == snapshotVersion &&
			gob.NewDecoder(bytes.NewReader(blob[1:])).Decode(snap) == nil {
			snap.InitMaps()
			state = snap
			since = seq
		}
		// else: stale or corrupt snapshot; keep Empty() and replay from 0.
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	events, err := st.LoadEvents(id, since)
	if err != nil {
		return nil, err
	}
	if err := foldAll(state, events); err != nil {
		// A fold failure at rebuild is the same fault as one during live play
		// (a corrupt log or an engine bug), so pause the game as apply() does:
		// visible, frozen and recoverable (Manager.ForceFinishPaused /
		// AbandonPaused). Otherwise callers drop the error and the game looks
		// empty while its row stays "active". A snapshotVersion bump replays
		// every live game at once, which is when this shows up at scale.
		slog.Error("game rebuild failed", "game", id, "err", err)
		if serr := st.SetGameStatus(id, statusPausedError); serr != nil {
			slog.Error("set paused status", "game", id, "err", serr)
		}
		return nil, fmt.Errorf("%w: game %s: %w", ErrRebuildFailed, id, err)
	}
	if state.NextSeq == 0 {
		return nil, fmt.Errorf("game %s: no events", id)
	}
	return state, nil
}

// ErrRebuildFailed marks a rebuild that could not fold the log, as opposed to
// one that could not read it. Only a fold failure pauses the game; a failed
// store read is transient and leaves the row alone.
var ErrRebuildFailed = errors.New("game state could not be rebuilt from its event log")

// foldAll applies a loaded log into state, converting an engine invariant
// panic into an error as Actor.apply does, so a corrupt log freezes the game
// instead of killing the calling goroutine.
func foldAll(state *engine.State, events []engine.Event) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic applying event: %v", r)
		}
	}()
	for _, e := range events {
		if applyErr := engine.Apply(state, e); applyErr != nil {
			return fmt.Errorf("apply %s at seq %d: %w", e.Type, e.Seq, applyErr)
		}
	}
	return nil
}

func (a *Actor) loop() {
	defer close(a.done)
	a.armTimer()
	a.runAutoSeats()
	for {
		select {
		case fn := <-a.reqs:
			fn()
		case <-a.tick:
			a.runAutoSeats()
			a.runOfferResponses()
			a.runDrawResponses()
		case <-a.release:
			// A bot's pacing delay elapsed: let one bot action through, then
			// runAutoSeats re-arms the delay for the next.
			a.botArmed = false
			a.botReleasing = true
			a.runAutoSeats()
			a.botReleasing = false
		case <-a.quit:
			if a.timer != nil {
				a.timer.Stop()
			}
			if a.offerTimer != nil {
				a.offerTimer.Stop()
			}
			if a.drawTimer != nil {
				a.drawTimer.Stop()
			}
			// Wake every subscriber's reader so its forwarder goroutine exits.
			a.ring.closeRing()
			return
		}
	}
}

// call runs fn on the actor goroutine and waits for it, reporting whether fn
// ran. fn does not run once the loop has exited, which happens under live
// websockets (the finished-game reaper and the idle sweep both stop actors),
// so every caller must check the result or a move dropped by a stopped actor
// is reported as accepted. An explicit `_ =` is used where the stop is already
// expressed in the result (Evictable false, View/Subscribe nil) or nothing is
// waiting on an answer.
func (a *Actor) call(fn func()) bool {
	done := make(chan struct{})
	select {
	case a.reqs <- func() { fn(); close(done) }:
		<-done
		return true
	case <-a.done:
		return false
	}
}

// Stop signals every goroutine this actor owns to exit and waits for all of
// them, including the snapshot worker, so the store can be closed safely
// afterwards. Safe for concurrent callers (sync.Once guards closing a.quit)
// and idempotent.
func (a *Actor) Stop() {
	a.quitOnce.Do(func() { close(a.quit) })
	a.goroutines.Wait()
}

// Evictable reports whether this actor can be unloaded: no subscriber is
// attached, the game is not finished (finished games reap via scheduleReap),
// and nothing has committed within the idle window. State rebuilds from the
// log on the next Get. Runs on the loop.
//
// Paused games are evictable too; otherwise each engine bug would pin an actor
// for the life of the process. A viewer keeps it loaded, and recovery works
// from the store (Manager.ForceFinishPaused, Manager.AbandonPaused).
func (a *Actor) Evictable(now time.Time, idle time.Duration) bool {
	var ok bool
	_ = a.call(func() {
		ok = len(a.subs) == 0 &&
			a.state.Phase != engine.PhaseFinished &&
			now.Sub(a.lastActivity) >= idle
	})
	return ok
}

// Do validates, persists, applies, and broadcasts a command's events.
func (a *Actor) Do(cmd engine.Command) error {
	var err error
	if !a.call(func() { err = a.execute(cmd) }) {
		return ErrGameStopped
	}
	return err
}

// ErrGameStopped is returned for a command when the actor is no longer
// running: the game was reaped after finishing, evicted for idleness, or the
// server is shutting down. It is a refusal, so the command is never reported
// as accepted.
var ErrGameStopped = errors.New("this game is no longer running; reload to continue")

var ErrPaused = errors.New("game is paused due to an internal error")

// ErrSeatBotControlled rejects a human-submitted command for a seat a bot is
// currently playing (the player left to spectate, or was escalated after a
// disconnect). The frontend hides these controls; this stops a crafted frame
// racing the bot.
var ErrSeatBotControlled = errors.New("a bot is playing this seat")

// ErrClaimNeedsBots rejects a claim (engine.CmdClaimGame) while another human
// is still playing. Claiming skips consent, which is only defensible when the
// skipped seats are bots; against a human, the draw offer is the route. The
// check lives here because seat status is game-layer knowledge.
var ErrClaimNeedsBots = errors.New("every other seat must be played by a bot")

func init() {
	// The engine owns the player-facing wording, so game-layer refusals
	// register here the same way a module's do.
	engine.RegisterErrorMessage(ErrClaimNeedsBots, "You can only end the game this way when every other seat is a bot")
	engine.RegisterErrorCode(ErrClaimNeedsBots, "CLAIM_NEEDS_BOTS")
	// Without this, a player who left to spectate and then pressed Surrender
	// would see the generic "That move isn't allowed".
	engine.RegisterErrorMessage(ErrSeatBotControlled, "A bot is playing your seat. Rejoin it before you make a move")
	engine.RegisterErrorCode(ErrSeatBotControlled, "SEAT_BOT_CONTROLLED")
	// Reaches a player whose game was reaped, evicted or restarted while their
	// socket was open; reloading is the useful advice.
	engine.RegisterErrorMessage(ErrGameStopped, "This game is no longer running. Reload the page to continue")
	engine.RegisterErrorCode(ErrGameStopped, "GAME_STOPPED")
}

func (a *Actor) execute(cmd engine.Command) (err error) {
	if a.paused {
		return ErrPaused
	}
	// Terminal conditions first: every game-layer gate below is about a game
	// still in progress, and reporting one for a finished game is misleading.
	if a.state.Phase == engine.PhaseFinished {
		return engine.ErrGameFinished
	}
	if a.autoSeats[cmd.Player] {
		return ErrSeatBotControlled
	}
	if cmd.Type == engine.CmdClaimGame && !a.onlyBotsBesides(cmd.Player) {
		return ErrClaimNeedsBots
	}
	// engine.Decide and the auto/bot machinery (runAutoSeats,
	// engine.AutoCommand) can panic on an invariant violation. Recover and
	// pause instead of killing the loop goroutine (mirrors apply's guard).
	defer a.recoverToPause(fmt.Sprintf("command %s by seat %d", cmd.Type, cmd.Player), &err)
	events, decErr := engine.Decide(a.state, cmd)
	if decErr != nil {
		return decErr
	}
	// The only commit a human's own command reaches; every other commit is
	// the server acting for a seat. The autoSeats gate above has already
	// refused a bot-held seat.
	if err := a.commit(events, engine.SourceHuman); err != nil {
		return err
	}
	a.runAutoSeats()
	return nil
}

// recoverToPause converts a panic in engine.Decide, engine.AutoCommand or a
// bot command source into a paused game instead of a crashed actor goroutine
// (the counterpart to apply's recover). If errOut is non-nil it is set to
// ErrPaused.
//
//nolint:gocritic // ptrToRefParam: errOut is a written-through out-parameter
func (a *Actor) recoverToPause(context string, errOut *error) {
	if r := recover(); r != nil {
		a.pause(fmt.Sprintf("panic in %s: %v", context, r))
		if errOut != nil {
			*errOut = ErrPaused
		}
	}
}

// commit is the persist, apply, broadcast pipeline. A crash between persist
// and broadcast is safe: rebuild replays the persisted events.
//
// src is the batch's provenance and is required, not defaulted, so every path
// that writes to the log has to say who caused it.
func (a *Actor) commit(events []engine.Event, src engine.Source) error {
	if len(events) == 0 {
		return nil
	}
	// Stamp before persisting: once an event reaches SQLite unstamped, its
	// provenance cannot be recovered.
	engine.StampSource(events, src)
	if err := a.st.AppendEvents(a.ID, events); err != nil {
		return err
	}
	for _, e := range events {
		if err := a.apply(e); err != nil {
			return err
		}
	}
	a.escalateAbsent()
	a.lastActivity = a.clock.Now()
	for _, e := range events {
		a.broadcast(e)
	}
	if a.state.NextSeq%snapshotEvery < len(events) {
		a.snapshot()
	}
	if refreshesTurnTimer(events) {
		a.armTimer()
	}
	a.maintainOfferTimer(events)
	a.maintainDrawTimer(events)
	if a.state.ActiveOffer != nil {
		a.scheduleTick(a.botDelay) // let bot seats respond to the standing offer
	}
	if a.state.DrawOffer != nil && a.state.Phase != engine.PhaseFinished {
		// Paced like trade responses: runDrawResponses commits at most one
		// acceptance per tick, so one offer does not fan out into a burst of
		// writes and broadcasts.
		a.scheduleTick(a.botDelay)
	}
	if a.eventCap > 0 && a.state.Phase != engine.PhaseFinished && a.state.NextSeq > a.eventCap {
		fin, err := engine.ForceFinish(a.state)
		if err != nil {
			return err
		}
		if len(fin) > 0 {
			// The event cap is the server ending a runaway game; no seat
			// decided it.
			if err := a.commit(fin, engine.SourceServer); err != nil {
				return err
			}
			return nil // onFinish already fired in the recursive commit
		}
	}
	if a.state.Phase == engine.PhaseFinished && a.onFinish != nil {
		a.onFinish(a.state.Winner)
	}
	return nil
}

// noteCommitFailure logs a commit that did not persist. The move did not
// happen and the caller will not reschedule, so without a log line a
// SQLITE_BUSY or full disk looks like a hang. ErrPaused is skipped because
// pause() has already logged the reason. Other errors are logged as-is; the
// transport classifies storage failures.
func (a *Actor) noteCommitFailure(what string, err error) {
	if errors.Is(err, ErrPaused) {
		return
	}
	slog.Error("commit failed; the game did not advance", "game", a.ID, "what", what, "err", err)
}

// apply folds an event, converting engine invariant panics into a paused game
// instead of a crashed server.
func (a *Actor) apply(e engine.Event) (err error) {
	defer func() {
		if r := recover(); r != nil {
			a.pause(fmt.Sprintf("panic applying %s at seq %d: %v", e.Type, e.Seq, r))
			err = ErrPaused
		}
	}()
	if foldErr := engine.Apply(a.state, e); foldErr != nil {
		a.pause(fmt.Sprintf("apply %s at seq %d: %v", e.Type, e.Seq, foldErr))
		return ErrPaused
	}
	if e.Type == engine.EvTurnEnded {
		a.turnsCompleted++
	}
	if e.Type == engine.EvRobberMoved {
		// Every ruleset's robber move emits this one event with the moving seat:
		// the base move, the Knights chase and Bishop, and the Fishermen's.
		var d engine.RobberMovedData
		if err := json.Unmarshal(e.Data, &d); err == nil {
			p := d.Player
			a.robberBy = &p
		}
	}
	return nil
}

func (a *Actor) pause(reason string) {
	a.paused = true
	slog.Error("game paused", "game", a.ID, "reason", reason)
	if err := a.st.SetGameStatus(a.ID, statusPausedError); err != nil {
		slog.Error("set paused status", "game", a.ID, "err", err)
	}
	// Push a public paused frame at the next free seq so every subscriber
	// reads it once. The game is frozen, so later seq continuity is moot.
	pe := engine.Event{Seq: a.state.NextSeq, Type: PausedEvent, Data: []byte(`{}`)}
	a.ring.push(encodeFrame(a.ID, pe))
}

func (a *Actor) broadcast(e engine.Event) {
	// Encode once (plus a redacted variant only for hidden events) and append
	// to the shared ring; every subscriber reads the same bytes.
	a.ring.push(encodeFrame(a.ID, e))
}

// snapPending is an encoded, seq-stamped snapshot handed to the background
// worker. Encoding happens on the loop so a.state is never read concurrently
// with a mutation; only the DB write and fsync run off the commit path.
type snapPending struct {
	seq  int
	blob []byte
}

// snapshot encodes the current state on the loop and hands the bytes to the
// background writer, so SaveSnapshot's transaction and fsync do not stall the
// commit path. Snapshots are an optimization, so dropping a coalesced one or
// losing the last on shutdown is harmless.
func (a *Actor) snapshot() {
	var buf bytes.Buffer
	buf.WriteByte(snapshotVersion)
	if err := gob.NewEncoder(&buf).Encode(a.state); err != nil {
		slog.Error("snapshot encode", "game", a.ID, "err", err)
		return
	}
	a.queueSnapshot(snapPending{seq: a.state.NextSeq, blob: buf.Bytes()})
}

// queueSnapshot hands an encoded snapshot to the background worker. If a
// write is already queued, the newer snapshot replaces it. Non-blocking.
func (a *Actor) queueSnapshot(s snapPending) {
	a.snapMu.Lock()
	a.snapNext = &s // newest wins; older queued snapshot is superseded
	a.snapMu.Unlock()
	select {
	case a.snapWake <- struct{}{}:
	default: // worker already has a wake pending
	}
}

// snapshotWorker writes queued snapshots off the loop. One worker per actor
// keeps seqs in order, and coalescing means it only writes the latest. Exits
// when quit closes and nothing is pending.
func (a *Actor) snapshotWorker() {
	for {
		select {
		case <-a.snapWake:
		case <-a.quit:
			a.drainSnapshots()
			return
		}
		a.drainSnapshots()
	}
}

// beforeSnapshotSave, when non-nil, runs on the snapshot worker just before
// each SaveSnapshot. Test-only: it lets a test park the worker between
// queueing and writing to check that Stop waits for it. Set before any actor
// exists and never mutated, so reading it is race-free.
var beforeSnapshotSave func()

func (a *Actor) drainSnapshots() {
	for {
		a.snapMu.Lock()
		s := a.snapNext
		a.snapNext = nil
		a.snapMu.Unlock()
		if s == nil {
			return
		}
		if beforeSnapshotSave != nil {
			beforeSnapshotSave()
		}
		if err := a.st.SaveSnapshot(a.ID, s.seq, s.blob); err != nil {
			slog.Error("snapshot save", "game", a.ID, "err", err)
		}
	}
}

// Subscribe attaches a viewer and returns the subscription plus a full view
// consistent with the stream start. The ring cursor is set to view.Seq on the
// loop, so the stream resumes where the view ends with no gap or duplicate.
func (a *Actor) Subscribe(viewer engine.PlayerID) (*Subscription, *FullView) {
	return a.SubscribeFrom(viewer, -1)
}

// SubscribeFrom is Subscribe for a viewer replacing its own subscription (a
// re-subscribe on the same connection): the cursor starts at `from`, the
// predecessor's Position, so undelivered frames are delivered by the new one.
// The caller sends those frames before the view, and the view before anything
// at or past view.Seq (server.Conn.forward does this).
//
// Falls back to view.Seq when `from` is negative or has left the window; the
// client's gap check refetches the missing log over REST.
func (a *Actor) SubscribeFrom(viewer engine.PlayerID, from int) (*Subscription, *FullView) {
	sub := &Subscription{Viewer: viewer, actor: a}
	var view *FullView
	_ = a.call(func() {
		view = a.viewFor(viewer)
		if view != nil {
			start := view.Seq
			if from >= 0 && a.ring.canResume(from, view.Seq) {
				start = from
			}
			sub.rd = a.ring.reader(viewer, start)
			a.subs[sub] = struct{}{}
		}
	})
	if view == nil { // actor stopped
		return sub, nil
	}
	return sub, view
}

// viewFor renders the redacted view and stamps every pending seat's remaining
// budget (ms) for synced countdowns. Loop-only. Values re-sync every frame and
// the client counts down locally in between.
func (a *Actor) viewFor(viewer engine.PlayerID) *FullView {
	// A seat handed to a bot still has an owner watching. While the bot holds
	// it, everything the view carries for deciding is withheld (see
	// newFullViewLegal); ownership information stays. Both transitions
	// broadcast a roster resync, so the client gets a fresh view on each.
	_, botHeld := a.botSeats[viewer]
	v := newFullViewLegal(a.state, viewer, !botHeld, func(seat engine.PlayerID) engine.LegalTargets {
		return a.legal.For(a.state, a.state.NextSeq, seat)
	})
	if v == nil {
		return nil
	}
	// Stamped on every view, not once at join, because a reconnecting client
	// only gets a full view.
	tw := timings.For(a.state.Config.TurnTimerSec)
	v.Timings = &tw
	if len(a.seatDeadlines) > 0 {
		now := a.clock.Now()
		m := make(map[engine.PlayerID]int64, len(a.seatDeadlines))
		budgets := make(map[engine.PlayerID]int64, len(a.seatDeadlines))
		for seat, st := range a.seatDeadlines {
			if ms := st.deadline.Sub(now).Milliseconds(); ms > 0 {
				m[seat] = ms
				// The decision's whole budget, so the client can scale
				// remaining/budget for the bar.
				budgets[seat] = budgetFor(
					engine.Decider{Seat: seat, Kind: st.kind, Decisions: st.decisions},
					a.state.Config.TurnTimerSec,
				).Milliseconds()
			}
		}
		if len(m) > 0 {
			v.SeatDeadlines = m
			v.SeatBudgets = budgets
		}
	}
	if !a.offerDeadline.IsZero() {
		if ms := a.offerDeadline.Sub(a.clock.Now()).Milliseconds(); ms > 0 {
			v.OfferDeadlineMs = &ms
		}
	}
	if !a.drawDeadline.IsZero() && a.state.DrawOffer != nil {
		if ms := a.drawDeadline.Sub(a.clock.Now()).Milliseconds(); ms > 0 {
			v.DrawDeadlineMs = &ms
		}
	}
	// Read-only after load, so sharing the map is safe. Lets spectators render
	// real names.
	if len(a.seatNames) > 0 {
		v.SeatNames = a.seatNames
	}
	if a.robberBy != nil {
		v.RobberSkin = a.seatRobbers[*a.robberBy]
	}
	// Read-only after load, like the names. Sent to every viewer because each
	// seat's buildings are drawn on everyone's board.
	if len(a.seatPieces) > 0 {
		v.SeatPieces = a.seatPieces
	}
	// Whether everyone else at the table is a bot, so the client knows whether
	// to offer the claim control. Only the game layer knows seat status.
	v.BotsOnly = viewer >= 0 && a.onlyBotsBesides(viewer)
	return v
}

// consentless reports whether a seat has no stake worth consulting: an
// original bot, or a player who chose to leave. A seat escalated after a
// disconnect is not consentless; that player still owns their game, and the
// others must not be able to accept a draw on their behalf.
func (a *Actor) consentless(seat engine.PlayerID) bool {
	return !a.humanSeats[seat] || a.walkedAway[seat]
}

// MarkWalkedAway records that a seat's player left of their own accord, so the
// seat may consent on their behalf. Called by Manager.LeaveSeat, never by the
// disconnect escalation.
func (a *Actor) MarkWalkedAway(seat engine.PlayerID) {
	_ = a.call(func() { a.walkedAway[seat] = true })
}

// onlyBotsBesides reports whether every seat other than p is played by a bot or
// auto-pass: an original bot, a player who left to spectate, or a seat escalated
// after a disconnect. It is the precondition for a claim, and the flag the view
// carries so the client only shows the control when it would work.
func (a *Actor) onlyBotsBesides(p engine.PlayerID) bool {
	if len(a.state.Players) < 2 {
		return false
	}
	for q := range a.state.Players {
		seat := engine.PlayerID(q)
		if seat == p {
			continue
		}
		if !a.consentless(seat) {
			return false
		}
	}
	return true
}

// concedeCommand reports whether a command type ends (or proposes ending) the
// game rather than playing it. Only a human seat's own frame may carry one.
func concedeCommand(t engine.CommandType) bool {
	switch t {
	case engine.CmdSurrender, engine.CmdOfferDraw, engine.CmdRespondDraw,
		engine.CmdCancelDraw, engine.CmdClaimGame:
		return true
	default:
		// every other command plays the game rather than ending it
	}
	return false
}

// runDrawResponses accepts an open draw offer on behalf of every consentless
// seat (bots and players who walked away), so the offer only needs the other
// human seats. Acceptances are ordinary commands, logged and replayed. Runs
// only on the loop.
func (a *Actor) runDrawResponses() {
	if a.paused || a.suspended || a.state.Phase == engine.PhaseFinished || a.state.DrawOffer == nil {
		return
	}
	defer a.recoverToPause("draw response", nil)
	accept := json.RawMessage(`{"accept":true}`)
	o := a.state.DrawOffer
	for q := range a.state.Players {
		seat := engine.PlayerID(q)
		if seat == o.By || o.HasAccepted(seat) || !a.consentless(seat) {
			continue
		}
		events, err := engine.Decide(a.state, engine.Command{Player: seat, Type: engine.CmdRespondDraw, Data: accept})
		if err != nil {
			continue
		}
		// Accepting a draw for a consentless seat is the server acting, and
		// the provenance records that.
		if err := a.commit(events, a.autoSourceFor(seat, false)); err != nil {
			a.noteCommitFailure("draw response", err)
			return
		}
		return // one acceptance per call; commit scheduled the next pass
	}
}

// maintainDrawTimer arms an expiry when a draw offer is posted and stops it
// once none stands. Mirrors maintainOfferTimer, including measuring from when
// the offer was posted rather than refreshing on each response.
func (a *Actor) maintainDrawTimer(events []engine.Event) {
	if a.state.DrawOffer == nil {
		a.drawDeadline = time.Time{}
		if a.drawTimer != nil {
			a.drawTimer.Stop()
		}
		return
	}
	posted := false
	for _, e := range events {
		if e.Type == engine.EvDrawOffered {
			posted = true
		}
	}
	if !posted {
		return
	}
	a.armDrawTimer()
}

// armDrawTimer starts a fresh expiry window for the standing draw offer. Used
// by maintainDrawTimer and Resume (a suspension does not keep what was left).
func (a *Actor) armDrawTimer() {
	// The same window a trade offer gets. A draw offer is answered in a
	// click, and with a turn timer the turn end clears it first anyway.
	life := a.offerLifetime()
	a.drawDeadline = a.clock.Now().Add(life)
	d := life + turnTimerBuffer
	if a.drawTimer == nil {
		a.drawTimer = a.clock.AfterFunc(d, a.onDrawTimer)
		return
	}
	a.drawTimer.Stop()
	a.drawTimer.Reset(d)
}

// onDrawTimer fires on the clock goroutine; hop onto the loop.
func (a *Actor) onDrawTimer() {
	select {
	case a.reqs <- func() { a.expireDrawOffer() }:
	case <-a.done:
	}
}

// expireDrawOffer withdraws the standing draw offer on behalf of its owner. A
// no-op if the offer was already answered or cleared before the timer fired.
func (a *Actor) expireDrawOffer() {
	if a.paused || a.suspended || a.state.DrawOffer == nil {
		return
	}
	defer a.recoverToPause("draw offer expiry", nil)
	cmd := engine.Command{Player: a.state.DrawOffer.By, Type: engine.CmdCancelDraw}
	events, err := engine.Decide(a.state, cmd)
	if err != nil {
		slog.Error("draw offer expiry", "game", a.ID, "err", err)
		return
	}
	// A timer withdrew this, not the offerer, so it is attributed to the
	// server.
	if err := a.commit(events, engine.SourceServer); err != nil {
		a.noteCommitFailure("draw offer expiry", err)
	}
}

// unsubscribe drops a subscription from the actor's set. Subscription.Close
// has already stopped the reader; this only forgets the cursor.
func (a *Actor) unsubscribe(sub *Subscription) {
	_ = a.call(func() { delete(a.subs, sub) })
}

// EventsSince returns redacted persisted events for a reconnect gap.
func (a *Actor) EventsSince(viewer engine.PlayerID, since int) ([]engine.Event, error) {
	events, err := a.st.LoadEvents(a.ID, since)
	if err != nil {
		return nil, err
	}
	out := make([]engine.Event, len(events))
	for i, e := range events {
		out[i] = RedactEvent(e, viewer)
	}
	return out, nil
}

// SetSeatAuto marks a seat as auto-pass (disconnected/kicked); auto seats act
// immediately whenever the game waits on them. A call that changes nothing
// does not re-run auto/bot play: clients re-subscribe on every event, and
// re-running here would let bots skip their pacing delay.
func (a *Actor) SetSeatAuto(seat engine.PlayerID, auto bool) {
	_ = a.call(func() {
		if _, was := a.autoSeats[seat]; was == auto {
			return
		}
		if auto {
			a.autoSeats[seat] = true
		} else {
			delete(a.autoSeats, seat)
		}
		a.noteControl(seat)
		a.runAutoSeats()
	})
}

// View returns the redacted full view for viewer, built on the loop.
func (a *Actor) View(viewer engine.PlayerID) *FullView {
	var view *FullView
	_ = a.call(func() { view = a.viewFor(viewer) })
	return view
}

// refreshesTurnTimer reports whether a committed batch should reset the
// decider's turn budget. Most actions do, but trade negotiation (offer,
// response, counter, cancel or expiry) and draw offers do not: they leave the
// decider on the same decision and have their own offer timer.
func refreshesTurnTimer(events []engine.Event) bool {
	for _, e := range events {
		switch e.Type {
		case engine.EvTradeOffered, engine.EvTradeResponded, engine.EvTradeCancelled, engine.EvTradeCountered,
			engine.EvDrawOffered, engine.EvDrawResponded, engine.EvDrawCancelled:
			// Trade negotiation and draw offers: not a move by the seat on
			// the clock, so the turn timer is left alone.
		default:
			return true
		}
	}
	return false
}

// runOfferResponses lets non-active bot seats respond to the standing offer
// (accept, decline or counter); the auto-seat loop only drives the seat
// nextToAct reports. It commits at most one response per call and reports
// whether it did; the commit reschedules a tick, so responses stagger by
// botDelay. The responded guard limits each bot to one answer per offer,
// which also stops a bot whose evaluation flips from revising forever.
// Runs only on the loop.
func (a *Actor) runOfferResponses() bool {
	if a.paused || a.suspended || a.state.Phase == engine.PhaseFinished || a.state.ActiveOffer == nil {
		return false
	}
	defer a.recoverToPause("offer response", nil)
	o := a.state.ActiveOffer
	for q := range a.state.Players {
		seat := engine.PlayerID(q)
		if seat == o.By || o.Responded(seat) {
			continue
		}
		src, isBot := a.botSeats[seat]
		if !isBot {
			continue
		}
		cmd, ok := src.Act(a.state, seat)
		if !ok || (cmd.Type != engine.CmdRespondTrade && cmd.Type != engine.CmdCounterTrade) {
			continue // abstaining (or a non-response move) is always valid
		}
		events, err := engine.Decide(a.state, cmd)
		if err != nil {
			continue // an illegal/declined response just means no response
		}
		// autoSourceFor distinguishes an original bot from one that inherited
		// the seat.
		if err := a.commit(events, a.autoSourceFor(seat, false)); err != nil {
			a.noteCommitFailure("trade offer response", err)
			return false
		}
		return true // one response per call; commit scheduled the next pass
	}
	return false
}

// armTimer computes a deadline for every seat that currently owes an action
// and points the single Go timer at the earliest (plus a buffer). Called after
// every committed action. All pending seats are armed, so simultaneous
// discards each show a timer, and bot seats too, so the countdown is never
// blank and a hung bot is backstopped. A seat already armed for the same
// decision keeps its deadline.
func (a *Actor) armTimer() {
	if a.paused {
		a.clearSeatDeadlines()
		return
	}
	// A non-positive turn timer normally arms nothing (the lobby rejects it,
	// but an old config row can still carry 0). That is fine for base
	// decisions, where the table just sits idle. While a module Blocks (a
	// camel vote waits on its bidders, then the placer) nothing else would
	// ever resolve a human seat, so an untimed table still arms the module
	// caps budgetFor floors in; every other seat stays unclocked.
	if a.state.Config.TurnTimerSec <= 0 && !moduleBlocks(a.state) {
		a.clearSeatDeadlines()
		return
	}
	now := a.clock.Now()
	next := make(map[engine.PlayerID]seatTimer)
	for _, d := range engine.PendingDeciders(a.state) {
		if prev, ok := a.seatDeadlines[d.Seat]; ok && prev.sameDecisionAs(d) && !prev.deadline.IsZero() {
			kept := prev // same decision still outstanding: keep its countdown
			if d.Kind == engine.DecisionMain {
				// Inactivity floor: a turn-advancing action guarantees the active
				// player at least min(inactivityFloor, TurnTimerSec) for the next
				// move. This branch is only reached after a commit for which
				// refreshesTurnTimer returned true (rebuild/Resume start with
				// empty seatDeadlines), so it never fires on trade negotiation.
				floor := timings.Scaled(inactivityFloor, a.state.Config.TurnTimerSec)
				if budget := time.Duration(a.state.Config.TurnTimerSec) * time.Second; budget < floor {
					floor = budget
				}
				if f := now.Add(floor); f.After(prev.deadline) {
					kept.deadline = f
				}
			} else if d.Kind == engine.DecisionRoll && moduleFixedDice(a.state) {
				// Alchemist floor: playing the card fixes the dice but leaves the
				// decision unchanged (still DecisionRoll), so the branch above
				// does not fire. Grant at least timings.AlchemistBonus for the
				// roll that follows, keeping whichever is larger.
				if f := now.Add(timings.Scaled(timings.AlchemistBonus, a.state.Config.TurnTimerSec)); f.After(prev.deadline) {
					kept.deadline = f
				}
			}
			next[d.Seat] = kept
			continue
		}
		budget := budgetFor(d, a.state.Config.TurnTimerSec)
		if rem, ok := a.suspendedRemaining[d.Seat]; ok && rem.kind == d.Kind && slices.Equal(rem.decisions, d.Decisions) {
			// Resuming from a suspension: restore the time the seat had left
			// rather than a fresh budget. A seat already out of time fires
			// promptly on resume.
			if budget = rem.remaining; budget <= 0 {
				budget = time.Millisecond
			}
		}
		if budget <= 0 {
			continue
		}
		next[d.Seat] = seatTimer{deadline: now.Add(budget), kind: d.Kind, decisions: d.Decisions}
	}
	a.seatDeadlines = next
	a.rescheduleTimer(now)
}

// moduleFixedDice reports whether some module has already fixed the next
// roll's dice (currently only Knights' Alchemist). It uses the generic
// Hooks().FixedDice, as engine/turn.go does, so the timer layer does not
// import engine/knights.
func moduleFixedDice(s *engine.State) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().FixedDice; h != nil {
			if _, _, ok := h(s); ok {
				return true
			}
		}
	}
	return false
}

// moduleBlocks reports whether some module is currently holding the turn (a
// camel vote, a barbarian-attack choice). Uses the generic hooks, like
// moduleFixedDice.
func moduleBlocks(s *engine.State) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().Blocks; h != nil && h(s) {
			return true
		}
	}
	return false
}

// clearSeatDeadlines drops all countdowns and stops the timer.
func (a *Actor) clearSeatDeadlines() {
	a.seatDeadlines = map[engine.PlayerID]seatTimer{}
	a.timerGen++ // any firing already in flight is stale
	if a.timer != nil {
		a.timer.Stop()
	}
}

// rescheduleTimer points the single Go timer at the earliest pending deadline
// (a buffer past it), or stops it when nothing is owed.
//
// It builds a new timer rather than calling Reset, because Reset keeps the
// original callback and the generation (see timerGen) has to travel inside
// the callback. Stop's result is ignored: a firing already in flight is
// handled by the generation check.
func (a *Actor) rescheduleTimer(now time.Time) {
	var earliest time.Time
	for _, st := range a.seatDeadlines {
		if earliest.IsZero() || st.deadline.Before(earliest) {
			earliest = st.deadline
		}
	}
	a.timerGen++
	if a.timer != nil {
		a.timer.Stop()
	}
	if earliest.IsZero() {
		return
	}
	d := max(earliest.Sub(now)+turnTimerBuffer, 0)
	gen := a.timerGen
	a.timer = a.clock.AfterFunc(d, func() { a.onTimer(gen) })
}

// onTimer fires on the clock goroutine; hop onto the loop, carrying the
// generation this arming belonged to.
func (a *Actor) onTimer(gen int) {
	select {
	case a.reqs <- func() { a.autoTimeoutDecision(gen) }:
	case <-a.done:
	}
}

// maintainOfferTimer arms a fresh expiry whenever an offer is posted (a new
// EvTradeOffered, including one replacing another) and stops it once no offer
// stands. Other commits leave the deadline alone, so the window is measured
// from posting, not refreshed by responses.
func (a *Actor) maintainOfferTimer(events []engine.Event) {
	if a.state.ActiveOffer == nil {
		a.offerDeadline = time.Time{}
		if a.offerTimer != nil {
			a.offerTimer.Stop()
		}
		return
	}
	posted := false
	for _, e := range events {
		if e.Type == engine.EvTradeOffered {
			posted = true
		}
	}
	if !posted {
		return
	}
	life := a.offerLifetime()
	a.offerDeadline = a.clock.Now().Add(life)
	d := life + turnTimerBuffer
	if a.offerTimer == nil {
		a.offerTimer = a.clock.AfterFunc(d, a.onOfferTimer)
		return
	}
	a.offerTimer.Stop()
	a.offerTimer.Reset(d)
}

// onOfferTimer fires on the clock goroutine; hop onto the loop.
func (a *Actor) onOfferTimer() {
	select {
	case a.reqs <- func() { a.expireOffer() }:
	case <-a.done:
	}
}

// expireOffer auto-cancels the standing offer on behalf of its owner. It is a
// no-op if the offer was already executed or canceled before the timer fired.
func (a *Actor) expireOffer() {
	if a.paused || a.suspended || a.state.ActiveOffer == nil {
		return
	}
	defer a.recoverToPause("offer expiry", nil)
	cmd := engine.Command{Player: a.state.ActiveOffer.By, Type: engine.CmdCancelTrade}
	events, err := engine.Decide(a.state, cmd)
	if err != nil {
		slog.Error("offer expiry", "game", a.ID, "err", err)
		return
	}
	// On commit failure the events did not persist, so stop here. Attributed
	// to the server, not the offerer, because a timer withdrew it.
	if err := a.commit(events, engine.SourceServer); err != nil {
		a.noteCommitFailure("trade offer expiry", err)
		return
	}
}

// autoTimeoutDecision resolves the decision the idle player was sitting on
// with the minimal legal move (engine.AutoCommand): roll, discard, move the
// robber, place a setup piece, or end the turn. It does not play the rest of
// the turn; commit re-arms the timer, so the next decision gets a fresh budget.
func (a *Actor) autoTimeoutDecision(gen int) {
	if a.paused || a.state.Phase == engine.PhaseFinished {
		return
	}
	if a.suspended {
		return
	}
	if gen != a.timerGen {
		// Superseded while in flight: the deadlines it was armed for are gone.
		// Acting would auto-play a seat whose budget has not run out. See
		// timerGen.
		return
	}
	// As in execute/runAutoSeats, a panic from engine.AutoCommand/Decide
	// pauses the game rather than killing the loop.
	defer a.recoverToPause("auto-timeout decision", nil)
	// The timer fired for the earliest deadline, so only seats sharing it are
	// out of time: usually one, or every over-7 discarder or module picker
	// armed together. Snapshot that batch once, then drain it via AutoCommand
	// (which resolves the lowest pending seat each pass). Seats with a later
	// deadline keep their budget; commit re-arms for the next. The batch comes
	// from the deadlines, not clock.Now, because the test clock does not
	// advance on Fire().
	var earliest time.Time
	for _, st := range a.seatDeadlines {
		if earliest.IsZero() || st.deadline.Before(earliest) {
			earliest = st.deadline
		}
	}
	batch := make(map[engine.PlayerID]bool, len(a.seatDeadlines))
	for seat, st := range a.seatDeadlines {
		if !st.deadline.After(earliest) { // deadline <= earliest
			batch[seat] = true
		}
	}
	for len(batch) > 0 {
		cmd, ok := engine.AutoCommand(a.state)
		if !ok || !batch[cmd.Player] {
			// AutoCommand serves the engine's next obligation, which in a
			// simultaneous phase can belong to a seat whose clock has not run
			// out. Resolve the rest of the batch per seat instead, and drop the
			// deadline of any seat the engine will not serve so armTimer gives
			// it a fresh one. Leaving an expired deadline with no timer behind it
			// freezes the table.
			a.drainStaleBatch(batch)
			break
		}
		events, err := engine.Decide(a.state, cmd)
		if err != nil {
			slog.Error("auto command", "game", a.ID, "cmd", cmd.Type, "err", err)
			// The engine will not serve this seat; same handling as above.
			// drainStaleBatch retries it via AutoCommandFor first (which can
			// reach past a module that blocks without owing this seat), drops
			// the stale deadline, re-arms, and pauses the game after
			// maxEmptyDrains identical refusals.
			a.drainStaleBatch(batch)
			break
		}
		// Drop the resolved seat before commit re-arms so its slot is free.
		delete(a.seatDeadlines, cmd.Player)
		delete(batch, cmd.Player)
		// A discard made by the clock is recorded differently from one the
		// player made: AutoCommand spreads the cards round-robin across the
		// hand, which is not a choice.
		if err := a.commit(events, a.autoSourceFor(cmd.Player, true)); err != nil {
			a.noteCommitFailure("auto-timeout decision", err)
			return
		}
	}
	// If the next seat to act is a bot or auto seat, drive it; otherwise the
	// game would stall on the following bot turn.
	a.runAutoSeats()
}

// maxEmptyDrains bounds how many consecutive timeout drains may resolve
// nothing before the game is paused. A single empty drain is normal (a
// simultaneous phase can expire one seat while the engine owes another); the
// bound catches the case that repeats. At a 60-second timer that is three
// minutes.
const maxEmptyDrains = 3

// drainStaleBatch resolves the timed-out seats AutoCommand would not serve,
// one at a time via AutoCommandFor, and re-arms the clock. A seat the engine
// still refuses has its expired deadline dropped so armTimer gives it a fresh
// budget; an expired deadline with no timer behind it freezes the table.
func (a *Actor) drainStaleBatch(batch map[engine.PlayerID]bool) {
	seats := make([]engine.PlayerID, 0, len(batch))
	for seat := range batch {
		seats = append(seats, seat)
	}
	slices.Sort(seats)
	committed := false
	for _, seat := range seats {
		delete(batch, seat)
		cmd, ok := engine.AutoCommandFor(a.state, seat)
		if !ok {
			delete(a.seatDeadlines, seat) // stale: re-armed below
			continue
		}
		events, err := engine.Decide(a.state, cmd)
		if err != nil {
			slog.Error("auto command (stale batch)", "game", a.ID, "seat", seat, "cmd", cmd.Type, "err", err)
			delete(a.seatDeadlines, seat)
			continue
		}
		delete(a.seatDeadlines, seat)
		if err := a.commit(events, a.autoSourceFor(seat, true)); err != nil {
			a.noteCommitFailure("auto-timeout decision (stale batch)", err)
			return
		}
		committed = true
	}
	if committed {
		a.emptyDrains = 0
	} else {
		// Nothing resolved and nothing logged. Re-arming is right for a
		// transient refusal, but a permanent one would loop forever with the
		// clock restarting (for example a seat count the board cannot fit
		// during setup, which board.ValidateSeats now rejects). After
		// maxEmptyDrains the game is paused: the log is kept for reproduction
		// and cmd/costan-recover can force-finish or abandon it.
		a.emptyDrains++
		if a.emptyDrains >= maxEmptyDrains {
			a.pause(fmt.Sprintf("no seat could be auto-resolved in %d consecutive timeout drains; the engine refuses every timed-out seat and no events are being appended", a.emptyDrains))
			return
		}
		// commit would have re-armed; nothing committed, so do it here.
		a.armTimer()
	}
}

// boardPrimer is implemented by command sources (bots) that want the fixed
// board once when installed, to precompute board-derived data. Primed at the
// only two bot-creation points: load and a forfeit takeover (BotifySeat).
type boardPrimer interface {
	Prime(b *board.Board)
}

// SetSeatBot installs a bot as the seat's command source (and marks the seat
// auto so it acts whenever the game waits on it). A nil source removes the
// bot.
func (a *Actor) SetSeatBot(seat engine.PlayerID, src CommandSource) {
	_ = a.call(func() {
		if src == nil {
			delete(a.botSeats, seat)
			delete(a.autoSeats, seat)
			a.noteControl(seat)
			return
		}
		if p, ok := src.(boardPrimer); ok {
			p.Prime(a.state.Board)
		}
		a.botSeats[seat] = src
		a.autoSeats[seat] = true
		a.noteControl(seat)
		a.runAutoSeats()
	})
}

// Suspend freezes the game: no bot/auto moves and no timeout auto-plays until
// Resume. Used while no human is connected (server presence reconciliation).
func (a *Actor) Suspend() {
	_ = a.call(func() {
		if a.suspended {
			return // already frozen; don't overwrite the captured remaining times
		}
		a.suspended = true
		// Capture each on-clock seat's remaining budget so Resume restores the
		// time actually left. The absolute deadlines are dropped: wall-clock
		// time keeps passing while suspended, so they would fire instantly.
		now := a.clock.Now()
		if len(a.seatDeadlines) > 0 {
			rem := make(map[engine.PlayerID]remainingBudget, len(a.seatDeadlines))
			for seat, st := range a.seatDeadlines {
				left := max(st.deadline.Sub(now), 0)
				rem[seat] = remainingBudget{remaining: left, kind: st.kind, decisions: st.decisions}
			}
			a.suspendedRemaining = rem
		}
		a.clearSeatDeadlines()
		if a.offerTimer != nil {
			a.offerTimer.Stop()
		}
		if a.drawTimer != nil {
			a.drawTimer.Stop()
		}
	})
}

// Resume lifts a suspension: re-arm the turn timer and nudge any owed bot/auto
// seat back into play.
func (a *Actor) Resume() {
	_ = a.call(func() {
		if !a.suspended {
			return
		}
		a.suspended = false
		a.armTimer() // consumes suspendedRemaining to restore each seat's leftover time
		a.suspendedRemaining = nil
		// Suspend stopped a.offerTimer without saving its remaining time, so
		// re-arm an open offer with a fresh lifetime (as maintainOfferTimer
		// does); otherwise it would never auto-cancel.
		if a.state.ActiveOffer != nil {
			life := a.offerLifetime()
			a.offerDeadline = a.clock.Now().Add(life)
			d := life + turnTimerBuffer
			if a.offerTimer == nil {
				a.offerTimer = a.clock.AfterFunc(d, a.onOfferTimer)
			} else {
				a.offerTimer.Stop()
				a.offerTimer.Reset(d)
			}
		}
		if a.state.DrawOffer != nil {
			a.armDrawTimer() // same reasoning as the trade offer above
		}
		a.scheduleTick(0)
	})
}

// MarkAbsent starts the disconnect grace window for a seat: after a full round
// of turns elapses with the seat still absent, escalateAbsent hands it to a bot.
// No-op if the seat is already a bot or already in its grace window.
func (a *Actor) MarkAbsent(seat engine.PlayerID) {
	_ = a.call(func() {
		if _, isBot := a.botSeats[seat]; isBot {
			return
		}
		if _, already := a.absentSince[seat]; already {
			return
		}
		a.absentSince[seat] = a.turnsCompleted
	})
}

// MarkPresent ends a seat's absence (the player reconnected). If the seat had
// escalated to a bot, control returns to the human. A recorded forfeit is not
// undone; it lives in the store.
func (a *Actor) MarkPresent(seat engine.PlayerID) {
	_ = a.call(func() {
		delete(a.absentSince, seat)
		// Back in the chair, and speaking for themselves again.
		delete(a.walkedAway, seat)
		if _, isBot := a.botSeats[seat]; isBot {
			delete(a.botSeats, seat)
			delete(a.autoSeats, seat)
		} else {
			delete(a.autoSeats, seat)
		}
		// Retaking a seat produces no event, so record the control change
		// here; otherwise the log would suggest the bot finished the game.
		a.noteControl(seat)
	})
}

// abandonLaps is how many full laps a player must miss before the table stops
// waiting on their consent. One lap hands the seat to a bot ("play around
// them"); four means they are not coming back. Keeping consent for the first
// three stops opponents drawing a game away from someone briefly
// disconnected, and releasing it stops one absent player blocking a draw
// forever.
const abandonLaps = 4

// escalateAbsent hands any seat absent for a full round to a bot, and after
// abandonLaps gives up on its player returning. The forfeit is recorded on the
// bot's first committed move (runAutoSeats), not here. Called after each
// committed batch, when turnsCompleted includes the turns just played.
func (a *Actor) escalateAbsent() {
	if len(a.absentSince) == 0 {
		return
	}
	round := a.state.Config.Players // a full lap of the table, bots included
	if round <= 0 {
		return
	}
	for seat, since := range a.absentSince {
		gone := a.turnsCompleted - since
		if gone < round {
			continue
		}
		// Installed once: this seat stays in absentSince until it is abandoned
		// or its player returns, so the bot must not be rebuilt every batch.
		if !a.autoSeats[seat] {
			if a.bots != nil {
				a.botSeats[seat] = a.bots(seat)
			}
			a.autoSeats[seat] = true
			a.noteControl(seat)
		}
		if gone >= round*abandonLaps {
			// Gone, not merely quiet: the seat may now consent on their
			// behalf, like a player who chose to leave. See consentless.
			a.walkedAway[seat] = true
			delete(a.absentSince, seat)
		}
	}
}

// runAutoSeats acts for seats in auto or bot mode until a human is up. It
// processes a bounded batch, then, if a bot/auto seat is still owed and the
// game is not over, reschedules itself via the tick channel so an all-bot
// game progresses without starving other actor work.
func (a *Actor) runAutoSeats() {
	if a.paused || a.suspended {
		return
	}
	// engine.AutoCommand, engine.Decide and bot sources can panic on an
	// invariant violation; pause rather than kill the loop goroutine.
	defer a.recoverToPause("auto/bot seat play", nil)
	const batch = 64
	acted := false
	for range batch {
		if a.state.Phase == engine.PhaseFinished {
			return
		}
		// Let the table answer a standing offer before the offerer plays on.
		// With unpaced bots this batch runs the offerer's whole turn without
		// yielding, so the offer would be replaced or die before the tick that
		// drives responses arrives (sim, COSTAN_BOT_DELAY=0). With a delay the
		// tick is serviced between actions, and answering here would fire every
		// response at once instead of staggering them.
		if a.botDelay == 0 && a.runOfferResponses() {
			acted = true
			continue
		}
		// Try every owed auto seat, not just the lowest: during a simultaneous
		// phase two modules can owe two seats, and the lowest may not be
		// servable (e.g. a barbarian defender draw owed to one seat while
		// another owes a gold pick).
		progressed := false
		for _, actor := range a.autoSeatsOwed() {
			switch a.tryAutoSeat(actor) {
			case autoSeatStop:
				return
			case autoSeatActed:
				progressed, acted = true, true
			case autoSeatSkip:
				continue
			}
			break
		}
		if !progressed {
			// Nothing owed, or nothing servable; another pass would repeat.
			break
		}
	}
	// Batch exhausted but a bot/auto seat is still up: continue next tick.
	// Only when something acted, so an unservable seat does not busy-loop.
	if acted && a.state.Phase != engine.PhaseFinished {
		if _, owes := a.nextAutoSeat(); owes {
			a.scheduleTick(0)
		}
	}
}

// autoSeatOutcome is what one pass of tryAutoSeat achieved: it committed a move,
// it could not serve this seat (try the next owed one), or the whole auto loop
// must stop (a bot's pacing delay is armed, a human is up, or a commit failed).
type autoSeatOutcome int

const (
	autoSeatActed autoSeatOutcome = iota
	autoSeatSkip
	autoSeatStop
)

// tryAutoSeat resolves one owed bot/auto seat. See autoSeatOutcome.
func (a *Actor) tryAutoSeat(actor engine.PlayerID) autoSeatOutcome {
	src, isBot := a.botSeats[actor]
	// Pace bot seats: wait before the bot acts so a watching human sees it
	// think. Arm a delay and return; only the release tick (which sets
	// botReleasing) lets one action through before the next re-arms.
	// Auto-pass for a disconnected human is never paced.
	consumed := false
	if a.botDelay > 0 && isBot {
		if !a.botReleasing {
			if !a.botArmed {
				a.botArmed = true
				a.scheduleRelease(a.botDelay)
			}
			return autoSeatStop
		}
		a.botReleasing = false // consume this release; re-arm for the next
		consumed = true
	}
	// Give back a release consumed by an unservable seat, or the same stuck
	// seat eats every release and no other seat gets one.
	skip := func() autoSeatOutcome {
		if consumed {
			a.botReleasing = true
		}
		return autoSeatSkip
	}
	var cmd engine.Command
	ok := false
	botCmd := false
	if isBot {
		cmd, ok = src.Act(a.state, actor)
		// Ending the game is never a bot's move. runOfferResponses whitelists
		// command types; this path otherwise forwards whatever the source
		// returns, so fall back to the minimal legal move.
		if ok && concedeCommand(cmd.Type) {
			ok = false
		}
		botCmd = ok
	}
	if !ok {
		// Resolve this seat's obligation, not the engine's lowest owed one: a
		// lower-seated human may owe the same decision, and a bot must never
		// wait on or act for a human.
		cmd, ok = engine.AutoCommandFor(a.state, actor)
	}
	if !ok {
		return skip()
	}
	// The chosen command must belong to an auto/bot seat; if a human is
	// actually up, stop.
	if !a.autoSeats[cmd.Player] {
		if consumed {
			a.botReleasing = true
		}
		return autoSeatStop
	}
	events, err := engine.Decide(a.state, cmd)
	if err != nil && botCmd {
		// Bots may misjudge; fall back to the minimal legal move so the
		// game never stalls on a buggy bot.
		slog.Warn("bot move rejected, falling back to auto", "game", a.ID, "seat", cmd.Player, "cmd", cmd.Type, "err", err)
		cmd, ok = engine.AutoCommandFor(a.state, actor)
		if !ok {
			return skip()
		}
		events, err = engine.Decide(a.state, cmd)
		botCmd = false // the bot's move was rejected; this one is the fallback
	}
	if err != nil {
		slog.Error("auto seat move", "game", a.ID, "seat", cmd.Player, "cmd", cmd.Type, "err", err)
		return skip()
	}
	// A move the bot chose is credited to the bot. A rejected bot move, or a
	// seat with no bot, gets SourceAuto: the fallback is the server's choice.
	prov := engine.SourceAuto
	if botCmd {
		prov = a.autoSourceFor(cmd.Player, false)
	}
	if err := a.commit(events, prov); err != nil {
		a.noteCommitFailure("auto seat move", err)
		if consumed {
			a.botReleasing = true
		}
		return autoSeatStop
	}
	// A bot moving for a human-owned seat forfeits it (ranking exclusion),
	// once. Original bots are not in humanSeats and never forfeit.
	if a.humanSeats[cmd.Player] && !a.forfeited[cmd.Player] {
		a.forfeited[cmd.Player] = true
		if a.onForfeit != nil {
			a.onForfeit(cmd.Player)
		}
	}
	return autoSeatActed
}

// scheduleTick nudges runAutoSeats to run again, optionally after a delay. A
// zero delay queues the tick immediately; a positive delay defers it on the
// clock (used to pace bot seats). The send is non-blocking: the buffered tick
// channel coalesces, so a pending tick is never duplicated.
func (a *Actor) scheduleTick(d time.Duration) {
	push := func() {
		select {
		case a.tick <- struct{}{}:
		default: // a tick is already pending
		}
	}
	if d <= 0 {
		push()
		return
	}
	a.clock.AfterFunc(d, push)
}

// scheduleRelease defers a bot's permission to act by d (its pacing delay). When
// it fires, the loop's release case lets exactly one bot action through. The
// send is non-blocking and the buffered release channel coalesces, so redundant
// timers (guarded anyway by botArmed) collapse to a single pending release.
func (a *Actor) scheduleRelease(d time.Duration) {
	a.clock.AfterFunc(d, func() {
		select {
		case a.release <- struct{}{}:
		default: // a release is already pending
		}
	})
}

// nextToAct returns the lowest-seated player the game is waiting on: the
// active player on a normal turn, or the lowest seat still owing an action in
// a simultaneous phase (over-7 discards, module picks). owes is false only
// when nothing is owed. It defers to engine.PendingDeciders so it agrees with
// the timer layer.
func nextToAct(s *engine.State) (engine.PlayerID, bool) {
	ds := engine.PendingDeciders(s)
	if len(ds) == 0 {
		return engine.NoPlayer, false
	}
	return ds[0].Seat, true
}

// nextAutoSeat returns the lowest-seated bot/auto seat that currently owes an
// action, or false if none does. Unlike nextToAct it skips owed human seats:
// simultaneous-phase actions are order-independent, so a bot must not wait
// behind a lower-seated human. Release pacing in runAutoSeats still
// serializes bots one action at a time.
func (a *Actor) nextAutoSeat() (engine.PlayerID, bool) {
	if owed := a.autoSeatsOwed(); len(owed) > 0 {
		return owed[0], true
	}
	return engine.NoPlayer, false
}

// autoSeatsOwed lists every bot/auto seat that currently owes an action,
// lowest first. runAutoSeats walks all of them because the lowest owed seat is
// not always servable.
func (a *Actor) autoSeatsOwed() []engine.PlayerID {
	var out []engine.PlayerID
	for _, d := range engine.PendingDeciders(a.state) {
		if a.autoSeats[d.Seat] {
			out = append(out, d.Seat)
		}
	}
	return out
}
