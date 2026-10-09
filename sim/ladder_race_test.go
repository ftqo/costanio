package sim

import (
	"os"
	"testing"
)

// skipLadderUnderRace skips an A/B ladder when the race detector is on.
//
// Skipped rather than shortened: a ladder decides "did X beat Y" from a
// confidence interval, and a small sample lets flukes clear the bar (48 games
// produced a "significant" [50.4%, 76.6%] from nothing). The assertions come in
// both `Beats` and `!Beats` shapes, so no sample size is safe for all of them.
//
// These are single-goroutine bot studies, so the detector checks nothing here
// while costing about 15x the wall clock.
func skipLadderUnderRace(t *testing.T) {
	t.Helper()
	if raceEnabled {
		t.Skip("A/B ladder: skipped under -race")
	}
}

// skipLadderUnlessRequested skips an A/B ladder unless asked for. They add up
// to about 24000 games and each prices a change that has already landed. The
// cheap behavioural checks (ships built, fish spent, boot passed, progress
// cards used) stay in the default suite.
//
//	COSTAN_LADDERS=1 go test ./sim -run 'Ladder|Beats|Wins|Cost'
//
// With this and skipLadderUnderRace, no gate runs a ladder, so a green gate
// says nothing about bot strength. Therefore:
//
//   - Before merging a bot/ change, run the ladder that prices it and put the
//     interval in the commit.
//   - Every lane that spends something gets a cheap affordability assertion in
//     the default gate (see sim.TestCamelLaneAffordable).
func skipLadderUnlessRequested(t *testing.T) {
	t.Helper()
	skipLadderUnderRace(t)
	if os.Getenv("COSTAN_LADDERS") == "" {
		t.Skip("A/B ladder: set COSTAN_LADDERS=1 to re-measure")
	}
}
