package sim

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
)

// TestFullGameLogCarriesProvenance: a whole game played through the real
// pipeline (actor -> store -> SQLite) comes back off disk with every row saying
// who caused it. A bot-only sim is the strictest case: every move is the
// server's and none may read as a person's.
//
// It also checks that the same log with provenance stripped folds to the
// identical final state: the fold doesn't read Src, so older logs without it
// replay unchanged.
func TestFullGameLogCarriesProvenance(t *testing.T) {
	st := openStore(t)
	res, err := RunGame(st, Options{
		Players:  4,
		Ruleset:  "base",
		TargetVP: 8,
		Seed:     42,
		Timeout:  60 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}

	events, err := Transcript(st, res.GameID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 30 {
		t.Fatalf("suspiciously short game: %d events", len(events))
	}
	counts := map[engine.Source]int{}
	for _, e := range events {
		counts[e.Src]++
		switch e.Src {
		case engine.SourceUnrecorded:
			t.Fatalf("seq %d (%s) came back from SQLite with no provenance", e.Seq, e.Type)
		case engine.SourceHuman:
			t.Fatalf("seq %d (%s) is attributed to a human in an all-bot game", e.Seq, e.Type)
		default:
			// Every other source is legitimate here: a bot moving, the server
			// dealing, a timer or auto-pass on a bot's seat. This only guards
			// against the two that can't occur in a simulated game.
		}
	}
	if counts[engine.SourceBot] == 0 {
		t.Error("no bot-sourced events in an all-bot game")
	}
	if counts[engine.SourceServer] == 0 {
		t.Error("the opening deal is not attributed to the server")
	}

	// Provenance is carried by the log, never read by the fold.
	stripped := make([]engine.Event, len(events))
	copy(stripped, events)
	for i := range stripped {
		stripped[i].Src = engine.SourceUnrecorded
	}
	withProv, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	without, err := engine.Replay(stripped)
	if err != nil {
		t.Fatal(err)
	}
	if withProv.Winner != without.Winner || withProv.NextSeq != without.NextSeq {
		t.Fatalf("replay diverged once provenance was stripped: winner %d/%d, seq %d/%d",
			withProv.Winner, without.Winner, withProv.NextSeq, without.NextSeq)
	}
}
