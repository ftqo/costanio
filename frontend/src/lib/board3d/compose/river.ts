// Compose a river channel into a base tile.
//
// The channel comes from a hand-made river tile (the template): its cut,
// water, wet margin, mouth shingle and the stones and reeds along it. The
// template's river is faceted (art/README.md, "The faceted re-cut"): its
// channel is the ground's own 631-point lattice, lowered by distance from the
// centreline, and every shipped land tile uses that same
// lattice, so the template's ground, channel, margin and fan together form a
// ground sheet this composer re-heights and repaints triangle for triangle.
// Everything else comes from the base tile:
//
//   HEIGHT  every template lattice point (ground, channel, margin and fan, so
//           no seam opens between them) keeps the template's height at the
//           water (absolute: bed 0.072, waterline 0.193, the kit seated on
//           it) and takes up the base's relief away from it
//           (RELIEF_NEAR..RELIEF_FAR from the water's edge). The bank climbs
//           onto the base's ground, not the pasture's.
//   COLOUR  a turf triangle, in the channel or out, takes the base ground's
//           material under it; the steep bank, its second tone and the wet
//           margin take the family's own (`swap`, `margin`); the river's bed,
//           shingle and water are shared by every family.
//   SLAB    the template's (its top face is cut for the channel), in the base
//           slab's material.
//   RIM     the template's (notched at the two mouths), each face in the base
//           rim's material for the same place on the shared border.
//   PROPS   the base's, minus the loose parts the water lands on, re-seated;
//           heroes moved to the spots authored for this shape.
//
// The cross-section and mouths are the template's exactly, because river hexes
// of different terrain meet mouth to mouth.
import { HeightField, KeepOut, clustersOf, hexApothem } from "./fields.ts";
import { CHIP_XZ, placeHeroes, type HeroLog, type KeepRules } from "./heroes.ts";
import { checkMinimums, sortProps } from "./props.ts";
import {
  faceNormal,
  partsWithRole,
  smoothstep,
  terrainOf,
  type Part,
  type Prim,
  type TileModel,
} from "./model.ts";
import { keepInside, seatGroup, type Place } from "./place.ts";
import type { GroundSpots, Selector } from "./recipe.ts";
import { countNodes, finish, propParts, selects } from "./trade.ts";

/** Template parts that ARE the channel, by the suffix after the template's terrain. */
export const KIT =
  /^(channel|water|fan|margin|bankrock_\d+|bar_\d+|ford_\d+|reeds_\d+|cascade(_\d+)?)$/;
/** The kit parts that cover water or wet bank: the keep-out is built from these. */
export const WET = /^(channel|water|fan|margin)$/;
/** The kit parts that are the faceted lattice itself: re-heighted and repainted with the ground. */
export const LATTICE = /^(channel|fan|margin)$/;
/**
 * The river's own materials, which every family's channel wears: the bed, the
 * shingle and the three water tones. The shallows are `Mat_Pasture_water` on
 * every faceted family (the hills' included), so that one pasture name is the
 * river's, not the pasture's.
 */
export const RIVER_OWN = /^(Mat_River_.*|Mat_Pasture_water)$/;

/** Ground blends from the template's heights (at the water's edge) to the base's over this band. */
export const RELIEF_NEAR = 0.1;
export const RELIEF_FAR = 0.6;
/** No bank point beside the water stands lower than this (the template's own ground floor). */
export const BANK_FLOOR = 0.2205;
/** A margin triangle reaching this high is turf, not a wet margin (fr_lib's rule). */
export const MARGIN_TOP = 0.44;
export const FLOOR_HOLD = 0.6;
export const FLOOR_FREE = 1.0;
/** Inside the chip's apron the lattice stays under its underside (the template's rule). */
export const CHIP_APRON = 1.07;
export const CHIP_APRON_Y = 0.247;
/**
 * A river tile's face budget: `riverArt.test.ts`'s ceiling for every river
 * tile, hand-made or not (the headwaters are 4162-4216).
 */
export const RIVER_TRI_BUDGET = 4600;
/** A base prop vertex this close to the channel drops its part. */
export const RIVER_DROP = 0.14;

export interface RiverInput {
  base: TileModel;
  template: TileModel;
  /** The template family's own plain tile (`sheep.glb` for a pasture template): the rim map's other half. */
  templateBase: TileModel;
  terrain: string;
  /** Template material -> this ground's material, for the banks and the reeds. */
  swap: Record<string, string>;
  /** Template material -> this ground's material, for the wet margin beside the cut. */
  margin?: Record<string, string>;
  /** Shape key the spots are authored under (`e_w_a`). */
  shape: string;
  ground?: GroundSpots;
  keep?: Selector[];
  drop?: Selector[];
  nudge?: Record<Selector, [number, number]>;
}

export interface RiverLog {
  dropped: string[];
  kept: number;
  heroes: HeroLog[];
  repainted: number;
  rimMap: Record<string, string>;
  forcedKeep: string[];
  forcedDrop: string[];
  nudged: string[];
  clipped: string[];
  tris: number;
}

/** The part name with its tile's terrain prefix taken off: `River_Pasture_E_W_A_bar_01` -> `bar_01`. */
function suffix(model: TileModel, name: string): string {
  const t = terrainOf(model);
  return name.startsWith(`${t}_`) ? name.slice(t.length + 1) : name;
}

function centroids(model: TileModel): { c: [number, number, number]; m: string }[] {
  const out: { c: [number, number, number]; m: string }[] = [];
  for (const part of partsWithRole(model, "rim")) {
    for (const p of part.prims) {
      for (let i = 0; i < p.pos.length; i += 9) {
        out.push({
          c: [0, 1, 2].map((k) => (p.pos[i + k] + p.pos[i + 3 + k] + p.pos[i + 6 + k]) / 3) as [
            number,
            number,
            number,
          ],
          m: p.material,
        });
      }
    }
  }
  return out;
}

/** The rim's outline band (hexcontract: CHAMFER_OUTER_EDGE - RIM_OUTLINE_BAND). */
const OUTLINE_FROM = (3 * Math.sqrt(3)) / 2 - 0.02;

interface RimFace {
  c: [number, number, number];
  key: string;
  band: boolean;
}

function rimFace(pos: Float32Array, i: number): RimFace {
  const vs = [0, 1, 2].map((k) => [pos[i + k * 3], pos[i + k * 3 + 1], pos[i + k * 3 + 2]]);
  return {
    c: [0, 1, 2].map((a) => (vs[0][a] + vs[1][a] + vs[2][a]) / 3) as [number, number, number],
    key: vs
      .map((v) => v.map((x) => x.toFixed(3)).join(","))
      .sort()
      .join("|"),
    band: vs.every((v) => hexApothem(v[0], v[2]) >= OUTLINE_FROM - 0.001),
  };
}

/**
 * The material of the base rim's face in the same place, for each template
 * rim face. A face whose three corners match a base face (to the millimetre)
 * takes its material. A face with no twin (the notch at a mouth) takes the
 * nearest base face's material within half a metre, except that the rim's
 * outline material (its outer 2 cm) only goes to faces in that band: the hex
 * contract reads the outline as the lip.
 */
function rimLookup(to: TileModel): (f: RimFace) => string | null {
  const faces: (RimFace & { m: string })[] = [];
  for (const part of partsWithRole(to, "rim")) {
    for (const p of part.prims)
      for (let i = 0; i < p.pos.length; i += 9) faces.push({ ...rimFace(p.pos, i), m: p.material });
  }
  const twins = new Map(faces.map((f) => [f.key, f.m]));
  const outline = new Set(faces.map((f) => f.m));
  for (const f of faces) if (!f.band) outline.delete(f.m);
  return (f) => {
    const twin = twins.get(f.key);
    if (twin && (f.band || !outline.has(twin))) return twin;
    let near: string | null = null,
      nearD = 0.5;
    for (const t of faces) {
      if (!f.band && outline.has(t.m)) continue;
      const d = Math.hypot(t.c[0] - f.c[0], t.c[1] - f.c[1], t.c[2] - f.c[2]);
      if (d < nearD) {
        nearD = d;
        near = t.m;
      }
    }
    return near;
  };
}

/**
 * Which base-rim material stands where each template-family rim material does.
 * Every shipped land rim is the same shared border face for face, so the
 * families' plain tiles give the map directly: pair each face with the other
 * rim's nearest face (by centroid, within 2 cm, since they were cut separately)
 * and take the majority per material, ties broken by name, so a stray face
 * cannot flip it and the result is stable.
 */
export function rimMaterialMap(from: TileModel, to: TileModel): Record<string, string> {
  const target = centroids(to);
  const CELL = 0.05;
  const grid = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  target.forEach((t, i) => {
    const k = key(t.c[0], t.c[2]);
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  const votes = new Map<string, Map<string, number>>();
  for (const f of centroids(from)) {
    let best = -1,
      bestD = 0.02;
    const gx = Math.floor(f.c[0] / CELL),
      gz = Math.floor(f.c[2] / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const i of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
          const t = target[i].c;
          const d = Math.hypot(t[0] - f.c[0], t[1] - f.c[1], t[2] - f.c[2]);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    if (best < 0) continue;
    const v = votes.get(f.m) ?? new Map<string, number>();
    v.set(target[best].m, (v.get(target[best].m) ?? 0) + 1);
    votes.set(f.m, v);
  }
  const out: Record<string, string> = {};
  for (const [src, v] of [...votes].sort(([a], [b]) => a.localeCompare(b))) {
    out[src] = [...v].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  return out;
}

/**
 * The template's rim, each face in the material of the base rim's face in the
 * same place. Outside the mouth notches the two are the same border, so this
 * reproduces the base rim's pattern face for face (outline band included,
 * which the hex contract's lip rule reads); a notch face has no twin and uses
 * the family map.
 */
function rimFaces(
  parts: Part[],
  lookup: (f: RimFace) => string | null,
  fallback: (m: string) => string,
  name: string,
): Part {
  const byMat = new Map<string, { pos: number[]; nrm: number[] }>();
  for (const p of parts) {
    for (const q of p.prims) {
      for (let i = 0; i < q.pos.length; i += 9) {
        const m = lookup(rimFace(q.pos, i)) ?? fallback(q.material);
        const e = byMat.get(m) ?? { pos: [], nrm: [] };
        for (let k = 0; k < 9; k++) {
          e.pos.push(q.pos[i + k]);
          e.nrm.push(q.nrm[i + k]);
        }
        byMat.set(m, e);
      }
    }
  }
  return {
    name,
    prims: [...byMat].map(([material, e]) => ({
      material,
      pos: new Float32Array(e.pos),
      nrm: new Float32Array(e.nrm),
    })),
  };
}

function recolour(parts: Part[], map: (m: string) => string, name: (p: Part) => string): Part[] {
  return parts.map((p) => ({
    name: name(p),
    prims: p.prims.map((q) => ({
      material: map(q.material),
      pos: new Float32Array(q.pos),
      nrm: new Float32Array(q.nrm),
    })),
  }));
}

export function composeRiver(input: RiverInput): { model: TileModel; log: RiverLog } {
  const { base, template, terrain, swap } = input;
  const baseT = terrainOf(base);
  const log: RiverLog = {
    dropped: [],
    kept: 0,
    heroes: [],
    repainted: 0,
    rimMap: {},
    forcedKeep: [],
    forcedDrop: [],
    nudged: [],
    clipped: [],
    tris: 0,
  };
  const used = { drop: new Set<string>(), keep: new Set<string>(), nudge: new Set<string>() };
  const sw = (m: string) => swap[m] ?? m;

  const kit = template.parts.filter((p) => KIT.test(suffix(template, p.name)));
  const wet = kit.filter((p) => WET.test(suffix(template, p.name)));
  if (wet.length === 0) throw new Error(`${template.root}: no channel in the template`);
  // What a prop keeps clear of: the water and the cut (its channel and the
  // shingle at its mouths). The wet margin beside the cut is the turf's own
  // triangles recoloured, flat ground a tree or a hut may stand on.
  const mask = new KeepOut()
    .add(wet.filter((p) => suffix(template, p.name) !== "margin").flatMap((p) => p.prims))
    .finish();
  const baseGround = partsWithRole(base, "ground");
  const Gb = new HeightField(baseGround.flatMap((p) => p.prims));

  // --- ground: the template's lattice, the base's relief and paint ---------
  // One height function for every lattice part, so the ground, the cut, the
  // margin and the shingle meet at every shared corner.
  const water = new KeepOut()
    .add(
      kit
        .filter((p) => suffix(template, p.name) === "water")
        .flatMap((p) => p.prims.filter((q) => RIVER_OWN.test(q.material))),
    )
    .finish();
  const lift = (x: number, y: number, z: number): number => {
    const w = smoothstep(RELIEF_NEAR, RELIEF_FAR, water.at(x, z));
    const b = Gb.sample(x, z);
    let v = b ? y + (b.y - y) * w : y;
    // The template never stands under BANK_FLOOR (fr_lib's ground floor), and
    // a base with lower ground (the forest's hollows) would drop the bank under
    // the waterline. So the floor holds out to FLOOR_HOLD from the water (past
    // the wet margin) and releases by FLOOR_FREE.
    const floor = Math.min(y, BANK_FLOOR);
    if (v < floor) v += (floor - v) * (1 - smoothstep(FLOOR_HOLD, FLOOR_FREE, water.at(x, z)));
    if (Math.hypot(x - CHIP_XZ[0], z - CHIP_XZ[1]) < CHIP_APRON)
      v = Math.min(v, Math.max(y, CHIP_APRON_Y));
    return v;
  };
  const bank = new Set(Object.keys(swap));
  const marginMap = input.margin ?? {};
  // The border's material map doubles as the fallback for a ground face the
  // base sheet does not reach (the outermost ring, under the rim's lip).
  const rimMap = rimMaterialMap(input.templateBase, base);
  /** A turf triangle takes the base ground's material under it. */
  const turf = (tri: number[], mat: string): string => {
    const s = Gb.sample((tri[0] + tri[3] + tri[6]) / 3, (tri[2] + tri[5] + tri[8]) / 3);
    if (s) {
      log.repainted++;
      return s.material;
    }
    return rimMap[mat] ?? mat;
  };
  const toPrims = (byMat: Map<string, number[]>): Prim[] =>
    [...byMat].map(([material, e]) => {
      const pos = new Float32Array(e),
        nrm = new Float32Array(pos.length);
      for (let t = 0; t < pos.length / 9; t++) {
        const n = faceNormal(pos, t);
        for (let k = 0; k < 3; k++) nrm.set(n, t * 9 + k * 3);
      }
      return { material, pos, nrm };
    });
  const put = (into: Map<string, number[]>, mat: string, tri: number[]) => {
    const e = into.get(mat);
    if (e) e.push(...tri);
    else into.set(mat, [...tri]);
  };
  /** Triangles a margin gives back to the ground: turf standing too high to be a wet margin. */
  const groundBack = new Map<string, number[]>();
  const relaid = (
    parts: Part[],
    paint: (tri: number[], mat: string) => string,
    backToGround?: (tri: number[]) => boolean,
  ): Prim[] => {
    const byMat = new Map<string, number[]>();
    for (const part of parts) {
      for (const prim of part.prims) {
        for (let i = 0; i < prim.pos.length; i += 9) {
          const tri: number[] = [];
          for (let k = 0; k < 3; k++) {
            const x = prim.pos[i + k * 3],
              y = prim.pos[i + k * 3 + 1],
              z = prim.pos[i + k * 3 + 2];
            tri.push(x, Math.fround(lift(x, y, z)), z);
          }
          if (backToGround?.(tri)) put(groundBack, turf(tri, prim.material), tri);
          else put(byMat, paint(tri, prim.material), tri);
        }
      }
    }
    return toPrims(byMat);
  };
  // The ground and the cut: a bank material is the family's, the river's own
  // stays, and every other triangle is turf.
  const cutPaint = (tri: number[], mat: string) =>
    bank.has(mat) ? sw(mat) : RIVER_OWN.test(mat) ? mat : turf(tri, mat);
  const latticeKit = new Map<Part, Prim[]>();
  for (const p of kit) {
    const s = suffix(template, p.name);
    if (!LATTICE.test(s)) continue;
    latticeKit.set(
      p,
      s === "margin"
        ? relaid(
            [p],
            (tri, m) => marginMap[m] ?? cutPaint(tri, m),
            // The margin is the turf by the water; where the base's field
            // stands high beside the river (the fields'), the turf there is
            // ground, not a wet margin (fr_lib's own rule: under MARGIN_TOP).
            (tri) => Math.max(tri[1], tri[4], tri[7]) >= MARGIN_TOP,
          )
        : relaid([p], cutPaint),
    );
  }
  const groundOwn = new Map<string, number[]>();
  for (const prim of relaid(partsWithRole(template, "ground"), cutPaint))
    put(groundOwn, prim.material, [...prim.pos]);
  for (const [m, tris] of groundBack) put(groundOwn, m, tris);
  const groundOut = toPrims(groundOwn);
  const Gn = new HeightField(groundOut);

  // --- the base's props ----------------------------------------------------
  const props = partsWithRole(base, "prop").flatMap((p) => clustersOf(p.name, p.prims));
  const heroes = placeHeroes(
    terrain,
    props,
    input.ground,
    input.shape,
    mask,
    Gb,
    Gn,
    undefined,
    "channel",
  );
  log.heroes = heroes.log;
  const rules = (input.ground?.keep ?? {}) as KeepRules;
  const sorted = sortProps({
    props,
    heroes,
    mask,
    distance: RIVER_DROP,
    rules,
    keep: input.keep,
    drop: input.drop,
    Gb,
    Gn,
    used,
    log,
  });
  const kept: Place[] = [...heroes.places, ...sorted.kept];
  for (const [sel, [dx, dz]] of Object.entries(input.nudge ?? {})) {
    for (const p of kept) {
      if (!selects(sel, p.c)) continue;
      used.nudge.add(sel);
      p.sx += dx;
      p.sz += dz;
      log.nudged.push(p.c.id);
    }
  }
  for (const [what, list] of [
    ["drop", input.drop],
    ["keep", input.keep],
    ["nudge", Object.keys(input.nudge ?? {})],
  ] as const) {
    for (const sel of list ?? [])
      if (!used[what].has(sel)) throw new Error(`${terrain}: ${what} "${sel}" picks nothing`);
  }
  // Seated on the finished ground with one lift per body, keeping the
  // clearance each had on the base ground (place.ts): a hero moved onto a
  // slope neither hovers off its downhill side nor sinks to its roof.
  const support = new HeightField([
    ...groundOut,
    ...kit
      .filter((p) => WET.test(suffix(template, p.name)))
      .flatMap((p) => latticeKit.get(p) ?? p.prims),
  ]);
  // Nothing placed may stand on the drawn border (place.ts, `keepInside`).
  for (const g of heroes.groups)
    if (!g.places.some((p) => p.mode === "fixed")) {
      keepInside(g.places);
      seatGroup(g.places, support, Gb);
    }
  for (const g of sorted.groups) {
    keepInside(g);
    seatGroup(g, support, Gb);
  }
  // A long, low body lies on the ground vertex by vertex and is in no group.
  for (const p of kept) if (p.mode === "follow") keepInside([p]);
  checkMinimums(terrain, kept, rules);
  log.kept = kept.length;

  // --- slab and rim: the template's cut, the base's paint --------------------
  const slabMat = partsWithRole(base, "slab")[0]?.prims[0]?.material;
  const templateSlabMats = new Set(
    partsWithRole(template, "slab").flatMap((p) => p.prims.map((q) => q.material)),
  );
  log.rimMap = rimMap;
  const rename = (from: TileModel) => (p: Part) => `${terrain}_${suffix(from, p.name)}`;
  const parts: Part[] = [
    ...recolour(
      partsWithRole(template, "slab"),
      (m) => (templateSlabMats.has(m) && slabMat ? slabMat : sw(m)),
      () => `Hex_${terrain}`,
    ),
    rimFaces(
      partsWithRole(template, "rim"),
      rimLookup(base),
      (m) => rimMap[m] ?? sw(m),
      `${terrain}_rim`,
    ),
    { name: `${terrain}_ground`, prims: groundOut },
    ...kit.map((p) =>
      latticeKit.has(p)
        ? { name: rename(template)(p), prims: latticeKit.get(p)! }
        : recolour([p], sw, rename(template))[0],
    ),
  ];
  const byNode = new Map<string, Place[]>();
  for (const p of kept) byNode.set(p.c.node, [...(byNode.get(p.c.node) ?? []), p]);
  parts.push(
    ...propParts(terrain, baseT, byNode, new Set(parts.map((p) => p.name)), countNodes(props)),
  );
  const res = finish(terrain, parts, [base, template], template, log, RIVER_TRI_BUDGET);
  // Nothing of the template's own terrain may survive: a pasture colour on a
  // forest river is the seam this composer exists to remove.
  const own = new Set(base.materials.keys());
  const allowed = (m: string) =>
    own.has(m) ||
    RIVER_OWN.test(m) ||
    Object.values(swap).includes(m) ||
    Object.values(input.margin ?? {}).includes(m);
  const foreign = [...res.model.materials.keys()].filter((m) => !allowed(m));
  if (foreign.length)
    throw new Error(`${terrain}: template materials survived: ${foreign.join(", ")}`);
  return res;
}
