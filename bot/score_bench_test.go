package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// benchPlayState drives a Strong game to a mid-play position and returns the
// state plus a legal build command the bot would score there.
func benchPlayState(b *testing.B) (*engine.State, engine.PlayerID, engine.Command) {
	b.Helper()
	log, err := engine.New(engine.GameConfig{Players: 4, TargetVP: 10}, engine.SeedsFrom(3))
	if err != nil {
		b.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			b.Fatal(err)
		}
	}
	bot := NewStrong()
	for i := 0; i < 400 && s.Phase != engine.PhaseFinished; i++ {
		seat := actingSeat(s)
		cmd, ok := bot.Act(s, seat)
		if !ok {
			b.Fatalf("no move at step %d", i)
		}
		// Stop once we're in steady play with a scoreable build available.
		if s.Phase == engine.PhasePlay && cmd.Type == engine.CmdBuildRoad {
			return s, seat, cmd
		}
		ev, err := engine.Decide(s, cmd)
		if err != nil {
			b.Fatalf("illegal %s: %v", cmd.Type, err)
		}
		for _, e := range ev {
			if err := engine.Apply(s, e); err != nil {
				b.Fatal(err)
			}
		}
	}
	b.Skip("no scoreable build reached on this seed")
	return nil, 0, engine.Command{}
}

// BenchmarkScore measures the per-candidate scoring cost (clone + apply +
// finalize + eval), the bot's dominant production cost.
func BenchmarkScore(b *testing.B) {
	s, seat, cmd := benchPlayState(b)
	bot := NewStrong()
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		bot.score(s, seat, cmd)
	}
}
