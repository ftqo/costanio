package harbormaster

import (
	"bytes"
	"encoding/gob"
	"math/rand/v2"
	"reflect"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Every state in this file is constructed rather than found by seed search, so
// no test can quietly stop running when the generator changes. A test that
// cannot build its state fails; it never skips.

// harborBoard builds a bare board carrying `n` harbours, each on the edge
// between the north and south corners of consecutive hexes, and returns it with
// the harbour vertices in stable order. It is not a playable map: HarborPoints
// only asks board.HarborAt whether a vertex belongs to a harbour, so the
// harbour list is the whole fixture.
func harborBoard(t *testing.T, n int) (*board.Board, []board.Vertex) {
	t.Helper()
	if n < 1 || n > 5 {
		t.Fatalf("harborBoard: want 1..5 harbours, got %d", n)
	}
	b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(2) {
		b.Tiles[h] = board.Tile{Res: board.Wood, Number: 6}
	}
	var verts []board.Vertex
	for i := range n {
		h := board.Hex{Q: i - 2, R: 2}
		v := board.Vertex{Q: h.Q, R: h.R, Side: board.N}
		w := board.Vertex{Q: h.Q, R: h.R, Side: board.S}
		b.Harbors = append(b.Harbors, board.Harbor{Verts: [2]board.Vertex{v, w}, Ratio: 3})
		verts = append(verts, v)
	}
	return b, verts
}

// bareState is a state with a board, seats and nothing else: no ruleset, so no
// module hooks run and the caller drives the derivation directly.
func bareState(t *testing.T, b *board.Board, players int) *engine.State {
	t.Helper()
	s := engine.Empty()
	s.Config = engine.GameConfig{Players: players, Ruleset: "base+" + Name, TargetVP: 11}
	s.Players = make([]engine.PlayerState, players)
	s.Board = b
	s.Phase = engine.PhasePlay
	return s
}

func put(s *engine.State, v board.Vertex, owner engine.PlayerID, city bool) {
	s.Buildings[v] = engine.Building{Owner: owner, City: city}
}

// TestHarborPointsEqualBuildingVP is the first conformance
// bullet: 1 per own settlement and 2 per own city standing on a harbour vertex,
// 0 for every other piece and every other vertex.
func TestHarborPointsEqualBuildingVP(t *testing.T) {
	b, hv := harborBoard(t, 3)
	inland := board.Vertex{Q: 0, R: 0, Side: board.N}
	if _, ok := b.HarborAt(inland); ok {
		t.Fatalf("fixture broken: %v was meant to be off-harbour", inland)
	}

	cases := []struct {
		name  string
		build func(s *engine.State)
		want  [2]int
	}{
		{"nothing on the board", func(*engine.State) {}, [2]int{0, 0}},
		{"a settlement on a harbour", func(s *engine.State) { put(s, hv[0], 0, false) }, [2]int{1, 0}},
		{"a city on a harbour", func(s *engine.State) { put(s, hv[0], 0, true) }, [2]int{2, 0}},
		{"a settlement off the harbour", func(s *engine.State) { put(s, inland, 0, false) }, [2]int{0, 0}},
		{"a city off the harbour", func(s *engine.State) { put(s, inland, 0, true) }, [2]int{0, 0}},
		{"a city and a settlement, two harbours", func(s *engine.State) {
			put(s, hv[0], 0, true)
			put(s, hv[1], 0, false)
		}, [2]int{3, 0}},
		{"only your own buildings count", func(s *engine.State) {
			put(s, hv[0], 0, true)
			put(s, hv[1], 1, true)
			put(s, hv[2], 1, false)
		}, [2]int{2, 3}},
		{"road on harbour edge", func(s *engine.State) {
			s.Roads[board.NewEdge(hv[0], board.Vertex{Q: hv[0].Q, R: hv[0].R, Side: board.S})] = 0
		}, [2]int{0, 0}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := bareState(t, b, 2)
			tc.build(s)
			for seat, want := range tc.want {
				if got := HarborPoints(s, engine.PlayerID(seat)); got != want {
					t.Errorf("HarborPoints(P%d) = %d, want %d", seat, got, want)
				}
			}
		})
	}
}

// TestBuildingCountsOnce: a building is worth 1 or
// 2 however many harbours its vertex belongs to. Our generator never deals
// overlapping harbours (placeHarbors reserves both vertices), so this only
// happens on a curated map and is constructed here.
func TestBuildingCountsOnce(t *testing.T) {
	b, hv := harborBoard(t, 1)
	v := hv[0]
	// A second and third harbour sharing the same vertex.
	for _, other := range []board.Vertex{{Q: 1, R: 1, Side: board.N}, {Q: -1, R: -1, Side: board.S}} {
		b.Harbors = append(b.Harbors, board.Harbor{Verts: [2]board.Vertex{v, other}, Ratio: 2, Res: board.Ore})
	}
	if len(b.Harbors) != 3 {
		t.Fatalf("fixture broken: %d harbours, want 3", len(b.Harbors))
	}

	s := bareState(t, b, 2)
	put(s, v, 0, false)
	if got := HarborPoints(s, 0); got != 1 {
		t.Errorf("a settlement on three overlapping harbours scored %d, want 1", got)
	}
	put(s, v, 0, true)
	if got := HarborPoints(s, 0); got != 2 {
		t.Errorf("a city on three overlapping harbours scored %d, want 2", got)
	}
}

// suppressor stands in for the module the BuildingVPSuppressed hook exists for
// (Raiders). Registered under a name no ruleset uses, so it is inert except in
// the test that names it.
type suppressor struct{}

var suppressed = map[board.Vertex]bool{}

func (suppressor) Name() string                                           { return "hmtestsuppressor" }
func (suppressor) SetupBoard(*board.Board, engine.GameConfig, *rand.Rand) {}
func (suppressor) Decide(*engine.State, engine.Command) ([]engine.Event, bool, error) {
	return nil, false, nil
}
func (suppressor) Apply(*engine.State, engine.Event) (bool, error) { return false, nil }
func (suppressor) Hooks() engine.Hooks {
	return engine.Hooks{
		BuildingVPSuppressed: func(_ *engine.State, v board.Vertex) bool { return suppressed[v] },
	}
}

func init() {
	engine.RegisterModule("hmtestsuppressor", func() engine.Module { return suppressor{} })
}

// TestSuppressedBuildingScoresNothing: the harbour must be usable by
// its owner for the building to score, and the building regains its full value
// when the enclosure breaks.
func TestSuppressedBuildingScoresNothing(t *testing.T) {
	b, hv := harborBoard(t, 2)
	s := bareState(t, b, 2)
	s.Config.Ruleset = "base+" + Name + "+hmtestsuppressor"
	put(s, hv[0], 0, true)
	put(s, hv[1], 0, false)

	if got := HarborPoints(s, 0); got != 3 {
		t.Fatalf("before the conquest: %d harbour points, want 3", got)
	}
	suppressed = map[board.Vertex]bool{hv[0]: true}
	t.Cleanup(func() { suppressed = map[board.Vertex]bool{} })
	if got := HarborPoints(s, 0); got != 1 {
		t.Errorf("with the city conquered: %d harbour points, want 1", got)
	}
	suppressed = map[board.Vertex]bool{}
	if got := HarborPoints(s, 0); got != 3 {
		t.Errorf("after liberation: %d harbour points, want 3 again", got)
	}
}

// TestHolderDerivation walks every branch of the declarative
// rule, including the two Decisions: a holder who falls below the threshold
// loses the card, and a tie arising from a loss leaves it unheld.
func TestHolderDerivation(t *testing.T) {
	const none = engine.NoPlayer
	cases := []struct {
		name    string
		points  []int
		current engine.PlayerID
		want    engine.PlayerID
	}{
		{"all zero", []int{0, 0, 0}, none, none},
		{"below threshold", []int{2, 1, 0}, none, none},
		{"all at two", []int{2, 2, 2}, none, none},
		{"first to three", []int{3, 2, 0}, none, 0},
		{"sole leader above threshold", []int{4, 3, 1}, none, 0},
		{"moves to strictly more", []int{3, 4, 0}, 0, 1},
		{"tie keeps holder", []int{4, 4, 0}, 0, 0},
		{"tie keeps holder seat 1", []int{4, 4, 0}, 1, 1},
		{"tie without holder unheld", []int{4, 4, 3}, 2, none},
		{"tie no holder unheld", []int{4, 4, 0}, none, none},
		{"holder below three loses", []int{2, 1, 0}, 0, none},
		{"holder below three to sole leader", []int{2, 3, 0}, 0, 1},
		{"holder below three tie above unheld", []int{1, 3, 3}, 0, none},
		{"holder outright beaten loses", []int{5, 4, 4}, 1, 0},
		{"three-way tie unheld", []int{3, 3, 3}, none, none},
		{"three-way tie keeps holder", []int{3, 3, 3}, 2, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := deriveHolder(tc.points, tc.current); got != tc.want {
				t.Errorf("deriveHolder(%v, holder=%d) = %d, want %d", tc.points, tc.current, got, tc.want)
			}
		})
	}
}

// TestDeriveHolderIsIdempotent: feeding the derivation its own answer must not
// move the card. This is what makes AfterEvents safe to run on every batch (it
// emits only on a change).
func TestDeriveHolderIsIdempotent(t *testing.T) {
	for _, points := range [][]int{
		{0, 0, 0}, {3, 0, 0}, {3, 3, 0}, {4, 4, 4}, {2, 5, 5}, {6, 3, 1},
	} {
		for current := engine.NoPlayer; int(current) < len(points); current++ {
			first := deriveHolder(points, current)
			if again := deriveHolder(points, first); again != first {
				t.Errorf("deriveHolder(%v, %d) = %d, then %d: not idempotent", points, current, first, again)
			}
		}
	}
}

// TestModuleSurface pins the last conformance bullet:
// no SetupBoard work, no BoardFinisher, BoardRadiuser or TerrainRequirer, no
// OnDiceRolled, no robber, BankRatio or RouteLength participation. The surface
// is VictoryCheck, the target adjustment and the re-derivation hook.
//
// Uses reflection over Hooks so a newly added hook is covered automatically.
func TestModuleSurface(t *testing.T) {
	allowed := map[string]bool{"AfterEvents": true, "VictoryCheck": true}
	h := reflect.ValueOf(Module{}.Hooks())
	ht := h.Type()
	for i := range ht.NumField() {
		f := ht.Field(i)
		set := false
		switch h.Field(i).Kind() {
		case reflect.Func:
			set = !h.Field(i).IsNil()
		case reflect.Bool:
			set = h.Field(i).Bool()
		default:
			t.Fatalf("Hooks.%s has unhandled kind %v", f.Name, h.Field(i).Kind())
		}
		if set && !allowed[f.Name] {
			t.Errorf("Harbormaster sets Hooks.%s, allowed hooks are %v", f.Name, slices.Sorted(maps(allowed)))
		}
		if !set && allowed[f.Name] {
			t.Errorf("Harbormaster leaves required Hooks.%s unset", f.Name)
		}
	}

	var m any = Module{}
	for _, iface := range []struct {
		name string
		typ  reflect.Type
	}{
		{"BoardFinisher", reflect.TypeFor[engine.BoardFinisher]()},
		{"BoardRadiuser", reflect.TypeFor[engine.BoardRadiuser]()},
		{"TerrainRequirer", reflect.TypeFor[engine.TerrainRequirer]()},
		{"ConfigDefaulter", reflect.TypeFor[engine.ConfigDefaulter]()},
		{"ExtBoardInitializer", reflect.TypeFor[engine.ExtBoardInitializer]()},
		{"Standalone", reflect.TypeFor[engine.Standalone]()},
	} {
		if reflect.TypeOf(m).Implements(iface.typ) {
			t.Errorf("Harbormaster implements %s, want not implemented", iface.name)
		}
	}
	for _, iface := range []struct {
		name string
		typ  reflect.Type
	}{
		{"TargetVPAdjuster", reflect.TypeFor[engine.TargetVPAdjuster]()},
		{"VPCeiler", reflect.TypeFor[engine.VPCeiler]()},
		{"ExtInitializer", reflect.TypeFor[engine.ExtInitializer]()},
		// The authored-map harbour minimum.
		{"MapChecker", reflect.TypeFor[engine.MapChecker]()},
	} {
		if !reflect.TypeOf(m).Implements(iface.typ) {
			t.Errorf("Harbormaster does not implement required %s", iface.name)
		}
	}
}

func maps(m map[string]bool) func(func(string) bool) {
	return func(yield func(string) bool) {
		for k := range m {
			if !yield(k) {
				return
			}
		}
	}
}

// TestExtClonesAndViewsShareNothing checks engine.Viewable's no-sharing
// contract on this module's one reference field, Points. The generic sweep in
// engine/ruletest also catches this; this test names the field.
func TestExtClonesAndViewsShareNothing(t *testing.T) {
	x := &Ext{Holder: 1, Points: []int{1, 2, 3}}

	c := x.CloneExt().(*Ext)
	c.Points[0] = 99
	if x.Points[0] != 1 {
		t.Errorf("CloneExt shares the Points slice with the live ext")
	}

	v := x.ViewExt(0).(*ExtView)
	v.Points[1] = 99
	if x.Points[1] != 2 {
		t.Errorf("ViewExt shares the Points slice with the live ext")
	}
	if v.Threshold != Threshold {
		t.Errorf("ViewExt published threshold %d, want %d", v.Threshold, Threshold)
	}
	if !slices.Equal(x.Points, []int{1, 2, 3}) {
		t.Errorf("the live ext was mutated: %v", x.Points)
	}
}

// TestViewSameForEveryViewer: the holder and every seat's harbour
// points are public, like Longest Road, so the view must not differ by viewer
// and no redactor is registered.
func TestViewSameForEveryViewer(t *testing.T) {
	x := &Ext{Holder: 2, Points: []int{1, 4, 5}}
	want := x.ViewExt(engine.NoPlayer).(*ExtView)
	for seat := range 3 {
		got := x.ViewExt(engine.PlayerID(seat)).(*ExtView)
		if got.Holder != want.Holder || !slices.Equal(got.Points, want.Points) {
			t.Errorf("seat %d sees {holder %d, points %v}, spectator sees {holder %d, points %v}",
				seat, got.Holder, got.Points, want.Holder, want.Points)
		}
	}
	if _, ok := engine.RedactorFor(EvStandings); ok {
		t.Errorf("%s has a redactor registered; the standings are public", EvStandings)
	}
}

// TestExtSurvivesSnapshot checks the gob hazard engine.ExtRestorer
// describes: gob omits zero-valued fields, so a sentinel meant to read NoPlayer
// could come back as seat 0.
//
// This ext is safe: NoPlayer is -1, not the zero value, so it is written and
// read back, and a stored 0 decodes as the seat 0 it meant. Points is dropped
// only when empty, which a real game's never is, and every reader tolerates
// nil, so RestoreExt has nothing to do.
func TestExtSurvivesSnapshot(t *testing.T) {
	for _, want := range []*Ext{
		{Holder: engine.NoPlayer, Points: []int{0, 0, 0}},
		{Holder: 0, Points: []int{3, 1, 0}},
		{Holder: 2, Points: []int{1, 1, 4}},
	} {
		// Through a map[string]Extension, the shape State.Ext has and a
		// snapshot encodes.
		var buf bytes.Buffer
		if err := gob.NewEncoder(&buf).Encode(map[string]engine.Extension{Name: want}); err != nil {
			t.Fatalf("encode %+v: %v", want, err)
		}
		var got map[string]engine.Extension
		if err := gob.NewDecoder(&buf).Decode(&got); err != nil {
			t.Fatalf("decode %+v: %v", want, err)
		}
		x, ok := got[Name].(*Ext)
		if !ok {
			t.Fatalf("decoded %T, want *Ext", got[Name])
		}
		x.RestoreExt()
		if x.Holder != want.Holder || !slices.Equal(x.Points, want.Points) {
			t.Errorf("round trip: {holder %d, points %v}, want {holder %d, points %v}",
				x.Holder, x.Points, want.Holder, want.Points)
		}
	}
}
