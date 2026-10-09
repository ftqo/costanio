package engine

import (
	"sort"

	"github.com/ftqo/costan.io/engine/board"
)

func decideRoll(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay {
		return nil, ErrWrongPhase
	}
	if cmd.Player != s.Cur {
		return nil, ErrNotYourTurn
	}
	if s.Rolled {
		return nil, ErrAlreadyRolled
	}
	if s.RobberPending { // a pre-roll knight's robber must resolve first
		return nil, ErrRobberPending
	}

	d1, d2 := rollDice(s)
	fixed := false
	for _, m := range s.Modules() {
		if h := m.Hooks().FixedDice; h != nil {
			if f1, f2, ok := h(s); ok {
				d1, d2, fixed = f1, f2, true
			}
		}
	}
	events := []Event{mustEvent(EvDiceRolled, DiceRolledData{Player: cmd.Player, D1: d1, D2: d2, Fixed: fixed})}

	if d1+d2 == 7 {
		// The event die belongs to the Roll Dice phase and resolves before the 7.
		// Fold its events onto a throwaway copy so the discard threshold reflects
		// them (a Knights city wall pillaged by the barbarians lowers the owner's
		// threshold). Base/Islands add no OnDiceRolled work, so `die` is empty and
		// the discard state is just `s`.
		die := rollEventDie(s, d1, d2)
		ds := foldDie(s, die)
		events = append(events, die...)

		var required []PlayerDiscard
		for p := range ds.Players {
			// Threshold (city walls raise it) and total (Knights commodities count too)
			// both come from the shared module-aware accessors.
			total := ds.DiscardableCount(PlayerID(p))
			if total > ds.DiscardThreshold(PlayerID(p)) {
				required = append(required, PlayerDiscard{Player: PlayerID(p), Count: total / 2})
			}
		}
		if len(required) > 0 {
			events = append(events, mustEvent(EvDiscardsReq, DiscardsReqData{Required: required}))
		}
		for _, m := range s.Modules() {
			if h := m.Hooks().OnSeven; h != nil {
				events = append(events, h(s)...)
			}
		}
		return events, nil
	}

	// The event die resolves before production, as in the 7 branch above:
	// emit its events first, then compute production from a copy with them
	// folded in, so a city pillaged on this roll produces as a settlement (or
	// not at all). Base/Islands add no OnDiceRolled work, so `die` is empty.
	die := rollEventDie(s, d1, d2)
	events = append(events, die...)
	if gains := distribute(foldDie(s, die), d1+d2); len(gains) > 0 {
		events = append(events, mustEvent(EvResDistributed, ResDistributedData{Gains: gains}))
	}
	return events, nil
}

// rollEventDie gathers the event-die events every module contributes for this
// roll (the Knights event die: barbarian advance/attack and gate-driven progress
// draws). Base and Islands contribute none.
func rollEventDie(s *State, d1, d2 int) []Event {
	var die []Event
	for _, m := range s.Modules() {
		if h := m.Hooks().OnDiceRolled; h != nil {
			die = append(die, h(s, d1, d2)...)
		}
	}
	return die
}

// foldDie applies the event-die events to a throwaway clone of s and returns it,
// so callers can read the post-event-die state (production and discards are
// computed from it) without mutating s. If any event fails to apply, s is
// returned unchanged.
func foldDie(s *State, die []Event) *State {
	if len(die) == 0 {
		return s
	}
	work := s.Clone()
	for _, e := range die {
		ec := e // copy: don't stamp Seq on the returned events
		ec.Seq = work.NextSeq
		if err := Apply(work, ec); err != nil {
			return s
		}
	}
	return work
}

// distribute computes production for a roll, honoring the bank-shortage rule:
// if the bank cannot cover everyone's claim on a resource and more than one
// player claims it, nobody receives that resource; a single claimant takes
// what's left.
func distribute(s *State, roll int) []PlayerGain {
	type claim struct {
		demand   map[PlayerID]int
		total    int
		claimers int
	}
	claims := map[board.Resource]*claim{}

	for h, t := range s.Board.Tiles {
		if t.Number != roll || !t.Res.Producing() || h == s.Board.Robber {
			continue
		}
		// A module may switch a hex off the same way the robber does (a Raiders
		// hex saturated by raiders produces nothing on any roll).
		if HexIsInert(s, h) {
			continue
		}
		for _, v := range h.Vertices() {
			b, ok := s.Buildings[v]
			if !ok {
				continue
			}
			// ... and it may switch a building off (a Raiders settlement with no
			// unconquered neighbour is laid on its side and produces nothing).
			if BuildingIsInert(s, v) {
				continue
			}
			n := 1
			if b.City {
				n = CityYield(s, t.Res)
			}
			c := claims[t.Res]
			if c == nil {
				c = &claim{demand: map[PlayerID]int{}}
				claims[t.Res] = c
			}
			if c.demand[b.Owner] == 0 {
				c.claimers++
			}
			c.demand[b.Owner] += n
			c.total += n
		}
	}

	perPlayer := map[PlayerID]Hand{}
	for res, c := range claims {
		avail := s.Bank[res]
		if c.total > avail && c.claimers > 1 {
			continue // contested shortage: nobody produces
		}
		for p, n := range c.demand {
			if n > avail {
				n = avail // single claimant takes the remainder
			}
			h := perPlayer[p]
			h[res] += n
			perPlayer[p] = h
		}
	}

	var gains []PlayerGain
	for p, h := range perPlayer {
		if h.Count() > 0 {
			gains = append(gains, PlayerGain{Player: p, Gain: h})
		}
	}
	sort.Slice(gains, func(i, j int) bool { return gains[i].Player < gains[j].Player })
	return gains
}

func decideDiscard(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay {
		return nil, ErrWrongPhase
	}
	need, ok := s.PendingDiscards[cmd.Player]
	if !ok {
		return nil, ErrNoDiscardNeeded
	}
	// A module (Knights) may own the discard so the player can spend its cards too
	// (commodities) toward the required count.
	for _, m := range s.Modules() {
		if h := m.Hooks().HandleDiscard; h != nil {
			if events, handled, hErr := h(s, cmd, need); handled || hErr != nil {
				return events, hErr
			}
		}
	}
	d, err := decodeCmd[CardsDiscardedData](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !d.Cards.NonNegative() || d.Cards.Count() != need || !s.Players[cmd.Player].Hand.Has(d.Cards) {
		// The count is not derivable from the code, so it travels as a named
		// parameter.
		return nil, WithParams(ErrBadDiscard, Params{"needed": need})
	}
	return []Event{mustEvent(EvCardsDiscarded, CardsDiscardedData{Player: cmd.Player, Cards: d.Cards})}, nil
}

func decideMoveRobber(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay {
		return nil, ErrWrongPhase
	}
	if cmd.Player != s.Cur {
		return nil, ErrNotYourTurn
	}
	if !s.RobberPending {
		return nil, ErrWrongPhase
	}
	if len(s.PendingDiscards) > 0 {
		return nil, ErrDiscardPending
	}
	d, err := decodeCmd[struct {
		Hex    board.Hex `json:"hex"`
		Victim *PlayerID `json:"victim"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !robberMayEnter(s, d.Hex) || d.Hex == s.Board.Robber {
		return nil, ErrBadPlacement
	}

	victims := robberVictims(s, d.Hex, cmd.Player)
	// Friendly robber: if some hex would let us rob an unprotected player,
	// the robber must go on such a hex, not park on a protected-only or empty
	// hex as a pure block.
	if s.FriendlyRobberActive() && len(victims) == 0 && friendlyRobberHasTarget(s, cmd.Player) {
		return nil, ErrBadPlacement
	}
	events := []Event{mustEvent(EvRobberMoved, RobberMovedData{Player: cmd.Player, Hex: d.Hex})}

	if len(victims) == 0 {
		if d.Victim != nil {
			return nil, ErrBadVictim
		}
		return events, nil
	}
	if d.Victim == nil || !victims[*d.Victim] {
		return nil, ErrBadVictim
	}

	victim := *d.Victim
	// A module may steal from a combined pool (Knights resources + commodities);
	// otherwise pick a uniformly random card from the victim's resource hand.
	if ev, ok := s.stealCard(cmd.Player, victim, 1); ok {
		events = append(events, ev)
		return events, nil
	}
	res, _ := RandomCard(rngFor(s.Seed, s.NextSeq+1), s.Players[victim].Hand)
	events = append(events, mustEvent(EvCardStolen,
		CardStolenData{Thief: cmd.Player, Victim: victim, Res: res},
		cmd.Player, victim))
	return events, nil
}

// stealCard asks modules for a combined-pool robber steal (Knights). It returns the
// first module's steal event, or (_, false) for the base resource-only steal.
func (s *State) stealCard(thief, victim PlayerID, offset int) (Event, bool) {
	for _, m := range s.Modules() {
		if h := m.Hooks().StealCard; h != nil {
			if ev, ok := h(s, thief, victim, offset); ok {
				return ev, true
			}
		}
	}
	return Event{}, false
}

// robberVictims returns players (other than the mover) with a building on the
// hex and at least one card. Under the friendly-robber rule, players protected
// by their low public score are excluded.
func robberVictims(s *State, h board.Hex, mover PlayerID) map[PlayerID]bool {
	out := map[PlayerID]bool{}
	for _, v := range h.Vertices() {
		// DiscardableCount is module-aware (Knights commodities are stealable too); for
		// base/Islands it equals the resource hand size.
		if b, ok := s.Buildings[v]; ok && b.Owner != mover && s.DiscardableCount(b.Owner) > 0 && !s.FriendlyRobberProtected(b.Owner) {
			out[b.Owner] = true
		}
	}
	return out
}

// friendlyRobberHasTarget reports whether any legal hex would let mover rob an
// unprotected player. When true, the friendly-robber rule forces the mover onto
// such a hex; when false, the robber may move to any legal hex with no steal.
func friendlyRobberHasTarget(s *State, mover PlayerID) bool {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !robberMayEnter(s, h) || h == s.Board.Robber {
			continue
		}
		if len(robberVictims(s, h, mover)) > 0 {
			return true
		}
	}
	return false
}

func decideEndTurn(s *State, cmd Command) ([]Event, error) {
	if err := requireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	// Ending the turn requires the strict Blocks to be clear: any deferred
	// reconcile (Knights over-limit progress hand) must be resolved before passing.
	for _, m := range s.Modules() {
		if h := m.Hooks().Blocks; h != nil && h(s) {
			return nil, ErrModulePending
		}
	}
	next := PlayerID((int(s.Cur) + 1) % s.Config.Players)
	return []Event{
		mustEvent(EvTurnEnded, TurnEndedData{Player: cmd.Player}),
		mustEvent(EvTurnStarted, TurnStartedData{Player: next}),
	}, nil
}
