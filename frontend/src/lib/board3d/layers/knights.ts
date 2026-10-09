// Knights pieces: knights, city walls, metropolises and the merchant.
//
// All of it comes off `knightsExt(view)`, the slice the 2D board reads, so the two
// boards agree about where a piece is.
//
// A knight stands on a vertex like a settlement, a wall rings its city's
// vertex, a metropolis replaces that city, and the merchant sits on a hex like
// the robber. The barbarian fleet is not drawn in 3D; the HUD's barbarian rail
// shows it.
import { knightsExt, type FullView, type Vertex } from "@/lib/types";
import { vertexToWorld, hexToWorld } from "../coords";
import { vertexKey } from "@/lib/hexgeo";
import { pieceKey, type KeyedPlacement } from "../drop";
import type { Placement } from "../instancing";

/** Node-name prefix in knights.glb for each knight level. */
export const KNIGHT_PREFIX = ["Knight_basic", "Knight_strong", "Knight_mighty"] as const;

/**
 * Node-name prefix in knights.glb for the sword each level holds.
 *
 * One per level because the sword is fitted to each body's height and reach;
 * the art carries the fit as the node's offset, so the renderer applies no
 * per-level correction. Suffix it with `SWORD_STATE` to pick the pose, which
 * is also the colour.
 */
export const KNIGHT_SWORD_PREFIX = [
  "Knight_sword_basic",
  "Knight_sword_strong",
  "Knight_sword_mighty",
] as const;

/**
 * The two swords a level ships, keyed by whether the knight is activated.
 *
 * Both poses are baked into their own object (dark leaning point-down, gold
 * upright) rather than rotated at draw time, because under
 * `prefers-reduced-motion` no pose function runs. See knightSword.ts.
 */
export const SWORD_STATE = { ready: "_gold", atEase: "_dark" } as const;

/**
 * A knight's sword's identity, derived from its knight's.
 *
 * The sword needs its own key because it turns and the body does not; sharing
 * the key would somersault the whole piece. Derived so `Board3D` can mirror a
 * knight's drop and hop onto `swordKey(k)`, keeping the sword with the knight.
 */
const SWORD_SUFFIX = "#sword";

export function swordKey(knightKey: string): string {
  return knightKey + SWORD_SUFFIX;
}

export function isSwordKey(key: string): boolean {
  return key.endsWith(SWORD_SUFFIX);
}

/**
 * Node-name prefix in metros.glb per improvement track.
 *
 * Indexed to match `KnightsPlayer.improve` and `.metropolis`, which are ordered
 * [Trade, Politics, Science]. Any other order swaps two of the metropolises.
 */
export const METRO_PREFIX = [
  "Metro_trade_metropolis",
  "Metro_politics_metropolis",
  "Metro_science_metropolis",
] as const;

/** A ring wall dropped round a city. One piece, not the modular segments. */
export const WALL_PREFIX = "Wall_segment_ring_01";

export const MERCHANT_PREFIX = "Trader_merchant";

// A knight always carries a key (`planKnights` builds one for every knight),
// so the type requires it. The drop for a new knight and the hop for a newly
// readied one both depend on it.
export interface KnightPlacement extends KeyedPlacement {
  owner: number;
  /** 0, 1 or 2: basic, strong, mighty. Indexes KNIGHT_PREFIX. */
  level: number;
  active: boolean;
}

export interface MetroPlacement extends Placement {
  /** 0, 1 or 2: trade, politics, science. Indexes METRO_PREFIX. */
  track: number;
  owner: number;
  /** The city vertex it stands on, so the city there can be suppressed. */
  v: Vertex;
}

/**
 * Every knight on the board.
 *
 * `level` arrives 1-based on the wire (a basic knight is level 1) and becomes
 * an index here, so callers can subscript KNIGHT_PREFIX directly. Out-of-range
 * levels are clamped rather than dropped, so every knight is drawn.
 */
export function planKnights(view: FullView): KnightPlacement[] {
  const knights = knightsExt(view)?.knights ?? [];
  return knights.map((k) => ({
    owner: k.owner,
    level: Math.min(KNIGHT_PREFIX.length - 1, Math.max(0, k.level - 1)),
    active: k.active,
    position: vertexToWorld(k.v),
    // Level is not in the key: promoting in place swaps the model rather than
    // re-dropping it. A move changes the vertex, so it is a placement.
    key: pieceKey("knight", k.owner, vertexKey(k.v)),
  }));
}

/**
 * What level each knight is, by key: the record a promotion is diffed against.
 *
 * The key excludes level, so the previous levels are the only way to notice a
 * promotion. Kept beside the plan so `promoted` in knightSword.ts stays a diff
 * over two maps.
 */
export function knightLevels(knights: readonly KnightPlacement[]): Map<string, number> {
  return new Map(knights.map((k) => [k.key, k.level]));
}

/** City walls, one ring per walled city vertex. */
export function planWalls(view: FullView): Placement[] {
  const walled = knightsExt(view)?.walled ?? [];
  // Walls belong to the city they ring rather than to a seat of their own, so
  // the vertex alone identifies one.
  return walled.map((v) => ({
    position: vertexToWorld(v),
    key: pieceKey("wall", -1, vertexKey(v)),
  }));
}

/**
 * Metropolises, one per track that some player holds.
 *
 * A track's metropolis exists only when its holder's `metropolis[t]` is set;
 * `metropolis_at[t]` carries a vertex either way, so reading it alone would
 * draw a metropolis for a track nobody has won.
 */
export function planMetros(view: FullView): MetroPlacement[] {
  const knightsState = knightsExt(view);
  if (!knightsState) return [];
  const out: MetroPlacement[] = [];
  knightsState.players.forEach((p, seat) => {
    METRO_PREFIX.forEach((_, track) => {
      if (!p.metropolis?.[track]) return;
      const at = p.metropolis_at?.[track];
      if (!at) return;
      out.push({
        track,
        owner: seat,
        v: at,
        position: vertexToWorld(at),
        key: pieceKey("metro", seat, `${track}@${vertexKey(at)}`),
      });
    });
  });
  return out;
}

/**
 * The draws a board's metropolises need: one per (seat, track).
 *
 * The track picks the model and the landmark colour inside it; the seat picks
 * the tint on the compound. Grouping by track alone paints every metropolis
 * in one seat's colour.
 *
 * A plain function so the invariant can be tested without WebGL.
 */
export function metroDraws(
  metros: MetroPlacement[],
): { seat: number; track: number; at: MetroPlacement[] }[] {
  const bySeatTrack = new Map<string, { seat: number; track: number; at: MetroPlacement[] }>();
  for (const m of metros) {
    const key = `${m.owner}:${m.track}`;
    const group = bySeatTrack.get(key) ?? { seat: m.owner, track: m.track, at: [] };
    group.at.push(m);
    bySeatTrack.set(key, group);
  }
  // Seat then track, so draws are rebuilt in the same order every time and
  // the instanced meshes do not shuffle.
  return [...bySeatTrack.values()].sort((a, b) => a.seat - b.seat || a.track - b.track);
}

/**
 * The vertices where a metropolis stands, keyed for lookup.
 *
 * A metropolis replaces the city it is built on, as on the 2D board; drawing
 * both would put the city inside the metropolis.
 */
export function metropolisVertexKeys(view: FullView): Set<string> {
  return new Set(planMetros(view).map((m) => vertexKey(m.v)));
}

/** The merchant, if it is on the board. */
export function planMerchant(view: FullView): Placement[] {
  const merchant = knightsExt(view)?.merchant;
  if (!merchant) return [];
  return [{ position: hexToWorld(merchant) }];
}
