package scenarios

import (
	"errors"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
)

// Rules-conformance tests, each naming the rule it pins.

// TestModuleNamesMatch pins the module-name strings this package uses for its
// combination rules against the packages that own them. caravans.go uses strings
// rather than importing engine/knights and engine/islands; a test may import both.
func TestModuleNamesMatch(t *testing.T) {
	if knightsModuleName != knights.Name {
		t.Errorf("knightsModuleName = %q, engine/knights calls itself %q", knightsModuleName, knights.Name)
	}
	if islandsModuleName != islands.Name {
		t.Errorf("islandsModuleName = %q, engine/islands calls itself %q", islandsModuleName, islands.Name)
	}
}

// TestRobberBlocksTheLake: the robber may be placed on the lake, where it blocks
// production for all four of its numbers, and may not be placed on fishing
// grounds.
func TestRobberBlocksTheLake(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 8)
	x := fishExt(s)

	// A settlement on a lake corner, and the robber anywhere else.
	var lake board.Hex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Tiles[h].Res == board.Lake {
			lake, found = h, true
			break
		}
	}
	if !found {
		t.Fatal("no lake on a Fishermen board")
	}
	v := lake.Vertices()[0]
	for _, n := range v.Neighbors() {
		delete(s.Buildings, n)
	}
	s.Buildings[v] = engine.Building{Owner: 0}

	roll := LakeNumbers[0] // 2: one die each
	catch := func() []engine.Event { return fishCatch(s, roll/2, roll-roll/2) }

	s.Board.Robber = board.OffBoard
	if evs := catch(); len(evs) == 0 {
		t.Fatal("the lake paid nothing with the robber off the board")
	}
	// Reset the holding: the assertion is about whether a catch happens at
	// all.
	x.Held[0] = [3]int{}

	s.Board.Robber = lake
	if evs := catch(); len(evs) != 0 {
		t.Errorf("the lake paid on %d with the robber standing on it: %+v", roll, evs)
	}

	// The grounds are unblockable: a ground is a marker on water, where the
	// robber may not stand.
	g := x.Grounds[0]
	gv := g.V[0]
	for _, n := range gv.Neighbors() {
		delete(s.Buildings, n)
	}
	s.Buildings[gv] = engine.Building{Owner: 0}
	for _, h := range g.Hex.Neighbors() {
		if !s.Board.Land(h) {
			continue
		}
		s.Board.Robber = h
		if evs := fishCatch(s, g.Number/2, g.Number-g.Number/2); len(evs) == 0 {
			t.Errorf("a robber on %v stopped fishing ground %d, which sits on water", h, g.Number)
		}
		x.Held[0] = [3]int{}
	}
}

// TestFishTileCapAndExchange: never more than 7 fish tokens at once, and a seat
// holding 7 that would obtain more may instead exchange one of its tokens with
// one from the supply, once per turn, and then stops drawing. The cap is why the
// spend table tops out at seven.
func TestFishTileCapAndExchange(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 8)
	x := fishExt(s)
	g := x.Grounds[0]
	v := g.V[0]
	for _, n := range v.Neighbors() {
		delete(s.Buildings, n)
	}
	s.Buildings[v] = engine.Building{Owner: 0, City: true} // draws two

	d1, d2 := g.Number/2, g.Number-g.Number/2

	// At the cap, holding only 3-fish tiles: the exchange can only lose
	// value, so the engine declines it and nothing is drawn (our decision;
	// see fishCatch).
	x.Held[0] = [3]int{0, 0, fishTileCap}
	x.Tiles[0] = tileCount(x.Held[0])
	if evs := fishCatch(s, d1, d2); len(evs) != 0 {
		t.Errorf("seat at the cap with nothing to trade in drew: %+v", evs)
	}

	// At the cap holding a 1-fish tile: exactly one exchange, so the holding
	// stays at the cap and one tile has been swapped for a fresh draw.
	x.Held[0] = [3]int{1, 0, fishTileCap - 1}
	x.Tiles[0] = tileCount(x.Held[0])
	before := x.Supply
	evs := fishCatch(s, d1, d2)
	if len(evs) == 0 {
		t.Fatal("a seat at the cap with a 1-fish tile took no exchange")
	}
	for i := range evs {
		evs[i].Seq = s.NextSeq
		if err := engine.Apply(s, evs[i]); err != nil {
			t.Fatal(err)
		}
	}
	if got := tileCount(x.Held[0]); got != fishTileCap {
		t.Errorf("holding = %d tiles after the exchange, want the cap %d", got, fishTileCap)
	}
	drawn := before[0] + before[1] + before[2] - (x.Supply[0] + x.Supply[1] + x.Supply[2])
	if drawn != 1 {
		t.Errorf("exchange drew %d tiles, want 1", drawn)
	}
	if x.Tiles[0] != tileCount(x.Held[0]) {
		t.Errorf("public tile count %d, holding %v after an exchange", x.Tiles[0], x.Held[0])
	}

	// Under the cap, a draw is an ordinary draw and the cap only trims the tail.
	x.Held[0] = [3]int{fishTileCap - 1, 0, 0}
	x.Tiles[0] = tileCount(x.Held[0])
	evs = fishCatch(s, d1, d2)
	if len(evs) == 0 {
		t.Fatal("a seat one tile under the cap drew nothing")
	}
	for i := range evs {
		evs[i].Seq = s.NextSeq
		if err := engine.Apply(s, evs[i]); err != nil {
			t.Fatal(err)
		}
	}
	if got := tileCount(x.Held[0]); got != fishTileCap {
		t.Errorf("holding = %d tiles, want the cap %d", got, fishTileCap)
	}
}

// TestFiveFishBuysAShipUnderIslands: under this pairing 5 fish may build a ship
// as well as a road. The credit is the shared FreeRoads counter, so the test
// guards the justifying edge: a legal ship edge must be accepted.
func TestFiveFishBuysAShipUnderIslands(t *testing.T) {
	s, _ := newGame(t, "base+fishermen+islands", 3)
	rolled(t, s)
	p := s.Cur
	setHeld(fishExt(s), p, [3]int{20, 0, 0})

	shipEdges := func() []board.Edge {
		var out []board.Edge
		for _, m := range s.Modules() {
			if h := m.Hooks().LegalExtras; h != nil {
				out = append(out, h(s, p).Ships...)
			}
		}
		return out
	}
	// Sail one ship out first. The opening ship edges are coastal, and a
	// coastal edge is also a road edge, so a spend justified by one would
	// take the road branch and prove nothing. One ship out to sea puts a
	// ship-only edge on the frontier.
	//
	// A bounded search, not a seeded guess: it finds the edge or the board
	// has no sea, which should fail loudly. If auto-pass left the seat no
	// coastal building to sail from, one is constructed on the coast.
	if len(shipEdges()) == 0 {
		placed := false
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			for _, v := range h.Vertices() {
				if placed || engine.CheckSettlementSpot(s, v) != nil {
					continue
				}
				for _, e := range v.Edges() {
					if !placed && s.Board.SeaEdge(e) && s.Board.LandEdge(e) {
						s.Buildings[v] = engine.Building{Owner: p}
						placed = true
					}
				}
			}
		}
		if !placed {
			t.Fatal("no free coastal vertex to anchor a ship on")
		}
	}
	var seaOnly board.Edge
	for range 4 {
		roads := s.LegalRoads(p)
		ships := shipEdges()
		if i := slices.IndexFunc(ships, func(e board.Edge) bool { return !slices.Contains(roads, e) }); i >= 0 {
			seaOnly = ships[i]
			break
		}
		if len(ships) == 0 {
			break
		}
		s.Players[p].Hand.Add(islands.CostShip)
		step(t, s, engine.Command{Player: p, Type: islands.CmdBuildShip,
			Data: mustJSON(t, map[string]any{"e": ships[0]})})
	}
	if seaOnly == (board.Edge{}) {
		t.Fatal("fixture: no ship edge that is not a road edge")
	}

	before := s.FreeRoads
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad, "e": seaOnly})})
	if s.FreeRoads != before+1 {
		t.Fatalf("free builds = %d, want %d", s.FreeRoads, before+1)
	}
	// And the credit really does buy that ship, for nothing.
	handBefore := s.Players[p].Hand
	step(t, s, engine.Command{Player: p, Type: islands.CmdBuildShip,
		Data: mustJSON(t, map[string]any{"e": seaOnly})})
	if s.FreeRoads != before {
		t.Errorf("free builds = %d after the ship, want %d", s.FreeRoads, before)
	}
	if s.Players[p].Hand != handBefore {
		t.Errorf("the free ship was charged: hand %v -> %v", handBefore, s.Players[p].Hand)
	}
}

// TestCaravanReturnUsesOasisPerimeter: a caravan's first camel may
// not go on a path along the oasis hex's edge, but a caravan that finds its way
// back to the oasis may place a camel there.
func TestCaravanReturnUsesOasisPerimeter(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	x := caravansExt(s)
	if !x.HasOasis {
		t.Fatal("no oasis")
	}
	perimEdges := x.Oasis.Edges()
	perim := perimEdges[:]

	// The first camel is barred with no code of its own: oasisSpokes only
	// picks non-perimeter edges as arrows.
	for i := range caravansPerOasis {
		if a := x.Arrows[i]; a != (board.Edge{}) && slices.Contains(perim, a) {
			t.Fatalf("caravan %d starts on the oasis perimeter edge %v", i, a)
		}
	}

	// A later camel is not barred. Build a chain whose front is back on an
	// oasis corner: an outward edge at that corner with one more edge
	// behind it.
	var corner board.Vertex
	var out, behind board.Edge
	for _, v := range x.Oasis.Vertices() {
		for _, e := range v.Edges() {
			if slices.Contains(perim, e) || !s.Board.LandEdge(e) {
				continue
			}
			far := e.Other(v)
			for _, b := range far.Edges() {
				if b == e || !s.Board.LandEdge(b) {
					continue
				}
				corner, out, behind = v, e, b
				break
			}
			if out != (board.Edge{}) {
				break
			}
		}
		if out != (board.Edge{}) {
			break
		}
	}
	if out == (board.Edge{}) {
		t.Skip("this board offers no land path back to an oasis corner")
	}
	x.Chains[0] = []board.Edge{behind, out}
	x.Occupied[behind] = true
	x.Occupied[out] = true
	if got := caravanFront(x, 0); got != corner {
		t.Fatalf("fixture: the chain's front is %v, want the oasis corner %v", got, corner)
	}

	got := (Caravans{}).caravanFrontEdges(x, s, 0)
	onPerimeter := 0
	for _, e := range got {
		if slices.Contains(perim, e) {
			onPerimeter++
		}
	}
	if onPerimeter == 0 {
		t.Errorf("a caravan back at the oasis was offered %v, none of them along the oasis: "+
			"a returning caravan may use the oasis perimeter", got)
	}
}

// TestCaravansMergeRatherThanBlock pins the merging rule: two caravans meeting at
// an intersection merge as soon as the next camel is placed and continue as a
// single caravan. A rival chain is not a wall; the scoring vertex where the
// chains meet counts.
func TestCaravansMergeRatherThanBlock(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	x := caravansExt(s)
	if !x.HasOasis {
		t.Fatal("no oasis")
	}

	// Grow caravan 0 one camel, then find an edge that reaches its front from
	// somewhere else: that is two chains meeting at an intersection.
	x.Chains[0] = []board.Edge{x.Arrows[0]}
	x.Occupied[x.Arrows[0]] = true
	front := caravanFront(x, 0)

	var joining board.Edge
	for _, e := range front.Edges() {
		if e != x.Arrows[0] && s.Board.LandEdge(e) && !x.Occupied[e] {
			joining = e
			break
		}
	}
	if joining == (board.Edge{}) {
		t.Fatal("caravan 0's front has no free land edge")
	}
	// Put that edge on caravan 1 as if its chain had arrived here. The two now
	// meet at `front`.
	x.Chains[1] = []board.Edge{joining}
	x.Occupied[joining] = true

	// A building at the meeting point scores, though the two camels belong to
	// different caravans. The rule says only "between 2 camels".
	for _, n := range front.Neighbors() {
		delete(s.Buildings, n)
	}
	s.Buildings[front] = engine.Building{Owner: 0}
	if got := VictoryVP(s, 0); got != 1 {
		t.Errorf("building between camels of two caravans scored %d, want 1", got)
	}

	// What happens next at the meeting point is
	// TestCaravansMergeAndContinue's.
}

// TestCaravansMergeAndContinue: two caravans meeting at an intersection merge as
// soon as the next camel is placed and continue as a single caravan.
//
// Two heads meeting leave the intersection one free path, and both caravans'
// other ends are anchored at the oasis, so that third path is where the merged
// caravan continues. Pinned: the third path is offered exactly once across the
// list, a camel on it extends the merged caravan, and the junction building
// still scores one point.
func TestCaravansMergeAndContinue(t *testing.T) {
	for seed := uint64(1); seed <= 40; seed++ {
		s, _ := newGame(t, "base+caravans", seed)
		x := caravansExt(s)
		if !x.HasOasis {
			t.Fatal("no oasis")
		}
		free := func(e board.Edge, avoid ...board.Vertex) bool {
			if !s.Board.LandEdge(e) || x.Occupied[e] {
				return false
			}
			for _, v := range avoid {
				if e.A == v || e.B == v {
					return false
				}
			}
			return true
		}
		// Caravan 0 takes its arrow; its head is at `meet`.
		x.Chains[0] = []board.Edge{x.Arrows[0]}
		x.Occupied[x.Arrows[0]] = true
		meet := caravanFront(x, 0)
		var joining, third, prev board.Edge
		for _, e := range meet.Edges() {
			if e == x.Arrows[0] || !free(e) {
				continue
			}
			if joining == (board.Edge{}) {
				joining = e
			} else {
				third = e
			}
		}
		if joining == (board.Edge{}) || third == (board.Edge{}) {
			x.Chains[0], x.Occupied = nil, map[board.Edge]bool{}
			continue
		}
		// Caravan 1 arrives head first along `joining`: a two-camel chain with
		// its head at `meet`, laid down directly.
		w := joining.Other(meet)
		for _, e := range w.Edges() {
			if e != joining && free(e, x.ArrowCorner[0], third.Other(meet)) {
				prev = e
				break
			}
		}
		if prev == (board.Edge{}) {
			x.Chains[0], x.Occupied = nil, map[board.Edge]bool{}
			continue
		}
		x.Chains[1] = []board.Edge{prev, joining}
		x.Occupied[prev], x.Occupied[joining] = true, true
		if caravanFront(x, 1) != meet {
			t.Fatalf("fixture: caravan 1's head is %v, want %v", caravanFront(x, 1), meet)
		}

		// The third path is offered, and once.
		n := 0
		for _, p := range CamelPaths(s) {
			if p.E == third {
				n++
				if p.Caravan != 0 {
					t.Errorf("the merge path is offered on caravan %d, want the lower-numbered 0", p.Caravan)
				}
			}
		}
		if n != 1 {
			t.Fatalf("seed %d: the merged caravan's continuation %v is offered %d times, want 1", seed, third, n)
		}

		// Place it: the merged caravan now continues from the far end.
		ev := engine.NewEvent(EvCamelPlaced, camelPlacedData{Caravan: 0, E: third})
		if _, err := (Caravans{}).Apply(s, ev); err != nil {
			t.Fatal(err)
		}
		if got := caravanFront(x, 0); got != third.Other(meet) {
			t.Errorf("merged caravan's head is %v, want %v", got, third.Other(meet))
		}
		if got := (Caravans{}).caravanFrontEdges(x, s, 1); len(got) != 0 {
			t.Errorf("the absorbed caravan still offers %v after the merge", got)
		}
		for _, n := range meet.Neighbors() {
			delete(s.Buildings, n)
		}
		s.Buildings[meet] = engine.Building{Owner: 0}
		if got := VictoryVP(s, 0); got != 1 {
			t.Errorf("the junction building scored %d, want 1", got)
		}
		return
	}
	t.Fatal("no seed in 1..40 gave a meeting point with a free third path")
}

// TestCaravanCamelsCrossWaterUnderIslands pins the sea combination rule: camels
// may go anywhere beside overland routes and waterways, roads and ships. A
// caravan whose head is on the coast is offered the adjacent sea path under
// Islands, and not without it.
func TestCaravanCamelsCrossWaterUnderIslands(t *testing.T) {
	s, _ := newGame(t, "base+caravans+islands", 3)
	x := caravansExt(s)
	// A coastal vertex with a sea-only path leaving it, reached over two land
	// paths so a two-camel chain can have its head there.
	var sea, in, prev board.Edge
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if s.Board.LandEdge(e) || !e.Valid() || !s.Board.SeaEdge(e) {
				continue
			}
			for _, v := range []board.Vertex{e.A, e.B} {
				if !s.Board.LandVertex(v) {
					continue
				}
				for _, a := range v.Edges() {
					if a == e || !s.Board.LandEdge(a) {
						continue
					}
					for _, b := range a.Other(v).Edges() {
						if b != a && s.Board.LandEdge(b) && b.Other(a.Other(v)) != v {
							sea, in, prev = e, a, b
						}
					}
				}
			}
		}
	}
	if sea == (board.Edge{}) {
		t.Fatal("fixture: no coastal vertex with a sea path and a land approach")
	}
	x.Chains[0] = []board.Edge{prev, in}
	x.Occupied = map[board.Edge]bool{prev: true, in: true}
	if !slices.Contains((Caravans{}).caravanFrontEdges(x, s, 0), sea) {
		t.Errorf("under Islands the caravan at the coast is not offered the sea path %v", sea)
	}
	s.Config.Ruleset = "base+caravans"
	if slices.Contains((Caravans{}).caravanFrontEdges(x, s, 0), sea) {
		t.Errorf("without Islands the caravan was offered the sea path %v", sea)
	}
}

// TestCaravansTargetVPPerCombination pins the two combination rules: alongside
// Knights the game ends at 15 victory points, and alongside the sea expansion
// the target rises by 2. It asks the engine (engine.ResolveTargetVP) on the
// canonical spelling a real game carries, not this module's helper.
func TestCaravansTargetVPPerCombination(t *testing.T) {
	for _, tc := range []struct {
		ruleset string
		want    int
	}{
		{"base+caravans", 12},
		{"base+cak+caravans", 15},
		{"base+caravans+islands", 14},
		{"base+cak+caravans+islands", 17},
		{"base+caravans+fishermen", 12},
	} {
		if got := engine.CanonicalRuleset(tc.ruleset); got != tc.ruleset {
			t.Errorf("%q is not the spelling a game carries (%q)", tc.ruleset, got)
		}
		got := engine.ResolveTargetVP(engine.GameConfig{Players: 4, Ruleset: tc.ruleset})
		if got != tc.want {
			t.Errorf("ResolveTargetVP(%q) = %d, want %d", tc.ruleset, got, tc.want)
		}
	}
}

// TestCaravanBidResourcesFollowTheRuleset pins the first Caravans-with-Knights
// combination rule: the nomads collect brick and lumber instead of wool and
// grain.
func TestCaravanBidResourcesFollowTheRuleset(t *testing.T) {
	plain, _ := newGame(t, "base+caravans", 5)
	if got := BidResources(plain); got != [2]board.Resource{board.Sheep, board.Wheat} {
		t.Errorf("base+caravans bids in %v, want wool and grain", got)
	}
	knights, _ := newGame(t, "base+caravans+cak", 5)
	if got := BidResources(knights); got != [2]board.Resource{board.Brick, board.Wood} {
		t.Errorf("base+caravans+cak bids in %v, want brick and lumber", got)
	}

	// And the bid is charged against those resources, not against wool and
	// grain by another name.
	s, x := openCamelVoteRuleset(t, "base+caravans+cak", 5)
	for p := range len(s.Players) {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Brick] = 2
		s.Players[p].Hand[board.Sheep] = 2
	}
	order := bidOrder(s, x)
	for i, p := range order {
		cards := [2]int{0, 0}
		if i == 0 {
			cards = [2]int{2, 0}
		}
		step(t, s, engine.Command{Player: p, Type: CmdBidCamel,
			Data: raw(map[string]any{"cards": cards})})
	}
	if got := s.Players[order[0]].Hand[board.Brick]; got != 0 {
		t.Errorf("brick after the round = %d, want 0", got)
	}
	if got := s.Players[order[0]].Hand[board.Sheep]; got != 2 {
		t.Errorf("wool after the round = %d, want 2", got)
	}
}

// TestSevenFishBuysAProgressCardUnderKnights pins the Fishermen-with-Knights
// combination rule: 7 fish draw one progress card of the player's choice, in
// place of the development card the ruleset lacks.
func TestSevenFishBuysAProgressCardUnderKnights(t *testing.T) {
	s, _ := newGame(t, "base+cak+fishermen", 7)
	rolled(t, s)
	p := s.Cur
	setHeld(fishExt(s), p, [3]int{20, 0, 0})

	if engine.ProgressDeckCount(s) != 3 {
		t.Fatalf("progress decks = %d, want the three disciplines", engine.ProgressDeckCount(s))
	}
	// Of the player's choice: the deck is named, and a deck that does not
	// exist is refused rather than substituted.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishProgressCard, "deck": 9})}); !errors.Is(err, engine.ErrBadCommand) {
		t.Errorf("naming deck 9: err = %v, want ErrBadCommand", err)
	}

	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("cak module not active")
	}
	const deck = 1
	before := 0
	for _, n := range cx.Decks[deck] {
		before += n
	}
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishProgressCard, "deck": deck})})
	after := 0
	for _, n := range cx.Decks[deck] {
		after += n
	}
	if after != before-1 {
		t.Errorf("deck %d went from %d to %d, want one card drawn from it", deck, before, after)
	}
	if got := fishTotal(fishExt(s).Held[p]); got != 20-fishCosts[FishProgressCard] {
		t.Errorf("the spend took %d fish, want %d", 20-got, fishCosts[FishProgressCard])
	}
}

// openCamelVoteRuleset is openCamelVote for a ruleset other than base+caravans.
func openCamelVoteRuleset(t *testing.T, ruleset string, seed uint64) (*engine.State, *CaravansExt) {
	t.Helper()
	s, _ := newGame(t, ruleset, seed)
	x := caravansExt(s)
	apply := func(evs []engine.Event) {
		t.Helper()
		for _, e := range evs {
			e.Seq = s.NextSeq
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	apply((Caravans{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvSettlementBuilt, map[string]any{"player": s.Cur})}))
	apply((Caravans{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvTurnEnded, engine.TurnEndedData{Player: s.Cur})}))
	if !x.Voting {
		t.Fatal("vote did not open")
	}
	return s, x
}

// TestCaravanCannotRunIntoTheSideOfAnother: a caravan whose head is one path from
// an intersection another caravan passes through (two camels, neither a head) may
// not take that path. Merging is two heads meeting; this would be a third camel
// at a vertex no caravan could continue from.
func TestCaravanCannotRunIntoTheSideOfAnother(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	x := caravansExt(s)
	land := func(e board.Edge) bool { return s.Board.LandEdge(e) }
	for _, h := range board.HexesInRadius(s.Board.Radius - 1) {
		for _, w := range h.Vertices() {
			es := w.Edges()
			if !land(es[0]) || !land(es[1]) || !land(es[2]) {
				continue
			}
			a, b, c := es[0], es[1], es[2]
			head := c.Other(w)
			for _, d := range head.Edges() {
				if d == c || !land(d) {
					continue
				}
				m := d.Other(head)
				for _, e := range m.Edges() {
					if e == d || !land(e) {
						continue
					}
					touch := map[board.Vertex]bool{a.A: true, a.B: true, b.A: true, b.B: true}
					if touch[head] || touch[m] || touch[e.Other(m)] {
						continue
					}
					x.Chains[0] = []board.Edge{e, d}
					x.Chains[1] = []board.Edge{a, b}
					x.Occupied = map[board.Edge]bool{a: true, b: true, d: true, e: true}
					if caravanFront(x, 0) != head {
						continue
					}
					if slices.Contains((Caravans{}).caravanFrontEdges(x, s, 0), c) {
						t.Errorf("caravan 0 at %v was offered %v, into the side of caravan 1 at %v", head, c, w)
					}
					return
				}
			}
		}
	}
	t.Fatal("fixture: no interior vertex with three land paths and a free approach")
}
