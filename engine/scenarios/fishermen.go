package scenarios

import (
	"encoding/json"
	"math/rand/v2"
	"slices"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Fishermen: the desert becomes a lake (yields on 2, 3, 11, 12) and six
// fishing-ground tiles sit on the coast (numbers 4, 5, 6, 8, 9, 10). When a
// fish source's number is rolled, each adjacent settlement draws one fish tile
// and each city two, from a shared supply of 1/2/3-fish tiles. Fish are spent on
// escalating actions. One tile is the "old boot": its holder needs one extra VP
// to win and may pass it, after rolling, to a player doing at least as well.
const FishermenName = "fishermen"

const (
	CmdSpendFish engine.CommandType = "spend_fish"
	CmdGiveBoot  engine.CommandType = "give_boot"

	EvFishCaught engine.EventType = "tab_fish_caught"
	// EvFishGained is one player's share of a catch: which tiles they drew.
	// The mix is hidden information (see the fishCaughtData comment), so it is
	// emitted per seat with a Visible list of one, alongside the public
	// EvFishCaught that carries the same draw's public half.
	EvFishGained engine.EventType = "tab_fish_gained"
	EvFishSpent  engine.EventType = "tab_fish_spent"
	EvBootGiven  engine.EventType = "tab_boot_given"
)

// Fish spends and their costs.
//
// FishRemoveRobber removes the robber from the board (it returns when a player
// next resolves a 7 or plays a knight); the spender does not name a
// destination.
//
// FishProgressCard is the seven-fish rung for rulesets with no development deck:
// under Fishermen with Knights, 7 fish draw one progress card of the player's
// choice. Only one of the two is ever offered (see decideSpend), so they share a
// price.
const (
	FishRemoveRobber = "remove_robber" // 2 fish: take the robber off the board (no steal)
	FishSteal        = "steal"         // 3 fish: take a random card from a victim
	FishTakeResource = "take_resource" // 4 fish: take a resource of choice from the bank
	FishFreeRoad     = "free_road"     // 5 fish: build a road (or, under Islands, a ship) for nothing
	FishWagonBoost   = "wagon_boost"   // 2 fish: +2 wagon movement
	FishRiderHurry   = "rider_hurry"   // 2 fish, under Raiders: one rider moves up to five paths
	FishBridge       = "bridge"        // 6 fish, under Rivers: build a bridge for nothing
	FishDevCard      = "dev_card"      // 7 fish: draw a development card free
	FishProgressCard = "progress_card" // 7 fish, under Knights: one progress card of your choice
)

// FishBridgeCost is the six-fish rung's price. Exported because the bridge
// belongs to Rivers, so tests and clients should read the number rather than
// restate it.
const FishBridgeCost = 6

var fishCosts = map[string]int{
	FishRemoveRobber: 2, FishSteal: 3, FishTakeResource: 4, FishFreeRoad: 5,
	FishWagonBoost: 2, FishRiderHurry: 2, FishBridge: FishBridgeCost, FishDevCard: 7, FishProgressCard: 7,
}

// fishTileCap is the most fish tiles a seat may hold at once. It counts tiles,
// not value: seven 3-fish tiles (21 fish) is a legal maximum. The old boot does
// not count.
const fishTileCap = 7

// LakeNumbers are the four production numbers a lake pays on, ascending.
//
// Published in ViewExt ("lake_numbers") because board.Tile holds only one number,
// so the client would otherwise hardcode {2, 3, 11, 12}. The lake tile's Number
// stays zero: consumers treat a non-zero Number as an ordinary numbered hex
// (engine/islands/setup.go, the client's planChips), so a placeholder would draw
// one chip on a hex that pays on four. A multi-number field on board.Tile would
// put one scenario's rule in every ruleset's tile.
var LakeNumbers = []int{2, 3, 11, 12}

// SecondLakeNumbers are the numbers the 5-6 player bracket's second lake hex
// carries. Every lake after the first pays on these; see fishTableFor.
var SecondLakeNumbers = []int{4, 10}

// groundNumbers are the production numbers of the six fishing grounds at 3-4
// players.
var groundNumbers = []int{4, 5, 6, 8, 9, 10}

// fishSupply is the count of 1-, 2-, and 3-fish tiles at 3-4 players
// (29 total).
var fishSupply = [3]int{11, 10, 8}

// bootSupply is the notional number of fish tiles the old boot hides among at
// 3-4 players: the 29 tokens and the boot itself.
const bootSupply = 30

// fishTable is one table size's component counts (derivation 13):
//   - 2 to 4 seats: six grounds (4, 5, 6, 8, 9, 10), 29 tokens as 11/10/8, one
//     lake on 2, 3, 11 and 12.
//   - 5 and 6 seats: the 5-6 player bracket. Two more grounds (5 and 9), 14 more
//     tokens (4/5/5) for 43 as 15/15/13, and a second lake on 4 and 10.
//   - 7 to 10 seats: ours, one more step of the same increments: two more grounds
//     on 5 and 9, fourteen more tokens as 4/5/5, a third lake on 4 and 10. This
//     keeps tokens close to one per pip of fish production (30/29, 44/43, 58/57).
//     See docs/rules/scenarios.md, "Table sizes".
//
// Lakes lists the number sets in deal order: the first lake gets the first set,
// every later lake the last, so extra lake hexes on a map still pay.
type fishTable struct {
	Grounds []int
	Supply  [3]int
	Lakes   [][]int
}

func fishTableFor(players int) fishTable {
	switch {
	case players <= 4:
		return fishTable{groundNumbers, fishSupply, [][]int{LakeNumbers}}
	case players <= 6:
		return fishTable{[]int{4, 5, 5, 6, 8, 9, 9, 10}, [3]int{15, 15, 13},
			[][]int{LakeNumbers, SecondLakeNumbers}}
	default:
		return fishTable{[]int{4, 5, 5, 5, 6, 8, 9, 9, 9, 10}, [3]int{19, 20, 18},
			[][]int{LakeNumbers, SecondLakeNumbers, SecondLakeNumbers}}
	}
}

// FishGroundCount is how many fishing grounds a table of `players` places (6,
// 8 or 10; see fishTableFor). Exported for the sim and ruletest invariants.
func FishGroundCount(players int) int { return len(fishTableFor(players).Grounds) }

// FishGroundNumbers is the numbers a table of `players` puts on its grounds,
// ascending (a copy).
func FishGroundNumbers(players int) []int { return slices.Clone(fishTableFor(players).Grounds) }

// bootSupplyFor is the notional count the boot hides among at a table size:
// every token in the supply plus the boot, as bootSupply is at 3-4 players.
func bootSupplyFor(players int) int {
	t := fishTableFor(players)
	return t.Supply[0] + t.Supply[1] + t.Supply[2] + 1
}

// fishLake is one lake and the numbers it pays on. Recorded in the board ext
// blob, because which lake carries which numbers is dealt from the public seed
// (dealLakeNumbers) and the log wins on replay.
type fishLake struct {
	Hex     board.Hex `json:"hex"`
	Numbers []int     `json:"numbers"`
}

// dealLakeNumbers deals the table's lake number sets over the board's lakes:
// one Shuffle of the lakes off engine.FishLakesSeq, then the first lake in
// shuffled order takes the first set (2, 3, 11, 12) and the rest the last. Seeded
// so the four-number lake is not always at the same end of the board. Returned in
// board order. verify/modules.mjs re-derives it.
func dealLakeNumbers(b *board.Board, players int, rng *rand.Rand) []fishLake {
	var lakes []fishLake
	for _, h := range board.HexesInRadius(b.Radius) {
		if t, ok := b.Tiles[h]; ok && t.Res == board.Lake {
			lakes = append(lakes, fishLake{Hex: h})
		}
	}
	sets := fishTableFor(players).Lakes
	order := make([]int, len(lakes))
	for i := range order {
		order[i] = i
	}
	rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
	for k, i := range order {
		lakes[i].Numbers = slices.Clone(sets[min(k, len(sets)-1)])
	}
	return lakes
}

type fishGround struct {
	V []board.Vertex `json:"v"` // coastal intersections it touches
	// Hex is the sea hex the ground is the notch of (the one whose corner ring
	// deriveGrounds walked to build V). Published because the client cannot always
	// recover it: a two-corner ground's corners are shared by the hexes on both sides
	// of the edge between them, and in a one-hex strait both are water.
	//
	// A bare board.Hex, unlike the nullable Caravans oasis: every ground is built
	// from a sea hex, so there is no absent case to express.
	Hex    board.Hex `json:"hex"`
	Number int       `json:"number"`
}

type FishExt struct {
	Held [][3]int // per player: counts of 1-, 2-, 3-fish tiles held
	// Tiles is the public per-seat count of fish tiles, the analogue of a hand's
	// public card count: how many is public, their value is private.
	//
	// The count is derivable from public state anyway (grounds, lake numbers and
	// buildings decide how many tiles each seat draws), so publishing the value too
	// would reveal the mix by arithmetic (one tile worth 3 is a 3-fish tile). Only the
	// count is published. sim.TestFishMixIsNotPubliclyReconstructible checks a
	// spectator cannot recover the mix.
	//
	// Tracked rather than counted from Held, since Held is not knowable from a
	// redacted stream: a catch splits into a public half (fishCaughtData.Draws) and
	// per-seat EvFishGained events with the mix, and Tiles folds from the public
	// halves alone. On the server's truth fold Tiles[p] == tileCount(Held[p])
	// (TestFishTilesTrackHeldOnTruth).
	Tiles   []int
	Supply  [3]int // tiles still face-down in the supply
	Used    [3]int // spent tiles, reshuffled back when the supply empties
	Grounds []fishGround
	// Lakes is every lake on the board and the numbers it pays on, in board
	// order (derivation 13). Nil means a log from before it, where every lake
	// pays on LakeNumbers (see UnmarshalJSON).
	Lakes []fishLake
	// BootSupply is the notional count the boot hides among, which TilesLeft
	// resets to. Zero on a legacy blob, which means bootSupply.
	BootSupply int

	BootHolder engine.PlayerID // NoPlayer until the boot is drawn
	BootInPlay bool
	TilesLeft  int // notional tiles still hiding the boot
}

// CloneExt deep-copies the module state for Decide, which runs the rules against
// a copy rather than the live game.
//
// It starts from a shallow struct copy so every value field is carried. Reference
// fields would alias the live game, so every slice, map and pointer below is
// replaced; TestCloneExtCarriesEveryField in engine/ruletest checks them by
// reflection.
func (e *FishExt) CloneExt() engine.Extension {
	c := *e
	c.Held = append([][3]int(nil), e.Held...)
	c.Tiles = append([]int(nil), e.Tiles...)
	// Grounds never changes after setup, but is copied anyway in case a future
	// rule mutates it; the cost is negligible.
	c.Grounds = make([]fishGround, len(e.Grounds))
	for i, g := range e.Grounds {
		g.V = append([]board.Vertex(nil), g.V...)
		c.Grounds[i] = g
	}
	if e.Lakes != nil {
		c.Lakes = make([]fishLake, len(e.Lakes))
		for i, l := range e.Lakes {
			l.Numbers = slices.Clone(l.Numbers)
			c.Lakes[i] = l
		}
	}
	return &c
}

// UnmarshalJSON adds one legacy rule: a blob with no "Lakes" key predates
// derivation 13, when every lake paid on 2, 3, 11 and 12, so the derived Lakes it
// is unmarshalled over are dropped. Otherwise an old 5-seat game would replay
// with its second lake on 4 and 10.
func (e *FishExt) UnmarshalJSON(raw []byte) error {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return err
	}
	if _, ok := probe["Lakes"]; !ok {
		e.Lakes = nil
	}
	if _, ok := probe["BootSupply"]; !ok {
		e.BootSupply = 0
	}
	type plain FishExt
	return json.Unmarshal(raw, (*plain)(e))
}

// bootReset is what TilesLeft resets to when it runs out.
func (e *FishExt) bootReset() int {
	if e.BootSupply > 0 {
		return e.BootSupply
	}
	return bootSupply
}

// lakeNumbersAt is the numbers the lake at h pays on: its recorded set, or, on
// a legacy ext with no Lakes, LakeNumbers.
func (e *FishExt) lakeNumbersAt(h board.Hex) []int {
	if e.Lakes == nil {
		return LakeNumbers
	}
	for _, l := range e.Lakes {
		if l.Hex == h {
			return l.Numbers
		}
	}
	return nil
}

func fishExt(s *engine.State) *FishExt {
	if e, ok := s.Ext[FishermenName].(*FishExt); ok {
		return e
	}
	e := freshFish(s)
	s.Ext[FishermenName] = e
	return e
}

func fishExtRO(s *engine.State) *FishExt {
	if e, ok := s.Ext[FishermenName].(*FishExt); ok {
		return e
	}
	return freshFish(s)
}

func freshFish(s *engine.State) *FishExt {
	n := len(s.Players)
	table := fishTableFor(n)
	e := &FishExt{
		Held: make([][3]int, n), Tiles: make([]int, n),
		Supply:     table.Supply,
		BootHolder: engine.NoPlayer, TilesLeft: bootSupplyFor(n), BootSupply: bootSupplyFor(n),
	}
	if s.Board != nil {
		e.Grounds = dealGroundNumbers(deriveGrounds(s.Board, table.Grounds),
			engine.PublicRngForSeed(s.PublicSeed, engine.FishGroundsSeq))
		e.Lakes = dealLakeNumbers(s.Board, n,
			engine.PublicRngForSeed(s.PublicSeed, engine.FishLakesSeq))
	}
	return e
}

// dealGroundNumbers shuffles the numbers deriveGrounds placed over its grounds,
// as the scenario shuffles the ground tiles face down. deriveGrounds assigns
// numbers in a fixed (Q, R) order, which would tie each number to a board
// position.
//
// Only the assignment moves: which hexes are grounds, their corners and the
// number multiset are unchanged (a short board is still short from the top). One
// Shuffle off engine.FishGroundsSeq over the grounds in deriveGrounds' order,
// then re-sorted by number. verify/modules.mjs re-derives it.
func dealGroundNumbers(grounds []fishGround, rng *rand.Rand) []fishGround {
	nums := make([]int, len(grounds))
	for i, g := range grounds {
		nums[i] = g.Number
	}
	rng.Shuffle(len(nums), func(i, j int) { nums[i], nums[j] = nums[j], nums[i] })
	for i := range grounds {
		grounds[i].Number = nums[i]
	}
	sort.SliceStable(grounds, func(i, j int) bool { return grounds[i].Number < grounds[j].Number })
	return grounds
}

// groundCorners caps a fishing ground at three coastal intersections, matching
// docs/rules/scenarios.md ("touches up to three coastal intersections").
const groundCorners = 3

// shoreRun returns the corners a fishing ground on sea hex h would touch: the
// longest run of consecutive land vertices around h's six-corner ring, trimmed
// to the first groundCorners. Hex.Vertices lists corners clockwise and
// consecutive entries share an edge, so a run is a connected stretch of shore.
//
// Ties go to the lower ring index, and the kept corners are that run's first three
// clockwise, listed in ascending ring order. The result depends only on h and the
// land mask.
//
// A sea hex touching land on two separate stretches (both shores of a strait)
// keeps only the longest. Fewer than two contiguous corners means no ground, and
// shoreRun returns nil.
func shoreRun(bd *board.Board, h board.Hex) []board.Vertex {
	ring := h.Vertices()
	var land [6]bool
	n := 0
	for i, v := range ring {
		if bd.LandVertex(v) {
			land[i] = true
			n++
		}
	}
	if n < 2 {
		return nil
	}
	if n == 6 {
		// Fully enclosed: every index starts a maximal run, so pick index 0.
		return []board.Vertex{ring[0], ring[1], ring[2]}
	}

	bestStart, bestLen := 0, 0
	for s := range 6 {
		if !land[s] || land[(s+5)%6] {
			continue // not land, or not the start of a run
		}
		l := 0
		for l < 6 && land[(s+l)%6] {
			l++
		}
		if l > bestLen {
			bestStart, bestLen = s, l
		}
	}
	if bestLen < 2 {
		return nil
	}
	bestLen = min(bestLen, groundCorners)
	// Emit in ascending ring order rather than from bestStart, so a run that
	// wraps past index 0 is listed like an unwrapped one.
	var keep [6]bool
	for i := range bestLen {
		keep[(bestStart+i)%6] = true
	}
	out := make([]board.Vertex, 0, bestLen)
	for i := range 6 {
		if keep[i] {
			out = append(out, ring[i])
		}
	}
	return out
}

// deriveGrounds places fishing grounds on coastal notches: sea hexes touching the
// shore over at least two contiguous corners, no two sharing a vertex, never on a
// harbor's dock hex. Each is trimmed by shoreRun to at most three corners before
// ranking, so 3-corner notches rank above 2-corner ones and ties fall to the
// stable (Q, R) anchor order.
//
// Dock hexes (board.HarborSeaHex) are excluded: a dock occupies the water beside
// its harbor edge, and a ground chip there collides with it, as
// board.validateHarbors refuses for two docks. The smallest board still has
// enough candidates.
//
// The full count is not guaranteed on every possible coast. The spread rule is
// not relaxed to reach it, since it keeps two chips off one settlement spot. A
// short board loses the last numbers in groundNumbers (10, then 9).
// sim.TestFishGroundsCount asserts the full count on every Fishermen ruleset.
//
// Numbers are returned in candidate order, a function of the board's shape;
// freshFish deals them with a seeded shuffle (dealGroundNumbers), so nothing else
// should treat this result's Number as the game's.
func deriveGrounds(b *board.Board, numbers []int) []fishGround {
	type cand struct {
		anchor board.Hex
		verts  []board.Vertex
	}
	docked := make(map[board.Hex]bool, len(b.Harbors))
	for _, hb := range b.Harbors {
		if sea, ok := b.HarborSeaHex(hb); ok {
			docked[sea] = true
		}
	}
	seen := map[board.Hex]bool{}
	var cands []cand
	for _, h := range board.HexesInRadius(b.Radius) {
		if !b.Land(h) {
			continue
		}
		for _, n := range h.Neighbors() {
			if b.Land(n) || seen[n] {
				continue
			}
			seen[n] = true
			if docked[n] {
				continue
			}
			if lv := shoreRun(b, n); len(lv) >= 2 {
				cands = append(cands, cand{n, lv})
			}
		}
	}
	sort.Slice(cands, func(i, j int) bool {
		a, c := cands[i].anchor, cands[j].anchor
		if a.Q != c.Q {
			return a.Q < c.Q
		}
		return a.R < c.R
	})
	// Prefer 3-corner notches, then 2-corner ones. The only separation is that
	// two grounds may not share a vertex, so neighbouring notches are allowed.
	// take walks the candidates in order and keeps each that shares no corner
	// with a kept ground. With trim, an overlapping three-corner notch may be
	// kept as its first two corners, or else its last two, when that pair is
	// free (a ground is two or three coastal intersections).
	take := func(order []cand, trim bool) []fishGround {
		var out []fishGround
		used := map[board.Vertex]bool{}
		free := func(vs []board.Vertex) bool {
			for _, v := range vs {
				if used[v] {
					return false
				}
			}
			return true
		}
		for _, c := range order {
			if len(out) == len(numbers) {
				break
			}
			verts := c.verts
			if !free(verts) {
				if !trim || len(verts) != groundCorners {
					continue
				}
				switch {
				case free(verts[:2]) && ringAdjacent(c.anchor, verts[0], verts[1]):
					verts = verts[:2]
				case free(verts[1:]) && ringAdjacent(c.anchor, verts[1], verts[2]):
					verts = verts[1:]
				default:
					continue
				}
			}
			for _, v := range verts {
				used[v] = true
			}
			out = append(out, fishGround{V: slices.Clone(verts), Hex: c.anchor, Number: numbers[len(out)]})
		}
		return out
	}
	order := append([]cand(nil), cands...)
	sort.SliceStable(order, func(i, j int) bool { return len(order[i].verts) > len(order[j].verts) })
	out := take(order, false)
	// Short of the table's count: try thin notches first (derivation 13).
	// Fatter-first packs badly on a long straight coast, where adjacent
	// three-corner notches share corners and then block the two-corner
	// notches between them. This matters for the 8 and 10 grounds of larger
	// tables. The second order is used only when it places more, so boards
	// the first order fills are unchanged.
	if len(out) < len(numbers) {
		thin := append([]cand(nil), cands...)
		sort.SliceStable(thin, func(i, j int) bool { return len(thin[i].verts) < len(thin[j].verts) })
		if alt := take(thin, true); len(alt) > len(out) {
			out = alt
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Number < out[j].Number })
	return out
}

// ringAdjacent reports whether two corners of h are next to each other on its
// ring. A run that wraps past corner 0 has its consecutive pair split across
// the ends of shoreRun's slice; this keeps a trimmed pair contiguous either way.
func ringAdjacent(h board.Hex, a, c board.Vertex) bool {
	ring := h.Vertices()
	for i := range 6 {
		if (ring[i] == a && ring[(i+1)%6] == c) || (ring[i] == c && ring[(i+1)%6] == a) {
			return true
		}
	}
	return false
}

// FishStateExt returns the fishermen module's ext state for s and whether the
// module is active. Read-only: callers outside the fold must not mutate it.
func FishStateExt(s *engine.State) (*FishExt, bool) {
	e, ok := s.Ext[FishermenName].(*FishExt)
	return e, ok
}

type Fishermen struct{}

func (Fishermen) Name() string { return FishermenName }

// TradeHexAllowed keeps every lake from becoming a Wagons trade hex
// (engine.TradeHexEligibility): a lake pays fish to its shore, and a trade hex's
// building stands on the hex it takes over.
//
// On engine-dealt boards this never binds, since the generator never deals the
// desert on the outer ring's corners. It binds where an author pinned a desert on
// a cape, and there the author's map decides the triple, as for the Caravans
// oasis. See docs/rules/wagons.md, "Fishermen", and
// ruletest.TestFishermenLakeIsNeverATradeHex.
func (Fishermen) TradeHexAllowed(s *engine.State, h board.Hex) bool {
	t, ok := s.Board.Tiles[h]
	return !ok || t.Res != board.Lake
}

// InitExtBoard seeds the module state as soon as the board exists, so the
// fishing grounds are in every client view from the first frame. Not InitExt,
// since s.Board is nil then.
//
// Pure: freshFish depends on len(s.Players) and s.Board, plus seeded public
// slots. See engine.ExtBoardInitializer.
func (Fishermen) InitExtBoard(s *engine.State) engine.Extension { return freshFish(s) }

// SetupBoard turns deserts into the lake.
func (Fishermen) SetupBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {
	for h, t := range b.Tiles {
		if t.Res == board.ResNone {
			// Number stays zero: the lake pays on four numbers (LakeNumbers), which
			// travel to the client in ViewExt, and any single value here would be
			// believed by every `Number != 0` consumer.
			b.Tiles[h] = board.Tile{Res: board.Lake}
		}
	}
	// The robber starts beside the board and enters on the first 7: the
	// desert the base game would park it on is now the lake, and a robber
	// there would block all four lake numbers (see fishCatch) from the start.
	// board.OffBoard is outside every board, so no hex test matches it, and
	// the ordinary post-7 move brings it back. The two-fish spend takes it off
	// again the same way.
	b.Robber = board.OffBoard
}

// fishCaughtData is the public half of a catch: how many tiles each seat drew
// and how many left the supply. A seat's tile count is public (as hand_count
// is); the mix and its value are private and travel in per-seat EvFishGained.
//
// Draws lets a viewer of only the public half fold FishExt.Tiles correctly
// (applyCaught) without re-deriving production. Publishing it costs nothing,
// since the count follows from the public board anyway.
type fishCaughtData struct {
	Draws  []int           `json:"draws"`   // per player: TILES drawn (not the mix, not the value)
	Total  int             `json:"total"`   // tiles drawn (for supply bookkeeping)
	BootTo engine.PlayerID `json:"boot_to"` // NoPlayer if the boot stayed hidden
	// Supply/Used are the post-draw snapshot from the Decide side. Apply restores
	// them verbatim so replay is identical: drawTile's weighted draw, with the spent
	// pile reshuffled back when the supply empties, cannot be reconstructed from the
	// gains alone. See TestFishSupplyReshuffleConservation.
	//
	// Pointers, so "removed by the redactor" differs from "genuinely empty".
	//
	// They are on the truth event only. The redactor drops both for every viewer,
	// spectators included: the tile set is constant, so
	// sum_p Held[p][v] = fishSupply[v] - Supply[v] - Used[v], which with one's own
	// mix reveals the rest of the table's holdings, and successive Used values reveal
	// exactly what each spender handed in. Nothing public reads them.
	Supply *[3]int `json:"supply,omitempty"`
	Used   *[3]int `json:"used,omitempty"`

	// Values is the legacy per-seat fish value gained, from one earlier release.
	// Never written; kept so those logs decode. Not folded, since a value gives no
	// tile count; those logs' counts are repaired from Held where Held is
	// trustworthy (see applyGain).
	Values []int `json:"values,omitempty"`

	// Gains is the legacy per-seat mix, from before the catch was split into a
	// public half and per-seat EvFishGained events. Never written; kept because
	// older logs carry it and must fold to the same state (applyCaught reads it
	// when present).
	Gains [][3]int `json:"gains,omitempty"`
}

// fishGainData is one seat's share of a catch: the tiles themselves. Emitted
// with Visible == that seat, and redacted to {player} for everyone else.
type fishGainData struct {
	Player engine.PlayerID `json:"player"`
	Gain   [3]int          `json:"gain"` // 1/2/3-fish tiles drawn
}

// fishSpentData carries a spend. Which tiles were handed in (Discard) and their
// worth (Value) are the spender's own information, like a catch's mix. Tiles, the
// number handed in, is the public half that keeps every seat's public tile count
// right, as hand_count does for cards.
//
// Value must stay private: spendTiles is deterministic and the price ladder is
// public, so (use, value) would pin the exact tiles for most costs. The count
// alone reveals no more than a card played face down.
type fishSpentData struct {
	Player    engine.PlayerID `json:"player"`
	Use       string          `json:"use"`
	Discard   [3]int          `json:"discard"`       // tiles spent (hidden: the mix)
	Value     int             `json:"value"`         // fish value spent (hidden)
	Tiles     int             `json:"tiles"`         // number of tiles spent (public)
	Res       board.Resource  `json:"res,omitempty"` // take_resource
	GrantRoad bool            `json:"grant_road,omitempty"`
}

func init() {
	// Hidden-payload events keep their public parts when redacted for
	// non-parties (see game.RedactEvent -> engine.RedactorFor). EvFishCaught
	// is public (Visible == nil) but still has a redactor: it removes two
	// fields for every viewer, since together they reveal the mix in
	// aggregate (see fishCaughtData.Supply). The stored log keeps them.
	engine.RegisterRedactor(EvFishCaught, func(e engine.Event) json.RawMessage {
		d := engine.DecodeEvent[fishCaughtData](e)
		public := map[string]any{"draws": d.Draws, "total": d.Total, "boot_to": d.BootTo}
		raw, _ := json.Marshal(public)
		return raw
	})
	engine.RegisterRedactor(EvFishGained, func(e engine.Event) json.RawMessage {
		// That a seat drew is already public (EvFishCaught names how many
		// tiles); which tiles it drew is not.
		d := engine.DecodeEvent[fishGainData](e)
		raw, _ := json.Marshal(map[string]any{"player": d.Player})
		return raw
	})
	engine.RegisterRedactor(EvFishSpent, func(e engine.Event) json.RawMessage {
		// The action, and how many tiles it took, are public; which tiles they
		// were and what they were worth are not.
		d := engine.DecodeEvent[fishSpentData](e)
		public := map[string]any{"player": d.Player, "use": d.Use, "tiles": d.Tiles}
		if d.Res != board.ResNone {
			public["res"] = d.Res
		}
		if d.GrantRoad {
			public["grant_road"] = d.GrantRoad
		}
		raw, _ := json.Marshal(public)
		return raw
	})
}

type bootData struct {
	Player engine.PlayerID `json:"player"`
}

func (Fishermen) Hooks() engine.Hooks {
	return engine.Hooks{
		OnDiceRolled: fishCatch,
		SetupGrant:   setupFishGrant,
		WinThresholdDelta: func(s *engine.State, p engine.PlayerID) int {
			if fishExtRO(s).BootHolder == p {
				return 1
			}
			return 0
		},
	}
}

// There is no LegalExtras hook for the 2-fish spend: it removes the robber
// rather than moving it, so there is nothing to target. A client offers it
// while the robber is on the board (board.Board.RobberOnBoard) and the seat
// holds two fish.

// fishCatch resolves the lake and fishing grounds on a roll, drawing fish tiles
// from the supply and possibly turning up the old boot.
func fishCatch(s *engine.State, d1, d2 int) []engine.Event {
	roll := d1 + d2
	x := fishExtRO(s)
	draws := make([]int, len(s.Players)) // tiles each player draws this roll
	addDraw := func(v board.Vertex) {
		// A building a module has switched off draws no fish: fish are
		// production, and a Raiders settlement with no unconquered neighbour is
		// laid on its side. See engine.BuildingIsInert.
		if engine.BuildingIsInert(s, v) {
			return
		}
		if b, ok := s.Buildings[v]; ok {
			if b.City {
				draws[b.Owner] += 2
			} else {
				draws[b.Owner]++
			}
		}
	}
	for h, t := range s.Board.Tiles {
		if t.Res != board.Lake || !slices.Contains(x.lakeNumbersAt(h), roll) {
			continue
		}
		// The robber blocks the lake on all four of its numbers; the lake is
		// not immune. The fishing grounds are unblockable: a ground is a marker
		// on water, and the robber may not be placed on water.
		if h == s.Board.Robber {
			continue
		}
		for _, v := range h.Vertices() {
			addDraw(v)
		}
	}
	for _, g := range x.Grounds {
		if g.Number != roll {
			continue
		}
		for _, v := range g.V {
			addDraw(v)
		}
	}
	return drawCatch(s, x, draws)
}

// setupFishGrant is the setup bonus: a second settlement adjacent to a fishing
// ground or lake receives a random fish token on top of the normal starting
// resources. It runs from the base round-2 grant (engine.Hooks.SetupGrant), so it
// covers a round-2 city too (Knights, Wagons).
//
// One token however many sources the corner touches. The draw is an ordinary
// one-tile catch (drawCatch) keyed on the placement's log position: the mix on the
// private run (engine.PrivateFishTilesSeq), the old boot on the public one
// (engine.FishBootSeq, re-derived by verify/verify.mjs). We count the lake as a
// source as well as the grounds (docs/rules/scenarios.md).
func setupFishGrant(s *engine.State, p engine.PlayerID, v board.Vertex) []engine.Event {
	x := fishExtRO(s)
	wet := false
	for _, h := range v.Hexes() {
		if t, ok := s.Board.Tiles[h]; ok && t.Res == board.Lake {
			wet = true
		}
	}
	for _, g := range x.Grounds {
		if slices.Contains(g.V, v) {
			wet = true
		}
	}
	if !wet || int(p) < 0 || int(p) >= len(s.Players) {
		return nil
	}
	draws := make([]int, len(s.Players))
	draws[p] = 1
	return drawCatch(s, x, draws)
}

// drawCatch draws the tiles a catch owes (draws[p] per seat), under the
// seven-token cap and the short-supply rule, and emits the public half and the
// per-seat halves. Shared by the roll (fishCatch) and the setup bonus
// (setupFishGrant); both key their streams on s.NextSeq.
func drawCatch(s *engine.State, x *FishExt, draws []int) []engine.Event {
	// The seven-token cap, applied before anything else: a seat holding seven
	// tiles draws no more. Applying it here keeps the short-supply check below
	// honest, since the supply only has to cover what is actually taken.
	//
	// exchange[p] is the swap the cap offers instead: once per turn, a seat at
	// seven that would gain a token may exchange one of its tokens with one
	// from the supply, then stop drawing. One roll is one turn here.
	//
	// Decision (the rule says "may" and there is nobody to ask): the engine
	// takes the exchange only when it cannot lose value, i.e. it hands in a
	// 1-fish tile. A seat holding only 2s and 3s declines, since swapping a 2
	// for the supply's average (about 1.9) loses. Recorded as our decision in
	// docs/rules/scenarios.md.
	exchange := make([]bool, len(s.Players))
	for p := range draws {
		room := max(0, fishTileCap-tileCount(x.Held[p]))
		if draws[p] <= room {
			continue
		}
		// The seat fills with tiles still owed: it draws what fits, then takes
		// at most the one exchange instead of the rest.
		exchange[p] = true
		draws[p] = room
	}

	planned := 0
	for _, n := range draws {
		planned += n
	}
	swaps := 0
	for _, e := range exchange {
		if e {
			swaps++
		}
	}
	if planned == 0 && swaps == 0 {
		return nil
	}
	// If the supply cannot cover everyone's production, nobody receives fish
	// that turn. An exchange draws a tile too, so it counts; its returned
	// tile is not available in advance. Counting every armed swap may
	// over-reserve for a seat that then declines, which errs toward
	// withholding.
	if x.Supply[0]+x.Supply[1]+x.Supply[2]+x.Used[0]+x.Used[1]+x.Used[2] < planned+swaps {
		return nil
	}

	// Two streams. The tile mix is hidden (it travels only on the seat's
	// EvFishGained), so it draws from the private run engine.PrivateFishTilesSeq.
	// The boot is public (tab_fish_caught names the seat, and the boot raises
	// its win threshold), so it draws from the public run engine.FishBootSeq,
	// which verify/ re-derives.
	rng := engine.RngForReserved(s, engine.PrivateFishTilesSeq(s.NextSeq))
	supply := x.Supply
	used := x.Used
	gains := make([][3]int, len(s.Players))
	// drawn is tiles actually taken from the supply, per seat: what the boot
	// rides on and the supply counts. Not `draws`, since an exchange draws a
	// tile for a seat whose draws are zero.
	drawn := make([]int, len(s.Players))
	total := 0
	draw := func(p int) {
		if supply[0]+supply[1]+supply[2] == 0 {
			supply, used = used, [3]int{} // reshuffle the spent pile
		}
		v := drawTile(&supply, rng)
		gains[p][v]++
		drawn[p]++
		total++
	}
	for p := range len(s.Players) {
		for range draws[p] {
			draw(p)
		}
		// The swap: hand back a 1-fish tile (see the decision above), then draw
		// its replacement. Held plus what was just drawn is the current holding,
		// so a 1-fish tile drawn this catch may be traded in.
		if !exchange[p] || x.Held[p][0]+gains[p][0] == 0 {
			continue
		}
		gains[p][0]--
		used[0]++
		draw(p)
	}
	if total == 0 {
		return nil // every armed swap declined and nobody had room
	}

	bootTo := engine.NoPlayer
	if !x.BootInPlay {
		boot := engine.PublicRngForSeed(s.PublicSeed, engine.FishBootSeq(s.NextSeq))
		left := max(x.TilesLeft, total)
		// Public reserved stream (see FishBootSeq), weighted by `drawn`, not
		// `draws` (an exchange draws for a seat whose draws are zero).
		if boot.IntN(left) < total {
			bootTo = weightedDrawer(drawn, boot)
		}
	}
	// supply/used hold the post-draw snapshot (including any reshuffle); record
	// it so Apply reconstructs identical arrays. See
	// TestFishSupplyReshuffleConservation.
	//
	// Emitted in two halves: one public event with the supply snapshot
	// (redacted off every wire), the boot and each seat's tile count, then one
	// EvFishGained per seat with its mix. The public half comes first so the
	// snapshot is restored before any gain is folded.
	out := []engine.Event{engine.NewEvent(EvFishCaught,
		fishCaughtData{Draws: slices.Clone(draws), Total: total, BootTo: bootTo, Supply: &supply, Used: &used})}
	for p := range gains {
		// drawn, not draws: an exchange changes a seat's tiles with a zero draw
		// count, and gains[p] carries the swap's -1 as well as the replacement.
		// A seat with all-zero gains gets no event.
		if drawn[p] == 0 {
			continue
		}
		out = append(out, engine.NewEvent(EvFishGained,
			fishGainData{Player: engine.PlayerID(p), Gain: gains[p]}, engine.PlayerID(p)))
	}
	return out
}

// ensureTiles repairs Tiles from Held when they do not line up. That is exact
// wherever it can fire: only the server's truth state (where Tiles[p] ==
// tileCount(Held[p]) by construction) and hand-built test fixtures have a Held
// without matching Tiles. A redacted fold always starts from freshFish and never
// reaches this.
//
// It is a safeguard that makes applyCaught, the EvFishSpent fold and the setHeld
// fixture total over any FishExt, at the cost of one length compare. Stale
// snapshots are handled by game.snapshotVersion, so they never reach a fold. If
// this is removed, remove the `p < len(x.Tiles)` guards at the fold sites too and
// let a short Tiles panic rather than silently drop the public count.
func (e *FishExt) ensureTiles() {
	if len(e.Tiles) == len(e.Held) {
		return
	}
	e.Tiles = make([]int, len(e.Held))
	for p := range e.Held {
		e.Tiles[p] = tileCount(e.Held[p])
	}
}

// applyCaught folds an EvFishCaught into the extension. It restores the
// post-draw Supply/Used snapshot recorded on the Decide side rather than
// re-deriving it, because drawTile's reshuffle is not reproducible from
// per-value gains (see TestFishSupplyReshuffleConservation).
//
// It does not touch Held: tiles arrive in the per-seat EvFishGained events that
// follow, which keeps one seat's mix out of another's stream.
//
// Redacted streams carry no snapshot, and absent is not zero: the fold keeps
// the supply it had rather than declaring it empty. Nothing public reads it.
func applyCaught(x *FishExt, d fishCaughtData) {
	x.ensureTiles()
	// Legacy logs only: a pre-split catch carried the mix here, so their
	// public counts come from it; newer logs use Draws. Logs from the
	// release that sent only per-seat values (d.Values) carry neither, and
	// their counts are repaired from Held by applyGain where trustworthy.
	for p, g := range d.Gains {
		for v := range 3 {
			x.Held[p][v] += g[v]
		}
		if p < len(x.Tiles) {
			x.Tiles[p] += tileCount(g)
		}
	}
	for p, n := range d.Draws {
		if p < len(x.Tiles) {
			x.Tiles[p] += n
		}
	}
	if d.Supply != nil {
		x.Supply = *d.Supply
	}
	if d.Used != nil {
		x.Used = *d.Used
	}
	if x.TilesLeft -= d.Total; x.TilesLeft < 1 {
		x.TilesLeft = x.bootReset()
	}
	if d.BootTo != engine.NoPlayer {
		x.BootHolder, x.BootInPlay = d.BootTo, true
	}
}

// applyGain folds one seat's share of a catch: the tiles, which reach only that
// seat and the server's truth fold.
//
// It also reconciles the public count against the mix, only here, where the mix
// is real. A redacted EvFishGained carries no gain and a real one is never empty,
// so an empty Gain means someone else's draw and the reconcile is skipped. This
// also lets logs from the release that published values but no counts fold to
// the right public numbers on a truth replay.
func applyGain(x *FishExt, d fishGainData) {
	x.ensureTiles()
	if d.Gain == ([3]int{}) {
		return
	}
	p := int(d.Player)
	if p < 0 || p >= len(x.Held) {
		return
	}
	for v := range 3 {
		x.Held[p][v] += d.Gain[v]
	}
	if p < len(x.Tiles) {
		x.Tiles[p] = tileCount(x.Held[p])
	}
}

// drawTile removes one tile from the supply (weighted by remaining counts) and
// returns its value index (0=1-fish, 1=2-fish, 2=3-fish).
func drawTile(supply *[3]int, rng *rand.Rand) int {
	n := supply[0] + supply[1] + supply[2]
	pick := rng.IntN(n)
	for v := range 3 {
		if pick < supply[v] {
			supply[v]--
			return v
		}
		pick -= supply[v]
	}
	supply[2]--
	return 2
}

func weightedDrawer(draws []int, rng *rand.Rand) engine.PlayerID {
	total := 0
	for _, n := range draws {
		total += n
	}
	pick := rng.IntN(total)
	for p, n := range draws {
		if pick < n {
			return engine.PlayerID(p)
		}
		pick -= n
	}
	return engine.NoPlayer
}

// fishTotal is what a holding is worth. Private: published only to the seat
// that holds it, as its own mix (see FishExt.Tiles).
func fishTotal(held [3]int) int { return held[0] + 2*held[1] + 3*held[2] }

// tileCount is how many tokens a holding is, which fishTileCap bounds (seven
// 3-fish tiles is seven tokens, twenty-one fish). Public, since a seat's draws
// follow from the roll, grounds and buildings; FishExt.Tiles publishes it.
func tileCount(held [3]int) int { return held[0] + held[1] + held[2] }

// FishTileCount is tileCount, exported for the sim invariants and the view
// layer.
func FishTileCount(held [3]int) int { return tileCount(held) }

// FishTileCap is the seven-token holding limit, exported so the client need
// not hardcode it.
const FishTileCap = fishTileCap

// FishValue is the fish value of a mix of tiles (ones, twos and threes). Not
// published (FishExt carries only the count). Exported for the sim invariants
// and the scoring path.
func FishValue(held [3]int) int { return fishTotal(held) }

func (m Fishermen) Decide(s *engine.State, cmd engine.Command) ([]engine.Event, bool, error) {
	switch cmd.Type {
	case CmdSpendFish:
		ev, err := m.decideSpend(s, cmd)
		return ev, true, err
	case CmdGiveBoot:
		ev, err := m.decideGiveBoot(s, cmd)
		return ev, true, err
	default:
	}
	return notHandled()
}

func (Fishermen) decideSpend(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	d, err := engine.DecodeCommand[struct {
		Use    string           `json:"use"`
		E      *board.Edge      `json:"e,omitempty"`
		Victim *engine.PlayerID `json:"victim,omitempty"`
		Res    board.Resource   `json:"res,omitempty"`
		Deck   int              `json:"deck,omitempty"` // progress_card: which discipline
		From   *board.Edge      `json:"from,omitempty"` // rider_hurry: the rider
		To     *board.Edge      `json:"to,omitempty"`   // rider_hurry: where it goes
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	cost, ok := fishCosts[d.Use]
	if !ok {
		return nil, engine.ErrBadCommand
	}
	// A spend whose effect the ruleset lacks is refused here, before any
	// tile is destroyed, so the player keeps their fish.
	//
	// The seven-fish rung has several faces. Knights removes the
	// development deck (NoDevCards) and the combination rule replaces the
	// draw with one progress card of the player's choice, so dev_card is
	// refused exactly where progress_card is offered. (engine.New always
	// fills DevDeck, so without this a VP card could count toward the
	// Knights target from a deck the ruleset lacks.) A scenario with its
	// own deck (Raiders) offers dev_card again: the card is taken and
	// resolved immediately.
	//
	// The two-fish spend needs a robber on the board. Knights keeps it out
	// until the barbarians first land, and once removed there is nothing to
	// do, so both cases refuse rather than charge.
	switch {
	case d.Use == FishDevCard && engine.DevCardsDisabled(s) && !engine.HasScenarioCards(s),
		d.Use == FishProgressCard && (!engine.DevCardsDisabled(s) || engine.ProgressDeckCount(s) == 0),
		d.Use == FishBridge && !engine.HasFreeBridge(s),
		d.Use == FishRiderHurry && !engine.HasFreeRiderHurry(s),
		d.Use == FishRemoveRobber && (engine.RobberSuppressed(s) || !s.Board.RobberOnBoard()):
		return nil, ErrSpendUnavailable
	}
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	x := fishExtRO(s)
	held := x.Held[cmd.Player]
	if fishTotal(held) < cost {
		// Not ErrNoResources: fish are not resources (no hand limit,
		// unstealable).
		return nil, ErrNoFish
	}
	discard := spendTiles(held, cost) // whole tiles; you cannot make change

	// Visible == the spender on every EvFishSpent: the mix and its value
	// are theirs alone; Tiles carries the public half.
	spent := fishSpentData{Player: cmd.Player, Use: d.Use, Discard: discard,
		Value: fishTotal(discard), Tiles: tileCount(discard)}
	switch d.Use {
	case FishRemoveRobber:
		// Remove the robber from the board; it returns when a player resolves
		// a 7 or plays a Knight. No destination and no steal: every hex
		// produces again until someone rolls a 7.
		//
		// board.OffBoard matches no real hex, so every `h == s.Board.Robber`
		// test answers no, and the ordinary post-7 move brings it back (any
		// land hex differs from OffBoard, so "move it to a new hex" needs no
		// special case).
		return []engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player),
			engine.NewEvent(engine.EvRobberMoved,
				engine.RobberMovedData{Player: cmd.Player, Hex: board.OffBoard})}, nil

	case FishSteal:
		// *d.Victim < 0 guards against a negative seat index slipping past
		// the upper-bound check. DiscardableCount is module-aware: a victim
		// holding only Knights commodities is still a valid target.
		//
		// FriendlyRobberProtected applies as for every other steal
		// (robberVictims, the pirate, Bishop): a seat at its starting public
		// score cannot be stolen from by any effect.
		if d.Victim == nil || *d.Victim < 0 || *d.Victim == cmd.Player || int(*d.Victim) >= len(s.Players) ||
			s.DiscardableCount(*d.Victim) == 0 || s.FriendlyRobberProtected(*d.Victim) {
			return nil, engine.ErrBadVictim
		}
		spentEv := engine.NewEvent(EvFishSpent, spent, cmd.Player)
		// As with the base robber: a module (Knights) may steal from the
		// combined resource+commodity pool, otherwise take a random resource.
		// StealCardFromModules is the shared entry point for every "take one
		// random card" effect. The steal is at batch index 1 (after
		// EvFishSpent), so the RNG offset is 1, matching NextSeq+1.
		if ev, ok := engine.StealCardFromModules(s, cmd.Player, *d.Victim, 1); ok {
			return []engine.Event{spentEv, ev}, nil
		}
		res, ok := engine.RandomCard(engine.RngFor(s, 1), s.Players[*d.Victim].Hand)
		if !ok {
			return nil, engine.ErrBadVictim
		}
		return []engine.Event{spentEv,
			engine.NewEvent(engine.EvCardStolen, engine.CardStolenData{Thief: cmd.Player, Victim: *d.Victim, Res: res},
				cmd.Player, *d.Victim)}, nil

	case FishTakeResource:
		if d.Res < board.Wood || d.Res > board.Ore || s.Bank[d.Res] < 1 {
			return nil, engine.ErrNoResources
		}
		spent.Res = d.Res
		return []engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player)}, nil

	case FishFreeRoad:
		// The road is granted as a credit (Apply bumps s.FreeRoads), as Road
		// Building does, and the player places it with a normal build command.
		// The edge here must be a placement the seat could legally make now,
		// which also guarantees the credit is usable (the seat is mid-turn per
		// RequireActionableTurn) and refuses a spend that buys nothing.
		//
		// Under Islands a ship counts too: the combination rule lets 5 fish
		// build a ship, and the shared FreeRoads credit is already spendable on
		// one (islands/decide.go). LegalRoads is the authority for road edges
		// (what decideBuild accepts, empty when no road pieces remain), and the
		// module's LegalExtras for ship edges.
		if d.E == nil {
			return nil, engine.ErrBadCommand
		}
		if e := board.NewEdge(d.E.A, d.E.B); !slices.Contains(s.LegalRoads(cmd.Player), e) &&
			!legalModuleShip(s, cmd.Player, e) {
			return nil, engine.ErrBadPlacement
		}
		spent.GrantRoad = true
		return []engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player)}, nil

	case FishRiderHurry:
		// Raiders' substitute for the rung the missing robber takes away. The
		// module that owns riders validates the move, before any tile is spent.
		if d.From == nil || d.To == nil {
			return nil, engine.ErrBadCommand
		}
		ev, ok, err := engine.FreeRiderHurryFromModules(s, cmd.Player, *d.From, *d.To)
		if !ok {
			return nil, ErrSpendUnavailable
		}
		if err != nil {
			return nil, err
		}
		return []engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player), ev}, nil

	case FishWagonBoost:
		ev, ok, err := engine.FreeWagonBoostFromModules(s, cmd.Player)
		if !ok {
			return nil, ErrSpendUnavailable
		}
		if err != nil {
			return nil, err
		}
		return []engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player), ev}, nil

	case FishBridge:
		// The six-fish rung, only alongside Rivers: 6 fish build a bridge at no
		// other cost. A whole-tile spend like every rung, and the bridge still
		// pays its 3 coins (coins pay for the placement, not its cost).
		//
		// The placement rules belong to the bridge module, reached through
		// engine.FreeBridgeFromModules. Refused before the tiles are spent, as
		// with the five-fish road.
		if d.E == nil {
			return nil, engine.ErrBadCommand
		}
		ev, ok, err := engine.FreeBridgeFromModules(s, cmd.Player, board.NewEdge(d.E.A, d.E.B))
		if !ok {
			return nil, ErrSpendUnavailable
		}
		if err != nil {
			return nil, err
		}
		return []engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player), ev}, nil

	case FishDevCard:
		// A scenario deck first, when the ruleset has one: its cards resolve on
		// the spot rather than going to a hand, so the draw can be several
		// events.
		if engine.HasScenarioCards(s) {
			evs, ok := engine.DrawScenarioCard(s, cmd.Player, 1)
			if !ok {
				return nil, engine.ErrDeckEmpty
			}
			return append([]engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player)}, evs...), nil
		}
		if s.DevDeck.Count() == 0 {
			return nil, engine.ErrDeckEmpty
		}
		card := engine.DrawDevCard(s, 1)
		return []engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player),
			engine.NewEvent(engine.EvDevCardBought, engine.DevCardBoughtData{Player: cmd.Player, Card: card, Free: true},
				cmd.Player)}, nil

	case FishProgressCard:
		// The seven-fish rung under Knights: one progress card of the player's
		// choice (other progress draws are dealt by the event die), so the deck
		// is named in the command. An empty deck is refused rather than paid
		// for; Knights decks run out and are not reshuffled.
		if d.Deck < 0 || d.Deck >= engine.ProgressDeckCount(s) {
			return nil, engine.ErrBadCommand
		}
		// Offset 1: the draw is at batch index 1, behind EvFishSpent, as for the
		// three-fish steal.
		ev, ok := engine.DrawProgressCardFromModules(s, cmd.Player, d.Deck, 1)
		if !ok {
			return nil, engine.ErrDeckEmpty
		}
		return []engine.Event{engine.NewEvent(EvFishSpent, spent, cmd.Player), ev}, nil
	}
	return nil, engine.ErrBadCommand
}

// legalModuleShip reports whether e is a ship edge seat could build on now,
// asking the modules what the client's ship picker asks. engine/islands
// publishes its buildable sea edges through LegalExtras and other rulesets
// publish none, so this package need not know what a ship is.
func legalModuleShip(s *engine.State, seat engine.PlayerID, e board.Edge) bool {
	for _, m := range s.Modules() {
		h := m.Hooks().LegalExtras
		if h == nil {
			continue
		}
		if slices.Contains(h(s, seat).Ships, e) {
			return true
		}
	}
	return false
}

// SpendTiles is spendTiles for callers outside the module: the bot.
//
// The bot prices the 3-fish steal and the 7-fish card by expectation rather than
// simulation (both resolve a draw inside Decide), so they bypass
// decideSpendFish. It needs the same tiles the engine would take, so it calls
// this rather than re-deriving the choice.
//
// Returns false when the held tiles cannot cover the cost, which an outside
// caller may hit (decideSpendFish checks first).
func SpendTiles(held [3]int, cost int) ([3]int, bool) {
	if fishTotal(held) < cost {
		return [3]int{}, false
	}
	return spendTiles(held, cost), true
}

// spendTiles chooses which held tiles to discard to cover cost, minimizing
// wasted fish first and tile count second (you cannot make change, so any
// overpayment is lost).
func spendTiles(held [3]int, cost int) [3]int {
	best := [3]int{}
	bestWaste, bestCount, found := 1<<30, 1<<30, false
	for c := 0; c <= held[2]; c++ {
		for b := 0; b <= held[1]; b++ {
			for a := 0; a <= held[0]; a++ {
				sum := a + 2*b + 3*c
				if sum < cost {
					continue
				}
				waste, count := sum-cost, a+b+c
				if waste < bestWaste || (waste == bestWaste && count < bestCount) {
					bestWaste, bestCount, found = waste, count, true
					best = [3]int{a, b, c}
				}
			}
		}
	}
	if !found { // caller guarantees enough fish; defensive
		return held
	}
	return best
}

func (Fishermen) decideGiveBoot(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	x := fishExtRO(s)
	if x.BootHolder != cmd.Player {
		return nil, engine.ErrBadCommand
	}
	d, err := engine.DecodeCommand[struct {
		To engine.PlayerID `json:"to"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.To < 0 || d.To == cmd.Player || int(d.To) >= len(s.Players) {
		return nil, ErrBootRecipient
	}
	// PublicVPWithModules (not PublicVP) so module VP (Caravans points,
	// Islands discovery chips) counts toward "doing at least as well", as
	// the win check does.
	if s.PublicVPWithModules(d.To) < s.PublicVPWithModules(cmd.Player) {
		// Not ErrBadVictim: nothing is stolen. The boot is a handicap handed on.
		return nil, ErrBootRecipient
	}
	return []engine.Event{engine.NewEvent(EvBootGiven, bootData{Player: d.To})}, nil
}

func (Fishermen) Apply(s *engine.State, e engine.Event) (bool, error) {
	x := fishExt(s)
	switch e.Type {
	case EvFishCaught:
		applyCaught(x, engine.DecodeEvent[fishCaughtData](e))
	case EvFishGained:
		// A redacted copy carries only {player}, so Gain decodes as zeros and
		// the fold leaves the mix alone.
		applyGain(x, engine.DecodeEvent[fishGainData](e))
	case EvBootGiven:
		x.BootHolder = engine.DecodeEvent[bootData](e).Player
	case EvFishSpent:
		d := engine.DecodeEvent[fishSpentData](e)
		x.ensureTiles()
		for v := range 3 {
			x.Held[d.Player][v] -= d.Discard[v]
			x.Used[v] += d.Discard[v]
		}
		// Tiles is the public half of the spend; Discard and Value are
		// redacted for everyone but the spender. Where the discard is present
		// (the spender's stream, the server's truth), the count is reconciled
		// against Held instead, as in applyGain, which also repairs logs that
		// published a spend's value but no tile count.
		if p := int(d.Player); p < len(x.Tiles) {
			if d.Discard != ([3]int{}) {
				x.Tiles[p] = tileCount(x.Held[p])
			} else {
				x.Tiles[p] -= d.Tiles
			}
		}
		if d.Use == FishTakeResource {
			var h engine.Hand
			h[d.Res] = 1
			s.Players[d.Player].Hand.Add(h)
			s.Bank.Sub(h)
		}
		if d.GrantRoad {
			s.FreeRoads++
		}
	default:
		return false, nil
	}
	return true, nil
}

// ViewExt publishes per-seat fish tile counts, the boot holder and the fishing
// grounds. What the tiles are worth goes only to the viewer, as their own mix.
//
// Every map and slice is copied out of the live ext: the view is serialised
// later on a connection goroutine while the actor may fold the next command
// into this ext, and a shared map is a fatal concurrent map access. game/views.go
// copies the base State's fields for the same reason.
func (e *FishExt) ViewExt(viewer engine.PlayerID) any {
	// Published from Tiles, not Held: a redacted fold cannot know another
	// seat's Held, while Tiles folds from public halves. On the server they
	// agree. No per-seat value is published, since next to the count it
	// would name the tiles (see FishExt.Tiles).
	//
	// ViewExt must not write, so a short Tiles is covered by the same
	// fallback ensureTiles uses, computed here and discarded.
	tiles := slices.Clone(e.Tiles)
	if len(tiles) != len(e.Held) {
		tiles = make([]int, len(e.Held))
		for p := range e.Held {
			tiles[p] = tileCount(e.Held[p])
		}
	}
	out := map[string]any{
		// Grounds is cloned although nothing writes it after setup (see
		// CloneExt): if that ever changes, sharing it would be a data race.
		"tiles": tiles, "boot_holder": e.BootHolder, "grounds": slices.Clone(e.Grounds),
		// No "boot_in_play": the client renders `boot_holder`, and the boot
		// leaves the supply the moment it has a holder.
		// The lake's four numbers, cloned so a caller cannot mutate the
		// package-level slice.
		"lake_numbers": slices.Clone(LakeNumbers),
		// Every lake and its numbers (derivation 13): from five seats the
		// second lake pays on 4 and 10 only. lake_numbers stays for clients
		// that read only it, and is the first lake's set.
		"lakes": e.viewLakes(),
	}
	// The viewer's own tile mix, and only theirs. Counts are public, but
	// the spend UI needs the mix: no change is given, so paying 2 fish
	// with a 3-tile loses all three, and the client must show that and
	// what is affordable. A spectator (viewer < 0) gets no mix.
	if viewer >= 0 && int(viewer) < len(e.Held) {
		out["mix"] = e.Held[viewer]
	}
	return out
}

// viewLakes copies Lakes out for the view (see ViewExt on aliasing). A legacy
// ext with no Lakes publishes nothing, and the client uses lake_numbers for
// every lake.
func (e *FishExt) viewLakes() []fishLake {
	if e.Lakes == nil {
		return nil
	}
	out := make([]fishLake, len(e.Lakes))
	for i, l := range e.Lakes {
		out[i] = fishLake{Hex: l.Hex, Numbers: slices.Clone(l.Numbers)}
	}
	return out
}

// ViewExtRevealed is ViewExt for a finished game: the spectator view plus every
// seat's tiles under "mixes" (seat-indexed, like "tiles"). See
// engine.RevealedViewable; the only caller is game.NewRevealedReplayView, which
// is reachable only once a game is over. The mix is added here, beside the gate
// it relaxes, so any future per-seat hidden field is listed in one place.
func (e *FishExt) ViewExtRevealed() any {
	// engine.NoPlayer is the same -1 as game.Spectator, which engine/scenarios
	// cannot import; ViewExt's gate is `viewer >= 0`.
	spectator := engine.NoPlayer
	out, ok := e.ViewExt(spectator).(map[string]any)
	if !ok {
		return e.ViewExt(spectator)
	}
	out["mixes"] = append([][3]int(nil), e.Held...)
	return out
}

// FinishBoard guarantees the board still has a lake once every other module has
// had its turn with it.
//
// SetupBoard floods the deserts, which is enough on a base board, but in
// canonical order Islands then carves the outer ring and can drown the lake. With
// no lake the four lake numbers never pay. FinishBoard runs after the carve, so
// the survey here is accurate (the same reasoning as Caravans.FinishBoard).
//
// Steps, in order:
//  1. Flood any desert that reappeared. Caravans.FinishBoard may promote a hex
//     to desert after our SetupBoard ran ("caravans" sorts first), and a
//     Fishermen board should not have a dry desert. This also makes the hook
//     idempotent.
//  2. If nothing neutral survived, promote an interior producing hex to lake
//     (interior so a ring carve cannot take it, whichever finisher runs first).
//  3. Move every lake off a hex another module reserved (engine.ReservedHexes:
//     the Wagons trade-hex candidates). See keepLakesOffReserved.
//
// With Caravans, one tile is spent in either order: Caravans first makes a desert
// that step 1 floods (and freshCaravans finds the oasis on the lake); Fishermen
// first makes a lake that Caravans accepts. The oasis and lake are one hex.
// Promotion deletes a producing tile and its token after generation (see
// Caravans for the cost), so it fires only when the lake would otherwise be
// missing.
//
// Only engine-dealt tiles move (dealtTerrain, as in Caravans.FinishBoard): a hex
// the author left as blank generic land is the engine's, a pinned terrain or
// token is the author's, and presets pin everything. Every lobby game supplies a
// board, so whether one was supplied decides nothing.
func (Fishermen) FinishBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {
	dealt := dealtTerrain(cfg)
	hexes := board.HexesInRadius(b.Radius)
	lake := false
	for _, h := range hexes {
		t, ok := b.Tiles[h]
		if !ok {
			continue
		}
		switch t.Res {
		case board.ResNone:
			// A desert the author placed stays a desert. One the engine dealt into
			// a hole they left is ours to flood, as SetupBoard would have done
			// after the carve.
			if !dealt(h) {
				continue
			}
			b.Tiles[h] = board.Tile{Res: board.Lake}
			lake = true
		case board.Lake:
			lake = true
		default: // every other terrain is somebody else's
		}
	}
	defer keepLakesOffReserved(b, cfg, dealt)
	if lake {
		return
	}
	// oasisSites suits here too: interior, and able to start three
	// caravans, which the composed base+caravans+fishermen board needs
	// since this lake becomes the oasis. Drawn from the seed rather than
	// first in board order, so the lake (and the robber's opening hex) is
	// not on the same tile of every board.
	sites := dealtOnly(oasisSites(b), dealt)
	if len(sites) > 0 {
		h := sites[rng.IntN(len(sites))]
		b.Tiles[h] = board.Tile{Res: board.Lake}
		// There was no neutral hex a moment ago, so the robber is on producing
		// land; give it the new non-producing hex rather than leave a corner
		// dark. Never to a robber already beside the board: SetupBoard puts it
		// there in every Fishermen game, and the lake would be the worst place
		// to return it now that it blocks the catch.
		if b.RobberOnBoard() && !b.RobberNeutral(b.Robber) {
			b.Robber = h
		}
	}
}

// keepLakesOffReserved swaps every engine-dealt lake off a hex another module
// will claim (engine.ReservedHexes: the Wagons trade-hex candidates, every
// cape) onto the nearest interior hex that can take it.
//
// The generator deals the desert anywhere, capes included, and Wagons would then
// make the lake a trade hex. Vetoing lakes from the candidates alone
// (TradeHexAllowed) would break the triple's equal legs, so the lake moves; the
// veto remains for a desert an author pinned on a cape.
//
// A swap, like the Caravans oasis repair, so every resource and token survives.
// The partner is the nearest hex (cube distance, ties by board order) among
// oasisSites (interior, able to start three caravans, which keeps the oasis whole
// under Caravans) that the engine dealt, is not reserved, and has no 6 or 8 (a
// red moving to the ring could sit beside another). Nearest rather than seeded:
// deterministic, and the starting cape is already a seeded outcome.
//
// Pinned lakes and pinned partner tiles never move. A lake with no eligible
// partner stays, and the veto keeps it off the triple.
func keepLakesOffReserved(b *board.Board, cfg engine.GameConfig, dealt func(board.Hex) bool) {
	reserved := engine.ReservedHexes(cfg, b)
	if len(reserved) == 0 {
		return
	}
	for _, h := range board.HexesInRadius(b.Radius) {
		t, ok := b.Tiles[h]
		if !ok || t.Res != board.Lake || !reserved[h] || !dealt(h) {
			continue
		}
		best, bestD, found := board.Hex{}, 0, false
		for _, c := range oasisSites(b) {
			if !dealt(c) || reserved[c] {
				continue
			}
			if n := b.Tiles[c].Number; n == 6 || n == 8 {
				continue
			}
			if d := hexDistance(h, c); !found || d < bestD {
				best, bestD, found = c, d, true
			}
		}
		if found {
			b.Tiles[h], b.Tiles[best] = b.Tiles[best], b.Tiles[h]
		}
	}
}

// hexDistance is the cube distance between two hexes.
func hexDistance(a, c board.Hex) int {
	return hexRing(board.Hex{Q: a.Q - c.Q, R: a.R - c.R})
}
