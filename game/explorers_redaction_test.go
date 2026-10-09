package game

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/explorers"
)

// Explorers' fog of war. Most of the board is face down and known to nobody,
// and the truth lives on the shared board that every view and event payload
// can reach, rather than in a per-seat field. So these tests play a real game,
// fold the spectator stream, and require that nothing in it names the terrain
// of a hex nobody has revealed.

// explorersGame plays a game with the engine's auto-commands (enough to reach
// play, roll and move the pirate) and returns the events and the truth state.
func explorersGame(t *testing.T, players int, seed uint64, turns int) ([]engine.Event, *engine.State) {
	t.Helper()
	evs, err := engine.New(engine.GameConfig{
		Players: players, Ruleset: explorers.Name, DiceMode: engine.DiceFair, BoardMode: board.BoardFair,
	}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	log := append([]engine.Event(nil), evs...)
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	for range turns {
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
			log = append(log, e)
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	return log, s
}

// TestSpectatorStreamHidesUnrevealedHexes searches every redacted
// payload, not a named field, for the coordinates of a hex still face down at
// that point in the log. board_generated is the event that could carry the
// whole map.
func TestSpectatorStreamHidesUnrevealedHexes(t *testing.T) {
	log, truth := explorersGame(t, 4, 3, 400)
	x, ok := explorers.StateExt(truth)
	if !ok {
		t.Fatal("no explorers ext")
	}
	if len(x.Pool) == 0 {
		t.Fatal("the pool is empty")
	}

	// Fold the public stream alongside, so "still unrevealed" is judged when
	// each event went out.
	revealed := map[board.Hex]bool{}
	for _, e := range log {
		pub := RedactEvent(e, Spectator)
		if pub.Type == engine.EvBoardGenerated {
			// The board lists every hex, fogged ones included, so a client can
			// draw them. What it says about them is checked by
			// TestRedactedBoardIsFogUntilExplored.
			continue
		}
		if pub.Type == explorers.EvHexRevealed {
			var d struct {
				H board.Hex `json:"h"`
			}
			if err := json.Unmarshal(pub.Data, &d); err != nil {
				t.Fatalf("reveal payload: %v", err)
			}
			revealed[d.H] = true
			continue
		}
		body := string(pub.Data)
		for _, p := range x.Pool {
			if revealed[p.H] {
				continue
			}
			// A payload would have to name the hex's coordinates to say anything
			// about it. board.Hex marshals as {"q":N,"r":M}.
			if strings.Contains(body, hexJSON(p.H)) {
				t.Errorf("event %d (%s) names the unrevealed hex %v: %s", pub.Seq, pub.Type, p.H, clip(body))
				break
			}
		}
	}
}

func hexJSON(h board.Hex) string {
	b, _ := json.Marshal(h)
	return string(b)
}

func clip(s string) string {
	if len(s) > 200 {
		return s[:200] + "..."
	}
	return s
}

// TestRedactedBoardIsFogUntilExplored: board_generated carries
// the whole board and, unredacted, the module's layout (every pool hex's
// region, kind, shoal number and village). The redacted form must be fog
// where nobody has looked and carry no layout.
func TestRedactedBoardIsFogUntilExplored(t *testing.T) {
	log, truth := explorersGame(t, 4, 5, 0)
	x, _ := explorers.StateExt(truth)
	var gen engine.Event
	for _, e := range log {
		if e.Type == engine.EvBoardGenerated {
			gen = e
		}
	}
	if gen.Type == "" {
		t.Fatal("no board_generated event")
	}
	if gen.Visible == nil || len(gen.Visible) != 0 {
		t.Fatalf("board_generated is visible to %v, want nobody", gen.Visible)
	}
	pub := RedactEvent(gen, Spectator)
	var d engine.BoardGeneratedData
	if err := json.Unmarshal(pub.Data, &d); err != nil {
		t.Fatalf("redacted board payload: %v", err)
	}
	if d.Board == nil {
		t.Fatal("the redacted payload carries no board")
	}
	if len(d.Ext) != 0 {
		t.Errorf("the redacted payload still carries the module layout blob: %v", d.Ext)
	}
	for _, p := range x.Pool {
		if got := d.Board.Tiles[p.H].Res; got != board.Fog {
			t.Errorf("pool hex %v is published as %v, want fog", p.H, got)
		}
		if got := d.Board.Tiles[p.H].Number; got != 0 {
			t.Errorf("pool hex %v is published with chit %d", p.H, got)
		}
	}
	// The home island is not masked: it is public from the first turn.
	for _, h := range x.Home {
		if d.Board.Tiles[h].Res == board.Fog {
			t.Errorf("home island hex %v was masked", h)
		}
	}
}

// TestRedactorSkipsOtherRulesets: a registered redactor runs on a
// public event for every viewer, and every game emits board_generated, so a
// redactor that always trimmed would blank every board.
func TestRedactorSkipsOtherRulesets(t *testing.T) {
	for _, ruleset := range []string{"base", "base+islands", "base+cak", "base+caravans", "base+fishermen"} {
		evs, err := engine.New(engine.GameConfig{
			Players: 4, Ruleset: ruleset, DiceMode: engine.DiceFair, BoardMode: board.BoardFair,
		}, engine.SeedsFrom(11))
		if err != nil {
			t.Fatalf("%s: %v", ruleset, err)
		}
		for _, e := range evs {
			if e.Type != engine.EvBoardGenerated {
				continue
			}
			if e.Visible != nil {
				t.Errorf("%s: board_generated is not public", ruleset)
			}
			pub := RedactEvent(e, Spectator)
			// Re-marshalled, so compare content rather than bytes.
			var was, now engine.BoardGeneratedData
			if err := json.Unmarshal(e.Data, &was); err != nil {
				t.Fatalf("%s: %v", ruleset, err)
			}
			if err := json.Unmarshal(pub.Data, &now); err != nil {
				t.Fatalf("%s: redacted payload: %v", ruleset, err)
			}
			if now.Board == nil || len(now.Board.Tiles) != len(was.Board.Tiles) {
				t.Errorf("%s: board trimmed by another ruleset's redactor", ruleset)
				continue
			}
			for h, tile := range was.Board.Tiles {
				if now.Board.Tiles[h] != tile {
					t.Errorf("%s: hex %v was rewritten from %v to %v", ruleset, h, tile, now.Board.Tiles[h])
				}
			}
			if len(now.Ext) != len(was.Ext) {
				t.Errorf("%s: the module layout blob was dropped: %d entries, want %d",
					ruleset, len(now.Ext), len(was.Ext))
			}
		}
	}
}

// TestSpectatorViewDrawsOnlyFog: the MaskBoard hook, through the
// real view builder.
func TestSpectatorViewDrawsOnlyFog(t *testing.T) {
	_, truth := explorersGame(t, 4, 7, 300)
	x, _ := explorers.StateExt(truth)
	for _, viewer := range []engine.PlayerID{Spectator, 0, 1} {
		v := NewFullView(truth, viewer)
		for _, p := range x.Pool {
			got := v.Board.Tiles[p.H]
			if x.Revealed[p.H] {
				if got.Res == board.Fog {
					t.Errorf("viewer %d: revealed hex %v is still drawn as fog", viewer, p.H)
				}
				continue
			}
			if got.Res != board.Fog || got.Number != 0 {
				t.Errorf("viewer %d: unrevealed hex %v is drawn as %v/%d", viewer, p.H, got.Res, got.Number)
			}
		}
		// The live board must be untouched by the masking.
		for _, p := range x.Pool {
			if truth.Board.Tiles[p.H].Res == board.Fog {
				t.Fatalf("MaskBoard wrote fog onto the LIVE board at %v", p.H)
			}
		}
	}
}

// TestModuleViewHidesFogContents: a client needs to know
// which hexes are unexplored and nothing else about them.
func TestModuleViewHidesFogContents(t *testing.T) {
	_, truth := explorersGame(t, 4, 9, 300)
	x, _ := explorers.StateExt(truth)
	view, ok := x.ViewExt(Spectator).(*explorers.ExtView)
	if !ok {
		t.Fatalf("ViewExt returned %T", x.ViewExt(Spectator))
	}
	fog := map[board.Hex]bool{}
	for _, h := range view.Fog {
		fog[h] = true
	}
	for _, p := range x.Pool {
		if x.Revealed[p.H] == fog[p.H] {
			t.Errorf("hex %v: revealed=%v but published as fog=%v", p.H, x.Revealed[p.H], fog[p.H])
		}
	}
	for _, r := range view.Revealed {
		if !x.Revealed[r.H] {
			t.Errorf("the view describes unrevealed hex %v", r.H)
		}
	}
	// Serialize it, so a later field that leaked the pool would show up as the
	// coordinates of an unrevealed hex.
	blob, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range x.Pool {
		if x.Revealed[p.H] {
			continue
		}
		body := string(blob)
		// The hex appears once, in the fog list, with no terrain or kind.
		if n := strings.Count(body, hexJSON(p.H)); n != 1 {
			t.Errorf("unrevealed hex %v appears %d times in the module view", p.H, n)
		}
	}
}
