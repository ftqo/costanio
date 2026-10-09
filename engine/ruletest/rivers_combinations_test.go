package ruletest

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// Two Rivers combination rules from docs/rules/rivers.md: a city about to be
// pillaged may be kept for 5 coins, and 6 fish build a bridge at no other cost.
//
// Each is a rule of a pair and no module may import another, so each is an
// additive engine seam: the currency's module prices it and folds the payment
// (engine.Hooks.PillageBuyout, engine.Hooks.FreeBridge), and the effect's module
// decides when the offer stands. These tests drive the real commands through
// engine.Decide on a composed ruleset, since the seam is what is most likely to be
// wired backwards.

// A seat that owes the barbarians a city may pay 5 coins instead, and then it
// owes nothing and keeps every city it had.
func TestPillageBuyoutKeepsTheCity(t *testing.T) {
	s := playState(t, "base+cak+rivers", 4)
	p := engine.PlayerID(1)
	v := cityFor(t, s, p)
	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("no cak ext in a base+cak game")
	}
	cx.PendingDowngrade = []engine.PlayerID{p}
	setCoins(t, s, p, rivers.CoinsPerPillageBuyout)

	evs, err := engine.Decide(s, engine.Command{Player: p, Type: knights.CmdPillageBuyout})
	if err != nil {
		t.Fatalf("a seat holding %d coins could not buy off a pillage: %v", rivers.CoinsPerPillageBuyout, err)
	}
	for _, e := range evs {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
	}
	if got := rivers.Coins(s, p); got != 0 {
		t.Fatalf("the buyout left %d coins, want %d spent", got, rivers.CoinsPerPillageBuyout)
	}
	if b, ok := s.Buildings[v]; !ok || !b.City || b.Owner != p {
		t.Fatal("the city the seat paid to keep is not there")
	}
	if len(knights.Read(s).PendingDowngrade) != 0 {
		t.Fatal("the seat still owes the barbarians a city after paying")
	}
	// The offer is once per pillage: the debt is gone, so a second attempt
	// is refused rather than charging again.
	setCoins(t, s, p, rivers.CoinsPerPillageBuyout)
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: knights.CmdPillageBuyout}); err == nil {
		t.Fatal("a seat owing nothing bought off a pillage")
	}
}

// One coin short is refused at no cost: the buyout "is refused if the owner
// cannot pay", and partial payment for a city that still burns would be worse.
func TestPillageBuyoutRefusedWhenOwnerCannotPay(t *testing.T) {
	s := playState(t, "base+cak+rivers", 4)
	p := engine.PlayerID(1)
	cityFor(t, s, p)
	cx, _ := knights.StateExt(s)
	cx.PendingDowngrade = []engine.PlayerID{p}
	setCoins(t, s, p, rivers.CoinsPerPillageBuyout-1)

	if _, err := engine.Decide(s, engine.Command{Player: p, Type: knights.CmdPillageBuyout}); err == nil {
		t.Fatalf("%d coins bought off a pillage priced at %d",
			rivers.CoinsPerPillageBuyout-1, rivers.CoinsPerPillageBuyout)
	}
	if got := rivers.Coins(s, p); got != rivers.CoinsPerPillageBuyout-1 {
		t.Fatalf("a refused buyout took coins: %d left of %d", got, rivers.CoinsPerPillageBuyout-1)
	}
	if len(knights.Read(s).PendingDowngrade) != 1 {
		t.Fatal("a refused buyout cleared the debt")
	}
}

// Without a module that sells one there is no buyout to take, and the command is
// refused rather than clearing the debt for free.
func TestPillageBuyoutNeedsAModuleThatSellsOne(t *testing.T) {
	s := playState(t, "base+cak", 4)
	p := engine.PlayerID(1)
	cityFor(t, s, p)
	cx, _ := knights.StateExt(s)
	cx.PendingDowngrade = []engine.PlayerID{p}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: knights.CmdPillageBuyout}); err == nil {
		t.Fatal("a game with no currency to pay with allowed a pillage buyout")
	}
	if len(knights.Read(s).PendingDowngrade) != 1 {
		t.Fatal("the refused buyout cleared the debt anyway")
	}
}

// A seat with exactly one city is asked rather than razed when the ruleset sells
// a buyout, since there is then a choice. Without one the city falls with the
// attack, as in every older log.
func TestOneCitySeatIsAskedOnlyWhereABuyoutExists(t *testing.T) {
	for _, c := range []struct {
		ruleset string
		asked   bool
	}{
		{"base+cak", false},
		{"base+cak+rivers", true},
	} {
		t.Run(c.ruleset, func(t *testing.T) {
			s := playState(t, c.ruleset, 4)
			if got := engine.HasPillageBuyout(s); got != c.asked {
				t.Fatalf("HasPillageBuyout = %v, want %v", got, c.asked)
			}
		})
	}
}

// Six fish buy a bridge: the tiles go, the bridge stands, and it still pays its
// 3 coins, since a coin is paid for the placement rather than its cost.
func TestSixFishBuyABridge(t *testing.T) {
	s := playState(t, "base+fishermen+rivers", 4)
	p := s.Cur
	s.Rolled = true
	e := freeBridgeSite(t, s, p)
	giveFish(t, s, p, scenarios.FishBridgeCost)
	coinsBefore := rivers.Coins(s, p)
	left := rivers.BridgesLeft(s, p)

	evs, err := engine.Decide(s, engine.Command{Player: p, Type: scenarios.CmdSpendFish,
		Data: rawCmd(map[string]any{"use": scenarios.FishBridge, "e": e})})
	if err != nil {
		t.Fatalf("six fish did not buy a bridge: %v", err)
	}
	for _, ev := range evs {
		if err := engine.Apply(s, ev); err != nil {
			t.Fatalf("apply %s: %v", ev.Type, err)
		}
	}
	if x, ok := rivers.StateExt(s); !ok || x.Bridges[e] != p {
		t.Fatal("the bridge the fish paid for is not on the board")
	}
	if got := rivers.BridgesLeft(s, p); got != left-1 {
		t.Fatalf("bridge supply went %d to %d, want one spent", left, got)
	}
	if got := rivers.Coins(s, p) - coinsBefore; got != rivers.CoinsPerBridge {
		t.Fatalf("the bridge paid %d coins, want %d", got, rivers.CoinsPerBridge)
	}
	if got := fishHeld(t, s, p); got != 0 {
		t.Fatalf("%d fish left after a six-fish spend, want none", got)
	}
}

// The rung exists only where a module has bridges. In a plain Fishermen game the
// spend is refused as unavailable, and no fish are taken for it.
func TestSixFishBridgeNeedsAModuleWithBridges(t *testing.T) {
	s := playState(t, "base+fishermen", 4)
	p := s.Cur
	s.Rolled = true
	giveFish(t, s, p, scenarios.FishBridgeCost)
	e := board.NewEdge(board.Vertex{}, board.Vertex{}.Neighbors()[0])
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: scenarios.CmdSpendFish,
		Data: rawCmd(map[string]any{"use": scenarios.FishBridge, "e": e})}); err == nil {
		t.Fatal("a game with no bridges sold one for six fish")
	}
	if got := fishHeld(t, s, p); got == 0 {
		t.Fatal("the refused spend took the fish anyway")
	}
}

// An illegal bridge site is refused before the tiles are spent, as with the
// five-fish road: a spend that buys nothing must cost nothing.
func TestSixFishBridgeRefusesIllegalSiteFree(t *testing.T) {
	s := playState(t, "base+fishermen+rivers", 4)
	p := s.Cur
	s.Rolled = true
	giveFish(t, s, p, scenarios.FishBridgeCost)
	// A river edge nobody's road reaches is a bridge site the seat may not use.
	e := unconnectedBridgeSite(t, s, p)
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: scenarios.CmdSpendFish,
		Data: rawCmd(map[string]any{"use": scenarios.FishBridge, "e": e})}); err == nil {
		t.Fatal("six fish bought a bridge with nothing to connect it to")
	}
	if got := fishHeld(t, s, p); got != scenarios.FishBridgeCost {
		t.Fatalf("a refused bridge spend took fish: %d left", got)
	}
}

// --- helpers ---------------------------------------------------------------

// cityFor gives p a city on the board and returns its vertex, so a pillage has
// something to be about.
func cityFor(t *testing.T, s *engine.State, p engine.PlayerID) board.Vertex {
	t.Helper()
	for v, b := range s.Buildings {
		if b.Owner == p {
			b.City = true
			s.Buildings[v] = b
			return v
		}
	}
	t.Fatalf("seat %d owns no building after setup", p)
	return board.Vertex{}
}

func setCoins(t *testing.T, s *engine.State, p engine.PlayerID, n int) {
	t.Helper()
	x, ok := rivers.StateExt(s)
	if !ok {
		t.Fatal("no rivers ext in a rivers game")
	}
	x.Coins[p] = n
}

// giveFish hands p exactly `value` fish in 1-fish tiles, so a whole-tile spend
// takes everything and a wrong charge shows up as a leftover.
func giveFish(t *testing.T, s *engine.State, p engine.PlayerID, value int) {
	t.Helper()
	x, ok := scenarios.FishStateExt(s)
	if !ok {
		t.Fatal("no fishermen ext in a fishermen game")
	}
	x.Held[p] = [3]int{value, 0, 0}
}

// fishHeld is what p's tiles are worth.
func fishHeld(t *testing.T, s *engine.State, p engine.PlayerID) int {
	t.Helper()
	x, ok := scenarios.FishStateExt(s)
	if !ok {
		t.Fatal("no fishermen ext in a fishermen game")
	}
	return scenarios.FishValue(x.Held[p])
}

// freeBridgeSite is an empty bridge site p's road network reaches: a road of p's
// is placed on an edge sharing a vertex with the site.
func freeBridgeSite(t *testing.T, s *engine.State, p engine.PlayerID) board.Edge {
	t.Helper()
	x, ok := rivers.StateExt(s)
	if !ok {
		t.Fatal("no rivers ext in a rivers game")
	}
	for e := range x.BridgeSites() {
		if _, taken := x.Bridges[e]; taken {
			continue
		}
		if _, taken := s.Roads[e]; taken {
			continue
		}
		for _, adj := range e.A.Edges() {
			if adj == e {
				continue
			}
			if _, taken := s.Roads[adj]; taken {
				continue
			}
			// Not a river edge: a road there would earn its own coin on the
			// ledger's next pass, and the test measures what the bridge paid.
			if x.IsRiverEdge(adj) {
				continue
			}
			s.Roads[adj] = p
			if s.RoadConnectsExcluding(e, p, board.Edge{}) {
				return e
			}
			delete(s.Roads, adj)
		}
	}
	t.Fatal("no empty bridge site could be connected to the seat's network")
	return board.Edge{}
}

// unconnectedBridgeSite is an empty bridge site p's network does not reach.
func unconnectedBridgeSite(t *testing.T, s *engine.State, p engine.PlayerID) board.Edge {
	t.Helper()
	x, ok := rivers.StateExt(s)
	if !ok {
		t.Fatal("no rivers ext in a rivers game")
	}
	for e := range x.BridgeSites() {
		if _, taken := x.Bridges[e]; taken {
			continue
		}
		if _, taken := s.Roads[e]; taken {
			continue
		}
		if !s.RoadConnectsExcluding(e, p, board.Edge{}) {
			return e
		}
	}
	t.Fatal("every bridge site is connected to the seat's network")
	return board.Edge{}
}
