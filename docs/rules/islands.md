# Islands rules spec

Original description of the Islands expansion mechanics. Layered on the base
game; only the differences are listed.

## New components & terrain

- **Sea** hexes (water) and **gold** hexes, in addition to the land terrains.
- **Ships** (a per-player supply, 15): a second connection piece besides roads.
- The **pirate**, a sea counterpart to the robber.
- Scenario maps mix a main island, where everyone starts, with outer islands
  separated by sea (see "Setup").

## Ships

- Cost: 1 lumber + 1 wool.
- A ship is placed on a **sea edge** (an edge bordering at least one sea hex).
- A new ship must connect to the player's existing ship network or to a coastal
  settlement/city. Ships and roads form a single connected network but join only
  at the player's own settlement or city: a ship cannot continue directly into
  a road or vice versa except through a building.
- One sea edge holds at most one ship; ships block opponents the way roads do.
- A road needs land on at least one side (`board.LandEdge`: one of the two
  hexes the edge separates is land). An edge between two sea hexes is open
  water and takes only a ship, even where each of its ends touches an island.
- A **coastal edge** (one that borders both land and sea, so it is eligible for a
  road *and* a ship) holds **one road or one ship, never both**, and the
  exclusion runs both ways: a road may not be built on an edge already holding a
  ship, just as a ship may not be built on an edge already holding a road.

### Moving ships

- Once per turn you may move **one** ship, but only an **open** ship: a ship at
  a free end of a ship chain (an endpoint not anchored by your building or
  another of your ships). Roads do **not** anchor a ship: a ship and a road
  join only through a settlement/city, so a road on the far side of a building
  does not close a ship end: a ship's end is open when it is not next to one of
  *your* ships or buildings.
- A ship may not be moved on the turn it was built, and a ship locked between
  two connections (closed on both ends) cannot move at all.
- **A closed route stays closed even after an opponent cuts it.** A chain of
  ships joining two of your own buildings is frozen for good, and an opponent
  building a settlement on an intersection partway along it does **not** open the
  two ships either side. (For the *title*, the same settlement does interrupt the
  trade route.) The open-end test gives this directly, since neither end of
  either ship becomes dangling.
- **Two loops are exceptions** (`engine/islands/decide.go`):
  - a ring of ships touching **no** building leaves **every** ship in it open;
  - a route that leaves one of your buildings and comes back to the **same**
    building with nothing between leaves the **two ships bordering that
    building** open.
- The moved ship is replaced at any legal new sea-edge position connected to
  your network. It may join a **different** route of yours; it does not have to
  stay on the one it left.
  - **Decision:** it may **not** be put back on the edge it just left
    (`to == from` is `ErrBadPlacement`): a move that changes nothing is a
    mis-click.

### The Road Building card

- The Road Building development card's two free builds may each be spent on a
  **road or a ship**, so the card builds 2 roads, 2 ships, or 1 ship and 1 road.
  Free builds are spent before resources, the same way they are for roads in the
  base game.
- **Known limitation: the two free builds should be consecutive, and ours are
  not.** You should not build a road with the card, then a settlement adjacent
  to it, and only then the card's second piece. We model the card as a counter
  (`State.FreeRoads`), so anything legal may happen between the first free
  piece and the second, including that settlement. Enforcing it would mean
  refusing every other command while a free build is outstanding, with an escape
  for a player who has no legal placement left so the turn cannot deadlock; that
  is not built.

## Settling from the sea

- **A ship anchors a build site the way a road does.** `base.md` says a
  settlement must touch your own road; in an Islands game it may instead touch
  your own **ship** (`anchorsVertex` in
  `engine/islands/hooks.go`). A city upgrade is unaffected: it needs a settlement
  of yours, not a connection.
- **The distance rule crosses water.** Two settlements on neighbouring islands
  separated by one narrow channel are still one edge apart and still conflict.
  Distance is measured on the vertex grid, and the grid does not care which hexes
  are wet.
- A settlement may stand with **no** road and no ship attached: losing every
  connection does not remove a building.

## Setup

- **Starting settlements go on the main island, where the board has one.**
  Both setup placements (under Knights, the round-2 settlement is a city, and
  it is held to the same rule) must touch the **main island**, and the outer
  islands are what the ships are for. Where the board
  has no main island (an archipelago of similar-sized islands) any island is a
  legal start. The victory target is unchanged (see "Victory target").
- **What the main island is.** The largest landmass (`board.Islands()`
  components, counting every `board.Land` hex: gold, desert and a Fishermen
  lake included), when it has **at least twice the land of the next largest**
  AND **more than half of all the land** on the board. Either test failing means
  there is no main island. `engine/islands.MainIsland` is the definition; the
  two tests catch different non-answers: the ratio alone would crown a 10-hex
  island among five 5-hex ones (29% of the land), and the share alone would
  crown one half of a 51/49 split. It is a pure function of the board's land
  (which hexes are land and how they join), nothing about resources, numbers or
  the seed. It decides legality only, never the board, so the fairness audit
  (`verify/`) is unaffected.
  From `TestMainIslandOnTheGallery` and `TestEveryProceduralBoardHasAMainIsland`:

  | Board | Land hexes | Landmasses (largest first) | Largest / next | Largest share | Main island |
  |---|---|---|---|---|---|
  | Shores (Small) | 28 | 19, 5, 3, 1 | 3.8x | 68% | yes, 19 hexes |
  | Shores (Medium) | 49 | 37, 3, 3, 3, 3 | 12.3x | 76% | yes, 37 |
  | Shores (Large) | 81 | 61, 5, 5, 5, 5 | 12.2x | 75% | yes, 61 |
  | **Archipelago** | 32 | 6, 6, 5, 5, 5, 5 | 1.0x | 19% | **none: any island** |
  | Japan | 92 | 62, 22, 5, 3 | 2.8x | 67% | yes, 62 |
  | UK & Ireland | 108 | 82, 26 | 3.2x | 76% | yes, 82 |
  | United States, China | 157, 151 | one landmass | n/a | 100% | yes, the whole map |
  | Procedural, 2-4 seats | | mainland + 1 arc | 5.5x to 6.5x | 85% to 87% | always |
  | Procedural, 5-6 seats | | mainland + 2 arcs | 6.3x to 12.5x | 76% to 86% | always |
  | Procedural, 7-10 seats | | mainland + 3 arcs | 11x to 21x | 79% to 88% | always |

  The procedural rows are 600 boards per seat count (300 seeds, both board
  modes) under every composed ruleset (`+cak`, `+fishermen`, `+caravans`,
  `+rivers`, `+raiders`). The tightest procedural board is 5.5x and 76%, and the
  tightest curated map with a home island is Japan at 2.8x and 67%, so both
  thresholds (2x and half the land) fall well between those and the
  Archipelago.

- **The host can switch it off.** The lobby's **Starting island** setting
  (`modules.islands.start_island`) is `auto` by default: the main island when
  the board has one, any island when it does not. `any` allows any island on
  every board, for a table that prefers a free start. The lobby says which applies to the chosen
  map ("This map has no main island, so any island is allowed" on the
  Archipelago), from a TypeScript copy of the definition that
  `frontend/src/lib/maps/mainIsland.test.ts` holds to the engine's answers in
  `mainIsland.vectors.json`.
- **The island bonus is measured from where you start**, not from the
  mainland: a setup settlement never earns a chip, and it makes its island
  "already occupied" for you. Starting on the main island, a player's first
  settlement on each outer island earns the chip and another settlement on the
  main island earns nothing (`TestWholeSetupLandsOnTheMainIsland`). Where any
  island is allowed, a player who starts on an outer island earns no chip
  there, and does earn one for their first settlement on the mainland.
- During setup, a player whose starting settlement sits on the coast may place a
  **ship instead of a road** as that settlement's free connector, heading
  straight out to sea. The same edge rules apply as to a built ship: an edge
  another seat's setup road already holds is taken, and an edge a composed
  module closes to ships (a Rivers bridge site) is refused.

## The pirate

- Lives on a sea hex. On a 7 (or when you play a knight) you move **either** the
  land robber **or** the pirate, never both. The robber may not go to sea and the
  pirate may not go ashore.
- **The pirate must move.** Like the robber, it goes to a **new** sea hex; you
  may not leave it where it is (`engine/islands/decide.go` enforces it).
- The pirate blocks ship building and movement on its adjacent sea edges, and
  lets you steal one random card from a player who owns a **ship** adjacent to
  the pirate's hex. A coastal settlement next to that hex is **not** a target;
  only a ship is.
  - The block is **symmetric**: no new ship on an edge of the pirate's hex, and
    no moving a ship **to or from** one.
  - The block applies during setup too, but has no effect there: **the pirate
    starts off the board** and arrives only when a player first moves it there,
    as the robber does on a board with no desert.

## Gold hexes

- A gold hex pays its adjacent builders the player's **free choice** of any
  resource(s): one per adjacent settlement, two per adjacent city. A city may
  take two of the **same** resource or two different ones, as it likes.
- **Decision:** the choosing player picks from what the bank
  actually has, and a drained bank shrinks the pick, so no card is ever minted.
- **Decision:** the second setup settlement pays out too, so a
  starting settlement bordering gold owes one pick per adjacent gold hex. That
  pick is made **during setup**, as soon as it is owed. It does not stall the
  placement snake (other players keep placing), but any pick left unmade when
  setup ends blocks the first turn until it is resolved. This matches the
  round-2 settlement paying for every other terrain.
  Since starting settlements go on the main island, this arises only where any
  island is allowed (the host's "any island", or a board with no main island):
  a generated board puts its gold on the outer islands, and a corner touches at
  most one landmass, so no main-island start can border it.

## Longest trade route

- The Longest Road card becomes the **Longest Trade Route** card: the longest
  continuous path counts both roads and ships together, joined only at the
  player's own settlements/cities, otherwise as in the base game.

## Victory points for exploration

- Many Islands scenarios grant bonus VP for being the first to build a
  settlement on a new island (one reached across the water), plus scenario-
  specific objectives. costan models this as a fixed VP chip (**default 2**, and
  configurable) for the first settlement a player founds on each island beyond
  their start.
- **This is a default.** A procedural board has no scenario to read the number
  off, so it is a config knob.

## The robber, harbours and the bank

- **The robber stays on land.** It may stand on any land hex, gold included,
  and never on sea. When the carve drowns the desert it started on, it is moved
  to another hex it may occupy before the game begins.
- **Harbours are recomputed for the carved coast**, so a ragged coastline can
  carry fewer than the usual number (`docs/islands.md`).
- **A fair-mode carved board has its numbers rebalanced after the carve**
  (derivation 13). Drowning a sixth of a balanced board otherwise leaves it far
  from fair (mean pip spread 1.65 at 2 to 4 seats against 0.33 on the base
  game; 0.50 after rebalancing). Only the
  number tokens move, never terrain, and only on procedural boards: a gallery
  or custom Islands map is never carved and keeps the numbers it was dealt.
  See `docs/islands.md`, "The carve".
- **Ships are pieces, not cards.** They come from your 15 and never go back to
  it, and the bank is involved only through what a ship costs and what a gold
  pick takes out of it (see "Gold hexes").

## Victory target

- **The target is the base game's 10**, and Islands adds nothing to it; the
  island chips are the extra points on offer. Knights and Caravans move it for
  their own reasons (`knights.md`, `scenarios.md`).
- **This is a default.** We do not scale the target with the land: our carved
  boards average about 13 terrain hexes (deserts excluded) at 2 to 4 seats, 25
  at 5 to 6 and 43 at 7 to 10, and the main-island
  start rule does not change it either. A host can name any target.

## Map eligibility

- Islands requires a board that includes sea: an Islands
  game must run on a map with sea terrain (procedural generation carves it; a
  curated Islands map must ship sea tiles).

## Knights in an Islands game

The combination rules are in `knights.md` under "Knights in an Islands game".
In short:
everything Knights says about roads applies to ships, so a knight moves along
your roads **and** your ships (joining them only at your own buildings), may end
its move at sea, closes a ship route so it can never be marooned, and chases the
pirate off a sea hex just as a land knight chases the robber. That section also
lists what we do not model.


## Compatibility

The lobby enforces this table; `engine/compat.go` is the resolved matrix and
`engine/compat_test.go` holds the two to each other.

| With | Allowed | Notes |
|---|---|---|
| Knights | Yes | Knights walk ships, the pirate can be chased at a sea intersection, and the target is Knights' 13. See "Knights in an Islands game" above and `knights.md`. |
| Fishermen | Yes | Five fish buy a road **or a ship**. The fishing grounds are placed along whatever coast the carve leaves. |
| Caravans | Yes | A ship sharing its path with a camel counts double, exactly as a road does, and the target rises by 2. See `scenarios.md`. |
| Rivers | Yes | A ship on a river edge earns its coin like any other piece, and a ship moving between two river edges is coin neutral. See `rivers.md`. |
| Raiders | **Yes**, with conditions | Only where the board has a continuous main island for the coastline to be raided; an all archipelago board does not work. The condition and its derivation are `raiders.md`'s. |
| Wagons | **No** | Wagons needs one contiguous, roughly round landmass and cannot cross water, and an island board is an archipelago by construction. The refusal is stated, with its reason, in `wagons.md`. |
| Harbormaster | Yes | Every harbour on the board counts, outer islands included; a ship is worth no harbour points and the pirate suppresses nothing. See `harbormaster.md`. |
| Explorers | **No** | Explorers is a standalone with its own board and its own sea rules: both scenarios use ships and a pirate, and their rules for both are different. |

## Engine conformance

- Ship cost/placement/connectivity/limit; open-ship single-move-per-turn,
  not-the-turn-built, no moving locked ships, both loop carve-outs, and no
  putting a moved ship back where it was.
- A ship anchors a settlement site; the distance rule crosses water.
- Road↔ship coastal exclusivity enforced both ways (no road on a ship's edge, no
  ship on a road's edge).
- Road Building card's free builds spendable on ships (2 roads / 2 ships / 1+1).
- Starting settlements (and the Knights setup city) on the main island when
  the board has one, any island otherwise or under `start_island: any`; the
  command, the legal targets, auto-pass and the bots all ask
  `engine.CheckSettlementSpot`, which consults the rule
  (`TestSetupSettlementsGoOnTheMainIsland`, `TestArchipelagoStartsAnywhere`,
  `TestStartAnyAllowsOuterIslands`, `TestStartRuleIsSetupOnly`).
- Coastal starting settlement may open by ship instead of road.
- Pirate on sea and must move; robber/pirate mutual exclusivity on a 7; pirate
  adjacency block on building and on moving a ship **to or from** its hex, in
  setup as well as in play; steal from a ship owner only.
- A knight anchors a ship end, so `base+islands+cak` cannot maroon one.
- Gold-hex free resource choice (1/settlement, 2/city), bank-limited.
- Longest route counts road+ship, joining only at own buildings.
- Island/exploration VP.
- Map requires sea.
- The offered targets are exactly what the validator accepts, both ways, on
  `base+islands`, `base+islands+rivers` and `base+cak+islands`, in setup as
  well as in play (`TestLegalTargetsMatchValidatorIslands`): a setup ship is
  not offered on a Rivers bridge site, a ship move the owner cannot pay the
  river coin for is not offered, and Road Building's free ship is offered
  before the roll, as its free road is (`TestFreeShipOfferedBeforeRolling`).
