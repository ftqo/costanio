// The coast's cross-section: how it falls, how wide it is, and how much of the
// water it may take.
//
// The shoreline's plan shape (smooth, closed, not self-crossing) is
// `shoreCurve.test.ts`. assetAnchors.test.ts only checks the shipped beach
// agrees with the built one; these check what the shape should be.
import { test, expect } from "vitest";
import {
  APOTHEM,
  BEACH_ENVELOPE,
  BEACH_FOOT_Y,
  BEACH_REACH,
  BEACH_SHAPE,
  BEACH_TUCK,
  BEACH_WET_TOP_Y,
  BEACH_WIDTH,
  DRY_WIDTH,
  TOP_Y,
  WATER_Y,
  WET_WIDTH,
  beachHeightAt,
  beachProfileU,
  beachProfileY,
  beachRibbonGeometry,
  beachStripGeometry,
  shorePointAt,
  shoreReach,
  shoreSamples,
  shoreWetU,
  type SandKind,
} from "./beachGeometry";
import { MITRE, SHORE_SAMPLE_STEP, SHORE_SMOOTH_PULL, SHORE_SWELL } from "./shoreCurve";
import { solveCoastLoops } from "./coastline";
import { LATTICE_SIZE } from "./coords";
import { TILE_APOTHEM, LATTICE_APOTHEM } from "./gapGeometry";
import board from "../../../dev/board-shots.board.json";
import type { BoardTile } from "@/lib/types";

/** The real thing: the board `make board-shot` photographs, dumped by the engine. */
const SHOT_BOARD = (board as unknown as { tiles: BoardTile[] }).tiles;

const land = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "wood", num: 8 });

test("the beach descends from land height to below the sea", () => {
  // One slope with no level stretch and no end above the water.
  expect(beachProfileY(0)).toBe(TOP_Y);
  expect(beachProfileY(1)).toBeCloseTo(BEACH_FOOT_Y, 12);
  expect(BEACH_FOOT_Y).toBeLessThan(WATER_Y);
  // The foot buys pitch without width: a raised foot over the same reach is
  // the same pitch on a narrower ribbon (a longer reach would close a one-hex
  // strait). It spends the sea's floor; see `SHORE_FOOT_CLEARANCE` in
  // ocean.ts, 0.022 at this foot.

  let previous = Infinity;
  let flattest = Infinity;
  let steepest = 0;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const y = beachProfileY(u);
    expect(y, `sand at ${u}`).toBeLessThan(previous);
    if (i > 0) {
      flattest = Math.min(flattest, (previous - y) / (1 / 400));
      steepest = Math.max(steepest, (previous - y) / (1 / 400));
    }
    previous = y;
  }
  // Nowhere level. The pitch is checked against the constants rather than
  // pinned, since reach, shape and crest are tuning knobs. What must hold at
  // any setting: one slope (no plate at the crest, no cliff at the foot) with
  // the mean fall inside it.
  const fall = TOP_Y - BEACH_FOOT_Y; // the mean rise per unit of u
  const deg = (rise: number) => (Math.atan(rise / BEACH_REACH) * 180) / Math.PI;
  expect(flattest, "nowhere level").toBeGreaterThan(0);
  expect(flattest).toBeLessThan(fall);
  expect(steepest).toBeGreaterThan(fall);
  expect(steepest / flattest, "steepest/flattest slope ratio").toBeLessThan(6);
  expect(deg(steepest), "steepest slope in degrees").toBeLessThan(30);
});

test("the visible sand band width is set by the board", () => {
  // `WATER_Y` is `SURFACE.sea` (ships float there, the flat ocean lies there),
  // so the beach must pass through it. Where it crosses sets the ring's width.
  const u = beachProfileU(WATER_Y);
  expect(beachProfileY(u)).toBeCloseTo(WATER_Y, 9);
  // The waterline is inside the ribbon: sand above and below it.
  expect(u).toBeGreaterThan(0.2);
  expect(u).toBeLessThan(0.8);
  const exposed = u * BEACH_REACH;

  // Width is a tuning choice (0.86 visible now). What binds it is checked
  // elsewhere: `a narrow beach leaves a one-hex strait open` here and the
  // pond and envelope checks in `shoreCurve.test.ts`.
  expect(exposed).toBeLessThan(BEACH_WIDTH);
  expect(exposed).toBeLessThan(BEACH_ENVELOPE);
  // The knobs are bounded rather than pinned: they stay in the profile's
  // domain and the sand stays inside the water hex it borrows.
  expect(BEACH_SHAPE).toBeGreaterThan(0);
  expect(BEACH_SHAPE).toBeLessThan(1);
  expect(BEACH_REACH).toBeLessThan(APOTHEM);
});

test("the wet band is a narrow line at the water's edge", () => {
  const wet = beachProfileU(BEACH_WET_TOP_Y);
  expect(BEACH_WET_TOP_Y).toBeGreaterThan(WATER_Y); // above the water at rest
  expect(BEACH_WET_TOP_Y).toBeLessThan(TOP_Y); // and below the dry crest
  const dry = wet * BEACH_REACH;
  const band = (beachProfileU(WATER_Y) - wet) * BEACH_REACH;
  // The dry/wet split is held as a ratio. The dry band should be at least twice
  // the wet one, or it reads as a wet beach rather than a waterline (3.7x now).
  expect(dry + band).toBeCloseTo(beachProfileU(WATER_Y) * BEACH_REACH, 12);
  expect(dry / band, "dry/wet width ratio").toBeGreaterThan(2);
  expect(band, "wet band width").toBeGreaterThan(0.05);
  expect(band / (dry + band)).toBeLessThan(0.34);
});

test("every station is a well-formed cross-section", () => {
  // The outline has no corners, so check every cross-section runs the right
  // way and they are evenly spaced.
  const loops = solveCoastLoops([land(0, 0), land(1, 0), land(0, 1)]);
  expect(loops.length).toBeGreaterThan(0);
  for (const loop of loops) {
    const stations = shoreSamples(loop);
    expect(stations.length).toBeGreaterThan(loop.length);
    for (const s of stations) {
      // Lip behind the coast, foot in front, on one line; a folded station
      // would draw sand over its own land.
      const out = [s.foot[0] - s.base[0], s.foot[1] - s.base[1]];
      const back = [s.base[0] - s.lip[0], s.base[1] - s.lip[1]];
      expect(out[0] * back[0] + out[1] * back[1], "lip behind, foot ahead").toBeGreaterThan(0);
      expect(Math.hypot(back[0], back[1])).toBeLessThanOrEqual(BEACH_TUCK * MITRE + 1e-9);
      // The cross-section's own length, which at a bay runs along the mitre and
      // is longer than the perpendicular width. `BEACH_ENVELOPE` bounds distance
      // from the coast; see `shoreCurve.test.ts`.
      //
      // Smoothing moves a corner by at most `SHORE_SMOOTH_PULL` toward the
      // inside of its turn, which shortens a headland's section from
      // `BEACH_REACH` and lengthens a bay's from `BEACH_REACH * MITRE`. Measured
      // 0.779 and 1.480 against bounds of 0.673 and 1.481 (a headland's offset
      // is an arc, so it keeps more).
      expect(shoreReach(s)).toBeGreaterThan(BEACH_REACH - SHORE_SMOOTH_PULL);
      expect(shoreReach(s)).toBeLessThanOrEqual(BEACH_REACH * MITRE + SHORE_SMOOTH_PULL);
      // The seam is inside the ribbon with sand either side of it.
      expect(shoreWetU(s)).toBeGreaterThan(0.1);
      expect(shoreWetU(s)).toBeLessThan(beachProfileU(WATER_Y));
    }
    // Evenly spaced along the curve; a lagging station shows as a long facet.
    const steps: number[] = [];
    for (let i = 0; i < stations.length; i++) {
      const a = stations[i].foot;
      const b = stations[(i + 1) % stations.length].foot;
      steps.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    expect(Math.max(...steps)).toBeLessThan(SHORE_SAMPLE_STEP * 1.15);
    expect(Math.min(...steps)).toBeGreaterThan(SHORE_SAMPLE_STEP * 0.75);
  }
});

test("the sand covers the gutter and stops short of the tile", () => {
  // The lip runs back under the land's half of the gutter to hide the seam
  // along the tile rim, and must stop short of the tile itself.
  const halfGutter = LATTICE_APOTHEM - TILE_APOTHEM;
  expect(BEACH_TUCK).toBeGreaterThan(0);
  expect(BEACH_TUCK * MITRE, "even mitred at a corner").toBeLessThan(halfGutter);
});

test("a narrow beach leaves a one-hex strait open", () => {
  // The crossing at the middle of a water hex: two coasts 2*APOTHEM apart,
  // each spending BEACH_ENVELOPE. Real, but not where a strait is narrowest.
  expect(BEACH_ENVELOPE).toBeCloseTo(
    (BEACH_REACH + SHORE_SMOOTH_PULL) * (1 + SHORE_SWELL / BEACH_REACH),
    12,
  );
  expect(BEACH_ENVELOPE).toBeLessThan(APOTHEM);
  // 1.59 of open water at a hex's middle. Stated against the lattice because
  // the reach is a tuning knob and this is what it costs.
  expect(2 * APOTHEM - 2 * BEACH_ENVELOPE).toBeGreaterThan(LATTICE_SIZE / 3);

  // The narrowest point is the lattice edge between two water hexes in a row,
  // where headlands from either side are one LATTICE_SIZE (3.144) apart.
  // Measured on a real row of water with land two rows deep either side.
  const strait: BoardTile[] = [];
  for (let q = -6; q <= 6; q++) {
    strait.push({ hex: { q, r: 0 }, res: "sea", num: 0 });
    strait.push(land(q, -1));
    strait.push(land(q + 1, -2));
    strait.push(land(q - 1, 1));
    strait.push(land(q - 1, 2));
  }
  const banks = solveCoastLoops(strait).map(shoreSamples);
  expect(banks.length).toBe(2);
  const gap = (u: number | null): number => {
    let best = Infinity;
    for (const a of banks[0])
      for (const b of banks[1]) {
        const [p, q] = [
          u === null ? a.foot : shorePointAt(a, u),
          u === null ? b.foot : shorePointAt(b, u),
        ];
        best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
      }
    return best;
  };
  // 0.30 at the submerged foot: this is what limits the reach. The foot is the
  // widest part of the ribbon, so each 0.1 of reach costs about 0.21 here and
  // the banks meet at a reach of about 1.74. The check is that they never touch.
  expect(gap(null), "gap between banks").toBeGreaterThan(0);
  // At the mean waterline the pinch keeps 1.84 and a hex's middle keeps 3.98,
  // both wider than half a lattice cell, so a strait reads as water.
  expect(gap(beachProfileU(WATER_Y))).toBeGreaterThan(gap(null));
  expect(gap(beachProfileU(WATER_Y))).toBeGreaterThan(LATTICE_SIZE / 2);
  const waterline = 2 * APOTHEM - 2 * beachProfileU(WATER_Y) * BEACH_REACH;
  expect(waterline).toBeGreaterThan(LATTICE_SIZE);
});

test("the ribbon is built once and stays small", () => {
  // Static geometry, built and freed with the board (see `instanceGeometry`'s
  // OWNS_GEOMETRY). Pinned because the sampling step multiplies it.
  const loops = solveCoastLoops(SHOT_BOARD);
  const tris = (kind: SandKind) =>
    beachRibbonGeometry(loops, kind).getAttribute("position").count / 3;
  const total = tris("dry") + tris("wet");
  expect(total).toBeGreaterThan(4000);
  expect(total, "vertex count for a whole board's coast").toBeLessThan(9000);
});

test("the ribbon is wound so its top faces up", () => {
  // A double-sided material shades a back face with the normal negated, so a
  // ribbon wound the wrong way lights like its underside.
  const loops = solveCoastLoops([land(0, 0)]);
  const geo = beachRibbonGeometry(loops, "dry");
  const pos = geo.getAttribute("position");
  const normal = geo.getAttribute("normal");
  let up = 0;
  let down = 0;
  for (let i = 0; i < pos.count; i += 3) {
    // Only near-horizontal faces; the skirts are vertical.
    if (Math.abs(normal.getY(i)) < 0.5) continue;
    if (normal.getY(i) > 0) up++;
    else down++;
  }
  expect(up).toBeGreaterThan(0);
  expect(down).toBe(0);
});

test("the reference cross-section is unchanged", () => {
  // beach.glb ships the canonical strip and wedge, generated from
  // these constants by tools/blender/lattice.py for modelling against, and
  // assetAnchors.test.ts holds them together. Nothing draws them, but the .glb
  // cannot be regenerated from here, so these numbers are frozen.
  expect(DRY_WIDTH).toBeCloseTo(0.7975, 12);
  expect(WET_WIDTH).toBeCloseTo(0.605, 12);
  expect(BEACH_WIDTH).toBeCloseTo(DRY_WIDTH + WET_WIDTH, 12);
  expect(beachHeightAt(0)).toBe(TOP_Y);
  expect(beachHeightAt(BEACH_WIDTH)).toBeCloseTo(WATER_Y, 12);

  const strip = beachStripGeometry("dry").getAttribute("position");
  const xs = Array.from({ length: strip.count }, (_, i) => strip.getX(i));
  expect(Math.max(...xs)).toBeCloseTo(APOTHEM, 6);
  expect(Math.min(...xs)).toBeCloseTo(APOTHEM - DRY_WIDTH, 6);
  const zs = Array.from({ length: strip.count }, (_, i) => strip.getZ(i));
  expect(Math.max(...zs)).toBeCloseTo(LATTICE_SIZE / 2, 6);
});

test("the reference cross-section bounds the visible beach", () => {
  // The ribbon from the crest to the mean waterline lies inside the reference
  // prism, at or below its top face, at both nominal and widest width.
  for (let i = 0; i <= 100; i++) {
    const u = (beachProfileU(WATER_Y) * i) / 100;
    expect(beachProfileY(u), "at the beach's nominal width").toBeLessThanOrEqual(
      beachHeightAt(u * BEACH_REACH) + 1e-12,
    );
    expect(beachProfileY(u), "at the beach's widest").toBeLessThanOrEqual(
      beachHeightAt(u * BEACH_ENVELOPE) + 1e-12,
    );
  }
});
