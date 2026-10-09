package knights

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
)

// A Knights city on commodity terrain collects one resource and one commodity
// from different stacks. So the shortage rule prices the city's claim on the
// resource stack at 1, not 2, and the commodity is owed from its own stack
// whatever the resource stack does.

// forestFixture clears the board of buildings and returns a forest hex with a
// production number, plus the roll that hits it. The robber is moved off it.
func forestFixture(t *testing.T, s *engine.State) (board.Hex, int) {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tl, ok := s.Board.Tiles[h]
		if !ok || tl.Res != board.Wood || tl.Number == 0 || tl.Number == 7 {
			continue
		}
		// Only this forest may carry its number, so no other forest adds claims.
		unique := true
		for h2, t2 := range s.Board.Tiles {
			if h2 != h && t2.Number == tl.Number && t2.Res == board.Wood {
				unique = false
			}
		}
		if !unique {
			continue
		}
		s.Buildings = map[board.Vertex]engine.Building{}
		if s.Board.Robber == h {
			for _, o := range board.HexesInRadius(s.Board.Radius) {
				if o != h && s.Board.Tiles[o].Number != tl.Number {
					s.Board.Robber = o
					break
				}
			}
		}
		return h, tl.Number
	}
	fixtureGone(t, "a forest hex whose number no other forest shares")
	return board.Hex{}, 0
}

// rollNumber rolls a fixed total for the current player through the
// Alchemist's fixed-dice path and settles nothing else.
func rollNumber(t *testing.T, s *engine.State, n int) {
	t.Helper()
	d1 := min(n-1, 6)
	x := ext(s)
	x.AlchemistD1, x.AlchemistD2 = d1, n-d1
	step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
}

func TestKnightsCityClaimsOneResourceUnderShortage(t *testing.T) {
	cases := []struct {
		name       string
		bank       int
		settlement bool   // a second player's settlement on the same forest
		wantCity   [2]int // wood, paper for the city owner
		wantSettle int    // wood for the settlement owner
	}{
		// Knights demand is 1 (city) + 1 (settlement) = 2 <= 2, so both are paid.
		// Control: a full bank pays everyone.
		{"bank covers everyone", 19, true, [2]int{1, 1}, 1},
		{"contested claim the bank covers", 2, true, [2]int{1, 1}, 1},
		// A lone claimant takes what is left: the city is owed 1 wood and there is 1.
		{"lone city, one wood left", 1, false, [2]int{1, 1}, 0},
		// The wood stack is empty, the paper stack is not; the paper is still owed.
		{"lone city, no wood left", 0, false, [2]int{0, 1}, 0},
		// A contested shortage: 2 claims on 1 card, so nobody takes wood, but the
		// commodity is a different stack and is still paid.
		{"contested shortage withholds only the wood", 1, true, [2]int{0, 1}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, _ := newGame(t, 11, nil)
			h, num := forestFixture(t, s)
			cityOwner := s.Cur
			settleOwner := (s.Cur + 1) % engine.PlayerID(len(s.Players))
			vs := h.Vertices()
			s.Buildings[vs[0]] = engine.Building{Owner: cityOwner, City: true}
			if c.settlement {
				s.Buildings[vs[3]] = engine.Building{Owner: settleOwner}
			}
			// Park the surplus wood outside play so the ledger stays whole.
			s.Bank[board.Wood] = c.bank
			woodBefore := s.Players[cityOwner].Hand[board.Wood]
			paperBefore := ext(s).Players[cityOwner].Commodities[Paper]
			settleBefore := s.Players[settleOwner].Hand[board.Wood]

			rollNumber(t, s, num)

			gotWood := s.Players[cityOwner].Hand[board.Wood] - woodBefore
			gotPaper := ext(s).Players[cityOwner].Commodities[Paper] - paperBefore
			if gotWood != c.wantCity[0] || gotPaper != c.wantCity[1] {
				t.Errorf("city owner got %d wood + %d paper, want %d + %d",
					gotWood, gotPaper, c.wantCity[0], c.wantCity[1])
			}
			if got := s.Players[settleOwner].Hand[board.Wood] - settleBefore; got != c.wantSettle {
				t.Errorf("settlement owner got %d wood, want %d", got, c.wantSettle)
			}
			if s.Bank[board.Wood] < 0 {
				t.Errorf("bank wood went negative: %d", s.Bank[board.Wood])
			}
		})
	}
}

// A city on brick or grain has no commodity and still collects 2 of the
// resource, so its claim on that stack is 2.
func TestKnightsCityOnFieldStillClaimsTwo(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	var field board.Hex
	num := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tl, ok := s.Board.Tiles[h]
		if !ok || tl.Res != board.Wheat || tl.Number == 0 {
			continue
		}
		unique := true
		for h2, t2 := range s.Board.Tiles {
			if h2 != h && t2.Number == tl.Number && t2.Res == board.Wheat {
				unique = false
			}
		}
		if unique {
			field, num = h, tl.Number
			break
		}
	}
	if num == 0 {
		fixtureGone(t, "a field hex whose number no other field shares")
	}
	s.Buildings = map[board.Vertex]engine.Building{}
	if s.Board.Robber == field {
		s.Board.Robber = board.OffBoard
	}
	p := s.Cur
	s.Buildings[field.Vertices()[0]] = engine.Building{Owner: p, City: true}
	before := s.Players[p].Hand[board.Wheat]
	rollNumber(t, s, num)
	if got := s.Players[p].Hand[board.Wheat] - before; got != 2 {
		t.Errorf("city on a field collected %d wheat, want 2", got)
	}
}

// aqueductOwed reports whether onEvents owes seat an Aqueduct pick for these
// roll events.
func aqueductOwed(s *engine.State, seat engine.PlayerID, events []engine.Event) bool {
	for _, e := range (Module{}).onEvents(s, events) {
		if e.Type != EvAqueductOwed {
			continue
		}
		if slices.Contains(engine.DecodeEvent[aqueductOwedData](e).Players, seat) {
			return true
		}
	}
	return false
}

// The Aqueduct pays "if you receive no production". A commodity and an Islands
// gold-field pick are both production, though neither is in the core's resource
// grant, so a player whose only income was gold or a commodity must not get the
// consolation too.
func TestAqueductCountsEveryCardTheRollPaid(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	h, num := forestFixture(t, s)
	p := s.Cur
	ext(s).Players[p].Improve[Science] = 3
	roll := func(extra ...engine.Event) []engine.Event {
		d1 := min(num-1, 6)
		return append([]engine.Event{
			engine.NewEvent(engine.EvDiceRolled, engine.DiceRolledData{Player: p, D1: d1, D2: num - d1}),
			engine.NewEvent(engine.EvResDistributed, engine.ResDistributedData{Gains: nil}),
		}, extra...)
	}

	// Control: nothing at all on the board for p, so the Aqueduct pays.
	if !aqueductOwed(s, p, roll()) {
		t.Fatal("control: a roll that paid p nothing must owe the Aqueduct")
	}

	// Gold picks owed to p: that is production.
	gold := engine.NewEvent(islandsGoldOwed, struct {
		Owed []engine.PlayerDiscard `json:"owed"`
	}{Owed: []engine.PlayerDiscard{{Player: p, Count: 2}}})
	if aqueductOwed(s, p, roll(gold)) {
		t.Error("a roll that owed p two gold picks also owed the Aqueduct")
	}

	// A city on the forest whose wood the bank could not pay: the paper still
	// comes, and that is production.
	s.Buildings[h.Vertices()[0]] = engine.Building{Owner: p, City: true}
	if aqueductOwed(s, p, roll()) {
		t.Error("a roll that paid p a paper also owed the Aqueduct")
	}
}

// TestIslandsGoldEventNameMatches pins the literal this module reads Islands'
// gold picks by, since it cannot import the package outside tests.
func TestIslandsGoldEventNameMatches(t *testing.T) {
	if islandsGoldOwed != islands.EvGoldOwed {
		t.Errorf("islandsGoldOwed = %q, engine/islands emits %q", islandsGoldOwed, islands.EvGoldOwed)
	}
}

// The robber blocks the whole hex, commodity included. The commodity is
// claimed from the board, so the robber check has to happen here too.
func TestRobberBlocksTheCommodityToo(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	h, num := forestFixture(t, s)
	p := s.Cur
	s.Buildings[h.Vertices()[0]] = engine.Building{Owner: p, City: true}
	s.Board.Robber = h
	wood, paper := s.Players[p].Hand[board.Wood], ext(s).Players[p].Commodities[Paper]
	rollNumber(t, s, num)
	if gw, gp := s.Players[p].Hand[board.Wood]-wood, ext(s).Players[p].Commodities[Paper]-paper; gw != 0 || gp != 0 {
		t.Errorf("a city under the robber collected %d wood + %d paper, want nothing", gw, gp)
	}
}
