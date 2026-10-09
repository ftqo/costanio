// Raiders: the castle, the riders on the paths, and the raiders on the coast.
//
// Vocabulary: a raider is a neutral figure on a hex (`barbarians.glb`, no seat
// material, up to three per hex). A rider is a seat-tinted figure on a path
// (`riders.glb`, one per edge). The words differ by one letter and both are
// drawn on the same coastline, so neither is abbreviated here.
//
// The castle is a per-hex override, like the Caravans oasis: `engine/raiders`
// picks the centre-most ordinary interior hex and leaves the tile alone, so
// the tile still reads `wood` or `ore` with a number, and `tileFileFor`
// (resources only) cannot find it.
import { raidersExt, type FullView, type BoardTile, type Hex } from "@/lib/types";
import { edgeKey } from "@/lib/hexgeo";
import { TILES } from "../manifest.generated";
import { hexKey, hexToWorld, edgeToWorld, edgeRotationY, type Vec3 } from "../coords";
import { TILE_ROTATION_Y } from "./tiles";
import { CASTLE_TILE } from "../loader";
import type { Placement } from "../instancing";
import { seatY, SURFACE } from "../seating";
import type { TileArt } from "./caravans";

/**
 * Node-name prefix in riders.glb. Helm, horse, lance, saddle, shield and torso
 * are one rider, and every one of them wears a `Seat_*` material.
 */
export const RIDER_PREFIX = "Rider_";

/**
 * Node-name prefix in barbarians.glb.
 *
 * `Barbarian_` because that is the art's name: the file predates the module
 * and is shared with a future Wagons. The rules name is raider.
 */
export const RAIDER_PREFIX = "Barbarian_";

/**
 * The hex to draw the castle over, or null.
 *
 * The wire decides whether there is one: `ViewExt` emits `castle` only when
 * the module derived one (`HasCastle`), as a nullable hex like the oasis and
 * the pirate. A bare hex could not say "no castle", since {q:0,r:0} is a real
 * hex at the board centre, where a live castle usually sits.
 *
 * The remaining check guards a malformed frame: the hex must be on this board.
 * No terrain whitelist, unlike the oasis: the castle can sit on any of the
 * five resources. Its number chip is hidden by `castleChipHidden`.
 */
export function castleHex(view: FullView): BoardTile | null {
  const castle = raidersExt(view)?.castle;
  if (!castle) return null;
  const key = hexKey(castle);
  return view.board.tiles.find((t) => hexKey(t.hex) === key) ?? null;
}

/**
 * The castle's tile override, in the shape the tile layers already take.
 *
 * Named apart from Caravans' `tileArtOverrides`: both produce a `TileArt`
 * and `Board3D` merges the three sources (this, the oasis, the fog).
 *
 * `land` as well as `files`, because art is per hex while beach, gutter sand
 * and tile scale are per resource. The tile under a castle is already land;
 * naming it keeps that true if the castle is ever placed elsewhere.
 */
export function castleTileArt(view: FullView): TileArt {
  const files = new Map<string, string>();
  const land = new Set<string>();
  const castle = castleHex(view);
  // Absent from the manifest until exported; the terrain underneath is better
  // than a 404.
  const entry = TILES[CASTLE_TILE];
  if (castle && entry) {
    files.set(hexKey(castle.hex), entry.file);
    land.add(hexKey(castle.hex));
  }
  // No `yaw` entries: the castle's art is composed for the board's facing,
  // like the oasis and unlike a river channel. An empty map makes no claim in
  // Board3D's merge.
  return { files, land, yaw: new Map() };
}

/**
 * The hexes whose number chip must not be drawn.
 *
 * Only the castle, in a Raiders game. The tile keeps its resource and number
 * on the wire, because the engine does not rewrite the board (the chip layout
 * is what the fairness audit reproduces from the seed). The castle produces
 * nothing, so its chip is hidden.
 *
 * A key set rather than a per-hex callback, so the chip layer pays one hash
 * per tile. Empty without Raiders or without a castle.
 */
export function castleChipHidden(view: FullView): Set<string> {
  const castle = castleHex(view);
  return castle ? new Set([hexKey(castle.hex)]) : new Set<string>();
}

/** A rider, with the seat it belongs to. Tinted at draw time, never here. */
export interface RiderPlacement extends Placement {
  owner: number;
  key: string;
}

/**
 * Every rider on the board.
 *
 * An edge piece placed like a road: the edge midpoint and `edgeRotationY`,
 * from art authored along +x.
 *
 * A rider faces +x (`riderArt.test.ts`), but `edgeRotationY` is an axis, not
 * a bearing (`NewEdge` normalises by (q, r, side)), so about half face the
 * other way along their path. Unlike the camel's caravan, a rider has no
 * ordered chain and the wire carries only the path, so there is no bearing to
 * recover. A horse facing either way along its path still reads correctly;
 * an invented bearing would not.
 *
 * The colour is resolved at draw time (`seatTint(colorOf(owner))` in
 * `Board3D`), so one instanced mesh serves ten seats.
 */
export function planRiders(view: FullView): RiderPlacement[] {
  const riders = raidersExt(view)?.riders ?? [];
  return riders.map((r) => ({
    owner: r.player,
    position: edgeToWorld(r.e),
    rotationY: edgeRotationY(r.e),
    key: `rider:${edgeKey(r.e)}`,
  }));
}

/**
 * The muster: how three raiders stand on one hex.
 *
 * A splayed triangle: a row reads as one long object at this elevation and a
 * stack cannot be counted, so the figures sit on a small circle, each turned
 * outward. The numbers come from `tools/blender/render_barbarians.py`;
 * `barbarianArt.test.ts` reads them from here and checks the footprint clears
 * the number chip and stays inside the tile at every bearing, so any change
 * must pass that test.
 *
 * They are in the tile's authored (Blender) frame, not world space. See
 * `tileFrameToWorld`.
 */
export const MUSTER_RADIUS = 0.45;
export const MUSTER_SHIFT: readonly [number, number] = [0.0, -0.6];
export const MUSTER_BEARINGS: readonly number[] = [90, 210, 330];

/**
 * Each muster slot's size, as a factor on `MODULE_SCALE.raider`.
 *
 * The third figure stands taller: three raiders is a conquered hex, which a
 * player must read across the table, and three equal figures read as scenery.
 * The third slot is the south-east one (330 degrees authored), furthest from
 * the number chip, so it can grow without entering the chip's keep-clear;
 * `barbarianArt.test.ts` checks the keep-clear and the tile edge with these
 * factors. The first two stay at 1.
 */
export const MUSTER_SCALE: readonly number[] = [1, 1, 1.3];

/**
 * A point in a tile's authored frame, as a world offset from the hex centre.
 *
 * Two turns: Blender's +y is the board's -z (the export maps (x, y, z) to
 * (x, z, -y)), and every tile is laid down turned by `TILE_ROTATION_Y`, which
 * is why the chip, authored at Blender (0, 1.5), ends up at world z = +1.5
 * (see `CHIP_OFFSET_Z`). Together they give (x, y) -> (-x, +y) in world (x, z).
 *
 * The offsets are already world units: the art is authored at `HEX_SIZE`, so
 * these are measured off `HEX_SIZE` rather than `LATTICE_SIZE`, like
 * `CHIP_OFFSET_Z`.
 */
function tileFrameToWorld(bx: number, by: number): [number, number] {
  return [-bx, by];
}

/** The same half turn, for a heading authored in that frame. */
function tileFrameYaw(bearingDeg: number): number {
  return (bearingDeg * Math.PI) / 180 + TILE_ROTATION_Y;
}

/**
 * Every raider figure on the board: up to three per coastal hex.
 *
 * Neutral: the art has no `Seat_*` material and nothing here reads an owner,
 * so a raider is never mistaken for a seat-tinted rider.
 *
 * Driven off `raider_count`, parallel to `coast`. Three is a conquered hex,
 * which draws three figures; its chip is handled by `hiddenChips`.
 */
export function planRaiders(view: FullView): Placement[] {
  const ext = raidersExt(view);
  const centreFigures = ext?.shared_paths
    ? (ext.path_figures ?? []).filter((r) => r.alive && !r.on_path)
    : undefined;
  const coast = centreFigures?.map((r) => r.hex) ?? ext?.coast ?? [];
  const counts = centreFigures?.map(() => 1) ?? ext?.raider_count ?? [];
  const out: Placement[] = [];
  for (let i = 0; i < coast.length; i++) {
    const n = Math.min(counts[i] ?? 0, MUSTER_BEARINGS.length);
    if (n <= 0) continue;
    const [cx, , cz] = hexToWorld(coast[i]);
    for (let k = 0; k < n; k++) {
      const b = (MUSTER_BEARINGS[k] * Math.PI) / 180;
      const [dx, dz] = tileFrameToWorld(
        MUSTER_SHIFT[0] + MUSTER_RADIUS * Math.cos(b),
        MUSTER_SHIFT[1] + MUSTER_RADIUS * Math.sin(b),
      );
      const position: Vec3 = [cx + dx, 0, cz + dz];
      out.push({
        position,
        rotationY: tileFrameYaw(MUSTER_BEARINGS[k]),
        // Relative: the caller multiplies it into MODULE_SCALE.raider when it
        // seats the figure (see `seatRaiders`).
        scale: MUSTER_SCALE[k] ?? 1,
        // Keyed by hex and slot, so a second raider on a hex is a new instance
        // rather than the first one moving.
        key: `raider:${hexKey(coast[i])}:${k}`,
      });
    }
  }
  return out;
}

/**
 * The raiders, seated on the land surface at their own sizes: each placement's
 * relative `scale` (its slot's `MUSTER_SCALE`) times `base`, the figure's
 * `MODULE_SCALE.raider`. Seated one by one, since a bigger figure's base must
 * be lowered more to stand on the same ground.
 */
export function seatRaiders(placements: Placement[], baseY: number, base: number): Placement[] {
  return placements.map((p) => {
    const scale = base * (p.scale ?? 1);
    return {
      ...p,
      position: [p.position[0], seatY(SURFACE.land, baseY, scale), p.position[2]] as Vec3,
      scale,
      groundY: SURFACE.land,
    };
  });
}

/** The saturated hexes, as world positions, for anything that marks them. */
export function conqueredHexes(view: FullView): Hex[] {
  return raidersExt(view)?.conquered ?? [];
}

/**
 * Every hex whose number chip the board must not draw: the castle, and each
 * conquered hex.
 *
 * A hex with three raiders produces nothing until won back, so its chip is
 * face down. There is no face-down chip art, so the chip is hidden; the three
 * raiders show why.
 */
export function hiddenChips(view: FullView): Set<string> {
  const out = castleChipHidden(view);
  for (const h of conqueredHexes(view)) out.add(hexKey(h));
  return out;
}

/** A stable key for `hiddenChips`, for the static board's rebuild key. */
export function hiddenChipsKey(view: FullView): string {
  return [...hiddenChips(view)].sort().join(";");
}
