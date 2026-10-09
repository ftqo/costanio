package sim

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// TestGameThroughputCeiling measures how many games can run at once: it ramps
// the number of concurrent all-bot games through one shared store and manager
// (the production topology) and measures sustained write throughput at each
// level.
//
// Each level keeps `conc` games alive for a fixed window and measures committed
// events/sec and games/sec over it, so one long game can't stall the run. Games
// play flat out (botDelay=0) with cheap bots, so the bottleneck is the
// store/actor path (chiefly the single SQLite write connection,
// store.go: SetMaxOpenConns(1)), not bot CPU. Where events/sec stops climbing
// is the ceiling.
//
// A live game at bot delay D commits ~1/D batches per second, so max
// concurrent games ≈ (commit ceiling) × D. The table prints that for D=1s and
// D=0.5s.
//
// Skipped by default. Run with:
//
//	LOADTEST=1 go test ./sim -run GameThroughputCeiling -v -timeout 10m
func TestGameThroughputCeiling(t *testing.T) {
	if os.Getenv("LOADTEST") == "" {
		t.Skip("load test; set LOADTEST=1 to run")
	}

	levels := []int{1, 2, 4, 8, 16, 32}
	const (
		playersPerGame = 4
		warmup         = 1 * time.Second
		window         = 8 * time.Second
		perGameCap     = 30 * time.Second
	)

	var peakEvps float64
	fmt.Printf("\n%4s | %9s | %9s\n", "conc", "events/s", "games/s")
	fmt.Printf("-----+-----------+----------\n")

	for _, conc := range levels {
		path := t.TempDir() + "/bench.db"
		st, err := store.Open(path)
		if err != nil {
			t.Fatalf("open store: %v", err)
		}
		mgr := game.NewManager(st, nil)
		mgr.SetBotFactory(func(engine.PlayerID) game.CommandSource { return bot.NewSimple() })

		// Separate handle for sampling/polling. Under WAL these reads run
		// concurrently with the single writer, so they don't perturb the write
		// throughput we're measuring.
		poll, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
		if err != nil {
			t.Fatalf("open poll db: %v", err)
		}
		poll.SetMaxOpenConns(8)

		// Workers keep `conc` games alive: each plays a game to completion, then
		// starts another, until stopped.
		stop := make(chan struct{})
		var wg sync.WaitGroup
		for w := range conc {
			wg.Add(1)
			go func(w int) {
				defer wg.Done()
				for seq := 0; ; seq++ {
					select {
					case <-stop:
						return
					default:
					}
					id := fmt.Sprintf("g-%d-%d-%d", conc, w, seq)
					cfg, err := seedAllBotGame(st, id, playersPerGame)
					if err != nil {
						return
					}
					if err := mgr.Start(id, cfg, engine.SeedsFrom(uint64(w)<<20|uint64(seq))); err != nil {
						return
					}
					gameDeadline := time.Now().Add(perGameCap)
					for !pollDone(poll, id) && !time.Now().After(gameDeadline) {

						select {
						case <-stop:
							return
						case <-time.After(20 * time.Millisecond):
						}
					}
				}
			}(w)
		}

		time.Sleep(warmup)
		e1 := sampleEvents(t, poll)
		g1 := sampleFinished(t, poll)
		t1 := time.Now()
		time.Sleep(window)
		e2 := sampleEvents(t, poll)
		g2 := sampleFinished(t, poll)
		secs := time.Since(t1).Seconds()

		close(stop)
		wg.Wait()
		mgr.StopAll()
		poll.Close()
		st.Close()

		evps := float64(e2-e1) / secs
		gps := float64(g2-g1) / secs
		if evps > peakEvps {
			peakEvps = evps
		}
		fmt.Printf("%4d | %9.0f | %9.1f\n", conc, evps, gps)
	}

	// Each committed event is ~one fsync on the single write connection. A live
	// game commits roughly one action per bot delay D, so the sustainable
	// concurrent-game count ≈ ceiling × D.
	fmt.Printf("\nwrite ceiling ≈ %.0f events/sec (flat across concurrency = single-connection bound)\n", peakEvps)
	fmt.Printf("≈ max concurrent games:  delay=1s → %.0f   delay=0.5s → %.0f   delay=0.25s → %.0f\n\n",
		peakEvps*1.0, peakEvps*0.5, peakEvps*0.25)
}

// sampleEvents returns the total number of engine events recorded so far. Each
// event row is written inside an AppendEvents transaction (one fsync on the
// single write connection), so the rate of growth tracks the write ceiling.
func sampleEvents(t *testing.T, poll *sql.DB) int64 {
	t.Helper()
	var events int64
	if err := poll.QueryRow(`SELECT count(*) FROM events`).Scan(&events); err != nil {
		t.Fatalf("count events: %v", err)
	}
	return events
}

func sampleFinished(t *testing.T, poll *sql.DB) int64 {
	t.Helper()
	var n int64
	if err := poll.QueryRow(
		`SELECT count(*) FROM games WHERE status IN ('finished','paused-error')`).Scan(&n); err != nil {
		t.Fatalf("count finished: %v", err)
	}
	return n
}

func pollDone(poll *sql.DB, id string) bool {
	var status string
	if err := poll.QueryRow(`SELECT status FROM games WHERE id = ?`, id).Scan(&status); err != nil {
		return false
	}
	return status == "finished" || status == "paused-error"
}

// seedAllBotGame creates a lobby game with `players` bot seats and returns its
// config, ready for mgr.Start. Mirrors the per-game setup in RunGame. Returns an
// error (rather than failing the test) since it runs on worker goroutines.
func seedAllBotGame(st *store.Store, id string, players int) (engine.GameConfig, error) {
	cfg := engine.GameConfig{Players: players, Ruleset: "base"}
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return cfg, err
	}
	host, err := st.CreateGuest("bot-0")
	if err != nil {
		return cfg, err
	}
	if err := st.CreateGame(&store.Game{ID: id, Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		return cfg, err
	}
	for seat := range players {
		uid := host.ID
		if seat > 0 {
			u, err := st.CreateGuest(fmt.Sprintf("bot-%d", seat))
			if err != nil {
				return cfg, err
			}
			uid = u.ID
		}
		if err := st.AddSeat(id, seat, uid); err != nil {
			return cfg, err
		}
		if err := st.SetSeatStatus(id, seat, "bot"); err != nil {
			return cfg, err
		}
	}
	return cfg, nil
}
