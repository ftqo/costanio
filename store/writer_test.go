package store

import (
	"encoding/json"
	"sync"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestDrainReqsDefaultBranch: with nothing queued, drainReqs returns the seed
// batch immediately via the select default (not closed).
func TestDrainReqsDefaultBranch(t *testing.T) {
	reqs := make(chan appendReq, 4)
	out, closed := drainReqs(reqs, []appendReq{{gameID: "seed"}})
	if closed {
		t.Error("drainReqs reported closed on an open empty channel")
	}
	if len(out) != 1 {
		t.Errorf("drainReqs len = %d, want 1 (only the seed)", len(out))
	}
}

// TestDrainReqsPullsQueued: queued requests are greedily appended.
func TestDrainReqsPullsQueued(t *testing.T) {
	reqs := make(chan appendReq, 4)
	reqs <- appendReq{gameID: "a"}
	reqs <- appendReq{gameID: "b"}
	out, closed := drainReqs(reqs, []appendReq{{gameID: "seed"}})
	if closed {
		t.Error("drainReqs reported closed on an open channel")
	}
	if len(out) != 3 {
		t.Errorf("drainReqs len = %d, want 3 (seed + 2 queued)", len(out))
	}
}

// TestDrainReqsClosedMidDrain: a closed channel mid-drain sets closed=true.
func TestDrainReqsClosedMidDrain(t *testing.T) {
	reqs := make(chan appendReq, 4)
	reqs <- appendReq{gameID: "a"}
	close(reqs)
	out, closed := drainReqs(reqs, []appendReq{{gameID: "seed"}})
	if !closed {
		t.Error("drainReqs did not report closed after channel close")
	}
	// The one queued item is drained before the close is observed.
	if len(out) != 2 {
		t.Errorf("drainReqs len = %d, want 2", len(out))
	}
}

// TestWriterGroupCommit pushes many concurrent appends (distinct games) so the
// writer loop coalesces several into one batch, and checks every append
// becomes durable.
func TestWriterGroupCommit(t *testing.T) {
	s := openTest(t)
	host, _ := s.CreateGuest("host")

	const n = 20
	ids := make([]string, n)
	for i := range n {
		id := "g" + string(rune('a'+i))
		ids[i] = id
		g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: host.ID}
		if err := s.CreateGame(g); err != nil {
			t.Fatal(err)
		}
	}

	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = s.AppendEvents(ids[i], []engine.Event{
				{Seq: 0, Type: "created", Data: json.RawMessage(`{}`)},
			})
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Errorf("append %s failed: %v", ids[i], err)
		}
		got, _ := s.LoadEvents(ids[i], 0)
		if len(got) != 1 {
			t.Errorf("game %s persisted %d events, want 1", ids[i], len(got))
		}
	}
}
