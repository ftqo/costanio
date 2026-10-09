// The geometric audit of a composed tile.
//
// Measured on the tile as it ships (the model read back from its `.glb`)
// against the base tile it was composed from, so a check cannot pass on the
// composer's own assumptions. One check per defect class:
//
//   (a) WATER FLOAT   a body of water (a pool, a pond, a lake, a river) whose
//                     underside is above the ground beneath it: the slab
//                     reads as a sheet hovering over a slope, with a shadow.
//   (b) PIERCE        ground poking up through a drape (plaza, paving, yard
//                     floor): the paving breaks into shards.
//   (c) ORPHANS       what is left of something the composer took apart: a
//                     loose part of a prop whose other half went (a clipped
//                     pool's mud rim, one blade of a sedge tuft), a rider
//                     (a lily pad) that lost the water it floated on, and a
//                     body sunk so deep only its roof shows.
//   (d) CLASH         a prop standing inside another prop, a building, or on
//                     the paving.
//   (e) HOVER         a rigid body whose lowest vertex is clear of the ground
//                     everywhere under it.
//   (f) OVERLAY       a smooth-outlined sheet laid over the faceted ground (a
//                     drape: the plaza, paving, a yard floor), by name or by
//                     shape. The town's paving is the ground's own triangles
//                     (paint.ts), so there should be none.
//   (g) PAINT         the painted ground broken up: a speck of paint (a
//                     painted patch of fewer than MIN_PAINT triangles), a
//                     pinhole (a triangle or two of bare ground enclosed by
//                     paint), or a base prop standing on the paint.
//
// "Ground" for (a) is the basin a water body lies in: the ground sheet plus a
// lake's bed and bank and a river's channel. "Support" for (e) and (c) is
// anything a body may stand on: that basin, the drapes, a lake town's decks,
// and the water itself (a punt, a lily pad, a moored boat).
import {
  BORDER_APOTHEM,
  HeightField,
  clustersOf,
  hexApothem,
  hull,
  insideDepth,
} from "./fields.ts";

export { hull, insideDepth };
import { boxOfPrims, terrainOf, type Box, type Part, type Prim, type TileModel } from "./model.ts";
import { LONG_LOW_EXTENT, LONG_LOW_HEIGHT } from "./place.ts";
import { GROUP_GAP } from "./props.ts";
import { FLOAT_TOL, WATER_MATERIAL, WATER_BODY_AREA, bodyOfWater, waterArea } from "./water.ts";

export { WATER_MATERIAL, WATER_BODY_AREA };

/** A water body's underside this far over its basin is floating (the base swamp's own pools reach 0.024). */
export const EPS_WATER = 0.03;
/** Ground this far over a drape pierces it (the drapes are authored 3-6 mm over their plane). */
export const EPS_PIERCE = 0.001;
/** A drape this far over the ground is floating. */
export const EPS_DRAPE_FLOAT = 0.02;
/** A rigid body whose lowest vertex clears the support by this much hovers. */
export const EPS_HOVER = 0.01;
/** A body whose least-buried contact is this deep (beyond what its base authored) is sunk. */
export const EPS_SUNK = 0.04;
/** A vertex this far inside another body's footprint, below its top, is a clash. */
export const EPS_CLASH = 0.02;
/** Plan sampling step for the area measures. */
export const STEP = 0.01;
/** A drape floating over less than this much plan (10 cm2) is a sliver no camera can see under. */
export const MIN_FLOAT_AREA = 0.001;
/** An exposed water edge shorter than this is a raster sliver, not a floating rim. */
export const MIN_EDGE = 0.03;
/** Still water whose surface varies by more than this is not level. */
export const EPS_LEVEL = 0.005;
/** A water edge over its basin's floor is contained if the bank climbs past it within this. */
export const BANK_REACH = 0.08;
/** Water outline beyond this apothem is a river mouth at the tile's edge. */
export const MOUTH_APOTHEM = 2.45;
/** Only a body at least this tall can be "sunk" (a crop row or a ripple is meant to sit low). */
export const SUNK_MIN_HEIGHT = 0.1;
/** A decal this flat may be clipped (a dune ripple): no stub stands up out of it. */
export const DECAL_HEIGHT = 0.03;

const DRAPE = /^town_(plaza|paving|yardfloor|path)(_\d+)?$/;
const FIXED = /^town_(deck|boardwalk|quay|pier|stilts)(_\d+)?$/;
/** Surfaces a lake or river brings: the basin its water lies in. */
const BASIN = /^(bed|bank|channel|fan|margin)$/;
/** A river kit's own stones and reeds: the template's, placed on the template's ground. */
const KIT = /^(bankrock_\d+|bar_\d+|ford_\d+|reeds_\d+|cascade(_\d+)?)$/;

export type Kind =
  | "slab"
  | "rim"
  | "ground"
  | "drape"
  | "fixed"
  | "town"
  | "water"
  | "basin"
  | "kit"
  | "prop";

export interface Classified {
  part: Part;
  /** Name with the tile's terrain prefix taken off. */
  short: string;
  kind: Kind;
  /** For a prop: the base node it came from. */
  node?: string;
  tris: number;
  box: Box;
}

/** Which base node a composed prop part came from: `pool_01` -> `Swamp_pool_01`, `sedge_10_02` -> `Swamp_sedge_10`. */
export function baseNode(short: string, baseNodes: Set<string>, baseT: string): string | undefined {
  let s = short.replace(/_base$/, "");
  for (let k = 0; k < 2; k++) {
    if (baseNodes.has(`${baseT}_${s}`)) return `${baseT}_${s}`;
    if (baseNodes.has(s)) return s;
    const m = /^(.*)_\d\d$/.exec(s);
    if (!m) break;
    s = m[1];
  }
  return undefined;
}

export function classify(model: TileModel, base?: TileModel): Classified[] {
  const T = terrainOf(model);
  const baseT = base ? terrainOf(base) : T;
  const baseNodes = new Set(base?.parts.map((p) => p.name) ?? []);
  return model.parts.map((part) => {
    const short = part.name.startsWith(`${T}_`) ? part.name.slice(T.length + 1) : part.name;
    const tris = part.prims.reduce((n, p) => n + p.pos.length / 9, 0);
    const box = boxOfPrims(part.prims);
    let kind: Kind;
    if (part.name === model.root) kind = "slab";
    else if (short === "rim") kind = "rim";
    else if (short === "ground") kind = "ground";
    else if (DRAPE.test(short)) kind = "drape";
    else if (FIXED.test(short)) kind = "fixed";
    else if (short.startsWith("town_")) kind = "town";
    else if (waterArea(part.prims) >= WATER_BODY_AREA) kind = "water";
    else if (BASIN.test(short)) kind = "basin";
    // A river's kit (its template's stones and reeds) is not the base's; a
    // lake's own reeds are.
    else if (KIT.test(short) && !baseNode(short, baseNodes, baseT)) kind = "kit";
    else kind = "prop";
    const node =
      kind === "prop" || kind === "water" ? baseNode(short, baseNodes, baseT) : undefined;
    return { part, short, kind, node, tris, box };
  });
}

// --------------------------------------------------------------- geometry --

function* verts(prims: Prim[]): Generator<[number, number, number]> {
  for (const p of prims)
    for (let i = 0; i < p.pos.length; i += 3) yield [p.pos[i], p.pos[i + 1], p.pos[i + 2]];
}

/** Grid samples over a part's plan box where `field` has a surface. */
function* planSamples(box: Box, step = STEP): Generator<[number, number]> {
  for (let x = Math.ceil(box[0] / step) * step; x <= box[3]; x += step)
    for (let z = Math.ceil(box[2] / step) * step; z <= box[5]; z += step) yield [x, z];
}

// ------------------------------------------------------------------ audit --

export interface WaterFloat {
  part: string;
  kind: "water" | "level" | "drape";
  /**
   * Water: length (m) of its outline standing more than EPS_WATER over the
   * basin. Drape: plan area (m^2) more than EPS_DRAPE_FLOAT over the ground.
   */
  measure: number;
  max: number;
}
export interface Pierce {
  part: string;
  /** Fraction of the drape's plan area the ground comes up through. */
  frac: number;
  max: number;
}
export interface Orphan {
  part: string;
  why: string;
}
export interface Clash {
  a: string;
  b: string;
  depth: number;
}
export interface Hover {
  part: string;
  gap: number;
}

export interface Overlay {
  part: string;
  why: string;
}
export interface PaintDefect {
  kind: "speck" | "pinhole" | "on-paint";
  where: string;
  tris: number;
}
/** The painted ground: triangles and connected patches. */
export interface PaintStats {
  tris: number;
  patches: number[];
}

/** A part standing past the drawn border, by its worst vertex. */
export interface BorderBreach {
  part: string;
  apothem: number;
  over: number;
}

/** A river's water and cut may cross the border at a mouth: within this of the edge midpoint... */
export const MOUTH_HALF_WIDTH = 0.35;
/** ...and no higher than the rim's outer edge. Both are `hexcontract`'s. */
export const MOUTH_TOP_Y = 0.2205;
const MOUTH_PARTS = /^(water|channel)$/;

/**
 * (h) the border: every vertex of every part except the slab and rim lies
 * inside `BORDER_APOTHEM` in the hexagon's metric, or, for a river's water and
 * cut, inside the mouth notch. The same rule `make check-hexes` applies to the
 * shipped file (`hexcontract.border_overshoot`), so vitest holds every
 * composed tile to it too.
 */
export function borderBreaches(cls: Classified[]): BorderBreach[] {
  const out: BorderBreach[] = [];
  for (const c of cls) {
    // The slab and rim are built to meet the border. The ground is the base's
    // sheet, re-heighted but not moved in plan, so it ends where the base's
    // does (`check-hexes` covers that).
    if (c.kind === "slab" || c.kind === "rim" || c.kind === "ground") continue;
    const mouth = MOUTH_PARTS.test(c.short);
    let worst = 0,
      at = 0;
    for (const [x, y, z] of verts(c.part.prims)) {
      const a = hexApothem(x, z);
      const over = a - BORDER_APOTHEM;
      if (over <= 1e-3) continue;
      if (mouth && y <= MOUTH_TOP_Y + 1e-3) {
        let k = 0;
        for (let i = 1; i < 6; i++) {
          const ti = (Math.PI / 3) * i,
            tk = (Math.PI / 3) * k;
          if (x * Math.cos(ti) + z * Math.sin(ti) > x * Math.cos(tk) + z * Math.sin(tk)) k = i;
        }
        const t = (Math.PI / 3) * k;
        if (Math.abs(-x * Math.sin(t) + z * Math.cos(t)) <= MOUTH_HALF_WIDTH + 1e-3) continue;
      }
      if (over > worst) {
        worst = over;
        at = a;
      }
    }
    if (worst > 0) out.push({ part: c.part.name, apothem: at, over: worst });
  }
  return out;
}

export interface TileAudit {
  /** Parts past the drawn border (see `borderBreaches`). */
  border: BorderBreach[];
  waterFloat: WaterFloat[];
  pierce: Pierce[];
  orphans: Orphan[];
  clashes: Clash[];
  hover: Hover[];
  overlays: Overlay[];
  paint: PaintDefect[];
  painted: PaintStats;
  /** Water bodies: where each one is, for the review captions. */
  water: string[];
}

interface BodyStats {
  gap: number;
  sunk: number;
  /** Its height, top to bottom: a part that no longer has it was laid on the ground vertex by vertex. */
  range?: number;
}

/** A rigid body against a support: its lowest clearance, and how deep its least-buried contact is. */
function bodyStats(prims: Prim[], S: HeightField): BodyStats {
  let minY = Infinity;
  for (const [, y] of verts(prims)) minY = Math.min(minY, y);
  let gap = Infinity,
    sunk = Infinity;
  for (const [x, y, z] of verts(prims)) {
    const s = S.sample(x, z);
    if (!s) continue;
    gap = Math.min(gap, y - s.y);
    if (y < minY + 0.02) sunk = Math.min(sunk, s.y - y);
  }
  return { gap: Number.isFinite(gap) ? gap : 0, sunk: Number.isFinite(sunk) ? sunk : 0 };
}

/** Plan hull of a body's foot: its vertices within 0.1 (or half its height) of its lowest. */
function footHull(prims: Prim[], box: Box): [number, number][] {
  const h = box[4] - box[1];
  const cut = box[1] + Math.min(0.1, h / 2);
  const pts: [number, number][] = [];
  for (const [x, y, z] of verts(prims)) if (y <= cut) pts.push([x, z]);
  return hull(pts);
}

function key(node: string, tris: number, box: Box): string {
  return `${node}|${tris}|${((box[0] + box[3]) / 2).toFixed(3)},${((box[2] + box[5]) / 2).toFixed(3)}`;
}

export interface BaseProps {
  /** node -> tri counts of its loose parts. */
  tris: Map<string, Set<number>>;
  /** Loose-part key -> group id. */
  group: Map<string, string>;
  /** group id -> member keys. */
  members: Map<string, string[]>;
  /** key -> the base's own stats for that loose part (what the hand-made tile authored). */
  stats: Map<string, BodyStats>;
  /** node|tris -> worst authored stats among its loose parts (for a part that moved). */
  statsByShape: Map<string, BodyStats>;
  /**
   * Clashes the base tile already has: by the two loose parts' shapes
   * (node|tris) and the offset between their centres, so a pair that moved
   * together (a hero's two parts) is still recognised as authored.
   */
  clashes: { a: string; b: string; dx: number; dz: number }[];
  /** Decal nodes: every loose part flat. */
  decal: Set<string>;
  /** node -> plan keys of every open edge its loose parts have in the base. */
  edges: Map<string, Set<string>>;
  /** node|tris of loose parts that float on water in the base. */
  riders: Set<string>;
}

/** The base tile's props as loose parts: what an audit compares a composed tile with. */
export function baseProps(base: TileModel): BaseProps {
  const cls = classify(base, base);
  const support = supportField(cls);
  const out: BaseProps = {
    tris: new Map(),
    group: new Map(),
    members: new Map(),
    stats: new Map(),
    statsByShape: new Map(),
    clashes: [],
    decal: new Set(),
    riders: new Set(),
    edges: new Map(),
  };
  const water = waterSurface(cls);
  const bodies: { key: string; prims: Prim[]; box: Box }[] = [];
  // A shape is a floater only if every loose part of it floats (a lily pad),
  // not a reed blade that touches the water line somewhere.
  const floatVotes = new Map<string, boolean>();
  for (const c of cls) {
    if (c.kind !== "prop" && c.kind !== "water") continue;
    const parts = clustersOf(c.part.name, c.part.prims).map((k) => ({
      box: k.box,
      prims: primsOf(k.tris),
      tris: k.tris.length,
    }));
    const set = out.tris.get(c.part.name) ?? new Set<number>();
    let flat = true;
    for (const p of parts) {
      set.add(p.tris);
      if (p.box[4] - p.box[1] > DECAL_HEIGHT) flat = false;
      const k = key(c.part.name, p.tris, p.box);
      const st = { ...bodyStats(p.prims, support), range: p.box[4] - p.box[1] };
      out.stats.set(k, st);
      const sk = `${c.part.name}|${p.tris}`;
      const prev = out.statsByShape.get(sk);
      out.statsByShape.set(sk, {
        gap: Math.max(prev?.gap ?? -Infinity, st.gap),
        sunk: Math.max(prev?.sunk ?? -Infinity, st.sunk),
      });
      const cx = (p.box[0] + p.box[3]) / 2,
        cz = (p.box[2] + p.box[5]) / 2;
      // A floater sits on the water surface (a lily pad, a punt), not below it
      // like a stilt hut.
      const w = water.sample(cx, cz);
      const floats = c.kind === "prop" && !!w && Math.abs(p.box[1] - w.y) < FLOAT_TOL;
      floatVotes.set(sk, (floatVotes.get(sk) ?? true) && floats);
      bodies.push({ key: k, prims: p.prims, box: p.box });
    }
    out.tris.set(c.part.name, set);
    out.edges.set(c.part.name, new Set(openEdges(c.part.prims).map((e) => e.plan)));
    if (flat) out.decal.add(c.part.name);
    // Single-linkage groups by plan gap.
    const id = parts.map((_, i) => i);
    const find = (i: number): number => (id[i] === i ? i : (id[i] = find(id[i])));
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i].box,
          b = parts[j].box;
        const gx = Math.max(0, a[0] - b[3], b[0] - a[3]),
          gz = Math.max(0, a[2] - b[5], b[2] - a[5]);
        if (Math.hypot(gx, gz) < GROUP_GAP) id[find(i)] = find(j);
      }
    parts.forEach((p, i) => {
      const g = `${c.part.name}#${find(i)}`;
      const k = key(c.part.name, p.tris, p.box);
      out.group.set(k, g);
      out.members.set(g, [...(out.members.get(g) ?? []), k]);
    });
  }
  const centre = new Map(
    bodies.map((b) => [b.key, [(b.box[0] + b.box[3]) / 2, (b.box[2] + b.box[5]) / 2]]),
  );
  for (const [sk, v] of floatVotes) if (v) out.riders.add(sk);
  for (const [a, b] of clashPairs(bodies)) {
    const [ax, az] = centre.get(a)!,
      [bx, bz] = centre.get(b)!;
    out.clashes.push({ a: shapeOf(a), b: shapeOf(b), dx: bx - ax, dz: bz - az });
  }
  return out;
}

/** `node|tris|x,z` -> `node|tris`. */
const shapeOf = (key: string) => key.split("|").slice(0, 2).join("|");

function primsOf(tris: { prim: Prim; start: number }[]): Prim[] {
  const by = new Map<string, number[]>();
  for (const t of tris) {
    const l = by.get(t.prim.material) ?? [];
    for (let k = 0; k < 9; k++) l.push(t.prim.pos[t.start + k]);
    by.set(t.prim.material, l);
  }
  return [...by].map(([material, l]) => ({
    material,
    pos: new Float32Array(l),
    nrm: new Float32Array(l.length),
  }));
}

/** The water surfaces alone (not a pond's reeds or a pool's bowl). */
function waterSurface(cls: Classified[]): HeightField {
  return new HeightField(
    cls
      .filter((c) => c.kind === "water")
      .flatMap((c) => c.part.prims.filter((p) => WATER_MATERIAL.test(p.material))),
  );
}

function supportField(cls: Classified[]): HeightField {
  return new HeightField(
    cls
      .filter((c) => ["ground", "drape", "fixed", "water", "basin"].includes(c.kind))
      .flatMap((c) => c.part.prims),
  );
}

/** Pairs of bodies where a vertex of one stands inside the other's foot, below its top. */
function clashPairs(
  bodies: { key: string; prims: Prim[]; box: Box }[],
  /** Where a vertex under this is underground, and meets nothing anyone sees. */
  ground?: HeightField,
): [string, string, number][] {
  const feet = bodies.map((b) => ({
    ...b,
    foot: footHull(b.prims, b.box),
    top: new HeightField(b.prims),
  }));
  const out: [string, string, number][] = [];
  for (let i = 0; i < feet.length; i++) {
    for (let j = 0; j < feet.length; j++) {
      if (i === j) continue;
      const A = feet[i],
        B = feet[j];
      if (
        A.box[0] > B.box[3] ||
        A.box[3] < B.box[0] ||
        A.box[2] > B.box[5] ||
        A.box[5] < B.box[2] ||
        A.box[1] > B.box[4] ||
        A.box[4] < B.box[1]
      )
        continue;
      let depth = 0;
      for (const [x, y, z] of verts(A.prims)) {
        if (y < B.box[1] - 0.01) continue;
        const g = ground?.sample(x, z);
        if (g && y < g.y - 0.002) continue;
        const d = insideDepth(B.foot, x, z);
        if (d <= EPS_CLASH) continue;
        const t = B.top.sample(x, z);
        if (!t || y > t.y) continue;
        depth = Math.max(depth, d);
      }
      if (depth > 0) out.push([A.key, B.key, depth]);
    }
  }
  return out;
}

/**
 * Audit one composed tile. `base` is the tile it was composed from and
 * `baseInfo` its loose parts (`baseProps`), so that what the hand-made tile
 * already authored (a stilt hut sunk into the bog, two sedge tufts that
 * touch) is not charged to the composer.
 */
export function auditTile(model: TileModel, base: TileModel, info: BaseProps): TileAudit {
  const cls = classify(model, base);
  const out: TileAudit = {
    border: borderBreaches(cls),
    waterFloat: [],
    pierce: [],
    orphans: [],
    clashes: [],
    hover: [],
    overlays: [],
    paint: [],
    painted: { tris: 0, patches: [] },
    water: [],
  };
  const ground = new HeightField(
    cls.filter((c) => c.kind === "ground").flatMap((c) => c.part.prims),
  );
  const basin = new HeightField(
    cls.filter((c) => c.kind === "ground" || c.kind === "basin").flatMap((c) => c.part.prims),
  );
  const support = supportField(cls);
  const waterF = waterSurface(cls);

  // (a) water float: a water body is contained when its outline meets the
  // ground (its edge tucked into the bank, as on every hand-made pool, pond,
  // lake and river). Its middle is above the basin by definition; the rim is
  // what shows as a floating slab.
  for (const c of cls) {
    if (c.kind !== "water") continue;
    out.water.push(c.short);
    const under = new HeightField(bodyOfWater(c.part.prims), true);
    const x0 = Math.floor(c.box[0] / STEP) - 1,
      z0 = Math.floor(c.box[2] / STEP) - 1;
    const nx = Math.ceil(c.box[3] / STEP) - x0 + 2,
      nz = Math.ceil(c.box[5] / STEP) - z0 + 2;
    const u = new Float64Array(nx * nz).fill(NaN);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const s = under.sample((x0 + i) * STEP, (z0 + j) * STEP);
        if (s) u[j * nx + i] = s.y;
      }
    let edge = 0,
      max = 0;
    for (let i = 1; i < nx - 1; i++)
      for (let j = 1; j < nz - 1; j++) {
        const k = j * nx + i;
        if (Number.isNaN(u[k])) continue;
        const rim =
          Number.isNaN(u[k - 1]) ||
          Number.isNaN(u[k + 1]) ||
          Number.isNaN(u[k - nx]) ||
          Number.isNaN(u[k + nx]);
        if (!rim) continue;
        const x = (x0 + i) * STEP,
          z = (z0 + j) * STEP;
        // A river's mouth runs to the tile's edge to meet the neighbour's
        // water; that edge is the rim's concern.
        if (hexApothem(x, z) > MOUTH_APOTHEM) continue;
        const g = basin.sample(x, z);
        if (!g) continue;
        const gap = u[k] - g.y;
        if (gap <= EPS_WATER) continue;
        // Over a basin floor with the bank rising just outside, the edge is
        // contained, as on a hand-made pond: water a few centimetres over the
        // mud, the bank climbing past it within a hand's breadth.
        let banked = false;
        const R = Math.round(BANK_REACH / STEP);
        for (let di = -R; di <= R && !banked; di++)
          for (let dj = -R; dj <= R && !banked; dj++) {
            if (di * di + dj * dj > R * R) continue;
            const ii = i + di,
              jj = j + dj;
            const inside =
              ii >= 0 && jj >= 0 && ii < nx && jj < nz && !Number.isNaN(u[jj * nx + ii]);
            if (inside) continue;
            const b = basin.sample((x0 + ii) * STEP, (z0 + jj) * STEP);
            if (b && b.y >= u[k] - EPS_WATER) banked = true;
          }
        if (banked) continue;
        edge += STEP;
        max = Math.max(max, gap);
      }
    if (edge >= MIN_EDGE) out.waterFloat.push({ part: c.short, kind: "water", measure: edge, max });
    // Still water is level. A pool re-draped vertex by vertex over new ground
    // warps: up out of its bowl on one side, under the ground on the other.
    // (River water runs downhill and is the template's, so only bodies the
    // composer moves are checked.)
    if (c.short !== "water") {
      let lo = Infinity,
        hi = -Infinity;
      for (const p of c.part.prims) {
        if (!WATER_MATERIAL.test(p.material)) continue;
        for (let i = 1; i < p.pos.length; i += 3) {
          lo = Math.min(lo, p.pos[i]);
          hi = Math.max(hi, p.pos[i]);
        }
      }
      if (hi - lo > EPS_LEVEL)
        out.waterFloat.push({ part: c.short, kind: "level", measure: hi - lo, max: hi - lo });
    }
  }

  // (a) for drapes, and (b): a drape floating over the ground, and the
  // ground coming up through it.
  for (const c of cls) {
    if (c.kind !== "drape") continue;
    const D = new HeightField(c.part.prims);
    let n = 0,
      hit = 0,
      max = 0,
      floatArea = 0,
      floatMax = 0;
    for (const [x, z] of planSamples(c.box)) {
      const d = D.sample(x, z);
      if (!d) continue;
      const g = ground.sample(x, z);
      if (!g) continue;
      n++;
      if (g.y - d.y > EPS_PIERCE) {
        hit++;
        max = Math.max(max, g.y - d.y);
      }
      if (d.y - g.y > EPS_DRAPE_FLOAT) floatArea += STEP * STEP;
      floatMax = Math.max(floatMax, d.y - g.y);
    }
    if (hit > 0) out.pierce.push({ part: c.short, frac: n ? hit / n : 0, max });
    if (floatArea >= MIN_FLOAT_AREA)
      out.waterFloat.push({ part: c.short, kind: "drape", measure: floatArea, max: floatMax });
  }

  // (e) hover, and the sunk half of (c): props against what their base authored.
  const composedKeys = new Map<string, Classified>();
  for (const c of cls) {
    if (c.kind !== "prop" && c.kind !== "town") continue;
    const st = bodyStats(c.part.prims, support);
    let ref: BodyStats = { gap: 0, sunk: 0 };
    if (c.node) {
      const k = key(c.node, c.tris, c.box);
      ref = info.stats.get(k) ?? info.statsByShape.get(`${c.node}|${c.tris}`) ?? ref;
      composedKeys.set(k, c);
    }
    if (st.gap > Math.max(EPS_HOVER, ref.gap + EPS_HOVER))
      out.hover.push({ part: c.short, gap: st.gap });
    // A long, low body (a crop row, hedge, dune, flat rock) is laid on the
    // ground vertex by vertex (`isLongLow`), so "sunk" does not apply.
    const longLow =
      Math.max(c.box[3] - c.box[0], c.box[5] - c.box[2]) > LONG_LOW_EXTENT &&
      c.box[4] - c.box[1] < LONG_LOW_HEIGHT;
    // Nor to a dune melted where the town covers it.
    const melted =
      (!!c.node && !info.tris.get(c.node)?.has(c.tris)) ||
      (ref.range !== undefined && Math.abs(c.box[4] - c.box[1] - ref.range) > 0.005);
    if (
      !longLow &&
      !melted &&
      c.box[4] - c.box[1] >= SUNK_MIN_HEIGHT &&
      st.sunk > Math.max(EPS_SUNK, ref.sunk + EPS_SUNK)
    )
      out.orphans.push({ part: c.short, why: `sunk ${st.sunk.toFixed(3)}` });
  }

  // (c) fragments, split groups and stranded riders.
  const present = new Set<string>();
  const moved: Classified[] = [];
  for (const c of cls) {
    if (c.kind !== "prop" && c.kind !== "water") continue;
    if (!c.node) continue;
    const shapes = info.tris.get(c.node);
    if (shapes && !shapes.has(c.tris) && !info.decal.has(c.node)) {
      // A fragment is a stub only where it was cut: an open edge the base part
      // did not have, standing above the ground. (A dune melted under the town
      // loses faces that are already underground.)
      const cut = cutEdges(c.part.prims, info.edges.get(c.node) ?? new Set(), support);
      if (cut > 0)
        out.orphans.push({
          part: c.short,
          why: `fragment: ${c.tris} of a ${[...shapes].join("/")}-triangle part, ${cut} cut edges showing`,
        });
    }
    const k = key(c.node, c.tris, c.box);
    // A part that stayed put keeps its plan centre exactly, so the key finds
    // it; one that did not was moved (a hero, or a rider with it).
    if (info.group.has(k)) present.add(k);
    else moved.push(c);
    if (info.riders.has(`${c.node}|${c.tris}`)) {
      const cx = (c.box[0] + c.box[3]) / 2,
        cz = (c.box[2] + c.box[5]) / 2;
      if (!waterF.sample(cx, cz)) out.orphans.push({ part: c.short, why: "floater off its water" });
    }
  }
  for (const [g, members] of info.members) {
    if (members.length < 2) continue;
    const here = members.filter((m) => present.has(m));
    if (here.length === 0 || here.length === members.length) continue;
    // A missing member that moved with its hero group counts only when no
    // moved part of the same node and shape exists.
    const missing = members.filter((m) => !present.has(m));
    const gone = missing.filter((m) => {
      const [node, tris] = m.split("|");
      return !moved.some((c) => c.node === node && String(c.tris) === tris);
    });
    if (gone.length === 0) continue;
    const names = here.map((m) => composedKeys.get(m)?.short ?? m);
    out.orphans.push({
      part: names.join("+"),
      why: `group ${g}: ${here.length} of ${members.length} left`,
    });
  }

  // (d) clashes: a body inside another, or a base prop on the paving.
  const bodies = cls
    .filter((c) => c.kind === "prop" || c.kind === "town")
    .map((c) => ({
      key: c.node ? key(c.node, c.tris, c.box) : `town:${c.short}`,
      prims: c.part.prims,
      box: c.box,
      c,
    }));
  const byKey = new Map(bodies.map((b) => [b.key, b.c]));
  for (const [a, b, depth] of clashPairs(bodies, ground)) {
    const A = byKey.get(a)!,
      B = byKey.get(b)!;
    if (A.kind === "town" && B.kind === "town") continue; // the layout, as authored
    // The base, as authored: the same two shapes at the same offset.
    const dx = (B.box[0] + B.box[3]) / 2 - (A.box[0] + A.box[3]) / 2,
      dz = (B.box[2] + B.box[5]) / 2 - (A.box[2] + A.box[5]) / 2;
    if (
      info.clashes.some(
        (k) =>
          // (by distance, not offset: a hero turns as it moves, and its parts
          // with it)
          k.a === shapeOf(a) &&
          k.b === shapeOf(b) &&
          Math.abs(Math.hypot(k.dx, k.dz) - Math.hypot(dx, dz)) < 0.01,
      )
    )
      continue;
    // Two parts neither of which moved (a dune melted in place counts as
    // itself) that overlapped on the base: authored.
    const stayed = (c: Classified) =>
      !!c.node && (!moved.includes(c) || !info.tris.get(c.node)?.has(c.tris));
    if (
      stayed(A) &&
      stayed(B) &&
      info.clashes.some((k) => k.a.split("|")[0] === A.node && k.b.split("|")[0] === B.node)
    )
      continue;
    // Two parts that both moved (one hero's parts, turned and scaled
    // together) and overlapped as the same shapes on the base: authored.
    if (
      moved.includes(A) &&
      moved.includes(B) &&
      info.clashes.some((k) => k.a === shapeOf(a) && k.b === shapeOf(b))
    )
      continue;
    out.clashes.push({ a: A.short, b: B.short, depth });
  }
  const drapes = cls.filter((c) => c.kind === "drape");
  for (const c of cls) {
    if (c.kind !== "prop") continue;
    for (const d of drapes) {
      if (c.box[0] > d.box[3] || c.box[3] < d.box[0] || c.box[2] > d.box[5] || c.box[5] < d.box[2])
        continue;
      const D = new HeightField(d.part.prims);
      let on = 0;
      for (const [x, y, z] of verts(c.part.prims)) {
        const h = D.sample(x, z);
        if (h && y > h.y - 0.001) on++;
      }
      if (on > 0) out.clashes.push({ a: c.short, b: d.short, depth: on });
    }
  }

  // (f) overlays: a drape by name, or any town part that is a thin sheet
  // lying on the ground by shape (whatever it is called).
  for (const c of cls) {
    if (c.kind === "drape") {
      out.overlays.push({ part: c.short, why: "a drape: a sheet laid over the ground" });
      continue;
    }
    if (c.kind !== "town") continue;
    const sheet = flatSheet(c.part.prims, c.box, ground);
    if (sheet) out.overlays.push({ part: c.short, why: sheet });
  }

  // (g) paint: only a town paints its ground.
  if (cls.some((c) => c.kind === "town" || c.kind === "fixed")) paintAudit(cls, base, out);
  return out;
}

/** A town part is a sheet if it is a flat, thin layer lying within this of the ground... */
export const SHEET_LIFT = 0.02;
/** ...over at least this much plan (m^2). */
export const SHEET_AREA = 0.02;

function flatSheet(prims: Prim[], box: Box, ground: HeightField): string | null {
  if (box[4] - box[1] > SHEET_LIFT) return null;
  let area = 0,
    near = 0,
    n = 0;
  for (const p of prims)
    for (let i = 0; i < p.pos.length; i += 9) {
      const P = p.pos;
      area +=
        Math.abs(
          (P[i + 3] - P[i]) * (P[i + 8] - P[i + 2]) - (P[i + 6] - P[i]) * (P[i + 5] - P[i + 2]),
        ) / 2;
      const cx = (P[i] + P[i + 3] + P[i + 6]) / 3,
        cy = (P[i + 1] + P[i + 4] + P[i + 7]) / 3,
        cz = (P[i + 2] + P[i + 5] + P[i + 8]) / 3;
      const g = ground.sample(cx, cz);
      n++;
      if (g && Math.abs(cy - g.y) < SHEET_LIFT) near++;
    }
  if (area < SHEET_AREA || near < n / 2) return null;
  return `a flat sheet of ${area.toFixed(3)} m2 on the ground`;
}

/** A painted patch this small is a speck. */
export const MIN_PAINT = 3;
/** Bare ground this small, all round it paint, is a pinhole. */
export const PINHOLE = 3;

/**
 * The painted ground's connectivity. A ground triangle is painted where its
 * material differs from the base triangle at the same three plan corners (the
 * composer re-heights the base sheet but never re-cuts it; corners welded to
 * 5 mm, well inside the compressed file's quantisation). Paint on base ground
 * of the same colour cannot be told apart and need not be: patches are
 * measured through every triangle wearing a paint colour, as the eye joins
 * them.
 */
function paintAudit(cls: Classified[], base: TileModel, out: TileAudit): void {
  const q = (v: number) => Math.round(v * 200);
  const keysOf = (P: Float32Array, i: number) =>
    [0, 3, 6].map((k) => `${q(P[i + k])},${q(P[i + k + 2])}`);
  const baseMat = new Map<string, string>();
  for (const c of classify(base, base)) {
    if (c.kind !== "ground") continue;
    for (const p of c.part.prims)
      for (let i = 0; i < p.pos.length; i += 9)
        baseMat.set([...keysOf(p.pos, i)].sort().join("|"), p.material);
  }
  const tris: { cx: number; cz: number; mat: string; painted: boolean; keys: string[] }[] = [];
  const groundPrims: Prim[] = [];
  for (const c of cls) {
    if (c.kind !== "ground") continue;
    for (const p of c.part.prims) {
      groundPrims.push(p);
      for (let i = 0; i < p.pos.length; i += 9) {
        const P = p.pos;
        const keys = keysOf(P, i);
        const b = baseMat.get([...keys].sort().join("|"));
        tris.push({
          cx: (P[i] + P[i + 3] + P[i + 6]) / 3,
          cz: (P[i + 2] + P[i + 5] + P[i + 8]) / 3,
          mat: p.material,
          painted: b !== undefined && b !== p.material,
          keys,
        });
      }
    }
  }
  const colours = new Set(tris.filter((t) => t.painted).map((t) => t.mat));
  const inPaint = (i: number) => tris[i].painted || colours.has(tris[i].mat);
  const edges = new Map<string, number[]>();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const a = t.keys[k],
        b = t.keys[(k + 1) % 3];
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      const l = edges.get(e);
      if (l) l.push(i);
      else edges.set(e, [i]);
    }
  });
  const nb: number[][] = tris.map(() => []);
  for (const l of edges.values())
    if (l.length === 2) {
      nb[l[0]].push(l[1]);
      nb[l[1]].push(l[0]);
    }
  const component = (start: number, want: boolean, seen: Set<number>): number[] => {
    const comp = [start];
    seen.add(start);
    for (let k = 0; k < comp.length; k++)
      for (const n of nb[comp[k]])
        if (!seen.has(n) && inPaint(n) === want) {
          seen.add(n);
          comp.push(n);
        }
    return comp;
  };
  const where = (i: number) => `${tris[i].cx.toFixed(2)},${tris[i].cz.toFixed(2)}`;
  const seenP = new Set<number>(),
    seenU = new Set<number>();
  tris.forEach((t, i) => {
    if (t.painted && !seenP.has(i)) {
      const comp = component(i, true, seenP);
      const n = comp.filter((m) => tris[m].painted).length;
      out.painted.tris += n;
      out.painted.patches.push(n);
      if (comp.length < MIN_PAINT) out.paint.push({ kind: "speck", where: where(i), tris: n });
    }
    if (!inPaint(i) && !seenU.has(i)) {
      const comp = component(i, false, seenU);
      if (comp.length > PINHOLE) return;
      // Bare ground on the sheet's edge is not enclosed, nor is bare ground in
      // the base's own patch of a paint colour (a desert's gravel).
      if (comp.some((m) => nb[m].length < 3)) return;
      const ring = new Set<number>();
      for (const m of comp) for (const n of nb[m]) if (!comp.includes(n)) ring.add(n);
      const painted = [...ring].filter((n) => tris[n].painted).length;
      if (ring.size === 0 || [...ring].some((n) => !inPaint(n)) || painted * 2 < ring.size) return;
      out.paint.push({ kind: "pinhole", where: where(i), tris: comp.length });
    }
  });
  // A base prop standing on the paint: its foot over a painted triangle.
  const painted = new HeightField(
    groundPrims.map((p) => {
      const keep: number[] = [];
      for (let i = 0; i < p.pos.length; i += 9) {
        const b = baseMat.get([...keysOf(p.pos, i)].sort().join("|"));
        if (b !== undefined && b !== p.material)
          for (let k = 0; k < 9; k++) keep.push(p.pos[i + k]);
      }
      return {
        material: p.material,
        pos: new Float32Array(keep),
        nrm: new Float32Array(keep.length),
      };
    }),
  );
  for (const c of cls) {
    if (c.kind !== "prop") continue;
    let on = 0;
    for (const [x, y, z] of verts(c.part.prims)) {
      if (y > c.box[1] + 0.02) continue;
      const g = painted.sample(x, z);
      if (g && y > g.y - 0.02) on++;
    }
    if (on > 0) out.paint.push({ kind: "on-paint", where: c.short, tris: on });
  }
}

/** One line per defect class: how many instances. */
export function counts(
  a: TileAudit,
): Record<"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h", number> {
  return {
    a: a.waterFloat.length,
    b: a.pierce.length,
    c: a.orphans.length,
    d: a.clashes.length,
    e: a.hover.length,
    f: a.overlays.length,
    g: a.paint.length,
    h: a.border.length,
  };
}

/**
 * The base tile with every prop node split into its loose parts, named as the
 * composer names them (`pool_01`, `sedge_10_02`), so the hand-made tile is
 * audited on the same terms and authored defects are not blamed on the
 * composer.
 */
export function exploded(base: TileModel): TileModel {
  const T = terrainOf(base);
  const parts: Part[] = [];
  for (const c of classify(base, base)) {
    if (c.kind !== "prop" && c.kind !== "water") {
      parts.push(c.part);
      continue;
    }
    const cs = clustersOf(c.part.name, c.part.prims);
    const stem = c.part.name.startsWith(`${T}_`) ? c.part.name : `${T}_${c.part.name}`;
    cs.forEach((k, i) =>
      parts.push({
        name: cs.length === 1 ? stem : `${stem}_${String(i + 1).padStart(2, "0")}`,
        prims: primsOf(k.tris),
      }),
    );
  }
  return { ...base, parts };
}

/** Every edge used by exactly one triangle (welded by position), with its plan key and midpoint. */
export function openEdges(prims: Prim[]): { plan: string; mid: [number, number, number] }[] {
  // Welded to the millimetre and keyed in plan to the centimetre, so edges
  // still match after compression's sub-millimetre quantisation.
  const q = (v: number, s: number) => Math.round(v * s);
  const k3 = (a: Float32Array, i: number) =>
    `${q(a[i], 1e3)},${q(a[i + 1], 1e3)},${q(a[i + 2], 1e3)}`;
  const k2 = (a: Float32Array, i: number) => `${q(a[i], 1e2)},${q(a[i + 2], 1e2)}`;
  const count = new Map<string, { n: number; plan: string; mid: [number, number, number] }>();
  for (const p of prims) {
    const a = p.pos;
    for (let i = 0; i < a.length; i += 9) {
      for (const [u, v] of [
        [0, 3],
        [3, 6],
        [6, 0],
      ]) {
        const ka = k3(a, i + u),
          kb = k3(a, i + v);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const pa = k2(a, i + u),
          pb = k2(a, i + v);
        const e = count.get(key);
        if (e) e.n++;
        else
          count.set(key, {
            n: 1,
            plan: pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`,
            mid: [
              (a[i + u] + a[i + v]) / 2,
              (a[i + u + 1] + a[i + v + 1]) / 2,
              (a[i + u + 2] + a[i + v + 2]) / 2,
            ],
          });
      }
    }
  }
  return [...count.values()].filter((e) => e.n === 1);
}

/** Open edges a part has that its base part did not, standing above the support. */
function cutEdges(prims: Prim[], base: Set<string>, S: HeightField): number {
  let n = 0;
  for (const e of openEdges(prims)) {
    if (base.has(e.plan)) continue;
    const g = S.sample(e.mid[0], e.mid[2]);
    if (!g || e.mid[1] > g.y + 0.005) n++;
  }
  return n;
}
