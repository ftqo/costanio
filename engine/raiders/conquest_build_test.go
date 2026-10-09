package raiders

import (
	"errors"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// Nothing may be built on the edges or intersections of a conquered hex. That
// is every build at one of its six corners, and a city upgrade is a build.
func TestUpgradeIsRefusedBesideAConqueredHex(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	h := x.Coast[0]
	v := h.Vertices()[0]
	s.Buildings[v] = engine.Building{Owner: 0}
	s.Players[0].Hand = engine.CostCity
	up := engine.Command{Player: 0, Type: engine.CmdBuildCity, Data: raw2(map[string]any{"v": v})}

	// Two raiders: not conquered yet, so the upgrade is open and offered.
	x.RaiderCount[x.coastIndex(h)] = conquered - 1
	if _, err := engine.Decide(s, up); err != nil {
		t.Fatalf("an upgrade beside an unconquered hex was refused: %v", err)
	}
	if !slices.Contains(s.LegalCities(0), v) {
		t.Fatal("an upgrade beside an unconquered hex is not offered")
	}

	x.RaiderCount[x.coastIndex(h)] = conquered
	if _, err := engine.Decide(s, up); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("upgrading beside a conquered hex: err %v, want ErrBadPlacement", err)
	}
	if slices.Contains(s.LegalCities(0), v) {
		t.Error("the board still offers a city upgrade beside a conquered hex")
	}
	if slices.Contains(s.LegalTargetsFor(0).Cities, v) {
		t.Error("the legal targets still offer a city upgrade beside a conquered hex")
	}
	// The same vertex refuses a new settlement.
	if err := engine.CheckSettlementSpot(s, h.Vertices()[2]); err == nil {
		t.Error("a new settlement is allowed on a conquered hex's corner")
	}
}

// knightsRaidersGame is a real base+cak+raiders game driven through setup, with
// the dice thrown, so a build command is judged on placement alone.
func knightsRaidersGame(t *testing.T) (*engine.State, *Ext, *knights.Ext) {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: engine.CanonicalRuleset("base+cak+raiders")},
		engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		evs, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("setup %s: %v", cmd.Type, err)
		}
		apply(t, s, evs)
	}
	s.Rolled = true
	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("no Knights ext in a Knights game")
	}
	return s, liveExt(t, s), cx
}

// emptyCornerOf is a land corner of coastal hex h with nothing on it and
// nothing beside it, so a test can put exactly what it needs there.
func emptyCornerOf(s *engine.State, cx *knights.Ext, h board.Hex) (board.Vertex, bool) {
	for _, v := range h.Vertices() {
		if !s.Board.LandVertex(v) {
			continue
		}
		clear := true
		nb := v.Neighbors()
		for _, n := range append(nb[:], v) {
			if _, ok := s.Buildings[n]; ok {
				clear = false
			}
			if _, ok := cx.Knights[n]; ok {
				clear = false
			}
		}
		for _, e := range v.Edges() {
			if _, ok := s.Roads[e]; ok {
				clear = false
			}
		}
		if clear {
			return v, true
		}
	}
	return board.Vertex{}, false
}

// Under Knights the rule covers the Knights pieces built on an intersection: a
// new knight (bought, or placed by the Deserter) and a city wall (bought, or
// free from the Engineer). Promoting, activating and moving a knight are not
// builds, and a metropolis is placed by the city improvement rather than built,
// so they stay open.
func TestKnightsBuildsRefusedBesideConqueredHex(t *testing.T) {
	s, x, cx := knightsRaidersGame(t)
	p := s.Cur
	var h board.Hex
	var kv, cv board.Vertex
	found := false
	for _, c := range x.Coast {
		a, ok := emptyCornerOf(s, cx, c)
		if !ok {
			continue
		}
		// A second, separate corner of the same hex for the city.
		an := a.Neighbors()
		for _, b := range c.Vertices() {
			if b == a || !s.Board.LandVertex(b) || slices.Contains(an[:], b) {
				continue
			}
			if _, ok := s.Buildings[b]; ok {
				continue
			}
			if _, ok := cx.Knights[b]; ok {
				continue
			}
			h, kv, cv, found = c, a, b, true
			break
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("no coastal hex with two free corners")
	}
	// A road of p's into the knight's corner, and a city of p's at the other.
	s.Roads[kv.Edges()[0]] = p
	s.Buildings[cv] = engine.Building{Owner: p, City: true}
	// Every other city of p's already walled, so a wall has one target.
	for v, b := range s.Buildings {
		if b.Owner == p && b.City && v != cv {
			cx.Walled[v] = true
		}
	}
	s.Players[p].Hand = engine.Hand{board.Sheep: 5, board.Ore: 5, board.Brick: 5, board.Wheat: 5}
	knight := engine.Command{Player: p, Type: knights.CmdBuildKnight, Data: raw2(map[string]any{"v": kv})}
	wall := engine.Command{Player: p, Type: knights.CmdBuildWall, Data: raw2(map[string]any{"v": cv})}
	anyWall := engine.Command{Player: p, Type: knights.CmdBuildWall, Data: raw2(map[string]any{})}
	engineer := engine.Command{Player: p, Type: knights.CmdPlayProgress,
		Data: raw2(map[string]any{"card": knights.CardEngineer})}
	cx.Players[p].Progress = []knights.ProgressCard{knights.CardEngineer}

	// Unconquered: every one of them is open, and offered.
	x.RaiderCount[x.coastIndex(h)] = conquered - 1
	for _, c := range []engine.Command{knight, wall, anyWall, engineer} {
		if _, err := engine.Decide(s, c); err != nil {
			t.Fatalf("%s beside an unconquered hex was refused: %v", c.Type, err)
		}
	}
	lt := s.LegalTargetsFor(p)
	if !slices.Contains(lt.Knights, kv) || !slices.Contains(lt.Walls, cv) {
		t.Fatalf("unconquered: knight offered %v, wall offered %v, want both",
			slices.Contains(lt.Knights, kv), slices.Contains(lt.Walls, cv))
	}

	x.RaiderCount[x.coastIndex(h)] = conquered
	if _, err := engine.Decide(s, knight); !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("a knight beside a conquered hex: err %v, want ErrBadPlacement", err)
	}
	if _, err := engine.Decide(s, wall); !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("a wall beside a conquered hex: err %v, want ErrBadPlacement", err)
	}
	// The unnamed wall and the Engineer both take the first unwalled city; the
	// only one left is beside the conquered hex, so both are refused.
	if _, err := engine.Decide(s, anyWall); err == nil {
		t.Error("an unnamed wall was built on a city beside a conquered hex")
	}
	if _, err := engine.Decide(s, engineer); err == nil {
		t.Error("the Engineer walled a city beside a conquered hex")
	}
	lt = s.LegalTargetsFor(p)
	if slices.Contains(lt.Knights, kv) {
		t.Error("a knight beside a conquered hex is still offered")
	}
	if slices.Contains(lt.Walls, cv) {
		t.Error("a wall beside a conquered hex is still offered")
	}
}

// The Medicine card is a discounted city upgrade, and the discount does not
// reopen a corner conquest has closed.
func TestMedicineIsRefusedBesideAConqueredHex(t *testing.T) {
	s, x, cx := knightsRaidersGame(t)
	p := s.Cur
	var h board.Hex
	var v board.Vertex
	found := false
	for _, c := range x.Coast {
		if a, ok := emptyCornerOf(s, cx, c); ok {
			h, v, found = c, a, true
			break
		}
	}
	if !found {
		t.Fatal("no free coastal corner")
	}
	s.Buildings[v] = engine.Building{Owner: p}
	s.Players[p].Hand = engine.Hand{board.Ore: 5, board.Wheat: 5}
	cx.Players[p].Progress = []knights.ProgressCard{knights.CardMedicine}
	med := engine.Command{Player: p, Type: knights.CmdPlayProgress,
		Data: raw2(map[string]any{"card": knights.CardMedicine, "v": v})}

	x.RaiderCount[x.coastIndex(h)] = conquered - 1
	if _, err := engine.Decide(s, med); err != nil {
		t.Fatalf("Medicine beside an unconquered hex was refused: %v", err)
	}
	x.RaiderCount[x.coastIndex(h)] = conquered
	if _, err := engine.Decide(s, med); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("Medicine beside a conquered hex: err %v, want ErrBadPlacement", err)
	}
}

// The Engineer names the city it walls. Using the fold's "first unwalled city
// in board order" would put a free wall beside a conquered hex whenever that
// city came first.
func TestEngineerSkipsACityBesideAConqueredHex(t *testing.T) {
	s, x, cx := knightsRaidersGame(t)
	p := s.Cur
	for v, b := range s.Buildings {
		if b.Owner == p && b.City {
			cx.Walled[v] = true
		}
	}
	// cv: the first free coastal corner in board order, beside a hex we conquer.
	// w: a later free corner, touching no conquered hex.
	var h board.Hex
	var cv, w board.Vertex
	haveCV, haveW := false, false
	for _, hh := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range hh.Vertices() {
			if !s.Board.LandVertex(v) {
				continue
			}
			if _, ok := s.Buildings[v]; ok {
				continue
			}
			if _, ok := cx.Knights[v]; ok {
				continue
			}
			if !haveCV && x.coastIndex(hh) >= 0 {
				h, cv, haveCV = hh, v, true
				continue
			}
			hv := h.Vertices()
			if haveCV && !slices.Contains(hv[:], v) {
				w, haveW = v, true
			}
		}
		if haveW {
			break
		}
	}
	if !haveCV || !haveW {
		t.Fatal("no pair of free corners")
	}
	s.Buildings[cv] = engine.Building{Owner: p, City: true}
	s.Buildings[w] = engine.Building{Owner: p, City: true}
	x.RaiderCount[x.coastIndex(h)] = conquered
	// Only h is conquered, so w is clear of it by construction.
	cx.Players[p].Progress = []knights.ProgressCard{knights.CardEngineer}
	evs, err := engine.Decide(s, engine.Command{Player: p, Type: knights.CmdPlayProgress,
		Data: raw2(map[string]any{"card": knights.CardEngineer})})
	if err != nil {
		t.Fatalf("the Engineer was refused with a wallable city available: %v", err)
	}
	apply(t, s, evs)
	if cx.Walled[cv] {
		t.Error("the Engineer walled the city beside the conquered hex")
	}
	if !cx.Walled[w] {
		t.Error("the Engineer did not wall the one city it may")
	}
}
