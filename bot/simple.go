package bot

import (
	"encoding/json"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// Simple is a greedy baseline bot: it satisfies obligations via the engine's
// auto logic, and on its own turn buys in priority order (city, settlement,
// road toward open spots, development card) before ending the turn. It
// knows nothing module-specific beyond what AutoCommand resolves.
type Simple struct {
	// noDefend drops the hard-rule knight backstop (see WithoutSimpleDefend).
	// Measurement only.
	noDefend bool
	// playerTrades gates responding to standing player offers (see WithPlayerTrades).
	// Off by default. Bank trades are always available.
	playerTrades bool
	// fish enables the minimal Fishermen policy (see simpleFishPlay). Set by
	// NewSimple, left zero by NewStrong: Strong's fallback Simple must not spend
	// fish Strong is saving for a higher rung.
	fish bool
	// raiders enables the minimal Raiders policy (see simpleRaidersPlay). Left
	// zero by NewStrong for the same reason as fish: the fallback must not buy a
	// card Strong declined.
	raiders bool
	// noSwift drops the Swift Journey and the arrival boost from the wagon lane
	// (see WithoutSwiftJourney). Measurement only.
	noSwift bool
}

func NewSimple(opts ...Option) Simple {
	c := resolve(opts)
	return Simple{playerTrades: c.playerTrades, fish: true, raiders: true, noSwift: c.noSwift}
}

func raw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func (b Simple) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	// Respond to a standing offer aimed at the table (not our own turn action).
	// Gated by playerTrades (off by default).
	if b.playerTrades && s.ActiveOffer != nil && s.ActiveOffer.By != seat && !s.ActiveOffer.Responded(seat) {
		if cmd, ok := simpleRespond(s, seat); ok {
			return cmd, true
		}
		return declineOffer(seat), true // see Strong.Act
	}

	// Under Wagons, the wagon lane goes before the obligations below: otherwise
	// AutoCommand returns the module's decline every turn and the wagon never
	// moves. See simpleWagonPlay.
	if cmd, ok := b.simpleWagonPlay(s, seat); ok {
		return cmd, true
	}

	// Obligations (discards, robber, setup, module pendings) first.
	if cmd, ok := engine.AutoCommand(s); ok {
		if cmd.Player == seat && cmd.Type != engine.CmdEndTurn {
			return cmd, true
		}
		if cmd.Player != seat {
			return engine.Command{}, false // someone else is up
		}
	} else {
		return engine.Command{}, false
	}

	// Our turn, rolled, nothing pending: spend.
	hand := s.Players[seat].Hand

	// Under Knights, defend before buying. See simpleDefend.
	if cmd, ok := simpleDefendGated(s, seat, b.noDefend); ok {
		return cmd, true
	}

	// Under Fishermen, shed the boot and convert fish before buying: the 4-fish
	// rung is a bank withdrawal that can pay for a build below. See
	// simpleFishPlay.
	if b.fish {
		if cmd, ok := simpleFishPlay(s, seat); ok {
			return cmd, true
		}
	}

	// Under Rivers, convert coins and take a bridge before the base builds. See
	// simpleRiversPlay.
	if cmd, ok := simpleRiversPlay(s, seat); ok {
		return cmd, true
	}

	// Under Raiders, hire and march before buying; a baseline that only builds
	// never reaches 12 VP. See simpleRaidersPlay.
	if b.raiders && raidersInRuleset(s) {
		if cmd, ok := simpleRaidersPlay(s, seat); ok {
			return cmd, true
		}
	}

	// Explorers replaces the ladder below with its own pieces and closes
	// building in its Movement phase, so it answers for the whole turn there.
	if cmd, ok := simpleExplorersPlay(s, seat); ok {
		return cmd, true
	}

	if !citiesDisabled(s) && hand.Has(engine.CostCity) && s.Players[seat].CitiesLeft > 0 {
		if v, ok := upgradableSettlement(s, seat); ok {
			return engine.Command{Player: seat, Type: engine.CmdBuildCity, Data: raw(map[string]any{"v": v})}, true
		}
	}
	if hand.Has(engine.CostSettlement) && s.Players[seat].SettlementsLeft > 0 {
		if v, ok := settleableSpot(s, seat); ok {
			// settleableSpot checks the player-independent rule; a module may
			// still bar this seat (an Explorers spice farm needs a landed crew).
			cmd := engine.Command{Player: seat, Type: engine.CmdBuildSettlement, Data: raw(map[string]any{"v": v})}
			if cmdLegal(s, cmd) {
				return cmd, true
			}
		}
	}
	if hand.Has(engine.CostRoad) && s.Players[seat].RoadsLeft > 0 {
		if e, ok := extendingRoad(s, seat); ok {
			return engine.Command{Player: seat, Type: engine.CmdBuildRoad, Data: raw(map[string]any{"e": e})}, true
		}
	}
	if !devCardsDisabled(s) && hand.Has(engine.CostDevCard) && s.DevDeck.Count() > 0 {
		return engine.Command{Player: seat, Type: engine.CmdBuyDevCard}, true
	}
	// Play a knight if we hold one (advances largest army; keeps cards moving).
	if !devCardsDisabled(s) && s.Players[seat].DevCards[engine.DevKnight] > 0 && !s.PlayedDevThisTurn {
		return engine.Command{Player: seat, Type: engine.CmdPlayDevCard, Data: raw(map[string]any{"card": engine.DevKnight})}, true
	}
	// Trade surplus toward something the seat can actually build.
	if cmd, ok := simpleBankDig(s, seat); ok {
		return cmd, true
	}
	// Explorers: enter the Movement phase last, since it closes building.
	if cmd, ok := explorersEnterMovement(s, seat); ok {
		return cmd, true
	}
	return engine.Command{Player: seat, Type: engine.CmdEndTurn}, true
}

// simpleDefend keeps the seat's active knight strength ahead of the cities it
// owns, under Knights only (it is a no-op for every other ruleset, where the
// seat holds no knights and no knight spot is legal).
//
// Without it a greedy buyer livelocks: its cities lose every barbarian attack,
// are razed, rebuilt, and razed again, and the score never moves. Activation is
// preferred to recruiting as the cheaper strength.
//
// Legality is asked of the engine rather than duplicated here.
func simpleDefendGated(s *engine.State, seat engine.PlayerID, off bool) (engine.Command, bool) {
	if off {
		return engine.Command{}, false
	}
	x := knights.Read(s)
	cities := 0
	for _, b := range s.Buildings {
		if b.City && b.Owner == seat {
			cities++
		}
	}
	if cities == 0 || x.ActiveStrength(seat) > cities {
		return engine.Command{}, false // nothing to lose, or already covered
	}
	for _, v := range ownKnightVertices(x, seat) {
		if x.Knights[v].Active {
			continue
		}
		if cmd := knightCmd(seat, knights.CmdActivateKnight, v); cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	for _, v := range s.LegalTargetsFor(seat).Knights {
		if cmd := knightCmd(seat, knights.CmdBuildKnight, v); cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	return engine.Command{}, false
}

// cmdLegal reports whether the engine would accept cmd right now, asked on a
// clone so the live state is untouched.
func cmdLegal(s *engine.State, cmd engine.Command) bool {
	c := s.Clone()
	_, err := engine.Decide(c, cmd)
	return err == nil
}

// simpleBankDig picks a maritime trade that moves the seat toward a build it
// can still make use of, cheapest-first: a city upgrade, a settlement on its
// network, a road extension, then a development card. The engine prices the
// give side (harbor ratios included), so the 4-card floor here is only a
// "genuinely surplus" test.
//
// Trading only toward a build the seat can place avoids a livelock where a seat
// converts its hand into something it can never spend. Each "can I use this
// build?" test must be about placement, not affordability, because the trade
// is what creates the affordability; hence the road check is cost-blind.
func simpleBankDig(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	p := &s.Players[seat]
	hand := p.Hand
	var wants []engine.Hand
	if _, ok := upgradableSettlement(s, seat); ok && p.CitiesLeft > 0 {
		wants = append(wants, engine.CostCity)
	}
	if _, ok := settleableSpot(s, seat); ok && p.SettlementsLeft > 0 {
		wants = append(wants, engine.CostSettlement)
	}
	// Cost-blind: see the note above.
	if _, ok := extendingRoadSpot(s, seat, true); ok && p.RoadsLeft > 0 {
		wants = append(wants, engine.CostRoad)
	}
	if !devCardsDisabled(s) && s.DevDeck.Count() > 0 {
		wants = append(wants, engine.CostDevCard)
	} else if raidersWantsCard(s, seat) {
		// Raiders has its own deck at the same price; a seat locked out of every
		// build by conquest needs this to trade toward a card.
		wants = append(wants, engine.CostDevCard)
	}
	for _, want := range wants {
		for _, get := range board.Resources {
			if hand[get] >= want[get] || s.Bank[get] == 0 {
				continue // already covered, or the bank is out
			}
			for _, give := range board.Resources {
				// Never spend down to below what this very cost needs.
				if give == get || hand[give] < 4 || hand[give]-4 < want[give] {
					continue
				}
				return engine.Command{Player: seat, Type: engine.CmdBankTrade,
					Data: raw(map[string]any{"give": give, "get": get})}, true
			}
		}
	}
	return engine.Command{}, false
}

// simpleRespond accepts an offer that nets at least as many cards as it costs
// while leaving the bot a spare copy of everything asked for; otherwise the bot
// abstains. It never counters.
func simpleRespond(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	o := s.ActiveOffer
	if hasTradeExtras(o) {
		// The card-count baseline cannot price a currency or commodity stake.
		// Use the scenario-aware evaluator, retaining Simple's no-counter policy.
		cmd, ok := NewStrong().respond(s, seat)
		return cmd, ok && cmd.Type == engine.CmdRespondTrade
	}
	hand := s.Players[seat].Hand
	if !hand.Has(o.Want) {
		return engine.Command{}, false // can't pay what's asked
	}
	for r := range o.Want {
		if o.Want[r] > 0 && hand[r] < o.Want[r]+1 {
			return engine.Command{}, false // don't trade away our last copy
		}
	}
	if o.Give.Count() < o.Want.Count() {
		return engine.Command{}, false // not a net gain in cards
	}
	return engine.Command{Player: seat, Type: engine.CmdRespondTrade, Data: raw(map[string]any{"accept": true})}, true
}

func devCardsDisabled(s *engine.State) bool {
	for _, m := range s.Modules() {
		if m.Hooks().NoDevCards {
			return true
		}
	}
	return false
}

func upgradableSettlement(s *engine.State, seat engine.PlayerID) (board.Vertex, bool) {
	// engine.LegalCities, because a module may bar a particular settlement from
	// becoming a city (e.g. an Explorers harbour settlement).
	legal := s.LegalCities(seat)
	if len(legal) == 0 {
		return board.Vertex{}, false
	}
	// Board order, so the choice stays deterministic across map iteration.
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if slices.Contains(legal, v) {
				return v, true
			}
		}
	}
	return board.Vertex{}, false
}

// settleableSpot finds an open settlement spot on the seat's road network. It
// defers to engine.CheckSettlementSpot for legality (distance, occupancy, and
// module vertex blockers such as an enemy knight).
func settleableSpot(s *engine.State, seat engine.PlayerID) (board.Vertex, bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if engine.CheckSettlementSpot(s, v) != nil {
				continue // illegal under full engine rules (incl. module blockers)
			}
			adjacentRoad := false
			for _, e := range v.Edges() {
				if owner, ok := s.Roads[e]; ok && owner == seat {
					adjacentRoad = true
				}
			}
			if adjacentRoad {
				return v, true
			}
		}
	}
	return board.Vertex{}, false
}

// extendingRoad finds a free land edge continuing the seat's network. Each
// candidate is confirmed legal by the engine (via roadLegal), so connectivity
// and module blockers are honoured.
func extendingRoad(s *engine.State, seat engine.PlayerID) (board.Edge, bool) {
	return extendingRoadSpot(s, seat, false)
}

// extendingRoadSpot is extendingRoad with the affordability half of legality
// made optional. ignoreCost=true asks "is there a placement here" (for trade
// planning); false asks "may I build one right now".
func extendingRoadSpot(s *engine.State, seat engine.PlayerID, ignoreCost bool) (board.Edge, bool) {
	seen := map[board.Edge]bool{}
	var cands []board.Edge
	consider := func(v board.Vertex) {
		if b, ok := s.Buildings[v]; ok && b.Owner != seat {
			return // blocked endpoint
		}
		for _, ne := range v.Edges() {
			if _, taken := s.Roads[ne]; taken {
				continue
			}
			if !s.Board.LandEdge(ne) || seen[ne] {
				continue
			}
			seen[ne] = true
			cands = append(cands, ne)
		}
	}
	for e, owner := range s.Roads {
		if owner == seat {
			consider(e.A)
			consider(e.B)
		}
	}
	for v, b := range s.Buildings {
		if b.Owner == seat {
			consider(v)
		}
	}
	// Deterministic: return the smallest legal extending edge, not whichever the
	// map iteration happened to surface first.
	sortEdges(cands)
	for _, ne := range cands {
		if roadLegal(s, seat, ne, ignoreCost) {
			return ne, true
		}
	}
	return board.Edge{}, false
}

// roadLegal reports whether the engine would accept seat building a road on
// edge e right now. It asks the engine directly (on a clone) so the bot's road
// choice tracks full engine legality, including module vertex blockers.
func roadLegal(s *engine.State, seat engine.PlayerID, e board.Edge, ignoreCost bool) bool {
	cmd := engine.Command{Player: seat, Type: engine.CmdBuildRoad, Data: raw(map[string]any{"e": e})}
	c := s.Clone()
	if ignoreCost {
		// Check every other road rule by giving the clone one road's worth of
		// resources.
		for r, n := range engine.CostRoad {
			c.Players[seat].Hand[r] += n
		}
	}
	_, err := engine.Decide(c, cmd)
	return err == nil
}
