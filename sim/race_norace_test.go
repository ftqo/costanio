//go:build !race

package sim

// raceEnabled reports whether the race detector is on (about 15x the wall
// clock), so the heavy many-game tests can trade coverage for time:
//
//   - Seeded sweeps (TestTwoPlayerAdversarial and friends) shrink: fewer seeds,
//     fewer rulesets. They assert nothing blew up, so a smaller sample is just
//     less coverage.
//   - A/B ladders skip entirely (skipLadderUnderRace). A smaller sample lets
//     flukes clear a confidence-interval bar, so they must not shrink.
//
// In a _test file because only tests read it.
const raceEnabled = false
