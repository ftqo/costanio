// Explorers: the fleet, the quays, the cargo riding in them, and what the pool
// turned out to be hiding.
//
// Everything comes off `explorersExt(view)`, the slice the 2D board reads, so
// the two boards agree about where a ship is. Every plan draws nothing when
// its field is absent, like `layers/caravans.ts`, so a client against an older
// server still renders.
//
// Redaction: `tileArtOverrides` repaints only hexes the wire has told this
// viewer about. An unrevealed hex arrives masked as `fog` (`MaskBoard`) and is
// never in `revealed`; drawing a fogged hex as a goldfield would leak the
// module's secret.
//
// Two geometries are shared with art authored elsewhere and restated here in
// the renderer's axes, since there is no common place to read them from:
//
//   THE HOLD    a 0.34 x 0.18 recess with its floor 0.06 above the piece base,
//               cut into `Cargo_hold` in `art/vessels` and into `Harbor_quay`
//               in `art/harbors`. `vesselArt.test.ts` and `harborArt.test.ts`
//               measure it on both files.
//   THE OFFSET  the quay stands 0.71 out along its own +x from its vertex, and
//               its geometry begins at 0.5, which keeps it clear of the
//               building the player's piece set draws there.
//
// The two recesses are the same rectangle transposed, which is why a `Slot`
// says which way it runs: on the ship the long axis runs along the hull (+x,
// as authored and as `edgeRotationY` turns it), on the quay across the deck
// (+z), since the deck's long axis points at the water. A piece moved between
// them keeps its size and floor and turns a quarter turn.
import {
  explorersExt,
  EXPLORERS_KIND,
  type BoardTile,
  type Edge,
  type ExplorersCargo,
  type ExplorersExt,
  type ExplorersHex,
  type ExplorersShip,
  type FullView,
  type Hex,
  type Vertex,
} from "@/lib/types";
import { edgeKey, vertexKey, vertexHexes } from "@/lib/hexgeo";
import {
  hexKey,
  hexToWorld,
  vertexToWorld,
  edgeToWorld,
  edgeBearingY,
  edgeRotationY,
  LATTICE_SCALE,
  TILE_ROTATION_Y,
  type Vec3,
} from "../coords";
import { WATER } from "../coastline";
import { OCEAN_MAX_Y } from "../ocean";
import { TILES } from "../manifest.generated";
import { MODULE_SCALE } from "../pieceArt";
import { SURFACE } from "../seating";
import { pieceKey } from "../drop";
import { FOG_RESOURCE } from "./fog";
import type { TileArt } from "./caravans";
import type { Placement } from "../instancing";

// --- node-name prefixes --------------------------------------------------
//
// One per family, each cut from a shared file by name: `vessels.glb` holds
// both ships, `harbors.glb` the quay and its two figures, `cargo.glb` the goods
// and the marker. Named narrowly because a broad cut silently collects
// whatever is added next (see `subsetByPrefixes`).

/** The cargo ship in vessels.glb: hull, hold, coaming, mast, sail, prow, castle. */
export const CARGO_PREFIX = "Cargo_";
/** The corsair in vessels.glb: hull, castle, two masts, two sails, two yards, flag. */
export const CORSAIR_PREFIX = "Corsair_";
/** The quay in harbors.glb: deck, bollard, crate, derrick. Not a building. */
export const QUAY_PREFIX = "Harbor_";
/** The small cargo figure in harbors.glb. Two fit abreast in one slot. */
export const CREW_PREFIX = "Crew_";
/** The large cargo figure in harbors.glb. One fills a slot. */
export const SETTLER_PREFIX = "Settler_";
/** The fish haul in cargo.glb: two fish head to tail, so it has no wrong way round. */
export const HAUL_PREFIX = "Haul_";
/** The spice sack in cargo.glb. Two lean together along a slot. */
export const SPICE_PREFIX = "Spice_";

// --- the shared slot -----------------------------------------------------

/** The recess's long axis (its short axis is 0.18), in authored units. A haul fills it; two small pieces sit along it. */
export const SLOT_LONG = 0.34;
/** How far the recess floor is above its host's base. */
export const SLOT_FLOOR_Y = 0.06;
/** How far out along the quay's own +x the basin sits, from the vertex. */
export const QUAY_SLOT_X = 0.71;
/** Where the quay's geometry begins, so a placement can be checked for clearance. */
export const QUAY_NEAR_EDGE_X = 0.5;

/**
 * How far apart two small pieces sit along the slot's long axis, authored.
 *
 * Two values, both measured in the art tests. Two crew are 0.11 wide in a
 * 0.34 slot, and the 0.12 left over should show as a gap. Two sacks are 0.14
 * wide and overlap: `cargoArt.test.ts` pins 0.125 as the pitch at which they
 * lean together as a pile.
 *
 * In the cargo piece's own units, so it scales with `MODULE_SCALE.cargoPiece`
 * rather than with the host.
 */
export const SMALL_PITCH = { crew: 0.17, spice: 0.125 } as const;

/**
 * How far off the edge's own line two cargo ships sit when they share it.
 *
 * The rules allow two per sea edge, and `vesselArt.test.ts` sizes the hull's
 * 0.28 beam for this: at 0.17 either side, two hulls leave 0.06 of water
 * between them. In the ship's own units, so it scales with the ship.
 */
export const SHIP_ABREAST = 0.17;

// --- what the pool turned out to be --------------------------------------

/**
 * The manifest key each revealed special draws, by `ExplorersHex.kind`.
 *
 * A per-hex override, as in `layers/caravans.ts`. A gold field is `gold` on
 * the wire and a spice farm is `none`, and drawing them as the gold mine and a
 * plain desert would hide what the expansion put there.
 */
export const EXPLORERS_TILE_FOR_KIND: Readonly<Record<number, string>> = {
  [EXPLORERS_KIND.gold]: "goldfield",
  [EXPLORERS_KIND.shoal]: "sea_shoal",
  [EXPLORERS_KIND.spice]: "spice",
};

/** True for the wire resources a hex drawn as water may carry. See `WATER`. */
function isWaterTile(t: BoardTile): boolean {
  // Fog is in `WATER` for the coastline solver but not water here: an
  // unrevealed hex is drawn as a land-shaped slab under a cloud
  // (`fogTileArt`) until it is revealed.
  return t.res !== FOG_RESOURCE && WATER.has(t.res);
}

/**
 * The tiles this module repaints, keyed by `hexKey`.
 *
 * Only revealed hexes, for redaction: `revealed` carries a hex only once it
 * is turned over, so a fogged hex cannot reach this map; the resource check is
 * a second guard against a frame the engine cannot produce.
 *
 * Two guards, like `oasisHex`: the hex must be on this board, and its terrain
 * must match the substitute's shape. The shoal is the sea's own hull and the
 * other two are land slabs, so a mismatch would put a hole in the island or an
 * island in the sea. A plain tile is the better failure.
 *
 * `land` carries the two land substitutions and not the shoal, which is water
 * by resource and art; claiming it as land would cut a coastline round it.
 *
 * Known gap: `planTiles` draws any overridden hex at scale 1
 * (`override ? 1 : tileScale(t.res)`), which is wrong for the shoal. A water
 * tile is authored a lattice cell wide and scaled back down on export, so the
 * shoal comes out 4.8% short with a thin seam of gutter around it. The fix is
 * to decide the scale on `land` in `planTiles`, which needs the `land` set
 * passed in.
 */
export function tileArtOverrides(view: FullView): TileArt {
  const files = new Map<string, string>();
  const land = new Set<string>();
  const yaw = new Map<string, number>();
  const ext = explorersExt(view);
  const byHex = new Map(view.board.tiles.map((t) => [hexKey(t.hex), t]));

  // The Council first: home waters are never fogged, so it is drawn from the
  // first frame.
  const council = councilTileArt(ext, byHex);
  if (council) {
    files.set(council.key, council.file);
    yaw.set(council.key, council.yaw);
  }

  const revealed = ext?.revealed ?? [];
  if (revealed.length === 0) return { files, land, yaw };

  for (const r of revealed) {
    const key = EXPLORERS_TILE_FOR_KIND[r.kind];
    // Absent from the manifest until exported; the terrain's own file is
    // better than a 404.
    const entry = key ? TILES[key] : undefined;
    if (!entry) continue;
    const tile = byHex.get(hexKey(r.h));
    if (!tile || tile.res === FOG_RESOURCE) continue;
    const wantsWater = r.kind === EXPLORERS_KIND.shoal;
    if (isWaterTile(tile) !== wantsWater) continue;
    files.set(hexKey(r.h), entry.file);
    if (!wantsWater) land.add(hexKey(r.h));
  }
  return { files, land, yaw };
}

// --- the Council tile ----------------------------------------------------

/**
 * The manifest key of the Council tile: a walled harbour town on a rock in open
 * water, authored on the ocean's own hull and wave sheet like the shoal.
 *
 * A water tile. The Council hex stays `sea` on the wire and only the file is
 * overridden, as for the oasis, so coastline, gutter sand and `tileScale`
 * treat it as open water (drawn a lattice cell wide, not in `land`).
 */
export const COUNCIL_TILE = "sea_council";

/**
 * The tile's quays run along the file's own +-z axis, to the two corners at
 * z = +-2.60 (the tile's N and S corners at the board's default half turn).
 * The art test holds the file to this.
 */
export const COUNCIL_QUAY_AXIS: readonly [number, number] = [0, 1];

/**
 * The Y rotation that lays the Council tile's quays onto its two anchors.
 *
 * The anchors are an opposite pair of corners (`councilAndAnchors`: the
 * corners between directions (d+1, d+2) and (d+4, d+5)), so they lie on one
 * of three axes (N/S, NE/SW, NW/SE), giving `TILE_ROTATION_Y` (PI) or
 * PI -+ PI/3. A Y rotation of `a` sends the file's +z to world (sin a, cos a),
 * so an anchor at (dx, dz) from the centre gives `a = atan2(dx, dz)`.
 *
 * The tile is symmetric under a half turn about its quay axis, so the result
 * is folded into (PI/2, 3PI/2] and the N/S case is exactly `TILE_ROTATION_Y`.
 * Snapped to a sixth of a turn to remove floating-point noise.
 *
 * Null when the anchors are missing or not an opposite pair on this hex (a
 * frame the engine cannot produce); the caller then draws plain sea.
 */
export function councilYaw(council: Hex, anchors: readonly Vertex[] | undefined): number | null {
  if (!anchors || anchors.length !== 2) return null;
  const [cx, , cz] = hexToWorld(council);
  const [ax, , az] = vertexToWorld(anchors[0]);
  const [bx, , bz] = vertexToWorld(anchors[1]);
  const da: [number, number] = [ax - cx, az - cz];
  const db: [number, number] = [bx - cx, bz - cz];
  // Opposite corners of this hex: equal and opposite offsets, one circumradius out.
  const r = Math.hypot(da[0], da[1]);
  if (Math.abs(r - Math.hypot(db[0], db[1])) > 1e-6 || r < 1e-6) return null;
  if (Math.hypot(da[0] + db[0], da[1] + db[1]) > 1e-6) return null;
  const sixth = Math.PI / 3;
  let a = Math.round(Math.atan2(da[0], da[1]) / sixth) * sixth;
  // Fold into (PI/2, 3PI/2]: the half-turn symmetry makes a and a + PI the same tile.
  while (a <= Math.PI / 2 + 1e-9) a += Math.PI;
  while (a > (3 * Math.PI) / 2 + 1e-9) a -= Math.PI;
  return a;
}

/**
 * The Council hex's file and turn, or null.
 *
 * The hex must be on this board and drawn as water (not fog, not land), and
 * the tile must be in the manifest, so a board without the art draws plain sea
 * rather than a 404.
 */
function councilTileArt(
  ext: ExplorersExt | undefined,
  byHex: ReadonlyMap<string, BoardTile>,
): { key: string; file: string; yaw: number } | null {
  if (!ext?.council) return null;
  const entry = TILES[COUNCIL_TILE];
  if (!entry) return null;
  const key = hexKey(ext.council);
  const tile = byHex.get(key);
  if (!tile || !isWaterTile(tile)) return null;
  const yaw = councilYaw(ext.council, ext.anchors);
  if (yaw === null) return null;
  return { key, file: entry.file, yaw };
}

// --- the shoal ----------------------------------------------------------

/**
 * The parts of `tiles/sea_shoal.glb` the board draws: the sea's own hull and
 * wave sheet, the three sand islets, the rocks, the school and the buoy.
 *
 * Not the flat: the tile ships a wet-sand plate (`Shoal_shallows`, 3.4 units
 * across at 0.298) and a fringe under it (`Shoal_fringe`, out to 2.4 of a 2.6
 * apothem) that together cover nearly the whole hex and read as a flat tan
 * mound from the board camera (a tile cannot carry water that follows the
 * sea; see art/README.md). Without them the shoal is three sand islets in
 * open water, and the water follows every look.
 *
 * Temporary: the proper fix is a re-authored shoal with a small landing bar at
 * its middle (xboard art spec); then delete this list and draw the file whole.
 * `explorersArt.test.ts` fails if the tile gains a part this list does not
 * account for.
 */
export const SHOAL_DRAWN_PREFIXES = [
  "Hex_",
  "Shoal_waves",
  "Shoal_bars",
  "Shoal_rocks",
  "Shoal_fish",
  "Shoal_buoy",
] as const;

/** The parts left out, named so the art test can tell them apart. */
export const SHOAL_CUT_PREFIXES = ["Shoal_shallows", "Shoal_fringe"] as const;

/**
 * Where a fish haul lies on a shoal: at its middle, just clear of the swell.
 *
 * The world crest is the tile's authored crest (`OCEAN_MAX_Y`, in the .glb's
 * frame) times the water tile's drawn scale; any lower and a wave swallows it
 * every few seconds.
 */
export const SHOAL_HAUL_Y = OCEAN_MAX_Y * LATTICE_SCALE + 0.01;

/**
 * How big a haul is drawn on a shoal, against the size it rides in a hold.
 *
 * In a hold it is sized to its recess (0.34 long), which is a few pixels at
 * the opening camera. Nearly three times that is about a third of the shoal,
 * the size of one islet.
 */
export const SHOAL_HAUL_SCALE = 3.0;

/**
 * Every fish haul waiting on a shoal, at the shoal's middle.
 *
 * `ExtView.hauls` names the shoals the fishing roll has stocked. Each gets one
 * `Haul_` piece from `cargo.glb` at the cargo scale, turned per hex so two
 * shoals differ. Keyed, so a haul that appears mid-game drops in.
 *
 * Only hexes on this board and drawn as water: a haul on land is a frame the
 * engine cannot produce, and a fish on a meadow is worse than none.
 */
export function planShoalHauls(view: FullView): OwnedPlacement[] {
  const hauls = explorersExt(view)?.hauls ?? [];
  if (hauls.length === 0) return [];
  const byHex = new Map(view.board.tiles.map((t) => [hexKey(t.hex), t]));
  const out: OwnedPlacement[] = [];
  for (const h of hauls) {
    const tile = byHex.get(hexKey(h));
    if (!tile || !isWaterTile(tile)) continue;
    const [x, , z] = hexToWorld(h);
    out.push({
      owner: -1,
      position: [x, SHOAL_HAUL_Y, z],
      rotationY: ((((h.q * 3 + h.r * 5) % 6) + 6) % 6) * (Math.PI / 3) + Math.PI / 6,
      key: pieceKey("haul", -1, hexKey(h)),
    });
  }
  return out;
}

// --- the lairs and the landed crews ---------------------------------------

/** The pirate lair token in lairs.glb: skull rock, rubble, eyes, teeth, gold, flag. */
export const LAIR_PREFIX = "Lair_";
/** The crew figure that stands ON a hex, in lairs.glb. Seat-tinted. */
export const BOARDER_PREFIX = "Boarder_";

/** How many crews on one lair capture it. The rules' number, restated for the art. */
export const LAIR_CAPTURE_CREWS = 3;

/**
 * Where a special tile's standing slots are, in the world, for the hex `h`.
 *
 * Read off the manifest, which carries them from the tile's blend
 * (`LairSlot_<n>` on the goldfield, `FarmSlot_<n>` on the spice farm; see
 * SLOT_PREFIXES in tools/blender/export_assets.py). They are in the socket's
 * frame, so they go through the tile's half turn (`TILE_ROTATION_Y`), which
 * sends (x, z) to (-x, -z). The y is the ground height at the slot, so a
 * figure is not seated: this is its base.
 */
export function tileSlotsWorld(tileKey: string, h: Hex): Vec3[] {
  const slots = TILES[tileKey]?.slots ?? [];
  const [x, , z] = hexToWorld(h);
  const c = Math.cos(TILE_ROTATION_Y);
  const s = Math.sin(TILE_ROTATION_Y);
  return slots.map(([sx, sy, sz]) => [x + sx * c + sz * s, sy, z - sx * s + sz * c] as Vec3);
}

/** The socket of a tile, in the world, for the hex `h`. Null when it has none. */
function socketWorld(tileKey: string, h: Hex): Vec3 | null {
  const socket = TILES[tileKey]?.socket;
  if (!socket) return null;
  const [x, , z] = hexToWorld(h);
  const c = Math.cos(TILE_ROTATION_Y);
  const s = Math.sin(TILE_ROTATION_Y);
  return [x + socket[0] * c + socket[2] * s, socket[1], z - socket[0] * s + socket[2] * c];
}

/**
 * The revealed hexes of one kind that are drawn as that kind's tile.
 *
 * Uses `tileArtOverrides`'s answer, so a lair token or crews never stand on a
 * hex drawn as plain terrain (art not exported, hex fogged, a frame naming
 * water).
 */
function drawnSpecials(view: FullView, kind: number): ExplorersHex[] {
  const ext = explorersExt(view);
  const revealed = ext?.revealed ?? [];
  if (revealed.length === 0) return [];
  const drawn = tileArtOverrides(view).files;
  const file = TILES[EXPLORERS_TILE_FOR_KIND[kind]]?.file;
  if (!file) return [];
  return revealed.filter((r) => r.kind === kind && drawn.get(hexKey(r.h)) === file);
}

/**
 * The pirate lair tokens: one on the socket of every gold field whose lair has
 * not fallen.
 *
 * It stands where the number chip will: the goldfield's socket is empty
 * (`explorersArt.test.ts`) and a captured field shows its number there, so
 * token and chip are never drawn together. Turned with the tile so the skull
 * faces the camera. No seat tint.
 */
export function planLairs(view: FullView): OwnedPlacement[] {
  const out: OwnedPlacement[] = [];
  for (const r of drawnSpecials(view, EXPLORERS_KIND.gold)) {
    if (r.captured) continue;
    const at = socketWorld(EXPLORERS_TILE_FOR_KIND[EXPLORERS_KIND.gold], r.h);
    if (!at) continue;
    out.push({
      owner: -1,
      position: [at[0], 0, at[2]],
      rotationY: TILE_ROTATION_Y,
      key: pieceKey("lair", -1, hexKey(r.h)),
    });
  }
  return out;
}

/**
 * Every crew standing on a hex: the ranks storming a lair, and the one crew
 * each seat has landed on a spice farm.
 *
 * Three in a row beside the token means the lair falls, so slots fill in a
 * fixed order (the first rank of three beside the token, then the rank on its
 * other side, then the front) and crews take them in seat order, each seat's
 * together, so the same frame always looks the same.
 *
 * The slot's y is the ground height there (see `tileSlotsWorld`), so these are
 * not seated. Crews on a lair face the token; farmers face into the village,
 * away from the camera.
 *
 * More crews than slots is possible under the rules but has not occurred (a
 * lair takes three, and each seat lands one per farm): the rest are not drawn,
 * and the hover card shows the real number.
 */
export function planHexCrews(view: FullView): OwnedPlacement[] {
  const out: OwnedPlacement[] = [];
  const goldKey = EXPLORERS_TILE_FOR_KIND[EXPLORERS_KIND.gold];
  for (const r of drawnSpecials(view, EXPLORERS_KIND.gold)) {
    const slots = tileSlotsWorld(goldKey, r.h);
    const face = socketWorld(goldKey, r.h);
    const seats: number[] = [];
    (r.crews ?? []).forEach((n, seat) => {
      for (let i = 0; i < n; i++) seats.push(seat);
    });
    seats.slice(0, slots.length).forEach((seat, i) => {
      const [x, y, z] = slots[i];
      const rotationY = face ? -Math.atan2(face[2] - z, face[0] - x) : 0;
      out.push({
        owner: seat,
        position: [x, y, z],
        rotationY,
        key: pieceKey("boarder", seat, `${hexKey(r.h)}:${i}`),
      });
    });
  }
  const spiceKey = EXPLORERS_TILE_FOR_KIND[EXPLORERS_KIND.spice];
  for (const r of drawnSpecials(view, EXPLORERS_KIND.spice)) {
    const slots = tileSlotsWorld(spiceKey, r.h);
    const seats: number[] = [];
    (r.farmers ?? []).forEach((landed, seat) => {
      if (landed) seats.push(seat);
    });
    seats.slice(0, slots.length).forEach((seat, i) => {
      out.push({
        owner: seat,
        position: slots[i],
        // Into the village: the tile's authored -y, which the half turn sends
        // to the world's -z. Aiming +x down (0, -1) is `-atan2(-1, 0)`.
        rotationY: Math.PI / 2,
        key: pieceKey("farmer", seat, hexKey(r.h)),
      });
    });
  }
  return out;
}

// --- the fleet -----------------------------------------------------------

/** A piece somebody owns. `owner` is a seat, or -1 for a piece nobody's colour. */
export interface OwnedPlacement extends Placement {
  owner: number;
  key: string;
}

/**
 * Every cargo ship on the board, on its edge and turned along it.
 *
 * Two can share an edge, so the pair is offset abreast (see `SHIP_ABREAST`)
 * rather than drawn one inside the other. Ordered by ship id so the same
 * frame always puts the same ship on the same side, whatever the server's
 * slice order.
 *
 * The turn is a bearing where the ship has one. `edgeRotationY` is an axis,
 * and which end of an `Edge` is `a` comes from `NewEdge`'s (q, r, side)
 * normalisation, so on about half the edges the bow would face the wrong way.
 * The engine records the end the ship arrived through (`ExplorersShip.bow`);
 * a ship that has never moved has none and gets the axis.
 */
export function planCargoShips(view: FullView): OwnedPlacement[] {
  return berths(explorersExt(view)).map((b) => ({
    owner: b.ship.owner,
    position: b.position,
    rotationY: b.rotationY,
    key: pieceKey("cargo", b.ship.owner, `${edgeKey(b.ship.e)}:${b.ship.id}`),
  }));
}

/** The end of an edge that is not `v`. */
function otherEnd(e: Edge, v: Vertex): Vertex {
  return vertexKey(e.a) === vertexKey(v) ? e.b : e.a;
}

/** A ship and the water it is drawn on. Shared by the hull and its cargo. */
interface Berth {
  ship: ExplorersShip;
  position: Vec3;
  rotationY: number;
}

/** Every ship's berth, with the pair on a shared edge moved apart. */
function berths(ext: ExplorersExt | undefined): Berth[] {
  const ships = ext?.ships ?? [];
  const byEdge = new Map<string, ExplorersShip[]>();
  for (const s of ships) {
    const key = edgeKey(s.e);
    byEdge.set(key, [...(byEdge.get(key) ?? []), s]);
  }
  const out: Berth[] = [];
  for (const group of byEdge.values()) {
    const ordered = [...group].sort((a, b) => a.id - b.id);
    ordered.forEach((ship, i) => {
      const rotationY = ship.bow
        ? edgeBearingY(otherEnd(ship.e, ship.bow), ship.bow)
        : edgeRotationY(ship.e);
      const across = (i - (ordered.length - 1) / 2) * 2 * SHIP_ABREAST * MODULE_SCALE.cargo;
      const [x, , z] = edgeToWorld(ship.e);
      const [dx, dz] = rotateXZ(rotationY, 0, across);
      out.push({ ship, position: [x + dx, 0, z + dz], rotationY });
    });
  }
  return out;
}

/**
 * The corsair, if one is on the board.
 *
 * Zero or one, as an array so a caller needs no null branch (like
 * `planPirate` and `planRobber`).
 *
 * Unlike the Islands pirate, it has an owner: the player who moved it owns it
 * while it stands there (tribute is owed to an opponent's, never your own),
 * and the art is seat-tinted in all three slots, so `pirate_owner` picks the
 * colour.
 *
 * `pirate_by` is not read: it is who owes an activation, usually a different
 * seat (see `ExtView`), and tinting with it would say the seat being robbed
 * owns the robber. An owner of -1 (`NoPlayer`, or an older server) draws the
 * piece in nobody's colour.
 */
export function planCorsair(view: FullView): OwnedPlacement[] {
  const ext = explorersExt(view);
  const hex = ext?.pirate;
  if (!hex) return [];
  const [x, , z] = hexToWorld(hex);
  const owner = ext?.pirate_owner;
  return [
    {
      // `NoPlayer` is -1 on the wire and an absent field means an older
      // server; both draw the piece in nobody's colour.
      owner: typeof owner === "number" && owner >= 0 ? owner : -1,
      position: [x, 0, z],
      key: "corsair",
    },
  ];
}

// --- the frame ----------------------------------------------------------

/**
 * The tiles the camera frames an Explorers board against, split in two.
 *
 * Every hex at distance exactly `radius` is `Sea` by construction (see "The
 * rim" in docs/rules/explorers.md): nothing is revealed or built there. Fitting
 * the rim's corners put a ring of open water round the map and opened the
 * board at about four fifths of the available size (280 of 390 pixels on a
 * phone).
 *
 * So `play` is fitted as tiles (corners and beach, as `boardFitPoints` does)
 * and the rim contributes only its centres, the furthest a ship, crew or the
 * pirate can stand, so nothing a player can place opens off screen.
 *
 * `rim` is empty on other rulesets and on a board whose rim is not all water,
 * so their framing is unchanged.
 */
export function explorersFrame(view: FullView): { play: BoardTile[]; rim: Vec3[] } {
  const tiles = view.board.tiles;
  if (!explorersExt(view)) return { play: tiles, rim: [] };
  const radius = view.board.radius;
  const onRim = (t: BoardTile) =>
    (Math.abs(t.hex.q) + Math.abs(t.hex.r) + Math.abs(t.hex.q + t.hex.r)) / 2 === radius;
  const rim = tiles.filter(onRim);
  if (rim.length === 0 || !rim.every(isWaterTile)) return { play: tiles, rim: [] };
  return { play: tiles.filter((t) => !onRim(t)), rim: rim.map((t) => hexToWorld(t.hex)) };
}

// --- the harbours --------------------------------------------------------

/**
 * The quays, one per harbour, standing beside their vertex.
 *
 * An add-on: the building on the vertex comes from the player's equipped set,
 * and the quay stands beside it. The art has no house, and its geometry
 * begins 0.5 out along +x so that at `MODULE_SCALE.harbor` it clears the
 * largest city any shipped set can put there (`harborArt.test.ts` checks every
 * set). So the placement is the vertex itself, as for a settlement; adding the
 * offset here too would push the dock a second unit out.
 *
 * The turn puts it in the water: seaward is the art's +x, so the quay faces
 * the average of the water hexes its vertex touches. A hex the board does not
 * carry counts as sea, so the map's edge behaves like its middle. A vertex
 * with no water (not produced by the rules) draws no quay rather than a dock
 * on dry land.
 */
export function planQuays(view: FullView): OwnedPlacement[] {
  const harbours = explorersExt(view)?.harbours ?? [];
  if (harbours.length === 0) return [];
  const board = boardIndex(view);
  const out: OwnedPlacement[] = [];
  for (const h of harbours) {
    const rotationY = seawardY(h.v, board);
    if (rotationY === null) continue;
    const [x, , z] = vertexToWorld(h.v);
    out.push({
      owner: h.owner,
      position: [x, 0, z],
      rotationY,
      key: pieceKey("quay", h.owner, vertexKey(h.v)),
    });
  }
  return out;
}

// --- what rides in them --------------------------------------------------

/** Which art a hold's contents want. The first two are owned, the last two are not. */
export type HoldPart = "settler" | "crew" | "haul" | "spice";

/**
 * One piece of cargo, standing on the floor of the slot that holds it.
 *
 * Not seated by the caller (the Fishermen weir is the other such placement).
 * `seat` solves for one base on one surface, and these land on two: a hold
 * floor at sea height under a ship drawn at 1.15, and a basin floor in the
 * gutter under a quay drawn at 2.0. The y is already the answer, which works
 * because every piece in both files has its base at exactly 0
 * (`harborArt.test.ts` and `cargoArt.test.ts` assert it on all five prefixes).
 */
export interface HoldPlacement extends Placement {
  part: HoldPart;
  owner: number;
}

/**
 * Every figure and every sack riding in a ship's hold or a harbour's basin.
 *
 * One list because the slot, not the piece, decides placement: the same
 * rectangle is cut into both hosts, and only the host's transform differs. The
 * caller groups by `part` to pick the file and prefix and decide on tint
 * (figures are seat-tinted, goods are neutral).
 *
 * A hold holds one large piece or up to two small ones, so at most one branch
 * below fires for any host the engine can produce.
 */
export function planHolds(view: FullView): HoldPlacement[] {
  const ext = explorersExt(view);
  if (!ext) return [];
  const out: HoldPlacement[] = [];

  for (const berth of berths(ext)) {
    out.push(
      ...slotContents(berth.ship.hold, berth.ship.owner, {
        position: berth.position,
        rotationY: berth.rotationY,
        scale: MODULE_SCALE.cargo,
        // The ship's base is 0, so the hull floats with its origin on the mean
        // water line (see `SURFACE.sea`).
        baseY: SURFACE.sea,
        // The hold is centred on the edge midpoint and runs along the hull.
        centre: [0, 0],
        longAlongX: true,
      }),
    );
  }

  const board = boardIndex(view);
  for (const h of ext.harbours ?? []) {
    const rotationY = seawardY(h.v, board);
    if (rotationY === null) continue;
    const [x, , z] = vertexToWorld(h.v);
    out.push(
      ...slotContents(h.basin, h.owner, {
        position: [x, 0, z],
        rotationY,
        scale: MODULE_SCALE.harbor,
        // A vertex is in the gutter between tiles, where every other vertex
        // piece is seated.
        baseY: SURFACE.gutter,
        centre: [QUAY_SLOT_X, 0],
        // The deck's long axis points at the water, so the basin's runs across
        // it, and a haul turns a quarter turn between hold and quay (see the
        // header).
        longAlongX: false,
      }),
    );
  }
  return out;
}

/** Where one host's slot is, and how it is turned. See `planHolds`. */
interface Slot {
  position: Placement["position"];
  rotationY: number;
  scale: number;
  baseY: number;
  /** The slot's centre in the host's own frame, before its scale and turn. */
  centre: [number, number];
  longAlongX: boolean;
}

function slotContents(cargo: ExplorersCargo, owner: number, slot: Slot): HoldPlacement[] {
  const out: HoldPlacement[] = [];
  // The floor rides at the host's scale, because the recess is part of the
  // host. What stands on it does not; see `MODULE_SCALE.cargoPiece`.
  const y = slot.baseY + slot.scale * SLOT_FLOOR_Y;
  // A haul is authored along its own +x and the slot's long axis may be
  // either of the host's, so the quarter turn handles the transposition.
  // Figures and sacks are round in plan.
  const turn = slot.longAlongX ? 0 : -Math.PI / 2;

  const large = (part: HoldPart, extra: number) => {
    const [dx, dz] = hostOffset(slot, 0);
    out.push({
      part,
      owner,
      position: [slot.position[0] + dx, y, slot.position[2] + dz],
      rotationY: slot.rotationY + extra,
    });
  };
  const small = (part: HoldPart, count: number, pitch: number) => {
    const n = Math.min(count, 2);
    for (let i = 0; i < n; i++) {
      const along = (i - (n - 1) / 2) * pitch * MODULE_SCALE.cargoPiece;
      const [dx, dz] = hostOffset(slot, along);
      out.push({
        part,
        owner,
        position: [slot.position[0] + dx, y, slot.position[2] + dz],
        rotationY: slot.rotationY,
      });
    }
  };

  if ((cargo.settler ?? 0) > 0) large("settler", 0);
  if ((cargo.haul ?? 0) > 0) large("haul", turn);
  if ((cargo.crew ?? 0) > 0) small("crew", cargo.crew ?? 0, SMALL_PITCH.crew);
  if ((cargo.spice ?? 0) > 0) small("spice", cargo.spice ?? 0, SMALL_PITCH.spice);
  return out;
}

/**
 * Where a point `along` the slot's long axis lands in the world.
 *
 * Two scales: the slot's centre belongs to the host's art and is drawn at the
 * host's size (the basin moves out to 1.42 with the deck at 2.0); the spacing
 * between pieces depends on the pieces' width and is already scaled by the
 * caller.
 */
function hostOffset(slot: Slot, along: number): [number, number] {
  const [cx, cz] = slot.centre;
  const lx = slot.scale * cx + (slot.longAlongX ? along : 0);
  const lz = slot.scale * cz + (slot.longAlongX ? 0 : along);
  return rotateXZ(slot.rotationY, lx, lz);
}

// --- the missions --------------------------------------------------------

/**
 * The mission markers: none.
 *
 * A marker records a seat's position on one of three mission tracks
 * (`ExplorersSeat.track`), and a track has no hex, vertex or edge; the tracks
 * run in the UI beside the board. Placing markers at the map's edge or on the
 * Council hex would suggest a piece could reach them. The art is ready
 * (`cargoArt.test.ts` pins the 0.08 stack pitch, and
 * `MODULE_SCALE.missionMarker` sets the size); this changes if a track ever
 * goes on the board.
 */
export function planMarkers(_view: FullView): Placement[] {
  return [];
}

// --- geometry helpers ----------------------------------------------------

/** Rotate a point in the host's own (x, z) frame into the board's. */
function rotateXZ(rotationY: number, x: number, z: number): [number, number] {
  // A Y rotation of `a` sends local +x to (cos a, -sin a) and local +z to
  // (sin a, cos a); see `edgeRotationY`.
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return [x * c + z * s, -x * s + z * c];
}

/** The board's tiles by `hexKey`, for the water questions below. */
function boardIndex(view: FullView): Map<string, BoardTile> {
  return new Map(view.board.tiles.map((t) => [hexKey(t.hex), t]));
}

/**
 * The turn that puts a vertex piece's +x on the water it belongs to, or null.
 *
 * The average of the water hexes the vertex touches, so a corner with two sea
 * hexes faces between them. A hex the board does not carry counts as sea.
 *
 * Null when the three hexes are all land, which the rules do not produce.
 */
function seawardY(v: Vertex, board: ReadonlyMap<string, BoardTile>): number | null {
  const [vx, , vz] = vertexToWorld(v);
  let dx = 0;
  let dz = 0;
  for (const h of vertexHexes(v)) {
    const tile = board.get(hexKey(h));
    if (tile && !isWaterTile(tile)) continue;
    const [hx, , hz] = hexToWorld(h);
    dx += hx - vx;
    dz += hz - vz;
  }
  if (Math.hypot(dx, dz) < 1e-9) return null;
  // Aiming +x down (dx, dz): `a = -atan2(dz, dx)`, as `edgeBearingY` derives.
  return -Math.atan2(dz, dx);
}
