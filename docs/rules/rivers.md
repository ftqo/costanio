# Rivers rules spec

Original description of the Rivers scenario. Layered on the base game; only the
differences are listed. Rivers is one module (`rivers`), it owns its state in
`State.Ext["rivers"]`, and it is a board-shaping module: it derives a
watercourse across the generated board, forbids roads from crossing it, sells
bridges that do, and pays a side currency (**coins**) for building along it.
Coins are not victory points on their own; they decide who holds the
**Wealthiest Settler** and **Poorest Settler** tiles, which are.

Terminology note: Islands already has **gold hexes**, which pay a free choice of
resource. Rivers has **coins** (also called gold). They are unrelated. This spec
says "coin" everywhere and never "gold hex" except when talking about Islands.

## New components & terrain

- **Swamp**, a new non-producing terrain. A swamp is land, takes no number chit,
  produces nothing, and can hold the robber, as the desert does. It is the
  **estuary**, where a river reaches the sea, and there is one per river.
- **River hexes.** A hex the watercourse runs through. A river hex keeps a normal
  terrain and number chit unless it is the swamp at the estuary. The channel
  enters and leaves through **edge midpoints**, so it is drawn either **straight**
  (opposite edges) or **bent** (edges two apart), and two consecutive river hexes
  meet mouth to mouth on their shared edge. A 60 degree hairpin is not a shape the
  board can draw, and the derivation below never produces one.
- **The source.** The upstream end of a watercourse: a **mountains** hex with one
  mouth, where the water fans into rivulets in the peaks and reaches no other
  edge. A river runs from a source down to an estuary, never sea to sea, so the
  bridge-site count is `n` per river rather than `n+1`.
- **Bridge sites.** The edges the channel crosses. A bridge site is an edge like
  any other for adjacency and blocking, but it may hold **only a bridge**: never a
  road, never (under Islands) a ship.
- **Bridges**, a per-player supply of **3**. A bridge is a connection piece that
  spans a bridge site.
- **Coins**, a per-player count. A count, not a piece: no supply limit, no hand,
  no cards.
- The **Wealthiest Settler** tile (+1 VP) and the **Poorest Settler** tile
  (-2 VP), described under "Wealth status".

## Deriving the river on a generated board

The watercourse is derived deterministically from the finished board, the way
Fishermen derives its fishing grounds and Caravans its oasis.

**Decision:** the derivation runs in **`BoardFinisher`**, not `SetupBoard`. A
river must know which hexes are land and where the coast is, and Islands carves
sea out of an already-generated board. In `SetupBoard` the answer would depend
on the ruleset string's lexicographic sort (where `rivers` happens to sort
last).

### How many rivers

`riverCount = 1 + (landHexes-1)/30`, the same shape as the board's desert count:
**1** river at radius 2 (19 hexes, 3 to 4 players), **2** at radius 3 (37 hexes,
5 to 6), **3** at radius 4 (61 hexes, 7 to 10).

**Decision:** on a 19-hex board we derive one river of four to seven hexes
rather than two short ones. Two derived chains must not touch (see below),
which on that little land forces both short and pins them to opposite edges.
The count of non-producing hexes stays in line with the base game either way:
one swamp per river alongside the board's existing desert allowance.

On `base+rivers` and `base+islands+rivers` every board deals its full count,
and chains run 4 to 7 hexes at radius 2, 4 to 9 at radius 3 and 4 to 11 at
radius 4.

### The chain

A river is a chain of land hexes `h1 … hn`. A chain is a candidate when all of
the following hold:

1. `4 <= n <= 2*radius + 3`.
2. Every hex is land, is not the desert (nor Fishermen's lake, nor Caravans'
   oasis), is not an Islands gold hex, is not a hex another module has reserved
   (the Wagons trade-hex candidates; see "With Wagons"), and is not a hex some
   other river already uses or touches.
3. **Non-self-adjacent.** No two hexes of the chain are adjacent except
   consecutive ones. This is what forbids hairpins: if `h(i-1)` and `h(i+1)` were
   adjacent, `h(i)`'s two channel edges would be 60 degrees apart and no tile can
   draw that.
4. **Six-direction stepping.** A chain may step in any of the six directions, and
   a channel may meet any of a hex's six edges. The only shape rule is that a
   hex's two mouths must be **opposite or two apart**: a 60 degree hairpin is a
   channel no tile is authored for, and non-self-adjacency (rule 3) plus the
   outlet rule (rule 5) between them make one impossible anyway.

   No edge is off limits because of the number chip. A mouth on the south-west
   or south-east edge sits **1.500** from the chip mount, and the chip needs
   **1.26** (its 1.05 keep-clear plus half the 0.42 water), so every edge can
   carry a mouth with room for water up to 0.90 wide. The chip stays clear
   because there is a **file per shape**: a river tile is laid down at the
   board's own facing like every other tile, with no yaw solver (rotating a
   tile would rotate its chip socket while `layers/chips.ts` mounts the chip at
   one fixed spot).

   **Decision:** the shape ids are the two mouth directions, **sorted by
   direction index and joined with an underscore**: `e_w`, `ne_sw`, `nw_se`
   (straights) and `ne_w`, `e_nw`, `e_sw`, `w_se`, `ne_se`, `nw_sw` (120 degree
   bends). A source hex draws `src_<direction>` for its single mouth. The engine
   publishes the shape per river hex in `ViewExt`; which terrain wears it, and
   which file that is, is the renderer's business.

   **Decision:** the fifteenth mouth pair, `{SW, SE}`, maps to no shape and never
   arises. It is a 60 degree hairpin like the other five, so the drawable rule
   already excludes it, and it is also geometrically impossible: the SW and SE
   edge lines sit 1.299 from the chip mount, so a centreline half a channel
   inside either is at 1.049, inside the keep-clear, and the only route between
   those two mouths is a 126 degree loop over the number.

   **Decision:** the `e_w` straight is authored **twice**, as one asymmetric
   meander and its mirror, and which one a hex draws is a **derivation**: one draw
   per east-west hex off a second reserved public slot (`RiversVariantSeq`),
   recorded in the board ext and reproduced by the fairness port. An east-west
   reach is the commonest run and so the one shape that repeats inside a single
   river. Players can see the choice, so it belongs in the audit rather than in a
   renderer-side hash.

   The length floor is 4 on every board; with all six step directions open no
   board comes up short at it.

5. **Source to sea.** `hn` borders sea (or the frame) and is the **estuary**; `h1` is
   the **source**, a headwater with a single mouth, and it may sit anywhere on the
   island. The estuary's outer edge is an edge it shares with a sea neighbour, and
   must be opposite or two apart from its seam with `h(n-1)`, for the same
   tile-drawing reason. When the estuary borders more than one sea hex, the outer
   edge is the first qualifying one in board order.

   **Decision:** a river runs from a headwater in the mountains down to a
   swampland estuary at the sea; it never runs coast to coast. A building site
   for a bridge is a path that crosses
   a river, so a river of `n` hexes with one sea outlet has `n-1` seams plus 1
   outlet = `n` sites.

   **Decision:** the source hex is painted **mountains**: a headwater sits in
   the peaks, and the one-mouth tile is authored on that terrain alone.

   **Decision:** the candidate enumeration walks upstream from the estuary, and
   the recorded chain is the reverse of that walk. Only the estuary has to reach
   the sea, so starting at the coastal hexes keeps the search roots few while
   reaching the same set of chains. A chain whose two ends are both coastal is
   therefore two candidates, one per direction, and must not be deduplicated
   against its reverse.

   The mouth is always the last hex, and **nothing in the derivation reads
   terrain** beyond the eligibility mask, so it is invariant under its own
   painting.

6. There is no terrain-supply requirement: a channel hex keeps whatever terrain
   it was dealt ("Painting the chain" step 3), and only the headwater takes a
   fixed terrain (step 2).

Candidates are enumerated in board order (`Q` then `R` of `h1`, then of `h2`, and
so on) so the list itself does not depend on map iteration, then scored: longer
chains first, then chains whose two ends are farthest apart in hex distance, then
board order. One of the best-scoring candidates is chosen with a
**newly reserved RNG stream** off the `EvGameCreated` seeds.

**Decision:** reserve a new unused `seq` for that stream, and a second one for
the tile-variant choice (`RiversBoardSeq` and `RiversVariantSeq`), so that
adding a meander later cannot move any watercourse. Never touch `rngFor`'s
`seq*φ+1` derivation: every game ever played is audited against it, and the
JavaScript port in `verify/` reimplements it.

With more than one river, rivers are chosen one at a time in that order, and each
later river's candidate set excludes every hex in, or adjacent to, an
already-chosen river. Rivers therefore never touch, so every bridge site is
unambiguous: an edge is crossed by at most one channel.

Every hex of the outer ring borders sea, so an estuary is easy to find at every
radius. A board that yields fewer rivers than `riverCount` must still be caught
by the tests rather than pass silently.

**Decision:** it degrades by shortening rather than by dropping a river. Chains
are chosen longest first and each one blocks every hex it touches, so two
eleven-hex rivers on a radius-4 board can eat the coast the third one needed.
The whole derivation is then re-run with a shorter length cap, and the first cap
that fits every river wins. This is cheap because the search is exponential in
the cap (a pass at cap-1 costs about a third of the pass above it), and every
pass draws from the same stream in order, so the result is still a pure
function of board and seed.

**Decision:** the count is enforced by a conformance test and a sim invariant,
not a panic in board generation. `rivers.TestRiverCountOnRealBoards` asserts it
over every player count and a spread of seeds. The same code serves authored
maps, where a silhouette with no qualifying chain is the author's choice and
should not refuse their game.

**Decision:** the length cap `2*radius+3` is additionally held at **11**, its
radius-4 value, for any larger board. Every board the generator deals is radius 2
to 4, so the formula is what a generated game ever sees. An authored map may be
radius 16, where the formula asks for 35 and the chain search is exponential in
the cap; `POST /api/replay/frames` folds a config the caller chose, so an
unbounded cap there is a search a server cannot finish. For the same reason the
whole derivation has a node budget of **16 million**, about four times the worst
radius-4 board seen (**1,538,940**, over 200 boards per radius on `base+rivers`
and `base+islands+rivers`, the whole cap descent counted). If the budget ever
binds, the derivation keeps the candidates it found, which is deterministic
because the walk order is board order.

### Painting the chain

Once the chain is fixed:

1. **The estuary.** `hn`, the sea end, becomes the **swamp**. Its **number chit is
   removed** and discarded. Nothing else moves, so the surviving chit distribution
   and the no-adjacent-red-numbers property are exactly what the base generator
   produced.

   The chain is directed (`h1` is the source, `hn` the estuary), so no rule is
   needed to pick the mouth. The derivation runs twice on every game: once in
   `BoardFinisher`, which paints the board it just surveyed, and once in
   `ExtBoardInitializer`, which surveys the painted board and whose answer is
   recorded in the event log. Both agree because the derivation reads **no
   terrain** beyond the eligibility mask, which painting cannot change (a swamp
   is eligible, and a terrain swap only exchanges producing terrains).
2. **The source.** `h1` becomes **mountains**, swapping terrain with a mountains
   hex if it is not one already, since the one-mouth tile is authored on that
   terrain alone. **Decision (derivation 11):** the partner is, in order, a
   hex off every river; then the one whose number token is worth the **same
   pips** as the headwater's, so the swap moves no production from one resource
   to another; then the nearest; then board order. When three rivers have
   between them run through every mountains hex (it happens at radius 4), an
   interior channel hex that is mountains is the partner and takes the
   headwater's terrain, which step 3 lets it carry. Never another river's source
   or mouth. On an authored map with no mountains at all the headwater keeps its
   own terrain rather than the board losing a resource.
3. **The rest (derivation 11).** **Every hex between the source and the estuary
   keeps the terrain and the number it was dealt**, forest and fields included,
   and the channel is drawn through whatever is there. Desert, lake and gold are
   excluded from a chain altogether (rule 2 above), so the channel terrains are
   the five producing ones. Repainting these hexes would run after the fair-mode
   solver has balanced numbers against terrain and undo its work.
4. **Rebalance (fair mode).** The swamp still takes a hex and its token off the
   board and the headwater still swaps, so on a fair-mode board the number tokens
   are rebalanced once painting is done (`board.Rebalance`): a deterministic,
   rng-free descent that swaps pairs of tokens in board order while the
   generator's own fair penalty strictly drops and no two reds come to touch.
   Only tokens the engine dealt move; an authored map's pinned numbers stay where
   the author put them, by the same rule Caravans uses for its oasis. Random mode
   is not rebalanced, as it is not balanced to begin with. The derivation reads
   no token, so the recorded pass is unaffected
   (`TestFairModeBoardsStayInTheFairBand`). A few 4-seat boards stay slightly
   outside the band (0.42 to 0.5), where the fair objective (pips, touching
   duplicates and hot spots together) prefers that spread to the swaps that
   would close it.

The resource bag loses exactly one hex, the one under the swamp, whichever
resource that was.

**Decision:** the mouth's chit is discarded, never doubled up on another hex,
so no hex ever carries two numbers.

**Decision:** the robber still starts on the **desert** when the board has one,
and on the first swamp in board order when it does not. A swamp is a legal
robber destination like any other non-producing land hex.

### Bridge sites, derived

The bridge sites of a chain are exactly the edges the channel crosses: the
`n-1` **seams** between consecutive river hexes, plus the **1 coastal outer edge**
at the estuary `hn`. So **`n` sites per river**.

**Ruling:** the coastal outlet edge is a bridge site: a site is any location
where the river crosses or meets an edge. Coastal edges are legal road edges in
the base game, so this is a real restriction: that edge can hold nothing but a
bridge.

**Ruling:** the source contributes no site of its own. A headwater has one mouth,
the seam with `h2`, and that seam is already the first site in the list, so the
count is `n` rather than `n+1`.

A vertex touches at most **two** bridge sites. Its three edges lie between three
mutually adjacent hexes, a simple non-self-adjacent chain can use at most two of
those three edges, and two rivers never touch. So every vertex on the board always
has at least one edge that can take a road, and a starting settlement can always be
given a legal road.

## Setup changes

Setup runs as in the base game (or as Knights overrides it), with three changes:

- **Roads may not be placed on bridge sites**, and **a bridge may not be built
  during setup**. The free connector is a road (or, under Islands, a ship) as
  normal.
- **Each starting settlement on a river vertex pays its owner 1 coin.** A river
  vertex is a vertex touching at least one river hex, swamp included.
- **Each starting road on a river edge pays its owner 1 coin.** A river edge is
  an edge with a river hex on at least one of its two sides, whether or not the
  channel crosses it.

**Ruling:** payment is **per piece, not per adjacent river hex**. A settlement on
a vertex where two river hexes meet pays 1 coin, not 2.

**Ruling:** under Knights, setup places a **city** as the second building, and
that city pays 1 coin on a river vertex just as a settlement does. This is the
only time a city ever pays a coin.

Every player begins holding a **Poorest Settler** tile, because every player
begins with 0 coins and is therefore tied for the fewest. Tiles shed themselves as
setup coins come in; see "Wealth status".

## Bridges

| Build | Cost | Limit |
|---|---|---|
| Bridge | 2 brick + 1 lumber | 3 per player |

- A bridge is placed on an **empty bridge site**. Bridge sites are the only edges
  a bridge may occupy, and the only edges a road may not.
- **Ruling:** a road may **never** cross the channel, at any cost, in any ruleset.
  A crossing costs more than a road and is capped at 3.
- A new bridge must **connect to one of your own roads, bridges, settlements or
  cities** at one of its two vertices, and it may not connect **through** an
  opponent's settlement or city. This is the road connection rule, unchanged.
- A bridge is **single-occupancy** and blocks opponents as a road does.
- A bridge is worth **0 VP**, and **counts as a road segment for the longest
  route**.
- Bridges are a separate supply from roads. Spending your 3 bridges does not
  consume roads, and running out of roads does not stop you building a bridge.
- **A bridge cannot be built for free by a Road Building effect.** The base game's
  Road Building development card builds roads only, and so does the Knights
  progress card of the same name. **Decision:** the rule covers the Knights
  card too, for the same reason: bridges cost more than roads and the card is
  priced on roads.
- Bridges are never removed, moved or destroyed. Under Knights, the Diplomat may
  not remove, relocate or place one (see "Composition").

## Coins

### Earning

| Action | Coins |
|---|---|
| Build a road on a river edge | 1 |
| Build a settlement on a river vertex | 1 |
| Build a bridge | 3 |
| Upgrade a settlement to a city | 0 |
| Build a ship on a river edge (Islands) | 1 |

**Ruling:** building a bridge pays **3 and only 3**. A bridge sits on an edge of a
river hex, but it does not also collect the 1-coin road payment: a settlement, a road and a bridge total 5
coins, not 6.

**Ruling:** a city **never** pays a coin outside setup, not even the first time a
river settlement is upgraded. The coin is paid for putting a piece on the river,
and the settlement already paid it.

**Ruling:** the coin is paid for the **placement**, not for the cost, so a piece
placed for free still pays. A road from a Road Building effect, a road the Knights
Diplomat rebuilds, and a bridge bought with fish all pay their coins in full.
Setup placements pay for the same reason.

**Decision:** coins are paid **after** the build event lands, in the module's
`AfterEvents` hook, and the wealth tiles are re-derived once per build rather than
once per coin. A Road Building effect that places two river roads pays 2 coins and
then re-checks the tiles once, so the tiles never show an intermediate
state.

**Decision:** the payment is a diff against the board, not a reaction to a list
of event types. The hook walks every river edge and river vertex, asks who holds
it now, and compares that against who was paid for it last time. The rules
above follow from that: a piece placed for free still pays, a
ship moving off a river edge refunds its coin and one moving onto another earns
one (so a move between two is coin-neutral), a settlement upgraded to a city pays
nothing because its vertex is already paid for, and the Knights Diplomat's
removal and rebuild charge and re-earn without this module knowing that card
exists (a piece taken off a river edge on some other seat's turn is charged to
the seat whose turn it is, which only the Diplomat can do; see "With Knights").
This keeps the module from naming `engine/islands`' ship events or
`engine/knights`'s Diplomat events; no module may import another.

**Decision:** each payment names the edge or vertex it was made for, on the
event. The ledger must be folded rather than written where it is computed,
because a replay never runs a reaction hook: a ledger updated in place would be
empty after a restore and the next live command would pay every piece again.

Coins can also be bought from the bank: **trade resources to the supply for 1 coin
at your best ratio for that resource** (4:1, 3:1 at a generic harbor, 2:1 at that
resource's harbor), as often as you like on your turn. This routes through the
`BankRatio` hook, so harbor ownership is read as it is for resource trades.

**Ruling:** the 2:1 harbor rate **does** apply to coin purchases, so the rates
are 4:1, 3:1 and 2:1 as for a resource trade, and the best rate a coin can be
bought at is **2 for 1** at that resource's own harbor. The same three rates
apply in all three currency modules; `wagons.md` states the same Ruling for
gold.

`engine.State.CurrencyRatio` is the one place the rate lives, and the Raiders
and Wagons gold purchases read the same function, so harbor ownership and any
module override (a Merchant Fleet's 2:1, or anything that made a rate worse)
are read as for a resource trade. There is no floor and no scenario-local rate.
`engine/ruletest`'s `TestCurrencyRatioAgreesAcrossModules` drives all three
scenarios' real commands through the same four port configurations and
requires the same answer; `TestCurrencyRatioHonoursAModuleOverride` covers the
override.

**Decision:** the coin supply is **unbounded**. Coins are a count rather than
pieces. No production shortage rule applies to them.

### Spending

- **2 coins buy 1 resource card of your choice from the supply, at most twice per
  turn.** So a turn can convert at most 4 coins into at most 2 resources. The bank
  must actually hold the resource; if it does not, the purchase is refused and no
  coins are spent.
- **Coins may be given and taken in player trades**, on the active player's turn,
  like resources.
  - **Decision:** they ride the engine's shared module-trade payload as an
    object with a `coins` key. That payload is one blob handed to every module,
    and Knights carries its commodities through it as a bare array, so two
    modules cannot both own the array form. Knights also accepts
    `{"commodities": [...]}` and reports an unrecognised payload as "nothing of
    mine" rather than as a refusal, so a single trade can carry both goods.
- Coins are **not resources**. They do not count toward the 7-card discard
  threshold, are never discarded on a 7, cannot be stolen by the robber, the
  pirate or any steal effect, and Monopoly cannot take them.
- Coins are **public**. Every seat sees every seat's count, so nothing in Rivers is
  redacted and the module adds no hidden state.

## Wealth status

Two tiles float over the table and are re-evaluated **immediately after any change
to any player's coin count**, whoever's turn it is.

- **Wealthiest Settler, +1 VP.** Held by the player with strictly the most coins.
  **On a tie nobody holds it**: it goes back to the supply and stays there until a
  single player leads again.
- **Poorest Settler, -2 VP.** Held by **every** player tied for the fewest coins.
  There is one per seat, so all seats can hold one at once, and they do at the
  start of setup when everyone has 0. A player sheds it the moment they no longer
  have the fewest.

**Decision:** a player can never hold both. With two or more seats, being the
strict maximum and being among the minima are mutually exclusive unless all seats
are equal, in which case there is no strict maximum. The engine asserts it.

**Ruling:** a player's victory total may go **negative**. -2 is a real penalty, not
a floor at zero, and a player at 1 VP holding a Poorest Settler tile is at -1.

Both tiles are public, like the longest route and largest army tiles, and both
move without any player action.

**Decision:** the two tiles move on one event carrying the whole new assignment
(the wealthiest seat, and every seat holding a Poorest Settler), rather than one
event per tile that moved. Both are re-derived together from the same coin
counts, so the fold, the replay and the client all want the assignment, not a
pair of deltas.

**Decision:** the re-derivation runs in the engine's `AfterEvents` phase, not
`OnEvents`. `AfterEvents` also runs during setup, where this module's first
coins are earned, and it runs after every module's `OnEvents` has landed, which
a standing re-derived from other modules' work needs (hook order is a
lexicographic name sort with no dependency meaning).

## Victory

Rivers does not change the victory threshold. The base game's **10** stands, as do
Knights' 13 and Caravans' 12 when those modules are co-active. What Rivers adds is
the `VictoryCheck` contribution: **+1** for the Wealthiest Settler tile and **-2**
for a Poorest Settler tile.

As always, the win is only checked on the holder's own turn. A trade on someone
else's turn can hand you the Wealthiest Settler tile and put you on 10; you win
when your turn comes round and you still have it.

## Composition

Hook by hook, so an implementer can see where the module attaches:

- **`SetupBoard`**: nothing. Rivers does not reshape terrain before other modules
  run.
- **`BoardFinisher`**: everything in "Deriving the river". Runs after every
  module's `SetupBoard`, so it sees Islands' sea, Fishermen's lake and Caravans'
  oasis, and routes around all three.
- **`OnDiceRolled`**: nothing. Swamps produce nothing because they are
  non-producing terrain, which the base production loop already handles.
- **`AfterEvents`** (not `OnEvents`; see the Decision under the wealth tiles):
  diffs every river edge and vertex against the coin ledger, paying or
  reclaiming coins for roads, ships, settlements and bridges; then re-derives
  both wealth tiles and, when the assignment changed, emits one
  `rivers_wealth_changed` event carrying the whole new assignment.
- **`Blocks`/`Auto`**: nothing. Rivers never interrupts a turn.
- **`RouteLength`**: a bridge is one segment of its owner's route network, joined
  to roads at either vertex under the normal rules. Under Islands it joins ships
  only through the owner's own settlement or city, as a road does.
- **`BankRatio`**: consulted for resource-to-coin trades.
- **`VictoryCheck`**: +1 for Wealthiest Settler, -2 for Poorest Settler.
- **Build legality**: bridge sites reject roads and ships; non-bridge-site edges
  reject bridges; bridges are capped at 3 per player.

### With Islands

Allowed. Islands runs first on the board and Rivers routes its chain over what is
left as land.

- **A ship built on a river edge pays 1 coin**, on the same "at least one river hex
  on either side" test roads use.
- **Moving a ship off a river edge costs 1 coin**, paid to the supply. **Decision:**
  if you cannot pay, the move is **refused before anything happens**, the way a
  build you cannot afford is refused; the engine has no concept of debt.
- **Decision:** a ship moved from one river edge to another is **coin-neutral**: it
  pays the 1 coin for leaving and earns 1 for arriving, so a ship shuffling along
  the same river is not taxed. The Knights Diplomat rule for roads has the same
  symmetric answer.
- **A ship may not be built on a bridge site.** The estuary's coastal outlet is a
  land-and-sea edge, which Islands would otherwise let a ship take. It holds a
  bridge or nothing.
  - **Ruling:** a bridge site is closed to every piece except a bridge. No ship
    may be built at a river's estuary, or anywhere else across the river line:
    those sites are reserved for bridges.
- The longest trade route counts roads, ships and bridges together, joining only at
  the owner's own buildings.
- Islands' gold hexes are untouched by Rivers, and the derivation never routes a
  channel through one.

### With Knights

Allowed. The threshold is Knights' 13.

- **Setup**: the second placement is a city, and a city on a river vertex pays 1
  coin during setup only.
- **Coins buy resources, never commodities.** Commodities may be traded **to** the
  supply for coins at the usual ratio.
- Coins are neither resource nor commodity, so **no progress card touches them**:
  they cannot be taken, given, doubled or counted by any of them.
- **The Aqueduct still fires when coins were your only income for the roll.**
  Its condition is no resources and no commodities; coins are neither, so
  receiving them does not switch it off.
- **Knights move across bridges as though they were roads**, and bridges are part
  of the continuous routes along which a knight displaces another knight.
- **Intrigue** may be played against a knight standing on a vertex that one of your
  **bridges** touches, not only one of your roads. By the same reading, a bridge of
  yours attached to a road makes that road **not open** for the Diplomat.
- **The Diplomat may not remove, relocate or place a bridge.** If it removes a road
  on a river edge, the **card's player pays 1 coin to the supply**, whether the
  road was their own or an opponent's. An opponent whose road is taken
  keeps the coin it earned. If the card's player removed their own road and takes
  the free rebuild onto a river edge, they **earn 1 coin** as for any new road, so
  moving a road from one river edge to another is coin-neutral.
  **Ruling:** a removal the card's player cannot pay for is **refused before
  anything happens**, as an Islands ship move off a river edge is, and
  such a road is not offered as a Diplomat target. The river-to-river relocation
  is priced net and so needs no coin in hand. (`engine/knights` asks
  `State.RouteMoveRefusal` with the card's player and an empty destination for a
  plain removal; `TestDiplomatRemovalIsPaidByTheCardPlayer`.)
- **A city about to be pillaged by the barbarians may be saved by paying 5 coins.**
  The choice belongs to the city's owner, is offered once per pillage, and is
  refused if the owner cannot pay. Implemented across the two modules through
  `engine.Hooks.PillageBuyout`: this module states the price
  (`rivers.CoinsPerPillageBuyout`) and folds the payment, Knights owns the debt
  and clears it (`knights.CmdPillageBuyout`, `knights.EvPillageBoughtOut`), and neither
  imports the other.
  **Decision:** a losing seat with exactly one sacrificable city is asked rather
  than razed on the spot, but only in a ruleset that sells a buyout, because it
  then has a choice (pay, or lose it). Without a buyout Knights razes a
  single-city seat inside the attack event, and logs already written are
  unchanged.
- Knights removes the development deck, so the Road Building development card is
  not in play; the **progress card** of the same name still cannot build bridges.

### With Fishermen

Allowed.

- **A bridge may be bought for 6 fish** instead of its resource cost, taking a slot
  in the fish spend table between the 5-fish free road and the 7-fish free
  development card (`scenarios.FishBridge`, priced at `scenarios.FishBridgeCost`). The rung
  reaches this module's `BuildBridgeFree` through `engine.Hooks.FreeBridge`, so
  the placement rules and the refusal are this module's and Fishermen needs to
  know nothing about bridges. The rung is absent from the table in any ruleset
  with no bridges to sell. It is a whole-tile spend like the rest: no change is
  given, and
  the bridge must still be legal (an empty bridge site, connected, and within your
  3). It still pays its **3 coins**, because coins are paid for the placement and
  not for what the placement cost.
- **Decision:** the **lake stays**. The board still generates a desert, the river
  derivation is forbidden from touching it, and Fishermen turns it into the lake as
  its own spec says.
- Fishing grounds sit on sea hexes and rivers end at the coast, so the two
  derivations can collide only at a shared coastal vertex. They do not conflict: a
  fishing ground pays on its number, a river vertex pays a coin once when built on.
- **The old boot is not an extra victory point.** The two scenarios move a
  seat's distance from winning through different seams, and both apply: the
  boot raises its holder's own threshold by 1 (`WinThresholdDelta`, engine/scenarios),
  while this scenario's tiles change a seat's total (`VictoryCheck`, +1 for
  Wealthiest Settler and -2 for a Poorest Settler). A seat holding the boot and
  the Wealthiest tile gets +1 on the total against +1 on the threshold, which
  cancel. Neither changes the game's target for anyone else.

### With Caravans

Allowed. The threshold is Caravans' 12.

- **A camel may be placed on a bridge site**, whether or not a bridge stands there,
  and **a camel affects a bridge as it affects a road**: a bridge sharing
  its path with a camel counts double for the longest route, and a settlement
  between two camels scores as normal. The exclusion runs neither way: a camel does
  not stop a bridge being built under it, and a bridge does not stop a caravan
  being extended over it. Only a second camel is refused.
- The oasis is never a river hex and a river hex is never the oasis. The river
  derivation excludes the desert (which is what Caravans' oasis is derived from),
  and Caravans' `FinishBoard` repair, which turns an interior hex into a desert
  when none survived, excludes river hexes.
- Caravans' voting round is unaffected: bids are wool and grain, never coins.

### With Wagons

Allowed, with adjustments. Wagons spends coins to move, which
changes what a coin means, so two Rivers rules bend:

- **A bridge pays 2 coins, not 3.**
- **The Poorest Settler tile is not used at all** in this pairing. Coins are a
  movement currency here, so a player who is simply spending well would be
  penalised for it. The Wealthiest Settler tile still applies.
- Fording a river costs a wagon **3 movement points**; crossing any bridge costs
  **1**. Crossing another player's bridge pays that player a **2-coin bridge toll**
  instead of the ordinary road toll.
- Wagons' starting coin handout is reduced in this pairing, and river building
  coins are earned on top of it.

The precise wagon numbers belong to the Wagons spec; they are recorded here so the
two specs agree.

**Ruling: no river runs through a Wagons trade hex.** Wagons reserves every hex
it could make a trade hex (the capes, which on a generated board are the six
outer corners) through `engine.HexReserver`, and the derivation treats a reserved
hex as ineligible: no chain passes through it and no estuary ends on it. It is
not a blocker in the "rivers never touch" sense, so a river may run alongside a
trade hex. Both passes (`FinishBoard` painting, `InitExtBoard` recording) ask
`engine.ReservedHexes` of the same land mask and route round the same set, so
they agree. The river moves rather than the trade hex because the trade
triple's equal legs are essential to that scenario and a river chain has many
equally good alternatives; see "Rivers" in `wagons.md`. Every board still carries its full `riverCount`
(`wagons.TestTradeHexesNeverSitOnARiver`, every valid Rivers+Wagons ruleset at
every player count). Derivation version 11: only boards with both modules move.

### With Raiders

Allowed.

- **The Poorest Settler tile is not used.** Raiders pays coins out when knights are
  lost, which swings coin totals for reasons that have nothing to do with how well
  a player is playing, and the tile would follow those swings. The Wealthiest
  Settler tile still applies.
- Barbarians occupy paths, and a bridge site is a path: a barbarian may stand on
  one, occupied or not, as on a road.
- **The castle is never a river hex, and it is the castle that moves**
  (derivation 12): it takes the nearest ordinary interior hex to the centre that
  no watercourse runs through, read through `engine.WatercourseSource`. The
  watercourse itself is unchanged by Raiders. See `raiders.md`, "Deriving the
  castle from a generated board".

### With Harbormaster

Allowed, with no rule conflict. Harbormaster raises the victory threshold by its
own rule; Rivers' +1 and -2 apply to the raised total unchanged.

### With Explorers

**Not allowed.** Explorers is a `Standalone` module: it replaces board generation,
setup and the victory condition wholesale, so there is no board for Rivers to
derive a chain on. Even on a fixed board the starting island is small enough
that the swamps would cost it producing hexes and could land on a harbor
settlement site, a seat-by-seat imbalance. The lobby refuses the pair.

## Compatibility

| With | Allowed | Note |
|---|---|---|
| Islands | Yes | Ship coins, no ship on a bridge site, ship-move charge |
| Knights | Yes | 13 VP; knights cross bridges; 5 coins saves a city |
| Fishermen | Yes | 6 fish buys a bridge; the lake stays (our board keeps a desert) |
| Caravans | Yes | 12 VP; camels sit on bridge sites and double bridges |
| Wagons | Yes | Bridge pays 2; no Poorest Settler tile; bridge tolls |
| Raiders | Yes | No Poorest Settler tile (knight-loss coin swings) |
| Harbormaster | Yes | No interaction beyond the raised threshold |
| Explorers | **No** | Explorers is standalone: it replaces the board Rivers derives from |
| Rivers | n/a | One instance per game; the module is not self-composable |

Every refusal above is a rule or structural conflict. Rivers composes easily
because it adds a currency and an edge restriction rather than a phase.

## Engine conformance

- **Board.** `riverCount = 1 + (landHexes-1)/30` rivers, derived in `BoardFinisher`
  from a newly reserved RNG stream, never from `rngFor`'s frozen formula. Each
  river is a simple, non-self-adjacent chain of `4 .. 2*radius+3` land hexes whose
  estuary borders sea, avoiding the desert, the lake, the oasis and Islands' gold
  hexes. Two rivers are never adjacent. Every ruleset deals its full count,
  Islands included.
  (`TestRiverCountFormula`, `TestRiverCountOnRealBoards`,
  `TestRiverCountOnIslandsBoards`, `TestChainShape`,
  `TestChainHexesAreNeverExcludedTerrain`, `TestTwoRiversAreNeverAdjacent`)
- **Board (shapes).** A chain steps in all six directions and a channel may meet
  any of a hex's six edges; a hex's two mouths are opposite or two apart, so a 60
  degree hairpin never arises. Every river hex draws one of exactly nine two-mouth
  shapes (`e_w`, `ne_sw`, `nw_se`, `ne_w`, `e_nw`, `e_sw`, `w_se`, `ne_se`,
  `nw_sw`) or, at the source, one of six one-mouth shapes (`src_e` .. `src_se`).
  The pair `{SW, SE}` maps to no shape. Chains bend: over a fixed sweep
  every one of the six step directions is used and at least one interior hex in
  ten turns.
  (`TestShapeIsOneOfNine`, `TestSourceShapeIsOneOfSix`,
  `TestChannelShapeIsDrawableEverywhere`, `TestEveryChannelClearsTheChip`,
  `TestChainsUseMoreThanTwoStepDirections`, `TestDrawableRejectsTheHairpin`)
- **Board (hand-drawn layouts).** A classic 3-hex and 4-hex river pair is
  expressible: a mountains source with one mouth, straights through the middle,
  and a swampland estuary turning 120 degrees into the sea (north-west on the
  4-hex, south-west on the 3-hex), for 3 + 4 = 7 bridge sites.
  (`TestReferenceLayoutsAreReproducible`, and
  `layers/rivers.test.ts`'s "the two reference rivers draw, hex for hex")
- **Board (tile variants).** Each east-west hex draws one of two authored
  meanders, chosen by one draw per hex off `RiversVariantSeq`, recorded in the
  board ext and published in `ViewExt`. Every other hex is variant 0, and both
  meanders are actually used.
  (`TestVariantsDeterministicOnStraights`)
- **Board.** The source hex ends as mountains, by swapping terrain (not chits)
  with a mountains hex off the rivers, same pips first, then nearest. Every hex
  between it and the sea keeps the terrain and number it was dealt, forest and
  fields included. The estuary becomes a swamp and loses its chit.
  (`TestPaintedTerrain`, `TestSourceSwapsForMountainsWhenItCan`,
  `TestSourceSwapPrefersTheSamePips`, `TestPaintingMovesTerrainNotChits`,
  `TestPaintWithNoMountainsLeavesTheSource`, `TestMouthIsAlwaysTheSeaEnd`)
- **Board (fair mode).** After painting, a fair-mode board's engine-dealt tokens
  are rebalanced (`board.Rebalance`) and the board is as balanced as the base
  board it was painted on, within a small measured margin.
  (`TestFairModeBoardsStayInTheFairBand`,
  `board.TestRebalanceRespectsPins`)
- **Board (with Wagons).** No channel runs through a Wagons trade-hex candidate,
  and every board still carries its full river count.
  (`wagons.TestTradeHexesNeverSitOnARiver`)
- **Board.** `deriveRivers(b)` is a pure function of the finished board and the
  reserved stream: two calls on the same board return the same chains, in the same
  order, and the answer survives its own painting.
  (`TestDeriveRiversIsPure`, `TestSameSeedSameBoard`)
- **Board.** Bridge sites are exactly the `n-1` seams plus the one coastal outer
  edge at the estuary (`n` per river), and no edge is a bridge site for two
  rivers. Coins and adjacency read hex membership only, so the shape of a channel
  does not move them.
  (`TestBridgeSitesSeamsAndOutlet`,
  `TestCoinsAndAdjacencyDoNotReadTheChannel`)
- **Board.** Every vertex has at least one edge that is not a bridge site, so setup
  can always give a settlement a road.
- **Board.** The robber starts on the desert when one exists, otherwise on the
  first swamp in board order. Swamps produce nothing and take no chit. No hex ever
  carries two number chits.
- **Setup.** Roads may not be placed on bridge sites and no bridge may be built.
  1 coin per starting settlement on a river vertex, 1 per starting road on a river
  edge, 1 per starting city on a river vertex under Knights, always per piece and
  never per adjacent river hex. Every player starts holding a Poorest Settler tile.
- **Bridges.** 2 brick + 1 lumber, 3 per player, empty bridge sites only,
  connected to the owner's own network, blocked by an opponent's building,
  single-occupancy, 0 VP, counted for the longest route, never buildable by any
  free-road effect, never removable.
- **Edges.** A bridge site rejects roads and (under Islands) ships; a non-bridge
  site rejects bridges. Both refusals are `err` frames that leave state untouched.
- **Coins.** 1 per road, 1 per settlement, 1 per ship (Islands), 3 per bridge, 0
  for a city upgrade. Coins are public, unbounded, excluded from the hand limit and
  the 7 discard, unstealable, and untouched by Monopoly and (under Knights) by
  every progress card.
- **Coins.** Resource-to-coin trades use `engine.State.CurrencyRatio`, which is
  the seat's own maritime rate for that resource: 4:1, 3:1 at a generic harbor,
  2:1 at that resource's own harbor. No floor, and the same function the Raiders
  and Wagons gold purchases read.
  Coin-to-resource is 2 coins for 1 chosen resource, capped at twice per turn, and
  refused (spending nothing) when the bank cannot pay. Under Knights, resources
  only, commodities never.
- **Wealth.** The Wealthiest Settler tile goes to the strict coin leader and to
  nobody on a tie; a Poorest Settler tile goes to every player tied for the fewest
  coins. Both are re-derived after every coin change, on any player's turn, and no
  player ever holds both.
- **Victory.** +1 and -2 respectively, applied to whatever threshold the co-active
  modules set (10 base, 13 Knights, 12 Caravans), checked only on the holder's own
  turn. Totals may be negative.
- **Composition.** Islands ship rules; Knights' 13 VP, bridge-crossing knights,
  Intrigue on a bridge vertex, the Diplomat's bridge ban and the 1 coin its
  player pays for removing a river road (refused when they cannot), and the
  5-coin pillage buyout (`engine.Hooks.PillageBuyout`), plus the Aqueduct
  firing on a coins-only roll; Fishermen's 6-fish bridge
  (`engine.Hooks.FreeBridge`) with the lake retained; Caravans' camels on
  bridge sites and doubled bridges; the Poorest Settler tile suppressed under
  Wagons and under Raiders; Explorers refused in `engine.ValidRuleset`.

### Website currency controls


The coins panel accepts resources at the displayed maritime ratio. Alongside
Knights it also accepts commodities through `buy_coin {good: "cloth"|"paper"|"coin"}`
at that commodity's maritime ratio (4:1, generic harbour 3:1, Merchant Fleet 2:1).
The payment is validated as a whole before any commodity leaves the hand.
Gold buys resources only. Player trades can include coins through the currency
rows in the normal trade builder, alongside resources and commodities.
