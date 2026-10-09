// Screen point -> lattice feature.
//
// Picking inverts coords.ts rather than raycasting the art. A ray hit on an
// InstancedMesh says which tile was struck, not which corner, and sculpted
// terrain and gutter props (a pine tree) would intercept rays meant for a
// vertex. Instead: intersect the ray with the board plane and snap to the
// nearest candidate. Candidates are only the currently pointable targets (see
// targets.ts), each drawn as a marker, so no click can select something
// illegal, off-turn, or hidden under a hill.
import * as THREE from "three";
import { LATTICE_SIZE } from "./coords";
import { SURFACE } from "./seating";

/**
 * The plane the pointer ray is intersected with: one plane at the tile surface
 * rather than each target's y. The kinds differ by 0.03 world units on a
 * 3-unit lattice, which moves the hit by well under a tenth of the smallest
 * snap radius.
 */
export const PICK_PLANE_Y = SURFACE.land;

/**
 * How close a pointer has to land, per kind, in world units.
 *
 * Derived from the lattice. An edge midpoint is `LATTICE_SIZE / 2` from each of
 * its vertices, and two edges meeting at a vertex have midpoints
 * `LATTICE_SIZE * sqrt(3) / 2` apart, so the vertex and edge radii stay under
 * half of those. When several kinds are live (inspect mode) the nearest
 * candidate, as a fraction of its own radius, wins.
 *
 * One radius for pointing and clicking: the hover previews what a click would
 * build, so it must cover exactly the clickable area. A hover is sticky on top
 * of this (see `hoverPick.ts`), and a mouse click commits the hover.
 *
 * Generous, because only legal spots are candidates: at 0.3 a vertex answered
 * on barely a fifth of the board, and the hand cursor kept going out between
 * spots the player was plainly aiming at.
 *
 * The hex radius is a full circumradius: hexes tile the plane and only legal
 * ones are candidates, so there is nothing to steal from, and the robber can
 * be placed by clicking anywhere on its tile.
 */
export const SNAP_RADIUS = {
  vertex: LATTICE_SIZE * 0.42,
  edge: LATTICE_SIZE * 0.36,
  hex: LATTICE_SIZE,
} as const;

/**
 * How close the pointer has to be to a piece for it to describe itself.
 *
 * Much tighter than `SNAP_RADIUS`: a hover isn't aimed, so generosity reads as
 * the board grabbing at you. At a full circumradius the robber claimed its
 * whole tile; these match the art's footprint, roughly "the pointer is on the
 * model".
 */
export const INFO_SNAP_RADIUS = {
  vertex: LATTICE_SIZE * 0.22,
  edge: LATTICE_SIZE * 0.18,
  hex: LATTICE_SIZE * 0.34,
} as const;

/**
 * How far the pointer may travel between press and release and still be a
 * click, in CSS pixels. A left-drag orbits the camera, so without this every
 * orbit would also place a piece. Allows a shaky hand or a touchscreen.
 */
export const CLICK_SLOP_PX = 6;

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Ndc {
  x: number;
  y: number;
}

/** A point on the board plane. y is implied by the plane, so it is not carried. */
export interface GroundPoint {
  x: number;
  z: number;
}

/**
 * Pointer position in normalized device coordinates.
 *
 * Measured against the canvas's bounding rect, never the window: index.css
 * applies CSS `zoom` past 1700px, and only a ratio of lengths in the same
 * zoomed space is right at every zoom factor.
 */
export function ndcFromClient(rect: CanvasRect, clientX: number, clientY: number): Ndc | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -(((clientY - rect.top) / rect.height) * 2 - 1),
  };
}

/**
 * Where the ray through `ndc` meets the horizontal plane at `planeY`.
 *
 * Null when the ray never gets there (parallel, or aimed at the sky), which
 * means the pointer is not over the board.
 */
export function groundPointAt(
  camera: THREE.Camera,
  ndc: Ndc,
  planeY: number = PICK_PLANE_Y,
): GroundPoint | null {
  const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position);
  if (Math.abs(dir.y) < 1e-9) return null;
  const t = (planeY - camera.position.y) / dir.y;
  if (!(t > 0) || !Number.isFinite(t)) return null;
  return { x: camera.position.x + dir.x * t, z: camera.position.z + dir.z * t };
}

/**
 * The minimum a thing needs to be snapped to: a kind (which sizes the snap) and
 * a place. Generic rather than tied to `PickTarget` because `planInfoPicks` in
 * targets.ts is picked the same way.
 */
export interface Snappable {
  kind: keyof typeof SNAP_RADIUS;
  pos: readonly [number, number, number];
}

/** A radius per kind. `SNAP_RADIUS` for clicks, `INFO_SNAP_RADIUS` for hovers. */
export type SnapRadii = Readonly<Record<Snappable["kind"], number>>;

/**
 * The nearest target to a point on the board plane, or null if none is close
 * enough. Compared in the plane only: a target's y is where its marker is
 * drawn, not part of where it is.
 */
export function nearestTarget<T extends Snappable>(
  targets: readonly T[],
  at: GroundPoint,
  radii: SnapRadii = SNAP_RADIUS,
): T | null {
  let best: T | null = null;
  let bestD2 = Infinity;
  for (const t of targets) {
    const dx = t.pos[0] - at.x;
    const dz = t.pos[2] - at.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestD2) continue;
    const r = radii[t.kind];
    if (d2 > r * r) continue;
    // A tie goes to the earlier target, i.e. planPickTargets' order: placement
    // markers before the pieces under them.
    if (d2 === bestD2) continue;
    best = t;
    bestD2 = d2;
  }
  return best;
}

/** The whole pick, from a pointer event's client coordinates. */
export function pickAt<T extends Snappable>(
  camera: THREE.Camera,
  rect: CanvasRect,
  clientX: number,
  clientY: number,
  targets: readonly T[],
  radii: SnapRadii = SNAP_RADIUS,
): T | null {
  if (!targets.length) return null;
  const ndc = ndcFromClient(rect, clientX, clientY);
  if (!ndc) return null;
  const at = groundPointAt(camera, ndc);
  if (!at) return null;
  return nearestTarget(targets, at, radii);
}

/** Was the gesture between these two screen points a click rather than a drag? */
export function isClick(
  down: { x: number; y: number },
  up: { x: number; y: number },
  slop: number = CLICK_SLOP_PX,
): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= slop;
}

/**
 * How far a tap may land from the spot it meant, in CSS pixels.
 *
 * `SNAP_RADIUS` is in world units and shrinks with the board: on a phone a
 * lattice side can be 16px, making an edge's radius about 4px. A touch that
 * misses the world radius falls back to the nearest legal target on screen
 * within this many pixels; only lit spots are candidates, so it can't reach
 * anything not offered. Half a comfortable touch target; more and taps in open
 * sea start building on the coast.
 */
export const TOUCH_SNAP_PX = 22;

/**
 * The pick for a pointer RELEASE: `pickAt`, and for a finger the on-screen
 * fallback described at `TOUCH_SNAP_PX`. A mouse gets exactly `pickAt`, so the
 * hover preview still covers its own click (see `SNAP_RADIUS`).
 */
export function pickTap<T extends Snappable>(
  camera: THREE.Camera,
  rect: CanvasRect,
  clientX: number,
  clientY: number,
  targets: readonly T[],
  touch: boolean,
  radiusPx: number = TOUCH_SNAP_PX,
): T | null {
  const hit = pickAt(camera, rect, clientX, clientY, targets);
  if (hit || !touch || !targets.length) return hit;
  let best: T | null = null;
  let bestD2 = radiusPx * radiusPx;
  const v = new THREE.Vector3();
  for (const t of targets) {
    v.set(t.pos[0], PICK_PLANE_Y, t.pos[2]).project(camera);
    // Behind the camera: not on screen at all.
    if (v.z > 1) continue;
    const dx = rect.left + ((v.x + 1) / 2) * rect.width - clientX;
    const dy = rect.top + ((1 - v.y) / 2) * rect.height - clientY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      best = t;
      bestD2 = d2;
    }
  }
  return best;
}
