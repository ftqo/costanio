package knights

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// reject asserts a command is rejected with one of the wanted errors.
func reject(t *testing.T, s *engine.State, cmd engine.Command, want ...error) {
	t.Helper()
	_, err := engine.Decide(s, cmd)
	if err == nil {
		t.Fatalf("%s by %d: expected error, got nil", cmd.Type, cmd.Player)
	}
	for _, w := range want {
		if errors.Is(err, w) {
			return
		}
	}
	t.Fatalf("%s by %d: err = %v, want one of %v", cmd.Type, cmd.Player, err, want)
}

// roadAndEmpty returns p's own road edge and an empty (no building/knight)
// endpoint on it, suitable for placing a knight.
func roadAndEmpty(t *testing.T, s *engine.State, p engine.PlayerID) (board.Vertex, bool) {
	t.Helper()
	for e, owner := range s.Roads {
		if owner != p {
			continue
		}
		for _, v := range []board.Vertex{e.A, e.B} {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			if _, taken := ext(s).Knights[v]; taken {
				continue
			}
			return v, true
		}
	}
	return board.Vertex{}, false
}

// --- CommodityHand helpers ----------------------------------------------------

func TestCommodityHandHelpers(t *testing.T) {
	var h CommodityHand
	h.Add(CommodityHand{Cloth: 2, Paper: 1})
	if h.Count() != 3 {
		t.Errorf("count = %d, want 3", h.Count())
	}
	if !h.nonNegative() {
		t.Error("should be non-negative")
	}
	if !h.Has(CommodityHand{Cloth: 2, Paper: 1}) {
		t.Error("should hold what was added")
	}
	if h.Has(CommodityHand{Paper: 2}) {
		t.Error("should not hold 2 paper")
	}
	h.Sub(CommodityHand{Cloth: 3})
	if h.nonNegative() {
		t.Error("Cloth went to -1; should be negative")
	}
}

func TestCommodityForTrackAll(t *testing.T) {
	cases := map[Track]Commodity{Trade: Cloth, Politics: Coin, Science: Paper}
	for tr, want := range cases {
		if got := commodityForTrack(tr); got != want {
			t.Errorf("commodityForTrack(%d) = %d, want %d", tr, got, want)
		}
	}
}

// --- Module surface -----------------------------------------------------------

func TestModuleNameAndSetupBoard(t *testing.T) {
	if (Module{}).Name() != Name {
		t.Errorf("Name() = %q, want %q", (Module{}).Name(), Name)
	}
	// SetupBoard is a no-op; it must not panic or mutate the board's tile set.
	s, _ := newGame(t, 1, nil)
	before := len(s.Board.Tiles)
	(Module{}).SetupBoard(s.Board, s.Config, nil)
	if len(s.Board.Tiles) != before {
		t.Errorf("SetupBoard mutated tiles: %d -> %d", before, len(s.Board.Tiles))
	}
}

func TestUnknownCommandPassesThrough(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	ev, handled, err := (Module{}).Decide(s, engine.Command{Player: s.Cur, Type: "not_a_cak_command"})
	if handled || err != nil || ev != nil {
		t.Errorf("unknown command: handled=%v err=%v ev=%v", handled, err, ev)
	}
}

// --- Build knight error branches ---------------------------------------------

func TestBuildKnightErrors(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur

	spot, ok := roadAndEmpty(t, s, p)
	if !ok {
		fixtureGone(t, "no road spot")
	}

	// Off-network / non-land vertex.
	reject(t, s, engine.Command{Player: p, Type: CmdBuildKnight,
		Data: mustJSON(t, map[string]any{"v": board.Vertex{Q: 99, R: 99, Side: board.N}})},
		engine.ErrBadPlacement)

	// Spot occupied by a building.
	s.Buildings[spot] = engine.Building{Owner: p}
	reject(t, s, engine.Command{Player: p, Type: CmdBuildKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, ErrVertexTaken)
	delete(s.Buildings, spot)

	// Spot occupied by an existing knight.
	ext(s).Knights[spot] = Knight{Owner: p, Level: 1}
	reject(t, s, engine.Command{Player: p, Type: CmdBuildKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, ErrVertexTaken)
	delete(ext(s).Knights, spot)

	// No resources.
	s.Players[p].Hand = engine.Hand{}
	reject(t, s, engine.Command{Player: p, Type: CmdBuildKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, engine.ErrNoResources)

	// Not your turn.
	q := (p + 1) % engine.PlayerID(len(s.Players))
	reject(t, s, engine.Command{Player: q, Type: CmdBuildKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, engine.ErrNotYourTurn)
}

// --- Activate knight error branches ------------------------------------------

func TestActivateKnightErrors(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	spot, ok := roadAndEmpty(t, s, p)
	if !ok {
		fixtureGone(t, "no road spot")
	}
	x := ext(s)

	// No knight there.
	reject(t, s, engine.Command{Player: p, Type: CmdActivateKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, ErrNoKnight)

	// Someone else's knight.
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x.Knights[spot] = Knight{Owner: q, Level: 1}
	reject(t, s, engine.Command{Player: p, Type: CmdActivateKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, ErrNoKnight)

	// Already active.
	x.Knights[spot] = Knight{Owner: p, Level: 1, Active: true}
	reject(t, s, engine.Command{Player: p, Type: CmdActivateKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, ErrKnightState)

	// Inactive but no wheat.
	x.Knights[spot] = Knight{Owner: p, Level: 1}
	s.Players[p].Hand = engine.Hand{}
	reject(t, s, engine.Command{Player: p, Type: CmdActivateKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, engine.ErrNoResources)
}

// --- Promote knight (entirely uncovered) -------------------------------------

func TestPromoteKnight(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	spot, ok := roadAndEmpty(t, s, p)
	if !ok {
		fixtureGone(t, "no road spot")
	}
	x := ext(s)

	// No knight.
	reject(t, s, engine.Command{Player: p, Type: CmdPromoteKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, ErrNoKnight)

	// Level 1 -> 2 with resources.
	x.Knights[spot] = Knight{Owner: p, Level: 1}
	s.Players[p].Hand = costKnight
	step(t, s, engine.Command{Player: p, Type: CmdPromoteKnight,
		Data: mustJSON(t, map[string]any{"v": spot})})
	if x.Knights[spot].Level != 2 {
		t.Fatalf("level after promote = %d, want 2", x.Knights[spot].Level)
	}

	// Level 2 -> 3 needs Politics 3.
	s.Players[p].Hand = costKnight
	reject(t, s, engine.Command{Player: p, Type: CmdPromoteKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, ErrMightyNeedsFort)

	x.Players[p].Improve[Politics] = 3
	s.Players[p].Hand = costKnight
	// A fresh turn: the cap is per knight, so this knight's own flag must clear.
	k := x.Knights[spot]
	k.PromotedThisTurn = false
	x.Knights[spot] = k
	step(t, s, engine.Command{Player: p, Type: CmdPromoteKnight,
		Data: mustJSON(t, map[string]any{"v": spot})})
	if x.Knights[spot].Level != 3 {
		t.Fatalf("level = %d, want 3", x.Knights[spot].Level)
	}

	// Already at max.
	s.Players[p].Hand = costKnight
	reject(t, s, engine.Command{Player: p, Type: CmdPromoteKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, ErrKnightState)
}

func TestPromoteKnightNoResources(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	spot, ok := roadAndEmpty(t, s, p)
	if !ok {
		fixtureGone(t, "no road spot")
	}
	ext(s).Knights[spot] = Knight{Owner: p, Level: 1}
	s.Players[p].Hand = engine.Hand{}
	reject(t, s, engine.Command{Player: p, Type: CmdPromoteKnight,
		Data: mustJSON(t, map[string]any{"v": spot})}, engine.ErrNoResources)
}

// --- Move knight error branches ----------------------------------------------

func TestMoveKnightErrors(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	from, ok := roadAndEmpty(t, s, p)
	if !ok {
		fixtureGone(t, "no road spot")
	}

	// No knight at `from`.
	reject(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": from})}, ErrNoKnight)

	// Inactive knight cannot move.
	x.Knights[from] = Knight{Owner: p, Level: 1}
	reject(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": from})}, ErrKnightState)

	// Freshly activated knight cannot move.
	x.Knights[from] = Knight{Owner: p, Level: 1, Active: true, FreshlyActivated: true}
	reject(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": from})}, ErrKnightState)
}

// TestMoveKnightOntoOwnKnight: a knight may not move onto your own knight.
func TestMoveKnightOntoOwnKnight(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	from, to, _, _, ok := findDisplacementSetup(s)
	if !ok {
		fixtureGone(t, "no geometry")
	}
	s.Roads[board.NewEdge(from, to)] = p
	x.Knights[from] = Knight{Owner: p, Level: 2, Active: true}
	x.Knights[to] = Knight{Owner: p, Level: 1, Active: true} // own knight
	reject(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": to})}, ErrVertexTaken)
}

// TestMoveKnightSimpleMove exercises the plain move (no displacement) path.
func TestMoveKnightSimpleMove(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	from, to, _, _, ok := findDisplacementSetup(s)
	if !ok {
		fixtureGone(t, "no geometry")
	}
	s.Roads[board.NewEdge(from, to)] = p
	x.Knights[from] = Knight{Owner: p, Level: 1, Active: true}

	step(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": to})})
	if _, gone := x.Knights[from]; gone {
		t.Error("knight should have left `from`")
	}
	k, ok := x.Knights[to]
	if !ok || k.Active {
		t.Errorf("knight should occupy `to`, deactivated: %+v ok=%v", k, ok)
	}
}

// TestMoveKnightUnreachable: moving to a vertex with no connected road path fails.
func TestMoveKnightUnreachable(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	from, ok := roadAndEmpty(t, s, p)
	if !ok {
		fixtureGone(t, "no road spot")
	}
	x.Knights[from] = Knight{Owner: p, Level: 1, Active: true}
	// A far, disconnected, empty land vertex.
	var far board.Vertex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if v == from || !emptyKnightVertex(s, v) {
				continue
			}
			reach := false
			for _, e := range v.Edges() {
				if owner, ok := s.Roads[e]; ok && owner == p {
					reach = true
				}
			}
			if !reach {
				far, found = v, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		fixtureGone(t, "no disconnected vertex")
	}
	reject(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": far})}, engine.ErrBadPlacement)
}

// --- Chase robber (entirely uncovered) ---------------------------------------

func TestChaseRobber(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Attacks = 1 // robber is only in play after the first barbarian attack

	// Find an active knight adjacent to the robber's hex.
	var spot board.Vertex
	found := false
	for _, v := range s.Board.Robber.Vertices() {
		if emptyKnightVertex(s, v) {
			spot, found = v, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no empty vertex adjacent to the robber")
	}
	x.Knights[spot] = Knight{Owner: p, Level: 1, Active: true}

	// A legal destination hex: any land hex that is not the robber's current hex.
	var dest board.Hex
	gotDest := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Land(h) && h != s.Board.Robber {
			dest, gotDest = h, true
			break
		}
	}
	if !gotDest {
		fixtureGone(t, "no destination hex")
	}

	// Move with no victim: drain the neighbours' hands so there is nothing to
	// steal.
	for _, v := range dest.Vertices() {
		if b, ok := s.Buildings[v]; ok && b.Owner != p {
			s.Players[b.Owner].Hand = engine.Hand{}
		}
	}
	events := step(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
		Data: mustJSON(t, map[string]any{"v": spot, "hex": dest})})
	if x.Knights[spot].Active {
		t.Error("knight should deactivate after chasing the robber")
	}
	sawRobber := false
	for _, e := range events {
		if e.Type == engine.EvRobberMoved {
			sawRobber = true
		}
	}
	if !sawRobber {
		t.Errorf("no robber-moved event: %+v", events)
	}
	if s.Board.Robber != dest {
		t.Errorf("robber at %v, want %v", s.Board.Robber, dest)
	}
}

func TestChaseRobberErrors(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	// A knight not adjacent to the robber.
	var spot board.Vertex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if h == s.Board.Robber {
			continue
		}
		for _, v := range h.Vertices() {
			if !emptyKnightVertex(s, v) {
				continue
			}
			adj := false
			for _, vh := range v.Hexes() {
				if vh == s.Board.Robber {
					adj = true
				}
			}
			if !adj {
				spot, found = v, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		fixtureGone(t, "no non-adjacent vertex")
	}

	dest := s.Board.Robber
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Land(h) && h != s.Board.Robber {
			dest = h
			break
		}
	}

	// Knight not active.
	x.Knights[spot] = Knight{Owner: p, Level: 1}
	reject(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
		Data: mustJSON(t, map[string]any{"v": spot, "hex": dest})}, ErrKnightState)

	// Active but not adjacent to the robber.
	x.Knights[spot] = Knight{Owner: p, Level: 1, Active: true}
	reject(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
		Data: mustJSON(t, map[string]any{"v": spot, "hex": dest})}, ErrKnightState)
}

func TestChaseRobberBadDestination(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Attacks = 1 // robber is only in play after the first barbarian attack
	var spot board.Vertex
	found := false
	for _, v := range s.Board.Robber.Vertices() {
		if emptyKnightVertex(s, v) {
			spot, found = v, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no adjacent vertex")
	}
	x.Knights[spot] = Knight{Owner: p, Level: 1, Active: true}
	// Moving onto the robber's own hex is illegal.
	reject(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
		Data: mustJSON(t, map[string]any{"v": spot, "hex": s.Board.Robber})}, engine.ErrBadPlacement)
}

// TestChaseRobberSteals exercises the steal branch with a known victim.
func TestChaseRobberSteals(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Attacks = 1 // robber is only in play after the first barbarian attack

	// Set up a land hex with a q-owned building adjacent, plus an empty
	// robber-adjacent vertex for our knight.
	var dest board.Hex
	var qVertex board.Vertex
	gotDest := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) || h == s.Board.Robber {
			continue
		}
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			dest, qVertex, gotDest = h, v, true
			break
		}
		if gotDest {
			break
		}
	}
	if !gotDest {
		fixtureGone(t, "no destination hex")
	}
	s.Buildings[qVertex] = engine.Building{Owner: q}
	s.Players[q].Hand = engine.Hand{board.Wood: 1}
	// Clear the thief's hand so the steal yields exactly 1 wood.
	s.Players[p].Hand = engine.Hand{}

	var spot board.Vertex
	found := false
	for _, v := range s.Board.Robber.Vertices() {
		if emptyKnightVertex(s, v) {
			spot, found = v, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no robber-adjacent vertex")
	}
	x.Knights[spot] = Knight{Owner: p, Level: 1, Active: true}

	events := step(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
		Data: mustJSON(t, map[string]any{"v": spot, "hex": dest, "victim": q})})
	stole := false
	for _, e := range events {
		if e.Type == engine.EvCardStolen {
			stole = true
		}
	}
	if !stole {
		t.Errorf("expected a steal: %+v", events)
	}
	if s.Players[q].Hand[board.Wood] != 0 || s.Players[p].Hand[board.Wood] != 1 {
		t.Errorf("steal not applied: p=%v q=%v", s.Players[p].Hand, s.Players[q].Hand)
	}
}

// emptyHexVertex finds a land hex (not the robber's) with an unbuilt vertex.
func emptyHexVertex(t *testing.T, s *engine.State) (board.Hex, board.Vertex) {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) || h == s.Board.Robber {
			continue
		}
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; !taken {
				return h, v
			}
		}
	}
	fixtureGone(t, "no empty hex/vertex")
	return board.Hex{}, board.Vertex{}
}

// The 7-roll robber steals from a victim's combined resource+commodity hand,
// so a victim holding only commodities can lose a commodity.
func TestRobberStealsCommodity(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	clearStartingCities(s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Attacks = 1 // robber active after the first barbarian attack
	s.RobberPending = true

	dest, qVertex := emptyHexVertex(t, s)
	s.Buildings[qVertex] = engine.Building{Owner: q}
	s.Players[q].Hand = engine.Hand{}                  // no resources
	x.Players[q].Commodities = CommodityHand{Cloth: 1} // commodities only

	events := step(t, s, engine.Command{Player: p, Type: engine.CmdMoveRobber,
		Data: mustJSON(t, map[string]any{"hex": dest, "victim": q})})

	stoleCom := false
	for _, e := range events {
		if e.Type == EvCommodityStolen {
			stoleCom = true
		}
	}
	if !stoleCom {
		t.Errorf("robber did not steal a commodity from a commodity-only victim: %+v", events)
	}
	if x.Players[q].Commodities[Cloth] != 0 {
		t.Errorf("victim commodity not removed: %v", x.Players[q].Commodities)
	}
}

// The knight-chase steal likewise draws from the combined pool.
func TestChaseRobberStealsCommodity(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Attacks = 1

	dest, qVertex := emptyHexVertex(t, s)
	s.Buildings[qVertex] = engine.Building{Owner: q}
	s.Players[q].Hand = engine.Hand{}
	x.Players[q].Commodities = CommodityHand{Coin: 1}

	var spot board.Vertex
	found := false
	for _, v := range s.Board.Robber.Vertices() {
		if emptyKnightVertex(s, v) {
			spot, found = v, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no robber-adjacent vertex")
	}
	x.Knights[spot] = Knight{Owner: p, Level: 1, Active: true}

	events := step(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
		Data: mustJSON(t, map[string]any{"v": spot, "hex": dest, "victim": q})})

	stoleCom := false
	for _, e := range events {
		if e.Type == EvCommodityStolen {
			stoleCom = true
		}
	}
	if !stoleCom {
		t.Errorf("chase did not steal a commodity from a commodity-only victim: %+v", events)
	}
	if x.Players[q].Commodities[Coin] != 0 {
		t.Errorf("victim commodity not removed: %v", x.Players[q].Commodities)
	}
}

// --- Build wall error branches -----------------------------------------------

func TestBuildWallErrors(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur

	// No city.
	reject(t, s, engine.Command{Player: p, Type: CmdBuildWall}, ErrNeedCity)

	makeCity(s, p)
	x := ext(s)

	// At wall cap.
	x.Players[p].Walls = 3
	reject(t, s, engine.Command{Player: p, Type: CmdBuildWall}, ErrMaxWalls)
	x.Players[p].Walls = 0

	// No resources.
	s.Players[p].Hand = engine.Hand{}
	reject(t, s, engine.Command{Player: p, Type: CmdBuildWall}, engine.ErrNoResources)
}

// --- Aqueduct pick error branches --------------------------------------------

func TestAqueductPickErrors(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	p := s.Cur
	x := ext(s)

	// Nothing owed.
	reject(t, s, engine.Command{Player: p, Type: CmdAqueductPick,
		Data: mustJSON(t, map[string]any{"res": board.Wood})}, ErrNotOwed)

	x.Aqueduct = []engine.PlayerID{p}

	// ResNone while the bank is non-empty is rejected.
	s.Bank[board.Wood] = 5
	reject(t, s, engine.Command{Player: p, Type: CmdAqueductPick,
		Data: mustJSON(t, map[string]any{"res": board.ResNone})}, engine.ErrBadCommand)

	// A resource the bank cannot cover is rejected.
	s.Bank = engine.Hand{}
	reject(t, s, engine.Command{Player: p, Type: CmdAqueductPick,
		Data: mustJSON(t, map[string]any{"res": board.Wood})}, engine.ErrBadCommand)

	// With an empty bank, ResNone clears the debt.
	step(t, s, engine.Command{Player: p, Type: CmdAqueductPick,
		Data: mustJSON(t, map[string]any{"res": board.ResNone})})
	if len(x.Aqueduct) != 0 {
		t.Errorf("aqueduct not cleared by ResNone: %v", x.Aqueduct)
	}
}

// --- Spy pick error branches -------------------------------------------------

func TestSpyPickErrors(t *testing.T) {
	s, _ := newGame(t, 9, nil)
	p := s.Cur
	x := ext(s)

	// Not the thief.
	reject(t, s, engine.Command{Player: p, Type: CmdSpyPick,
		Data: mustJSON(t, map[string]any{"card": CardBishop})}, ErrNotOwed)

	q := (p + 1) % engine.PlayerID(len(s.Players))
	x.SpyThief, x.SpyVictim = p, q
	x.Players[q].Progress = []ProgressCard{CardBishop}

	// Card the victim does not hold.
	reject(t, s, engine.Command{Player: p, Type: CmdSpyPick,
		Data: mustJSON(t, map[string]any{"card": CardWedding})}, ErrNoProgressCard)
}

// --- Trading House more error branches ---------------------------------------

func TestTradingHouseErrors(t *testing.T) {
	s, _ := newGame(t, 21, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Improve[Trade] = 3
	x.Players[p].Commodities = CommodityHand{Cloth: 2}

	// Bad commodity index.
	reject(t, s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": 9, "get_res": board.Wheat})}, engine.ErrBadCommand)

	// Neither output specified.
	reject(t, s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Cloth})}, engine.ErrBadCommand)

	// Both outputs specified.
	reject(t, s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Cloth, "get_res": board.Wheat, "get_com": Coin})},
		engine.ErrBadCommand)

	// Output resource the bank cannot cover.
	s.Bank = engine.Hand{}
	reject(t, s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Cloth, "get_res": board.Wheat})}, engine.ErrBadCommand)

	// Bad output commodity index.
	reject(t, s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Cloth, "get_com": 9})}, engine.ErrBadCommand)
}

// --- Harbor give error branches ----------------------------------------------

func TestHarborGiveErrors(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	p := s.Cur

	// Nothing owed.
	reject(t, s, engine.Command{Player: p, Type: CmdHarborGive,
		Data: mustJSON(t, map[string]any{"com": Cloth})}, ErrNotOwed)

	x := ext(s)
	x.HarborGive = map[engine.PlayerID]board.Resource{p: board.Wheat}
	x.HarborTaker = (p + 1) % engine.PlayerID(len(s.Players))

	// Giving a commodity you do not hold.
	x.Players[p].Commodities = CommodityHand{}
	reject(t, s, engine.Command{Player: p, Type: CmdHarborGive,
		Data: mustJSON(t, map[string]any{"com": Cloth})}, ErrBadGive)

	// Bad commodity index.
	reject(t, s, engine.Command{Player: p, Type: CmdHarborGive,
		Data: mustJSON(t, map[string]any{"com": 9})}, ErrBadGive)
}

// --- Improve city error branches ---------------------------------------------

func TestImproveCityErrors(t *testing.T) {
	s, _ := newGame(t, 4, nil)
	rolled(t, s)
	p := s.Cur
	makeCity(s, p)
	x := ext(s)

	// Bad track index.
	reject(t, s, engine.Command{Player: p, Type: CmdImproveCity,
		Data: mustJSON(t, map[string]any{"track": 9})}, engine.ErrBadCommand)

	// Max improvement.
	x.Players[p].Improve[Trade] = maxImprovement
	reject(t, s, engine.Command{Player: p, Type: CmdImproveCity,
		Data: mustJSON(t, map[string]any{"track": Trade})}, ErrMaxImprovement)
	x.Players[p].Improve[Trade] = 0

	// Insufficient commodities.
	x.Players[p].Commodities = CommodityHand{}
	reject(t, s, engine.Command{Player: p, Type: CmdImproveCity,
		Data: mustJSON(t, map[string]any{"track": Trade})}, ErrNoCommodities)
}

// --- Discard progress error branches -----------------------------------------

func TestDiscardProgressErrors(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	p := s.Cur
	x := ext(s)

	// Hand not over the limit.
	x.Players[p].Progress = []ProgressCard{CardSpy}
	reject(t, s, engine.Command{Player: p, Type: CmdDiscardProgress,
		Data: mustJSON(t, map[string]any{"card": CardSpy})}, ErrHandNotOver)

	// Over the limit, but a card not held.
	x.Players[p].Progress = []ProgressCard{CardSpy, CardBishop, CardWedding, CardMedicine, CardMining}
	reject(t, s, engine.Command{Player: p, Type: CmdDiscardProgress,
		Data: mustJSON(t, map[string]any{"card": CardCrane})}, ErrNoProgressCard)
}

// --- Give cards error branches -----------------------------------------------

func TestGiveCardsNotOwed(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	p := s.Cur
	reject(t, s, engine.Command{Player: p, Type: CmdGiveCards,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{}})}, ErrNotOwed)
}

// --- decidePlayProgress gating branches --------------------------------------

func TestPlayProgressGating(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardWarlord}

	// Before rolling, a non-Alchemist card requires a roll first.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardWarlord})}, engine.ErrMustRoll)

	rolled(t, s)

	// Not holding the card.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSmith})}, ErrNoProgressCard)

	// Alchemist after the roll is rejected.
	x.Players[p].Progress = []ProgressCard{CardAlchemist}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardAlchemist, "d1": 2, "d2": 3})}, ErrNotBeforeRoll)

	// Not your turn.
	q := (p + 1) % engine.PlayerID(len(s.Players))
	reject(t, s, engine.Command{Player: q, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardWarlord})}, engine.ErrNotYourTurn)
}

func TestAlchemistDiceValidation(t *testing.T) {
	s, _ := newGame(t, 9, nil)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardAlchemist}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardAlchemist, "d1": 0, "d2": 3})}, ErrAlchemistDice)
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardAlchemist, "d1": 3, "d2": 7})}, ErrAlchemistDice)
}

// --- Progress cards: Bishop --------------------------------------------------

func TestBishopMovesRobberAndSteals(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Attacks = 1 // robber is only in play after the first barbarian attack
	x.Players[p].Progress = []ProgressCard{CardBishop}

	// Find a land hex (not the robber) with an empty vertex; plant a q building and
	// give q a hand, so Bishop steals from a neighbor.
	var dest board.Hex
	var qVertex board.Vertex
	gotDest := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) || h == s.Board.Robber {
			continue
		}
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			dest, qVertex, gotDest = h, v, true
			break
		}
		if gotDest {
			break
		}
	}
	if !gotDest {
		fixtureGone(t, "no dest hex")
	}
	s.Buildings[qVertex] = engine.Building{Owner: q}
	s.Players[q].Hand = engine.Hand{board.Brick: 2}

	events := step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardBishop, "hex": dest})})
	if s.Board.Robber != dest {
		t.Errorf("robber at %v, want %v", s.Board.Robber, dest)
	}
	stole := false
	for _, e := range events {
		if e.Type == engine.EvCardStolen || e.Type == EvCommodityStolen {
			stole = true
		}
	}
	if !stole {
		t.Errorf("Bishop should steal from the neighbor: %+v", events)
	}
}

func TestBishopBadPlacement(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Attacks = 1 // robber is only in play after the first barbarian attack
	x.Players[p].Progress = []ProgressCard{CardBishop}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardBishop, "hex": s.Board.Robber})}, engine.ErrBadPlacement)
}

func TestBishopStealsCommodity(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Attacks = 1 // robber is only in play after the first barbarian attack
	x.Players[p].Progress = []ProgressCard{CardBishop}

	var dest board.Hex
	var qVertex board.Vertex
	gotDest := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) || h == s.Board.Robber {
			continue
		}
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			dest, qVertex, gotDest = h, v, true
			break
		}
		if gotDest {
			break
		}
	}
	if !gotDest {
		fixtureGone(t, "no dest hex")
	}
	s.Buildings[qVertex] = engine.Building{Owner: q}
	s.Players[q].Hand = engine.Hand{}                  // only commodities
	x.Players[q].Commodities = CommodityHand{Cloth: 3} // must steal a commodity

	events := step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardBishop, "hex": dest})})
	sawCom := false
	for _, e := range events {
		if e.Type == EvCommodityStolen {
			sawCom = true
		}
	}
	if !sawCom {
		t.Errorf("Bishop should steal a commodity when the neighbor has only commodities: %+v", events)
	}
	if x.Players[p].Commodities[Cloth] != 1 || x.Players[q].Commodities[Cloth] != 2 {
		t.Errorf("commodity steal not applied: p=%v q=%v", x.Players[p].Commodities, x.Players[q].Commodities)
	}
}

// --- Progress cards: Merchant ------------------------------------------------

func TestMerchantPlacesAndScores(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMerchant}

	// Find a land hex p has a building on.
	var hex board.Hex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) {
			continue
		}
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p {
				hex, found = h, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		fixtureGone(t, "no p-owned hex")
	}
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMerchant, "hex": hex})})
	if x.MerchantOwner != p || x.Players[p].MerchantVP != 1 {
		t.Errorf("merchant not assigned to p: owner=%d vp=%d", x.MerchantOwner, x.Players[p].MerchantVP)
	}
	if x.Merchant == nil || *x.Merchant != hex {
		t.Errorf("merchant hex wrong: %v", x.Merchant)
	}
}

func TestMerchantBadPlacement(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMerchant}
	// A land hex with no p building.
	var hex board.Hex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) {
			continue
		}
		owns := false
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p {
				owns = true
			}
		}
		if !owns {
			hex, found = h, true
			break
		}
	}
	if found {
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardMerchant, "hex": hex})}, engine.ErrBadPlacement)
	}
}

// --- Progress cards: TradeMonopoly -------------------------------------------

func TestTradeMonopoly(t *testing.T) {
	s, _ := newGame(t, 10, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardTradeMonopoly}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x.Players[q].Commodities = CommodityHand{Cloth: 3}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardTradeMonopoly, "com": Cloth})})
	if x.Players[p].Commodities[Cloth] != 1 || x.Players[q].Commodities[Cloth] != 2 {
		t.Errorf("trade monopoly took wrong amount: p=%v q=%v", x.Players[p].Commodities, x.Players[q].Commodities)
	}

	// Bad commodity index.
	x.Players[p].Progress = []ProgressCard{CardTradeMonopoly}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardTradeMonopoly, "com": 9})}, engine.ErrBadCommand)
}

// --- Progress cards: Deserter (no knight / removal-only) ----------------------

func TestDeserterErrors(t *testing.T) {
	s, _ := newGame(t, 32, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardDeserter}
	q := (p + 1) % engine.PlayerID(len(s.Players))

	// Targeting self.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": p})}, engine.ErrBadVictim)

	// Victim with no knight.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": q})}, engine.ErrBadVictim)
}

// When the taker already fields both pieces at the surrendered knight's tier,
// they place a basic knight instead: the victim's knight is removed and a
// level-1 replacement is owed. Forfeit happens only when no tier has a free
// piece (TestDeserterForfeitWhenNoPieceFree).
func TestDeserterFallsBackToBasicWhenTierFull(t *testing.T) {
	s, _ := newGame(t, 32, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	q := (p + 1) % engine.PlayerID(len(s.Players))
	victimSpot := board.Vertex{Q: 2, R: -1, Side: board.N}
	x.Knights[victimSpot] = Knight{Owner: q, Level: 2}
	// p already fields the two level-2 pieces, but its basic tier is free.
	for _, v := range nFreeVertices(s, x, victimSpot, 2) {
		x.Knights[v] = Knight{Owner: p, Level: 2}
	}
	x.Players[p].Progress = []ProgressCard{CardDeserter}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": q})})
	step(t, s, engine.Command{Player: q, Type: CmdDeserterSurrender, Data: mustJSON(t, map[string]any{"v": victimSpot})})

	if _, ok := x.Knights[victimSpot]; ok {
		t.Error("victim knight should be removed")
	}
	if x.DeserterLevel != 1 || x.DeserterTaker != p {
		t.Fatalf("strong tier full -> taker owes a basic (level-1) replacement: level=%d taker=%d",
			x.DeserterLevel, x.DeserterTaker)
	}
	spot := knightSpotFor(t, s, p)
	step(t, s, engine.Command{Player: p, Type: CmdDeserterPlace, Data: mustJSON(t, map[string]any{"v": spot})})
	if k := x.Knights[spot]; k.Owner != p || k.Level != 1 {
		t.Errorf("replacement = %+v, want owner=%d level=1 (basic fallback)", k, p)
	}
}

// With no piece free even at the basic tier, the replacement is forfeited: the
// victim still loses a knight and the taker places nothing.
func TestDeserterForfeitWhenNoPieceFree(t *testing.T) {
	s, _ := newGame(t, 32, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	q := (p + 1) % engine.PlayerID(len(s.Players))
	victimSpot := board.Vertex{Q: 2, R: -1, Side: board.N}
	x.Knights[victimSpot] = Knight{Owner: q, Level: 1}
	// p already fields both basic knights, so neither an equal-strength nor a
	// basic-fallback replacement can be placed.
	for _, v := range nFreeVertices(s, x, victimSpot, 2) {
		x.Knights[v] = Knight{Owner: p, Level: 1}
	}
	x.Players[p].Progress = []ProgressCard{CardDeserter}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": q})})
	step(t, s, engine.Command{Player: q, Type: CmdDeserterSurrender, Data: mustJSON(t, map[string]any{"v": victimSpot})})

	if _, ok := x.Knights[victimSpot]; ok {
		t.Error("victim knight should be removed")
	}
	if x.DeserterLevel != 0 || x.DeserterTaker != engine.NoPlayer || x.DeserterVictim != engine.NoPlayer {
		t.Errorf("no piece free -> no replacement owed and pending cleared: level=%d taker=%d victim=%d",
			x.DeserterLevel, x.DeserterTaker, x.DeserterVictim)
	}
}

// The placed replacement inherits the active/inactive status of the
// surrendered knight.
func TestDeserterPreservesActiveStatus(t *testing.T) {
	s, _ := newGame(t, 32, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	q := (p + 1) % engine.PlayerID(len(s.Players))
	victimSpot := board.Vertex{Q: 2, R: -1, Side: board.N}
	// q surrenders an active basic knight.
	x.Knights[victimSpot] = Knight{Owner: q, Level: 1, Active: true}
	x.Players[p].Progress = []ProgressCard{CardDeserter}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": q})})
	step(t, s, engine.Command{Player: q, Type: CmdDeserterSurrender, Data: mustJSON(t, map[string]any{"v": victimSpot})})
	if x.DeserterLevel != 1 || !x.DeserterActive {
		t.Fatalf("taker should owe an active level-1 replacement: level=%d active=%v", x.DeserterLevel, x.DeserterActive)
	}

	spot := knightSpotFor(t, s, p)
	step(t, s, engine.Command{Player: p, Type: CmdDeserterPlace, Data: mustJSON(t, map[string]any{"v": spot})})
	k, ok := x.Knights[spot]
	if !ok || k.Owner != p || k.Level != 1 || !k.Active {
		t.Errorf("replacement = %+v, want owner=%d level=1 ACTIVE", k, p)
	}
	// Active, but not active when this Action phase began, so any action is
	// refused on the knight's state before the destination is considered.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": spot, "to": victimSpot})}); !errors.Is(err, ErrKnightState) {
		t.Errorf("moving the replacement the turn it arrived: err = %v, want ErrKnightState", err)
	}
	if !k.FreshlyActivated {
		t.Error("the active replacement should be locked until the taker's next turn")
	}
}

// TestDeserterAutoResolves: when neither party acts, auto-pass completes both
// the surrender and the placement (the bot sim never takes this path, since
// bots answer interactive cards themselves).
func TestDeserterAutoResolves(t *testing.T) {
	s, _ := newGame(t, 32, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	q := (p + 1) % engine.PlayerID(len(s.Players))
	victimSpot := board.Vertex{Q: 2, R: -1, Side: board.N}
	x.Knights[victimSpot] = Knight{Owner: q, Level: 2}
	x.Players[p].Progress = []ProgressCard{CardDeserter}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": q})})

	for guard := 0; x.DeserterVictim != engine.NoPlayer || x.DeserterLevel > 0; guard++ {
		if guard > 4 {
			t.Fatal("auto-pass did not resolve the deserter interaction")
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("auto-pass produced no command while deserter pending")
		}
		step(t, s, cmd)
	}

	if _, ok := x.Knights[victimSpot]; ok {
		t.Error("auto-surrender should have removed the victim's knight")
	}
	if x.DeserterTaker != engine.NoPlayer {
		t.Errorf("interaction not cleared: taker=%d", x.DeserterTaker)
	}
	got := 0
	for _, k := range x.Knights {
		if k.Owner == p && k.Level == 2 {
			got++
		}
	}
	if got != 1 {
		t.Errorf("auto-placement should give the taker one level-2 replacement, got %d", got)
	}
}

// --- Progress cards: Diplomat ------------------------------------------------

func TestDiplomatRemovesOpenRoad(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardDiplomat}

	// Missing edge.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDiplomat})}, engine.ErrBadCommand)

	// Find an open road owned by an opponent (or any open road).
	var target board.Edge
	found := false
	for e := range s.Roads {
		owner := s.Roads[e]
		if openRoad(s, e, owner) {
			target, found = e, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no open road")
	}
	owner := s.Roads[target]
	if owner == p {
		// re-run with a fresh card if our own road; still valid (relocation optional)
		x.Players[p].Progress = []ProgressCard{CardDiplomat}
	}
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDiplomat, "e": map[string]any{"a": target.A, "b": target.B}})})
	if _, ok := s.Roads[target]; ok {
		t.Errorf("diplomat did not remove the road at %v", target)
	}
}

// Diplomat's free rebuild of your own removed road must connect to your
// network (excluding the road just freed).
func TestDiplomatRebuildMustConnect(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardDiplomat}

	var own board.Edge
	foundOwn := false
	for e, o := range s.Roads {
		if o == p && openRoad(s, e, p) {
			own, foundOwn = e, true
			break
		}
	}
	if !foundOwn {
		fixtureGone(t, "no own open road")
	}

	touchesP := func(e board.Edge) bool {
		for _, v := range []board.Vertex{e.A, e.B} {
			if b, ok := s.Buildings[v]; ok && b.Owner == p {
				return true
			}
			for _, ve := range v.Edges() {
				if ve == e || ve == own {
					continue
				}
				if o, ok := s.Roads[ve]; ok && o == p {
					return true
				}
			}
		}
		return false
	}
	var dest board.Edge
	foundDest := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			for _, e := range v.Edges() {
				if _, taken := s.Roads[e]; taken || !e.Valid() || !s.Board.LandEdge(e) {
					continue
				}
				if !touchesP(e) {
					dest, foundDest = e, true
					break
				}
			}
			if foundDest {
				break
			}
		}
		if foundDest {
			break
		}
	}
	if !foundDest {
		fixtureGone(t, "no disconnected land edge")
	}

	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, map[string]any{
		"card": CardDiplomat,
		"e":    map[string]any{"a": own.A, "b": own.B},
		"to":   map[string]any{"a": dest.A, "b": dest.B},
	})}, engine.ErrBadPlacement)
}

func TestDiplomatNotOpenRoad(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardDiplomat}

	// A non-existent road edge.
	var empty board.Edge
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if _, ok := s.Roads[e]; !ok && s.Board.LandEdge(e) {
				empty, found = e, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		fixtureGone(t, "no empty edge")
	}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDiplomat, "e": map[string]any{"a": empty.A, "b": empty.B}})},
		ErrNoOpenRoad)
}

// A road is not open if the owner's own knight sits at its dangling end; the
// knight anchors it like a settlement or city.
func TestDiplomatOpenRoadBlockedByOwnKnight(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)

	for e := range s.Roads {
		owner := s.Roads[e]
		if !openRoad(s, e, owner) {
			continue
		}
		// Collect the endpoints that make this road open; they must be empty so a
		// knight can be parked there.
		var openEnds []board.Vertex
		usable := true
		for _, v := range []board.Vertex{e.A, e.B} {
			if b, ok := s.Buildings[v]; ok && b.Owner == owner {
				continue // already attached at this end
			}
			isOpen := true
			for _, ve := range v.Edges() {
				if ve == e {
					continue
				}
				if o, ok := s.Roads[ve]; ok && o == owner {
					isOpen = false
				}
			}
			if !isOpen {
				continue
			}
			if _, occupied := s.Buildings[v]; occupied {
				usable = false // an opponent building; can't place our knight here
				break
			}
			openEnds = append(openEnds, v)
		}
		if !usable || len(openEnds) == 0 {
			continue
		}
		for _, v := range openEnds {
			x.Knights[v] = Knight{Owner: owner, Level: 1}
		}
		if openRoad(s, e, owner) {
			t.Errorf("road %v should be closed once the owner's knight sits at its open end", e)
		}
		return
	}
	fixtureGone(t, "no suitable open road on this seed")
}

// --- Progress cards: Intrigue errors -----------------------------------------

func TestIntrigueErrors(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardIntrigue}

	// Missing vertex.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardIntrigue})}, engine.ErrBadCommand)

	// A vertex with no enemy knight.
	spot, ok := roadAndEmpty(t, s, p)
	if !ok {
		fixtureGone(t, "no spot")
	}
	x.Players[p].Progress = []ProgressCard{CardIntrigue}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardIntrigue, "v": spot})}, ErrNoKnight)

	// An enemy knight not on p's road network.
	q := (p + 1) % engine.PlayerID(len(s.Players))
	var offRoad board.Vertex
	gotOff := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !emptyKnightVertex(s, v) {
				continue
			}
			onMine := false
			for _, e := range v.Edges() {
				if owner, ok := s.Roads[e]; ok && owner == p {
					onMine = true
				}
			}
			if !onMine {
				offRoad, gotOff = v, true
				break
			}
		}
		if gotOff {
			break
		}
	}
	if !gotOff {
		fixtureGone(t, "no off-road vertex")
	}
	x.Knights[offRoad] = Knight{Owner: q, Level: 1}
	x.Players[p].Progress = []ProgressCard{CardIntrigue}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardIntrigue, "v": offRoad})}, engine.ErrBadPlacement)
}

// --- Progress cards: Saboteur ------------------------------------------------

func TestSaboteur(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardSaboteur}
	// Make q at-least-as-rich in VP, with a sizeable hand to halve.
	makeCity(s, q)
	s.Players[q].Hand = engine.Hand{board.Wood: 5}

	events := step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSaboteur})})
	sawReq := false
	for _, e := range events {
		if e.Type == engine.EvDiscardsReq {
			sawReq = true
			d := engine.DecodeEvent[engine.DiscardsReqData](e)
			if len(d.Required) == 0 {
				t.Error("saboteur required nobody")
			}
		}
	}
	if !sawReq {
		t.Errorf("saboteur should issue a discard requirement: %+v", events)
	}
}

func TestSaboteurNoTargets(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardSaboteur}
	// Make p richest so nobody has >= VP; drain everyone else's hands.
	makeCity(s, p)
	makeCity(s, p)
	for q := range s.Players {
		if engine.PlayerID(q) != p {
			s.Players[q].Hand = engine.Hand{}
			x.Players[q].Commodities = CommodityHand{}
		}
	}
	// Nobody to hit: refused, and the card stays in the hand.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSaboteur})}, ErrCardNoEffect)
}

// --- Progress cards: Spy errors ----------------------------------------------

func TestSpyErrors(t *testing.T) {
	s, _ := newGame(t, 9, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardSpy}

	// Self target.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSpy, "victim": p})}, engine.ErrBadVictim)

	// Victim with an empty progress hand.
	x.Players[q].Progress = nil
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSpy, "victim": q})}, engine.ErrBadVictim)
}

// --- Progress cards: Engineer (free wall) ------------------------------------

func TestEngineerFreeWall(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardEngineer}

	// No city.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardEngineer})}, ErrNeedCity)

	makeCity(s, p)
	s.Players[p].Hand = engine.Hand{} // engineer is free
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardEngineer})})
	if x.Players[p].Walls != 1 {
		t.Errorf("engineer did not build a free wall: walls=%d", x.Players[p].Walls)
	}

	// At wall cap.
	x.Players[p].Progress = []ProgressCard{CardEngineer}
	x.Players[p].Walls = 3
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardEngineer})}, ErrMaxWalls)
}

// --- Progress cards: Inventor ------------------------------------------------

func TestInventorSwapsTokens(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardInventor}

	// Find two distinct land hexes with swappable numbers (not 2/6/8/12, not 0),
	// in stable board order for determinism.
	var a, b board.Hex
	got := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tile, ok := s.Board.Tiles[h]
		if !ok {
			continue
		}
		n := tile.Number
		if n == 0 || n == 2 || n == 6 || n == 8 || n == 12 {
			continue
		}
		if got == 0 {
			a = h
			got = 1
		} else if h != a {
			b = h
			got = 2
			break
		}
	}
	if got < 2 {
		fixtureGone(t, "not enough swappable tiles")
	}
	na := s.Board.Tiles[a].Number
	nb := s.Board.Tiles[b].Number

	// Play Inventor through the full Decide→Apply pipeline, as the actor's commit
	// does. Guards against finalize() cloning a board that shares the Tiles map,
	// which made the speculative apply undo the real one.
	events := step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardInventor, "a": a, "b": b})})
	sawSwap := false
	for _, e := range events {
		if e.Type == EvTokensSwapped {
			sawSwap = true
		}
	}
	if !sawSwap {
		t.Fatalf("inventor did not emit a swap: %+v", events)
	}
	if s.Board.Tiles[a].Number != nb || s.Board.Tiles[b].Number != na {
		t.Errorf("tokens not swapped through Decide/Apply: a=%d b=%d, want %d/%d",
			s.Board.Tiles[a].Number, s.Board.Tiles[b].Number, nb, na)
	}
}

// The swap event carries the two pre-swap numbers for the event log only; the
// fold derives the swap from s.Board.Tiles. So a log without the fields, and
// one with wrong numbers, both fold to the same board as a fresh one.
func TestInventorSwapNumbersAreDisplayOnly(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardInventor}

	var a, b board.Hex
	got := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tile, ok := s.Board.Tiles[h]
		if !ok {
			continue
		}
		n := tile.Number
		if n == 0 || n == 2 || n == 6 || n == 8 || n == 12 {
			continue
		}
		if got == 0 {
			a, got = h, 1
		} else if h != a {
			b, got = h, 2
			break
		}
	}
	if got < 2 {
		fixtureGone(t, "not enough swappable tiles")
	}
	na, nb := s.Board.Tiles[a].Number, s.Board.Tiles[b].Number

	events := step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardInventor, "a": a, "b": b})})
	var swap engine.Event
	for _, e := range events {
		if e.Type == EvTokensSwapped {
			swap = e
		}
	}
	if swap.Type != EvTokensSwapped {
		t.Fatalf("inventor did not emit a swap: %+v", events)
	}
	if d := engine.DecodeEvent[tokensSwappedData](swap); d.AN != na || d.BN != nb {
		t.Errorf("payload numbers = %d/%d, want the PRE-swap %d/%d", d.AN, d.BN, na, nb)
	}
	want := s.Board.Tiles // the board the live apply produced

	// Replay both shapes onto a fresh fold of the same game. Building the event
	// from raw JSON with Payload nil matches an event loaded from the store.
	for _, c := range []struct {
		name string
		data map[string]any
	}{
		{"an old log with no numbers at all", map[string]any{"a": a, "b": b}},
		{"a log whose numbers are wrong", map[string]any{"a": a, "b": b, "an": 99, "bn": 99}},
	} {
		t.Run(c.name, func(t *testing.T) {
			s2, _ := newGame(t, 5, nil)
			rolled(t, s2)
			e := engine.Event{Seq: s2.NextSeq, Type: EvTokensSwapped, Data: mustJSON(t, c.data)}
			if err := engine.Apply(s2, e); err != nil {
				t.Fatalf("Apply: %v", err)
			}
			if s2.Board.Tiles[a].Number != want[a].Number || s2.Board.Tiles[b].Number != want[b].Number {
				t.Errorf("replayed to a=%d b=%d, want a=%d b=%d",
					s2.Board.Tiles[a].Number, s2.Board.Tiles[b].Number,
					want[a].Number, want[b].Number)
			}
		})
	}
}

func TestInventorErrors(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardInventor}

	// Missing hexes.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardInventor})}, engine.ErrBadCommand)

	// A forbidden 6/8/2/12 number is rejected.
	var forbidden, ok2 board.Hex
	var gotF, gotO bool
	for h, tile := range s.Board.Tiles {
		switch tile.Number {
		case 6, 8, 2, 12:
			if !gotF {
				forbidden, gotF = h, true
			}
		default:
			if tile.Number != 0 && !gotO {
				ok2, gotO = h, true
			}
		}
	}
	if gotF && gotO {
		x.Players[p].Progress = []ProgressCard{CardInventor}
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardInventor, "a": forbidden, "b": ok2})}, engine.ErrBadPlacement)
	}
}

// --- Progress cards: Irrigation / Mining -------------------------------------

func TestIrrigationHarvest(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	// Find a wheat hex and plant a p building adjacent to it.
	var wheatHex board.Hex
	found := false
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Wheat {
			wheatHex, found = h, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no wheat hex")
	}
	var v board.Vertex
	planted := false
	for _, vv := range wheatHex.Vertices() {
		if _, taken := s.Buildings[vv]; !taken {
			v, planted = vv, true
			break
		}
	}
	if !planted {
		fixtureGone(t, "no empty vertex on wheat hex")
	}
	s.Buildings[v] = engine.Building{Owner: p}
	s.Bank[board.Wheat] = 20
	x.Players[p].Progress = []ProgressCard{CardIrrigation}

	before := s.Players[p].Hand[board.Wheat]
	bankBefore := s.Bank[board.Wheat]
	events := step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardIrrigation})})
	var harvested int
	for _, e := range events {
		if e.Type == EvHarvest {
			harvested = engine.DecodeEvent[harvestData](e).Count
		}
	}
	if harvested < 2 {
		t.Fatalf("irrigation should harvest at least 2 (one wheat hex), got %d", harvested)
	}
	if s.Players[p].Hand[board.Wheat] != before+harvested {
		t.Errorf("hand did not gain the harvest: got +%d, want +%d", s.Players[p].Hand[board.Wheat]-before, harvested)
	}
	if s.Bank[board.Wheat] != bankBefore-harvested {
		t.Errorf("bank not drawn for harvest: got %d want %d", s.Bank[board.Wheat], bankBefore-harvested)
	}
}

func TestMiningNoEligibleHexHarvestsNothing(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	// Remove all p buildings so Mining would harvest nothing: refused.
	for v, b := range s.Buildings {
		if b.Owner == p {
			delete(s.Buildings, v)
		}
	}
	x.Players[p].Progress = []ProgressCard{CardMining}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMining})}, ErrCardNoEffect)
}

// --- Progress cards: Medicine ------------------------------------------------

func TestMedicineCheapCity(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMedicine}

	// A p-owned settlement (not a city).
	var v board.Vertex
	found := false
	for vv, b := range s.Buildings {
		if b.Owner == p && !b.City {
			v, found = vv, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no p settlement")
	}
	s.Players[p].Hand = costMedicineCity
	if s.Players[p].CitiesLeft == 0 {
		s.Players[p].CitiesLeft = 1
	}
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMedicine, "v": v})})
	if !s.Buildings[v].City {
		t.Errorf("medicine did not upgrade to a city: %+v", s.Buildings[v])
	}
}

func TestMedicineErrors(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMedicine}

	// Missing vertex.
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMedicine})}, engine.ErrBadCommand)

	// A vertex that is not p's settlement (a city).
	makeCity(s, p)
	var city board.Vertex
	for vv, b := range s.Buildings {
		if b.Owner == p && b.City {
			city = vv
			break
		}
	}
	x.Players[p].Progress = []ProgressCard{CardMedicine}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMedicine, "v": city})}, engine.ErrBadPlacement)
}

func TestMedicineNoResources(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMedicine}
	var v board.Vertex
	found := false
	for vv, b := range s.Buildings {
		if b.Owner == p && !b.City {
			v, found = vv, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no p settlement")
	}
	if s.Players[p].CitiesLeft == 0 {
		s.Players[p].CitiesLeft = 1
	}
	s.Players[p].Hand = engine.Hand{}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMedicine, "v": v})}, engine.ErrNoResources)
}

// A laid-on-side city pins the next upgrade; Medicine must refuse to upgrade
// any other settlement first.
func TestMedicineHonorsLaidCityPin(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	var settle, cityV board.Vertex
	var gotS, gotC bool
	for vv, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		if b.City && !gotC {
			cityV, gotC = vv, true
		} else if !b.City && !gotS {
			settle, gotS = vv, true
		}
	}
	if !gotS || !gotC {
		fixtureGone(t, "need a p settlement and a p city")
	}
	// Lay the city on its side: a non-city building pinned as the must-upgrade.
	s.Buildings[cityV] = engine.Building{Owner: p, City: false}
	x.Players[p].LaidCityActive = true
	x.Players[p].LaidCity = cityV

	s.Players[p].Hand = costMedicineCity
	if s.Players[p].CitiesLeft == 0 {
		s.Players[p].CitiesLeft = 1
	}

	// Medicine on the other settlement is refused while the pin is active.
	x.Players[p].Progress = []ProgressCard{CardMedicine}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMedicine, "v": settle})}, engine.ErrBadPlacement)

	// Medicine on the pinned (laid-on-side) vertex is allowed and clears the pin.
	x.Players[p].Progress = []ProgressCard{CardMedicine}
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMedicine, "v": cityV})})
	if !s.Buildings[cityV].City {
		t.Errorf("medicine did not upgrade the pinned city: %+v", s.Buildings[cityV])
	}
}

// --- Progress cards: RoadBuilding --------------------------------------------

func TestRoadBuildingGrantsFreeRoads(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardRoadBuilding}
	if s.Players[p].RoadsLeft == 0 {
		s.Players[p].RoadsLeft = 2
	}
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardRoadBuilding})})
	if s.FreeRoads == 0 {
		t.Errorf("road building did not grant free roads: %d", s.FreeRoads)
	}
}

func TestRoadBuildingNoPieces(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardRoadBuilding}
	s.Players[p].RoadsLeft = 0
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardRoadBuilding})}, engine.ErrNoPieces)
}

// --- Progress cards: Smith ---------------------------------------------------

func TestSmithPromotesTwoKnights(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardSmith}

	// Two level-1 knights of p on the board.
	spots := []board.Vertex{}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if emptyKnightVertex(s, v) {
				spots = append(spots, v)
				if len(spots) == 2 {
					break
				}
			}
		}
		if len(spots) == 2 {
			break
		}
	}
	if len(spots) < 2 {
		fixtureGone(t, "not enough empty vertices")
	}
	x.Knights[spots[0]] = Knight{Owner: p, Level: 1}
	x.Knights[spots[1]] = Knight{Owner: p, Level: 1}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSmith})})
	if x.Knights[spots[0]].Level != 2 || x.Knights[spots[1]].Level != 2 {
		t.Errorf("smith should promote two knights: %d %d", x.Knights[spots[0]].Level, x.Knights[spots[1]].Level)
	}
}

func TestSmithNoKnight(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	// Remove all knights of p.
	for v, k := range x.Knights {
		if k.Owner == p {
			delete(x.Knights, v)
		}
	}
	x.Players[p].Progress = []ProgressCard{CardSmith}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSmith})}, ErrCardNoEffect)
}

// --- Progress cards: Crane errors --------------------------------------------

func TestCraneMissingTrack(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	makeCity(s, p)
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCrane}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCrane})}, engine.ErrBadCommand)
}

// --- harborAllocation auto path ----------------------------------------------

func TestCommercialHarborAutoAllocation(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	s.Players[p].Hand = engine.Hand{board.Wheat: 2}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x.Players[q].Commodities = CommodityHand{Cloth: 1}

	// No explicit gives -> auto-assign one commodity per opponent that holds one.
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor})})
	if _, ok := x.HarborGive[q]; !ok {
		t.Errorf("auto harbor allocation did not target q: %v", x.HarborGive)
	}
}

func TestCommercialHarborNoTargets(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	// No opponent holds commodities -> nothing to force: refused.
	for q := range s.Players {
		if engine.PlayerID(q) != p {
			x.Players[q].Commodities = CommodityHand{}
		}
	}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor})}, ErrCardNoEffect)
}

func TestCommercialHarborExplicitErrors(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	q := (p + 1) % engine.PlayerID(len(s.Players))

	// Targeting self.
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	x.Players[q].Commodities = CommodityHand{Cloth: 1}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor,
			"gives": []map[string]any{{"player": p, "res": board.Wheat}}})}, engine.ErrBadCommand)

	// Targeting an opponent with no commodities.
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	x.Players[q].Commodities = CommodityHand{}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor,
			"gives": []map[string]any{{"player": q, "res": board.Wheat}}})}, engine.ErrBadVictim)

	// Spending a resource you do not hold.
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	x.Players[q].Commodities = CommodityHand{Cloth: 1}
	s.Players[p].Hand = engine.Hand{}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor,
			"gives": []map[string]any{{"player": q, "res": board.Wheat}}})}, engine.ErrNoResources)
}

// --- ViewExt redaction --------------------------------------------------------

func TestViewExtRedaction(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	x.Players[0].Commodities = CommodityHand{Cloth: 2, Coin: 1}
	x.Players[0].Progress = []ProgressCard{CardWarlord, CardBishop}
	x.Players[0].DefenderVP = 1
	x.Players[0].MerchantVP = 1
	x.Players[0].Walls = 2
	x.Knights[board.Vertex{Q: 0, R: 0, Side: board.N}] = Knight{Owner: 0, Level: 2, Active: true}

	// Owner sees their own commodities and progress hand.
	own := x.ViewExt(0).(*ExtView)
	if own.Players[0].Commodities == nil || own.Players[0].Commodities.Count() != 3 {
		t.Errorf("owner should see own commodities: %+v", own.Players[0].Commodities)
	}
	if len(own.Players[0].Progress) != 2 {
		t.Errorf("owner should see own progress hand: %v", own.Players[0].Progress)
	}
	if own.Players[0].CommodityCount != 3 || own.Players[0].ProgressCount != 2 {
		t.Errorf("public counts wrong: %d/%d", own.Players[0].CommodityCount, own.Players[0].ProgressCount)
	}

	// Another viewer sees only counts, not the hands.
	other := x.ViewExt(1).(*ExtView)
	if other.Players[0].Commodities != nil {
		t.Error("non-owner should not see commodity detail")
	}
	if len(other.Players[0].Progress) != 0 {
		t.Error("non-owner should not see progress detail")
	}
	if other.Players[0].CommodityCount != 3 || other.Players[0].ProgressCount != 2 {
		t.Errorf("non-owner counts wrong: %d/%d", other.Players[0].CommodityCount, other.Players[0].ProgressCount)
	}
	if len(other.Knights) != 1 || other.Knights[0].Level != 2 {
		t.Errorf("knight view wrong: %+v", other.Knights)
	}
}

func TestViewExtPendingMaps(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	x.PendingGive = map[engine.PlayerID]int{1: 2}
	x.HarborGive = map[engine.PlayerID]board.Resource{2: board.Wheat}
	x.Aqueduct = []engine.PlayerID{0}

	v := x.ViewExt(0).(*ExtView)
	if v.PendingGive[1] != 2 {
		t.Errorf("pending give not in view: %v", v.PendingGive)
	}
	if v.HarborGive[2] != board.Wheat {
		t.Errorf("harbor give not in view: %v", v.HarborGive)
	}
	if len(v.Aqueduct) != 1 || v.Aqueduct[0] != 0 {
		t.Errorf("aqueduct not in view: %v", v.Aqueduct)
	}
}

// --- CloneExt deep copy -------------------------------------------------------

func TestCloneExtDeepCopy(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	x.Players[0].Commodities = CommodityHand{Cloth: 1}
	x.Players[0].Progress = []ProgressCard{CardBishop}
	x.Knights[board.Vertex{Q: 1, R: 0, Side: board.N}] = Knight{Owner: 0, Level: 1}
	x.PendingGive = map[engine.PlayerID]int{1: 1}
	x.HarborGive = map[engine.PlayerID]board.Resource{2: board.Wheat}
	x.Walled = map[board.Vertex]bool{{Q: 0, R: 0, Side: board.N}: true}
	hex := board.Hex{Q: 0, R: 0}
	x.Merchant = &hex

	clone := x.CloneExt().(*Ext)
	// Mutate the clone; the original must be unaffected.
	clone.Players[0].Progress = append(clone.Players[0].Progress, CardWarlord)
	clone.Knights[board.Vertex{Q: 2, R: 0, Side: board.N}] = Knight{Owner: 1, Level: 1}
	clone.PendingGive[3] = 5
	clone.HarborGive[4] = board.Ore
	clone.Walled[board.Vertex{Q: 1, R: 1, Side: board.N}] = true
	*clone.Merchant = board.Hex{Q: 9, R: 9}
	clone.Decks[Trade][CardMerchant] = 99

	if len(x.Players[0].Progress) != 1 {
		t.Error("clone shares the progress slice")
	}
	if len(x.Knights) != 1 {
		t.Error("clone shares the knights map")
	}
	if _, ok := x.PendingGive[3]; ok {
		t.Error("clone shares pendingGive")
	}
	if _, ok := x.HarborGive[4]; ok {
		t.Error("clone shares harborGive")
	}
	if len(x.Walled) != 1 {
		t.Error("clone shares walled")
	}
	if *x.Merchant != hex {
		t.Error("clone shares the merchant pointer")
	}
	if x.Decks[Trade][CardMerchant] == 99 {
		t.Error("clone shares the deck maps")
	}
}

// --- DefenderVP awarded on a sole-defender win --------------------------------

func TestBarbarianSoleDefenderGetsVP(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	clearStartingCities(s)
	x := ext(s)
	makeCity(s, 0)
	spot := board.Vertex{Q: 0, R: 0, Side: board.N}
	x.Knights[spot] = Knight{Owner: 1, Level: 2, Active: true} // sole, strongest defender

	attack, tied := (Module{}).attackEvents(s, x)
	d := engine.DecodeEvent[barbarianAttackData](attack[0])
	if !d.Win {
		t.Fatalf("expected a defended win: strength=%d cities=%d", d.Strength, d.Cities)
	}
	if len(tied) != 0 {
		t.Fatalf("expected a sole defender, got ties %v", tied)
	}
	if d.Defender != 1 {
		t.Fatalf("defender = %d, want 1", d.Defender)
	}
	attack[0].Seq = s.NextSeq
	if err := engine.Apply(s, attack[0]); err != nil {
		t.Fatal(err)
	}
	if x.Players[1].DefenderVP != 1 {
		t.Errorf("sole defender did not get a VP: %d", x.Players[1].DefenderVP)
	}
}

// --- onDiceRolled: barbarian draw on a defended tie through the live roll -----

// TestOnDiceRolledShipAdvance checks the event-die roll path including the
// AlchemistD1 unfix and a fresh ship advance.
func TestOnDiceRolledShipAdvance(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	x.Barbarians = 0
	before := x.Barbarians

	// Drive several event-die rolls until at least one "ship" advances the fleet.
	advanced := false
	for i := 0; i < 40 && !advanced; i++ {
		out := (Module{}).onDiceRolled(s, 3, 2)
		for j := range out {
			out[j].Seq = s.NextSeq
			if err := engine.Apply(s, out[j]); err != nil {
				t.Fatal(err)
			}
			if out[j].Type == EvEventDie {
				d := engine.DecodeEvent[eventDieData](out[j])
				if d.Face == "ship" {
					advanced = true
				}
			}
		}
		if x.Barbarians >= barbarianTrack {
			x.Barbarians = 0 // avoid triggering an attack; we only test the advance
		}
	}
	if !advanced {
		fixtureGone(t, "no ship face in 40 rolls (rng-dependent)")
	}
	if x.Barbarians <= before && x.Barbarians != 0 {
		t.Errorf("ship face did not advance the fleet")
	}
}

// TestOnDiceRolledProgressGate covers the progress-card gate draw on a discipline
// face when a player is improved in that track.
func TestOnDiceRolledProgressGate(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	// Improve everyone in all tracks so whatever face shows, someone draws.
	for p := range s.Players {
		x.Players[p].Improve[Trade] = 5
		x.Players[p].Improve[Politics] = 5
		x.Players[p].Improve[Science] = 5
	}
	drew := false
	for i := 0; i < 30 && !drew; i++ {
		out := (Module{}).onDiceRolled(s, 3, 1) // red=1 always under the gate
		for j := range out {
			out[j].Seq = s.NextSeq
			if err := engine.Apply(s, out[j]); err != nil {
				t.Fatal(err)
			}
			if out[j].Type == EvProgressDrawn {
				drew = true
			}
		}
		if x.Barbarians >= barbarianTrack-1 {
			x.Barbarians = 0
		}
	}
	if !drew {
		fixtureGone(t, "no discipline face drew a card in 30 rolls")
	}
}

// --- helper coverage: lowestResource / lowestCommodity / vertexLess ----------

func TestSmallHelpers(t *testing.T) {
	if r, ok := lowestResource(engine.Hand{board.Ore: 1}); !ok || r != board.Ore {
		t.Errorf("lowestResource = %v,%v", r, ok)
	}
	if _, ok := lowestResource(engine.Hand{}); ok {
		t.Error("empty hand should have no lowest resource")
	}
	if c, ok := lowestCommodity(CommodityHand{Paper: 1}); !ok || c != Paper {
		t.Errorf("lowestCommodity = %v,%v", c, ok)
	}
	if _, ok := lowestCommodity(CommodityHand{}); ok {
		t.Error("empty commodity hand should have no lowest")
	}
	if !vertexLess(board.Vertex{Q: 0}, board.Vertex{Q: 1}) {
		t.Error("vertexLess Q ordering")
	}
	if !vertexLess(board.Vertex{Q: 0, R: 0}, board.Vertex{Q: 0, R: 1}) {
		t.Error("vertexLess R ordering")
	}
	if !vertexLess(board.Vertex{Q: 0, R: 0, Side: board.N}, board.Vertex{Q: 0, R: 0, Side: board.S}) {
		t.Error("vertexLess Side ordering")
	}
}

// --- trackOf / vpCard --------------------------------------------------------

func TestTrackOfAndVPCard(t *testing.T) {
	cases := map[ProgressCard]Track{
		CardMerchant: Trade, CardBishop: Politics, CardCrane: Science,
	}
	for card, want := range cases {
		if got := trackOf(card); got != want {
			t.Errorf("trackOf(%s) = %d, want %d", card, got, want)
		}
	}
	// Unknown card falls back to Trade.
	if got := trackOf("bogus"); got != Trade {
		t.Errorf("trackOf(unknown) = %d, want Trade", got)
	}
	if !vpCard(CardConstitution) || !vpCard(CardPrinter) {
		t.Error("Constitution/Printer should be VP cards")
	}
	if vpCard(CardMerchant) {
		t.Error("Merchant is not a VP card")
	}
}

// TestVPCardsScoreOnDraw: Constitution / Printer add ExtraVP immediately when
// drawn instead of joining the hand.
func TestVPCardsScoreOnDraw(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	p := engine.PlayerID(0)
	before := x.Players[p].ExtraVP
	ev := engine.NewEvent(EvProgressDrawn, progressCardData{Player: p, Card: CardConstitution, Track: Politics})
	ev.Seq = s.NextSeq
	if err := engine.Apply(s, ev); err != nil {
		t.Fatal(err)
	}
	if x.Players[p].ExtraVP != before+1 {
		t.Errorf("Constitution did not score: extraVP=%d", x.Players[p].ExtraVP)
	}
	if len(x.Players[p].Progress) != 0 {
		t.Errorf("VP card should not join the hand: %v", x.Players[p].Progress)
	}
}

// --- pick (deck) -------------------------------------------------------------

func TestDeckPick(t *testing.T) {
	d := freshDecks("base+cak")
	// The first card of the Trade deck in order is CommercialHarbor.
	if got := d.pick(Trade, 0); got != deckOrder[Trade][0] {
		t.Errorf("pick(Trade,0) = %s, want %s", got, deckOrder[Trade][0])
	}
	// An index past the first card's count lands on the next card.
	first := deckComposition[Trade][deckOrder[Trade][0]]
	if got := d.pick(Trade, first); got != deckOrder[Trade][1] {
		t.Errorf("pick(Trade,%d) = %s, want %s", first, got, deckOrder[Trade][1])
	}
}

// --- redactors round-trip ----------------------------------------------------

func TestRedactorsStripDetail(t *testing.T) {
	cases := []struct {
		typ  engine.EventType
		ev   engine.Event
		keep []string
		drop []string
	}{
		{EvProgressDrawn, engine.NewEvent(EvProgressDrawn, progressCardData{Player: 1, Card: CardBishop, Track: Politics}),
			[]string{"player", "track"}, []string{"card"}},
		{EvProgressStolen, engine.NewEvent(EvProgressStolen, progressStolenData{Thief: 1, Victim: 2, Card: CardBishop}),
			[]string{"thief", "victim"}, []string{"card"}},
		{EvCardsTaken, engine.NewEvent(EvCardsTaken, cardsMovedData{From: 1, To: 2, Cards: engine.Hand{board.Wood: 3}}),
			[]string{"from", "to", "count"}, []string{"cards"}},
		{EvCommodityStolen, engine.NewEvent(EvCommodityStolen, commodityStolenData{Thief: 1, Victim: 2, Com: Cloth}),
			[]string{"thief", "victim"}, []string{"com"}},
		{EvCommodityTaken, engine.NewEvent(EvCommodityTaken, commodityMovedData{From: 1, To: 2, Cards: CommodityHand{Cloth: 2}}),
			[]string{"from", "to", "count"}, []string{"cards"}},
	}
	for _, c := range cases {
		red, ok := engine.RedactorFor(c.typ)
		if !ok {
			t.Fatalf("no redactor for %s", c.typ)
		}
		var m map[string]any
		if err := json.Unmarshal(red(c.ev), &m); err != nil {
			t.Fatalf("%s: %v", c.typ, err)
		}
		for _, k := range c.keep {
			if _, ok := m[k]; !ok {
				t.Errorf("%s: redaction dropped public field %q: %v", c.typ, k, m)
			}
		}
		for _, k := range c.drop {
			if _, ok := m[k]; ok {
				t.Errorf("%s: redaction leaked private field %q: %v", c.typ, k, m)
			}
		}
	}
}

// --- bestTrack ---------------------------------------------------------------

func TestBestTrack(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)

	// No improvement -> no best track.
	if _, ok := bestTrack(x, 0); ok {
		t.Error("a player with no improvement should have no best track")
	}

	// Politics most improved.
	x.Players[0].Improve[Trade] = 1
	x.Players[0].Improve[Politics] = 3
	x.Players[0].Improve[Science] = 2
	tr, ok := bestTrack(x, 0)
	if !ok || tr != Politics {
		t.Errorf("bestTrack = %d,%v want Politics", tr, ok)
	}

	// Ties break by track order (Trade first).
	x.Players[1].Improve[Trade] = 2
	x.Players[1].Improve[Science] = 2
	tr, ok = bestTrack(x, 1)
	if !ok || tr != Trade {
		t.Errorf("tie bestTrack = %d,%v want Trade", tr, ok)
	}
}

// --- auto: harbor / spy / aqueduct branches ----------------------------------

func TestAutoResolvesHarbor(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.HarborGive = map[engine.PlayerID]board.Resource{q: board.Wheat}
	x.HarborTaker = p
	x.Players[q].Commodities = CommodityHand{Paper: 1}
	s.Players[p].Hand = engine.Hand{board.Wheat: 1}

	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != CmdHarborGive || cmd.Player != q {
		t.Fatalf("auto did not produce a harbor give: ok=%v %+v", ok, cmd)
	}
	step(t, s, cmd)
	if len(x.HarborGive) != 0 {
		t.Errorf("harbor not cleared by auto: %v", x.HarborGive)
	}
}

func TestAutoResolvesSpy(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.SpyThief, x.SpyVictim = p, q
	x.Players[q].Progress = []ProgressCard{CardBishop, CardMedicine}

	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != CmdSpyPick || cmd.Player != p {
		t.Fatalf("auto did not produce a spy pick: ok=%v %+v", ok, cmd)
	}
	step(t, s, cmd)
	if x.SpyThief != engine.NoPlayer {
		t.Errorf("spy not cleared by auto: %d", x.SpyThief)
	}
}

func TestAutoResolvesAqueduct(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	p := s.Cur
	x := ext(s)
	x.Aqueduct = []engine.PlayerID{p}
	s.Bank = engine.Hand{board.Wood: 5}

	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != CmdAqueductPick || cmd.Player != p {
		t.Fatalf("auto did not produce an aqueduct pick: ok=%v %+v", ok, cmd)
	}
	step(t, s, cmd)
	if len(x.Aqueduct) != 0 {
		t.Errorf("aqueduct not cleared by auto: %v", x.Aqueduct)
	}
}

// --- handleDiscard error branches --------------------------------------------

func TestHandleDiscardErrors(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	p := s.Cur
	s.Players[p].Hand = engine.Hand{board.Wood: 3}
	ext(s).Players[p].Commodities = CommodityHand{Cloth: 3}

	// Negative resources.
	if _, _, err := (Module{}).handleDiscard(s, engine.Command{Player: p,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Wood: -1}, "commodities": CommodityHand{}})}, 1); !errors.Is(err, engine.ErrBadDiscard) {
		t.Errorf("negative resources err = %v", err)
	}

	// Negative commodities.
	if _, _, err := (Module{}).handleDiscard(s, engine.Command{Player: p,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{}, "commodities": CommodityHand{Cloth: -1}})}, 1); !errors.Is(err, engine.ErrBadDiscard) {
		t.Errorf("negative commodities err = %v", err)
	}

	// Wrong total.
	if _, _, err := (Module{}).handleDiscard(s, engine.Command{Player: p,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Wood: 1}, "commodities": CommodityHand{}})}, 3); !errors.Is(err, engine.ErrBadDiscard) {
		t.Errorf("wrong total err = %v", err)
	}

	// Discarding more than held.
	if _, _, err := (Module{}).handleDiscard(s, engine.Command{Player: p,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Wood: 9}, "commodities": CommodityHand{}})}, 9); !errors.Is(err, engine.ErrBadDiscard) {
		t.Errorf("over-hold err = %v", err)
	}

	// A valid combined discard succeeds.
	events, handled, err := (Module{}).handleDiscard(s, engine.Command{Player: p,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Wood: 2}, "commodities": CommodityHand{Cloth: 1}})}, 3)
	if err != nil || !handled {
		t.Fatalf("valid discard: handled=%v err=%v", handled, err)
	}
	if len(events) != 2 {
		t.Errorf("expected resource+commodity discard events, got %+v", events)
	}
}

// --- decidePlayProgress: phase / discard / robber gating ---------------------

func TestPlayProgressWrongPhase(t *testing.T) {
	// newGame drives setup to completion, so take a state that is still in setup.
	s := newSetupGame(t, 8)
	_, err := (Module{}).decidePlayProgress(s, engine.Command{Player: s.Cur, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardWarlord})})
	if !errors.Is(err, engine.ErrWrongPhase) {
		t.Errorf("setup-phase play err = %v, want ErrWrongPhase", err)
	}
}

func TestPlayProgressBlockedByDiscardAndRobber(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardWarlord}

	// Pending discard blocks.
	s.PendingDiscards[p] = 1
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardWarlord})}, engine.ErrDiscardPending)
	delete(s.PendingDiscards, p)

	// Robber pending blocks.
	s.RobberPending = true
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardWarlord})}, engine.ErrRobberPending)
}

// --- tradeExtra hooks --------------------------------------------------------

func TestTradeExtraHeld(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	x.Players[0].Commodities = CommodityHand{Cloth: 2}

	// Empty payload: 0 cards, held.
	if n, ok := tradeExtraHeld(s, 0, nil); n != 0 || !ok {
		t.Errorf("empty payload = %d,%v", n, ok)
	}

	// Garbage payload: not held.
	if n, ok := tradeExtraHeld(s, 0, json.RawMessage(`{bad`)); n != 0 || ok {
		t.Errorf("garbage payload = %d,%v", n, ok)
	}

	// A zero-count valid payload.
	if n, ok := tradeExtraHeld(s, 0, mustJSON(t, CommodityHand{})); n != 0 || !ok {
		t.Errorf("zero payload = %d,%v", n, ok)
	}

	// Holds the requested commodities.
	if n, ok := tradeExtraHeld(s, 0, mustJSON(t, CommodityHand{Cloth: 2})); n != 2 || !ok {
		t.Errorf("held payload = %d,%v, want 2,true", n, ok)
	}

	// Does not hold them.
	if n, ok := tradeExtraHeld(s, 0, mustJSON(t, CommodityHand{Cloth: 5})); n != 5 || ok {
		t.Errorf("over-hold payload = %d,%v, want 5,false", n, ok)
	}
}

func TestTradeExtraEvents(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	// Empty payload -> no events.
	if ev := tradeExtraEvents(s, 0, 1, nil); ev != nil {
		t.Errorf("empty payload events = %+v", ev)
	}
	// Zero-count valid payload -> no events.
	if ev := tradeExtraEvents(s, 0, 1, mustJSON(t, CommodityHand{})); ev != nil {
		t.Errorf("zero payload events = %+v", ev)
	}
	// Real payload -> one commodity-taken event.
	ev := tradeExtraEvents(s, 0, 1, mustJSON(t, CommodityHand{Cloth: 1}))
	if len(ev) != 1 || ev[0].Type != EvCommodityTaken {
		t.Errorf("payload events = %+v", ev)
	}
}

// --- extraDiscardCount / discardLimitDelta -----------------------------------

func TestExtraDiscardAndLimitDelta(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	x.Players[0].Commodities = CommodityHand{Cloth: 2, Paper: 1}
	x.Players[0].Walls = 2
	if got := (Module{}).extraDiscardCount(s, 0); got != 3 {
		t.Errorf("extraDiscardCount = %d, want 3", got)
	}
	if got := (Module{}).discardLimitDelta(s, 0); got != 4 {
		t.Errorf("discardLimitDelta = %d, want 4 (2 walls x2)", got)
	}
}

// --- knightReachable through a blocked path ----------------------------------

func TestKnightReachableSameVertex(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	v := board.Vertex{Q: 0, R: 0, Side: board.N}
	if knightReachable(s, x, v, v, 0) {
		t.Error("a knight cannot move to its own vertex")
	}
}

// --- removeCard when card absent ---------------------------------------------

func TestRemoveCardAbsent(t *testing.T) {
	hand := []ProgressCard{CardBishop, CardWarlord}
	out := removeCard(hand, CardSpy) // not present
	if len(out) != 2 {
		t.Errorf("removeCard of absent card changed the hand: %v", out)
	}
	out = removeCard(hand, CardBishop)
	if len(out) != 1 || out[0] != CardWarlord {
		t.Errorf("removeCard wrong result: %v", out)
	}
}

// --- randomCombinedCard ------------------------------------------------------

func TestRandomCombinedCard(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	// Only a resource present -> picks the resource, isCom false.
	res, _, isCom := randomCombinedCard(s, 3, engine.Hand{board.Wheat: 2}, CommodityHand{})
	if isCom || res != board.Wheat {
		t.Errorf("combined (res only) = res=%v isCom=%v", res, isCom)
	}
	// Only a commodity present -> picks the commodity, isCom true.
	_, com, isCom := randomCombinedCard(s, 4, engine.Hand{}, CommodityHand{Coin: 2})
	if !isCom || com != Coin {
		t.Errorf("combined (com only) = com=%v isCom=%v", com, isCom)
	}
}

// --- sortedPlayers / sortedHarbor --------------------------------------------

func TestSortedHelpers(t *testing.T) {
	sp := sortedPlayers(map[engine.PlayerID]int{2: 0, 0: 0, 1: 0})
	if len(sp) != 3 || sp[0] != 0 || sp[1] != 1 || sp[2] != 2 {
		t.Errorf("sortedPlayers = %v, want [0 1 2]", sp)
	}
	sh := sortedHarbor(map[engine.PlayerID]board.Resource{2: board.Wood, 0: board.Ore})
	if len(sh) != 2 || sh[0] != 0 || sh[1] != 2 {
		t.Errorf("sortedHarbor = %v, want [0 2]", sh)
	}
}

// TestChaseRobberHonorsFriendlyRobber: the knight chase is a robber move, so
// it must respect the friendly-robber shield like the base robber and the
// pirate, and match the victims the client offers.
func TestChaseRobberHonorsFriendlyRobber(t *testing.T) {
	// setup arranges a chase: an active knight next to the robber, and a
	// destination hex where exactly one opponent has a building and a full hand.
	setup := func(t *testing.T, friendly bool) (*engine.State, board.Vertex, board.Hex, engine.PlayerID) {
		t.Helper()
		s, _ := newGame(t, 5, nil)
		rolled(t, s)
		s.Config.FriendlyRobber = friendly
		p := s.Cur
		x := ext(s)
		x.Attacks = 1 // robber only in play after the first barbarian attack

		var spot board.Vertex
		ok := false
		for _, v := range s.Board.Robber.Vertices() {
			if emptyKnightVertex(s, v) {
				spot, ok = v, true
				break
			}
		}
		if !ok {
			fixtureGone(t, "no empty vertex adjacent to the robber")
		}
		x.Knights[spot] = Knight{Owner: p, Level: 1, Active: true}

		// A destination hex, cleared and given exactly one opponent building. The
		// victim's other pieces are removed too: a Knights start is worth 3 public VP,
		// above the shield's threshold, and one settlement puts them at 1.
		var dest board.Hex
		gotDest := false
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if s.Board.Land(h) && h != s.Board.Robber {
				dest, gotDest = h, true
				break
			}
		}
		if !gotDest {
			fixtureGone(t, "no destination hex")
		}
		victim := (p + 1) % engine.PlayerID(len(s.Players))
		for v, b := range s.Buildings {
			if b.Owner == victim {
				delete(s.Buildings, v)
			}
		}
		for _, v := range dest.Vertices() {
			delete(s.Buildings, v)
		}
		s.Buildings[dest.Vertices()[0]] = engine.Building{Owner: victim}
		s.Players[victim].Hand = engine.Hand{1, 1, 1, 1, 1}
		if got := s.PublicVPWithModules(victim); got > 2 {
			t.Fatalf("victim public VP = %d, want the shielded range (<= 2)", got)
		}
		return s, spot, dest, p
	}

	t.Run("shielded victim is rejected", func(t *testing.T) {
		s, spot, dest, p := setup(t, true)
		reject(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
			Data: mustJSON(t, map[string]any{"v": spot, "hex": dest, "victim": victimOf(t, s, dest, p)})},
			engine.ErrBadVictim)
		// With the shield in force there is nobody to rob, so the chase goes through
		// with no victim.
		step(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
			Data: mustJSON(t, map[string]any{"v": spot, "hex": dest})})
		if s.Board.Robber != dest {
			t.Errorf("robber at %v, want %v", s.Board.Robber, dest)
		}
	})

	t.Run("unshielded victim is stealable", func(t *testing.T) {
		s, spot, dest, p := setup(t, false)
		victim := victimOf(t, s, dest, p)
		events := step(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
			Data: mustJSON(t, map[string]any{"v": spot, "hex": dest, "victim": victim})})
		stole := false
		for _, e := range events {
			if e.Type == engine.EvCardStolen || e.Type == EvCommodityStolen {
				stole = true
			}
		}
		if !stole {
			t.Errorf("no steal event with the option off: %+v", events)
		}
	})
}

// victimOf returns the single opponent owning a building on h.
func victimOf(t *testing.T, s *engine.State, h board.Hex, mover engine.PlayerID) engine.PlayerID {
	t.Helper()
	for _, v := range h.Vertices() {
		if b, ok := s.Buildings[v]; ok && b.Owner != mover {
			return b.Owner
		}
	}
	t.Fatalf("no opponent building on %v", h)
	return engine.NoPlayer
}

// TestBishopIsNotDealtUnderRaiders. The Bishop moves the robber, and a Raiders
// game has none (barbariansSail is false, so robberLocked never clears). The
// card would be dead, so it is left out of the Politics deck, as engine/wagons
// does with swiftDeckFor.
func TestBishopIsNotDealtUnderRaiders(t *testing.T) {
	with := freshDecks(engine.CanonicalRuleset("base+cak+raiders"))
	if n := with[Politics][CardBishop]; n != 0 {
		t.Errorf("Raiders Politics deck holds %d Bishops, want 0", n)
	}
	without := freshDecks("base+cak")
	if n := without[Politics][CardBishop]; n != deckComposition[Politics][CardBishop] {
		t.Errorf("Bishop count with a robber = %d, want %d",
			n, deckComposition[Politics][CardBishop])
	}
	// No other card count changes.
	for _, track := range []Track{Trade, Politics, Science} {
		for card, n := range deckComposition[track] {
			if card == CardBishop {
				continue
			}
			if with[track][card] != n {
				t.Errorf("%s: %d under Raiders, want the deck's %d", card, with[track][card], n)
			}
		}
	}
	if with.remaining(Politics) != without.remaining(Politics)-deckComposition[Politics][CardBishop] {
		t.Error("the Politics deck lost more (or less) than the two Bishops")
	}
}
