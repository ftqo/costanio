# Maps

How boards work across rulesets, the wire contract with frontends, and how
both evolve without breaking each other.

## Board generation: random vs fair

Procedural boards come in two modes (`board_mode` config), mirroring the
dice modes:

- **`fair`** (default): balance the layout on top of the standard "no two 6/8
  tiles adjacent" rule. Four soft objectives, scored by `Board.penalty` and its
  index-based mirror `grid.penalty`: no two *duplicate* numbers adjacent;
  per-resource pip averages within `fairPipBand` of each other; no over-loaded
  settlement spot (`hotSpots`); no same-resource block bigger than `clumpMax`
  (`clumpExcess`).
- **`random`**: shuffle the tile bag and number tokens, keeping only the
  standard "no two 6/8 tiles adjacent" rule.

Both are deterministic functions of the committed game seed, so both are
provably fair against operator manipulation in the same way the dice are
(commit–reveal, see [dice.md](dice.md)): the board can be re-derived and
verified from the revealed seed, and replays reproduce it exactly.

### The fair-mode thresholds

The tuning constants sit next to `penalty` in `engine/board/generate.go`. Each is
set to what a standard board can actually reach:

- `fairPipBand = 0.34` sits just above 1/3, the floor: the 18 tokens carry 58
  pips, and dealing those across three 4-hex and two 3-hex resources cannot land
  closer than 3.25 vs 3.33 pips per hex. The term is flat zero inside the band,
  so a looser band lets the search stop early. At 0.34 boards sit at the floor
  on essentially every seed, with a 4-hex resource at 12..13 total pips.
- `hotSpot3 = 13` / `hotSpot2 = 9` are the pip sums that make a settlement spot
  over-loaded, inland (three producing tiles) and coastal (two). 13 is the most a
  legal 3-tile vertex can carry (5+4+4 pips; 5+5+3 would need two touching reds),
  so the strongest spot is banned without flattening the 12-pip spots under it.
  Coastal vertices are scored too, since most of a standard board's best spots
  are on the coast.
- `clumpMax = 2` allows touching pairs (the physical board has them) and
  penalizes each hex past that, so a fair board cannot carry a four-hex block
  of one resource.

`Lint` reports the same objectives as builder warnings, with a looser pip
threshold so a hand-built map is not nagged for a small spread.

### The search

Generation is a bounded best-effort search: a constructive pass places the
tokens (`placeNumbers`), then local search with random restarts improves the soft
objectives (`fairLayout`/`descend`), keeping the best layout it sees so
generation never hangs. It reaches penalty 0 at every supported board size in
practice, in ~0.35 ms for a 4-player board.

`descend` splits the penalty into three parts and rescores only what a proposal
can move: `numPenalty` (adjacent reds, duplicates, hot spots) reads numbers only,
`clumpExcess` reads resources only, and `pipImbalance` reads both but is the
cheapest of the three. The split is exact because `resMov` holds producing slots
only, so a resource swap leaves the producing set, and therefore `numPenalty`,
unchanged.

Curated map presets are never reshuffled.

### What the modules do to a generated board, and what they must not

A board reaches the table through three passes: `GenerateRadius`, then every
module's `SetupBoard` in ruleset-string order, then every `BoardFinisher`'s
`FinishBoard` (`engine/state.go`). The middle pass is a lexicographic sort with
no dependency semantics, which is why the third pass exists: a module that
surveys the board in pass two can have its conclusion undone by a module sorting
after it.

Three rules hold across those passes:

- **A module may not delete another module's feature.** Fishermen floods every
  desert into the lake; Islands then carves its channel, and on a small board
  could drown it, leaving neither a lake nor a desert. Islands therefore
  guarantees a neutral hex survives its own carve: when the drowning would take
  the last desert or lake, it makes a new desert out of the cheapest surviving
  mainland tile (drawn from the seed among the ties). It makes one rather than
  reviving a drowned hex, because a revived hex is one of the ones holding the
  channel open. Caravans' oasis is protected by `Caravans.FinishBoard`. The
  `FinishBoard` repairs can only restore a feature by deleting a producing tile
  and its number token from an already balanced layout.
- **A feature's position is part of it.** Each of Caravans' three spokes needs
  an outward, non-perimeter land edge, and an oasis on the outer ring does not
  have three. `FinishBoard` swaps a badly placed oasis with an interior hex,
  tile and token together, so the board keeps everything it was dealt.
- **A repair picks its hex from the seed, never from iteration order.** These
  repairs walk `HexesInRadius`, which starts at the west corner, so picking by
  iteration order puts the feature on the same tile of every board (the robber's
  opening hex, for one). The same applies to `numberTokens`' largest-remainder
  tie: 6 and 8 carry the same share and go short together, so the spare is drawn
  from the seed rather than dealt by `tokenDealOrder`.

These are asserted over the space of generated boards in `sim/boardgen_test.go`
(lake survival, spoke count, robber terrain and its distribution across seeds,
ground count, token symmetry, and every generated board passing
`ValidateLayout`). Each test also asserts that it reaches its interesting case,
since most repairs fire on a minority of seeds and a sweep that stopped
producing carved boards would pass vacuously.

**A generated board must pass its own validator.** `ValidateLayout` counts a
lake as the desert it is; the same check guards the share code,
`POST /api/maps/*` and the builder.

## A map is data

A board is pure data: hexes in axial coordinates, each with a terrain and an
optional number token, plus harbors and the robber/pirate. There are three
sources, all producing the same structure:

1. **Procedural** (default): generated from the game seed for the player
   count; active modules then shape it (Islands carves the outer ring and the
   channel behind it into sea, and puts gold on the islands it cuts off).
2. **Built-in presets**: curated layouts registered in code (`beginner`, more
   over time, including hand-built 7–10 player maps).
3. **User maps** (future): the same JSON schema stored in the database via a
   map editor; registration becomes a DB row instead of an `init()` call.
   Nothing else changes.

## Ocean framing: the ocean is computed, not authored

A board's ocean is derived from its land, not hand-placed. This keeps a
non-hexagonal map (a horizontal landmass, an archipelago) from rendering inside
a giant hexagon-shaped sea, and closes hand-authoring gaps between islands.

Every hex is one of three kinds:

- **solid**: any ground hex: land, desert (`ResNone`), the five producing
  resources, gold, lake, and `Border` (foreign off-board land). Solid hexes keep
  their original tile.
- **ocean**: `Sea`. Always computed, never read from the input.
- **absent**: everything else. Not stored in the runtime board and rendered as
  nothing. Absent hexes are what make a board non-hexagonal.

`(*Board).Frame()` (`engine/board/frame.go`) is the pure, deterministic transform
that recomputes the ocean from the solid set:

1. **Skip full hexagons.** If the solid set is exactly `HexesInRadius(radius)` (a
   standard map: a full hexagon of ground, no sea, no holes) the board is returned
   unchanged. The three standard maps and the roughly hexagonal Shores maps stay
   that way.
2. **Convex hull.** Compute the convex hull of the land hex centers in exact
   integer doubled-axial coordinates (`X = 2q + r`, `Y = r`); the `√3/2` y-scale
   factors out of every orientation test, so the geometry is float-free and
   deterministic.
3. **Fill the hull.** A hull with area is filled solid by a scanline (every row's
   full hex span between the hull's left and right edges); its edges are also
   rasterized as hex lines so a sliver too thin for any scanline row still
   connects. A degenerate (collinear / single-hex) hull instead joins its land
   hexes in order with hex lines. This fills bays, straits, lakes, and the wedge
   between distant landmasses in one step.
4. **Add a 1-hex coastal margin** around the filled outline (also `Sea`).
5. **Heal.** Flood-fill the exterior and turn any enclosed absent hex into `Sea`
   (plugging the thin notch a rasterized edge can leave), then, only if the
   footprint is still in more than one piece (a very thin hull), bridge the
   components with a hex line of sea and re-plug. The sea is then a single
   connected, hole-free body.
6. **Compose.** Solid hexes keep their tiles; filled and margin water become
   `Sea`; everything else is absent. The bounding radius is set tight to the kept
   hexes. Because cube-distance is convex, the fill never reaches farther from the
   origin than a land hex does, so the radius grows by at most the one margin ring.

`Frame` is idempotent (`Frame(Frame(b)) == Frame(b)`): the ocean is recomputed
from solid every time and any prior `Sea` is ignored.

**Runs at game start.** `engine.New` calls `Frame` right after the board is
acquired (custom / preset / procedural) and before `Resolve` / module
`SetupBoard` / `EnsureHarbors` (harbors land on the freshly computed coast).
Because it runs on every game, legacy share codes that authored a giant hexagon
of sea around a small landmass are reframed to a tight coastline on load
(`TestFrameHealsLegacyHexagonCode` in `engine/board/frame_legacy_test.go`).

**Codec absent sentinel.** The wire/share codec stays dense (one byte per
`HexesInRadius` hex), but a reserved resource nibble value **12** (`codecAbsent` in
`engine/board/codec.go`; the `Resource` enum stops at `Border` = 11) means absent.
`EncodeBoard` writes nibble 12 for any hex missing from the sparse `Tiles` map;
`DecodeBoard` skips those bytes. Desert stays `ResNone` (0, present), distinct from
absent. Old fully dense codes never used nibble 12, so they decode unchanged with
no version bump.

**Playable-tile cap.** `ValidateLayout` (`engine/board/validate.go`) counts only
playable hexes (land / desert / gold / lake / producing) against the size cap.
`Sea` and absent hexes are free, so the computed coastal ring never pushes a board
over the limit.

**Gallery & builder previews.** The frontend gallery and the map builder author
land only and call `POST /api/maps/frame` (mirrors `/api/maps/encode`) to render
the framed ocean for display. The gallery memoizes one batch frame call per
session; the builder frames (debounced) before export so shared codes embed
already-framed boards. Previews therefore match the Go `Frame` exactly.

## One dock per water hex

A harbor travels as an edge (`Harbor.Verts`) with a ratio, but its dock stands
on the water hex beside that edge: the single non-land hex of the two the edge
borders (`Board.HarborSeaHex`). One water hex can serve several coast edges (a
bay, a strait between two landmasses, the notch between an islet and the
mainland), so distinct edges are not enough.

> **Rule: no two harbors may resolve to the same water hex.** That would put two
> docks in one place, which cannot be drawn.

Enforced at three levels:

- **Generation** (`placeHarbors`, `engine/board/generate.go`). Even spacing around
  each coast loop is a target: a spaced position is taken if its water hex is
  still free, otherwise the harbor slides to the nearest free coast edge along
  the same loop (forward before backward at equal distance; a pure function of
  the inputs, costing no randomness). When no edge on the loop is free, the
  harbor is dropped rather than doubled up, so a ragged coast may end up with
  fewer than the requested count. Convex boards (the procedural full hexagons)
  never need a slide.
- **Validation** (`Board.ValidateLayout`). A hand-authored or shared board that
  violates the rule is rejected before a game can use it. Harbors with no single
  water side (both hexes land, or both water) are skipped here: they have no
  dock hex to clash over and are a separate kind of bad data.
- **Lint / builder** (`board.Lint` code `harbor_shared_hex`, severity `error`, naming
  the offending water hex). The Design-mode harbor overlay greys out and disables
  every coast edge whose water hex is already claimed; the lint error is the
  backstop for imported codes.

The invariant is asserted across generated boards by
`sim.TestHarborDocksNeverShareAHex` (every ruleset × player count × many seeds) and
by `checkRuleInvariants` in the adversarial suite.

The 3D renderer (`frontend/src/lib/board3d/layers/harbors.ts`) draws what the
board says; an impossible board is rejected upstream.

## The builder: one editor, one board

The web map builder authors one `Board`. Every tile is either blank land
(`ResLand`, no number: the roll fills it) or pinned (a concrete resource and a
number, a desert, gold, water). A bare outline and a fully designed map are the
same data at two points on that scale; both start a game and both share via the
same map code. The engine's `Resolve` fills whatever is still blank at the
table.

**Layout.** Tools on the left of the canvas, in three tabs; the sidebar on the
right reads top to bottom in working order: **Preview**, expansions,
Generate, then Save / Play, then the lint warnings and sharing.

- **Shape** tab: the canvas size (opens at 3, room to grow the standard hexagon
  on every side), a **Land** brush that adds blank tiles and a
  **Water** brush that erases them (an erased hex is absent from the board; the
  ocean is computed, see above), and a way back to a blank map. Gold is a
  resource and lives under Tiles; the desert is placed by the roll or painted
  under Tiles.
- **Tiles** tab: resources (the five, gold, desert) and numbers, painted or
  swapped by drag. Painting only touches hexes that hold a tile.
- **Ports** tab: the harbour palette.

**Generate is one panel.** It carries the two seeds, a "desert in the middle"
switch, a Balanced / Random toggle and Randomize. A roll strips the
board back to its silhouette first (`lib/maps/board.ts` `stripToShape`; the
server's `StripToShape` pins deserts, and every desert on a rolled board was
placed by the previous roll) and rolls a fresh map on the same outline. Water
and gold survive; nothing rolls gold. Painted resources do not survive a roll,
and the panel says so.

- **Two seeds.** `POST /api/maps/randomize` takes an optional `seed` (tiles:
  resources, numbers, deserts) and `harbor_seed` (ports), as decimal strings
  since a uint64 does not survive JSON's float64, and answers with both it used;
  `POST /api/maps/harbors` takes `seed` the same way. With seeds the roll is a
  pure function of (shape, mode, seed, harbor_seed), each drawn from its own
  fixed PCG stream, not the game's `rngFor` derivation, since a lobby commits to
  its own seed and these never reach a game. The port seed defaults to the tile
  seed: an absent `harbor_seed` follows `seed` (on its own stream), so one
  number reproduces a whole board, and the builder's ports field shows the tile
  seed it follows until a different one is typed or the ports are rolled on
  their own. In the panel each seed has a field and a dice; a Generate (or
  Reroll ports) button appears beside a field only once it differs from what
  dealt the board on screen. **Randomize** is the main button: fresh seeds for
  both, fresh board. Enter in a changed field applies it.
- **"Desert in the middle"** (on by default) pins one desert on the land tile
  nearest the centroid of the land before the roll is posted (`centerDesert`,
  frontend). `Resolve` keeps a pinned desert and carves none of its own, so a
  centred board has exactly the one, like the standard board. Off, the deserts
  land where the roll puts them.
- **Balanced / Random** is the roll's `mode`, the same two the lobby offers.

**The roll hands over a complete board.** It clears harbors before `Resolve`
then calls `EnsureHarbors`, so the author gets resources, numbers and a full
port set. `engine.New` runs `EnsureHarbors` at game start regardless, so this
only shows the author the board they were going to get. Ports are rerolled
along with the tiles because Generate already discards the author's resources
and numbers; keeping their coastline would make it a partial re-roll.

**Preview is a fullscreen overlay, and it rolls first if it has to.** The
button at the top of the sidebar opens the board through `POST /api/preview`
(`server/preview.go` `handlePreviewBoard`): the board goes through
`engine.New` as a custom map under the chosen ruleset and the Generate panel's
seed, the way "Play this map" sends it, so every module's `SetupBoard`
and `FinishBoard` runs and the envelope carries the `ext` the layers draw from.
The same `Board3D` the game mounts renders it edge to edge; the top bar holds
the seed stepper and Regenerate, a Checks toggle (the geometry checks from
`lib/preview/checks.ts`, folded into a side panel), and Play; Escape returns to
the editor. A board with blank tiles is generated before the overlay opens,
since the engine rolls blanks from the lobby's own seed and a half-rolled
preview would show a board the table never deals. Resources, numbers and ports
are pinned in the board and so reach the table as previewed; expansion layers
(a river's course, the lake, the oasis) are dealt again at game start, and the
overlay says so. The overlay is the only caller of `lib/preview/seed.ts`,
`lib/preview/view.ts`, `lib/preview/checks.ts` and
`components/board/CheckList.tsx`.

**Expansions are picked in the builder, but only the ones that change the
map.** An `ExpansionShelf` in the sidebar offers Islands, Fishermen, Caravans,
Rivers, Raiders and Wagons (each reshapes the board in `SetupBoard` or
`FinishBoard`); Knights and Harbormaster change the rules and not one tile, so
they are picked in the lobby. Explorers refuses an authored map. The shelf sets
the ruleset the lint, the preview and Play all use; opened from a lobby, it
starts with that lobby's whole set (the hidden rules-only modules included) and
"Apply to lobby" hands the set back with the map. Islands is derived, not
switched: land in more than one piece needs ships and gold produces only under
Islands, so either holds the switch on; one solid landmass with no sea holds it
off (`mapNeedsShips` / `mapSupportsIslands`, the lobby's own predicates). The
shelf's `locked` prop shows the switch, held, with the sentence that says why.

**Ports are painted, not cycled.** Harbor mode carries a palette (erase, 3:1, and
a 2:1 per resource): one click places the selected type on a coast edge, clicking
the same type again removes it. Two actions sit beside it: **Clear ports** (local)
and **Reroll ports**, which posts to `POST /api/maps/harbors` so the engine's
placement (even spacing per coast loop, one dock per water hex, a base-game mix
of 3:1 and 2:1) stays the single implementation. Reroll ports also rebuilds a
port layout without touching the tiles, which Regenerate would.

**Camera.** The editor zooms out to `BUILDER_MIN_ZOOM` (0.41) rather than
stopping at the viewBox's resting frame, and opens at `BUILDER_DESIGN_ZOOM`
(0.8). The viewBox frames the whole canvas rectangle (every cell a Land brush
can reach) rather than the tiles, so the frame holds still while tiles are
added and erased. Below k=1 `clampPan` centers the board instead of clamping to
an inverted interval.

Map codes are versioned (`engine/board/codec.go`): v1 for a harborless board,
v2 when harbors are present (appended after the per-hex bytes). v1 codes still
decode.

## Eligibility: derived, not declared

Terrain types have owning modules (`sea`/`gold` → islands; `lake` →
fishermen), registered via `engine.RegisterTerrain`. Eligibility
for a map × ruleset combination is computed, never hand-maintained:

- Every special terrain on the map must have its owning module active:
  a base-game lobby cannot pick an archipelago map.
- Every active module that requires terrain (`TerrainRequirer`, e.g.
  Islands requires `sea`) must find it on a curated map. Procedural boards
  are exempt: the module's `SetupBoard` provides its own.
- Every active module with a non-terrain map rule (`MapChecker`) must pass
  it: Harbormaster refuses an authored map carrying exactly one harbour
  (`module_needs_harbours`, see `docs/rules/harbormaster.md`). A map with no
  harbours is dealt a full set at start and passes.
- Curated maps are never transformed by modules.

Validated twice: at lobby creation (fast feedback) and inside `engine.New`
(authoritative).

## The wire contract (frontend rendering)

Frontends are dumb renderers of board data; no map- or module-specific layout
logic. Three rules keep old frontends working against newer backends:

1. **Terrains are self-describing strings** (`"wood"`, `"sea"`, `"gold"`),
   an append-only vocabulary. An old frontend that meets an unknown terrain
   renders a generic tile; it never misinterprets a renumbered int.
2. **Module state is namespaced** in views: `ext.islands = {ships, pirate,
   pending_gold, ...}`. Frontends feature-detect by key and ignore unknown
   namespaces; a new module cannot break an old client.
3. **Events are typed strings**, and any client can always resynchronize with
   a full `state` frame (see [protocol.md](protocol.md)). Unknown event types
   degrade to "refetch", never to corruption.

Board JSON shape (inside `BoardGenerated` events and full views):

```json
{
  "radius": 2,
  "tiles":  [{"hex": {"q": 0, "r": -2}, "res": "ore", "num": 10}, ...],
  "robber": {"q": 0, "r": 0},
  "harbors": [{"verts": [{...}, {...}], "ratio": 2, "res": "wood"}, ...]
}
```

Rules never live client-side. For placement UX, a future frontend either asks
the backend for legal placements (a cheap read-only endpoint to add with the
frontend) or optimistically tries a command; the server validates either way.

## Adding a terrain later (checklist)

1. Append the terrain constant and its string name (`board`).
2. `engine.RegisterTerrain(newTerrain, "owning-module")`.
3. The owning module gives it semantics (production hook, movement rules).
4. Frontends gain a sprite for the new string whenever they catch up; until
   then they show a generic tile.

Old maps remain valid forever: the vocabulary only grows.
