package raiders

import (
	"math/rand/v2"
	"slices"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// minCoastHexes is the shortest numbered coastline this scenario plays on.
// Under Islands the main landmass can be too small to raid; FinishBoard grows
// it rather than letting the lobby refuse the pairing on a seed-dependent
// condition. See docs/rules/raiders.md.
const minCoastHexes = 8

// repairNumbers are the tokens a hex reclaimed from the sea may carry: never 6
// or 8, so no red ends up beside another after the generator has checked that
// constraint. The choice is drawn from the seeded stream.
var repairNumbers = []int{3, 4, 5, 9, 10, 11}

// FinishBoard grows the landmass when needed and takes the robber off the
// board. It does not place the castle.
//
// The castle is not a tile. Replacing the centre hex with a neutral one would
// collide with Caravans (which picks its oasis as the first desert in board
// order, so a new desert could take the oasis, and always would under Fishermen
// where deserts are lakes), and board.Resource has no free value for it: the
// codec reserves nibble 12 for "hex absent" and Border is 11.
//
// So the castle is a derived hex recorded in the module's transported ext
// (deriveBoard), like the Caravans oasis, and the tile underneath is left
// alone. HexInert makes it produce nothing, the setup grant skips it, and the
// client draws the castle over it (hiding its number chip). Raiders reshapes no
// terrain another module reads.
//
// It is a BoardFinisher because both jobs depend on other modules: Islands
// decides whether the coast is long enough, and Islands and Fishermen place the
// robber in the first pass.
//
// Order-independent, as BoardFinisher requires: growing the landmass returns
// once coast and refuge suffice, and removing the robber is idempotent. A later
// finisher must not put the robber back.
func (Module) FinishBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {
	growLandmass(b, rng)
	// The robber and pirate are not in play in any Raiders combination.
	// board.OffBoard makes every `h == s.Board.Robber` test answer "not
	// blocked" for every real hex.
	b.Robber = board.OffBoard
}

// growLandmass guarantees the main landmass carries at least minCoastHexes
// numbered coastal hexes and productive interior outside the castle. A compact
// radius-two patch restores the refuge a small Islands carve can remove,
// extending the footprint when the channel leaves no room inside it.
//
// Only Islands puts sea inside the board, but the repair works on the board
// rather than the ruleset string, so a curated archipelago map gets it too.
//
// Existing terrain and separate landmasses are preserved. New tiles are dealt
// in ascending (Q, R), harbours are redealt against the repaired coastline, and
// each converted hex gets a resource and token from the seeded stream, so the
// result stays a function of the public seed. Tokens exclude 6 and 8 (see
// repairNumbers).
func growLandmass(b *board.Board, rng *rand.Rand) {
	land := mainLandmass(b)
	if len(land) == 0 {
		return
	}
	castle, hasCastle := castleHex(b, land, nil)
	set := hexSet(land)
	refuge := slices.ContainsFunc(land, func(h board.Hex) bool {
		t := b.Tiles[h]
		return (!hasCastle || h != castle) && t.Res.Producing() && t.Number > 0 && !isCoastal(b, set, h)
	})
	if refuge && len(numberedCoast(b, land, castle, hasCastle)) >= minCoastHexes {
		return
	}

	// A radius-two patch has the reference island's seven interior hexes. Pick
	// the patch requiring the fewest new tiles, ties by centre (Q, R). It must
	// overlap the mainland and leave every other island separated by water.
	// Allow extending the footprint: a radius-two Islands carve may have no
	// room for productive interior terrain inside its original boundary.
	var patch []board.Hex
	best := -1
	for _, centre := range board.HexesInRadius(b.Radius + 3) {
		var missing []board.Hex
		touches, allowed := false, true
		for _, offset := range board.HexesInRadius(2) {
			h := board.Hex{Q: centre.Q + offset.Q, R: centre.R + offset.R}
			if set[h] {
				touches = true
				continue
			}
			if tile, ok := b.Tiles[h]; ok && tile.Res != board.Sea {
				allowed = false
				break
			}
			for _, n := range h.Neighbors() {
				if b.Land(n) && !set[n] {
					allowed = false
					break
				}
			}
			if !allowed {
				break
			}
			missing = append(missing, h)
		}
		if allowed && touches && (best < 0 || len(missing) < best) {
			patch, best = missing, len(missing)
		}
	}
	if best < 0 {
		return
	} // An authored mainland can be enclosed by foreign land.
	for _, h := range patch {
		res := board.Resources[rng.IntN(len(board.Resources))]
		b.Tiles[h] = board.Tile{Res: res, Number: repairNumbers[rng.IntN(len(repairNumbers))]}
	}
	b.Frame()
	b.Harbors = board.PlaceHarbors(rng, b, len(b.Harbors))
}

// deriveBoard fills in the board-derived half of the ext: main landmass,
// castle, coastline, supply, and the raiders seeded at setup.
//
// Pure in (board, knights): engine.New calls it to record the result into
// EvBoardGenerated and the fold calls it again, and the two must agree.
func deriveBoard(e *Ext, b *board.Board, knights bool, avoid map[board.Hex]bool) {
	land := mainLandmass(b)
	e.Land = land
	castle, ok := castleHex(b, land, avoid)
	e.Castle, e.HasCastle = castle, ok
	e.Coast = numberedCoast(b, land, castle, ok)
	e.RaiderCount = make([]int, len(e.Coast))
	// The supply is 3 x the numbered coastal hexes at setup, enough to saturate
	// the whole coast (30 figures for the reference 10-hex coast). Unbounded
	// under Knights per the combination rule; see supplyEmpty.
	e.Supply = conquered * len(e.Coast)
	if knights {
		e.Supply = 0 // meaningless: supplyEmpty never consults it under Knights
	}
	for _, i := range seedSites(b, e.Coast) {
		e.RaiderCount[i]++
		if !knights {
			e.Supply--
		}
	}
}

// seedSites is the opening position: one raider on each of the max(2,
// round(coast/5)) numbered coastal hexes with the lowest dice probability, ties
// by ascending (Q, R).
//
// On a reference-size board that is the 2 and the 12, as in the scenario.
// Larger boards scale the seeding with coast length, since landings per build
// do not scale with board size.
//
// Returns indexes into coast, ascending.
func seedSites(b *board.Board, coast []board.Hex) []int {
	if len(coast) == 0 {
		return nil
	}
	n := max(2, (len(coast)+2)/5) // round(coast/5), half up
	n = min(n, len(coast))
	idx := make([]int, len(coast))
	for i := range idx {
		idx[i] = i
	}
	// coast is already ascending (Q, R), so a stable sort on pips alone leaves
	// ties in that order.
	sort.SliceStable(idx, func(a, c int) bool {
		return pips(b.Tiles[coast[idx[a]]].Number) < pips(b.Tiles[coast[idx[c]]].Number)
	})
	out := idx[:n]
	slices.Sort(out)
	return out
}

// pips is how many of the 36 dice combinations a token pays on; 0 for no token.
func pips(n int) int {
	if n <= 0 || n == 7 {
		return 0
	}
	return 6 - abs(7-n)
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// mainLandmass is the largest connected component of land hexes, ties by the
// lowest (Q, R) in the component. Returned ascending (Q, R).
//
// Raiders needs a continuous landmass with a numbered coastline: raiders land
// only here, riders exist only on paths touching it, and building on an outer
// island still triggers a full landing here.
func mainLandmass(b *board.Board) []board.Hex {
	comp := b.Islands() // hex -> component id, deterministic
	byID := map[int][]board.Hex{}
	for _, h := range board.HexesInRadius(b.Radius) {
		if id, ok := comp[h]; ok {
			byID[id] = append(byID[id], h)
		}
	}
	best, bestID := 0, -1
	for id, hs := range byID {
		switch {
		case len(hs) > best:
			best, bestID = len(hs), id
		case len(hs) == best && bestID >= 0 && hexLess(hs[0], byID[bestID][0]):
			bestID = id
		}
	}
	if bestID < 0 {
		return nil
	}
	out := slices.Clone(byID[bestID])
	sortHexes(out)
	return out
}

// castleHex is where riders enter the board: the centre-most hex of the main
// landmass, which on a full hexagon is the board centre.
//
// The centre rather than an outer-ring corner, because boards come in three
// sizes. A rider covers 3 paths a turn (5 if paid for); from the centre the
// farthest coast is Radius hexes away, two turns at radius 2 and three at
// radius 4, while from a corner it is roughly double, unplayable on the 61-hex
// board for 7-10 seats. A corner castle would also make one stretch of coast
// permanently cheaper to defend, chosen by the seed.
//
// "Centre-most" is the hex minimising the maximum cube distance to the
// component's coastal hexes, ties by ascending (Q, R): the origin on a full
// hexagon, the middle of an Islands main island.
//
// The site is then the nearest ordinary interior hex to that centre: ordinary
// so it never takes the desert (Caravans' oasis) or the lake (Fishermen),
// interior so no stretch of coast gets permanent immunity. Ties by cube
// distance then (Q, R). Fallbacks widen to any ordinary hex and then the centre
// itself, so a degenerate landmass still gets a castle.
func castleHex(b *board.Board, land []board.Hex, avoid map[board.Hex]bool) (board.Hex, bool) {
	if len(land) == 0 {
		return board.Hex{}, false
	}
	set := hexSet(land)
	var coastal []board.Hex
	for _, h := range land {
		if isCoastal(b, set, h) {
			coastal = append(coastal, h)
		}
	}
	centre := land[0]
	bestScore := -1
	for _, h := range land {
		worst := 0
		for _, c := range coastal {
			if d := hexDist(h, c); d > worst {
				worst = d
			}
		}
		if bestScore < 0 || worst < bestScore {
			centre, bestScore = h, worst
		}
	}
	pick := func(want func(board.Hex) bool) (board.Hex, bool) {
		best, found := board.Hex{}, false
		bestD := 0
		for _, h := range land {
			if !want(h) {
				continue
			}
			d := hexDist(h, centre)
			if !found || d < bestD {
				best, bestD, found = h, d, true
			}
		}
		return best, found
	}
	ordinary := func(h board.Hex) bool { return b.Tiles[h].Res.Producing() }
	free := func(h board.Hex) bool { return !avoid[h] }
	if h, ok := pick(func(h board.Hex) bool { return ordinary(h) && free(h) && !isCoastal(b, set, h) }); ok {
		return h, true
	}
	if h, ok := pick(func(h board.Hex) bool { return ordinary(h) && free(h) }); ok {
		return h, true
	}
	if h, ok := pick(ordinary); ok {
		return h, true
	}
	return centre, true
}

// castleAvoid is the set of hexes another module draws a whole-hex feature over
// on the finished board, which the castle must stay off: every hex a river runs
// through (engine.WatercourseHexes, estuary and headwater included) and every
// hex another module reserved (engine.ReservedHexes, the Wagons trade-hex
// candidates). The castle is a tile override too, and two on one hex means one
// is not drawn.
//
// Only the finished board has a watercourse, so only callers that run after
// every FinishBoard pass this (deriveBoard, TradeHexAllowed). growLandmass and
// ValidateFinishedBoard pass nil; they only ask whether some productive
// interior hex other than the castle survives, which moving the castle does not
// change.
func castleAvoid(s *engine.State) map[board.Hex]bool {
	out := engine.WatercourseHexes(s)
	for h := range engine.ReservedHexes(s.Config, s.Board) {
		if out == nil {
			out = map[board.Hex]bool{}
		}
		out[h] = true
	}
	return out
}

// numberedCoast is the landing-eligible set, fixed at setup: every
// main-landmass hex that is coastal (a neighbouring position is not land: sea
// or off the board), carries a number, and is not the castle. Ascending (Q, R),
// which is also the battle sweep's order.
//
// The desert has no number and the Fishermen lake carries four, so neither is
// here and neither can be conquered, as the scenario requires.
func numberedCoast(b *board.Board, land []board.Hex, castle board.Hex, hasCastle bool) []board.Hex {
	set := hexSet(land)
	var out []board.Hex
	for _, h := range land {
		if hasCastle && h == castle {
			continue
		}
		t := b.Tiles[h]
		if !t.Res.Producing() || t.Number == 0 {
			continue
		}
		if isCoastal(b, set, h) {
			out = append(out, h)
		}
	}
	return out
}

// isCoastal reports whether h has a neighbouring position that is not part of
// the landmass: a sea hex, another island, or off the board entirely.
func isCoastal(b *board.Board, land map[board.Hex]bool, h board.Hex) bool {
	for _, n := range h.Neighbors() {
		if !land[n] {
			return true
		}
	}
	return false
}

func hexSet(hs []board.Hex) map[board.Hex]bool {
	out := make(map[board.Hex]bool, len(hs))
	for _, h := range hs {
		out[h] = true
	}
	return out
}

func hexDist(a, c board.Hex) int {
	return (abs(a.Q-c.Q) + abs(a.R-c.R) + abs(a.Q+a.R-c.Q-c.R)) / 2
}

func hexLess(a, c board.Hex) bool {
	if a.Q != c.Q {
		return a.Q < c.Q
	}
	return a.R < c.R
}

func sortHexes(hs []board.Hex) {
	sort.SliceStable(hs, func(i, j int) bool { return hexLess(hs[i], hs[j]) })
}

// coastIndex is where h sits in the landing-eligible list, or -1.
func (e *Ext) coastIndex(h board.Hex) int {
	for i, c := range e.Coast {
		if c == h {
			return i
		}
	}
	return -1
}

// RaidersOn is how many raiders stand on hex h. Zero for any hex that is not
// landing-eligible, which is every interior hex, the castle, the desert, the
// lake and every outer island.
func (e *Ext) RaidersOn(h board.Hex) int {
	if e.Shared {
		n := 0
		for _, r := range e.PathFigures {
			if r.Alive && r.Hex == h {
				n++
			}
		}
		return n
	}
	if i := e.coastIndex(h); i >= 0 {
		return e.RaiderCount[i]
	}
	return 0
}

// Conquered reports whether hex h is saturated. Derived, never stored, so every
// rule that adds or removes a raider updates it.
func (e *Ext) Conquered(h board.Hex) bool { return e.RaidersOn(h) == conquered }

// onLandmass reports whether h is part of the landmass this scenario is played
// on. Riders never leave it and raiders never land off it.
//
// A binary search because this is the innermost test of the rider walk
// (riderReach, movesFor, and ViewExt once per viewer per frame). Land is sorted
// by mainLandmass and never mutated afterwards.
func (e *Ext) onLandmass(h board.Hex) bool {
	_, ok := slices.BinarySearchFunc(e.Land, h, func(a, c board.Hex) int {
		switch {
		case hexLess(a, c):
			return -1
		case hexLess(c, a):
			return 1
		}
		return 0
	})
	return ok
}

// riderPath reports whether a rider may stand on or cross edge e: a path with
// at least one adjacent hex on the main landmass. A path between two sea hexes
// does not qualify, so riders cannot march across water between islands.
func (e *Ext) riderPath(ed board.Edge) bool {
	return slices.ContainsFunc(board.EdgeHexes(ed), e.onLandmass)
}

// castlePaths are the castle hex's six paths, the only places a Muster may put a
// rider and the ring no rider may still be standing on when the turn ends.
func (e *Ext) castlePaths() []board.Edge {
	if !e.HasCastle {
		return nil
	}
	es := e.Castle.Edges()
	out := make([]board.Edge, 0, len(es))
	for _, ed := range es {
		out = append(out, ed)
	}
	sortEdges(out)
	return out
}

func sortEdges(es []board.Edge) {
	sort.SliceStable(es, func(i, j int) bool { return edgeLess(es[i], es[j]) })
}

func edgeLess(a, c board.Edge) bool {
	if a.A != c.A {
		return vertexLess(a.A, c.A)
	}
	return vertexLess(a.B, c.B)
}

func vertexLess(a, c board.Vertex) bool {
	if a.Q != c.Q {
		return a.Q < c.Q
	}
	if a.R != c.R {
		return a.R < c.R
	}
	return a.Side < c.Side
}

// supplyEmpty reports whether the neutral supply has run out, which stops
// landings for the rest of the game. Raiders leave the supply when they land
// and do not return when captured, so the pressure tails off.
//
// Unbounded under Knights, where the combination rule replaces the "hand back 3
// prisoners for a VP token when out of figures" recycle. With a counter and a
// floor(n/3) VP rule that recycle amounts to an unbounded supply.
func (e *Ext) supplyEmpty(knights bool) bool { return !knights && e.Supply <= 0 }

// takeFromSupply decrements the supply unless it is unbounded.
func (e *Ext) takeFromSupply(knights bool) {
	if !knights {
		e.Supply--
	}
}

// ValidateFinishedBoard refuses authored islands whose separating channels
// leave no room for the refuge patch. A failed repair must not start a game
// whose productive terrain can all be conquered permanently.
func (Module) ValidateFinishedBoard(b *board.Board, _ engine.GameConfig) error {
	land := mainLandmass(b)
	castle, hasCastle := castleHex(b, land, nil)
	set := hexSet(land)
	if len(numberedCoast(b, land, castle, hasCastle)) < minCoastHexes {
		return ErrNoRefuge
	}
	for _, h := range land {
		t := b.Tiles[h]
		if (!hasCastle || h != castle) && t.Res.Producing() && t.Number > 0 && !isCoastal(b, set, h) {
			return nil
		}
	}
	return ErrNoRefuge
}
