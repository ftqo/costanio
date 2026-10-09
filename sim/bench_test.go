package sim

import (
	"sync/atomic"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

func BenchmarkBaseGame(b *testing.B) {
	for i := range b.N {
		st, err := store.OpenMem()
		if err != nil {
			b.Fatal(err)
		}
		// Skip the rare stalemate seed (capped by RunGame); it's not a normal
		// game and would skew the per-op timing.
		_, _ = RunGame(st, Options{
			Players: 4,
			Seed:    uint64(i) + 1,
			Bots:    func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		st.Close()
	}
}

func BenchmarkBaseGameParallel(b *testing.B) {
	var seed atomic.Uint64
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			s := seed.Add(1)
			st, err := store.OpenMem()
			if err != nil {
				b.Fatal(err)
			}
			_, _ = RunGame(st, Options{
				Players: 4,
				Seed:    s,
				Bots:    func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
			})
			st.Close()
		}
	})
}
