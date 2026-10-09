package store

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
)

// TestWALGrowthProbe checks for WAL checkpoint starvation. SQLite only
// checkpoints frames older than the oldest live reader, so long reads on the
// read pool can hold the checkpoint back. This samples the -wal file under
// saturated writers with continuous long reads, to see whether growth is
// bounded by read duration.
//
// Skipped by default. Run with:
//
//	ROPROBE=1 go test ./store -run WALGrowthProbe -v -timeout 10m
func TestWALGrowthProbe(t *testing.T) {
	if os.Getenv("ROPROBE") == "" {
		t.Skip("probe; set ROPROBE=1 to run")
	}

	path := t.TempDir() + "/wal.db"
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	u, _ := s.CreateGuest("prober")

	const writers = 16
	ids := make([]string, writers)
	seq := make([]int, writers)
	for i := range ids {
		ids[i] = fmt.Sprintf("g%03d", i)
		s.CreateGame(&Game{ID: ids[i], Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID})
		for n := 0; n < 1250; n += 100 {
			batch := make([]engine.Event, 100)
			for j := range batch {
				batch[j] = engine.Event{Seq: seq[i], Type: "test", Data: json.RawMessage(`{"a":1,"b":"padding padding padding"}`)}
				seq[i]++
			}
			if err := s.AppendEvents(ids[i], batch); err != nil {
				t.Fatal(err)
			}
		}
	}

	walSize := func() int64 {
		fi, err := os.Stat(path + "-wal")
		if err != nil {
			return 0
		}
		return fi.Size()
	}

	// scenario runs saturated writers plus `readers` goroutines doing long scans
	// for `window`, sampling the WAL every 100ms.
	scenario := func(label string, readers int, window time.Duration) {
		stop := make(chan struct{})
		var wg sync.WaitGroup
		var commits atomic.Int64
		for i := range ids {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				for {
					select {
					case <-stop:
						return
					default:
					}
					batch := make([]engine.Event, 10)
					for j := range batch {
						batch[j] = engine.Event{Seq: seq[i], Type: "test", Data: json.RawMessage(`{"a":1,"b":"padding"}`)}
						seq[i]++
					}
					if s.AppendEvents(ids[i], batch) != nil {
						return
					}
					commits.Add(1)
				}
			}(i)
		}
		for range readers {
			wg.Go(func() {
				for {
					select {
					case <-stop:
						return
					default:
					}
					s.LoadEvents("g007", 0)
				}
			})
		}

		var peak int64
		deadline := time.Now().Add(window)
		for time.Now().Before(deadline) {
			if n := walSize(); n > peak {
				peak = n
			}
			time.Sleep(100 * time.Millisecond)
		}
		close(stop)
		wg.Wait()

		// Give the writer a moment with no readers holding a snapshot, then see
		// whether the WAL actually drains.
		settled := int64(-1)
		for range 20 {
			s.AppendEvents(ids[0], []engine.Event{{Seq: seq[0], Type: "t", Data: json.RawMessage(`{}`)}})
			seq[0]++
			time.Sleep(50 * time.Millisecond)
			settled = walSize()
			if settled < peak/4 {
				break
			}
		}
		fmt.Printf("%-38s peak WAL=%6.1f MiB   after quiesce=%6.1f MiB   commits=%d\n",
			label, float64(peak)/(1<<20), float64(settled)/(1<<20), commits.Load())
	}

	fmt.Printf("\n")
	orig := s.rdb
	s.rdb = s.db
	scenario("shared handle, 2 scanning readers", 2, 8*time.Second)
	s.rdb = orig
	scenario("read handle, 2 scanning readers", 2, 8*time.Second)
	scenario("read handle, 4 scanning readers", 4, 8*time.Second)
	scenario("read handle, no readers (control)", 0, 8*time.Second)
}
