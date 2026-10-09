package sim

import (
	"os"
	"testing"
)

// EnvSlow opts a run into the heavy seeded batches in this package. Unset (the
// default), those tests skip and `go test ./sim` takes seconds instead of
// minutes; set to anything non-empty, the full suite runs.
//
// Opt-in, and an env var rather than -short, because most changes (a Discord
// handler, a stylesheet, a doc) cannot alter a simulated game. Changes to the
// rules, actor, bots or event log should set it. The skip messages name the
// variable.
const EnvSlow = "COSTAN_SIM_SLOW"

// slowEnabled reports whether the heavy batches are opted in.
func slowEnabled() bool { return os.Getenv(EnvSlow) != "" }

// skipUnlessSlow skips the calling test unless the batches are opted in. what
// describes the cost, so the line reads e.g.
//
//	--- SKIP: TestFoo (0.00s)
//	    slow_test.go:NN: plays hundreds of games; set COSTAN_SIM_SLOW=1 to run
func skipUnlessSlow(t *testing.T, what string) {
	t.Helper()
	if !slowEnabled() {
		t.Skipf("%s; set %s=1 to run", what, EnvSlow)
	}
}
