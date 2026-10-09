// Rivers: the tiles a river hex is drawn with, and the bridges that cross it.
//
// ## Where the split falls
//
// `engine/rivers` sends the shape of every river hex, never the art. Which
// channel a hex draws is a rules fact (it comes from the chain the derivation
// chose, makes hexes meet mouth to mouth, and decides where bridges may
// stand); which file draws that shape is art, known only here. See
// `RiverView` in engine/rivers/view.go.
//
// ## No yaw solver
//
// Turning a tile turns its chip socket, and `layers/chips.ts` keeps every chip
// at one fixed tile-local spot, so a yawed river tile would run its channel
// through the number (a chip disc is radius 0.880 centred 1.5 out; yawed
// water came within 0.10 to 0.88 of that centre). Instead there is a file per
// shape and every river tile is laid at `TILE_ROTATION_Y` like any other.
// `rivers.test.ts`'s "no river tile is ever turned" holds this.
//
// The engine may step all six ways: a mouth on the south-west or south-east
// edge sits 1.500 from the chip mount, against a keep-clear of 1.05 plus half
// the 0.42 water, so no mouth crowds the number.
//
// ## What the art is
//
// A river is a land slab with a water channel cut into it, entering at one
// edge midpoint and leaving at another.
//
//   * Nine two-mouth channels, named for the two board directions they meet,
//     sorted by direction index and joined with an underscore: three straights
//     (`e_w`, `ne_sw`, `nw_se`) and six 120 degree bends (`ne_w`, `e_nw`,
//     `e_sw`, `w_se`, `ne_se`, `nw_sw`). Four of the eight non-`e_w` shapes are
//     hand-authored and four are their mirrors (`ne_w`/`e_nw`, `ne_sw`/`nw_se`,
//     `e_sw`/`w_se`, `ne_se`/`nw_sw`); a mirror is real reflected geometry, not
//     a negative scale, which would flip winding and break the flat-shaded
//     normals.
//   * Each of the nine on six terrains: mountains, hills, pasture and swamp
//     (the four in the reference layout, all hand-made), plus forest and
//     fields, whose tiles are recipe-built (`make compose-tiles`): the
//     pasture's channel of each shape composed into the shipped forest and
//     fields tiles.
//   * `e_w` twice per terrain, `_a` and `_b`: one asymmetric meander and its
//     mirror. East-west is the commonest run and the one shape that repeats
//     within a river; the engine picks between them (see `River.variants`).
//   * Six one-mouth headwaters, `src_e` .. `src_se`, on mountains only: the
//     engine paints every source hex to mountains.
//   * Plus the plain marsh, which carries no channel.
//
// 9 x 6 = 54, plus 6 more for the second `e_w` meander, plus 6 sources, plus the
// marsh: 67 files (47 hand-made, 20 composed). All are on disk, and there is no
// fallback for a missing key: a missing file draws plain terrain rather than a
// plausible wrong channel, and `rivers.test.ts` asserts the pending set is
// empty.
//
// ## Where the numbers come from
//
// The tile art is drawn at circumradius `HEX` with art edge `e`'s midpoint at
// glTF (x, z) = (APOTHEM cos(pi/3 e), -APOTHEM sin(pi/3 e)); art edge 0 is the
// +x edge. A tile is laid down at `TILE_ROTATION_Y`, a half turn, so art edge
// `e` lands on board direction `e + 3` (mod 6), which is how the shape ids
// are read. `riverArt.test.ts` measures this off the shipped files, including
// which pair of edges each channel opens on.
import { riversExt, type FullView, type Hex, type Resource, type RiverShape } from "@/lib/types";
import { edgeKey, hexKey } from "@/lib/hexgeo";
import { edgeToWorld, edgeRotationY, TILE_ROTATION_Y } from "../coords";
import { pieceKey } from "../drop";
import { TILES } from "../manifest.generated";
import type { OwnedPlacement } from "./islands";

/**
 * The six terrains a channel is drawn on. The first four are hand-made; forest
 * and fields are recipe-built (`make compose-tiles`, art/recipes/): the
 * pasture's channel of each shape composed into the shipped forest and fields
 * tiles, so their mouths match the pasture's exactly.
 */
export const RIVER_FAMILIES = [
  "mountains",
  "hills",
  "pasture",
  "swamp",
  "forest",
  "fields",
] as const;
export type RiverFamily = (typeof RIVER_FAMILIES)[number];

/** The nine two-mouth channels, in the order the shape table lists them. */
export const CHANNEL_SHAPES = [
  "e_w",
  "ne_sw",
  "nw_se",
  "ne_w",
  "e_nw",
  "e_sw",
  "w_se",
  "ne_se",
  "nw_sw",
] as const;
export type ChannelShape = (typeof CHANNEL_SHAPES)[number];

/** The six one-mouth headwaters. Mountains only. */
export const SOURCE_SHAPES = ["src_e", "src_ne", "src_nw", "src_w", "src_sw", "src_se"] as const;
export type SourceShape = (typeof SOURCE_SHAPES)[number];

/** The suffix each `e_w` meander's file carries, one per `engine/rivers.EWVariants`. */
const VARIANT_SUFFIX = ["a", "b"] as const;

/** The marsh hex itself, which carries no number and may carry no channel. */
export const SWAMP_TILE = "swamp";

/**
 * The manifest key for one (shape, family), and for `e_w` one variant of it.
 *
 * `river_<terrain>_<shape>`, with `_a`/`_b` on the two `e_w` meanders and
 * `river_mountains_src_<direction>` for a headwater. One rule, so art files
 * and lookups cannot drift apart by a typo.
 */
export function riverTileKey(
  shape: ChannelShape | SourceShape,
  family: RiverFamily,
  variant = 0,
): string {
  if (shape === "e_w") return `river_${family}_e_w_${VARIANT_SUFFIX[variant] ?? "a"}`;
  return `river_${family}_${shape}`;
}

/** Which of the nine two-mouth channels maps to which family of files. */
export const CHANNEL_TILES: Record<ChannelShape, Record<RiverFamily, string>> = Object.fromEntries(
  CHANNEL_SHAPES.map((shape) => [
    shape,
    Object.fromEntries(RIVER_FAMILIES.map((family) => [family, riverTileKey(shape, family)])),
  ]),
) as Record<ChannelShape, Record<RiverFamily, string>>;

/**
 * The six headwater files. Mountains only, a rules fact: `engine/rivers.paint`
 * writes mountains at every source hex (swapping with an off-river mountains
 * hex if needed), so a source on hills or pasture is a board this build does
 * not understand.
 */
export const SOURCE_TILES: Record<SourceShape, string> = Object.fromEntries(
  SOURCE_SHAPES.map((shape) => [shape, riverTileKey(shape, "mountains")]),
) as Record<SourceShape, string>;

/** The second `e_w` meander, per family. */
export const EW_VARIANT_TILES: Record<RiverFamily, string[]> = Object.fromEntries(
  RIVER_FAMILIES.map((family) => [
    family,
    VARIANT_SUFFIX.map((_, v) => riverTileKey("e_w", family, v)),
  ]),
) as Record<RiverFamily, string[]>;

/**
 * Every manifest key the art holds: sixty-six channels and the marsh.
 *
 * Both what a Rivers board can draw and what a base board must not download;
 * `MODULE_TILES` is a filter over `TILES`, so one list does both.
 */
export const RIVER_TILES: readonly string[] = [
  ...CHANNEL_SHAPES.flatMap((shape) =>
    RIVER_FAMILIES.map((family) => CHANNEL_TILES[shape][family]),
  ),
  ...RIVER_FAMILIES.flatMap((family) => EW_VARIANT_TILES[family]),
  ...SOURCE_SHAPES.map((shape) => SOURCE_TILES[shape]),
  SWAMP_TILE,
].filter((key, i, all) => all.indexOf(key) === i);

/**
 * Which shape each manifest key draws, for the art tests.
 *
 * `riverArt.test.ts` cannot ask a .glb which edges its channel opens on, so
 * this table records it. Derived from `riverTileKey`, so name and shape cannot
 * drift apart.
 */
export const RIVER_TILE_SHAPES: Record<string, ChannelShape | SourceShape> = {
  ...Object.fromEntries(
    CHANNEL_SHAPES.flatMap((shape) =>
      RIVER_FAMILIES.map((family) => [CHANNEL_TILES[shape][family], shape] as const),
    ),
  ),
  ...Object.fromEntries(
    RIVER_FAMILIES.flatMap((family) =>
      EW_VARIANT_TILES[family].map((key) => [key, "e_w"] as const),
    ),
  ),
  ...Object.fromEntries(SOURCE_SHAPES.map((shape) => [SOURCE_TILES[shape], shape] as const)),
};

/**
 * Which terrain family each manifest key belongs to, for the art tests.
 *
 * Separate from `RIVER_TILE_SHAPES` because the art tests hold each family to
 * its own props: a mountains river carries a peak, scree, a tree and a fall
 * whichever way its channel runs.
 */
export const RIVER_TILE_FAMILIES: Record<string, RiverFamily> = {
  ...Object.fromEntries(
    CHANNEL_SHAPES.flatMap((shape) =>
      RIVER_FAMILIES.map((family) => [CHANNEL_TILES[shape][family], family] as const),
    ),
  ),
  ...Object.fromEntries(
    RIVER_FAMILIES.flatMap((family) =>
      EW_VARIANT_TILES[family].map((key) => [key, family] as const),
    ),
  ),
  ...Object.fromEntries(SOURCE_SHAPES.map((shape) => [SOURCE_TILES[shape], "mountains"] as const)),
  [SWAMP_TILE]: "swamp",
};

/**
 * The same keys, spelled out. Do not derive this list.
 *
 * Everything above builds keys with `riverTileKey`, so no river tile name
 * appears as a literal, and `loader.test.ts`'s reachability check (that every
 * exported tile is named by something other than the generated manifest)
 * would treat them as dead art. So the list is written out, and
 * `rivers.test.ts` asserts it equals `RIVER_TILES`.
 */
export const RIVER_TILE_NAMES: readonly string[] = [
  // The mountains.
  "river_mountains_e_w_a",
  "river_mountains_e_w_b",
  "river_mountains_ne_sw",
  "river_mountains_nw_se",
  "river_mountains_ne_w",
  "river_mountains_e_nw",
  "river_mountains_e_sw",
  "river_mountains_w_se",
  "river_mountains_ne_se",
  "river_mountains_nw_sw",
  // ...and the six headwaters, which are the mountains' alone.
  "river_mountains_src_e",
  "river_mountains_src_ne",
  "river_mountains_src_nw",
  "river_mountains_src_w",
  "river_mountains_src_sw",
  "river_mountains_src_se",
  // The hills.
  "river_hills_e_w_a",
  "river_hills_e_w_b",
  "river_hills_ne_sw",
  "river_hills_nw_se",
  "river_hills_ne_w",
  "river_hills_e_nw",
  "river_hills_e_sw",
  "river_hills_w_se",
  "river_hills_ne_se",
  "river_hills_nw_sw",
  // The pasture.
  "river_pasture_e_w_a",
  "river_pasture_e_w_b",
  "river_pasture_ne_sw",
  "river_pasture_nw_se",
  "river_pasture_ne_w",
  "river_pasture_e_nw",
  "river_pasture_e_sw",
  "river_pasture_w_se",
  "river_pasture_ne_se",
  "river_pasture_nw_sw",
  // The swamp.
  "river_swamp_e_w_a",
  "river_swamp_e_w_b",
  "river_swamp_ne_sw",
  "river_swamp_nw_se",
  "river_swamp_ne_w",
  "river_swamp_e_nw",
  "river_swamp_e_sw",
  "river_swamp_w_se",
  "river_swamp_ne_se",
  "river_swamp_nw_sw",
  // The forest: recipe-built (art/recipes/river_forest_*.json).
  "river_forest_e_w_a",
  "river_forest_e_w_b",
  "river_forest_ne_sw",
  "river_forest_nw_se",
  "river_forest_ne_w",
  "river_forest_e_nw",
  "river_forest_e_sw",
  "river_forest_w_se",
  "river_forest_ne_se",
  "river_forest_nw_sw",
  // The fields: recipe-built likewise.
  "river_fields_e_w_a",
  "river_fields_e_w_b",
  "river_fields_ne_sw",
  "river_fields_nw_se",
  "river_fields_ne_w",
  "river_fields_e_nw",
  "river_fields_e_sw",
  "river_fields_w_se",
  "river_fields_ne_se",
  "river_fields_nw_sw",
  // And the marsh, which carries no channel.
  "swamp",
];

/**
 * Which module owns each of them, in the shape `MODULE_TILES` wants.
 *
 * Spread into that table, so a new river tile is one line here.
 *
 * This is the keep-out list and names all sixty-seven: `MODULE_TILES` stops a
 * base game downloading river tiles. What a Rivers game fetches is narrower;
 * see the two lists below.
 */
export const RIVER_MODULE_TILES: Record<string, string> = Object.fromEntries(
  RIVER_TILES.map((tile) => [tile, "rivers"]),
);

/**
 * The only river tile a ruleset-level prefetch fetches: the marsh.
 *
 * The prefetch runs in the lobby, before the board exists. The river set is
 * 6.5 MB of a 7.7 MB tile directory, and a board draws at most one tile per
 * river hex (a handful, with chains capped at six). The marsh is cheap and on
 * every Rivers board (a river ends on one), and its file does not depend on
 * the derived shapes. Channels are fetched per board by `boardTileFiles` in
 * loader.ts; the loader caches per file, so a late fetch costs one round trip
 * on the first board.
 */
export const RIVER_PREFETCH_TILES: readonly string[] = [SWAMP_TILE];

/** Every river tile that is fetched per board rather than per ruleset. */
export const RIVER_BOARD_TILES: readonly string[] = RIVER_TILES.filter(
  (tile) => !RIVER_PREFETCH_TILES.includes(tile),
);

/** Node-name prefix in bridges.glb. Span, rails and abutments are one bridge. */
export const BRIDGE_PREFIX = "Bridge_";

/**
 * Which family of channel tiles a river hex's terrain is drawn from.
 *
 * The engine guarantees the set: the source becomes mountains (swapping with
 * a mountains hex if needed), every hex between keeps whichever of the five
 * producing terrains it was dealt (derivation 11), and the estuary becomes
 * swamp. Any other terrain is a frame this build does not understand;
 * `riverTileFor` draws the plain terrain rather than guessing.
 */
const TILE_FAMILY: Partial<Record<Resource, RiverFamily>> = {
  ore: "mountains",
  brick: "hills",
  sheep: "pasture",
  swamp: "swamp",
  // Forest and fields: tiles composed rather than hand-made (see
  // RIVER_FAMILIES).
  wood: "forest",
  wheat: "fields",
};

/** One river hex, ready for `planTiles` to lay down. */
export interface RiverTilePlan {
  hex: Hex;
  /** The manifest FILE, as `TilePlacement.file` carries it. */
  file: string;
  /**
   * The tile's turn about Y.
   *
   * Always `TILE_ROTATION_Y`, carried to make the claim explicit: a river tile
   * keeps the board's facing so its chip socket faces the viewer. See the
   * header.
   */
  rotationY: number;
}

function isSourceShape(shape: string): shape is SourceShape {
  return (SOURCE_SHAPES as readonly string[]).includes(shape);
}

function isChannelShape(shape: string): shape is ChannelShape {
  return (CHANNEL_SHAPES as readonly string[]).includes(shape);
}

/**
 * The tile and the turn for every river hex on the board.
 *
 * A hex is skipped (and draws its plain terrain) when anything cannot be
 * answered: a terrain outside the families, an unknown shape, a headwater not
 * on mountains, or a file missing from the manifest. A gap reads as missing
 * art; a guess would read as wrong art and an unexplained bridge site.
 *
 * Terrain comes from the board's tile list, because the river derivation
 * swaps terrain to put its headwater on mountains.
 */
export function planRiverTiles(view: FullView): RiverTilePlan[] {
  const rivers = riversExt(view)?.rivers ?? [];
  if (rivers.length === 0) return [];
  const terrain = new Map<string, Resource>();
  for (const t of view.board?.tiles ?? []) terrain.set(hexKey(t.hex), t.res);

  const out: RiverTilePlan[] = [];
  for (const river of rivers) {
    const hexes = river.hexes ?? [];
    for (let i = 0; i < hexes.length; i++) {
      const plan = riverTileFor(
        hexes[i],
        terrain.get(hexKey(hexes[i])),
        river.shapes?.[i],
        river.variants?.[i] ?? 0,
      );
      if (plan) out.push(plan);
    }
  }
  return out;
}

/**
 * The distinct tile files this board's rivers draw.
 *
 * The board-aware half of the prefetch split: exactly what `planRiverTiles`
 * will ask the loader for, deduped, so the files can be fetched in parallel
 * as soon as the view arrives. Empty on boards without rivers.
 */
export function riverTileFiles(view: FullView): string[] {
  return [...new Set(planRiverTiles(view).map((plan) => plan.file))];
}

/** One hex's tile, or null when it should draw its plain terrain. */
function riverTileFor(
  hex: Hex,
  res: Resource | undefined,
  shape: RiverShape | undefined,
  variant: number,
): RiverTilePlan | null {
  if (!res || !shape) return null;
  const family = TILE_FAMILY[res];
  if (!family) return null;
  if (!isChannelShape(shape) && !isSourceShape(shape)) return null;
  // A headwater exists only on mountains, and the engine paints every source
  // hex to mountains, so any other terrain draws plain rather than a channel
  // starting in a field.
  if (isSourceShape(shape) && family !== "mountains") return null;
  const key = isSourceShape(shape) ? SOURCE_TILES[shape] : riverTileKey(shape, family, variant);
  const entry = TILES[key];
  // Absent from the manifest means the art was not exported; draw the plain
  // terrain. No nearest shape is substituted: every key is on disk, so a miss
  // is a broken build and should show. See the header.
  if (!entry) return null;
  return { hex, file: entry.file, rotationY: TILE_ROTATION_Y };
}

/**
 * Every built bridge, as a seat-tinted edge piece.
 *
 * A bridge takes the road's placement exactly: it stands in the road's slot,
 * at the same midpoint, drawn scale (`MODULE_SCALE.bridge`) and gutter.
 * `bridgeArt.test.ts` measures the shipped piece against `pieces.glb`'s road.
 *
 * `edgeRotationY` rather than a bearing, because the piece is symmetric about
 * its middle (also asserted by `bridgeArt.test.ts`): an `Edge` is unordered,
 * so an asymmetric bridge would sit backwards on about half the crossings.
 */
export function planBridges(view: FullView): OwnedPlacement[] {
  const bridges = riversExt(view)?.bridges ?? [];
  return bridges.map((b) => ({
    owner: b.player,
    position: edgeToWorld(b.e),
    rotationY: edgeRotationY(b.e),
    key: pieceKey("bridge", b.player, edgeKey(b.e)),
  }));
}
