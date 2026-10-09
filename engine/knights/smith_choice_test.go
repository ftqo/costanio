package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// smithBoard puts three of p's knights on free vertices at the given levels and
// hands p a Smith card.
func smithBoard(t *testing.T, s *engine.State, p engine.PlayerID, levels ...int) []board.Vertex {
	t.Helper()
	x := ext(s)
	vs := nFreeVertices(s, x, board.Vertex{}, len(levels))
	if len(vs) < len(levels) {
		fixtureGone(t, "board too small")
	}
	for i, lv := range levels {
		x.Knights[vs[i]] = Knight{Owner: p, Level: lv}
	}
	x.Players[p].Progress = []ProgressCard{CardSmith}
	return vs
}

// The Smith promotes the knights the player names; 1 -> 2 and 2 -> 3 are worth
// very different things.
func TestSmithPromotesTheKnightsNamed(t *testing.T) {
	s, _ := newGame(t, 41, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	vs := smithBoard(t, s, p, 1, 1, 1)

	// Two basic pieces per player means three basics cannot happen in a game, but
	// the pick is what is tested: name the last two and check the first is
	// untouched.
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[1], vs[2]}})})
	if x.Knights[vs[0]].Level != 1 {
		t.Errorf("knight the player did not name went up: %d", x.Knights[vs[0]].Level)
	}
	if x.Knights[vs[1]].Level != 2 || x.Knights[vs[2]].Level != 2 {
		t.Errorf("named knights = %d, %d, want 2, 2", x.Knights[vs[1]].Level, x.Knights[vs[2]].Level)
	}
}

// One name is a legal play: the card promotes UP TO two.
func TestSmithPromotesOneNamedKnight(t *testing.T) {
	s, _ := newGame(t, 41, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	vs := smithBoard(t, s, p, 1, 1)

	events := step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[1]}})})
	promotions := 0
	for _, e := range events {
		if e.Type == EvKnightPromoted {
			promotions++
		}
	}
	if promotions != 1 {
		t.Errorf("promotions = %d, want 1", promotions)
	}
	if x.Knights[vs[0]].Level != 1 || x.Knights[vs[1]].Level != 2 {
		t.Errorf("levels = %d, %d, want 1, 2", x.Knights[vs[0]].Level, x.Knights[vs[1]].Level)
	}
}

// No names means board order, which is how older logs replay and what a client
// without a picker sends.
func TestSmithWithoutNamesKeepsBoardOrder(t *testing.T) {
	s, _ := newGame(t, 41, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	vs := smithBoard(t, s, p, 1, 1, 1)

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardSmith})})
	if x.Knights[vs[0]].Level != 2 || x.Knights[vs[1]].Level != 2 {
		t.Errorf("board order should raise the first two: %d, %d", x.Knights[vs[0]].Level, x.Knights[vs[1]].Level)
	}
	if x.Knights[vs[2]].Level != 1 {
		t.Errorf("third knight = %d, want 1", x.Knights[vs[2]].Level)
	}
}

// A named knight that cannot go up gets an error naming why, not a silent
// substitution.
func TestSmithRejectsIneligibleNames(t *testing.T) {
	base := func(t *testing.T, levels ...int) (*engine.State, engine.PlayerID, []board.Vertex) {
		t.Helper()
		s, _ := newGame(t, 41, nil)
		rolled(t, s)
		p := s.Cur
		return s, p, smithBoard(t, s, p, levels...)
	}

	t.Run("not yours", func(t *testing.T) {
		s, p, vs := base(t, 1, 1)
		q := (p + 1) % engine.PlayerID(len(s.Players))
		ext(s).Knights[vs[1]] = Knight{Owner: q, Level: 1}
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[1]}})}, ErrNoKnight)
	})

	t.Run("already mighty", func(t *testing.T) {
		s, p, vs := base(t, 3, 1)
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[0]}})}, ErrKnightState)
	})

	t.Run("mighty needs politics 3", func(t *testing.T) {
		s, p, vs := base(t, 2, 1)
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[0]}})}, ErrMightyNeedsFort)
	})

	t.Run("already promoted this turn", func(t *testing.T) {
		s, p, vs := base(t, 1, 1)
		x := ext(s)
		k := x.Knights[vs[0]]
		k.PromotedThisTurn = true
		x.Knights[vs[0]] = k
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[0]}})}, ErrAlreadyPromoted)
	})

	t.Run("destination tier full", func(t *testing.T) {
		// Two strong knights already exist, so neither basic can be promoted; naming
		// one must fail rather than promote the other.
		s, p, vs := base(t, 1, 1, 2, 2)
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[0]}})}, engine.ErrNoPieces)
	})

	t.Run("both names into a tier with one slot", func(t *testing.T) {
		// One strong piece is spare: the first name takes it, the second has nothing
		// left, and the play is refused whole.
		s, p, vs := base(t, 1, 1, 2)
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[0], vs[1]}})}, engine.ErrNoPieces)
	})

	t.Run("same knight twice", func(t *testing.T) {
		s, p, vs := base(t, 1, 1)
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[0], vs[0]}})}, engine.ErrBadCommand)
	})

	t.Run("more than two", func(t *testing.T) {
		s, p, vs := base(t, 1, 1, 1)
		reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardSmith, "knights": []board.Vertex{vs[0], vs[1], vs[2]}})}, engine.ErrBadCommand)
	})
}
