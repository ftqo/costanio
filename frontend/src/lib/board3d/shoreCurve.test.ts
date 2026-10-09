// The shoreline in plan: a smooth closed curve, neighbouring stretches agree,
// and it stays where a beach of the nominal width can live. These measure
// smoothness, not just that the outline is not straight; a lumpy polygon
// passes the latter.
import { test, expect } from "vitest";
import {
  HEADLAND_FACETS,
  MITRE,
  SHORE_SAMPLE_STEP,
  SHORE_SMOOTH,
  SHORE_SMOOTH_PULL,
  SHORE_SWELL,
  SHORE_SWELL_WAVELENGTH,
  SHORE_WET_PHASE,
  SHORE_WET_SWELL,
  bspline3,
  shoreSkeleton,
  shoreStations,
  smoothClosed,
  swellPeriods,
  wetLineU,
} from "./shoreCurve";
import {
  APOTHEM,
  BEACH_ENVELOPE,
  BEACH_REACH,
  BEACH_TUCK,
  WATER_Y,
  beachProfileU,
  shorePointAt,
  shoreReach,
} from "./beachGeometry";
import { solveCoastLoops, type CoastLoop, type Vec2 } from "./coastline";
import { LATTICE_GAP } from "./coords";
import board from "../../../dev/board-shots.board.json";
import type { BoardTile } from "@/lib/types";

const SHOT_BOARD = (board as unknown as { tiles: BoardTile[] }).tiles;
const land = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "wood", num: 8 });
const sea = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "sea", num: 0 });

/** Every degree of turn between consecutive samples of a closed polyline. */
function turns(points: readonly Vec2[]): number[] {
  const n = points.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    let d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push((d * 180) / Math.PI);
  }
  return out;
}

/** Distance from a point to the coast itself: its nearest point on any edge. */
function toCoast(loops: CoastLoop[], p: Vec2): number {
  let best = Infinity;
  for (const loop of loops)
    for (const e of loop) {
      const dx = e.b[0] - e.a[0];
      const dz = e.b[1] - e.a[1];
      const t = Math.min(
        1,
        Math.max(0, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dz) / (dx * dx + dz * dz)),
      );
      best = Math.min(best, Math.hypot(p[0] - (e.a[0] + dx * t), p[1] - (e.a[1] + dz * t)));
    }
  return best;
}

/** Whether a closed polyline crosses itself anywhere. */
function selfIntersects(points: readonly Vec2[]): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]];
      if (side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)) return true;
    }
  }
  return false;
}

const footprint = (loop: CoastLoop): Vec2[] =>
  shoreStations(loop, BEACH_REACH, BEACH_TUCK).map((s) => s.foot);

/** A single water hex walled in by land: the loop that runs the other way. */
const POND: BoardTile[] = [
  land(1, 0),
  land(-1, 0),
  land(0, 1),
  land(0, -1),
  land(1, -1),
  land(-1, 1),
  sea(0, 0),
];

test("the smoothing kernel is the cubic B-spline", () => {
  // Non-negative (no overshoot past the offset), a partition of unity (a
  // straight run stays straight rather than shrinking), and C2 (no corner
  // anywhere, including the loop's closure).
  for (let t = -3; t <= 3; t += 0.01) expect(bspline3(t)).toBeGreaterThanOrEqual(0);
  expect(bspline3(2)).toBe(0);
  expect(bspline3(-2)).toBe(0);
  expect(bspline3(0)).toBeCloseTo(2 / 3, 12);
  expect(bspline3(1)).toBeCloseTo(1 / 6, 12);
  // Continuous at the knot where the two pieces meet, and so is its slope.
  expect(bspline3(1 - 1e-7)).toBeCloseTo(bspline3(1 + 1e-7), 6);
  // Partition of unity on any integer lattice: shifted copies sum to 1.
  for (const off of [0, 0.13, 0.5, 0.87]) {
    let sum = 0;
    for (let m = -4; m <= 4; m++) sum += bspline3(m + off);
    expect(sum, `shifts at ${off}`).toBeCloseTo(1, 12);
  }
  // Integral one, so smoothing a shape does not move its centre of mass.
  let area = 0;
  for (let t = -2; t < 2; t += 0.0001) area += bspline3(t + 0.00005) * 0.0001;
  expect(area).toBeCloseTo(1, 6);
});

test("a straight coast stays straight and a corner comes back round", () => {
  // A long straight stretch must survive untouched (shrinking it would pull the
  // island in), and a corner must spread over about the kernel's width.
  const step = SHORE_SAMPLE_STEP;
  const straight: Vec2[] = [];
  const n = 400;
  for (let i = 0; i < n; i++) {
    // A long thin closed loop: the two long sides are straight for 30 units.
    const s = (i / n) * 2 * 30;
    straight.push(s < 30 ? [s, 0] : [60 - s, 4]);
  }
  const flat = smoothClosed(straight, SHORE_SMOOTH, step);
  for (let i = 20; i < 120; i++) expect(flat[i][1], `straight at ${i}`).toBeCloseTo(0, 9);

  // A 60 degree corner (the only turn a hex boundary makes) moves by exactly
  // SHORE_SMOOTH_PULL, the identity in that constant's comment.
  const legs: Vec2[] = [];
  const count = Math.round(40 / step);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * 40;
    legs.push(
      t < 20 ? [t - 20, 0] : [(t - 20) * Math.cos(Math.PI / 3), (t - 20) * Math.sin(Math.PI / 3)],
    );
  }
  const round = smoothClosed(legs, SHORE_SMOOTH, step);
  const apex = round[Math.round(20 / step)];
  expect(Math.hypot(apex[0], apex[1])).toBeCloseTo(SHORE_SMOOTH_PULL, 2);
});

test("no corner anywhere on the coast, and the offset it smooths has one", () => {
  // Consecutive samples turn by a small angle. The board's sharpest is 4.9
  // degrees at SHORE_SMOOTH 1.4; the bound of 8 leaves room to retune the sample
  // rate but fails a kernel narrower than a hex edge.
  const loops = solveCoastLoops(SHOT_BOARD);
  expect(loops.length).toBeGreaterThan(0);
  let worst = 0;
  for (const loop of loops) worst = Math.max(worst, ...turns(footprint(loop)).map(Math.abs));
  expect(worst).toBeLessThan(8);
  // A floor rather than an exact value: the figure drifts slightly as the reach
  // is tuned.
  expect(worst).toBeGreaterThan(3);

  // The raw offset fails: a bay's mitre is a single 60 degree turn, so the
  // smoothing is what does the work.
  let raw = 0;
  for (const loop of loops) {
    const skel = shoreSkeleton(loop, BEACH_REACH, BEACH_TUCK);
    raw = Math.max(raw, ...turns(skel.outer).map(Math.abs));
  }
  expect(raw).toBeGreaterThan(50);
});

test("the curve closes on itself, with no seam to find", () => {
  // The smoothing is a circular convolution and the modulation fits a whole
  // number of periods, so sample zero is not special. Bound how fast the turn
  // changes per sample, then check the seam specifically.
  const loops = solveCoastLoops(SHOT_BOARD);
  for (const loop of loops) {
    const t = turns(footprint(loop));
    const deltas = t.map((_, i) => Math.abs(t[(i + 1) % t.length] - t[i]));
    // Even through a rounded corner the turn changes by about 0.65 degrees per
    // sample: the corner is spread over 5.6 units, about 36 samples.
    expect(Math.max(...deltas), "curvature never jumps").toBeLessThan(1.5);
    // The seam samples sit in the ordinary run, not at the top of it.
    const sorted = [...deltas].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    expect(deltas[0], "the seam is unremarkable").toBeLessThanOrEqual(p90);
    expect(deltas[deltas.length - 1]).toBeLessThanOrEqual(p90);
  }

  // The smoothing commutes with rotating the loop. A filter that clamped or
  // mirrored at the ends would fail this.
  const pts: Vec2[] = Array.from({ length: 57 }, (_, i) => {
    const a = (i / 57) * 2 * Math.PI;
    return [Math.cos(a) * 3 + Math.cos(a * 5) * 0.4, Math.sin(a) * 3];
  });
  const straightOn = smoothClosed(pts, SHORE_SMOOTH, SHORE_SAMPLE_STEP);
  const shift = 19;
  const rotated = smoothClosed(
    pts.map((_, i) => pts[(i + shift) % pts.length]),
    SHORE_SMOOTH,
    SHORE_SAMPLE_STEP,
  );
  for (let i = 0; i < pts.length; i++) {
    expect(rotated[i][0]).toBeCloseTo(straightOn[(i + shift) % pts.length][0], 12);
    expect(rotated[i][1]).toBeCloseTo(straightOn[(i + shift) % pts.length][1], 12);
  }
});

test("nothing on the ribbon reaches past what the scene reserves for it", () => {
  // `BEACH_ENVELOPE` pads the board's fit in `scene.ts` and budgets the one-hex
  // strait, so it must bound the real ribbon. Smoothing moves a point toward the
  // inside of its turn, which at a bay is out to sea, so the ribbon stands
  // further off than the offset's mitre.
  //
  // Checked on the shot board and the tightest loops the solver produces, where
  // the 5.6-unit kernel spans most of the loop.
  const boards: [string, BoardTile[]][] = [
    ["the shot board", SHOT_BOARD],
    ["a lone hex", [land(0, 0)]],
    ["a one-hex strait", [land(0, 0), land(2, 0), land(1, 1)]],
    ["a pond", POND],
  ];
  for (const [name, tiles] of boards) {
    const loops = solveCoastLoops(tiles);
    let worst = 0;
    for (const loop of loops)
      for (const p of footprint(loop)) worst = Math.max(worst, toCoast(loops, p));
    expect(worst, name).toBeLessThan(BEACH_ENVELOPE);
  }

  // The shot board's worst is a bay's mitre pushed `SHORE_SMOOTH_PULL` further
  // along its bisector, i.e. `SHORE_SMOOTH_PULL / MITRE` perpendicular to the
  // coast. The envelope keeps 0.044 over that (the bound for a 90 degree turn).
  const loops = solveCoastLoops(SHOT_BOARD);
  let worst = 0;
  for (const loop of loops)
    for (const p of footprint(loop)) worst = Math.max(worst, toCoast(loops, p));
  expect(worst).toBeCloseTo(BEACH_REACH + SHORE_SMOOTH_PULL / MITRE, 2);
  // Only the identity is pinned; the absolute figure moves with the reach.
  expect(worst).toBeGreaterThan(BEACH_REACH);
  expect(BEACH_ENVELOPE).toBeCloseTo(BEACH_REACH + SHORE_SMOOTH_PULL, 12);
  expect(BEACH_ENVELOPE - worst).toBeGreaterThan(0.02);
});

test("the coast is the hex offset, within the smoothing tolerance", () => {
  // The coast is the offset of the land outline, moved only by smoothing, so
  // its distance from the coast is tightly bounded everywhere.
  //
  // The exact offset stands at `BEACH_REACH` everywhere, so this measures the
  // smoothing alone. The bound is `SHORE_SMOOTH_PULL` (0.327); the board comes in
  // at 0.282, the same corner seen perpendicular to the coast.
  const loops = solveCoastLoops(SHOT_BOARD);
  let worst = 0;
  for (const loop of loops)
    for (const p of footprint(loop))
      worst = Math.max(worst, Math.abs(toCoast(loops, p) - BEACH_REACH));
  expect(worst).toBeLessThanOrEqual(SHORE_SMOOTH_PULL + SHORE_SWELL + 1e-3);
  expect(worst).toBeCloseTo(SHORE_SMOOTH_PULL / MITRE, 2);
  expect(worst).toBeCloseTo(0.282, 3);
});

test("the sand is a band a player can see everywhere, at the mean tide", () => {
  // The widest and narrowest beach on a whole board, measured off the land at
  // rest. Smoothing narrows a headland and widens a bay.
  const loops = solveCoastLoops(SHOT_BOARD);
  const u = beachProfileU(WATER_Y);
  const nominal = u * BEACH_REACH;
  let min = Infinity;
  let max = -Infinity;
  for (const loop of loops)
    for (const s of shoreStations(loop, BEACH_REACH, BEACH_TUCK)) {
      const w = toCoast(loops, shorePointAt(s, u));
      min = Math.min(min, w);
      max = Math.max(max, w);
    }
  // The floor: the ribbon tucks back over the land's half of the gutter
  // (`BEACH_TUCK`), and what shows seaward must stay wider than the whole
  // gutter (`LATTICE_GAP`) to read as shore rather than another seam. A convex
  // headland is the narrowest point.
  expect(min).toBeGreaterThan(LATTICE_GAP);
  expect(min).toBeGreaterThan(nominal * 0.85);
  // The ceiling, relative to the nominal width since the reach is still being
  // tuned: a bay may run about a fifth wider than nominal.
  expect(max).toBeLessThan(nominal * 1.3);
  // A ribbon twice as wide in places as in others would have a shape of its own
  // rather than the land's.
  expect(max / min).toBeLessThan(2);
  // With the modulation off, the variation comes from the outline, so it is the
  // same at every headland and bay.
  expect(max - min).toBeGreaterThan(nominal * 0.05);
  expect(SHORE_SWELL).toBe(0);
});

test("the coast never crosses itself, at the foot or at the waterline", () => {
  // Checked on the real board and the tightest shape the solver returns: a
  // single hex, six edges and six headlands.
  const u = beachProfileU(WATER_Y);
  for (const tiles of [SHOT_BOARD, [land(0, 0)], [land(0, 0), land(2, 0), land(1, 1)]]) {
    const loops = solveCoastLoops(tiles);
    for (const loop of loops) {
      const stations = shoreStations(loop, BEACH_REACH, BEACH_TUCK);
      expect(selfIntersects(stations.map((s) => s.foot))).toBe(false);
      expect(selfIntersects(stations.map((s) => shorePointAt(s, u)))).toBe(false);
    }
  }
});

test("a pond enclosed by land gets a coast of its own, and it closes too", () => {
  // The loop runs the other way and its offset goes inward, so too much reach
  // or smoothing would fold it through its own middle.
  const loops = solveCoastLoops(POND);
  expect(loops.length).toBe(2);
  for (const loop of loops) {
    const pts = footprint(loop);
    expect(selfIntersects(pts)).toBe(false);
    expect(Math.max(...turns(pts).map(Math.abs))).toBeLessThan(8);
  }
  // A single water hex has an inward offset only 10.4 units round and the
  // kernel spans 5.6, so the corners merge into nearly a circle.
  //
  // Sand cannot reach further in than `BEACH_ENVELOPE`, so a pool of at least
  // `APOTHEM - BEACH_ENVELOPE` must survive.
  const both = loops.map((l) => shoreStations(l, BEACH_REACH, BEACH_TUCK));
  const inner = both[0].length < both[1].length ? both[0] : both[1];
  const radii = inner.map((s) => Math.hypot(s.foot[0], s.foot[1]));
  expect(Math.min(...radii)).toBeGreaterThan(APOTHEM - BEACH_ENVELOPE);
  expect(Math.min(...radii), "still a pond, not a puddle").toBeGreaterThan(LATTICE_GAP * 2);
  expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.05);
});

test("the smallest loop still carries more samples than the kernel spans", () => {
  // `smoothClosed` is a circular convolution over a fixed number of samples
  // either side. A loop shorter than the kernel would wrap onto the same points
  // and collapse toward its centroid. The smallest loop the solver produces is a
  // one-hex pond: 10.4 units and 76 samples against the kernel's 5.6 and 37.
  const radius = Math.ceil((2 * SHORE_SMOOTH) / SHORE_SAMPLE_STEP);
  const span = 2 * radius + 1;
  expect(span).toBe(37);
  for (const [name, tiles] of [
    ["a one-hex pond", POND],
    ["a lone hex", [land(0, 0)]],
    ["the shot board", SHOT_BOARD],
  ] as [string, BoardTile[]][])
    for (const loop of solveCoastLoops(tiles)) {
      const stations = shoreStations(loop, BEACH_REACH, BEACH_TUCK);
      expect(stations.length, name).toBeGreaterThan(span);
      expect(stations[0].length, name).toBeGreaterThan(4 * SHORE_SMOOTH);
    }
});

test("the modulation is one long sine, and it closes on the island", () => {
  // At most one sine, low frequency, fitted to a whole number of periods so it
  // cannot leave a step where the walk started. These are properties of its
  // shape and hold at any amplitude, including the shipped zero.
  expect(SHORE_SWELL).toBeLessThanOrEqual(0.12);
  expect(SHORE_SWELL_WAVELENGTH).toBeGreaterThanOrEqual(6);
  for (const length of [4, 12, 47.3, 113.6, 400]) {
    const k = swellPeriods(length);
    expect(Number.isInteger(k)).toBe(true);
    expect(k).toBeGreaterThanOrEqual(1);
    if (length >= SHORE_SWELL_WAVELENGTH) {
      expect(length / k, `wavelength on a loop of ${length}`).toBeGreaterThanOrEqual(
        SHORE_SWELL_WAVELENGTH * 0.66,
      );
    }
  }
  // Many sample steps long, so it cannot alias.
  const loops = solveCoastLoops(SHOT_BOARD);
  for (const loop of loops) {
    const stations = shoreStations(loop, BEACH_REACH, BEACH_TUCK);
    const wavelength = stations[0].length / swellPeriods(stations[0].length);
    expect(wavelength).toBeGreaterThan(SHORE_SWELL_WAVELENGTH * 0.9);
    expect(wavelength / SHORE_SAMPLE_STEP).toBeGreaterThan(30);
  }
});

test("the wet seam is a constant inset without swell and a sine with it", () => {
  // With `SHORE_WET_SWELL` at zero (as shipped) the seam sits at the same
  // fraction across every cross-section. The ribbon is 0.48 wide at a headland
  // and 0.80 in a bay, so the wet band still follows the beach.
  const loops = solveCoastLoops(SHOT_BOARD);
  const NOMINAL = 0.42;
  for (const loop of loops) {
    const stations = shoreStations(loop, BEACH_REACH, BEACH_TUCK);
    const u = stations.map((s) => wetLineU(s, NOMINAL));
    expect(SHORE_WET_SWELL).toBe(0);
    for (const each of u) expect(each).toBe(NOMINAL);
    // The seam's own width in world units is the ribbon's, times a constant.
    const widths = stations.map((s, i) => shoreReach(s) * (beachProfileU(WATER_Y) - u[i]));
    expect(Math.min(...widths)).toBeGreaterThan(0.09);
    expect(Math.max(...widths) / Math.min(...widths)).toBeCloseTo(
      Math.max(...stations.map(shoreReach)) / Math.min(...stations.map(shoreReach)),
      9,
    );
  }

  // At the old non-zero amplitudes: the seam is the shoreline's sine a phase
  // apart, so the two are correlated rather than independent.
  const SWELL = 0.07;
  const WET = 0.05;
  for (const loop of loops) {
    const stations = shoreStations(loop, BEACH_REACH, BEACH_TUCK, SWELL);
    const u = stations.map((s) => wetLineU(s, NOMINAL, WET));
    // Exactly `swellPeriods` turning points each way round.
    let extrema = 0;
    for (let i = 0; i < u.length; i++) {
      const a = u[(i - 1 + u.length) % u.length];
      const b = u[i];
      const c = u[(i + 1) % u.length];
      if ((b - a) * (c - b) < 0) extrema++;
    }
    expect(extrema).toBe(2 * swellPeriods(stations[0].length));

    // Correlate against the width's modulation, not the width: the width is
    // mostly the outline's doing, so difference against the unmodulated run.
    const plain = shoreStations(loop, BEACH_REACH, BEACH_TUCK);
    const moved = stations.map((s, i) => shoreReach(s) - shoreReach(plain[i]));
    // The sine scales a cross-section rather than extending it, so a station's
    // width moves by `SWELL * width / BEACH_REACH` (up to 0.10 in a bay). Scaling
    // is what stops a station folding over its neighbour.
    for (let i = 0; i < moved.length; i++)
      expect(Math.abs(moved[i])).toBeLessThanOrEqual(
        (SWELL * shoreReach(plain[i])) / BEACH_REACH + 1e-9,
      );
    expect(Math.max(...moved.map(Math.abs))).toBeGreaterThan(SWELL);

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mx = mean(moved);
    const my = mean(u);
    const cov = mean(moved.map((x, i) => (x - mx) * (u[i] - my)));
    const sx = Math.sqrt(mean(moved.map((x) => (x - mx) ** 2)));
    const sy = Math.sqrt(mean(u.map((y) => (y - my) ** 2)));
    // cos(SHORE_WET_PHASE) once both are sampled on the same arc length.
    expect(Math.abs(cov / (sx * sy)), "one shore, not two").toBeGreaterThan(0.15);
    expect(Math.abs(cov / (sx * sy)), "and not the same curve twice").toBeLessThan(0.9);
    expect(cov / (sx * sy)).toBeCloseTo(Math.cos(SHORE_WET_PHASE), 2);
  }
});

test("headland arcs are fine and the coast is order-independent", () => {
  const loops = solveCoastLoops(SHOT_BOARD);
  // The fan is control points for the smoothing: six across 60 degrees puts the
  // polyline within 0.004 of a circle. Bounded as a fraction of the reach,
  // since the sagitta scales with the radius.
  const chord = 2 * BEACH_REACH * Math.sin(Math.PI / 3 / HEADLAND_FACETS / 2);
  const sagitta = BEACH_REACH - Math.sqrt(BEACH_REACH ** 2 - (chord / 2) ** 2);
  expect(sagitta / BEACH_REACH).toBeLessThan(0.004);
  expect(MITRE).toBeCloseTo(1 / Math.cos(Math.PI / 6), 12);

  // Deterministic: same tiles, same coast, whatever order they arrive in.
  const once = footprint(loops[0]);
  const again = footprint(solveCoastLoops([...SHOT_BOARD].reverse())[0]);
  expect(again.length).toBe(once.length);
  for (let i = 0; i < once.length; i++) {
    expect(again[i][0]).toBeCloseTo(once[i][0], 12);
    expect(again[i][1]).toBeCloseTo(once[i][1], 12);
  }
});
