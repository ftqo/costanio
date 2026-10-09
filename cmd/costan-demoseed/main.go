// Command costan-demoseed builds a database holding one finished game, created
// and started through the real lobby, for screenshots of the fairness audit.
//
//	go run ./cmd/costan-demoseed -db /tmp/demo.db
//
// It goes through lobby.Create and lobby.Start rather than seeding rows,
// because those write what the audit reads: the seed commitment (at create)
// and the pre-shuffle roster (at start).
//
// The host is the same Discord identity GET /auth/dev logs in as, so the
// screenshot session is a participant and the replay reveals its seeds.
//
// A manual tool; nothing imports it.
package main

import (
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/store"

	_ "github.com/ftqo/costan.io/engine/explorers" // register the Explorers ruleset
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/raiders"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

func main() {
	dbPath := flag.String("db", "", "database file to build (required)")
	players := flag.Int("players", 4, "seats, including the host")
	ruleset := flag.String("ruleset", "base", "ruleset")
	games := flag.Int("n", 1, "how many finished games to leave behind")
	flag.Parse()
	if *dbPath == "" {
		log.Fatal("-db is required")
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	// The account GET /auth/dev upserts, so the browser session that takes the
	// screenshots is the host of these games.
	host, err := st.UpsertDiscordUser("dev-tester", "Tester", "")
	if err != nil {
		log.Print(err)
		return
	}

	mgr := game.NewManager(st, nil)
	// No pacing: nobody is watching.
	mgr.SetBotDelay(0)
	mgr.SetBotFactory(func(engine.PlayerID) game.CommandSource { return bot.NewStrong() })
	defer mgr.StopAll()
	lb := lobby.New(st, mgr)

	for i := range *games {
		id, err := playOne(st, lb, host, *players, *ruleset)
		if err != nil {
			log.Printf("game %d: %v", i+1, err)
			return
		}
		fmt.Println(id)
	}
}

func playOne(st *store.Store, lb *lobby.Lobby, host *store.User, players int, ruleset string) (string, error) {
	sum, err := lb.Create(host, engine.GameConfig{
		Players: players, Ruleset: ruleset, DiceMode: "fair", BoardMode: "fair",
		TurnOrder: engine.TurnOrderRandom,
	}, false)
	if err != nil {
		return "", fmt.Errorf("create: %w", err)
	}
	id := sum.Game.ID

	// Fill the other seats with bots, and hand the host's seat to the server so
	// the game finishes. The host stays seated, which is what reveals the seeds.
	for range players - 1 {
		if _, err := lb.AddBot(host, id); err != nil {
			return "", fmt.Errorf("add bot: %w", err)
		}
	}
	// Before Start: the actor reads seat control when it spawns. (lobby.Start
	// carries the status across the turn-order shuffle.)
	if err := st.SetSeatStatus(id, 0, "bot"); err != nil {
		return "", fmt.Errorf("hand the host seat to the server: %w", err)
	}
	if err := lb.Start(host, id); err != nil {
		return "", fmt.Errorf("start: %w", err)
	}

	deadline := time.Now().Add(3 * time.Minute)
	for {
		g, err := st.GameByID(id)
		if err != nil {
			return "", err
		}
		if g.Status == "finished" {
			// Hand the host's seat back and record the match. A bot-only game
			// is excluded from match history (store.MatchHistoryForUser), which
			// would hide the Verify button on the history row.
			if err := st.SetSeatStatus(id, hostSeat(st, id, host.ID), "active"); err != nil {
				return "", fmt.Errorf("return the host seat: %w", err)
			}
			if _, err := game.RecordMatch(st, id); err != nil {
				return "", fmt.Errorf("record match: %w", err)
			}
			return id, nil
		}
		if g.Status == "paused-error" {
			return "", fmt.Errorf("game %s hit an engine error", id)
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("game %s did not finish", id)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// hostSeat finds which seat the turn-order shuffle put the host in.
func hostSeat(st *store.Store, gameID string, userID int64) int {
	seats, err := st.Seats(gameID)
	if err != nil {
		return 0
	}
	for _, s := range seats {
		if s.UserID == userID {
			return s.No
		}
	}
	return 0
}
