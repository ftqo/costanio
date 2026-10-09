package knights_test

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// TestLegalTargetsMatchValidatorKnights drives full bot-played base+cak games and
// at every state asserts the offered legal-target set equals what the
// validator accepts on a funded clone, in both directions, for every action
// type that maps to a board position.
func TestLegalTargetsMatchValidatorKnights(t *testing.T) {
	const games = 4
	for seed := uint64(1); seed <= games; seed++ {
		playoutAssertingKnights(t, seed)
	}
}

func playoutAssertingKnights(t *testing.T, seed uint64) {
	t.Helper()
	b := bot.NewStrong()
	cfg := engine.GameConfig{Players: 3 + int(seed%2), Ruleset: "base+cak"}
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
	for step := 0; s.Phase != engine.PhaseFinished && step < 8000; step++ {
		cmd, ok := nextKnightsCommand(s, b)
		if !ok {
			break
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			if events, err = engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdEndTurn}); err != nil {
				break
			}
		}
		for _, e := range events {
			engine.Apply(s, e)
		}
		assertKnightsLegalMatchesValidator(t, s, seed)
	}
}

func nextKnightsCommand(s *engine.State, b *bot.Strong) (engine.Command, bool) {
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

func assertKnightsLegalMatchesValidator(t *testing.T, s *engine.State, seed uint64) {
	t.Helper()
	cur := s.Cur
	lt := s.LegalTargetsFor(cur)
	rich := fundedCloneKnights(s, cur)

	if s.Phase == engine.PhasePlay {
		assertVerts(t, seed, "settlement", s, rich, lt.Settlements, engine.CmdBuildSettlement, nilErrKnights)
		assertVerts(t, seed, "city", s, rich, lt.Cities, engine.CmdBuildCity, nilErrKnights)
		assertEdges(t, seed, "road", s, rich, lt.Roads, engine.CmdBuildRoad, nilErrKnights)
		assertVerts(t, seed, "knight", s, rich, lt.Knights, knights.CmdBuildKnight, nilErrKnights)
	}
	assertHexes(t, seed, "robber", s, rich, lt.RobberHexes, engine.CmdMoveRobber, robberOKKnights)

	// Chase-robber: every offered hex must be a land hex other than the robber's
	// (decideChaseRobber's exact rule; reverse holds by construction).
	for _, h := range lt.ChaseRobberHexes {
		if !s.Board.Land(h) || h == s.Board.Robber {
			t.Errorf("seed %d: chase-robber offered invalid hex %v (land=%v robber=%v)", seed, h, s.Board.Land(h), s.Board.Robber)
		}
	}

	// Pending placements (Deserter replacement, knight relocation) may be owed by
	// any seat, e.g. a displaced non-current player. Check each.
	for p := range s.Players {
		seat := engine.PlayerID(p)
		pl := s.LegalTargetsFor(seat)
		richP := fundedCloneKnights(s, seat)
		assertVertsForSeat(t, seed, "deserter-place", s, richP, seat, pl.DeserterPlacements, knights.CmdDeserterPlace, "v")
		assertVertsForSeat(t, seed, "knight-reloc", s, richP, seat, pl.KnightRelocations, knights.CmdRelocateKnight, "to")
	}

	assertImprovementsMatchValidator(t, seed, s, cur)

	// Knight moves (and displacement): each offered destination must be accepted.
	for _, grp := range lt.KnightMoves {
		offered := map[board.Vertex]bool{}
		for _, v := range grp.To {
			offered[v] = true
		}
		for _, v := range allVertsKnights(s) {
			_, err := engine.Decide(rich, engine.Command{Player: cur, Type: knights.CmdMoveKnight,
				Data: jsonKnights(map[string]any{"from": grp.From, "to": v})})
			if offered[v] != (err == nil) {
				t.Errorf("seed %d: knight move %v->%v offered=%v validator=%v (err=%v)", seed, grp.From, v, offered[v], err == nil, err)
			}
		}
	}
}

// allTracks is the improvement disciplines in wire order, so the improvement
// invariant can sweep every track a client could ask for.
var allTracks = []knights.Track{knights.Trade, knights.Politics, knights.Science}

// assertImprovementsMatchValidator checks the improvement advisory against
// decideImprove, on a clone funded with commodities so the cost gate (checked
// before the metropolis rule and not part of the advisory) cannot mask a
// structural refusal:
//
//   - subset: every track offered is accepted by decideImprove. Always checked.
//   - converse: every track decideImprove accepts is offered. Checked only when
//     LegalTargetsFor forwards the module's improvements at all (PhasePlay,
//     actionable, nothing owed).
func assertImprovementsMatchValidator(t *testing.T, seed uint64, s *engine.State, cur engine.PlayerID) {
	t.Helper()
	lt := s.LegalTargetsFor(cur)
	offered := map[int]bool{}
	for _, tr := range lt.Improvements {
		offered[tr] = true
	}
	rich := commodityCloneKnights(s, cur)
	forwarded := s.Phase == engine.PhasePlay && !s.RobberPending &&
		len(lt.DeserterPlacements)+len(lt.KnightRelocations)+len(lt.BarbarianDowngrades) == 0 &&
		engine.RequireActionableTurn(s, cur) == nil
	for _, tr := range allTracks {
		_, err := engine.Decide(rich, engine.Command{Player: cur, Type: knights.CmdImproveCity,
			Data: jsonKnights(map[string]any{"track": tr})})
		if offered[int(tr)] && err != nil {
			t.Errorf("seed %d: improvement track %v offered but rejected by decideImprove: %v", seed, tr, err)
		}
		if forwarded && !offered[int(tr)] && err == nil {
			t.Errorf("seed %d: improvement track %v accepted by decideImprove but not offered", seed, tr)
		}
	}
}

// --- helpers (external knights_test package) -----------------------------------

func jsonKnights(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
func nilErrKnights(err error) bool      { return err == nil }
func robberOKKnights(err error) bool {
	return err == nil || errors.Is(err, engine.ErrBadVictim)
}

// commodityCloneKnights clones s with cur's commodity stock filled, so an
// improvement command fails only for structural reasons.
func commodityCloneKnights(s *engine.State, cur engine.PlayerID) *engine.State {
	rich := s.Clone()
	x, ok := rich.Ext[knights.Name].(*knights.Ext)
	if !ok {
		return rich
	}
	for c := range x.Players[cur].Commodities {
		x.Players[cur].Commodities[c] = 30
	}
	return rich
}

func fundedCloneKnights(s *engine.State, cur engine.PlayerID) *engine.State {
	rich := s.Clone()
	for r := range rich.Players[cur].Hand {
		rich.Players[cur].Hand[r] = 30
	}
	return rich
}

func assertVerts(t *testing.T, seed uint64, name string, s, rich *engine.State, offered []board.Vertex, ct engine.CommandType, ok func(error) bool) {
	t.Helper()
	set := map[board.Vertex]bool{}
	for _, v := range offered {
		set[v] = true
	}
	for _, v := range allVertsKnights(s) {
		_, err := engine.Decide(rich, engine.Command{Player: s.Cur, Type: ct, Data: jsonKnights(map[string]any{"v": v})})
		if set[v] != ok(err) {
			t.Errorf("seed %d: %s %v offered=%v validator=%v (err=%v)", seed, name, v, set[v], ok(err), err)
		}
	}
}

// assertVertsForSeat checks an owed-placement set for an arbitrary seat (the
// owing player may not be the current one), using the command's vertex key.
func assertVertsForSeat(t *testing.T, seed uint64, name string, s, rich *engine.State, seat engine.PlayerID, offered []board.Vertex, ct engine.CommandType, key string) {
	t.Helper()
	set := map[board.Vertex]bool{}
	for _, v := range offered {
		set[v] = true
	}
	for _, v := range allVertsKnights(s) {
		_, err := engine.Decide(rich, engine.Command{Player: seat, Type: ct, Data: jsonKnights(map[string]any{key: v})})
		if set[v] != (err == nil) {
			t.Errorf("seed %d: %s seat %d %v offered=%v validator=%v (err=%v)", seed, name, seat, v, set[v], err == nil, err)
		}
	}
}

func assertEdges(t *testing.T, seed uint64, name string, s, rich *engine.State, offered []board.Edge, ct engine.CommandType, ok func(error) bool) {
	t.Helper()
	set := map[board.Edge]bool{}
	for _, e := range offered {
		set[e] = true
	}
	for _, e := range allEdgesKnights(s) {
		_, err := engine.Decide(rich, engine.Command{Player: s.Cur, Type: ct, Data: jsonKnights(map[string]any{"e": e})})
		if set[e] != ok(err) {
			t.Errorf("seed %d: %s %v offered=%v validator=%v (err=%v)", seed, name, e, set[e], ok(err), err)
		}
	}
}

func assertHexes(t *testing.T, seed uint64, name string, s, rich *engine.State, offered []board.Hex, ct engine.CommandType, ok func(error) bool) {
	t.Helper()
	set := map[board.Hex]bool{}
	for _, h := range offered {
		set[h] = true
	}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		_, err := engine.Decide(rich, engine.Command{Player: s.Cur, Type: ct, Data: jsonKnights(map[string]any{"hex": h})})
		if set[h] != ok(err) {
			t.Errorf("seed %d: %s %v offered=%v validator=%v (err=%v)", seed, name, h, set[h], ok(err), err)
		}
	}
}

func allVertsKnights(s *engine.State) []board.Vertex {
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

func allEdgesKnights(s *engine.State) []board.Edge {
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
