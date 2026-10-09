package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestCommercialHarborMayOfferASubset: the player may offer each other player
// one of their resource cards, at most one offer per player. Skipping an
// affordable opponent and stopping early are both legal.
func TestCommercialHarborMayOfferASubset(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	// Both opponents hold a commodity, and the taker could afford to force both.
	others := []engine.PlayerID{}
	for q := range s.Players {
		if engine.PlayerID(q) != p {
			x.Players[q].Commodities = CommodityHand{Cloth: 1}
			others = append(others, engine.PlayerID(q))
		}
	}
	s.Players[p].Hand = engine.Hand{board.Wheat: 2, board.Ore: 2}

	// Targeting only one of the two affordable opponents is a legal play.
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor,
			"gives": []map[string]any{{"player": others[0], "res": board.Wheat}}})})
	if len(x.HarborGive) != 1 {
		t.Fatalf("a one-opponent offer should force exactly that opponent, got %v", x.HarborGive)
	}
	if _, ok := x.HarborGive[others[0]]; !ok {
		t.Errorf("opponent %d was not forced: %v", others[0], x.HarborGive)
	}
	if _, ok := x.HarborGive[others[1]]; ok {
		t.Errorf("opponent %d was skipped by the taker and must not be forced: %v", others[1], x.HarborGive)
	}
}

// TestCommercialHarborRepeatOpponent: the one cap the card does
// carry is one offer per player, so an allocation naming the same opponent
// twice is illegal.
func TestCommercialHarborRepeatOpponent(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	other := engine.NoPlayer
	for q := range s.Players {
		if engine.PlayerID(q) != p {
			x.Players[q].Commodities = CommodityHand{Cloth: 2}
			if other == engine.NoPlayer {
				other = engine.PlayerID(q)
			}
		}
	}
	s.Players[p].Hand = engine.Hand{board.Wheat: 2, board.Ore: 2}

	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor,
			"gives": []map[string]any{
				{"player": other, "res": board.Wheat},
				{"player": other, "res": board.Ore},
			}})}, engine.ErrBadCommand)
}

// TestCommercialHarborEmptyOfferRejected: a card known to do nothing may not
// be played. An explicit allocation forcing nobody while an affordable target
// exists is refused (with no target at all, see
// TestCommercialHarborNoTargets).
func TestCommercialHarborEmptyOfferRejected(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	for q := range s.Players {
		if engine.PlayerID(q) != p {
			x.Players[q].Commodities = CommodityHand{Cloth: 1}
		}
	}
	s.Players[p].Hand = engine.Hand{board.Wheat: 2}

	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor,
			"gives": []map[string]any{}})}, engine.ErrBadCommand)
}

// TestCommercialHarborResourceLimitedSubset: when the taker lacks the resources
// to force everyone, they may target the affordable subset (here, 1 of
// 2 opponents with only 1 resource in hand).
func TestCommercialHarborResourceLimitedSubset(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	others := []engine.PlayerID{}
	for q := range s.Players {
		if engine.PlayerID(q) != p {
			x.Players[q].Commodities = CommodityHand{Cloth: 1}
			others = append(others, engine.PlayerID(q))
		}
	}
	s.Players[p].Hand = engine.Hand{board.Wheat: 1} // only enough for one

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor,
			"gives": []map[string]any{{"player": others[0], "res": board.Wheat}}})})
	if len(x.HarborGive) != 1 {
		t.Errorf("resource-limited harbor should force exactly 1 opponent, got %v", x.HarborGive)
	}
}
