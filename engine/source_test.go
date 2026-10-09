package engine

import (
	"math/rand/v2"
	"testing"
)

// playLogForProvenance runs one random game and returns its event log, reusing
// the same random-playout driver the determinism suite uses.
func playLogForProvenance(t *testing.T, seed uint64) []Event {
	t.Helper()
	log, err := New(GameConfig{Players: 3}, SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := Empty()
	for _, e := range log {
		if err := Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	rng := rand.New(rand.NewPCG(seed, 4242))
	apply := func(cmd Command) bool {
		events, err := Decide(s, cmd)
		if err != nil {
			return false
		}
		for _, e := range events {
			if err := Apply(s, e); err != nil {
				t.Fatalf("apply %s: %v", e.Type, err)
			}
		}
		log = append(log, events...)
		return true
	}
	for step := 0; s.Phase != PhaseFinished && step < 1500; step++ {
		if !advanceRandomly(t, s, rng, apply) {
			break
		}
	}
	return log
}

// TestApplyIgnoresSource: the fold must produce the same state whatever an event
// claims about who caused it, or replay(eventLog) == live state would depend on a
// field the engine should not know. Replays one log twice with wrong and mutually
// contradictory provenance and requires identical states.
func TestApplyIgnoresSource(t *testing.T) {
	log := playLogForProvenance(t, 7)
	if len(log) < 20 {
		t.Fatalf("log too short to be a meaningful test: %d events", len(log))
	}

	clone := func(src func(i int) Source) []Event {
		out := make([]Event, len(log))
		copy(out, log)
		for i := range out {
			out[i].Src = src(i)
			// Payload is a cache of Data and survives the copy; nothing here
			// touches Data, so the two stay in agreement.
		}
		return out
	}

	allHuman, err := Replay(clone(func(int) Source { return SourceHuman }))
	if err != nil {
		t.Fatalf("replay (all human): %v", err)
	}
	// Every source the vocabulary has, cycled event by event, including the
	// zero value an old log carries.
	rotating, err := Replay(clone(func(i int) Source { return Source(i % 7) }))
	if err != nil {
		t.Fatalf("replay (rotating): %v", err)
	}
	unstamped, err := Replay(clone(func(int) Source { return SourceUnrecorded }))
	if err != nil {
		t.Fatalf("replay (unstamped): %v", err)
	}

	assertStatesEqual(t, allHuman, rotating)
	assertStatesEqual(t, allHuman, unstamped)
}

// TestDecideLeavesSourceUnset: the engine must not invent provenance. Decide's
// events come out unstamped; the game layer stamps them.
func TestDecideLeavesSourceUnset(t *testing.T) {
	log := playLogForProvenance(t, 11)
	for _, e := range log {
		if e.Src != SourceUnrecorded {
			t.Fatalf("engine stamped %s at seq %d with source %s, want unrecorded",
				e.Type, e.Seq, e.Src)
		}
	}
}

func TestStampSourceMarksWholeBatch(t *testing.T) {
	events := []Event{{Seq: 1}, {Seq: 2}, {Seq: 3}}
	StampSource(events, SourceBotTakeover)
	for _, e := range events {
		if e.Src != SourceBotTakeover {
			t.Fatalf("seq %d: got %s, want bot_takeover", e.Seq, e.Src)
		}
	}
}

// TestSourcePredicates pins the two questions readers of the log ask. An old,
// unstamped event must not read as a human decision.
func TestSourcePredicates(t *testing.T) {
	cases := []struct {
		src         Source
		name        string
		human       bool
		serverActed bool
	}{
		{SourceUnrecorded, "unrecorded", false, false},
		{SourceHuman, "human", true, false},
		{SourceTimeout, "timeout", false, true},
		{SourceAuto, "auto", false, true},
		{SourceBot, "bot", false, true},
		{SourceBotTakeover, "bot_takeover", false, true},
		{SourceServer, "server", false, true},
	}
	for _, c := range cases {
		if got := c.src.String(); got != c.name {
			t.Errorf("Source(%d).String() = %q, want %q", c.src, got, c.name)
		}
		if got := c.src.Human(); got != c.human {
			t.Errorf("%s.Human() = %v, want %v", c.name, got, c.human)
		}
		if got := c.src.ServerActed(); got != c.serverActed {
			t.Errorf("%s.ServerActed() = %v, want %v", c.name, got, c.serverActed)
		}
	}
}
