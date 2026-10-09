import { test, expect } from "vitest";
import * as THREE from "three";
import { projectToFrame } from "./project";
import { groundPointAt, ndcFromClient } from "./picking";
import { boardExtent, makeCamera, applyHudInset, frameTarget } from "./scene";
import type { BoardTile } from "@/lib/types";

// A board centred on the origin, so `frameTarget` is (near enough) the origin
// and "the middle of the frame" and "the world origin" are the same claim.
const tiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 1, r: 0 }, res: "ore", num: 5 },
  { hex: { q: -1, r: 0 }, res: "brick", num: 6 },
  { hex: { q: 0, r: 1 }, res: "sheep", num: 9 },
  { hex: { q: 0, r: -1 }, res: "wheat", num: 4 },
];
const extent = boardExtent(tiles);

function camera(): THREE.PerspectiveCamera {
  const cam = makeCamera(16 / 9, extent);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** The board's pivot, which is what `makeCamera` aims dead centre. */
function centre(): [number, number, number] {
  const t = frameTarget(extent);
  return [t.x, t.y, t.z];
}

test("the point the camera aims at lands in the middle of the frame", () => {
  const p = projectToFrame(centre(), camera());
  expect(p.fx).toBeCloseTo(0.5, 5);
  expect(p.fy).toBeCloseTo(0.5, 5);
  expect(p.behind).toBe(false);
});

test("world +x is frame-right and world +z is frame-down", () => {
  const cam = camera();
  const [cx, cy, cz] = centre();
  // coords.ts's sign convention: +z is the bottom of the screen, as +y is on
  // the SVG board. Flipped, the 3D board would mirror the 2D one.
  expect(projectToFrame([cx + 3, cy, cz], cam).fx).toBeGreaterThan(0.5);
  expect(projectToFrame([cx - 3, cy, cz], cam).fx).toBeLessThan(0.5);
  expect(projectToFrame([cx, cy, cz + 3], cam).fy).toBeGreaterThan(0.5);
  expect(projectToFrame([cx, cy, cz - 3], cam).fy).toBeLessThan(0.5);
});

test("lifting a point off the board moves it up the frame", () => {
  const cam = camera();
  const [cx, cy, cz] = centre();
  const ground = projectToFrame([cx, cy, cz], cam);
  const above = projectToFrame([cx, cy + 2, cz], cam);
  expect(above.fy).toBeLessThan(ground.fy);
});

test("a point behind the camera is flagged rather than clamped", () => {
  const cam = camera();
  // Straight out the back: the camera is on +z of the target looking at it,
  // so further along +z is behind it.
  const behind = new THREE.Vector3()
    .copy(cam.position)
    .add(cam.position.clone().sub(frameTarget(extent)));
  const p = projectToFrame([behind.x, behind.y, behind.z], cam);
  expect(p.behind).toBe(true);
});

test("the HUD inset is already in the projection", () => {
  // applyHudInset is a setViewOffset, baked into the projection matrix, so
  // `project` picks it up; a caller correcting again would double the shift.
  const plain = camera();
  const inset = camera();
  applyHudInset(inset, 800, 600);
  const before = projectToFrame(centre(), plain);
  const after = projectToFrame(centre(), inset);
  expect(after.fy).toBeLessThan(before.fy);
  expect(after.fx).toBeCloseTo(before.fx, 5);
});

test("a zero inset clears the offset rather than shifting by nothing", () => {
  const cam = camera();
  applyHudInset(cam, 800, 600, 0);
  expect(projectToFrame(centre(), cam).fy).toBeCloseTo(0.5, 5);
});

test("projecting reuses its scratch result safely", () => {
  // The module reuses one Vector3. Interleaved projections must return
  // independent objects, not the scratch.
  const cam = camera();
  const [cx, cy, cz] = centre();
  const a = projectToFrame([cx - 3, cy, cz], cam);
  const b = projectToFrame([cx + 3, cy, cz], cam);
  expect(a).not.toBe(b);
  expect(a.fx).toBeLessThan(b.fx);
});

test("a left inset pushes the board right, and only right", () => {
  // The seat rail covers the left edge, so the board is framed into the
  // visible slice. Same mechanism as the bottom inset.
  const plain = camera();
  const inset = camera();
  applyHudInset(inset, 800, 600, { left: 0.14 });
  const before = projectToFrame(centre(), plain);
  const after = projectToFrame(centre(), inset);
  expect(after.fx).toBeGreaterThan(before.fx);
  expect(after.fy).toBeCloseTo(before.fy, 5);
});

test("both insets compose without fighting", () => {
  const plain = camera();
  const both = camera();
  applyHudInset(both, 800, 600, { left: 0.14, bottom: 0.12 });
  const before = projectToFrame(centre(), plain);
  const after = projectToFrame(centre(), both);
  expect(after.fx).toBeGreaterThan(before.fx);
  expect(after.fy).toBeLessThan(before.fy);
});

test("an inset of zero on both axes clears the offset", () => {
  const cam = camera();
  applyHudInset(cam, 800, 600, { left: 0, bottom: 0 });
  const p = projectToFrame(centre(), cam);
  expect(p.fx).toBeCloseTo(0.5, 5);
  expect(p.fy).toBeCloseTo(0.5, 5);
});

test("the number form still means a bottom inset", () => {
  // The original call shape still works.
  const a = camera();
  const b = camera();
  applyHudInset(a, 800, 600, 0.12);
  applyHudInset(b, 800, 600, { bottom: 0.12 });
  expect(projectToFrame(centre(), a)).toEqual(projectToFrame(centre(), b));
});

test("picking round-trips through an inset projection", () => {
  // The view offset is in the projection matrix, so picking's ndc -> world
  // unprojection must account for it (it does, via projectionMatrixInverse).
  // Project the board centre, pick that screen point, and land on the centre.
  const cam = camera();
  applyHudInset(cam, 800, 600, { left: 0.14, bottom: 0.12 });
  const p = projectToFrame(centre(), cam);
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  const target = frameTarget(extent);
  const at = groundPointAt(
    cam,
    ndcFromClient(rect, rect.left + p.fx * rect.width, rect.top + p.fy * rect.height)!,
    // The plane the projected point lies on. groundPointAt defaults to the
    // tile top, a different plane along the same ray.
    target.y,
  );
  expect(at).not.toBeNull();
  expect(at!.x).toBeCloseTo(target.x, 3);
  expect(at!.z).toBeCloseTo(target.z, 3);
});
