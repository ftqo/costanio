package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// The baseline bot's Fishermen policy: spend the cheapest rung it can afford,
// and pass the boot when the rules allow.
//
// Fishermen has no Auto hook, so without this Simple would never spend fish or
// pass the boot. Simple is what the adversarial battery plays (where
// checkRuleInvariants runs), and the 4-fish bank withdrawal (FishTakeResource in
// engine/scenarios/fishermen.go) is Fishermen's only base-resource movement, so the
// resource ledger needs Simple to reach it.
//
// It stays minimal: cheapest affordable rung, first legal target, no
// evaluation. Strong must not inherit it (NewStrong leaves the field zero),
// since greedy spending would take fish Strong is saving for a higher rung.
//
// Deterministic: rungs in cost order, victims in seat order, resources in
// board.Resources order, roads in LegalRoads order. The two spends that resolve
// a draw (steal, dev card) are legality-checked on a discarded clone.
func simpleFishPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	x, ok := scenarios.FishStateExt(s)
	if !ok {
		return engine.Command{}, false // not a Fishermen game
	}
	// Every command below needs an actionable turn; check once up front.
	if engine.RequireActionableTurn(s, seat) != nil {
		return engine.Command{}, false
	}
	// The boot first: it costs a victory point while held. Legality is asked of
	// the engine.
	if x.BootHolder == seat {
		for p := range s.Players {
			q := engine.PlayerID(p)
			if q == seat {
				continue
			}
			cmd := engine.Command{Player: seat, Type: scenarios.CmdGiveBoot,
				Data: raw(map[string]any{"to": q})}
			if cmdLegal(s, cmd) {
				return cmd, true
			}
		}
	}

	have := ownFish(s, seat)
	if have < 2 {
		return engine.Command{}, false
	}
	spend := func(use string, data map[string]any) (engine.Command, bool) {
		data["use"] = use
		cmd := engine.Command{Player: seat, Type: scenarios.CmdSpendFish, Data: raw(data)}
		return cmd, cmdLegal(s, cmd)
	}

	// Rungs in cost order. A rung the ruleset removes (e.g. Knights has no dev
	// deck) is refused by the engine's legality check.
	// The 2-fish rung takes no target: it removes the robber from the board.
	if have >= 2 && s.Board.RobberOnBoard() {
		if cmd, ok := spend(scenarios.FishRemoveRobber, map[string]any{}); ok {
			return cmd, true
		}
	}
	if have >= 3 {
		for p := range s.Players {
			if engine.PlayerID(p) == seat {
				continue
			}
			if cmd, ok := spend(scenarios.FishSteal, map[string]any{"victim": engine.PlayerID(p)}); ok {
				return cmd, true
			}
		}
	}
	if have >= 4 {
		// A bank withdrawal, Fishermen's only base-resource movement.
		for _, r := range board.Resources {
			if cmd, ok := spend(scenarios.FishTakeResource, map[string]any{"res": r}); ok {
				return cmd, true
			}
		}
	}
	if have >= 5 {
		for _, e := range s.LegalRoads(seat) {
			if cmd, ok := spend(scenarios.FishFreeRoad, map[string]any{"e": e}); ok {
				return cmd, true
			}
		}
	}
	if have >= 7 {
		if cmd, ok := spend(scenarios.FishDevCard, map[string]any{}); ok {
			return cmd, true
		}
	}
	return engine.Command{}, false
}
