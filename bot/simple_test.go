package bot

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestSimpleAcceptsFavorableOffer(t *testing.T) {
	s := engine.Empty()
	s.Phase = engine.PhasePlay
	s.Players = []engine.PlayerState{{}, {}}
	s.Cur = 0
	s.Players[1].Hand = engine.Hand{1: 4} // seat 1 holds 4 wood (surplus)
	// Offerer gives 1 ore (seat 1 lacks), wants 1 wood (seat 1 has to spare).
	s.ActiveOffer = &engine.TradeOffer{By: 0, Give: engine.Hand{5: 1}, Want: engine.Hand{1: 1}}

	cmd, ok := NewSimple(WithPlayerTrades()).Act(s, 1)
	if !ok || cmd.Type != engine.CmdRespondTrade {
		t.Fatalf("want a respond_trade, got %+v ok=%v", cmd, ok)
	}
	var d engine.TradeRespondedData
	if err := json.Unmarshal(cmd.Data, &d); err != nil {
		t.Fatal(err)
	}
	if !d.Accept {
		t.Error("Simple should accept a clearly favorable offer")
	}
}

func TestSimpleIgnoresOfferByDefault(t *testing.T) {
	s := engine.Empty()
	s.Phase = engine.PhasePlay
	s.Players = []engine.PlayerState{{}, {}}
	s.Cur = 0
	s.Players[1].Hand = engine.Hand{1: 4} // a clearly favorable offer it could accept
	s.ActiveOffer = &engine.TradeOffer{By: 0, Give: engine.Hand{5: 1}, Want: engine.Hand{1: 1}}

	cmd, ok := Simple{}.Act(s, 1) // default: player trades disabled
	if ok && cmd.Type == engine.CmdRespondTrade {
		t.Fatalf("default Simple must not respond to table offers, got %s", cmd.Type)
	}
}

func TestSimpleAbstainsWhenCannotPay(t *testing.T) {
	s := engine.Empty()
	s.Phase = engine.PhasePlay
	s.Players = []engine.PlayerState{{}, {}}
	s.Cur = 0
	s.Players[1].Hand = engine.Hand{} // seat 1 holds nothing
	s.ActiveOffer = &engine.TradeOffer{By: 0, Give: engine.Hand{5: 1}, Want: engine.Hand{1: 1}}
	if _, ok := (Simple{}).Act(s, 1); ok {
		t.Error("Simple cannot pay the want, must abstain")
	}
}

// driveGame plays a full game with Simple in every seat, straight through the
// engine. The bot must keep producing legal commands until someone wins (or
// the cap proves it stalls, which is a failure).
func driveGame(t *testing.T, seed uint64, target int) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, TargetVP: target}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	b := NewSimple()

	for i := 0; i < 30000 && s.Phase != engine.PhaseFinished; i++ {
		seat := actingSeat(s)
		cmd, ok := b.Act(s, seat)
		if !ok {
			t.Fatalf("bot has no move at step %d (phase %s cur %d)", i, s.Phase, s.Cur)
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("bot produced illegal %s at step %d: %v", cmd.Type, i, err)
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	return s
}

// actingSeat mirrors the actor's nextToAct: whoever owes the engine something,
// else the current player. It asks AutoCommand because a module pending (a
// Knights barbarian sacrifice, a metropolis pick) can be owed off-turn and is
// invisible to the base fields.
func actingSeat(s *engine.State) engine.PlayerID {
	if cmd, ok := engine.AutoCommand(s); ok {
		return cmd.Player
	}
	return s.Cur
}

func TestSimpleBotFinishesGames(t *testing.T) {
	for seed := uint64(1); seed <= 3; seed++ {
		s := driveGame(t, seed, 6) // modest target keeps the test quick
		if s.Phase != engine.PhaseFinished {
			t.Fatalf("seed %d: game did not finish", seed)
		}
		if s.VP(s.Winner) < s.Config.TargetVP {
			t.Errorf("seed %d: winner below target", seed)
		}
	}
}

func TestSimpleBotNeverActsOutOfTurn(t *testing.T) {
	log, _ := engine.New(engine.GameConfig{Players: 3}, engine.SeedsFrom(9))
	s := engine.Empty()
	for _, e := range log {
		engine.Apply(s, e)
	}
	b := NewSimple()
	// Seat 2 is asked to act while seat 0 is up in setup.
	if _, ok := b.Act(s, 2); ok {
		t.Error("bot acted for a seat that is not up")
	}
}
