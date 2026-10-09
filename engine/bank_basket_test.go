package engine

import (
	"bytes"
	"errors"
	"math/rand"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// A basket bank trade spends any mix of resource kinds for any mix of other
// kinds in one command, each give kind priced at its own rate. These tests pin
// the legality rule:
//
//	L1 the ask is non-empty
//	L2 no resource on both sides
//	L3 every give kind's stake is a whole multiple of its own rate
//	L4 the stakes fund exactly the ask, no more and no less
//	L5 the player holds the stake
//	L6 the bank holds the ask
//
// plus the two shapes of the command payload (legacy scalar, new basket) and
// the fact that a rejected command changes nothing.

// harborState returns a play-phase game whose only buildings are ones planted
// for player 0 on the named 2:1 harbors, so player 0 trades those resources at
// 2:1 and everything else at 4:1. Skips the seed if the board lacks a harbor.
func harborState(t *testing.T, seed uint64, specific ...board.Resource) *State {
	t.Helper()
	s := playState(t, seed)
	s.Buildings = map[board.Vertex]Building{}
	for _, res := range specific {
		found := false
		for i := range s.Board.Harbors {
			h := s.Board.Harbors[i]
			if h.Ratio == 2 && h.Res == res {
				s.Buildings[h.Verts[0]] = Building{Owner: 0}
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("board for seed %d has no 2:1 %v harbor to plant on", seed, res)
		}
	}
	return s
}

// TestBankBasketTwoPortsOneTrade: a player with 2:1 wood and 2:1 brick
// harbors pays 2 wood + 2 brick for 2 sheep as one command and one event.
func TestBankBasketTwoPortsOneTrade(t *testing.T) {
	s := harborState(t, 20, board.Wood, board.Brick)
	if got := s.bankRatio(0, board.Wood); got != 2 {
		t.Fatalf("wood ratio = %d, want 2", got)
	}
	if got := s.bankRatio(0, board.Brick); got != 2 {
		t.Fatalf("brick ratio = %d, want 2", got)
	}
	s.Players[0].Hand = Hand{board.Wood: 2, board.Brick: 2}
	s.Bank[board.Sheep] = 5
	before := totalCards(s)

	events, err := Decide(s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
		"spend": Hand{board.Wood: 2, board.Brick: 2},
		"want":  Hand{board.Sheep: 2},
	})})
	if err != nil {
		t.Fatalf("basket trade: %v", err)
	}
	if len(events) != 1 || events[0].Type != EvBankTraded {
		t.Fatalf("events = %v, want one bank_traded", events)
	}
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			t.Fatalf("apply: %v", err)
		}
	}
	if want := (Hand{board.Sheep: 2}); s.Players[0].Hand != want {
		t.Errorf("hand after = %v, want %v", s.Players[0].Hand, want)
	}
	if totalCards(s) != before {
		t.Error("cards not conserved")
	}
}

// TestBankBasketMixedRates: give kinds are priced independently, so a 2:1 ore
// stake and a 4:1 wheat stake can fund one ask together.
func TestBankBasketMixedRates(t *testing.T) {
	s := harborState(t, 22, board.Ore)
	s.Players[0].Hand = Hand{board.Ore: 2, board.Wheat: 4}
	s.Bank[board.Sheep] = 5
	s.Bank[board.Brick] = 5

	events, err := Decide(s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
		"spend": Hand{board.Ore: 2, board.Wheat: 4},
		"want":  Hand{board.Sheep: 1, board.Brick: 1},
	})})
	if err != nil {
		t.Fatalf("mixed-rate basket: %v", err)
	}
	d := decode[BankTradedData](events[0])
	if d.Give != (Hand{board.Ore: 2, board.Wheat: 4}) || d.Get != (Hand{board.Sheep: 1, board.Brick: 1}) {
		t.Errorf("event = %+v", d)
	}
}

// TestBankBasketLegality walks the predicate one row at a time. Player 0 has no
// harbors, so every rate is 4:1 unless the row says otherwise.
func TestBankBasketLegality(t *testing.T) {
	huge := 1 << 60
	cases := []struct {
		name  string
		hand  Hand
		spend Hand
		want  Hand
		err   error // nil = legal
	}{
		{"exact single kind", Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{board.Ore: 1}, nil},
		{"two kinds, two units", Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Ore: 2}, nil},
		{"two kinds fund two different kinds", Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Ore: 1, board.Sheep: 1}, nil},
		{"one kind funds two different kinds", Hand{board.Wood: 8}, Hand{board.Wood: 8}, Hand{board.Ore: 1, board.Sheep: 1}, nil},
		// L4: the stake must fund the ask exactly.
		{"underfunded", Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{board.Ore: 2}, ErrBadTrade},
		{"overfunded", Hand{board.Wood: 8}, Hand{board.Wood: 8}, Hand{board.Ore: 1}, ErrBadTrade},
		// L3: no burning an odd card. 4 wood + 3 brick pays for one card and wastes
		// three, which is refused.
		{"indivisible stake", Hand{board.Wood: 4, board.Brick: 3}, Hand{board.Wood: 4, board.Brick: 3}, Hand{board.Ore: 1}, ErrBadTrade},
		{"single indivisible stake", Hand{board.Wood: 3}, Hand{board.Wood: 3}, Hand{board.Ore: 1}, ErrBadTrade},
		// L2: no resource on both sides, even when other kinds also move.
		{"same kind both sides", Hand{board.Wood: 8}, Hand{board.Wood: 8}, Hand{board.Wood: 2}, ErrSameResource},
		{"overlap alongside a legal leg", Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Brick: 1, board.Ore: 1}, ErrSameResource},
		// L5 / L6.
		{"hand short", Hand{board.Wood: 3}, Hand{board.Wood: 4}, Hand{board.Ore: 1}, ErrNoResources},
		{"hand short on the second kind", Hand{board.Wood: 4}, Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Ore: 2}, ErrNoResources},
		// L1 and malformed payloads.
		{"empty ask", Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{}, ErrBadCommand},
		{"empty stake", Hand{board.Wood: 4}, Hand{}, Hand{board.Ore: 1}, ErrBadTrade},
		{"negative stake", Hand{board.Wood: 4}, Hand{board.Wood: -4}, Hand{board.Ore: 1}, ErrBadCommand},
		{"negative ask", Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{board.Ore: -1}, ErrBadCommand},
		{"unused slot in the stake", Hand{board.Wood: 4}, Hand{0: 4}, Hand{board.Ore: 1}, ErrBadCommand},
		{"unused slot in the ask", Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{0: 1}, ErrBadCommand},
		// Absurd counts are bounded by the bank and the hand before any
		// multiplication, so nothing overflows.
		{"huge ask", Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{board.Ore: huge}, ErrNoResources},
		{"huge stake", Hand{board.Wood: 4}, Hand{board.Wood: huge}, Hand{board.Ore: 1}, ErrNoResources},
		{"huge on both sides", Hand{board.Wood: 4}, Hand{board.Wood: huge}, Hand{board.Ore: huge}, ErrNoResources},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := harborState(t, 20)
			s.Players[0].Hand = tc.hand
			before := deepCopyState(t, s)

			events, err := Decide(s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
				"spend": tc.spend,
				"want":  tc.want,
			})})
			if !errors.Is(err, tc.err) {
				t.Fatalf("err = %v, want %v", err, tc.err)
			}
			// A rejected command changes nothing, and Decide never mutates.
			if !reflect.DeepEqual(before, deepCopyState(t, s)) {
				t.Error("Decide mutated the state")
			}
			if tc.err != nil {
				return
			}
			d := decode[BankTradedData](events[0])
			if d.Give != tc.spend || d.Get != tc.want {
				t.Errorf("event = %+v, want give %v get %v", d, tc.spend, tc.want)
			}
		})
	}
}

// TestBankBasketBankStock: the bank must cover every kind asked for, checked
// before anything is emitted, so a basket is never half-filled.
func TestBankBasketBankStock(t *testing.T) {
	s := harborState(t, 25)
	s.Players[0].Hand = Hand{board.Wood: 8}
	s.Bank[board.Ore] = 1
	s.Bank[board.Sheep] = 0 // drained

	_, err := Decide(s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
		"spend": Hand{board.Wood: 8},
		"want":  Hand{board.Ore: 1, board.Sheep: 1},
	})})
	if !errors.Is(err, ErrNoResources) {
		t.Fatalf("err = %v, want ErrNoResources", err)
	}
	// The affordable half of the same basket is untouched by the rejection.
	if s.Players[0].Hand[board.Wood] != 8 {
		t.Errorf("hand = %v, want the stake still in hand", s.Players[0].Hand)
	}
}

// TestBankBasketOutOfTurn: the turn gate is the same one the scalar form uses.
func TestBankBasketOutOfTurn(t *testing.T) {
	s := harborState(t, 26)
	s.Players[1].Hand = Hand{board.Wood: 4}
	_, err := Decide(s, Command{Player: 1, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
		"spend": Hand{board.Wood: 4},
		"want":  Hand{board.Ore: 1},
	})})
	if !errors.Is(err, ErrNotYourTurn) {
		t.Errorf("err = %v, want ErrNotYourTurn", err)
	}
}

// TestBankBasketLegacyPayloadUnchanged: the old {give, get, count} shape keeps
// its exact meaning, including the count<=0 default and the bank bound, for
// older clients and commands in flight across a deploy.
func TestBankBasketLegacyPayloadUnchanged(t *testing.T) {
	cases := []struct {
		name string
		data map[string]any
		hand Hand
		give Hand
		get  Hand
		err  error
	}{
		{"explicit count", map[string]any{"give": board.Wood, "get": board.Ore, "count": 2}, Hand{board.Wood: 8}, Hand{board.Wood: 8}, Hand{board.Ore: 2}, nil},
		{"missing count means one", map[string]any{"give": board.Wood, "get": board.Ore}, Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{board.Ore: 1}, nil},
		{"zero count means one", map[string]any{"give": board.Wood, "get": board.Ore, "count": 0}, Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{board.Ore: 1}, nil},
		{"negative count means one", map[string]any{"give": board.Wood, "get": board.Ore, "count": -3}, Hand{board.Wood: 4}, Hand{board.Wood: 4}, Hand{board.Ore: 1}, nil},
		{"like for like", map[string]any{"give": board.Wood, "get": board.Wood}, Hand{board.Wood: 4}, Hand{}, Hand{}, ErrSameResource},
		{"unknown resource", map[string]any{"give": "gold", "get": "ore"}, Hand{board.Wood: 4}, Hand{}, Hand{}, ErrBadCommand},
		{"count beyond the bank", map[string]any{"give": board.Wood, "get": board.Ore, "count": 1 << 60}, Hand{board.Wood: 8}, Hand{}, Hand{}, ErrNoResources},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := harborState(t, 27)
			s.Players[0].Hand = tc.hand
			events, err := Decide(s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, tc.data)})
			if !errors.Is(err, tc.err) {
				t.Fatalf("err = %v, want %v", err, tc.err)
			}
			if tc.err != nil {
				return
			}
			d := decode[BankTradedData](events[0])
			if d.Give != tc.give || d.Get != tc.get {
				t.Errorf("event = %+v, want give %v get %v", d, tc.give, tc.get)
			}
		})
	}
}

// TestBankBasketSolves: with no stake stated, the engine pays for the ask
// itself, cheapest kinds first, and never touches a kind that is being bought.
func TestBankBasketSolves(t *testing.T) {
	s := harborState(t, 28, board.Ore)
	// Ore is 2:1, everything else 4:1. Asking for 2 sheep spends the two ore
	// first, then tops up from a 4:1 kind; wood beats wheat only by canonical
	// resource order.
	s.Players[0].Hand = Hand{board.Ore: 2, board.Wheat: 8, board.Wood: 8}
	s.Bank[board.Sheep] = 5

	events, err := Decide(s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
		"want": Hand{board.Sheep: 2},
	})})
	if err != nil {
		t.Fatalf("solve: %v", err)
	}
	d := decode[BankTradedData](events[0])
	if want := (Hand{board.Ore: 2, board.Wood: 4}); d.Give != want {
		t.Errorf("solved stake = %v, want %v", d.Give, want)
	}
	if want := (Hand{board.Sheep: 2}); d.Get != want {
		t.Errorf("get = %v, want %v", d.Get, want)
	}
}

// TestBankBasketSolveSkipsBuildCost: L2 binds the solver too, so a hand
// that could only pay with the asked-for kind is unaffordable.
func TestBankBasketSolveSkipsBuildCost(t *testing.T) {
	s := harborState(t, 29)
	s.Players[0].Hand = Hand{board.Ore: 8}
	_, err := Decide(s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
		"want": Hand{board.Ore: 1},
	})})
	if !errors.Is(err, ErrNoResources) {
		t.Errorf("err = %v, want ErrNoResources", err)
	}
}

// TestBankBasketDeterministic: the same state and command produce the same
// bytes every time, which catches map iteration leaking into the solver.
func TestBankBasketDeterministic(t *testing.T) {
	s := harborState(t, 30, board.Ore, board.Wood)
	s.Players[0].Hand = Hand{board.Ore: 4, board.Wood: 4, board.Wheat: 8, board.Brick: 8}
	s.Bank[board.Sheep] = 10
	cmd := Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
		"want": Hand{board.Sheep: 5},
	})}
	first, err := Decide(s, cmd)
	if err != nil {
		t.Fatalf("solve: %v", err)
	}
	for range 500 {
		got, err := Decide(s, cmd)
		if err != nil {
			t.Fatalf("solve: %v", err)
		}
		if len(got) != len(first) || !bytes.Equal(got[0].Data, first[0].Data) {
			t.Fatalf("non-deterministic emission: %s vs %s", got[0].Data, first[0].Data)
		}
	}
}

// TestSolveBankSpendIsOptimal checks the greedy solver against brute force on
// random rates, hands and asks: it must find a payment exactly when one exists,
// and always the cheapest in cards. Greedy relies on each kind's price being
// independent of the others.
func TestSolveBankSpendIsOptimal(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	for range 3000 {
		var ratios [6]int
		var pool, want Hand
		for _, r := range board.Resources {
			ratios[r] = 2 + rng.Intn(3)
			pool[r] = rng.Intn(7)
			if rng.Intn(3) == 0 {
				want[r] = 1 + rng.Intn(2)
			}
		}
		if want.Count() == 0 {
			continue
		}
		// Rule L2: a kind being bought is not available to spend.
		for _, r := range board.Resources {
			if want[r] > 0 {
				pool[r] = 0
			}
		}
		got, ok := solveBankSpend(ratios, pool, want)
		bestCost, found := bruteForceSpend(ratios, pool, want)
		if ok != found {
			t.Fatalf("ratios %v pool %v want %v: solver ok=%v, brute force found=%v", ratios, pool, want, ok, found)
		}
		if !ok {
			continue
		}
		if got.Count() != bestCost {
			t.Fatalf("ratios %v pool %v want %v: solver spent %d (%v), optimum is %d", ratios, pool, want, got.Count(), got, bestCost)
		}
		// And its answer has to be legal on its own terms.
		units := 0
		for _, r := range board.Resources {
			if got[r]%ratios[r] != 0 {
				t.Fatalf("stake %v is not a whole multiple of the rates %v", got, ratios)
			}
			if got[r] > pool[r] {
				t.Fatalf("stake %v exceeds the pool %v", got, pool)
			}
			units += got[r] / ratios[r]
		}
		if units != want.Count() {
			t.Fatalf("stake %v funds %d units, ask is %d", got, units, want.Count())
		}
	}
}

// bruteForceSpend enumerates every affordable number of units per kind and
// returns the cheapest total that funds the ask exactly.
func bruteForceSpend(ratios [6]int, pool, want Hand) (int, bool) {
	need := want.Count()
	best, found := 0, false
	var rec func(i, left, cost int)
	rec = func(i, left, cost int) {
		if i == len(board.Resources) {
			if left == 0 && (!found || cost < best) {
				best, found = cost, true
			}
			return
		}
		r := board.Resources[i]
		max := pool[r] / ratios[r]
		for u := 0; u <= max && u <= left; u++ {
			rec(i+1, left-u, cost+u*ratios[r])
		}
	}
	rec(0, need, 0)
	return best, found
}

// deepCopyState round-trips the state so a test can compare before/after
// without sharing maps with the live copy.
func deepCopyState(t *testing.T, s *State) *State {
	t.Helper()
	return s.Clone()
}
