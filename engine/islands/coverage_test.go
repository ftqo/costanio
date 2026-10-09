package islands

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// --- Controlled-board helpers ------------------------------------------------
//
// Small, fully known boards so module branches (ship moves, foreign-island
// chips, the redacted view, error paths) run deterministically instead of
// depending on what a seed deals.

// builtState constructs a radius-2 island board: every hex in radius is land
// except the chosen sea hexes, which carry water. It returns a play-phase state
// with the given number of players, all banks full, ready for module commands.
func builtState(t *testing.T, players int, sea ...board.Hex) *engine.State {
	t.Helper()
	b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
	seaSet := map[board.Hex]bool{}
	for _, h := range sea {
		seaSet[h] = true
	}
	for _, h := range board.HexesInRadius(2) {
		if seaSet[h] {
			b.Tiles[h] = board.Tile{Res: board.Sea}
		} else {
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
		}
	}
	// Robber needs a land hex; origin is land in all our scenarios.
	b.Robber = board.Hex{Q: 0, R: 0}
	if seaSet[b.Robber] {
		t.Fatal("origin used as sea hex by a test")
	}

	s := engine.Empty()
	s.Config = engine.GameConfig{Players: players, Ruleset: "base+islands", TargetVP: 10}
	s.Board = b
	s.Players = make([]engine.PlayerState, players)
	for i := range s.Players {
		s.Players[i] = engine.PlayerState{
			RoadsLeft: engine.MaxRoads, SettlementsLeft: engine.MaxSettlements, CitiesLeft: engine.MaxCities,
		}
	}
	for _, r := range board.Resources {
		s.Bank[r] = 19
	}
	s.Buildings = map[board.Vertex]engine.Building{}
	s.Roads = map[board.Edge]engine.PlayerID{}
	s.PendingDiscards = map[engine.PlayerID]int{}
	s.Ext = map[string]engine.Extension{}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	// Seed the module ext so direct ext(s) reads are stable.
	ext(s)
	return s
}

// coastEdge finds a sea edge whose endpoint A is a land vertex, returning the
// edge and that land vertex.
func coastEdge(t *testing.T, s *engine.State) (board.Edge, board.Vertex) {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.IsSea(h) {
			continue
		}
		for _, e := range h.Edges() {
			for _, v := range []board.Vertex{e.A, e.B} {
				if s.Board.LandVertex(v) {
					return e, v
				}
			}
		}
	}
	t.Fatal("no coastal edge on controlled board")
	return board.Edge{}, board.Vertex{}
}

func hasEvent(evs []engine.Event, typ engine.EventType) bool {
	for _, e := range evs {
		if e.Type == typ {
			return true
		}
	}
	return false
}

func decideErr(t *testing.T, s *engine.State, cmd engine.Command, want error) {
	t.Helper()
	if _, err := engine.Decide(s, cmd); !errors.Is(err, want) {
		t.Fatalf("%s by %d: err = %v, want %v", cmd.Type, cmd.Player, err, want)
	}
}

// applyModuleEvent folds a module-produced event straight into the state via the
// module's Apply (no Seq bookkeeping), mirroring the fold path for tests that
// build state without the full engine loop.
func applyModuleEvent(t *testing.T, s *engine.State, ev engine.Event) {
	t.Helper()
	if ok, err := (Module{}).Apply(s, ev); err != nil || !ok {
		t.Fatalf("Apply(%s): ok=%v err=%v", ev.Type, ok, err)
	}
}

// --- ViewExt -----------------------------------------------------------------

func TestViewExtRedactsNothingButShapesPayload(t *testing.T) {
	s := builtState(t, 3, board.Hex{Q: 2, R: 0}, board.Hex{Q: -2, R: 0})
	x := ext(s)

	// Two ships (unordered map) plus pirate plus pending gold plus island VP.
	e1, _ := coastEdge(t, s)
	x.Ships[e1] = 0
	// A second, distinct ship edge.
	var e2 board.Edge
	for _, h := range board.HexesInRadius(2) {
		if !s.Board.IsSea(h) {
			continue
		}
		for _, e := range h.Edges() {
			if e != e1 && s.Board.SeaEdge(e) {
				e2 = e
			}
		}
	}
	x.Ships[e2] = 1
	x.MovedShip = true
	x.HasPirate = true
	x.Pirate = board.Hex{Q: 2, R: 0}
	x.PendingGold[2] = 3
	x.IslandVP[0] = 4

	v := x.ViewExt(1).(*ExtView)
	if len(v.Ships) != 2 {
		t.Fatalf("ships = %+v", v.Ships)
	}
	// Deterministic sort: A endpoints non-decreasing.
	a, b := v.Ships[0].E, v.Ships[1].E
	if a.A != b.A {
		ak := [3]int{a.A.Q, a.A.R, int(a.A.Side)}
		bk := [3]int{b.A.Q, b.A.R, int(b.A.Side)}
		for i := range ak {
			if ak[i] != bk[i] {
				if ak[i] > bk[i] {
					t.Errorf("ships not sorted by A: %+v", v.Ships)
				}
				break
			}
		}
	}
	if !v.MovedShip {
		t.Error("MovedShip not surfaced")
	}
	if v.Pirate == nil || *v.Pirate != (board.Hex{Q: 2, R: 0}) {
		t.Errorf("pirate view = %+v", v.Pirate)
	}
	if v.PendingGold[2] != 3 {
		t.Errorf("pending gold view = %+v", v.PendingGold)
	}
	if v.IslandVP[0] != 4 {
		t.Errorf("island vp view = %+v", v.IslandVP)
	}

	// JSON round-trips (the view is the wire format).
	if _, err := json.Marshal(v); err != nil {
		t.Fatal(err)
	}
}

func TestViewExtEmptyOmitsOptionalFields(t *testing.T) {
	s := builtState(t, 3, board.Hex{Q: 2, R: 0})
	v := ext(s).ViewExt(0).(*ExtView)
	if len(v.Ships) != 0 {
		t.Errorf("ships should be empty, got %+v", v.Ships)
	}
	if v.Pirate != nil {
		t.Errorf("no pirate expected: %+v", v.Pirate)
	}
	if v.PendingGold != nil || v.IslandVP != nil {
		t.Errorf("optional maps should be nil: %+v %+v", v.PendingGold, v.IslandVP)
	}
}

// --- CloneExt ----------------------------------------------------------------

func TestCloneExtDeepCopies(t *testing.T) {
	s := builtState(t, 3, board.Hex{Q: 2, R: 0})
	x := ext(s)
	e, _ := coastEdge(t, s)
	x.Ships[e] = 0
	x.BuiltTurn[e] = true
	x.MovedShip = true
	x.HasPirate = true
	x.Pirate = board.Hex{Q: 2, R: 0}
	x.PendingGold[1] = 2
	x.Reached[0] = map[int]bool{3: true}
	x.IslandVP[0] = 6
	x.ShipsLeft[0] = 11

	c := x.CloneExt().(*Ext)
	if !reflect.DeepEqual(c.Ships, x.Ships) || !reflect.DeepEqual(c.Reached, x.Reached) {
		t.Fatal("clone not equal to original")
	}

	// Mutating the clone must not touch the original (independent maps/slices).
	c.Ships[e] = 2
	c.BuiltTurn[e] = false
	c.PendingGold[1] = 99
	c.Reached[0][3] = false
	c.IslandVP[0] = 0
	c.ShipsLeft[0] = 0
	if x.Ships[e] != 0 || !x.BuiltTurn[e] || x.PendingGold[1] != 2 ||
		!x.Reached[0][3] || x.IslandVP[0] != 6 || x.ShipsLeft[0] != 11 {
		t.Error("clone shares backing storage with original")
	}
}

// --- decideMoveShip + shipOpen ----------------------------------------------

// TestMoveShipDeterministic moves an open ship anchored at a player's building
// and checks the move's refusals and the one-move-per-turn limit.
func TestMoveShipDeterministic(t *testing.T) {
	// Surround the origin with sea so it has many sea edges to chain on.
	s := builtState(t, 2, board.Hex{Q: 1, R: 0}, board.Hex{Q: 0, R: 1}, board.Hex{Q: -1, R: 1})
	p := s.Cur
	x := ext(s)

	// Anchor: a settlement at a land vertex touching a sea edge.
	e1, v := coastEdge(t, s)
	s.Buildings[v] = engine.Building{Owner: p}
	x.Ships[e1] = p // e1 anchored by the building at v; far end is open.

	// The destination must reconnect to the player's network after `from` is
	// lifted; the building at v is the only anchor, so `to` must be another sea
	// edge touching v.
	var to board.Edge
	foundTo := false
	for _, ne := range v.Edges() {
		if ne == e1 || !s.Board.SeaEdge(ne) {
			continue
		}
		if _, taken := x.Ships[ne]; taken {
			continue
		}
		if _, taken := s.Roads[ne]; taken {
			continue
		}
		to = ne
		foundTo = true
		break
	}
	if !foundTo {
		t.Fatal("no second free sea edge at the anchor vertex")
	}

	// A ship that was just built cannot move.
	x.BuiltTurn[e1] = true
	decideErr(t, s, engine.Command{Player: p, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": e1, "to": to})}, ErrShipJustBuilt)
	delete(x.BuiltTurn, e1)

	// Moving a ship you don't own / that isn't there is bad placement.
	decideErr(t, s, engine.Command{Player: p, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": to, "to": e1})}, engine.ErrBadPlacement)

	// to == from is rejected.
	decideErr(t, s, engine.Command{Player: p, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": e1, "to": e1})}, engine.ErrBadPlacement)

	// A legal move: open ship slides to the adjacent sea edge.
	evs := step(t, s, engine.Command{Player: p, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": e1, "to": to})})
	if !hasEvent(evs, EvShipMoved) {
		t.Fatalf("move events = %+v", evs)
	}
	if _, still := x.Ships[e1]; still {
		t.Error("ship left origin? still present")
	}
	if x.Ships[to] != p || !x.MovedShip {
		t.Errorf("ship not at target: %+v moved=%v", x.Ships, x.MovedShip)
	}

	// One move per turn.
	decideErr(t, s, engine.Command{Player: p, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": to, "to": e1})}, ErrShipAlreadyMoved)
}

// A ship locked between an own building and an own continuing ship is not open
// and cannot move.
func TestMoveShipNotOpen(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0}, board.Hex{Q: 0, R: 1}, board.Hex{Q: -1, R: 1})
	p := s.Cur
	x := ext(s)

	e1, v := coastEdge(t, s)
	s.Buildings[v] = engine.Building{Owner: p}
	x.Ships[e1] = p
	open := e1.Other(v)

	// Find a continuing ship at the open end and a destination beyond it.
	var cont, dest board.Edge
	foundCont := false
	for _, ne := range open.Edges() {
		if ne == e1 || !s.Board.SeaEdge(ne) {
			continue
		}
		cont = ne
		foundCont = true
		// And a free third sea edge somewhere to attempt the (blocked) move to.
		for _, h := range board.HexesInRadius(2) {
			if !s.Board.IsSea(h) {
				continue
			}
			for _, he := range h.Edges() {
				if he != e1 && he != cont && s.Board.SeaEdge(he) {
					dest = he
				}
			}
		}
		break
	}
	if !foundCont {
		t.Fatal("no continuing sea edge at open end")
	}
	x.Ships[cont] = p // now e1 is closed at both ends (building + own ship)

	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": e1, "to": dest})}); !errors.Is(err, ErrShipNotOpen) {
		t.Fatalf("locked ship move err = %v, want ErrShipNotOpen", err)
	}
}

// Pirate sitting next to a ship blocks moving it.
func TestMoveShipBlockedByPirate(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0}, board.Hex{Q: 0, R: 1})
	p := s.Cur
	x := ext(s)
	e1, v := coastEdge(t, s)
	s.Buildings[v] = engine.Building{Owner: p}
	x.Ships[e1] = p
	// Park the pirate on a sea hex bordering e1.
	for _, h := range board.EdgeHexes(e1) {
		if s.Board.IsSea(h) {
			x.HasPirate = true
			x.Pirate = h
		}
	}
	open := e1.Other(v)
	var to board.Edge
	for _, ne := range open.Edges() {
		if ne != e1 && s.Board.SeaEdge(ne) {
			to = ne
		}
	}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": e1, "to": to})}); !errors.Is(err, ErrPirateBlocks) {
		t.Fatalf("pirate-blocked move err = %v", err)
	}
}

// decideMoveShip rejects when not the actionable turn (wrong player).
func TestMoveShipNotActionable(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	decideErr(t, s, engine.Command{Player: 1, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": board.Edge{}, "to": board.Edge{}})}, engine.ErrNotYourTurn)
}

// --- decideBuildShip: out-of-pieces and out-of-resources --------------------

func TestBuildShipNoPiecesAndNoResources(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0}, board.Hex{Q: 0, R: 1})
	p := s.Cur
	e, v := coastEdge(t, s)
	s.Buildings[v] = engine.Building{Owner: p}

	// Out of resources first (ships left is full, hand empty).
	decideErr(t, s, engine.Command{Player: p, Type: CmdBuildShip,
		Data: mustJSON(t, map[string]any{"e": e})}, engine.ErrNoResources)

	// Out of ships: zero the supply, give resources.
	ext(s).ShipsLeft[p] = 0
	s.Players[p].Hand = CostShip
	decideErr(t, s, engine.Command{Player: p, Type: CmdBuildShip,
		Data: mustJSON(t, map[string]any{"e": e})}, engine.ErrNoPieces)
}

// --- decideMovePirate error branches ----------------------------------------

func TestMovePirateDisabled(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	s.Config.Modules = map[string]json.RawMessage{Name: mustJSON(t, Config{Pirate: false, IslandVP: 2})}
	s.RobberPending = true
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": board.Hex{Q: 1, R: 0}})}, engine.ErrUnknownCommand)
}

func TestMovePirateGuardRails(t *testing.T) {
	sea := board.Hex{Q: 1, R: 0}
	s := builtState(t, 2, sea)

	// Wrong phase: no robber pending yet.
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": sea})}, engine.ErrWrongPhase)

	// Not your turn.
	s.RobberPending = true
	decideErr(t, s, engine.Command{Player: 1, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": sea})}, engine.ErrNotYourTurn)

	// Discards pending blocks the pirate.
	s.PendingDiscards[1] = 2
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": sea})}, engine.ErrDiscardPending)
	delete(s.PendingDiscards, 1)

	// Target must be sea.
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": board.Hex{Q: 0, R: 0}})}, engine.ErrBadPlacement)

	// Cannot stay on the pirate's current hex.
	ext(s).HasPirate = true
	ext(s).Pirate = sea
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": sea})}, engine.ErrBadPlacement)
}

// Moving the pirate next to a victim who holds no cards: a victim was named but
// there are no eligible victims -> bad victim.
func TestMovePirateBadVictimWhenNamedButNone(t *testing.T) {
	sea := board.Hex{Q: 1, R: 0}
	s := builtState(t, 2, sea)
	s.RobberPending = true
	victim := engine.PlayerID(1)
	// No ship of the victim near the pirate hex, so naming a victim is invalid.
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": sea, "victim": victim})}, engine.ErrBadVictim)
}

// A victim adjacent but with an empty hand is not eligible: naming them errors,
// and moving with no victim is the only legal play.
func TestMovePirateEligibilityRequiresCards(t *testing.T) {
	sea := board.Hex{Q: 1, R: 0}
	s := builtState(t, 2, sea)
	s.RobberPending = true
	victim := engine.PlayerID(1)

	// Place a victim ship next to the pirate hex but leave their hand empty.
	var shipEdge board.Edge
	for _, e := range sea.Edges() {
		if s.Board.SeaEdge(e) {
			shipEdge = e
			break
		}
	}
	ext(s).Ships[shipEdge] = victim
	s.Players[victim].Hand = engine.Hand{}

	// Empty-handed neighbor is not eligible -> naming errors.
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": sea, "victim": victim})}, engine.ErrBadVictim)

	// With no victim named it is a clean pirate move (no steal).
	evs := step(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": sea})})
	if !hasEvent(evs, EvPirateMoved) || hasEvent(evs, engine.EvCardStolen) {
		t.Fatalf("pirate move events = %+v", evs)
	}
	if !ext(s).HasPirate || ext(s).Pirate != sea || s.RobberPending {
		t.Errorf("pirate state after move: has=%v at=%v robberPending=%v",
			ext(s).HasPirate, ext(s).Pirate, s.RobberPending)
	}
}

// --- decideChooseGold error branches ----------------------------------------

func TestChooseGoldErrors(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})

	// Setup is a legal phase for a gold pick (a round-2 settlement bordering
	// gold owes one; see TestChooseGoldInSetupPhase). With nothing owed the
	// answer is ErrNoGoldOwed, not wrong-phase.
	s.Phase = engine.PhaseSetup
	decideErr(t, s, engine.Command{Player: 0, Type: CmdChooseGold,
		Data: mustJSON(t, map[string]any{"gain": engine.Hand{board.Ore: 1}})}, ErrNoGoldOwed)
	s.Phase = engine.PhasePlay

	// No gold owed.
	decideErr(t, s, engine.Command{Player: 0, Type: CmdChooseGold,
		Data: mustJSON(t, map[string]any{"gain": engine.Hand{board.Ore: 1}})}, ErrNoGoldOwed)

	// Owed 2 but picking a negative-count / wrong-size / not-in-bank hand.
	ext(s).PendingGold[0] = 2
	decideErr(t, s, engine.Command{Player: 0, Type: CmdChooseGold,
		Data: mustJSON(t, map[string]any{"gain": engine.Hand{board.Ore: -1, board.Wood: 3}})}, ErrBadGoldPick)
	decideErr(t, s, engine.Command{Player: 0, Type: CmdChooseGold,
		Data: mustJSON(t, map[string]any{"gain": engine.Hand{board.Ore: 1}})}, ErrBadGoldPick)
}

// A drained bank caps the pick: owed 2 but only 1 card in the bank means a
// 1-card pick is valid.
func TestChooseGoldClampsToBank(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	ext(s).PendingGold[0] = 2
	s.Bank = engine.Hand{board.Ore: 1} // only one card left

	// A 2-card pick is now too large.
	decideErr(t, s, engine.Command{Player: 0, Type: CmdChooseGold,
		Data: mustJSON(t, map[string]any{"gain": engine.Hand{board.Ore: 2}})}, ErrBadGoldPick)

	// A 1-card pick of what's left succeeds.
	evs := step(t, s, engine.Command{Player: 0, Type: CmdChooseGold,
		Data: mustJSON(t, map[string]any{"gain": engine.Hand{board.Ore: 1}})})
	if !hasEvent(evs, EvGoldChosen) {
		t.Fatalf("gold chosen events = %+v", evs)
	}
	if s.Players[0].Hand[board.Ore] != 1 || s.Bank[board.Ore] != 0 {
		t.Errorf("bank/hand after clamped pick: hand %v bank %v", s.Players[0].Hand, s.Bank)
	}
}

// --- onEvents: island chips via vertexIslands & playerOnIslandElsewhere ------

// A settlement reaching a brand-new island awards a chip; a later settlement on
// the same island (player already present elsewhere) does not.
func TestOnEventsIslandChips(t *testing.T) {
	// Two separate land masses divided by a sea ring slice: make a small island
	// out of one corner hex, the rest is the mainland.
	island := board.Hex{Q: 2, R: -2} // a corner hex, isolated by surrounding sea
	s := builtState(t, 2,
		board.Hex{Q: 1, R: -1}, board.Hex{Q: 2, R: -1}, board.Hex{Q: 1, R: -2})
	// Confirm `island` is a 1-hex component distinct from origin's component.
	ids := s.Board.Islands()
	if ids[island] == ids[board.Hex{Q: 0, R: 0}] {
		t.Fatal("island hex not isolated; adjust sea layout")
	}

	p := engine.PlayerID(0)
	cfg := configFrom(s.Config)
	if cfg.IslandVP != 2 {
		t.Fatalf("default island vp = %d", cfg.IslandVP)
	}

	// First settlement on the island: chip awarded.
	first := island.Vertices()[0]
	built := engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: p, V: &first})
	out := (Module{}).onEvents(s, []engine.Event{built})
	var chip *engine.Event
	for i := range out {
		if out[i].Type == EvIslandChip {
			chip = &out[i]
		}
	}
	if chip == nil {
		t.Fatalf("no island chip for first island settlement: %+v", out)
	}
	d := engine.DecodeEvent[islandChipData](*chip)
	if d.Player != p || d.VP != 2 || d.Island != ids[island] {
		t.Errorf("chip data = %+v", d)
	}

	// Place the building (but not the chip) so the player is present on the
	// island without Reached set. A second settlement on the same island must
	// still award no chip, exercising playerOnIslandElsewhere's positive path.
	s.Buildings[first] = engine.Building{Owner: p}
	second := island.Vertices()[3] // opposite corner of the same hex
	built2 := engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: p, V: &second})
	out2 := (Module{}).onEvents(s, []engine.Event{built2})
	for _, e := range out2 {
		if e.Type == EvIslandChip {
			t.Error("second settlement on the same island earned a chip (player already present)")
		}
	}

	// An opponent's building on the island must not suppress p's chip
	// (playerOnIslandElsewhere filters by owner).
	delete(s.Buildings, first)
	s.Buildings[first] = engine.Building{Owner: engine.PlayerID(1)}
	out3 := (Module{}).onEvents(s, []engine.Event{built2})
	if !hasEvent(out3, EvIslandChip) {
		t.Error("opponent's island building wrongly suppressed our chip")
	}

	// Now fold the chip: re-reaching an already-Reached island yields nothing.
	for i := range out3 {
		if out3[i].Type == EvIslandChip {
			applyModuleEvent(t, s, out3[i])
		}
	}
	out4 := (Module{}).onEvents(s, []engine.Event{built2})
	for _, e := range out4 {
		if e.Type == EvIslandChip {
			t.Error("already-reached island earned another chip")
		}
	}
}

// onEvents emits a turn-reset event on EvTurnStarted, and skips chip logic when
// IslandVP is configured to 0 or the built event carries no vertex.
func TestOnEventsTurnResetAndDisabledChips(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	out := (Module{}).onEvents(s, []engine.Event{engine.NewEvent(engine.EvTurnStarted, struct{}{})})
	if len(out) != 1 || out[0].Type != EvTurnReset {
		t.Fatalf("turn-started should emit reset: %+v", out)
	}

	// IslandVP=0 disables chips entirely.
	s.Config.Modules = map[string]json.RawMessage{Name: mustJSON(t, map[string]any{"island_vp": 0})}
	v := board.Hex{Q: 0, R: 0}.Vertices()[0]
	built := engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: 0, V: &v})
	if out := (Module{}).onEvents(s, []engine.Event{built}); len(out) != 0 {
		t.Errorf("island_vp=0 still produced events: %+v", out)
	}

	// A built event with a nil vertex (e.g. road build payload) is ignored.
	s.Config.Modules = nil
	builtNoV := engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: 0})
	if out := (Module{}).onEvents(s, []engine.Event{builtNoV}); len(out) != 0 {
		t.Errorf("nil-vertex built produced events: %+v", out)
	}
}

// --- TurnReset apply path ----------------------------------------------------

func TestTurnResetClearsPerTurnState(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	x := ext(s)
	e, _ := coastEdge(t, s)
	x.BuiltTurn[e] = true
	x.MovedShip = true
	applyModuleEvent(t, s, engine.NewEvent(EvTurnReset, struct{}{}))
	if len(x.BuiltTurn) != 0 || x.MovedShip {
		t.Errorf("turn reset did not clear: built=%v moved=%v", x.BuiltTurn, x.MovedShip)
	}
}

// --- configFrom: malformed and negative-VP configs --------------------------

func TestConfigFromDefaultsAndOverrides(t *testing.T) {
	// No modules -> defaults.
	d := configFrom(engine.GameConfig{})
	if d.IslandVP != 2 || !d.Pirate {
		t.Errorf("defaults = %+v", d)
	}

	// Negative VP is coerced back to the default.
	neg := configFrom(engine.GameConfig{Modules: map[string]json.RawMessage{
		Name: json.RawMessage(`{"island_vp":-5,"pirate":false}`)}})
	if neg.IslandVP != 2 || neg.Pirate {
		t.Errorf("negative vp config = %+v", neg)
	}

	// Explicit override.
	ov := configFrom(engine.GameConfig{Modules: map[string]json.RawMessage{
		Name: json.RawMessage(`{"island_vp":3}`)}})
	if ov.IslandVP != 3 {
		t.Errorf("override vp = %d", ov.IslandVP)
	}
}

// --- setupShipEvent rejections ----------------------------------------------

func TestSetupShipEventRejections(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	p := engine.PlayerID(0)
	e, _ := coastEdge(t, s)

	// Happy path.
	ev, ok := setupShipEvent(s, e, p)
	if !ok || ev.Type != EvShipBuilt {
		t.Fatalf("setup ship event = %+v ok=%v", ev, ok)
	}
	d := engine.DecodeEvent[shipData](ev)
	if !d.Free || d.Player != p {
		t.Errorf("setup ship data = %+v", d)
	}

	// A land edge is not a ship spot.
	var landEdge board.Edge
	for _, le := range (board.Hex{Q: 0, R: 0}).Edges() {
		if !s.Board.SeaEdge(le) {
			landEdge = le
		}
	}
	if _, ok := setupShipEvent(s, landEdge, p); ok {
		t.Error("setup ship accepted a land edge")
	}

	// Edge already occupied by a ship.
	ext(s).Ships[e] = p
	if _, ok := setupShipEvent(s, e, p); ok {
		t.Error("setup ship accepted an occupied edge")
	}

	// Out of ships.
	delete(ext(s).Ships, e)
	ext(s).ShipsLeft[p] = 0
	if _, ok := setupShipEvent(s, e, p); ok {
		t.Error("setup ship accepted with zero ships left")
	}
}

// --- relocateRobber: no desert (lands only) and onto-random-land path -------

func TestRelocateRobberOntoLand(t *testing.T) {
	// A board where the robber's hex drowned and there is no desert: it must
	// land on some hex it may legally occupy (which one is drawn from the seed;
	// TestRelocateRobberSpreadsOverCandidates covers the distribution).
	b := &board.Board{Radius: 1, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(1) {
		b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
	}
	// Drown the origin (where the robber starts) so relocate must move it.
	b.Tiles[board.Hex{Q: 0, R: 0}] = board.Tile{Res: board.Sea}
	b.Robber = board.Hex{Q: 0, R: 0}
	relocateRobber(b, rand.New(rand.NewPCG(1, 2)))
	if !b.Land(b.Robber) {
		t.Errorf("robber not relocated to land: %v (%v)", b.Robber, b.Tiles[b.Robber])
	}

	// And a board with a surviving desert: robber should prefer the desert.
	b2 := &board.Board{Radius: 1, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(1) {
		b2.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
	}
	desert := board.Hex{Q: 1, R: 0}
	b2.Tiles[desert] = board.Tile{Res: board.ResNone}
	b2.Tiles[board.Hex{Q: 0, R: 0}] = board.Tile{Res: board.Sea}
	b2.Robber = board.Hex{Q: 0, R: 0}
	relocateRobber(b2, rand.New(rand.NewPCG(1, 2)))
	if b2.Robber != desert {
		t.Errorf("robber should sit on the surviving desert %v, got %v", desert, b2.Robber)
	}
}

// TestRelocateRobberSpreadsOverCandidates: the fallback must not always pick
// the same hex. The board is uniform (drowned centre, every other hex an
// identical 5), so every candidate is equally cheap and all six must be
// reached.
func TestRelocateRobberSpreadsOverCandidates(t *testing.T) {
	seen := map[board.Hex]int{}
	for seed := range uint64(200) {
		b := &board.Board{Radius: 1, Tiles: map[board.Hex]board.Tile{}}
		for _, h := range board.HexesInRadius(1) {
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
		}
		b.Tiles[board.Hex{Q: 0, R: 0}] = board.Tile{Res: board.Sea}
		b.Robber = board.Hex{Q: 0, R: 0}
		relocateRobber(b, rand.New(rand.NewPCG(seed, 0x9e3779b9)))
		if !b.RobberOK(b.Robber) {
			t.Fatalf("seed %d: robber on %v (%v), not a legal hex", seed, b.Robber, b.Tiles[b.Robber])
		}
		seen[b.Robber]++
	}
	if len(seen) != 6 {
		t.Fatalf("robber reached %d of the 6 candidate hexes over 200 seeds: %v", len(seen), seen)
	}
	for h, n := range seen {
		if n < 200/6/3 {
			t.Errorf("hex %v drew %d of 200: the choice is skewed, not uniform", h, n)
		}
	}
}

// TestRelocateRobberPrefersTheCheapestHex pins the tie-break's other half: among
// hexes the robber must block, it blocks the one that pays least.
func TestRelocateRobberPrefersTheCheapestHex(t *testing.T) {
	cheap := board.Hex{Q: 1, R: -1}
	for seed := range uint64(50) {
		b := &board.Board{Radius: 1, Tiles: map[board.Hex]board.Tile{}}
		for _, h := range board.HexesInRadius(1) {
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 6} // 5 pips
		}
		b.Tiles[cheap] = board.Tile{Res: board.Wood, Number: 12} // 1 pip
		b.Tiles[board.Hex{Q: 0, R: 0}] = board.Tile{Res: board.Sea}
		b.Robber = board.Hex{Q: 0, R: 0}
		relocateRobber(b, rand.New(rand.NewPCG(seed, 7)))
		if b.Robber != cheap {
			t.Fatalf("seed %d: robber on %v (%d pips), want the 1-pip hex %v",
				seed, b.Robber, board.Pips(b.Tiles[b.Robber].Number), cheap)
		}
	}
}

// --- auto: drained bank caps the auto gold pick -----------------------------

func TestAutoGoldClampedByBank(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	ext(s).PendingGold[1] = 5
	// Bank holds only 2 cards total.
	s.Bank = engine.Hand{board.Ore: 1, board.Wood: 1}
	cmd, ok := (Module{}).auto(s, engine.NoPlayer)
	if !ok || cmd.Type != CmdChooseGold || cmd.Player != 1 {
		t.Fatalf("auto = %+v ok=%v", cmd, ok)
	}
	d := engine.DecodeEvent[goldChosenData](engine.Event{Data: cmd.Data})
	if d.Gain.Count() != 2 {
		t.Errorf("auto pick should clamp to bank (2), got %d (%v)", d.Gain.Count(), d.Gain)
	}

	// With no pending gold, auto declines.
	delete(ext(s).PendingGold, 1)
	if _, ok := (Module{}).auto(s, engine.NoPlayer); ok {
		t.Error("auto produced a command with no pending gold")
	}
}

// --- Decide returns (nil,false,nil) for unrelated commands ------------------

func TestDecideIgnoresForeignCommands(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	evs, handled, err := (Module{}).Decide(s, engine.Command{Player: 0, Type: engine.CmdEndTurn})
	if handled || err != nil || evs != nil {
		t.Errorf("foreign command: evs=%v handled=%v err=%v", evs, handled, err)
	}
}

// --- Apply returns false for unrelated events -------------------------------

func TestApplyIgnoresForeignEvents(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0})
	ok, err := (Module{}).Apply(s, engine.NewEvent(engine.EvTurnStarted, struct{}{}))
	if ok || err != nil {
		t.Errorf("foreign event: ok=%v err=%v", ok, err)
	}
}
