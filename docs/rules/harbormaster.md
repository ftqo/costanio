# Harbormaster rules spec

Original description of the Harbormaster variant, the smallest module in the
set: it adds no hex, no piece, no cost and no new action. It adds one
**special card**, a derived per-player counter, and one point to the victory
target. Layered on the base game; only the differences are listed.

## What it adds

- One **Harbormaster card**, worth **2 VP**, held by at most one player at a
  time. It behaves like Longest Road and Largest Army: a public title, awarded by
  a comparison the engine re-derives rather than by a player action, and it is
  never bought, played or traded.
- A derived per-player total, the player's **harbour points**. It is a pure
  function of the board and the buildings on it, so it is not stored state and
  cannot desynchronise from the log.
- **+1 to the victory target** for the whole game, whatever that target would
  otherwise have been.

## Harbour points

A **harbour vertex** is a vertex belonging to a harbour (`Board.HarborAt`):
the vertices that already grant the 3:1 or 2:1 maritime rate in the base
game. Nothing about which harbour it is matters here: a 2:1 ore harbour and a
generic 3:1 harbour are worth the same.

- A **settlement** on a harbour vertex is worth **1** harbour point.
- A **city** on a harbour vertex is worth **2** harbour points.
- Everything else is worth **0**: roads, ships, knights, the Knights Merchant
  token, an Islands ship touching a harbour's sea edge, a building one vertex
  away from the harbour.

A player's harbour points are the sum over their own buildings. A building's
value here is its own victory-point value, which is the simplest way to
implement the rule.

**Ruling:** the count is **per building, not per harbour**. A building is worth
1 or 2 no matter how many harbours its vertex belongs to. The generator never
lets two harbours share a vertex (`placeHarbors` reserves both vertices of each
placed harbour), so this only matters on a curated map with overlapping
harbours, where it must not double-count.

**Decision:** the harbour must be **usable** by its owner for the building to
score. This matters only under Raiders: a building enclosed by conquered hexes
scores no victory points and its harbour cannot be used, so it contributes
**0** harbour points while conquered and its full value again once the
enclosure is broken. Harbour points are victory points in buildings on
harbours, so a building worth no VP is worth no harbour points.

Two consequences that bound the design:

- **At most one building can ever stand on a given harbour.** A harbour spans
  the two ends of one coast edge, and the distance rule forbids buildings on
  adjacent vertices. So harbour points come from *distinct* harbours, one
  building each, and the threshold of 3 always requires **at least two harbours**
  (a city plus a settlement, or two cities).
- A base-game player's ceiling is 5 buildings, so 10 harbour points, and in
  practice far less: harbours are spread around the coast and each one costs a
  settlement placed where the distance rule and the road network allow.

## The Harbormaster card

The card is re-derived after every change to any player's harbour points. The
holder is defined declaratively rather than as a sequence of transfers, because
only the declarative form covers every case:

Let `top` be the greatest harbour-point total among all players.

1. If `top < 3`, **nobody** holds the card.
2. If exactly one player has `top` and `top >= 3`, that player holds it.
3. If two or more players tie at `top >= 3`, the **current holder keeps it** if
   they are one of the tied players; otherwise **nobody** holds it.

That is the base game's Longest Road rule with 3 harbour points in place of 5
road segments. In normal play the first player to reach 3 takes it (rule 2),
and it moves only to a player with
**strictly more** (rule 2 again, since a tie is rule 3 and the holder is in it).

**Ruling:** the card moves **immediately**, at the moment the harbour points
change, not at the end of the turn. A player who upgrades a settlement on a harbour to
a city and thereby takes the card has its 2 VP available for the same turn's win
check.

**Decision:** a holder whose own total falls **below 3** loses the card even
though no opponent has more (rule 1). The threshold is a qualification for
holding the title, not a one-time entry fee, as with Longest Road. This needs
Knights or Raiders, the only modules that can take a building's value away.

**Decision:** the card may be claimed **during setup**. It is unreachable in the
base game (two settlements is 2 points), but Knights places a **city** in round
2, so a player who takes a harbour vertex in both rounds finishes setup with 3
harbour points and the card. Withholding it until the first turn would score
the same position differently depending on when it was examined, and nothing in
the rules gates the card on a phase.

**Decision:** ties for `top` that arise from a *loss* (rule 3's "otherwise")
leave the card unheld rather than picking a winner. This arises when a barbarian
attack downgrades two tied leaders' cities at once, or takes the holder's city and
leaves two others level. There is no tie-break; the card sits out until one
player leads alone, as Longest Road does after a break.

## Victory

- The default victory target rises by **1** for as long as the module
  is in the ruleset. It is **not** conditional on anyone holding the card. Base
  becomes **11**; Knights becomes **14**; Caravans becomes **13**; Fishermen
  becomes **11**, and **12** for whoever holds the old boot, since the boot's own
  +1 stacks on top.
- The increment is **relative**: it adds one to whatever target the rest of the
  ruleset produces. It therefore cannot use the "set the target if it is still
  unset" idiom that Knights and Caravans use, and it must be applied **after**
  every other module has chosen a target, not at whatever position the ruleset
  string's lexicographic sort puts it in.
- The resolved target is baked into the config carried by the game-created event
  at log position 0, so a replay reads it back rather than recomputing it, and the
  increment can never be applied twice.
- **Decision:** the increment moves the ruleset's **default** target, and a config
  that **names** a target of its own keeps that number. Every other module's
  target rule already yields to an explicit one (`Caravans.DefaultConfig`), and
  the lobby always sends a target, filled in from `format.ts`'s `recommendedVP`
  (which already includes the +1), so adjusting a named target would apply the
  point twice. The engine adds the point only when the caller named nothing
  (`engine.TargetVPAdjuster`). A table that wants 12 with Harbormaster sets 12
  and plays to 12.
- The card's 2 VP are **public**, like Longest Road's: they are visible to every
  seat and are included in the public VP total the lobby and the claim-against-bots
  comparison use.

## Compatibility

The lobby enforces this table; the prose below it is where each row's detail
lives, and `engine/compat_test.go` holds the table to `engine/compat.go`.

| With | Allowed | Notes |
|---|---|---|
| Islands | Yes | Every harbour counts, outer islands included. |
| Knights | Yes | The one expansion that can lower a seat's points, and it can do it on another player's turn. |
| Fishermen | Yes | No interaction. |
| Caravans | Yes | No interaction. |
| Rivers | Yes | No interaction: a bridge is not a building and earns no harbour points. |
| Raiders | Yes | The second expansion that lowers points: a conquered building scores none. |
| Wagons | Yes | No rule changes; the target rises by 1 as in any game. A harbour on a trade hex's seaward corners cannot be built beside and scores for nobody. |
| Explorers | **No** | Explorers has no ports, so there would be nothing to score. It is a standalone. |

## Composition

Harbour points are read off the board, so most modules compose with this one by
doing nothing. The interactions that exist are all about a building's value
changing.

- **Islands.** Fully compatible, no rule changes. Every harbour on the board
  counts, including harbours on outer islands and any harbour a generated sea
  carve leaves on a new coastline: the module never asks which landmass a harbour
  belongs to. Ships are worth nothing here, a ship does not connect a building to
  a harbour it does not touch, and the pirate does not suppress a harbour. Islands
  does not change the victory target, so `base+islands+harbormaster` is 11.
- **Knights.** Compatible, and the only module that makes harbour points fall.
  - A **barbarian attack** that downgrades a harbour city to a settlement takes
    that player from 2 to 1 on that harbour, which can move or unseat the card
    **on another player's turn**. Re-derive after the downgrade resolves, and
    after the whole attack resolves when several players lose a city at once
    (rule 3's tie case is reachable exactly here).
  - A city with no settlement piece left in supply is laid on its side and
    **treated as a settlement**, so it is worth **1** harbour point until its
    owner upgrades it back.
  - **Decision:** a **metropolis** on a harbour city is worth **2** harbour
    points, not 4. The metropolis is a separate award worth 2 VP placed on the
    city; the building is still a city. Harbour points count the building,
    and counting the award as well would let a single vertex carry 4 of the 3
    points the card needs.
  - A metropolis city is never downgraded, so a harbour metropolis is a harbour
    city that cannot lose value to barbarians.
  - The Knights Merchant token grants a 2:1 rate on a hex; it is **not** a
    harbour and grants no harbour points. Neither does the Commercial Harbor
    progress card, whose name is the only harbour about it.
  - Setup can award the card (see above). Target 13 becomes **14**.
- **Fishermen.** Compatible. **Ruling:** fishing grounds are **not** harbours and
  grant no harbour points, and a building on an intersection touching both a
  harbour and a fishing ground gets **both** benefits in full: it draws fish on the
  ground's number and scores its 1 or 2 harbour points. The two are independent
  systems that happen to share the coast. The Fishermen derivation never puts a
  fishing ground on a harbour's dock hex, so the overlap is rare, but where it
  occurs it is legal. Target 10 becomes **11**, and 12 while holding the old boot.
- **Caravans.** Compatible, no interaction. Camels never touch a vertex's harbour
  value, and a building can be worth a caravan VP and its harbour points at once.
  Target 12 becomes **13**.
- **Rivers.** Compatible, no interaction. Bridges are edge pieces and score
  nothing here.
- **Raiders.** Compatible, and the second module that can take harbour points
  away: a conquered building is worth 0 while enclosed (see the Decision above)
  and worth its full value again when a neighbouring hex is liberated. Re-derive
  on both transitions.
- **Wagons.** Compatible, no interaction. The trade hexes are capes on the outer
  ring, and a harbour dealt on a cape's two sea-only corners (which a trade hex
  blocks for building) is slid one edge along the coast onto a buildable one
  (derivation 12; `wagons.md`, "Harbours on a trade hex"), so every harbour can
  be built beside and scores as normal. Target 13 becomes **14**.
- **Explorers.** **Not compatible.** The exploration ruleset has no coastal trade
  harbours: its map is dealt face down and its coastlines are discovered, and
  what it calls a harbour is the **harbour settlement**, an upgrade a player
  builds onto their own settlement to hold cargo, not a place on the board anyone
  competes for. **Ruling:** harbour settlements grant **no** harbour points, and
  the pairing is refused in `engine.ValidRuleset`: with no harbour vertices every
  player sits at 0 and the module would only add 1 to the target.

## Board derivation

Harbormaster needs **no** derived feature: harbours are placed by the base board
generator, spread around the coastline and seeded from the game-created event.
The module implements no `SetupBoard`, no `BoardFinisher` and no
`TerrainRequirer`, so setup-hook ordering does not affect it.

The one question a procedural board raises is whether the **threshold** should
scale, since the harbour count scales with the board:

| Players | Radius | Hexes | Harbours | Harbour vertices |
|---|---|---|---|---|
| 3–4 | 2 | 19 | 9 | 18 |
| 5–6 | 3 | 37 | 12 | 24 |
| 7–10 | 4 | 61 | 15 | 30 |

**Decision:** the threshold stays at **3** for every player count and board size,
and so does the card's 2 VP. The threshold is only an entry gate: above it the
card goes to whoever leads, so raising it on a bigger board would only delay the
card's first appearance. A bigger board also has more players, so the number of
harbours per player barely moves.

A curated or custom map carrying no harbours of its own gets a coastline-scaled
set from `EnsureHarbors` before play. A curated map that ships **fewer than two**
harbours would make the card unreachable while the +1 target still applied.
**Decision: refused.** The module implements
`engine.MapChecker`, so `engine.MapEligibilityIssues` reports issue
`module_needs_harbours` (params `module`, `min: 2`) for an authored map carrying
**one** harbour (0 < n < `MinHarbours`). A map with **none** is still fine: it is
dealt a coastline-scaled set at start. The map builder shows the issue live, the
lobby refuses the config (and `engine.New` the game) with transport code
`HARBORMASTER_NEEDS_HARBOURS` (params `min`), and the lobby says so inline under
the expansion shelf (`harbormasterMapWarning`). Tested by
`TestMapWithTooFewHarboursIsRefused` and `server.TestHarbormasterOneHarbourRefused`.

## Engine conformance

- Harbour points: 1 per own settlement and 2 per own city standing on a vertex of
  any harbour, counted once per building regardless of how many harbours share
  the vertex; 0 for every other piece; 0 for a building whose harbour is
  unusable (Raiders conquest).
- Holder derivation is the total three-rule form above: nobody below 3, sole
  leader at 3 or more takes it, tie keeps it with a tied current holder and
  otherwise leaves it unheld. It is derived, never stored as an authoritative
  fact, so `replay(eventLog)` reproduces it.
- **Decision:** the re-derivation runs at a new engine seam,
  `Hooks.AfterEvents`, rather than at the existing `OnEvents`. Hook order is the
  ruleset string's lexicographic sort, which carries no dependency semantics, and
  `harbormaster` sorts before `raiders`, so an `OnEvents` re-derivation would read
  the standings one conquest out of date. `AfterEvents` runs once every module's
  `OnEvents` has landed and before the victory check, so a transfer counts toward
  the acting player's win on the same turn. It also runs during setup, which
  implements the setup Decision above. Same reasoning as `RouteWeights` beside
  `RouteEdges`; see `docs/engine.md`.
- **Decision:** "the harbour must be usable" is asked through
  `Hooks.BuildingVPSuppressed`, a new engine seam meaning "this building is on the
  board and worth nothing right now", rather than by importing the module that
  conquered it (no module imports another). Raiders implements it with the same
  predicate as its `BuildingInert`, so the two cannot disagree. A module that
  answers true must still subtract the base victory points itself, through its
  own `VictoryCheck`.

- Re-derived after **every** event that can change a building's harbour value:
  settlement built, city upgraded, and (with modules) a Knights barbarian
  downgrade, a Knights laid-on-side city, a Raiders conquest and a Raiders
  liberation. Including setup placements, so `base+cak+harbormaster` can award the
  card before the first turn.
- Transfers take effect immediately, including during another player's turn, and
  count toward the acting player's win check on the same turn.
- The card is worth 2 public VP through the module's `VictoryCheck`.
- The default victory target is the rest of the ruleset's default **plus one**, computed
  after all other modules' defaults, persisted in the game-created config, and
  never applied twice on replay. `base` 11, `base+cak` 14, `base+caravans` 13,
  `base+fishermen` 11 (12 while holding the boot), `base+islands` 11.
- `engine.ValidRuleset` allows Harbormaster with base, Islands, Knights,
  Fishermen, Caravans, Rivers, Raiders and Wagons, and **refuses** it with
  Explorers.
- No `SetupBoard`, `BoardFinisher`, `BoardRadiuser` or `TerrainRequirer`, no
  `OnDiceRolled`, no robber or `BankRatio` or `RouteLength` participation: the
  module's whole surface is `VictoryCheck`, the target default, and the
  re-derivation hook on events.
