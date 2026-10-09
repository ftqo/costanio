// The hover's pick: which target the pointer is on, given which one it was on.
//
// `picking.ts` answers "what is near this point" afresh on every call, which
// is right for a tap and wrong for a hover. A hover is a hand drifting over
// the board, and a fresh answer per pointermove flickers at every radius
// boundary and drops to nothing in the gaps between them. So a hover is
// sticky:
//
//   ACQUIRE  a target is taken when the pointer comes within its snap radius
//            (`SNAP_RADIUS`, with a pixel floor; see `HOVER_FLOOR_PX`);
//   HOLD     it is kept until the pointer is `RELEASE_RATIO` times that far
//            away, so drifting a little off the spot does not drop it;
//   SWITCH   another target takes over only when it is clearly nearer
//            (`SWITCH_RATIO`), so a pointer on the border between two spots
//            does not flip between them.
//
// The hover is also what a mouse click commits (Board3D's `onPointerUp`), so
// whatever the preview shows is what a click builds. That is the point: the
// board used to keep a preview lingering in the gaps that a click there could
// not reach, and lose the hand cursor on the way back.
//
// Distances are measured in the world, normalised by each target's radius so
// kinds with different radii (inspect mode mixes vertices and edges) compete
// fairly. A target with a `body` is also measured against its standing volume
// rather than only its footprint: on a tilted camera a tall piece is drawn
// above its base, and a ray through the robber's body lands on the ground
// behind it.
import * as THREE from "three";
import {
  PICK_PLANE_Y,
  SNAP_RADIUS,
  ndcFromClient,
  type CanvasRect,
  type SnapRadii,
} from "./picking";

/**
 * A piece's standing volume: a vertical cylinder of radius `r` from `y0` to
 * `y1`, centred on its target's x and z. World units.
 */
export interface Body {
  y0: number;
  y1: number;
  r: number;
}

/** What the hover can pick: a key to remember it by, a kind, a place, maybe a body. */
export interface Hoverable {
  key: string;
  kind: keyof typeof SNAP_RADIUS;
  pos: readonly [number, number, number];
  body?: Body;
}

/**
 * How much further than its acquire radius a held target may drift before it
 * is let go. 1.4 on a vertex is 0.59 of a lattice side: past the midpoint to
 * the next vertex, so a sweep along a coast hands the preview from spot to
 * spot instead of dropping it between them.
 */
export const RELEASE_RATIO = 1.4;

/**
 * How much nearer (as a fraction of the held target's score) another target
 * must be to take over. Below 1 is the hysteresis band on a shared border.
 */
export const SWITCH_RATIO = 0.85;

/**
 * The least acquire radius, in CSS pixels, for a mouse. The world radii shrink
 * with the board: zoomed out on a small window a lattice side can be 30px,
 * making a vertex's radius about 12px. Below that a hover has to be aimed.
 */
export const HOVER_FLOOR_PX = 12;

/** The pointer as a ray from the camera, or null off the canvas. */
export function pointerRay(
  camera: THREE.Camera,
  rect: CanvasRect,
  clientX: number,
  clientY: number,
): THREE.Ray | null {
  const ndc = ndcFromClient(rect, clientX, clientY);
  if (!ndc) return null;
  const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(origin).normalize();
  return new THREE.Ray(origin, dir);
}

/** How far the ray passes from the board-plane point under `pos`, in the plane. Infinity if it never reaches the plane. */
function groundMiss(ray: THREE.Ray, pos: readonly [number, number, number]): number {
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-9) return Infinity;
  const t = (PICK_PLANE_Y - ray.origin.y) / dy;
  if (!(t > 0) || !Number.isFinite(t)) return Infinity;
  const x = ray.origin.x + ray.direction.x * t;
  const z = ray.origin.z + ray.direction.z * t;
  return Math.hypot(pos[0] - x, pos[2] - z);
}

/**
 * The closest the ray comes to the vertical segment (x, y0..y1, z).
 *
 * The usual two-line solve, then clamped: the segment parameter to its ends,
 * the ray parameter to the camera side. Each clamp re-solves the other, which
 * is exact for a segment against a half-line.
 */
export function segmentMiss(ray: THREE.Ray, x: number, z: number, y0: number, y1: number): number {
  const o = ray.origin;
  const u = ray.direction;
  // The segment as A + s * (0, h, 0), s in [0, 1].
  const h = y1 - y0;
  const wx = o.x - x;
  const wy = o.y - y0;
  const wz = o.z - z;
  const a = u.lengthSq();
  const b = u.y * h;
  const c = h * h;
  const d = u.x * wx + u.y * wy + u.z * wz;
  const e = h * wy;
  const den = a * c - b * b;
  let s = den > 1e-12 ? (a * e - b * d) / den : 0;
  s = Math.min(1, Math.max(0, s));
  let t = (b * s - d) / a;
  if (t < 0) {
    t = 0;
    s = c > 1e-12 ? Math.min(1, Math.max(0, e / c)) : 0;
  }
  const px = o.x + u.x * t - x;
  const py = o.y + u.y * t - (y0 + h * s);
  const pz = o.z + u.z * t - z;
  return Math.hypot(px, py, pz);
}

/** World units per CSS pixel at `pos`, for a perspective camera; 0 for anything else. */
export function worldPerPixel(
  camera: THREE.Camera,
  rect: CanvasRect,
  pos: readonly [number, number, number],
): number {
  if (!(camera instanceof THREE.PerspectiveCamera) || !(rect.height > 0)) return 0;
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const depth = (pos[0] - eye.x) * fwd.x + (pos[1] - eye.y) * fwd.y + (pos[2] - eye.z) * fwd.z;
  if (!(depth > 0)) return 0;
  return (
    (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (camera.zoom * rect.height)
  );
}

/** A target's distance from the pointer as a fraction of its acquire radius: 1 is the edge. */
export interface Scored<T> {
  target: T;
  score: number;
}

/**
 * The decision, on scores alone. Pure, so the stickiness is tested without a
 * camera.
 *
 * `held` is the key the hover was on, or null. The nearest target within its
 * acquire radius wins (a tie to the earlier one, which is `planPickTargets`'
 * order: placement markers before the pieces under them), except that a held
 * target still within `release` keeps the hover unless the winner beats it by
 * `switchRatio`.
 */
export function chooseSticky<T extends { key: string }>(
  scored: readonly Scored<T>[],
  held: string | null,
  release: number = RELEASE_RATIO,
  switchRatio: number = SWITCH_RATIO,
): T | null {
  let best: Scored<T> | null = null;
  let kept: Scored<T> | null = null;
  for (const s of scored) {
    if (held !== null && s.target.key === held && !kept) kept = s;
    if (s.score <= 1 && (!best || s.score < best.score)) best = s;
  }
  if (kept && kept.score <= release) {
    if (!best || best === kept || best.score >= kept.score * switchRatio) return kept.target;
  }
  return best?.target ?? null;
}

export interface HoverPickOptions {
  /** Per-kind acquire radii, world units. */
  radii?: SnapRadii;
  /** The least acquire radius in CSS pixels; 0 for none. */
  floorPx?: number;
  release?: number;
  switchRatio?: number;
}

/** Every target's score for this pointer ray. See `Scored`. */
export function scoreTargets<T extends Hoverable>(
  camera: THREE.Camera,
  rect: CanvasRect,
  ray: THREE.Ray,
  targets: readonly T[],
  radii: SnapRadii = SNAP_RADIUS,
  floorPx: number = HOVER_FLOOR_PX,
): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const t of targets) {
    const radius = Math.max(
      radii[t.kind],
      floorPx ? floorPx * worldPerPixel(camera, rect, t.pos) : 0,
    );
    let score = groundMiss(ray, t.pos) / radius;
    if (t.body) {
      const miss = segmentMiss(ray, t.pos[0], t.pos[2], t.body.y0, t.body.y1);
      score = Math.min(score, miss / t.body.r);
    }
    if (Number.isFinite(score)) out.push({ target: t, score });
  }
  return out;
}

/** The whole hover pick, from client coordinates and the key the hover was on. */
export function hoverPickAt<T extends Hoverable>(
  camera: THREE.Camera,
  rect: CanvasRect,
  clientX: number,
  clientY: number,
  targets: readonly T[],
  held: string | null,
  opts: HoverPickOptions = {},
): T | null {
  if (!targets.length) return null;
  const ray = pointerRay(camera, rect, clientX, clientY);
  if (!ray) return null;
  return chooseSticky(
    scoreTargets(camera, rect, ray, targets, opts.radii, opts.floorPx),
    held,
    opts.release,
    opts.switchRatio,
  );
}
