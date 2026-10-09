// Command costan-backfill populates match_history rows for finished games that
// predate the match-history feature. It is idempotent: safe to run more than
// once (already-recorded games are skipped by the store's ON CONFLICT clause,
// and a bad individual game is logged and skipped rather than aborting the run).
package main

import (
	"flag"
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

func main() {
	dbPath := flag.String("db", env("COSTAN_DB", "costan.db"), "sqlite database path")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	st, err := store.Open(*dbPath)
	if err != nil {
		slog.Error("open store", "err", err)
		os.Exit(1)
	}

	ids, err := st.FinishedGamesWithoutMatchHistory()
	if err != nil {
		st.Close()
		slog.Error("enumerate games", "err", err)
		os.Exit(1)
	}

	var saved, skipped, failed int
	for _, gameID := range ids {
		ok, err := game.RecordMatch(st, gameID)
		if err != nil {
			slog.Error("record match", "game", gameID, "err", err)
			failed++
			continue
		}
		if ok {
			saved++
			slog.Info("backfilled", "game", gameID)
		} else {
			skipped++ // bot-only
		}
	}

	slog.Info("backfill complete",
		"backfilled", saved,
		"skipped_bot_only", skipped,
		"errors", failed,
	)
	st.Close()
	if failed > 0 {
		os.Exit(1)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
