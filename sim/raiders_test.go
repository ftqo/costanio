package sim

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/raiders"
)

// raidersRulesets is the block these tests play: the scenario alone, and against
// each partner whose own board work can move the coast under it.
func raidersRulesets() []string {
	return canonical([]string{
		"base+raiders",
		"base+islands+raiders",
		"base+caravans+raiders",
		"base+fishermen+raiders",
	})
}

// TestRaiderSupplyConserved: every raider figure is in exactly one of three
// places (Supply, RaiderCount, Prisoners) at every step of every game.
//
// The three are written in different folds (landing, Treason, battle,
// Intrigue), and a raider never goes back to the supply: that is the
// scenario's clock, as landings stop once it is empty. So the total is fixed
// at setup (3 x the numbered coastal hexes), and any drift means a fold
// miscounted.
//
// Knights is absent from the block: with it the supply is unbounded (see
// Ext.supplyEmpty), so there is no total to conserve.
func TestRaiderSupplyConserved(t *testing.T) {
	st := openStore(t)
	landed, captured := 0, 0
	for _, rs := range raidersRulesets() {
		for _, seed := range supplySeeds() {
			events := botGame(t, rs, seed, st)
			total := -1
			foldChecked(t, events, func(s *engine.State, e engine.Event, _ engine.EventType) {
				x, ok := raiders.StateExt(s)
				if !ok || !x.HasCastle {
					return
				}
				onBoard := x.RaidersOnBoard()
				prisoners := 0
				for _, n := range x.Prisoners {
					prisoners += n
				}
				sum := x.Supply + onBoard + prisoners
				if total < 0 {
					total = sum
				}
				if sum != total {
					t.Fatalf("%s seed %d: after %s at seq %d the raider figures total %d, not %d "+
						"(supply %d + coast %d + prisoners %d)",
						rs, seed, e.Type, e.Seq, sum, total, x.Supply, onBoard, prisoners)
				}
				if x.Supply < 0 {
					t.Fatalf("%s seed %d: the raider supply went negative (%d) after %s at seq %d",
						rs, seed, x.Supply, e.Type, e.Seq)
				}
				switch e.Type {
				case raiders.EvLanded:
					landed++
				case raiders.EvBattle:
					captured++
				default:
					// Counting two kinds, ignoring the rest.
				}
			})
		}
	}
	// A ledger nobody moved is conserved trivially.
	if landed == 0 {
		t.Errorf("no raider ever landed (landed=%d captured=%d)", landed, captured)
	}
	if captured == 0 {
		t.Errorf("no battle was ever fought")
	}
}

// TestRiderSupplyConserved: each seat's six riders are either on the board or in
// its supply, never both and never neither. Placement takes one from the
// supply, a battle loss returns one, and a move changes neither.
func TestRiderSupplyConserved(t *testing.T) {
	st := openStore(t)
	placed, lost := 0, 0
	for _, rs := range raidersRulesets() {
		for _, seed := range supplySeeds() {
			events := botGame(t, rs, seed, st)
			foldChecked(t, events, func(s *engine.State, e engine.Event, _ engine.EventType) {
				x, ok := raiders.StateExt(s)
				if !ok || len(x.RidersLeft) == 0 {
					return
				}
				onBoard := make([]int, len(x.RidersLeft))
				for _, owner := range x.RiderAt {
					if owner < 0 || int(owner) >= len(onBoard) {
						t.Fatalf("%s seed %d: rider belongs to seat %d, not at this table", rs, seed, owner)
					}
					onBoard[owner]++
				}
				for p, left := range x.RidersLeft {
					if left < 0 {
						t.Fatalf("%s seed %d: seat %d has %d riders left after %s at seq %d",
							rs, seed, p, left, e.Type, e.Seq)
					}
					if got := left + onBoard[p]; got != 6 {
						t.Fatalf("%s seed %d: seat %d holds %d riders and has %d left (%d, not 6) after %s at seq %d",
							rs, seed, p, onBoard[p], left, got, e.Type, e.Seq)
					}
				}
				switch e.Type {
				case raiders.EvRiderPlaced:
					placed++
				case raiders.EvBattle:
					lost++
				default:
					// Counting two kinds, ignoring the rest.
				}
			})
		}
	}
	if placed == 0 {
		t.Errorf("no rider was ever placed")
	}
	_ = lost
}

// TestRaidersNoRobber: the robber and the pirate are absent from every Raiders
// ruleset, in any combination, and Board.Robber is never read.
//
// Checked on the finished log rather than in the module, because base setup,
// Islands and Fishermen all place or move the robber without knowing about this
// scenario. If the robber were ever on the board, a 7 would set RobberPending
// and the turn would stall on a move nobody can make.
func TestRaidersNoRobber(t *testing.T) {
	st := openStore(t)
	sevens := 0
	for _, rs := range raidersRulesets() {
		for _, seed := range supplySeeds() {
			events := botGame(t, rs, seed, st)
			foldChecked(t, events, func(s *engine.State, e engine.Event, _ engine.EventType) {
				if s.Board == nil {
					return
				}
				if s.Board.RobberOnBoard() {
					t.Fatalf("%s seed %d: robber on the board at %v after %s at seq %d",
						rs, seed, s.Board.Robber, e.Type, e.Seq)
				}
				if s.RobberPending {
					t.Fatalf("%s seed %d: robber move pending after %s at seq %d",
						rs, seed, e.Type, e.Seq)
				}
				if e.Type == engine.EvDiceRolled {
					d := engine.DecodeEvent[engine.DiceRolledData](e)
					if d.D1+d.D2 == 7 {
						sevens++
					}
				}
			})
		}
	}
	if sevens == 0 {
		t.Errorf("no 7 was rolled")
	}
}
