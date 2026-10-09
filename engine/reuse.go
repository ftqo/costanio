package engine

import (
	"math/rand/v2"

	"github.com/ftqo/costan.io/engine/board"
)

// Exported wrappers around internal engine predicates so bots and modules reuse
// the authoritative computation instead of reimplementing it.

// DevCardsDisabled reports whether some module has removed the development-card
// deck from this ruleset (Knights replaces it with progress cards). Any module
// that grants a dev card as a side effect must consult this: engine.New fills
// s.DevDeck whatever the ruleset, so an unguarded draw hands out a card the
// ruleset says does not exist.
func DevCardsDisabled(s *State) bool { return devCardsDisabled(s) }

// RobberSuppressed reports whether some module currently has the robber out of
// play (Knights locks it away until the barbarians first land). A state, not a
// ruleset property: it can go from true to false mid-game.
func RobberSuppressed(s *State) bool { return robberSuppressed(s) }

// RobberMayEnter reports whether the robber may be moved to hex h: land, and
// not a hex some module forbids (the Caravans oasis). It says nothing about the
// robber's current hex; callers still refuse that. Every robber destination
// (base move, knight card, Knights chase, Bishop, auto-player, bots) asks this,
// so a module that forbids a hex forbids it everywhere.
func RobberMayEnter(s *State, h board.Hex) bool { return robberMayEnter(s, h) }

func robberMayEnter(s *State, h board.Hex) bool {
	if !s.Board.Land(h) {
		return false
	}
	for _, m := range s.Modules() {
		if f := m.Hooks().RobberForbidden; f != nil && f(s, h) {
			return false
		}
	}
	return true
}

// ProgressDeckCount is how many progress-card decks this ruleset offers a
// player who gets to choose one, from whichever module owns them (Knights'
// three disciplines). Zero without such a module, so "is the choose-a-card
// spend available" is a state question.
func ProgressDeckCount(s *State) int {
	for _, m := range s.Modules() {
		if h := m.Hooks().ProgressDecks; h != nil {
			if n := h(s); n > 0 {
				return n
			}
		}
	}
	return 0
}

// DrawProgressCardFromModules hands p a card off the named deck, from whichever
// module owns the decks, and reports false when none does or the deck is empty.
// The shared entry point for an effect outside that module that grants a
// progress card, so the draw uses the module's own deck bookkeeping and RNG
// offset. Mirrors StealCardFromModules.
func DrawProgressCardFromModules(s *State, p PlayerID, deck, offset int) (Event, bool) {
	for _, m := range s.Modules() {
		if h := m.Hooks().DrawProgressCard; h != nil {
			if ev, ok := h(s, p, deck, offset); ok {
				return ev, true
			}
		}
	}
	return Event{}, false
}

// HasScenarioCards reports whether some active module ships its own development
// deck (the Raiders deck). Like ProgressDeckCount it is a state question: an
// effect granting "a development card" must know which deck it comes from
// before charging.
func HasScenarioCards(s *State) bool {
	for _, m := range s.Modules() {
		if m.Hooks().ScenarioCard != nil {
			return true
		}
	}
	return false
}

// DrawScenarioCard hands p one card off whichever module owns a deck of its
// own, resolving it, and reports false when none does. The shared entry point
// for outside effects that grant a card, using the module's own deck
// bookkeeping and RNG slot. Mirrors DrawProgressCardFromModules. See
// Hooks.ScenarioCard.
func DrawScenarioCard(s *State, p PlayerID, offset int) ([]Event, bool) {
	for _, m := range s.Modules() {
		if h := m.Hooks().ScenarioCard; h != nil {
			if evs, ok := h(s, p, offset); ok {
				return evs, true
			}
		}
	}
	return nil, false
}

// LongestRoadLength is a player's longest simple road path, in edges, with
// opponent buildings cutting paths. Use this instead of a private DFS copy.
func LongestRoadLength(s *State, p PlayerID) int { return longestRoadLength(s, p) }

// LongestRouteLength is a player's longest route system: one walk over the base
// road network plus every active module's RouteEdges contribution (ships,
// camel-doubled roads). It is the computation the longest-route award uses
// (engine/decide.go), so the scoreboard reports the number the engine credits.
// For a base-only game it equals LongestRoadLength.
func LongestRouteLength(s *State, p PlayerID) int { return longestRouteLength(s, p) }

// VertexBlocked reports whether a module hook (an enemy knight) bars vertex v
// for player p. Module route-length overrides consult this so their own DFS
// breaks at enemy knights just like the base road DFS does.
func (s *State) VertexBlocked(v board.Vertex, p PlayerID) bool { return s.vertexBlocked(v, p) }

// CheckSettlementSpot reports nil if a settlement may be placed at v under the
// full engine rules (on-board, unoccupied, distance rule, and module blockers
// like knights/fog). Bots must consult this so they never propose spots the
// engine will reject.
func CheckSettlementSpot(s *State, v board.Vertex) error { return checkSettlementSpot(s, v) }

// RobberVictims returns the players (other than mover) with a building on hex h
// and at least one card: the legal steal targets.
func RobberVictims(s *State, h board.Hex, mover PlayerID) map[PlayerID]bool {
	return robberVictims(s, h, mover)
}

// StealCardFromModules asks each active module's StealCard hook for a
// combined-pool steal (Knights resources + commodities), returning the first
// override, or (_, false) for the base resource-only steal. Offset is the
// stolen card's position relative to the current log head, so the draw replays.
//
// Every "take one random card" steal must go through here so the base robber,
// the pirate and the knight chase all steal from the same pool.
func StealCardFromModules(s *State, thief, victim PlayerID, offset int) (Event, bool) {
	return s.stealCard(thief, victim, offset)
}

// RandomCard picks a uniformly random resource card from a hand using the given
// rng, returning ok=false for an empty hand. Centralizes the "steal a random
// card" draw shared by the robber and several module effects.
func RandomCard(rng *rand.Rand, h Hand) (board.Resource, bool) {
	total := h.Count()
	if total == 0 {
		return 0, false
	}
	idx := rng.IntN(total)
	for r, n := range h {
		if idx < n {
			return board.Resource(r), true
		}
		idx -= n
	}
	return 0, false
}

// PublicVPWithModules is PublicVP plus every active module's VictoryCheck
// contribution (island chips, metropolis, defender/merchant VP). It matches
// what the win check counts (see finalize), so client views show the real
// public standing.
func (s *State) PublicVPWithModules(p PlayerID) int {
	vp := s.PublicVP(p)
	for _, m := range s.Modules() {
		if h := m.Hooks().VictoryCheck; h != nil {
			vp += h(s, p)
		}
	}
	return vp
}

// VPWithModules is a player's full victory points: PublicVPWithModules plus
// hidden VP development cards, the exact total the win check compares against
// the target. Used for a seat's own displayed score.
func (s *State) VPWithModules(p PlayerID) int {
	return s.PublicVPWithModules(p) + s.Players[p].DevCards[DevVictoryPoint] + s.Players[p].NewDevCards[DevVictoryPoint]
}

// FriendlyRobberProtected reports whether the friendly-robber option shields
// player p from being robbed, by the base robber, the Islands pirate, and every
// other steal that asks (a Knights chase or Bishop, the Fishermen three-fish
// spend). Under the toggle, players at or below FriendlyRobberMaxVP are
// protected. It uses PublicVPWithModules (the score opponents already see),
// never hidden VP cards, so it leaks nothing.
func (s *State) FriendlyRobberProtected(p PlayerID) bool {
	return s.FriendlyRobberActive() && s.PublicVPWithModules(p) <= s.FriendlyRobberMaxVP()
}

// FriendlyRobberActive reports whether the friendly-robber shield applies in
// this game: the option is on and the ruleset has a robber. With no robber
// (RulesetHasRobber false: Wagons, Raiders, Explorers) the lobby hides the
// setting and the engine ignores it, so a stored true from an older client
// shields nobody.
func (s *State) FriendlyRobberActive() bool {
	if !s.Config.FriendlyRobber {
		return false
	}
	for _, m := range s.Modules() {
		if m.Hooks().RobberNeverInPlay {
			return false
		}
	}
	return true
}

// FriendlyRobberMaxVP is the highest public score the shield covers: the
// ruleset's starting score, protecting "players still at their starting score"
// (GameConfig). A ruleset whose second setup placement is a city (Knights,
// Wagons, Raiders) starts every seat on 3, not the base game's 2.
func (s *State) FriendlyRobberMaxVP() int { return s.StartingVP() }

// StartingVP is the public score the setup draft deals every seat: two
// settlements (2), or a settlement and a city (3) when a module makes the
// second placement a city (Hooks.SetupRound2City). Setup-time awards to one
// seat (the Harbormaster card) are not included.
//
// A module that owns the whole draft (Hooks.OwnsSetup, Explorers) is not
// modelled here; Explorers has no robber, so no caller reaches that case.
func (s *State) StartingVP() int {
	if s.setupRound2City() {
		return 1 + 2
	}
	return 2
}

// DiscardThreshold is the hand size above which a rolled 7 forces a discard for
// player p, including module deltas (Knights city walls raise it). The single source
// of truth for the limit used in turn.go's 7-handling.
func (s *State) DiscardThreshold(p PlayerID) int {
	limit := s.Config.DiscardLimit
	if limit == 0 {
		limit = 7
	}
	for _, m := range s.Modules() {
		if h := m.Hooks().DiscardLimitDelta; h != nil {
			limit += h(s, p)
		}
	}
	return limit
}

// DiscardableCount is the number of cards that count toward p's 7-roll discard:
// the resource hand plus any module-held cards (Knights commodities).
func (s *State) DiscardableCount(p PlayerID) int {
	total := s.Players[p].Hand.Count()
	for _, m := range s.Modules() {
		if h := m.Hooks().ExtraDiscardCount; h != nil {
			total += h(s, p)
		}
	}
	return total
}

// HasPillageBuyout reports whether some active module offers the owner of a
// city about to be pillaged a way to buy it back (Rivers' 5 coins).
//
// A ruleset question, separate from whether the player can afford it: the
// pillaging module asks this to decide whether the offer exists, and
// PillageBuyoutFor for the price.
func HasPillageBuyout(s *State) bool {
	for _, m := range s.Modules() {
		if m.Hooks().PillageBuyout != nil {
			return true
		}
	}
	return false
}

// PillageBuyoutFor collects the payment for p buying off a pending pillage,
// from whichever module owns the currency, and reports false when no module
// offers one. The error is that module's own refusal (not enough coins) and
// reaches the player unchanged.
//
// The first module offering a buyout charges; no ruleset has two.
func PillageBuyoutFor(s *State, p PlayerID) ([]Event, bool, error) {
	for _, m := range s.Modules() {
		if h := m.Hooks().PillageBuyout; h != nil {
			evs, err := h(s, p)
			return evs, true, err
		}
	}
	return nil, false, nil
}

// HasFreeBridge reports whether some active module has bridges an outside
// effect can buy (Rivers). Like HasScenarioCards, the Fishermen spend table
// must know whether the option exists before charging.
func HasFreeBridge(s *State) bool {
	for _, m := range s.Modules() {
		if m.Hooks().FreeBridge != nil {
			return true
		}
	}
	return false
}

// FreeBridgeFromModules builds p a bridge at e through whichever module owns
// bridges, and reports false when nobody does. The placement rules and the
// refusal are the owning module's, so a caller paying in its own currency
// charges only after this has returned an event.
func FreeBridgeFromModules(s *State, p PlayerID, e board.Edge) (Event, bool, error) {
	for _, m := range s.Modules() {
		if h := m.Hooks().FreeBridge; h != nil {
			ev, err := h(s, p, e)
			return ev, true, err
		}
	}
	return Event{}, false, nil
}

// ArmSeaBlockerFromModules makes whichever module owns a sea blocker owe p a
// placement of it, and reports false when no module does. See
// Hooks.ArmSeaBlocker.
func ArmSeaBlockerFromModules(s *State, p PlayerID) (Event, bool) {
	for _, m := range s.Modules() {
		if h := m.Hooks().ArmSeaBlocker; h != nil {
			if ev, ok := h(s, p); ok {
				return ev, true
			}
		}
	}
	return Event{}, false
}

// HasFreeHarbour reports whether some active module has harbour settlements an
// outside effect can buy (Explorers). Like HasFreeBridge: the Knights Medicine
// card must know whether the second upgrade exists before offering it.
func HasFreeHarbour(s *State) bool {
	for _, m := range s.Modules() {
		if m.Hooks().FreeHarbour != nil {
			return true
		}
	}
	return false
}

// FreeHarbourFromModules upgrades p's settlement at v to a harbour settlement
// through whichever module owns them, and reports false when nobody does. The
// placement rules and the refusal are the owning module's.
func FreeHarbourFromModules(s *State, p PlayerID, v board.Vertex) (Event, bool, error) {
	for _, m := range s.Modules() {
		if h := m.Hooks().FreeHarbour; h != nil {
			ev, err := h(s, p, v)
			return ev, true, err
		}
	}
	return Event{}, false, nil
}

// HasFreeRiderHurry reports whether some active module has riders a fish
// spend can hurry (Raiders).
func HasFreeRiderHurry(s *State) bool {
	for _, m := range s.Modules() {
		if m.Hooks().FreeRiderHurry != nil {
			return true
		}
	}
	return false
}

// FreeRiderHurryFromModules makes one hurried rider move through the module
// that owns riders, paid for by the caller. ok is false when no active module
// has riders.
func FreeRiderHurryFromModules(s *State, p PlayerID, from, to board.Edge) (Event, bool, error) {
	for _, m := range s.Modules() {
		if h := m.Hooks().FreeRiderHurry; h != nil {
			ev, err := h(s, p, from, to)
			return ev, true, err
		}
	}
	return Event{}, false, nil
}

// FreeWagonBoostFromModules buys movement through the module that owns it.
func FreeWagonBoostFromModules(s *State, p PlayerID) (Event, bool, error) {
	for _, m := range s.Modules() {
		if h := m.Hooks().FreeWagonBoost; h != nil {
			ev, err := h(s, p)
			return ev, true, err
		}
	}
	return Event{}, false, nil
}

// EdgeBlockerTargetsFromModules lists blockers a piece at from can chase.
func EdgeBlockerTargetsFromModules(s *State, from board.Vertex) []int {
	for _, m := range s.Modules() {
		if h := m.Hooks().EdgeBlockerTargets; h != nil {
			return h(s, from)
		}
	}
	return nil
}

// ChaseEdgeBlockerFromModules opens the blocker owner's relocation choice.
func ChaseEdgeBlockerFromModules(s *State, p PlayerID, from board.Vertex, blocker int) ([]Event, error) {
	for _, m := range s.Modules() {
		if h := m.Hooks().ChaseEdgeBlocker; h != nil {
			return h(s, p, from, blocker)
		}
	}
	return nil, ErrBadCommand
}
