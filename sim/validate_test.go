package sim

import (
	"strings"
	"testing"
	"time"
)

func TestRunGameRejectsTooFewPlayers(t *testing.T) {
	st := openStore(t)
	_, err := RunGame(st, Options{Players: 1, Ruleset: "base", Seed: 1})
	if err == nil || !strings.Contains(err.Error(), "players must be 2-10") {
		t.Fatalf("Players=1 err = %v; want a players-range error", err)
	}
}

func TestRunGameRejectsTooManyPlayers(t *testing.T) {
	st := openStore(t)
	_, err := RunGame(st, Options{Players: 11, Ruleset: "base", Seed: 1})
	if err == nil || !strings.Contains(err.Error(), "players must be 2-10") {
		t.Fatalf("Players=11 err = %v; want a players-range error", err)
	}
}

// An empty Ruleset must default to "base" and still play to completion. This
// also exercises the Timeout==0 default branch. Runs by default: one 6-VP game
// takes tens of milliseconds.
func TestRunGameDefaultsRulesetAndTimeout(t *testing.T) {
	st := openStore(t)
	res, err := RunGame(st, Options{
		Players:  3,
		Ruleset:  "", // defaults to "base"
		TargetVP: 6,  // low target keeps it quick
		Seed:     5,
		// Timeout left at 0 to hit the 30s default branch.
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Winner < 0 || int(res.Winner) >= 3 {
		t.Fatalf("winner = %d", res.Winner)
	}
	if res.WinnerVP < 6 {
		t.Errorf("winner VP = %d; want >= 6", res.WinnerVP)
	}
}

// A tiny timeout against a real game forces the deadline branch to fire,
// returning the "did not finish within" error rather than a result.
func TestRunGameTimesOut(t *testing.T) {
	st := openStore(t)
	_, err := RunGame(st, Options{
		Players:  3,
		Ruleset:  "base",
		TargetVP: 10,
		Seed:     11,
		Timeout:  time.Nanosecond,
	})
	if err == nil || !strings.Contains(err.Error(), "did not finish within") {
		t.Fatalf("tiny-timeout err = %v; want a timeout error", err)
	}
}
