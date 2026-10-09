import { test, expect } from "vitest";
import { CHIP_SWAP, swapArc, swapPose, stillSwapping } from "./chipSwap";
import { CHIP_FLIP } from "./flip";
import { hexToWorld, type Vec3 } from "./coords";
import { CHIP_OFFSET_Z } from "./layers/chips";

/** Where a chip on `hex` actually rests, the way `planChips` seats one. */
function chipAt(q: number, r: number): Vec3 {
  const [x, , z] = hexToWorld({ q, r });
  return [x, 0, z + CHIP_OFFSET_Z];
}

/** The two ends of a swap between neighbours, which is the tightest one. */
const NEAR_A = chipAt(0, 0);
const NEAR_B = chipAt(1, 0);
/** And a long one, across a big board. */
const FAR_A = chipAt(-3, 0);
const FAR_B = chipAt(3, -1);

/** Where a chip that ends at `to` actually is, in world space, at time t. */
function pointAt(from: Vec3, to: Vec3, elapsedMs: number): Vec3 {
  const p = swapPose(CHIP_SWAP, from, to, elapsedMs);
  return [to[0] + p.offsetX, to[1] + p.lift, to[2] + p.offsetZ];
}

/** Sample the whole exchange, ends included. */
function samples(n = 64): number[] {
  return Array.from({ length: n + 1 }, (_, i) => (CHIP_SWAP.ms * i) / n);
}

test("an unstarted swap holds at the other hex and is not done", () => {
  // The chip starts where its number came from (it is drawn on its
  // destination), and must not report done on the frame it is armed, since the
  // carrier stops when a pose says done.
  for (const t of [0, -50]) {
    const p = swapPose(CHIP_SWAP, NEAR_A, NEAR_B, t);
    expect(p.done).toBe(false);
    expect(p.lift).toBe(0);
    expect([NEAR_B[0] + p.offsetX, NEAR_B[2] + p.offsetZ]).toEqual([NEAR_A[0], NEAR_A[2]]);
  }
});

test("a finished swap is seated exactly", () => {
  // The ticker poses one frame past the end, and the chip never moves again,
  // so any residual offset is permanent.
  for (const t of [CHIP_SWAP.ms, CHIP_SWAP.ms + 1, CHIP_SWAP.ms * 10]) {
    expect(swapPose(CHIP_SWAP, NEAR_A, NEAR_B, t)).toEqual({
      offsetX: 0,
      offsetZ: 0,
      lift: 0,
      done: true,
    });
  }
});

test("each chip arrives at the other one's hex", () => {
  // The chip ending on B set off from A, and vice versa.
  for (const [from, to] of [
    [FAR_A, FAR_B],
    [FAR_B, FAR_A],
  ] as const) {
    const start = pointAt(from, to, 1e-6);
    expect(start[0]).toBeCloseTo(from[0], 3);
    expect(start[2]).toBeCloseTo(from[2], 3);
    const end = pointAt(from, to, CHIP_SWAP.ms - 1e-6);
    expect(end[0]).toBeCloseTo(to[0], 3);
    expect(end[2]).toBeCloseTo(to[2], 3);
  }
});

test("the two chips are diametrically opposite at every instant", () => {
  // On a straight line the pair would meet head-on at the midpoint. On one
  // ellipse half a lap apart they reflect through its centre, so the sum of
  // their positions equals the sum of the two hexes at every t.
  for (const [a, b] of [
    [NEAR_A, NEAR_B],
    [FAR_A, FAR_B],
  ] as const) {
    for (const t of samples()) {
      const onA = pointAt(b, a, t); // ends at a, came from b
      const onB = pointAt(a, b, t); // ends at b, came from a
      expect(onA[0] + onB[0]).toBeCloseTo(a[0] + b[0], 6);
      expect(onA[2] + onB[2]).toBeCloseTo(a[2] + b[2], 6);
      // And the same height, so neither is hidden under the other.
      expect(onA[1]).toBeCloseTo(onB[1], 6);
    }
  }
});

test("the chips keep apart, even between adjacent hexes", () => {
  // Neighbouring hexes are 5.45 apart, and the chips pass at the ends of the
  // minor axis, half that, more than a chip's 2.0 diameter.
  let closest = Infinity;
  for (const t of samples(256)) {
    const onA = pointAt(NEAR_B, NEAR_A, t);
    const onB = pointAt(NEAR_A, NEAR_B, t);
    closest = Math.min(closest, Math.hypot(onA[0] - onB[0], onA[2] - onB[2]));
  }
  const centres = Math.hypot(NEAR_B[0] - NEAR_A[0], NEAR_B[2] - NEAR_A[2]);
  expect(closest).toBeCloseTo(2 * CHIP_SWAP.minorRatio * centres, 3);
  expect(closest).toBeGreaterThan(2.5);
});

test("the path bows off the straight line", () => {
  // A chip on the segment between the centres would slide through everything
  // and collide with its partner. Measured as distance from the line.
  for (const [a, b] of [
    [NEAR_A, NEAR_B],
    [FAR_A, FAR_B],
  ] as const) {
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const ux = (b[0] - a[0]) / d;
    const uz = (b[2] - a[2]) / d;
    let widest = 0;
    for (const t of samples(256)) {
      const p = pointAt(a, b, t);
      // Signed distance from the a-b line, using the same perpendicular.
      widest = Math.max(widest, Math.abs((p[0] - a[0]) * uz - (p[2] - a[2]) * ux));
    }
    expect(widest).toBeCloseTo(CHIP_SWAP.minorRatio * d, 3);
  }
});

test("the pair sweeps clockwise from the default camera", () => {
  // Screen right is world +x and screen down is world +z (coords.ts: the camera
  // looks down -z). Along x, the left-to-right chip goes over the top (-z) and
  // the right-to-left one underneath (+z): a clockwise lap.
  const left: Vec3 = [-6, 0, 0];
  const right: Vec3 = [6, 0, 0];
  const mid = CHIP_SWAP.ms / 2;
  expect(pointAt(left, right, mid)[2]).toBeLessThan(0);
  expect(pointAt(right, left, mid)[2]).toBeGreaterThan(0);
  // Not merely at the midpoint: neither chip ever crosses to the other side.
  for (const t of samples(128).slice(1, -1)) {
    expect(pointAt(left, right, t)[2]).toBeLessThanOrEqual(0);
    expect(pointAt(right, left, t)[2]).toBeGreaterThanOrEqual(0);
  }
});

test("the swap is clockwise in every direction", () => {
  // The direction depends on the shape, not which hex is named first, so it
  // must hold for every orientation. The cross product of travel direction
  // with bow has one sign for clockwise.
  for (let deg = 0; deg < 360; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    const a: Vec3 = [-6 * Math.cos(rad), 0, -6 * Math.sin(rad)];
    const b: Vec3 = [6 * Math.cos(rad), 0, 6 * Math.sin(rad)];
    const p = pointAt(a, b, CHIP_SWAP.ms / 2);
    // (b - a) x (p - midpoint), y component, midpoint at the origin. Positive is
    // the +z-ward quarter turn `swapPose` uses, clockwise on screen.
    const cross = (b[2] - a[2]) * p[0] - (b[0] - a[0]) * p[2];
    expect(cross, `${deg} degrees`).toBeGreaterThan(0);
  }
});

test("both chips lift off and land back on the board", () => {
  // As with the robber's carry: a chip dragged flat would cut through
  // everything between the hexes.
  for (const [from, to] of [
    [NEAR_A, NEAR_B],
    [FAR_A, FAR_B],
  ] as const) {
    const peak = swapPose(CHIP_SWAP, from, to, CHIP_SWAP.ms / 2).lift;
    expect(peak).toBeCloseTo(swapArc(CHIP_SWAP, from, to), 6);
    expect(peak).toBeGreaterThanOrEqual(CHIP_FLIP.lift);
    expect(peak).toBeLessThanOrEqual(CHIP_SWAP.arcMax);
    for (const t of samples()) {
      const { lift } = swapPose(CHIP_SWAP, from, to, t);
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThanOrEqual(peak + 1e-9);
    }
  }
});

test("the travel eases in and out at both ends", () => {
  // The lift is eased on the same clock as the horizontal (unlike `tripPose`,
  // which lands hard with a squash), so the descent must arrive at rest.
  const step = CHIP_SWAP.ms / 512;
  const speed = (t: number) => {
    const p = pointAt(NEAR_A, NEAR_B, t);
    const q = pointAt(NEAR_A, NEAR_B, t + step);
    return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / step;
  };
  const middle = speed(CHIP_SWAP.ms / 2);
  expect(speed(step)).toBeLessThan(middle / 8);
  expect(speed(CHIP_SWAP.ms - 2 * step)).toBeLessThan(middle / 8);
});

test("the path never doubles back", () => {
  // Smoothstep is monotone, so the chip only advances along the ellipse.
  let prev = -Infinity;
  for (const t of samples(256)) {
    const p = pointAt(FAR_A, FAR_B, t);
    // Progress along the major axis, monotone in theta over this half-lap.
    const along =
      (p[0] - FAR_A[0]) * (FAR_B[0] - FAR_A[0]) + (p[2] - FAR_A[2]) * (FAR_B[2] - FAR_A[2]);
    expect(along).toBeGreaterThanOrEqual(prev - 1e-9);
    prev = along;
  }
});

test("a zero-length swap returns a still pose", () => {
  // The engine never sends the same hex twice, but a divide by zero here would
  // put NaN in an instance matrix and three would drop the whole InstancedMesh.
  const p = swapPose(CHIP_SWAP, NEAR_A, NEAR_A, CHIP_SWAP.ms / 2);
  expect(p).toEqual({ offsetX: 0, offsetZ: 0, lift: 0, done: true });
});

test("CHIP_SWAP is slower than a flip and at most 700ms", () => {
  // Longer than a flip because two things move a real distance; short enough
  // not to wait through. `ROBBER_TRAVEL`'s cross-board ceiling is 620.
  expect(CHIP_SWAP.ms).toBeGreaterThan(CHIP_FLIP.ms);
  expect(CHIP_SWAP.ms).toBeLessThanOrEqual(700);
});

test("stillSwapping rejects stale and future stamps", () => {
  // Both edges of `stillFlipping`. The lower bound matters because a rebuilt
  // rig has a fresh ticker starting at zero, so an old stamp reads as future
  // and an unguarded negative elapsed would pin a subscriber forever.
  expect(stillSwapping(CHIP_SWAP, 1000, 1000)).toBe(true);
  expect(stillSwapping(CHIP_SWAP, 1000, 1000 + CHIP_SWAP.ms - 1)).toBe(true);
  expect(stillSwapping(CHIP_SWAP, 1000, 1000 + CHIP_SWAP.ms)).toBe(false);
  expect(stillSwapping(CHIP_SWAP, 100000, 5)).toBe(false);
});
