"""Naming conventions for the board blends under `art/`.

Imports no bpy, so it unit-tests without Blender.
The exporter's correctness rests on these conventions; the golden manifest
test fails if the blend drifts from them.
"""

import re

# Terrain name in the blend -> engine resource string
# (engine/board/resource_json.go:12-21). Every resource but `fog` has art of
# its own now; `fog` alone still falls back to the sea tile at load time
# (RESOURCE_FALLBACK in export_assets.py).
TERRAIN_TO_RESOURCE = {
    "Forest": "wood",
    "Hills": "brick",
    "Pasture": "sheep",
    "Fields": "wheat",
    "Mountains": "ore",
    "Desert": "none",
    # Fishermen floods one desert into a lake. It is land to the engine
    # (board.Land is true; roads and settlements go round its shore), so its
    # art follows the land contract.
    "Lake": "lake",
    # Caravans derives one desert into the oasis at setup; it is not a
    # generated terrain and has no engine resource, so the renderer selects
    # this tile per hex (board3d/layers/caravans.ts) rather than by resource.
    "Oasis": "oasis",
    "Gold": "gold",
    "Ocean": "sea",
    # No "Shore" entry: `art/hexes/shore.blend` is kept as authored art, but
    # nothing selects the tile (`sea_shore` is not an engine resource). The
    # reachability check in frontend/src/lib/board3d/loader.test.ts would flag
    # it. Re-add it only with something that asks for the tile.
    "Port": "sea_port",
    "Generic": "generic",
    # Raiders places one castle hex on the board. Like the oasis it is not a
    # generated terrain and no engine resource names it, so `castle` here is a
    # manifest key rather than a wire string, and the renderer selects the tile
    # per hex (`MODULE_TILES` in board3d/loader.ts) rather than by resource.
    "Castle": "castle",
    # Explorers. Three derived tiles, none an engine resource (like the
    # oasis): the key is the exporter's file name and the handle
    # `loader.ts:MODULE_TILES` gates the prefetch on. Each is modelled on the
    # shipped tile it derives from; see `art/README.md`.
    #
    # No "Unexplored" entry: an unrevealed hex is hidden information, so the
    # `MaskBoard` hook rewrites it to the wire-only `fog` resource, drawn as
    # sea with mist over it.
    #
    # `Shoal` takes a `sea_` key because it is sea (see
    # `lattice.WATER_TERRAINS`).
    "Goldfield": "goldfield",
    "Shoal": "sea_shoal",
    "Spice": "spice",
    # The Council, Explorers' delivery hex. A sea tile with a walled harbour
    # town on a rock in it, authored on the ocean's own hull and wave sheet
    # (like the shoal), so it takes a `sea_` key and sits in
    # `lattice.WATER_TERRAINS`. No chip socket. Its two stone quays run to the
    # blend's +y and -y corners, which at the board's TILE_ROTATION_Y are the
    # hex's North and South corners (vertex sides 0 and 1): the renderer yaws
    # the tile by a multiple of 60 degrees to put them on the engine's anchor
    # pair. See `layers/explorers.ts` `planCouncil`.
    "Council": "sea_council",
    # Rivers. Module-derived tiles like the oasis: a river is a property of a
    # hex laid down at setup, not a dealt terrain. Listed here so
    # `export_assets.main` exports them; the renderer selects them per hex
    # (`frontend/src/lib/board3d/layers/rivers.ts` names each as a literal for
    # `loader.test.ts`'s reachability check).
    #
    # One file per shape, and no river tile is ever yawed: the number chip
    # does not turn with a tile (`layers/chips.ts`), so a rotated bend could
    # run its channel through the number. Every river tile is laid at
    # TILE_ROTATION_Y.
    #
    # One key per blend: `hex_blend` derives the path from the key.
    "Swamp": "swamp",
    # The mountains family. Sixteen tiles named for the sorted compass pair of
    # their two mouths.
    #
    # Nine shapes (every non-adjacent edge pair): three straights and six
    # 120-degree bends. The east-west straight ships only as two authored
    # meanders, `e_w_a` and its mirror `e_w_b`, on every family, so repeated
    # east-west reaches vary. There is no bare `River_Mountains_E_W`
    # (`riverTileKey` never asks for one).
    # `src_*` are the six headwater tiles: one mouth, a tarn at the head and
    # the water fanning into rivulets, which is where a river can begin.
    #
    # Blend edge angles, chip socket at +y (90): E=180, NE=240, NW=300, W=0,
    # SW=60, SE=120. So `e_w` opens at 180 and 0, `ne_sw` at 240 and 60, and so
    # on, and no tile is ever yawed: the shape names the file.
    "River_Mountains_E_W_A": "river_mountains_e_w_a",
    "River_Mountains_E_W_B": "river_mountains_e_w_b",
    "River_Mountains_NE_SW": "river_mountains_ne_sw",
    "River_Mountains_NW_SE": "river_mountains_nw_se",
    "River_Mountains_NE_W": "river_mountains_ne_w",
    "River_Mountains_E_NW": "river_mountains_e_nw",
    "River_Mountains_E_SW": "river_mountains_e_sw",
    "River_Mountains_W_SE": "river_mountains_w_se",
    "River_Mountains_NE_SE": "river_mountains_ne_se",
    "River_Mountains_NW_SW": "river_mountains_nw_sw",
    "River_Mountains_Src_E": "river_mountains_src_e",
    "River_Mountains_Src_W": "river_mountains_src_w",
    "River_Mountains_Src_NE": "river_mountains_src_ne",
    "River_Mountains_Src_NW": "river_mountains_src_nw",
    "River_Mountains_Src_SE": "river_mountains_src_se",
    "River_Mountains_Src_SW": "river_mountains_src_sw",
    # The hills family, re-cut on the same shape table and to the same channel:
    # water 0.60 bank to bank, cut 0.70 at the slab's top face, mouths on the
    # edge midpoint, bank at the mouth 0.2205. What differs is the line: a
    # sharp zigzag through the hills where the pasture gets a lazy meander,
    # so these turn 80 to 105 degrees at
    # corners filleted to 0.45 rather than sweeping through them.
    #
    # Ten tiles: the east-west straight is two meanders (`riverTileKey` in
    # board3d/layers/rivers.ts, `EWVariants` in Go), so no plain
    # `river_hills_e_w`. No `Src_*`: `engine/rivers.paint` writes mountains at
    # every source hex.
    "River_Hills_E_W_A": "river_hills_e_w_a",
    "River_Hills_E_W_B": "river_hills_e_w_b",
    "River_Hills_NE_SW": "river_hills_ne_sw",
    "River_Hills_NW_SE": "river_hills_nw_se",
    "River_Hills_NE_W": "river_hills_ne_w",
    "River_Hills_E_NW": "river_hills_e_nw",
    "River_Hills_E_SW": "river_hills_e_sw",
    "River_Hills_W_SE": "river_hills_w_se",
    "River_Hills_NE_SE": "river_hills_ne_se",
    "River_Hills_NW_SW": "river_hills_nw_sw",
    # The pasture family, third onto the same shape table and cut to the same
    # channel to the millimetre: water 0.60 bank to bank, cut 0.70 at the
    # slab's top face, mouths on the edge midpoint, bank at the mouth 0.2205.
    # The section is the seam between families, so it never varies.
    #
    # What differs is the line: these sweep, two or three changes of direction
    # inside the hex, amplitude about +-0.5, corners filleted at 1.00 against
    # the hills' 0.45. The banks are cut in `Mat_Pasture_mud`, and the wet
    # collar breaks three or four times down the reach.
    #
    # Ten tiles and no `Src_*`, for the hills' reasons.
    "River_Pasture_E_W_A": "river_pasture_e_w_a",
    "River_Pasture_E_W_B": "river_pasture_e_w_b",
    "River_Pasture_NE_SW": "river_pasture_ne_sw",
    "River_Pasture_NW_SE": "river_pasture_nw_se",
    "River_Pasture_NE_W": "river_pasture_ne_w",
    "River_Pasture_E_NW": "river_pasture_e_nw",
    "River_Pasture_E_SW": "river_pasture_e_sw",
    "River_Pasture_W_SE": "river_pasture_w_se",
    "River_Pasture_NE_SE": "river_pasture_ne_se",
    "River_Pasture_NW_SW": "river_pasture_nw_sw",
    # The swamp family, fourth and last onto the same shape table and cut to
    # the same channel: water 0.60 bank to bank, cut 0.70 at the slab's top
    # face, mouths on the edge midpoint, bank at the mouth 0.2205, so any two
    # river hexes meet mouth to mouth seamlessly.
    #
    # The swamp is the estuary (`engine/rivers.paint` writes marsh at the
    # mouth): two long slack sweeps at the widest fillet the legs allow,
    # mid-channel silt shoals, braided backwaters with lily pads in the crook
    # of the bends, sedge on the banks, and its own cut in `Mat_Swamp_mud`
    # under a `Mat_Swamp_bog_dk` lip. No ford on any of them, and no `Src_*`
    # (a source hex is always mountains).
    "River_Swamp_E_W_A": "river_swamp_e_w_a",
    "River_Swamp_E_W_B": "river_swamp_e_w_b",
    "River_Swamp_NE_SW": "river_swamp_ne_sw",
    "River_Swamp_NW_SE": "river_swamp_nw_se",
    "River_Swamp_NE_W": "river_swamp_ne_w",
    "River_Swamp_E_NW": "river_swamp_e_nw",
    "River_Swamp_E_SW": "river_swamp_e_sw",
    "River_Swamp_W_SE": "river_swamp_w_se",
    "River_Swamp_NE_SE": "river_swamp_ne_se",
    "River_Swamp_NW_SW": "river_swamp_nw_sw",
    # No forest or fields rivers here, and no trade towns: `river_forest_*`,
    # `river_fields_*` (ten shapes each) and the forty-eight
    # `trade_<ground>_<dir>` are recipe-built: no blend exports them,
    # `frontend/scripts/compose-tiles.ts` composes them out of the shipped tiles
    # and art/trade/parts/ (`make compose-tiles`), one recipe per tile under
    # art/recipes/. This table is what makes `export_assets.main` open
    # `art/hexes/<key>.blend`, so an entry here would be a blend that does not
    # exist. `recipes.py` is their table: `make check-hexes` measures them from
    # it, and `layers/rivers.ts` / `layers/wagons.ts` name them for the renderer.
}

SEAT_PREFIX = "Seat_"

_CHIP_RE = re.compile(r"^Chip_(\d{2})_(\d)_(.+)$")


def hex_terrain(name):
    """'Hex_Desert' -> 'Desert'; None if not a known hex tile."""
    if not name.startswith("Hex_"):
        return None
    terrain = name[len("Hex_") :]
    return terrain if terrain in TERRAIN_TO_RESOURCE else None


def socket_terrain(name):
    """'Token_Gold' -> 'Gold'; None if not a known chip socket."""
    if not name.startswith("Token_"):
        return None
    terrain = name[len("Token_") :]
    return terrain if terrain in TERRAIN_TO_RESOURCE else None


def parse_chip(name):
    """'Chip_06_2_numeral' -> (6, 2, 'numeral'). None for Chip_blank_* etc."""
    m = _CHIP_RE.match(name)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), m.group(3)


def is_tint_material(name):
    """True for materials the runtime recolors per seat."""
    return name.startswith(SEAT_PREFIX)


# --- Wagons trade towns: hand-authored parts for the export-time composer ---
#
# The trade hex is drawn as the hex's own base tile (any of the eight grounds
# below) with a market town composed onto its seaward half. People author the
# parts in `art/trade/parts.blend`; a script composes the 48 variants
# (8 grounds x 6 directions). Nothing here is a shipped tile: the parts export
# to `art/trade/parts/`, never into the manifest, and the composed tiles are
# what ship; `tools/blender/export_trade_parts.py` writes the parts.
#
# Frame: every part is authored in the base tile's own Blender frame: origin at
# the hex centre, +z up, the number-chip socket at (0, +1.5, 0.26). The chip
# never turns with a tile (`layers/chips.ts`), so the composer turns only the
# town, never the ground. In the glTF file frame that is (x, z, -y).

#: The eight grounds a trade hex can stand on, as terrain names (so
#: `Hex_<Terrain>` and `art/hexes/<terrain>.blend` resolve).
TRADE_GROUNDS = ("Hills", "Forest", "Pasture", "Fields", "Mountains", "Desert", "Swamp", "Lake")

#: World compass direction of the seaward half (the normal of the middle of the
#: three blocked edges, `seawardEdges` in engine/wagons/board.go) -> the angle
#: of that normal in the tile's Blender frame, degrees CCW from +x. Same table
#: as the river mouths: chip corner at 90.
TRADE_DIR_ANGLE = {"W": 0, "SW": 60, "SE": 120, "E": 180, "NE": 240, "NW": 300}

#: How a direction's town is made from one of the two authored layouts:
#: (family, rotate_deg, mirror_x). Tile point = Mx^mirror . Rz(rotate) . layout
#: point, rotation first, about +z CCW (three.js: about +y by the same angle);
#: Mx negates x (so a composer must also reverse triangle winding). Mirroring
#: in x keeps the chip corner (90) where it is, which is why E, NE and SE are
#: mirrors rather than rotations: a layout then has to keep clear only the
#: chip positions of its own two (W) or one (SW) unmirrored uses.
TRADE_LAYOUT = {
    "W": ("W", 0, False),
    "E": ("W", 0, True),
    "NW": ("W", 300, False),
    "NE": ("W", 300, True),
    "SW": ("SW", 0, False),
    "SE": ("SW", 0, True),
}

#: The lake town is not composed from a family: the lake does not turn with
#: the town, so each direction is authored directly in the tile frame
#: (identity transform) as `LakeTown_<DIR>_*`.
TRADE_LAKE_DIRS = tuple(TRADE_DIR_ANGLE)

#: Part name -> how the composer treats it, by the part's suffix.
#:   bed    flatten target, never drawn: base ground inside it is pulled to its
#:          heights (plus the composer's ground offset), untouched outside.
#:   drape  laid on the composed ground: every vertex keeps its height above
#:          the bed and follows the ground; clamp to 0.249 in the chip disc.
#:   fixed  keeps its authored z exactly (things standing in the lake water,
#:          whose level is fixed by the lake tile).
#:   rigid  moved as one body: its node origin is its seat (footprint centre,
#:          local z=0 is the ground line); set down on the composed ground.
TRADE_DRAPE_PARTS = ("plaza", "paving", "yardfloor", "path")
TRADE_FIXED_PARTS = ("deck", "boardwalk", "quay", "pier", "stilts")

_TOWN_RE = re.compile(r"^(Town|LakeTown)_(W|SW|E|NE|NW|SE|Tile)_([a-z]+)(?:_(\d{2}))?$")
_HERO_RE = re.compile(r"^Hero_([A-Z][a-z]+)_([a-z]+\d*)$")
_SPOT_RE = re.compile(r"^Spot_([A-Z][a-z]+)_(W|SW|E|NE|NW|SE)_([a-z]+\d*)(_alt)?$")
_RIVER_SPOT_RE = re.compile(r"^RiverSpot_([A-Z][a-z]+)_((?:[A-Z]+_)*[A-Z]+)_([a-z]+\d*)(_alt)?$")

#: The river channel shapes the composer can lay through a trade-free forest
#: or fields hex, named as the `river_pasture_*` templates it borrows the
#: channel from (`River_Pasture_<SHAPE>` above, e.g. `E_W_A`).
TRADE_RIVER_SHAPES = ("E_W_A", "E_W_B", "NE_SW", "NW_SE", "NE_W", "E_NW", "E_SW", "W_SE", "NE_SE", "NW_SW")


def trade_part_role(part):
    """'plaza' -> 'drape', 'bed' -> 'bed', 'deck' -> 'fixed', 'house' -> 'rigid'."""
    if part == "bed":
        return "bed"
    if part in TRADE_DRAPE_PARTS:
        return "drape"
    if part in TRADE_FIXED_PARTS:
        return "fixed"
    return "rigid"


def parse_trade_part(name):
    """'Town_W_house_03' -> ('Town', 'W', 'house', 3, 'rigid'); None otherwise.

    For `Town` the second field is a family (W or SW) or `Tile`, the parts
    every direction shares in the tile frame and that are never turned (the
    plaza, whose chip-side edge is cut to the chip's keep-clear disc); for
    `LakeTown` it is a direction (all six).
    """
    m = _TOWN_RE.match(name)
    if not m:
        return None
    kind, key, part, num = m.groups()
    if kind == "Town" and key not in ("W", "SW", "Tile"):
        return None
    if kind == "LakeTown" and key == "Tile":
        return None
    return kind, key, part, int(num) if num else None, trade_part_role(part)


def parse_trade_hero(name):
    """'Hero_Hills_kiln' -> ('Hills', 'kiln'); None otherwise."""
    m = _HERO_RE.match(name)
    if not m or m.group(1) not in TRADE_GROUNDS:
        return None
    return m.group(1), m.group(2)


def parse_trade_spot(name):
    """'Spot_Hills_E_kiln_alt' -> ('Hills', 'E', 'kiln', True); None otherwise."""
    m = _SPOT_RE.match(name)
    if not m or m.group(1) not in TRADE_GROUNDS:
        return None
    return m.group(1), m.group(2), m.group(3), bool(m.group(4))


def parse_trade_river_spot(name):
    """'RiverSpot_Forest_NE_SW_stand' -> ('Forest', 'NE_SW', 'stand', False)."""
    m = _RIVER_SPOT_RE.match(name)
    if not m or m.group(1) not in TRADE_GROUNDS or m.group(2) not in TRADE_RIVER_SHAPES:
        return None
    return m.group(1), m.group(2), m.group(3), bool(m.group(4))
