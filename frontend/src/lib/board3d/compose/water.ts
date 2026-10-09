// Bodies of water: a swamp's pools, a pasture's pond. A pool is a flat water
// sheet with its bowl and a rim of moss, and it reads as a pool because the
// ground meets it: tucked up to the rim at the edge and down under the water
// inside. The hand-made tile shaped that ground for the pool's original spot.
//
// So a water body moves rigid (re-draping vertex by vertex would warp the
// level sheet), at a water level set from the ground it lands on, and its
// basin is carved into the composed ground there:
//
//   TUCK   round its outline, and on a one-cell shelf outside it, the ground
//          comes up to the rim so no edge stands clear of the bank; beyond the
//          shelf the bank falls back to the ground's own height.
//   UNDER  everywhere the sheet covers, edge included, the ground is at least
//          TUCK under the water line, so no shore vertex pokes through (a
//          level sheet over sloping ground is cut along a contour).
//   OPEN   more than a shore's width inside the water, the ground goes under
//          the water line, so the water shows.
//   FILL   where a pool left, the dip the hand-made ground had for it is
//          filled to the surrounding ground.
//
// A spot needing the ground moved more than MAX_CARVE (a steep slope) does not
// get the pool: it is dropped rather than left floating.
import { HeightField, KeepOut, type Cluster } from "./fields.ts";
import type { Prim } from "./model.ts";
import { smoothstep } from "./model.ts";
import { emitPlaces, stay, type Place } from "./place.ts";

/** Materials that are a water surface. A well's or a trough's water is too small to count. */
export const WATER_MATERIAL =
  /^Mat_(Swamp_pool|Pasture_water(_dk)?|Lake_water|Lake_shoal|River_water(_dk)?)$/;
/** A part is a body of water when its water covers at least this much plan area. */
export const WATER_BODY_AREA = 0.05;
/** A water body's rim stands at most this far over its water line (the swamp's moss ring: 4 mm). */
export const WATER_RIM = 0.02;

/** A part whose lowest point is this close to the water under it floats on it (a punt, a lily pad). */
export const FLOAT_TOL = 0.03;
/** The ground comes up to this under a water body's rim: hidden, and no gap. */
export const TUCK = 0.004;
/** The flat shelf outside the outline: wider than one ground cell (the grid's edges are ~0.21). */
export const SHELF = 0.26;
/** Beyond the shelf the bank falls back to the ground at this grade. */
export const BANK_GRADE = 0.5;
/** Water shows where the ground is this far under the water line... */
export const OPEN_DEPTH = 0.012;
/** ...more than this far inside the water's edge (the shore). */
export const SHORE = 0.05;
/** A spot that needs the ground moved more than this to hold a pool is too steep for it. */
export const MAX_CARVE = 0.12;
/** The dip a pool leaves is filled over its footprint, feathered over this. */
export const FILL_FEATHER = 0.2;

function planArea(pos: Float32Array, i: number): number {
  return (
    Math.abs(
      (pos[i + 3] - pos[i]) * (pos[i + 8] - pos[i + 2]) -
        (pos[i + 6] - pos[i]) * (pos[i + 5] - pos[i + 2]),
    ) / 2
  );
}

export function waterArea(prims: Prim[]): number {
  let a = 0;
  for (const p of prims) {
    if (!WATER_MATERIAL.test(p.material)) continue;
    for (let i = 0; i < p.pos.length; i += 9) a += planArea(p.pos, i);
  }
  return a;
}

/** Is this loose part a body of water (not a trough's or a well's)? */
export function isWaterBody(c: Cluster): boolean {
  let a = 0;
  for (const t of c.tris)
    if (WATER_MATERIAL.test(t.prim.material)) a += planArea(t.prim.pos, t.start);
  return a >= WATER_BODY_AREA;
}

/** The water line: the highest water vertex (a pool's sheet is flat). */
export function waterLevel(prims: Prim[]): number {
  let wl = -Infinity;
  for (const p of prims) {
    if (!WATER_MATERIAL.test(p.material)) continue;
    for (let i = 1; i < p.pos.length; i += 3) wl = Math.max(wl, p.pos[i]);
  }
  return wl;
}

/**
 * The triangles of a water body that lie at or under its water line: the
 * water, its bowl and its rim. A reed standing up out of it is a blade, not
 * a surface, and its underside is the air.
 */
export function bodyOfWater(prims: Prim[]): Prim[] {
  const wl = waterLevel(prims);
  return prims.map((p) => {
    const keep: number[] = [];
    for (let i = 0; i < p.pos.length; i += 9) {
      if (Math.max(p.pos[i + 1], p.pos[i + 4], p.pos[i + 7]) <= wl + WATER_RIM) {
        for (let k = 0; k < 9; k++) keep.push(p.pos[i + k]);
      }
    }
    return {
      material: p.material,
      pos: new Float32Array(keep),
      nrm: new Float32Array(keep.length),
    };
  });
}

/** The median of the ground under the water of some prims. */
export function medianUnderWater(prims: Prim[], G: HeightField): number | null {
  const ys: number[] = [];
  for (const p of prims) {
    if (!WATER_MATERIAL.test(p.material)) continue;
    for (let i = 0; i < p.pos.length; i += 9) {
      for (const [u, v] of [
        [1 / 3, 1 / 3],
        [0.1, 0.1],
        [0.8, 0.1],
        [0.1, 0.8],
      ]) {
        const w = 1 - u - v;
        const x = p.pos[i] * w + p.pos[i + 3] * u + p.pos[i + 6] * v,
          z = p.pos[i + 2] * w + p.pos[i + 5] * u + p.pos[i + 8] * v;
        const g = G.sample(x, z);
        if (g) ys.push(g.y);
      }
    }
  }
  if (!ys.length) return null;
  ys.sort((a, b) => a - b);
  return ys[ys.length >> 1];
}

/** One placed water body, ready to carve its basin. */
export interface Basin {
  wl: number;
  /** The lowest surface of its bowl, water and rim. */
  under: HeightField;
  /** Its plan footprint (bowl, water, rim), carrying the underside's height outward. */
  foot: KeepOut;
  /** Distance inside its water. */
  inWater: KeepOut;
  /** Whether a surface under the water line exists that is not water (a bowl). */
  bowl: boolean;
  /** Its water triangles in plan, [x0, z0, x1, z1, x2, z2] each, for exact tests. */
  sheet: number[][];
}

/** Is (x, z) on the sheet (its edge included, to a millimetre: a ground vertex and
 * the sheet corner snapped onto it can differ by a float's worth of a lattice). */
export function onSheet(b: Basin, x: number, z: number): boolean {
  const E = 1e-3;
  for (const [x0, z0, x1, z1, x2, z2] of b.sheet) {
    if (x < Math.min(x0, x1, x2) - E || x > Math.max(x0, x1, x2) + E) continue;
    if (z < Math.min(z0, z1, z2) - E || z > Math.max(z0, z1, z2) + E) continue;
    const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
    const l2 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
    const tol = E / Math.sqrt(Math.abs(d));
    if (l1 >= -tol && l2 >= -tol && 1 - l1 - l2 >= -tol) return true;
  }
  return false;
}

export function basinOf(prims: Prim[]): Basin {
  const body = bodyOfWater(prims);
  const under = new HeightField(body, true);
  const foot = new KeepOut().add(body).finish((x, z) => {
    // A cell stamped by an edge can have its centre just off every
    // triangle: look round it for the surface.
    for (const [dx, dz] of [
      [0, 0],
      [0.012, 0],
      [-0.012, 0],
      [0, 0.012],
      [0, -0.012],
      [0.012, 0.012],
      [-0.012, -0.012],
      [0.012, -0.012],
      [-0.012, 0.012],
    ]) {
      const s = under.sample(x + dx, z + dz);
      if (s) return s.y;
    }
    return null;
  });
  const water = new KeepOut().add(prims.filter((p) => WATER_MATERIAL.test(p.material)));
  return {
    wl: waterLevel(prims),
    under,
    foot,
    inWater: water.finish().inverted(),
    bowl: body.some((p) => !WATER_MATERIAL.test(p.material) && p.pos.length > 0),
    sheet: prims
      .filter((p) => WATER_MATERIAL.test(p.material))
      .flatMap((p) => {
        const out: number[][] = [];
        for (let i = 0; i < p.pos.length; i += 9)
          out.push([
            p.pos[i],
            p.pos[i + 2],
            p.pos[i + 3],
            p.pos[i + 5],
            p.pos[i + 6],
            p.pos[i + 8],
          ]);
        return out;
      }),
  };
}

/** The ground at (x, z), height y, with every basin carved into it. */
export function carve(basins: Basin[], x: number, z: number, y: number): number {
  for (const b of basins) {
    const d = b.foot.at(x, z);
    if (d > SHELF + 0.6) continue;
    const u = b.under.sample(x, z);
    // TUCK: under the rim and bowl, along the water's edge where the sheet runs
    // past its bowl, and on the shelf round it all, the ground comes up to just
    // under the body. Only well inside the water (OPEN, below) does it stay down.
    const rimY = u ? u.y : b.foot.nearestValue(x, z);
    const edge = !u || !WATER_MATERIAL.test(u.material) || b.inWater.at(x, z) <= SHORE;
    if (rimY !== null && edge) {
      const lift = d <= SHELF ? rimY - TUCK : rimY - TUCK - BANK_GRADE * (d - SHELF);
      y = Math.max(y, lift);
    }
    // UNDER: anywhere the sheet covers, edge included, the ground stays under
    // it. A pool is whole lattice triangles (latticeSnap), so its edge runs
    // along ground vertices; one left above the water line would poke through
    // the sheet.
    if (onSheet(b, x, z)) y = Math.min(y, b.wl - TUCK);
    // OPEN: far enough inside the water, under the water line.
    if (b.inWater.at(x, z) > SHORE) y = Math.min(y, b.wl - OPEN_DEPTH);
  }
  return y;
}

/**
 * The ground at (x, z) held under every sheet that covers it, and nothing
 * else: for a vertex the paving owns, whose height `carve` does not set but
 * which a pool's edge still runs through.
 */
export function underSheets(basins: Basin[], x: number, z: number, y: number): number {
  for (const b of basins) {
    if (onSheet(b, x, z)) y = Math.min(y, b.wl - TUCK);
  }
  return y;
}

/**
 * How far the ground would have to move to hold this basin: the largest
 * change `carve` makes on a grid over its footprint and shelf.
 */
export function carveCost(b: Basin, G: HeightField, box: [number, number, number, number]): number {
  let m = 0;
  const [x0, z0, x1, z1] = box;
  for (let x = x0 - SHELF; x <= x1 + SHELF; x += 0.05) {
    for (let z = z0 - SHELF; z <= z1 + SHELF; z += 0.05) {
      if (b.foot.at(x, z) > SHELF) continue;
      const g = G.sample(x, z);
      if (!g) continue;
      m = Math.max(m, Math.abs(carve([b], x, z, g.y) - g.y));
    }
  }
  return m;
}

/** A dip left by a pool that moved away: filled to the ground round it. */
export interface Fill {
  x: number;
  z: number;
  r: number;
  y: number;
}

/** The fill height for a footprint: the mean of the ground on a ring just outside it. */
export function fillOf(x: number, z: number, r: number, G: HeightField): Fill | null {
  let s = 0,
    n = 0;
  for (let k = 0; k < 24; k++) {
    const a = (k * Math.PI) / 12;
    const g = G.sample(x + (r + 0.1) * Math.cos(a), z + (r + 0.1) * Math.sin(a));
    if (g) {
      s += g.y;
      n++;
    }
  }
  return n ? { x, z, r, y: s / n } : null;
}

/** Raise the ground inside every fill toward its height (never lower it). */
export function fill(fills: Fill[], x: number, z: number, y: number): number {
  for (const f of fills) {
    const d = Math.hypot(x - f.x, z - f.z);
    const w = 1 - smoothstep(f.r - FILL_FEATHER, f.r, d);
    if (w > 0) y = Math.max(y, y + (f.y - y) * w);
  }
  return y;
}

/** Still water is set this far under the median ground its sheet lands on: mostly cut, a little fill. */
export const WATER_SET = -0.005;

/**
 * Set a water body's level on the ground it lands on (one rigid lift for all
 * its parts): its water line goes WATER_SET under the median of that ground
 * under its sheet. Returns the level.
 */
export function seatWater(places: Place[], G: HeightField): number | null {
  const authored = emitPlaces(places.map((p) => stay(p.c, 0)));
  const wlOld = waterLevel(authored);
  const m = medianUnderWater(emitPlaces(places), G);
  if (m === null || !Number.isFinite(wlOld)) return null;
  const wl = m + WATER_SET;
  for (const p of places) {
    p.mode = "rigid";
    p.yOld = wlOld;
    p.yNew = wl;
  }
  return wl;
}
