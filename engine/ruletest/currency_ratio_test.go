package ruletest

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/wagons"
)

// "Buy a unit of scenario currency from the supply at your port rate" is one rule
// written by three scenarios: a Rivers coin, a Raiders gold, a Wagons gold. Each
// module's own tests can pass while the three disagree, so this drives the same
// port configurations through each module's real Decide path and requires the
// same charge, equal to engine.State.CurrencyRatio. The module-override row checks
// that a rate another module lowered (Knights' Merchant Fleet) reaches all three.
func TestCurrencyRatioAgreesAcrossModules(t *testing.T) {
	for _, buy := range currencyBuys {
		for _, port := range portCases {
			t.Run(buy.name+"/"+port.name, func(t *testing.T) {
				s, p := buy.open(t, buy.ruleset)
				port.fit(t, s, p)

				want := port.want
				if got := s.CurrencyRatio(p, board.Ore); got != want {
					t.Fatalf("CurrencyRatio = %d, want %d", got, want)
				}

				// One card short is refused, so a pass cannot be a command that
				// charged nothing.
				s.Players[p].Hand = engine.Hand{}
				s.Players[p].Hand[board.Ore] = want - 1
				if _, err := engine.Decide(s, buy.cmd(p, board.Ore)); err == nil {
					t.Fatalf("%s bought a unit for %d ore; the rate is %d", buy.name, want-1, want)
				}

				s.Players[p].Hand[board.Ore] = want
				before := buy.held(s, p)
				evs, err := engine.Decide(s, buy.cmd(p, board.Ore))
				if err != nil {
					t.Fatalf("%s refused the sale at its own rate %d: %v", buy.name, want, err)
				}
				for _, e := range evs {
					if err := engine.Apply(s, e); err != nil {
						t.Fatalf("apply %s: %v", e.Type, err)
					}
				}
				if left := s.Players[p].Hand[board.Ore]; left != 0 {
					t.Fatalf("%s charged %d ore, want the port rate %d", buy.name, want-left, want)
				}
				if got := buy.held(s, p) - before; got != 1 {
					t.Fatalf("%s paid out %d units, want 1", buy.name, got)
				}
			})
		}
	}
}

// TestCurrencyRatioHonoursAModuleOverride: a rate another module lowered
// reaches all three currencies. Knights' Merchant Fleet (engine/knights/hooks.go
// bankRatio) gives 2:1 on one resource with no port on the board, so a rule that
// scans buildings for harbours cannot see it.
func TestCurrencyRatioHonoursAModuleOverride(t *testing.T) {
	for _, buy := range currencyBuys {
		t.Run(buy.name, func(t *testing.T) {
			s, p := buy.open(t, "base+cak+"+buy.name)
			s.Board.Harbors = nil
			cx, ok := knights.StateExt(s)
			if !ok {
				t.Fatal("no cak ext in a base+cak game")
			}
			for len(cx.Fleet) <= int(p) {
				cx.Fleet = append(cx.Fleet, board.ResNone)
			}
			cx.Fleet[p] = board.Ore + 1 // a Merchant Fleet held on ore

			if got := s.CurrencyRatio(p, board.Ore); got != 2 {
				t.Fatalf("CurrencyRatio under a Merchant Fleet = %d, want 2", got)
			}
			s.Players[p].Hand = engine.Hand{}
			s.Players[p].Hand[board.Ore] = 2
			evs, err := engine.Decide(s, buy.cmd(p, board.Ore))
			if err != nil {
				t.Fatalf("%s ignored the Merchant Fleet rate: %v", buy.name, err)
			}
			for _, e := range evs {
				if err := engine.Apply(s, e); err != nil {
					t.Fatalf("apply %s: %v", e.Type, err)
				}
			}
			if left := s.Players[p].Hand[board.Ore]; left != 0 {
				t.Fatalf("%s charged %d ore under a Merchant Fleet, want 2", buy.name, 2-left)
			}
		})
	}
}

// currencyBuy is one scenario's purchase of its own currency from the supply.
type currencyBuy struct {
	name    string
	ruleset string
	// open plays a game of ruleset to an actionable turn and returns the seat
	// whose turn it is, with whatever module state the command needs opened.
	open func(t *testing.T, ruleset string) (*engine.State, engine.PlayerID)
	// cmd is the purchase, paid for in res.
	cmd func(p engine.PlayerID, res board.Resource) engine.Command
	// held is how many units of the currency the seat holds.
	held func(s *engine.State, p engine.PlayerID) int
}

var currencyBuys = []currencyBuy{
	{
		name: "rivers", ruleset: "base+rivers",
		open: actionable,
		cmd: func(p engine.PlayerID, res board.Resource) engine.Command {
			return engine.Command{Player: p, Type: rivers.CmdBuyCoin, Data: rawCmd(map[string]any{"res": res})}
		},
		held: func(s *engine.State, p engine.PlayerID) int { return rivers.Coins(s, p) },
	},
	{
		name: "raiders", ruleset: "base+raiders",
		open: actionable,
		cmd: func(p engine.PlayerID, res board.Resource) engine.Command {
			return engine.Command{Player: p, Type: raiders.CmdSellForGold, Data: rawCmd(map[string]any{"res": res, "count": 1})}
		},
		held: func(s *engine.State, p engine.PlayerID) int { return raiders.GoldOf(s, p) },
	},
	{
		name: "wagons", ruleset: "base+wagons",
		open: openWagons,
		cmd: func(p engine.PlayerID, res board.Resource) engine.Command {
			return engine.Command{Player: p, Type: wagons.CmdSell, Data: rawCmd(map[string]any{"res": res})}
		},
		held: func(s *engine.State, p engine.PlayerID) int { return wagons.Gold(s, p) },
	},
}

// portCase is one harbour configuration for the seat and the rate it must give.
// The fourth case catches a floor or a per-seat scan: a 2:1 on a different
// resource leaves ore at 4.
var portCases = []struct {
	name string
	want int
	fit  func(t *testing.T, s *engine.State, p engine.PlayerID)
}{
	{"no-port", 4, func(t *testing.T, s *engine.State, p engine.PlayerID) {
		t.Helper()
		s.Board.Harbors = nil
	}},
	{"generic-3to1", 3, func(t *testing.T, s *engine.State, p engine.PlayerID) {
		t.Helper()
		harbourAt(t, s, p, board.Harbor{Ratio: 3, Res: board.ResNone})
	}},
	{"specific-2to1-on-ore", 2, func(t *testing.T, s *engine.State, p engine.PlayerID) {
		t.Helper()
		harbourAt(t, s, p, board.Harbor{Ratio: 2, Res: board.Ore})
	}},
	{"specific-2to1-elsewhere", 4, func(t *testing.T, s *engine.State, p engine.PlayerID) {
		t.Helper()
		harbourAt(t, s, p, board.Harbor{Ratio: 2, Res: board.Wheat})
	}},
}

// harbourAt gives seat p that harbour and no other, on a vertex it already
// occupies, so the seat's rate is exactly the one the case names.
func harbourAt(t *testing.T, s *engine.State, p engine.PlayerID, h board.Harbor) {
	t.Helper()
	for v, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		h.Verts = [2]board.Vertex{v, v}
		s.Board.Harbors = []board.Harbor{h}
		return
	}
	t.Fatalf("seat %d owns no building after setup", p)
}

// actionable plays ruleset through setup and returns a state on the current
// seat's turn with the dice thrown. The roll is stamped rather than rolled so no
// robber, discard or module pending gets in the way.
func actionable(t *testing.T, ruleset string) (*engine.State, engine.PlayerID) {
	t.Helper()
	s := playState(t, ruleset, 4)
	s.Rolled = true
	return s, s.Cur
}

// openWagons is actionable for a scenario that opens only with the first play
// batch (EvStart deals the wagons, which a stamped roll would skip). It plays on
// until the scenario runs with nothing owed, then stamps the turn actionable.
func openWagons(t *testing.T, ruleset string) (*engine.State, engine.PlayerID) {
	t.Helper()
	s := playState(t, ruleset, 4)
	started := func() bool {
		x, ok := s.Ext[wagons.WagonsName].(*wagons.WagonsExt)
		return ok && x.Started
	}
	for step := 0; step < 400 && (!started() || engine.RequireUninterruptedTurn(s, s.Cur) != nil); step++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("nothing to do and the wagons never started")
		}
		evs, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("decide %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("apply %s: %v", e.Type, err)
			}
		}
	}
	if !started() {
		t.Fatal("the wagons scenario never started")
	}
	s.Rolled = true
	return s, s.Cur
}

func rawCmd(v map[string]any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
