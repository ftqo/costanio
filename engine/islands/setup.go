package islands

import (
	"math/rand/v2"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// SetupBoard carves the Islands scenario out of a procedurally generated board:
// a mainland, one to three outer islands cut off by a sea channel, a ragged
// mainland coast, gold on the islands, and harbors recomputed for the new
// coastline.
//
// The carve must actually separate land. Each outer island is an arc of the
// outer ring; the ring-(R-1) hexes behind it are drowned to make the channel,
// and the ring hexes flanking it are drowned to part it from the rest of the
// coast, giving 1 + k components. (Drowning outer-ring hexes alone leaves every
// survivor connected through ring R-1, which would make the island chip and
// IslandVP unreachable.)
//
// Curated presets and inlined custom maps (cfg.Board) are never carved; they
// ship their own sea (enforced by map eligibility, see docs/maps.md).
func (Module) SetupBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {
	// Curated presets and inlined custom/built-in maps ship their own sea; only
	// fully procedural boards are carved.
	if cfg.Preset != "" || cfg.Board != nil {
		return
	}
	carve(b, rng)

	// A fair board is rebalanced after the carve (derivation 13). The generator
	// balanced numbers against the full hexagon, and the carve then drowns
	// about a sixth of it and its desert repair takes a token, which otherwise
	// leaves fair-mode Islands boards far outside the fair band.
	// board.Rebalance draws no randomness, so no stream moves. Every tile here
	// is the engine's (authored maps are never carved), so every token may
	// move.
	//
	// It runs after everything the carve does to terrain (channel, notches,
	// desert repair, gold), and inside SetupBoard so it precedes every
	// BoardFinisher. Every token-reading derivation is a finisher (Rivers'
	// headwater swap, the Caravans oasis, Fishermen grounds and lakes, the
	// Raiders castle, Wagons trade hexes), so they all see the balanced board,
	// and the two that remove a token afterwards (a Rivers estuary, a Caravans
	// promotion) rebalance themselves. The only SetupBoard that runs after
	// Islands is Wagons', which cannot be combined with Islands. The robber and
	// harbours below read no token.
	if cfg.BoardMode == board.BoardFair {
		b.Rebalance(func(board.Hex) bool { return true })
	}

	// The robber must still be on a hex it may occupy: the carve may have
	// turned its home into sea.
	//
	// A lake is fine: it is the desert Fishermen flooded, produces nothing, and
	// is a legal robber home.
	//
	// A robber off the board is also left alone. Fishermen's setup puts it
	// beside the board until the first 7, and that fails RobberOK like sea
	// does, so without this guard the carve would bring it back onto land.
	if b.RobberOnBoard() && !b.RobberOK(b.Robber) {
		relocateRobber(b, rng)
	}

	b.Harbors = board.PlaceHarbors(rng, b, len(b.Harbors))
}

// outerIslands is how many islands the carve cuts off the mainland, so the
// board ends with that many plus one. It keys off the radius, which bounds the
// outer ring: 12 hexes at radius 2, 18 at 3, 24 at 4 (board.RadiusFor maps 2-4
// players to radius 2, 5-6 to 3, 7-10 to 4). One island per ~8 ring hexes
// leaves room for gaps between islands and a usable mainland coast.
func outerIslands(radius int) int {
	return max(1, min(3, radius-1))
}

// arcSpan is how many ring hexes one island is made of. Two is the floor
// (a single hex is an island a settlement can reach but never grow on); a third
// is drawn from the seed on the larger boards, where the ring is long enough
// that a three-hex island still leaves gaps.
func arcSpan(radius int, rng *rand.Rand) int {
	if radius < 3 {
		return 2
	}
	return 2 + rng.IntN(2)
}

// carve cuts the mainland/island structure. Every draw comes from the seeded
// rng and every other choice is a function of the geometry, so it replays, and
// verify/modules.mjs reproduces it.
func carve(b *board.Board, rng *rand.Rand) {
	ring := ringWalk(b.Radius)
	l := len(ring)
	k := outerIslands(b.Radius)
	slot := l / k

	// Where the first island sits. Everything else is measured from here, so one
	// draw rotates the entire archipelago.
	off := rng.IntN(l)

	inArc := map[board.Hex]bool{}
	drown := map[board.Hex]bool{}
	var arcs [][]board.Hex
	for i := range k {
		span := arcSpan(b.Radius, rng)
		// The jitter is bounded so the arc always ends at least one hex short of
		// its slot: with the next arc starting no earlier than the slot boundary,
		// consecutive islands are always parted by at least one drowned hex, and
		// two islands can never touch and read as one.
		jitter := 0
		if slot > span {
			jitter = rng.IntN(slot - span)
		}
		start := off + i*slot + jitter
		arc := make([]board.Hex, 0, span)
		for j := range span {
			h := ring[(start+j)%l]
			arc = append(arc, h)
			inArc[h] = true
		}
		arcs = append(arcs, arc)
		// The flanks: the ring hexes on either side of the arc. Without these the
		// island is still joined to the coast the long way round.
		for _, h := range []board.Hex{ring[((start-1)%l+l)%l], ring[(start+span)%l]} {
			if !inArc[h] {
				drown[h] = true
			}
		}
	}
	// The channel: an arc hex's only remaining land neighbours are at ring R-1,
	// so those are drowned.
	for _, arc := range arcs {
		for _, h := range arc {
			for _, n := range h.Neighbors() {
				if ringOf(n) == b.Radius-1 {
					drown[n] = true
				}
			}
		}
	}

	// Notches: single-hex bays bitten out of the mainland coast, giving each
	// seed a different coastline (and PlaceHarbors a ragged coast; see
	// docs/islands.md).
	//
	// A notch may not touch another, so the coast is dented rather than eaten,
	// and there are at most `radius` of them, since the channel has already
	// taken its share (the floor is 13 land hexes at radius 2).
	//
	// The no-touching rule also means no connectivity check is needed: a ring
	// hex keeps at least one ring neighbour as long as no two notches touch. A
	// check was tried and rejected nothing, so it was dropped to keep verify's
	// JavaScript port simple. TestCarveActuallyMakesIslands asserts the
	// component count instead.
	//
	// The draw happens for every candidate whether or not it is accepted, so
	// the rng stream does not depend on either test.
	notches, budget := 0, b.Radius
	for i, h := range ring {
		if inArc[h] || drown[h] {
			continue
		}
		hit := rng.IntN(4) == 0
		if !hit || notches == budget {
			continue
		}
		if drown[ring[(i+l-1)%l]] || drown[ring[(i+1)%l]] {
			continue // shoulder to shoulder with an existing bay or channel
		}
		drown[h] = true
		notches++
	}

	for h := range drown {
		b.Tiles[h] = board.Tile{Res: board.Sea}
	}

	// The carve must not take the board's last desert. On small boards the
	// drowned hexes are a sixth of the board, and a board with no desert or
	// lake leaves the robber nowhere harmless to stand, fails
	// board.ValidateLayout (so it cannot round-trip through the share code,
	// POST /api/maps/* or the builder), and costs Caravans its oasis.
	//
	// The repair turns a survivor into a desert rather than reviving a drowned
	// hex, since drowned hexes hold the channel open. The survivor is drawn
	// from the seed among the cheapest first (a desert loses its number, and
	// losing a 2 or 12 costs least). Mainland only: a desert would be most of a
	// two-hex island.
	if !hasNeutral(b) {
		var cands []board.Hex
		best := -1
		for _, h := range board.HexesInRadius(b.Radius) {
			if drown[h] || inArc[h] || !b.Tiles[h].Res.Producing() {
				continue
			}
			p := board.Pips(b.Tiles[h].Number)
			switch {
			case best < 0 || p < best:
				best, cands = p, []board.Hex{h}
			case p == best:
				cands = append(cands, h)
			}
		}
		if len(cands) > 0 {
			b.Tiles[cands[rng.IntN(len(cands))]] = board.Tile{Res: board.ResNone}
		}
	}

	goldRush(b, arcs, rng)
}

// goldRush turns island tiles to gold, keeping their number token. Gold belongs
// on the outer islands, where it makes a small island worth the ships to reach.
//
// At least one gold hex always lands, as Caravans always gets an oasis; a flat
// one-in-four per island tile would leave a noticeable share of boards with no
// gold.
func goldRush(b *board.Board, arcs [][]board.Hex, rng *rand.Rand) {
	var cands []board.Hex
	for _, arc := range arcs {
		for _, h := range arc {
			if t := b.Tiles[h]; t.Res.Producing() && t.Number != 0 {
				cands = append(cands, h)
			}
		}
	}
	if len(cands) == 0 {
		// Every island tile is desert or blank: fall back to the mainland rather
		// than ship a board with no gold on it.
		for _, h := range board.HexesInRadius(b.Radius) {
			if t := b.Tiles[h]; t.Res.Producing() && t.Number != 0 {
				cands = append(cands, h)
			}
		}
	}
	gold := 0
	for _, h := range cands {
		if rng.IntN(4) != 0 {
			continue
		}
		b.Tiles[h] = board.Tile{Res: board.Gold, Number: b.Tiles[h].Number}
		gold++
	}
	if gold == 0 && len(cands) > 0 {
		h := cands[rng.IntN(len(cands))]
		b.Tiles[h] = board.Tile{Res: board.Gold, Number: b.Tiles[h].Number}
	}
}

// hasNeutral reports whether any hex on the board is one the robber can stand on
// without blocking anything: a desert, or the lake Fishermen made of one.
func hasNeutral(b *board.Board) bool {
	for h := range b.Tiles {
		if b.RobberNeutral(h) {
			return true
		}
	}
	return false
}

// ringWalk returns the hexes at exactly `radius` from the centre in cyclic
// order, each adjacent to the next and the last to the first. The arcs are cut
// from this order; board.HexesInRadius gives the same set in row-major order,
// where consecutive entries are usually not neighbours.
func ringWalk(radius int) []board.Hex {
	if radius <= 0 {
		return []board.Hex{{Q: 0, R: 0}}
	}
	// Start at the far end of direction 4 and walk each of the six directions
	// `radius` steps: the standard hex-ring traversal.
	dirs := [6]board.Hex{{Q: 1, R: 0}, {Q: 1, R: -1}, {Q: 0, R: -1}, {Q: -1, R: 0}, {Q: -1, R: 1}, {Q: 0, R: 1}}
	h := board.Hex{Q: dirs[4].Q * radius, R: dirs[4].R * radius}
	out := make([]board.Hex, 0, 6*radius)
	for d := range 6 {
		for range radius {
			out = append(out, h)
			h = board.Hex{Q: h.Q + dirs[d].Q, R: h.R + dirs[d].R}
		}
	}
	return out
}

// ringOf is a hex's distance from the centre, in rings.
func ringOf(h board.Hex) int {
	return maxAbs(h.Q, -h.Q-h.R, h.R)
}

func maxAbs(ns ...int) int {
	m := 0
	for _, n := range ns {
		if n < 0 {
			n = -n
		}
		if n > m {
			m = n
		}
	}
	return m
}

// relocateRobber puts the robber on a neutral hex if any survives, else on a
// seeded-random hex it may legally occupy.
//
// Neutral is board.RobberNeutral: a desert, or the lake a desert became under
// Fishermen, so the robber blocks nothing. That branch keeps board order since
// the choice has no cost.
//
// The fallback, when the carve drowned the only desert, must land on producing
// land. Always taking the first hex in board order would block the same corner
// every time, so the choice is drawn from the seed among the lowest-pip
// candidates, where the cost is smallest.
func relocateRobber(b *board.Board, rng *rand.Rand) {
	for _, h := range board.HexesInRadius(b.Radius) {
		if b.RobberNeutral(h) {
			b.Robber = h
			return
		}
	}
	var cands []board.Hex
	best := -1
	for _, h := range board.HexesInRadius(b.Radius) {
		if !b.RobberOK(h) {
			continue
		}
		p := board.Pips(b.Tiles[h].Number)
		switch {
		case best < 0 || p < best:
			best, cands = p, []board.Hex{h}
		case p == best:
			cands = append(cands, h)
		}
	}
	if len(cands) > 0 {
		b.Robber = cands[rng.IntN(len(cands))]
	}
}
