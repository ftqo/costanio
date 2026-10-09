package wagons

import (
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// caravansWagonsRulesets is every valid ruleset carrying both modules.
func caravansWagonsRulesets(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, rs := range engine.ValidRulesets() {
		parts := strings.Split(rs, "+")
		if slices.Contains(parts, "caravans") && slices.Contains(parts, WagonsName) {
			out = append(out, rs)
		}
	}
	if len(out) == 0 {
		t.Fatal("no valid ruleset carries both caravans and wagons")
	}
	return out
}

func fullSilhouette(players int) *board.Board {
	r := board.RadiusFor(players)
	b := &board.Board{Radius: r, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(r) {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

// Ruling (docs/rules/wagons.md, "Caravans"): the oasis is never a trade hex. On
// every board the engine deals (procedural and the lobby silhouette, every player
// count, every valid Caravans+Wagons ruleset) this holds without the trade side
// losing a candidate: three alternating corners 2R apart with one of each role,
// and the oasis still starts all three caravans. On these boards the oasis repair
// already keeps the oasis inland, so this is a guard; the ruling matters for the
// authored case below.
func TestOasisIsNeverATradeHex(t *testing.T) {
	for i, rs := range caravansWagonsRulesets(t) {
		// cak and harbormaster change no board; one seat count per radius for
		// those, every seat count for the rest.
		players := []int{3, 5, 8}
		parts := strings.Split(rs, "+")
		if !slices.Contains(parts, "cak") && !slices.Contains(parts, "harbormaster") {
			players = []int{2, 3, 4, 5, 6, 7, 8, 9, 10}
		}
		for _, inline := range []bool{false, true} {
			for _, n := range players {
				seed := uint64(200 + i*10 + n)
				cfg := engine.GameConfig{Players: n, Ruleset: rs}
				if inline {
					cfg.Board = fullSilhouette(n)
				}
				evs, err := engine.New(cfg, engine.Seeds{Public: seed, Private: seed ^ 0x51})
				if err != nil {
					t.Fatalf("%s/%dp/inline=%v: new: %v", rs, n, inline, err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatalf("%s/%dp: replay: %v", rs, n, err)
				}
				x, ok := StateExt(s)
				if !ok || !x.HasTrade {
					t.Fatalf("%s/%dp/inline=%v: no trade hexes", rs, n, inline)
				}
				cx, ok := scenarios.CaravansStateExt(s)
				if !ok || !cx.HasOasis {
					t.Fatalf("%s/%dp/inline=%v: no oasis", rs, n, inline)
				}
				if slices.Contains(x.Trade[:], cx.Oasis) {
					t.Fatalf("%s/%dp/inline=%v seed %d: the oasis %v is a trade hex %v", rs, n, inline, seed, cx.Oasis, x.Trade)
				}
				for k, a := range cx.Arrows {
					if a == (board.Edge{}) {
						t.Fatalf("%s/%dp/inline=%v: caravan %d has no spoke", rs, n, inline, k)
					}
				}
				r := s.Board.Radius
				for a := range x.Trade {
					for b := a + 1; b < len(x.Trade); b++ {
						if got := hexDist(x.Trade[a], x.Trade[b]); got != 2*r {
							t.Fatalf("%s/%dp/inline=%v: legs %d-%d are %d apart, want %d", rs, n, inline, a, b, got, 2*r)
						}
					}
				}
				roles := map[uint8]bool{}
				for _, role := range x.Roles {
					roles[role] = true
				}
				if len(roles) != tradeHexCount {
					t.Fatalf("%s/%dp/inline=%v: roles %v are not one of each", rs, n, inline, x.Roles)
				}
			}
		}
	}
}

// The case the ruling changes: an author pins a desert on an outer corner. The
// engine may not move it, so the oasis stays there, and Caravans'
// TradeHexAllowed removes it from the candidates so the triple is chosen from the
// rest.
func TestPinnedCapeOasisIsNotATradeHex(t *testing.T) {
	for _, rs := range []string{"base+caravans+wagons", engine.CanonicalRuleset("base+caravans+rivers+wagons")} {
		for _, players := range []int{3, 5, 8} {
			for seed := uint64(1); seed <= 20; seed++ {
				b := fullSilhouette(players)
				corner := board.Hex{Q: b.Radius, R: 0}
				b.Tiles[corner] = board.Tile{Res: board.ResNone}
				evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs, Board: b},
					engine.Seeds{Public: seed, Private: seed})
				if err != nil {
					t.Fatalf("%s/%dp: %v", rs, players, err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatal(err)
				}
				x, _ := StateExt(s)
				// At five seats and up the pinned desert is one oasis of two or three;
				// the others are promoted from engine-dealt land (derivation 13), and
				// any may come first in board order.
				cx, ok := scenarios.CaravansStateExt(s)
				if !ok || !slices.Contains(cx.Oases, corner) {
					t.Fatalf("%s/%dp seed %d: pinned oasis moved: oases %v", rs, players, seed, cx.Oases)
				}
				if len(cx.Oases) != scenarios.OasisCount(players) {
					t.Fatalf("%s/%dp seed %d: %d oases, want %d", rs, players, seed, len(cx.Oases), scenarios.OasisCount(players))
				}
				if !x.HasTrade {
					t.Fatalf("%s/%dp seed %d: no trade hexes", rs, players, seed)
				}
				for _, o := range cx.Oases {
					if slices.Contains(x.Trade[:], o) {
						t.Fatalf("%s/%dp seed %d: the oasis %v is a trade hex %v", rs, players, seed, o, x.Trade)
					}
				}
			}
		}
	}
}
