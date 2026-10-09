package store

import (
	"errors"
	"sync"
	"time"

	"github.com/ftqo/costan.io/engine"
)

// ErrStoreClosed is returned by AppendEvents when the store has already been
// closed. Every other path in this package surfaces a post-Close call as
// "sql: database is closed"; this makes the event-append path behave the same
// way instead of panicking.
var ErrStoreClosed = errors.New("store: closed")

// The event-append path is funneled through a single writer goroutine that
// coalesces whatever appends are pending into one transaction (group commit).
// Under light load an append commits on its own; under heavy load many games'
// appends ride in a single transaction, so per-action transaction overhead and
// single-connection serialization stop scaling with game count.
const (
	writerQueueDepth = 1024 // pending appends before AppendEvents blocks (backpressure)
	maxBatchReqs     = 256  // cap per transaction so a batch can't grow unbounded
)

type appendReq struct {
	gameID string
	events []engine.Event
	done   chan error // buffered(1); receives the batch's result
}

type writer struct {
	reqs chan appendReq
	done chan struct{} // closed when the loop has exited

	// mu guards reqs against its own close (a send on a closed channel
	// panics). submit holds it for read across the send.
	mu      sync.RWMutex
	stopped bool
}

// submit hands one append to the writer and waits for its transaction's result.
//
// After Close it returns ErrStoreClosed instead of panicking, for the
// degraded-shutdown case in game.Manager.StopAll where an actor outlives the
// manager.
func (w *writer) submit(req appendReq) error {
	w.mu.RLock()
	if w.stopped {
		w.mu.RUnlock()
		return ErrStoreClosed
	}
	w.reqs <- req
	w.mu.RUnlock()
	return <-req.done
}

func (s *Store) startWriter() {
	s.w = &writer{reqs: make(chan appendReq, writerQueueDepth), done: make(chan struct{})}
	go s.writerLoop()
}

// stopWriter closes the queue and waits for the loop to flush everything already
// enqueued and exit. Callers must ensure no AppendEvents runs concurrently with
// or after stopWriter (Close runs after all actors are stopped).
func (s *Store) stopWriter() {
	if s.w == nil {
		return
	}
	// The write lock waits out every in-flight submit (each holds the read lock
	// across its send), so no send can be in progress when the channel closes.
	// A submit that arrives afterwards sees stopped and gets ErrStoreClosed.
	s.w.mu.Lock()
	s.w.stopped = true
	close(s.w.reqs)
	s.w.mu.Unlock()
	<-s.w.done
}

func (s *Store) writerLoop() {
	defer close(s.w.done)
	for {
		first, ok := <-s.w.reqs
		if !ok {
			return
		}
		batch := append(make([]appendReq, 0, maxBatchReqs), first)
		batch, closed := drainReqs(s.w.reqs, batch)
		err := s.writeBatch(batch)
		for _, r := range batch {
			r.done <- err
		}
		if closed {
			return
		}
	}
}

// drainReqs greedily pulls every request already queued onto the batch (up to
// maxBatchReqs) without blocking, so the batch is as large as the current load
// offers. closed reports that the queue was closed mid-drain.
func drainReqs(reqs <-chan appendReq, batch []appendReq) (out []appendReq, closed bool) {
	for len(batch) < maxBatchReqs {
		select {
		case r, ok := <-reqs:
			if !ok {
				return batch, true
			}
			batch = append(batch, r)
		default:
			return batch, false
		}
	}
	return batch, false
}

// writeBatch commits every request's events in one transaction. One actor per
// game means at most one request per game per batch, so each game's append is
// independent. Any failure rolls back the whole transaction and is returned to
// every request in the batch. Per-request errors (contiguity) are caught in
// AppendEvents before enqueue, so what remains here is transaction-level, such
// as a full disk.
func (s *Store) writeBatch(batch []appendReq) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	// Collect every game's column binds, then emit them as a few multi-row
	// INSERTs: modernc/sqlite recompiles a statement on every Exec, so fewer
	// statements means less parsing.
	args := make([]any, 0, len(batch)*insertParamsPerRow)
	gameIDs := make([]string, 0, len(batch))
	for _, r := range batch {
		args, err = appendEventsTx(args, r.gameID, r.events, now)
		if err != nil {
			return err
		}
		gameIDs = append(gameIDs, r.gameID)
	}
	if err := batchedInsert(tx, gameIDs, args); err != nil {
		return err
	}
	return tx.Commit()
}
