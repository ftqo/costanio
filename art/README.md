# Board art

Review renders (pair frames, hero shots, board stills) are written by the
scripts under `tools/blender/` into `art/prototypes/<family>/`. That directory
is local output and is not tracked; re-run the script to get a frame.

**One blend, one shipped asset.** The file you open to change a thing is the
file it ships from, and no blend produces more than one `.glb`:

| source | ships as | holds |
|---|---|---|
| `art/hexes/<terrain>.blend` ×13 | `models/tiles/<resource>.glb` | one hex tile, its props and its chip socket. Module hexes have their own rows below |
| `art/pieces.blend` | `pieces.glb` | settlement, city, both roads, the robber (plus the `Player_*` reference copies, which ship nowhere) |
| `art/chips.blend` | `chips.glb` | every number chip and the blank |
| `art/knights.blend` | `knights.glb` | three knights and their six swords |
| `art/metros.blend` | `metros.glb` | the three metropolises |
| `art/ships.blend` | `ships.glb` | route ships, the pirate, the barbarian ship |
| `art/walls.blend` | `walls.glb` | the city wall ring |
| `art/dice.blend` | (not exported) | the two dice. The die a player sees is code-drawn (`Die.tsx`), because a die is a red/white pair and an asset slot cannot encode the pairing. |
| `art/cards.blend` | `cards.glb` | the card slab |
| `art/improvements.blend` | `improvements.glb` | book, scales, crown |
| `art/trader.blend` | `trader.glb` | the merchant: the stall that ships and draws |
| `art/trader_v2.blend` | `trader_v2.glb` | the same piece rebuilt, not drawn (`Trader2_merchant_*`). See the section below and `TRADER_CANDIDATE` in `frontend/src/lib/board3d/loader.ts` |
| `art/docks.blend` | `docks.glb` | six trading posts (`Dock_wood`, `_brick`, `_sheep`, `_wheat`, `_ore`, `_generic`) |
| `art/signs.blend` | `signs.glb` | six harbour ratio signs |
| `art/beach.blend` | `beach.glb` | the canonical beach strips and the `Mat_Path` swatch |
| `art/camels.blend` | `camels.glb` | the Caravans camel (`Camel_*`), and the punt it rides on a pure sea path under Islands (`Raft_*`, 172 tris, authored in the camel's frame with its deck top at 0.245 under the feet; `layers/caravans.ts` floats its 0.17 waterline on the mean sea and, on a path shared with a route ship, moves it 0.78 toward the caravan's head and the ship 0.8 the other way). Modelled live; no generator. A laden dromedary: one hump (two rings over a four-station barrel), a curved neck, four legs, a tail, an oxblood saddle blanket and two bales in the waypost's pale cap colour. Feet on 0.25, drawn at 1 (`MODULE_SCALE.camel`): the belly stands at 0.660 over the road's 0.434 top and the feet outside its 0.1438 half-width. Four values (body, darker legs and hump, blanket, bales). The blanket is dark so the piece stays neutral by value against seat-coloured roads on the same edge |
| `art/spokes.blend` | `spokes.glb` | the Caravans waypost pair (`Spoke_*`) |
| `art/fishing.blend` | `fishing.glb` | the Fishermen weir marker (`Fish_*`) |
| `art/riders.blend` | `riders.glb` | the Raiders rider (`Rider_*`), a horse and rider on an edge. Generated from `tools/blender/gen/riders.py` |
| `art/wagons.blend` | `wagons.glb` | the Wagons covered wagon (`Wagon_*`), a seat-tinted vertex piece. Generated from `tools/blender/gen/wagons.py` |
| `art/bridges.blend` | `bridges.glb` | the Rivers bridge (`Bridge_*`). Generated from `tools/blender/gen/bridges.py` |
| `art/vessels.blend` | `vessels.glb` | the Explorers cargo ship (`Cargo_*`) and corsair (`Corsair_*`). Generated from `tools/blender/gen/vessels.py`; a re-run overwrites the blend, so change the shapes there |
| `art/hexes/castle.blend` | `tiles/castle.glb` | the Raiders castle hex (`Castle_*`). Modelled live on the pasture's own ground, rim and props (appended from `art/hexes/pasture.blend`, renamed) |
| `art/harbors.blend` | `harbors.glb` | the Explorers harbour quay (`Harbor_*`) and the cargo its basin holds (`Settler_*`, `Crew_*`). A quay only: it stands beside whatever settlement or city the player's piece set draws on that vertex, starting 0.50 seaward along +x (1.00 at the settlement's drawn scale), clearing the largest building of the three shipped sets by 0.166. `harborArt.test.ts` re-measures all six. Generated from `tools/blender/gen/harbors.py`; edits in the blend are overwritten |
| `art/lairs.blend` | `lairs.glb` | Explorers, on land: the pirate lair token (`Lair_*`, the skull rock, 452 tris, seated on the goldfield's empty chip socket until the lair falls) and the crew that stands on a hex (`Boarder_*`, the cutlass figure, 128 tris, `Seat_*` tinted, drawn at 1, front +x, base 0): three in a rank beside the token take a lair, and one per seat stands on a spice farm. Modelled live; no generator. The figures stand on the tiles' own slots, `LairSlot_<n>` in `hexes/goldfield.blend` and `FarmSlot_<n>` in `hexes/spice.blend`: empties parented to the hex at ground height, exported into the manifest as `TileEntry.slots` |
| `art/cargo.blend` | `cargo.glb` | the Explorers cargo: the fish haul (`Haul_*`, 60 faces / 132 tris: four sections, a crest in the outline instead of fins, the cord one extruded loop), the spice sack (`Spice_*`, 52 faces / 120 tris: five rings, a pinched-lathe neck cord), the mission marker (`Marker_*`). Generated from `tools/blender/gen/cargo.py`; model in `cargo_kit.py`, not in the blend |
| `art/barbarians.blend` | `barbarians.glb` | the raider (`Barbarian_*`), shared by Raiders and Wagons. Modelled live; no generator. A turned figure: flared plinth, a tapered eight-sided column leaning forward, an overhanging shoulder slab, a dark brow band, a pointed helm, and one prop, a bearded axe on a dark haft (the only pale thing on it). No arms, legs or face. Feet on 0, drawn at 1.4 (`MODULE_SCALE.raider`). Neutral by value (four near-achromatic colours) so it never reads as a seat's figure beside the seat-tinted rider |
| `art/hexes/goldfield.blend` | `tiles/goldfield.glb` | Explorers: placer country on the hills' own ground, relief, rim and rocks, with the brickworks and kiln removed. A creek down the slope with worked banks, gravel bars in the mountains' scree, a riffle sluice, a windlass over a shaft, spoil, two prospect pits, one tent and the nuggets. Its chip socket stays empty: a pirate lair mounts there. The crews' ranks either side are kept clear (`lairArt.test.ts` measures every `LairSlot_<n>`) |
| `art/hexes/shoal.blend` | `tiles/sea_shoal.glb` | Explorers: open water with a bank in it. The ocean's own hull and wave sheet, plus a wet-sand flat with a shelf, three sand islands (wet skirt below the swell, dry cap above), six rocks awash, a school of fish and a marker buoy. Everything stands above the swell's crest. A fish haul lands at its middle. The flat and shelf are sand, not tinted water: `applyOceanLook` repaints the sea by material name, and `instanceAsset` merges every other material into one vertex-coloured draw, so a tile cannot carry water that follows the sea look |
| `art/hexes/spice.blend` | `tiles/spice.glb` | Explorers: a village on the pasture's own ground and rim. Five huts on a horseshoe open to the north, a drying rack, mats and heaps of spice, a well, a walled garden, sack piles, two of the forest's broadleaves, and a cleared 0.88 x 0.88 pad the spice sacks stack on. Every material is another shipped tile's |
| `art/hexes/council.blend` | `tiles/sea_council.glb` | Explorers: the Council, a walled town on a rock in open water on the ocean's own hull and wave sheet, its two quays running to the tile's +-y corners (`councilYaw` turns them onto the engine's anchors). Each quay ends in a stone pier-head carrying an iron anchor (`Council_pier`, `_pier_top`, `_anchor`, 296 tris), inside the 2.598 border. There are no code-drawn ring or anchor discs |
| `art/hexes/swamp.blend` | `models/tiles/swamp.glb` | the plain marsh, with no channel and no number: it is a river's estuary, which is why the robber starts on one. The full set is **nine channel shapes × four terrains, plus a second east-west meander per terrain, plus six mountains headwaters, plus the marsh: 47** hand-made, and twenty recipe-built forest and fields channels (rows below) |
| `art/hexes/river_hills_<shape>.blend` ×10 | `models/tiles/river_hills_<shape>.glb` | the hills family: the nine-shape table in ten files (the east-west straight ships only as its two meanders), the mountains' channel exactly, on a sharp zigzag line. Banks in the hills' wet clay, a ford on the straights, a cascade on every one |
| `art/hexes/river_mountains_<shape>.blend` ×16 | `models/tiles/river_mountains_<shape>.glb` | the mountains family: nine shapes named for the sorted compass pair of their two mouths, two variants of the east-west straight, and six one-mouth headwaters (a source hex is always mountains). Water 0.60 bank to bank, a meander on every one, and a chip rule that binds at the mouth |
| `art/hexes/river_pasture_<shape>.blend` ×10 | `models/tiles/river_pasture_<shape>.glb` | the pasture family: the same ten files and channel, on a lazy S. Banks in the pasture's wet mud, an intermittent wet collar, reeds, a ford on the straights and one sheep drinking |
| `art/hexes/river_swamp_<shape>.blend` ×10 | `models/tiles/river_swamp_<shape>.glb` | the swamp family, the river's mouth: the same ten files and channel, on the slowest line of the four. A silted estuary with mid-channel shoals, braided backwaters and lily pads at the bends, sedge on the banks, dead trees and tussocks clear of the water, cut in the marsh's silt under a bog lip. No ford |
| `art/recipes/trade_<ground>_<dir>.json` ×48 | `models/tiles/trade_<ground>_<dir>.glb` | recipe-built; no blend exports them. The Wagons market town on each of eight grounds (hills, forest, pasture, fields, mountains, desert, swamp, lake) facing each of six seaward directions, composed by `make compose-tiles` from the shipped base tile and the parts below. The recipe is the tile's source and carries only per-tile review fixes (`keep`, `drop`, `nudge`, `offset`); see "Recipe-built tiles" |
| `art/recipes/river_<forest\|fields>_<shape>.json` ×20 | `models/tiles/river_<forest\|fields>_<shape>.glb` | recipe-built: the pasture's faceted channel for each of the ten shapes, composed into the shipped forest and fields tiles, with banks in each ground's wet material and its heroes (seven conifers and the woodcutter; the farmstead, stooks and scarecrow) on spots authored per shape |
| `art/trade/parts.blend` | `art/trade/parts/*.glb`, `spots.json` (composer input; nothing ships) | the town layouts (`Town_W`, `Town_SW`, the unturned `Town_Tile` plaza), the six lake towns, and every hero anchor and spot per ground, direction and river shape. Exported by `tools/blender/export_trade_parts.py`; the contract is `spots.json` and `naming.py`'s `TRADE_*` |

**There is no face-down Explorers hex.** An unrevealed hex is hidden
information, not a terrain: the engine masks it to the wire-only `fog`
resource (`MaskBoard` in `engine/module.go`), and the renderer draws the
shipped blank slab (`tiles/generic.glb`) at land scale with a faceted cloud bank
built in code (`frontend/src/lib/board3d/layers/fog.ts`).

The goldfield, shoal and spice tiles are modelled by hand in the live Blender
session on top of the shipped tile each derives from; there is no generator.
`tools/blender/render_explorers.py` renders the stills from the blends.

**They are built out of the shipped tiles.** Each opens the tile it derives
from (`bpy.data.libraries.load`), keeps its `Hex_*` slab, ground sheet and
material split, rim and props, removes only what has to go, and builds the
feature in the space. The goldfield's and spice village's grounds are restored
vertex for vertex from `hills.blend` and `pasture.blend` and deformed only where
the creek and the village yard cut in. Missing colours come from other shipped
blends (the mine's water and timber, the beach's sand, the mountains' stone, the
harbour's canvas, the merchant's saffron). The only new colours are the shoal's
three, for shallow water over pale sand.

**Two things to know before opening one.** The water slab (`Hex_Shoal`, like
`Hex_Ocean`) ships with `hide_viewport` set: it carries a Bevel modifier, and a
hidden object is not in the depsgraph, so `make check-hexes` measures the raw
hexagon at 3.1443 rather than the bevelled 3.1292 the contract rejects. Un-hide
it to look, and hide it again before saving. And `Ocean_waves`/`Shoal_waves`
carries a basis translation that cancels its parent inverse; zeroing the child's
location throws the sheet ten units off its tile.

`tools/blender/render_explorers.py -- OUTDIR pairs` photographs each tile
beside the shipped one it is made of and beside a neighbour it must not be
mistaken for, through the game camera, as `pair_*.jpg`. Check every change
there.

`art/board.blend` is not in the table: it is the tiles linked into one assembly
for viewing, an output of `make board`. `art/robbers.blend` is generated from
`robber_designs.py`.

`art/hexes/oasis.blend` is generated from `tools/blender/gen/oasis.py`; do not
model in it, as the next run overwrites it. Its pond is a recess: the water
sheet sits at 0.190, so the slab's opaque top face at 0.220 is cut around the
pond. The pond is the shared lattice's own triangles (see "Ground features are
lattice triangles"). Nothing `hexcontract` measures moves.

It carries `Oasis_rim`: the desert's profile reproduced ring for ring, cutbank
included, in the oasis palette (desert sand is warmer and more saturated, and
appending the desert's materials would ring this tile in another's edge).
`Mat_Oasis_gravel` exists only on that cutbank.

The profile is in that script's header, and `audit()` re-measures the contract
from the built mesh, rim included, before saving.
`tools/blender/render_oasis.py` writes the frames under
`art/prototypes/oasis/`, including `pair_desert.jpg`: the oasis beside the
desert sharing a gutter, which shows a missing border clearly. To see it through
the real three.js renderer, use `frontend/dev/board-shot.mjs` with
`frontend/dev/board-shots.tsx` temporarily pointed at a Caravans view so the
fixture's desert draws as the oasis (do not commit that patch: the harness is
shared and its fixture is a base board).

## Two merchant stalls

`trader.glb` is a bright funfair kiosk: cyan trim and counter, a red-and-white
awning, an orange pennant, ten materials, 372 faces, and 1.63 tall drawn (half
again a drawn knight). Its footprint reaches inside the number chip's 1.05
keep-clear on its hex. Next to the figure family (the `family` frame of
`render_barbarians.py`) it reads as a different set.

`trader_v2.blend` is the same stall rebuilt in the house vocabulary, keeping the
stall silhouette, the striped awning, and the accent colour muted to a weathered
teal on the counter and the awning's two beams. Five warm materials, 113 flat
faces, 1.095 tall drawn (level with a knight), clear of the chip disc.

**Only `trader.glb` is drawn.** Both are exported so they can be compared on a
board. `frontend/src/lib/board3d/traderArt.test.ts` measures the candidate
against the shipped one's contract (base at zero, hex centre at
`MODULE_SCALE.merchant`, clear of the chip) and checks that no ruleset fetches
it. To switch: swap the file and prefix at the two call sites in
`TRADER_CANDIDATE`'s note, then delete the other blend, its `.glb`, its palette
entries and its line in `tools/blender/export_assets.py`'s FAMILIES.

The prefixes are `Trader_merchant` and `Trader2_merchant`. The digit placement
matters: `subsetByPrefix` and the exporter match on a string prefix, so
`Trader_v2_*` would be picked up by every `Trader_` call site.

## Photographing a piece against its neighbours

`tools/blender/render_pieces.py` opens no blend. It appends each piece from the
file that ships it and stages several families in one frame. Modes, each
writing into the family's own `art/prototypes/<family>/`:

    blender --background --factory-startup --python tools/blender/render_pieces.py \
        -- art/prototypes/camels pair camel     # the frame a change is decided on
        -- art/prototypes/camels hero camel     # 1024 square, neutral grey
        -- art/prototypes/camels board camel    # three of it, where a board puts them
        -- art/prototypes lineup                # every piece, one frame
        -- art/prototypes/before-after before camel OLD.glb   # what changed

**Decide on the pair frame.** A hero shot flatters everything; the real
questions are comparative (does the wagon disappear under the settlement on its
junction, is the camel a smooth loft beside the rider's boxy horse). `pair`
stages the subject beside a settlement, a road and a knight, each at the
client's factor (`PIECE_SCALE`/`MODULE_SCALE` in
`frontend/src/lib/board3d/pieceArt.ts`), through the board camera: 32 degrees
vertical FOV at 56 degrees elevation. It also writes a 28-degree frame, since
56 flattens a silhouette and a piece has to survive both.

Every piece is placed by its own bounding box rather than its object transform,
because the blends are showcases: an appended `Knight_basic` arrives 38 units
from the origin and a trader stall 22 the other way.

**`before` takes an old `.glb` and puts it on the next tile.** The old art comes
out of git:

    git show <sha>:frontend/public/models/camels.glb | git lfs smudge > /tmp/old.glb

(`git lfs smudge` is needed because the models are in LFS and `git show` alone
gives a 130-byte pointer). Blender reads a shipped `.glb` directly, meshopt
compression included, with names as the loader sees them. Both halves of the
frame get the same tile, reference pieces, light, camera and anchoring; only the
mesh and, if it changed, the client's draw factor differ.

## The generated blends

Rows marked "Generated" in the table are overwritten by the next run of their
generator, so edit the script, not the blend. These pieces are dozens of blocks
whose proportions take several tries, and a number in a script can be diffed and
reverted where a binary edit cannot. Change the generator, re-run it, then
`make export-assets`, then re-shoot that family's frames.

**Riders** (`tools/blender/gen/riders.py`):

    blender --background --factory-startup --python tools/blender/gen/riders.py

then `make export-assets`, then re-shoot `art/prototypes/riders/` with
`tools/blender/render_riders.py` (three zooms at two bearings).

**Wagons** (`tools/blender/gen/wagons.py`). The wagon's shape is two dozen named
constants at the top of the script; its bpy-free half is unit-tested by
`tools/blender/test_wagons.py` (winding, envelope, face budget), and the shipped
`.glb` is measured by `frontend/src/lib/board3d/wagonArt.test.ts`.

`frontend/src/lib/board3d/layers/wagons.ts` draws it seat-tinted on an
intersection at `MODULE_SCALE.wagon` of 1.5, ringed at 0.22 / 0.38 / 0.47
authored units (multiplied by that factor) when two, three or four share one
corner, each yawed outward along its radius. Shoot a real game with
`BOARD_SHOT_VIEW=/dev/board-shots.wagons.view.json node frontend/dev/board-shot.mjs`.

The factor is 1.5 because the wagon was sized against a settlement's authored
envelope (wagon 0.551 x 0.35 x 0.45, house 0.470 x 0.440 x 0.40) and a
settlement is drawn at 2. `render_wagon.py --scales` writes one frame per factor
(`junction_scale_{10,15,20}.jpg`) rather than a row, because at 56 degrees
elevation position also changes apparent size.

**Known issue: the `city_setup.jpg` frame.** "Each player places their wagon on
their round-2 city's intersection" (`docs/rules/wagons.md`), and `planWagons`
puts a lone wagon at radius 0, inside a city drawn at 2.58 that reaches 0.76
from that point, so the wagon is hidden. The fix is a radius for the `n = 1`
case in `layers/wagons.ts` (clear of a city is about 0.95 out, a third of the
way down an edge), not a scale.

**The trade hex draws a market town**, on the ground the hex keeps and facing
its seaward half: forty-eight recipe-built tiles (see "Recipe-built tiles"),
selected by `tradeTileOverrides` in `frontend/src/lib/board3d/layers/wagons.ts`.
`art/hexes/castle.blend` is the Raiders castle, a different building on a
different hex.

**Bridges** (`tools/blender/gen/bridges.py`). Open the blend to look and
measure; edit the script and re-run it:

    blender --background --factory-startup --python tools/blender/gen/bridges.py
    make export-assets

An arch is a formula: its roadway, soffit and both parapets must agree at every
station. The script's constants (`ARCH_HALF`, `ARCH_RISE`, `DECK_RISE`) are the
piece's interface. `tools/blender/render_bridges.py` photographs the bridge on
the board beside a road and a settlement in the same seat colour (to check the
pieces are distinguishable), plus a studio `hero.png` at low elevation, where
the arch reads as a hole.

**Castle** is hand-modelled; there is no `gen/castle.py` (see below).

**Cargo** (`tools/blender/cargo_kit.py` via `gen/cargo.py`):

    blender --background --factory-startup --python tools/blender/gen/cargo.py

Three pieces in one file, an exception to one-blend-one-asset, because they
share a vocabulary and no module draws them yet (`loader.ts` lists `cargo.glb`
under `EXPLORERS_MODELS` and nothing else references it). Its envelope is a
contract with the vessels (the 0.34 x 0.18 hold recess):
`tools/blender/test_cargo_kit.py` holds the envelope and
`frontend/src/lib/board3d/cargoArt.test.ts` holds the shipped `.glb` to it.
Re-photograph with `tools/blender/render_cargo.py` (see its docstring).

**Barbarians are not generated**; there is no `tools/blender/gen/barbarians.py`.
Every shipped figure is a turned solid (the knight is one mesh, the settler and
crew three, none with limbs or a face), so the raider was modelled by hand
against the knight, settler, crew and rider. See "The barbarian" below.

**The Rivers tiles are not generated**, and there is no `make rivers`. They
were modelled in the live Blender session on a generated ground, rim and slab.
The channel has a per-station, per-side lip, a brink dropping 2 to 5 cm off an
apron lying on the ground, and an outer bank narrowed to a cutbank on the bends.
The water is five columns of varying width with a dark thalweg. Each channel
has an intermittent wet margin, one or two gravel bars, bank rocks with their
feet in the water, and a wet-sand fan at each mouth. Each terrain's props are
the shipped tile's own meshes, appended, split at loose parts and re-placed
clear of the water: `Pasture_farm`, `_wall`, `_hedge`, `_pond` and the flock;
`Hills_kiln`, `_brickworks` and `_terrainprops`; `Mountains_massif`, `_scree`
and `_slopes`. The mountains river drops over a ledge with a foam apron, and
straight tiles have a ford of stepping stones. Only the swamp's dressing is
built new (it has no shipped tile to derive from): dead trees, dark pools with
lily pads, tussocks, and a pale sedge (`Mat_Swamp_sedge`) in place of mist.
Each terrain's straight tile is the master, and its bends re-run the same recipe
on their own channel.

Two river hexes meet mouth to mouth with the gutter's 0.25 of sand between
them, and the water cannot cross it: `gapGeometry.ts` fills the gap at z 0.220,
above the surface. The fans make the joint read as one river and mark the
bridge site; the `board_crossing_*.jpg` frames show it.

River tiles are the only ones whose slab is not 12 verts and 8 faces: the
corridor is cut out of the top face, because the water sits at 0.190 and would
otherwise be buried under the slab's 0.220 top. Each carries its own
`<Terrain>_rim` (see "Terrain rims"). The ground stops at the rim's inner edge,
and the rim runs the whole way round including both mouths: the channel's last
0.125 passes under the border rather than through it, because a hole out over
the gutter's underlap z-fights the sand. The apron is lifted a few millimetres
where it overlaps the ground and tapered to nothing at the mouths, where the lip
lands on the rim's 0.2205; `riverArt.test.ts` holds a bridge deck against it.

**A river tile's rim is the base tile's rim, appended**, as `Castle_rim` is
`Pasture_rim`. `river_hills_*` rims measure 0.349 luminance against
`brick.glb`'s 0.352, `river_pasture_*` 0.445 against `sheep.glb`'s 0.449. All
sixteen `river_mountains_*` wear `Mountains_rim`, appended from
`art/hexes/mountains.blend` and renamed, with their ground's outer ring levelled
onto the rim's inner edge at 0.290 and repainted from the ore tile's own ring.
The rims measure identically to `ore.glb`: luminance 0.365, area 2.735, 336
triangles, `rock_mid` 33% / `rock_dk` 32% / `rock_lit` 14% / `scree_dk` 14% /
`shale` 4% (the outline band) / `moss` 3%. `Mountains_rim` matches the river
tiles' inner shell exactly (42 vertices at apothem 2.4731, all at 0.290), so the
mouths are unchanged: the channel's last 0.125 passes under the border and the
water meets the boundary at 0.2205. The rim costs 84 triangles a tile; `src_e`
and `src_w` stay under `riverArt.test.ts`'s 4000 by dropping collinear vertices
from their ground's flat boundary loop (3987 each).

Shoot the tiles on a real board through the shipping renderer into
`art/prototypes/rivers/`. A river is a property of the joints (whether the water
lines up across the gutter, whether bends follow the chain, whether the swamp
reads as the end, whether every number is clear of the water), which a single
tile frame cannot show. Dump real games rather than hand-built boards:

    rm -rf art/prototypes/rivers && mkdir -p art/prototypes/rivers
    for seed in 20260902 20260903; do
      go run ./cmd/costan-sim -players 4 -ruleset base+rivers -seed $seed \
          -dump-view frontend/dev/board-shots.rivers.$seed.view.json
      BOARD_SHOT_FIXTURE=/dev/board-shots.rivers.$seed.view.json \
          BOARD_SHOT_BEARINGS=0,120 BOARD_SHOT_ZOOMS=0,4 \
          node frontend/dev/board-shot.mjs /tmp/rivershot
      for f in /tmp/rivershot/*.jpg; do
        mv "$f" "art/prototypes/rivers/seed-$seed-$(basename "$f")"
      done
    done

(The rename is needed because `board-shot.mjs` names frames by bearing and zoom
only, which collides across two boards.)

Two seeds, because one seed can deal a river that runs straight east-west, and
two show that the chain bends and the shapes vary. Two zooms: the framed board
shows the river reads as a river, the close one that every number it passes is
readable. `riverArt.test.ts` measures that clearance from the `.glb` files.

Use `-dump-view`, not `-dump-board`: the watercourse is derived state in
`EvBoardGenerated`'s ext blob, so a board-only dump has no river.
(`BOARD_SHOT_PORT` moves the dev server if another checkout is shooting on
6788.)

`tools/blender/render_rivers.py` photographs them from the blends. Subjects are
`family_mountains|family_hills|family_pasture|family_swamp|family_all|board|detail`,
all seven by default:

    blender --background --factory-startup \
        --python tools/blender/render_rivers.py \
        -- art/prototypes/river-tiles [family_swamp|family_all|board|detail]

`family_<terrain>` shows that family's tiles through the game lens from +y
(the side the number is on after the half turn every tile takes), with a chip on
every socket. Six of the nine shapes run past the chip, so this is the frame to
check.

`family_all` puts all forty-six channelled tiles on one sheet at roughly board
size, to check that four terrains and nine shapes read as one river. The
channel section is identical on all of them, so the differences (the mountains
sweep, the hills kink, the pasture meanders, the marsh crawls) are intended, and
a drifting family shows up as the odd row.

#### River kit

**One file per shape, and no yaw.** The number chip does not turn with a tile:
`layers/chips.ts` mounts every disc at one fixed tile-local spot, `(0, +1.5)` in
the blend frame, where each tile's `Token_*` socket sits. A yawed channel could
therefore run through the number, and `make check-hexes` would not notice,
because it measures keep-clear against the tile's own socket, which turns with
the tile. So every shape has its own file, drawn at `TILE_ROTATION_Y` with no
yaw. The rules allow a mouth on the two edges either side of the chip: such a
mouth sits **1.500** from the chip mount against a keep-clear of 1.05 plus half
the channel. See `docs/rules/rivers.md`, "Six-direction stepping".

#### The three frames

Getting these wrong mirrors the board without any single axis looking wrong.

| frame | used by | where the chip is |
|---|---|---|
| **board** (glTF, y-up, board in XZ, +z toward the viewer) | `coords.ts`, the engine's compass names and shape ids | `(0, +1.5)` |
| **analysis** (`x` = board x, `y` = -board z, so +y is north on screen) | the clearance numbers below | `(0, -1.5)` |
| **art / blend** | the `.blend` files, `hexcontract.SOCKET_OFFSET` | `(0, +1.5)` in blend (x, y); `(0, -1.5)` in the exported glTF |

Conversions:

- analysis `(x, y)` -> exported glTF `(x, z) = (-x, y)`
- analysis `(x, y)` -> Blender `(bx, by) = (-x, -y)` (a 180-degree turn)
- **board direction `d` -> Blender edge at angle `180 + 60d`**: E=180, NE=240,
  NW=300, W=0, SW=60, SE=120. The chip is at blend 90 degrees, flanked by blend
  60 and 120, which are board **SW and SE**.
- A tile is laid down at `TILE_ROTATION_Y` (a half turn), so **art edge `e` lands
  on board direction `e + 3` (mod 6)**. Board direction indices are the engine's:
  `E=0, NE=1, NW=2, W=3, SW=4, SE=5`.

#### The shape set: 47 files

Shape ids are the engine's: the two mouth directions in the board frame, sorted
by direction index. `art edges` are the glTF edge indices to cut the channel on
(`= board direction + 3, mod 6`), and `blend deg` is the same as an angle in the
Blender viewport with the chip socket at +y.

| # | shape id | mouths (board) | kind | art edges | blend deg | detour | mirror of | terrains | tiles |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `e_w` | E, W | straight | 3, 0 | 180, 0 | none | self | mt/hl/pa/sw | 8 (two meanders) |
| 2 | `ne_sw` | NE, SW | straight | 4, 1 | 240, 60 | 63 deg west | `nw_se` | mt/hl/pa/sw | 4 |
| 3 | `nw_se` | NW, SE | straight | 5, 2 | 300, 120 | 63 deg east | `ne_sw` | mt/hl/pa/sw | 4 |
| 4 | `ne_w` | NE, W | bend 120 | 4, 0 | 240, 0 | none | `e_nw` | mt/hl/pa/sw | 4 |
| 5 | `e_nw` | E, NW | bend 120 | 3, 5 | 180, 300 | none | `ne_w` | mt/hl/pa/sw | 4 |
| 6 | `e_sw` | E, SW | bend 120 | 3, 1 | 180, 60 | 98 deg west | `w_se` | mt/hl/pa/sw | 4 |
| 7 | `w_se` | W, SE | bend 120 | 0, 2 | 0, 120 | 98 deg east | `e_sw` | mt/hl/pa/sw | 4 |
| 8 | `ne_se` | NE, SE | bend 120 | 4, 2 | 240, 120 | 17 deg east | `nw_sw` | mt/hl/pa/sw | 4 |
| 9 | `nw_sw` | NW, SW | bend 120 | 5, 1 | 300, 60 | 17 deg west | `ne_se` | mt/hl/pa/sw | 4 |
| 10 | `src_<d>` | one mouth | headwater | `d`+3 | 180+60`d` | none | 3 pairs | **mountains only** | 6 |
| - | plain marsh | none | - | - | - | - | self | swamp | 1 |
| | | | | | | | | **total** | **47** |

File names are `river_<terrain>_<shape>.blend`, with `river_<t>_e_w_a` and
`river_<t>_e_w_b` for the two east-west meanders and
`river_mountains_src_<direction>` for the six headwaters. The renderer's table
is `frontend/src/lib/board3d/layers/rivers.ts`, and `layers/rivers.test.ts`'s
"the art owed is nothing" test fails if any of the 47 is missing. There is no
fallback to a nearest shape: a missing file fails rather than drawing a
plausible wrong river.

**Detours.** Seven of the nine shapes bend round the chip, `e_sw` and `w_se`
most, because the straight chord between their mouths passes through the chip
mount. The detour is 15 to 26% longer than the chord with a 60 to 100 degree
sweep. `{SW, SE}` cannot be authored: its only route is a 126-degree loop over
the number, 69% longer than the chord, and the engine never asks for it.

Mouths land on the edge midpoint to 1e-3 (measured: 2.4e-5 and 3.8e-5). The
water is bounded by the 1.05 keep-clear, and `riverArt.test.ts` asserts the
bound on every one of the forty-six channels. On the six shapes touching SW or
SE the mouth is at 1.500 and the widest admissible centreline tops out at 1.461,
so the bound binds. The bank may enter the keep-clear where it is flattened at
or below the chip's underside (`hexcontract.CHIP_UNDERSIDE_Z`).

**Amplitude.** A river should change direction three or four times inside one
hex; one smooth bow per tile makes a five-hex reach look like the same tile five
times. A straight channel's centreline at mid-hex can use `y` in [-0.24, +2.75],
so a meander of +/-0.5 about the axis is nowhere near the walls.

**Mirrors are real reflected geometry**, never a negative scale (which flips
winding, breaks the flat-shaded normals and takes the tile off the instancing
path) and never a rotation (no turn of `{0, 240}` is `{180, 300}` with the
mouths in order). Each mirror is its original reflected through `x = 0` with
every face's winding reversed, which puts the normals back outward exactly;
normal recalculation is not used, since it guesses on open sheets like the water
or the fan. `Token_*` is on the axis and the hexagon is its own mirror.

**Handed props are turned by hand.** A mirror-image building is visibly wrong.
If the original faces theta, its mirror faces 180 - theta, so the original mesh
turned by 180 - 2*theta about its own centre lands where the mirror put it. The
pasture's barn takes that turn (door at 135 degrees, so -90) plus a nudge of
(-0.35, 0, -0.044) to sit back in its hollow inside the rim. The hills do the
same for the kiln only; the brick racks and spoil are stacks. The mountains and
the marsh have no handed props; the waterfall mirrors with the channel.

**The kit**, measured off the original pasture river and held on every river
tile by `riverArt.test.ts` (the re-cut families widened the channel and water;
see the next section):

| | value |
|---|---|
| channel at the mouth, bank to bank | **0.50** |
| water sheet at the mouth | **0.42** (0.25 either side of the axis) |
| water surface | **0.193**, dropping to **0.1867** in the dark thalweg column |
| channel bed | **0.072** |
| wet margin band | foot **0.2825 to 0.2926**, head follows the bank (steepest shipped: 0.4273, the mountains straight) |
| gravel bars | **2** per tile, in the mountains' scree material |
| bank rocks | **3 to 5**, feet in the water |
| mouth fans | **one `_fan` mesh** reaching both mouths, `Mat_River_shingle` |
| reeds / sedge | pasture and marsh only |
| ford | the straights only, 5 stones |
| rim | unbroken; the channel's last **0.125** passes under it |
| materials | `Mat_River_water`, `Mat_River_water_dk`, `Mat_River_bed`, `Mat_River_shingle` on every channel |

The `family_<terrain>` sheets `render_rivers.py` writes show every tile of a
family from the side the number is on, with a chip on every socket. A `pair_*`
frame photographs a tile from the side the chip is not on.

#### The mountains: nine shapes, wider water, a meander

Sixteen mountains tiles, modelled live on the original `river_mountains.blend`:
its ground, rim, slab, peaks, scree, conifers, bank rocks, gravel bars, ford
stones and waterfall ledge, moved off the new line and re-seated. Nothing was
modelled fresh.

| | original channel | re-cut |
|---|---|---|
| water, bank to bank | 0.42 | **0.60** |
| channel at the slab's top face | 0.50 | **0.70** |
| mouth pairs available | 3 of 15 | **9 of 15**, plus one-mouth headwaters |
| the channel's line | one smooth bow, 0.34 off the axis | three or four changes of direction inside the hex |
| nearest water to the chip mount | 1.841 / 2.051 | **1.05**, the keep-clear exactly |

0.42 is 8.7 CSS pixels at zoom 0 (1600x1000, 32-degree FOV, 56 degrees
elevation, foreshortened by sin 56), which reads as a thin pipe; 0.60 is 12.4.
The tightest mouth is 1.500 from the mount, so water up to 2 * (1.500 - 1.050)
= 0.900 wide still clears the keep-clear there.

All four families are cut to this one section, and nothing on the 0.42 section
remains, so river hexes of any terrain meet mouth to mouth with no step.

**The chip rule splits in two**, and `riverArt.test.ts` asserts both: the water
keeps the whole 1.05 keep-clear, so no number is drawn over water; the bank may
enter it at or below the chip's underside, flattened into the apron the disc
stands on (`hexcontract.CHIP_UNDERSIDE_Z`). `make check-hexes` measures it on
all sixteen.

**Mirrors** follow the rule above. The only handed props are `_tree_03` and
`_tree_05`, which wear a moss-and-scrub skirt on one side; the copy is turned by
`180 - 2*theta` using the skirt's measured bearing. `riverArt.test.ts` holds
each of the eight mirror pairs to a water footprint that is its original's
reflection to 1e-3.

**Headwaters.** Six tiles (three originals plus three mirrors) where a river
begins at a mountains source: one mouth, no bridge site on any other edge. The
rules currently run rivers coast to coast, so this art is ahead of the rules.
Each has a tarn at the head, a stem at the full 0.60, and three dry washes
running out into the scree (see the faceted re-cut below for how the tarn and
washes are built). One body of water reaches the one mouth. Rules that still
hold from the hand-modelled pass:

  * The number chip's disc as drawn (0.881) is a tighter bound than the
    keep-clear: on `src_ne` and `src_sw` the ground's boundary is pulled back to
    0.955 from the chip mount and the apron clipped to 0.900.
  * `bankrock_02` (`src_sw`) and `bankrock_05` (`src_ne`) stand on the shore,
    the second 2.10 from the chip mount. The `_margin` ledge is trimmed to the
    last station that clears open water.
  * Mirrors reflect `_water`, `_channel`, `_margin`, `_ground`, the slab and the
    moved bank rocks wholesale (`riverArt.test.ts` bounds the pair at 1e-3);
    handed props (`_tree_03`, `_tree_05`) are not reflected.

There is no generator for any of these. They were authored in the live session
against the measured kit: the cross-section is the original straight's profile
scaled by 0.60/0.42, the relief is sampled from `river_mountains.blend` and
`mountains.blend` and deformed only within 0.73 of the water, and every prop is
a shipped mesh moved off the channel and re-seated. Each original was cut and
checked one at a time; the mirrors are reflections.

#### The hills: the same channel, a sharp zigzag

Ten hills tiles, cut to the mountains' channel exactly and drawn on a different
line. The channel is the seam between hexes of different terrain, so it is
fixed: water 0.60 bank to bank, a 0.70 cut at the slab's top face, mouths on the
edge midpoints, and the bank at a mouth at 0.2205 so a bridge deck lies flat on
both. `riverArt.test.ts` measures every family against one master and against
the absolute numbers, so two families cannot agree by both drifting.

**What differs is the line.** Each terrain has its own: a sharp zigzag through
the hills, a lazy S through the pasture. These turn **80 to 105 degrees at a
corner**, filleted to 0.45 (the tightest a 0.70 cut can turn before the inside
bank folds through itself). Four or five changes of direction inside the hex,
amplitude about +-0.5, biased south because the chip is north: at mid-hex the
centreline may not come above y = +0.15 and keep the water outside the 1.05
keep-clear.

| | original hills | re-cut hills |
|---|---|---|
| water, bank to bank | 0.42 | **0.60** |
| the channel's line | one bow, 0.34 off the axis | four or five kinks, +-0.5 |
| nearest water to the chip mount | 1.841 | **1.060** (the bound is 1.05) |
| mouth pairs | 3 of 15 | **9 of 15**, ten files |

**Ten files for nine shapes.** `engine/rivers` ships the east-west straight as
two authored meanders and picks between them (`riverTileKey`, `EWVariants`), so
it is `river_hills_e_w_a` and `river_hills_e_w_b`, with no plain
`river_hills_e_w`. There are no hills `src_*`: `engine/rivers.paint` writes
mountains at every source hex.

**Built from the shipped hills.** The ground is `hills.blend`'s lattice with
`river_hills.blend`'s sheet laid over it wherever that sheet has vertices,
because the props were authored on the river sheet (the kiln stands on a mound
the plain tile lacks). The corridor is cut out of that field with the channel's
lip welded in and a shoulder loop 0.28 further out, and nothing is deformed
beyond 1.18 of the water. The rim, kiln, brickworks, kiln yard, spoil and scrub
are `river_hills.blend`'s meshes, kept in place where the new line leaves room
and moved to the nearest clear spot where it does not. Banks are cut in
`Mat_Hills_clay_wet`.

**Two gotchas.**

The hills sheet has **clay cones**: a single lattice vertex raised most of a
unit above its six neighbours. Cutting the corridor through a cone's base ring
leaves its apex standing, and the triangulation joins it to the nearest vertex,
giving a needle in the water. An apex whose ring the channel broke is set back
down, and a vertex the triangulation invents where two constraint edges cross
takes its height from the nearest input vertex rather than the relief.

The rim's mouth is **marked, not cut**. A rim dropped flat at a mouth stops
being a chamfer (it must climb 0.020 from outer to inner edge) and fails
`check-hexes`. The channel's last 0.125 passes under the rim instead. The mark
is in **`Mat_Hills_clay_dk`, not the wet clay**: `hexcontract` accepts a rim's
lip as geometry or as a material confined to the outer 0.020, the hills rim
passes on the material, and `Mat_Hills_clay_wet` is that material (apothem
[2.5968, 2.5981]). Using it for the mark would spread it across the chamfer and
remove the shadow line that draws the tile's edge.

**The kit holds, with one addition.** Two gravel bars, three to five bank rocks,
one mouth-fan mesh, no reeds. The ford (five stones) is on the straights only
(`e_w_a`, `e_w_b`, `ne_sw`, `nw_se`), where a track would cross. Every tile adds
a **cascade**: a rock lip across the channel with the water surface stepping
down over it. `riverArt.test.ts` asserts both the ledge and the step.

**Mirrors**: five of the ten (`e_w_b`, `nw_se`, `e_nw`, `w_se`, `nw_sw`). The
only handed prop is the kiln, whose firing mouth is its soot face; it is turned
by `180 - 2*theta` using the measured bearing and re-seated.

No generator; the blends are the source. `tools/blender/render_rivers.py --
OUTDIR family_hills` re-shoots the sheet; `pair_recut_hills`,
`pair_recut_hills_bend` and `pair_mirror_hills_recut` under `detail` compare
them with the plain hills tile they share ground, rim and props with.

#### The pasture: the same channel, a lazy S

Ten tiles on the same shape table and section (the seam rules above).

**The line sweeps**: two or three changes of direction inside the hex,
amplitude about +-0.5, corners filleted at **1.00** (the widest the polyline's
leg lengths allow). Where a pair needs a detour round the chip, the meander is
the detour. The nearest water is **1.060** from the mount against a bound of
1.05, binding on the four shapes that touch SW or SE.

| | original pasture | re-cut pasture |
|---|---|---|
| water, bank to bank | 0.42 | **0.60** |
| the channel's line | one bow, 0.34 off the axis | two or three sweeps, +-0.5 |
| nearest water to the chip mount | 1.841 | **1.060** (the bound is 1.05) |
| mouth pairs | 3 of 15 | **9 of 15**, ten files |

**The bank is low.** The section is fixed at the mouth, so a family's character
is in the bank inland. A meadow river's bank is a lip a hand's breadth above the
water with the field sloping down to it; raising the lip to field height (as the
mountains and hills do) climbs 0.12 over the outer 0.042 and reads as a milled
groove. The lip is clamped to 0.238..0.272 inland, and a shoulder loop 0.34
further out carries the rise.

**The wet ground is intermittent.** A margin at a fixed width along a smooth
curve is another smooth groove. The margin strip and the turf's mud collar
follow one slow wave down the reach, out of phase on the two banks, vanishing
three or four times inside the hex. Measured as the wet fraction of the bank:
these are 0.50 to 0.59; `river_hills_e_w_a` is **1.000** (one unbroken strip a
side). `riverArt.test.ts` asserts the bound and uses the hills' strip as the
negative control.

**Built from the shipped pasture.** The ground is `pasture.blend`'s lattice with
`river_pasture.blend`'s sheet laid over it where that sheet has vertices, as for
the hills. The rim is `Pasture_rim`, ring for ring. The barn, haystack, gate,
pond, field wall, hedge, flock of eight and reed clumps are
`river_pasture.blend`'s meshes, moved off the new line and re-seated.

**Gotchas:**

The rim's mouth is marked, not cut, as on the hills, in `Mat_Pasture_dirt`
rather than the mud: the pasture rim passes `hexcontract`'s lip check on
`Mat_Pasture_mud` (the constant's docstring names it), and marking the mouth in
it would remove the edge's shadow line.

**A rigid prop seated by its centre gets buried on falling ground.** Every prop
is dropped by its centre and then raised until no vertex is under the ground
beneath it.

**`hide_render` survives the write.** The live session's render helper hides
everything it is not photographing, so a tile saved right after a still carries
the flag. It still exports a correct `.glb` and passes `make check-hexes` (which
walks the depsgraph), but renders as an empty grey frame in later stills. The
relink pass clears it on every tile.

**So do suffixed material names** like `Mat_River_shingle.015`. A live session
that has appended many tiles brings later ones in with suffixed materials, and
`libraries.write` saves them. Everything still passes, but `palette.json` is
keyed on the material name, so that tile silently stops being restyled.
`riverArt.test.ts` catches the three river materials by name and nothing
catches the rest. The relink pass strips the suffix, merges onto the unsuffixed
datablock, and asserts none is left.

**Measure a prop on its vertices, not a bounding circle.** The barn is 0.86 by
0.92; a bounding circle puts its corner 0.85 into the meadow and reports it as
standing in the river. Where a shape leaves the barn nowhere to stand, each tile
names its own farmyard rather than taking the nearest free slot, which would put
the barn in the same corner on every tile.

**The wall and hedge are lines.** A member the channel crosses is dropped and
the survivors renumbered from 01, so a wall runs down to the water and stops.
`riverArt.test.ts` asserts `_wall_01` and `_hedge_01` but no count.

**The kit holds, with one exception and two additions.** Two gravel bars, three
to five bank rocks, one mouth-fan mesh, the ford on the straights only (five
stones: `e_w_a`, `e_w_b`, `ne_sw`, `nw_se`). No cascade. Added: **reeds and
sedge on the banks**, at least four clumps a tile, placed on the bank; and **one
sheep drinking** on the outside of a meander. **No footbridge**: a bridge is a
piece a player builds (2 brick and 1 lumber) on one of seven building sites, so
a modelled one would show a bridge nobody paid for. `riverArt.test.ts` asserts
there is no `_bridge` mesh.

**Mirrors**: five of the ten (`e_w_b`, `nw_se`, `e_nw`, `w_se`, `nw_sw`). The
only handed prop is the barn, whose door end is the painted boarding
(`Mat_Pasture_barn`, measured at 131.7 degrees); it is turned by
`180 - 2*theta` and re-seated.

No generator. `tools/blender/render_rivers.py -- OUTDIR family_pasture`
re-shoots the sheet; `pair_recut_pasture`, `pair_recut_pasture_bend` and
`pair_mirror_pasture_recut` under `detail` compare them with the plain pasture
tile.

#### The swamp: the same channel, a slow estuary

Ten tiles on the same shape table and section. `riverArt.test.ts` measures all
**forty-six** channelled tiles against one master and the absolute numbers.

The old names are gone: `swamp_river.blend`, `swamp_river_bend.blend`,
`swamp_river_bend_m.blend` and their `.glb` files and `naming.py` keys are
deleted, along with the other nine tiles on the old naming. The engine speaks
shape ids (the old straight is `e_w`, bend `ne_w`, mirrored bend `e_nw`).
`riverArt.test.ts` asserts none of the thirteen old keys is in the manifest.

**The swamp is the estuary.** The marsh is the river's mouth: the water bends
through it into the sea, it carries no number, and the robber starts there. So
this is the slowest reach: two long slack sweeps filleted at 1.00 to 1.05,
amplitude about +-0.6, biased south. Where a pair needs a detour, the meander is
the detour; nearest water to the mount is **1.060** against a bound of 1.05.

| | original swamp river | re-cut swamp |
|---|---|---|
| water, bank to bank | 0.42 | **0.60** |
| the channel's line | one bow, 0.34 off the axis | two slack sweeps, +-0.6 |
| nearest water to the chip mount | 1.841 | **1.060** (the bound is 1.05) |
| mouth pairs | 3 of 15 | **9 of 15**, ten files |
| ford | 5 stones on the straight | **none** |

**No number, but the chip rule still binds.** The robber stands at the chip's
spot (`integrate/expansions`, "the robber always stands at the chip's spot") and
starts on a swamp. So the water keeps the whole 1.05, the bank inside it stays
at or below the chip's underside, and `family_swamp.png` is shot with a disc on
every socket, standing in for the robber.

**Silting.** The cut widens inland (0.350 at the mouth to 0.394 at mid-hex)
while the water stays 0.60, so the bank is a wide slack shelf of silt. The kit's
two gravel bars are **mid-channel silt shoals** in `Mat_Swamp_mud`, seven
stations long and barely breaking the surface; the three to five bank rocks are
**peat hags** in `Mat_Swamp_peat`. The water surface is mottled with patches of
`Mat_Swamp_pool` through the river's two blues, as on the plain marsh
(`Swamp_River_water` put that material on 62 of its 140 faces).
`Mat_River_water` is still on every tile: the palette is keyed on the name, and
one water makes four terrains one river.

**The top of the bank is bog, not silt.** A cut in one brown from water to lip
draws a hard dark outline down both sides at board zoom. A marsh is vegetated to
the waterline, so the outermost column of the section is `Mat_Swamp_bog_dk` and
silt is only the wet part. The wet margin is `Mat_Swamp_silt_dk` and is
intermittent: 0.50 to 0.65 of the reach, the wettest of the four.
`riverArt.test.ts` keeps `river_hills_e_w_a`'s 1.000 as the negative control.

**The mouth's mark on the rim is `Mat_Swamp_bog`.** The swamp rim's cutbank
measures 0.0135, under the 0.020 floor, so it passes `hexcontract`'s lip check
on the material alone, `Mat_Swamp_silt_dk` (apothem 2.5968 to 2.5981 only).
Marking the mouth in silt would spread it across the chamfer and lose the edge.

**Dressing.** Four dead trees, six tussocks, twelve sedge clumps and two pool
lenses, each a mesh from `swamp_river.blend` moved onto the new line: trees and
tussocks moved off the water, six sedge clumps pinned on the bank (sedge grows
where the ground is wet) and four out in the bog. The two pools are placed
first, as backwaters in the crook of a bend (the slack inside of the turn),
using each station's curvature to pick the side.

**Lily pads** are the one new prop: three rafts of four flat leaves, on the two
backwaters and inside the sharpest bend. `riverArt.test.ts` holds every pad to
the surface it floats on (the channel at 0.193, or a backwater lens lying on the
bog above it), so a raft spread wider than its lens fails.

**No ford and no outlet.** A track does not cross a swamp. The sea belongs to
the board: the marsh uses the ordinary two-mouth shapes, since a hex does not
know which edge is the coast.

**Mirrors**: five of the ten (`e_w_b`, `nw_se`, `e_nw`, `w_se`, `nw_sw`), with
no handed props (dead trunks, peat hags, tussocks and lily rafts have no front).

No generator. `tools/blender/render_rivers.py -- OUTDIR family_swamp` re-shoots
the sheet and `family_all` all forty-six; `pair_recut_swamp`,
`pair_recut_swamp_bend` and `pair_mirror_swamp_recut` under `detail` compare
them with the plain marsh, which is what a player sees beside them.

#### The faceted re-cut: the channel is the ground's own triangles

Every channelled tile's `_ground`, `_channel`, `_water`, `_margin` and `_fan`
are built from one lattice: the ground's own 631-point, 0.214 triangle grid
(ring 14 pulled onto the rim's inner edge at apothem 2.4731, the grid the base
tiles are drawn on). Each lattice vertex is lowered on one shared cross-section
by its distance from the centreline, and the centreline is read off the tile's
earlier water (its thalweg column, station by station), so every tile keeps its
line, mouths and props.

| | swept ribbon (before) | faceted |
|---|---|---|
| bank | a smooth strip, 8 columns x 36 stations | the ground's triangles, stepping down |
| water edge | a smooth curve | a chain of straight segments along the terrain's facets |
| water surface | one sheet in long colour stripes | a flat sheet of whole triangles, toned by triangle |
| wet margin | a strip beside the water | the turf's own triangles next to the cut, repainted on a slow wave |
| shingle at a mouth | a separate fan | the channel's own triangles at the mouth, repainted |

**The cross-section**, shared by every family: bed 0.072 (flat out to 0.11 so
the kit's bed height is met exactly), 0.135 at 0.22, the 0.193 waterline about
0.30 out, and the lip at 0.44 where the cut meets the field. An 8 mm jitter
rides the bank so no two stations step the same.

**The water** is flat at 0.193 (the thalweg's own vertices dip to 0.1867), in
three tones by triangle: `Mat_River_water_dk` in the deep middle,
`Mat_River_water` over the mid bank, `Mat_Pasture_water` in the shallows (the
marsh uses `Mat_Swamp_pool`). Every triangle owns its normal; nothing is
smoothed.

**The seam is pinned.** At each mouth the five ring-14 lattice points around the
edge midpoint go to 0, +-0.30 and +-0.35 along the edge at the bed, waterline
and the 0.2205 bank, so the 0.60 of water and 0.70 of cut hold exactly against
every other tile. `riverArt.test.ts`'s mouth and seam tests read the same
numbers as before.

**The chip keeps its circle by construction.** Water inside 1.056 of the socket
is cut back along a chord (a polygon clip, never a vertex nudge, which folds
triangles), the ground inside 1.07 is held under the chip's 0.25 underside, and
any bank triangle within 0.905 of the socket goes in `_ground` rather than
`_channel`, so the channel stays clear of the disc as drawn.

**The slab's top is only a collar.** Inside the lattice the ground covers
everything, so the slab's top face is opened inside apothem 2.468 and survives
only under the rim, with the mouths' notches.

**Props keep their authored place and clearance.** Each prop's lowest points are
measured against the old ground and the new, and it is moved in z by the
difference; a bank rock whose top would be under water moves to the new
waterline on its side. Nothing moves in plan unless it ended up in the water.

**Mirrors** are the cut original's meshes reflected through x = 0 with winding
reversed; each mirror keeps its own (hand-placed) props, re-seated the same way.
Vertices are snapped to a 1e-5 grid before writing, because clip points that
differ in the last bits get merged by the exporter on one hand and not the
other, and "each mirrored bend is its bend reflected" counts vertices.

**A fall is a step in the section, not a ramp.** The hills' cascade and the
mountains' fall keep their stations. The lower reach has its waterline at the
lower level (0.1775 on the hills, 0.175 on the mountains) crossing at 0.30 (so
the bed is flat to 0.11), and the upper reach is the same section raised by the
step, so both reaches are 0.60 wide. The water splits along the fall line
through the fall's own station, with a vertical sheet hanging between the two
levels behind the `_cascade` or `_fall` prop.

**The mountains' river grounds are resampled.** Their ground had been
re-triangulated round the old channel, so the cut raycasts the old surface at
each lattice point (median 4 mm change, 95th percentile 5 cm at the foot of the
peaks). Every prop is re-seated to its old clearance, and one left standing
clear of everything is set down.

**The headwaters' tarn is the lattice too**: the cross-section run round a point
(radius 0.28 of flat bed before the bank starts), toned by triangle like the
channel. The three rivulets are dry washes: a gully 0.10 either side of each
line, floored in shingle and scree, rising gently away from the pool (a trickle
under 0.20 wide cannot be drawn on a 0.214 lattice). One body of water reaches
the one mouth; the footprint is about 2.2, under every through-channel's.
`riverArt.test.ts`'s tarn test allows no disc and fails a z-fight wherever one
returns.

**Marsh pools are carved basins.** Each pool's level is 4 mm under the lowest
ground round it, and the lattice inside is lowered into a bowl 1 to 3.4 cm under
that level (never under the slab's 0.220), with the triangles below the level
repainted mud and moss. On the river tiles the basin is part of the cut; a
backwater is moved away from the channel until a lattice cell of bank separates
them, and its lily raft goes with it, 2 mm proud of the new level. The plain
marsh's pools are whole triangles of its own 0.204 grid (see "Ground features
are lattice triangles"). Lily rafts and the punt are set onto their pool's level
part by part, and sedge or dead trees left floating are set down. The six
`trade_swamp_*` tiles are recomposed from the new marsh.

**Water triangles share no corners.** Each owns its three vertices, so the
exporter writes exactly three per triangle on a tile and its mirror (welded, it
merges corners whenever two coplanar faces' float normals agree bit for bit,
and the mirror comes out short).

**Per family, only the bank changes.** Steep facets take the family's wet
material; dry flat facets of the cut take the colour of the turf they replace:

| family | steep bank | second bank tone | wet margin | shallows |
|---|---|---|---|---|
| pasture | `Mat_Pasture_mud` | `Mat_Pasture_dirt` | mud, `grass_dk` | `Mat_Pasture_water` |
| hills | `Mat_Hills_clay_wet` | `Mat_Hills_clay_dk` | wet clay, `clay_dk` | `Mat_Pasture_water` |
| mountains | `Mat_Mountains_shale` | `Mat_Mountains_scree_dk` | shale, `scree_dk` | `Mat_Pasture_water` |
| swamp | `Mat_Swamp_mud` | `Mat_Swamp_peat` | `silt_dk`, `bog_dk` | `Mat_Swamp_pool` |

These were made by a one-off script, run one tile at a time and checked in the
viewport before saving; it is not kept as a generator.

#### The waterline is lattice edges, not a contour

The water is whole lattice triangles; nothing is clipped. (Clipping channel
triangles at 0.193 made the waterline the bank's height contour, which crosses
the lattice at any angle and reads as a smooth curve.) Every lattice vertex
within 0.20 of the centreline (or of a headwater's tarn) is **wet** and sits on
the bed; every lattice neighbour of a wet vertex is **waterline** and sits 3 mm
above its reach's level; a triangle whose three corners are wet or waterline is
water, laid flat and toned by triangle. The outline is therefore all
waterline-to-waterline lattice edges, and the ring sits 4 mm under the sheet
(`featurelattice.carve_basin`'s convention), so every water corner has ground
below it and the bank rises outside the water's edge. `make check-hexes` holds
all 66 river tiles to the lattice rule with no exemption.

A wet vertex whose waterline neighbour would land inside the chip's keep-clear
or on the border is not wet, which keeps the number and rim clear by
construction. At a fall the step runs along lattice edges between the two
reaches, with the hanging sheet on those edges. In-tile ponds (the pasture's
pond, the marsh's backwaters) are cut the same way; the pond's reeds keep their
clearance. A pool's shore ring is lifted 4 mm over its level, and a pool keeps
three lattice steps from the river and from other pools so shores never share a
vertex.

Audit over the decoded `.glb`s: inside apothem 2.40 every river tile's water and
pool outlines are 1.000 on the lattice directions (the remaining few percent is
the pinned mouth seam under the rim, 0.30 of water against a 0.214 lattice). The
cut was a one-off headless script per tile, resampling each tile's pre-faceting
surface.

#### The fold in the water, and what it cost to take out

When `_water` was a swept ribbon (stations down the channel, five columns
across on straight ribs through the centreline at +-0.300 and +-0.130), it
folded at tight bends: consecutive ribs cross at a distance equal to the local
radius of curvature, and on the hills' zigzag that was as little as 0.229
against a 0.300 bank, so outer columns overlapped coplanar and z-fought.
`tools/blender/river_fold.py` (bpy-free, tested by `test_river_fold.py` in
`make test-tools`) repairs this by turning the rib frame more slowly (at most 30
degrees between neighbours and 25 from authored) and then narrowing columns
along their rib by a per-station, per-side factor in [0.55, 1]. Neither step
moves a vertex further from the centreline, the end stations are frozen so the
mouths keep their 0.60, only x and y change, and topology is unchanged.
`unfold_river_water.py` is the driver; it is idempotent (an unfolded grid is
returned unchanged).

`riverArt.test.ts`'s "no river tile's water lies on top of itself" holds the
property on the exported files: no two triangles of a `_water` mesh may cover
the same ground in plan, in the same material slot anywhere and in any slot
except on the six `_src_` tiles. The test is in plan, not 3D, because two layers
a millimetre apart are exactly the failure.

To re-run:

    blender --background --factory-startup \
        --python tools/blender/unfold_river_water.py -- --dry-run
    make export-tiles && make check-hexes
    cd frontend && npx vitest run src/lib/board3d/riverArt.test.ts

`art/hexes/castle.blend` is not generated. It was modelled by hand in the live
session on the pasture's own turf lattice, rim, slab, barn, field wall, hedge,
pond and flock, appended from `art/hexes/pasture.blend` and renamed `Castle_*`,
so its ground and materials are the pasture's. The compound (motte, curtain,
four drum towers, keep, watch tower, gatehouse, footing, track) was built in the
viewport; `tools/blender/render_castle.py` renders the stills.

`art/hexes/lake.blend` is generated from `tools/blender/gen/lake.py`; do not
model in it. Its water is a recess: the sheet sits at 0.190, so the slab's
opaque top face at 0.220 is cut around the lake. Nothing `hexcontract` measures
moves; the profile is in the script's header and `audit()` re-measures the
contract before saving. Its ground, rim and their materials are the pasture's,
appended with `bpy.data.libraries.load`, which rules out a `PALETTE_CONFLICT`
on those colours. (Not the desert's: `art/hexes/oasis.blend` is already water in
a sand basin, and the lake must not look like it.) Only `Mat_Lake_bank` and
`_bank_shade` are its own, as the darker wet meadow ringing the water. `Hex_Lake`
wears `Mat_Pasture`: the slab's side wall is 0.47 tall and stands proud of the
gutter, so any other colour outlines the tile. `palette.test.ts`'s dead-override
guard keeps removed materials such as `Mat_Lake_slab` out of `palette.json`.
`tools/blender/render_lake.py` writes the frames under `art/prototypes/lake/`,
including three pair frames beside the pasture, the desert and the oasis in a
purpose-built scene (all three are staged on cell (1, 0), so no linked board
can show them together). Check `pair_oasis.jpg` first.

    make export-assets     # every blend -> every .glb, the manifest, the palette
    make export-tiles      # just the tiles, the fast half
    make art-live          # watch them all and re-export on save

Every export is stripped of authoring metadata: the glTF exporter stamps
`asset.generator` ("Khronos glTF Blender I/O v5.2.39") and Blender copies custom
properties into `extras`, none of which the loader reads. `export_glb` calls
`tools/blender/assetmeta.py` as it writes, so a fresh export matches the
committed file byte for byte and `make verify-split` stays meaningful. The same
module handles assets from elsewhere (ffmpeg encoder tags in the sound effects,
GIF comments, PNG text chunks, EXIF and XMP in JPEG and WebP); sweep all of
`frontend/public` with

    python3 scripts/strip-asset-metadata.py           # rewrite in place
    python3 scripts/strip-asset-metadata.py --check   # what `lint.sh --check` runs

Node, mesh and material names are data, not metadata (the loader looks assets up
by name and `palette.json` is keyed on material names), so they stay. So do the
fonts' name tables, where the OFL requires the copyright notice.

The blends are the source of truth: a change to one is a change to that file.
The old patch scripts under `tools/blender/edits/` (forty-four of them, still
cited by number in comments, e.g. `edits/0025_harbour_ratio_signs.py`) are
retired and their effects baked into the blends; do not bring the pattern back.

## The contract every tile follows

`tools/blender/hexcontract.py` encodes the standard every tile follows: slab
size and height, the gutter the art must not cross, where the number chip
mounts and what must stay clear of it, and a height ceiling. `make check-hexes`
measures the per-tile blends and fails any tile that breaks it;
`test_hexcontract.py` checks the rules still tell a broken tile from a good one.
It measures every terrain in `naming.TERRAIN_TO_RESOURCE`, so registering a tile
puts it under the contract.

Existing deviations are recorded in `KNOWN_DRIFT` at the value they measure
rather than absorbed into a loose tolerance, so anything new that drifts the
same way still fails.

### Ground features are lattice triangles

**Every ground feature is a set of the tile's own ground triangles**, so its
outline is a staircase of lattice edges (30/90/150 degrees on land; 0/60/120 on
a sea tile, whose lattice is its wave sheet's, halved). Paths and plazas are
painted that way, and the same goes for water and anything else laid on the
ground. Not allowed: a smooth or free-form polygon laid on top (e.g. an octagon
pond or an n-gon motte); a level sheet whose edge is wherever the terrain cuts
it (a level pool over sloping facets draws a height contour, a smooth line); a
line clipped across the lattice at its own angle.

Water is whole lattice triangles in a three-tone per-triangle mosaic, in a
basin cut from the lattice, its visible edge the sheet's boundary with a 4 mm
vertical lip to the bank. `tools/blender/featurelattice.py` builds it
(`carve_basin`: every water triangle's three ground corners go under the sheet,
the bank ring stays over it), and `make check-hexes` holds every tile to it,
composed ones included:

  * a body of water (a connected patch of a water material over 0.05 in plan,
    not a well's or a trough's) must have at least 0.95 of its plan boundary
    on lattice directions and 0.95 of its corners on ground vertices;
  * the ground may not stand over any water triangle's corner or centroid by
    more than a millimetre;
  * named ground features (`_bars`, `_track`, `_motte`, `_pad`, `_ripples`)
    are held to the same outline rule.

`featurelattice.EXEMPT` is empty; the river tiles' pinned mouth seam is handled
by `MOUTH_SEAM`. `test_featurelattice.py` checks the rule still fails an
octagon, a contour-cut level sheet and a line at its own angle.

How each tile was converted (one headless run per tile; the oasis and lake
through their generators):

| tile | before | after |
|---|---|---|
| pasture | an octagon pond on a lattice warped to fit it (17 points pulled up to 8 cm) | lattice points put back; 43 triangles of water in a carved basin, mud bank ring |
| castle | the pasture's pond floating 10-20 cm on a 12-gon motte, a 4-face gate ramp | the motte folded into the ground (every lattice vertex takes the old mound's height; its top the grass plateau, its flank the dirt ring), the ramp mud triangles, the pond 30 triangles off the flank |
| marsh | six level 12-gons cut by the bog's facets | the same six at the same levels as whole triangles of the marsh's own 0.204 grid, the bank tucked up round them |
| goldfield | a 24-station ribbon down the slope (under the turf in places), free-form scree plates | the bars folded into the ground's triangles; the creek the lattice triangles it covered, one tilted sheet triangle per lattice triangle, keeping its fall |
| oasis, lake | an n-gon cut into a 9-ring CDT ground | the shared lattice, sampled from the same relief; bed, bank ring and verge are its triangles |
| shoal | three stacks of octagonal frusta | terraces of the sea sheet's lattice with vertical sides, so the swell's waterline is a staircase too |
| spice | a 0.88 box pad | the lattice triangles over it, a millimetre proud |
| desert | three ribbon drapes | the lattice triangles under them painted the ribbons' lit sand |

The composer holds moved pools to the same rule (`compose/place.ts`
`latticeSnap`): a pool authored on the lattice is turned only by multiples of 60
degrees, never scaled (a smaller spot takes a subset of its triangles), and
moved so its corners land on ground vertices; `water.ts` then keeps every ground
vertex under a sheet below it, paving-owned ones included. The sea's coast is
not a tile feature: it is the board's beach, drawn in code along a smooth spline
(`shoreCurve.ts`), and the rule does not apply.

### The border is measured on the hexagon, not the circle

Nothing a tile carries may stand on the drawn border: the rim's chamfer and the
gutter beyond it, where roads, settlements and paths between hexes are drawn.
`hexcontract.BORDER_APOTHEM` is the line, **2.4731** in the hexagon's own metric
(`hexcontract.apothem`): the art apothem 2.5981 less the tile's half of the 0.25
gutter, which is the rim's inner edge and where every ground's outer ring sits.
Every vertex of every part except the slab and the rim is held to it.

A radius check against the 3.0 circumradius is not enough: mid-edge, the hexagon
is 13% narrower, so art could hang 0.40 over the middle of an edge and pass. The
table `make check-hexes` prints shows how far each tile's art reaches and which
part does.

- **Water tiles** keep the same half gutter clear inside their cell:
  `WATER_BORDER_APOTHEM`, 2.7231 - 0.125 = 2.5981 in the blend's world-sized
  frame (2.4788 in a shipped sea `.glb`, which is written at 1/LATTICE_SCALE).
  The wave sheet fills the cell by design. The harbour pier is the one named
  exception (`BORDER_BY_DESIGN`): it lands on the beach at its own harbour edge
  and never crosses the lattice line.
- **River mouths** cross by design, so a river's `_water` and `_channel` are
  held to the notch instead: past the line only within 0.35 of an edge midpoint
  (the pinned 0.70 cut) and no higher than the rim's outer edge.
- **Composed tiles** are held by construction: `keepInside` (compose/place.ts)
  moves any placed body back inside the line before seating it, and the audit's
  `border` defect (`compose.audit.test.ts`) is held at zero.

## First checkout on a new machine

The blends and the `.glb` exports under `frontend/public/models/` are stored in
**Git LFS** (see `.gitattributes`). Without git-lfs on PATH they check out as
~130-byte pointer text files, and Blender or the frontend fails with an unhelpful
parse error. `file art/pieces.blend` says `ASCII text` instead of `Blender` if
that has happened.

The nix devShell provides git-lfs, registers the filters for the clone, and
fetches the art once if it came down as pointers. So `git clone` then
`direnv allow` (or `nix develop`) is the whole setup. By hand:
`git lfs install --local && git lfs pull`.

Blender is **not** in the flake: its closure is multiple GB, and the copy you
author in should be the same install the Makefile runs (on WSL, a Blender inside
WSL rather than the Windows one). Install it per machine and point the Makefile
at it if it isn't on `PATH`:

    make export-assets BLENDER=/path/to/blender

`make` resolves it in this order: an explicit `BLENDER=`, then
`~/blender/blender-5.2.0-linux-x64/blender`, then
`/Applications/Blender.app/Contents/MacOS/Blender` (the macOS bundle never puts
its binary on `PATH`), then `blender` on `PATH`.

Colours are not authored here for shipping. The exporter writes a default
palette once; `frontend/public/models/palette.json` overrides it at runtime and
is where restyling happens, so the viewport shows authoring colours.

At present the difference is zero: every material in `palette.json` holds the
value the exporter wrote (`jq length frontend/public/models/palette.json` gives
the current count, and the export prints it). So a Blender render is
colour-faithful for now. Once a restyle happens, re-check the terrain rims
(below), several of which were tuned by distance from `Mat_Shore_sand`.

Re-export after any geometry change:

    make export-assets

## Conventions the exporter depends on

Breaking one of these fails the golden manifest test. They are encoded in
`tools/blender/naming.py`.

- `Hex_<Terrain>` parents everything on its tile: ground, props, waves.
- `Token_<Terrain>` is a CIRCLE empty at `z=0.26` marking the number-chip mount.
- `Chip_<NN>_<variant>_{body,face,numeral,pip_NN}`, `body` is the parent.
- `Seat_{Body,Shade,Detail}` materials mark geometry the runtime recolors per
  seat. Anything else is baked art and keeps its authored color.

**Every piece a player owns must carry the seat slots.** Forgetting is invisible
in Blender (the viewport shows the authored colour) and the piece ships in one
colour for all ten seats. `frontend/src/lib/board3d/loader.test.ts` fails if an
owned mesh loses its slots. Pieces that belong to nobody (the robber, the
pirate, the barbarian ship) and cues that mean the same on every board (the
knight's gold rank crest, and the sword, whose colour is its activation state)
do not tint; that test pins those too.

The raised sword wears `Mat_Knight_crest` itself rather than its own gold, so
the activation cue and the rank cue cannot be restyled apart: both say what the
piece is doing, never whose it is. `loader.test.ts` pins it per mesh.

The sword is the only piece whose fit is carried by parenting.
`Knight_sword_<level>_{dark,gold}` is a child of its `Knight_<level>`, positioned
at the hand. `anchors.rule_for` moves each exported root onto the origin, and
the root of that group is the knight, so the sword's glTF node keeps the offset
that puts it in the grip. Unparented, it would be recentred and ship growing out
of the knight's chest. `frontend/src/lib/board3d/knightSwordArt.test.ts`
measures the shipped offsets against the knight's silhouette.

**Judge a piece's size through the game camera.** The board is seen from 56
degrees of elevation, which draws vertical things at 56% of their length, and a
knight is about a tenth of the frame tall next to a hex three units across. A
front orthographic render hides both.

    blender art/board.blend --background \
        --python tools/blender/render_knight_sword.py -- art/prototypes/knight-sword

photographs all three knights in both sword states on real lattice vertices, at
`MODULE_SCALE.knight`, through the shipping rig, at three zooms and two bearings
(JPEG, to keep a pass small).

Objects parented to a hex but named `Chip_*`, `Beach_*`, `Connector_*`,
`Robber_*`, `Dock_*`, `Hwedge_*` or `Ref_*` are staging, not part of the tile;
`export_assets.TILE_CHILD_EXCLUDE` drops them. That lets harbour dressing be
authored on the port tile and still ship from its own file: there is one
`sea_port` tile and five trades, so a tile that carried its children would draw
every trading post and all six ratio signs on every harbour.

## The board you see is the board that ships

The blend is laid out on the **lattice**, not the tile art's own size. Adjacent
hex centres are `sqrt(3) * 3.144` apart rather than `sqrt(3) * 3.0`, which opens
the 0.25 gutter the renderer runs between tiles for roads, settlements and
paths. Water tiles are authored a whole lattice cell wide, as they are drawn:
the gutter reserves the perimeter of a land tile and at sea would only be a
seam. See `frontend/src/lib/board3d/coords.ts`.

None of that reaches the `.glb` files. Each tile's blend carries the spacing on
its hex's own transform (`build_board.py` links them back onto their lattice
cells without restaging, which checks that they still fit) and
`anchors.scale_cancel_for` divides the water's scale back out on export, the
same trade `is_upright` makes for the number chips. Shipped tiles are
byte-identical to their pre-lattice versions.

### `Ref_*` is a mirror, not the source of truth

Three things on the board are built in TypeScript at runtime from the lattice
constants, so a modelled copy would stop fitting whenever a constant moved:

| what | built by | mirrored as |
|---|---|---|
| the sand filling the lattice gap | `gapGeometry.ts` | `Ref_Gap_<Terrain>_e<0-5>` |
| the coastline | `beachGeometry.ts` + `coastline.ts` + `shoreCurve.ts` | `Ref_Beach_<cell>_{e,c}<n>_{dry,wet}` |
| the harbour's trade token | `harborToken.ts` | `Ref_HarborToken` |

The mirror was generated from `tools/blender/lattice.py`, which restates the
TypeScript constants in Blender coordinates, and sits in the blends as plain
geometry: `Ref_Gap_*` and `Ref_Sea_*` in each tile's file, `Ref_Beach_*` in
`art/beach.blend`. `Ref_Sea_<cell>` plates the open water under the coastline,
since the backdrop is instanced at runtime.

**Do not edit `Ref_*` geometry or rely on it shipping**: the exporter drops it.
To change the gap or the beach, change the TypeScript and regenerate the mirror
from `lattice.py` if you want the viewport to agree.
`tools/blender/test_lattice.py` reads the constants back out of the `.ts` files
and fails if `lattice.py` has drifted.

**Regenerating the beach mirror**: `make beach-mirror`, then
`make export-assets ARGS=beach`. `tools/blender/rebuild_beach_mirror.py`
rewrites all 76 beach meshes in that file (the four that ship,
`Beach_canonical_*`/`Connector_beach_*`, and the `Ref_Beach_*` staging) from
`lattice.py`, keeping materials and transforms, and refuses if an unrecognised
mesh matches the naming convention. `assetAnchors.test.ts` catches the art and
the renderer disagreeing. Order: change the TypeScript, change `lattice.py` to
match, `make test-tools`, `make beach-mirror`, re-export.

**The beach mirror is an envelope, not a copy.** The coast is a continuous
ribbon laid along a smooth closed curve (`shoreCurve.ts`) and sloped from a
crest at 0.215 down to a foot at 0.050 under the water. **The crest must not be
raised to the land's 0.250**: the sand-filled gutter's top is 0.220, and a
beach at tile height covers the hexes' rims and gutter. `Ref_Beach_*` bounds
everything a player can see: the ribbon shows 0.86 of sand from crest to mean
waterline at nominal width against the prism's 1.4025, and lies at or below its
top face. The width varies: smoothing narrows a convex headland and widens a
bay, so the visible band runs **0.769 at a headland to 1.016 in a bay** and the
submerged foot stands **1.424 to 1.882** from the lattice line. Only that
apron escapes the prism. The mirror has not been regenerated against the
ribbon; until it is, model rims against the prism and expect the drawn sand to
fall away from it seaward.

**The coast is a smooth curve.** It is the exact offset of the land's outline
(arcs at headlands, mitres in bays) run through a cubic B-spline at scale
**1.4**, so neighbouring stretches agree because they are neighbours. The sine
on arc length is still in `shoreCurve.ts` with amplitude **0**. (Noise on a
ribbon this narrow reads as a lumpy edge.)

The kernel spans `4 * scale`. At 1.4 that is 5.6, nearly two hex edges (3.144),
so no straight survives and the outline is one continuous sweep; at smaller
scales the straights between rounded corners keep the hex outline legible. The
board turns 4.9 degrees a sample at its sharpest, the sand stands 1.882 from
the coast at its widest, and a one-hex strait keeps 0.30 of open water where its
two submerged feet come closest. **That last number caps the coast, and it is
measured**: the feet meet at a `BEACH_REACH` of about 1.75, a one-hex pond stops
being smooth at about 1.70, and its sand escapes `BEACH_ENVELOPE` at 1.95. So
the reach cannot exceed ~1.7; a gentler beach beyond that needs `BEACH_FOOT_Y`
or `BEACH_SHAPE`. `beachGeometry.test.ts` and `shoreCurve.test.ts` hold all
three.

Shipping coast and sea: reach 1.6, shape 0.9, crest 0.215, foot 0.05, wet seam
0.15, and a swell of `WAVE_AMPLITUDE` 0.024 against the 0.046 the clearances
allow (at the maximum it read as one large wave with small ones on top); see
`ocean.ts` for the budget.

`SHORE_SWELL` and `SHORE_WET_SWELL` are amplitudes passed to `shoreStations` and
`wetLineU`; they are zero, but the code path is still tested at a non-zero
amplitude.

### The gutter is a path

The gutter uses `Mat_Path`, not the beach's `Mat_Shore_sand`, so the strip
between two tiles reads as a way between places rather than more shore.
`gapStripGeometry` builds one tile's **half** of the gutter, so every hex has
half a path round it and two neighbours' halves make the whole.

`Mat_Path` reaches the renderer on `Beach_path_swatch`, a scrap of geometry in
`art/beach.blend` whose only job is to carry the material into `beach.glb`, the
file the gutter layer loads and takes its material from by name. Deleting the
swatch removes the gutter's colour.

### The number chip is a clearance constraint

A chip is a disc of radius 1.0 on `Token_<Terrain>` with its underside at
z=0.25, and `edit_geometry` treats it as the thirteenth thing a tile's art must
keep clear of (the only disc rather than a point). `make check-hexes` fails a
tile whose ground or props stand in it.

The hex's north point and the chip socket coincide, so the forest canopy leaves
that point bare rather than planting a conifer through the number.

### Terrain rims

**Every land tile carries a `<Terrain>_rim` mesh** that ramps the surface down
and outward to meet the gutter, so the board reads as terrain with paths through
it rather than counters laid on sand. That includes module tiles: the oasis, the
castle, the goldfield, the spice village, the river and swamp tiles, the lake.
Sea tiles are exempt, since they fill their whole lattice cell. The eight base
tiles (`Desert_rim`, `Fields_rim`, `Forest_rim`, `Generic_rim`, `Gold_rim`,
`Hills_rim`, `Mountains_rim`, `Pasture_rim`) follow one shared contract, and a
module tile reuses one: `Castle_rim` is `Pasture_rim`, appended and renamed, so
the two cannot disagree about where the chamfer starts.

| | value | from |
|---|---|---|
| chamfer outer edge | apothem **2.5981** | `lattice.TILE_APOTHEM` |
| chamfer width | **0.125** | `lattice.LATTICE_GAP / 2`, the tile's own half of the gutter |
| chamfer outer height | **0.220** | `lattice.GAP_SAND_Z`, the sand it meets |
| tie-break at the rim | **+0.0005** | three surfaces meet at 0.220 there; see below |

Every rim must:

1. **Sink the slab.** `Hex_<Terrain>`'s top face is a full hexagon at z=0.250,
   so a chamfer dipping below that inside apothem 2.598 is buried. Min-clamp the
   six top vertices to 0.220. The slab's side wall is already hidden by the gap
   fill.
2. **Sink the ground apron too.** Most `<Terrain>_ground` meshes are full
   hexagons ending in a flat outer ring at ~0.255, which buries the chamfer
   again. Depth varies by tile (0.200 to 0.218) depending on whether the ring
   below is flat; Fields could not clamp and deletes its apron skirt instead.
3. **Cover apothem 2.538 → 2.598 opaquely.** With the slab at 0.220 it is
   coplanar with the gap sand over that annulus, so a hole in the rim z-fights.
   2.538 is 2.5981 minus `lattice.GAP_UNDERLAP`, how far the gutter fill reaches
   back under its tile to hide the seam.
4. **Give it a lip.** See below.

**Sinking the slab removes the 0.030 wall that cast each tile's outline
shadow**, and a plain feather reads worse than no rim. So on the seven tiles
built from the shared border, one dark material (`Mat_Desert_gravel`,
`Mat_Pasture_mud`, `Mat_Hills_clay_wet`, …) is confined to the outermost 1.3 mm
of the ring, on a vertical cutbank 0.0135 tall. Reproduce that, cutbank
included, if a new tile looks mushy. Generic is the exception (a shop counter,
not a landscape): a bare 0.030 feather in one material, waived by name in
`hexcontract.py`.

#### What `make check-hexes` measures

`hexcontract.rim_violations` holds every land tile to the above, off the
evaluated mesh, and `make check-hexes` fails unless:

- there is a `<Terrain>_rim` mesh;
- the slab's top is at 0.220, and nothing else on the tile sits above 0.220 in
  the annulus;
- the rim reaches the art apothem, with its outer edge at 0.220 (+0.0005
  tie-break, as the shared border has);
- its inner edge stands at least 0.020 above its outer edge (a rim that does not
  climb is a decal);
- no sample across the 2.538 → 2.598 overlap is uncovered (3 rings × 120 spokes);
- it has a lip: **either** a material confined to the outer 0.020 **or** a
  cutbank of 0.020. The shared border passes on the material; its own 0.0135
  cutbank would not.

A tile that needs an exception takes a `KNOWN_DRIFT` entry with its reason, as
Generic's lip does.

`Lake_rim` is four rings at hexagonal radius 0.9519 (z 0.2900), 0.9720 (a broken
crust band wandering 0.2480..0.2760), 0.9995 (0.2340) and 1.0000 (0.2205), but
it is not built from those numbers: `gen/lake.py` appends `Pasture_rim` and
rebuilds it in the lake's own frame, faces and material slots included. A rim is
a pure function of the hexagon. Rebuilding one from measurements gets the
geometry right (`Pasture_rim` and `Desert_rim` are the same mesh in different
colours) but not the lip: the shipped rims wander their middle ring in radius as
well as height (0.960, 0.968 and 0.975 on one ring) and carry three materials on
that band and two on the next. If you need a rim, take an existing one. The
lake's ground hands over at 0.290 and shares that inner ring's vertices with the
rim, since a T-junction shows a hairline of gutter sand; `gen/lake.py`'s
`audit()` checks the loops still match before saving.

The rim numbers are not factored into a shared helper. Only two of the eight
tiles have a flat 0.250 plateau; the rest drape their inner edge over sculpted
ground, and Gold's spoil bank reaches 0.767. Each script restates the contract
locally and cites `lattice.py` for the constants.

The beach is the exception: `beach.glb` must carry `Mat_Shore_sand` and
`Mat_Shore_wetsand` for the generated coast to use, so
`Beach_canonical_e0_{dry,wet}` and `Connector_beach_canonical_c0_{dry,wet}` are
generated and shipped. The renderer no longer draws them (see the envelope note
above), but the materials they carry paint the coast.

`Mat_Shore_wetsand` is `0.4551, 0.3799, 0.2714`, 0.53 of the dry sand's value,
so the 0.20-wide wet band at mean tide reads as a line at the water's edge.
`palette.json` is read at load, so a colour change needs no re-export. The only
other user is the shoal's wet skirt (`Shoal_bars`, in `sea_shoal.glb`), which
sits under the swell and moves with it.

## Authoring position does not matter

The blend is a showcase board (`Hex_Forest` sits on hex (-2, 1), the number
chips on a staging grid to one side), but every renderer layer computes a world
position and instances the art there. Art exported at its authoring position
would land at *authored offset + computed position*.

So the exporter moves each item onto the origin on the way out.
`tools/blender/anchors.py` holds the rules and explains each one;
`frontend/src/lib/board3d/assetAnchors.test.ts` checks the shipped `.glb` files
still obey them. Model wherever it reads best, but if you add a family whose
anchor is neither its object origin nor its parent hex, give it a rule there.

Piece anchors are lattice quantities: a settlement staged on a vertex is staged
on the spread lattice's vertex, so its anchor is `LCOL, LHEX`, not `COL, HEX`.

## Changing a blend

Every asset is a small file. Open it and change it:

1. Open `art/<thing>.blend`, model, save.
2. `make export-assets`: every `.glb` under `frontend/public/models/` updates in
   place, along with the manifest and the palette check. Refresh a running
   `npm run dev` (they are static assets, not HMR'd, so hard-reload if the
   browser cached the old file). `make art-live` does this on every save.
3. Watch the export output. `PALETTE_UNCHANGED 271 materials` (whatever the
   count is today) means the material set matches `palette.json`;
   `PALETTE_DRIFT` means you added or removed one and the shipping palette needs
   a decision. `PALETTE_CONFLICT` means two blends disagree about a material's
   authored colour, usually because a shared material was restyled in only one
   file.
4. For a tile, run `make check-hexes` too: it measures every tile against
   `hexcontract.py` and fails a slab, gutter, socket or height that drifted.
5. Pure math belongs in `tools/blender/edit_geometry.py` with a test in
   `test_edit_geometry.py` (the same split as `anchors.py`/`naming.py` versus
   `export_assets.py`): anything that does not need `bpy` is tested without
   launching Blender. `make test-tools` runs it all.
6. Before committing, confirm `make export-assets` is deterministic: run it
   twice and check `git status` on `frontend/public/models/`. These are LFS
   files, so compare working-tree bytes (or LFS oids), never `git show` output,
   which is pointer text.

To inspect a blend without the GUI (e.g. to measure how far a surface is from
an empty):

    blender art/pieces.blend --background --factory-startup \
        --python your_inspection_script.py

`bpy.data.objects["Name"].matrix_world` gives world-space transforms;
`obj.data.vertices` gives the mesh. `bound_box` is the axis-aligned corner box,
which inflates measurements by most of a unit, so measure evaluated vertices.

## Robber prototypes

Twenty candidate robbers, and a recolourable version of the shipped one, live
outside the shipped blends:

    make robbers        # rebuild art/robbers.blend, then photograph the set

Both halves are generated. `tools/blender/robber_designs.py` holds the shapes as
profiles and `art/robbers.blend` is its output; do not model in that blend. The
frames `make robbers` writes under `art/prototypes/robbers/` come from the
blend. Start at `sheet.jpg`, all twenty-one in one labelled picture. The board
lineups (`set<n>_az<n>.jpg`) come with it, and the 63 per-design frames with
`make robbers ROBBER_STAGES="play study"`.

These are candidates to choose between, so they live as profiles that can be
diffed and regenerated rather than as hand-modelled meshes.

**Seven of the twenty ship.** They are sold as the `robber.*` catalog items
(`cosmetics/catalog.go`) and drawn from
`frontend/public/models/robbers/<design>.glb`, built by
`tools/robbers/export_skins.py` from the same profiles. They are not in
`art/pieces.blend`: the profile stays the source, which lets a chroma be a
colour table rather than a second mesh (see `frontend/src/lib/robbers.ts`).
`art/pieces.blend`'s `Robber_*` remains the default piece and the envelope
below.

The envelope is the shipped `Robber_body`: 1.5 tall, 0.45 radius, 10 sides.
`tools/blender/test_robber_designs.py` fails a design that leaves it, bands the
front-view silhouette area as well as the height (a 1.5-tall needle and a
1.5-tall barrel differ on a board), and fails two designs that converge on one
outline.

Before editing a profile:

- **Judge on the board frames, not the sheet.** `sheet.jpg` is a studio clay
  render. `play_<name>.jpg` is the piece in shipping near-black at playing
  distance (where the wraith's sleeves turned out to read as rabbit ears).
- **The camera flattens vertical detail** (56 degrees of elevation draws
  anything plumb at 56% of its length), and near-black hides everything but the
  outline. A design must differ from its neighbours in silhouette.
- **Neighbours converge.** `bruin` and `swagbag` were the same lumpy mass until
  the bear got a neck; `menhir` and `skullpost` were both a thin thing with a
  weight on top until the stone got broad and blunt.

### Seeing them as build tiles

The dock's tiles are rendered on the player's machine by `thumbnail.ts`, so to
see a candidate robber as a tile, hand the game's own renderer a shot:

    blender --background --factory-startup \
        --python tools/blender/export_robbers_glb.py     # -> public/models/robbers.glb
    cd frontend && npx vite --port 6789
    open 'http://localhost:6789/dev/robber-shots.html?exposure=1.9'

`frontend/dev/robber-shots.ts` imports `renderShotBlobs` rather than reimplementing
the rig, so the shot is the game's. It lives outside `src/` so `vite build`
never sees it, which also means `tsc -b` never typechecks it.

- **The exported `.glb` is untracked.** `vite build` copies `public/` wholesale,
  so a prototype left there would ship. See that directory's `.gitignore`.
- **This subject needs more exposure.** The rig's lighting was solved on seat
  colours at 0.3–0.5 albedo; `Mat_Robber` is 0.08, and at the default exposure
  every tile is a black shape on a dark dock. The per-shot `exposure` multiplier
  handles this (the dev-deck card uses it the other way); 1.9 is where these
  read.

### The recolour split

The robber's single `Mat_Robber` becomes three slots, `Robber_Body` (the mass),
`Robber_Shade` (plinths, recesses, what sits behind) and `Robber_Detail` (the
one accent), shared by all twenty, so one palette edit restyles the whole set.
On the base piece the split is by height: plinth, figure, hat. That lets a
finish treat foot and hat differently (a chrome robber wants its hat catching
light its plinth does not; a glass one needs an opaque foot or it reads as a
puddle).

`build_robbers.FINISHES` carries matte, chrome, pitch and glass (plus a studio
clay that is not a shipping finish), rendered as `finish_<name>.jpg`.

Seven skins ship as their own glb. A robber restyled purely from
`palette.json` is still open, blocked by two things:

1. `palette.json` carries only color, roughness and metalness (`PaletteEntry`
   in `frontend/src/lib/board3d/palette.ts`). That covers matte, chrome and
   pitch; **glass needs transmission and IOR**, so the palette schema needs two
   more fields first.
2. The robber is pinned out of the `Seat_*` tint system by
   `frontend/src/lib/board3d/loader.test.ts`, and that should stay: these slots
   are `Robber_*`, not `Seat_*`, because the piece belongs to nobody, and a
   recolour that followed whoever moved it would make it look owned.

## The barbarian

One figure for two expansions. Raiders musters up to three on a coastal hex
while a raid builds and keeps captured ones as prisoners; Wagons stands one on a
road edge to block a wagon. It ships once, so there is one thing to restyle and
one silhouette to learn.

Wagons draws it on a road edge, lying across the path it blocks
(`layers/wagons.ts`, `planPathBarbarians`), at `MODULE_SCALE.pathBarbarian`.
That is not the `barbarian` entry beside it, which is the Knights raiding
fleet's `Ship_barbarian` and measures something two orders of magnitude
different. `WAGONS_MODELS` names the file alongside `RAIDERS_MODELS`, and
`boardModelFiles` dedupes, so a game with both fetches it once. Raiders does not
draw it yet.

**The house figure vocabulary**, measured off the shipped art:

- **A figure is a turned solid, not a body.** `Knight_basic` is one mesh: an
  octagonal plinth, a tapered column, a head sitting on the shoulders, one stub
  arm. The settler and the crew are three parts each (column, head, hat). The
  only modelled limbs belong to the rider's horse. Nothing has a face.
- **Three colours**, the seat's own: `Seat_Body`, `Seat_Detail`, `Seat_Shade`.
  A body value, a shade a step darker, and one near-white detail.
- **One silhouette-breaking prop**, pale, held clear of the mass: the knight's
  sword, the rider's lance, the settler's hat brim.
- **Detail is a step in the profile.** Every radial part is an eight-sided loft,
  every face flat, no bevels or curves.

So the raider is eight turned parts, four flat colours and one axe. It leans
forward, its shoulders overhang its column, its brow band is the dark step where
a face would be, and the axe is the only pale thing on it. It is neutral by
value rather than hue, because every hue is some seat's and the seat-tinted
rider stands on the same coastline. (A body colour borrowed from the raiding
fleet's hull was invisible at 56 degrees, where the shoulder slab hides the
column.)

`barbarianArt.test.ts` measures what a layer needs: 0.92 tall with its feet at
y = 0, facing +x, 132 faces / 304 triangles, four `Mat_Barbarian_*` materials
and no seat slot. Its authored envelope is 0.449 x 0.599 x 0.92.

Two numbers were set by eye; both are in `tools/blender/render_barbarians.py`
and re-asserted in that test:

- **Drawn at 1.4**, which is 1.29 on the board: above a drawn knight (1.10) and
  well below the robber (2.25). Judged on the `board` frame (`play_az0.jpg`)
  against a settlement on the vertex below. At 1.15 the three helms merged into
  one smudge at playing distance.
- **The muster is a splayed triangle**, radius 0.45 about a point 0.60 south of
  the hex centre, the three turned to bearings 90/210/330 so each faces outward.
  A row reads as one long object at 56 degrees of elevation, and a stack cannot
  be counted. The southward shift is required: centred on the hex, the northern
  figure's axe would be inside the chip's 1.05 keep-clear. Nearest reach is
  1.267 and furthest 1.527.

        blender art/barbarians.blend --background --factory-startup \
            --python tools/blender/render_barbarians.py -- art/prototypes/barbarians hero
        blender art/board.blend --background --factory-startup \
            --python tools/blender/render_barbarians.py -- art/prototypes/barbarians board
        blender --background --factory-startup \
            --python tools/blender/render_barbarians.py -- art/prototypes/barbarians family

Re-shoot `family` before changing this piece: the raider beside the knight, the
trader, the settler and the rider, each at its own drawn scale, through the
board camera.

## Recipe-built tiles

Sixty-eight tiles are not one-blend-one-asset: forty-eight trade towns and
twenty forest and fields rivers are composed at export time by
`frontend/scripts/compose-tiles.ts`:

    make compose-tiles     write every tiles/<key>.glb from art/recipes/<key>.json, then compress
    make compose-check     compose in memory and byte-compare with what ships (in the gate)
    make compose-review    photograph each beside its base in the real renderer (.compose-review/)

**Why composed.** A town hand-built on eight grounds in six directions is
forty-eight files to redo whenever a base tile changes, and the forest and
fields rivers are twenty more. Composed, the base tile is the shipped `.glb`
(`art/recipes/parts.json` names each), so a base-tile change reaches every
variant the next time the step runs, and the only per-variant input is where its
identity props go.

**What is authored, and where.** The town layouts and lake towns are modelled in
`art/trade/parts.blend`. The hero spots (where each ground's kiln, barn, mine
head, conifers or farmstead goes on each direction's tile and each river shape)
are empties in the same blend, exported to `art/trade/parts/spots.json` with
every per-ground rule (clip, drop, keep, budget). A recipe
(`art/recipes/<key>.json`) is the tile's own source file and is usually empty;
it carries only what a review of that tile asked for: `keep`/`drop` a base prop
by node name or by one loose part's id (`Hills_kiln@-0.5,0.2`, as the compose
log prints it), `nudge` one by `[dx, dz]`, or an `offset` for the town's pads.
A line that no longer matches anything is an error.

**What the composer does** is documented at the top of
`frontend/src/lib/board3d/compose/trade.ts` and `river.ts`: the base ground is
kept vertex for vertex and re-heighted (per-pad median heights under a town, the
template's cut near a channel), town parts go by role (bed, paint, fixed,
rigid), layouts are turned by the contract's table (rotate, then mirror with the
winding reversed), base props under the town or water are dropped and the rest
re-seated, and heroes go to their spots. The chip's keep-clear disc is clamped
and guarded.

**The forest and fields rivers follow the faceted pasture channel.** The
pasture template is cut into the ground's own lattice (see "The faceted
re-cut"), and every land tile is drawn on that lattice, so ground, channel, wet
margin and mouth shingle are one sheet the composer re-heights and repaints
triangle for triangle. Height: the template's cross-section at the water (bed,
waterline and the kit on them exactly), the base's own relief from 0.1 to 0.6
off the water's edge, one height per corner across all four parts, and never
under the template's 0.2205 ground floor within 0.6 of the water (the forest
floor dips to 0.10, which would take the bank under the waterline). Colour: a
turf triangle, in the cut or out, takes the base ground's material under it; the
steep bank and its second tone take the family's (`swap` in `parts.json`: forest
`Mat_Forest_trail_dk`/`Mat_Forest_trail`, fields `Mat_Fields_plough_dk`/
`_plough_lt`), as does the wet margin (`margin`: the same dark tone and
`Mat_Forest_floor_shade` or `Mat_Fields_fallow_dk`); a margin triangle the
base's field lifts to 0.44 or more is turf again, fr_lib's own rule. The bed,
the shingle and the three water tones are shared by every family. Props keep
clear of the water and the cut, not of the margin, which is flat turf.
`river_forest_nw_sw` carries one nudge: its woodcutter and fifth conifer 0.15
west, off the bank.

**Four rules**, each in its own file:

- *Water* (`water.ts`). A pool moves rigid and level, at a water line set from
  the ground it lands on, and its basin is carved into the composed ground there
  (ground tucked up to its rim, down under its open water); where it left, the
  dip is filled. A spot too steep to carve drops the pool rather than floating
  it. A pool is never clipped: a town reaching one drops it whole. What rides on
  a pool (lily pads, reeds at its edge) moves with it, and a punt whose water
  went is moored on the nearest pool. The pasture's ground-bound pond keeps its
  dug ground; a building in its water is not built, unless that would cost the
  hall or more than two buildings, in which case the pond gives way and its
  basin is filled.
- *Paving* (`drape.ts`, `paint.ts`). Paving is painted into the ground, not laid
  over it (a smooth sheet on a faceted board reads as a sticker and floats or is
  pierced where the lattices disagree). The ground follows the paving: each
  plaza, spoke and yard floor gets a surface smooth at the ground's 21 cm scale
  (a plane for the plaza, a graded, level-across profile for a spoke, ramped
  down to the chip's disc), and every ground corner under or beside it is set to
  that surface. The ground's own triangles then take the paving's colour. The
  plaza is the largest lattice hexagon inscribed in the authored plaza's circle
  (54 whole triangles, cobbled by triangle in `Mat_Castle_stone` and
  `_stone_lt`); a spoke is a band of whole lattice rows, its axis snapped to the
  nearest lattice bearing and its edges to the lattice lines nearest its width
  (two rows on the 21 cm sheets, one on the lake's coarse one), in the ground's
  own path material from the yard-material table with the odd stone; a yard
  floor is the triangles whose centres it covers, in the yard material. One
  gap-fill pass closes a pocket of up to three bare triangles the paint
  surrounds, and a patch under three triangles is not painted. Painted points
  are evened by at most 1.5 cm, never up inside the chip's disc and never beside
  water. Small ten-triangle kerb stones (`town_kerb_NN`, one part each) are set
  at spaced points along the plaza's and spokes' edges, clear of the chip, every
  building, prop, deck and pool, at deterministic places.
- *Seating* (`place.ts`). Every rigid part stands on its own foot: the
  least-buried of its lowest vertices ends as far over the new support as it was
  over the base, so its downhill side meets the ground, nothing hovers, and
  nothing sinks further than authored. A long, low body (a crop row, a hedge, a
  dune) follows the ground vertex by vertex instead.
- *Wholes* (`props.ts`, `heroes.ts`). Loose parts of one node within 3 cm are
  one thing and move together; a dune the town covers melts under it rather
  than being cut open; a moved hero drops what its real shape lands on, not just
  its footprint circle; and a hero sent into an earlier one, or into the
  clearance round the town or a channel, steps out by the least step (at most
  0.6) that clears it.

`make compose-audit` measures every shipped tile for seven defects (floating
water or paving, ground through paving, orphaned or sunk parts, props inside
props, anything hovering, a smooth sheet laid over the ground, and paint broken
into specks, holed by pinholes or stood on by a prop) against its base, per tile
and per ground; `compose.audit.test.ts` holds every one at zero with no
exceptions.

**How they are held.** `make check-hexes` measures every composed `.glb` (the
shipped file, imported) against the hex contract, and a composed tile inherits
only its base terrain's recorded drift (`hexcontract.DERIVES_FROM`). The
manifest stays one table: `export_assets.py` spreads the composer's
`manifest.composed.generated.ts` into `TILES`. `loader.test.ts` counts a
recipe-built key as reachable by the literal list that selects it
(`TRADE_TILES` in `layers/wagons.ts`, `RIVER_TILE_NAMES` in `layers/rivers.ts`),
as for any other module tile, and both are fetched per board.

**Review before merging a change to any of it.** `make compose-review` writes
one sheet per ground (the shipped tile, then the six directions, close and at
the game camera) and two for the rivers (each composed channel beside the
hand-made pasture one of its shape). Each tile is captioned from the compose
log: what dropped, which spot each hero took, and any spot the composer's own
check disagrees with.
