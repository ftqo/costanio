package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
)

// TestReadPoolSizeProbe is the measurement behind readPoolConns. It drives
// concurrent readers against a saturated writer across pool sizes, reporting
// read latency and the writer's commit rate, which trade against each other.
//
// Skipped by default. Run with:
//
//	ROPROBE=1 go test ./store -run ReadPoolSizeProbe -v -timeout 10m
func TestReadPoolSizeProbe(t *testing.T) {
	if os.Getenv("ROPROBE") == "" {
		t.Skip("probe; set ROPROBE=1 to run")
	}

	path := t.TempDir() + "/pool.db"
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

	// Saturate the writer for the whole probe.
	stop := make(chan struct{})
	var commits atomic.Int64
	var wg sync.WaitGroup
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
	defer func() { close(stop); wg.Wait() }()
	time.Sleep(500 * time.Millisecond)

	// run drives `readers` concurrent goroutines calling f for `window`, and
	// reports the pooled latency distribution and the writer's commit rate.
	run := func(readers int, window time.Duration, f func() error) (p50, p99 time.Duration, rps, wps float64) {
		var mu sync.Mutex
		var all []time.Duration
		c0 := commits.Load()
		deadline := time.Now().Add(window)
		var rwg sync.WaitGroup
		for range readers {
			rwg.Go(func() {
				var local []time.Duration
				for time.Now().Before(deadline) {
					t0 := time.Now()
					if err := f(); err != nil {
						return
					}
					local = append(local, time.Since(t0))
				}
				mu.Lock()
				all = append(all, local...)
				mu.Unlock()
			})
		}
		rwg.Wait()
		dc := float64(commits.Load() - c0)
		slices.Sort(all)
		if len(all) == 0 {
			return 0, 0, 0, 0
		}
		secs := window.Seconds()
		return all[len(all)/2], all[min(int(float64(len(all))*0.99), len(all)-1)],
			float64(len(all)) / secs, dc / secs
	}

	cheap := func() error { _, err := s.GameByID("g007"); return err }
	scan := func() error { _, err := s.LoadEvents("g007", 0); return err }

	orig := s.rdb
	defer func() { s.rdb = orig }()

	fmt.Printf("\n%-24s | %-6s | %10s | %10s | %10s | %10s\n",
		"config", "pool", "read p50", "read p99", "reads/s", "commits/s")
	fmt.Printf("-------------------------+--------+------------+------------+------------+-----------\n")

	type cfg struct {
		label   string
		readers int
		window  time.Duration
		f       func() error
	}
	for _, c := range []cfg{
		{"cheap, 8 readers", 8, 2 * time.Second, cheap},
		{"scan, 2 readers", 2, 2 * time.Second, scan},
	} {
		// shared (pre-change)
		s.rdb = s.db
		p50, p99, rps, wps := run(c.readers, c.window, c.f)
		fmt.Printf("%-24s | %-6s | %10v | %10v | %10.0f | %10.0f\n", c.label, "shared", p50, p99, rps, wps)
		for _, n := range []int{1, 2, 4, 8, 16} {
			rdb, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&mode=ro")
			if err != nil {
				t.Fatal(err)
			}
			rdb.SetMaxOpenConns(n)
			rdb.SetMaxIdleConns(n)
			rdb.SetConnMaxIdleTime(0)
			rdb.SetConnMaxLifetime(0)
			s.rdb = rdb
			p50, p99, rps, wps := run(c.readers, c.window, c.f)
			fmt.Printf("%-24s | %-6d | %10v | %10v | %10.0f | %10.0f\n", c.label, n, p50, p99, rps, wps)
			rdb.Close()
		}
	}
}
