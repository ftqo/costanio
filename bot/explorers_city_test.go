package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/explorers"
)

func TestExplorersCityChoiceCanBuyTheLastOre(t *testing.T) {
	for _, funded := range []bool{false, true} {
		s := explorersPlayableRuleset(t, 5, "cak+explorers")
		seat := s.Cur
		// Turn the starting city into an upgradeable settlement, keeping the
		// separate starting harbour and ship. No undiscovered vertex is invented.
		found := false
		for v, building := range s.Buildings {
			if building.Owner == seat && building.City {
				building.City = false
				s.Buildings[v] = building
				s.Players[seat].CitiesLeft++
				s.Players[seat].SettlementsLeft--
				found = true
				break
			}
		}
		if !found {
			t.Fatal("setup did not place a city")
		}
		s.Players[seat].Hand = engine.CostCity
		if !funded {
			s.Players[seat].Hand[board.Ore]--
		}
		x, _ := explorers.StateExt(s)
		x.Seats[seat].Gold = explorers.GoldPerResource + explorers.Tribute
		b := NewStrong()
		cmd, ok := b.explorersCityChoice(s, seat)
		want := engine.CmdBuildCity
		if !funded {
			want = explorers.CmdGoldBuy
		}
		if !ok || cmd.Type != want {
			t.Fatalf("funded=%v: got %s (%v), want %s", funded, cmd.Type, ok, want)
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatal(err)
		}
		for _, ev := range events {
			if err := engine.Apply(s, ev); err != nil {
				t.Fatal(err)
			}
		}
		if !funded {
			cmd, ok = b.explorersCityChoice(s, seat)
			if !ok || cmd.Type != engine.CmdBuildCity {
				t.Fatalf("the funded city was not built: %s (%v)", cmd.Type, ok)
			}
			if _, err := engine.Decide(s, cmd); err != nil {
				t.Fatal(err)
			}
		}
	}
}
