// Command costan-recover is the way out of "paused-error".
//
// When the engine hits an invariant violation the actor freezes the game and
// marks the row "paused-error" (docs/game-actor.md, "Engine invariant
// violations"). Play never resumes from such a state, but without an ending the
// seats never get their rating, Pips, match history or post-game screen.
//
// Two endings, and neither resumes play:
//
//	finish   commit engine.ForceFinish's tiebreak result (stamped SourceServer,
//	         so the log still tells it apart from a real win) and run the
//	         ordinary finish path: ratings, Pips, match history, post-game.
//	         The right ending when the state is intact and only a command
//	         went wrong.
//	abandon  move the row to "abandoned" and release the seats. No result and
//	         no rating movement. The right ending when the log will not even
//	         fold, which is when `finish` refuses.
//
// The event log is never deleted by either one: report the bug from it first,
// then pick an ending.
//
// Usage:
//
//	costan-recover [-db path] list
//	costan-recover [-db path] finish  <game-id>...
//	costan-recover [-db path] abandon <game-id>...
package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"

	_ "github.com/ftqo/costan.io/engine/explorers" // register the Explorers ruleset
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"   // register the module
	_ "github.com/ftqo/costan.io/engine/knights"   // register the module
	_ "github.com/ftqo/costan.io/engine/raiders"   // register the module
	_ "github.com/ftqo/costan.io/engine/rivers"    // register the Rivers scenario
	_ "github.com/ftqo/costan.io/engine/scenarios" // register the scenario modules
	_ "github.com/ftqo/costan.io/engine/wagons"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// main is a thin wrapper: run owns the deferred store.Close and StopAll, which
// an os.Exit inside it would skip.
func main() { os.Exit(run()) }

func run() int {
	dbPath := flag.String("db", env("COSTAN_DB", "costan.db"), "sqlite database path")
	flag.Usage = usage
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	args := flag.Args()
	if len(args) == 0 {
		usage()
		return 2
	}
	cmd, ids := args[0], args[1:]
	if cmd != "list" && len(ids) == 0 {
		fmt.Fprintf(os.Stderr, "%s: needs at least one game id\n", cmd)
		return 2
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		slog.Error("open store", "err", err)
		return 1
	}
	defer st.Close()

	// No StartReaper: this process loads no games, so it wants neither the idle
	// sweep nor the startup finalization sweep running underneath it.
	m := game.NewManager(st, nil)
	defer m.StopAll()

	switch cmd {
	case "list":
		return list(m)
	case "finish":
		return each(ids, "force-finished", m.ForceFinishPaused)
	case "abandon":
		return each(ids, "abandoned", m.AbandonPaused)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", cmd)
		usage()
		return 2
	}
}

func list(m *game.Manager) int {
	ids, err := m.PausedGames()
	if err != nil {
		slog.Error("list paused games", "err", err)
		return 1
	}
	if len(ids) == 0 {
		fmt.Println("no paused games")
		return 0
	}
	for _, id := range ids {
		fmt.Println(id)
	}
	return 0
}

// each runs one recovery over every id, reporting per game rather than aborting
// the run on the first failure.
func each(ids []string, verb string, fn func(string) error) int {
	failed := 0
	for _, id := range ids {
		if err := fn(id); err != nil {
			slog.Error("recover", "game", id, "err", err)
			failed++
			continue
		}
		slog.Info(verb, "game", id)
	}
	if failed > 0 {
		return 1
	}
	return 0
}

func usage() {
	fmt.Fprint(os.Stderr, `costan-recover ends games frozen in "paused-error".

  costan-recover [-db path] list                  list every paused game
  costan-recover [-db path] finish  <game-id>...  force-finish and finalize (ratings, Pips, history)
  costan-recover [-db path] abandon <game-id>...  write off; no result, no rating movement

Neither resumes play. Report the bug from the event log first; the log is kept
by both endings.

Flags:
`)
	flag.PrintDefaults()
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
