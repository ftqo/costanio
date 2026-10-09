package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// evalViaDecide is the reference scoring path: full engine.Decide (which
// finalizes the longest-road title) then eval. score() uses engine.DecideForEval,
// which skips that finalization; both must yield an identical eval.
func evalViaDecide(b *Strong, s *engine.State, seat engine.PlayerID, cmd engine.Command) (float64, bool) {
	c := s.Clone()
	events, err := engine.Decide(c, cmd)
	if err != nil {
		return 0, false
	}
	for _, e := range events {
		if err := engine.Apply(c, e); err != nil {
			return 0, false
		}
	}
	return b.eval(c, seat), true
}

// TestDecideForEvalScoreEquivalence drives Strong-vs-Strong games and, at every
// play-phase decision, asserts that scoring through DecideForEval gives exactly
// the eval of the full-Decide path.
func TestDecideForEvalScoreEquivalence(t *testing.T) {
	for seed := uint64(1); seed <= 6; seed++ {
		log, err := engine.New(engine.GameConfig{Players: 4, TargetVP: 10}, engine.SeedsFrom(seed))
		if err != nil {
			t.Fatal(err)
		}
		s := engine.Empty()
		for _, e := range log {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		b := NewStrong()

		for i := 0; i < 30000 && s.Phase != engine.PhaseFinished; i++ {
			seat := actingSeat(s)
			cmd, ok := b.Act(s, seat)
			if !ok {
				t.Fatalf("seed %d: bot has no move at step %d", seed, i)
			}
			// Only the scoreable play-phase commands go through score(); compare
			// the two scoring paths for those that Decide accepts.
			if s.Phase == engine.PhasePlay {
				viaEval, okE := b.score(s, seat, cmd)
				viaDecide, okD := evalViaDecide(b, s, seat, cmd)
				if okE != okD {
					t.Fatalf("seed %d step %d: legality mismatch (eval=%v decide=%v) for %s",
						seed, i, okE, okD, cmd.Type)
				}
				if okE && viaEval != viaDecide {
					t.Fatalf("seed %d step %d: eval mismatch for %s: DecideForEval=%v Decide=%v",
						seed, i, cmd.Type, viaEval, viaDecide)
				}
			}
			events, err := engine.Decide(s, cmd)
			if err != nil {
				t.Fatalf("seed %d: illegal %s at step %d: %v", seed, cmd.Type, i, err)
			}
			for _, e := range events {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
		}
		if s.Phase != engine.PhaseFinished {
			t.Fatalf("seed %d: game did not finish", seed)
		}
	}
}
