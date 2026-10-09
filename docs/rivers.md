# Rivers

The Rivers scenario (`engine/rivers/`, ruleset part `rivers`). The rules are in
[rules/rivers.md](rules/rivers.md), which is the source of truth; this document
covers how the implementation is shaped.

The watercourse is derived from whatever board the generator dealt, the way
Fishermen derives its fishing grounds and Caravans its oasis, so the scenario
needs no fixed board.

## What the module adds

- **Swamp** (`board.Swamp`, wire name `"swamp"`), a non-producing land hex at
  each river's mouth. It takes no number token, produces nothing and may hold
  the robber, like the desert; every predicate that treats the desert as a
  harmless place to stand treats a swamp the same way.
- **Bridge sites**, the edges a channel crosses. They hold a bridge or nothing:
  never a road, never a ship.
- **Bridges**, 3 per player, 2 brick + 1 lumber, one segment of the longest
  route, 0 VP, never removed and never bought by a free-road effect.
- **Coins**, a public per-seat count that is not a card: outside the hand limit,
  never discarded on a 7, unstealable, and untouched by Monopoly and by every
  Knights progress card.
- **The Wealthiest Settler (+1) and Poorest Settler (-2) tiles**, re-derived
  from the coin counts after every change.

## The derivation runs twice, and both runs must agree

Everything in `engine/rivers/board.go` is shaped around this.

`FinishBoard` derives the chains and paints the board from them: mountains at
the source end of each (by swapping terrain with a same-pip mountains hex, so
the number tokens never move), a swamp at the estuary end with its token
discarded, and every hex between left as dealt, forest and fields included. On
a fair-mode board it then rebalances the dealt number tokens
(`board.Rebalance`), because painting after the solver otherwise pulls most
boards out of the fair band (see "Painting the chain" in
[rules/rivers.md](rules/rivers.md)). It also routes round every hex another
module reserves (`engine.HexReserver`: the Wagons trade-hex candidates).
`InitExtBoard` then derives the chains again, from the painted board, and that
second answer is what `EvBoardGenerated` records and what a replay folds (see
`engine.ExtBoardInitializer`). So the derivation must be invariant under its
own painting, or a game is recorded with a layout its board was not painted
for.

Everything it reads is invariant by construction: hex eligibility is the land
mask minus a fixed exclusion set (sea, border, desert, lake, gold) and minus
the reserved hexes (a function of the land mask), and painting creates a swamp
(eligible), swaps producing terrain between two eligible hexes and moves number
tokens, without creating or destroying a desert, a lake or a gold hex. Length,
non-self-adjacency, the estuary's coastal test, the outer-edge rule, the
scoring and the candidate order are all positional. The generator is minted
fresh from one reserved slot, so identical candidate lists take identical
draws. Nothing in the derivation reads terrain beyond the eligibility mask, and
because the chain is directed (source to estuary) the mouth is always the last
hex.

`rivers.TestDeriveRiversIsPure` covers both halves, and
`ruletest.TestRecordedLayoutRoundTripsExactly` covers the consequence.
`deriveBoardExt` must build its scratch state with the game's real seeds: with
`engine.Empty()`'s zero seed the recorded layout would disagree with the
painted board.

## The reserved stream slots

`State.New` hands every `FinishBoard` a generator at position 3, minted once per
module, so two finishers there draw the identical sequence. Caravans and
Fishermen get away with that because both draw only when they repair something.
Rivers draws on every board, so it names its own slot through
`engine.BoardFinisherSlot`: `engine.RiversBoardSeq`, `-4000000`, registered in
`engine/seeds.go` beside the other public reservations and checked by
`TestPublicSlotsDoNotCollide`. See [dice.md](dice.md) and the
`BoardFinisherSlot` section of [engine.md](engine.md).

A second slot, `engine.RiversVariantSeq` (`-4000001`), picks which of the two
authored east-west meanders each straight hex draws. It is separate so that
adding a meander later does not move every watercourse.

The watercourse is a derivation every player can see and `verify/` reproduces
it, so any change to it bumps `engine.DerivationVersion`; a game recorded under
an earlier build then reports as unauditable rather than as rigged.

## The chain search and its bounds

Chains are enumerated by a depth-first walk with a branching factor of at most
three (non-self-adjacency forbids the arriving hex and its two shoulders), over
an index-addressed copy of the board rather than maps, which keeps an 8-player
board in single-digit milliseconds. Only the best-scoring candidates are kept:
the seeded pick chooses among the longest chains with the farthest-apart ends,
so a worse candidate is dead as soon as a better one is found.

Two bounds, both recorded as Decisions in [rules/rivers.md](rules/rivers.md):

- **The length cap descends when the board cannot fit its rivers.** Chains are
  chosen longest first and each blocks every hex it touches, so two eleven-hex
  rivers on a radius-4 board can eat the coast the third one needed. The whole
  derivation is re-run with a shorter cap until every river fits; this is cheap
  because the search is exponential in the cap.
- **A node budget of 16 million across the whole derivation**, about four times
  the worst radius-4 board seen (1,538,940 over 200 boards per radius), plus a
  hard ceiling of 11 on chain length however large the board.
  `board.MaxRadius` is 16 and `POST /api/replay/frames` folds a config the
  caller chose, so an unbounded search would be reachable from an HTTP body.

## The shape set

A river hex's channel is named by a shape id, published per hex in `ViewExt`:
the two mouth directions in the board frame, sorted by direction index. There
are nine two-mouth shapes (`e_w`, `ne_sw`, `nw_se` straight; `ne_w`, `e_nw`,
`e_sw`, `w_se`, `ne_se`, `nw_sw` bent 120 degrees) and six one-mouth headwaters
(`src_e` through `src_se`). `{SW, SE}` maps to nothing: it is a 60 degree
hairpin like the other five, and no tile could be authored for it.

The engine names the shape and the renderer picks the file; there is no yaw
solver between them. `layers/chips.ts` mounts every number chip at one fixed
tile-local spot without turning it, so a yawed tile would run the water through
the number. With a file per shape, a river tile is laid at the board's own
facing like every other tile. A mouth on either edge beside the chip sits 1.500
from the chip mount against a keep-clear of 1.05 plus half the 0.42 water, so
channels need no restriction near the chip.

The set is 67 files: nine shapes for each of six terrains (mountains, hills,
pasture, forest, fields, swamp), a second east-west meander per terrain, six
mountains-only headwaters, and the plain marsh. There is no fallback for a
missing tile; `layers/rivers.test.ts`'s "the art owed is nothing" test fails if
one is missing.

Which east-west meander a hex draws is a derivation, not a rendering choice:
one draw per east-west hex off `engine.RiversVariantSeq`, recorded in the board
event and reproduced by `verify/`. Players can see it, so it belongs in the
audit rather than in a renderer-side hash.

## Coins are paid by diffing the board

`engine/rivers/module.go`'s `afterEvents` walks every river edge and river
vertex, asks who holds it now, and compares that with who was paid for it last
time. The spec's payment rules follow from that:

- a piece placed for free still pays (the coin is for the placement, not the
  cost);
- an Islands ship moving off a river edge refunds its coin and one moving onto
  another earns one, so a move between two is coin-neutral;
- a settlement upgraded to a city pays nothing, because its vertex is already
  paid for, while the Knights round-2 setup city, on a vertex nobody has paid
  for, pays as a settlement does;
- the Knights Diplomat's road removal takes its coin back and its rebuild earns
  a fresh one, without this module knowing that card exists.

This keeps the package from naming `engine/islands`' ship events or
`engine/knights`'s Diplomat events; no module imports another.

Each payment names the edge or vertex it was made for, on the event. A replay
never runs a reaction hook, so a ledger kept only where it is computed would be
empty after a restore and the next live command would pay every piece again.
`Apply` folds the position, so the log reproduces the ledger.

The hook is `AfterEvents` rather than `OnEvents` because it also runs during
setup, where the first coins are earned, and because it runs after every
module's `OnEvents`, which a standing re-derived from other modules' work
needs.

## Edges a module closes

`OccupiesEdge` means "my piece is standing here". A bridge site is empty and
permanently shut, which needs a different seam: `Hooks.RefusesEdge` returns the
module's own error so the player is told "a river crosses that edge" rather
than "that spot is taken". The base road build, the setup connector,
`LegalRoads`, the auto-mover's `LegalSetupRoads`, Islands' ship-placement choke
point and the Diplomat's relocation all ask it. Offers must filter on it too, or
the auto-mover proposes a road the engine refuses and the setup draft stalls.

`Hooks.RefusesRouteMove` is the same seam for a move, which is not two builds
and cannot be priced as one. See [engine.md](engine.md).

`Hooks.RouteEdgeKind` is the third. `RouteEdge` answers "whose piece is on this
edge", which is enough to walk a route but not to decide whether a road is
open at a vertex. A road and a ship join only through the owner's own
building, so a ship at the end of a road leaves it open; a bridge is a road
segment, so it closes it, and the Knights Diplomat frees an open road.

## Knights

Knights cross bridges, because `knights.touchesOwnRoute` walks `ModuleRouteEdge`
and a bridge answers it. Intrigue reaches a knight on a vertex a bridge of
yours touches by the same accessor. The Diplomat's 1-coin road refund comes
from the coin ledger being a diff against the board. The Diplomat may not
relocate a road onto a bridge site; the test for that plays the card rather
than asserting the predicate.

## Bots

`bot/rivers.go`. Strong offers bridges and both coin conversions as candidates
priced by the same evaluator as every other action (the wealth tiles price
themselves through `PublicVPWithModules`), plus a linear hold term for coins at
half a resource card, the rules' exchange rate. That weight is not tuned by
self-play: identical bots tie on coins, a tie awards no Wealthiest Settler, and
a ladder would price the tiles at zero.

Simple gets a deterministic minimal policy so the adversarial ledger in `sim/`
sees all three commands: convert coins into the card a build is short of, take
a bridge when it can pay for one, and turn a genuine surplus into coins. Every
branch is bounded, which keeps it out of the livelocks `bot/simple.go`
describes.

## Composition

- **The 5-coin buyout of a city about to be pillaged** is the Knights
  `pillage_buyout` command (`engine/knights`).
- **The Fishermen six-fish bridge** goes through `Hooks.FreeBridge` to
  `rivers.BuildBridgeFree`, which produces a bridge that pays its 3 coins.
- The Wagons and Raiders adjustments (a bridge pays 2 coins, and the Poorest
  Settler tile is not used) are keyed on the ruleset name.
