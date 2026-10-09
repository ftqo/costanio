// Paint: the town's plaza, spokes and yard floors as the ground's own
// triangles, not sheets laid over it.
//
// A smooth-outlined sheet on a faceted 21 cm lattice looked like a sticker,
// floated where the lattices disagreed, and had ground poking through it
// elsewhere. So the ground is set to each drape's surface (drape.ts: a plane
// for the plaza, a graded profile for a spoke), the drape is not emitted, and
// the ground triangles in its footprint take its colour:
//
//   PLAZA   the largest lattice hexagon inscribed in the plaza's circle,
//           centred on the lattice vertex nearest its centre: whole
//           triangles, cobbled by triangle in two stones.
//   SPOKE   a band of whole lattice rows along the spoke: its axis snapped to
//           the nearest lattice direction, its edges to the lattice lines
//           nearest its width. In the ground's own path material, with the
//           odd stone.
//   YARD    a yard floor: the triangles whose centres fall inside it, in the
//           ground's yard material.
//
// Then one gap-fill pass over face adjacency (a triangle with two painted
// neighbours of one kind joins them; a painted one with none is cleared), and
// painted points are evened by at most EVEN_CAP (never raised inside the
// chip's disc). Kerb stones (small blocks at spaced points along the plaza's
// and spokes' edges, clear of buildings, props, pools and the chip) are the
// only added parts.
//
// All of this is plan arithmetic on the ground's vertices in a fixed order,
// with a positional hash for stone choice, so the same inputs paint the same
// triangles.
import { HeightField, hexApothem } from "./fields.ts";
import { CHIP_KEEP, HERO_APOTHEM, chipDist } from "./heroes.ts";
import { faceNormal, type Part, type Prim } from "./model.ts";

export type PaintLabel = "plaza" | "spoke" | "yard";

/** The plaza's two stones, by triangle, and the share of the lighter. */
export const PLAZA_STONE = "Mat_Castle_stone";
export const PLAZA_STONE_LT = "Mat_Castle_stone_lt";
export const PLAZA_LIGHT = 0.4;
/** The share of a spoke's triangles that are a stone in the path. */
export const SPOKE_STONE = 1 / 7;
/** A spoke this elongated runs along its own axis; a stubbier one, out from the centre. */
export const SPOKE_RATIO = 2.5;
/** With a plaza, a spoke's band reaches this far back toward it (the plaza wins where they meet). */
export const SPOKE_BACK = 0.3;
/** A painted point moves by at most this when evened... */
export const EVEN_CAP = 0.015;
/** ...over this many passes, this far toward its neighbours' mean each pass... */
export const EVEN_PASSES = 2;
export const EVEN_STRENGTH = 0.5;
/** ...and never up inside the chip's disc (and this margin round it). */
export const EVEN_CHIP = CHIP_KEEP + 0.05;

/** One paintable drape: its part, what it is, and the material a compact one wears. */
export interface PaintSource {
  part: Part;
  label: PaintLabel;
}

export interface PaintResult {
  /** The ground, repainted and evened. */
  ground: Prim[];
  /** Painted triangles by label. */
  painted: Record<PaintLabel, number>;
  /** The painted ground triangles by label, as prims (plan footprints). */
  regions: Record<PaintLabel, Prim[]>;
  /** Triangle index (in `mesh`) -> label. */
  labels: Map<number, PaintLabel>;
  mesh: GroundMesh;
}

// ------------------------------------------------------------------ mesh --

export const pkey = (x: number, z: number) => `${Math.fround(x)},${Math.fround(z)}`;

/** The ground as triangles with their edge neighbours, welded by plan position. */
export class GroundMesh {
  readonly tris: { prim: number; at: number; cx: number; cz: number; keys: string[] }[] = [];
  readonly nb: number[][] = [];
  /** Plan vertex -> its [x, z]. */
  readonly verts = new Map<string, [number, number]>();
  /** Plan vertex -> the vertices it shares an edge with. */
  readonly vnb = new Map<string, Set<string>>();
  /** Plan vertex -> the triangles it is a corner of. */
  readonly vtris = new Map<string, number[]>();
  readonly prims: Prim[];
  constructor(prims: Prim[]) {
    this.prims = prims;
    const edges = new Map<string, number[]>();
    prims.forEach((p, pi) => {
      for (let i = 0; i < p.pos.length; i += 9) {
        const P = p.pos;
        const keys = [0, 3, 6].map((k) => pkey(P[i + k], P[i + k + 2]));
        const t = this.tris.push({
          prim: pi,
          at: i,
          cx: (P[i] + P[i + 3] + P[i + 6]) / 3,
          cz: (P[i + 2] + P[i + 5] + P[i + 8]) / 3,
          keys,
        });
        for (let k = 0; k < 3; k++) {
          this.verts.set(keys[k], [P[i + k * 3], P[i + k * 3 + 2]]);
          const vt = this.vtris.get(keys[k]);
          if (vt) vt.push(t - 1);
          else this.vtris.set(keys[k], [t - 1]);
          const a = keys[k],
            b = keys[(k + 1) % 3];
          if (a === b) continue;
          const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
          const l = edges.get(ek);
          if (l) l.push(t - 1);
          else edges.set(ek, [t - 1]);
          for (const [u, v] of [
            [a, b],
            [b, a],
          ]) {
            const s = this.vnb.get(u);
            if (s) s.add(v);
            else this.vnb.set(u, new Set([v]));
          }
        }
      }
    });
    for (let t = 0; t < this.tris.length; t++) this.nb.push([]);
    for (const l of edges.values()) {
      if (l.length !== 2) continue;
      this.nb[l[0]].push(l[1]);
      this.nb[l[1]].push(l[0]);
    }
  }

  /** The ground vertex nearest (x, z). */
  nearest(x: number, z: number): [number, number] {
    let best: [number, number] = [x, z],
      d = Infinity;
    for (const v of this.verts.values()) {
      const e = Math.hypot(v[0] - x, v[1] - z);
      if (e < d) {
        d = e;
        best = v;
      }
    }
    return best;
  }

  /**
   * The lattice's three directions: the three strongest edge bearings (mod
   * 180), each at least 20 degrees from the others. On every shipped land
   * tile they are 30, 90 and 150; on a square test sheet 0, 45 and 90.
   */
  directions(): [number, number][] {
    const hist = new Float64Array(180);
    for (const t of this.tris) {
      for (let k = 0; k < 3; k++) {
        const a = this.verts.get(t.keys[k])!,
          b = this.verts.get(t.keys[(k + 1) % 3])!;
        const ang = (((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 180) + 180;
        hist[Math.round(ang) % 180]++;
      }
    }
    const picked: number[] = [];
    while (picked.length < 3) {
      let best = -1;
      for (let d = 0; d < 180; d++) {
        if (picked.some((p) => Math.min(Math.abs(p - d), 180 - Math.abs(p - d)) < 20)) continue;
        if (best < 0 || hist[d] > hist[best]) best = d;
      }
      if (best < 0 || hist[best] === 0) break;
      picked.push(best);
    }
    // The peak's own mean bearing, to a fraction of a degree.
    return picked.map((d) => {
      let s = 0,
        n = 0;
      for (let e = -1; e <= 1; e++) {
        const w = hist[(d + e + 180) % 180];
        s += (d + e) * w;
        n += w;
      }
      const a = ((n ? s / n : d) * Math.PI) / 180;
      return [Math.cos(a), Math.sin(a)];
    });
  }
}

// ----------------------------------------------------------------- lines --

/**
 * The lattice lines parallel to u near a point: the offsets (along u's normal,
 * from `origin`) at which the ground's vertices line up, among the vertices
 * `within` selects. Clustered, so a lattice wandering a few millimetres still
 * gives one line each. A line needs LINE_SUPPORT of the best line's vertices,
 * so a stray vertex or two (the lake's sheet is refined near its bank) does
 * not count.
 */
export function linesAlong(
  mesh: GroundMesh,
  u: [number, number],
  origin: [number, number],
  within: (s: number, d: number) => boolean,
): number[] {
  const n: [number, number] = [-u[1], u[0]];
  const ds: number[] = [];
  for (const [x, z] of mesh.verts.values()) {
    const s = (x - origin[0]) * u[0] + (z - origin[1]) * u[1],
      d = (x - origin[0]) * n[0] + (z - origin[1]) * n[1];
    if (within(s, d)) ds.push(d);
  }
  ds.sort((a, b) => a - b);
  const runs: number[][] = [];
  let run: number[] = [];
  for (const d of ds) {
    if (run.length && d - run[run.length - 1] > LINE_TOL) {
      runs.push(run);
      run = [];
    }
    run.push(d);
  }
  if (run.length) runs.push(run);
  const most = Math.max(0, ...runs.map((r) => r.length));
  return runs
    .filter((r) => r.length >= Math.max(2, LINE_SUPPORT * most))
    .map((r) => r.reduce((a, b) => a + b, 0) / r.length);
}
/** A lattice line has at least this share of the best-supported line's vertices. */
export const LINE_SUPPORT = 0.4;
/** Vertex offsets within this of each other are one lattice line. */
export const LINE_TOL = 0.04;

// ------------------------------------------------------------ footprints --

interface Axis {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  s0: number;
  s1: number;
  halfW: number;
  ratio: number;
}

/** A drape's principal axis, its extent along it and its half-width across it. */
export function axisOf(part: Part): Axis | null {
  const v: [number, number][] = [];
  for (const p of part.prims)
    for (let i = 0; i < p.pos.length; i += 3) v.push([p.pos[i], p.pos[i + 2]]);
  if (v.length === 0) return null;
  const cx = v.reduce((s, p) => s + p[0], 0) / v.length,
    cz = v.reduce((s, p) => s + p[1], 0) / v.length;
  let sxx = 0,
    szz = 0,
    sxz = 0;
  for (const [x, z] of v) {
    sxx += (x - cx) ** 2;
    szz += (z - cz) ** 2;
    sxz += (x - cx) * (z - cz);
  }
  const tr = sxx + szz,
    det = sxx * szz - sxz * sxz;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc,
    l2 = tr / 2 - disc;
  let ux: number, uz: number;
  if (Math.abs(sxz) > 1e-12) {
    const l = Math.hypot(l1 - szz, sxz);
    ux = (l1 - szz) / l;
    uz = sxz / l;
  } else if (sxx >= szz) {
    ux = 1;
    uz = 0;
  } else {
    ux = 0;
    uz = 1;
  }
  let s0 = Infinity,
    s1 = -Infinity,
    halfW = 0;
  for (const [x, z] of v) {
    const s = (x - cx) * ux + (z - cz) * uz;
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
    halfW = Math.max(halfW, Math.abs(-(x - cx) * uz + (z - cz) * ux));
  }
  return { cx, cz, ux, uz, s0, s1, halfW, ratio: Math.sqrt(l1 / Math.max(l2, 1e-9)) };
}

/**
 * The plaza: the largest lattice hexagon inscribed in its circle, centred on
 * the lattice vertex nearest the circle's centre. Each pair of sides is on the
 * lattice lines normal to one direction, at the whole number of rows that keeps
 * the corners inside the circle, so every triangle is whole and the outline is
 * six straight lattice lines.
 */
export function plazaTris(mesh: GroundMesh, part: Part, dirs: [number, number][]): number[] {
  const a = axisOf(part);
  if (!a) return [];
  // The circle's centre. Its authored outline is a disc bitten on the chip's
  // side, so use the middle of its x extent and of its far side's reach.
  let x0 = Infinity,
    x1 = -Infinity;
  for (const p of part.prims)
    for (let i = 0; i < p.pos.length; i += 3) {
      x0 = Math.min(x0, p.pos[i]);
      x1 = Math.max(x1, p.pos[i]);
    }
  const R = (x1 - x0) / 2;
  const c = mesh.nearest((x0 + x1) / 2, a.cz);
  // Each pair of sides: the outermost lattice lines parallel to one
  // direction that keep the corners inside R (a side at R cos 30).
  const lim = R * Math.cos(Math.PI / 6) + 1e-6;
  const sides = dirs.map((u) => {
    const lines = linesAlong(mesh, u, c, (s, d) => Math.hypot(s, d) < R + 0.5);
    return {
      n: [-u[1], u[0]] as [number, number],
      hi: Math.max(0, ...lines.filter((d) => d > 0 && d <= lim)),
      lo: Math.min(0, ...lines.filter((d) => d < 0 && d >= -lim)),
    };
  });
  const within = (x: number, z: number) =>
    sides.every(({ n, lo, hi }) => {
      const d = (x - c[0]) * n[0] + (z - c[1]) * n[1];
      return d > lo + 1e-4 && d < hi - 1e-4;
    });
  const out: number[] = [];
  mesh.tris.forEach((t, i) => {
    if (within(t.cx, t.cz)) out.push(i);
  });
  return out;
}

/**
 * A spoke: a band of whole lattice rows. The axis is snapped to the nearest
 * lattice direction, and the band's two edges to the pair of lattice lines
 * whose width is nearest the spoke's and whose middle is nearest its axis.
 */
export function spokeTris(
  mesh: GroundMesh,
  part: Part,
  dirs: [number, number][],
  back = 0,
): number[] {
  const a = axisOf(part);
  if (!a) return [];
  // The strip's own axis; a stub too short to have one (the lake's last piece
  // of spoke, from water to rim) runs out from the tile's centre.
  const r = Math.hypot(a.cx, a.cz);
  const [ax, az] = a.ratio >= SPOKE_RATIO || r < 0.3 ? [a.ux, a.uz] : [a.cx / r, a.cz / r];
  let u: [number, number] = dirs[0];
  for (const d of dirs)
    if (Math.abs(d[0] * ax + d[1] * az) > Math.abs(u[0] * ax + u[1] * az)) u = d;
  const o: [number, number] = [a.cx, a.cz];
  let s0 = Infinity,
    s1 = -Infinity,
    W = 0;
  for (const p of part.prims)
    for (let i = 0; i < p.pos.length; i += 3) {
      const s = (p.pos[i] - o[0]) * u[0] + (p.pos[i + 2] - o[1]) * u[1];
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      W = Math.max(W, 2 * Math.abs(-(p.pos[i] - o[0]) * u[1] + (p.pos[i + 2] - o[1]) * u[0]));
    }
  const lines = linesAlong(
    mesh,
    u,
    o,
    (s, d) => s > s0 - 0.1 && s < s1 + 0.1 && Math.abs(d) < 3 * W,
  );
  let band: [number, number] | null = null,
    cost = Infinity;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length && j <= i + 4; j++) {
      const c = Math.abs(lines[j] - lines[i] - W) + Math.abs((lines[i] + lines[j]) / 2);
      if (c < cost - 1e-9) {
        cost = c;
        band = [lines[i], lines[j]];
      }
    }
  if (!band) return [];
  const [lo, hi] = band;
  // Which end is the plaza's: the one nearer the tile's centre.
  const inner =
    Math.hypot(o[0] + u[0] * s0, o[1] + u[1] * s0) < Math.hypot(o[0] + u[0] * s1, o[1] + u[1] * s1);
  const from = s0 - (inner ? back : 0),
    to = s1 + (inner ? 0 : back);
  const out: number[] = [];
  mesh.tris.forEach((t, i) => {
    const s = (t.cx - o[0]) * u[0] + (t.cz - o[1]) * u[1],
      d = -(t.cx - o[0]) * u[1] + (t.cz - o[1]) * u[0];
    if (d > lo + 1e-4 && d < hi - 1e-4 && s >= from && s <= to) out.push(i);
  });
  return out;
}

/** A compact drape: the triangles whose centres fall inside it. */
export function compactTris(mesh: GroundMesh, part: Part): number[] {
  const F = new HeightField(part.prims);
  const out: number[] = [];
  mesh.tris.forEach((t, i) => {
    if (F.sample(t.cx, t.cz)) out.push(i);
  });
  return out;
}

// ----------------------------------------------------------------- paint --

/** A deterministic [0, 1) from a plan point and a salt. */
export function hash01(x: number, z: number, salt: number): number {
  let h =
    Math.imul(Math.round(x * 1000), 73856093) ^ Math.imul(Math.round(z * 1000), 19349663) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** FNV-1a of a name: a tile's own salt. */
export function saltOf(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const PRIORITY: PaintLabel[] = ["plaza", "spoke", "yard"];
/** A bare pocket of up to this many triangles closed in by paint is filled. */
export const POCKET = 3;
/** A painted patch of fewer triangles than this is a speck, and is not painted. */
export const MIN_PATCH = 3;

/** What is painted where, decided on the ground's PLAN alone. */
export interface PaintPlan {
  mesh: GroundMesh;
  labels: Map<number, PaintLabel>;
  /** A yard floor's (or a spoke's own) material, by triangle. */
  own: Map<number, string>;
  /** The painted triangles by label, as plan footprints. */
  regions: Record<PaintLabel, Prim[]>;
}

export interface PlanInput {
  /** The ground sheet: only its plan is read, so any re-heighting of it will do. */
  ground: Prim[];
  sources: PaintSource[];
  /** Where nothing is painted (a ground-bound pond's water and bank). */
  exclude?: (x: number, z: number) => boolean;
  /** The paint's colours besides the stones (the ground's path material). */
  colours?: string[];
}

/**
 * Which ground triangles are painted as what. Only plan positions are read,
 * and re-heighting never moves them, so this is decided once before the town
 * is placed, and props and heroes keep clear of the paint itself.
 */
export function planPaint(input: PlanInput): PaintPlan {
  const mesh = new GroundMesh(input.ground);
  const dirs = mesh.directions();
  const labels = new Map<number, PaintLabel>();
  const own = new Map<number, string>();
  const excluded = (i: number) => !!input.exclude?.(mesh.tris[i].cx, mesh.tris[i].cz);
  const hasPlaza = input.sources.some((s) => s.label === "plaza");
  // In priority order: the plaza first, then the spokes, then yard floors.
  for (const label of PRIORITY) {
    for (const src of input.sources) {
      if (src.label !== label) continue;
      const tris =
        label === "plaza"
          ? plazaTris(mesh, src.part, dirs)
          : label === "spoke"
            ? spokeTris(mesh, src.part, dirs, hasPlaza ? SPOKE_BACK : 0)
            : compactTris(mesh, src.part);
      const mat = src.part.prims[0]?.material;
      for (const t of tris) {
        if (labels.has(t) || excluded(t)) continue;
        labels.set(t, label);
        if (mat) own.set(t, mat);
      }
    }
  }
  // One gap-fill pass, on a snapshot. A bare triangle with two painted
  // neighbours joins them (taking the majority kind, the plaza's on a tie), as
  // does a pocket of up to POCKET bare triangles enclosed by paint (the notch
  // where two spokes leave the plaza at neighbouring corners).
  const snap = new Map(labels);
  const colours = new Set([PLAZA_STONE, PLAZA_STONE_LT, ...(input.colours ?? []), ...own.values()]);
  const likePaint = (n: number) => colours.has(input.ground[mesh.tris[n].prim].material);
  const join = (t: number, from: number[]) => {
    let best: PaintLabel | null = null,
      most = 0;
    for (const label of PRIORITY) {
      const n = from.filter((m) => snap.get(m) === label).length;
      if (n > most) {
        most = n;
        best = label;
      }
    }
    if (!best) return;
    labels.set(t, best);
    const m = own.get(from.find((f) => snap.get(f) === best)!);
    if (m) own.set(t, m);
  };
  const filled = new Set<number>();
  for (let t = 0; t < mesh.tris.length; t++) {
    if (snap.has(t) || excluded(t) || filled.has(t)) continue;
    // The bare pocket this triangle is in, if it is a small closed one.
    const pocket = [t];
    let closed = true;
    for (let k = 0; k < pocket.length && closed; k++) {
      if (mesh.nb[pocket[k]].length < 3) closed = false; // the sheet's own edge
      for (const n of mesh.nb[pocket[k]]) {
        // Base ground already in a paint colour (a field's track beside a
        // spoke) closes a pocket like paint, since the eye cannot tell them apart.
        if (snap.has(n) || pocket.includes(n) || likePaint(n)) continue;
        if (excluded(n) || pocket.length >= POCKET) closed = false;
        else pocket.push(n);
      }
    }
    const touches = pocket.some((p) => mesh.nb[p].some((n) => snap.has(n)));
    for (const p of closed && touches ? pocket : [t]) {
      const painted = mesh.nb[p].filter((n) => snap.has(n));
      if (closed && touches && !painted.length) {
        // Inside the pocket, away from the paint: the pocket's own kind.
        const edge = pocket.flatMap((q) => mesh.nb[q].filter((n) => snap.has(n)));
        join(p, edge);
      } else if ((closed && touches) || painted.length >= 2) join(p, painted);
      filled.add(p);
    }
  }
  // A patch of paint smaller than MIN_PATCH is a speck, not a path: it goes.
  const patchSeen = new Set<number>();
  for (const [t, label] of [...labels]) {
    if (patchSeen.has(t)) continue;
    const patch = [t];
    patchSeen.add(t);
    for (let k = 0; k < patch.length; k++)
      for (const n of mesh.nb[patch[k]])
        if (!patchSeen.has(n) && labels.get(n) === label) {
          patchSeen.add(n);
          patch.push(n);
        }
    if (patch.length < MIN_PATCH)
      for (const p of patch) {
        labels.delete(p);
        own.delete(p);
      }
  }
  const pos: Record<PaintLabel, number[]> = { plaza: [], spoke: [], yard: [] };
  for (const [t, label] of labels) {
    const tri = mesh.tris[t];
    pos[label].push(...input.ground[tri.prim].pos.subarray(tri.at, tri.at + 9));
  }
  const asPrims = (l: PaintLabel): Prim[] =>
    pos[l].length
      ? [{ material: l, pos: new Float32Array(pos[l]), nrm: new Float32Array(pos[l].length) }]
      : [];
  return {
    mesh,
    labels,
    own,
    regions: { plaza: asPrims("plaza"), spoke: asPrims("spoke"), yard: asPrims("yard") },
  };
}

export interface PaintInput {
  /** The finished ground: the plan's sheet, re-heighted, triangle for triangle. */
  ground: Prim[];
  plan: PaintPlan;
  /** The spokes' material: the ground's own path (the yard-material table). */
  path?: string;
  salt: number;
  /** Points the evening leaves where they are (a bank that holds water in). */
  still?: (x: number, z: number) => boolean;
  /**
   * Planned triangles left in their own colour (a prop's foot stands on
   * them). Their points are evened anyway, so a second call with this set
   * changes only colours.
   */
  bare?: Set<number>;
}

export function paintGround(input: PaintInput): PaintResult {
  const { mesh, labels, own: ownMat } = input.plan;
  if (input.ground.length !== mesh.prims.length)
    throw new Error("paintGround: the ground is not the plan's sheet");

  // The materials, by triangle.
  const materialOf = (t: number): string => {
    const tri = mesh.tris[t];
    const label = input.bare?.has(t) ? undefined : labels.get(t);
    const own = input.ground[tri.prim].material;
    if (!label) return own;
    const r = hash01(tri.cx, tri.cz, input.salt);
    if (label === "plaza") return r < PLAZA_LIGHT ? PLAZA_STONE_LT : PLAZA_STONE;
    if (label === "spoke")
      return r < SPOKE_STONE ? PLAZA_STONE : (input.path ?? ownMat.get(t) ?? own);
    return ownMat.get(t) ?? own;
  };

  // Even the painted points: a gentle pull toward their neighbours' mean,
  // never more than EVEN_CAP from where the surfaces set them, and never up
  // inside the chip's disc.
  const pos = input.ground.map((p) => new Float32Array(p.pos));
  const paintedV = new Set<string>();
  for (const t of labels.keys()) for (const k of mesh.tris[t].keys) paintedV.add(k);
  const copies = new Map<string, [number, number][]>();
  mesh.tris.forEach((t) => {
    for (let k = 0; k < 3; k++) {
      if (!paintedV.has(t.keys[k])) continue;
      const l = copies.get(t.keys[k]);
      const at: [number, number] = [t.prim, t.at + k * 3];
      if (l) l.push(at);
      else copies.set(t.keys[k], [at]);
    }
  });
  const heightOf = new Map<string, number>();
  mesh.tris.forEach((t) => {
    for (let k = 0; k < 3; k++)
      if (!heightOf.has(t.keys[k])) heightOf.set(t.keys[k], pos[t.prim][t.at + k * 3 + 1]);
  });
  const y0 = new Map([...paintedV].map((k) => [k, heightOf.get(k)!]));
  const order = [...paintedV].sort();
  for (let pass = 0; pass < EVEN_PASSES; pass++) {
    const next = new Map<string, number>();
    for (const k of order) {
      const ns = [...(mesh.vnb.get(k) ?? [])];
      if (!ns.length) continue;
      const y = heightOf.get(k)!;
      const mean = ns.reduce((s, n) => s + heightOf.get(n)!, 0) / ns.length;
      const base = y0.get(k)!;
      let v = y + (mean - y) * EVEN_STRENGTH;
      v = Math.max(base - EVEN_CAP, Math.min(base + EVEN_CAP, v));
      const [x, z] = mesh.verts.get(k)!;
      if (input.still?.(x, z)) continue;
      if (chipDist(x, z) < EVEN_CHIP) v = Math.min(v, base);
      next.set(k, v);
    }
    for (const [k, v] of next) heightOf.set(k, v);
  }
  const moved = new Set<number>();
  for (const k of order) {
    const y = Math.fround(heightOf.get(k)!);
    for (const [p, i] of copies.get(k)!) {
      if (pos[p][i + 1] === y) continue;
      pos[p][i + 1] = y;
      moved.add(p);
    }
  }

  // Re-emit by material: the ground's own materials in their order, then
  // the paint's in the order they first appear.
  const byMat = new Map<string, { pos: number[]; nrm: number[] }>();
  for (const p of input.ground)
    if (!byMat.has(p.material)) byMat.set(p.material, { pos: [], nrm: [] });
  const painted: Record<PaintLabel, number> = { plaza: 0, spoke: 0, yard: 0 };
  mesh.tris.forEach((t, i) => {
    const m = materialOf(i);
    let dst = byMat.get(m);
    if (!dst) byMat.set(m, (dst = { pos: [], nrm: [] }));
    const P = pos[t.prim];
    dst.pos.push(...P.subarray(t.at, t.at + 9));
    const src = input.ground[t.prim];
    const same = !moved.has(t.prim) || [1, 4, 7].every((k) => src.pos[t.at + k] === P[t.at + k]);
    const n = same
      ? [...src.nrm.subarray(t.at, t.at + 3)]
      : faceNormal(P.subarray(t.at, t.at + 9), 0);
    for (let k = 0; k < 3; k++) dst.nrm.push(...n);
    const label = input.bare?.has(i) ? undefined : labels.get(i);
    if (label) painted[label]++;
  });
  const ground: Prim[] = [];
  for (const [material, { pos: p, nrm }] of byMat)
    if (p.length) ground.push({ material, pos: new Float32Array(p), nrm: new Float32Array(nrm) });
  const kept = input.bare ? new Map([...labels].filter(([t]) => !input.bare!.has(t))) : labels;
  return { ground, painted, regions: input.plan.regions, labels: kept, mesh };
}

/** The planned triangles any of these plan points falls in. */
export function trisUnder(plan: PaintPlan, points: [number, number][]): Set<number> {
  const out = new Set<number>();
  const pos = new Map<number, number[]>();
  for (const t of plan.labels.keys()) {
    const tri = plan.mesh.tris[t];
    pos.set(t, [...plan.mesh.prims[tri.prim].pos.subarray(tri.at, tri.at + 9)]);
  }
  for (const [x, z] of points)
    for (const [t, P] of pos) {
      if (out.has(t)) continue;
      const d = (P[5] - P[8]) * (P[0] - P[6]) + (P[6] - P[3]) * (P[2] - P[8]);
      if (Math.abs(d) < 1e-12) continue;
      const w1 = ((P[5] - P[8]) * (x - P[6]) + (P[6] - P[3]) * (z - P[8])) / d;
      const w2 = ((P[8] - P[2]) * (x - P[6]) + (P[0] - P[6]) * (z - P[8])) / d;
      if (w1 >= -1e-6 && w2 >= -1e-6 && 1 - w1 - w2 >= -1e-6) out.add(t);
    }
  return out;
}

// ----------------------------------------------------------------- kerbs --

/** Kerb stones stand at least this far apart on the plaza's edge... */
export const KERB_GAP_PLAZA = 0.26;
/** ...and on a spoke's, where only this share of the candidates is kept. */
export const KERB_GAP_SPOKE = 0.5;
export const KERB_KEEP_SPOKE = 0.55;
/** A stone's half-size in plan (x, z) and its height, before its own jitter. */
export const KERB_SIZE: [number, number, number] = [0.042, 0.034, 0.03];
/** Its foot goes this far under the lowest ground beneath it. */
export const KERB_SINK = 0.02;
/** Clear of the chip's disc by this. */
export const KERB_CHIP = CHIP_KEEP + 0.1;

/**
 * Small low-poly stones along the plaza's and spokes' edges, one part each
 * (so each is its own body to every check), at the painted region's boundary
 * points in a fixed order, spaced, skipping points `blocked` marks as near a
 * building, prop, pool or deck. Ten triangles a stone: four sides and a top,
 * the top slightly smaller and askew.
 */
export function kerbStones(
  paint: PaintResult,
  ground: HeightField,
  blocked: (x: number, z: number) => boolean,
  salt: number,
  name: (i: number) => string,
): Part[] {
  const { mesh, labels } = paint;
  const cand: { k: string; x: number; z: number; plaza: boolean }[] = [];
  for (const [k, ts] of mesh.vtris) {
    const kinds = new Set(ts.map((t) => labels.get(t)));
    if (!kinds.has("plaza") && !kinds.has("spoke")) continue;
    if (!kinds.has(undefined)) continue;
    const [x, z] = mesh.verts.get(k)!;
    cand.push({ k, x, z, plaza: kinds.has("plaza") });
  }
  cand.sort((a, b) => Math.round(a.x * 100) - Math.round(b.x * 100) || a.z - b.z);
  const used: [number, number][] = [];
  const out: Part[] = [];
  for (const c of cand) {
    if (chipDist(c.x, c.z) < KERB_CHIP) continue;
    if (hexApothem(c.x, c.z) > HERO_APOTHEM) continue;
    if (blocked(c.x, c.z)) continue;
    const gap = c.plaza ? KERB_GAP_PLAZA : KERB_GAP_SPOKE;
    if (used.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < gap)) continue;
    const r = (n: number) => hash01(c.x + n * 0.37, c.z - n * 0.61, salt);
    if (!c.plaza && r(0) > KERB_KEEP_SPOKE) continue;
    const stone = kerbStone(c.x, c.z, ground, r);
    if (!stone) continue;
    used.push([c.x, c.z]);
    out.push({ name: name(out.length), prims: stone });
  }
  return out;
}

function kerbStone(x: number, z: number, G: HeightField, r: (n: number) => number): Prim[] | null {
  const j = (n: number, lo: number, hi: number) => lo + (hi - lo) * r(n);
  const sx = KERB_SIZE[0] * j(1, 0.8, 1.25),
    sz = KERB_SIZE[1] * j(2, 0.8, 1.25),
    h = KERB_SIZE[2] * j(3, 0.8, 1.25);
  const yaw = j(4, 0, Math.PI),
    c = Math.cos(yaw),
    s = Math.sin(yaw);
  const at = (lx: number, lz: number): [number, number] => [
    x + lx * c - lz * s,
    z + lx * s + lz * c,
  ];
  const corners: [number, number][] = [
    [-sx, -sz],
    [sx, -sz],
    [sx, sz],
    [-sx, sz],
  ];
  let lo = Infinity;
  for (const [lx, lz] of corners) {
    const [px, pz] = at(lx, lz);
    const g = G.sample(px, pz);
    if (!g) return null;
    lo = Math.min(lo, g.y);
  }
  const mid = G.sample(x, z);
  if (!mid) return null;
  const foot = lo - KERB_SINK;
  const base = corners.map(([lx, lz]) => {
    const [px, pz] = at(lx, lz);
    return [px, foot, pz];
  });
  const top = corners.map(([lx, lz], i) => {
    const [px, pz] = at(lx * j(5 + i, 0.7, 0.9), lz * j(9 + i, 0.7, 0.9));
    return [px, mid.y + h + j(13 + i, -0.012, 0.012), pz];
  });
  const faces: number[][][] = [];
  for (let i = 0; i < 4; i++) {
    const a = base[i],
      b = base[(i + 1) % 4],
      cc = top[(i + 1) % 4],
      d = top[i];
    faces.push([a, b, cc], [a, cc, d]);
  }
  faces.push([top[0], top[1], top[2]], [top[0], top[2], top[3]]);
  // Wound outward: flip any face whose normal points into the stone.
  const cy = (foot + mid.y + h) / 2;
  const light: number[] = [],
    dark: number[] = [];
  const nl: number[] = [],
    nd: number[] = [];
  faces.forEach((f, i) => {
    const P = new Float32Array(f.flat());
    let n = faceNormal(P, 0);
    const fx = (f[0][0] + f[1][0] + f[2][0]) / 3 - x,
      fy = (f[0][1] + f[1][1] + f[2][1]) / 3 - cy,
      fz = (f[0][2] + f[1][2] + f[2][2]) / 3 - z;
    if (n[0] * fx + n[1] * fy + n[2] * fz < 0) {
      f = [f[0], f[2], f[1]];
      n = [-n[0], -n[1], -n[2]];
    }
    // Two tones, by face pair (a side is one quad, one tone).
    const lightFace = r(17 + (i >> 1)) < 0.4;
    (lightFace ? light : dark).push(...f.flat());
    for (let k = 0; k < 3; k++) (lightFace ? nl : nd).push(...n);
  });
  const prims: Prim[] = [];
  if (dark.length)
    prims.push({ material: PLAZA_STONE, pos: new Float32Array(dark), nrm: new Float32Array(nd) });
  if (light.length)
    prims.push({
      material: PLAZA_STONE_LT,
      pos: new Float32Array(light),
      nrm: new Float32Array(nl),
    });
  return prims;
}
