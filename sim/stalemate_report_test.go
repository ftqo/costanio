package sim

import (
	"errors"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// passBot plays the engine's obligations (setup, discards, robber) and nothing
// else, so the game reaches PhasePlay and never ends: a stand-in for a
// livelocked bot.
type passBot struct{}

func (passBot) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Player != seat {
		return engine.Command{}, false
	}
	return cmd, true
}

// TestStalemateIsReportedNotScored pins sim's opt-out of game.DefaultEventCap.
//
// game.NewManager arms an 8000-event force-finish by default, which writes
// game_finished with a tiebreak winner. In sim that would turn a stuck game
// into a normal Result with a winner, crediting the stuck bot in strength and
// ladder measurements. So sim.Run calls SetEventCap(0) and keeps its own
// MaxEvents check, which reports ErrStalemate.
func TestStalemateIsReportedNotScored(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	_, err = RunGame(st, Options{
		Players:   3,
		Ruleset:   "base",
		Seed:      1,
		MaxEvents: 400,
		Timeout:   60 * time.Second,
		Bots:      func(engine.PlayerID) game.CommandSource { return passBot{} },
		IDTag:     "stalemate-report",
	})
	if !errors.Is(err, ErrStalemate) {
		t.Fatalf("RunGame of a non-terminating game: err = %v, want ErrStalemate", err)
	}
}
