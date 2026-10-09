package wagons

import (
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/rivers"
)

// riversWagonsRulesets is every valid ruleset carrying both modules, from the
// engine's enumerator so new companions join the sweep automatically.
func riversWagonsRulesets(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, rs := range engine.ValidRulesets() {
		parts := strings.Split(rs, "+")
		has := func(n string) bool { return slices.Contains(parts, n) }
		if has("rivers") && has(WagonsName) {
			out = append(out, rs)
		}
	}
	if len(out) == 0 {
		t.Fatal("no valid ruleset carries both rivers and wagons")
	}
	return out
}

// Ruling (docs/rules/wagons.md and docs/rules/rivers.md, "With Wagons"): a
// trade hex never sits on a river hex; the river moves instead. This checks
// that no trade hex (nor any cape one could be chosen from) carries a channel,
// the trade triple is still three alternating corners 2R apart, and the board
// still has every river the Rivers count asks for.
func TestTradeHexesNeverSitOnARiver(t *testing.T) {
	// The pairing over 12 seeds at every player count, plus every companion
	// combination on one seed at one player count per radius (3, 5 and 8 seats
	// are radius 2, 3 and 4), so the board-reshaping companions (lake, oasis,
	// castle) are each crossed with the reservation. Kept small for -race: a
	// radius-4 Rivers derivation costs ~240ms under it.
	type row struct {
		players []int
		lo, hi  uint64
	}
	every := []int{}
	for p := engine.MinPlayers; p <= engine.MaxPlayers; p++ {
		every = append(every, p)
	}
	for i, rs := range riversWagonsRulesets(t) {
		w := row{players: []int{3, 5, 8}, lo: uint64(100 + i), hi: uint64(100 + i)}
		if rs == "base+rivers+wagons" {
			w = row{players: every, lo: 1, hi: 12}
		}
		for _, players := range w.players {
			for seed := w.lo; seed <= w.hi; seed++ {
				evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs},
					engine.Seeds{Public: seed, Private: seed ^ 0x9E37})
				if err != nil {
					t.Fatalf("%s/%dp/seed %d: new: %v", rs, players, seed, err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatalf("%s/%dp/seed %d: replay: %v", rs, players, seed, err)
				}
				x, ok := StateExt(s)
				if !ok || !x.HasTrade {
					t.Fatalf("%s/%dp/seed %d: no trade hexes", rs, players, seed)
				}
				rx, ok := rivers.StateExt(s)
				if !ok {
					t.Fatalf("%s/%dp/seed %d: no rivers ext", rs, players, seed)
				}
				for _, h := range x.Trade {
					if rx.IsRiverHex(h) {
						t.Fatalf("%s/%dp/seed %d: trade hex %v is a river hex (trade %v)",
							rs, players, seed, h, x.Trade)
					}
				}
				for _, h := range capeHexes(s.Board) {
					if rx.IsRiverHex(h) {
						t.Fatalf("%s/%dp/seed %d: reserved cape %v carries a channel",
							rs, players, seed, h)
					}
				}
				r := s.Board.Radius
				for i := range x.Trade {
					for j := i + 1; j < len(x.Trade); j++ {
						if got := hexDist(x.Trade[i], x.Trade[j]); got != 2*r {
							t.Fatalf("%s/%dp/seed %d: trade legs %d-%d are %d apart, want 2R = %d",
								rs, players, seed, i, j, got, 2*r)
						}
					}
				}
				roles := map[uint8]int{}
				for _, role := range x.Roles {
					roles[role]++
				}
				if len(roles) != tradeHexCount {
					t.Fatalf("%s/%dp/seed %d: roles %v are not one of each", rs, players, seed, x.Roles)
				}
				land := 0
				for _, h := range board.HexesInRadius(s.Board.Radius) {
					if s.Board.Land(h) {
						land++
					}
				}
				// rivers.riverCount, restated: 1 + (land-1)/30.
				if got, want := len(rx.Rivers), 1+(land-1)/30; got != want {
					t.Fatalf("%s/%dp/seed %d: %d rivers, want %d",
						rs, players, seed, got, want)
				}
			}
		}
	}
}

// The reservation is the Wagons trade candidates and nothing else, so a ruleset
// without Wagons derives exactly the watercourse it always did.
func TestRiversWithoutWagonsIgnoreCapes(t *testing.T) {
	for _, players := range []int{3, 5, 8} {
		s := newGame(t, players, "base+rivers")
		if got := engine.ReservedHexes(s.Config, s.Board); got != nil {
			t.Fatalf("%dp base+rivers reserves %v, want none", players, got)
		}
		w := newGame(t, players, "base+rivers+wagons")
		res := engine.ReservedHexes(w.Config, w.Board)
		if len(res) != 6 {
			t.Fatalf("%dp base+rivers+wagons reserves %d hexes, want the six corners", players, len(res))
		}
		for _, h := range capeHexes(w.Board) {
			if !res[h] {
				t.Fatalf("%dp: cape %v is not reserved", players, h)
			}
		}
	}
}
