package ruletest

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/harbormaster"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/scenarios"
)

func TestRiverCoinsAcceptAtomicCommodityPayments(t *testing.T) {
	for _, ratio := range []int{4, 3, 2} {
		t.Run(string(rune('0'+ratio)), func(t *testing.T) {
			s := playState(t, "base+cak+rivers", 4)
			s.Rolled = true
			p := s.Cur
			cx, _ := knights.StateExt(s)
			s.Board.Harbors = nil
			if ratio == 3 {
				harbourAt(t, s, p, board.Harbor{Ratio: 3})
			}
			if ratio == 2 {
				cx.ComFleet[p] = int(knights.Cloth) + 1
			}
			cx.Players[p].Commodities[knights.Cloth] = ratio - 1
			before := rivers.Coins(s, p)
			command := engine.Command{Player: p, Type: rivers.CmdBuyCoin, Data: rawCmd(map[string]any{"good": "cloth"})}
			if _, err := engine.Decide(s, command); err == nil {
				t.Fatal("short payment accepted")
			}
			if cx.Players[p].Commodities[knights.Cloth] != ratio-1 || rivers.Coins(s, p) != before {
				t.Fatal("refusal mutated live state")
			}
			cx.Players[p].Commodities[knights.Cloth] = ratio
			events, err := engine.Decide(s, command)
			if err != nil {
				t.Fatal(err)
			}
			if cx.Players[p].Commodities[knights.Cloth] != ratio {
				t.Fatal("decide spent live commodities")
			}
			for _, ev := range events {
				if err := engine.Apply(s, ev); err != nil {
					t.Fatal(err)
				}
			}
			if cx.Players[p].Commodities[knights.Cloth] != 0 || rivers.Coins(s, p) != before+1 {
				t.Fatal("wrong commodity price or coin payment")
			}
		})
	}
}

func TestConquestSuppressesBuildingBonuses(t *testing.T) {
	s := playState(t, "base+raiders+caravans+harbormaster", 4)
	p := s.Cur
	rx, _ := raiders.StateExt(s)
	cx, _ := scenarios.CaravansStateExt(s)
	var v board.Vertex
	found := false
	for _, h := range rx.Coast {
		for _, candidate := range h.Vertices() {
			coastOnly := true
			for _, adj := range candidate.Hexes() {
				if s.Board.Land(adj) {
					coastal := false
					for _, c := range rx.Coast {
						if c == adj {
							coastal = true
						}
					}
					if !coastal {
						coastOnly = false
					}
				}
			}
			if coastOnly {
				v = candidate
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("no conquerable coastal vertex")
	}
	s.Buildings = map[board.Vertex]engine.Building{v: {Owner: p, City: true}}
	s.Board.Harbors = []board.Harbor{{Ratio: 3, Verts: [2]board.Vertex{v, v}}}
	neighbors := v.Neighbors()
	cx.Chains[0] = []board.Edge{board.NewEdge(v, neighbors[0]), board.NewEdge(v, neighbors[1])}
	if scenarios.VictoryVP(s, p) != 1 || harbormaster.HarborPoints(s, p) != 2 {
		t.Fatal("fixture bonuses missing")
	}
	for _, h := range v.Hexes() {
		for i, c := range rx.Coast {
			if c == h {
				rx.RaiderCount[i] = 3
			}
		}
	}
	if !s.BuildingVPSuppressed(v) {
		t.Fatal("fixture not conquered")
	}
	if scenarios.VictoryVP(s, p) != 0 || harbormaster.HarborPoints(s, p) != 0 {
		t.Fatal("conquered building retained scenario bonus")
	}
	for i := range rx.RaiderCount {
		rx.RaiderCount[i] = 0
	}
	if scenarios.VictoryVP(s, p) != 1 || harbormaster.HarborPoints(s, p) != 2 {
		t.Fatal("liberation did not restore bonuses")
	}
}
