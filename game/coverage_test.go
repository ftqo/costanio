package game

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/store"
)

// botSeatCount returns how many seats currently have a bot command source.
func botSeatCount(a *Actor) int {
	var n int
	a.call(func() { n = len(a.botSeats) })
	return n
}

func seatIsAuto(a *Actor, seat engine.PlayerID) bool {
	var b bool
	a.call(func() { _, b = a.autoSeats[seat] })
	return b
}

func actorSuspended(a *Actor) bool {
	var b bool
	a.call(func() { b = a.suspended })
	return b
}

func absentTracked(a *Actor, seat engine.PlayerID) (int, bool) {
	var n int
	var ok bool
	a.call(func() { n, ok = a.absentSince[seat] })
	return n, ok
}

// TestManagerStartSpawnsActor exercises Manager.Start: it writes the initial
// engine events, flips the row to active, and returns a live, queryable actor.
func TestManagerStartSpawnsActor(t *testing.T) {
	st := openStore(t)
	host, _ := st.CreateGuest("host")
	cfg := engine.GameConfig{Players: 3}
	cfgJSON, _ := json.Marshal(cfg)
	if err := st.CreateGame(&store.Game{ID: "g1", Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		u, _ := st.CreateGuest("p")
		if err := st.AddSeat("g1", i, u.ID); err != nil {
			t.Fatal(err)
		}
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	if err := m.Start("g1", cfg, engine.SeedsFrom(42)); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !m.running("g1") {
		t.Fatal("Start did not register a running actor")
	}
	g, err := st.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != "active" {
		t.Errorf("status = %q, want active", g.Status)
	}
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	if v := a.View(Spectator); v == nil || v.Phase != engine.PhaseSetup {
		t.Fatalf("started game view = %+v", v)
	}
	// Persisted events match a fresh engine.New for the same seed.
	want, _ := engine.New(cfg, engine.SeedsFrom(42))
	events, _ := st.LoadEvents("g1", 0)
	if len(events) != len(want) {
		t.Errorf("persisted %d events, want %d", len(events), len(want))
	}
}

// TestManagerStartRejectsBadConfig: an invalid config fails before any row is
// touched (engine.New returns an error).
func TestManagerStartRejectsBadConfig(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	// Zero players is not a buildable game.
	if err := m.Start("bad", engine.GameConfig{Players: 0}, engine.SeedsFrom(1)); err == nil {
		t.Fatal("expected Start to reject a zero-player config")
	}
	if m.running("bad") {
		t.Error("a rejected Start must not leave a running actor")
	}
}

// TestNewManagerDefaultsClock: a nil clock falls back to the real clock without
// panicking, and the manager is usable.
func TestNewManagerDefaultsClock(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, nil)
	defer m.StopAll()
	if m.clock == nil {
		t.Fatal("NewManager left a nil clock")
	}
}

// TestGetRejectsNonActiveGame: load() refuses a game whose store status isn't
// "active", surfacing ErrGameNotRunning.
func TestGetRejectsNonActiveGame(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	if err := st.SetGameStatus("g1", "finished"); err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	if _, err := m.Get("g1"); err == nil {
		t.Fatal("expected Get to refuse a non-active game")
	}
}

// TestGetMissingGame: a game id with no row returns an error, not a nil actor
// silently registered.
func TestGetMissingGame(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	if _, err := m.Get("nope"); err == nil {
		t.Fatal("expected Get of a missing game to error")
	}
	if m.running("nope") {
		t.Error("a failed Get must not register the game")
	}
}

// TestBotifySeatWithFactory: with a bot factory configured, BotifySeat
// installs a bot command source on the seat and drives it.
func TestBotifySeatWithFactory(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	seq0 := actorState(a).NextSeq
	if err := m.BotifySeat("g1", 0); err != nil {
		t.Fatal(err)
	}
	if !seatIsBot(a, 0) {
		t.Fatal("BotifySeat with a factory did not install a bot source")
	}
	// Seat 0 is up at game start, so the bot should advance the game.
	if next, ok := pollSeqGrows(a, seq0); !ok {
		t.Fatalf("bot seat did not advance game (seq stuck at %d)", next)
	}
}

// TestLeaveSeatFallsBackToAutoPass: with no bot factory, LeaveSeat marks the
// seat auto-pass so the game still progresses.
func TestLeaveSeatFallsBackToAutoPass(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.LeaveSeat("g1", 0); err != nil {
		t.Fatal(err)
	}
	if seatIsBot(a, 0) {
		t.Error("LeaveSeat installed a bot despite no factory")
	}
	// Auto-pass for the up seat advances play past it.
	if s := actorState(a); s.Cur == 0 && s.Phase == engine.PhaseSetup {
		t.Error("auto-pass seat did not advance the game")
	}
}

// TestBotifySeatMissingGame: a game id that can't be loaded propagates the
// error rather than panicking.
func TestBotifySeatMissingGame(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	if err := m.BotifySeat("nope", 0); err == nil {
		t.Error("expected BotifySeat of a missing game to error")
	}
}

// TestSuspendResumeViaManager: the manager wrappers freeze and unfreeze the
// running actor.
func TestSuspendResumeViaManager(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	m.SuspendGame("g1")
	if !actorSuspended(a) {
		t.Fatal("SuspendGame did not suspend the actor")
	}
	m.ResumeGame("g1")
	if actorSuspended(a) {
		t.Fatal("ResumeGame did not lift the suspension")
	}
	// No-op on a game that can't load: must not panic.
	m.SuspendGame("nope")
	m.ResumeGame("nope")
}

// TestMarkSeatAbsentPresentViaManager: the manager wrappers start and clear a
// seat's disconnect grace window on the live actor.
func TestMarkSeatAbsentPresentViaManager(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	m.MarkSeatAbsent("g1", 1)
	if _, tracked := absentTracked(a, 1); !tracked {
		t.Fatal("MarkSeatAbsent did not start the grace window")
	}
	m.MarkSeatPresent("g1", 1)
	if _, tracked := absentTracked(a, 1); tracked {
		t.Fatal("MarkSeatPresent did not clear the grace window")
	}
	// No-ops on an unloadable game: must not panic.
	m.MarkSeatAbsent("nope", 0)
	m.MarkSeatPresent("nope", 0)
}

// TestMarkAbsentNoOpForBotSeat: a seat already controlled by a bot is never
// tracked as absent (it can't disconnect).
func TestMarkAbsentNoOpForBotSeat(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	a.SetSeatBot(1, autoBot{})
	a.MarkAbsent(1)
	if _, tracked := absentTracked(a, 1); tracked {
		t.Error("a bot-controlled seat should not enter the absence grace window")
	}
}

// TestMarkAbsentIdempotent: a second MarkAbsent before any turns pass keeps the
// original turnsCompleted baseline (the grace window isn't restarted).
func TestMarkAbsentIdempotent(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	a.MarkAbsent(1)
	first, _ := absentTracked(a, 1)
	a.call(func() { a.turnsCompleted += 5 })
	a.MarkAbsent(1) // already absent: must not reset the baseline
	second, _ := absentTracked(a, 1)
	if first != second {
		t.Errorf("MarkAbsent reset the grace baseline: %d -> %d", first, second)
	}
}

// TestResumeNoOpWhenNotSuspended: Resume on a running (un-suspended) actor is a
// no-op and does not panic or wedge the loop.
func TestResumeNoOpWhenNotSuspended(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	if actorSuspended(a) {
		t.Fatal("freshly loaded actor should not be suspended")
	}
	a.Resume() // no-op
	if v := a.View(Spectator); v == nil {
		t.Fatal("actor unresponsive after a no-op Resume")
	}
}

// TestEventsSinceRedactsForViewer: EventsSince returns persisted events from a
// gap, redacted to the viewer (game_created's seeds are stripped for a
// spectator).
func TestEventsSinceRedactsForViewer(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	events, err := a.EventsSince(Spectator, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) == 0 {
		t.Fatal("EventsSince returned no events")
	}
	// The first event is game_created; its seed must be redacted for a spectator.
	var found bool
	for _, e := range events {
		if e.Type == engine.EvGameCreated {
			found = true
			var raw map[string]any
			json.Unmarshal(e.Data, &raw)
			if _, leaked := raw["seed"]; leaked {
				t.Errorf("EventsSince leaked the seed to a spectator: %s", e.Data)
			}
		}
	}
	if !found {
		t.Fatal("game_created not present in the event tail")
	}

	// since past the tail returns an empty (non-nil-error) slice.
	tail, err := a.EventsSince(Spectator, 1<<30)
	if err != nil {
		t.Fatal(err)
	}
	if len(tail) != 0 {
		t.Errorf("EventsSince past the tail = %d events, want 0", len(tail))
	}
}

// TestSubscribeAfterStopReturnsNilView: subscribing to a stopped actor yields a
// closed channel and a nil view (the loop is gone, so viewFor never runs).
func TestSubscribeAfterStopReturnsNilView(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	a.Stop()

	sub, view := a.Subscribe(0)
	if view != nil {
		t.Errorf("Subscribe on a stopped actor returned a view: %+v", view)
	}
	if _, _, _, ok := sub.Next(); ok {
		t.Error("Subscribe on a stopped actor returned a live stream")
	}
}

// TestRedactDevCardBoughtHidesCard: the dev_card_bought event reveals the buyer
// but hides which card to everyone else.
func TestRedactDevCardBoughtHidesCard(t *testing.T) {
	data, _ := json.Marshal(engine.DevCardBoughtData{Player: 0, Card: engine.DevKnight})
	e := engine.Event{Seq: 7, Type: engine.EvDevCardBought, Data: data, Visible: []engine.PlayerID{0}}

	// The buyer sees the full payload.
	if got := RedactEvent(e, 0); string(got.Data) != string(data) {
		t.Errorf("buyer should see the card, got %s", got.Data)
	}
	// Others see only the buyer, not the card.
	for _, viewer := range []engine.PlayerID{1, Spectator} {
		got := RedactEvent(e, viewer)
		var raw map[string]any
		json.Unmarshal(got.Data, &raw)
		if _, leaked := raw["card"]; leaked {
			t.Errorf("viewer %d sees the bought card: %s", viewer, got.Data)
		}
		if raw["player"] != float64(0) {
			t.Errorf("buyer should stay public for viewer %d: %s", viewer, got.Data)
		}
	}
}

// TestRedactUnknownHiddenEventRevealsOnlyType: a hidden event with no
// type-specific case and no registered redactor is reduced to an empty payload
// for non-visible viewers (only its type leaks).
func TestRedactUnknownHiddenEventRevealsOnlyType(t *testing.T) {
	e := engine.Event{
		Seq:     3,
		Type:    engine.EventType("mystery_hidden_event"),
		Data:    []byte(`{"secret":42}`),
		Visible: []engine.PlayerID{0},
	}
	// The listed viewer sees everything.
	if got := RedactEvent(e, 0); string(got.Data) != string(e.Data) {
		t.Errorf("visible viewer should see full payload, got %s", got.Data)
	}
	// Everyone else gets an empty object.
	got := RedactEvent(e, Spectator)
	if string(got.Data) != `{}` {
		t.Errorf("unknown hidden event leaked to spectator: %s", got.Data)
	}
	if got.Type != e.Type {
		t.Errorf("event type should be preserved: %s", got.Type)
	}
}

// TestRecordForfeitPersists: the manager's forfeit recorder maps a seat to its
// user and writes a forfeit row read back by Forfeited.
func TestRecordForfeitPersists(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	seats, _ := st.Seats("g1")
	var seat2User int64
	for _, s := range seats {
		if s.No == 2 {
			seat2User = s.UserID
		}
	}
	m.recordForfeit("g1", 2)
	ff, err := st.Forfeited("g1", seat2User)
	if err != nil {
		t.Fatal(err)
	}
	if !ff {
		t.Error("recordForfeit did not persist a forfeit for seat 2's user")
	}
	// A seat number with no matching store seat is a silent no-op (no panic).
	m.recordForfeit("g1", 99)
}

// TestRecordForfeitStoreError: a Seats() failure (closed DB) is logged and
// swallowed; recordForfeit must not panic.
func TestRecordForfeitStoreError(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	st.Close()
	m.recordForfeit("g1", 0) // logs "load seats" error, returns cleanly
}

// TestFinishStoreError: a Seats() failure (closed DB) inside finish is logged
// and swallowed without panicking.
func TestFinishStoreError(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	st.Close()
	m.finish("g1", 0) // logs "load seats" error, returns cleanly
}

// seedGameWithLog writes a game row, seats, and an explicit event log to the
// store so BuildScoreboard has events to replay. Returns the seeded seat slice.
func seedGameWithLog(t *testing.T, st *store.Store, id string, events []engine.Event) []*store.Seat {
	t.Helper()
	// Derive player count from the game_created event config.
	var nPlayers int
	for _, e := range events {
		if e.Type == engine.EvGameCreated {
			var d engine.GameCreatedData
			if err := json.Unmarshal(e.Data, &d); err == nil {
				nPlayers = d.Config.Players
			}
			break
		}
	}
	if nPlayers == 0 {
		t.Fatal("seedGameWithLog: no game_created event or zero players")
	}
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(engine.GameConfig{Players: nPlayers})
	if err := st.CreateGame(&store.Game{ID: id, Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		t.Fatalf("CreateGame: %v", err)
	}
	if err := st.AddSeat(id, 0, host.ID); err != nil {
		t.Fatalf("AddSeat 0: %v", err)
	}
	for i := 1; i < nPlayers; i++ {
		u, _ := st.CreateGuest("p")
		if err := st.AddSeat(id, i, u.ID); err != nil {
			t.Fatalf("AddSeat %d: %v", i, err)
		}
	}
	if err := st.AppendEvents(id, events); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}
	if err := st.SetGameStatus(id, "active"); err != nil {
		t.Fatalf("SetGameStatus: %v", err)
	}
	seats, err := st.Seats(id)
	if err != nil {
		t.Fatalf("Seats: %v", err)
	}
	return seats
}

// TestApplyRatingsMovesWinnerAboveLoser: after applyRatings the winner's
// display rating is strictly above the last-place player's, and their Mu
// values differ (ApplyGameRatings ran).
func TestApplyRatingsMovesWinnerAboveLoser(t *testing.T) {
	st := openStore(t)
	// twoPlayerLog gives a finished 2-player game where seat 0 wins.
	seats := seedGameWithLog(t, st, "g1", twoPlayerLog())
	if len(seats) != 2 {
		t.Fatalf("want 2 seats, got %d", len(seats))
	}
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	winner := seats[0].UserID // seat 0 wins in twoPlayerLog
	loser := seats[1].UserID

	if err := m.applyRatings("g1", "base", seats, winner, map[int64]bool{}); err != nil {
		t.Fatal(err)
	}

	wr, err := st.RatingRow(winner, "base")
	if err != nil {
		t.Fatal(err)
	}
	lr, err := st.RatingRow(loser, "base")
	if err != nil {
		t.Fatal(err)
	}
	if wr.Display <= lr.Display {
		t.Errorf("winner display %d not above loser display %d", wr.Display, lr.Display)
	}
	// Mu must differ: ApplyGameRatings changes Mu per rank.
	if wr.Mu == lr.Mu {
		t.Errorf("winner Mu (%.4f) == loser Mu (%.4f)",
			wr.Mu, lr.Mu)
	}
}

// TestApplyRatingsSkipsSoloGame: a single-seat slice is a no-op (no opponent
// to score against).
func TestApplyRatingsSkipsSoloGame(t *testing.T) {
	st := openStore(t)
	seats := seedGameWithLog(t, st, "g1", twoPlayerLog())
	if len(seats) < 1 {
		t.Fatal("want at least 1 seat")
	}
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	solo := seats[:1]
	before, err := st.RatingRow(solo[0].UserID, "base")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.applyRatings("g1", "base", solo, solo[0].UserID, map[int64]bool{}); err != nil {
		t.Fatal(err)
	}
	after, err := st.RatingRow(solo[0].UserID, "base")
	if err != nil {
		t.Fatal(err)
	}
	if before.Display != after.Display || before.Mu != after.Mu {
		t.Errorf("solo game changed rating: display %d->%d, mu %.4f->%.4f",
			before.Display, after.Display, before.Mu, after.Mu)
	}
}

// TestReleaseUnknownGameNoOp: Release of a game with no live actor is a safe
// no-op.
func TestReleaseUnknownGameNoOp(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.Release("nope") // must not panic
	if m.running("nope") {
		t.Error("Release somehow registered the game")
	}
}

// TestStaleSnapshotFallsBackToReplay: a snapshot with the wrong version byte is
// discarded and rebuild replays the full event log, producing the same state.
func TestStaleSnapshotFallsBackToReplay(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})

	// Write a snapshot with a bad version byte at a fake seq; rebuild must ignore
	// it and replay from scratch.
	if err := st.SaveSnapshot("g1", 1, []byte{0xFF, 0x00, 0x01, 0x02}); err != nil {
		t.Fatal(err)
	}
	state, err := rebuild("g1", st)
	if err != nil {
		t.Fatalf("rebuild over a stale snapshot: %v", err)
	}
	// Full replay from the event log yields the same NextSeq as a direct replay.
	want := mirrorState(t, st, "g1")
	if state.NextSeq != want.NextSeq {
		t.Errorf("stale-snapshot rebuild NextSeq = %d, want %d (full replay)", state.NextSeq, want.NextSeq)
	}
}

// TestRebuildNoEventsErrors: rebuilding a game id with no persisted events is an
// error (nothing to load).
func TestRebuildNoEventsErrors(t *testing.T) {
	st := openStore(t)
	if _, err := rebuild("ghost", st); err == nil {
		t.Fatal("expected rebuild of an event-less game to error")
	}
}

// cancelPanicSource panics when asked to act, driving a panic through the
// auto path.
type cancelPanicSource struct{}

func (cancelPanicSource) Act(*engine.State, engine.PlayerID) (engine.Command, bool) {
	panic("boom from offer source")
}

// TestExpireOfferNoOpWithoutOffer: expireOffer is a no-op when no offer stands
// (timer fired after the offer was already cleared).
func TestExpireOfferNoOpWithoutOffer(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	// No active offer: expireOffer must do nothing and not pause the game.
	a.call(func() { a.expireOffer() })
	if v := a.View(Spectator); v == nil {
		t.Fatal("actor unresponsive after a no-op expireOffer")
	}
}

// TestSuspendStopsOfferTimer: Suspend stops the standing offer timer in addition
// to the turn timer, freezing offer expiry while no human is connected.
func TestSuspendStopsOfferTimer(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	// Drive to an offerable state and post an offer (mirrors TestOfferAutoExpires).
	mirror := mirrorState(t, st, "g1")
	var offer engine.Command
	found := false
	for i := 0; i < 5000 && !found; i++ {
		if mirror.Phase == engine.PhasePlay && mirror.Rolled && !mirror.RobberPending && len(mirror.PendingDiscards) == 0 {
			hand := mirror.Players[mirror.Cur].Hand
			gi := -1
			for r := 1; r <= 5; r++ {
				if hand[r] > 0 {
					gi = r
					break
				}
			}
			if gi != -1 {
				var give, want engine.Hand
				give[gi] = 1
				want[gi%5+1] = 1
				data, _ := json.Marshal(engine.TradeOfferedData{Give: give, Want: want})
				offer = engine.Command{Player: mirror.Cur, Type: engine.CmdOfferTrade, Data: data}
				found = true
				break
			}
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		evs, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror decide %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor.Do(%s): %v", cmd.Type, err)
		}
	}
	if !found {
		t.Fatal("game never reached a state where a trade could be offered")
	}
	if err := a.Do(offer); err != nil {
		t.Fatalf("offer_trade: %v", err)
	}
	if actorState(a).ActiveOffer == nil {
		t.Fatal("offer was not registered")
	}

	// Suspend, then fire the clock: the offer timer was stopped so the offer must
	// survive the expiry that would otherwise fire.
	a.Suspend()
	clock.Fire()
	if actorState(a).ActiveOffer == nil {
		t.Error("offer expired despite the game being suspended (timer not stopped)")
	}
}

// TestPanickingTimeoutPausesGame: a panic in the auto path pauses the game
// rather than killing the loop.
func TestPanickingTimeoutPausesGame(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 30})
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	// A poisoned state is hard to build and autoTimeoutDecision's
	// engine.AutoCommand is safe, so force the panic through runAutoSeats via
	// a panicking bot.
	a.SetSeatBot(0, cancelPanicSource{}) // marks seat auto + triggers runAutoSeats panic

	// The game must be paused but alive: View returns non-nil, Do reports
	// ErrPaused.
	if v := a.View(Spectator); v == nil {
		t.Fatal("actor died after panic in auto path")
	}
	if err := a.Do(engine.Command{Player: 1, Type: engine.CmdRollDice}); !errors.Is(err, ErrPaused) {
		t.Fatalf("expected ErrPaused after panic, got %v", err)
	}
}

// TestPauseNotifiesSubscribers: pausing flips the store row to paused-error
// and pushes a PausedEvent to live subscribers.
func TestPauseNotifiesSubscribers(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	sub, _ := a.Subscribe(0)
	defer sub.Close()

	a.SetSeatBot(0, cancelPanicSource{}) // panics → pause

	// The subscriber receives a PausedEvent frame off the shared ring. Read the
	// frame in a goroutine (Next blocks) and decode its embedded event type.
	type res struct {
		typ engine.EventType
		ok  bool
	}
	ch := make(chan res, 1)
	go func() {
		raw, _, _, ok := sub.Next()
		if !ok {
			ch <- res{ok: false}
			return
		}
		var f EvFrame
		json.Unmarshal(raw, &f)
		ch <- res{typ: f.Ev.Type, ok: true}
	}()
	select {
	case r := <-ch:
		if !r.ok {
			t.Fatal("stream closed instead of delivering a paused frame")
		}
		if r.typ != PausedEvent {
			t.Errorf("first event after pause = %s, want %s", r.typ, PausedEvent)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("paused game did not notify the subscriber")
	}

	// The store row reflects the paused status.
	g, err := st.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != "paused-error" {
		t.Errorf("store status = %q, want paused-error", g.Status)
	}
}

// TestUnsubscribeIdempotent: closing a subscription twice is a safe no-op.
func TestUnsubscribeIdempotent(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	sub, _ := a.Subscribe(0)
	sub.Close()
	sub.Close() // second close must not panic (reader already stopped/removed)

	// Actor still responsive.
	if v := a.View(Spectator); v == nil {
		t.Fatal("actor unresponsive after double unsubscribe")
	}
}

// TestSetSeatBotNilRemovesBot: installing then removing a bot source clears both
// the bot and auto markers for the seat.
func TestSetSeatBotNilRemovesBot(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	a.SetSeatBot(1, autoBot{})
	if !seatIsBot(a, 1) || !seatIsAuto(a, 1) {
		t.Fatal("SetSeatBot did not install bot+auto markers")
	}
	a.SetSeatBot(1, nil)
	if seatIsBot(a, 1) || seatIsAuto(a, 1) {
		t.Error("SetSeatBot(nil) did not clear the bot+auto markers")
	}
	if n := botSeatCount(a); n != 0 {
		t.Errorf("bot seat count = %d after removal, want 0", n)
	}
}

// boardPrimerBot records whether Prime was called, verifying SetSeatBot primes
// board-aware sources at install.
type boardPrimerBot struct{ primed *bool }

func (b boardPrimerBot) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	return autoBot{}.Act(s, seat)
}
func (b boardPrimerBot) Prime(*board.Board) { *b.primed = true }

// TestBuildScoreboardLoadsFromStore: the public BuildScoreboard wrapper loads a
// game's event log from the store and produces a per-seat summary.
func TestBuildScoreboardLoadsFromStore(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})

	sb, err := BuildScoreboard(st, "g1")
	if err != nil {
		t.Fatalf("BuildScoreboard: %v", err)
	}
	if sb == nil || len(sb.Players) != 3 {
		t.Fatalf("scoreboard = %+v, want 3 player lines", sb)
	}
	// A missing game has no events: BuildScoreboard surfaces an error or an empty
	// board, never a panic.
	if _, err := BuildScoreboard(st, "ghost"); err != nil {
		// LoadEvents may error for a missing game, or replay an empty log.
		// Either is fine; this only exercises the path.
		_ = err
	}
}

// TestBuildBoardViewLoadsFromStore: the public BuildBoardView wrapper renders
// the final board as a fully-revealed spectator view.
func TestBuildBoardViewLoadsFromStore(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})

	v, err := BuildBoardView(st, "g1")
	if err != nil {
		t.Fatalf("BuildBoardView: %v", err)
	}
	if v == nil || v.Viewer != Spectator {
		t.Fatalf("board view = %+v, want a spectator view", v)
	}
	if v.Board == nil {
		t.Error("board view missing the board")
	}
}

// TestBuildScoreboardStoreError: the public wrappers surface a store load error
// (closed DB) instead of returning a bogus scoreboard/view.
func TestBuildScoreboardStoreError(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	st.Close() // LoadEvents now fails

	if _, err := BuildScoreboard(st, "g1"); err == nil {
		t.Error("BuildScoreboard did not surface the store error")
	}
	if _, err := BuildBoardView(st, "g1"); err == nil {
		t.Error("BuildBoardView did not surface the store error")
	}
}

// TestScoreboardAndBoardViewReplayError: a malformed event log (out-of-order
// seq) makes both scoreboardFromEvents and boardViewFromEvents surface the
// replay error rather than panic.
func TestScoreboardAndBoardViewReplayError(t *testing.T) {
	bad := []engine.Event{
		{Seq: 5, Type: engine.EvTurnStarted, Data: []byte(`{}`)}, // seq gap from 0
	}
	if _, err := scoreboardFromEvents(bad); err == nil {
		t.Error("scoreboardFromEvents accepted an out-of-order event log")
	}
	if _, err := boardViewFromEvents(bad); err == nil {
		t.Error("boardViewFromEvents accepted an out-of-order event log")
	}
}

// TestEventsSinceStoreError: EventsSince surfaces a store error (here from a
// closed store) instead of returning a partial slice.
func TestEventsSinceStoreError(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	a.Stop()
	st.Close() // close the underlying DB so LoadEvents fails

	if _, err := a.EventsSince(Spectator, 0); err == nil {
		t.Error("EventsSince did not surface the store error after the DB was closed")
	}
}

// TestAutoTimeoutNoOpWhenSuspended: a turn-timer expiry that fires while the
// game is suspended must not act (autoTimeoutDecision returns early).
func TestAutoTimeoutNoOpWhenSuspended(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 30})
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	a.Suspend()
	seq0 := actorState(a).NextSeq
	// Drive the timeout path directly; suspended means it should be a no-op.
	a.call(func() { a.autoTimeoutDecision(a.timerGen) })
	if got := actorState(a).NextSeq; got != seq0 {
		t.Errorf("suspended auto-timeout advanced the game: seq %d -> %d", seq0, got)
	}
}

// TestAutoTimeoutNoOpWhenFinished: the auto-timeout is a no-op once the game is
// over (no decision to resolve).
func TestAutoTimeoutNoOpWhenFinished(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	// Force the finished phase on the live state, then confirm the timeout path
	// returns without acting.
	a.call(func() { a.state.Phase = engine.PhaseFinished })
	seq0 := actorState(a).NextSeq
	a.call(func() { a.autoTimeoutDecision(a.timerGen) })
	if got := actorState(a).NextSeq; got != seq0 {
		t.Errorf("finished auto-timeout advanced the game: seq %d -> %d", seq0, got)
	}
}

// TestRealClockFiresAndStops asserts the production Clock implementation:
// AfterFunc actually fires its callback, Now returns a sane time, and Stop
// before the deadline prevents the callback from running.
func TestRealClockFiresAndStops(t *testing.T) {
	c := realClock{}
	if c.Now().IsZero() {
		t.Error("realClock.Now returned the zero time")
	}

	fired := make(chan struct{}, 1)
	t1 := c.AfterFunc(5*time.Millisecond, func() { fired <- struct{}{} })
	select {
	case <-fired:
	case <-time.After(time.Second):
		t.Fatal("realClock.AfterFunc never fired its callback")
	}
	// A fired one-shot timer reports it can't be stopped.
	if t1.Stop() {
		t.Error("Stop on an already-fired timer returned true")
	}

	// A timer stopped before its deadline must not fire.
	t2 := c.AfterFunc(time.Hour, func() { t.Error("stopped timer fired") })
	if !t2.Stop() {
		t.Error("Stop on a pending timer returned false")
	}
	// Reset re-arms it to fire soon; confirm it then fires.
	fired2 := make(chan struct{}, 1)
	t3 := c.AfterFunc(time.Hour, func() { fired2 <- struct{}{} })
	t3.Stop()
	t3.Reset(5 * time.Millisecond)
	select {
	case <-fired2:
	case <-time.After(time.Second):
		t.Fatal("realTimer.Reset did not re-arm the timer")
	}
}

// illegalThenAutoBot returns one illegal command (rolling during setup) for its
// seat, exercising runAutoSeats' fall-back-to-auto path, then defers to the
// engine's minimal move so the game still progresses.
type illegalThenAutoBot struct{ tried *bool }

func (b illegalThenAutoBot) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if !*b.tried {
		*b.tried = true
		// Illegal in setup: rolling dice. Decide will reject it, forcing the
		// auto-command fallback.
		return engine.Command{Player: seat, Type: engine.CmdRollDice}, true
	}
	return autoBot{}.Act(s, seat)
}

// TestBotIllegalMoveFallsBackToAuto: when a bot proposes an illegal command
// the actor falls back to the minimal legal move, so the seat still advances.
func TestBotIllegalMoveFallsBackToAuto(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	tried := false
	seq0 := actorState(a).NextSeq
	a.SetSeatBot(0, illegalThenAutoBot{tried: &tried})

	// The fallback auto-command advances the game (a setup piece is placed).
	if next, ok := pollSeqGrows(a, seq0); !ok {
		t.Fatalf("illegal bot move did not fall back to auto (seq stuck at %d)", next)
	}
	if !tried {
		t.Error("bot's illegal move was never attempted")
	}
}

// TestArmTimerClearsDeadlineWhenPaused: a paused game shows no countdown;
// armTimer clears the deadlines and stops the timer.
func TestArmTimerClearsDeadlineWhenPaused(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 30})
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	// A timed game with a human up exposes a deadline.
	if v := a.View(0); len(v.SeatDeadlines) == 0 {
		t.Fatal("expected a turn deadline before pausing")
	}
	// Pausing and re-arming clears all seat deadlines (no countdown while paused).
	var cleared bool
	a.call(func() {
		a.paused = true
		a.armTimer()
		cleared = len(a.seatDeadlines) == 0
		a.paused = false // restore so deferred Stop runs cleanly
		a.armTimer()
	})
	if !cleared {
		t.Error("armTimer did not clear the turn deadline while paused")
	}
}

// TestArmTimerNoDeadlineForUntimedGame: an untimed game (TurnTimerSec 0) never
// exposes a turn deadline.
func TestArmTimerNoDeadlineForUntimedGame(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	if v := a.View(0); len(v.SeatDeadlines) != 0 {
		t.Errorf("untimed game exposed a turn deadline: %v", v.SeatDeadlines)
	}
}

// TestLoadDefaultsClock: Load with a nil clock installs the real clock and
// still produces a working actor.
func TestLoadDefaultsClock(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{}) // nil clock → realClock
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()
	if a.clock == nil {
		t.Fatal("Load left a nil clock")
	}
	if v := a.View(Spectator); v == nil {
		t.Fatal("actor unresponsive after Load with a default clock")
	}
}

// TestLoadMissingGameErrors: Load of a game id with no events fails (rebuild
// returns an error) and does not start a loop.
func TestLoadMissingGameErrors(t *testing.T) {
	st := openStore(t)
	if _, err := Load("ghost", st, Options{Clock: &fakeClock{}}); err == nil {
		t.Fatal("expected Load of an event-less game to error")
	}
}

// TestApplyFoldErrorPausesGame: a fold error from engine.Apply (here an
// out-of-order seq) pauses the game instead of crashing, returning ErrPaused.
func TestApplyFoldErrorPausesGame(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	var applyErr error
	a.call(func() {
		// An event with a seq the state does not expect makes engine.Apply return
		// a fold error, which apply converts into a paused game.
		applyErr = a.apply(engine.Event{Seq: 99999, Type: engine.EvTurnStarted, Data: []byte(`{}`)})
	})
	if !errors.Is(applyErr, ErrPaused) {
		t.Fatalf("apply of an out-of-order event = %v, want ErrPaused", applyErr)
	}
	// The game is now paused: commands report ErrPaused.
	if err := a.Do(engine.Command{Player: 0, Type: engine.CmdRollDice}); !errors.Is(err, ErrPaused) {
		t.Errorf("expected ErrPaused after a fold-error pause, got %v", err)
	}
}

// TestFinishIsIdempotent: a second finish for the same game does not double-count
// stats (FinishGameOnce gates the bump).
func TestFinishIsIdempotent(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	seats, _ := st.Seats("g1")
	winnerUser := seats[0].UserID

	m.finish("g1", 0)
	m.finish("g1", 0) // duplicate (reload / replayed finish) must be a no-op

	stats, _ := st.StatsFor(winnerUser)
	if len(stats) != 1 || stats[0].Games != 1 || stats[0].Wins != 1 {
		t.Errorf("winner stats after double finish = %+v, want exactly one game/win", stats)
	}
}

// TestFinishWinnerNotInSeats: finish with a winner seat that maps to no store
// seat runs without panicking and credits no stats. The store may reject
// finalizing against the unmapped user (FK); finish logs and tolerates it.
func TestFinishWinnerNotInSeats(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	seats, _ := st.Seats("g1")
	m.finish("g1", 99) // seat 99 has no store seat → winnerUser stays 0

	// No seat's user should have been credited a win against an unmapped winner.
	for _, s := range seats {
		stats, _ := st.StatsFor(s.UserID)
		for _, st := range stats {
			if st.Wins != 0 {
				t.Errorf("user %d credited a win for an unmapped winner: %+v", s.UserID, st)
			}
		}
	}
}

// TestExpireOfferNoOpWhenPaused: a paused game ignores an offer-expiry timer.
func TestExpireOfferNoOpWhenPaused(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	a.call(func() { a.paused = true })
	// Must return immediately without touching state.
	a.call(func() { a.expireOffer() })
}

func TestSetSeatBotPrimesBoardAwareSource(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	primed := false
	a.SetSeatBot(2, boardPrimerBot{primed: &primed})
	a.call(func() {}) // round-trip the loop so the install completes
	if !primed {
		t.Error("SetSeatBot did not Prime a board-aware command source")
	}
}
