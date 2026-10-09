// Paving surfaces: the plaza, the spokes, a yard's floor. The paving itself is
// painted on the ground's own triangles (paint.ts), but the ground under it
// must still be a plausible road or square: level across a spoke, graded along
// it, flat under the plaza.
//
// Each paving part gets a surface smooth at the ground's 21 cm scale, and every
// ground corner under or beside it is set to that surface:
//
//   PLANE    a compact part (the plaza, a yard floor) is one plane: the
//            least-squares fit of the ground under it. On its pad that is
//            the pad, exactly.
//   PROFILE  an elongated part (a spoke) is level across and follows a
//            smoothed profile along its axis. Where it runs under the plaza it
//            takes the plaza's height, so the two meet.
//
// Both are clamped under the chip's underside inside its disc.
import { HeightField, KeepOut } from "./fields.ts";
import { CHIP_CLAMP_Y, CHIP_KEEP, chipDist } from "./heroes.ts";
import type { Part, Prim } from "./model.ts";

/** A drape authored on this plane, at its own lift over it. */
export const DRAPE_PLANE = 0.25;
/** The ground under paving is set this far under its surface. */
export const GROUND_UNDER = 0;
/** A drape this elongated (principal axes) is a road with a profile; below it, a plane. */
export const PROFILE_RATIO = 2.5;
/** Profile samples along a spoke... */
export const PROFILE_STEP = 0.05;
/** ...averaged over this half-window, this many passes (a spoke's grade changes slowly). */
export const PROFILE_HALF = 0.5;
export const PROFILE_PASSES = 6;
/** A spoke keeps the plaza's plane this far past the plaza's edge (a ground cell and a bit)... */
export const MEET_REACH = 0.26;
/** ...and takes up its own grade over this beyond that. */
export const MEET_BLEND = 0.9;
/** Ground this close to a drape is set to its surface... */
export const DRAPE_REACH = 0.22;
/** ...and blends back to its own over this beyond that. */
export const DRAPE_FEATHER = 0.25;

export interface DrapeSurface {
  part: Part;
  /** The ground line under the drape at (x, z), defined everywhere (extrapolated off it). */
  line: (x: number, z: number) => number;
  /** Its footprint. */
  foot: KeepOut;
  field: HeightField;
}

function planVerts(part: Part): [number, number][] {
  const v: [number, number][] = [];
  for (const p of part.prims)
    for (let i = 0; i < p.pos.length; i += 3) v.push([p.pos[i], p.pos[i + 2]]);
  return v;
}

/** The ground averaged across a drape's width at a station (a road is level across). */
function across(
  G: HeightField,
  x: number,
  z: number,
  nx: number,
  nz: number,
  half: number,
): number | null {
  let s = 0,
    n = 0;
  for (let k = -2; k <= 2; k++) {
    const g = G.sample(x + (nx * half * k) / 2, z + (nz * half * k) / 2);
    if (g) {
      s += g.y;
      n++;
    }
  }
  return n ? s / n : null;
}

/**
 * Cap a ground line under the chip's underside inside its disc (less the
 * drape's lift), and ramp down to that cap over CHIP_RAMP outside it. Without
 * the ramp, a plaza on high ground would drop to the chip's height within one
 * ground cell and its rim would stand over nothing.
 */
const CHIP_CAP = CHIP_CLAMP_Y - 0.006;
export const CHIP_RAMP = 1.0;
export const CHIP_RAMP_MAX = 1.6;
export const CHIP_RAMP_PER = 5;
const chipCap = (x: number, z: number, y: number) => {
  const d = chipDist(x, z);
  if (d < CHIP_KEEP) return Math.min(y, CHIP_CAP);
  // The higher the ground stands over the chip, the longer the ramp down
  // to it, so its grade stays one the ground's faces can follow.
  const ramp = Math.min(CHIP_RAMP_MAX, Math.max(CHIP_RAMP, CHIP_RAMP_PER * (y - CHIP_CAP)));
  if (d >= CHIP_KEEP + ramp || y <= CHIP_CAP) return y;
  const t = smooth(CHIP_KEEP, CHIP_KEEP + ramp, d);
  return CHIP_CAP + (y - CHIP_CAP) * t;
};

/**
 * A surface for each drape part. `G` is the ground they are laid on;
 * `isPlaza` names the part a spoke's profile must meet where it runs under it.
 */
export function drapeSurfaces(
  parts: Part[],
  G: HeightField,
  isPlaza: (p: Part) => boolean,
  /** The town's flat pads: a compact drape on one is fitted to the pad itself, not the ground's feather round it. */
  pads?: HeightField,
): DrapeSurface[] {
  const out: DrapeSurface[] = [];
  const planes = new Map<Part, { raw: (x: number, z: number) => number; foot: KeepOut }>();
  // Planes first: a spoke meets the plaza's.
  const ordered = [...parts].sort((a, b) => Number(isPlaza(b)) - Number(isPlaza(a)));
  for (const part of ordered) {
    const v = planVerts(part);
    if (v.length === 0) continue;
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
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)),
      l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const ratio = Math.sqrt(l1 / Math.max(l2, 1e-9));
    let line: (x: number, z: number) => number;
    // The surface before the chip cap, which a meeting spoke blends to
    // (capping twice would drag the spoke down to the chip's height).
    let raw: (x: number, z: number) => number = (x, z) => line(x, z);
    if (ratio < PROFILE_RATIO || isPlaza(part)) {
      // Least squares y = a + b x + c z over the ground at the drape's
      // vertices and triangle centres.
      const pts: [number, number, number][] = [];
      for (const p of part.prims) {
        for (let i = 0; i < p.pos.length; i += 9) {
          for (const [u, w] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1 / 3, 1 / 3],
          ]) {
            const x = p.pos[i] * (1 - u - w) + p.pos[i + 3] * u + p.pos[i + 6] * w,
              z = p.pos[i + 2] * (1 - u - w) + p.pos[i + 5] * u + p.pos[i + 8] * w;
            const g = pads?.sample(x, z) ?? G.sample(x, z);
            if (g) pts.push([x - cx, z - cz, g.y]);
          }
        }
      }
      const [a, b, c] = fitPlane(pts);
      raw = (x, z) => a + b * (x - cx) + c * (z - cz);
      line = (x, z) => chipCap(x, z, a + b * (x - cx) + c * (z - cz));
    } else {
      // The long axis, its stations, and the smoothed profile along it.
      const ax = Math.abs(sxz) > 1e-12 ? l1 - szz : 1,
        az = Math.abs(sxz) > 1e-12 ? sxz : 0;
      const al = Math.hypot(ax, az) || 1;
      const ux = sxx >= szz || Math.abs(sxz) > 1e-12 ? ax / al : 0,
        uz = sxx >= szz || Math.abs(sxz) > 1e-12 ? az / al : 1;
      const nx = -uz,
        nz = ux;
      let s0 = Infinity,
        s1 = -Infinity,
        halfW = 0;
      for (const [x, z] of v) {
        const s = (x - cx) * ux + (z - cz) * uz;
        s0 = Math.min(s0, s);
        s1 = Math.max(s1, s);
        halfW = Math.max(halfW, Math.abs((x - cx) * nx + (z - cz) * nz));
      }
      const n = Math.max(2, Math.ceil((s1 - s0) / PROFILE_STEP) + 1);
      const st = (k: number) => s0 + ((s1 - s0) * k) / (n - 1);
      // The ground's profile, heavily smoothed, then blended into the plaza's
      // plane over MEET_BLEND near it, so the spoke leaves the plaza level. The
      // grade must change slowly because the ground is a lattice of 21 cm faces.
      let h: number[] = [];
      const meet: { w: number; y: number }[] = [];
      for (let k = 0; k < n; k++) {
        const x = cx + ux * st(k),
          z = cz + uz * st(k);
        h.push(across(G, x, z, nx, nz, halfW) ?? DRAPE_PLANE);
        let best: { w: number; y: number } = { w: 1, y: 0 };
        for (const q of planes.values()) {
          const d = q.foot.at(x, z);
          const w = smooth(MEET_REACH, MEET_REACH + MEET_BLEND, d);
          if (w < best.w) best = { w, y: q.raw(x, z) };
        }
        meet.push(best);
      }
      const win = Math.round(PROFILE_HALF / PROFILE_STEP);
      for (let pass = 0; pass < PROFILE_PASSES; pass++) {
        h = h.map((_, k) => {
          let s = 0,
            m = 0;
          for (let j = Math.max(0, k - win); j <= Math.min(n - 1, k + win); j++) {
            s += h[j];
            m++;
          }
          return s / m;
        });
      }
      h = h.map((v, k) => {
        const x = cx + ux * st(k),
          z = cz + uz * st(k);
        return chipCap(x, z, meet[k].y + (v - meet[k].y) * meet[k].w);
      });
      line = (x, z) => {
        const s = (x - cx) * ux + (z - cz) * uz;
        const t = Math.max(0, Math.min(n - 1, ((s - s0) / (s1 - s0 || 1)) * (n - 1)));
        const k = Math.min(n - 2, Math.floor(t));
        return chipCap(x, z, h[k] + (h[k + 1] - h[k]) * (t - k));
      };
    }
    if (isPlaza(part)) planes.set(part, { raw, foot: new KeepOut().add(part.prims).finish() });
    out.push({
      part,
      line,
      foot: new KeepOut().add(part.prims).finish(),
      field: new HeightField(part.prims),
    });
  }
  return out;
}

function fitPlane(pts: [number, number, number][]): [number, number, number] {
  if (pts.length === 0) return [DRAPE_PLANE, 0, 0];
  // Normal equations for y = a + b x + c z.
  let n = 0,
    sx = 0,
    sz = 0,
    sy = 0,
    sxx = 0,
    szz = 0,
    sxz = 0,
    sxy = 0,
    szy = 0;
  for (const [x, z, y] of pts) {
    n++;
    sx += x;
    sz += z;
    sy += y;
    sxx += x * x;
    szz += z * z;
    sxz += x * z;
    sxy += x * y;
    szy += z * y;
  }
  const M = [
    [n, sx, sz],
    [sx, sxx, sxz],
    [sz, sxz, szz],
  ];
  const r = [sy, sxy, szy];
  const d3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = d3(M);
  if (Math.abs(D) < 1e-12) return [sy / n, 0, 0];
  const col = (k: number) => M.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)));
  return [d3(col(0)) / D, d3(col(1)) / D, d3(col(2)) / D];
}

/**
 * Inside the chip's disc the ground under paving sits 9 mm under its surface
 * (the contract's 0.240 under a 0.249 lip).
 */
export const CHIP_DRAPE_CLEAR = 0.009;

/**
 * The ground height at a corner (x, z), height y, given the drapes: under or
 * touching a drape, just under its surface; near one, feathered back.
 * `touching` is every corner of a ground face that reaches under a drape.
 */
export function groundUnderDrapes(
  surfaces: DrapeSurface[],
  touching: Set<string>,
  x: number,
  z: number,
  y: number,
): number {
  // The drape it is under (the highest, where two overlap), or the nearest.
  let under: DrapeSurface | null = null,
    top = -Infinity;
  for (const s of surfaces) {
    const h = s.field.sample(x, z);
    if (h && h.y > top) {
      top = h.y;
      under = s;
    }
  }
  if (under)
    return under.line(x, z) - GROUND_UNDER - (chipDist(x, z) < CHIP_KEEP ? CHIP_DRAPE_CLEAR : 0);
  let near: DrapeSurface | null = null,
    d = Infinity;
  for (const s of surfaces) {
    const e = s.foot.at(x, z);
    if (e < d) {
      d = e;
      near = s;
    }
  }
  if (!near) return y;
  const touch = touching.has(vkey(x, z));
  if (!touch && d >= DRAPE_REACH + DRAPE_FEATHER) return y;
  // A corner beside two drapes (a yard floor and a spoke) takes the lower, or
  // it would lift a face through the other.
  let target = near.line(x, z) - GROUND_UNDER;
  if (touch)
    for (const s of surfaces)
      if (s !== near && s.foot.at(x, z) < DRAPE_REACH)
        target = Math.min(target, s.line(x, z) - GROUND_UNDER);
  const w = touch ? 1 : 1 - smooth(DRAPE_REACH, DRAPE_REACH + DRAPE_FEATHER, d);
  return y + (target - y) * w;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const vkey = (x: number, z: number) => `${Math.fround(x)},${Math.fround(z)}`;

/** The corners of every ground triangle that reaches under a drape. */
export function drapeCorners(ground: Prim[], surfaces: DrapeSurface[]): Set<string> {
  const out = new Set<string>();
  const Hd = new HeightField(surfaces.flatMap((s) => s.part.prims));
  const dv: [number, number][] = surfaces.flatMap((s) => planVerts(s.part));
  const near = (x: number, z: number) => Math.min(...surfaces.map((s) => s.foot.at(x, z)));
  for (const p of ground) {
    for (let i = 0; i < p.pos.length; i += 9) {
      const ax = p.pos[i],
        az = p.pos[i + 2],
        bx = p.pos[i + 3],
        bz = p.pos[i + 5],
        cx = p.pos[i + 6],
        cz = p.pos[i + 8];
      if (Math.min(near(ax, az), near(bx, bz), near(cx, cz)) > 0.3) continue;
      let hit = false;
      for (let a = 0; a <= 6 && !hit; a++)
        for (let b = 0; a + b <= 6 && !hit; b++) {
          const u = a / 6,
            v = b / 6,
            w = 1 - u - v;
          if (Hd.sample(ax * w + bx * u + cx * v, az * w + bz * u + cz * v)) hit = true;
        }
      if (!hit) {
        // A drape detail smaller than the sampling: one of its corners inside.
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) > 1e-12)
          hit = dv.some(([x, z]) => {
            const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
            const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
            return w1 >= 0 && w2 >= 0 && w1 + w2 <= 1;
          });
      }
      if (hit) {
        out.add(vkey(ax, az));
        out.add(vkey(bx, bz));
        out.add(vkey(cx, cz));
      }
    }
  }
  return out;
}

/**
 * Remove the faces of a drape lying wholly under the plaza. Spokes are
 * authored running under the plaza's rim so no gap opens; the hidden part
 * would be a second sheet 2 mm below that could poke through.
 */
export function hideUnder(parts: Part[], isTop: (p: Part) => boolean): void {
  const tops = parts.filter(isTop);
  if (!tops.length) return;
  const T = new HeightField(tops.flatMap((p) => p.prims));
  for (const part of parts) {
    if (isTop(part)) continue;
    part.prims = part.prims.map((prim) => {
      const keep: number[] = [];
      for (let i = 0; i < prim.pos.length; i += 9) {
        const pts: [number, number][] = [
          [prim.pos[i], prim.pos[i + 2]],
          [prim.pos[i + 3], prim.pos[i + 5]],
          [prim.pos[i + 6], prim.pos[i + 8]],
          [
            (prim.pos[i] + prim.pos[i + 3] + prim.pos[i + 6]) / 3,
            (prim.pos[i + 2] + prim.pos[i + 5] + prim.pos[i + 8]) / 3,
          ],
        ];
        if (!pts.every(([x, z]) => T.sample(x, z))) keep.push(i);
      }
      const pos = new Float32Array(keep.length * 9),
        nrm = new Float32Array(keep.length * 9);
      keep.forEach((i, n) => {
        pos.set(prim.pos.subarray(i, i + 9), n * 9);
        nrm.set(prim.nrm.subarray(i, i + 9), n * 9);
      });
      return { material: prim.material, pos, nrm };
    });
  }
}
