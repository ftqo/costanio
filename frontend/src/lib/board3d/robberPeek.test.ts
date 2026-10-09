import { test, expect, describe, it } from "vitest";
import * as THREE from "three";
import { CAMERA_TILT_DEG } from "./scene";
import { CHIP_DISC_RADIUS, ROBBER_HALF_HEIGHT, ROBBER_HALF_WIDTH, flipAxisY } from "./flip";
import { instanceGeometry, poseInstanceAt } from "./instancing";
import {
  PEEK_RIGHT_MS,
  PEEK_TILT,
  PEEK_TIP_MS,
  peekMoving,
  peekPivot,
  peekProgress,
  peekTilt,
  planPeek,
  stillPeek,
  type Peek,
} from "./robberPeek";

/** A camera looking north-east and down, so no axis is accidentally the answer. */
const AXIS = flipAxisY(0.6, 0.8);

test("a robber nobody is pointing at stands up straight", () => {
  // The empty pose must be exactly zero: `poseInstanceAt` skips the rotation
  // when `tilt` is falsy, and a residual angle would leave a rounded identity.
  expect(peekTilt(null, 0)).toBe(0);
  expect(peekTilt(null, 99999)).toBe(0);
  expect(peekMoving(null, 0)).toBe(false);
});

test("the tip reaches exactly its full angle, and stops there", () => {
  const peek = planPeek(null, true, AXIS, 1000)!;
  expect(peekTilt(peek, 1000)).toBe(0);
  expect(peekTilt(peek, 1000 + PEEK_TIP_MS)).toBeCloseTo(PEEK_TILT, 10);
  // Held, not overshot and not decayed: the pointer is still on the piece.
  expect(peekTilt(peek, 1000 + PEEK_TIP_MS * 10)).toBeCloseTo(PEEK_TILT, 10);
  expect(peekMoving(peek, 1000 + PEEK_TIP_MS * 10)).toBe(false);
});

test("standing back up returns to exactly upright", () => {
  const down = planPeek(null, true, AXIS, 0)!;
  const up = planPeek(down, false, AXIS, PEEK_TIP_MS)!;
  expect(peekTilt(up, PEEK_TIP_MS)).toBeCloseTo(PEEK_TILT, 10);
  // Exactly 0, for the reason above. `smooth(0)` is 0 and the progress clamps.
  expect(peekTilt(up, PEEK_TIP_MS + PEEK_RIGHT_MS)).toBe(0);
  expect(peekMoving(up, PEEK_TIP_MS + PEEK_RIGHT_MS)).toBe(false);
});

test("the piece is never in a hurry at either end", () => {
  // Smoothstepped, like the flip, so it reads as handled rather than spun.
  const peek = planPeek(null, true, AXIS, 0)!;
  const at = (t: number) => peekTilt(peek, PEEK_TIP_MS * t);
  expect(at(0.1)).toBeLessThan(PEEK_TILT * 0.1);
  expect(at(0.5)).toBeCloseTo(PEEK_TILT * 0.5, 10);
  expect(at(0.9)).toBeGreaterThan(PEEK_TILT * 0.9);
});

test("a reversal mid-flight is continuous, and never snaps", () => {
  // Why the peek has a from/to leg: brushing on and off, the piece catches
  // itself and comes back rather than jumping.
  const down = planPeek(null, true, AXIS, 0)!;
  const half = PEEK_TIP_MS / 2;
  const wasAt = peekTilt(down, half);

  const up = planPeek(down, false, AXIS, half)!;
  expect(peekTilt(up, half)).toBeCloseTo(wasAt, 10);

  // And it keeps heading back to upright without finishing the abandoned leg.
  let prev = wasAt;
  for (let t = half; t <= half + PEEK_RIGHT_MS; t += 8) {
    const now = peekTilt(up, t);
    expect(now).toBeLessThanOrEqual(prev + 1e-12);
    expect(now).toBeLessThanOrEqual(wasAt + 1e-12);
    prev = now;
  }
  expect(prev).toBe(0);
});

test("a reversal covers its shorter distance at the same speed", () => {
  // Durations are full-travel times: a quarter of the way down has a quarter
  // of the way back.
  const down = planPeek(null, true, AXIS, 0)!;
  const quarter = PEEK_TIP_MS / 4;
  const up = planPeek(down, false, AXIS, quarter)!;
  expect(peekProgress(up, quarter + PEEK_RIGHT_MS * 0.25)).toBeCloseTo(0, 10);
  expect(peekMoving(up, quarter + PEEK_RIGHT_MS * 0.25)).toBe(false);
  // Still moving just before that, so the carrier isn't stopped early.
  expect(peekMoving(up, quarter + PEEK_RIGHT_MS * 0.25 - 1)).toBe(true);
});

test("a pointer resting on the piece re-plans to the very same leg", () => {
  // `onPointerMove` calls this on every mouse sample; a fresh leg each time
  // would never get past the first frame.
  const down = planPeek(null, true, AXIS, 0)!;
  expect(planPeek(down, true, AXIS, 10)).toBe(down);
  expect(planPeek(down, true, AXIS, 10_000)).toBe(down);
  // And an un-hover of a piece that was never tipped carries no state at all.
  expect(planPeek(null, false, AXIS, 0)).toBeNull();
  const settled = planPeek(planPeek(down, false, AXIS, PEEK_TIP_MS), false, AXIS, 10_000);
  expect(settled).toBeNull();
});

test("a reversal keeps the axis the tip began with", () => {
  // Otherwise orbiting while the robber is down swings it sideways on the way
  // up. Same as `fireChipFlip`.
  const other = flipAxisY(-1, 0.2);
  const down = planPeek(null, true, AXIS, 0)!;
  const up = planPeek(down, false, other, PEEK_TIP_MS / 2)!;
  expect(up.axisY).toBe(AXIS);
  // A tip that starts from upright takes the current camera.
  const again = planPeek(null, true, other, 0)!;
  expect(again.axisY).toBe(other);
});

test("a leg stamped by a previous ticker lands rather than hanging", () => {
  // A rebuilt rig's clock starts at zero, so an old stamp reads as future and
  // would never finish, holding the ticker (see `stillFlipping`).
  const stale: Peek = { from: 0, to: 1, start: 900_000, axisY: AXIS };
  expect(peekMoving(stale, 0)).toBe(false);
  expect(peekTilt(stale, 0)).toBeCloseTo(PEEK_TILT, 10);
});

test("the reduced-motion peek is settled at every instant", () => {
  const still = stillPeek(true, AXIS)!;
  expect(peekMoving(still, 0)).toBe(false);
  expect(peekMoving(still, 1_000_000)).toBe(false);
  expect(peekTilt(still, 0)).toBeCloseTo(PEEK_TILT, 10);
  expect(peekTilt(still, 1_000_000)).toBeCloseTo(PEEK_TILT, 10);
  expect(stillPeek(false, AXIS)).toBeNull();
});

test("the pivot is the foot the piece falls over, one half-width out", () => {
  const p = peekPivot(AXIS);
  expect(Math.hypot(p.x, p.z)).toBeCloseTo(ROBBER_HALF_WIDTH, 10);
  // Along the camera's flattened view direction: away from the viewer.
  const dir = new THREE.Vector2(0.6, 0.8).normalize();
  expect(p.x).toBeCloseTo(dir.x * ROBBER_HALF_WIDTH, 10);
  expect(p.z).toBeCloseTo(dir.y * ROBBER_HALF_WIDTH, 10);
});

test("the robber tips away from the camera, never onto the chip", () => {
  // Tipping toward the viewer would lay the piece over the number it should
  // reveal. Checked through the real matrix maths, since `flipAxisY` is
  // documented as lifting a chip's near edge, which for a tall piece is the
  // same as falling away.
  const camera = new THREE.Vector3(-6, 9, -8);
  const seat = new THREE.Vector3(1, 0.5, 2);
  const view = new THREE.Vector3().subVectors(seat, camera);
  const axisY = flipAxisY(view.x, view.z);

  // A unit box at the robber's spot, at its drawn height, so its top is a real
  // point.
  const [mesh] = instanceGeometry(
    new THREE.BoxGeometry(2 * ROBBER_HALF_WIDTH, 2 * ROBBER_HALF_HEIGHT, 2 * ROBBER_HALF_WIDTH),
    new THREE.MeshBasicMaterial(),
    [
      {
        position: [seat.x, seat.y + ROBBER_HALF_HEIGHT, seat.z],
        groundY: seat.y,
        key: "robber",
      },
    ],
    "robber",
  );
  const topOf = () => {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    // The box's own +Y face centre, carried through whatever the pose did.
    return new THREE.Vector3(0, 1, 0).applyMatrix4(m);
  };

  const upright = topOf();
  const pivot = peekPivot(axisY);
  poseInstanceAt(mesh, 0, {
    tilt: PEEK_TILT,
    tiltAxisY: axisY,
    tiltPivotY: 0,
    tiltPivotX: pivot.x,
    tiltPivotZ: pivot.z,
  });
  const tipped = topOf();

  // Further from the camera by most of the piece's height.
  const before = camera.distanceTo(upright);
  const after = camera.distanceTo(tipped);
  expect(after).toBeGreaterThan(before + ROBBER_HALF_HEIGHT);
  // And leaning: the head is further out than it is up. (Rolling over the far
  // foot lifts as it turns, so at 75 degrees the head is still about half its
  // standing height.)
  const out = Math.hypot(tipped.x - seat.x, tipped.z - seat.z);
  expect(out).toBeGreaterThan(tipped.y - seat.y);
  expect(tipped.y - seat.y).toBeLessThan(ROBBER_HALF_HEIGHT * 2 * 0.6);
});

test("the tipped piece clears the chip it was standing on, on screen", () => {
  // `PEEK_TILT`'s derivation, pinned so changes to the art or camera fail
  // here. Screen-vertical offset of a world point at ground distance u (away
  // from the camera) and height v, for camera elevation e: u*sin e + v*cos e.
  const e = (CAMERA_TILT_DEG * Math.PI) / 180;
  const screenY = (u: number, v: number) => u * Math.sin(e) + v * Math.cos(e);

  // The piece's lowest point on screen is its near bottom corner, which starts
  // at ground offset -W and swings about the far bottom edge at +W.
  const W = ROBBER_HALF_WIDTH;
  const nearCorner = (t: number) => screenY(W - 2 * W * Math.cos(t), 2 * W * Math.sin(t));
  const chipFarRim = screenY(CHIP_DISC_RADIUS, 0);

  // Upright, the piece is well below the rim: it is standing on the chip.
  expect(nearCorner(0)).toBeLessThan(chipFarRim);
  // Tipped, the whole footprint has come off it.
  expect(nearCorner(PEEK_TILT)).toBeGreaterThan(chipFarRim);
  // And not by much: well beyond this the piece lies flat and reads as knocked
  // over.
  expect(PEEK_TILT).toBeLessThan(Math.PI / 2);
});

describe("playing dead", () => {
  // No separate dead angle: the piece rests at the hover height players know,
  // and `PEEK_TILT` is derived (75 degrees clears the chip's far rim).
  it("rests at the peek's own angle, not one of its own", () => {
    const leg = stillPeek(true, 0);
    expect(peekTilt(leg, 1_000_000)).toBeCloseTo(PEEK_TILT, 6);
  });

  it("still stands all the way up when it is let go", () => {
    expect(peekTilt(stillPeek(false, 0), 1_000_000)).toBeCloseTo(0, 6);
  });
});
