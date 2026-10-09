// The three fields composition is built on: a height field over a ground
// sheet, a keep-out distance field from a footprint, and the loose parts a
// prop mesh falls apart into.
import { boxOfPrims, boxesOverlapXZ, emptyBox, type Box, type Prim } from "./model.ts";

// ------------------------------------------------------------ height field --

interface Tri {
  a: number; // index into `pts` of the first vertex's x
  material: string;
}

/**
 * Barycentric sampler over a set of ground triangles: (x, z) -> the highest
 * ground surface there, and which material draws it.
 *
 * Vertical faces are skipped (they cover no area in plan), and where two
 * surfaces overlap the higher one wins, which is what "the ground under a
 * point" means for a sheet with a cutbank in it.
 */
export class HeightField {
  private static readonly CELL = 0.25;
  private readonly pts: number[] = [];
  private readonly tris: Tri[] = [];
  private readonly grid = new Map<string, number[]>();

  /**
   * `lowest` samples the LOWEST surface where several overlap instead: the
   * underside of a body (a pool's bowl under its water), which is what the
   * audit asks "does this float" of.
   */
  private readonly lowest: boolean;

  constructor(prims: Prim[], lowest = false) {
    this.lowest = lowest;
    for (const p of prims) {
      for (let i = 0; i < p.pos.length; i += 9) {
        const a = this.pts.length;
        for (let k = 0; k < 9; k++) this.pts.push(p.pos[i + k]);
        const idx = this.tris.push({ a, material: p.material }) - 1;
        const xs = [p.pos[i], p.pos[i + 3], p.pos[i + 6]];
        const zs = [p.pos[i + 2], p.pos[i + 5], p.pos[i + 8]];
        const C = HeightField.CELL;
        const x0 = Math.floor(Math.min(...xs) / C),
          x1 = Math.floor(Math.max(...xs) / C);
        const z0 = Math.floor(Math.min(...zs) / C),
          z1 = Math.floor(Math.max(...zs) / C);
        for (let gx = x0; gx <= x1; gx++) {
          for (let gz = z0; gz <= z1; gz++) {
            const key = `${gx},${gz}`;
            const list = this.grid.get(key);
            if (list) list.push(idx);
            else this.grid.set(key, [idx]);
          }
        }
      }
    }
  }

  sample(x: number, z: number): { y: number; material: string } | null {
    const C = HeightField.CELL;
    const list = this.grid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`);
    if (!list) return null;
    let best: { y: number; material: string } | null = null;
    const P = this.pts;
    for (const i of list) {
      const { a, material } = this.tris[i];
      const ax = P[a],
        ay = P[a + 1],
        az = P[a + 2];
      const bx = P[a + 3],
        by = P[a + 4],
        bz = P[a + 5];
      const cx = P[a + 6],
        cy = P[a + 7],
        cz = P[a + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
      const y = w1 * ay + w2 * by + w3 * cy;
      if (!best || (this.lowest ? y < best.y : y > best.y)) best = { y, material };
    }
    return best;
  }

  y(x: number, z: number, fallback: number): number {
    return this.sample(x, z)?.y ?? fallback;
  }
}

// --------------------------------------------------------- keep-out field --

/** Raster resolution and half-extent: 256 cells over [-3.2, 3.2], 2.5 cm each. */
export const MASK_N = 256;
export const MASK_EXTENT = 3.2;
const CELL = (2 * MASK_EXTENT) / MASK_N;

/**
 * The plan footprint of some geometry, and the distance from every cell to
 * the nearest covered cell ("how far is this point from the town").
 *
 * A two-pass 3-4 chamfer transform, within about 4% of the Euclidean distance
 * and exact at 0 (on the footprint), which is what the drop rule tests.
 */
export class KeepOut {
  readonly occ = new Uint8Array(MASK_N * MASK_N);
  readonly dist = new Float32Array(MASK_N * MASK_N);
  private finished = false;

  add(prims: Prim[]): this {
    for (const p of prims) {
      const a = p.pos;
      for (let i = 0; i < a.length; i += 9) {
        const ax = a[i],
          az = a[i + 2],
          bx = a[i + 3],
          bz = a[i + 5],
          cx = a[i + 6],
          cz = a[i + 8];
        this.set(ax, az);
        this.set(bx, bz);
        this.set(cx, cz);
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) {
          // A wall seen from above is a line: stamp its edges.
          for (let s = 0; s <= 1.0001; s += 0.1) {
            this.set(ax + (bx - ax) * s, az + (bz - az) * s);
            this.set(bx + (cx - bx) * s, bz + (cz - bz) * s);
            this.set(cx + (ax - cx) * s, cz + (az - cz) * s);
          }
          continue;
        }
        const i0 = this.ix(Math.min(ax, bx, cx)),
          i1 = this.ix(Math.max(ax, bx, cx));
        const j0 = this.ix(Math.min(az, bz, cz)),
          j1 = this.ix(Math.max(az, bz, cz));
        for (let ii = i0; ii <= i1; ii++) {
          for (let jj = j0; jj <= j1; jj++) {
            const x = -MASK_EXTENT + (ii + 0.5) * CELL,
              z = -MASK_EXTENT + (jj + 0.5) * CELL;
            const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
            const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
            if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) this.occ[jj * MASK_N + ii] = 1;
          }
        }
      }
    }
    this.finished = false;
    return this;
  }

  private ix(v: number): number {
    return Math.max(0, Math.min(MASK_N - 1, Math.floor((v + MASK_EXTENT) / CELL)));
  }

  private set(x: number, z: number): void {
    this.occ[this.ix(z) * MASK_N + this.ix(x)] = 1;
  }

  /**
   * The distance field. With `value`, also carries the value at the nearest
   * covered cell through the same passes, extending a height known only on
   * the footprint (a town's bed) outward for a feather to blend toward.
   */
  finish(value?: (x: number, z: number) => number | null): this {
    const N = MASK_N;
    const INF = 1e9;
    const d = new Float64Array(N * N).fill(INF);
    const val = value ? new Float64Array(N * N).fill(NaN) : null;
    for (let k = 0; k < N * N; k++) {
      if (!this.occ[k]) continue;
      d[k] = 0;
      if (val && value) {
        const i = k % N,
          j = (k - i) / N;
        const v = value(-MASK_EXTENT + (i + 0.5) * CELL, -MASK_EXTENT + (j + 0.5) * CELL);
        val[k] = v ?? NaN;
      }
    }
    const relax = (k: number, from: number, w: number) => {
      if (d[from] + w < d[k]) {
        d[k] = d[from] + w;
        if (val) val[k] = val[from];
      }
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (i > 0) relax(k, k - 1, 3);
        if (j > 0) {
          relax(k, k - N, 3);
          if (i > 0) relax(k, k - N - 1, 4);
          if (i < N - 1) relax(k, k - N + 1, 4);
        }
      }
    }
    for (let j = N - 1; j >= 0; j--) {
      for (let i = N - 1; i >= 0; i--) {
        const k = j * N + i;
        if (i < N - 1) relax(k, k + 1, 3);
        if (j < N - 1) {
          relax(k, k + N, 3);
          if (i < N - 1) relax(k, k + N + 1, 4);
          if (i > 0) relax(k, k + N - 1, 4);
        }
      }
    }
    for (let k = 0; k < N * N; k++) this.dist[k] = d[k] >= INF ? 1e3 : (d[k] / 3) * CELL;
    this.nearest = val;
    this.finished = true;
    return this;
  }

  private nearest: Float64Array | null = null;

  /** The value `finish` carried out from the nearest covered cell, or null. */
  nearestValue(x: number, z: number): number | null {
    if (!this.finished) this.finish();
    const v = this.nearest?.[this.ix(z) * MASK_N + this.ix(x)];
    return v === undefined || Number.isNaN(v) ? null : v;
  }

  /**
   * The complement: covered where this is not. Its distance field is how far
   * inside this footprint a point is (0 outside).
   */
  inverted(): KeepOut {
    const k = new KeepOut();
    for (let i = 0; i < this.occ.length; i++) k.occ[i] = this.occ[i] ? 0 : 1;
    return k.finish();
  }

  /** Is the cell under (x, z) covered? */
  covers(x: number, z: number): boolean {
    return this.occ[this.ix(z) * MASK_N + this.ix(x)] === 1;
  }

  /** Distance from (x, z) to the footprint, in metres. 0 on it. */
  at(x: number, z: number): number {
    if (!this.finished) this.finish();
    return this.dist[this.ix(z) * MASK_N + this.ix(x)];
  }
}

// ----------------------------------------------------------------- the hex --

/** Art apothem of a land tile (circumradius 3), and the rim's inner edge. */
export const TILE_APOTHEM = (3 * Math.sqrt(3)) / 2;

/**
 * Where the drawn border starts: the rim's inner edge, the art apothem less
 * the tile's half of the 0.25 gutter. Mirrors `hexcontract.BORDER_APOTHEM`
 * (2.4731); `make check-hexes` and `audit.ts`'s `border` defect enforce it.
 * Roads, settlements and paths use the band outside, so nothing composed may
 * cross it: `keepInside` (place.ts) walks a body back.
 */
export const BORDER_APOTHEM = TILE_APOTHEM - 0.25 / 2;

/**
 * How far out (x, z) is in the hexagon's own metric: the apothem of the
 * smallest concentric pointy-top hexagon containing it. Mirrors
 * `hexcontract.apothem` (the file frame's xz is the blend's x, -y, and the
 * metric is symmetric under that flip).
 */
export function hexApothem(x: number, z: number): number {
  let m = -Infinity;
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    m = Math.max(m, x * Math.cos(a) + z * Math.sin(a));
  }
  return m;
}

// ------------------------------------------------------------- loose parts --

/** One triangle of a part: which prim, and where in its arrays it starts. */
export interface TriRef {
  prim: Prim;
  start: number; // float offset of the triangle's first vertex
}

/**
 * A loose part of one prop mesh: a sheep, a house and its roof, one tree.
 * `id` is `<node>@<x>,<z>`, the node name and the part's authored centre to a
 * tenth, which is what a recipe names it by.
 */
export interface Cluster {
  node: string;
  id: string;
  tris: TriRef[];
  box: Box;
}

export function clusterCentre(c: Cluster): [number, number] {
  return [(c.box[0] + c.box[3]) / 2, (c.box[2] + c.box[5]) / 2];
}

function boxOfTris(tris: TriRef[]): Box {
  const b = emptyBox();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const i = t.start + k * 3;
      const x = t.prim.pos[i],
        y = t.prim.pos[i + 1],
        z = t.prim.pos[i + 2];
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (z < b[2]) b[2] = z;
      if (x > b[3]) b[3] = x;
      if (y > b[4]) b[4] = y;
      if (z > b[5]) b[5] = z;
    }
  }
  return b;
}

function union(a: Box, b: Box): Box {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[3], b[3]),
    Math.max(a[4], b[4]),
    Math.max(a[5], b[5]),
  ];
}

function boxesTouch(a: Box, b: Box, pad: number): boolean {
  return boxesOverlapXZ(a, b, pad) && a[1] - pad <= b[4] && a[4] + pad >= b[1];
}

/**
 * Split one node's prims into loose parts (triangles welded by position), then
 * merge parts whose boxes touch (a sheep's legs, a roof on its walls) until
 * nothing more merges. Deterministic: parts come out ordered by their first
 * triangle, and ids are unique (a clash gets `#2`, `#3`).
 */
export function clustersOf(node: string, prims: Prim[], mergeTouching = true): Cluster[] {
  const tris: TriRef[] = [];
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 9) tris.push({ prim: p, start: i });
  const parent = tris.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const owner = new Map<string, number>();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const i = t.start + k * 3;
      const key = `${t.prim.pos[i].toFixed(4)},${t.prim.pos[i + 1].toFixed(4)},${t.prim.pos[i + 2].toFixed(4)}`;
      const o = owner.get(key);
      if (o === undefined) owner.set(key, ti);
      else {
        const a = find(ti),
          b = find(o);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  const groups = new Map<number, TriRef[]>();
  tris.forEach((t, ti) => {
    const r = find(ti);
    const g = groups.get(r);
    if (g) g.push(t);
    else groups.set(r, [t]);
  });
  let parts = [...groups.values()].map((g) => ({ tris: g, box: boxOfTris(g) }));
  let merged = mergeTouching;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (boxesTouch(parts[i].box, parts[j].box, 0.012)) {
          parts[i] = {
            tris: [...parts[i].tris, ...parts[j].tris],
            box: union(parts[i].box, parts[j].box),
          };
          parts = parts.filter((_, k) => k !== j);
          merged = true;
          break outer;
        }
      }
    }
  }
  const seen = new Map<string, number>();
  return parts.map((p) => {
    const cx = (p.box[0] + p.box[3]) / 2,
      cz = (p.box[2] + p.box[5]) / 2;
    let id = `${node}@${cx.toFixed(1)},${cz.toFixed(1)}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}#${n}`;
    return { node, id, tris: p.tris, box: p.box };
  });
}

/** Every vertex (x, z) of a cluster, shifted. */
export function* clusterPlan(c: Cluster, dx = 0, dz = 0): Generator<[number, number, number]> {
  for (const t of c.tris) {
    for (let k = 0; k < 3; k++) {
      const i = t.start + k * 3;
      yield [t.prim.pos[i] + dx, t.prim.pos[i + 1], t.prim.pos[i + 2] + dz];
    }
  }
}

export { boxOfPrims };

// ---------------------------------------------------------------- hulls --

/** Plan convex hull (Andrew's monotone chain), counter-clockwise. */
export function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [],
    hi: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** How far (x, z) is inside a CCW convex polygon: negative outside. */
export function insideDepth(poly: [number, number][], x: number, z: number): number {
  if (poly.length < 3) return -Infinity;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i],
      [bx, bz] = poly[(i + 1) % poly.length];
    const ex = bx - ax,
      ez = bz - az;
    const l = Math.hypot(ex, ez) || 1;
    // Left of a CCW edge is inside.
    d = Math.min(d, (ex * (z - az) - ez * (x - ax)) / l);
  }
  return d;
}
