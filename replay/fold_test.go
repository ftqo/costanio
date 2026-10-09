package replay_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/replay"
	"github.com/ftqo/costan.io/sim"
	"github.com/ftqo/costan.io/store"
)

// A real log, played end to end; a hand-built log would only prove that Fold
// loops.
func playedGame(t *testing.T) (string, []engine.Event) {
	t.Helper()
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	res, err := sim.RunGame(st, sim.Options{Players: 2, Ruleset: "base", Seed: 4242})
	if err != nil {
		t.Fatal(err)
	}
	events, err := st.LoadEvents(res.GameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	return res.GameID, events
}

// The board shown at the end of a replay must be the board the engine says the
// log produces.
func TestFoldEndsWhereReplayDoes(t *testing.T) {
	id, events := playedGame(t)

	file, err := replay.Fold(id, events, game.Spectator)
	if err != nil {
		t.Fatalf("fold: %v", err)
	}
	if len(file.Frames) != len(events) {
		t.Fatalf("frames = %d, want one per event (%d)", len(file.Frames), len(events))
	}

	want, err := engine.Replay(events)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	got, _ := json.Marshal(file.Frames[len(file.Frames)-1].View)
	expect, _ := json.Marshal(game.NewFullView(want, game.Spectator))
	if string(got) != string(expect) {
		t.Error("the last frame is not the state replay(log) arrives at")
	}
}

// Every frame carries a board. A nil view renders as an empty ocean mid-game.
func TestFoldFillsEveryFrame(t *testing.T) {
	id, events := playedGame(t)
	file, err := replay.Fold(id, events, game.Spectator)
	if err != nil {
		t.Fatalf("fold: %v", err)
	}
	for i, f := range file.Frames {
		if f.View == nil {
			t.Fatalf("frame %d (%s) has no view", i, f.Type)
		}
		if f.Seq != events[i].Seq || f.Type != events[i].Type {
			t.Fatalf("frame %d is %d/%s, want %d/%s", i, f.Seq, f.Type, events[i].Seq, events[i].Type)
		}
	}
	// The board arrives a few events in (the seed and config draw nothing), and
	// every frame after it has one. `useReplay`'s bounds skip the tileless frames.
	dealt := -1
	for i, f := range file.Frames {
		if f.View.Board != nil && len(f.View.Board.Tiles) > 0 {
			dealt = i
			break
		}
	}
	if dealt < 0 {
		t.Fatal("no frame ever has a dealt board")
	}
	for i := dealt; i < len(file.Frames); i++ {
		if b := file.Frames[i].View.Board; b == nil || len(b.Tiles) == 0 {
			t.Fatalf("frame %d lost the board after it was dealt", i)
		}
	}
}

// Meta describes the frames rather than the caller's hopes about them.
func TestFoldMetaFromLog(t *testing.T) {
	id, events := playedGame(t)
	file, err := replay.Fold(id, events, game.Spectator)
	if err != nil {
		t.Fatalf("fold: %v", err)
	}
	m := file.Meta
	if m.GameID != id {
		t.Errorf("game id = %q, want %q", m.GameID, id)
	}
	if m.Players != 2 {
		t.Errorf("players = %d, want 2", m.Players)
	}
	if m.Ruleset != "base" {
		t.Errorf("ruleset = %q, want base", m.Ruleset)
	}
	if m.Events != len(events) {
		t.Errorf("events = %d, want %d", m.Events, len(events))
	}
	if len(m.Scores) != 2 {
		t.Fatalf("scores = %v, want one per seat", m.Scores)
	}
	// The seed is the audit trail (docs/dice.md): a player checks the dice against
	// the commitment shown during the game.
	if m.Seed == nil {
		t.Error("a raw log carries the seed and the fold dropped it")
	}
	final := file.Frames[len(file.Frames)-1].View
	if m.Winner != int(final.Winner) {
		t.Errorf("meta winner = %d, final view says %d", m.Winner, final.Winner)
	}
}

// The same log folds to different frames per viewer, so a player gets their own
// hand back without anyone else seeing it.
func TestFoldRedactsPerViewer(t *testing.T) {
	id, events := playedGame(t)

	seat0, err := replay.Fold(id, events, engine.PlayerID(0))
	if err != nil {
		t.Fatalf("fold as seat 0: %v", err)
	}
	spectator, err := replay.Fold(id, events, game.Spectator)
	if err != nil {
		t.Fatalf("fold as spectator: %v", err)
	}

	held := func(f *replay.File, seat int) bool {
		for _, fr := range f.Frames {
			for _, p := range fr.View.Players {
				if int(p.Seat) == seat && p.Hand != nil {
					return true
				}
			}
		}
		return false
	}
	if !held(seat0, 0) {
		t.Error("seat 0 never sees its own hand in its own replay")
	}
	if held(seat0, 1) {
		t.Error("seat 0 can see seat 1's hand")
	}
	if held(spectator, 0) || held(spectator, 1) {
		t.Error("a spectator can see a hand")
	}
}

// A spectator's download is still watchable, which the upload feature relies on.
//
// The redacted log has no seed, but the log records outcomes: the board is in
// `board_generated`, every roll is its own event, and Apply never reads the
// seed. So it folds to exactly what a spectator saw, frame for frame. Only the
// seed audit is lost.
func TestRedactedLogFoldsToSpectatorView(t *testing.T) {
	id, events := playedGame(t)
	redacted := make([]engine.Event, len(events))
	for i, ev := range events {
		redacted[i] = game.RedactEvent(ev, game.Spectator)
	}

	raw, err := replay.Fold(id, events, game.Spectator)
	if err != nil {
		t.Fatalf("fold raw: %v", err)
	}
	red, err := replay.Fold(id, redacted, game.Spectator)
	if err != nil {
		t.Fatalf("fold redacted: %v", err)
	}
	if len(red.Frames) != len(raw.Frames) {
		t.Fatalf("redacted fold has %d frames, raw has %d", len(red.Frames), len(raw.Frames))
	}
	for i := range raw.Frames {
		a, _ := json.Marshal(raw.Frames[i].View)
		b, _ := json.Marshal(red.Frames[i].View)
		if string(a) != string(b) {
			t.Fatalf("frame %d (%s) differs between a raw log and its redaction", i, raw.Frames[i].Type)
		}
	}
	if raw.Meta.Seed == nil {
		t.Error("the raw log lost its seed")
	}
	if red.Meta.Seed != nil {
		t.Error("the redacted log reported a seed it does not carry")
	}
}

// Why an upload is folded as a spectator, never as a seat: the frames above
// match because a spectator sees no hands, but the state does not. A redacted
// `card_stolen` doesn't say which resource moved, so a seat view would show the
// wrong cards. If this starts failing because the two agree, redaction has
// stopped hiding something.
func TestSeatViewOfRedactedLogDiverges(t *testing.T) {
	id, events := playedGame(t)
	redacted := make([]engine.Event, len(events))
	for i, ev := range events {
		redacted[i] = game.RedactEvent(ev, game.Spectator)
	}

	raw, err := replay.Fold(id, events, engine.PlayerID(0))
	if err != nil {
		t.Fatalf("fold raw: %v", err)
	}
	red, err := replay.Fold(id, redacted, engine.PlayerID(0))
	if err != nil {
		t.Fatalf("fold redacted: %v", err)
	}
	for i := range raw.Frames {
		a, _ := json.Marshal(raw.Frames[i].View)
		b, _ := json.Marshal(red.Frames[i].View)
		if string(a) != string(b) {
			return // diverged, as it must
		}
	}
	t.Fatal("seat view identical for redacted and full logs")
}

func TestFoldRefusesAnEmptyLog(t *testing.T) {
	if _, err := replay.Fold("g", nil, game.Spectator); !errors.Is(err, replay.ErrEmpty) {
		t.Fatalf("error = %v, want ErrEmpty", err)
	}
}

// The revealed fold shows every hand; the spectator fold shows none. Pinned
// both ways so a reveal that stops revealing fails.
func TestFoldRevealedShowsEveryHand(t *testing.T) {
	id, events := playedGame(t)

	plain, err := replay.Fold(id, events, game.Spectator)
	if err != nil {
		t.Fatalf("Fold: %v", err)
	}
	last := plain.Frames[len(plain.Frames)-1].View
	for seat, p := range last.Players {
		if p.Hand != nil {
			t.Errorf("a spectator fold hands seat %d a hand", seat)
		}
	}

	shown, err := replay.FoldRevealed(id, events)
	if err != nil {
		t.Fatalf("FoldRevealed: %v", err)
	}
	revealed := shown.Frames[len(shown.Frames)-1].View
	if len(revealed.Players) == 0 {
		t.Fatal("no players in the folded view")
	}
	for seat, p := range revealed.Players {
		if p.Hand == nil {
			t.Errorf("seat %d has no hand in a revealed fold", seat)
		}
		if p.DevCards == nil {
			t.Errorf("seat %d has no dev cards in a revealed fold", seat)
		}
	}
	// The revealed hands must match the counts the spectator fold published, or
	// the panel and the seat rail disagree.
	for seat := range revealed.Players {
		if got, want := revealed.Players[seat].Hand.Count(), last.Players[seat].HandCount; got != want {
			t.Errorf("seat %d: revealed hand holds %d, the public count says %d", seat, got, want)
		}
	}
}

// The module half of the reveal: every seat's fish tiles.
//
// game.NewRevealedReplayView builds a spectator view and patches the fields it
// knows (Hand, DevCards, VP). A module's per-seat private data lives in its own
// ext view behind a `viewer >= 0` gate, so a module has to opt in through
// engine.RevealedViewable; this checks the opt-in is honoured.
func TestFoldRevealedShowsEverySeatsFishTiles(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	// A seed sweep: whether anyone ends a game still holding a tile is luck.
	// It fails rather than skips when the budget runs out.
	var events []engine.Event
	var gameID string
	for seed := uint64(1); seed <= 12 && gameID == ""; seed++ {
		res, err := sim.RunGame(st, sim.Options{Players: 4, Ruleset: "base+fishermen", Seed: seed})
		if err != nil {
			continue
		}
		evs, err := st.LoadEvents(res.GameID, 0)
		if err != nil {
			t.Fatal(err)
		}
		s, err := engine.Replay(evs)
		if err != nil {
			t.Fatal(err)
		}
		x, ok := scenarios.FishStateExt(s)
		if !ok {
			t.Fatal("fishermen module not active")
		}
		for _, m := range x.Held {
			if m != ([3]int{}) {
				gameID, events = res.GameID, evs
				break
			}
		}
	}
	if gameID == "" {
		t.Fatal("no seeded fishermen game ended with a seat holding a tile")
	}

	// A spectator's fold has no seat's mix, which is correct during a game but
	// not for a finished one.
	plain, err := replay.Fold(gameID, events, game.Spectator)
	if err != nil {
		t.Fatalf("Fold: %v", err)
	}
	if ext, ok := plain.Frames[len(plain.Frames)-1].View.Ext["fishermen"].(map[string]any); !ok {
		t.Fatal("no fishermen ext in the spectator fold")
	} else if _, leaked := ext["mixes"]; leaked {
		t.Error("a SPECTATOR fold published every seat's fish mix")
	}

	shown, err := replay.FoldRevealed(gameID, events)
	if err != nil {
		t.Fatalf("FoldRevealed: %v", err)
	}
	view := shown.Frames[len(shown.Frames)-1].View
	ext, ok := view.Ext["fishermen"].(map[string]any)
	if !ok {
		t.Fatalf("no fishermen ext in the revealed fold: %#v", view.Ext)
	}
	mixes, ok := ext["mixes"].([][3]int)
	if !ok {
		t.Fatalf("revealed fold mixes = %#v", ext["mixes"])
	}
	if len(mixes) != len(view.Players) {
		t.Fatalf("revealed fold has %d mixes for %d seats", len(mixes), len(view.Players))
	}
	// They must agree with the public tile counts in the same frame.
	tiles, ok := ext["tiles"].([]int)
	if !ok {
		t.Fatalf("revealed fold tiles = %#v", ext["tiles"])
	}
	held := 0
	for seat, m := range mixes {
		if got, want := m[0]+m[1]+m[2], tiles[seat]; got != want {
			t.Errorf("seat %d: revealed mix %v is %d tiles, the public count says %d", seat, m, got, want)
		}
		held += m[0] + m[1] + m[2]
	}
	if held == 0 {
		t.Error("every revealed mix is empty")
	}
}

// created is a one-event log: the opening event and nothing else, which is all
// the untrusted checks look at.
func created(config string) []engine.Event {
	return []engine.Event{{
		Seq:  0,
		Type: engine.EvGameCreated,
		Data: json.RawMessage(`{"config":` + config + `}`),
	}}
}

// The uploader chooses the numbers in the file, and the seat count sizes the
// state the fold builds: a 110-byte body claiming 1e8 seats would allocate
// 16 GB, passing the body cap and the event cap, and Go cannot recover from
// the resulting fatal error.
//
// Uses 100 seats, not 1e8, so the test is safe to run if the bound is removed.
func TestUntrustedFoldRejectsImpossibleGame(t *testing.T) {
	for _, tc := range []struct {
		name   string
		config string
	}{
		{"more seats than a game has", `{"players":100}`},
		{"no seats at all", `{"players":0}`},
		{"a board wider than any board", `{"players":2,"board":{"radius":100,"tiles":[]}}`},
		// The ruleset resolver's own bound: a repeated module must not resolve, or
		// every spelling would take an entry in a process-global cache.
		{"a ruleset repeating a module", `{"players":2,"ruleset":"base+cak+cak"}`},
		{"a ruleset with an empty part", `{"players":2,"ruleset":"base++cak"}`},
		{"a ruleset naming a module nobody has", `{"players":2,"ruleset":"base+nosuchmodule"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file, err := replay.FoldRevealedUntrusted("uploaded-game", created(tc.config))
			if err == nil {
				t.Fatalf("folded %s", tc.config)
			}
			if !errors.Is(err, replay.ErrNotAGameLog) {
				t.Errorf("error = %v, want ErrNotAGameLog", err)
			}
			if file != nil {
				t.Error("a refused fold handed back frames")
			}
			// The reply names the file so the uploader can tell which one it was.
			if !strings.Contains(err.Error(), "uploaded-game") {
				t.Errorf("error %q does not name the game", err)
			}
		})
	}

	// A plausible seat count still folds.
	if _, err := replay.FoldRevealedUntrusted("g", created(`{"players":2}`)); err != nil {
		t.Errorf("a plain two-player log no longer folds: %v", err)
	}
}

// Nothing an uploader controls may be quoted back whole: the game id and
// ruleset come from the file, and an 8 MB one would become an 8 MB message.
func TestUntrustedRefusalOmitsFile(t *testing.T) {
	huge := strings.Repeat("x", 1<<20)
	_, err := replay.FoldRevealedUntrusted(huge, created(`{"players":2,"ruleset":"base+`+huge+`"}`))
	if err == nil {
		t.Fatal("a ruleset naming a megabyte-long module resolved")
	}
	if len(err.Error()) > 1024 {
		t.Errorf("refusal is %d bytes, want a short message", len(err.Error()))
	}
}

// An engine panic mid-fold must come back as an error. There is no recover()
// in server/, so otherwise net/http just hangs up on the player.
//
// The log below panics: a seat index no seat has, in a two-player game.
func TestFoldReturnsEnginePanicAsError(t *testing.T) {
	events := append(created(`{"players":2}`), engine.Event{
		Seq:  1,
		Type: engine.EvSettlementPlace,
		Data: json.RawMessage(`{"player":5,"v":{"q":0,"r":0,"c":0}}`),
	})

	file, err := replay.Fold("g", events, game.Spectator)
	if err == nil {
		t.Fatal("a log that crashes the engine folded")
	}
	var p *replay.PanicError
	if !errors.As(err, &p) {
		t.Fatalf("error = %v (%T), want *replay.PanicError", err, err)
	}
	if file != nil {
		t.Error("a crashed fold handed back frames")
	}
	if len(p.Stack) == 0 {
		t.Error("no stack captured")
	}
	// The stack is for the operator log, never for the response body.
	if strings.Contains(p.Error(), "goroutine") {
		t.Error("Error() carries the stack trace into whatever prints it")
	}

	// The same crash on the upload path is the uploader's problem, not a 500.
	if _, err := replay.FoldRevealedUntrusted("g", events); !errors.Is(err, replay.ErrNotAGameLog) {
		t.Errorf("untrusted error = %v, want ErrNotAGameLog", err)
	}
}

// TestFoldsEveryRuleset folds every ruleset, so a module hook that runs at
// frame zero (between game_created and board_generated, which a live game never
// renders) is exercised. Caravans' RouteLength hook once dereferenced nil there.
func TestFoldsEveryRuleset(t *testing.T) {
	for _, rs := range []string{
		"base",
		"base+cak",
		"base+islands",
		"base+fishermen",
		"base+caravans",
		"base+caravans+fishermen",
		"base+cak+caravans+fishermen+islands",
	} {
		t.Run(rs, func(t *testing.T) {
			st, err := store.OpenMem()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { st.Close() })
			// A low named target: this test is about the fold, and the game only
			// has to finish (as in sim.TestRulesetsPlayToCompletion). At the
			// ruleset default, base+cak+caravans+fishermen+islands plays to 17,
			// which bots don't reach inside the harness's event cap. A named
			// target also overrides every module's adjuster.
			res, err := sim.RunGame(st, sim.Options{Players: 4, Ruleset: rs, Seed: 909, TargetVP: 8})
			if err != nil {
				t.Fatalf("%s: run: %v", rs, err)
			}
			log, err := st.LoadEvents(res.GameID, 0)
			if err != nil {
				t.Fatalf("%s: load: %v", rs, err)
			}
			f, err := replay.Fold(res.GameID, log, engine.PlayerID(0))
			if err != nil {
				t.Fatalf("%s: fold: %v", rs, err)
			}
			if len(f.Frames) != len(log) {
				t.Errorf("%s: %d frames for %d events", rs, len(f.Frames), len(log))
			}
			// Frame zero is built before the board is dealt.
			if f.Frames[0].View == nil {
				t.Errorf("%s: frame 0 has no view", rs)
			}
		})
	}
}

// A seed is a string on the wire: it is a full uint64, and the browser parses
// JSON numbers as doubles, which round anything above 2^53.
func TestMetaSeedIsAJSONString(t *testing.T) {
	seed := uint64(18242572678285395083)
	raw, err := json.Marshal(replay.Meta{Seed: &seed})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if s, ok := got["seed"].(string); !ok || s != "18242572678285395083" {
		t.Errorf("meta seed on the wire = %#v (%s), want the string \"18242572678285395083\"", got["seed"], raw)
	}
	var back replay.Meta
	if err := json.Unmarshal(raw, &back); err != nil || back.Seed == nil || *back.Seed != seed {
		t.Errorf("meta seed does not round-trip: %v, %v", back.Seed, err)
	}
}
