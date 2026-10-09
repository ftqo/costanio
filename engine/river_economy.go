package engine

import "github.com/ftqo/costan.io/engine/board"

// RiverEconomy is the Rivers-owned purse and crossings used by the Wagons
// combination. Mutators are only called while folding recorded events.
type RiverEconomy interface {
	RiverGold(PlayerID) int
	ChangeRiverGold(PlayerID, int)
	RiverPurchases() int
	CountRiverPurchase()
	RiverCrossing(board.Edge) (owner PlayerID, crossing, bridged bool)
}

func SharedRiverEconomy(s *State) (RiverEconomy, bool) {
	x, ok := s.Ext["rivers"].(RiverEconomy)
	return x, ok
}

// ComposedViewable adjusts an already-redacted view with public information
// owned by another module. It must not retain or expose references into State.
type ComposedViewable interface{ ComposeView(*State, any) any }

type RiverPurseUser interface{ UsesRiverPurse() bool }
