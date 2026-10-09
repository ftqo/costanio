package scenarios

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Derivation 13: the 5-6-player content of both scenarios, and our own
// extrapolation of it to 7-10 seats. docs/rules/scenarios.md states every count
// these tests pin, and says which are the scenario's and which are ours.

// boardGame folds a game's creation log only: the board and every module's
// board-derived ext, before anybody has placed anything.
func boardGame(t *testing.T, ruleset string, players int, seed uint64) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("%s %dp seed %d: %v", ruleset, players, seed, err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func boardLakes(s *engine.State) []board.Hex {
	var out []board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if t, ok := s.Board.Tiles[h]; ok && t.Res == board.Lake {
			out = append(out, h)
		}
	}
	return out
}

// TestFishermenCountsByTableSize pins the component counts per bracket: the
// 3-4 player set at 2 to 4 seats; the 5-6 player bracket (8 grounds, the extra
// two on 5 and 9; 43 tokens as 15/15/13; a second lake on 4 and 10) at 5 and 6;
// and our extrapolation at 7 to 10.
func TestFishermenCountsByTableSize(t *testing.T) {
	cases := []struct {
		players []int
		supply  [3]int
		grounds []int
		lakes   [][]int
	}{
		{[]int{2, 3, 4}, [3]int{11, 10, 8}, []int{4, 5, 6, 8, 9, 10}, [][]int{{2, 3, 11, 12}}},
		{[]int{5, 6}, [3]int{15, 15, 13}, []int{4, 5, 5, 6, 8, 9, 9, 10}, [][]int{{2, 3, 11, 12}, {4, 10}}},
		{[]int{7, 8, 9, 10}, [3]int{19, 20, 18}, []int{4, 5, 5, 5, 6, 8, 9, 9, 9, 10},
			[][]int{{2, 3, 11, 12}, {4, 10}, {4, 10}}},
	}
	for _, c := range cases {
		for _, p := range c.players {
			for seed := uint64(1); seed <= 12; seed++ {
				s := boardGame(t, "base+fishermen", p, seed)
				x := fishExt(s)
				if x.Supply != c.supply {
					t.Fatalf("%dp seed %d: supply %v, want %v", p, seed, x.Supply, c.supply)
				}
				if want := c.supply[0] + c.supply[1] + c.supply[2] + 1; x.TilesLeft != want {
					t.Fatalf("%dp seed %d: boot hides among %d, want %d (every token plus the boot)", p, seed, x.TilesLeft, want)
				}
				var nums []int
				for _, g := range x.Grounds {
					nums = append(nums, g.Number)
				}
				slices.Sort(nums)
				if !slices.Equal(nums, c.grounds) {
					t.Fatalf("%dp seed %d: ground numbers %v, want %v", p, seed, nums, c.grounds)
				}
				lakes := boardLakes(s)
				if len(x.Lakes) != len(lakes) {
					t.Fatalf("%dp seed %d: %d lakes recorded for %d lake tiles", p, seed, len(x.Lakes), len(lakes))
				}
				if len(lakes) != len(c.lakes) {
					t.Fatalf("%dp seed %d: %d lakes on the board, want %d", p, seed, len(lakes), len(c.lakes))
				}
				var got [][]int
				for i, l := range x.Lakes {
					if l.Hex != lakes[i] {
						t.Fatalf("%dp seed %d: lake %d at %v, want board order %v", p, seed, i, l.Hex, lakes[i])
					}
					got = append(got, l.Numbers)
				}
				slices.SortFunc(got, func(a, b []int) int { return len(b) - len(a) })
				for i := range c.lakes {
					if !slices.Equal(got[i], c.lakes[i]) {
						t.Fatalf("%dp seed %d: lake numbers %v, want %v", p, seed, got, c.lakes)
					}
				}
			}
		}
	}
}

// TestLakesPayOnlyTheirOwnNumbers drives every roll against each lake on a
// 5-seat board alone: the 2/3/11/12 lake pays on exactly those, and the second
// lake on 4 and 10 and nothing else.
func TestLakesPayOnlyTheirOwnNumbers(t *testing.T) {
	s := boardGame(t, "base+fishermen", 5, 3)
	x := fishExt(s)
	if len(x.Lakes) != 2 {
		t.Fatalf("5p board has %d lakes, want 2", len(x.Lakes))
	}
	x.Grounds = nil
	for _, l := range x.Lakes {
		// A corner of this lake that touches no other lake, so only this one
		// can answer.
		var corner *board.Vertex
		for _, v := range l.Hex.Vertices() {
			alone := true
			for _, h := range v.Hexes() {
				if h != l.Hex && s.Board.Tiles[h].Res == board.Lake {
					alone = false
				}
			}
			if alone {
				corner = &v
				break
			}
		}
		if corner == nil {
			t.Fatalf("lake %v has no corner of its own", l.Hex)
		}
		s.Buildings = map[board.Vertex]engine.Building{*corner: {Owner: 0}}
		for roll := 2; roll <= 12; roll++ {
			d1 := min(roll-1, 6)
			paid := len(fishCatch(s, d1, roll-d1)) > 0
			if want := slices.Contains(l.Numbers, roll); paid != want {
				t.Errorf("lake %v (%v): roll %d paid=%v, want %v", l.Hex, l.Numbers, roll, paid, want)
			}
		}
	}
}

// TestLegacyFishBlobKeepsEveryLakeOnFour: a log recorded before derivation 13
// has no Lakes in its ext blob, and every lake it played paid on 2, 3, 11 and
// 12. The fold must keep that, or an old 5-seat replay moves its second lake.
func TestLegacyFishBlobKeepsEveryLakeOnFour(t *testing.T) {
	s := boardGame(t, "base+fishermen", 5, 3)
	x := freshFish(s)
	if err := json.Unmarshal([]byte(`{"Supply":[11,10,8],"TilesLeft":30}`), x); err != nil {
		t.Fatal(err)
	}
	if x.Lakes != nil {
		t.Fatalf("legacy blob folded to lakes %v, want nil (every lake on 2/3/11/12)", x.Lakes)
	}
	s.Ext[FishermenName] = x
	x.Grounds = nil
	for _, h := range boardLakes(s) {
		s.Buildings = map[board.Vertex]engine.Building{h.Vertices()[0]: {Owner: 0}}
		for roll := 2; roll <= 12; roll++ {
			d1 := min(roll-1, 6)
			paid := len(fishCatch(s, d1, roll-d1)) > 0
			if want := slices.Contains(LakeNumbers, roll); paid != want {
				t.Errorf("legacy lake %v: roll %d paid=%v, want %v", h, roll, paid, want)
			}
		}
	}
}

// setupTo drives a fresh game's setup with AutoCommand until pick says to
// intervene, returning the state and the events of the placement pick made.
func setupPlace(t *testing.T, ruleset string, players int, seed uint64, round int,
	want func(s *engine.State, v board.Vertex) bool) (*engine.State, []engine.Event, board.Vertex) {
	t.Helper()
	s := boardGame(t, ruleset, players, seed)
	for s.Phase == engine.PhaseSetup {
		if s.SetupRound == round && !s.NeedRoad {
			for _, h := range board.HexesInRadius(s.Board.Radius) {
				for _, v := range h.Vertices() {
					if !want(s, v) {
						continue
					}
					cmd := engine.Command{Player: s.Cur, Type: engine.CmdPlaceSettlement,
						Data: mustJSON(t, map[string]any{"v": v})}
					evs, err := engine.Decide(s, cmd)
					if err != nil {
						continue
					}
					for _, e := range evs {
						if err := engine.Apply(s, e); err != nil {
							t.Fatal(err)
						}
					}
					return s, evs, v
				}
			}
			t.Fatalf("no legal round-%d spot matched", round+1)
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		step(t, s, cmd)
	}
	t.Fatal("setup ended before the placement")
	return nil, nil, board.Vertex{}
}

// fishSources counts the grounds and lakes a corner touches.
func fishSources(s *engine.State, v board.Vertex) int {
	n := 0
	for _, g := range fishExtRO(s).Grounds {
		if slices.Contains(g.V, v) {
			n++
		}
	}
	for _, h := range v.Hexes() {
		if t, ok := s.Board.Tiles[h]; ok && t.Res == board.Lake {
			n++
		}
	}
	return n
}

// setupPlaceQuiet is setupPlace, returning nil events (rather than failing)
// when no legal spot matches.
func setupPlaceQuiet(t *testing.T, ruleset string, players int, seed uint64, round int,
	want func(s *engine.State, v board.Vertex) bool) (*engine.State, []engine.Event, board.Vertex) {
	t.Helper()
	s := boardGame(t, ruleset, players, seed)
	for s.Phase == engine.PhaseSetup {
		if s.SetupRound == round && !s.NeedRoad {
			for _, h := range board.HexesInRadius(s.Board.Radius) {
				for _, v := range h.Vertices() {
					if !want(s, v) {
						continue
					}
					cmd := engine.Command{Player: s.Cur, Type: engine.CmdPlaceSettlement,
						Data: mustJSON(t, map[string]any{"v": v})}
					if evs, err := engine.Decide(s, cmd); err == nil {
						return s, evs, v
					}
				}
			}
			return s, nil, board.Vertex{}
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		step(t, s, cmd)
	}
	return s, nil, board.Vertex{}
}

func onGround(s *engine.State, v board.Vertex) bool {
	for _, g := range fishExtRO(s).Grounds {
		if slices.Contains(g.V, v) {
			return true
		}
	}
	return false
}

func onLake(s *engine.State, v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if t, ok := s.Board.Tiles[h]; ok && t.Res == board.Lake {
			return true
		}
	}
	return false
}

func setupCatch(t *testing.T, evs []engine.Event) (fishCaughtData, []fishGainData) {
	t.Helper()
	var caught *fishCaughtData
	var gains []fishGainData
	for _, e := range evs {
		if e.Type == EvFishCaught {
			d := engine.DecodeEvent[fishCaughtData](e)
			caught = &d
		}
		if e.Type == EvFishGained {
			gains = append(gains, engine.DecodeEvent[fishGainData](e))
		}
	}
	if caught == nil {
		return fishCaughtData{}, nil
	}
	return *caught, gains
}

// TestSetupFishBonus: a second settlement adjacent to a fishing ground or lake
// gets one random fish token on top of the normal starting resources, however
// many sources the corner touches, and the first settlement gets nothing.
func TestSetupFishBonus(t *testing.T) {
	t.Run("second settlement on a ground draws one token", func(t *testing.T) {
		s, evs, _ := setupPlace(t, "base+fishermen", 3, 5, 1, onGround)
		c, gains := setupCatch(t, evs)
		seat := engine.DecodeEvent[engine.SettlementPlacedData](evs[0]).Player
		if c.Total != 1 || c.Draws[seat] != 1 {
			t.Fatalf("catch %+v, want exactly one token for seat %d", c, seat)
		}
		if len(gains) != 1 || gains[0].Player != seat || tileCount(gains[0].Gain) != 1 {
			t.Fatalf("gains %+v, want one tile to seat %d", gains, seat)
		}
		if got := fishExtRO(s).Tiles[seat]; got != 1 {
			t.Fatalf("seat %d holds %d tiles after setup, want 1", seat, got)
		}
	})
	t.Run("second settlement on a lake draws one token", func(t *testing.T) {
		_, evs, _ := setupPlace(t, "base+fishermen", 3, 5, 1, func(s *engine.State, v board.Vertex) bool {
			return onLake(s, v) && !onGround(s, v)
		})
		c, _ := setupCatch(t, evs)
		if c.Total != 1 {
			t.Fatalf("lake corner: catch %+v, want one token", c)
		}
	})
	t.Run("a corner on two sources still draws one", func(t *testing.T) {
		// Seeds until a legal round-2 corner touches two sources (two grounds,
		// or a ground and a lake): the rule gives it one token, not two.
		var evs []engine.Event
		for seed := uint64(1); seed <= 60 && evs == nil; seed++ {
			_, evs, _ = setupPlaceQuiet(t, "base+fishermen", 4, seed, 1, func(s *engine.State, v board.Vertex) bool {
				return fishSources(s, v) >= 2
			})
		}
		if evs == nil {
			t.Fatal("no seed offered a legal round-2 corner on two fish sources")
		}
		c, _ := setupCatch(t, evs)
		if c.Total != 1 {
			t.Fatalf("catch %+v, want one token", c)
		}
	})
	t.Run("first settlement draws nothing", func(t *testing.T) {
		_, evs, _ := setupPlace(t, "base+fishermen", 3, 5, 0, onGround)
		if c, _ := setupCatch(t, evs); c.Total != 0 {
			t.Fatalf("round-1 settlement caught %+v, want nothing", c)
		}
	})
	t.Run("a dry second settlement draws nothing", func(t *testing.T) {
		_, evs, _ := setupPlace(t, "base+fishermen", 3, 5, 1, func(s *engine.State, v board.Vertex) bool {
			return !onGround(s, v) && !onLake(s, v)
		})
		if c, _ := setupCatch(t, evs); c.Total != 0 {
			t.Fatalf("dry corner caught %+v, want nothing", c)
		}
	})
	t.Run("a round-2 city under Knights draws one", func(t *testing.T) {
		_, evs, _ := setupPlace(t, engine.CanonicalRuleset("base+cak+fishermen"), 3, 5, 1, onGround)
		if c, _ := setupCatch(t, evs); c.Total != 1 {
			t.Fatalf("round-2 city caught %+v, want one token", c)
		}
	})
}

// TestBootSupplyGrowsWithTheTable: the old boot hides among every token and
// itself, so at five seats the gate counts down from 44, and resets to 44.
func TestBootSupplyGrowsWithTheTable(t *testing.T) {
	s := boardGame(t, "base+fishermen", 5, 2)
	x := fishExt(s)
	if x.TilesLeft != 44 {
		t.Fatalf("5p TilesLeft = %d, want 44", x.TilesLeft)
	}
	applyCaught(x, fishCaughtData{Draws: make([]int, 5), Total: 44, BootTo: engine.NoPlayer})
	if x.TilesLeft != 44 {
		t.Fatalf("5p TilesLeft after running out = %d, want the reset to 44", x.TilesLeft)
	}
}

// TestSetupFishBonusBootIsPublic: the setup draw can turn up the old boot, and
// reads the public boot slot at the placement's log position, which
// verify/verify.mjs re-derives.
func TestSetupFishBonusBootIsPublic(t *testing.T) {
	for seed := uint64(1); seed <= 400; seed++ {
		s, evs, _ := setupPlace(t, "base+fishermen", 3, seed, 1, onGround)
		_ = s
		c, _ := setupCatch(t, evs)
		boot := engine.PublicRngForSeed(s.PublicSeed, engine.FishBootSeq(evs[0].Seq))
		// A fresh game: TilesLeft is the full notional supply.
		turned := boot.IntN(30) < 1
		if turned != (c.BootTo != engine.NoPlayer) {
			t.Fatalf("seed %d: boot gate says %v, catch says boot_to=%d", seed, turned, c.BootTo)
		}
		if turned {
			return // one seed that turns it up is the positive case
		}
	}
	t.Fatal("no seed in 400 turned the boot up at setup")
}

// TestCaravansByTableSize pins the oases, caravans and camels per bracket: one
// oasis, three caravans and 22 camels at 2 to 4 seats; the 5-6 player
// bracket's two oases, six caravans and 33 camels at 5 and 6; three, nine and
// 44 at 7 to 10 (ours). Every oasis starts all three of its caravans, no two
// oases touch or share a spoke corner, and the robber may stand on none of them.
func TestCaravansByTableSize(t *testing.T) {
	cases := []struct {
		players []int
		oases   int
		camels  int
	}{
		{[]int{2, 3, 4}, 1, 22},
		{[]int{5, 6}, 2, 33},
		{[]int{7, 8, 9, 10}, 3, 44},
	}
	for _, ruleset := range []string{"base+caravans", engine.CanonicalRuleset("base+caravans+fishermen")} {
		for _, c := range cases {
			for _, p := range c.players {
				for seed := uint64(1); seed <= 16; seed++ {
					s := boardGame(t, ruleset, p, seed)
					x := caravansExt(s)
					if len(x.Oases) != c.oases || !x.HasOasis || x.Oases[0] != x.Oasis {
						t.Fatalf("%s %dp seed %d: oases %v (first %v), want %d", ruleset, p, seed, x.Oases, x.Oasis, c.oases)
					}
					if x.CamelsLeft != c.camels || x.CamelSupply != c.camels {
						t.Fatalf("%s %dp seed %d: camels %d of %d, want %d", ruleset, p, seed, x.CamelsLeft, x.CamelSupply, c.camels)
					}
					if len(x.Arrows) != 3*c.oases {
						t.Fatalf("%s %dp seed %d: %d caravans, want %d", ruleset, p, seed, len(x.Arrows), 3*c.oases)
					}
					corners := map[board.Vertex]bool{}
					for i, a := range x.Arrows {
						if a == (board.Edge{}) {
							t.Fatalf("%s %dp seed %d: caravan %d has no spoke", ruleset, p, seed, i)
						}
						for _, v := range []board.Vertex{a.A, a.B} {
							if corners[v] {
								t.Fatalf("%s %dp seed %d: two spokes share %v", ruleset, p, seed, v)
							}
							corners[v] = true
						}
						ring := x.Oases[i/3].Vertices()
						if !slices.Contains(ring[:], x.ArrowCorner[i]) {
							t.Fatalf("%s %dp seed %d: caravan %d leaves from %v, not a corner of oasis %v",
								ruleset, p, seed, i, x.ArrowCorner[i], x.Oases[i/3])
						}
					}
					for i, o := range x.Oases {
						if r := s.Board.Tiles[o].Res; r != board.ResNone && r != board.Lake {
							t.Fatalf("%s %dp seed %d: oasis %v is %v", ruleset, p, seed, o, r)
						}
						if !robberForbidden(s, o) {
							t.Fatalf("%s %dp seed %d: the robber may stand on oasis %v", ruleset, p, seed, o)
						}
						for _, q := range x.Oases[:i] {
							if hexDistance(o, q) < 2 {
								t.Fatalf("%s %dp seed %d: oases %v and %v touch", ruleset, p, seed, o, q)
							}
						}
					}
					if n := len(CamelPaths(s)); n != 3*c.oases {
						t.Fatalf("%s %dp seed %d: %d opening placements, want one per caravan (%d)", ruleset, p, seed, n, 3*c.oases)
					}
				}
			}
		}
	}
}

// TestLegacyCaravansBlobKeepsOneOasis: a log from before derivation 13 records
// one oasis, three arrows and no supply. Folded over a 5-seat derivation it
// must still be the game that was played: one oasis, three caravans, 22 camels.
func TestLegacyCaravansBlobKeepsOneOasis(t *testing.T) {
	s := boardGame(t, "base+caravans", 5, 3)
	fresh := freshCaravans(s)
	legacy, err := json.Marshal(map[string]any{
		"Oasis": fresh.Oasis, "HasOasis": true,
		"Arrows": fresh.Arrows[:3], "ArrowCorner": fresh.ArrowCorner[:3],
		"Chains": []any{nil, nil, nil}, "CamelsLeft": 22,
	})
	if err != nil {
		t.Fatal(err)
	}
	x := freshCaravans(s)
	if err := json.Unmarshal(legacy, x); err != nil {
		t.Fatal(err)
	}
	if len(x.Oases) != 1 || x.Oases[0] != fresh.Oasis || x.Supply() != 22 || len(x.Arrows) != 3 || len(x.Chains) != 3 {
		t.Fatalf("legacy fold: oases %v supply %d arrows %d chains %d, want one oasis, 22, 3, 3",
			x.Oases, x.Supply(), len(x.Arrows), len(x.Chains))
	}
	s.Ext[CaravansName] = x
	if robberForbidden(s, fresh.Oases[1]) {
		t.Fatal("a legacy game forbids the robber a hex that was never its oasis")
	}
}

// TestOasesClash pins the rule that keeps two oases apart: no two may touch,
// and no spoke of one may share an intersection with a spoke of the other.
func TestOasesClash(t *testing.T) {
	b := &board.Board{Radius: 3, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(3) {
		b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
	}
	o := board.Hex{}
	for _, n := range o.Neighbors() {
		if !oasesClash(b, o, n) || !oasesClash(b, n, o) {
			t.Errorf("oases %v and %v touch and do not clash", o, n)
		}
	}
	far := board.Hex{Q: 3, R: -3}
	if hexDistance(o, far) < 3 || oasesClash(b, o, far) {
		t.Errorf("oases %v and %v, three apart, clash", o, far)
	}
	shared := 0
	for _, h := range board.HexesInRadius(2) {
		if hexDistance(o, h) != 2 {
			continue
		}
		if oasesClash(b, o, h) {
			shared++
		}
	}
	if shared == 0 {
		t.Error("no hex two away shares a spoke intersection")
	}
}
