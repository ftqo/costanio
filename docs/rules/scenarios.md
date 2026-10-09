# Scenarios rules spec (board-independent scenarios)

This file covers **Fishermen** and **Caravans**, the two modules in
`engine/scenarios/`. Rivers, Raiders, Wagons, Explorers and Harbormaster have their own
specifications in this directory. Each module composes according to its
compatibility table; procedural-board adaptations are called out.

## Table sizes (derivation 13)

Component counts step with the table size: each larger bracket adds the same
increment.

| | 2-4 seats | 5-6 seats | 7-10 seats |
|---|---|---|---|
| Fishing grounds | 6: 4, 5, 6, 8, 9, 10 | 8: adds a 5 and a 9 | 10: adds another 5 and 9 |
| Fish tokens (1/2/3) | 29: 11/10/8 | 43: 15/15/13 (adds 4/5/5) | 57: 19/20/18 |
| Lakes | every desert, on 2, 3, 11, 12 | two: one on 2, 3, 11, 12, the second on **4 and 10** | three: one on 2, 3, 11, 12, the others on 4 and 10 |
| Old boot hides among | 30 | 44 | 58 |
| Oases / caravans | 1 / 3 | 2 / 6 | 3 / 9 |
| Camels | 22 | 33 | 44 |

- **7 to 10 is one more step.** The 61-hex board is dealt
  three deserts where the 37-hex board is dealt two, so it gets a third lake and
  a third oasis, and each carries what the second one does: a lake on 4 and 10,
  an oasis with three caravans and eleven camels. The grounds and tokens step by
  the same increment (two grounds on 5 and 9, fourteen tokens as 4/5/5). That
  keeps about one fish token per pip of fish production (30 pips of grounds and
  lake for 29 tokens at 2-4, 44 for 43 at 5-6, 58 for 57 at 7-10), so the supply
  runs out on the same clock at every size.
- **Which lake pays on which numbers is dealt from the seed**
  (`dealLakeNumbers`, public slot `engine.FishLakesSeq`): one Shuffle of the
  lakes in board order, the first of the shuffled order takes 2, 3, 11, 12 and
  every other lake 4 and 10 (taking the first lake in board order would always
  put the four-number lake in the north-west). A map with more lakes than its
  table has lake hexes (an authored map with extra deserts) gives every further
  lake 4 and 10, and at 2 to 4 seats every lake pays on all four.
- **An Islands carve can drown a desert.** Caravans then promotes a producing
  hex for each oasis the table is short (below), so every Caravans board plays
  with its full count (`sim.TestCaravansHasThreeSpokes`). Fishermen does not
  rebuild a second or third lake out of producing land (only the first lake is
  promoted when none survives), so a
  carved Fishermen board may play with fewer lakes. The camel supply follows the
  oases the board actually has (22 plus 11 per oasis past the first); with the
  promotion that is always the table's count on a generated board.
- **Voting at the larger tables is unchanged.** There is no extra build phase
  (see `base.md`), so a camel still follows any turn in which the active player
  built, and the placer chooses among every caravan of every oasis: which oasis
  to start a caravan from, and which caravan to extend with the new camel.

## Fishermen

- A **lake hex replaces the desert** (one lake yields on 2, 3, 11, 12; at five
  seats and up the others on 4 and 10, see "Table sizes") and **six fishing
  grounds** (eight at 5 and 6 seats, ten at 7 to 10) sit on the coast with
  their own numbers **4, 5, 6, 8, 9, 10** (plus the table's extra 5s and 9s),
  shuffled over the grounds (derivation 12: one seeded Shuffle on the public slot
  `engine.FishGroundsSeq`, `dealGroundNumbers`). The shuffle moves numbers, not
  grounds. Each fishing ground touches two or three
  coastal intersections, and those intersections are contiguous: a ground is
  one connected stretch of a sea hex's shore, never scattered corners around
  it. A sea hex whose shore runs along two separated stretches (opposite sides
  of a strait) contributes only one of them, and a notch with fewer than
  two contiguous coastal corners is skipped. **Tie-break (ours):** two
  separated stretches on one hex are always two corners each (a stretch is at
  least two corners and two stretches need two gaps, so 2 + 1 + 2 + 1 fills the
  ring), so "the longer" never decides; the stretch whose first corner has the
  lower index in the hex's clockwise corner order wins. A stretch longer than
  three corners keeps its first three going clockwise, and a sea hex enclosed
  on all six corners keeps corners 0 to 2. All of it is a function of the hex
  and the land mask alone (`shoreRun`; `TestShoreRun` covers every case).
- **One lake per desert.** Every desert the deal produced becomes a lake, so
  the larger tables, which are dealt more than one desert, have more than one
  lake: one at 2 to 4 seats, two at 5 or 6, three at 7 to 10 on a generated
  board (fewer under Islands, whose carve can drown one). Each lake pays on its
  own numbers to its own shore (2, 3, 11 and 12, or 4 and 10: "Table sizes"),
  the robber blocks only the lake it stands on, and under Caravans the oases
  are lakes (every lake the oasis rule takes). No two grounds share a vertex,
  and that spread rule is described in the conformance list. **Component counts
  follow the table** (derivation 13).
  **Generated-board adaptation: a sea hex a harbour's dock stands on is not eligible**
  (`Board.HarborSeaHex`): the dock and the ground's number chip are both drawn
  at that hex's centre and would overlap.
- **The count is not guaranteed.** `deriveGrounds` places as many
  non-overlapping notches as it finds, up to the table's count, and a short
  board is short from the top (a five-ground board has no 10, a four-ground
  board no 9; the numbers it does have are then shuffled over its grounds): the
  spread rule is what keeps two number chips off one settlement spot, and it is
  never relaxed to reach a count.
  **A second walk, when the first falls short (derivation 13, ours).** The walk
  takes three-corner notches first, and on a long straight coast those overlap
  their neighbours, so it keeps every other one and blocks the two-corner
  notches between them, which can leave a larger board short. A second walk
  then takes the thin notches first and may keep a three-corner notch as two of
  its corners (the first two clockwise, else the last two) where the third is
  taken; it is used only when it places more. Both walks keep the spread rule.
  A 2-to-4-seat board never falls short.
  On the current generator every board places the table's full count, Islands
  archipelagos included; `sim.TestFishGroundsCount` asserts it over every
  Fishermen ruleset at 2 to 10 seats, so a board change that shortens a coast
  fails there.
- **The lake is guaranteed** (`Fishermen.FinishBoard`). `SetupBoard` floods
  every desert, which is enough on a base board, but in the canonical order
  Islands runs after Fishermen and its carve can drown a lake standing on the
  outer ring. After
  every module's `SetupBoard`, the finisher floods any desert that reappeared
  (Caravans' oasis repair can make one) and, if no neutral hex survived at all,
  promotes a seeded **interior** producing hex to lake, handing it the robber
  only when the robber is on the board and on producing land (in a Fishermen
  game it is beside the board until the first 7, and not the finisher's to
  bring back). Composed with Caravans the two
  finishers spend one tile between them, in either order, and the lake and the
  oasis are the same hex. A tile the map's author pinned is left alone; a tile
  the engine dealt into a hole they left is the engine's to move, the same line
  `Caravans.FinishBoard` draws (`dealtTerrain`).
- **The lake should not sit on the coast, and we do not model that.** Ideally the
  lake is completely surrounded by land, and no ship is built at it.
  **Decision: a retained variant.**
  The flood converts whatever desert the deal produced, so a desert on the outer
  ring becomes a coastal lake; only the promote-an-interior-hex branch (which
  fires when no neutral hex survives) respects the inner area. This is common:
  most `base+fishermen` boards have a lake touching the sea or the board's edge.
  Reasons for keeping it:
  - Moving the lake inward is a tile swap on most boards, after the fair-board
    solver has balanced the numbers: a producing hex and its token go out to
    the ring. Caravans pays that price because a ring oasis loses a third of its
    scenario; a coastal lake loses nothing, since it pays on its four numbers
    wherever it sits and the fishing grounds are on the sea, not beside it.
  - The swap would reorder three board repairs that already cooperate
    (Caravans' spoke swap, Fishermen's flood, Rivers' eligibility mask, which
    excludes the lake), and every one of them is mirrored in `verify/`.
  - The no-ships-at-the-lake clause is mostly moot here: a lake is not sea,
    Islands ships sit only on edges that border a sea hex (`Board.SeaEdge`),
    so an edge between a lake and a land hex is not sailable. What stays
    unmodelled is a ship on the one edge between a coastal lake and the sea,
    which is legal here.
  If this is ever implemented, it belongs in `Fishermen.FinishBoard` as a swap
  with an interior hex that keeps Caravans' three spokes (`oasisSites`), ported
  to `verify/modules.mjs` under a derivation bump.
- When a fish source's number is rolled, every adjacent **settlement draws one
  fish tile and every city two**, from a shared supply of **1-, 2-, and 3-fish
  tiles** (11/10/8 of each, 29 in all, at 2 to 4 seats; "Table sizes"). If the
  supply plus the spent pile can't cover everyone's draws that roll, no one
  draws (see the conformance list). Spent tiles reshuffle back when the supply
  empties, mid-catch if need be.
- **Setup: a second settlement beside a fish source draws one token**
  (derivation 13): a second settlement adjacent to a fishing ground or lake
  receives a random fish token in addition to its normal starting resources.
  One token however many sources the corner touches; nothing for the
  first settlement; and under Knights or Wagons, where the round-2 placement is
  a city, that city is the second settlement and draws the same one token
  (`setupFishGrant`, run from the base round-2 grant). It is an ordinary draw
  from the supply: the mix is private, and it can turn up the **old boot**,
  whose gate reads the public `engine.FishBootSeq` slot at the placement's own
  log position, which the audit re-derives.
- **The robber blocks the lake, and cannot block a fishing ground.** A robber
  standing on a lake stops the catch on **every one** of its numbers, as it
  stops any other hex. A fishing ground is a marker on **water**, not a
  hex, and the robber may not be placed on water, so grounds are unblockable
  and a robber on the land beside one changes nothing.
- **The robber starts beside the board** and enters play on the first 7 (or on
  the first knight), because the desert the base game parks it on has become
  the lake, and the lake should not open shut off. `board.OffBoard` is the coordinate the engine uses
  for "not on the board": every "is this hex the robber's" test answers no
  while it is there.
- **The scenario changes no victory target.** A Fishermen game is played to the
  base game's **10**, and to whatever the other active modules make it (13 under
  Knights, 12 with Caravans, 13 with Wagons). The old boot is the one thing here
  that moves a finish line and it moves **its holder's**, not the game's: +1 to
  that seat's threshold while it holds the boot, through `WinThresholdDelta`.
  **Decision:** no premium for the fish. They buy things and score nothing, and a
  higher target for a scenario that adds no VP source would just be a longer
  game.
- **Decision: how many tiles you hold is public, what they are worth is not.**
  A seat's tile count is published (`ext.fishermen.tiles`) as its card count
  is; the mix of 1s, 2s and 3s, and therefore the fish value, is sealed to its
  owner. The draw is a function of the public board (published grounds,
  published lake numbers, public buildings), so the count cannot be hidden, and
  publishing the value beside it would reveal the mix by arithmetic
  (`sim.TestFishMixIsNotPubliclyReconstructible`). The old boot's holder is
  public.
- Fish are a side currency (not resources): they don't count toward the hand
  limit and can't be stolen, discarded or **traded**, to the bank or to another
  player. You spend **whole tiles** and cannot make change; overpayment is
  lost. The engine picks which tiles go, least waste first and fewest tiles
  second. Several spends may be made in one turn, but each is **paid
  separately**: you may not pool tiles across two actions.
- **Seven tiles at most.** You may never hold more than seven fish tokens. A
  seat already holding seven draws no more; instead it may **exchange** one of
  its tokens for a fresh one from the supply, once per turn, and then stops
  drawing. The old boot is not a token and does not count toward the seven.
  - **Decision:** the exchange is a "may", but rather than open an interrupt
    for a choice worth at most two fish, the engine takes it exactly when it
    cannot lose value: only a **1-fish tile** is ever handed in, since every
    tile drawn is worth at least one. A seat holding only 2s and 3s declines,
    since the supply's average is about 1.9.
- **Fish spends** (escalating value), on your own turn after rolling:
  - 2 **remove the robber from the board**, with no steal. There is no
    destination to name: the robber leaves play entirely and comes back when
    somebody next resolves a 7 or plays a knight. Refused, before any tile is
    paid, when there is no robber on the board to remove.
  - 3 **steal** a random card from a chosen victim, through the same pool every
    other steal uses (Knights commodities included) and behind the same
    friendly-robber shield.
  - 4 **take a resource** of choice from the bank. A resource, never a
    commodity.
  - 5 **free road**: a credit, placed with an ordinary build. The spend must
    name an edge the seat could legally build on right now, so it can never
    charge five fish for a road with nowhere to go. Under Islands that edge may
    be a **ship** edge as well as a road edge, and the credit buys either. The
    credit is its own purchase: a Road Building card (or, under Knights, the
    progress card) played while it is unspent adds its two roads to it rather
    than replacing it (`TestFishRoadCreditSurvivesRoadBuilding`).
  - 7 **free development card**, or, in a ruleset with no development deck,
    **one progress card of the discipline you name**.
- **The old boot**: one tile is the old boot (modelled as a seeded gate over the
  supply rather than a 31st tile; it surfaces with a catch and goes to one of
  that roll's drawers, weighted by draws). Its holder is revealed and, *after
  rolling*, may pass it to any player with at least as many public VP, module
  VP included (a sole leader must keep it). The boot is **not** a victory
  point: while you hold it you need **one extra VP to win**. That is a +1 on
  whatever the game's target is (11 in a plain Fishermen game, 13 under
  Caravans, 14 under Knights).
- **The fishing grounds and the lake are placed by derivation.** See the
  conformance list below.

## Compatibility: Fishermen

The lobby enforces this table; `engine/compat.go` is the resolved matrix and
`engine/compat_test.go` holds the two to each other.

| With | Allowed | Notes |
|---|---|---|
| Islands | Yes | Five fish buy a road **or a ship**; the grounds follow whatever coast the carve leaves, and the lake is guaranteed to survive it (`Fishermen.FinishBoard`). |
| Knights | Yes | The 7-fish rung becomes one progress card of your choice, and the 2-fish removal waits for the first barbarian landing. Both are above. |
| Caravans | Yes | The two scenarios share this file and compose without changes: the lake and the oasis are the same hex, and one producing tile pays for both. |
| Rivers | Yes | A **6-fish bridge** joins the spend table between the 5-fish road and the 7-fish card. See `rivers.md`. |
| Raiders | Yes | There is no robber, so the 2-fish removal is refused (it costs nothing to try). A rider move substitutes for it: two fish pay for one rider's five-path hurry instead of the grain. See `raiders.md`. |
| Wagons | Yes | Two fish stand in for the wagon's grain boost, and the pairing plays to 13. **The lake is never a trade hex:** the finisher swaps an engine-dealt lake off every hex Wagons reserves, and Fishermen vetoes lakes from the trade candidates for a desert an author pinned on a cape. See `wagons.md`, "Fishermen". |
| Harbormaster | Yes | Nothing in either touches the other: fish are not victory points and a ground is not a harbour. |
| Explorers | **No** | Explorers deals its map face down, so there is no coastline to place the fishing grounds along. It is a standalone. |

## The Caravans

- The **oasis replaces the desert**. At 5 and 6
  seats **two deserts are oases**, and at 7 to 10 three ("Table sizes"); every
  oasis starts its own three caravans, caravan i from oasis i/3. Three neutral
  caravans grow outward from spokes at three alternating oasis corners (corners
  0, 2 and 4, each taking its first outward, non-perimeter land edge: one of
  the edge's two hexes is land, `board.LandEdge`, so a caravan never starts on
  a strait between two sea hexes; derivation 12,
  `scenarios.TestOasisSpokesAreNeverStraits`). Under
  Fishermen the desert has already become the lake, and that lake is the oasis.
- **Which deserts are oases** (`pickOases`): the deserts in board order, then
  the lakes, each taken unless it **clashes** with one already taken, until the
  table has its count. Two oases clash when they touch, or when a spoke of one
  shares an intersection with a spoke of the other (a caravan would open onto
  another's start). The first is always the first desert (else lake). A neutral hex not taken
  stays a plain desert (or lake) the robber may stand on.
- **The oasis is guaranteed, and so are its three spokes**
  (`Caravans.FinishBoard`, which runs after every module's `SetupBoard`, since
  Islands' carve can drown the only desert and the canonical ruleset order runs
  Caravans first). Two repairs, in order:
  - no neutral hex at all, at 2 to 4 seats: promote a seeded interior
    producing hex to desert (deleting its number token; the board is one hex
    poorer), and on a fair-mode board rebalance the engine-dealt tokens
    afterwards, as the fill below does (derivation 13;
    `scenarios.TestSinglePromotionRebalancesAFairBoard`). No board the engine deals
    reaches this branch today: Islands' carve keeps a desert on every board it
    cuts, and `board.Resolve` deals one on any map with a hex left to fill. It
    is kept for a future module that removes a desert. A larger table leaves
    this to the fill below;
  - the oasis survives but sits on the **outer ring**, where a spoke has no
    outward edge: **swap** it with a seeded interior producing hex whose number
    is not a 6 or an 8, tile and token both, so the board keeps everything it
    was dealt and only positions move.
  Only tiles the engine dealt may move: a hex the map's author pinned (a named
  terrain or a chosen number) stays put, and a preset pins every tile.
  **Every oasis of a larger table gets the swap too** (derivation 13): a pass
  repairs the first dealt oasis that is on the ring or on a reserved hex, and,
  while the table is an oasis short, moves the first desert `pickOases` had to
  skip; the partner is an interior non-red hex that starts three caravans and
  clashes with none of the other oases. A hex no partner can fix stays where it
  is.
  **Then every missing oasis is promoted** (derivation 13, `tab.fillOases`):
  while the table is still short (an Islands carve drowned a desert), a
  producing hex becomes a desert and its number token leaves the board. The hex
  is held to every oasis rule: interior, three spokes that are real land edges,
  dealt by the engine, off every reserved hex (the Wagons trade candidates),
  clashing with no other oasis, and never a 6 or an 8. It is drawn from the
  finisher's own seeded stream after the swaps, and only among the candidates
  that still leave room for the rest, so an early pick can never crowd out an
  oasis the board had room for. A promotion cannot land on a river, a castle or
  a lake: it is producing land when chosen, and Rivers and the Raiders castle,
  which derive afterwards, both avoid deserts. A fair-mode board then has its
  engine-dealt tokens rebalanced (`board.Rebalance`), as Rivers does, because a
  token has left a balanced board (`scenarios.TestFillOasesRebalancesAFairBoard`).
  Only carved Islands boards at 5 to 10 seats reach this; no other
  ruleset has a desert to lose. At 2 to 4 seats the one-oasis promotion above
  covers a board with no neutral hex, and is rebalanced the same way.
- **The robber starts beside the board, and may never stand on an oasis** (any
  of them, at the larger tables).
  The robber enters the game when a player resolves a 7 or plays a Knight card,
  and never on the oasis. The base game parks the robber on the desert, which
  here is the oasis, so `Caravans.FinishBoard` sets the robber beside the board
  after its repairs, on every board including authored maps and presets, and the module's
  `RobberForbidden` hook removes the oasis from every robber destination: the
  7, the Knight card, the auto-player, the bots, and under Knights the chase and
  the Bishop. A destination is refused, not converted: the legal set a client
  shows never offers the oasis.
  - **Decision (composition): the ban holds under Fishermen too**, where the
    oasis is the lake. Fishermen lets the robber block the lake; Caravans
    forbids the oasis outright and is the more specific rule for this hex. So in
    `base+caravans+fishermen` the lake's catch can never be blocked.
- After any turn in which the active player **built or upgraded** a building,
  exactly **one camel** is placed. Where it goes is decided by a **voting
  round**. **Bidding is open and sequential**: it starts with the player who
  just finished their turn and goes clockwise, each seat answering once, and
  the cards go face up, so a later bidder sees what the earlier ones committed.
  One vote per card. Every bid is paid whatever the outcome, at resolution, and
  clamped then to what the seat still holds. No round opens when the camel
  supply is empty or no caravan can grow.
- **Resolution has four steps, in this order:**
  1. a seat with **more votes than everyone else combined** chooses where the
     camel goes;
  2. otherwise, if **two or more seats holding a combined majority agree** on a
     placement, the camel goes there. This outranks the largest single bidder:
     at 4 / 3 / 3 the two threes agreeing beat the four;
  3. otherwise the **single largest bidder** chooses, even on a bare plurality;
  4. otherwise (a tie for the top, or no votes at all) the player who just
     finished their turn chooses.
  - **Decision: what "they agree" means online.** At a table, step 2 is a
    conversation after the bids are down. The engine has no conversation, so
    agreement is expressed **in the bid**: a bid may name the placement it
    wants, and seats naming the same placement pool their votes. Open,
    sequential bidding makes this work: a later bidder can see and match an
    earlier one, the same information a table has, in the same order. A bid that names
    no placement joins no coalition. When a coalition carries it there is no
    placement pick: the agreed path is the placement, and the camel is placed
    in the same batch.
- **The vote does not halt the table.** It runs alongside the next player's
  turn: a seat is held only while the vote is waiting on it, which in a
  sequential round means the one seat on the clock (or the placement it won).
  Every other seat, including the seat whose turn it is, may build, trade and
  play cards as normal in the meantime. It may not end its turn until the camel
  is placed, so a vote can never be left open or overtaken by a second one.
  Because the round is sequential, its clocks add rather than running at once,
  and the per-bid budget is shorter for it (`timings/timings.go`).
- A caravan is a **non-branching chain**: each new camel extends from the front
  of the last camel in one of the three caravans, or starts a caravan on its
  oasis spoke. A path may hold a camel and a road side by side, but not two
  camels, and a coastal path is a path like any other. The generated-board
  supply is **22 camels** at 2 to 4 seats, **33** at 5 and 6 (the extension's
  11 more) and **44** at 7 to 10: eleven per oasis past the first, counted off
  the oases the board actually has. Any desert beyond the table's oases stays a
  plain desert (the robber may stand on it, as in the base game).
- **Only a caravan's first camel is barred from the oasis perimeter.** A
  caravan that later finds its way back round to the oasis may be extended
  along an oasis edge. The first-camel bar needs no rule of its own here: a
  spoke is by construction an outward, non-perimeter edge.
- **Caravans merge; they do not block.** Two caravans whose heads meet at an
  intersection become a single caravan as soon as the next camel is placed, and
  continue as one. Both caravans' other ends are anchored at the oasis, so
  the one place the merged caravan can continue from is that intersection's
  **third path**, and the next camel may go there. It is offered once, as the
  lower-numbered caravan's placement, and the other caravan has no front left.
  That junction is the only intersection that ever holds three camels, and it
  is a merge rather than a branch because two caravans become one there.
  Otherwise a camel may never be laid onto an intersection that already joins
  two camels: a caravan whose head reaches the side or the tail of another has
  ended, because it could not continue from there. The only edges closed to a
  growing caravan are camel-bearing edges and non-land edges (sea edges open up
  alongside Islands, below). A caravan that can no longer be extended has
  simply ended; so does every caravan when the camel supply runs out.
  - **Decision (reading): a head that reaches the side of another caravan is
    stopped, not merged.** Only a meeting of two heads leaves a path to
    continue along.
    A head arriving at an intersection another caravan passes through would
    make a junction nothing can continue from, so the engine refuses that
    camel rather than end a caravan on it.
- **Scoring**: each settlement or city sitting **between two camels** is worth
  +1 VP to its owner. Two camels, whichever caravans they came from, since
  caravans merge. One point for a city as much as for a settlement. A road
  sharing a path with a camel counts **double** for the Longest Road, and a
  camel placement re-checks the title on the spot.
- **The victory target follows the combination**: **12 VP** on its own, **15**
  alongside Knights, and **2 more than either** alongside Islands (so 14, or 17
  with both).
  **Decision (implementation):** stated as **+2, and +2 more with Islands**, and
  implemented as an `engine.TargetVPAdjuster` rather than a `ConfigDefaulter`.
  Each of the four numbers is the rest of the ruleset's target plus that
  addition (10+2, 13+2, 10+4, 13+4), so it does not depend on module order;
  defaulters are first-writer-wins over the lexicographic ruleset sort, where
  `cak` precedes `caravans`. The module also adds the same number to
  `engine.MaxVPWithoutCards`, or the lobby would refuse its combinations as
  unwinnable.
- **Alongside Knights the bid resources change**: the vote is bid in **brick
  and lumber** instead of wool and grain, keeping the vote off the resources
  Knights turns into commodities.
- **Alongside Islands a ship counts double too** when a camel shares its path,
  as a road does, and **camels may be placed on sea paths**, beside roads and
  ships alike. So under Islands a camel may stand on any path a ship could
  (`board.SeaEdge`), and a caravan can leave its island. The pirate does not
  stop one, and nothing in the camel rules reads it.
- **Decision: a seat does not win on someone else's placement.** Camel VP
  accrues to whoever owns the interior building, and the placer is usually not
  the active player, so a camel really can carry a non-current seat over the
  target. The base game's rule applies: if you reach the target when it is not
  your turn, the game continues until a player has it on their own turn.
  Nothing in the scenario overrides it, so the win is **banked** and lands at
  the start of that seat's own next turn (`engine/decide.go`, `finalizeWith`,
  which checks the seat whose turn it was and the seat whose turn it now is).
  Awarding it on the spot would end the game on a move its winner had no part
  in.

## Compatibility: Caravans

The lobby enforces this table; `engine/compat.go` is the resolved matrix and
`engine/compat_test.go` holds the two to each other.

| With | Allowed | Notes |
|---|---|---|
| Islands | Yes | Camels may be placed on sea paths as well as land ones, and a ship sharing a camel's path counts double, as a road does. The target rises by 2. |
| Knights | Yes | The vote is bid in brick and lumber, and the pairing plays to 15. |
| Fishermen | Yes | Same file, no changes: the oasis and the lake are the same hex. |
| Rivers | Yes | Camels sit on the paths a river leaves; nothing in either scenario claims the other's pieces. |
| Raiders | Yes | Camels and riders share paths and neither blocks the other. A conquered building scores no VP, which reaches the between-two-camels point as well. |
| Wagons | Yes, and it warns | Playable, and Wagons removes the Longest Road award, so the camels' road doubling is dead while their settlement points still score. `engine.Warnings` carries that sentence for the lobby. **The oasis is never a trade hex:** the oasis repair never places it on a hex Wagons reserves (`engine.ReservedHexes`), and Caravans vetoes the oasis from the trade candidates (`TradeHexAllowed`) for a desert an author pinned on a cape. See `wagons.md`, "Caravans". |
| Harbormaster | Yes | Nothing in either touches the other. |
| Explorers | **No** | Explorers has no longest route for a caravan to double, so camel scoring has nothing to measure. It is a standalone. |

## Engine conformance

- Fishermen: lakes (2/3/11/12, and 4/10 for every further lake at 5 seats and
  up), blocked by the robber like any other hex, plus procedurally placed
  coastal fishing grounds (six, eight or ten by table size), which nothing can
  block; the setup draw for a second settlement beside a ground or a lake;
  1 tile per settlement / 2 per
  city drawn from a finite 1/2/3-fish supply with reshuffle, under the
  seven-token holding cap; whole-tile spends (no change) on the 2/3/4/5/7
  table, with a **6-fish bridge** rung added in any ruleset that has bridges
  (see below); the robber beside the board until the first 7; the old boot as a held
  win-threshold token passable to an equal-or-better player. The boot's entry
  is modeled as a seeded gate over the supply size rather than as a physical
  31st tile in the draw pool; this changes nothing in play.
- **The short-supply rule withholds the whole roll** when the supply and the
  spent pile together cannot cover it, rather than dealing what there is one
  token at a time clockwise from the active player.
- **Fishing-ground placement is derived.** A procedural coast has no fixed
  positions, so `deriveGrounds` picks them, with two rules of its own: no two
  grounds share a vertex, and a ground never sits on the sea hex a
  harbour's dock stands on. A corner may still touch both a ground and a
  harbour, since only the dock's own sea hex is excluded, and it gets both
  benefits.
- **The ground numbers are shuffled over the grounds** (derivation 12). See the
  first bullet under Fishermen.
- **Fishermen combined with Knights: the seven-fish rung changes, and the
  two-fish spend waits.** Knights removes the development-card deck (progress
  cards replace it) and keeps the robber out of play until the barbarians first
  land (`cak` `NoRobber`, true while `Attacks == 0`). So in `base+cak+fishermen`
  the 7-fish spend becomes **one progress card of the discipline you name**,
  and the **2-fish removal** is
  refused until the first barbarian attack, after which it works normally. A
  refusal costs nothing (`SPEND_UNAVAILABLE`): a spend never pays for an effect
  the ruleset does not have. The pairing also narrows the 4-fish spend to a
  resource (never a commodity) and widens the 3-fish steal to the victim's
  combined hand, through a resource-only bank take and `StealCardFromModules`.
- **Fishermen combined with Rivers: six fish buy a bridge** at no other cost.
  It is a whole-tile spend like every other rung: no change is given, the
  bridge must be a legal placement for that seat, and it still pays its 3
  coins, because a coin is paid for the placement rather than its cost. The rung
  (`scenarios.FishBridge`) reaches the bridge through `engine.Hooks.FreeBridge`, so
  this module never learns what a bridge is, and the rung is refused as
  `SPEND_UNAVAILABLE` in any ruleset with no bridges at all. An illegal site is
  refused before a tile is spent, as the five-fish road is.
- **Fishermen combined with Islands: five fish buy a road or a ship.** The
  spend names an edge it could legally build on right now, and under Islands
  that may be a ship edge; the credit is the same `FreeRoads` counter Road
  Building grants, which `engine/islands/decide.go` spends on a ship.
  **Not modelled:** two fish removing the **pirate** instead of the robber when
  the pirate is in play.
- Caravans: oases from the deserts (one, two or three by table size), each
  with three spoke-rooted, non-branching, merging caravans, oases and spokes
  guaranteed by `FinishBoard`;
  after-build camel placement via an open, sequential voting round paid at
  resolution; between-two-camels VP awarded to any seat whoever placed;
  camel-paralleling roads (and, under Islands, ships) doubled for Longest Road;
  the per-combination victory target. The four-step resolution is complete,
  with the coalition step mechanised as a placement named in the bid (see the
  Decision above).
- **Two Caravans adaptations, both to a procedural board.** The oasis takes
  whatever hex the desert landed on rather than the board's centre, and only
  swaps inward when a spoke would have no outward edge. And with Fishermen,
  `FinishBoard` makes the lake and the oasis the same hex with four numbers
  rather than keeping two separate features.
