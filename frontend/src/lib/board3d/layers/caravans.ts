// Caravans: which hex the board draws as the oasis.
//
// No resource names the oasis. `engine/scenarios/caravans.go` derives it at setup
// by picking a desert (the first, if there are several) and, under Fishermen,
// the lake that desert became. So the oasis tile reads `none` on a plain board
// and `lake` on a flooded one, and `tileFileFor` (resources only) cannot find
// it.
//
// Hence a per-hex override rather than an entry in RESOURCE_FALLBACK, which
// maps resources to files.
import {
  caravansExt,
  islandsExt,
  type FullView,
  type BoardTile,
  type Edge,
  type Vertex,
} from "@/lib/types";
import { edgeKey, edgeHexes, vertexKey } from "@/lib/hexgeo";
import { hexKey, edgeToWorld, edgeRotationY, edgeBearingY, type Vec3 } from "../coords";
import { WATER } from "../coastline";
import { SURFACE } from "../seating";
import { TILES } from "../manifest.generated";
import { planRiverTiles } from "./rivers";
import type { Placement } from "../instancing";

/** The manifest key of the oasis tile. */
export const OASIS_TILE = "oasis";

/**
 * Resources a derived oasis can be sitting on.
 *
 * `none` is the desert the module picked; `lake` is that desert after
 * Fishermen flooded it (`sim`'s oasis invariant asserts this pair). Anything
 * else means the hex named on the wire is not an oasis.
 */
const OASIS_TERRAIN = new Set(["none", "lake"]);

/**
 * The hex to draw as the oasis, or null.
 *
 * The wire decides whether there is one: `ViewExt` emits `oasis` only when
 * the module derived one (`HasOasis`), as a nullable hex like
 * `islands.ExtView.Pirate`. Do not infer it from terrain.
 *
 * The two remaining checks guard against a malformed frame: the hex must be
 * on this board, and its terrain must be `none` or `lake`. Both hold for every
 * frame the engine produces; if not, a plain desert is the better failure.
 */
export function oasisHex(view: FullView): BoardTile | null {
  return oasisHexes(view)[0] ?? null;
}

/**
 * Every oasis to draw, first one first: five or six seats play two, seven to
 * ten three (engine/scenarios `oasisCountFor`). Read off `oases`, falling back to
 * the single `oasis` older servers send; each gets the two guards
 * `oasisHex` describes.
 */
export function oasisHexes(view: FullView): BoardTile[] {
  const ext = caravansExt(view);
  if (!ext?.oasis) return [];
  const out: BoardTile[] = [];
  for (const o of ext.oases ?? [ext.oasis]) {
    const key = hexKey(o);
    const tile = view.board.tiles.find((t) => hexKey(t.hex) === key);
    if (tile && OASIS_TERRAIN.has(tile.res)) out.push(tile);
  }
  return out;
}

/**
 * What a module has repainted on this board, keyed by `hexKey`.
 *
 * `files` is the tile each named hex draws instead of its resource's.
 *
 * `land` is the hexes drawn as land whatever their resource says. Tile art is
 * per hex but the beach, lattice gap and tile scale are per resource. The
 * oasis slab is authored to the land contract (circumradius 3.0 against
 * water's 3.1443, top at 0.22 against 0.1596; `make check-hexes` lists it in
 * the `wat` column beside desert and fields), so it does not fill its lattice
 * cell: drawn as water it would get no gap sand and a beach ring sized for a
 * full cell. A flooded oasis is `lake` on the wire, which coastline.ts
 * also treats as land, so for it `land` is a second guard.
 *
 * Maps and a set rather than a per-hex callback, so each layer pays one hash
 * per tile. Empty on boards without Caravans, or with no oasis.
 *
 * `land` mirrors `files`' keys today because every override substitutes a land
 * model; they are separate because a water override (a whirlpool) would break
 * that.
 */
export interface TileArt {
  files: ReadonlyMap<string, string>;
  land: ReadonlySet<string>;
  /**
   * The whole Y rotation a named hex's tile is laid at, replacing the board's
   * `TILE_ROTATION_Y`. A hex with no entry keeps that constant.
   *
   * Separate from the other two because turning and substituting are
   * independent. Rivers does both (a channel must line up with the engine's
   * two edges); the oasis only substitutes, and its art is composed for the
   * board's own facing.
   */
  yaw: ReadonlyMap<string, number>;
}

/**
 * Every module's repaint, merged.
 *
 * Two modules answer per hex today and cannot collide: the oasis is a derived
 * desert, and the river derivation may not route through the desert. So this
 * merges, and a hex named twice would be a frame the engine cannot produce.
 *
 * River hexes are not added to `land`: they carry a land resource
 * (mountain, hill, pasture, or swamp), so beach and gutter sand already treat
 * them as land. `land` is for hexes whose resource says water and whose art
 * says otherwise, which is only the flooded oasis. `planTiles` follows the
 * coastline's rule for size as well (see its docstring), so river hexes keep
 * their authored size.
 */
export function tileArtOverrides(view: FullView): TileArt {
  const files = new Map<string, string>();
  const land = new Set<string>();
  const yaw = new Map<string, number>();
  // Absent from the manifest until the tile is exported; better a desert than
  // a 404 on every board.
  const entry = TILES[OASIS_TILE];
  for (const oasis of entry ? oasisHexes(view) : []) {
    files.set(hexKey(oasis.hex), entry.file);
    land.add(hexKey(oasis.hex));
  }
  for (const t of planRiverTiles(view)) {
    files.set(hexKey(t.hex), t.file);
    yaw.set(hexKey(t.hex), t.rotationY);
  }
  return { files, land, yaw };
}

// --- the camels themselves ----------------------------------------------
//
// A camel is an unowned road: it occupies an edge, blocks it against a second
// camel, and a player's road may sit beside it. It takes the road's position
// (the edge midpoint, art authored along +x).
//
// Not the road's rotation: `edgeRotationY` gives an axis, and a camel has a
// head (`Camel_head` spans x 0.149..0.894; `Camel_body` spans -0.633..0.398).
// The bearing comes from the chain; see `planCamels`.
//
// Not the road's ownership either: the art has no `Seat_*` material and
// nothing here reads an owner. `loader.test.ts` checks the shipped glb.

/**
 * Node-name prefix in camels.glb. Body, hump, head, legs, pack and blanket are
 * one.
 */
export const CAMEL_PREFIX = "Camel_";

/**
 * Node-name prefix in spokes.glb. Stone, post and cap are one waypost pair.
 *
 * Kept beside the camel's because the two stand on the same edge at the same
 * scale, and the camel replaces the waypost.
 */
export const SPOKE_PREFIX = "Spoke_";

/** A camel, or the ghost of one at a spoke: an edge, and the turn onto it. */
export interface CamelPlacement extends Placement {
  key: string;
  /**
   * True for a camel on a pure sea path, which rides its punt. Its position
   * already carries its y (the punt on the mean water line, see `SEA_CAMEL_Y`),
   * so it is not seated on the gutter.
   */
  onSea?: boolean;
}

// --- the punt --------------------------------------------------------------
//
// Under Caravans with Islands a caravan may cross open water. A camel on a
// path whose two hexes are both water rides a punt (`Raft_*` in camels.glb,
// authored in the camel's frame with its deck under the camel's feet), drawn
// at one placement.
//
// When a route ship shares the path, they split its length: the camel and
// punt move `RAFT_SHIFT` toward the caravan's head and the ship `SHIP_SHIFT`
// the other way, along the path's line. Splitting sideways would overhang the
// hexes either side of a narrow strait. The punt's bow stops 0.03 short of the
// far corner and the ship's stern 0.14 short of the near one;
// `caravans.test.ts` measures both.

/** Node-name prefix of the punt in camels.glb. Not `Camel_`, or every camel would draw one. */
export const RAFT_PREFIX = "Raft_";

/**
 * How high the punt's waterline is in the camel's frame: the hull runs 0.10
 * to 0.22 under a deck topped at 0.245, floating a little over half way up its
 * side, so the swell laps the hull and not the deck.
 */
export const RAFT_WATERLINE = 0.17;

/** Where a sea camel's (and its punt's) origin goes: its waterline on the mean sea. */
export const SEA_CAMEL_Y = SURFACE.sea - RAFT_WATERLINE;

/** How far the camel and its punt move toward the caravan's head on a shared path. */
export const RAFT_SHIFT = 0.78;

/** How far a route ship moves the other way, toward the caravan's tail. */
export const SHIP_SHIFT = 0.8;

/**
 * True when both hexes either side of `e` are water. A hex the board does not
 * carry is open sea, as it is for the harbours in `layers/explorers.ts`.
 */
export function isSeaPath(view: FullView, e: Edge): boolean {
  const byHex = new Map(view.board.tiles.map((t) => [hexKey(t.hex), t]));
  return edgeHexes(e).every((h) => {
    const t = byHex.get(hexKey(h));
    return !t || WATER.has(t.res);
  });
}

/** Local +x under a Y turn of `a`, in the world: THREE sends it to (cos a, -sin a). */
function heading(a: number): [number, number] {
  return [Math.cos(a), -Math.sin(a)];
}

/**
 * The route ships a sea camel shares its path with, and where each moves to.
 *
 * Keyed by `edgeKey`, the value is the world (dx, dz) the ship moves by:
 * `SHIP_SHIFT` toward the caravan's tail, which is minus the camel's heading.
 * `layers/islands.ts` reads this; empty on every board without a camel at sea
 * under a ship, which is every board that is not Caravans with Islands.
 */
export function shipShiftsOnCamelPaths(view: FullView): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const c of planCamels(view)) {
    if (!c.onSea || !c.shared) continue;
    const [hx, hz] = heading(c.rotationY ?? 0);
    out.set(c.edge, [-hx * SHIP_SHIFT, -hz * SHIP_SHIFT]);
  }
  return out;
}

/**
 * The punts: one under every camel on a pure sea path, at the camel's own
 * placement (the art is authored in the camel's frame), keyed apart from it.
 */
export function planRafts(view: FullView): CamelPlacement[] {
  return planCamels(view)
    .filter((c) => c.onSea)
    .map((c) => ({
      position: c.position,
      rotationY: c.rotationY,
      key: `raft:${c.edge}`,
      onSea: true,
    }));
}

/**
 * Every camel on the board, each facing the way its caravan runs.
 *
 * Off `camels`, which is grouped by caravan and ordered outward from the
 * oasis. That order is the only thing that says which end of an edge is far,
 * so the rotation comes from it (`edgeRotationY` is an axis, not a bearing).
 *
 * The order is used as sent (`game/views.go` does not sort `camels`, and
 * neither does this). The walk:
 *
 *   - the first camel's tail is its caravan's oasis corner, from `caravans`;
 *   - each later camel's tail is the vertex it shares with the camel before it,
 *     which is the previous camel's head;
 *   - the head is the edge's other endpoint, and the camel faces it.
 *
 * Vertices are compared by key: every vertex is canonically the north or
 * south corner of exactly one hex (`engine/board/coords.go`).
 *
 * Degradations fall back to the axis rather than guessing a bearing:
 *
 *   - `camels` absent (an older server): use `occupied`, so every camel is
 *     still drawn;
 *   - a caravan omitted from `caravans` (no outward land edge from its corner)
 *     leaves the first camel with no known tail. With two or more camels the
 *     shared vertex with the next one is the head, which fixes the tail anyway;
 *     a lone camel there gets the axis;
 *   - an edge touching neither end of the running chain means a malformed
 *     frame; the chain restarts from it on the same rules.
 */
export function planCamels(view: FullView): (CamelPlacement & { edge: string; shared: boolean })[] {
  return afloat(view, camelsOnEdges(view));
}

/**
 * Put every camel on a pure sea path onto its punt, and move it along the path
 * when a route ship shares it. See "the punt" above.
 */
function afloat(
  view: FullView,
  camels: { e: Edge; placement: CamelPlacement }[],
): (CamelPlacement & { edge: string; shared: boolean })[] {
  const ships = new Set((islandsExt(view)?.ships ?? []).map((s) => edgeKey(s.e)));
  return camels.map(({ e, placement }) => {
    const edge = edgeKey(e);
    if (!isSeaPath(view, e)) return { ...placement, edge, shared: false };
    const shared = ships.has(edge);
    const [hx, hz] = heading(placement.rotationY ?? 0);
    const along = shared ? RAFT_SHIFT : 0;
    const [x, , z] = placement.position;
    const position: Vec3 = [x + hx * along, SEA_CAMEL_Y, z + hz * along];
    return { ...placement, position, onSea: true, edge, shared };
  });
}

/** Every camel on the board with the edge it stands on, before the sea is considered. */
function camelsOnEdges(view: FullView): { e: Edge; placement: CamelPlacement }[] {
  const ext = caravansExt(view);
  const chains = ext?.camels ?? [];
  if (chains.length === 0) {
    return (ext?.occupied ?? []).map((e) => ({
      e,
      placement: {
        position: edgeToWorld(e),
        rotationY: edgeRotationY(e),
        key: `camel:${edgeKey(e)}`,
      },
    }));
  }
  const corners = new Map<number, string>();
  for (const c of ext?.caravans ?? []) corners.set(c.caravan, vertexKey(c.corner));

  const out: { e: Edge; placement: CamelPlacement }[] = [];
  let i = 0;
  while (i < chains.length) {
    const caravan = chains[i].caravan;
    let j = i;
    while (j < chains.length && chains[j].caravan === caravan) j++;
    const chain = chains.slice(i, j).map((c) => c.e);
    const first = corners.get(caravan);
    let tail = first !== undefined && endpointNamed(chain[0], first) ? first : undefined;
    for (let k = 0; k < chain.length; k++) {
      const e = chain[k];
      if (tail === undefined || !endpointNamed(e, tail)) {
        // No tail from the oasis (or the chain broke): the vertex shared with
        // the next camel is this one's head, so the other end is the tail.
        const next = chain[k + 1];
        const shared = next ? sharedVertexKey(e, next) : undefined;
        tail = shared === undefined ? undefined : otherEndKey(e, shared);
      }
      const head = tail === undefined ? undefined : otherEnd(e, tail);
      out.push({
        e,
        placement: {
          position: edgeToWorld(e),
          rotationY:
            head === undefined || tail === undefined
              ? edgeRotationY(e)
              : edgeBearingY(vertexKey(e.a) === tail ? e.a : e.b, head),
          key: `camel:${edgeKey(e)}`,
        },
      });
      tail = head === undefined ? undefined : vertexKey(head);
    }
    i = j;
  }
  return out;
}

function endpointNamed(e: Edge, key: string): boolean {
  return vertexKey(e.a) === key || vertexKey(e.b) === key;
}

function otherEnd(e: Edge, key: string): Vertex {
  return vertexKey(e.a) === key ? e.b : e.a;
}

function otherEndKey(e: Edge, key: string): string {
  return vertexKey(otherEnd(e, key));
}

function sharedVertexKey(e: Edge, f: Edge): string | undefined {
  const fa = vertexKey(f.a);
  const fb = vertexKey(f.b);
  for (const v of [e.a, e.b]) {
    const k = vertexKey(v);
    if (k === fa || k === fb) return k;
  }
  return undefined;
}

/**
 * The three spokes, minus any a camel already stands on.
 *
 * A spoke is where a caravan leaves the oasis, the edge its first camel must
 * take. Without it, an opening board shows three important edges as bare
 * gutter. Once a camel stands there the spoke is dropped, since two things on
 * one edge would read as two camels.
 *
 * A caravan whose oasis corner has no outward land edge is omitted from
 * `caravans` on the wire rather than sent as a zero edge (a real edge at the
 * origin), so a short list needs no filtering.
 */
export function planSpokes(view: FullView): CamelPlacement[] {
  const ext = caravansExt(view);
  const spokes = ext?.caravans ?? [];
  const taken = new Set((ext?.occupied ?? []).map(edgeKey));
  return spokes
    .filter((s) => !taken.has(edgeKey(s.arrow)))
    .map((s) => ({
      position: edgeToWorld(s.arrow),
      rotationY: edgeRotationY(s.arrow),
      key: `spoke:${s.caravan}:${edgeKey(s.arrow)}`,
    }));
}
