package wagons

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// ViewExt is what a client is handed: everything a player can see at the table.
//
// The only hidden thing is the order of the cargo stacks, and that is never in
// this state (see stackOrder); only the remaining count travels.
//
// Every reference field is copied: the view is serialized on a connection
// goroutine while the actor keeps folding into the same ext.
// engine/ruletest.TestViewExtSharesNothingWithLiveExt enforces it.
func (e *WagonsExt) ViewExt(viewer engine.PlayerID) any {
	type tradeView struct {
		Hex     board.Hex `json:"hex"`
		Role    uint8     `json:"role"`
		Plaza   any       `json:"plaza"`
		Accepts []int     `json:"accepts"`
		Ships   []int     `json:"ships"`
		Left    int       `json:"left"`
	}
	v := map[string]any{
		// The scenario's constants, so the client does not keep its own copy of
		// the rules.
		"mp_track":     scaledTrack(e.MPBonus),
		"max_level":    maxLevel,
		"gold_price":   goldPerResource,
		"buys_a_turn":  buysPerTurn,
		"stack_depth":  stackDepth,
		"gold":         slices.Clone(e.Gold),
		"level":        slices.Clone(e.Level),
		"cargo":        wireBytes(e.Cargo),
		"delivered":    slices.Clone(e.Landed),
		"started":      e.Started,
		"swift_left":   e.SwiftLeft,
		"move_open":    e.MoveOpen,
		"move_done":    e.MoveDone,
		"moved":        e.Moved,
		"mp":           e.MP,
		"boosted":      e.Boosted,
		"turn_seat":    e.TurnSeat,
		"tried":        e.Tried,
		"path_tried":   slices.Clone(e.PathTried),
		"bought":       e.Bought,
		"barb_seat":    e.BarbSeat,
		"barb_index":   e.BarbIdx,
		"has_trade":    e.HasTrade,
		"drive_floors": driveFloors(),
	}
	// A list rather than the slice, so a seat with no wagon is absent instead
	// of serialising the zero vertex, which is a real intersection.
	type wagonView struct {
		Player engine.PlayerID `json:"player"`
		V      board.Vertex    `json:"v"`
	}
	wagons := make([]wagonView, 0, len(e.Wagon))
	if e.Started {
		for i, w := range e.Wagon {
			if i >= len(e.OnBoard) || !e.OnBoard[i] {
				continue
			}
			wagons = append(wagons, wagonView{Player: engine.PlayerID(i), V: w})
		}
	}
	v["wagons"] = wagons

	if e.HasTrade {
		trade := make([]tradeView, 0, tradeHexCount)
		for i, h := range e.Trade {
			role := e.Roles[i]
			p := plazaOf(h)
			trade = append(trade, tradeView{
				Hex: h, Role: role,
				// The plaza is an intersection wagons stop on, addressed as the
				// trade hex's coordinate with a third Side value. See board.go.
				Plaza:   p,
				Accepts: wireBytes(acceptsOf(role)),
				Ships:   func() []int { sh := shipsOf(role); return []int{int(sh[0]), int(sh[1])} }(),
				Left:    stackDepth - e.Drawn[i],
			})
		}
		v["trade"] = trade
		v["barbarians"] = slices.Clone(e.Barb[:])
	}
	// A seat's own Swift Journeys, and everyone else's count. The count is
	// public because the purchase event's type already reveals it. See the
	// Decision in docs/rules/wagons.md.
	if viewer >= 0 && int(viewer) < len(e.Swift) {
		v["swift"] = e.Swift[viewer]
		v["swift_new"] = e.SwiftNew[viewer]
	}
	held := make([]int, len(e.Swift))
	for i := range e.Swift {
		held[i] = e.Swift[i] + e.SwiftNew[i]
	}
	v["swift_held"] = held
	return v
}

// ViewExtRevealed is the finished-game view: there is no play left to hide, so
// every seat's Swift Journey hand is filled in.
//
// ViewExt gates the per-seat half behind `viewer >= 0`, which the spectator
// view game.NewRevealedReplayView builds cannot satisfy.
func (e *WagonsExt) ViewExtRevealed() any {
	v, ok := e.ViewExt(engine.NoPlayer).(map[string]any)
	if !ok {
		return e.ViewExt(engine.NoPlayer)
	}
	v["swift_by_seat"] = slices.Clone(e.Swift)
	v["swift_new_by_seat"] = slices.Clone(e.SwiftNew)
	return v
}

// scaledTrack is the movement track as this board drives it: the radius-2
// entries plus the board's bonus.
func scaledTrack(bonus int) [maxLevel]int {
	out := mpTrack
	for i := range out {
		out[i] += bonus
	}
	return out
}

// driveFloors is the lowest die that drives a barbarian off at each level,
// published so the client can say "5 or 6" without a second copy of the table.
// Index by level-1; 7 means "never", which is level 1.
func driveFloors() [maxLevel]int {
	var out [maxLevel]int
	for i := range out {
		out[i] = driveOffFloor(i + 1)
	}
	return out
}

// wireBytes widens a []uint8 for the wire: encoding/json writes []uint8 as a
// base64 string, and the client expects a number array. The result is also a
// fresh copy.
func wireBytes(b []uint8) []int {
	out := make([]int, len(b))
	for i, c := range b {
		out[i] = int(c)
	}
	return out
}
