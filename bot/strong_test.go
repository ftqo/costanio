package bot

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func mustUnmarshal(t *testing.T, data json.RawMessage, v any) {
	t.Helper()
	if err := json.Unmarshal(data, v); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
}

// respond() prices an offer with the evaluator: take a trade that improves the
// position, decline one that does not.
func TestStrongRespondsOnValue(t *testing.T) {
	offer := func(give, want engine.Hand) *engine.State {
		s := newBaseGame(t, 3)
		s.Phase = engine.PhasePlay
		s.Cur = 0
		s.Players[1].Hand = engine.Hand{board.Wood: 4, board.Brick: 1}
		s.ActiveOffer = &engine.TradeOffer{By: 0, Give: give, Want: want}
		return s
	}

	// Lopsided against seat 1: two of its wood for one ore. It should not take
	// it, and it should SAY so (see TestStrongDeclinesOutLoud).
	cmd, ok := NewStrong().Act(offer(engine.Hand{board.Ore: 1}, engine.Hand{board.Wood: 2}), 1)
	if ok && cmd.Type == engine.CmdRespondTrade {
		var d engine.TradeRespondedData
		mustUnmarshal(t, cmd.Data, &d)
		if d.Accept {
			t.Errorf("accepted a trade that costs two cards for one")
		}
	}

	// A seat drowning in wood swapping one spare for a card it holds none of
	// should be worth taking.
	cmd, ok = NewStrong().Act(offer(engine.Hand{board.Ore: 1}, engine.Hand{board.Wood: 1}), 1)
	if !ok {
		t.Fatal("did not respond to a favourable one-for-one")
	}
	if cmd.Type != engine.CmdRespondTrade && cmd.Type != engine.CmdCounterTrade {
		t.Errorf("expected a trade response, got %s", cmd.Type)
	}

	// And the knob still turns the whole thing off.
	cmd, ok = NewStrong(WithoutPlayerTrades()).Act(offer(engine.Hand{board.Ore: 1}, engine.Hand{board.Wood: 1}), 1)
	if ok && (cmd.Type == engine.CmdRespondTrade || cmd.Type == engine.CmdCounterTrade) {
		t.Errorf("WithoutPlayerTrades must not engage table trades, got %s", cmd.Type)
	}
}

// A bot that will not take an offer declines it explicitly, so a human offerer
// is not left waiting. Covers a hand that cannot pay and a price not worth
// taking or countering. (A counter is also an answer.)
func TestStrongDeclinesOutLoud(t *testing.T) {
	cases := []struct {
		name  string
		setup func(s *engine.State)
	}{
		{"bad price, nothing to counter with", func(s *engine.State) {
			// Two wood for a brick it already has plenty of; its most abundant
			// card is the one on offer, so no counter either.
			s.Players[0].Hand = engine.Hand{board.Brick: 1}
			s.Players[1].Hand = engine.Hand{board.Wood: 2, board.Brick: 3}
			s.ActiveOffer = &engine.TradeOffer{By: 0, Give: engine.Hand{board.Brick: 1}, Want: engine.Hand{board.Wood: 2}}
		}},
		{"cannot pay", func(s *engine.State) {
			s.Players[1].Hand = engine.Hand{}
			s.ActiveOffer = &engine.TradeOffer{By: 0, Give: engine.Hand{board.Ore: 1}, Want: engine.Hand{board.Wood: 1}}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newBaseGame(t, 3)
			s.Phase = engine.PhasePlay
			s.Cur = 0
			s.Rolled = true
			s.Players[0].Hand = engine.Hand{board.Ore: 1} // the offerer can honour it
			tc.setup(s)
			cmd, ok := NewStrong().Act(s, 1)
			if !ok || cmd.Type != engine.CmdRespondTrade {
				t.Fatalf("want an explicit respond_trade decline, got %+v ok=%v", cmd, ok)
			}
			var d engine.TradeRespondedData
			mustUnmarshal(t, cmd.Data, &d)
			if d.Accept || d.Retract {
				t.Fatalf("want a plain decline, got %+v", d)
			}
			// The engine must accept the decline.
			evs, err := engine.Decide(s, cmd)
			if err != nil {
				t.Fatalf("engine refused the decline: %v", err)
			}
			for _, e := range evs {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			if !s.ActiveOffer.Responded(1) {
				t.Fatal("seat 1 still reads as not having answered")
			}
			// Answered once, the bot is done: no second word on the same offer.
			if cmd, ok := NewStrong().Act(s, 1); ok && cmd.Type == engine.CmdRespondTrade {
				t.Fatalf("answered twice: %+v", cmd)
			}
		})
	}
	// Simple, once it trades at all, answers the same way.
	s := newBaseGame(t, 3)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Players[0].Hand = engine.Hand{board.Ore: 1}
	s.Players[1].Hand = engine.Hand{}
	s.ActiveOffer = &engine.TradeOffer{By: 0, Give: engine.Hand{board.Ore: 1}, Want: engine.Hand{board.Wood: 1}}
	cmd, ok := NewSimple(WithPlayerTrades()).Act(s, 1)
	if !ok || cmd.Type != engine.CmdRespondTrade {
		t.Fatalf("Simple: want a decline, got %+v ok=%v", cmd, ok)
	}
}

func TestPips(t *testing.T) {
	want := map[int]int{2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 0, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1, 0: 0}
	for n, w := range want {
		if got := pips(n); got != w {
			t.Errorf("pips(%d) = %d, want %d", n, got, w)
		}
	}
}

// newBaseGame builds a 4-player base game folded into state.
func newBaseGame(t *testing.T, seed uint64) *engine.State {
	t.Helper()
	events, err := engine.New(engine.GameConfig{Players: 4}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func TestSetupPicksHighValueSpot(t *testing.T) {
	s := newBaseGame(t, 1)
	b := NewStrong()
	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != engine.CmdPlaceSettlement {
		t.Fatalf("expected a setup settlement, got %+v ok=%v", cmd, ok)
	}
	// The chosen spot must be among the highest-pip open spots.
	var chosen struct {
		V board.Vertex `json:"v"`
	}
	mustUnmarshal(t, cmd.Data, &chosen)
	chosenPips := vertexPips(s, chosen.V)

	bestPips := 0.0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if engine.CheckSettlementSpot(s, v) == nil {
				if p := vertexPips(s, v); p > bestPips {
					bestPips = p
				}
			}
		}
	}
	// Allow some slack: the bot balances pips with diversity/ports, but it
	// shouldn't pick a clearly poor spot.
	if chosenPips < bestPips*0.6 {
		t.Errorf("setup spot pips %.0f far below best %.0f", chosenPips, bestPips)
	}
}

func TestRobberTargetsAndSpares(t *testing.T) {
	s := newBaseGame(t, 2)
	// Hand-place: seat 0 (the mover) on a hex, an opponent (seat 1) on a
	// richer hex; the robber should go to the opponent, not seat 0.
	var ownHex, oppHex board.Hex
	got := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if t2, ok := s.Board.Tiles[h]; ok && t2.Res.Producing() && h != s.Board.Robber {
			if got != 0 {
				oppHex = h
				break
			}
			ownHex = h
			got++
		}
	}
	s.Buildings[ownHex.Vertices()[0]] = engine.Building{Owner: 0}
	s.Buildings[oppHex.Vertices()[0]] = engine.Building{Owner: 1, City: true}
	s.Players[1].Hand = engine.Hand{board.Ore: 2}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	s.RobberPending = true

	b := NewStrong()
	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != engine.CmdMoveRobber {
		t.Fatalf("expected move_robber, got %+v ok=%v", cmd, ok)
	}
	var d struct {
		Hex    board.Hex        `json:"hex"`
		Victim *engine.PlayerID `json:"victim"`
	}
	mustUnmarshal(t, cmd.Data, &d)
	if d.Hex == ownHex {
		t.Error("robber placed on the bot's own hex")
	}
	for _, v := range d.Hex.Vertices() {
		if bld, ok := s.Buildings[v]; ok && bld.Owner == 0 {
			t.Error("robber hex still touches the bot's own building")
		}
	}
}

func TestSecondSettlementSeeksDiversity(t *testing.T) {
	s := newBaseGame(t, 31)
	b := NewStrong()

	// Place seat 0's first settlement on a producing spot, then ask for the next
	// setup placement; it should favor a producing spot (ideally adding new
	// resources). Assert it produces something.
	var first board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if vertexPips(s, v) > 0 {
				first = v
				break
			}
		}
		if (first != board.Vertex{}) {
			break
		}
	}
	s.Buildings[first] = engine.Building{Owner: 0}
	s.Phase = engine.PhaseSetup
	s.Cur = 0
	s.NeedRoad = false

	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != engine.CmdPlaceSettlement {
		t.Fatalf("expected a setup settlement, got %+v ok=%v", cmd, ok)
	}
	var d struct {
		V board.Vertex `json:"v"`
	}
	mustUnmarshal(t, cmd.Data, &d)
	if vertexPips(s, d.V) == 0 {
		t.Errorf("second settlement %+v produces nothing", d.V)
	}
}

func TestDiscardDropsSurplus(t *testing.T) {
	s := newBaseGame(t, 3)
	b := NewStrong()
	s.Players[0].Hand = engine.Hand{board.Wood: 6, board.Ore: 2}
	out := b.chooseDiscard(s, 0, 4)
	if out.Count() != 4 {
		t.Fatalf("discarded %d, want 4", out.Count())
	}
	// It should shed mostly wood (the big surplus), keeping ore.
	if out[board.Wood] < 3 {
		t.Errorf("kept too much wood; discard = %v", out)
	}
	if out[board.Ore] > 1 {
		t.Errorf("discarded too much ore; discard = %v", out)
	}
	if !s.Players[0].Hand.Has(out) {
		t.Error("discard exceeds hand")
	}
}

func TestTradeTowardBuildKeepsNeeded(t *testing.T) {
	s := newBaseGame(t, 51)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	b := NewStrong()
	s.Bank = engine.Hand{board.Wood: 9, board.Brick: 9, board.Sheep: 9, board.Wheat: 9, board.Ore: 9}
	s.Players[0].Hand = engine.Hand{board.Wood: 8}

	cmd, ok := b.tradeTowardBuild(s, 0)
	if ok {
		if cmd.Type != engine.CmdBankTrade {
			t.Fatalf("expected a bank trade, got %+v", cmd)
		}
		var d struct {
			Give board.Resource `json:"give"`
			Get  board.Resource `json:"get"`
		}
		mustUnmarshal(t, cmd.Data, &d)
		if d.Give != board.Wood {
			t.Errorf("traded away %v, want wood (the surplus)", d.Give)
		}
		if d.Get == board.Wood {
			t.Errorf("traded wood for wood")
		}
	}
	// ok may be false if no build is worth trading for in this layout; the
	// assertion only constrains the trade when one is made.
}
