package bot

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
)

// Shores (Small), land only, exactly as frontend/src/lib/maps/gallery.ts
// authors it (SHORES_LAND / SHORES_GOLD). Frame computes its ocean.
const pullShoresLand = "0,-3 2,-3 3,-3 3,-2 -1,-1 0,-1 1,-1 3,-1 -2,0 -1,0 0,0 1,0 -3,1 -2,1 -1,1 0,1 1,1 3,1 -3,2 -2,2 -1,2 0,2 2,2 -3,3 -2,3 -1,3 1,3"
const pullShoresGold = "4,-1"

// pullShoresState is a 3-seat Shores (Small) game in its play phase with an
// empty board: no buildings, no roads, no ships, seat 0 to act.
func pullShoresState(t *testing.T) *engine.State {
	t.Helper()
	b := &board.Board{Radius: 4, Tiles: map[board.Hex]board.Tile{}}
	add := func(spec string, res board.Resource) {
		for p := range strings.FieldsSeq(spec) {
			qr := strings.Split(p, ",")
			q, _ := strconv.Atoi(qr[0])
			r, _ := strconv.Atoi(qr[1])
			b.Tiles[board.Hex{Q: q, R: r}] = board.Tile{Res: res}
		}
	}
	add(pullShoresLand, board.ResLand)
	add(pullShoresGold, board.Gold)
	b.Robber = board.Hex{Q: 0, R: -3}
	b.Frame()
	events, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+islands", Board: b}, engine.SeedsFrom(11))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	if _, ok := islands.StateExt(s); !ok {
		s.Ext[islands.Name] = &islands.Ext{
			Ships:       map[board.Edge]engine.PlayerID{},
			BuiltTurn:   map[board.Edge]bool{},
			PendingGold: map[engine.PlayerID]int{},
			Reached:     map[engine.PlayerID]map[int]bool{},
			IslandVP:    map[engine.PlayerID]int{},
			ShipsLeft:   []int{15, 15, 15},
		}
	}
	return s
}

// mainIsland is the id of the largest land component.
func mainIsland(isle map[board.Hex]int) int {
	size := map[int]int{}
	for _, id := range isle {
		size[id]++
	}
	best, main := 0, -1
	for id, n := range size {
		if n > best || n == best && id < main {
			best, main = n, id
		}
	}
	return main
}

// onIsland reports whether v touches island id.
func onIsland(v board.Vertex, isle map[board.Hex]int, id int) bool {
	for _, h := range v.Hexes() {
		if got, ok := isle[h]; ok && got == id {
			return true
		}
	}
	return false
}

func coastal(s *engine.State, v board.Vertex) bool {
	for _, e := range v.Edges() {
		if e.Valid() && s.Board.SeaEdge(e) {
			return true
		}
	}
	return false
}

func sortedVertices(s *engine.State) []board.Vertex {
	seen := map[board.Vertex]bool{}
	var out []board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !seen[v] {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	sortVertices(out)
	return out
}

func sailingBot() *Strong {
	b := NewStrong()
	on := true
	b.islandsOn = &on
	return b
}

// TestIslandDistanceWalksToTheCoast pins the land leg of islandPull's plan:
// ships leave only from coastal buildings, so an inland seat must still see the
// island (via roads and a coastal settlement), farther than a coastal seat.
func TestIslandDistanceWalksToTheCoast(t *testing.T) {
	s := pullShoresState(t)
	isle := s.Board.Islands()
	main := mainIsland(isle)
	b := sailingBot()
	dIn, inland := -1, 0
	shore := -1
	for _, v := range sortedVertices(s) {
		if !onIsland(v, isle, main) || engine.CheckSettlementSpot(s, v) != nil {
			continue
		}
		s.Buildings[v] = engine.Building{Owner: 0}
		d, ok := b.islandDistance(s, 0, nil)
		delete(s.Buildings, v)
		if !ok {
			continue
		}
		if coastal(s, v) {
			if shore < 0 || d < shore {
				shore = d
			}
		} else {
			inland++
			if dIn < 0 || d < dIn {
				dIn = d
			}
		}
	}
	if inland == 0 {
		t.Fatalf("no inland settlement on the main island sees an island")
	}
	if dIn < islandPullLanding+1 {
		t.Errorf("nearest inland distance %d is shorter than a landing plus one ship", dIn)
	}
	if shore < 0 || shore >= dIn {
		t.Errorf("nearest coastal settlement is %d from an island, nearest inland %d, want coastal nearer", shore, dIn)
	}
}

// TestIslandPullRewardsEachShip: from a coastal building, some ship shortens the
// plan by exactly one build and raises the pull by one step of the gradient.
// That constant step is what a one-step evaluator needs to walk a crossing.
func TestIslandPullRewardsEachShip(t *testing.T) {
	s := pullShoresState(t)
	isle := s.Board.Islands()
	main := mainIsland(isle)
	b := sailingBot()
	for _, v := range sortedVertices(s) {
		if onIsland(v, isle, main) && coastal(s, v) && engine.CheckSettlementSpot(s, v) == nil {
			s.Buildings[v] = engine.Building{Owner: 0}
			break
		}
	}
	d, ok := b.islandDistance(s, 0, nil)
	if !ok || d == 0 {
		t.Fatalf("coastal seat: distance %d ok=%v", d, ok)
	}
	before := b.islandPull(s, 0)
	x, _ := islands.StateExt(s)
	best := d
	for _, e := range b.shipFrontier(s, 0) {
		x.Ships[e] = 0
		if nd, ok := b.islandDistance(s, 0, nil); ok && nd < best {
			best = nd
			if after := b.islandPull(s, 0); after <= before {
				t.Errorf("a ship that shortens the plan (%d -> %d) moved the pull %.2f -> %.2f", d, nd, before, after)
			}
		}
		delete(x.Ships, e)
	}
	if best != d-1 {
		t.Errorf("best single ship takes the plan from %d to %d, want %d", d, best, d-1)
	}
}

// TestBotLandsOnTheLastIsland is the potential-shaping guard. At IslandPull > 1
// the pull exceeds the chip, so without the banked credit the bot would refuse
// to settle its last unreached island. With a ship on an open spot there, it
// must settle.
func TestBotLandsOnTheLastIsland(t *testing.T) {
	s := pullShoresState(t)
	isle := s.Board.Islands()
	main := mainIsland(isle)
	x, _ := islands.StateExt(s)
	// Well above 1 regardless of the default: the convex VP term makes three
	// points at five VP worth about 147, and the pull must exceed that.
	w := DefaultWeights()
	w.IslandPull = 12
	b := NewStrong(WithWeights(w))
	on := true
	b.islandsOn = &on

	ids := map[int]bool{}
	for _, id := range isle {
		if id != main {
			ids[id] = true
		}
	}
	var last int
	for id := range ids {
		last = max(last, id)
	}
	// Home on the main island; every islet but the last already reached.
	for _, v := range sortedVertices(s) {
		if onIsland(v, isle, main) && engine.CheckSettlementSpot(s, v) == nil {
			s.Buildings[v] = engine.Building{Owner: 0}
			break
		}
	}
	x.Reached[0] = map[int]bool{}
	for id := range ids {
		if id != last {
			x.Reached[0][id] = true
			x.IslandVP[0] += 2
		}
	}
	var target board.Vertex
	found := false
	for _, v := range sortedVertices(s) {
		if !onIsland(v, isle, last) || engine.CheckSettlementSpot(s, v) != nil {
			continue
		}
		for _, e := range v.Edges() {
			if e.Valid() && s.Board.SeaEdge(e) {
				x.Ships[e] = 0
				x.ShipsLeft[0]--
				target, found = v, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("the last islet has no open coastal spot")
	}
	if d, ok := b.islandDistance(s, 0, nil); !ok || d != 0 {
		t.Fatalf("fixture: distance to the last islet is %d (ok=%v), want 0", d, ok)
	}
	s.Players[0].Hand = engine.CostSettlement

	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != engine.CmdBuildSettlement {
		t.Fatalf("bot played %s, want a settlement on the last islet", cmd.Type)
	}
	var d struct {
		V board.Vertex `json:"v"`
	}
	if err := json.Unmarshal(cmd.Data, &d); err != nil || d.V != target {
		t.Errorf("settled %v, want the islet spot %v", d.V, target)
	}
}

// TestIslandRoadsHeadForTheCoast pins islandRoadCandidates both ways: roads that
// shorten the plan are offered, but not while an open spot needs the same wood
// and brick and the hand cannot pay for both.
func TestIslandRoadsHeadForTheCoast(t *testing.T) {
	s := pullShoresState(t)
	isle := s.Board.Islands()
	main := mainIsland(isle)
	b := sailingBot()
	// An inland settlement that still sees an island, so the plan starts with
	// a road.
	var home board.Vertex
	found := false
	for _, v := range sortedVertices(s) {
		if !onIsland(v, isle, main) || coastal(s, v) || engine.CheckSettlementSpot(s, v) != nil {
			continue
		}
		s.Buildings[v] = engine.Building{Owner: 0}
		if d, ok := b.islandDistance(s, 0, nil); ok && d > islandPullLanding {
			home, found = v, true
			break
		}
		delete(s.Buildings, v)
	}
	if !found {
		t.Fatal("no inland spot on the main island with an island in range")
	}
	cur, _ := b.islandDistance(s, 0, nil)
	offered := func() []engine.Command {
		var out []engine.Command
		b.islandRoadCandidates(s, 0, 1, func(c engine.Command) { out = append(out, c) })
		return out
	}

	both := engine.CostSettlement
	both.Add(engine.CostRoad)
	s.Players[0].Hand = both
	got := offered()
	if len(got) == 0 {
		t.Fatalf("seat at %v, %d builds from an island: no coastward road offered", home, cur)
	}
	for _, c := range got {
		var d struct {
			E board.Edge `json:"e"`
		}
		if err := json.Unmarshal(c.Data, &d); err != nil {
			t.Fatal(err)
		}
		if nd, ok := b.islandDistance(s, 0, &d.E); !ok || nd >= cur {
			t.Errorf("offered road %v leaves the plan at %d (ok=%v), was %d", d.E, nd, ok, cur)
		}
	}

	s.Players[0].Hand = engine.CostRoad
	if got := offered(); len(got) != 0 {
		t.Errorf("open spot, hand holds one road: %d coastward roads offered, want 0", len(got))
	}
}
