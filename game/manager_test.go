package game

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/econ"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// seedRankedGameWithLog is seedGameWithLog with Ranked=true on the game row.
func seedRankedGameWithLog(t *testing.T, st *store.Store, id string, events []engine.Event) []*store.Seat {
	t.Helper()
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
		t.Fatal("seedRankedGameWithLog: no game_created event or zero players")
	}
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(engine.GameConfig{Players: nPlayers})
	if err := st.CreateGame(&store.Game{ID: id, Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID, Ranked: true}); err != nil {
		t.Fatalf("CreateGame (ranked): %v", err)
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

// TestConcurrentGetSameGame: many goroutines Get()ing the same game at once
// all receive the same actor (the two-phase load reserves the slot, so there
// is no duplicate Load()) without racing on m.mu or the loading map. Run under
// -race.
func TestConcurrentGetSameGame(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	const callers = 24
	var wg sync.WaitGroup
	wg.Add(callers)
	got := make([]*Actor, callers)
	errs := make([]error, callers)
	start := make(chan struct{})
	for i := range callers {
		go func(i int) {
			defer wg.Done()
			<-start
			got[i], errs[i] = m.Get("g1")
		}(i)
	}
	close(start)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("Get[%d]: %v", i, err)
		}
	}
	first := got[0]
	if first == nil {
		t.Fatal("nil actor")
	}
	for i, a := range got {
		if a != first {
			t.Fatalf("Get[%d] returned a different actor instance %p, want %p", i, a, first)
		}
	}
}

// TestConcurrentGetDifferentGames exercises the two-phase load across distinct
// games to confirm loads proceed without holding m.mu (no deadlock) under race.
func TestConcurrentGetDifferentGames(t *testing.T) {
	st := openStore(t)
	ids := []string{"g0", "g1", "g2", "g3"}
	for _, id := range ids {
		seedGame(t, st, id, 3, engine.GameConfig{Players: 3})
	}
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	var wg sync.WaitGroup
	for _, id := range ids {
		for range 4 {
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				if _, err := m.Get(id); err != nil {
					t.Errorf("Get(%s): %v", id, err)
				}
			}(id)
		}
	}
	wg.Wait()
	for _, id := range ids {
		if !m.running(id) {
			t.Errorf("game %s not running after Get", id)
		}
	}
}

// TestReaperReleasesFinishedGame: once a game finishes, the reaper releases
// its actor after the grace period.
func TestReaperReleasesFinishedGame(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	// Target 3: two setup settlements (2 VP) + a city upgrade wins.
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TargetVP: 3})
	m := NewManager(st, clock)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	mirror := mirrorState(t, st, "g1")
	do := func(cmd engine.Command) {
		t.Helper()
		evs, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor %s: %v", cmd.Type, err)
		}
	}
	for i := 0; i < 20000 && mirror.Phase != engine.PhaseFinished; i++ {
		if mirror.Phase == engine.PhasePlay && mirror.Rolled && !mirror.RobberPending &&
			len(mirror.PendingDiscards) == 0 && mirror.Players[mirror.Cur].Hand.Has(engine.CostCity) {
			var spot json.RawMessage
			for v, b := range mirror.Buildings {
				if b.Owner == mirror.Cur && !b.City {
					spot, _ = json.Marshal(map[string]any{"v": v})
					break
				}
			}
			if spot != nil {
				do(engine.Command{Player: mirror.Cur, Type: engine.CmdBuildCity, Data: spot})
				continue
			}
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		do(cmd)
	}
	if mirror.Phase != engine.PhaseFinished {
		t.Fatalf("mirror game never finished (phase=%v)", mirror.Phase)
	}

	// The actor is still registered immediately after finish (grace period).
	if !m.running("g1") {
		t.Fatal("game released before grace period")
	}
	// Firing the clock triggers the scheduled reap, which Releases the actor.
	clock.Fire()
	if m.running("g1") {
		t.Error("finished game not released by reaper after grace period")
	}
}

// TestFinishExcludesBotSeatsFromRatings plays an all-bot game to completion
// through the Manager and asserts no seat is rated, even on the ranked finish
// path. Rating of real players is covered by
// TestApplyRatingsMovesWinnerAboveLoser and TestRankedForfeiterPenalizedAndRatedLast.
func TestFinishExcludesBotSeatsFromRatings(t *testing.T) {
	st := openStore(t)

	// Three guest users, all seats marked "bot", so the Manager drives the game
	// to finish with bot.Simple.
	host, _ := st.CreateGuest("rating-host")
	p1, _ := st.CreateGuest("rating-p1")
	p2, _ := st.CreateGuest("rating-p2")
	users := []int64{host.ID, p1.ID, p2.ID}

	cfg := engine.GameConfig{Players: 3, TargetVP: 10}
	cfgJSON, _ := json.Marshal(cfg)
	// Ranked with all-bot seats cannot happen in production (bots can't queue
	// ranked); it checks the bot filter holds on the ranked branch.
	if err := st.CreateGame(&store.Game{ID: "rg1", Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID, Ranked: true}); err != nil {
		t.Fatalf("CreateGame: %v", err)
	}
	for i, uid := range users {
		if err := st.AddSeat("rg1", i, uid); err != nil {
			t.Fatalf("AddSeat %d: %v", i, err)
		}
		if err := st.SetSeatStatus("rg1", i, "bot"); err != nil {
			t.Fatalf("SetSeatStatus %d: %v", i, err)
		}
	}

	// Use realClock so the actor bot loop actually runs.
	m := NewManager(st, nil)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return bot.NewSimple() })
	// bot.Simple stalls in a minority of games, so cap the log as production
	// does (COSTAN_GAME_EVENT_CAP). A healthy 3-player game ends well under a
	// thousand events, and the assertions hold either way.
	m.SetEventCap(4000)
	defer m.StopAll()

	if err := m.Start("rg1", cfg, engine.SeedsFrom(42)); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Poll until finish() sets status="finished".
	deadline := time.Now().Add(30 * time.Second)
	for {
		g, err := st.GameByID("rg1")
		if err != nil {
			t.Fatalf("GameByID: %v", err)
		}
		if g.Status == "finished" {
			break
		}
		if g.Status == "paused-error" {
			t.Fatal("game hit a paused-error during bot play")
		}
		if time.Now().After(deadline) {
			t.Fatal("game did not finish within 30s")
		}
		time.Sleep(5 * time.Millisecond)
	}

	// Give the post-finish write a brief grace window, then assert every bot
	// seat is still unrated (UpdatedAt == 0).
	time.Sleep(200 * time.Millisecond)
	for _, uid := range users {
		r, err := st.RatingRow(uid, "base")
		if err != nil {
			t.Fatalf("RatingRow %d: %v", uid, err)
		}
		if r.UpdatedAt != 0 {
			t.Errorf("bot seat user %d was rated (UpdatedAt=%d, Display=%d)",
				uid, r.UpdatedAt, r.Display)
		}
	}
}

// TestRankedForfeiterPenalizedAndRatedLast: in a ranked game a forfeiter gets
// a queue strike and is rated last rather than excluded, so the winner is
// still rated in a 2-player game.
func TestRankedForfeiterPenalizedAndRatedLast(t *testing.T) {
	st := openStore(t)
	// twoPlayerLog: seat 0 wins, finished game.
	seats := seedRankedGameWithLog(t, st, "g1", twoPlayerLog())
	if len(seats) != 2 {
		t.Fatalf("want 2 seats, got %d", len(seats))
	}

	// Seat 1 (the loser) forfeits.
	seat1 := seats[1]
	if err := st.RecordForfeit("g1", seat1.UserID); err != nil {
		t.Fatalf("RecordForfeit: %v", err)
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	// Drive finish directly (seat 0 = engine.PlayerID(0) wins).
	m.finish("g1", 0)

	// (a) Forfeiter must have a ranked strike applied.
	until, err := st.RankedCooldownUntil(seat1.UserID)
	if err != nil {
		t.Fatalf("RankedCooldownUntil: %v", err)
	}
	if until == 0 {
		t.Error("ranked: forfeiter has no cooldown after finish")
	}

	// (b) The winner's rating is updated: both seats go to ApplyGameRatings
	// with the forfeiter last.
	seat0 := seats[0]
	wr, err := st.RatingRow(seat0.UserID, "base")
	if err != nil {
		t.Fatalf("RatingRow winner: %v", err)
	}
	if wr.UpdatedAt == 0 {
		t.Error("ranked: winner rating was never written")
	}
	if wr.Display <= 1000 {
		t.Errorf("ranked: winner display rating %d not above 1000 (default) after rated-last update", wr.Display)
	}
}

// TestCasualForfeiterNotPenalized: in a casual game the forfeiter gets no
// queue strike and the winner's rating is unchanged (Display stays 1000).
func TestCasualForfeiterNotPenalized(t *testing.T) {
	st := openStore(t)
	// seedGameWithLog creates a non-ranked game.
	seats := seedGameWithLog(t, st, "g2", twoPlayerLog())
	if len(seats) != 2 {
		t.Fatalf("want 2 seats, got %d", len(seats))
	}

	// Seat 1 (the loser) forfeits.
	seat1 := seats[1]
	if err := st.RecordForfeit("g2", seat1.UserID); err != nil {
		t.Fatalf("RecordForfeit: %v", err)
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	m.finish("g2", 0)

	// No ranked strike.
	until, err := st.RankedCooldownUntil(seat1.UserID)
	if err != nil {
		t.Fatalf("RankedCooldownUntil: %v", err)
	}
	if until != 0 {
		t.Errorf("casual: forfeiter received a cooldown %d", until)
	}

	// Winner rating untouched: casual games are not rated.
	seat0 := seats[0]
	wr, err := st.RatingRow(seat0.UserID, "base")
	if err != nil {
		t.Fatalf("RatingRow winner: %v", err)
	}
	if wr.UpdatedAt != 0 {
		t.Errorf("casual: winner rating was updated (UpdatedAt=%d)", wr.UpdatedAt)
	}
}

// TestNonRankedGameDoesNotRate: a casual game where both players finish (no
// forfeit) must not move anyone's rating. Unlike
// TestCasualForfeiterNotPenalized, no seat is excluded, so only the ranked
// gate prevents rating.
func TestNonRankedGameDoesNotRate(t *testing.T) {
	st := openStore(t)
	seats := seedGameWithLog(t, st, "nr1", twoPlayerLog())
	if len(seats) != 2 {
		t.Fatalf("want 2 seats, got %d", len(seats))
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	// Seat 0 wins; nobody forfeits.
	m.finish("nr1", 0)

	for _, s := range seats {
		r, err := st.RatingRow(s.UserID, "base")
		if err != nil {
			t.Fatalf("RatingRow seat %d: %v", s.No, err)
		}
		if r.UpdatedAt != 0 {
			t.Errorf("non-ranked: seat %d rating was updated (UpdatedAt=%d)", s.No, r.UpdatedAt)
		}
	}
}

// TestRecoverFinalizationReFinalizes: if the process crashes after
// FinishGameOnce marks a game 'finished' but before stats, ratings and match
// history are written, recoverFinalization (run at startup) must re-finalize
// it.
func TestRecoverFinalizationReFinalizes(t *testing.T) {
	st := openStore(t)
	// A finished 2-player game with two human seats (seat 0 wins at seq 12).
	seats := seedGameWithLog(t, st, "rec1", twoPlayerLog())
	if len(seats) != 2 {
		t.Fatalf("want 2 seats, got %d", len(seats))
	}
	winnerUser := seats[0].UserID

	// Simulate the crash: mark the game 'finished' via FinishGameOnce but skip
	// every stat, rating and match-history write.
	won, err := st.FinishGameOnce("rec1", winnerUser)
	if err != nil || !won {
		t.Fatalf("FinishGameOnce = (%v, %v), want (true, nil)", won, err)
	}

	// Precondition: no match-history row, no stats yet.
	if _, err := st.MatchHistoryByGame("rec1"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("MatchHistoryByGame before recovery = %v, want ErrNotFound", err)
	}
	if stats, _ := st.StatsFor(winnerUser); len(stats) != 0 {
		t.Fatalf("winner has stats before recovery: %+v", stats)
	}

	// Run the recovery sweep (what StartReaper kicks off at startup).
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.recoverFinalization()

	// Match history must now exist.
	if _, err := st.MatchHistoryByGame("rec1"); err != nil {
		t.Fatalf("MatchHistoryByGame after recovery: %v", err)
	}
	// Stats must have been bumped for the winner (1 game, 1 win).
	stats, err := st.StatsFor(winnerUser)
	if err != nil {
		t.Fatalf("StatsFor: %v", err)
	}
	if len(stats) != 1 || stats[0].Games != 1 || stats[0].Wins != 1 {
		t.Fatalf("winner stats after recovery = %+v, want 1 game / 1 win", stats)
	}

	// Idempotent: a second sweep finds the row and re-finalizes nothing.
	m.recoverFinalization()
	stats, _ = st.StatsFor(winnerUser)
	if len(stats) != 1 || stats[0].Games != 1 || stats[0].Wins != 1 {
		t.Fatalf("winner stats after 2nd sweep = %+v, want unchanged 1/1", stats)
	}
}

// TestManagerEvictsIdleGame: sweepIdleOnce evicts an unsubscribed, idle actor,
// and a later Get rebuilds it from the event log.
func TestManagerEvictsIdleGame(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetIdleEvict(time.Minute)
	m.startReaper()
	defer m.StopAll()

	// Create and load a game (no subscribers).
	seedGame(t, st, "evict1", 3, engine.GameConfig{Players: 3})
	if _, err := m.Get("evict1"); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !m.running("evict1") {
		t.Fatal("game should be running after Get")
	}

	// Advance clock past the idle window so lastActivity is stale.
	clock.Advance(2 * time.Minute)
	// Fire all pending AfterFunc callbacks (the reaper sweep).
	clock.Fire()

	if m.running("evict1") {
		t.Fatal("idle unsubscribed game should have been evicted from memory")
	}
	// Reopening must rebuild from the event log.
	if _, err := m.Get("evict1"); err != nil {
		t.Fatalf("Get after eviction should rebuild: %v", err)
	}
}

// TestFinishPersistsMatchHistory verifies that finish() writes a MatchRecord
// blob for human-seat games and skips bot-only games.
func TestFinishPersistsMatchHistory(t *testing.T) {
	// Case 1: a human game persists a MatchRecord. seedGameWithLog creates a
	// non-ranked 2-player game with two guest seats; twoPlayerLog() has seat 0
	// winning at seq 12.
	st := openStore(t)
	seedGameWithLog(t, st, "mh1", twoPlayerLog())

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	// Drive finish directly (seat 0 wins).
	m.finish("mh1", 0)

	row, err := st.MatchHistoryByGame("mh1")
	if err != nil {
		t.Fatalf("MatchHistoryByGame(human game): %v", err)
	}
	var rec MatchRecord
	if err := json.Unmarshal([]byte(row.Record), &rec); err != nil {
		t.Fatalf("unmarshal MatchRecord: %v", err)
	}
	if rec.GameID != "mh1" {
		t.Errorf("rec.GameID = %q, want %q", rec.GameID, "mh1")
	}
	if len(rec.Scoreboard.Players) == 0 {
		t.Error("rec.Scoreboard.Players is empty")
	}
	if !hasHumanSeat(func() []*store.Seat {
		s, _ := st.Seats("mh1")
		return s
	}()) {
		t.Error("expected at least one human seat in mh1")
	}

	// Case 2: a bot-only game persists no row.
	st2 := openStore(t)
	host, _ := st2.CreateGuest("bot-host")
	cfg := engine.GameConfig{Players: 3, TargetVP: 10}
	cfgJSON, _ := json.Marshal(cfg)
	if err := st2.CreateGame(&store.Game{ID: "mh_bot", Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		t.Fatalf("CreateGame bot: %v", err)
	}
	p1, _ := st2.CreateGuest("bot-p1")
	p2, _ := st2.CreateGuest("bot-p2")
	users := []int64{host.ID, p1.ID, p2.ID}
	for i, uid := range users {
		if err := st2.AddSeat("mh_bot", i, uid); err != nil {
			t.Fatalf("AddSeat %d: %v", i, err)
		}
		if err := st2.SetSeatStatus("mh_bot", i, "bot"); err != nil {
			t.Fatalf("SetSeatStatus %d: %v", i, err)
		}
	}

	m2 := NewManager(st2, nil)
	m2.SetBotFactory(func(engine.PlayerID) CommandSource { return bot.NewSimple() })
	m2.SetEventCap(4000) // see TestFinishExcludesBotSeatsFromRatings: Simple stalemates sometimes
	defer m2.StopAll()

	if err := m2.Start("mh_bot", cfg, engine.SeedsFrom(42)); err != nil {
		t.Fatalf("Start bot game: %v", err)
	}

	// Poll until the game finishes.
	deadline := time.Now().Add(30 * time.Second)
	for {
		g, err := st2.GameByID("mh_bot")
		if err != nil {
			t.Fatalf("GameByID: %v", err)
		}
		if g.Status == "finished" {
			break
		}
		if g.Status == "paused-error" {
			t.Fatal("bot game hit paused-error")
		}
		if time.Now().After(deadline) {
			t.Fatal("bot game did not finish within 30s")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Poll until the status is "finished", then give finish() a brief window
	// to flush. A bot-only game's match-history row must never appear.
	writeDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(writeDeadline) {
		g, err2 := st2.GameByID("mh_bot")
		if err2 == nil && g.Status == "finished" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	// One more short pause to let any in-flight write after status flip complete.
	time.Sleep(20 * time.Millisecond)

	_, err = st2.MatchHistoryByGame("mh_bot")
	if !errors.Is(err, store.ErrNotFound) {
		t.Errorf("bot-only game: MatchHistoryByGame err = %v, want ErrNotFound", err)
	}
}

func TestStopAllIdempotent(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, &fakeClock{})
	m.StartReaper()
	// StopAll must be safe to call again and return promptly with no actors.
	m.StopAll()
	m.StopAll()
}

// TestFinalizePaysMatchFaucet: the match reward is paid through the
// finalize transaction.
func TestFinalizePaysMatchFaucet(t *testing.T) {
	st := openStore(t)
	seats := seedGameWithLog(t, st, "pay1", creditableLog())
	winnerUser := seats[0].UserID
	if won, err := st.FinishGameOnce("pay1", winnerUser); err != nil || !won {
		t.Fatalf("FinishGameOnce = (%v, %v)", won, err)
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.recoverFinalization()

	// A first game of the day pays both faucets.
	want := econ.MatchPayout + econ.DailyPayout
	for _, s := range seats {
		bal, err := st.Balance(s.UserID)
		if err != nil || bal != want {
			t.Fatalf("balance(seat %d) = %d, %v; want %d", s.No, bal, err, want)
		}
	}

	// The sweep re-runs whole finalizations; the idem keys stop a second
	// payout.
	m.recoverFinalization()
	for _, s := range seats {
		if bal, _ := st.Balance(s.UserID); bal != want {
			t.Fatalf("balance(seat %d) after 2nd sweep = %d; want %d", s.No, bal, want)
		}
	}
}

// A table needs two humans before anyone is paid; one human plus a bot pays
// nobody.
func TestFinalizePaysNobodyWithoutTwoHumans(t *testing.T) {
	st := openStore(t)
	seats := seedGameWithLog(t, st, "pay2", creditableLog())
	if err := st.SetSeatStatus("pay2", seats[1].No, "bot"); err != nil {
		t.Fatalf("SetSeatStatus: %v", err)
	}
	if won, err := st.FinishGameOnce("pay2", seats[0].UserID); err != nil || !won {
		t.Fatalf("FinishGameOnce = (%v, %v)", won, err)
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.recoverFinalization()

	for _, s := range seats {
		if bal, _ := st.Balance(s.UserID); bal != 0 {
			t.Fatalf("balance(seat %d) = %d; want 0", s.No, bal)
		}
	}
}

// The daily cap holds across games: a player already at MatchDailyCap rewarded
// matches today is skipped, while their opponent is still paid.
func TestFinalizeRespectsDailyCap(t *testing.T) {
	st := openStore(t)
	seats := seedGameWithLog(t, st, "pay3", creditableLog())
	capped := seats[0].UserID
	for i := range econ.MatchDailyCap {
		if _, err := st.LedgerCredit(capped, econ.MatchPayout, "match",
			fmt.Sprintf("match:earlier%d:%d", i, capped)); err != nil {
			t.Fatalf("seed credit %d: %v", i, err)
		}
	}
	if won, err := st.FinishGameOnce("pay3", capped); err != nil || !won {
		t.Fatalf("FinishGameOnce = (%v, %v)", won, err)
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.recoverFinalization()

	// The cap applies to the match reward only. The daily bonus has its own
	// rule, and this player has not had today's.
	wantCapped := econ.MatchPayout*econ.MatchDailyCap + econ.DailyPayout
	if bal, _ := st.Balance(capped); bal != wantCapped {
		t.Fatalf("capped balance = %d; want %d (daily only, no match past the cap)", bal, wantCapped)
	}
	wantOpponent := econ.MatchPayout + econ.DailyPayout
	if bal, _ := st.Balance(seats[1].UserID); bal != wantOpponent {
		t.Fatalf("uncapped opponent balance = %d; want %d", bal, wantOpponent)
	}
}

// The second game of the day pays the match reward only: the daily bonus's
// idem key is per user per day.
func TestDailyBonusPaysOncePerDay(t *testing.T) {
	st := openStore(t)
	first := seedGameWithLog(t, st, "day2a", creditableLog())
	if won, _ := st.FinishGameOnce("day2a", first[0].UserID); !won {
		t.Fatal("first FinishGameOnce did not win the transition")
	}
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.recoverFinalization()

	after := econ.MatchPayout + econ.DailyPayout
	if bal, _ := st.Balance(first[0].UserID); bal != after {
		t.Fatalf("after the first game = %d; want %d", bal, after)
	}

	// A second game the same day, with the same two players in it.
	second := seedGameWithLogForUsers(t, st, "day2b", creditableLog(), []int64{first[0].UserID, first[1].UserID})
	if won, _ := st.FinishGameOnce("day2b", second[0].UserID); !won {
		t.Fatal("second FinishGameOnce did not win the transition")
	}
	m.recoverFinalization()

	if bal, _ := st.Balance(first[0].UserID); bal != after+econ.MatchPayout {
		t.Fatalf("after the second game = %d; want %d (one more match, no second daily)",
			bal, after+econ.MatchPayout)
	}
}

// seedGameWithLogForUsers is seedGameWithLog for players who already exist
// (a second game with the same people).
func seedGameWithLogForUsers(
	t *testing.T, st *store.Store, id string, events []engine.Event, users []int64,
) []*store.Seat {
	t.Helper()
	cfgJSON, _ := json.Marshal(engine.GameConfig{Players: len(users)})
	if err := st.CreateGame(&store.Game{
		ID: id, Ruleset: "base", Config: cfgJSON, CreatedBy: users[0],
	}); err != nil {
		t.Fatalf("CreateGame: %v", err)
	}
	for i, u := range users {
		if err := st.AddSeat(id, i, u); err != nil {
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

// creditableLog is twoPlayerLog padded to a length that counts as a match
// for payouts. twoPlayerLog ends on turn one, so it is the fixture for a game
// too short to pay (TestFinalizeSkipsPayoutForShortGame).
func creditableLog() []engine.Event {
	log := twoPlayerLog()
	fin := log[len(log)-1] // the game_finished event stays last
	log = log[:len(log)-1]
	seq := fin.Seq
	for i := range matchMinRounds * 2 {
		log = append(log, ev(seq, engine.EvTurnEnded, engine.TurnEndedData{Player: engine.PlayerID(i % 2)}))
		seq++
		log = append(log, ev(seq, engine.EvTurnStarted, engine.TurnStartedData{Player: engine.PlayerID((i + 1) % 2)}))
		seq++
	}
	fin.Seq = seq
	return append(log, fin)
}

// A game that ends in seconds (e.g. a surrender in setup between two
// accounts) pays nobody, so the faucets cannot be farmed.
func TestFinalizeSkipsPayoutForShortGame(t *testing.T) {
	st := openStore(t)
	seats := seedGameWithLog(t, st, "short1", twoPlayerLog()) // ends on turn one
	if won, err := st.FinishGameOnce("short1", seats[0].UserID); err != nil || !won {
		t.Fatalf("FinishGameOnce = (%v, %v)", won, err)
	}
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.recoverFinalization()

	for _, s := range seats {
		if bal, _ := st.Balance(s.UserID); bal != 0 {
			t.Fatalf("balance(seat %d) = %d; want 0", s.No, bal)
		}
	}
	// Nor is the daily streak ticked.
	for _, s := range seats {
		days, err := st.CreditDays(s.UserID, "daily", 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(days) != 0 {
			t.Fatalf("seat %d daily credits = %v; want none", s.No, days)
		}
	}
}

// StopAll must join the Manager's background goroutines, not just signal them.
// An unjoined recovery sweep could still be in a store query after StopAll
// returned, racing store.Close (or t.TempDir cleanup). The sweep goes in
// through StartReaper, the production wiring, via Manager.recoverSweep, so the
// test fails if StartReaper launches it with a plain `go`.
func TestStopAllJoinsBackgroundGoroutines(t *testing.T) {
	m := NewManager(openStore(t), &fakeClock{})
	started := make(chan struct{})
	var finished atomic.Bool
	m.recoverSweep = func() {
		close(started)
		time.Sleep(50 * time.Millisecond)
		finished.Store(true)
	}
	m.StartReaper()
	<-started
	m.StopAll()
	if !finished.Load() {
		t.Fatal("StopAll returned while the recovery sweep was still running")
	}
}

// StopAll gives the actors and the background join separate budgets, so an
// actor that uses up its budget does not leave the background join
// unattempted.
//
// The wedged actor is a bare Actor with one registered goroutine that never
// returns, which Stop() blocks on. stopAllTimeout is shrunk so the timeout
// path runs in milliseconds.
func TestStopAllTimeoutStillJoinsBackgroundWork(t *testing.T) {
	old := stopAllTimeout
	stopAllTimeout = 100 * time.Millisecond
	t.Cleanup(func() { stopAllTimeout = old })

	m := NewManager(openStore(t), &fakeClock{})
	var finished atomic.Bool
	m.recoverSweep = func() {
		time.Sleep(150 * time.Millisecond) // outlives the actor budget, fits inside the background one
		finished.Store(true)
	}
	m.StartReaper()
	// An actor that never finishes stopping uses the whole actor budget.
	wedged := &Actor{quit: make(chan struct{}), done: make(chan struct{})}
	wedged.goroutines.Add(1) // never Done: Stop blocks here for the whole budget
	m.mu.Lock()
	m.actors["wedged"] = wedged
	m.mu.Unlock()

	m.StopAll()
	if !finished.Load() {
		t.Fatal("recovery sweep still running after the budget")
	}
}

// Get must refuse once StopAll has begun. Its slow phase runs outside m.mu, so
// otherwise a Get could install a live actor after StopAll snapshotted the
// map and returned.
func TestGetRefusesAfterStopAll(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, &fakeClock{})
	cfg := engine.GameConfig{Players: 2, Ruleset: "base"}
	seedGame(t, st, "g1", 2, cfg)

	// It loads normally first, so the refusal below is about shutdown.
	if _, err := m.Get("g1"); err != nil {
		t.Fatalf("Get before StopAll: %v", err)
	}
	m.StopAll()

	a, err := m.Get("g1")
	if !errors.Is(err, ErrShuttingDown) {
		t.Fatalf("Get after StopAll = (%v, %v), want ErrShuttingDown", a, err)
	}
	if a != nil {
		t.Error("Get returned an actor while shutting down")
	}
	m.mu.Lock()
	n := len(m.actors)
	m.mu.Unlock()
	if n != 0 {
		t.Errorf("%d actors installed after StopAll", n)
	}
}

// A Get already in flight when StopAll runs: whichever way it lands, no actor
// is running when StopAll returns and none appears afterwards. Asserted on the
// actor's done channel, since an actor that was never installed but never
// stopped would hold the store with nothing pointing at it.
func TestGetRacingStopAllLeavesNoActorRunning(t *testing.T) {
	cfg := engine.GameConfig{Players: 2, Ruleset: "base"}
	for i := range 50 {
		st := openStore(t)
		m := NewManager(st, &fakeClock{})
		seedGame(t, st, "g1", 2, cfg)

		got := make(chan *Actor, 1)
		go func() {
			a, _ := m.Get("g1")
			got <- a
		}()
		m.StopAll()
		a := <-got

		m.mu.Lock()
		n := len(m.actors)
		m.mu.Unlock()
		if n != 0 {
			t.Fatalf("iter %d: %d actors in the map after StopAll", i, n)
		}
		if a == nil {
			continue // refused, which is the other legal outcome
		}
		select {
		case <-a.done:
		case <-time.After(5 * time.Second):
			t.Fatalf("iter %d: Get installed an actor that StopAll never stopped", i)
		}
	}
}

// With an unjoined sweep, a read connection could be dialed into the directory
// the harness was deleting, and cleanup failed with "directory not empty".
// Probabilistic, so it loops.
func TestStopAllLeavesNoStoreUserBehind(t *testing.T) {
	for i := range 300 {
		dir := t.TempDir()
		st, err := store.Open(filepath.Join(dir, "test.db"))
		if err != nil {
			t.Fatal(err)
		}
		m := NewManager(st, &fakeClock{})
		m.StartReaper()
		m.StopAll()
		// The shutdown order main() uses: StopAll, then close the store.
		if err := st.Close(); err != nil {
			t.Fatalf("iter %d: close: %v", i, err)
		}
		if err := os.RemoveAll(dir); err != nil {
			t.Fatalf("iter %d: RemoveAll after StopAll: %v", i, err)
		}
		if ents, err := os.ReadDir(dir); err == nil && len(ents) > 0 {
			t.Fatalf("iter %d: store files recreated after StopAll: %v", i, ents)
		}
	}
}

// TestStartCanonicalisesRuleset pins the production call site, which the
// engine/ruletest tests cannot (they canonicalise their own inputs). It
// asserts on the event log, since the logged ruleset is what every replay
// resolves modules from.
//
// The target VP is checked too: both spellings must resolve to 15 (Caravans
// is a TargetVPAdjuster, and adjusters sum), so a regression to an
// order-dependent target fails here.
func TestStartCanonicalisesRuleset(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(engine.GameConfig{Players: 4})
	if err := st.CreateGame(&store.Game{ID: "canon", Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		t.Fatal(err)
	}
	for i := range 4 {
		u, _ := st.CreateGuest("p")
		if err := st.AddSeat("canon", i, u.ID); err != nil {
			t.Fatal(err)
		}
	}

	const raw = "base+caravans+cak"
	if err := m.Start("canon", engine.GameConfig{Players: 4, Ruleset: raw}, engine.SeedsFrom(7)); err != nil {
		t.Fatalf("Start: %v", err)
	}
	events, err := st.LoadEvents("canon", 0)
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	want := engine.CanonicalRuleset(raw)
	if want == raw {
		t.Fatalf("fixture is no longer non-canonical: %q", raw)
	}
	if s.Config.Ruleset != want {
		t.Errorf("logged ruleset = %q, want the canonical %q", s.Config.Ruleset, want)
	}
	if s.Config.TargetVP != 15 {
		t.Errorf("TargetVP = %d, want the pairing's 15", s.Config.TargetVP)
	}
	// The same number however the host spelled it.
	if got := engine.ResolveTargetVP(engine.GameConfig{Players: 4, Ruleset: raw}); got != 15 {
		t.Errorf("the uncanonical spelling resolves to %d, want 15", got)
	}
}

// TestNewManagerDefaultsEventCap pins the safety net being on by default.
// sim, which reports non-terminating games as ErrStalemate rather than
// scoring tiebreak wins, turns it off explicitly.
func TestNewManagerDefaultsEventCap(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	if got := m.getEventCap(); got != DefaultEventCap {
		t.Fatalf("NewManager eventCap = %d, want DefaultEventCap (%d)", got, DefaultEventCap)
	}
	if DefaultEventCap <= 0 {
		t.Fatalf("DefaultEventCap = %d, want > 0", DefaultEventCap)
	}
	// Explicitly opting out must still work (sim relies on it).
	m.SetEventCap(0)
	if got := m.getEventCap(); got != 0 {
		t.Fatalf("after SetEventCap(0), eventCap = %d, want 0", got)
	}
}
