package wagons

import (
	"testing"

	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/raiders"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// --- the trade hexes -------------------------------------------------------

// Conformance: "Exactly three, derived from the board as cape hexes (three
// consecutive non-land neighbours), chosen as the triple with the largest
// minimum pairwise distance, parity and role assignment seeded. On a generated
// full hexagon of radius R they are three alternating outer-ring corners, 2R
// apart."
func TestTradeHexesAlternateOuterCorners(t *testing.T) {
	for _, players := range []int{2, 3, 4, 5, 6, 7, 8, 9, 10} {
		s := newGame(t, players, "base+wagons")
		x, ok := StateExt(s)
		if !ok || !x.HasTrade {
			t.Fatalf("%dp: no trade hexes derived", players)
		}
		r := s.Board.Radius
		seen := map[board.Hex]bool{}
		for _, h := range x.Trade {
			if seen[h] {
				t.Fatalf("%dp: the same hex twice: %v", players, h)
			}
			seen[h] = true
			if _, isCape := capeOutward(s.Board, h); !isCape {
				t.Fatalf("%dp: trade hex %v is not a cape", players, h)
			}
			if got := hexDist(board.Hex{}, h); got != r {
				t.Fatalf("%dp: trade hex %v is %d rings out, want the outer ring %d", players, h, got, r)
			}
		}
		// Alternating corners of a full hexagon sit 2R apart pairwise: three
		// legs of one circuit, each the same length.
		for i := range tradeHexCount {
			for j := i + 1; j < tradeHexCount; j++ {
				if got := hexDist(x.Trade[i], x.Trade[j]); got != 2*r {
					t.Fatalf("%dp: %v and %v are %d apart, want 2R = %d",
						players, x.Trade[i], x.Trade[j], got, 2*r)
				}
			}
		}
		// One of each role, so the cargo cycle is complete.
		roles := map[uint8]int{}
		for _, r := range x.Roles {
			roles[r]++
		}
		for role := range uint8(tradeHexCount) {
			if roles[role] != 1 {
				t.Fatalf("%dp: role %d appears %d times, want exactly once", players, role, roles[role])
			}
		}
	}
}

// The derivation is a pure function of the board and the public seed: one seed
// gives one layout (replay determinism), and different seeds generally give
// different layouts (the seed is actually consulted).
func TestTradeHexDerivationSeeded(t *testing.T) {
	layout := func(seed uint64) ([tradeHexCount]board.Hex, [tradeHexCount]uint8) {
		evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base+wagons"}, engine.SeedsFrom(seed))
		if err != nil {
			t.Fatal(err)
		}
		s, err := engine.Replay(evs)
		if err != nil {
			t.Fatal(err)
		}
		x, _ := StateExt(s)
		return x.Trade, x.Roles
	}
	h1, r1 := layout(fixtureSeed)
	h2, r2 := layout(fixtureSeed)
	if h1 != h2 || r1 != r2 {
		t.Fatalf("the same seed dealt two layouts: %v/%v then %v/%v", h1, r1, h2, r2)
	}
	// Across a spread of seeds both parity and roles move; a derivation that
	// ignored the seed would give one answer.
	hexes, roles := map[[tradeHexCount]board.Hex]bool{}, map[[tradeHexCount]uint8]bool{}
	for seed := range uint64(24) {
		h, r := layout(seed)
		hexes[h] = true
		roles[r] = true
	}
	if len(hexes) < 2 {
		t.Fatalf("24 seeds produced one trade-hex triple")
	}
	if len(roles) < 2 {
		t.Fatalf("24 seeds produced one role assignment")
	}
}

// The result depends only on the land mask and the seed, so it must not change
// with the SetupBoard position. Checked against every allowed partner.
func TestTradeHexClaimIsIndependentOfCompanions(t *testing.T) {
	base := newGame(t, 4, "base+wagons")
	bx, _ := StateExt(base)
	for _, rs := range []string{"base+cak+wagons", "base+caravans+wagons"} {
		s := newGame(t, 4, rs)
		x, ok := StateExt(s)
		if !ok || !x.HasTrade {
			t.Fatalf("%s: no trade hexes", rs)
		}
		if x.Trade != bx.Trade || x.Roles != bx.Roles {
			t.Fatalf("%s moved the trade hexes: %v/%v against base %v/%v",
				rs, x.Trade, x.Roles, bx.Trade, bx.Roles)
		}
	}
}

// Conformance: "Trade hexes keep terrain and number and produce for their land
// corners. The 2 and the 12 stay in the number deal and no roll is ever
// re-rolled."
//
// We do not remove three tiles and the 2 and 12 chips as a fixed board does
// (that follows from a bag of 18 chips for 19 hexes); blanking three outer hexes
// would remove about a sixth of a small board's production.
func TestTradeHexesKeepTheirTerrainAndNumber(t *testing.T) {
	plain, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base"}, engine.SeedsFrom(fixtureSeed))
	if err != nil {
		t.Fatal(err)
	}
	plainState, err := engine.Replay(plain)
	if err != nil {
		t.Fatal(err)
	}
	s := newGame(t, 4, "base+wagons")
	x, _ := StateExt(s)
	for _, h := range x.Trade {
		got, want := s.Board.Tiles[h], plainState.Board.Tiles[h]
		if got != want {
			t.Fatalf("trade hex %v is %v, want base tile %v", h, got, want)
		}
	}
	// The whole board is the base game's board: this module reshapes no tile.
	// (It moves the robber off the board, which is not a tile.)
	for h, want := range plainState.Board.Tiles {
		if got := s.Board.Tiles[h]; got != want {
			t.Fatalf("hex %v is %v under Wagons and %v under base", h, got, want)
		}
	}
}

// The 2 and the 12 stay in the deal. Checked over a spread of boards,
// since any single board may not have been dealt one.
func TestTwoAndTwelveStayInTheDeal(t *testing.T) {
	found := map[int]bool{}
	for seed := range uint64(40) {
		evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base+wagons"}, engine.SeedsFrom(seed))
		if err != nil {
			t.Fatal(err)
		}
		s, err := engine.Replay(evs)
		if err != nil {
			t.Fatal(err)
		}
		for _, tile := range s.Board.Tiles {
			if tile.Number == 2 || tile.Number == 12 {
				found[tile.Number] = true
			}
		}
	}
	if !found[2] || !found[12] {
		t.Fatalf("40 boards: dealt 2 = %v, dealt 12 = %v, want both", found[2], found[12])
	}
}

// --- the shape of a trade hex ---------------------------------------------

// Conformance: "Plaza vertex, four spokes to the four land corners, three
// blocked coastal edges, two blocked coastal corners. Seven usable paths, five
// usable intersections, four buildable."
//
// Seven paths is three perimeter plus four spokes; the spokes are the module's
// own graph while the trade-hex tile is deferred (see board.go), so the count is
// asserted through the movement graph.
func TestTradeHexTopology(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	for i, h := range x.Trade {
		corners := landCorners(s.Board, h)
		if len(corners) != 4 {
			t.Fatalf("trade hex %d (%v) has %d land corners, want 4", i, h, len(corners))
		}
		blockedCorners := 0
		for _, v := range h.Vertices() {
			if !cornerIsLand(s.Board, h, v) {
				blockedCorners++
			}
		}
		if blockedCorners != 2 {
			t.Fatalf("trade hex %d has %d blocked corners, want 2", i, blockedCorners)
		}
		sea := seawardEdges(s.Board, h)
		if len(sea) != 3 {
			t.Fatalf("trade hex %d has %d seaward edges, want 3", i, len(sea))
		}
		// The plaza reaches all four land corners and nothing else.
		plaza := plazaOf(h)
		spokes := steps(s, x, plaza)
		if len(spokes) != 4 {
			t.Fatalf("trade hex %d's plaza has %d spokes, want 4", i, len(spokes))
		}
		for _, st := range spokes {
			if !st.Spoke {
				t.Fatalf("trade hex %d's plaza reached %v by something that is not a spoke", i, st.To)
			}
		}
		// Seven usable paths: the three land-side perimeter edges plus the four
		// spokes. The perimeter is six edges, three of which are seaward.
		usable := 0
		for _, e := range h.Edges() {
			if !blockedEdgeOn(s.Board, x.Trade, e) && s.Board.LandEdge(e) {
				usable++
			}
		}
		if usable+4 != 7 {
			t.Fatalf("trade hex %d offers %d perimeter paths plus 4 spokes, want 7 in total", i, usable)
		}
		// Five usable intersections: four land corners and the plaza.
		if len(corners)+1 != 5 {
			t.Fatalf("trade hex %d offers %d intersections, want 5", i, len(corners)+1)
		}
	}
}

// No settlement or city on a plaza. checkSettlementSpot rejects any vertex
// whose Side is past board.S, so the base engine refuses it without knowing
// what a plaza is.
func TestNoBuildingOnAPlaza(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	plaza := plazaOf(x.Trade[0])
	if !isPlaza(plaza) {
		t.Fatal("the plaza is not addressed as a plaza")
	}
	for _, ct := range []engine.CommandType{engine.CmdBuildSettlement, engine.CmdBuildCity} {
		refuse(t, s, cmd(s.Cur, ct, map[string]any{"v": plaza}), engine.ErrBadPlacement)
	}
	// It is never offered either: the legal set is built from the board's
	// own vertices.
	for _, v := range s.LegalSettlements(s.Cur) {
		if isPlaza(v) {
			t.Fatalf("a plaza (%v) was offered as a settlement spot", v)
		}
	}
}

// No road on a trade hex's three blocked coastal edges. The building stands
// there.
func TestNoRoadOnABlockedCoastalEdge(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	blocked := seawardEdges(s.Board, x.Trade[0])
	if len(blocked) == 0 {
		t.Fatal("the fixture trade hex has no blocked edges")
	}
	for _, e := range blocked {
		refuse(t, s, cmd(s.Cur, engine.CmdBuildRoad, map[string]any{"e": e}), engine.ErrOccupied)
		for _, offered := range s.LegalRoads(s.Cur) {
			if offered == e {
				t.Fatalf("blocked coastal edge %v was offered as a road target", e)
			}
		}
	}
}

// A blocked corner takes no settlement: the two water-only corners are the
// building's.
func TestNoSettlementOnABlockedCorner(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	var blocked []board.Vertex
	for _, v := range x.Trade[0].Vertices() {
		if !cornerIsLand(s.Board, x.Trade[0], v) {
			blocked = append(blocked, v)
		}
	}
	if len(blocked) != 2 {
		t.Fatalf("want 2 blocked corners, got %d", len(blocked))
	}
	for _, v := range blocked {
		for _, offered := range s.LegalSettlements(s.Cur) {
			if offered == v {
				t.Fatalf("blocked corner %v was offered as a settlement spot", v)
			}
		}
	}
}

// The four land corners are ordinary intersections: the distance rule applies
// and a road may reach them.
func TestLandCornersBehaveNormally(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	for i := range x.Trade {
		for _, v := range landCorners(s.Board, x.Trade[i]) {
			if s.Board.LandVertex(v) != true {
				t.Fatalf("land corner %v of trade hex %d is not a land vertex", v, i)
			}
			// Reachable in the wagon graph by an ordinary board edge, so a road
			// on that edge is a road to the trade hex.
			byEdge := false
			for _, st := range steps(s, x, v) {
				if !st.Spoke {
					byEdge = true
				}
			}
			if !byEdge {
				t.Fatalf("land corner %v of trade hex %d has no ordinary path off it", v, i)
			}
		}
	}
}

// --- the barbarians --------------------------------------------------------

// Conformance: "Exactly three, one per path, never on a blocked edge, never
// blocking construction. Start positions derived per trade hex at (R-1)*d[i] /
// (R-1)*d[i] + d[i+1] with a deterministic walk as the fallback."
func TestThreeBarbariansOnDistinctLegalPaths(t *testing.T) {
	for _, players := range []int{2, 4, 6, 8, 10} {
		s := newGame(t, players, "base+wagons")
		x, _ := StateExt(s)
		seen := map[board.Edge]bool{}
		for i, e := range x.Barb {
			if e == (board.Edge{}) {
				t.Fatalf("%dp: barbarian %d was never placed", players, i)
			}
			if seen[e] {
				t.Fatalf("%dp: two barbarians on one path %v", players, e)
			}
			seen[e] = true
			if !e.Valid() || !s.Board.LandEdge(e) {
				t.Fatalf("%dp: barbarian %d on %v, not a road path", players, i, e)
			}
			if blockedEdgeOn(s.Board, x.Trade, e) {
				t.Fatalf("%dp: barbarian %d on blocked trade-hex edge %v", players, i, e)
			}
		}
		if x.Barb != x.Barbarians {
			t.Fatalf("%dp: live barbarians differ from the derivation", players)
		}
	}
}

// The derived start is one ring inside the trade hex and one step around it.
// Asserted against the formula rather than recorded coordinates, so it follows
// the trade hexes if they move.
func TestBarbarianStartsOneRingInAndOneAround(t *testing.T) {
	s := newGame(t, 4, "base+wagons")
	x, _ := StateExt(s)
	for i, h := range x.Trade {
		dir, ok := capeOutward(s.Board, h)
		if !ok {
			t.Fatalf("trade hex %d is not a cape", i)
		}
		inner := board.Hex{Q: h.Q - hexDirs[dir].Q, R: h.R - hexDirs[dir].R}
		round := hexDirs[(dir+1)%6]
		around := board.Hex{Q: inner.Q + round.Q, R: inner.R + round.R}
		want, ok := sharedEdge(inner, around)
		if !ok {
			t.Fatalf("trade hex %d: %v and %v do not share an edge", i, inner, around)
		}
		if x.Barb[i] != want {
			t.Fatalf("barbarian %d is on %v, want the derived %v", i, x.Barb[i], want)
		}
	}
}

// A barbarian does not stop anything being built. Its only effect is the 2 MP a
// wagon pays to cross it.
func TestBarbarianDoesNotBlockBuilding(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	// Put a barbarian on a path the current seat may legally build a road on,
	// then require that road to still be legal.
	roads := s.LegalRoads(s.Cur)
	if len(roads) == 0 {
		t.Fatal("fixture: seat can build no road")
	}
	x.Barb[0] = roads[0]
	if got := s.LegalRoads(s.Cur); len(got) != len(roads) {
		t.Fatalf("barbarian removed %d road targets, want 0", len(roads)-len(got))
	}
	found := false
	for _, e := range s.LegalRoads(s.Cur) {
		if e == roads[0] {
			found = true
		}
	}
	if !found {
		t.Fatalf("the barbarian's own path %v stopped being a legal road target", roads[0])
	}
}
