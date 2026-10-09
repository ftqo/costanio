package sim

import (
	"fmt"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

type explorersSeat interface {
	Act(*engine.State, engine.PlayerID) (engine.Command, bool)
}

// explorersGameSteps plays one headless game at the ruleset's default target
// (17 for explorers, 22 for cak+explorers) the way game.Actor does: every owed
// seat in engine.PendingDeciders order, the bot first, the engine's own move
// for that seat when the bot has none or is refused. It returns the steps
// taken (cap means the game never finished) and whether any seat made the
// Explorers-only trade the stall fix added: a bank trade for wool, grain or ore
// by a seat with no settlement left to place, which the base ladder's dig can
// never make (with no settlement to build, its only want is a road).
func explorersGameSteps(t *testing.T, ruleset string, players int, seed uint64, cap int,
	mk func() explorersSeat,
) (steps int, dug bool) {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	seats := make([]explorersSeat, players)
	for i := range seats {
		seats[i] = mk()
	}
	for ; s.Phase != engine.PhaseFinished && steps < cap; steps++ {
		acted := false
		for _, d := range engine.PendingDeciders(s) {
			cmd, ok := seats[d.Seat].Act(s, d.Seat)
			fromBot := ok
			if !ok {
				cmd, ok = engine.AutoCommandFor(s, d.Seat)
			}
			if !ok {
				continue
			}
			events, err := engine.Decide(s, cmd)
			if err != nil && fromBot {
				if cmd, ok = engine.AutoCommandFor(s, d.Seat); !ok {
					continue
				}
				fromBot = false
				events, err = engine.Decide(s, cmd)
			}
			if err != nil {
				continue
			}
			if fromBot && cmd.Type == engine.CmdBankTrade && s.Players[cmd.Player].SettlementsLeft == 0 {
				d, derr := engine.DecodeCommand[struct {
					Get board.Resource `json:"get"`
				}](cmd.Data)
				if derr == nil && d.Get != board.Wood && d.Get != board.Brick {
					dug = true
				}
			}
			for _, e := range events {
				if err := engine.Apply(s, e); err != nil {
					t.Fatalf("%s %dp seed %d: apply %s: %v", ruleset, players, seed, e.Type, err)
				}
			}
			acted = true
			break
		}
		if !acted {
			t.Fatalf("%s %dp seed %d: no owed seat could move at step %d", ruleset, players, seed, steps)
		}
	}
	return steps, dug
}

func simpleSeat() explorersSeat { b := bot.NewSimple(); return &b }
func strongSeat() explorersSeat { return bot.NewStrong() }

// explorersStepCap is far above a finished game (the pinned seeds below finish
// in 875 to 1,751 steps after the fix) and a stall never ends at all.
const explorersStepCap = 8000

// TestSimpleExplorersStalledSeedsTerminate pins the two-player Simple stalemate
// in Explorers (9 of 40 games at `costan-sim -bot simple -players 2 -ruleset
// explorers -seed 7 -n 40`, 38 of 200 from seed 1000).
//
// In every stalled game both seats had placed all five settlements, had no
// road to build toward, and held one or two resources with no ore, while a
// harbour settlement (grain and ore) or a crew (wool and ore) was one 3:1 trade
// away. Two defects caused it:
//
//   - simpleBankDig trades only toward a city, settlement, road or development
//     card, and Explorers removes or exhausts all four (bot.explorersBankDig);
//   - Simple rebuilt a ship from any empty one whenever it held lumber and wool,
//     spending the wool the 2-gold purchase bought (bot.explorersBuildShip).
//
// Either fix alone clears these seeds, so the dig is also asserted directly
// below, and bot/explorers_stall_test.go covers each fix. The seeds are the
// nine that hit the cap with both fixes reverted; about three seconds.
func TestSimpleExplorersStalledSeedsTerminate(t *testing.T) {
	seeds := []uint64{11, 18, 19, 22, 24, 25, 30, 32, 38}
	anyDug := false
	for _, seed := range seeds {
		steps, dug := explorersGameSteps(t, "explorers", 2, seed, explorersStepCap, simpleSeat)
		if steps >= explorersStepCap {
			t.Errorf("explorers 2p seed %d: did not finish in %d steps", seed, explorersStepCap)
		}
		anyDug = anyDug || dug
	}
	// Require the escape to have actually happened, so the test can't pass just
	// because the seeds stopped being hard.
	if !anyDug {
		t.Error("no seat with every settlement placed ever traded for wool, grain or ore")
	}
}

// TestExplorersGamesTerminate is the sweep behind the pinned seeds: both
// Explorers rulesets, both bots, two to four players, 200 games a row (20 under
// the race detector), and a budget of zero.
func TestExplorersGamesTerminate(t *testing.T) {
	skipUnlessSlow(t, "plays thousands of games")
	games := 200
	if raceEnabled {
		games = 20
	}
	for _, rs := range []string{"explorers", "cak+explorers"} {
		for _, c := range []struct {
			name string
			mk   func() explorersSeat
		}{{"simple", simpleSeat}, {"strong", strongSeat}} {
			for _, players := range []int{2, 3, 4} {
				t.Run(fmt.Sprintf("%s/%s/%dp", rs, c.name, players), func(t *testing.T) {
					t.Parallel()
					var stuck []uint64
					for seed := uint64(1000); seed < uint64(1000+games); seed++ {
						if steps, _ := explorersGameSteps(t, rs, players, seed, explorersStepCap, c.mk); steps >= explorersStepCap {
							stuck = append(stuck, seed)
						}
					}
					if len(stuck) > 0 {
						t.Fatalf("%d/%d %dp %s %s games did not finish in %d steps: seeds %v",
							len(stuck), games, players, rs, c.name, explorersStepCap, stuck)
					}
				})
			}
		}
	}
}
