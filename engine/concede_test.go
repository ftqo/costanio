package engine

import (
	"errors"
	"testing"
)

// ready plays the setup draft and fast-forwards the turn counter so draw
// offers and claims are unlocked. Tests that care about the threshold set
// TurnsCompleted themselves instead.
func ready(t *testing.T, players int, seed uint64) *State {
	t.Helper()
	s, _ := newGame(t, players, seed)
	runSetup(t, s)
	s.TurnsCompleted = DrawMinTurns
	return s
}

// mustReject asserts a command is refused with want and leaves the state
// untouched.
func mustReject(t *testing.T, s *State, cmd Command, want error) {
	t.Helper()
	seq, phase, winner := s.NextSeq, s.Phase, s.Winner
	offer := s.DrawOffer
	if _, err := Decide(s, cmd); !errors.Is(err, want) {
		t.Fatalf("Decide(%s by %d) err = %v, want %v", cmd.Type, cmd.Player, err, want)
	}
	if s.NextSeq != seq || s.Phase != phase || s.Winner != winner || s.DrawOffer != offer {
		t.Fatalf("rejected %s mutated state", cmd.Type)
	}
}

func TestSurrenderEndsDuel(t *testing.T) {
	tests := []struct {
		name       string
		conceder   PlayerID
		wantWinner PlayerID
	}{
		{"seat 0 concedes", 0, 1},
		{"seat 1 concedes", 1, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := ready(t, 2, 7)
			events := step(t, s, Command{Player: tc.conceder, Type: CmdSurrender})
			if len(events) != 2 || events[0].Type != EvSurrendered || events[1].Type != EvGameFinished {
				t.Fatalf("events = %v, want surrender then finish", eventTypes(events))
			}
			if s.Phase != PhaseFinished {
				t.Errorf("phase = %s, want finished", s.Phase)
			}
			if s.Winner != tc.wantWinner {
				t.Errorf("winner = %d, want %d", s.Winner, tc.wantWinner)
			}
			d := decode[GameFinishedData](events[1])
			if d.VP != s.VPWithModules(tc.wantWinner) {
				t.Errorf("finish VP = %d, want %d", d.VP, s.VPWithModules(tc.wantWinner))
			}
			// The finished game accepts nothing further.
			if _, err := Decide(s, Command{Player: tc.wantWinner, Type: CmdRollDice}); !errors.Is(err, ErrGameFinished) {
				t.Errorf("post-surrender command err = %v, want ErrGameFinished", err)
			}
		})
	}
}

// A surrender at 3+ seats is refused; leaving there hands the seat to a bot.
func TestSurrenderRejectedAboveTwoPlayers(t *testing.T) {
	for _, players := range []int{3, 4, 6} {
		s := ready(t, players, 11)
		mustReject(t, s, Command{Player: 1, Type: CmdSurrender}, ErrNotDuel)
	}
}

// Surrender does not wait for your turn.
func TestSurrenderOffTurn(t *testing.T) {
	s := ready(t, 2, 3)
	if s.Cur != 0 {
		t.Fatalf("setup left cur = %d, want 0", s.Cur)
	}
	step(t, s, Command{Player: 1, Type: CmdSurrender})
	if s.Phase != PhaseFinished || s.Winner != 0 {
		t.Fatalf("phase %s winner %d, want finished/0", s.Phase, s.Winner)
	}
}

// autoPlay plays minimal legal moves (what an absent seat gets) until the game
// has completed `turns` turns, returning every event so the caller can replay
// the log. Minimal play never builds, so the game never ends on its own: the
// unwinnable position these rules are for.
func autoPlay(t *testing.T, s *State, turns int) []Event {
	t.Helper()
	var log []Event
	for s.TurnsCompleted < turns {
		cmd, ok := AutoCommand(s)
		if !ok {
			t.Fatalf("no auto command at turn %d (phase %s)", s.TurnsCompleted, s.Phase)
		}
		log = append(log, step(t, s, cmd)...)
	}
	return log
}

func TestTurnsCompletedFolds(t *testing.T) {
	s, _ := newGame(t, 3, 5)
	runSetup(t, s)
	if s.TurnsCompleted != 0 {
		t.Fatalf("after setup TurnsCompleted = %d, want 0", s.TurnsCompleted)
	}
	autoPlay(t, s, 4)
	if s.TurnsCompleted != 4 {
		t.Fatalf("TurnsCompleted = %d, want 4", s.TurnsCompleted)
	}
}

func TestDrawRejectedBeforeThreshold(t *testing.T) {
	s, _ := newGame(t, 3, 9)
	runSetup(t, s)
	s.TurnsCompleted = DrawMinTurns - 1
	mustReject(t, s, Command{Player: 0, Type: CmdOfferDraw}, ErrDrawTooEarly)
	mustReject(t, s, Command{Player: 0, Type: CmdClaimGame}, ErrDrawTooEarly)
	// One more completed turn is exactly enough.
	s.TurnsCompleted = DrawMinTurns
	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
	if s.DrawOffer == nil || s.DrawOffer.By != 0 {
		t.Fatalf("draw offer = %+v, want one by seat 0", s.DrawOffer)
	}
}

func TestDrawNeedsEveryOtherSeat(t *testing.T) {
	s := ready(t, 3, 13)
	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
	step(t, s, Command{Player: 1, Type: CmdRespondDraw, Data: mustJSON(t, map[string]any{"accept": true})})
	if s.Phase == PhaseFinished {
		t.Fatal("one acceptance of three seats ended the game")
	}
	if !s.DrawOffer.HasAccepted(1) {
		t.Fatal("seat 1's acceptance was not recorded")
	}
	events := step(t, s, Command{Player: 2, Type: CmdRespondDraw, Data: mustJSON(t, map[string]any{"accept": true})})
	if len(events) != 2 || events[1].Type != EvGameFinished {
		t.Fatalf("events = %v, want response then finish", eventTypes(events))
	}
	if s.Phase != PhaseFinished {
		t.Fatalf("phase = %s, want finished", s.Phase)
	}
	if s.Winner != NoPlayer {
		t.Errorf("winner = %d, want NoPlayer (a draw has none)", s.Winner)
	}
	if d := decode[GameFinishedData](events[1]); d.VP != 0 {
		t.Errorf("finish VP = %d, want 0 for a draw", d.VP)
	}
}

func TestDrawDeclineEndsOffer(t *testing.T) {
	s := ready(t, 3, 17)
	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
	step(t, s, Command{Player: 1, Type: CmdRespondDraw, Data: mustJSON(t, map[string]any{"accept": false})})
	if s.DrawOffer != nil {
		t.Fatal("a decline left the offer open")
	}
	if s.Phase == PhaseFinished {
		t.Fatal("a decline ended the game")
	}
	// Seat 2 has nothing left to answer.
	mustReject(t, s, Command{Player: 2, Type: CmdRespondDraw, Data: mustJSON(t, map[string]any{"accept": true})}, ErrNoDrawOffer)
	// A fresh offer is allowed.
	step(t, s, Command{Player: 2, Type: CmdOfferDraw})
}

func TestDrawOfferRejections(t *testing.T) {
	s := ready(t, 3, 19)
	accept := mustJSON(t, map[string]any{"accept": true})
	// Nothing to answer before an offer exists.
	mustReject(t, s, Command{Player: 1, Type: CmdRespondDraw, Data: accept}, ErrNoDrawOffer)
	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
	// A second offer while one is open.
	mustReject(t, s, Command{Player: 1, Type: CmdOfferDraw}, ErrDrawPending)
	// The offerer cannot answer their own offer.
	mustReject(t, s, Command{Player: 0, Type: CmdRespondDraw, Data: accept}, ErrNoDrawOffer)
	step(t, s, Command{Player: 1, Type: CmdRespondDraw, Data: accept})
	// And cannot answer twice.
	mustReject(t, s, Command{Player: 1, Type: CmdRespondDraw, Data: accept}, ErrAlreadyResponded)
}

// An unanswered offer dies with the turn, like a trade offer.
func TestDrawOfferExpiresAtTurnEnd(t *testing.T) {
	s := ready(t, 3, 23)
	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
	autoPlay(t, s, s.TurnsCompleted+1)
	if s.DrawOffer != nil {
		t.Fatal("draw offer survived the turn")
	}
}

func TestClaimAgainstBots(t *testing.T) {
	tests := []struct {
		name       string
		ahead      bool
		wantWinner PlayerID
	}{
		{"ahead claims the win", true, 0},
		{"level or behind claims a draw", false, NoPlayer},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := ready(t, 3, 29)
			if tc.ahead {
				upgradeOneSettlement(t, s, 0)
			}
			// Setup leaves every seat on two settlements, so without the upgrade seat 0 is
			// only level and must not win by claiming.
			events := step(t, s, Command{Player: 0, Type: CmdClaimGame})
			if len(events) != 2 || events[0].Type != EvGameClaimed || events[1].Type != EvGameFinished {
				t.Fatalf("events = %v, want claim then finish", eventTypes(events))
			}
			if got := decode[GameClaimedData](events[0]).Winner; got != tc.wantWinner {
				t.Errorf("claim winner = %d, want %d", got, tc.wantWinner)
			}
			if s.Phase != PhaseFinished {
				t.Errorf("phase = %s, want finished", s.Phase)
			}
			if s.Winner != tc.wantWinner {
				t.Errorf("winner = %d, want %d", s.Winner, tc.wantWinner)
			}
		})
	}
}

// A claim is decided on true victory points, hidden cards included, since
// dev-card purchases are public and an opponent's unplayed cards can be
// counted. Both halves are asserted: a losing claimer does not win and a
// rightful claim still does.
func TestClaimCountsHiddenVictoryCards(t *testing.T) {
	t.Run("opponent hidden VP blocks claim", func(t *testing.T) {
		s := ready(t, 3, 31)
		upgradeOneSettlement(t, s, 0) // one clear on the count anyone can see
		s.Players[1].DevCards[DevVictoryPoint] = 2
		step(t, s, Command{Player: 0, Type: CmdClaimGame})
		if s.Winner != NoPlayer {
			t.Fatalf("winner = %d, want NoPlayer (claimer behind on true VP)", s.Winner)
		}
	})
	t.Run("own hidden VP counts", func(t *testing.T) {
		s := ready(t, 3, 31)
		s.Players[0].DevCards[DevVictoryPoint] = 3
		step(t, s, Command{Player: 0, Type: CmdClaimGame})
		if s.Winner != 0 {
			t.Fatalf("winner = %d, want seat 0 (hidden VP counted)", s.Winner)
		}
	})
	t.Run("tie on true VP", func(t *testing.T) {
		s := ready(t, 3, 31)
		s.Players[0].DevCards[DevVictoryPoint] = 2
		s.Players[1].DevCards[DevVictoryPoint] = 2
		step(t, s, Command{Player: 0, Type: CmdClaimGame})
		if s.Winner != NoPlayer {
			t.Fatalf("winner = %d, want NoPlayer on a tie", s.Winner)
		}
	})
}

// Every ending replays exactly, including a draw (winner NoPlayer).
func TestConcedeEndingsReplay(t *testing.T) {
	tests := []struct {
		name string
		play func(t *testing.T, s *State) []Event
	}{
		{"surrender", func(t *testing.T, s *State) []Event {
			return step(t, s, Command{Player: 1, Type: CmdSurrender})
		}},
		{"draw", func(t *testing.T, s *State) []Event {
			var out []Event
			out = append(out, step(t, s, Command{Player: 0, Type: CmdOfferDraw})...)
			out = append(out, step(t, s, Command{Player: 1, Type: CmdRespondDraw, Data: mustJSON(t, map[string]any{"accept": true})})...)
			return out
		}},
		{"claim", func(t *testing.T, s *State) []Event {
			return step(t, s, Command{Player: 0, Type: CmdClaimGame})
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s, initial := newGame(t, 2, 37)
			log := append([]Event(nil), initial...)
			// A real log that reaches the threshold, so TurnsCompleted is folded rather
			// than set by hand.
			log = append(log, autoPlay(t, s, DrawMinTurns)...)
			log = append(log, tc.play(t, s)...)

			replayed, err := Replay(log)
			if err != nil {
				t.Fatalf("Replay: %v", err)
			}
			if replayed.Phase != s.Phase || replayed.Winner != s.Winner {
				t.Fatalf("replay = phase %s winner %d, want phase %s winner %d",
					replayed.Phase, replayed.Winner, s.Phase, s.Winner)
			}
			if replayed.TurnsCompleted != s.TurnsCompleted {
				t.Fatalf("replay TurnsCompleted = %d, want %d", replayed.TurnsCompleted, s.TurnsCompleted)
			}
		})
	}
}

func eventTypes(events []Event) []EventType {
	out := make([]EventType, len(events))
	for i, e := range events {
		out[i] = e.Type
	}
	return out
}

// upgradeOneSettlement turns one of p's settlements into a city, putting them a
// point clear of a table that is otherwise level after setup.
func upgradeOneSettlement(t *testing.T, s *State, p PlayerID) {
	t.Helper()
	for v, b := range s.Buildings {
		if b.Owner == p && !b.City {
			s.Buildings[v] = Building{Owner: p, City: true}
			return
		}
	}
	t.Fatalf("seat %d has no settlement to upgrade", p)
}

// Surrender in setup or the first few turns is an abort: it would finish a
// credited match in seconds. The host's reset covers that.
func TestSurrenderRejectedBeforeStart(t *testing.T) {
	// Setup, before a single turn.
	s, _ := newGame(t, 2, 41)
	mustReject(t, s, Command{Player: 0, Type: CmdSurrender}, ErrWrongPhase)

	// Play has begun, but not enough of it.
	runSetup(t, s)
	if s.Phase != PhasePlay {
		t.Fatalf("phase = %s, want play", s.Phase)
	}
	s.TurnsCompleted = SurrenderMinTurns - 1
	mustReject(t, s, Command{Player: 0, Type: CmdSurrender}, ErrSurrenderTooEarly)

	// One more completed turn is enough, and well short of DrawMinTurns.
	if SurrenderMinTurns >= DrawMinTurns {
		t.Fatalf("SurrenderMinTurns (%d) must be far below DrawMinTurns (%d)", SurrenderMinTurns, DrawMinTurns)
	}
	s.TurnsCompleted = SurrenderMinTurns
	step(t, s, Command{Player: 0, Type: CmdSurrender})
	if s.Phase != PhaseFinished || s.Winner != 1 {
		t.Fatalf("phase %s winner %d, want finished/1", s.Phase, s.Winner)
	}
}

// A decline clears the offer, so without a cap one player could loop offers
// all turn, each cycle two persisted, broadcast events. One offer per player
// per turn, folded from the log so replay agrees.
func TestDrawOfferCappedAtOnePerPlayerPerTurn(t *testing.T) {
	s := ready(t, 3, 43)
	decline := mustJSON(t, map[string]any{"accept": false})
	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
	step(t, s, Command{Player: 1, Type: CmdRespondDraw, Data: decline})
	if s.DrawOffer != nil {
		t.Fatal("the decline left the offer open")
	}
	mustReject(t, s, Command{Player: 0, Type: CmdOfferDraw}, ErrDrawOfferUsed)
	// Another seat still has its own offer to spend.
	step(t, s, Command{Player: 2, Type: CmdOfferDraw})
	step(t, s, Command{Player: 0, Type: CmdRespondDraw, Data: decline})

	// The turn ends and everyone may offer again.
	autoPlay(t, s, s.TurnsCompleted+1)
	if len(s.DrawOffersUsed) != 0 {
		t.Fatalf("DrawOffersUsed = %v, want cleared at turn end", s.DrawOffersUsed)
	}
	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
}

// The cap must survive replay, or the live game and its log disagree about
// whether an offer was legal.
func TestDrawOfferCapReplays(t *testing.T) {
	s, initial := newGame(t, 3, 47)
	log := append([]Event(nil), initial...)
	log = append(log, autoPlay(t, s, DrawMinTurns)...)
	log = append(log, step(t, s, Command{Player: 0, Type: CmdOfferDraw})...)
	log = append(log, step(t, s, Command{Player: 1, Type: CmdRespondDraw, Data: mustJSON(t, map[string]any{"accept": false})})...)

	replayed, err := Replay(log)
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if _, err := Decide(replayed, Command{Player: 0, Type: CmdOfferDraw}); !errors.Is(err, ErrDrawOfferUsed) {
		t.Fatalf("replayed state allowed a second offer: err = %v", err)
	}
}

// A draw offer is a modal prompt, so it is refused while a player owes a forced
// discard on a running clock.
func TestDrawOfferRefusedWhileDecisionOwed(t *testing.T) {
	s := ready(t, 3, 53)
	s.PendingDiscards = map[PlayerID]int{1: 4}
	mustReject(t, s, Command{Player: 0, Type: CmdOfferDraw}, ErrModulePending)
	delete(s.PendingDiscards, 1)

	s.RobberPending = true
	mustReject(t, s, Command{Player: 0, Type: CmdOfferDraw}, ErrModulePending)
	s.RobberPending = false

	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
}

// `respond_draw` with no data must be rejected as malformed, not read as a
// decline.
func TestRespondDrawRequiresAnswer(t *testing.T) {
	for _, data := range []string{"", "{}", `{"accept":null}`} {
		s := ready(t, 3, 59)
		step(t, s, Command{Player: 0, Type: CmdOfferDraw})
		cmd := Command{Player: 1, Type: CmdRespondDraw}
		if data != "" {
			cmd.Data = []byte(data)
		}
		mustReject(t, s, cmd, ErrBadCommand)
		if s.DrawOffer == nil {
			t.Fatalf("data %q killed the offer", data)
		}
	}
}

// Only the offer's owner can withdraw it. The game layer sends the same command
// for them when the offer expires.
func TestDrawOfferWithdrawn(t *testing.T) {
	s := ready(t, 3, 61)
	step(t, s, Command{Player: 0, Type: CmdOfferDraw})
	mustReject(t, s, Command{Player: 1, Type: CmdCancelDraw}, ErrNoDrawOffer)
	events := step(t, s, Command{Player: 0, Type: CmdCancelDraw})
	if len(events) != 1 || events[0].Type != EvDrawCancelled {
		t.Fatalf("events = %v, want a single draw_cancelled", eventTypes(events))
	}
	if s.DrawOffer != nil {
		t.Fatal("the offer survived being withdrawn")
	}
	// Withdrawing does not refund the turn's offer, or the cap would be
	// meaningless.
	mustReject(t, s, Command{Player: 0, Type: CmdOfferDraw}, ErrDrawOfferUsed)
	mustReject(t, s, Command{Player: 0, Type: CmdCancelDraw}, ErrNoDrawOffer)
}
