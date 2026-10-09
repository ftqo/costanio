// Where a base prop ends up: left alone, re-seated, or moved to an authored
// hero spot. One affine form covers all three, so every prop is emitted by one
// function and nothing drifts between them.
import { BORDER_APOTHEM, HeightField, clusterCentre, type Cluster, type TriRef } from "./fields.ts";
import type { Box, Prim } from "./model.ts";

/**
 * p' = spot + Rz(yaw) . scale . (p - anchor) in plan, and
 * y' = yNew + scale . (y - yOld) in height.
 *
 * Plain re-seating is anchor = spot = 0, yaw 0, scale 1, yOld 0, yNew = dy.
 * `yaw` is degrees about +y, three.js's sense, which is also CCW about the
 * blend's +z (the trade-parts contract).
 */
export interface Place {
  c: Cluster;
  /**
   * How height is set. `rigid` (the default) is the affine form above.
   * `fixed` keeps every authored height (a boat on water whose level the
   * ground does not move). `drape` lays each vertex back on the composed
   * ground by its authored lift over the base ground (a flat pool).
   */
  mode?: "rigid" | "fixed" | "drape" | "follow";
  /**
   * `follow` only: how much of its authored height over the base ground a
   * vertex keeps (1 unless a town is melting it down, as a dune runs out under
   * the paving), so a long low thing (a crop row, a hedge, a dune) lies on the
   * new ground as it lay on the old.
   */
  melt?: (x: number, z: number) => number;
  grounds?: { Gb: HeightField; Gn: HeightField };
  ax: number;
  az: number;
  sx: number;
  sz: number;
  yaw: number;
  scale: number;
  yOld: number;
  yNew: number;
}

/** A fully melted vertex sits this far under the new ground, so it cannot z-fight with it. */
export const MELT_SINK = 0.05;

export function stay(c: Cluster, dy = 0): Place {
  return { c, ax: 0, az: 0, sx: 0, sz: 0, yaw: 0, scale: 1, yOld: 0, yNew: dy };
}

/** The placed height of a vertex authored at (x, y, z), landing at (px, pz). */
export function placeY(p: Place, x: number, y: number, z: number, px: number, pz: number): number {
  if (p.mode === "fixed") return y;
  if (p.mode === "follow" && p.grounds) {
    const b = p.grounds.Gb.sample(x, z),
      n = p.grounds.Gn.sample(px, pz);
    if (b && n) {
      const m = p.melt ? p.melt(px, pz) : 1;
      return n.y + (y - b.y) * m - MELT_SINK * (1 - m);
    }
  }
  if (p.mode === "drape" && p.grounds) {
    const b = p.grounds.Gb.sample(x, z),
      n = p.grounds.Gn.sample(px, pz);
    if (b && n) return n.y + (y - b.y);
  }
  return p.yNew + p.scale * (y - p.yOld);
}

export function planPoint(p: Place, x: number, z: number): [number, number] {
  const a = (p.yaw * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const rx = (x - p.ax) * p.scale,
    rz = (z - p.az) * p.scale;
  return [p.sx + rx * c + rz * s, p.sz - rx * s + rz * c];
}

export function placedBox(p: Place): Box {
  const b: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const t of p.c.tris) {
    for (let k = 0; k < 3; k++) {
      const i = t.start + k * 3;
      const [x, z] = planPoint(p, t.prim.pos[i], t.prim.pos[i + 2]);
      const y = placeY(p, t.prim.pos[i], t.prim.pos[i + 1], t.prim.pos[i + 2], x, z);
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

/** Every placed vertex, for checks. */
export function* placedPoints(p: Place): Generator<[number, number, number]> {
  for (const t of p.c.tris) {
    for (let k = 0; k < 3; k++) {
      const i = t.start + k * 3;
      const [x, z] = planPoint(p, t.prim.pos[i], t.prim.pos[i + 2]);
      yield [x, placeY(p, t.prim.pos[i], t.prim.pos[i + 1], t.prim.pos[i + 2], x, z), z];
    }
  }
}

/**
 * The smallest change of ground under any vertex of a part that stays in
 * plan, so a kept prop never floats: every vertex rises or sinks by the same
 * amount, the least the ground moved anywhere under it.
 */
export function minLift(c: Cluster, Gn: HeightField, Gb: HeightField): number {
  let dy = Infinity;
  for (const t of c.tris) {
    for (let k = 0; k < 3; k++) {
      const i = t.start + k * 3;
      const x = t.prim.pos[i],
        z = t.prim.pos[i + 2];
      const n = Gn.sample(x, z),
        o = Gb.sample(x, z);
      if (n && o) dy = Math.min(dy, n.y - o.y);
    }
  }
  return Number.isFinite(dy) ? dy : 0;
}

/** The lowest ground on a ring of radius r round (x, z), and at its centre. */
export function ringMin(G: HeightField, x: number, z: number, r: number, fallback: number): number {
  let m = Infinity;
  const pts: [number, number][] = [[x, z]];
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    pts.push([x + r * Math.cos(a), z + r * Math.sin(a)]);
  }
  for (const [px, pz] of pts) {
    const s = G.sample(px, pz);
    if (s) m = Math.min(m, s.y);
  }
  return Number.isFinite(m) ? m : fallback;
}

/** A hero body moved to a spot and re-seated rigidly on the new ground. */
export function heroPlace(
  c: Cluster,
  anchor: [number, number],
  spot: [number, number],
  yaw: number,
  scale: number,
  footprint: number,
  Gb: HeightField,
  Gn: HeightField,
): Place {
  const yOld = ringMin(Gb, anchor[0], anchor[1], footprint, c.box[1]);
  const yNew = ringMin(Gn, spot[0], spot[1], footprint * scale, yOld);
  return { c, ax: anchor[0], az: anchor[1], sx: spot[0], sz: spot[1], yaw, scale, yOld, yNew };
}

/**
 * Put placements of a body of water onto a triangle lattice.
 *
 * A ground feature is made of the ground's own triangles (see
 * tools/blender/featurelattice.py), so a pool authored on the base lattice
 * stays whole lattice triangles only if it lands on the lattice again. The
 * turn is rounded to a multiple of 60 degrees, the scale to 1, and the spot
 * moved (by at most half a cell) so the pool's first vertex lands on the
 * nearest lattice point; every other vertex then does too. All places move
 * together, as one body.
 */
export function latticeSnap(points: [number, number][]): (places: Place[]) => Place[] {
  const key = (x: number, z: number) => `${Math.round(x * 500)},${Math.round(z * 500)}`;
  const on = new Set<string>();
  for (const [x, z] of points)
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) on.add(key(x + dx / 500, z + dz / 500));
  // Only a pool that is on the lattice where it was authored is held to it;
  // a hand-drawn test pool moves exactly as its spot says.
  const onLattice = (c: Cluster) => {
    let n = 0,
      hit = 0;
    for (const t of c.tris) {
      if (!/water|pool/i.test(t.prim.material)) continue;
      for (let k = 0; k < 3; k++) {
        n++;
        if (on.has(key(t.prim.pos[t.start + k * 3], t.prim.pos[t.start + k * 3 + 2]))) hit++;
      }
    }
    return n > 0 && hit >= 0.95 * n;
  };
  return (places) => {
    if (!places.every((p) => onLattice(p.c))) return places;
    const turned = places.map((p) => ({
      ...p,
      c: p.scale < 0.999 ? shrunk(p.c, p.ax, p.az, p.scale) : p.c,
      yaw: Math.round(p.yaw / 60) * 60,
      scale: 1,
    }));
    const first = turned[0];
    const t = first.c.tris.find((u) => /water|pool/i.test(u.prim.material)) ?? first.c.tris[0];
    const [x, z] = planPoint(first, t.prim.pos[t.start], t.prim.pos[t.start + 2]);
    let best = Infinity,
      qx = x,
      qz = z;
    for (const [px, pz] of points) {
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) {
        best = d;
        qx = px;
        qz = pz;
      }
    }
    return turned.map((p) => ({ ...p, sx: p.sx + qx - x, sz: p.sz + qz - z }));
  };
}

/**
 * A lattice pool at a smaller scale: the water triangles whose centroid,
 * scaled back up about the anchor, still lies on the water. Same shape, fewer
 * triangles, none resized off the lattice. Lips are kept only along the new
 * edge.
 */
function shrunk(c: Cluster, ax: number, az: number, scale: number): Cluster {
  const isWater = (t: TriRef) => /water|pool/i.test(t.prim.material);
  const water = c.tris.filter(isWater);
  const inside = (x: number, z: number) =>
    water.some((t) => {
      const P = t.prim.pos,
        i = t.start;
      const d =
        (P[i + 5] - P[i + 8]) * (P[i] - P[i + 6]) + (P[i + 6] - P[i + 3]) * (P[i + 2] - P[i + 8]);
      if (Math.abs(d) < 1e-12) return false;
      const l1 =
        ((P[i + 5] - P[i + 8]) * (x - P[i + 6]) + (P[i + 6] - P[i + 3]) * (z - P[i + 8])) / d;
      const l2 = ((P[i + 8] - P[i + 2]) * (x - P[i + 6]) + (P[i] - P[i + 6]) * (z - P[i + 8])) / d;
      return l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6;
    });
  const keep = water.filter((t) => {
    const P = t.prim.pos,
      i = t.start;
    const cx = (P[i] + P[i + 3] + P[i + 6]) / 3,
      cz = (P[i + 2] + P[i + 5] + P[i + 8]) / 3;
    return inside(ax + (cx - ax) / scale, az + (cz - az) / scale);
  });
  if (keep.length === 0) return c;
  const k = (x: number, z: number) => `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`;
  const edges = new Map<string, number>();
  for (const t of keep) {
    const P = t.prim.pos,
      i = t.start;
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const ka = k(P[i + a * 3], P[i + a * 3 + 2]),
        kb = k(P[i + b * 3], P[i + b * 3 + 2]);
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  const lips = c.tris.filter((t) => {
    if (isWater(t)) return false;
    // A lip triangle is kept when two of its corners are an edge of the kept water.
    const P = t.prim.pos,
      i = t.start;
    const ks = [0, 1, 2].map((j) => k(P[i + j * 3], P[i + j * 3 + 2]));
    return [0, 1, 2].some((j) => {
      const a = ks[j],
        b = ks[(j + 1) % 3];
      return a !== b && edges.get(a < b ? `${a}|${b}` : `${b}|${a}`) === 1;
    });
  });
  const tris = [...keep, ...lips];
  const box: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const t of tris)
    for (let j = 0; j < 3; j++) {
      const i = t.start + j * 3;
      for (let a = 0; a < 3; a++) {
        box[a] = Math.min(box[a], t.prim.pos[i + a]);
        box[a + 3] = Math.max(box[a + 3], t.prim.pos[i + a]);
      }
    }
  return { ...c, tris, box };
}

/** Every distinct plan point of some prims (a ground's lattice vertices). */
export function latticePoints(prims: Prim[]): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const p of prims) {
    for (let i = 0; i < p.pos.length; i += 3) {
      const k = `${Math.round(p.pos[i] * 1e4)},${Math.round(p.pos[i + 2] * 1e4)}`;
      if (!seen.has(k)) seen.set(k, [p.pos[i], p.pos[i + 2]]);
    }
  }
  return [...seen.values()];
}

/** Rebuild prims, one per material, from placed parts. */
export function emitPlaces(places: Place[]): Prim[] {
  const byMat = new Map<string, { pos: number[]; nrm: number[] }>();
  for (const p of places) {
    const a = (p.yaw * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    for (const t of p.c.tris) {
      let e = byMat.get(t.prim.material);
      if (!e) byMat.set(t.prim.material, (e = { pos: [], nrm: [] }));
      for (let k = 0; k < 3; k++) {
        const i = t.start + k * 3;
        const [x, z] = planPoint(p, t.prim.pos[i], t.prim.pos[i + 2]);
        e.pos.push(x, placeY(p, t.prim.pos[i], t.prim.pos[i + 1], t.prim.pos[i + 2], x, z), z);
        const nx = t.prim.nrm[i],
          nz = t.prim.nrm[i + 2];
        e.nrm.push(nx * c + nz * s, t.prim.nrm[i + 1], -nx * s + nz * c);
      }
    }
  }
  return [...byMat].map(([material, e]) => ({
    material,
    pos: new Float32Array(e.pos),
    nrm: new Float32Array(e.nrm),
  }));
}

export { clusterCentre };

/**
 * Seat a rigid place (one loose part) on the composed support with one lift,
 * so its foot keeps the clearance it had on the base: the least-buried of its
 * lowest vertices ends as far over (or, for a stilt hut, under) the new
 * support as it was over the old. On a slope that is the contract's "min
 * ground over the footprint", measured on the body itself: its downhill corner
 * meets the ground, nothing hovers, and it sinks no deeper than authored.
 *
 * `Sb` is what the base part stood on (its ground, and the water a punt or a
 * stilt hut stood in); `S` is what it stands on now.
 */
export function seatOne(p: Place, S: HeightField, Sb: HeightField): void {
  let minY = Infinity;
  for (const t of p.c.tris)
    for (let k = 0; k < 3; k++) minY = Math.min(minY, t.prim.pos[t.start + k * 3 + 1]);
  let authored = -Infinity,
    placed = -Infinity,
    allAuthored = Infinity,
    allPlaced = Infinity;
  for (const t of p.c.tris) {
    for (let k = 0; k < 3; k++) {
      const i = t.start + k * 3;
      const x = t.prim.pos[i],
        y = t.prim.pos[i + 1],
        z = t.prim.pos[i + 2];
      const b = Sb.sample(x, z);
      const [px, pz] = planPoint(p, x, z);
      const s = S.sample(px, pz);
      if (b) allAuthored = Math.min(allAuthored, y - b.y);
      if (s) allPlaced = Math.min(allPlaced, p.scale * y - s.y);
      if (y > minY + FOOT_BAND) continue;
      if (b) authored = Math.max(authored, y - b.y);
      if (s) placed = Math.max(placed, p.scale * y - s.y);
    }
  }
  if (!Number.isFinite(placed)) return;
  const o = Number.isFinite(authored) ? authored : 0;
  p.yOld = 0;
  p.yNew = p.scale * o - placed;
  // And never clear of the ground by more than the base part was anywhere
  // (a blade authored standing a little proud of a bank stays no prouder).
  if (Number.isFinite(allAuthored) && Number.isFinite(allPlaced))
    p.yNew = Math.min(p.yNew, p.scale * Math.max(allAuthored, 0) - allPlaced);
}

/** A body walked off the border ends this far inside it, so it does not sit on the line. */
export const BORDER_CLEAR = 0.01;

/**
 * The border keep-out. Move a group of places (one body: a house and its
 * roof, a tree and its canopy) inward by the smallest translation that brings
 * every placed vertex inside `BORDER_APOTHEM`, and return the distance moved.
 *
 * Measured in the hexagon's metric, per edge: each edge crossed pushes the
 * body back along its inward normal by the overshoot plus `BORDER_CLEAR`, and
 * a body over a corner takes both. Moves in plan only, before seating. A body
 * already inside (every body on every current tile) is untouched; this guards
 * against a new spot, prop or layout hanging over a road.
 */
export function keepInside(places: Place[]): number {
  let tx = 0,
    tz = 0;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let k = 0; k < 6; k++) {
      const c = Math.cos((Math.PI / 3) * k),
        s = Math.sin((Math.PI / 3) * k);
      let far = -Infinity;
      for (const p of places)
        for (const t of p.c.tris)
          for (let v = 0; v < 3; v++) {
            const i = t.start + v * 3;
            const [x, z] = planPoint(p, t.prim.pos[i], t.prim.pos[i + 2]);
            far = Math.max(far, (x + tx) * c + (z + tz) * s);
          }
      const limit = pass === 0 ? BORDER_APOTHEM + 1e-4 : BORDER_APOTHEM - BORDER_CLEAR + 1e-6;
      if (far > limit) {
        const over = far - (BORDER_APOTHEM - BORDER_CLEAR);
        tx -= over * c;
        tz -= over * s;
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (tx === 0 && tz === 0) return 0;
  for (const p of places) {
    p.sx += tx;
    p.sz += tz;
  }
  return Math.hypot(tx, tz);
}

/** A body's foot: its vertices this close to its lowest. */
export const FOOT_BAND = 0.02;

/** Seat every place of a group, each on its own foot. */
export function seatGroup(places: Place[], S: HeightField, Sb: HeightField): void {
  for (const p of places) seatOne(p, S, Sb);
}

/** A long, low body (a crop row, a hedge, a wall, a dune) lies on the ground rather than standing on it. */
export function isLongLow(c: Cluster): boolean {
  const ext = Math.max(c.box[3] - c.box[0], c.box[5] - c.box[2]);
  return ext > LONG_LOW_EXTENT && c.box[4] - c.box[1] < LONG_LOW_HEIGHT;
}
export const LONG_LOW_EXTENT = 0.5;
export const LONG_LOW_HEIGHT = 0.35;
