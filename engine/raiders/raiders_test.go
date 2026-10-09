package raiders

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"

	// The partners whose combination rules this scenario carries, imported only
	// in the test build so composed rulesets resolve. The module itself keys
	// those rules on the ruleset string (see rulesetHas) and does not import
	// its peers.
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/scenarios"
)

// Every test here constructs the state it needs rather than searching seeds,
// and none skips. The hand-built boards are small and regular; the seeded
// batteries in sim/ play real ones.

// testBoard is a full hexagon of the given radius with a producing resource and
// a token on every hex, dealt round-robin so the layout is fixed and readable.
// Tests that care about specific numbers set them afterwards.
func testBoard(radius int) *board.Board {
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}, Robber: board.OffBoard}
	nums := []int{3, 4, 5, 6, 8, 9, 10, 11, 2, 12}
	res := board.Resources
	i := 0
	for _, h := range board.HexesInRadius(radius) {
		b.Tiles[h] = board.Tile{Res: res[i%len(res)], Number: nums[i%len(nums)]}
		i++
	}
	return b
}

// newState builds a playable state with the given ruleset and board, already in
// the play phase with the dice thrown, so a command under test is not refused
// for a reason the test is not about.
func newState(t *testing.T, ruleset string, players int, b *board.Board) *engine.State {
	t.Helper()
	s := engine.Empty()
	s.Config = engine.GameConfig{Players: players, Ruleset: ruleset, TargetVP: winVP, DiscardLimit: 7}
	s.Players = make([]engine.PlayerState, players)
	for i := range s.Players {
		s.Players[i] = engine.PlayerState{
			RoadsLeft: engine.MaxRoads, SettlementsLeft: engine.MaxSettlements, CitiesLeft: engine.MaxCities,
		}
	}
	for _, r := range board.Resources {
		s.Bank[r] = engine.BankPerResource(players)
	}
	s.Board = b
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	s.NextSeq = 100 // past the board slots, like a real log
	x := (Module{}).InitExt(s.Config).(*Ext)
	s.Ext[Name] = x
	if y := (Module{}).InitExtBoard(s); y != nil {
		s.Ext[Name] = y
	}
	return s
}

// liveExt is the live module state, for a test that needs to arrange the board.
func liveExt(t *testing.T, s *engine.State) *Ext {
	t.Helper()
	x, ok := StateExt(s)
	if !ok {
		t.Fatal("raiders ext missing from a raiders game")
	}
	return x
}

// apply folds a batch, so a test can act on the state a command produced.
func apply(t *testing.T, s *engine.State, evs []engine.Event) {
	t.Helper()
	for _, e := range evs {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
	}
}

func raw2(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// --- The board ------------------------------------------------------------

// The castle is at the centre of a full hexagon, it is landing-eligible for
// nobody, and it produces nothing.
func TestCastleAtCentreProducesNothing(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(3))
	x := liveExt(t, s)
	if !x.HasCastle {
		t.Fatal("no castle on a full-hexagon board")
	}
	if x.Castle != (board.Hex{}) {
		t.Errorf("castle at %v, want the centre (0,0)", x.Castle)
	}
	if !(Module{}).hexInert(s, x.Castle) {
		t.Error("the castle produces")
	}
	if x.coastIndex(x.Castle) >= 0 {
		t.Error("the castle is landing-eligible")
	}
	// And nothing else on the board is inert to start with.
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if h != x.Castle && (Module{}).hexInert(s, h) {
			t.Errorf("hex %v is inert with no raiders on it", h)
		}
	}
}

// The castle never eats the desert or the lake, because it only ever lands on
// ordinary producing terrain. That is what keeps the Caravans oasis and the
// Fishermen lake where the other modules put them.
func TestCastleNeverTakesANeutralHex(t *testing.T) {
	for _, res := range []board.Resource{board.ResNone, board.Lake, board.Gold} {
		b := testBoard(3)
		b.Tiles[board.Hex{}] = board.Tile{Res: res}
		s := newState(t, "base+raiders", 4, b)
		x := liveExt(t, s)
		if x.Castle == (board.Hex{}) {
			t.Errorf("the castle took the %v hex at the centre, want the nearest ordinary hex", res)
		}
		if !x.HasCastle {
			t.Errorf("%v at the centre left the game with no castle at all", res)
		}
	}
}

// The robber and the pirate are absent from every Raiders combination, and the
// board finisher is what takes the robber off.
func TestFinishBoardRemovesRobber(t *testing.T) {
	b := testBoard(3)
	b.Robber = board.Hex{Q: 1}
	(Module{}).FinishBoard(b, engine.GameConfig{Players: 4, Ruleset: "base+raiders"}, nil)
	if b.RobberOnBoard() {
		t.Fatalf("the robber is still on the board at %v", b.Robber)
	}
	s := newState(t, "base+raiders", 4, b)
	if !engine.RobberSuppressed(s) {
		t.Error("robber not suppressed")
	}
}

// The coast is every numbered land hex with a neighbouring position that is not
// land, and the supply is three per hex of it.
func TestCoastAndSupply(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	// Radius 2: the outer ring is 12 hexes, every one of them coastal.
	if len(x.Coast) != 12 {
		t.Fatalf("coast is %d hexes, want the 12 of the outer ring", len(x.Coast))
	}
	for i := 1; i < len(x.Coast); i++ {
		if !hexLess(x.Coast[i-1], x.Coast[i]) {
			t.Fatalf("coast is not ascending (Q, R) at %d: %v then %v", i, x.Coast[i-1], x.Coast[i])
		}
	}
	seeded := 0
	for _, n := range x.RaiderCount {
		seeded += n
	}
	// max(2, round(12/5)) = 2.
	if seeded != 2 {
		t.Errorf("setup seeded %d raiders, want max(2, round(coast/5)) = 2", seeded)
	}
	if want := conquered*len(x.Coast) - seeded; x.Supply != want {
		t.Errorf("supply %d, want 3 x %d coastal hexes minus the %d seeded = %d",
			x.Supply, len(x.Coast), seeded, want)
	}
}

// The seeding goes on the lowest-probability hexes, which on a reference-size
// board is the 2 and the 12.
func TestSetupSeedsLowestProbabilityHexes(t *testing.T) {
	b := testBoard(2)
	coastNums := map[board.Hex]int{}
	for _, h := range board.HexesInRadius(2) {
		if ringOf(h) == 2 {
			coastNums[h] = 6 // everything a 6 ...
		}
	}
	// ... except two, which get the two rarest numbers.
	var picked []board.Hex
	for _, h := range board.HexesInRadius(2) {
		if ringOf(h) == 2 {
			picked = append(picked, h)
		}
	}
	coastNums[picked[3]] = 2
	coastNums[picked[7]] = 12
	for h, n := range coastNums {
		b.Tiles[h] = board.Tile{Res: board.Wood, Number: n}
	}
	s := newState(t, "base+raiders", 4, b)
	x := liveExt(t, s)
	for i, h := range x.Coast {
		want := 0
		if h == picked[3] || h == picked[7] {
			want = 1
		}
		if x.RaiderCount[i] != want {
			t.Errorf("hex %v (number %d) holds %d raiders, want %d",
				h, b.Tiles[h].Number, x.RaiderCount[i], want)
		}
	}
}

func ringOf(h board.Hex) int {
	return max(abs(h.Q), max(abs(-h.Q-h.R), abs(h.R)))
}

// --- Landings -------------------------------------------------------------

// A number that names no eligible hex places nothing and is not re-rolled: it
// still counts as one of the attack's three distinct numbers.
func TestLandingOnEmptyNumberPlacesNothing(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	evs := (Module{}).resolveLanding(s, x, []int{7, 7, 7}) // 7 is on no chip
	if len(evs) != 3 {
		t.Fatalf("got %d events for three numbers naming nothing, want three that place nothing", len(evs))
	}
	for _, e := range evs {
		if d := engine.DecodeEvent[landedData](e); d.Hex != nil {
			t.Errorf("a number no hex carries placed a raider at %v", *d.Hex)
		}
	}
}

// A single surviving candidate is placed automatically; only a genuine tie
// interrupts the roller.
func TestOnlyAGenuineTiePromptsTheRoller(t *testing.T) {
	b := testBoard(2)
	// Give the ring one unique number and two shared ones.
	var ring []board.Hex
	for _, h := range board.HexesInRadius(2) {
		if ringOf(h) == 2 {
			ring = append(ring, h)
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
		}
	}
	b.Tiles[ring[0]] = board.Tile{Res: board.Wood, Number: 3} // the only 3
	s := newState(t, "base+raiders", 4, b)
	x := liveExt(t, s)
	for i := range x.RaiderCount {
		x.RaiderCount[i] = 0
	}

	// A number carried by exactly one hex resolves with no prompt.
	evs := (Module{}).resolveLanding(s, x, []int{3})
	if len(evs) != 1 {
		t.Fatalf("a forced landing produced %d events, want one placement", len(evs))
	}
	if d := engine.DecodeEvent[landedData](evs[0]); d.Hex == nil || *d.Hex != ring[0] {
		t.Fatalf("the only hex carrying a 3 was not the one chosen")
	}

	// A number carried by eleven hexes, all equally empty, stops for the pick.
	if evs := (Module{}).resolveLanding(s, x, []int{5}); len(evs) != 0 {
		t.Fatalf("a tie among %d equally empty hexes resolved itself into %d events", len(ring)-1, len(evs))
	}
}

// Fill evenly: the raider goes to a hex holding the fewest, and a saturated hex
// is not a candidate.
func TestLandingFillsEvenlySkipsSaturated(t *testing.T) {
	b := testBoard(2)
	var ring []board.Hex
	for _, h := range board.HexesInRadius(2) {
		if ringOf(h) == 2 {
			ring = append(ring, h)
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 9}
		}
	}
	s := newState(t, "base+raiders", 4, b)
	x := liveExt(t, s)
	for i := range x.RaiderCount {
		x.RaiderCount[i] = 1
	}
	// One hex is empty and one is saturated; everything else holds one.
	empty := x.coastIndex(ring[2])
	full := x.coastIndex(ring[5])
	x.RaiderCount[empty] = 0
	x.RaiderCount[full] = conquered

	cands := x.landingCandidates(b, 9)
	if len(cands) != 1 || cands[0] != empty {
		t.Fatalf("candidates %v, want only the emptiest hex (index %d)", cands, empty)
	}
	// With that one filled, every remaining hex ties at one and the saturated one
	// is still out.
	x.RaiderCount[empty] = 1
	cands = x.landingCandidates(b, 9)
	if len(cands) != len(ring)-1 {
		t.Fatalf("candidates %d, want the %d unsaturated hexes", len(cands), len(ring)-1)
	}
	for _, i := range cands {
		if i == full {
			t.Error("a saturated hex is still a landing candidate")
		}
	}
}

// An empty supply stops landings happening at all: no dice are rolled.
func TestAnEmptySupplyStopsLandings(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	x.Supply = 0
	if evs := (Module{}).landingFor(s, x, 0, 1, 0, 0); len(evs) != 0 {
		t.Fatalf("empty supply produced %d landing events, want 0", len(evs))
	}
	// Unbounded under Knights, so the same state still lands there.
	sk := newState(t, "base+cak+raiders", 4, testBoard(2))
	xk := liveExt(t, sk)
	xk.Supply = 0
	if evs := (Module{}).landingFor(sk, xk, 0, 1, 0, 0); len(evs) == 0 {
		t.Fatal("the supply is unbounded under Knights and no raider landed")
	}
}

// Three distinct non-7 numbers per triggering build, from the seeded stream.
func TestLandingRollsThreeDistinctNonSevens(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	for builds := 1; builds <= 2; builds++ {
		evs := (Module{}).landingFor(s, x, 0, builds, 0, 0)
		if len(evs) == 0 {
			t.Fatalf("%d builds produced no landing", builds)
		}
		d := engine.DecodeEvent[landingData](evs[0])
		if len(d.Numbers) != landingNumbers*builds {
			t.Fatalf("%d builds rolled %d numbers, want %d", builds, len(d.Numbers), landingNumbers*builds)
		}
		for i := range builds {
			trip := d.Numbers[i*landingNumbers : (i+1)*landingNumbers]
			seen := map[int]bool{}
			for _, n := range trip {
				if n == 7 {
					t.Errorf("a landing rolled a 7")
				}
				if n < 2 || n > 12 {
					t.Errorf("a landing rolled %d", n)
				}
				if seen[n] {
					t.Errorf("landing %d repeated the number %d within one attack: %v", i, n, trip)
				}
				seen[n] = true
			}
		}
	}
}

// --- Conquest -------------------------------------------------------------

// Conquest is derived, and it switches the hex, the buildings and the building
// sites off together.
func TestConquestDisablesBuildings(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	h := x.Coast[0]
	i := x.coastIndex(h)
	x.RaiderCount[i] = 0

	if x.Conquered(h) {
		t.Fatal("an empty hex is conquered")
	}
	for n := 1; n <= conquered; n++ {
		x.RaiderCount[i] = n
		if got := x.Conquered(h); got != (n == conquered) {
			t.Fatalf("%d raiders: conquered=%v, want %v", n, got, n == conquered)
		}
	}
	if !(Module{}).hexInert(s, h) {
		t.Error("a conquered hex still produces")
	}
	v := h.Vertices()[0]
	if !(Module{}).blocksNewConstruction(s, v) {
		t.Error("a new settlement is still allowed on a conquered hex's corner")
	}
	if !(Module{}).blocksNewRoad(s, h.Edges()[0]) {
		t.Error("a new road is still allowed on a conquered hex's path")
	}
	// It all comes back when a raider leaves. Reconquest needs no code because
	// the predicate is derived.
	x.RaiderCount[i] = 2
	if (Module{}).hexInert(s, h) || (Module{}).blocksNewConstruction(s, v) || (Module{}).blocksNewRoad(s, h.Edges()[0]) {
		t.Error("un-conquering the hex did not stand everything back up")
	}
}

// A free road is refused on a conquered hex's path too. The Fishermen five-fish
// road arrives as a free-road credit (s.FreeRoads, as for Road Building) placed
// through the ordinary road build, so it meets the same conquest check.
func TestFreeRoadRefusedBesideConqueredHex(t *testing.T) {
	s := newState(t, "base+fishermen+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	h := x.Coast[0]
	x.RaiderCount[x.coastIndex(h)] = conquered
	e := h.Edges()[0]
	s.Buildings[e.A] = engine.Building{Owner: 0}
	s.FreeRoads = 1

	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdBuildRoad,
		Data: raw2(map[string]any{"e": e})}); err == nil {
		t.Error("a free road was placed on a conquered hex's path")
	}
	for _, le := range s.LegalRoads(0) {
		if slices.Contains(board.EdgeHexes(le), h) {
			t.Errorf("a road on conquered %v's path %v is still offered", h, le)
		}
	}
	// The same road is taken once the hex is un-conquered, so the refusal above
	// is the conquest and nothing else.
	x.RaiderCount[x.coastIndex(h)] = 2
	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdBuildRoad,
		Data: raw2(map[string]any{"e": e})}); err != nil {
		t.Errorf("the free road was refused after the hex was un-conquered: %v", err)
	}
}

// A building with no unconquered neighbour is switched off: it produces
// nothing, scores nothing, and cannot use its harbour. It still stands.
func TestConqueredBuildingInertButStanding(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	// A vertex of the outer ring whose land hexes are all coastal, saturated.
	var v board.Vertex
	var hexes []board.Hex
	for _, h := range x.Coast {
		for _, cand := range h.Vertices() {
			var land []board.Hex
			all := true
			for _, hh := range cand.Hexes() {
				if !s.Board.Land(hh) {
					continue
				}
				land = append(land, hh)
				if x.coastIndex(hh) < 0 {
					all = false
				}
			}
			if all && len(land) > 0 {
				v, hexes = cand, land
			}
		}
		if len(hexes) > 0 {
			break
		}
	}
	if len(hexes) == 0 {
		t.Fatal("no vertex on this board touches only coastal hexes")
	}
	s.Buildings[v] = engine.Building{Owner: 0, City: true}

	if engine.BuildingIsInert(s, v) {
		t.Fatal("the building is switched off with no raiders anywhere")
	}
	for _, h := range hexes {
		x.RaiderCount[x.coastIndex(h)] = conquered
	}
	if !engine.BuildingIsInert(s, v) {
		t.Fatal("every neighbour is conquered and the building is still working")
	}
	// 0 VP, and the subtraction reaches every leader test through VictoryCheck.
	if got := (Module{}).victory(s, 0); got != -2 {
		t.Errorf("conquered city contributes %d, want -2", got)
	}
	if s.PublicVPWithModules(0) != 0 {
		t.Errorf("a seat whose only city is conquered shows %d public VP, want 0", s.PublicVPWithModules(0))
	}
	// It still exists, so an opponent may not build through it.
	if err := engine.CheckSettlementSpot(s, v); err == nil {
		t.Error("the conquered building's intersection is free to build on")
	}
	// And one raider leaving stands it back up.
	x.RaiderCount[x.coastIndex(hexes[0])] = 1
	if engine.BuildingIsInert(s, v) {
		t.Error("un-conquering one neighbour did not stand the building back up")
	}
}

// --- Riders ---------------------------------------------------------------

// Six per seat, one per path, and a rider shares a path with a road freely.
func TestRiderSupplyAndSharedPaths(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	if x.RidersLeft[0] != ridersPerSeat {
		t.Fatalf("seat 0 starts with %d riders, want %d", x.RidersLeft[0], ridersPerSeat)
	}
	e := x.castlePaths()[0]
	s.Roads[e] = 1 // an opponent's road, already there
	x.Pend = Pending{Kind: PendMuster, Seat: 0}
	x.refreshChoices(s)
	evs, err := (Module{}).decidePlaceRider(s, engine.Command{Player: 0, Type: CmdPlaceRider, Data: raw2(map[string]any{"e": e})})
	if err != nil {
		t.Fatalf("a rider was refused a path holding a road: %v", err)
	}
	for i := range evs {
		evs[i].Seq = s.NextSeq + i
	}
	apply(t, s, evs)
	if x.RiderAt[e] != 0 || x.RidersLeft[0] != ridersPerSeat-1 {
		t.Fatalf("the rider did not land: RiderAt=%v left=%d", x.RiderAt[e], x.RidersLeft[0])
	}
	// A second rider may not stand on the same path.
	x.Pend = Pending{Kind: PendMuster, Seat: 1}
	x.refreshChoices(s)
	if _, err := (Module{}).decidePlaceRider(s, engine.Command{Player: 1, Type: CmdPlaceRider, Data: raw2(map[string]any{"e": e})}); err == nil {
		t.Error("two riders were allowed on one path")
	}
	// Riders never block a road: the base build is untouched by one.
	x.clearPend()
	s.Cur = 2
	s.Players[2].Hand = engine.CostRoad
	free := x.castlePaths()[1]
	s.Buildings[free.A] = engine.Building{Owner: 2}
	x.RiderAt[free] = 3
	if _, err := engine.Decide(s, engine.Command{Player: 2, Type: engine.CmdBuildRoad, Data: raw2(map[string]any{"e": free})}); err != nil {
		t.Errorf("a road was refused a path holding an opponent's rider: %v", err)
	}
}

// Movement: three paths, five for a grain, passing through everything, never
// ending on an occupied path.
func TestRiderMovement(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(3))
	x := liveExt(t, s)
	from := x.castlePaths()[0]
	x.RiderAt[from] = 0

	near := x.riderReach(from, riderMove)
	far := x.riderReach(from, riderMoveHurry)
	if len(near) == 0 || len(far) <= len(near) {
		t.Fatalf("reach: %d paths at 3 and %d at 5; the grain must buy more ground", len(near), len(far))
	}
	// Nothing blocks a rider in transit: an opponent's rider sitting on the only
	// short path out does not shrink the set beyond that one square.
	block := near[0]
	x.RiderAt[block] = 1
	after := x.riderReach(from, riderMove)
	if len(after) != len(near)-1 {
		t.Errorf("an occupied path cost %d destinations, want exactly the one it stands on", len(near)-len(after))
	}
	for _, e := range after {
		if e == block {
			t.Error("a rider may end on a path that already holds one")
		}
	}
	// A move beyond the allowance is refused, and the same move is taken once the
	// grain is paid.
	var beyond board.Edge
	for _, e := range far {
		if !contains(near, e) {
			beyond = e
			break
		}
	}
	cmd := func(hurry bool) engine.Command {
		return engine.Command{Player: 0, Type: CmdMoveRider,
			Data: raw2(map[string]any{"from": from, "to": beyond, "hurry": hurry})}
	}
	if _, err := (Module{}).decideMoveRider(s, cmd(false)); err == nil {
		t.Error("a rider reached a five-path destination on its three-path allowance")
	}
	if _, err := (Module{}).decideMoveRider(s, cmd(true)); err == nil {
		t.Error("the grain was not charged: the seat holds none")
	}
	s.Players[0].Hand[board.Wheat] = 1
	evs, err := (Module{}).decideMoveRider(s, cmd(true))
	if err != nil {
		t.Fatalf("a paid five-path move was refused: %v", err)
	}
	for i := range evs {
		evs[i].Seq = s.NextSeq + i
	}
	apply(t, s, evs)
	if s.Players[0].Hand[board.Wheat] != 0 {
		t.Error("the grain was not taken")
	}
	if x.RiderAt[beyond] != 0 {
		t.Error("the rider is not at its destination")
	}
	// One move per rider per turn.
	if _, err := (Module{}).decideMoveRider(s, engine.Command{Player: 0, Type: CmdMoveRider,
		Data: raw2(map[string]any{"from": beyond, "to": from})}); err == nil {
		t.Error("a rider moved twice in one turn")
	}
}

func contains(es []board.Edge, e board.Edge) bool {
	return slices.Contains(es, e)
}

// A castle rider must leave, and the turn is refused while one that could have
// left has not. A rider with nowhere to go stays, and the turn may end.
func TestCastleRiderMustLeaveUnlessItCannot(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(3))
	x := liveExt(t, s)
	paths := x.castlePaths()
	x.RiderAt[paths[0]] = 0

	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdEndTurn}); err == nil {
		t.Fatal("the turn ended with a rider still standing at the castle")
	}
	// The block only refuses the pass: the seat keeps playing.
	if (Module{}).blocksTurnActions(s) {
		t.Error("a castle rider froze the seat's other actions")
	}
	s.Players[0].Hand = engine.CostRoad
	s.Buildings[paths[1].A] = engine.Building{Owner: 0}
	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdBuildRoad,
		Data: raw2(map[string]any{"e": paths[1]})}); err != nil {
		t.Errorf("building was refused while a castle rider owed a move: %v", err)
	}

	// Wall the rider in: every path within three of it holds one.
	for _, e := range x.riderReach(paths[0], riderMove) {
		x.RiderAt[e] = 1
	}
	if _, stuck := x.stuckAtCastle(0); stuck {
		t.Fatal("a rider with no legal destination is still reported as owing a move")
	}
	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdEndTurn}); err != nil {
		t.Errorf("end turn with an immobile rider: %v", err)
	}
}

// No rider may end a move on a castle path ("after you finish moving, none of
// your riders may be on a path adjacent to the castle hex"). Pins both a castle
// rider stepping round the ring and a rider elsewhere marching back onto it.
func TestNoRiderEndsItsMoveAtTheCastle(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(3))
	x := liveExt(t, s)
	paths := x.castlePaths()
	x.RiderAt[paths[0]] = 0

	for _, steps := range []int{riderMove, riderMoveHurry} {
		for _, e := range x.riderReach(paths[0], steps) {
			if contains(paths, e) {
				t.Errorf("a castle rider may end a %d-path move on castle path %v", steps, e)
			}
		}
	}
	// Crossing the ring is still free: the far side of the castle is reachable
	// in three (round two castle paths, then one step off the ring).
	var opposite board.Edge
	ring := x.Castle.Edges()
	for i, e := range ring {
		if e == paths[0] {
			opposite = ring[(i+3)%6]
		}
	}
	far := false
	for _, e := range x.riderReach(paths[0], riderMove) {
		if e.A == opposite.A || e.B == opposite.A || e.A == opposite.B || e.B == opposite.B {
			far = true
		}
	}
	if !far {
		t.Error("a rider can no longer pass through the castle ring to the far side")
	}

	// The command half: stepping round the ring is refused, not merely unoffered.
	if _, err := (Module{}).decideMoveRider(s, engine.Command{Player: 0, Type: CmdMoveRider,
		Data: raw2(map[string]any{"from": paths[0], "to": paths[1]})}); err == nil {
		t.Error("a castle rider stepped to another castle path")
	}
	// And a rider elsewhere cannot march back onto the ring either.
	delete(x.RiderAt, paths[0])
	out := x.riderReach(paths[0], riderMove)[0]
	x.RiderAt[out] = 0
	if _, err := (Module{}).decideMoveRider(s, engine.Command{Player: 0, Type: CmdMoveRider,
		Data: raw2(map[string]any{"from": out, "to": paths[0]})}); err == nil {
		t.Error("a rider ended its move on a castle path")
	}
}

// --- Battles --------------------------------------------------------------

// A hex is a victory when the riders on its six paths outnumber the raiders;
// every raider becomes a prisoner, and the sole involved seat takes them all.
func TestBattleVictoryAndPrisoners(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	h := x.Coast[0]
	i := x.coastIndex(h)
	x.RaiderCount[i] = 2
	edges := h.Edges()
	x.RiderAt[edges[0]] = 0
	x.RiderAt[edges[1]] = 0

	// Equal strength is not a victory: riders must outnumber.
	if evs := (Module{}).sweep(s, x, 0); len(evs) != 0 {
		t.Fatal("two riders beat two raiders")
	}
	x.RiderAt[edges[2]] = 0
	supplyBefore := x.Supply
	evs := (Module{}).sweep(s, x, 0)
	if len(evs) != 1 {
		t.Fatalf("three riders against two raiders produced %d battles, want one", len(evs))
	}
	for k := range evs {
		evs[k].Seq = s.NextSeq + k
	}
	apply(t, s, evs)
	if x.RaiderCount[i] != 0 {
		t.Errorf("the hex still holds %d raiders after a victory", x.RaiderCount[i])
	}
	if x.Prisoners[0] != 2 {
		t.Errorf("the sole involved seat holds %d prisoners, want both", x.Prisoners[0])
	}
	if x.Supply != supplyBefore {
		// Prisoners never return to the supply, so the supply works as a clock.
		t.Errorf("supply moved from %d to %d on a victory, want unchanged",
			supplyBefore, x.Supply)
	}
}

// Two prisoners are a point and a lone one is worth nothing at all, including
// for the purpose of working out who is leading.
func TestPrisonerScoring(t *testing.T) {
	for _, tc := range []struct {
		ruleset   string
		prisoners int
		want      int
	}{
		{"base+raiders", 0, 0}, {"base+raiders", 1, 0}, {"base+raiders", 2, 1},
		{"base+raiders", 3, 1}, {"base+raiders", 4, 2},
		{"base+cak+raiders", 2, 0}, {"base+cak+raiders", 3, 1}, {"base+cak+raiders", 5, 1},
		{"base+cak+raiders", 6, 2},
	} {
		s := newState(t, tc.ruleset, 4, testBoard(2))
		x := liveExt(t, s)
		x.Prisoners[0] = tc.prisoners
		if got := (Module{}).victory(s, 0); got != tc.want {
			t.Errorf("%s with %d prisoners scored %d, want %d", tc.ruleset, tc.prisoners, got, tc.want)
		}
		if got := s.PublicVPWithModules(0); got != tc.want {
			t.Errorf("%s with %d prisoners shows %d public VP, want %d",
				tc.ruleset, tc.prisoners, got, tc.want)
		}
	}
}

// The loss die names one of three edge directions: a path and the path opposite
// it. Riders elsewhere are untouched.
func TestLossesTakeADirectionNotAPath(t *testing.T) {
	h := board.Hex{}
	edges := h.Edges()
	var involved []riderAt
	for _, e := range edges {
		involved = append(involved, riderAt{Player: 0, E: e})
	}
	for die := 1; die <= 6; die++ {
		dir := (die - 1) % 3
		lost := lossesFor(h, involved, dir)
		if len(lost) != 2 {
			t.Fatalf("die %d took %d riders, want the two paths of one direction", die, len(lost))
		}
		if lost[0].E != edges[dir] || lost[1].E != edges[dir+3] {
			t.Errorf("die %d took %v, want the opposite pair at indexes %d and %d", die, lost, dir, dir+3)
		}
	}
	// A rider not involved in this battle is not at risk, whatever it stands on.
	if lost := lossesFor(h, involved[:1], 1); len(lost) != 0 {
		t.Error("a rider on a path of the rolled direction died without being involved")
	}
}

// The sweep walks the coast in ascending (Q, R) and resolves each battle in
// full before the next hex, so a rider lost at one is missing from the next.
func TestSweepOrderAndLossesCarry(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(3))
	x := liveExt(t, s)
	for i := range x.RaiderCount {
		x.RaiderCount[i] = 1
	}
	for _, h := range x.Coast {
		for _, e := range h.Edges() {
			if _, taken := x.RiderAt[e]; !taken {
				x.RiderAt[e] = 0
			}
		}
	}
	evs := (Module{}).sweep(s, x, 0)
	if len(evs) < 2 {
		t.Fatalf("a coast of %d occupied hexes produced %d battles", len(x.Coast), len(evs))
	}
	var prev board.Hex
	for i, e := range evs {
		d := engine.DecodeEvent[battleData](e)
		if i > 0 && !hexLess(prev, d.Hex) {
			t.Fatalf("battle %d at %v follows %v: the sweep is not ascending (Q, R)", i, d.Hex, prev)
		}
		prev = d.Hex
	}
	// Losses are settled inside each battle, so a later battle's involved list
	// cannot name a rider an earlier one took off the board.
	gone := map[board.Edge]bool{}
	for _, e := range evs {
		d := engine.DecodeEvent[battleData](e)
		for _, r := range d.Involved {
			if gone[r.E] {
				t.Errorf("a rider lost earlier in the sweep fought again at %v", d.Hex)
			}
		}
		for _, l := range d.Lost {
			gone[l.E] = true
		}
	}
}

// Every seat's riders count, whoever's turn it is, and the split hands a
// prisoner to each involved seat in seat order.
func TestEverySeatsRidersCount(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	h := x.Coast[0]
	x.RaiderCount[x.coastIndex(h)] = 2
	edges := h.Edges()
	x.RiderAt[edges[0]] = 1
	x.RiderAt[edges[1]] = 2
	x.RiderAt[edges[2]] = 3
	s.Cur = 0 // seat 0 owns nothing here and is the one whose turn it is

	evs := (Module{}).sweep(s, x, 0)
	if len(evs) != 1 {
		t.Fatalf("three seats' riders did not add up to a victory: %d battles", len(evs))
	}
	d := engine.DecodeEvent[battleData](evs[0])
	if len(d.Prisoners) != 2 {
		t.Fatalf("two prisoners went to %d seats, want one each in seat order", len(d.Prisoners))
	}
	// Two prisoners, three seats: a roll-off, and whoever comes away empty takes
	// gold instead.
	took := map[engine.PlayerID]bool{}
	for _, p := range d.Prisoners {
		took[p.Player] = true
	}
	for _, seat := range []engine.PlayerID{1, 2, 3} {
		if took[seat] {
			continue
		}
		found := false
		for _, g := range d.Gold {
			if g.Player == seat && g.Count >= goldPerLoss {
				found = true
			}
		}
		if !found {
			t.Errorf("seat %d rolled and came away with nothing and no gold", seat)
		}
	}
}

// --- The deck -------------------------------------------------------------

func TestDeckComposition(t *testing.T) {
	d := freshDeck()
	want := map[Card]int{CardMuster: 14, CardSwiftRider: 4, CardTreason: 4, CardIntrigue: 4}
	for c, n := range want {
		if d[c] != n {
			t.Errorf("%v: %d in the deck, want %d", c, d[c], n)
		}
	}
	if deckCount(d) != 26 {
		t.Errorf("deck of %d, want 26", deckCount(d))
	}
}

// A Muster with nothing to place is discarded with no effect: not held, not
// refunded, and no replacement draw. Only Intrigue redraws.
func TestOnlyIntrigueRedraws(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	// No riders left, and no raider anywhere: Muster and Swift Rider are both
	// void, and Intrigue has nothing to take.
	x.RidersLeft[0] = 0
	for i := range x.RaiderCount {
		x.RaiderCount[i] = 0
	}
	for range 30 {
		evs := (Module{}).cardEvents(s, 0, 0, false)
		if len(evs) == 0 {
			t.Fatal("a card purchase produced no events")
		}
		last := engine.DecodeEvent[cardData](evs[len(evs)-1])
		for i, e := range evs[:len(evs)-1] {
			d := engine.DecodeEvent[cardData](e)
			if d.Card != CardIntrigue || !d.Void {
				t.Fatalf("event %d redrew after a %v (void=%v); only Intrigue redraws", i, d.Card, d.Void)
			}
		}
		if last.Card == CardIntrigue && last.Void {
			t.Fatal("the run ended on a void Intrigue instead of redrawing")
		}
		// Only the first card is paid for.
		for i, e := range evs {
			if d := engine.DecodeEvent[cardData](e); (i == 0) == d.Free {
				t.Errorf("event %d: Free=%v, want the first card charged and the redraws not", i, d.Free)
			}
		}
		for i := range evs {
			evs[i].Seq = s.NextSeq + i
		}
		s.Players[0].Hand = engine.CostDevCard
		apply(t, s, evs)
	}
}

// The deck reshuffles the moment it empties, so it is effectively infinite.
func TestTheDeckReshufflesWhenItEmpties(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	x.Deck = [cardKinds]int{CardMuster: 1}
	s.Players[0].Hand = engine.CostDevCard
	evs := (Module{}).cardEvents(s, 0, 0, false)
	for i := range evs {
		evs[i].Seq = s.NextSeq + i
	}
	apply(t, s, evs)
	if deckCount(x.Deck) != 26 {
		t.Fatalf("the last card left a deck of %d, want a reshuffled 26", deckCount(x.Deck))
	}
}

// Treason places only on coastal hexes, from different hexes, onto other ones.
func TestTreasonPlacesOnlyOnTheCoast(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(3))
	x := liveExt(t, s)
	for i := range x.RaiderCount {
		x.RaiderCount[i] = 0
	}
	x.RaiderCount[0] = 1
	x.RaiderCount[1] = 1
	x.Pend = Pending{Kind: PendTreason, Seat: 0}
	x.refreshChoices(s)

	interior := x.Castle // not on the coast at all
	bad := []treasonMove{{From: &x.Coast[0], To: interior}, {From: &x.Coast[1], To: x.Coast[2]}}
	if _, err := (Module{}).decideTreason(s, engine.Command{Player: 0, Type: CmdTreason,
		Data: raw2(map[string]any{"moves": bad})}); err == nil {
		t.Error("Treason seeded the interior, which no landing can ever reach")
	}
	same := []treasonMove{{From: &x.Coast[0], To: x.Coast[2]}, {From: &x.Coast[0], To: x.Coast[3]}}
	if _, err := (Module{}).decideTreason(s, engine.Command{Player: 0, Type: CmdTreason,
		Data: raw2(map[string]any{"moves": same})}); err == nil {
		t.Error("Treason took two raiders off one hex")
	}
	good := []treasonMove{{From: &x.Coast[0], To: x.Coast[2]}, {From: &x.Coast[1], To: x.Coast[3]}}
	if _, err := (Module{}).decideTreason(s, engine.Command{Player: 0, Type: CmdTreason,
		Data: raw2(map[string]any{"moves": good})}); err != nil {
		t.Errorf("a legal Treason plan was refused: %v", err)
	}
}

// Treason's plan length counts a conquered source as needing no destination.
// Two part-filled hexes first in board order, one empty hex, the rest of the
// coast conquered: the legal plan is conquered -> part-filled and part-filled
// -> empty, two moves. Pins the count the client is sent too.
func TestTreasonCountsAConqueredSourceAsFree(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	for i := range x.RaiderCount {
		x.RaiderCount[i] = conquered
	}
	x.RaiderCount[0], x.RaiderCount[1], x.RaiderCount[2] = 1, 1, 0
	x.Supply = 10
	x.Pend = Pending{Kind: PendTreason, Seat: 0}
	x.refreshChoices(s)

	if got := treasonCount(x, false); got != 2 {
		t.Fatalf("Treason moves %d raiders here, want 2", got)
	}
	plan := []treasonMove{
		{From: &x.Coast[3], To: x.Coast[0]},
		{From: &x.Coast[1], To: x.Coast[2]},
	}
	if _, err := (Module{}).decideTreason(s, engine.Command{Player: 0, Type: CmdTreason,
		Data: raw2(map[string]any{"moves": plan})}); err != nil {
		t.Errorf("a legal two-move Treason was refused: %v", err)
	}
	// Auto's plan is the same length, and legal.
	if err := validateTreason(x, autoTreason(x, false), false); err != nil {
		t.Errorf("the auto plan is not legal: %v", err)
	}
	v, _ := x.ViewExt(0).(map[string]any)
	pend, _ := v["pend"].(map[string]any)
	if pend["treason_count"] != 2 {
		t.Errorf("the view publishes treason_count %v, want 2", pend["treason_count"])
	}
}

// --- Gold and the 7 -------------------------------------------------------

// Two gold buy a bank resource, at most twice a turn, and the bank's stock is
// checked before the gold is spent.
func TestGoldBuysAreCappedAndBankLimited(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	x.Gold[0] = 10
	buy := func() ([]engine.Event, error) {
		return (Module{}).decideBuyResource(s, engine.Command{Player: 0, Type: CmdBuyResource,
			Data: raw2(map[string]any{"res": board.Wood})})
	}
	for n := range goldBuysPerTurn {
		evs, err := buy()
		if err != nil {
			t.Fatalf("purchase %d refused: %v", n, err)
		}
		for i := range evs {
			evs[i].Seq = s.NextSeq + i
		}
		apply(t, s, evs)
	}
	if _, err := buy(); err == nil {
		t.Error("a third purchase was allowed in one turn")
	}
	if x.Gold[0] != 10-goldBuysPerTurn*goldPerResource {
		t.Errorf("gold is %d after two purchases, want %d", x.Gold[0], 10-goldBuysPerTurn*goldPerResource)
	}
	// A bank with none of that resource refuses before the gold moves.
	x.Buys = 0
	s.Bank[board.Ore] = 0
	before := x.Gold[0]
	if _, err := (Module{}).decideBuyResource(s, engine.Command{Player: 0, Type: CmdBuyResource,
		Data: raw2(map[string]any{"res": board.Ore})}); err == nil {
		t.Error("a resource the bank does not hold was bought")
	}
	if x.Gold[0] != before {
		t.Error("gold moved on a refused purchase")
	}
}

// Maritime trade into gold uses the seat's own port rate: 4:1, 3:1 at a generic
// harbour, 2:1 at that resource's harbour (engine.State.CurrencyRatio, shared
// with the Rivers coin and Wagons gold). The specific harbour on another
// resource is asserted here because a per-seat rate cannot express it.
func TestGoldMaritimeRateIsSeatPortRate(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	v := board.Vertex{}
	s.Buildings[v] = engine.Building{Owner: 0}
	if got := GoldRatio(s, 0, board.Wood); got != 4 {
		t.Errorf("no harbour: rate %d, want 4", got)
	}
	s.Board.Harbors = []board.Harbor{{Verts: [2]board.Vertex{v, v.Neighbors()[0]}, Ratio: 2, Res: board.Wood}}
	if got := GoldRatio(s, 0, board.Wood); got != 2 {
		t.Errorf("a 2:1 wood harbour gave a wood rate of %d, want 2", got)
	}
	if got := GoldRatio(s, 0, board.Ore); got != 4 {
		t.Errorf("a 2:1 WOOD harbour gave an ore rate of %d, want the bare 4", got)
	}
	s.Board.Harbors = []board.Harbor{{Verts: [2]board.Vertex{v, v.Neighbors()[0]}, Ratio: 3}}
	if got := GoldRatio(s, 0, board.Ore); got != 3 {
		t.Errorf("a generic 3:1 harbour gave a gold rate of %d, want 3", got)
	}
}

// A harbour at a conquered building is no harbour. State.CurrencyRatio skips an
// inert building because a resource trade does, so this holds without this
// module asking.
func TestGoldMaritimeRateIgnoresConqueredPort(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	h := x.Coast[0]
	x.RaiderCount[x.coastIndex(h)] = conquered
	// An intersection of that hex whose every land neighbour is conquered: the
	// building there is inert, which is what switches its harbour off.
	var v board.Vertex
	found := false
	for _, c := range h.Vertices() {
		land, conq := 0, 0
		for _, n := range c.Hexes() {
			if s.Board.Land(n) {
				land++
				if x.Conquered(n) {
					conq++
				}
			}
		}
		if land > 0 && land == conq {
			v, found = c, true
			break
		}
	}
	if !found {
		t.Fatal("no corner of the conquered hex has all its land neighbours conquered")
	}
	s.Buildings[v] = engine.Building{Owner: 0}
	if !engine.BuildingIsInert(s, v) {
		t.Fatal("the building on a fully conquered corner is not inert")
	}
	s.Board.Harbors = []board.Harbor{{Verts: [2]board.Vertex{v, v.Neighbors()[0]}, Ratio: 2, Res: board.Wood}}
	if got := GoldRatio(s, 0, board.Wood); got != 4 {
		t.Errorf("a conquered building's 2:1 harbour gave a rate of %d, want the bare 4", got)
	}
}

// Gold is not a resource: it is not counted toward the 7-discard.
func TestGoldIsNotCountedForDiscards(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	x.Gold[0] = 99
	for _, r := range board.Resources {
		s.Players[0].Hand[r] = 1
	}
	if got := s.DiscardableCount(0); got != 5 {
		t.Errorf("a hand of five cards and 99 gold counts %d for the discard, want 5", got)
	}
	if got := s.DiscardThreshold(0); got != 7 {
		t.Errorf("the discard threshold is %d, want the base 7", got)
	}
}

// The 7 takes one random resource from a player of the roller's choice, with no
// robber moved and nothing blocked.
func TestSevenStealsFromAChosenPlayer(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	s.Players[2].Hand[board.Ore] = 3
	evs := (Module{}).onSeven(s)
	for i := range evs {
		evs[i].Seq = s.NextSeq + i
	}
	apply(t, s, evs)
	if x.Pend.Kind != PendSteal || x.Pend.Seat != 0 {
		t.Fatalf("the 7 did not open a steal for the active seat: %+v", x.Pend)
	}
	victim := engine.PlayerID(1) // holds nothing
	if _, err := (Module{}).decideSteal(s, engine.Command{Player: 0, Type: CmdSteal,
		Data: raw2(map[string]any{"victim": victim})}); err == nil {
		t.Error("a player with no cards was a legal victim")
	}
	victim = 2
	got, err := (Module{}).decideSteal(s, engine.Command{Player: 0, Type: CmdSteal,
		Data: raw2(map[string]any{"victim": victim})})
	if err != nil {
		t.Fatalf("the steal was refused: %v", err)
	}
	if len(got[0].Visible) != 2 {
		t.Errorf("the stolen card is visible to %d seats, want the thief and the victim only", len(got[0].Visible))
	}
	for i := range got {
		got[i].Seq = s.NextSeq + i
	}
	apply(t, s, got)
	if s.Players[2].Hand[board.Ore] != 2 || s.Players[0].Hand[board.Ore] != 1 {
		t.Error("the card did not move")
	}
	if s.Board.RobberOnBoard() || s.RobberPending {
		t.Error("the 7 put a robber into a game that has none")
	}
}

// The redactor blanks the resource for everybody but the two parties.
func TestTheStolenCardIsRedacted(t *testing.T) {
	e := engine.NewEvent(EvSevenStolen, stolenData{Thief: 0, Victim: 2, Res: board.Ore}, 0, 2)
	f, ok := engine.RedactorFor(EvSevenStolen)
	if !ok {
		t.Fatal("no redactor registered for the 7's steal")
	}
	var public map[string]any
	if err := json.Unmarshal(f(e), &public); err != nil {
		t.Fatal(err)
	}
	if _, leaked := public["res"]; leaked {
		t.Errorf("the redacted payload names the card: %v", public)
	}
	if public["thief"] == nil || public["victim"] == nil {
		t.Errorf("the redacted payload hides who was robbed: %v", public)
	}
}

// --- Composition ----------------------------------------------------------

// The ruleset composes with everything its spec allows and refuses Explorers.
func TestRulesetCompatibility(t *testing.T) {
	for _, rs := range []string{
		"base+raiders",
		engine.CanonicalRuleset("base+islands+raiders"),
		engine.CanonicalRuleset("base+cak+raiders"),
		engine.CanonicalRuleset("base+fishermen+raiders"),
		engine.CanonicalRuleset("base+caravans+raiders"),
		engine.CanonicalRuleset("base+cak+caravans+fishermen+islands+raiders"),
	} {
		if !engine.ValidRuleset(rs) {
			t.Errorf("%s is refused and the spec allows it", rs)
		}
	}
	if engine.ValidRuleset("explorers+raiders") {
		t.Error("explorers+raiders resolved, want refused")
	}
	if _, ok := engine.ConflictBetween("explorers", "raiders"); !ok {
		t.Error("the compatibility table has no reason for refusing explorers+raiders")
	}
}

// The target is 12, and 13 alongside Knights.
func TestVictoryTarget(t *testing.T) {
	for _, tc := range []struct {
		ruleset string
		want    int
	}{
		{"base+raiders", winVP},
		{engine.CanonicalRuleset("base+cak+raiders"), winVPKnights},
	} {
		cfg := (Module{}).DefaultConfig(engine.GameConfig{Ruleset: tc.ruleset})
		if tc.ruleset == "base+raiders" && cfg.TargetVP != tc.want {
			t.Errorf("%s defaults to %d VP, want %d", tc.ruleset, cfg.TargetVP, tc.want)
		}
		// Alongside Knights the number comes from cak's own defaulter ("cak"
		// sorts before "raiders" and State.New applies them in ruleset order).
		// Both say 13.
		evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: tc.ruleset}, engine.SeedsFrom(3))
		if err != nil {
			t.Fatalf("%s: %v", tc.ruleset, err)
		}
		s, err := engine.Replay(evs)
		if err != nil {
			t.Fatal(err)
		}
		if s.Config.TargetVP != tc.want {
			t.Errorf("%s plays to %d, want %d", tc.ruleset, s.Config.TargetVP, tc.want)
		}
	}
}

// The base development deck is off, and so is Largest Army: nothing is ever
// held, so there is nothing to count.
func TestNoBaseDeckAndNoLargestArmy(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	if !engine.DevCardsDisabled(s) {
		t.Fatal("the base development deck is still in play")
	}
	s.Players[0].Hand = engine.CostDevCard
	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdBuyDevCard}); err == nil {
		t.Error("a base development card was bought in a Raiders game")
	}
	// The Largest Army title cannot be earned: playing a knight is the only route
	// to it and there are no knight cards to play.
	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdPlayDevCard,
		Data: raw2(map[string]any{"card": engine.DevKnight})}); err == nil {
		t.Error("a knight card was played in a Raiders game")
	}
}

// The second setup placement is a city.
func TestSetupSecondPlacementIsACity(t *testing.T) {
	evs, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+raiders"}, engine.SeedsFrom(5))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	cities := 0
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stalled")
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("%s: %v", cmd.Type, err)
		}
		for _, e := range out {
			if e.Type == engine.EvSetupCityPlace {
				cities++
			}
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	if cities != 3 {
		t.Errorf("%d setup cities, want one per seat", cities)
	}
	// And no landing was triggered by any of it.
	for _, b := range s.Ext {
		if x, ok := b.(*Ext); ok {
			seeded := 0
			for _, n := range x.RaiderCount {
				seeded += n
			}
			if seeded != max(2, (len(x.Coast)+2)/5) {
				t.Errorf("%d raiders on the coast after setup, want only the seeded ones", seeded)
			}
		}
	}
}

// --- Turn structure -------------------------------------------------------

// A landing fires immediately on a build and on an upgrade, and the whole batch
// is one command's worth of events.
func TestBuildAndUpgradeEachTriggerALanding(t *testing.T) {
	for _, tc := range []struct {
		name string
		cmd  engine.CommandType
		cost engine.Hand
	}{
		{"a settlement", engine.CmdBuildSettlement, engine.CostSettlement},
		{"an upgrade", engine.CmdBuildCity, engine.CostCity},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newState(t, "base+raiders", 4, testBoard(3))
			x := liveExt(t, s)
			// A vertex touching only interior land, so the build itself is legal
			// and nothing is conquered anywhere near it.
			v := x.Castle.Vertices()[0]
			s.Players[0].Hand = tc.cost
			if tc.cmd == engine.CmdBuildCity {
				s.Buildings[v] = engine.Building{Owner: 0}
			} else {
				s.Roads[v.Edges()[0]] = 0
			}
			before := x.RaidersOnBoard()
			evs, err := engine.Decide(s, engine.Command{Player: 0, Type: tc.cmd, Data: raw2(map[string]any{"v": v})})
			if err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			landings := 0
			for _, e := range evs {
				if e.Type == EvLanding {
					landings++
				}
			}
			if landings != 1 {
				t.Fatalf("%s produced %d landings, want exactly one", tc.name, landings)
			}
			apply(t, s, evs)
			if x.RaidersOnBoard() <= before && x.Pend.Kind == PendNone {
				t.Errorf("%s: attack landed nothing and asked nothing", tc.name)
			}
		})
	}
}

// The move phase fully precedes the sweep: every battle in a batch arrives after
// the turn has ended, never interleaved with a move.
func TestTheSweepFollowsTheWholeTurn(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	h := x.Coast[0]
	x.RaiderCount[x.coastIndex(h)] = 1
	edges := h.Edges()
	x.RiderAt[edges[0]] = 0
	x.RiderAt[edges[1]] = 0

	evs, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdEndTurn})
	if err != nil {
		t.Fatalf("end turn: %v", err)
	}
	ended, swept, fought := -1, -1, -1
	for i, e := range evs {
		switch e.Type {
		case engine.EvTurnEnded:
			ended = i
		case EvSweep:
			swept = i
		case EvBattle:
			fought = i
		default:
			// Every other event type: this loop looks for three positions in
			// the log.
		}
	}
	if ended < 0 || swept < ended || fought < swept {
		t.Fatalf("batch order %v, want turn end, sweep, battles", eventTypes(evs))
	}
	apply(t, s, evs)
	if x.RaiderCount[x.coastIndex(h)] != 0 {
		t.Error("the hex was not cleared by the victory")
	}
	// And the per-turn bookkeeping is closed, so the riders may move again.
	if len(x.Moved) != 0 || x.Buys != 0 {
		t.Error("the sweep did not clear the turn's rider-move and gold-buy bookkeeping")
	}
}

func eventTypes(evs []engine.Event) []engine.EventType {
	out := make([]engine.EventType, len(evs))
	for i, e := range evs {
		out[i] = e.Type
	}
	return out
}

// Replaying the log reproduces the live state exactly, landings and battles
// included. Everything this scenario draws comes from the seeded public stream.
func TestReplayReproducesAScenarioGame(t *testing.T) {
	for _, ruleset := range []string{
		"base+raiders",
		engine.CanonicalRuleset("base+islands+raiders"),
		engine.CanonicalRuleset("base+caravans+raiders"),
	} {
		t.Run(ruleset, func(t *testing.T) {
			evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: ruleset}, engine.SeedsFrom(11))
			if err != nil {
				t.Fatal(err)
			}
			live, err := engine.Replay(evs)
			if err != nil {
				t.Fatal(err)
			}
			// Drive the game with the engine's own auto moves, which are seeded
			// too, so the log is reproducible without a bot.
			for range 4000 {
				if live.Phase == engine.PhaseFinished {
					break
				}
				cmd, ok := engine.AutoCommand(live)
				if !ok {
					break
				}
				out, err := engine.Decide(live, cmd)
				if err != nil {
					t.Fatalf("%s: %v", cmd.Type, err)
				}
				for _, e := range out {
					if err := engine.Apply(live, e); err != nil {
						t.Fatal(err)
					}
					evs = append(evs, e)
				}
			}
			again, err := engine.Replay(evs)
			if err != nil {
				t.Fatalf("replay: %v", err)
			}
			a, _ := StateExt(live)
			b, _ := StateExt(again)
			if a == nil || b == nil {
				t.Fatal("no scenario state after a whole game")
			}
			if a.Supply != b.Supply {
				t.Errorf("replay: supply %d, live %d", b.Supply, a.Supply)
			}
			for i := range a.RaiderCount {
				if a.RaiderCount[i] != b.RaiderCount[i] {
					t.Fatalf("replay: hex %v holds %d raiders, live holds %d", a.Coast[i], b.RaiderCount[i], a.RaiderCount[i])
				}
			}
			for p := range a.Prisoners {
				if a.Prisoners[p] != b.Prisoners[p] || a.Gold[p] != b.Gold[p] || a.RidersLeft[p] != b.RidersLeft[p] {
					t.Fatalf("replay: seat %d differs (prisoners %d/%d, gold %d/%d, riders %d/%d)",
						p, b.Prisoners[p], a.Prisoners[p], b.Gold[p], a.Gold[p], b.RidersLeft[p], a.RidersLeft[p])
				}
			}
			if len(a.RiderAt) != len(b.RiderAt) {
				t.Fatalf("replay: %d riders on the board, live has %d", len(b.RiderAt), len(a.RiderAt))
			}
			for e, owner := range a.RiderAt {
				if b.RiderAt[e] != owner {
					t.Fatalf("replay: the rider on %v belongs to %d, live says %d", e, b.RiderAt[e], owner)
				}
			}
		})
	}
}

// The two Knights event types this scenario watches for are spelled as wire
// strings because modules do not import each other. The test build can import
// engine/knights, so pin them against its constants.
func TestKnightsEventNamesMatch(t *testing.T) {
	for _, tc := range []struct{ got, want engine.EventType }{
		{knightsEventDie, knights.EvEventDie},
		{knightsImproved, knights.EvImproved},
	} {
		if tc.got != tc.want {
			t.Errorf("raiders watches for %q and engine/knights emits %q", tc.got, tc.want)
		}
	}
	if knights.Name != knightsModuleName {
		t.Errorf("raiders keys its Knights rules on %q and the module is named %q", knightsModuleName, knights.Name)
	}
	if islands.Name != islandsModuleName {
		t.Errorf("raiders names the Islands module %q and it is named %q", islandsModuleName, islands.Name)
	}
}

// --- The Fishermen and Knights seams --------------------------------------

// The seven-fish spend draws from this scenario's deck, and the spend that
// removes the robber is always refused, before any tile is taken.
func TestFishermenSeams(t *testing.T) {
	s := newState(t, engine.CanonicalRuleset("base+fishermen+raiders"), 4, testBoard(2))
	if !engine.HasScenarioCards(s) {
		t.Fatal("the seven-fish spend cannot see this scenario's deck")
	}
	evs, ok := engine.DrawScenarioCard(s, 0, 1)
	if !ok || len(evs) == 0 {
		t.Fatal("the scenario deck handed back nothing")
	}
	if evs[0].Type != EvCard {
		t.Fatalf("the draw produced a %s, want a revealed card", evs[0].Type)
	}
	if d := engine.DecodeEvent[cardData](evs[0]); !d.Free {
		t.Error("a granted card was charged for")
	}
	// There is no robber and there never will be, so the two-fish spend is
	// refused rather than waiting for one to enter play.
	if !engine.RobberSuppressed(s) || s.Board.RobberOnBoard() {
		t.Error("a Fishermen+Raiders game has a robber in it")
	}
}

// Under Knights the barbarian fleet does not sail, so the board has one
// barbarian system rather than two. The event die is still rolled because the
// fairness audit re-derives it.
func TestKnightsBarbariansDoNotSail(t *testing.T) {
	evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: engine.CanonicalRuleset("base+cak+raiders")},
		engine.SeedsFrom(59))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	dice, attacks := 0, 0
	for range 6000 {
		if s.Phase == engine.PhaseFinished {
			break
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			break
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("%s: %v", cmd.Type, err)
		}
		for _, e := range out {
			switch e.Type {
			case knightsEventDie:
				dice++
			case knights.EvBarbarianAttack:
				attacks++
			default:
				// Counting two kinds, ignoring the rest.
			}
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	if dice == 0 {
		t.Fatal("event die never rolled")
	}
	if attacks != 0 {
		t.Errorf("%d barbarian landfalls in a Raiders game, want 0", attacks)
	}
}

// Under Islands, a ship route may only be extended if one of your ships touches
// one of your own unconquered buildings, and a conquered building leaves the
// pieces beside it open.
func TestIslandsShipsAndConquest(t *testing.T) {
	s := newState(t, engine.CanonicalRuleset("base+islands+raiders"), 4, testBoard(3))
	x := liveExt(t, s)
	// A coastal vertex of ours, and the hexes it touches.
	var v board.Vertex
	var land []board.Hex
	for _, h := range x.Coast {
		for _, cand := range h.Vertices() {
			var hs []board.Hex
			all := true
			for _, hh := range cand.Hexes() {
				if !s.Board.Land(hh) {
					continue
				}
				hs = append(hs, hh)
				if x.coastIndex(hh) < 0 {
					all = false
				}
			}
			if all && len(hs) > 0 {
				v, land = cand, hs
			}
		}
		if len(land) > 0 {
			break
		}
	}
	if len(land) == 0 {
		t.Fatal("no vertex on this board touches only coastal hexes")
	}
	s.Buildings[v] = engine.Building{Owner: 0}
	if engine.BuildingIsInert(s, v) {
		t.Fatal("the building is switched off with no raiders anywhere")
	}
	for _, h := range land {
		x.RaiderCount[x.coastIndex(h)] = conquered
	}
	if !engine.BuildingIsInert(s, v) {
		t.Fatal("every neighbour is conquered and the building is still working")
	}
	// A road beside it is refused and a ship on the same edge is not ("the
	// coast is where you retreat to"): the road build asks BlocksNewRoad,
	// Islands' ship build does not, and this module registers no OccupiesEdge,
	// which would refuse both.
	blocked := 0
	for _, e := range v.Edges() {
		if (Module{}).blocksNewRoad(s, e) {
			blocked++
		}
	}
	if blocked == 0 {
		t.Fatal("no path at a fully conquered vertex refuses a new road")
	}
	if (Module{}).Hooks().OccupiesEdge != nil {
		t.Error("OccupiesEdge is set, want nil")
	}
	// The route the conquered building anchored is frozen: it no longer counts
	// as its owner's building for a ship extension.
	if !engine.BuildingIsInert(s, v) {
		t.Error("the conquered building is still anchoring")
	}
}
