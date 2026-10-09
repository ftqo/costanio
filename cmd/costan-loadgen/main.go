package main

import (
	"flag"
	"fmt"
	"log"
	"os"
)

func main() {
	var (
		baseURL  = flag.String("base-url", "http://localhost:6769", "backend base URL")
		games    = flag.Int("games", 20, "number of bot games to create")
		players  = flag.Int("players", 4, "players per game (2-10)")
		ruleset  = flag.String("ruleset", "base", "ruleset for created games")
		sessions = flag.Int("sessions", 10, "number of guest session tokens to mint for spectators")
		out      = flag.String("out", "loadtest/targets.json", "path to write targets.json")
	)
	flag.Parse()

	if *players < 2 || *players > 10 {
		log.Fatalf("players must be 2-10, got %d", *players)
	}

	// Host identity that creates all games. Hosting requires a registered account,
	// so the host logs in via dev-auth (server needs COSTAN_DEV_AUTH=1). Under
	// COSTAN_LOADTEST the per-user create limiter is relaxed so this single host
	// can create the whole pool; without it, it is throttled to ~burst 5.
	host, err := NewClient(*baseURL)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := host.MintDev(); err != nil {
		log.Fatalf("mint host (dev) session: %v", err)
	}

	cfg := gameConfig{Players: *players, Ruleset: *ruleset}
	fmt.Printf("creating %d private %s games (%d players each)...\n", *games, *ruleset, *players)
	gameTargets, err := buildPool(host, *games, cfg)
	if err != nil {
		log.Fatalf("build pool (created %d/%d): %v", len(gameTargets), *games, err)
	}

	// Spectators are guests: they may watch a private game with its invite code.
	fmt.Printf("minting %d spectator (guest) session(s)...\n", *sessions)
	tokens := make([]string, 0, *sessions)
	for i := range *sessions {
		c, err := NewClient(*baseURL)
		if err != nil {
			log.Fatal(err)
		}
		tok, err := c.MintGuest()
		if err != nil {
			log.Fatalf("mint spectator %d (minted %d): %v", i, len(tokens), err)
		}
		tokens = append(tokens, tok)
	}

	t := Targets{Games: gameTargets, Tokens: tokens}
	if err := t.Save(*out); err != nil {
		log.Fatalf("write %s: %v", *out, err)
	}
	fmt.Printf("wrote %s: %d games, %d tokens\n", *out, len(gameTargets), len(tokens))
	os.Exit(0)
}
