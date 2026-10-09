// The shoreline as one smooth closed curve per island.
//
// Built rather than sampled from noise: the sand is a narrow ribbon on a hex
// outline, so any displacement at the ribbon's width scale reads as lumps, and
// a field over world position gives neighbouring stretches no reason to agree.
//
//   1. Offset. Push the coast loop out to sea by the beach's reach: an arc about
//      each headland corner, the mitre where offset lines cross in a bay. This
//      is the exact offset curve, so adjacent stretches agree by construction.
//   2. Resample by arc length at `SHORE_SAMPLE_STEP`.
//   3. Smooth with the cubic B-spline kernel at scale `SHORE_SMOOTH`: the
//      B-spline with the offset polyline as control polygon. C2 everywhere
//      including across the loop's closure, variation-diminishing (adds no
//      wiggle), and it moves a corner by `SHORE_SMOOTH_PULL` toward the inside
//      of its turn (inward at a headland, seaward at a bay). The kernel spans
//      4 * SHORE_SMOOTH = 5.6 units, nearly two hex edges (3.144), so a bay
//      between two headlands is one sweep with no straight part.
//   4. Modulate, once, on arc length (currently off). One sine of wavelength at
//      least `SHORE_SWELL_WAVELENGTH` and amplitude `SHORE_SWELL`, fitted to a
//      whole number of periods so it closes exactly. Both amplitudes are zero
//      as shipped; see `SHORE_SWELL`.
//
// Nothing here is random or seeded: the curve depends only on which hexes are
// land, so every rebuild draws the same coast.
import { LATTICE_SIZE } from "./coords";
import { coastTurnsOut, type CoastLoop, type Vec2 } from "./coastline";

/** The mitre factor for the 60 degree turn a hex boundary always makes. */
export const MITRE = 1 / Math.cos(Math.PI / 6);

/**
 * Spacing of the ribbon's cross-sections along the shore: a hex edge (3.144)
 * split twenty ways, 0.157. At the sharpest curvature (a bay's rounded mitre)
 * that is 4.9 degrees of turn per step; the tests hold it under 8.
 */
export const SHORE_SAMPLE_STEP = LATTICE_SIZE / 20;

/**
 * Facets across a headland's offset arc, before smoothing. Six over 60 degrees
 * keeps the arc within 0.004 of a circle. These are control points for step 3,
 * not shipped geometry.
 */
export const HEADLAND_FACETS = 6;

/**
 * The cubic B-spline's scale, in world units: the radius the hex outline's
 * corners come back as, and the main dial on how smooth the coast is.
 *
 * The kernel spans 4 * this, so a 60 degree corner spreads over 5.6 units,
 * nearly two hex edges (3.144). No edge comes back straight, so an island's
 * outline is one continuous sweep. A kernel narrower than an edge (0.45 was
 * tried) leaves arcs joined by straights and the hex outline stays legible.
 *
 * Bounded above by the ribbon width: smoothing pulls a headland in by up to
 * `SHORE_SMOOTH_PULL` (0.327), straight off the sand, so the narrowest sand is
 * 0.484 at a headland against 0.62 nominal. Much past 1.4 it eats the
 * headland's beach; `shoreCurve.test.ts` holds the floor.
 */
export const SHORE_SMOOTH = 1.4;

/**
 * How far the smoothing can move a point, in world units.
 *
 * 7/30 of the scale, by identity: convolving a corner of two straight legs with
 * the cubic B-spline kernel displaces the apex by
 * `scale * integral(B3(u) * u, 0, inf) * |t_out - t_in|`, the integral is 7/30,
 * and a hex boundary's 60 degree turn gives a tangent difference of length
 * 2*sin(30) = 1. The displacement is toward the inside of the turn: inward at a
 * headland, outward at a bay.
 *
 * Per corner, not a strict global bound: at this scale two adjacent bays (about
 * 1.99 apart on the offset) fall in one kernel window and their displacements
 * add. The worst seen over 1,500 random boards is 0.283, still inside 0.327;
 * `BEACH_ENVELOPE` is built on the safe side anyway.
 */
export const SHORE_SMOOTH_PULL = (SHORE_SMOOTH * 7) / 30;

/**
 * The swell amplitude, in world units of reach. Currently zero (off).
 *
 * A single sine on arc length so the beach width breathes gently around the
 * island. It cannot alias (its wavelength is forty sample steps) or put a
 * corner anywhere (curvature is bounded by `amplitude * k^2`). Even so, at 0.07
 * with the smoothing at 1.4 it read as jagged, and the plain offset looked
 * right.
 *
 * Kept as one number: `shoreStations` and `wetLineU` take the amplitude as an
 * argument defaulting to this, so tests still exercise the sine at a non-zero
 * amplitude. See `SHORE_WET_SWELL` for the seam.
 */
export const SHORE_SWELL = 0.0;

/**
 * The shortest wavelength the swell may have, in world units. Six is nearly two
 * hex edges, so the swell belongs to the island rather than the coastline's
 * texture. The realised wavelength is the perimeter divided by a whole number
 * of periods (see `swellPeriods`), so it is at least this.
 */
export const SHORE_SWELL_WAVELENGTH = 6;

/** Where the sine starts, at arc length zero. Any value; fixed so it is stable. */
export const SHORE_SWELL_PHASE = 0.7;

/**
 * How far the dry/wet seam slides along the profile, as a fraction of the
 * reach. Zero, like `SHORE_SWELL`.
 *
 * The same sine with a phase offset, so the waterline and the sand's edge move
 * together; out of phase so the wet band is wider where the beach is narrow.
 *
 * At zero the seam is a fixed fraction across the ribbon, and the ribbon's
 * width still varies (0.48 at a headland to 0.80 in a bay), so the wet band
 * follows the geometry.
 */
export const SHORE_WET_SWELL = 0.0;

/** The seam's phase lead on the shoreline's own, in radians. */
export const SHORE_WET_PHASE = 1.9;

/** One cross-section of the ribbon, landward end to seaward end. */
export interface ShoreStation {
  /** The point on the coast itself: a lattice line, or a lattice corner. */
  base: Vec2;
  /** The lip, tucked back under the gutter. Shared by a whole corner. */
  lip: Vec2;
  /** The seaward foot of the sand, on the smooth curve. */
  foot: Vec2;
  /** Distance along the smooth curve, for anything else that must stay in step. */
  s: number;
  /** Total length of this loop's curve, so `s` can be read as a phase. */
  length: number;
}

const norm = (v: Vec2): Vec2 => {
  const len = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / len, v[1] / len];
};

/** The three parallel polylines a loop is walked into, before resampling. */
interface Skeleton {
  /** The exact offset curve: arcs at headlands, mitres in bays. */
  outer: Vec2[];
  /** Where each of those came from on the coast itself. */
  base: Vec2[];
  /** ...and the landward lip that goes with it. */
  lip: Vec2[];
}

/**
 * Walk one loop of coast and push it out to sea by `reach`.
 *
 * Corners only: between corners both the coast and its offset are straight, so
 * interpolating them in step is exact and a cross-section keeps track of its
 * landward end however far its seaward end is smoothed.
 *
 * A headland (water outside the turn) gets a fan of arc points about the
 * corner; a bay gets one mitre point where the edges' offsets cross. Both put
 * the lip on the mitre, because the lip is 0.08 wide and a fan of it would fold
 * into a bowtie.
 */
export function shoreSkeleton(loop: CoastLoop, reach: number, tuck: number): Skeleton {
  const outer: Vec2[] = [];
  const base: Vec2[] = [];
  const lip: Vec2[] = [];

  for (let i = 0; i < loop.length; i++) {
    const edge = loop[i];
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const bisector = norm([prev.n[0] + edge.n[0], prev.n[1] + edge.n[1]]);
    const here: Vec2 = [
      edge.a[0] - bisector[0] * tuck * MITRE,
      edge.a[1] - bisector[1] * tuck * MITRE,
    ];

    if (coastTurnsOut(prev.n, edge.n)) {
      for (let k = 0; k <= HEADLAND_FACETS; k++) {
        const n = norm([
          prev.n[0] + (edge.n[0] - prev.n[0]) * (k / HEADLAND_FACETS),
          prev.n[1] + (edge.n[1] - prev.n[1]) * (k / HEADLAND_FACETS),
        ]);
        outer.push([edge.a[0] + n[0] * reach, edge.a[1] + n[1] * reach]);
        base.push(edge.a);
        lip.push(here);
      }
    } else {
      outer.push([
        edge.a[0] + bisector[0] * reach * MITRE,
        edge.a[1] + bisector[1] * reach * MITRE,
      ]);
      base.push(edge.a);
      lip.push(here);
    }
  }
  return { outer, base, lip };
}

/** Length of a closed polyline, and the running total at each vertex. */
function arcLengths(points: readonly Vec2[]): { at: number[]; total: number } {
  const at: number[] = [0];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    at.push(total);
  }
  return { at, total };
}

/**
 * Resample a closed skeleton at a uniform step along its outer polyline. Base
 * and lip are interpolated at the same parameter, so a station's landward end
 * stays the coast point its seaward end was offset from.
 */
function resample(skel: Skeleton, step: number): Skeleton {
  const { at, total } = arcLengths(skel.outer);
  const count = Math.max(3, Math.round(total / step));
  const out: Skeleton = { outer: [], base: [], lip: [] };
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const s = (total * i) / count;
    while (seg + 1 < at.length - 1 && at[seg + 1] <= s) seg++;
    const span = at[seg + 1] - at[seg] || 1;
    const t = (s - at[seg]) / span;
    const j = (seg + 1) % skel.outer.length;
    const mix = (a: readonly Vec2[]): Vec2 => [
      a[seg][0] + (a[j][0] - a[seg][0]) * t,
      a[seg][1] + (a[j][1] - a[seg][1]) * t,
    ];
    out.outer.push(mix(skel.outer));
    out.base.push(mix(skel.base));
    out.lip.push(mix(skel.lip));
  }
  return out;
}

/**
 * The cubic B-spline basis, the smoothing kernel. Support [-2, 2], integral 1,
 * C2. Non-negative (no overshoot into the land or past the envelope), sums to
 * one (straight coast stays straight), and variation-diminishing (adds no
 * wiggle, which is what rules out self-intersection).
 */
export function bspline3(t: number): number {
  const a = Math.abs(t);
  if (a >= 2) return 0;
  if (a >= 1) return (2 - a) ** 3 / 6;
  return 2 / 3 - a * a + (a * a * a) / 2;
}

/**
 * Smooth a closed polyline of uniformly spaced points. Circular, so the curve
 * is C2 across the loop's start and there is no seam.
 */
export function smoothClosed(points: readonly Vec2[], scale: number, step: number): Vec2[] {
  const radius = Math.ceil((2 * scale) / step);
  if (radius < 1 || points.length < 3) return points.map((p) => [p[0], p[1]] as Vec2);
  const weights: number[] = [];
  let sum = 0;
  for (let m = -radius; m <= radius; m++) {
    const w = bspline3((m * step) / scale);
    weights.push(w);
    sum += w;
  }
  const n = points.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let z = 0;
    for (let m = -radius; m <= radius; m++) {
      const w = weights[m + radius];
      const p = points[(((i + m) % n) + n) % n];
      x += w * p[0];
      z += w * p[1];
    }
    out.push([x / sum, z / sum]);
  }
  return out;
}

/**
 * How many whole periods of the swell fit round a loop of this length. Whole,
 * because a sine that does not close leaves a step in the coast where the walk
 * started. At least one.
 */
export function swellPeriods(length: number): number {
  return Math.max(1, Math.round(length / SHORE_SWELL_WAVELENGTH));
}

/**
 * One loop of coast, as the stations the ribbon is built on.
 *
 * `reach` is the sand's nominal width; the returned feet are that offset,
 * smoothed and modulated, and the profile is stretched across whatever width
 * results (`beachProfileY` takes a fraction across, not a distance).
 *
 * `swell` defaults to `SHORE_SWELL` (zero), giving the plain smoothed offset.
 * It is an argument so the sine stays tested.
 */
export function shoreStations(
  loop: CoastLoop,
  reach: number,
  tuck: number,
  swell: number = SHORE_SWELL,
): ShoreStation[] {
  if (loop.length < 3) return [];
  const skel = resample(shoreSkeleton(loop, reach, tuck), SHORE_SAMPLE_STEP);
  const smooth = smoothClosed(skel.outer, SHORE_SMOOTH, SHORE_SAMPLE_STEP);
  const { at, total } = arcLengths(smooth);
  const k = (2 * Math.PI * swellPeriods(total)) / total;

  return smooth.map((foot, i) => {
    const base = skel.base[i];
    // Scale along the cross-section rather than push along the curve normal:
    // the direction is kept, so stations cannot fold over each other.
    const grow = 1 + (swell * Math.sin(at[i] * k + SHORE_SWELL_PHASE)) / reach;
    return {
      base,
      lip: skel.lip[i],
      foot: [base[0] + (foot[0] - base[0]) * grow, base[1] + (foot[1] - base[1]) * grow] as Vec2,
      s: at[i],
      length: total,
    };
  });
}

/**
 * How far across the ribbon the sand stops being dry, at a station.
 *
 * `nominal` is the profile's top of the swash; this slides it along the same
 * sine as the width, a phase apart, clamped so the seam stays on the ribbon.
 * `swell` defaults to `SHORE_WET_SWELL` (zero), which returns `nominal`
 * everywhere.
 */
export function wetLineU(
  station: ShoreStation,
  nominal: number,
  swell: number = SHORE_WET_SWELL,
): number {
  const k = (2 * Math.PI * swellPeriods(station.length)) / station.length;
  const u = nominal + swell * Math.sin(station.s * k + SHORE_SWELL_PHASE + SHORE_WET_PHASE);
  return Math.min(0.9, Math.max(0.05, u));
}
