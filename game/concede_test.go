package game

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// longLog builds a real event log for a `players`-seat game past the draw
// threshold by playing minimal legal moves. Minimal play never builds, so the
// game does not end on its own. A log rather than a poked state, so the actor
// loads it like any game.
func longLog(t *testing.T, players int) []engine.Event {
	t.Helper()
	cfg := engine.GameConfig{Players: players}
	log, err := engine.New(cfg, engine.SeedsFrom(99))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for s.TurnsCompleted < engine.DrawMinTurns {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatalf("no auto command at turn %d", s.TurnsCompleted)
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("Decide(%s): %v", cmd.Type, err)
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		log = append(log, events...)
	}
	return log
}

// concedeHarness is an actor loaded over a past-the-threshold log, recording
// finishes and forfeits.
type concedeHarness struct {
	a         *Actor
	clock     *fakeClock
	mu        sync.Mutex
	finishes  []engine.PlayerID
	forfeited []engine.PlayerID
}

func loadConcedeActor(t *testing.T, players int) *concedeHarness {
	t.Helper()
	return loadConcedeActorBots(t, players)
}

// loadConcedeActorBots loads a game where botSeats are original bots (seats no
// human ever held) and every other seat is a human. Only original bots and
// players who walked away may consent to a draw; marking a human seat with
// SetSeatBot models a disconnected player instead.
func loadConcedeActorBots(t *testing.T, players int, botSeats ...engine.PlayerID) *concedeHarness {
	t.Helper()
	return loadConcedePaced(t, players, 0, botSeats...)
}

// loadConcedePaced is loadConcedeActorBots with a bot pacing delay. On the
// fake clock every scheduleTick(botDelay) waits until the test fires the
// clock, so a test can step the actor's autonomous work.
func loadConcedePaced(t *testing.T, players int, botDelay time.Duration, botSeats ...engine.PlayerID) *concedeHarness {
	t.Helper()
	st := openStore(t)
	seedGameWithLog(t, st, "g1", longLog(t, players))
	h := &concedeHarness{}
	isBot := map[engine.PlayerID]bool{}
	for _, s := range botSeats {
		isBot[s] = true
	}
	var humans []engine.PlayerID
	for i := range players {
		if !isBot[engine.PlayerID(i)] {
			humans = append(humans, engine.PlayerID(i))
		}
	}
	clock := &fakeClock{}
	h.clock = clock
	a, err := Load("g1", st, Options{
		Clock:    clock,
		BotDelay: botDelay,
		Bots:     func(engine.PlayerID) CommandSource { return autoBot{} },
		Humans:   humans,
		OnFinish: func(w engine.PlayerID) {
			h.mu.Lock()
			h.finishes = append(h.finishes, w)
			h.mu.Unlock()
		},
		OnForfeit: func(seat engine.PlayerID) {
			h.mu.Lock()
			h.forfeited = append(h.forfeited, seat)
			h.mu.Unlock()
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)
	h.a = a
	return h
}

func (h *concedeHarness) results() (finishes, forfeited []engine.PlayerID) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]engine.PlayerID(nil), h.finishes...), append([]engine.PlayerID(nil), h.forfeited...)
}

// phaseWinner reads the live phase and winner on the actor loop.
func phaseWinner(a *Actor) (engine.Phase, engine.PlayerID) {
	var p engine.Phase
	var w engine.PlayerID
	a.call(func() { p, w = a.state.Phase, a.state.Winner })
	return p, w
}

// waitFinished polls until the game is over, or fails.
func waitFinished(t *testing.T, a *Actor) engine.PlayerID {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		phase, winner := phaseWinner(a)
		if phase == engine.PhaseFinished {
			return winner
		}
		if time.Now().After(deadline) {
			t.Fatal("game never finished")
		}
		time.Sleep(time.Millisecond)
	}
}

// Conceding a duel is normal play, not desertion, and must not record a
// forfeit; otherwise players would go AFK instead.
func TestSurrenderFinishesDuelAndRecordsNoForfeit(t *testing.T) {
	h := loadConcedeActor(t, 2)
	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdSurrender}); err != nil {
		t.Fatalf("surrender: %v", err)
	}
	phase, winner := phaseWinner(h.a)
	if phase != engine.PhaseFinished || winner != 1 {
		t.Fatalf("phase %s winner %d, want finished/1", phase, winner)
	}
	finishes, forfeited := h.results()
	if len(finishes) != 1 || finishes[0] != 1 {
		t.Errorf("onFinish = %v, want [1]", finishes)
	}
	if len(forfeited) != 0 {
		t.Errorf("onForfeit = %v, want none", forfeited)
	}
}

// The claim skips consent, so it is only allowed when the skipped seats are
// bots. With a human seated, a draw offer is the route.
func TestClaimRejectedWithHumanSeated(t *testing.T) {
	h := loadConcedeActor(t, 3)
	h.a.SetSeatBot(2, autoBot{}) // one bot is not enough: seat 1 is still human
	err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdClaimGame})
	if !errors.Is(err, ErrClaimNeedsBots) {
		t.Fatalf("claim err = %v, want ErrClaimNeedsBots", err)
	}
	if phase, _ := phaseWinner(h.a); phase == engine.PhaseFinished {
		t.Fatal("a rejected claim ended the game")
	}
}

func TestClaimAgainstAllBots(t *testing.T) {
	h := loadConcedeActorBots(t, 3, 1, 2)
	h.a.SetSeatBot(1, autoBot{})
	h.a.SetSeatBot(2, autoBot{})
	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdClaimGame}); err != nil {
		t.Fatalf("claim: %v", err)
	}
	phase, winner := phaseWinner(h.a)
	if phase != engine.PhaseFinished {
		t.Fatalf("phase = %s, want finished", phase)
	}
	// Minimal play leaves every seat level on public VP, so the claimer is not
	// ahead and the game is a draw rather than a farmed win.
	if winner != engine.NoPlayer {
		t.Errorf("winner = %d, want NoPlayer", winner)
	}
}

// Bot and auto seats accept a draw offer on the humans' behalf, so with only
// bots left one human's offer settles the game.
func TestBotSeatsAcceptDrawOffer(t *testing.T) {
	h := loadConcedeActorBots(t, 3, 1, 2)
	h.a.SetSeatBot(1, autoBot{})
	h.a.SetSeatBot(2, autoBot{})
	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdOfferDraw}); err != nil {
		t.Fatalf("offer draw: %v", err)
	}
	if winner := waitFinished(t, h.a); winner != engine.NoPlayer {
		t.Fatalf("winner = %d, want NoPlayer", winner)
	}
	finishes, _ := h.results()
	if len(finishes) == 0 || finishes[0] != engine.NoPlayer {
		t.Fatalf("onFinish = %v, want it to report NoPlayer", finishes)
	}
}

// A human seat must still answer for itself: the bots accepting is not enough.
func TestDrawWaitsForOtherHuman(t *testing.T) {
	h := loadConcedeActorBots(t, 3, 2)
	h.a.SetSeatBot(2, autoBot{}) // seat 1 stays human
	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdOfferDraw}); err != nil {
		t.Fatalf("offer draw: %v", err)
	}
	// Give the bot pass time to run and (correctly) not settle the game.
	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		if phase, _ := phaseWinner(h.a); phase == engine.PhaseFinished {
			t.Fatal("the game was drawn without the other human agreeing")
		}
		time.Sleep(time.Millisecond)
	}
	accept, _ := json.Marshal(map[string]bool{"accept": true})
	if err := h.a.Do(engine.Command{Player: 1, Type: engine.CmdRespondDraw, Data: accept}); err != nil {
		t.Fatalf("accept draw: %v", err)
	}
	if winner := waitFinished(t, h.a); winner != engine.NoPlayer {
		t.Fatalf("winner = %d, want NoPlayer", winner)
	}
}

// seedRankedGame is seedGameWithLog for a ranked game, so the draw's
// rating-skip can be observed.
func seedRankedGame(t *testing.T, st *store.Store, id string, events []engine.Event, players int) []*store.Seat {
	t.Helper()
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(engine.GameConfig{Players: players})
	if err := st.CreateGame(&store.Game{ID: id, Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID, Ranked: true}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddSeat(id, 0, host.ID); err != nil {
		t.Fatal(err)
	}
	for i := 1; i < players; i++ {
		u, _ := st.CreateGuest("p")
		if err := st.AddSeat(id, i, u.ID); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.AppendEvents(id, events); err != nil {
		t.Fatal(err)
	}
	if err := st.SetGameStatus(id, "active"); err != nil {
		t.Fatal(err)
	}
	seats, err := st.Seats(id)
	if err != nil {
		t.Fatal(err)
	}
	return seats
}

// A drawn game stores NULL for the winner, counts as a draw (played, not won,
// not lost) for everyone, and is rated as a tie, so a draw is not strictly
// better than a loss for trailing players.
func TestDrawnGameFinalizesWithNoWinner(t *testing.T) {
	st := openStore(t)
	seats := seedRankedGame(t, st, "g1", longLog(t, 2), 2)
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.finish("g1", engine.NoPlayer)

	g, err := st.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != "finished" {
		t.Fatalf("status = %q, want finished", g.Status)
	}
	if g.Winner != nil {
		t.Fatalf("winner_user_id = %d, want NULL for a draw", *g.Winner)
	}
	for _, s := range seats {
		rows, err := st.StatsFor(s.UserID)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 {
			t.Fatalf("seat %d stat rows = %d, want 1", s.No, len(rows))
		}
		if rows[0].Games != 1 || rows[0].Wins != 0 || rows[0].Draws != 1 {
			t.Errorf("seat %d = %d games / %d wins / %d draws, want 1/0/1", s.No, rows[0].Games, rows[0].Wins, rows[0].Draws)
		}
	}
	// Rated as a tie: both seats were rated, and equal ranks leave them level.
	var elos []float64
	for _, s := range seats {
		rows, _ := st.StatsFor(s.UserID)
		elos = append(elos, rows[0].Elo)
	}
	if elos[0] == 1000 {
		t.Errorf("elo = %v, want a rating row", elos[0])
	}
	if elos[0] != elos[1] {
		t.Errorf("elos = %v, want both seats level after a tie", elos)
	}
}

// A forfeiter is struck however the remaining players end the game, so a
// ranked abandoner cannot escape the cooldown through a draw.
func TestForfeiterStruckOnDraw(t *testing.T) {
	st := openStore(t)
	seats := seedRankedGame(t, st, "g1", longLog(t, 3), 3)
	deserter := seats[2].UserID
	if err := st.RecordForfeit("g1", deserter); err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.finish("g1", engine.NoPlayer)

	until, err := st.RankedCooldownUntil(deserter)
	if err != nil {
		t.Fatal(err)
	}
	if until == 0 {
		t.Fatal("the forfeiter walked out of a ranked game and got no queue strike")
	}
	for _, s := range seats[:2] {
		if u, _ := st.RankedCooldownUntil(s.UserID); u != 0 {
			t.Errorf("seat %d was struck for staying (cooldown %d)", s.No, u)
		}
	}
	// The forfeiter is excluded from the stat bumps, as always, and the players
	// who stayed are credited with the draw.
	for _, s := range seats[:2] {
		rows, _ := st.StatsFor(s.UserID)
		if len(rows) != 1 || rows[0].Draws != 1 {
			t.Errorf("seat %d stats = %+v, want one drawn game", s.No, rows)
		}
	}
}

// A player whose connection dropped for a round still owns their game: their
// seat must not accept a draw on their behalf. autoSeats treats such a seat
// like a bot for moving, but not for consent.
func TestDisconnectedSeatNoDrawConsent(t *testing.T) {
	h := loadConcedeActorBots(t, 3) // every seat human
	// Seat 2's player drops and the actor takes their seat over.
	h.a.SetSeatBot(2, autoBot{})

	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdOfferDraw}); err != nil {
		t.Fatalf("offer draw: %v", err)
	}
	accept, _ := json.Marshal(map[string]bool{"accept": true})
	if err := h.a.Do(engine.Command{Player: 1, Type: engine.CmdRespondDraw, Data: accept}); err != nil {
		t.Fatalf("accept draw: %v", err)
	}
	// Give any auto-acceptance every chance to fire.
	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		if phase, _ := phaseWinner(h.a); phase == engine.PhaseFinished {
			t.Fatal("a disconnected player's seat accepted a draw on their behalf")
		}
		time.Sleep(time.Millisecond)
	}
}

// A player who chose to leave has given up their say, so their seat answers
// and one walk-out cannot hold the table hostage.
func TestWalkedAwaySeatConsentsToDraw(t *testing.T) {
	h := loadConcedeActorBots(t, 3) // every seat human
	h.a.SetSeatBot(2, autoBot{})
	h.a.MarkWalkedAway(2) // what Manager.LeaveSeat does

	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdOfferDraw}); err != nil {
		t.Fatalf("offer draw: %v", err)
	}
	accept, _ := json.Marshal(map[string]bool{"accept": true})
	if err := h.a.Do(engine.Command{Player: 1, Type: engine.CmdRespondDraw, Data: accept}); err != nil {
		t.Fatalf("accept draw: %v", err)
	}
	if winner := waitFinished(t, h.a); winner != engine.NoPlayer {
		t.Fatalf("winner = %d, want NoPlayer", winner)
	}
}

// A claim skips consent, so the same distinction gates it: a briefly absent
// human is not a bot.
func TestClaimRejectedWithDisconnectedHuman(t *testing.T) {
	h := loadConcedeActorBots(t, 3, 1) // seat 1 a real bot, seat 2 a human
	h.a.SetSeatBot(1, autoBot{})
	h.a.SetSeatBot(2, autoBot{}) // seat 2's player merely dropped

	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdClaimGame}); !errors.Is(err, ErrClaimNeedsBots) {
		t.Fatalf("claim err = %v, want ErrClaimNeedsBots", err)
	}
	if phase, _ := phaseWinner(h.a); phase == engine.PhaseFinished {
		t.Fatal("a claim ended the game out from under a disconnected player")
	}
}

// drawAccepted reads the standing offer's acceptance count on the actor loop.
// -1 means no offer stands.
func drawAccepted(a *Actor) int {
	n := -1
	a.call(func() {
		if a.state.DrawOffer != nil {
			n = len(a.state.DrawOffer.Accepted)
		}
	})
	return n
}

// One client frame must not turn into a burst of writes: consentless seats
// accept one per pass, paced like bot trade responses.
func TestBotDrawAcceptancesArePaced(t *testing.T) {
	h := loadConcedePaced(t, 4, 50*time.Millisecond, 1, 2, 3)
	for _, seat := range []engine.PlayerID{1, 2, 3} {
		h.a.SetSeatBot(seat, autoBot{})
	}
	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdOfferDraw}); err != nil {
		t.Fatalf("offer draw: %v", err)
	}
	// The pacing delay is parked on the fake clock, so nothing has run yet
	// beyond at most one already-pending pass.
	if n := drawAccepted(h.a); n > 1 {
		t.Fatalf("%d seats accepted in the same instant as the offer, want at most 1", n)
	}
	for i := range 3 {
		before := drawAccepted(h.a)
		if before < 0 {
			break // already settled
		}
		h.a.call(h.a.runDrawResponses)
		after := drawAccepted(h.a)
		if after >= 0 && after-before > 1 {
			t.Fatalf("pass %d committed %d acceptances, want at most 1", i, after-before)
		}
	}
	if winner := waitFinished(t, h.a); winner != engine.NoPlayer {
		t.Fatalf("winner = %d, want NoPlayer once every bot seat has answered", winner)
	}
}

// A draw offer expires on its own. With TurnTimerSec == 0 nothing ends the
// turn, and while one offer stands nobody else can make one.
func TestDrawOfferExpires(t *testing.T) {
	h := loadConcedeActorBots(t, 3) // every seat human, so nothing auto-accepts
	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdOfferDraw}); err != nil {
		t.Fatalf("offer draw: %v", err)
	}
	if v := h.a.View(0); v.DrawDeadlineMs == nil || *v.DrawDeadlineMs <= 0 {
		t.Fatalf("draw_deadline_ms = %v, want a positive countdown", v.DrawDeadlineMs)
	}
	h.clock.Fire()
	deadline := time.Now().Add(2 * time.Second)
	for drawAccepted(h.a) >= 0 {

		if time.Now().After(deadline) {
			t.Fatal("the draw offer outlived its expiry")
		}
		time.Sleep(time.Millisecond)
	}
	if phase, _ := phaseWinner(h.a); phase == engine.PhaseFinished {
		t.Fatal("an expiring offer ended the game")
	}
	if v := h.a.View(0); v.DrawDeadlineMs != nil {
		t.Errorf("draw_deadline_ms = %v, want it cleared with the offer", *v.DrawDeadlineMs)
	}
}

// A player who left to spectate and then pressed Surrender gets a specific
// refusal, not the generic "That move isn't allowed".
func TestSeatBotControlledRefusal(t *testing.T) {
	h := loadConcedeActorBots(t, 2)
	h.a.SetSeatBot(0, autoBot{})
	err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdSurrender})
	if !errors.Is(err, ErrSeatBotControlled) {
		t.Fatalf("err = %v, want ErrSeatBotControlled", err)
	}
	if msg := engine.UserError(err); msg == "That move isn't allowed" {
		t.Errorf("UserError = %q, want wording of its own", msg)
	}
	if code := engine.ErrorCode(err); code != "SEAT_BOT_CONTROLLED" {
		t.Errorf("ErrorCode = %q, want SEAT_BOT_CONTROLLED", code)
	}
}

// Terminal conditions are checked first, so a claim on a finished game
// reports that the game is finished rather than CLAIM_NEEDS_BOTS.
func TestClaimOnFinishedGame(t *testing.T) {
	h := loadConcedeActorBots(t, 2, 1)
	h.a.SetSeatBot(1, autoBot{})
	if err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdSurrender}); err != nil {
		t.Fatalf("surrender: %v", err)
	}
	// Seat 1 is a bot, so the bots-only gate would happily pass this claim.
	err := h.a.Do(engine.Command{Player: 0, Type: engine.CmdClaimGame})
	if !errors.Is(err, engine.ErrGameFinished) {
		t.Fatalf("claim on a finished game err = %v, want ErrGameFinished", err)
	}
}

// surrenderBot is a command source that only ever tries to end the game.
type surrenderBot struct{}

func (surrenderBot) Act(_ *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	return engine.Command{Player: seat, Type: engine.CmdSurrender}, true
}

// Ending the game is never a bot's move. runOfferResponses whitelists command
// types; the auto-seat loop must also refuse concede commands from a source.
func TestAutoSeatsIgnoreConcedeCommandsFromBots(t *testing.T) {
	// Seat 0 is an original bot, and the fixture log leaves seat 0 on turn.
	h := loadConcedeActorBots(t, 2, 0)
	var before int
	h.a.call(func() { before = h.a.state.TurnsCompleted })

	// SetSeatBot runs the auto-seat loop synchronously, so by the time it
	// returns the bot has had every chance to try its one move.
	h.a.SetSeatBot(0, surrenderBot{})

	phase, winner := phaseWinner(h.a)
	if phase == engine.PhaseFinished {
		t.Fatalf("a bot surrendered the game (winner %d)", winner)
	}
	var after int
	h.a.call(func() { after = h.a.state.TurnsCompleted })
	if after <= before {
		t.Fatalf("turns %d -> %d: seat did not concede or move", before, after)
	}
}

// Absence has two thresholds. After one lap the seat goes to a bot but keeps
// its player's say, so opponents cannot draw a game away from a brief
// disconnect. After four laps the player is treated as gone, so one absent
// player cannot block a draw forever.
func TestConsentSurvivesShortAbsence(t *testing.T) {
	h := loadConcedeActorBots(t, 3) // every seat human
	const seat engine.PlayerID = 2

	// One lap: driven by the actor, but still speaking for itself.
	h.a.call(func() {
		h.a.absentSince[seat] = 0
		h.a.turnsCompleted = 3 // exactly one lap of a 3-seat table
		h.a.escalateAbsent()
	})
	var auto, consent bool
	h.a.call(func() { auto, consent = h.a.autoSeats[seat], h.a.consentless(seat) })
	if !auto {
		t.Error("a seat absent for a lap should be played by a bot")
	}
	if consent {
		t.Error("a seat absent for one lap must still hold its player's consent")
	}

	// Four laps: gone.
	h.a.call(func() {
		h.a.turnsCompleted = 3 * abandonLaps
		h.a.escalateAbsent()
	})
	h.a.call(func() { consent = h.a.consentless(seat) })
	if !consent {
		t.Error("a seat absent for abandonLaps must stop blocking the table")
	}

	// And coming back restores their say, however long they were gone.
	h.a.MarkPresent(seat)
	h.a.call(func() { consent = h.a.consentless(seat) })
	if consent {
		t.Error("returning to the table must restore the player's own consent")
	}
}
