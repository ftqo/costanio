package islands

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// In base+islands+cak the pirate must treat a Knights player holding only
// commodities as a valid target and steal from the combined resource and
// commodity pool through the cak StealCard hook, as the land robber does.
func TestPirateStealsFromCombinedPool(t *testing.T) {
	h := board.Hex{Q: 1, R: 0}
	cases := []struct {
		name       string
		resHand    engine.Hand
		coms       knights.CommodityHand
		wantVictim bool
		wantEvent  engine.EventType
	}{
		{"commodity-only victim", engine.Hand{}, knights.CommodityHand{knights.Cloth: 3}, true, knights.EvCommodityStolen},
		{"resource-only victim", engine.Hand{board.Wood: 2}, knights.CommodityHand{}, true, engine.EvCardStolen},
		{"empty victim excluded", engine.Hand{}, knights.CommodityHand{}, false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := builtState(t, 2, h)
			s.Config.Ruleset = "base+islands+cak"
			s.RobberPending = true

			// Victim (player 1) has a ship bordering the sea hex h.
			e := h.Edges()[0]
			ext(s).Ships[e] = 1

			// Victim's holdings: resource hand on the base state, commodities in the
			// cak module ext.
			s.Players[1].Hand = tc.resHand
			cx := &knights.Ext{Players: make([]knights.PlayerExt, 2)}
			cx.Players[1].Commodities = tc.coms
			s.Ext[knights.Name] = cx

			// pirateVictims must use combined-pool stealability (DiscardableCount),
			// so a commodity-only victim counts and an empty one does not.
			if got := pirateVictims(s, h, 0)[1]; got != tc.wantVictim {
				t.Fatalf("pirateVictims[1] = %v, want %v", got, tc.wantVictim)
			}
			if !tc.wantVictim {
				return
			}

			victim := engine.PlayerID(1)
			evs, handled, err := (Module{}).Decide(s, engine.Command{
				Player: 0, Type: CmdMovePirate,
				Data: mustJSON(t, map[string]any{"hex": h, "victim": victim}),
			})
			if err != nil || !handled {
				t.Fatalf("Decide pirate: handled=%v err=%v", handled, err)
			}
			if !hasEvent(evs, EvPirateMoved) {
				t.Fatalf("missing pirate move: %+v", evs)
			}
			if !hasEvent(evs, tc.wantEvent) {
				t.Fatalf("steal event = %+v, want %s", evs, tc.wantEvent)
			}
		})
	}
}
