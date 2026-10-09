import { test, expect } from "vitest";
import {
  CHIP_DISC_RADIUS,
  CHIP_FLIP,
  CHIP_HALF_THICKNESS,
  ROBBER_FLIP,
  ROBBER_HALF_HEIGHT,
  ROBBER_HALF_WIDTH,
  flipAxisY,
  flipPose,
  stillFlipping,
  type FlipSpec,
} from "./flip";

test("a flip that has not started is at rest and not done", () => {
  // At rest, because the ticker never calls back under reduced motion and a
  // piece lifted up front would hang in the air. Not done, because the carrier
  // stops on the frame a pose reports done, and a flip's first frame can land
  // on elapsed 0.
  for (const spec of [CHIP_FLIP, ROBBER_FLIP]) {
    expect(flipPose(spec, 0)).toEqual({ lift: 0, tilt: 0, done: false });
    expect(flipPose(spec, -50)).toEqual({ lift: 0, tilt: 0, done: false });
  }
});

test("a finished flip is at rest, exactly, and stays there", () => {
  // The ticker poses one frame past the end; any residual is a permanent offset.
  for (const spec of [CHIP_FLIP, ROBBER_FLIP]) {
    expect(flipPose(spec, spec.ms)).toEqual({ lift: 0, tilt: 0, done: true });
    expect(flipPose(spec, spec.ms * 10)).toEqual({ lift: 0, tilt: 0, done: true });
  }
});

test("mid-flip the piece is off the board and partway round", () => {
  const p = flipPose(CHIP_FLIP, CHIP_FLIP.ms / 2);
  expect(p.done).toBe(false);
  expect(p.lift).toBeGreaterThan(0);
  expect(p.tilt).toBeGreaterThan(0);
  expect(p.tilt).toBeLessThan(Math.PI * 2);
});

test("the turn is one full revolution, and only ever forward", () => {
  let prev = -1;
  for (let t = 0; t <= CHIP_FLIP.ms; t += CHIP_FLIP.ms / 64) {
    const { tilt } = flipPose(CHIP_FLIP, t);
    if (t < CHIP_FLIP.ms) {
      expect(tilt).toBeGreaterThanOrEqual(prev);
      prev = tilt;
    }
  }
  // Nearly the whole turn by the last frame, never past it: overshooting 2pi
  // would rock back on landing.
  expect(flipPose(CHIP_FLIP, CHIP_FLIP.ms - 1).tilt).toBeGreaterThan(Math.PI * 1.9);
  expect(flipPose(CHIP_FLIP, CHIP_FLIP.ms - 1).tilt).toBeLessThanOrEqual(Math.PI * 2);
});

test("the hop leaves the board and comes back to it", () => {
  for (const spec of [CHIP_FLIP, ROBBER_FLIP]) {
    const peak = flipPose(spec, spec.ms / 2).lift;
    expect(peak).toBeCloseTo(spec.lift, 5);
    expect(flipPose(spec, spec.ms * 0.1).lift).toBeGreaterThan(0);
    expect(flipPose(spec, spec.ms * 0.1).lift).toBeLessThan(peak);
    expect(flipPose(spec, spec.ms * 0.9).lift).toBeLessThan(peak);
    // The piece never digs into the board it stands on.
    for (let t = 0; t <= spec.ms; t += spec.ms / 32) {
      expect(flipPose(spec, t).lift).toBeGreaterThanOrEqual(0);
    }
  }
});

test("a flip picked up mid-turn by a rebuild carries on", () => {
  // The board is replaced while a piece is still turning.
  expect(stillFlipping(CHIP_FLIP, 1000, 1000)).toBe(true);
  expect(stillFlipping(CHIP_FLIP, 1000, 1000 + CHIP_FLIP.ms / 2)).toBe(true);
  expect(stillFlipping(CHIP_FLIP, 1000, 1000 + CHIP_FLIP.ms - 1)).toBe(true);
  // The window is per spec: the robber turns for longer than the chips.
  expect(stillFlipping(ROBBER_FLIP, 1000, 1000 + CHIP_FLIP.ms + 1)).toBe(true);
});

test("a flip that has already landed is not picked up again", () => {
  // Same boundary `flipPose` reports done at, or the first frame would arm a
  // subscription only to stop it.
  expect(stillFlipping(CHIP_FLIP, 1000, 1000 + CHIP_FLIP.ms)).toBe(false);
  expect(stillFlipping(CHIP_FLIP, 1000, 1000 + CHIP_FLIP.ms * 10)).toBe(false);
  expect(stillFlipping(ROBBER_FLIP, 1000, 1000 + ROBBER_FLIP.ms)).toBe(false);
  // A rebuild long after a roll must not replay it.
  expect(stillFlipping(CHIP_FLIP, 0, 600000)).toBe(false);
});

test("a start time in the future is refused, however far in the future", () => {
  // A rebuilt rig brings a new ticker whose clock starts at zero, so a flip
  // stamped by the old one reads as in the future. Arming it would leave a
  // subscription that never reports done pinned on the ticker.
  expect(stillFlipping(CHIP_FLIP, 1, 0)).toBe(false);
  expect(stillFlipping(CHIP_FLIP, 120000, 0)).toBe(false);
  expect(stillFlipping(ROBBER_FLIP, 120000, 100)).toBe(false);
  // The flip it would have armed never finishes.
  expect(flipPose(CHIP_FLIP, 0 - 120000).done).toBe(false);
});

/**
 * The lowest point of a turning piece, relative to the surface it rests on.
 *
 * Both pieces turn about their own middle, so at rest the pivot stands
 * `halfHeight` above that surface. Tilted, the piece reaches
 * `halfWidth*|sin tilt| + halfHeight*|cos tilt|` below the pivot; it is a
 * solid, so both terms count.
 */
function clearance(spec: FlipSpec, halfWidth: number, halfHeight: number) {
  let worst = Infinity;
  let worstAt = 0;
  for (let i = 0; i <= 2000; i++) {
    const t = (i / 2000) * spec.ms;
    const { lift, tilt } = flipPose(spec, t);
    const reach = halfWidth * Math.abs(Math.sin(tilt)) + halfHeight * Math.abs(Math.cos(tilt));
    const gap = lift + halfHeight - reach;
    if (gap < worst) {
      worst = gap;
      worstAt = t;
    }
  }
  return { worst, worstAt };
}

test("the chip never turns through the tile it is lying on", () => {
  // The invariant the lift exists for: the tile is an opaque slab, so a rim
  // that dips below its face is a chip buried in the board. Sampled densely
  // because the worst moment is not an endpoint or the apex: the turn is eased
  // and the hop is not, so the chip is edge-on about a third of the way
  // through.
  const { worst, worstAt } = clearance(CHIP_FLIP, CHIP_DISC_RADIUS, CHIP_HALF_THICKNESS);
  // Zero is lying on the tile; touching is allowed within a float epsilon.
  expect(worst, `lowest point of the disc at ${worstAt.toFixed(1)}ms`).toBeGreaterThan(-1e-9);
});

test("the robber never turns through the tile it is standing on", () => {
  // Same invariant for a piece shaped the other way round, which is why the
  // specs cannot share a lift: the robber is taller than wide, so its worst
  // moment is the diagonal.
  const { worst, worstAt } = clearance(ROBBER_FLIP, ROBBER_HALF_WIDTH, ROBBER_HALF_HEIGHT);
  expect(worst, `lowest point of the robber at ${worstAt.toFixed(1)}ms`).toBeGreaterThan(-1e-9);
});

test("neither lift carries more margin than its clearance needs", () => {
  // Both lifts are derived, so each should sit just above the minimum that
  // clears. A piece thrown much higher stops reading as being turned over on a
  // table. No lift needs to exceed the half-diagonal it is clearing.
  const diagonal = (w: number, h: number) => Math.hypot(w, h);
  expect(CHIP_FLIP.lift).toBeLessThan(diagonal(CHIP_DISC_RADIUS, CHIP_HALF_THICKNESS) * 1.5);
  expect(ROBBER_FLIP.lift).toBeLessThan(diagonal(ROBBER_HALF_WIDTH, ROBBER_HALF_HEIGHT) * 1.5);
});

test("the axis is square to the camera, so the turn reads as a flip", () => {
  // Sweep the orbit: whichever way the board is being looked at, the axis lies
  // in the ground plane at right angles to the view.
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    const dir = { x: Math.cos(a), z: Math.sin(a) }; // where the camera is looking
    const phi = flipAxisY(dir.x, dir.z);
    const axis = { x: Math.cos(phi), z: Math.sin(phi) };
    expect(axis.x * dir.x + axis.z * dir.z).toBeCloseTo(0, 6);
  }
});

test("a positive turn lifts the edge nearest the camera first", () => {
  // Which perpendicular is chosen decides whether the piece tips toward or
  // away from the viewer, and the sign is easy to get backwards. The near edge
  // is -dir; the vertical component of axis x near says which way that edge
  // moves at t = 0+.
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    const dir = { x: Math.cos(a), z: Math.sin(a) };
    const phi = flipAxisY(dir.x, dir.z);
    const axis = { x: Math.cos(phi), z: Math.sin(phi) };
    const near = { x: -dir.x, z: -dir.z };
    const upward = axis.z * near.x - axis.x * near.z; // (axis x near) . y
    expect(upward).toBeGreaterThan(0);
  }
});
