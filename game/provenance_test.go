package game

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// moverEvents are the event types whose "player" is the seat that acted.
// Provenance is per command batch, and many events name a player who did not
// cause them (a payout after seat 2's roll names every collecting seat but
// carries seat 2's source), so only these can be lined up against a seat.
var moverEvents = map[engine.EventType]bool{
	engine.EvSettlementPlace: true,
	engine.EvRoadPlaced:      true,
	engine.EvSettlementBuilt: true,
	engine.EvRoadBuilt:       true,
	engine.EvCityBuilt:       true,
	engine.EvCardsDiscarded:  true,
	engine.EvRobberMoved:     true,
	engine.EvTurnEnded:       true,
}

// eventSeat decodes the seat that acted, for the event types where the
// payload's player is the mover. ok is false for everything else.
func eventSeat(e engine.Event) (engine.PlayerID, bool) {
	if !moverEvents[e.Type] {
		return 0, false
	}
	var d struct {
		Player *engine.PlayerID `json:"player"`
	}
	if err := json.Unmarshal(e.Data, &d); err != nil || d.Player == nil {
		return 0, false
	}
	return *d.Player, true
}

// loadLog reads the persisted log back out of SQLite: provenance is a claim
// about what is on disk.
func loadLog(t *testing.T, st *store.Store, id string) []engine.Event {
	t.Helper()
	log, err := st.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	return log
}

// seedGameUnstamped builds a game as a pre-provenance server left it, with no
// source on any row. It duplicates seedGame, which now stamps sources.
func seedGameUnstamped(t *testing.T, st *store.Store, id string, players int, cfg engine.GameConfig) {
	t.Helper()
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(cfg)
	if err := st.CreateGame(&store.Game{ID: id, Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddSeat(id, 0, host.ID); err != nil {
		t.Fatal(err)
	}
	for i := 1; i < players; i++ {
		u, _ := st.CreateGuest("p" + string(rune('0'+i)))
		if err := st.AddSeat(id, i, u.ID); err != nil {
			t.Fatal(err)
		}
	}
	events, err := engine.New(cfg, engine.SeedsFrom(99))
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AppendEvents(id, events); err != nil { // no StampSource, on purpose
		t.Fatal(err)
	}
	if err := st.SetGameStatus(id, "active"); err != nil {
		t.Fatal(err)
	}
}

// playSetupPiece places one setup piece for the seat that is up through Do,
// the human path into the actor.
func playSetupPiece(t *testing.T, a *Actor) {
	t.Helper()
	s := actorState(a)
	cmd, ok := engine.AutoCommand(s)
	if !ok {
		t.Fatal("no legal setup move available")
	}
	if err := a.Do(cmd); err != nil {
		t.Fatalf("human setup move: %v", err)
	}
}

// TestAutoPlayDistinctFromHumanInLog: a timeout auto-play and a
// human's own move produce the same engine command, so the log's source must
// tell them apart.
func TestAutoPlayDistinctFromHumanInLog(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 30})
	clock := &fakeClock{}
	m := NewManager(st, clock)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	// A real person places the opening settlement and its road.
	playSetupPiece(t, a)
	playSetupPiece(t, a)
	humanUpTo := len(loadLog(t, st, "g1"))
	if humanUpTo == 0 {
		t.Fatal("no events logged for the human's moves")
	}

	// The next seat sits on its hands until the clock runs out.
	clock.Fire()
	// Fire hops onto the actor loop; a View round-trips the loop, so the
	// timeout has been processed.
	a.View(Spectator)

	log := loadLog(t, st, "g1")
	if len(log) <= humanUpTo {
		t.Fatal("the decision timeout produced no events")
	}

	// Everything before the timeout is the opening deal or the human's own
	// moves; none of it may claim the server acted for a player.
	for _, e := range log[:humanUpTo] {
		if e.Src != engine.SourceHuman && e.Src != engine.SourceServer {
			t.Errorf("seq %d (%s): pre-timeout event has source %s, want human or server", e.Seq, e.Type, e.Src)
		}
	}

	sawTimeout := false
	for _, e := range log[humanUpTo:] {
		if e.Src != engine.SourceTimeout {
			t.Errorf("seq %d (%s): auto-played event has source %s, want timeout", e.Seq, e.Type, e.Src)
		}
		sawTimeout = true
	}
	if !sawTimeout {
		t.Fatal("no timeout-sourced event in the log")
	}

	// The same move type appears under both sources, so only Src separates
	// them.
	humanTypes := map[engine.EventType]bool{}
	for _, e := range log[:humanUpTo] {
		if e.Src == engine.SourceHuman {
			humanTypes[e.Type] = true
		}
	}
	if len(humanTypes) == 0 {
		t.Fatal("no human-sourced events")
	}
}

// TestBotTakeoverDistinctFromOriginalBot: MatchRecord.Seats[].IsBot
// only says who started as a bot, so the log must distinguish a bot that
// inherited a human's seat from an original one.
func TestBotTakeoverDistinctFromOriginalBot(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	// Seat 2 is a bot from the start; seats 0 and 1 are people.
	if err := st.SetSeatStatus("g1", 2, "bot"); err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, &fakeClock{})
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	// Seat 0's player walks out mid-game and a bot inherits their position.
	if err := m.LeaveSeat("g1", 0); err != nil {
		t.Fatal(err)
	}
	// Seat 1 goes quiet too, so setup reaches seat 2 and the original bot
	// moves. Its own events are auto-sourced and not what this test reads.
	a.SetSeatAuto(1, true)
	a.View(Spectator) // round-trip the loop so the moves are committed

	var sawBot, sawTakeover bool
	for _, e := range loadLog(t, st, "g1") {
		seat, ok := eventSeat(e)
		if !ok {
			continue
		}
		switch {
		case seat == 2 && e.Src == engine.SourceBot:
			sawBot = true
		case seat == 0 && e.Src == engine.SourceBotTakeover:
			sawTakeover = true
		case seat == 2 && e.Src == engine.SourceBotTakeover:
			t.Errorf("seq %d: seat 2 started as a bot but logged as a takeover", e.Seq)
		case seat == 0 && e.Src == engine.SourceBot:
			t.Errorf("seq %d: seat 0 was a human's seat but logged as an original bot", e.Seq)
		}
	}
	if !sawBot {
		t.Error("no original-bot event in the log")
	}
	if !sawTakeover {
		t.Error("no bot-takeover event in the log")
	}
}

// TestSeatControlLogRecordsTakeoverAndReturn covers what per-event provenance
// cannot show: a seat held by a bot while it owes nothing, and a player taking
// their seat back, which produces no event.
func TestSeatControlLogRecordsTakeoverAndReturn(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	// Seat 1 is not the seat up first, so nothing it does can race the baseline.
	a.SetSeatBot(1, autoBot{})
	a.MarkPresent(1)
	a.View(Spectator)

	log, err := st.SeatControlLog("g1")
	if err != nil {
		t.Fatal(err)
	}
	var seat1 []string
	for _, c := range log {
		if c.Seat == 1 {
			seat1 = append(seat1, c.Control)
		}
	}
	// Transitions only: the opening control is seats.status and is not
	// repeated here.
	if len(seat1) != 2 {
		t.Fatalf("seat 1 control history = %v, want bot_takeover -> human", seat1)
	}
	if seat1[0] != "bot_takeover" {
		t.Errorf("after takeover = %q, want bot_takeover", seat1[0])
	}
	if seat1[1] != "human" {
		t.Errorf("after the player returned = %q, want human", seat1[1])
	}
}

// TestSeatControlLogRecordsTransitions: every re-subscribe lifts
// auto on the client's seat, so without the dedupe a flaky client would write
// a row per call.
func TestSeatControlLogRecordsTransitions(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	before, err := st.SeatControlLog("g1")
	if err != nil {
		t.Fatal(err)
	}
	for range 50 {
		a.SetSeatAuto(1, false) // already not auto: changes nothing, every time
	}
	after, err := st.SeatControlLog("g1")
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("50 no-op calls added %d control rows, want 0",
			len(after)-len(before))
	}
}

// TestUnstampedLogStillReplays: games logged before provenance have src = 0 on
// every row and must load and replay as before. Nothing that folds the log
// reads provenance.
func TestUnstampedLogStillReplays(t *testing.T) {
	st := openStore(t)
	cfg := engine.GameConfig{Players: 3}
	seedGameUnstamped(t, st, "g1", 3, cfg)

	// Extend the old-style log with real gameplay, still unstamped.
	s, err := engine.Replay(loadLog(t, st, "g1"))
	if err != nil {
		t.Fatal(err)
	}
	for range 12 {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			break
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatal(err)
		}
		if err := st.AppendEvents("g1", events); err != nil { // no StampSource: an old log
			t.Fatal(err)
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}

	raw := loadLog(t, st, "g1")
	for _, e := range raw {
		if e.Src != engine.SourceUnrecorded {
			t.Fatalf("seq %d: fixture is not actually a pre-provenance log (src %s)", e.Seq, e.Src)
		}
	}

	replayed, err := engine.Replay(raw)
	if err != nil {
		t.Fatalf("a pre-provenance log failed to replay: %v", err)
	}
	if replayed.NextSeq != s.NextSeq || replayed.Phase != s.Phase || replayed.Cur != s.Cur {
		t.Fatalf("replay diverged: got seq %d phase %s cur %d, want seq %d phase %s cur %d",
			replayed.NextSeq, replayed.Phase, replayed.Cur, s.NextSeq, s.Phase, s.Cur)
	}

	// And the actor loads it (the live path, not just engine.Replay).
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatalf("actor refused a pre-provenance log: %v", err)
	}
	if got := actorState(a); got.NextSeq != s.NextSeq {
		t.Fatalf("actor rebuilt to seq %d, want %d", got.NextSeq, s.NextSeq)
	}
}

// TestAutoSeatWithoutBotLogsAuto: a seat with no player and no bot, played by
// the engine's minimal legal move, is logged as auto: neither a timeout nor a
// bot choice.
func TestAutoSeatWithoutBotLogsAuto(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{}) // no bot factory: auto-pass only
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	before := len(loadLog(t, st, "g1"))
	a.SetSeatAuto(0, true) // seat 0 is up; nobody is in it
	a.View(Spectator)

	log := loadLog(t, st, "g1")
	if len(log) <= before {
		t.Fatal("the auto seat did not act")
	}
	for _, e := range log[before:] {
		if e.Src != engine.SourceAuto {
			t.Errorf("seq %d (%s): auto-pass event has source %s, want auto", e.Seq, e.Type, e.Src)
		}
	}
}

// TestCommittedEventsCarrySource: every actor write path must state a
// source (commit requires one), so SourceUnrecorded only ever means "logged
// before provenance existed". This drives a game through enough of them to
// check.
func TestCommittedEventsCarrySource(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 30})
	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	playSetupPiece(t, a) // human
	a.SetSeatBot(2, autoBot{})
	a.SetSeatAuto(1, true)
	clock.Fire() // timeout
	deadline := time.Now().Add(2 * time.Second)
	for len(loadLog(t, st, "g1")) < 12 && time.Now().Before(deadline) {
		a.View(Spectator)
		time.Sleep(time.Millisecond)
	}

	log := loadLog(t, st, "g1")
	if len(log) < 12 {
		t.Fatalf("only %d events", len(log))
	}
	for _, e := range log {
		if e.Src == engine.SourceUnrecorded {
			t.Errorf("seq %d (%s) reached SQLite with no provenance", e.Seq, e.Type)
		}
	}
}

// TestForceFinishDistinctFromWin: DefaultEventCap ends a runaway
// game via engine.ForceFinish, which writes an ordinary game_finished and
// flips the row to "finished", so status alone cannot tell it from a real win.
// The log can: a force-finish carries SourceServer, a real win the source of
// the seat whose command crossed the target.
func TestForceFinishDistinctFromWin(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})

	a, err := Load("g1", st, Options{Clock: &fakeClock{}, EventCap: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	mirror := mirrorState(t, st, "g1")
	cmd, ok := engine.AutoCommand(mirror)
	if !ok {
		t.Fatal("no auto command available at game start")
	}
	if err := a.Do(cmd); err != nil {
		t.Fatalf("Do(%s): %v", cmd.Type, err)
	}

	var fin *engine.Event
	for _, e := range loadLog(t, st, "g1") {
		if e.Type == engine.EvGameFinished {
			fin = &e
		}
	}
	if fin == nil {
		t.Fatal("no game_finished event after the event cap")
	}
	if fin.Src != engine.SourceServer {
		t.Fatalf("force-finish game_finished has Src = %v, want SourceServer", fin.Src)
	}
}
