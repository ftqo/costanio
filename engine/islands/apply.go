package islands

import (
	"github.com/ftqo/costan.io/engine"
)

func (Module) Apply(s *engine.State, e engine.Event) (bool, error) {
	x := ext(s)
	switch e.Type {
	case EvShipBuilt:
		d := engine.DecodeEvent[shipData](e)
		x.Ships[d.E] = d.Player
		x.ShipsLeft[d.Player]--
		// "Built this turn" is a play-phase restriction (a ship cannot move the
		// turn it was built). A free setup ship is placed before any turn
		// exists, so it is not marked: BuiltTurn is cleared by EvTurnReset,
		// which is emitted only for EvTurnStarted in PhasePlay, and player 0's
		// first EvTurnStarted rides a setup-phase command whose finalize
		// returns early, so a marked setup ship would never become movable.
		// Phase is still PhaseSetup here (the flip rides later events in the
		// same batch), so replay is exact.
		if !d.Free || s.Phase != engine.PhaseSetup {
			x.BuiltTurn[d.E] = true
		}
		if d.Free {
			// A Road Building free ship spends one free build; a setup ship is
			// also Free but is placed with no FreeRoads pending (so untouched).
			if s.FreeRoads > 0 {
				s.FreeRoads--
			}
		} else {
			s.Players[d.Player].Hand.Sub(CostShip)
			s.Bank.Add(CostShip)
		}

	case EvShipMoved:
		d := engine.DecodeEvent[shipMoveData](e)
		delete(x.Ships, d.From)
		x.Ships[d.To] = d.Player
		x.MovedShip = true

	case EvPirateMoved:
		d := engine.DecodeEvent[pirateData](e)
		x.Pirate = d.Hex
		x.HasPirate = true
		s.RobberPending = false

	case EvGoldOwed:
		d := engine.DecodeEvent[goldOwedData](e)
		for _, o := range d.Owed {
			x.PendingGold[o.Player] += o.Count
		}

	case EvGoldChosen:
		d := engine.DecodeEvent[goldChosenData](e)
		s.Players[d.Player].Hand.Add(d.Gain)
		s.Bank.Sub(d.Gain)
		delete(x.PendingGold, d.Player)

	case EvIslandChip:
		d := engine.DecodeEvent[islandChipData](e)
		if x.Reached[d.Player] == nil {
			x.Reached[d.Player] = map[int]bool{}
		}
		x.Reached[d.Player][d.Island] = true
		x.IslandVP[d.Player] += d.VP

	case EvTurnReset:
		clear(x.BuiltTurn)
		x.MovedShip = false

	default:
		return false, nil
	}
	return true, nil
}
