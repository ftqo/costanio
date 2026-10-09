package engine

import "math/rand/v2"

// Seeds are the two independent seeds a game runs on. Only Public is needed to
// re-derive everything a player saw, so revealing it proves the visible game was
// fair while Private keeps the cards secret until the game is over. See
// docs/dice.md and verify/.
//
// They must be drawn independently: equal values would make the private stream
// derivable from the public one at any shared seq.
type Seeds struct {
	// Public drives every outcome visible at the table: dice (both modes), the
	// fair-dice deck, the event die, board generation, seat order.
	Public uint64
	// Private drives hidden outcomes: robber steals, dev and progress card
	// draws, and server auto-moves.
	Private uint64
}

// DerivationVersion identifies the published derivations this build uses: board
// generation, every module board hook, and the public stream slots (dice, fair
// deck, seat shuffle, event die and the rest). It is stamped into game_created,
// and verify/ reports a game stamped with a version this build does not implement
// as unauditable rather than failed (as it does for pre-migration-0030 games; see
// docs/dice.md).
//
// Any change to a player-visible derivation must bump this in the same commit.
// TestDerivationFingerprint in verify/derivation_test.go pins every derivation's
// output for this version and fails, naming this constant, when the output moves
// without the number. verify/ implements only the current version (see
// verify/README.md). The version names the build's whole set of derivations, so
// it moves for every ruleset even when only one ruleset's boards change.
//
// What each version changed:
//   - 3: Islands carves a channel, so procedural Islands boards have 2-4
//     islands instead of one landmass.
//   - 4: the fishing grounds and the Caravans oasis and spokes join the audit;
//     the Fishermen old boot moves to a public slot (FishBootSeq); the Fishermen
//     robber starts beside the board instead of on the lake.
//   - 5: the Rivers watercourse (on its own slot, RiversBoardSeq), the Raiders
//     castle, coastline and starting raiders, and the Wagons trade hexes and
//     barbarians (WagonsBoardSeq).
//   - 6: Rivers channels keep clear of number chips, so chains step only east
//     and west, with a length floor of 3.
//   - 7: Rivers reverts 6 (the real chip problem was the renderer's yaw): all six
//     steps open, chains run source to sea with n bridge sites, the length-3
//     floor is gone, and RiversVariantSeq picks the east-west meander.
//   - 8: Raiders restores a productive interior refuge while preserving outer
//     islands, extending and re-framing small carved boards when needed.
//   - 9: Raiders and Wagons share a population, initially at two trade hex
//     centres; trade sites stay on the mainland outside the riders castle.
//   - 10: Caravans starts the robber beside the board, not on the oasis.
//   - 11: Rivers routes round Wagons trade-hex candidates (engine.HexReserver);
//     painting keeps the channel's dealt terrain, swaps only the headwater for
//     equal-pip mountains, and fair boards are rebalanced (board.Rebalance);
//     the Caravans oasis is never a Wagons trade hex.
//   - 12: Wagons slides harbours off a cape's sea-only corners; fishing-ground
//     numbers are shuffled on FishGroundsSeq; Fishermen vetoes a lake from the
//     Wagons trade candidates; the Raiders castle avoids river and reserved
//     hexes; Caravans spokes and Wagons barbarian homes use board.LandEdge, so
//     no caravan starts on a strait under Islands.
//   - 13: 5-10 seat scenario content and one Islands fix. Fishermen places
//     eight grounds at 5-6 seats and ten at 7-10 (with a thin-first fallback in
//     deriveGrounds); lakes are dealt numbers on FishLakesSeq (one on 2, 3, 11,
//     12, the rest on 4 and 10; all four at 2-4 seats). Caravans plays two oases
//     at 5-6 seats and three at 7-10 (oasesClash, tab.fillOases, then
//     board.Rebalance on fair boards). Fair Islands boards are rebalanced at the
//     end of the carve. The Fishermen setup bonus draws for a second settlement
//     by a ground or lake and can turn up the boot on FishBootSeq; the boot's
//     notional supply grows with the table (30, 44, 58).
const DerivationVersion = 13

// seatOrderSeq reserves a public stream slot for the lobby's turn-order shuffle.
//
// This comment is the registry of public slots; a new public stream adds itself
// here in the same change, and TestPublicSlotsDoNotCollide (seeds_test.go) checks
// they are disjoint:
//   - dice: s.NextSeq (0 and up)
//   - board generation: 1 (generation/preset), 2 (SetupBoard), 3 (FinishBoard;
//     see State.newBoard)
//   - fair-dice deck: -(epoch+1), one per 36 rolls
//   - seat shuffle: -1000000
//   - Knights event die: -2000001 down, one per roll (EventDieSeq)
//   - Fishermen old boot: -3000001 down, one per roll (FishBootSeq)
//   - Rivers: -4000000 and -4000001
//   - Wagons drive-off die: -5000001 down, one per event (WagonsDieSeq)
//   - Raiders: -6000001 down, one per event (RaidersSeq)
//   - Wagons board: -7000000
//   - Explorers board block: -8000000 to -8000005
//   - Explorers dice: -9000001 down, one per event (ExplorersDieSeq)
//   - Fishermen grounds and lakes: -10000000, -10000001
//
// Runs are a million apart, far more rolls or events than a game can reach under
// the event cap; the fair deck reaches -1000000 only after ~36 million rolls.
const seatOrderSeq = -1_000_000

// boardFinishSeq is the shared public slot every BoardFinisher reads unless it
// reserved its own.
const boardFinishSeq = 3

// RiversBoardSeq is the public slot the Rivers watercourse derivation reads.
//
// Every FinishBoard hook gets a fresh rngFor(publicSeed, boardFinishSeq), so
// finishers sharing that slot draw identical numbers. Caravans and Fishermen get
// away with it because both draw only on a rare repair. Rivers draws on every
// board, so sharing would tie the oasis repair to the first river's choice.
//
// One slot, not a run: the derivation reads one generator once, at board time.
const RiversBoardSeq = -4_000_000

// RiversVariantSeq is the public slot for the Rivers tile variant: which of the
// two authored east-west meanders each straight hex draws.
//
// Separate from RiversBoardSeq so that adding a meander does not consume numbers
// the chain choice reads and move every watercourse. It is public and audited
// because the choice is recorded in EvBoardGenerated's ext blob and players see
// it.
const RiversVariantSeq = -4_000_001

// eventDieSeqBase anchors the Knights event die's own descending run of public
// stream slots. EventDieSeq is what reserves them.
const eventDieSeqBase = -2_000_000

// EventDieSeq is the public slot for the Knights event die drawn with the roll at
// log position nextSeq.
//
// It descends from a large negative base because a small positive offset collides
// with the dice: at NextSeq+11 the event die equalled die1-1 of whichever roll
// later landed at that seq. Both are public, but one public draw must not predict
// another. Changing this derivation makes every Knights game under the old one
// unauditable.
func EventDieSeq(nextSeq int) int { return eventDieSeqBase - nextSeq }

// fishBootSeqBase anchors the Fishermen old boot's own descending run of public
// stream slots. FishBootSeq is what reserves them.
const fishBootSeqBase = -3_000_000

// FishBootSeq is the public slot for the Fishermen old-boot draw made with the
// roll at log position nextSeq.
//
// It must be public: tab_fish_caught names the seat that gets the boot, and
// holding it raises that seat's win threshold, so players must be able to
// re-derive it. (A private fixed offset also collided with baseAutoCommand's
// public setup pick; see TestPrivateSlotsDoNotCollide.) One slot per roll is
// enough because a catch resolves in OnDiceRolled, so at most one boot draw exists
// per roll.
func FishBootSeq(nextSeq int) int { return fishBootSeqBase - nextSeq }

// raidersSeqBase anchors the Raiders scenario's own descending run of public
// stream slots. RaidersSeq is what reserves them.
const raidersSeqBase = -6_000_000

// RaidersSeq is the public slot for a Raiders draw made at log position nextSeq.
//
// Everything Raiders draws is public: the landing dice and hexes, the loss die,
// the prisoner roll-offs, and development cards, which are revealed and resolved
// on purchase. So there is one run, on this stream.
//
// One slot per produced event, keyed on its log position, because a turn can
// draw several times (a build and an upgrade can each trigger a landing, and a
// sweep can fight several battles). Log positions are unique, so the run cannot
// collide with itself.
func RaidersSeq(nextSeq int) int { return raidersSeqBase - nextSeq }

// WagonsBoardSeq is the one public slot the Wagons board layer reads: which three
// cape hexes become trade hexes when the two alternating triples tie, and which
// role (castle, quarry, glassworks) each takes.
//
// Read once at creation: the answer is recorded in EvBoardGenerated's ext blob and
// the log wins on replay (see wagons.InitExtBoard). Public because the result is
// on the board for everyone to see.
//
// base+rivers+wagons is legal, so this must not equal RiversBoardSeq;
// TestPublicSlotsDoNotCollide checks the registry.
const WagonsBoardSeq = -7_000_000

// wagonsDieSeqBase anchors the Wagons drive-off die's own descending run of
// public stream slots. WagonsDieSeq is what reserves them.
const wagonsDieSeqBase = -5_000_000

// WagonsDieSeq is the public slot for the Wagons drive-off die rolled at log
// position nextSeq. Public because the roll is announced and moves a barbarian
// everyone can see.
//
// One slot per log position rather than per roll, since one movement action can
// roll several drive-off dice; keying on the produced event's position makes the
// slot unique, as RngFor does on the private stream.
func WagonsDieSeq(nextSeq int) int { return wagonsDieSeqBase - nextSeq }

// Explorers reserves a fixed block for its board derivation and one descending
// run for dice rolled outside the production roll.
//
// The block is fixed because each draw happens once, at creation, before the log
// has an event to key on. Each derivation (region split, special hexes, shoal
// numbering, the two number-chit stacks, terrain) gets its own slot so changing
// one does not move the others. SetupBoard gets only one *rand.Rand, so Explorers
// implements BoardSeeder and takes the seed instead.
//
// The registry is flat across the build ("same seq, same draw"), so these must not
// overlap other modules' slots even where engine/compat.go refuses the pairing.
const (
	explorersRegionSeq  = -8_000_000
	explorersSpecialSeq = -8_000_001
	explorersShoalSeq   = -8_000_002
	explorersChitSeqN   = -8_000_003
	explorersChitSeqS   = -8_000_004
	// explorersTerrainSeq deals the pool's terrain and re-deals any desert the
	// generator left on the home island.
	explorersTerrainSeq = -8_000_005
)

// ExplorersBoardSeqs names the fixed block above for the module (in another
// package) and the collision test. The order is the derivation's consumption
// order and is part of the published derivation.
var ExplorersBoardSeqs = struct {
	Terrain, Region, Special, Shoal, ChitNorth, ChitSouth int
}{
	Terrain:   explorersTerrainSeq,
	Region:    explorersRegionSeq,
	Special:   explorersSpecialSeq,
	Shoal:     explorersShoalSeq,
	ChitNorth: explorersChitSeqN,
	ChitSouth: explorersChitSeqS,
}

// FishGroundsSeq is the one public slot the Fishermen board layer reads: which
// fishing ground carries which number. Placement uses no randomness; only the deal
// of numbers does, once per game in freshFish. Recorded in EvBoardGenerated's ext
// blob, so it is read at creation only. Public because the numbers are on the
// board and decide who catches fish.
const FishGroundsSeq = -10_000_000

// FishLakesSeq is the public slot that deals the Fishermen lakes their numbers
// (derivation 13): at five seats and up there is a second lake, and which lake
// gets the four-number set is a draw. One Shuffle of the lakes in board order, in
// freshFish; recorded in the ext blob, so read at creation only.
const FishLakesSeq = -10_000_001

// explorersDieSeqBase anchors the descending run every Explorers die reads from:
// the fishing die, the pirate-chase dice, and the lair battle's dice.
const explorersDieSeqBase = -9_000_000

// ExplorersDieSeq is the public slot for the dice rolled with the event at log
// position nextSeq: the fishing die, pirate-chase dice and lair-battle dice.
//
// One slot per log position rather than per roll, because a Movement phase can
// roll several times, each producing its own event; this is the RngFor scheme and
// makes the seq unique. A resolution needing several dice (a lair battle rolls one
// per involved player) draws them in a defined order from the one generator
// returned here, never one generator per die at a guessed offset.
func ExplorersDieSeq(nextSeq int) int { return explorersDieSeqBase - nextSeq }

// SeatOrder returns the turn-order permutation for n seats as a deterministic
// function of the public seed, so a finished game's seating can be re-derived.
// The lobby applies it when it closes the table; the engine never calls it.
// It lives here because it is part of the published derivation verify/ reproduces.
func SeatOrder(publicSeed uint64, n int) []int {
	return rngFor(publicSeed, seatOrderSeq).Perm(n)
}

// SeedsFrom expands a single seed into a Seeds pair for the simulator, the board
// and replay dump tools, and tests.
//
// Public is the seed itself, so a dumped board stays the same. Private is a
// SplitMix64 mix of it, so the streams differ and a slot collision cannot hide
// behind Public == Private.
//
// Not for production: the private seed is derivable from the public one here. The
// lobby draws both from crypto/rand (see lobby.newSeeds).
func SeedsFrom(seed uint64) Seeds {
	z := seed + 0x9e3779b97f4a7c15
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return Seeds{Public: seed, Private: z ^ (z >> 31)}
}

// PublicRngForSeed exposes the public stream to packages that reproduce a
// derivation from a bare seed (engine/knights/hooks.go, verify/derivation_test.go).
// It cannot reach the private stream, so callers cannot leak hidden randomness.
func PublicRngForSeed(publicSeed uint64, seq int) *rand.Rand {
	return rngFor(publicSeed, seq)
}
