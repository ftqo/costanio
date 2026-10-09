package raiders

import (
	"math/rand/v2"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The scenario's own development deck.
//
// The base deck is not used. This one costs the usual price (1 ore + 1 wool + 1
// grain) and each card is revealed and resolved on purchase, then discarded.
// Nothing is held in hand (no hidden development cards, no VP cards), so every
// draw is on the public stream (see engine.RaidersSeq).
//
// Several may be bought in a turn, but each must be fully resolved first: the
// module Blocks while a card's pending is open.

// drawCard picks uniformly from the remaining deck, deterministically from the
// public seed and the log position the draw's event will occupy.
func drawCard(deck [cardKinds]int, rng *rand.Rand) Card {
	total := deckCount(deck)
	if total <= 0 {
		return CardMuster
	}
	idx := rng.IntN(total)
	for c, n := range deck {
		if idx < n {
			return Card(c)
		}
		idx -= n
	}
	return CardMuster
}

// decideBuyCard buys and resolves one card.
func (m Module) decideBuyCard(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	if !s.Players[cmd.Player].Hand.Has(engine.CostDevCard) {
		return nil, engine.ErrNoResources
	}
	return m.cardEvents(s, cmd.Player, 0, false), nil
}

// cardEvents draws a card and returns the events that reveal it.
//
// offset is where the first event lands in the batch; the draw is keyed to it,
// so two cards bought in one turn use different slots.
//
// free skips the price, for the Fishermen seven-fish spend.
//
// A Muster with nothing to place (no rider in supply, or all six castle paths
// occupied) is discarded with no effect: not held, refunded or replaced. Only
// Intrigue redraws, because its text says so, and the redraw loops since the
// next card can be another Intrigue.
func (m Module) cardEvents(s *engine.State, p engine.PlayerID, offset int, free bool) []engine.Event {
	x := extRO(s)
	deck := x.Deck
	var out []engine.Event
	for range len(deck) * 8 {
		rng := engine.PublicRngForSeed(s.PublicSeed, engine.RaidersSeq(s.NextSeq+offset+len(out)))
		c := drawCard(deck, rng)
		d := cardData{Player: p, Card: c, Free: free || len(out) > 0}
		switch c {
		case CardIntrigue:
			if len(x.occupiedCoast()) == 0 {
				d.Void = true
			}
		case CardMuster:
			if x.RidersLeft[p] == 0 || len(x.freePaths(x.castlePaths())) == 0 {
				d.Void = true
			}
		case CardSwiftRider:
			if x.RidersLeft[p] == 0 || len(x.freePaths(x.allRiderPaths())) == 0 {
				d.Void = true
			}
		case CardTreason:
			d.Gold = goldPerTreason
		default:
			// cardKinds is the count sentinel, not a card.
			// `default-signifies-exhaustive` is on in .golangci.yml; this marks
			// the four above as the whole deck.
		}
		out = append(out, engine.NewEvent(EvCard, d))
		deck[c]--
		if deckCount(deck) == 0 {
			deck = freshDeck()
		}
		if c == CardIntrigue && d.Void {
			continue // discard it and draw another; only Intrigue redraws
		}
		break
	}
	return out
}

// freePaths keeps the paths with no rider on them.
func (e *Ext) freePaths(in []board.Edge) []board.Edge {
	var out []board.Edge
	for _, ed := range in {
		if _, taken := e.RiderAt[ed]; !taken {
			out = append(out, ed)
		}
	}
	return out
}

// allRiderPaths is every path a rider may stand on: the edges of the main
// landmass's hexes, ascending. Swift Rider draws from this; movement is bounded
// by it too.
func (e *Ext) allRiderPaths() []board.Edge {
	seen := map[board.Edge]bool{}
	var out []board.Edge
	for _, h := range e.Land {
		for _, ed := range h.Edges() {
			if seen[ed] {
				continue
			}
			seen[ed] = true
			out = append(out, ed)
		}
	}
	sortEdges(out)
	return out
}

// decideTreason resolves the whole Treason card in one command.
//
// The card: take 2 gold; move 2 raiders from 2 different hexes onto 2 other
// unconquered coastal hexes; if fewer than 2 raiders are on the board, take one
// or both from the supply. The card's own event pays the gold; this is the
// movement half.
//
// Ruling: Treason may only place raiders on coastal hexes, so it cannot conquer
// an interior hex the landing rules can never reach.
func (m Module) decideTreason(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.Pend.Kind != PendTreason || x.Pend.Seat != cmd.Player {
		return nil, engine.ErrWrongPhase
	}
	d, err := engine.DecodeCommand[struct {
		Moves []treasonMove `json:"moves"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	want := treasonCount(x, hasKnights(s))
	if len(d.Moves) != want {
		return nil, ErrTreasonPlan
	}
	if err := validateTreason(x, d.Moves, hasKnights(s)); err != nil {
		return nil, err
	}
	return []engine.Event{engine.NewEvent(EvTreason,
		treasonData{Player: cmd.Player, Moves: d.Moves})}, nil
}

// treasonCount is how many raiders this Treason moves: two, unless the board
// cannot furnish two.
//
// It is the length of the greedy plan rather than a separate count of sources
// and destinations, which would overstate it: a destination may not also be a
// source and supply raiders only cover the shortfall, so with one occupied hex
// and two free ones a count says two while no legal two-move plan exists.
func treasonCount(x *Ext, knights bool) int { return len(greedyTreason(x, knights)) }

// validateTreason checks a plan against the card: distinct sources, distinct
// destinations, destinations unconquered and not doubling as a source, and a
// supply-sourced raider only while fewer than two stand on the board.
func validateTreason(x *Ext, moves []treasonMove, knights bool) error {
	fromBoard := 0
	var froms, tos []board.Hex
	for _, mv := range moves {
		if mv.From != nil {
			if x.RaidersOn(*mv.From) == 0 || slices.Contains(froms, *mv.From) {
				return ErrTreasonPlan
			}
			froms = append(froms, *mv.From)
			fromBoard++
		}
		if !slices.Contains(x.unconqueredCoast(), mv.To) || slices.Contains(tos, mv.To) {
			return ErrTreasonPlan
		}
		tos = append(tos, mv.To)
	}
	for _, t := range tos {
		if slices.Contains(froms, t) {
			return ErrTreasonPlan // destinations must differ from sources
		}
	}
	// A raider may come out of the supply only for the shortfall ("if fewer
	// than 2 raiders are on the board").
	supplyUsed := len(moves) - fromBoard
	allowed := max(0, len(moves)-len(x.occupiedCoast()))
	if supplyUsed > allowed {
		return ErrTreasonPlan
	}
	if !knights && supplyUsed > x.Supply {
		return ErrTreasonPlan
	}
	return nil
}

// autoTreason is the plan the timer and the baseline bot use: the first legal
// one in board order.
func autoTreason(x *Ext, knights bool) []treasonMove { return greedyTreason(x, knights) }

// greedyTreason builds the longest plan the card can make, in board order. It
// defines both what Auto does and how many moves the command must carry (see
// treasonCount).
//
// All sources are chosen before any destination. Interleaving would let a hex
// picked as the first move's destination be the natural second source, which
// the card forbids ("2 other hexes"), shortening the plan.
//
// Sources prefer a conquered hex: an unconquered source uses up a destination
// and a conquered one does not. Conquered first, board order within each group,
// leaves the most destinations.
func greedyTreason(x *Ext, knights bool) []treasonMove {
	const want = 2
	open := x.unconqueredCoast()
	occupied := x.occupiedCoast()
	slices.SortStableFunc(occupied, func(a, b board.Hex) int {
		ao, bo := slices.Contains(open, a), slices.Contains(open, b)
		switch {
		case ao == bo:
			return 0
		case !ao:
			return -1
		default:
			return 1
		}
	})
	sources := make([]*board.Hex, 0, want)
	for i := range want {
		if i < len(occupied) {
			h := occupied[i]
			sources = append(sources, &h)
			continue
		}
		// The shortfall comes out of the supply, which the card allows only
		// while fewer than two raiders are on the board.
		if knights || x.Supply > len(sources)-len(occupied) {
			sources = append(sources, nil)
		}
	}
	taken := map[board.Hex]bool{}
	for _, s := range sources {
		if s != nil {
			taken[*s] = true
		}
	}
	var moves []treasonMove
	for _, src := range sources {
		var dst *board.Hex
		for _, h := range open {
			if taken[h] {
				continue
			}
			hh := h
			dst = &hh
			break
		}
		if dst == nil {
			break
		}
		taken[*dst] = true
		moves = append(moves, treasonMove{From: src, To: *dst})
	}
	for len(moves) > 0 {
		if err := validateTreason(x, moves, knights); err == nil {
			break
		}
		moves = moves[:len(moves)-1] // shed the move the card cannot back
	}
	return moves
}
