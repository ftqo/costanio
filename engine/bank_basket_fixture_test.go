package engine

import (
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// The frontend decides whether a basket is a legal trade before the button is
// pressed, so the predicate exists twice: here and in `maritimeTrade` in
// frontend/src/lib/bank.ts. This test writes the table below to a fixture the
// frontend's `bank.legality.test.ts` reads, so a rule change on either side
// fails on the other. It is a golden file:
// `go test ./engine -run TestBankBasketFixture -update` rewrites it.
//
// Only cases a client can construct are included. Negative counts, a number in
// the unused index-0 slot and 2^60 asks are refused by the engine
// (TestBankBasketLegality) but a picker cannot produce them.

var updateFixture = flag.Bool("update", false, "rewrite the shared bank-basket fixture")

type fixtureCase struct {
	Name string `json:"name"`
	// Rates by resource index, 1..5 (index 0 unused), as the view's `bank_ratios`
	// carries them.
	Ratios [6]int `json:"ratios"`
	Hand   [6]int `json:"hand"`
	Bank   [6]int `json:"bank"`
	Spend  [6]int `json:"spend"`
	Want   [6]int `json:"want"`
	// Legal is what the frontend must match: would the server accept this? Err
	// names the reason, for a reader of the fixture.
	Legal bool   `json:"legal"`
	Err   string `json:"err,omitempty"`
}

func fixturePath(t *testing.T) string {
	t.Helper()
	return filepath.Join("..", "frontend", "src", "lib", "__fixtures__", "bank-basket-legality.json")
}

func TestBankBasketFixture(t *testing.T) {
	// A generous bank everywhere except where a row is testing scarcity.
	full := Hand{board.Wood: 19, board.Brick: 19, board.Sheep: 19, board.Wheat: 19, board.Ore: 19}
	ports := func(pairs ...any) [6]int {
		r := [6]int{0, 4, 4, 4, 4, 4}
		for i := 0; i+1 < len(pairs); i += 2 {
			r[pairs[i].(board.Resource)] = pairs[i+1].(int)
		}
		return r
	}
	flat := ports()

	cases := []struct {
		name   string
		ratios [6]int
		hand   Hand
		bank   Hand
		spend  Hand
		want   Hand
		err    error
	}{
		{"exact single kind", flat, Hand{board.Wood: 4}, full, Hand{board.Wood: 4}, Hand{board.Ore: 1}, nil},
		{"one kind funds two different kinds", flat, Hand{board.Wood: 8}, full, Hand{board.Wood: 8}, Hand{board.Ore: 1, board.Sheep: 1}, nil},
		{"two kinds, one ask", flat, Hand{board.Wood: 4, board.Brick: 4}, full, Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Ore: 2}, nil},
		{"two kinds fund two different kinds", flat, Hand{board.Wood: 4, board.Brick: 4}, full, Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Ore: 1, board.Sheep: 1}, nil},

		// The reported case: two 2:1 ports, four cards, two of one kind back.
		{"two 2:1 ports in one trade", ports(board.Wood, 2, board.Brick, 2), Hand{board.Wood: 2, board.Brick: 2}, full, Hand{board.Wood: 2, board.Brick: 2}, Hand{board.Sheep: 2}, nil},
		{"a 2:1 port buys two different kinds", ports(board.Wood, 2), Hand{board.Wood: 4}, full, Hand{board.Wood: 4}, Hand{board.Sheep: 1, board.Brick: 1}, nil},
		{"mixed rates fund one ask", ports(board.Ore, 2), Hand{board.Ore: 2, board.Wheat: 4}, full, Hand{board.Ore: 2, board.Wheat: 4}, Hand{board.Sheep: 1, board.Brick: 1}, nil},
		{"a 3:1 generic port", ports(board.Wood, 3, board.Brick, 3, board.Sheep, 3, board.Wheat, 3, board.Ore, 3), Hand{board.Wood: 3}, full, Hand{board.Wood: 3}, Hand{board.Ore: 1}, nil},

		// L4: the stake funds the ask exactly, neither less nor more.
		{"underfunded", flat, Hand{board.Wood: 4}, full, Hand{board.Wood: 4}, Hand{board.Ore: 2}, ErrBadTrade},
		{"overfunded", flat, Hand{board.Wood: 8}, full, Hand{board.Wood: 8}, Hand{board.Ore: 1}, ErrBadTrade},

		// L3: no odd card burnt, in a mixed basket or alone.
		{"indivisible stake in a mixed basket", flat, Hand{board.Wood: 4, board.Brick: 3}, full, Hand{board.Wood: 4, board.Brick: 3}, Hand{board.Ore: 1}, ErrBadTrade},
		{"single indivisible stake", flat, Hand{board.Wood: 3}, full, Hand{board.Wood: 3}, Hand{board.Ore: 1}, ErrBadTrade},
		{"odd card at a port rate", ports(board.Wood, 2), Hand{board.Wood: 3}, full, Hand{board.Wood: 3}, Hand{board.Ore: 1}, ErrBadTrade},

		// L2: a kind on both sides is two trades, never one.
		{"same kind both sides", flat, Hand{board.Wood: 8}, full, Hand{board.Wood: 8}, Hand{board.Wood: 2}, ErrSameResource},
		{"overlap alongside a legal leg", flat, Hand{board.Wood: 4, board.Brick: 4}, full, Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Brick: 1, board.Ore: 1}, ErrSameResource},

		// L5 / L6: the hand pays and the bank supplies.
		{"hand short", flat, Hand{board.Wood: 3}, full, Hand{board.Wood: 4}, Hand{board.Ore: 1}, ErrNoResources},
		{"hand short on the second kind", flat, Hand{board.Wood: 4}, full, Hand{board.Wood: 4, board.Brick: 4}, Hand{board.Ore: 2}, ErrNoResources},
		{"bank dry of the asked kind", flat, Hand{board.Wood: 4}, Hand{board.Wood: 19, board.Ore: 0}, Hand{board.Wood: 4}, Hand{board.Ore: 1}, ErrNoResources},
		{"bank short on one of two asked kinds", flat, Hand{board.Wood: 8}, Hand{board.Wood: 19, board.Ore: 1, board.Sheep: 0}, Hand{board.Wood: 8}, Hand{board.Ore: 1, board.Sheep: 1}, ErrNoResources},

		// L1: an empty side is not a trade.
		{"empty ask", flat, Hand{board.Wood: 4}, full, Hand{board.Wood: 4}, Hand{}, ErrBadCommand},
		{"empty stake", flat, Hand{board.Wood: 4}, full, Hand{}, Hand{board.Ore: 1}, ErrBadTrade},
	}

	built := make([]fixtureCase, 0, len(cases))
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := ratioState(t, tc.ratios)
			s.Players[0].Hand = tc.hand
			s.Bank = tc.bank

			_, err := Decide(s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{
				"spend": tc.spend,
				"want":  tc.want,
			})})
			if !errors.Is(err, tc.err) {
				t.Fatalf("engine says %v, fixture claims %v", err, tc.err)
			}
		})
		name := ""
		if tc.err != nil {
			name = tc.err.Error()
		}
		built = append(built, fixtureCase{
			Name: tc.name, Ratios: tc.ratios, Hand: [6]int(tc.hand), Bank: [6]int(tc.bank),
			Spend: [6]int(tc.spend), Want: [6]int(tc.want), Legal: tc.err == nil, Err: name,
		})
	}

	want, err := json.MarshalIndent(map[string]any{
		"note":  "Generated by engine.TestBankBasketFixture (go test ./engine -run TestBankBasketFixture -update). The frontend's bank.legality.test.ts asserts maritimeTrade agrees with every row.",
		"cases": built,
	}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want = append(want, '\n')

	path := fixturePath(t)
	if *updateFixture {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, want, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", path)
		return
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v: run go test ./engine -run TestBankBasketFixture -update", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s is stale: run go test ./engine -run TestBankBasketFixture -update", path)
	}
}

// ratioState builds a state whose player 0 has exactly the given rates by
// planting the harbors that produce them.
func ratioState(t *testing.T, ratios [6]int) *State {
	t.Helper()
	s := playState(t, 20)
	s.Buildings = map[board.Vertex]Building{}
	for res := board.Wood; res <= board.Ore; res++ {
		want := ratios[res]
		if want >= 4 {
			continue
		}
		found := false
		for i := range s.Board.Harbors {
			h := s.Board.Harbors[i]
			if h.Ratio != want {
				continue
			}
			if want == 2 && h.Res != res {
				continue
			}
			s.Buildings[h.Verts[0]] = Building{Owner: 0}
			found = true
			break
		}
		if !found {
			// Fixed seed, so a missing harbor means the board changed under the fixture;
			// fail rather than skip.
			t.Fatalf("board has no %d:1 harbor for %v to plant on", want, res)
		}
	}
	for res := board.Wood; res <= board.Ore; res++ {
		if got := s.bankRatio(0, res); got != ratios[res] {
			t.Fatalf("planted harbors give %v rate %d, want %d", res, got, ratios[res])
		}
	}
	return s
}
