package raiders

import (
	"encoding/json"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The two Knights event types this scenario reacts to, as wire strings since
// modules do not import each other. TestKnightsEventNamesMatch pins them against
// engine/knights' constants in the test build.
const (
	knightsEventDie engine.EventType = "cak_event_die"
	knightsImproved engine.EventType = "cak_improved"
)

// Decide handles the scenario's commands.
func (m Module) Decide(s *engine.State, cmd engine.Command) ([]engine.Event, bool, error) {
	if len(extRO(s).PathQueue) > 0 && cmd.Type != CmdPickPath {
		switch cmd.Type {
		case CmdBuyCard, CmdPlaceRider, CmdMoveRider, CmdPickHex, CmdTreason, CmdSteal, CmdBuyResource, CmdSellForGold, CmdDeclineOffer:
			return nil, true, engine.ErrWrongPhase
		default:
		}
	}
	switch cmd.Type {
	case CmdPickPath:
		ev, err := m.decidePath(s, cmd)
		return ev, true, err
	case CmdBuyCard:
		ev, err := m.decideBuyCard(s, cmd)
		return ev, true, err
	case CmdPlaceRider:
		ev, err := m.decidePlaceRider(s, cmd)
		return ev, true, err
	case CmdMoveRider:
		ev, err := m.decideMoveRider(s, cmd)
		return ev, true, err
	case CmdPickHex:
		ev, err := m.decidePickHex(s, cmd)
		return ev, true, err
	case CmdTreason:
		ev, err := m.decideTreason(s, cmd)
		return ev, true, err
	case CmdSteal:
		ev, err := m.decideSteal(s, cmd)
		return ev, true, err
	case CmdBuyResource:
		ev, err := m.decideBuyResource(s, cmd)
		return ev, true, err
	case CmdSellForGold:
		ev, err := m.decideSellForGold(s, cmd)
		return ev, true, err
	case CmdDeclineOffer:
		ev, err := m.decideDecline(s, cmd)
		return ev, true, err
	default:
	}
	return nil, false, nil
}

// onEvents is where the scenario's two automatic beats happen: a landing after
// every build, and the battle sweep after every turn.
//
// The placement round does not trigger landings: the rule fires on a build made
// on your turn, and setup seeds the coast directly (deriveBoard). finalizeWith
// already skips OnEvents outside PhasePlay; the gate is repeated here so this
// module does not depend on the shape of setup.
func (m Module) onEvents(after *engine.State, events []engine.Event) []engine.Event {
	if after.Phase != engine.PhasePlay {
		return nil
	}
	x := extRO(after)
	if !x.HasCastle {
		return nil
	}
	builds, ended := 0, false
	// The Knights combination's two extra triggers, read off the batch by wire
	// string rather than by importing engine/knights. A ruleset without Knights
	// never carries either event.
	improvements, shipRoll, shipFace := 0, 0, false
	for _, e := range events {
		switch e.Type {
		case engine.EvSettlementBuilt, engine.EvCityBuilt:
			builds++
		case engine.EvTurnEnded:
			ended = true
		case engine.EvDiceRolled:
			d := engine.DecodeEvent[engine.DiceRolledData](e)
			shipRoll = d.D1 + d.D2
		case knightsEventDie:
			var d struct {
				Face string `json:"face"`
			}
			if json.Unmarshal(e.Data, &d) == nil && d.Face == "ship" {
				shipFace = true
			}
		case knightsImproved:
			improvements++
		default:
		}
	}
	var out []engine.Event
	// A landing interrupts the turn and is resolved first. The pending check is
	// defensive: BlocksTurnActions already refuses a build while a landing is
	// open.
	//
	// Builds and city improvements share one queue because they share one
	// pending: three distinct numbers per build plus one per improvement,
	// stacking as the combination rule says.
	if (builds > 0 || improvements > 0) && x.Pend.Kind == PendNone {
		out = append(out, m.landingFor(after, x, after.Cur, builds, improvements, 0)...)
	}
	// The event die's ship face lands one raider on the hex the turn's own
	// production dice named. It is not a fresh roll, so it is not in the queue
	// above, and it cannot share a batch with a build (the die is rolled with
	// the dice; a build is a later command).
	if (shipFace || (x.Shared && (shipRoll == 2 || shipRoll == 12))) && x.Pend.Kind == PendNone && len(out) == 0 {
		if shipFace && x.Shared && (shipRoll == 2 || shipRoll == 12) {
			numbers := []int{shipRoll, shipRoll}
			out = append(out, engine.NewEvent(EvLanding, landingData{Player: after.Cur, Numbers: numbers}))
			out = append(out, m.resolveLanding(after, x, numbers)...)
		} else {
			out = append(out, m.singleLandingFor(after, x, after.Cur, shipRoll, 0)...)
		}
	}
	if ended {
		// The sweep marker first, then the battles. It clears the turn's
		// bookkeeping (riders moved, gold spent on resources) as an explicit
		// fold step, and is emitted even when no battle follows.
		out = append(out, engine.NewEvent(EvSweep, sweepData{Player: after.Cur}))
		out = append(out, m.sweep(after, x, len(out))...)
	}
	return out
}

// blocks pauses the turn while the scenario is waiting on somebody.
//
// A pending is a decision owed right now; nothing else may happen until it is
// answered. A castle rider that must leave is different: the player may keep
// building and trading and only the pass is refused. decideEndTurn checks the
// strict Blocks; requireUninterruptedTurn checks blocksTurnActions.
func (m Module) blocks(s *engine.State) bool {
	if s.Phase != engine.PhasePlay {
		return false
	}
	x := extRO(s)
	if len(x.PathQueue) > 0 || x.Pend.Kind != PendNone {
		return true
	}
	// Only once the dice are thrown. The rule is that the turn may not end
	// while a castle rider could still leave, and a turn cannot end before the
	// roll anyway; but AutoCommand consults Blocks before the roll, so
	// reporting it earlier would make the timer offer a rider move
	// decideMoveRider refuses.
	if !s.Rolled {
		return false
	}
	_, stuck := x.stuckAtCastle(s.Cur)
	return stuck
}

func (m Module) blocksTurnActions(s *engine.State) bool {
	if s.Phase != engine.PhasePlay {
		return false
	}
	return len(extRO(s).PathQueue) > 0 || extRO(s).Pend.Kind != PendNone
}

// auto is the module's minimal legal answer, for the turn timer and for a bot
// seat with nothing better to do.
//
// It declines while discards are owed, so AutoCommand falls through to the
// discard branch: the 7's steal and a landing both wait behind discards.
func (m Module) auto(s *engine.State, target engine.PlayerID) (engine.Command, bool) {
	if s.Phase != engine.PhasePlay {
		return engine.Command{}, false
	}
	x := extRO(s)
	if len(x.PathQueue) > 0 {
		if len(s.PendingDiscards) > 0 || (target != engine.NoPlayer && target != x.PathSeat) {
			return engine.Command{}, false
		}
		return engine.Command{Player: x.PathSeat, Type: CmdPickPath, Data: raw(map[string]any{"e": x.PathEdges[0]})}, true
	}
	if x.Pend.Kind != PendNone {
		seat := x.Pend.Seat
		if seat < 0 || (target != engine.NoPlayer && target != seat) {
			return engine.Command{}, false
		}
		if len(s.PendingDiscards) > 0 {
			return engine.Command{}, false
		}
		switch x.Pend.Kind {
		case PendLanding, PendIntrigue:
			if len(x.Pend.Hexes) == 0 {
				return engine.Command{}, false
			}
			return engine.Command{Player: seat, Type: CmdPickHex,
				Data: raw(map[string]any{"hex": x.Pend.Hexes[0]})}, true
		case PendMuster:
			if len(x.Pend.Edges) == 0 || x.RidersLeft[seat] == 0 {
				return engine.Command{}, false
			}
			return engine.Command{Player: seat, Type: CmdPlaceRider,
				Data: raw(map[string]any{"e": x.Pend.Edges[0]})}, true
		case PendSwift:
			// Optional, so the minimal answer is to decline.
			return engine.Command{Player: seat, Type: CmdDeclineOffer}, true
		case PendTreason:
			return engine.Command{Player: seat, Type: CmdTreason,
				Data: raw(map[string]any{"moves": autoTreason(x, hasKnights(s))})}, true
		case PendSteal:
			victims := stealVictims(s, seat)
			payload := map[string]any{}
			if len(victims) > 0 {
				payload["victim"] = victims[0]
			}
			return engine.Command{Player: seat, Type: CmdSteal, Data: raw(payload)}, true
		}
		return engine.Command{}, false
	}
	// A castle rider that must leave. Only the seat that owns it can move it, and
	// only its own turn is blocked.
	seat := s.Cur
	if target != engine.NoPlayer && target != seat {
		return engine.Command{}, false
	}
	// Only when the seat may act at all. This is the one Auto branch that
	// answers with an ordinary turn action, so another module can refuse it:
	// AutoCommandFor returns the first Auto that answers before collecting
	// every gate, and with a Knights interrupt open this rider move would be
	// refused repeatedly until the game paused.
	//
	// RequireActionableTurn applies every other module's gate and does not gate
	// on this module's castle rider (blocksTurnActions leaves that free), so it
	// cannot refuse the move being offered.
	if engine.RequireActionableTurn(s, seat) != nil {
		return engine.Command{}, false
	}
	from, stuck := x.stuckAtCastle(seat)
	if !stuck || !s.Rolled {
		return engine.Command{}, false
	}
	to := x.riderReach(from, riderMove)
	if len(to) == 0 {
		return engine.Command{}, false
	}
	return engine.Command{Player: seat, Type: CmdMoveRider,
		Data: raw(map[string]any{"from": from, "to": to[0]})}, true
}

// pendingDeciders names the seats the scenario is waiting on, with the id the
// timer layer sizes their budget from.
func (m Module) pendingDeciders(s *engine.State) []engine.ModuleDecider {
	if s.Phase != engine.PhasePlay {
		return nil
	}
	x := extRO(s)
	if len(x.PathQueue) > 0 {
		if len(s.PendingDiscards) > 0 {
			return nil
		}
		return []engine.ModuleDecider{{Seat: x.PathSeat, Decision: PendPath}}
	}
	if x.Pend.Kind != PendNone {
		if x.Pend.Seat < 0 || len(s.PendingDiscards) > 0 {
			return nil
		}
		return []engine.ModuleDecider{{Seat: x.Pend.Seat, Decision: x.Pend.Kind}}
	}
	// Same gate as auto's: a seat another module is holding cannot make this
	// move, so it gets no clock for it.
	if _, stuck := x.stuckAtCastle(s.Cur); stuck && s.Rolled && engine.RequireActionableTurn(s, s.Cur) == nil {
		return []engine.ModuleDecider{{Seat: s.Cur, Decision: DecisionRiderLeave}}
	}
	return nil
}

// DrawCardFor hands p one card off this scenario's deck and resolves it, for an
// effect outside this module that grants one: the Fishermen seven-fish spend
// (take one card and resolve it immediately). offset is the log position of the
// first returned event.
//
// Returns false when Raiders is not active, so the caller can fall back to its
// own ruleset's option.
func DrawCardFor(s *engine.State, p engine.PlayerID, offset int) ([]engine.Event, bool) {
	if !active(s) {
		return nil, false
	}
	return (Module{}).cardEvents(s, p, offset, true), true
}

// CastleOf is the castle hex and whether this game has one. Read-only, for the
// client view builders and the bots.
func CastleOf(s *engine.State) (board.Hex, bool) {
	if !active(s) {
		return board.Hex{}, false
	}
	x := extRO(s)
	return x.Castle, x.HasCastle
}
