// The other direction through the camera: world position to a spot on the
// canvas, for things that belong to the board but are drawn in the DOM (a
// resource card flying out of the hex that produced it).
//
// Fractions of the canvas rather than pixels: index.css zooms the UI on wide
// screens (1.2 past 1700px, up to 2 at 4K), and under `zoom`
// getBoundingClientRect() reports zoomed pixels while style.left is read
// unzoomed (see Board3D's `resize`). The overlay writes
// `left: ${fx * 100}%`, which resolves against the same box.
import * as THREE from "three";

/** Where a world point lands on the canvas, as a fraction of its box. */
export interface FramePoint {
  /** 0 at the left edge, 1 at the right. Outside [0,1] is off-screen. */
  fx: number;
  /** 0 at the top edge, 1 at the bottom (CSS's direction, not NDC's). */
  fy: number;
  /**
   * The point is behind the camera, where the perspective divide mirrors the
   * projection. Callers should hide rather than clamp.
   */
  behind: boolean;
}

/**
 * A projection closed over one live camera. Handed out by the board because
 * the camera is rebuilt with the rig; see Board3D's `onProjector`.
 */
export type Projector = (world: readonly [number, number, number]) => FramePoint;

/**
 * Scratch vector: this runs per in-flight card per frame, so it avoids
 * allocation during the animation. Never outlives the call.
 */
const scratch = new THREE.Vector3();

/**
 * Where `world` currently appears on the canvas.
 *
 * No HUD offset correction: `applyHudInset` uses `setViewOffset`, which is in
 * the projection matrix, so `Vector3.project` already accounts for it.
 */
export function projectToFrame(
  world: readonly [number, number, number],
  camera: THREE.Camera,
): FramePoint {
  const p = scratch.set(world[0], world[1], world[2]).project(camera);
  // NDC is +y up and [-1, 1] on both axes; the page is +y down and [0, 1].
  return { fx: (p.x + 1) / 2, fy: (1 - p.y) / 2, behind: p.z > 1 };
}
