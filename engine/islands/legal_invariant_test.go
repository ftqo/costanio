package islands_test

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
)

// TestLegalTargetsMatchValidatorIslands is the Islands half of the "board never
// shows an invalid move" guarantee. It plays full bot games (reaching real ship
// and pirate states) and at every state asserts the offered legal-target set
// exactly equals what the validator accepts on a funded clone, both ways, for
// settlements, cities, roads, robber, ships and pirate.
//
// It also runs the compositions, because modules that refuse an edge (Rivers'
// bridge sites) or price a ship move (Rivers' coin) reach the ship validator
// through hooks the legal set must consult too.
func TestLegalTargetsMatchValidatorIslands(t *testing.T) {
	for _, rs := range []string{"base+islands", "base+islands+rivers", "base+cak+islands"} {
		t.Run(rs, func(t *testing.T) {
			for seed := uint64(1); seed <= 4; seed++ {
				playoutAssertingIslands(t, rs, seed)
			}
		})
	}
}

func playoutAssertingIslands(t *testing.T, ruleset string, seed uint64) {
	t.Helper()
	b := bot.NewStrong()
	cfg := engine.GameConfig{Players: 3 + int(seed%2), Ruleset: ruleset}
	log, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for step := 0; s.Phase != engine.PhaseFinished && step < 6000; step++ {
		cmd, ok := nextBotCommand(s, b)
		if !ok {
			break
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			// The bot should only ever propose legal moves; if not, end the turn
			// rather than wedge so the playout keeps covering states.
			if events, err = engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdEndTurn}); err != nil {
				break
			}
		}
		for _, e := range events {
			engine.Apply(s, e)
		}
		assertIslandsLegalMatchesValidator(t, s, seed)
	}
}

// nextBotCommand drives a game at the State level: discards owed by any seat
// first, then the current player's bot action, then any forced auto-resolution.
func nextBotCommand(s *engine.State, b *bot.Strong) (engine.Command, bool) {
	for p := range s.PendingDiscards {
		if cmd, ok := b.Act(s, p); ok {
			return cmd, true
		}
	}
	if cmd, ok := b.Act(s, s.Cur); ok {
		return cmd, true
	}
	return engine.AutoCommand(s)
}

func assertIslandsLegalMatchesValidator(t *testing.T, s *engine.State, seed uint64) {
	t.Helper()
	cur := s.Cur
	lt := s.LegalTargetsFor(cur)
	rich := fundedClone(s, cur)

	if s.Phase == engine.PhaseSetup && s.NeedRoad {
		// The setup connector: a ship is place_road with ship=true.
		set := map[board.Edge]bool{}
		for _, e := range lt.Ships {
			set[e] = true
		}
		for _, e := range allEdges(s) {
			_, err := engine.Decide(rich, engine.Command{Player: cur, Type: engine.CmdPlaceRoad,
				Data: mustJSON(t, map[string]any{"e": e, "ship": true})})
			if set[e] != (err == nil) {
				t.Errorf("seed %d: setup ship %v offered=%v validator=%v (err=%v)", seed, e, set[e], err == nil, err)
			}
		}
	}
	if s.Phase == engine.PhasePlay {
		assertVertexSet(t, seed, "settlement", s, rich, lt.Settlements, engine.CmdBuildSettlement, nilErr)
		assertVertexSet(t, seed, "city", s, rich, lt.Cities, engine.CmdBuildCity, nilErr)
		assertEdgeSet(t, seed, "road", s, rich, lt.Roads, engine.CmdBuildRoad, nilErr)
		assertEdgeSet(t, seed, "ship", s, rich, lt.Ships, islands.CmdBuildShip, nilErr)
	}
	assertHexSet(t, seed, "robber", s, rich, lt.RobberHexes, engine.CmdMoveRobber, robberOK)
	assertHexSet(t, seed, "pirate", s, rich, lt.PirateHexes, islands.CmdMovePirate, robberOK)

	// Ship moves: for each movable ship, every offered destination must be
	// accepted, and no other edge may be a legal destination.
	for _, grp := range lt.ShipMoves {
		offered := map[board.Edge]bool{}
		for _, e := range grp.To {
			offered[e] = true
		}
		for _, e := range allEdges(s) {
			_, err := engine.Decide(rich, engine.Command{Player: cur, Type: islands.CmdMoveShip,
				Data: mustJSON(t, map[string]any{"from": grp.From, "to": e})})
			if offered[e] != (err == nil) {
				t.Errorf("seed %d: ship move %v->%v offered=%v validator=%v (err=%v)", seed, grp.From, e, offered[e], err == nil, err)
			}
		}
	}
}

// --- shared invariant helpers (islands package) ----------------------------

func nilErr(err error) bool { return err == nil }
func robberOK(err error) bool {
	return err == nil || errors.Is(err, engine.ErrBadVictim)
}

func fundedClone(s *engine.State, cur engine.PlayerID) *engine.State {
	rich := s.Clone()
	for r := range rich.Players[cur].Hand {
		rich.Players[cur].Hand[r] = 30
	}
	return rich
}

func assertVertexSet(t *testing.T, seed uint64, name string, s, rich *engine.State, offered []board.Vertex, ct engine.CommandType, ok func(error) bool) {
	t.Helper()
	set := map[board.Vertex]bool{}
	for _, v := range offered {
		set[v] = true
	}
	for _, v := range allVertices(s) {
		_, err := engine.Decide(rich, engine.Command{Player: s.Cur, Type: ct, Data: mustJSON(t, map[string]any{"v": v})})
		if set[v] != ok(err) {
			t.Errorf("seed %d: %s %v offered=%v validator=%v (err=%v)", seed, name, v, set[v], ok(err), err)
		}
	}
}

func assertEdgeSet(t *testing.T, seed uint64, name string, s, rich *engine.State, offered []board.Edge, ct engine.CommandType, ok func(error) bool) {
	t.Helper()
	set := map[board.Edge]bool{}
	for _, e := range offered {
		set[e] = true
	}
	for _, e := range allEdges(s) {
		_, err := engine.Decide(rich, engine.Command{Player: s.Cur, Type: ct, Data: mustJSON(t, map[string]any{"e": e})})
		if set[e] != ok(err) {
			t.Errorf("seed %d: %s %v offered=%v validator=%v (err=%v)", seed, name, e, set[e], ok(err), err)
		}
	}
}

func assertHexSet(t *testing.T, seed uint64, name string, s, rich *engine.State, offered []board.Hex, ct engine.CommandType, ok func(error) bool) {
	t.Helper()
	set := map[board.Hex]bool{}
	for _, h := range offered {
		set[h] = true
	}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		_, err := engine.Decide(rich, engine.Command{Player: s.Cur, Type: ct, Data: mustJSON(t, map[string]any{"hex": h})})
		if set[h] != ok(err) {
			t.Errorf("seed %d: %s %v offered=%v validator=%v (err=%v)", seed, name, h, set[h], ok(err), err)
		}
	}
}

func allVertices(s *engine.State) []board.Vertex {
	seen := map[board.Vertex]bool{}
	var out []board.Vertex
	for h := range s.Board.Tiles {
		for _, v := range h.Vertices() {
			if !seen[v] {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	return out
}

func allEdges(s *engine.State) []board.Edge {
	seen := map[board.Edge]bool{}
	var out []board.Edge
	for h := range s.Board.Tiles {
		for _, e := range h.Edges() {
			ne := board.NewEdge(e.A, e.B)
			if !seen[ne] {
				seen[ne] = true
				out = append(out, ne)
			}
		}
	}
	return out
}

// mustJSON mirrors the helper in the internal islands test package. This file
// is in islands_test (external) so it can import bot, which imports
// engine/islands; an internal test importing bot would be an import cycle.
func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
