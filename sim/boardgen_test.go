package sim

import (
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// Board-level invariants over generated boards: where the robber starts and how
// that is distributed, that a Fishermen board keeps its lake, that a Caravans
// board has all three caravans, how many fishing grounds land, and that token
// counts vary across seeds. Board-only, so they run in the default gate.
//
// Each test also asserts that its sweep reaches the interesting case, since
// several repairs fire on a minority of seeds. Where a witness needs the board
// before a module touched it, it regenerates the seed without that module:
// generation is rngFor(seed, 1) and depends only on player count.

func ringOf(h board.Hex) int {
	x, y, z := h.Q, -h.Q-h.R, h.R
	m := 0
	for _, n := range []int{x, y, z} {
		if n < 0 {
			n = -n
		}
		if n > m {
			m = n
		}
	}
	return m
}

func desertOf(b *board.Board) (board.Hex, bool) {
	for _, h := range board.HexesInRadius(b.Radius) {
		if t, ok := b.Tiles[h]; ok && t.Res == board.ResNone {
			return h, true
		}
	}
	return board.Hex{}, false
}

func neutralCount(b *board.Board) int {
	n := 0
	for _, t := range b.Tiles {
		if t.Res == board.ResNone || t.Res == board.Lake {
			n++
		}
	}
	return n
}

// TestFishermenBoardsKeepTheirLake: Fishermen's SetupBoard floods every desert
// into the lake, and in canonical order that runs before Islands, whose carve
// can drown a lake on the outer ring. A board with no lake and no desert pays
// none of the lake's numbers and has no neutral hex for the 2-fish robber
// spend. Fishermen's FinishBoard guarantees a lake.
func TestFishermenBoardsKeepTheirLake(t *testing.T) {
	rulesets := canonical([]string{
		"base+fishermen",
		"base+fishermen+islands",
		"base+fishermen+caravans",
		"base+fishermen+islands+caravans",
		"base+cak+fishermen",
	})
	repaired := 0
	for _, rs := range rulesets {
		for _, players := range []int{2, 3, 4, 6, 10} {
			for seed := range uint64(40) {
				b := setupBoard(t, rs, players, seed)
				lakes := 0
				for _, t := range b.Tiles {
					if t.Res == board.Lake {
						lakes++
					}
				}
				if lakes == 0 {
					t.Fatalf("%s p%d seed %d: no lake on the board",
						rs, players, seed)
				}
				// No dry desert either: freshCaravans, the robber and
				// ValidateLayout treat desert and lake as one tile.
				if _, dry := desertOf(b); dry {
					t.Fatalf("%s p%d seed %d: a dry desert survived onto a Fishermen board", rs, players, seed)
				}
				// Witness that the carve runs on this sweep: the seed's own desert
				// hex is no longer the neutral one (Islands drowned it and the
				// desert reappeared as an islet elsewhere).
				base := setupBoard(t, "base", players, seed)
				if d, ok := desertOf(base); ok {
					if tile, present := b.Tiles[d]; !present || tile.Res != board.Lake {
						repaired++
					}
				}
			}
		}
	}
	if repaired == 0 {
		t.Fatal("no board in the sweep had its dealt desert carved away")
	}
	t.Logf("the carve moved the dealt desert on %d boards", repaired)
}

// TestCaravansHasThreeSpokes: each caravan grows from a spoke at one of the
// oasis' alternating corners, and a spoke needs an outward, non-perimeter land
// edge. An oasis on the outer ring has fewer than three, while HasOasis is
// still true.
func TestCaravansHasThreeSpokes(t *testing.T) {
	moved, promoted := 0, 0
	carvedRuleset := func(rs string) bool { return slices.Contains(strings.Split(rs, "+"), "islands") }
	for _, rs := range caravanRulesets {
		for _, players := range []int{2, 3, 4, 5, 6, 8, 10} {
			for seed := uint64(1); seed <= 40; seed++ {
				evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs},
					engine.Seeds{Public: seed, Private: seed})
				if err != nil {
					t.Fatalf("%s p%d seed %d: new: %v", rs, players, seed, err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatalf("%s p%d seed %d: replay: %v", rs, players, seed, err)
				}
				x, ok := scenarios.CaravansStateExt(s)
				if !ok {
					t.Fatalf("%s p%d seed %d: no caravans ext", rs, players, seed)
				}
				// Every oasis the table plays with (one; two at 5 and 6; three
				// at 7 to 10: derivation 13), three caravans each, Islands
				// included: where the carve drowned a desert the finisher
				// promotes a producing hex for each missing oasis.
				want := scenarios.OasisCount(players)
				if len(x.Oases) != want || len(x.Arrows) != 3*want || x.Supply() != 22+11*(want-1) {
					t.Fatalf("%s p%d seed %d: %d oases, %d caravans and %d camels, want %d, %d and %d",
						rs, players, seed, len(x.Oases), len(x.Arrows), x.Supply(), want, 3*want, 22+11*(want-1))
				}
				for i, spokes := range x.Arrows {
					if spokes == (board.Edge{}) {
						t.Fatalf("%s p%d seed %d: caravan %d has no spoke (oasis %v on ring %d of %d)",
							rs, players, seed, i, x.Oasis, ringOf(x.Oasis), s.Board.Radius)
					}
				}
				// Witness for the promotion: the board has fewer producing hexes
				// than the same seed's Islands board without Caravans. A swap
				// keeps every hex it moves, so only a promotion loses one.
				if carvedRuleset(rs) && rs == engine.CanonicalRuleset("base+islands+caravans") && players >= 5 {
					plain, err := engine.New(engine.GameConfig{Players: players, Ruleset: "base+islands"},
						engine.Seeds{Public: seed, Private: seed})
					if err != nil {
						t.Fatal(err)
					}
					ps, err := engine.Replay(plain)
					if err != nil {
						t.Fatal(err)
					}
					for _, h := range board.HexesInRadius(s.Board.Radius) {
						if ps.Board.Tiles[h].Res.Producing() {
							promoted++
						}
						if s.Board.Tiles[h].Res.Producing() {
							promoted--
						}
					}
				}
				// Witness: the seed dealt its desert on the outer ring, where an
				// oasis cannot have three spokes, so this board is one the
				// repair had to act on.
				base := setupBoard(t, "base", players, seed)
				if d, ok := desertOf(base); ok && ringOf(d) >= base.Radius {
					moved++
				}
			}
		}
	}
	if moved == 0 {
		t.Fatal("no board in the sweep dealt its desert on the outer ring")
	}
	if promoted == 0 {
		t.Fatal("no carved board at 5 or more seats needed an oasis promoted")
	}
	t.Logf("%d boards started from an outer-ring desert; %d hexes promoted to an oasis on base+islands+caravans", moved, promoted)
}

// TestRobberOpeningHexAndSpread checks the robber's opening
// position:
//
//   - Terrain: it starts on a desert whenever the board has one.
//   - Distribution: it is not the same hex on every seed. A fallback that walks
//     HexesInRadius for the first legal hex always lands in one corner, which a
//     single-board check cannot see, so this asserts the spread across seeds.
//
// Under Fishermen and Caravans the robber starts off the board, so those
// rulesets are asserted to have no opening hex instead.
func TestRobberOpeningHexAndSpread(t *testing.T) {
	rulesets := canonical([]string{
		"base",
		"base+fishermen",
		"base+islands",
		"base+fishermen+islands",
		"base+caravans",
		"base+islands+caravans",
		"base+islands+fishermen+caravans",
	})
	const seeds = 120
	forced := 0
	for _, rs := range rulesets {
		// Under Fishermen and Caravans the robber starts off the board and
		// enters on the first 7 or Knight. Caravans holds it back because
		// the oasis stands where the desert would and the robber may never
		// enter it (docs/rules/scenarios.md). Assert the absence instead.
		if strings.Contains(rs, "fishermen") || strings.Contains(rs, "caravans") {
			t.Run(rs, func(t *testing.T) {
				for _, players := range []int{2, 4, 6} {
					for seed := range uint64(seeds) {
						b := setupBoard(t, rs, players, seed)
						if b.RobberOnBoard() {
							t.Fatalf("%s p%d seed %d: robber opened on %v (%v), want off the board",
								rs, players, seed, b.Robber, b.Tiles[b.Robber].Res)
						}
					}
				}
			})
			continue
		}
		t.Run(rs, func(t *testing.T) {
			for _, players := range []int{2, 4, 6} {
				hexes := map[board.Hex]int{}
				for seed := range uint64(seeds) {
					b := setupBoard(t, rs, players, seed)
					if !b.RobberOnBoard() {
						t.Fatalf("%s p%d seed %d: robber opened off the board, want on a hex",
							rs, players, seed)
					}
					if !b.RobberOK(b.Robber) {
						t.Fatalf("%s p%d seed %d: robber on %v (%v), which it may not occupy",
							rs, players, seed, b.Robber, b.Tiles[b.Robber].Res)
					}
					if neutralCount(b) > 0 && !b.RobberNeutral(b.Robber) {
						t.Fatalf("%s p%d seed %d: robber on producing %v while a non-producing hex is free",
							rs, players, seed, b.Tiles[b.Robber].Res)
					}
					if neutralCount(b) == 0 {
						forced++
					}
					hexes[b.Robber]++
				}
				top := 0
				for _, n := range hexes {
					if n > top {
						top = n
					}
				}
				// The robber must reach several hexes, and no single hex may take
				// half the seeds. A first-in-board-order fallback scores 1 and
				// seeds respectively.
				if len(hexes) < 5 {
					t.Errorf("%s p%d: robber opened on only %d distinct hexes over %d seeds",
						rs, players, len(hexes), seeds)
				}
				if top*2 > seeds {
					t.Errorf("%s p%d: one hex took %d of %d openings",
						rs, players, top, seeds)
				}
			}
		})
	}
	if forced == 0 {
		t.Log("no board in this sweep ran out of neutral hexes; seeded fallback not exercised")
	}
}

// TestFishGroundsCount asserts every ground of the table lands (six at 2 to 4
// seats, eight at 5 and 6, ten at 7 to 10), on carved coastlines as well as
// plain ones, and that their numbers are the table's.
//
// The Islands carve leaves an archipelago with more coast than the original
// hexagon, so carved boards place the full count too. deriveGrounds still
// accepts fewer; a change that shortens coasts would fail here.
func TestFishGroundsCount(t *testing.T) {
	uncarved := canonical([]string{"base+fishermen", "base+cak+fishermen", "base+fishermen+caravans"})
	carved := canonical([]string{"base+fishermen+islands", "base+islands+fishermen+caravans"})
	for _, rs := range append(append([]string{}, uncarved...), carved...) {
		isCarved := false
		for _, c := range carved {
			if c == rs {
				isCarved = true
			}
		}
		for _, players := range []int{2, 3, 4, 5, 6, 8, 10} {
			for seed := range uint64(40) {
				s := setupStateFor(t, rs, players, seed)
				fx, ok := scenarios.FishStateExt(s)
				if !ok {
					t.Fatalf("%s p%d seed %d: no fishermen ext", rs, players, seed)
				}
				n := len(fx.Grounds)
				var nums []int
				for _, g := range fx.Grounds {
					nums = append(nums, g.Number)
				}
				// Carved or not, an archipelago has more coast than the hexagon
				// it was cut from. Six at 2 to 4 seats, eight at 5 and 6, ten
				// at 7 to 10 (derivation 13; scenarios.FishGroundCount).
				if want := scenarios.FishGroundCount(players); n != want {
					t.Fatalf("%s p%d seed %d: %d fishing grounds, want all %d (carved=%v)", rs, players, seed, n, want, isCarved)
				}
				// The numbers, each exactly once, compared as a set: the order
				// deriveGrounds appends in doesn't matter (the client reads
				// Grounds by hex).
				sorted := slices.Sorted(slices.Values(nums))
				if want := scenarios.FishGroundNumbers(players); !slices.Equal(sorted, want) {
					t.Fatalf("%s p%d seed %d: ground numbers %v, want %v",
						rs, players, seed, nums, want)
				}
			}
		}
	}
}

// TestTokenTwinsDoNotAlwaysFavourTheSameValue: numberTokens deals scaled
// counts and gives the remainder out by largest fractional part. 6 and 8 have
// the same share, so their tie must be broken from the seed, not by
// tokenDealOrder; otherwise every 35-token board has four 6s and three 8s.
func TestTokenTwinsDoNotAlwaysFavourTheSameValue(t *testing.T) {
	// Twins: values with identical shares, so a remainder can only ever be
	// broken between them by the tie-break under test.
	twins := [][2]int{{6, 8}, {5, 9}, {4, 10}, {3, 11}}
	for _, players := range []int{4, 5, 6, 8, 10} {
		counts := map[int]map[int]int{}
		for seed := range uint64(120) {
			b := setupBoard(t, "base", players, seed)
			c := map[int]int{}
			for _, tile := range b.Tiles {
				if tile.Number != 0 {
					c[tile.Number]++
				}
			}
			for _, tw := range twins {
				if d := c[tw[0]] - c[tw[1]]; d < -1 || d > 1 {
					t.Fatalf("p%d seed %d: %d %ds against %d %ds, more than one apart",
						players, seed, c[tw[0]], tw[0], c[tw[1]], tw[1])
				}
			}
			for v, n := range c {
				if counts[v] == nil {
					counts[v] = map[int]int{}
				}
				counts[v][n]++
			}
		}
		// A board size whose token count divides evenly by 18 has no remainder,
		// and the twins always match. Where there is a remainder, both counts
		// must occur across the seeds.
		for _, tw := range twins {
			for _, v := range tw {
				if len(counts[v]) == 1 {
					continue // this value is never short at this board size
				}
				if len(counts[v]) < 2 {
					t.Errorf("p%d: the %d count was %v on all 120 seeds while its twin's varied",
						players, v, counts[v])
				}
			}
		}
	}
	// Check that 35 tokens (5 and 6 players) really is a size where the 6
	// count varies.
	c := map[int]int{}
	for seed := range uint64(120) {
		b := setupBoard(t, "base", 5, seed)
		n := 0
		for _, tile := range b.Tiles {
			if tile.Number == 6 {
				n++
			}
		}
		c[n]++
	}
	if len(c) < 2 {
		t.Fatalf("5-player boards carried the same number of 6s on all 120 seeds (%v)", c)
	}
}

// TestGeneratedBoardsValidate: a board the generator produces must pass
// ValidateLayout. engine.New validates only presets and inlined maps, but the
// share code, POST /api/maps/* and the builder validate everything. Fishermen
// boards have no desert (it becomes the lake), so ValidateLayout counts the
// lake, as RobberNeutral and freshCaravans do.
func TestGeneratedBoardsValidate(t *testing.T) {
	rulesets := canonical([]string{
		"base",
		"base+islands",
		"base+cak",
		"base+fishermen",
		"base+caravans",
		"base+fishermen+caravans",
		"base+islands+fishermen+caravans",
		"base+raiders",
		"base+islands+raiders",
	})
	fishermen := 0
	for _, rs := range rulesets {
		for _, players := range []int{2, 4, 6, 10} {
			for seed := range uint64(30) {
				b := setupBoard(t, rs, players, seed)
				if err := b.ValidateLayout(); err != nil {
					t.Fatalf("%s p%d seed %d: generated board fails validation: %v",
						rs, players, seed, err)
				}
				if _, dry := desertOf(b); !dry {
					fishermen++ // a board whose only neutral hex is the lake
				}
			}
		}
	}
	if fishermen == 0 {
		t.Fatal("no board in the sweep had a lake in place of its desert")
	}
	t.Logf("%d boards validated with a lake and no desert", fishermen)
}

func setupStateFor(t *testing.T, ruleset string, players int, seed uint64) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset, TargetVP: 10}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("%s p%d seed %d: New: %v", ruleset, players, seed, err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("%s p%d seed %d: Apply: %v", ruleset, players, seed, err)
		}
	}
	return s
}
