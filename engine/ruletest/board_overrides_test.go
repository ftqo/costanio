package ruletest

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/engine/wagons"
)

// Four modules draw their own tile over a hex of the finished board: the Rivers
// channel (swamp and headwater included), the Raiders castle, the Caravans oasis
// and the Wagons trade hexes. Two on one hex means one is not drawn, and two rules
// claim the hex.
//
// These tests are the board-derivation half of derivation 12. See
// docs/rules/raiders.md ("The castle"), docs/rules/wagons.md ("Harbours",
// "Fishermen") and docs/rules/scenarios.md (fishing-ground numbers).

// silhouette is the lobby's generic-land map: every hex of the radius as
// ResLand, which board.Resolve deals at start. Every real lobby game inlines it.
func silhouette(players int) *board.Board {
	r := board.RadiusFor(players)
	b := &board.Board{Radius: r, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(r) {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

func newBoardState(t *testing.T, cfg engine.GameConfig, seed uint64) *engine.State {
	t.Helper()
	evs, err := engine.New(cfg, engine.Seeds{Public: seed, Private: seed ^ 0x9e37})
	if err != nil {
		t.Fatalf("%s/%dp seed %d: new: %v", cfg.Ruleset, cfg.Players, seed, err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatalf("%s/%dp seed %d: replay: %v", cfg.Ruleset, cfg.Players, seed, err)
	}
	return s
}

// overrides lists, per module, the hexes it draws its own tile over.
func overrides(s *engine.State) map[string][]board.Hex {
	out := map[string][]board.Hex{}
	if x, ok := rivers.StateExt(s); ok {
		for _, r := range x.Rivers {
			out["river"] = append(out["river"], r.Hexes...)
		}
	}
	if h, ok := raiders.CastleOf(s); ok {
		out["castle"] = []board.Hex{h}
	}
	// Every oasis: a table of five or more plays with two or three
	// (derivation 13), possibly promoted from producing land where an
	// Islands carve drowned a desert.
	if x, ok := scenarios.CaravansStateExt(s); ok {
		out["oasis"] = slices.Clone(x.Oases)
	} else if h, ok := scenarios.OasisOf(s); ok {
		out["oasis"] = []board.Hex{h}
	}
	if x, ok := wagons.StateExt(s); ok && x.HasTrade {
		out["trade"] = slices.Clone(x.Trade[:])
	}
	return out
}

// overrideRulesets is every valid ruleset of one to three modules with at
// least two of the four overriding modules.
func overrideRulesets(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, rs := range engine.ValidRulesets() {
		parts := strings.Split(rs, "+")
		mods := slices.DeleteFunc(slices.Clone(parts), func(p string) bool { return p == "base" })
		if len(mods) > 3 {
			continue
		}
		n := 0
		for _, m := range []string{"rivers", "raiders", "caravans", "wagons"} {
			if slices.Contains(mods, m) {
				n++
			}
		}
		if n >= 2 {
			out = append(out, rs)
		}
	}
	if len(out) == 0 {
		t.Fatal("no valid ruleset carries two overriding modules")
	}
	return out
}

// TestTileOverridesNeverCollide: across every one-to-three-module composition,
// on the procedural board and the lobby silhouette, at every radius, no hex
// carries two overrides.
func TestTileOverridesNeverCollide(t *testing.T) {
	rulesets := overrideRulesets(t)
	boards := 0
	for i, rs := range rulesets {
		for _, inline := range []bool{false, true} {
			if inline && slices.Contains(strings.Split(rs, "+"), "islands") {
				continue // an all-land silhouette is not an Islands map
			}
			for _, players := range []int{3, 4, 6, 8} {
				for k := range uint64(6) {
					seed := uint64(1000+i*97) + k*13 + uint64(players)
					cfg := engine.GameConfig{Players: players, Ruleset: rs}
					if inline {
						cfg.Board = silhouette(players)
					}
					s := newBoardState(t, cfg, seed)
					boards++
					owner := map[board.Hex]string{}
					ov := overrides(s)
					for _, kind := range []string{"river", "castle", "oasis", "trade"} {
						for _, h := range ov[kind] {
							if prev, ok := owner[h]; ok && prev != kind {
								t.Fatalf("%s/%dp/inline=%v seed %d: hex %v is both the %s and the %s",
									rs, players, inline, seed, h, prev, kind)
							}
							owner[h] = kind
						}
					}
				}
			}
		}
	}
	t.Logf("%d boards over %d rulesets", boards, len(rulesets))
}

// TestRaidersCastleIsNeverARiverHex: a castle picked off the land mask alone
// lands on a channel hex in many base+raiders+rivers games. It must move off the
// river and stay central.
func TestRaidersCastleIsNeverARiverHex(t *testing.T) {
	for _, rs := range []string{
		engine.CanonicalRuleset("base+raiders+rivers"),
		engine.CanonicalRuleset("base+raiders+rivers+wagons"),
	} {
		moved := 0
		for _, inline := range []bool{false, true} {
			for _, players := range []int{3, 4, 6, 8} {
				for seed := uint64(1); seed <= 25; seed++ {
					cfg := engine.GameConfig{Players: players, Ruleset: rs}
					if inline {
						cfg.Board = silhouette(players)
					}
					s := newBoardState(t, cfg, seed)
					castle, ok := raiders.CastleOf(s)
					if !ok {
						t.Fatalf("%s/%dp seed %d: no castle", rs, players, seed)
					}
					x, _ := rivers.StateExt(s)
					if x == nil || len(x.Rivers) == 0 {
						t.Fatalf("%s/%dp seed %d: no river", rs, players, seed)
					}
					if x.IsRiverHex(castle) {
						t.Fatalf("%s/%dp/inline=%v seed %d: the castle %v is a river hex", rs, players, inline, seed, castle)
					}
					if engine.ReservedHexes(s.Config, s.Board)[castle] {
						t.Fatalf("%s/%dp seed %d: the castle %v is a reserved hex", rs, players, seed, castle)
					}
					// Central: never on the coast, and never further than one
					// ring out from the board's centre on a full hexagon.
					if d := ringOf(castle); d > 1 {
						t.Fatalf("%s/%dp/inline=%v seed %d: castle %v is %d rings out, want the centre or ring 1",
							rs, players, inline, seed, castle, d)
					}
					if castle != (board.Hex{}) {
						moved++
					}
				}
			}
		}
		t.Logf("%s: castle moved off the centre on %d of 200 boards", rs, moved)
	}
}

func ringOf(h board.Hex) int {
	return max(abs(h.Q), abs(h.R), abs(-h.Q-h.R))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// TestFishermenLakeIsNeverATradeHex: an authored map with a desert pinned on a
// cape, which Fishermen floods into a lake. Fishermen vetoes every lake from the
// Wagons trade candidates (engine.TradeHexEligibility), as Caravans does the
// oasis.
func TestFishermenLakeIsNeverATradeHex(t *testing.T) {
	for _, rs := range []string{"base+fishermen+wagons", engine.CanonicalRuleset("base+caravans+fishermen+wagons")} {
		for _, players := range []int{3, 5, 8} {
			for seed := uint64(1); seed <= 30; seed++ {
				b := silhouette(players)
				corner := board.Hex{Q: b.Radius, R: 0}
				b.Tiles[corner] = board.Tile{Res: board.ResNone}
				s := newBoardState(t, engine.GameConfig{Players: players, Ruleset: rs, Board: b}, seed)
				if s.Board.Tiles[corner].Res != board.Lake {
					t.Fatalf("%s/%dp seed %d: the pinned desert did not become a lake (%v)", rs, players, seed, s.Board.Tiles[corner].Res)
				}
				x, ok := wagons.StateExt(s)
				if !ok || !x.HasTrade {
					t.Fatalf("%s/%dp seed %d: no trade hexes", rs, players, seed)
				}
				for _, h := range x.Trade {
					if s.Board.Tiles[h].Res == board.Lake {
						t.Fatalf("%s/%dp seed %d: the lake %v is a trade hex %v", rs, players, seed, h, x.Trade)
					}
				}
			}
		}
	}
}

// TestPinnedCapeDesertMayBeATradeHex: the Fishermen veto does not extend to a
// plain desert pinned on a cape with no module turning it into a feature. A trade
// hex keeps its terrain and produces normally, and a desert produces nothing
// either way. See docs/rules/wagons.md.
func TestPinnedCapeDesertMayBeATradeHex(t *testing.T) {
	desertTrade := 0
	for seed := uint64(1); seed <= 30; seed++ {
		b := silhouette(4)
		corner := board.Hex{Q: b.Radius, R: 0}
		b.Tiles[corner] = board.Tile{Res: board.ResNone}
		s := newBoardState(t, engine.GameConfig{Players: 4, Ruleset: "base+wagons", Board: b}, seed)
		x, _ := wagons.StateExt(s)
		if slices.Contains(x.Trade[:], corner) {
			desertTrade++
		}
	}
	if desertTrade == 0 {
		t.Fatal("pinned cape desert never became a trade hex")
	}
	t.Logf("pinned cape desert became a trade hex on %d of 30 seeds", desertTrade)
}

// groundKey names a fishing ground's position by its sea hex.
func groundKey(h board.Hex) string { return fmt.Sprintf("%d,%d", h.Q, h.R) }

// TestFishingGroundNumbersAreShuffled: dealt in candidate order, a four-seat
// board would always put the 10 east at Q=3 and the 4 west. The scenario
// shuffles the ground tiles, so every position should see more than one number.
func TestFishingGroundNumbersAreShuffled(t *testing.T) {
	numbersAt := map[string]map[int]int{}
	for seed := uint64(1); seed <= 200; seed++ {
		s := newBoardState(t, engine.GameConfig{Players: 4, Ruleset: "base+fishermen"}, seed)
		fx, ok := scenarios.FishStateExt(s)
		if !ok || len(fx.Grounds) != 6 {
			t.Fatalf("seed %d: want six grounds", seed)
		}
		var nums []int
		for _, g := range fx.Grounds {
			k := groundKey(g.Hex)
			if numbersAt[k] == nil {
				numbersAt[k] = map[int]int{}
			}
			numbersAt[k][g.Number]++
			nums = append(nums, g.Number)
		}
		if got := slices.Sorted(slices.Values(nums)); !slices.Equal(got, []int{4, 5, 6, 8, 9, 10}) {
			t.Fatalf("seed %d: numbers %v, want one each of 4 5 6 8 9 10", seed, got)
		}
	}
	for k, hist := range numbersAt {
		total := 0
		for _, n := range hist {
			total += n
		}
		if total >= 30 && len(hist) < 4 {
			t.Errorf("ground at %s took only %d distinct numbers over %d boards: %v", k, len(hist), total, hist)
		}
	}
	// The east edge: the 10 must not be pinned to it.
	for k, hist := range numbersAt {
		total := 0
		for _, n := range hist {
			total += n
		}
		if total >= 30 && hist[10] == total {
			t.Errorf("the 10 sat on %s on every one of its %d boards", k, total)
		}
	}
}

// TestFishingGroundNumbersAreDeterministic: the shuffle is off the public seed,
// so two derivations of one game agree, and the audit can re-derive it.
func TestFishingGroundNumbersAreDeterministic(t *testing.T) {
	for seed := uint64(1); seed <= 10; seed++ {
		cfg := engine.GameConfig{Players: 4, Ruleset: "base+fishermen"}
		a := newBoardState(t, cfg, seed)
		b := newBoardState(t, cfg, seed)
		ga, _ := scenarios.FishStateExt(a)
		gb, _ := scenarios.FishStateExt(b)
		if fmt.Sprint(ga.Grounds) != fmt.Sprint(gb.Grounds) {
			t.Fatalf("seed %d: two derivations disagree:\n%v\n%v", seed, ga.Grounds, gb.Grounds)
		}
	}
}

// TestFishermenLakeLeavesTheCapes is the generated-board half of the lake
// ruling: the generator deals the desert anywhere, including on a cape, so
// Fishermen's finisher swaps an engine-dealt lake off every reserved hex. The veto
// then never binds on such a board and the triple keeps its equal legs.
func TestFishermenLakeLeavesTheCapes(t *testing.T) {
	for _, rs := range []string{"base+fishermen+wagons", engine.CanonicalRuleset("base+caravans+fishermen+wagons")} {
		for _, inline := range []bool{false, true} {
			for players := 2; players <= 10; players++ {
				for seed := uint64(1); seed <= 12; seed++ {
					cfg := engine.GameConfig{Players: players, Ruleset: rs}
					if inline {
						cfg.Board = silhouette(players)
					}
					s := newBoardState(t, cfg, seed)
					for _, h := range (wagons.Wagons{}).ReservedHexes(s.Board) {
						if s.Board.Tiles[h].Res == board.Lake {
							t.Fatalf("%s/%dp/inline=%v seed %d: a lake is on the cape %v", rs, players, inline, seed, h)
						}
					}
					x, _ := wagons.StateExt(s)
					r := s.Board.Radius
					for a := range x.Trade {
						for c := a + 1; c < len(x.Trade); c++ {
							if d := ringOf(board.Hex{Q: x.Trade[a].Q - x.Trade[c].Q, R: x.Trade[a].R - x.Trade[c].R}); d != 2*r {
								t.Fatalf("%s/%dp/inline=%v seed %d: legs %v-%v are %d apart, want %d",
									rs, players, inline, seed, x.Trade[a], x.Trade[c], d, 2*r)
							}
						}
					}
					if fx, ok := scenarios.FishStateExt(s); !ok || len(fx.Grounds) != scenarios.FishGroundCount(players) {
						t.Fatalf("%s/%dp/inline=%v seed %d: want %d fishing grounds", rs, players, inline, seed, scenarios.FishGroundCount(players))
					}
				}
			}
		}
	}
}
