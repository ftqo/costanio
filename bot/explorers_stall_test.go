package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/knights"
)

// explorersWithHarbourUpgrade is a playable Explorers state whose current seat
// owns a coastal settlement that may become a harbour settlement. Searched over
// seeds (a settlement needs a legal coastal corner of the derived island); the
// search is bounded and fails, rather than skips, when it runs out.
func explorersWithHarbourUpgrade(t *testing.T) *engine.State {
	t.Helper()
	for seed := uint64(1); seed <= 40; seed++ {
		s := explorersPlayable(t, seed)
		if len(explorers.HarbourUpgrades(s, s.Cur)) > 0 {
			return s
		}
	}
	t.Fatal("no seed in 1..40 deals the current seat a coastal settlement")
	return nil
}

// TestExplorersSimpleTradesForHarbourOre: with all settlements
// placed, no road to build and no ore (e.g. `brick 5, wheat 2`), simpleBankDig
// has nothing to trade toward under Explorers, so Simple must trade toward a
// harbour settlement (2 VP) instead of stalling.
func TestExplorersSimpleTradesForHarbourOre(t *testing.T) {
	s := explorersWithHarbourUpgrade(t)
	seat := s.Cur
	x, _ := explorers.StateExt(s)
	p := &s.Players[seat]
	// The stall: nothing left on the base ladder and no ore. Three brick, which
	// is exactly one trade at Explorers' flat 3:1 and below the base ladder's
	// four-card surplus floor.
	p.SettlementsLeft = 0
	p.RoadsLeft = 0
	p.Hand = engine.Hand{}
	p.Hand[board.Brick] = 3
	p.Hand[board.Wheat] = 2
	x.Seats[seat].Gold = 0
	x.Seats[seat].ShipsLeft = 0 // no ship to buy either: the want is the harbour

	cmd, ok := NewSimple().Act(s, seat)
	if !ok {
		t.Fatal("Simple proposed nothing")
	}
	if cmd.Type != engine.CmdBankTrade {
		t.Fatalf("Simple proposed %s %s, want a 3:1 bank trade toward the harbour settlement's ore",
			cmd.Type, cmd.Data)
	}
	got, err := engine.DecodeCommand[struct {
		Give board.Resource `json:"give"`
		Get  board.Resource `json:"get"`
	}](cmd.Data)
	if err != nil {
		t.Fatal(err)
	}
	if got.Get != board.Ore || got.Give != board.Brick {
		t.Fatalf("traded %v for %v, want brick for ore", got.Give, got.Get)
	}
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("the engine refused the trade: %v", err)
	}
}

// TestExplorersSimpleTradesBeforeGoldSale pins the order of the Action
// phase's card trades: over the discard limit the lane sells its most-held card
// for gold, but only after looking for a trade toward a build, so it does not
// sell the pile a 3:1 trade toward a harbour settlement needs.
func TestExplorersSimpleTradesBeforeGoldSale(t *testing.T) {
	s := explorersWithHarbourUpgrade(t)
	seat := s.Cur
	x, _ := explorers.StateExt(s)
	p := &s.Players[seat]
	p.SettlementsLeft = 0
	p.RoadsLeft = 0
	p.Hand = engine.Hand{}
	p.Hand[board.Wheat] = 5
	p.Hand[board.Sheep] = 3
	if p.Hand.Count() <= s.DiscardThreshold(seat) {
		t.Fatal("fixture: the hand is not over the discard limit, so no sale is on offer")
	}
	x.Seats[seat].Gold = 0
	x.Seats[seat].ShipsLeft = 0
	cmd, ok := NewSimple().Act(s, seat)
	if !ok || cmd.Type != engine.CmdBankTrade {
		t.Fatalf("Simple proposed %s %s (%v), want the 3:1 trade toward the harbour settlement's ore",
			cmd.Type, cmd.Data, ok)
	}
	got, err := engine.DecodeCommand[struct {
		Get board.Resource `json:"get"`
	}](cmd.Data)
	if err != nil || got.Get != board.Ore {
		t.Fatalf("traded for %v (%v), want ore", got.Get, err)
	}
}

// TestExplorersSimpleKeepsShipThatCanSailHome: recycling is for a
// ship that cannot get home. Recycling any empty hull spends the wool a crew
// needs on a hull-for-hull swap.
func TestExplorersSimpleKeepsShipThatCanSailHome(t *testing.T) {
	s := explorersPlayable(t, 5)
	seat := s.Cur
	x, _ := explorers.StateExt(s)
	ships := explorers.ShipsOf(x, seat)
	if len(ships) == 0 {
		t.Fatal("setup placed no ship")
	}
	sh := ships[0]
	sh.Hold = explorers.Cargo{}
	x.Ships[sh.ID] = sh
	x.Seats[seat].ShipsLeft = 0
	if len(explorers.PathToHarbour(s, seat, sh.ID)) == 0 {
		t.Fatal("fixture: the setup ship has no route to its own harbour settlement")
	}
	s.Players[seat].Hand = explorers.CostShip
	if cmd, ok := explorersBuildShip(s, x, seat); ok {
		t.Fatalf("Simple recycled an empty ship that can sail home: %s %s", cmd.Type, cmd.Data)
	}
}

// TestStrongExplorersYieldsToKnightsPending: Strong's Explorers lane runs
// before the code that answers a Knights pending (a Defender draw after a tied
// barbarian win, a progress hand over its limit), so it must not propose a buy
// while one is owed (`explorers_buy_cargo: a pending choice must be resolved
// first`).
func TestStrongExplorersYieldsToKnightsPending(t *testing.T) {
	s := explorersPlayableRuleset(t, 5, "cak+explorers")
	seat := s.Cur
	x, _ := explorers.StateExt(s)
	// A settler purchase, the buy the lane makes without asking the engine first
	// (ship builds go through cmdLegal). Lift the fog so there is somewhere to
	// found.
	for _, ph := range x.Pool {
		x.Revealed[ph.H] = true
	}
	if !explorers.FoundingSpots(s, seat) || explorers.SettlersLeft(x, seat) == 0 {
		t.Fatal("fixture: nowhere to land a settler, or none left")
	}
	s.Players[seat].Hand = explorers.CostSettler
	cmd, ok := StrongExplorersPlay(s, seat)
	if !ok || cmd.Type != explorers.CmdBuyCargo {
		t.Fatalf("fixture: lane proposed %s (%v), want a settler", cmd.Type, ok)
	}
	knights.Read(s).DefenderDraws = []engine.PlayerID{seat}
	if _, err := engine.Decide(s, cmd); err == nil {
		t.Fatal("fixture: engine accepted a buy during a Defender draw")
	}
	if cmd, ok := StrongExplorersPlay(s, seat); ok {
		_, err := engine.Decide(s, cmd)
		t.Fatalf("Knights pending owed: lane proposed %s (engine: %v)", cmd.Type, err)
	}
}

// TestExplorersSimpleTradesForKnightsCity is the same order
// under cak+explorers, where rule A brings the city back. Over the discard limit
// the lane answers with a sale before the base ladder's own city dig ever runs,
// so the city has to be one of the lane's own wants.
func TestExplorersSimpleTradesForKnightsCity(t *testing.T) {
	s := explorersPlayableRuleset(t, 5, "cak+explorers")
	seat := s.Cur
	x, _ := explorers.StateExt(s)
	found := false
	for v, b := range s.Buildings {
		if b.Owner == seat && b.City {
			b.City = false
			s.Buildings[v] = b
			s.Players[seat].CitiesLeft++
			s.Players[seat].SettlementsLeft--
			found = true
			break
		}
	}
	if !found {
		t.Fatal("setup did not place a city")
	}
	// Nothing else to trade toward: no harbour settlement left to build, no
	// ship in supply, no settlement to place.
	x.Seats[seat].HarboursLeft = 0
	x.Seats[seat].ShipsLeft = 0
	x.Seats[seat].Gold = 0
	p := &s.Players[seat]
	p.SettlementsLeft = 0
	p.Hand = engine.Hand{}
	p.Hand[board.Brick] = 6
	p.Hand[board.Wheat] = 2
	p.Hand[board.Ore] = 1
	if p.Hand.Count() <= s.DiscardThreshold(seat) {
		t.Fatal("fixture: the hand is not over the discard limit, so no sale is on offer")
	}
	if _, ok := upgradableSettlement(s, seat); !ok {
		t.Fatal("fixture: no settlement may become a city")
	}
	cmd, ok := NewSimple().Act(s, seat)
	if !ok || cmd.Type != engine.CmdBankTrade {
		t.Fatalf("Simple proposed %s %s (%v), want the 3:1 trade toward the city's ore", cmd.Type, cmd.Data, ok)
	}
	got, err := engine.DecodeCommand[struct {
		Get board.Resource `json:"get"`
	}](cmd.Data)
	if err != nil || got.Get != board.Ore {
		t.Fatalf("traded for %v (%v), want ore", got.Get, err)
	}
}
