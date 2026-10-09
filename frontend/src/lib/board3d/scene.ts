// Camera rig, light rigs, and how far the ocean has to reach.
import * as THREE from "three";
import type { BoardTile } from "@/lib/types";
import { hexToWorld, cornerToWorld, LATTICE_SIZE } from "./coords";
import { BEACH_ENVELOPE } from "./beachGeometry";
import type { OceanFadeBand } from "./ocean";
import { BOARD_LOOKS, type BoardLook } from "./boardTheme";

/**
 * Fixed camera tilt, in degrees above the board. Lower and near rows occlude
 * far ones and props lean over their neighbours; much higher and the
 * perspective convergence disappears.
 */
export const CAMERA_TILT_DEG = 56;

/**
 * The steepest the board is allowed to open at, on the narrowest screens.
 *
 * On a portrait phone the fit is bound by width and the board's projected
 * height scales with sin(tilt), so a steeper camera uses the spare vertical
 * space. At 56 degrees a 390x844 screen showed the board at 33% of its height
 * (41% on desktop).
 */
const PORTRAIT_TILT_DEG = 74;
/** Aspect at or above which the board opens at the usual tilt. */
const LANDSCAPE_ASPECT = 1.0;
/** Aspect at or below which it opens fully raked. Roughly a phone held upright. */
const PORTRAIT_ASPECT = 0.55;

/**
 * Below this many CSS px on its shorter side, the board stops being a 3D scene
 * you look around and becomes a map you look at. See `flatView`.
 *
 * The short side, so a landscape phone counts too (the hardest case to orbit),
 * and so does a small desktop window: the trigger is room, not device type.
 */
export const FLAT_MAX_PX = 600;

/**
 * Is this box small enough to lock the camera flat? Measured on the board's
 * host box in CSS px, since the HUD's rail and docks take part of the window.
 */
export function flatView(width: number, height: number): boolean {
  return Math.min(width, height) < FLAT_MAX_PX;
}

/**
 * The same question asked of the viewport, for chrome that must decide before
 * the board has been measured.
 *
 * One-way: the host box is never larger than the viewport, so a small viewport
 * guarantees a flat board, but a roomy viewport may still leave the board a
 * small frame. So this may say "not flat" about a flat board but never "flat"
 * about one that orbits. That is the safe direction for its one reader, the
 * HUD's reset control: an extra button is clutter, a missing one strands the
 * player.
 *
 * Both axes, matching `flatView`'s `Math.min(width, height)`, so the two agree
 * on a landscape phone. Not `pointer: coarse`: a large tablet still orbits and
 * needs its reset button.
 */
export const FLAT_VIEW_QUERY = `(max-width: ${FLAT_MAX_PX - 1}px), (max-height: ${FLAT_MAX_PX - 1}px)`;

/**
 * How the board is posed when it opens (and when the reset button is pressed).
 *
 * The tilt depends on the viewport: it rakes up as the frame narrows, because
 * a portrait fit is bound by width and projected height scales with sin(tilt).
 * In a flat view it is pinned at the top of that range whatever the aspect.
 *
 * The bearing is fixed, so every player sees the map facing the same way; a
 * player can turn it, or the phone.
 *
 * Opening pose only: on a full-size viewport the player's orbit is kept until
 * reset. A flat view has no orbit (see `Board3D`); pan and zoom move within
 * this pose.
 */
export function openingPose(aspect: number, flat = false): { tiltDeg: number; azimuthRad: number } {
  if (flat) return { tiltDeg: PORTRAIT_TILT_DEG, azimuthRad: 0 };
  const t = Math.min(
    1,
    Math.max(0, (LANDSCAPE_ASPECT - aspect) / (LANDSCAPE_ASPECT - PORTRAIT_ASPECT)),
  );
  return { tiltDeg: CAMERA_TILT_DEG + t * (PORTRAIT_TILT_DEG - CAMERA_TILT_DEG), azimuthRad: 0 };
}

const OCEAN_MIN_RINGS = 6;
/** Slack past the solve, so the last row of hexes is never the edge. */
const OCEAN_REACH = 1.15;

/**
 * The rig's key: where the hexes are, and nothing about what they are.
 *
 * Board3D rebuilds its whole rig (renderer, camera, controls) when this
 * changes, so it must track only the board's shape. Terrain changes mid-game
 * (an Explorers reveal), and that belongs to `staticBoardKey` in Board3D.
 */
export function boardShapeKey(board: { radius: number; tiles: readonly BoardTile[] }): string {
  return `${board.radius}:${board.tiles.map((t) => `${t.hex.q},${t.hex.r}`).join("|")}`;
}

/**
 * White light by day, moonlight by night; see `boardTheme.ts`.
 *
 * Lights normally supply intensity and palette.json supplies colour. Night is
 * the exception: a dim white key reads as an underexposed afternoon, and a
 * cool tint on one light says "night" without re-authoring 242 materials.
 */

export interface BoardExtent {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  radius: number;
}

export function boardExtent(tiles: BoardTile[], size = LATTICE_SIZE): BoardExtent {
  if (!tiles.length) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, radius: size };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of tiles) {
    const [x, , z] = hexToWorld(t.hex, size);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  // `+ size` reaches from the outermost tile's centre to its far corner, and
  // BEACH_ENVELOPE adds the ring of sand a coastal tile puts into the water.
  // Without the beach, zoomed fully out would cut off the coast.
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + size + BEACH_ENVELOPE;
  return { minX, maxX, minZ, maxZ, radius };
}

/**
 * Clearance past the island's far side before the haze may start, so the back
 * row of tiles isn't hazed while the front row is clear.
 */
const FOG_ISLAND_MARGIN = 1;

/**
 * How deep the band of air over the water is, in world units.
 *
 * The fog is anchored to the island rather than to the sea's outer edge, so it
 * is the same depth on every board and the ocean only has to outlast it.
 * Water faded to the page's blue is indistinguishable from the page, so the sea
 * can stop once the fade is done (see `oceanRadius`).
 *
 * Ten rings. Shorter is cheaper and reads as heavier weather; much shorter and
 * the island sits in a bowl of haze.
 */
export const OCEAN_FOG_REACH = LATTICE_SIZE * 10;

/**
 * Where the haze starts and finishes, as distances from the camera.
 *
 * `THREE.Fog` measures from the camera, so both ends are recomputed from the
 * live standoff; a fixed pair would fog the island when zoomed out. Lives here
 * so `oceanRadius` asks the same question the renderer does.
 */
export function oceanFog(extent: BoardExtent, standoff: number): { near: number; far: number } {
  const near = standoff + extent.radius + FOG_ISLAND_MARGIN;
  return { near, far: near + OCEAN_FOG_REACH };
}

/** Poses the ocean is sized against. See `oceanRadius`. */
const OCEAN_STANDOFF_SAMPLES = 5;
const OCEAN_ELEVATION_STEP_DEG = 2.5;
const OCEAN_BEARINGS = 8;

/**
 * How far the water reaches.
 *
 * Solved against the frustum: over every pose the controls allow, find the
 * furthest point of the water plane that the frame shows and the fog hasn't
 * yet faded to the page's colour, plus slack. Water beyond that would be the
 * same colour as the page, so it can be absent.
 *
 * Swept rather than solved in closed form, because the requirement isn't
 * monotonic in any one argument:
 *
 *  - Elevation: the frame reaches furthest at the shallowest tilt, but the
 *    fog also cuts in soonest there.
 *  - Standoff, both ends: the back of the dolly range reaches furthest; the
 *    front has the fog's shortest reach, since the fog is camera-anchored.
 *  - Pan, which dominates: the pivot may go `PAN_MARGIN` past the board's
 *    half-span, while the ocean stays a disc about the lattice origin.
 *  - Bearing, because the pan box is square and the ocean round.
 *
 * Corner rays matter: they have shallower depression than the top-centre ray
 * and travel further.
 *
 * Memoised on its arguments; `applyViewport` asks on every resize via
 * `cameraPlanes`.
 */
export function oceanRadius(extent: BoardExtent, aspect = 1): number {
  const key = `${extent.minX}|${extent.maxX}|${extent.minZ}|${extent.maxZ}|${extent.radius}|${aspect}`;
  const hit = oceanRadiusCache.get(key);
  if (hit !== undefined) return hit;
  oceanRadiusSolves++;
  const value = solveOceanRadius(extent, aspect);
  // Insertion-ordered, so the oldest key is first. A handful of entries covers
  // every live board; the bound only stops unbounded growth.
  if (oceanRadiusCache.size >= OCEAN_RADIUS_CACHE_MAX) {
    const oldest = oceanRadiusCache.keys().next().value;
    if (oldest !== undefined) oceanRadiusCache.delete(oldest);
  }
  oceanRadiusCache.set(key, value);
  return value;
}

/**
 * Keyed on the extent's values, not its identity: callers each build their own
 * `BoardExtent` (`oceanHexes` per call, `Board3D` memoised, `cameraPlanes`
 * passed through), and an identity key made them evict each other and rerun
 * the ~500k-iteration sweep constantly.
 */
const OCEAN_RADIUS_CACHE_MAX = 16;
const oceanRadiusCache = new Map<string, number>();

let oceanRadiusSolves = 0;

/** Drop the memo. Tests only. */
export function __resetOceanRadiusCache(): void {
  oceanRadiusCache.clear();
  oceanRadiusSolves = 0;
}

/** How many times the sweep actually ran. Tests only. */
export function __oceanRadiusSolves(): number {
  return oceanRadiusSolves;
}

/**
 * The narrowest and widest viewport the board is ever sized for, with room to
 * spare: a 9:21 phone on its end is 0.43 and a 32:9 ultrawide 3.56.
 */
const OCEAN_ASPECT_MIN = 0.3;
const OCEAN_ASPECT_MAX = 4;

/**
 * How far the flat sea must reach to fill any frame this board could be shown
 * in, not just the current one.
 *
 * The annulus is the only viewport-dependent size (`nearOceanRadius` always
 * clamps to the collar, since `solveOceanRadius` never returns less than
 * `extent.radius + OCEAN_NEAR_BAND + LATTICE_SIZE`). Sizing it for the worst
 * case lets the static half of the build ignore aspect, avoiding rebuilds on
 * resize. It costs nothing: a `RingGeometry`'s vertex count depends only on
 * its segments, and the extra span is past the fog.
 *
 * Two samples, because the requirement is quasi-convex in aspect (lowest near
 * square), so the maximum over a range is at an end. Checked across boards of
 * radius 2, 3, 4 and 6 in scene.test.ts.
 */
export function oceanRadiusAnyAspect(extent: BoardExtent): number {
  return Math.max(oceanRadius(extent, OCEAN_ASPECT_MIN), oceanRadius(extent, OCEAN_ASPECT_MAX));
}

function solveOceanRadius(extent: BoardExtent, aspect = 1): number {
  const back = framingDistance(aspect, extent);
  const centre = frameTarget(extent);
  const half = halfSpans(extent);
  const halfV = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const halfH = halfV * aspect;
  // A corner ray's length before normalising: forward, right and up are unit
  // and orthogonal.
  const cornerLen = Math.sqrt(1 + halfH * halfH + halfV * halfV);
  let need = 0;
  for (let s = 0; s < OCEAN_STANDOFF_SAMPLES; s++) {
    const standoff = back * Math.pow(0.5, s);
    const fogFar = oceanFog(extent, standoff).far;
    for (const px of [-1, 0, 1]) {
      for (const pz of [-1, 0, 1]) {
        const pivotX = centre.x + px * half.x * (1 + PAN_MARGIN);
        const pivotZ = centre.z + pz * half.z * (1 + PAN_MARGIN);
        for (let deg = MIN_CAMERA_ELEVATION_DEG; deg <= 90; deg += OCEAN_ELEVATION_STEP_DEG) {
          const e = (deg * Math.PI) / 180;
          for (let a = 0; a < OCEAN_BEARINGS; a++) {
            const az = (a * 2 * Math.PI) / OCEAN_BEARINGS;
            const ux = Math.sin(az) * Math.cos(e);
            const uy = Math.sin(e);
            const uz = Math.cos(az) * Math.cos(e);
            const camX = pivotX + ux * standoff;
            const camY = uy * standoff;
            const camZ = pivotZ + uz * standoff;
            const fx = -ux;
            const fy = -uy;
            const fz = -uz;
            // right = normalise(forward x up). Straight down is degenerate, and
            // there every bearing is the same one, so any right vector serves.
            let rx = -fz;
            let rz = fx;
            const rl = Math.hypot(rx, rz);
            if (rl < 1e-9) {
              rx = 1;
              rz = 0;
            } else {
              rx /= rl;
              rz /= rl;
            }
            // camUp = right x forward
            const cux = -rz * fy;
            const cuy = rz * fx - rx * fz;
            const cuz = rx * fy;
            // Skip a pose that cannot raise `need`. No counted ray is longer
            // than the fog's far end, or than the frame's shallowest ray (a
            // top corner) needs to reach the water, and a ray of length t
            // lands sqrt(t^2 - camY^2) from the camera's foot. The slack
            // covers rounding, so a skipped pose never held the maximum.
            const topDy = (fy + halfV * cuy) / cornerLen;
            const tMax = topDy < 0 ? Math.min(fogFar, camY / -topDy) : fogFar;
            const reach =
              Math.hypot(camX, camZ) + Math.sqrt(Math.max(0, tMax * tMax - camY * camY));
            if (reach * (1 + 1e-9) < need) continue;
            // The frame's own grid, sampled finely on the vertical axis: a
            // ray's reach and its distance from the camera both grow toward
            // the horizon, so the binding ray is mid-frame. The horizontal
            // axis only needs the corners.
            for (let i = 0; i <= 4; i++) {
              const x = -1 + i / 2;
              for (let j = 0; j <= 12; j++) {
                const y = -1 + j / 6;
                let dx = fx + x * halfH * rx + y * halfV * cux;
                let dy = fy + y * halfV * cuy;
                let dz = fz + x * halfH * rz + y * halfV * cuz;
                const dl = Math.hypot(dx, dy, dz);
                dx /= dl;
                dy /= dl;
                dz /= dl;
                // A ray at or above the horizon never meets the water; nothing
                // is drawn there and the page is the fog colour.
                if (dy >= -1e-6) continue;
                const t = -camY / dy;
                // Past the fog's far end the water matches the page.
                if (!(t > 0) || t >= fogFar) continue;
                need = Math.max(need, Math.hypot(camX + dx * t, camZ + dz * t));
              }
            }
          }
        }
      }
    }
  }
  return Math.max(
    LATTICE_SIZE * OCEAN_MIN_RINGS,
    // Never inside the collar, or the hex field would be the sea's edge.
    extent.radius + OCEAN_NEAR_BAND + LATTICE_SIZE,
    need * OCEAN_REACH,
  );
}

/**
 * How much tessellated water a board gets past its own coastline.
 *
 * A collar on the coast: real sea hexes with a swell inside it, one flat ring
 * past it (see `oceanAnnulusGeometry`), then nothing once the fog is done. The
 * hexes are the only part of the ocean that costs anything; the flat ring is
 * 192 triangles at any radius.
 *
 * Five rings, chosen by eye: wide enough that the island sits in water rather
 * than in a ripple trim, at ten players and the shallowest tilt.
 */
export const OCEAN_NEAR_BAND = LATTICE_SIZE * 5;

/**
 * How wide the swell's fade-out is.
 *
 * The fade is all that hides the switch from hexes to a plane, so it wants to
 * be wide, but it must finish inside the collar. Three rings out of five
 * leaves two rings of full swell past the beach, where people look.
 */
const OCEAN_FADE_WIDTH = LATTICE_SIZE * 3;

/**
 * How far the tessellated sea reaches before the flat annulus takes over.
 * Clamped to `oceanRadius`, so on a board with no annulus the hex field is
 * never larger than the flat ring it hands over to.
 */
export function nearOceanRadius(extent: BoardExtent, aspect = 1): number {
  return Math.min(oceanRadius(extent, aspect), extent.radius + OCEAN_NEAR_BAND);
}

/**
 * How far out the backdrop's sea hexes are laid, which is not where the flat
 * annulus starts.
 *
 * The hex field's boundary is a lattice and the annulus's a circle, so they
 * have to overlap. A hex centred within this radius covers every point out to
 * `nearOceanRadius` (a cell's centre is at most one circumradius from any
 * point in it) and reaches at most one more circumradius past it, so the
 * double-covered band is two hexes wide at any board size. `annulusMaterial`
 * decides who wins in it.
 */
export function oceanBackdropRadius(extent: BoardExtent, aspect = 1): number {
  return nearOceanRadius(extent, aspect) + LATTICE_SIZE;
}

/**
 * The band the swell is faded out over, ending where the hexes do. Clamped to
 * start outside the board, so the swell along the coast is never stilled.
 */
export function oceanFadeFor(extent: BoardExtent, aspect = 1): OceanFadeBand {
  const outer = nearOceanRadius(extent, aspect);
  return { inner: Math.max(extent.radius, outer - OCEAN_FADE_WIDTH), outer };
}

/**
 * Shadows on, but recomputed only when something asks.
 *
 * The key light is static (see `makeLights`), the water doesn't cast, and
 * pieces only move while animating. With `autoUpdate`, three would redraw the
 * shadow map every frame (the swell keeps the loop running), about half the
 * frame's draw calls, for an identical result.
 *
 * `invalidateShadows` is the other half: a caster that moves without calling
 * it drags a stale shadow.
 */
export interface ShadowMapLike {
  enabled: boolean;
  autoUpdate: boolean;
  needsUpdate: boolean;
}

export function configureShadows(shadowMap: ShadowMapLike): void {
  shadowMap.enabled = true;
  shadowMap.autoUpdate = false;
  // Without this the board's first render has no shadow map at all.
  shadowMap.needsUpdate = true;
}

/** Ask for one more shadow pass, on the next frame that draws. */
export function invalidateShadows(renderer: { shadowMap: ShadowMapLike } | null | undefined): void {
  if (renderer) renderer.shadowMap.needsUpdate = true;
}

/**
 * Vertical field of view.
 *
 * Perspective, because an orthographic board reads as a flat illustration at
 * any tilt. Narrow, because a wide field makes near tiles visibly larger and
 * more raked than far ones; 32 keeps the convergence without that distortion.
 */
export const CAMERA_FOV_DEG = 32;

/**
 * The shallowest the camera may be tilted, in degrees above the board plane.
 *
 * Elevation, not polar angle (`polar = 90 - elevation`); the controls take the
 * polar form from `MAX_CAMERA_POLAR_RAD` below.
 *
 * Two things read this and must agree:
 *
 *  - The controls stop here, via `maxPolarAngle`. Lower, the near row occludes
 *    the next, props lean over neighbours and chips become slivers.
 *  - The ocean is sized here: the lower the camera, the further the frustum
 *    reaches over the water (see `solveOceanRadius`).
 *
 * 30 allows a raking look along the board. The extra reach lands in the flat
 * annulus, whose cost doesn't depend on radius, so the hex field doesn't grow.
 */
export const MIN_CAMERA_ELEVATION_DEG = 30;

/**
 * The same floor, as the polar angle OrbitControls wants. Polar 0 is overhead
 * and 90 is level, so an elevation floor is a polar ceiling (`maxPolarAngle`).
 * Straight down stays reachable.
 */
export const MAX_CAMERA_POLAR_RAD = ((90 - MIN_CAMERA_ELEVATION_DEG) * Math.PI) / 180;

/**
 * The tilt the board is shown at while it turns on its own (the endgame
 * backdrop; see `Board3DControls.setAutoOrbit`). Lower than `CAMERA_TILT_DEG`
 * so the pieces stand up against the sea, but well above
 * `MIN_CAMERA_ELEVATION_DEG` so near metropolises don't hide the far side.
 */
export const SHOWCASE_ELEVATION_DEG = 45;

/**
 * How much of the exact fit the showcase stands off at. Slightly inside: the
 * fit is against the bounding cylinder, which leaves air at most bearings, and
 * a few percent in fills the frame without the coast touching an edge.
 */
export const SHOWCASE_FILL = 0.94;

/**
 * How fast that turn goes, in degrees of bearing per second: a full circle in
 * seventy-two seconds, slow enough not to compete with the scoreboard.
 */
export const SHOWCASE_TURN_DEG_PER_SEC = 5;

/**
 * How long the camera takes to glide from wherever it was into the showcase
 * pose, in milliseconds. Cutting straight to it would look like the board had
 * been replaced.
 */
export const SHOWCASE_SETTLE_MS = 2500;

/**
 * How long the bearing takes to reach `SHOWCASE_TURN_DEG_PER_SEC`. Longer than
 * the settle, so the glide moves first and the turn creeps in under it.
 */
export const SHOWCASE_SPINUP_MS = 4000;

/** Smoothstep: flat at both ends, so nothing starts or stops abruptly. */
function smoothstep01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * How far into the glide into the showcase pose, 0 to 1. Eased at both ends:
 * the camera leaves from a standstill (`settleCamera` has just killed any
 * fling momentum) and arrives without a stop.
 */
export function showcaseSettle(elapsedMs: number, spanMs = SHOWCASE_SETTLE_MS): number {
  if (!(spanMs > 0)) return 1;
  return smoothstep01(elapsedMs / spanMs);
}

/**
 * The bearing to advance by this frame, in radians. The rate follows the eased
 * ramp so the turn accelerates from rest. Integrated per frame because frame
 * lengths vary.
 */
export function showcaseSpin(
  elapsedMs: number,
  dtMs: number,
  degPerSec = SHOWCASE_TURN_DEG_PER_SEC,
  spinupMs = SHOWCASE_SPINUP_MS,
): number {
  const rate = degPerSec * (spinupMs > 0 ? smoothstep01(elapsedMs / spinupMs) : 1);
  return (rate * dtMs * Math.PI) / 180_000;
}

/** Breathing room between the board's bounding circle and the frustum edge. */
const FRAME_MARGIN = 1.05;

/**
 * How far back the camera stands to frame the board.
 *
 * Solved exactly. The board is a disc of radius `R` in the plane; with the
 * camera at `target + d * u`, `u = (0, sin t, cos t)`, a point `q` on the disc
 * has camera coordinates
 *
 *     x = q.x        y = -q.z sin t        depth = d - q.z cos t
 *
 * Fitting needs `|q.x| <= halfH * depth` and `|q.z| sin t <= halfV * depth`.
 * Both give a lower bound on `d`; maximising each over the circle gives the
 * closed forms below. The `q.z cos t` term accounts for the near edge being
 * closer than the centre.
 *
 * `tiltDeg` is a parameter because the answer depends on it (a shallower camera
 * sees the board more foreshortened), and the zoom-out limit is recomputed from
 * the live elevation.
 *
 * `headroom` turns the disc into a cylinder: looking steeply down, a piece on
 * the rim projects further out than its footprint (a three-unit piece on a
 * large board's edge overflowed the frame by half a percent).
 */
export function cameraDistance(
  aspect: number,
  extent: BoardExtent,
  tiltDeg: number = CAMERA_TILT_DEG,
  headroom = 0,
): number {
  const fov = (CAMERA_FOV_DEG * Math.PI) / 180;
  const tilt = (tiltDeg * Math.PI) / 180;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const halfV = Math.tan(fov / 2);
  const halfH = halfV * aspect;
  const r = extent.radius;
  const h = Math.max(0, headroom);
  // max over the circle of r*(sin@ cos t + |cos@| / halfH), and the tallest
  // point is the one furthest along the view direction.
  const across = r * Math.hypot(cos, 1 / halfH) + h * sin;
  // The vertical constraint over the cylinder: linear in cos@ and the height
  // inside the absolute value, so its maximum is at one of four corners.
  let vertical = 0;
  for (const c of [1, -1]) {
    for (const y of [0, h]) {
      vertical = Math.max(
        vertical,
        r * c * cos + y * sin + Math.abs(y * cos - r * c * sin) / halfV,
      );
    }
  }
  return Math.max(across, vertical) * FRAME_MARGIN;
}

/**
 * Half the board's world span on each axis, padded exactly as `radius` is.
 *
 * `radius` is a bounding circle, right for anything that must hold at every
 * azimuth (sea reach, shadow camera, zoom-out limit). The opening view is one
 * known azimuth, and on themed presets the short axis is about half the long
 * one, so framing the circle wastes space. See `defaultCameraDistance`.
 *
 * Clamped to `radius`, so a hand-built extent (as in tests, with a radius and
 * no corners) is never larger than it claims.
 */
export function halfSpans(extent: BoardExtent): { x: number; z: number } {
  return {
    x: Math.min(extent.radius, (extent.maxX - extent.minX) / 2 + SPAN_PAD),
    z: Math.min(extent.radius, (extent.maxZ - extent.minZ) / 2 + SPAN_PAD),
  };
}

/**
 * What `halfSpans` adds to the raw span of the tile centres to get the board's
 * outer edge: half a lattice cell to the tile's rim, then the coastal sand.
 * Named because `clampPanTarget` subtracts it again.
 */
const SPAN_PAD = LATTICE_SIZE + BEACH_ENVELOPE;

/**
 * How far back the board opens: the same solve as `cameraDistance`, against the
 * board's actual footprint rather than its bounding circle.
 *
 * For a rectangle the worst point is a corner: `|q.x| <= halfH * (d - q.z cos t)`
 * is worst at `(halfX, halfZ)` and `|q.z| sin t <= halfV * (d - q.z cos t)` at
 * `q.z = halfZ`, the near edge.
 *
 * Only for the opening view and reset. The zoom-out limit must hold at every
 * bearing, so `framingDistance` keeps the circle.
 */
export function defaultCameraDistance(
  aspect: number,
  extent: BoardExtent,
  tiltDeg: number = CAMERA_TILT_DEG,
  azimuthRad = 0,
): number {
  const fov = (CAMERA_FOV_DEG * Math.PI) / 180;
  const tilt = (tiltDeg * Math.PI) / 180;
  const halfV = Math.tan(fov / 2);
  const halfH = halfV * aspect;
  const span = halfSpans(extent);
  // A quarter turn swaps which world axis runs across the screen. Only the two
  // right angles are handled; other bearings need `fitDistance`.
  const turned = Math.abs(Math.sin(azimuthRad)) > 0.5;
  const hx = turned ? span.z : span.x;
  const hz = turned ? span.x : span.z;
  const across = hx / halfH + hz * Math.cos(tilt);
  const nearEdge = hz * (Math.cos(tilt) + Math.sin(tilt) / halfV);
  return Math.max(across, nearEdge) * FRAME_MARGIN;
}

/**
 * The board reduced to the points that can actually leave the frame.
 *
 * The disc solves above are a loose bound on a board's shape. These are the
 * real corners, six per tile including sea tiles, so harbours are covered as
 * themselves: a harbour marker stands `SEAWARD_OFFSET` out from its edge,
 * inside its sea hex (see layers/harbors.ts), so that hex's corners bound it.
 *
 * `BEACH_ENVELOPE` is pushed out along each corner's radial, where the sand
 * goes.
 *
 * `headroom` adds a raised copy of every point, since tall things on the far
 * edge reach up the frame. Board3D measures it (its `ceiling`).
 */
export function boardFitPoints(
  tiles: BoardTile[],
  headroom = 0,
  size = LATTICE_SIZE,
): THREE.Vector3[] {
  if (!tiles.length) return [new THREE.Vector3()];
  const pts: THREE.Vector3[] = [];
  for (const t of tiles) {
    const [cx, , cz] = hexToWorld(t.hex, size);
    for (let i = 0; i < 6; i++) {
      const [x, , z] = cornerToWorld(t.hex, i, size);
      // Radially outward from the tile's own centre, so the sand lands outside
      // the hex.
      const dx = x - cx;
      const dz = z - cz;
      const len = Math.hypot(dx, dz) || 1;
      const px = x + (dx / len) * BEACH_ENVELOPE;
      const pz = z + (dz / len) * BEACH_ENVELOPE;
      pts.push(new THREE.Vector3(px, 0, pz));
      if (headroom > 0) pts.push(new THREE.Vector3(px, headroom, pz));
    }
  }
  return pts;
}

/** The part of the frame the board must stay inside, in normalised device coords. */
export interface FrameBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The whole window, for a rig with no HUD over it. */
export const FULL_FRAME: FrameBounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

/**
 * The frame with the HUD's dead bands taken out of it.
 *
 * Paired with `applyHudInset`: the view offset centres the board away from the
 * bands (a bottom band `b` puts the pivot at NDC y = +b), and this sizes the
 * rectangle the board must fit in. Neither double-counts the other.
 */
export function usableFrame(insets: HudInsets = {}): FrameBounds {
  const { left = 0, right = 0, bottom = 0, top = 0 } = insets;
  return {
    minX: -1 + 2 * Math.max(0, left),
    maxX: 1 - 2 * Math.max(0, right),
    minY: -1 + 2 * Math.max(0, bottom),
    maxY: 1 - 2 * Math.max(0, top),
  };
}

/** Unit vector from the pivot toward a camera at this elevation and bearing. */
export function orbitDir(elevationDeg: number, azimuthRad = 0): THREE.Vector3 {
  const e = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(azimuthRad) * Math.cos(e),
    Math.sin(e),
    Math.cos(azimuthRad) * Math.cos(e),
  );
}

/**
 * Where the camera is standing, as an elevation and azimuth.
 *
 * The exact inverse of `orbitDir`, so readouts match how poses are written in
 * this file (`openingPose`, `CAMERA_TILT_DEG`, the dolly fences).
 *
 * `elevationDeg` is above the ground plane: 90 straight down, 0 level.
 * `azimuthDeg` is about Y with 0 looking along +Z, turning toward +X. A camera
 * exactly on its target reports zeroes rather than NaNs (unreachable anyway,
 * since `distance` is fenced above zero).
 */
export interface CameraReadout {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  distance: number;
  elevationDeg: number;
  azimuthDeg: number;
  fovDeg: number;
  aspect: number;
}

export function cameraReadout(cam: THREE.PerspectiveCamera, target: THREE.Vector3): CameraReadout {
  const w = cam.position.clone().sub(target);
  const distance = w.length();
  const d = distance > 1e-6 ? w.clone().divideScalar(distance) : new THREE.Vector3();
  return {
    position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
    target: { x: target.x, y: target.y, z: target.z },
    distance,
    // `asin` of the unit direction's Y, which is what `orbitDir` put there.
    elevationDeg: distance > 1e-6 ? (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI : 0,
    // `atan2(x, z)`, in that order, because `orbitDir` builds x from sin and z
    // from cos. `atan2(z, x)` would be off by 90 degrees.
    azimuthDeg: distance > 1e-6 ? (Math.atan2(d.x, d.z) * 180) / Math.PI : 0,
    fovDeg: cam.fov,
    aspect: cam.aspect,
  };
}

/**
 * The distance at which every one of `points` lands inside `bounds`.
 *
 * The general, exact form of the closed solves above. With the camera at
 * `target + d * dir`, a point `p` has camera coordinates
 *
 *     x = w . right      y = w . up      depth = d - w . dir      (w = p - target)
 *
 * and `x_ndc = sx * x / depth - ox`, with `sx` and `ox` from the projection
 * matrix. So `x_ndc <= bounds.maxX` rearranges to
 *
 *     d >= w . dir + sx * x / (bounds.maxX + ox)
 *
 * and likewise for the other three bounds. Each is linear in `w`, so the answer
 * is the largest over the point set, in one pass.
 *
 * `sx`/`ox` come from the matrix because `applyHudInset` shifts the frustum,
 * which `fov` and `aspect` alone can't describe.
 *
 * Multiplied by FRAME_MARGIN, unless the caller already took its margin out of
 * `bounds` (a flat view does, in `fitBounds`).
 */
export function fitDistance(
  cam: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  dir: THREE.Vector3,
  points: readonly THREE.Vector3[],
  bounds: FrameBounds = FULL_FRAME,
  margin: number = FRAME_MARGIN,
): number {
  const e = cam.projectionMatrix.elements;
  const sx = e[0];
  const sy = e[5];
  const ox = e[8];
  const oy = e[9];
  // Each bound's denominator: maxX/maxY positive, minX/minY negative, so one
  // expression serves all four. Floored away from zero for a degenerate
  // projection.
  const away = (v: number) => (Math.abs(v) < 1e-6 ? (v < 0 ? -1e-6 : 1e-6) : v);
  const rx = away(bounds.maxX + ox);
  const lx = away(bounds.minX + ox);
  const ty = away(bounds.maxY + oy);
  const by = away(bounds.minY + oy);

  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, dir);
  // Straight down: every bearing is the same one, so any right vector will do.
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
  else right.normalize();
  const camUp = new THREE.Vector3().crossVectors(dir, right);

  const w = new THREE.Vector3();
  let need = 0;
  for (const p of points) {
    w.copy(p).sub(target);
    const along = w.dot(dir);
    const x = w.dot(right) * sx;
    const y = w.dot(camUp) * sy;
    need = Math.max(need, along + x / rx, along + x / lx, along + y / ty, along + y / by);
  }
  return need * margin;
}

/**
 * The point the camera aims at and orbits about. One function, because they
 * must be the same point.
 *
 * The centre of the board, independent of aspect ratio: moving the pivot off
 * centre swings the island around the frame as you orbit, and an aspect-based
 * pivot would jump on resize. The board therefore sits slightly low in frame
 * (its near half projects larger), which is acceptable.
 */
export function frameTarget(extent: BoardExtent): THREE.Vector3 {
  return new THREE.Vector3((extent.minX + extent.maxX) / 2, 0, (extent.minZ + extent.maxZ) / 2);
}

/**
 * Fraction of the viewport height the HUD's hand shelf covers along the bottom.
 */
export const HUD_BOTTOM_INSET = 0.12;

/**
 * How much of the frame a flat view keeps clear around the board.
 *
 * `fitDistance` puts the outermost fitted point exactly on the bounds. On a
 * phone that leaves harbour markers half off screen, because the pier and sign
 * extend past the fitted harbour hex.
 *
 * Applied to the bounds only, not as an inset. An inset both narrows
 * `usableFrame` and makes `applyHudInset` shift the virtual frame; a
 * symmetric inset would cancel out and leave the board on the edge.
 */
export const FLAT_FRAME_MARGIN = 0.03;

/**
 * The fit bounds with a flat view's breathing room taken out of them.
 * Symmetric: where the board sits between the HUD's bands comes from the
 * measured chrome insets in `applyHudInset`.
 */
export function fitBounds(frame: FrameBounds, flat: boolean): FrameBounds {
  if (!flat) return frame;
  const m = 2 * FLAT_FRAME_MARGIN;
  return {
    minX: frame.minX + m,
    maxX: frame.maxX - m,
    minY: frame.minY + m,
    maxY: frame.maxY - m,
  };
}

/**
 * Dead bands the HUD occupies, as fractions of the viewport. `fitDistance`
 * sizes the board against the frame they leave (`usableFrame`), and
 * `applyHudInset` shifts it clear of them.
 */
export interface HudInsets {
  left?: number;
  /**
   * The band along the right: the feed island and the bank card.
   *
   * A single band on one side shifts the board by half its width (a ~208px
   * rail put a desktop board 124px off centre). Matching left and right bands
   * cancel, giving clearance without the shift, as top and bottom do.
   */
  right?: number;
  bottom?: number;
  /**
   * The band along the top: the utility orbs and turn pill, plus the seat rail
   * where it becomes a horizontal strip beneath them. On a 390x844 phone this
   * is ~230px, over a quarter of the height.
   */
  top?: number;
}

/**
 * Shift the rendered image away from the HUD's dead bands, without touching the
 * pivot.
 *
 * Moving `frameTarget` instead would make the island swing around the frame as
 * you orbit (see scene.test.ts). A view offset changes only the projection: the
 * camera still looks at and orbits the board's true centre.
 *
 * It renders a slice of a virtual frame larger than the canvas on the inset
 * axes, taken on the same side as the band. The board's centre stays in the
 * middle of the virtual frame, so it lands away from the band: a bottom band
 * moves the board up, a left band moves it right.
 */
export function applyHudInset(
  cam: THREE.PerspectiveCamera,
  width: number,
  height: number,
  insets: HudInsets | number = { bottom: HUD_BOTTOM_INSET },
): void {
  if (width <= 0 || height <= 0) return;
  // A bare number keeps the original bottom-only call shape working.
  const {
    left = 0,
    right = 0,
    bottom = 0,
    top = 0,
  } = typeof insets === "number" ? { bottom: insets } : insets;
  const l = Math.max(0, left);
  const r = Math.max(0, right);
  const b = Math.max(0, bottom);
  const t = Math.max(0, top);
  if (l <= 0 && r <= 0 && b <= 0 && t <= 0) {
    cam.clearViewOffset();
    return;
  }
  // The horizontal pair works like the vertical one below: both bands grow the
  // virtual frame and the left one places the window, so one band shifts the
  // board off its edge and two equal bands cancel.
  const fullW = width * (1 + l + r);
  // Both vertical bands grow the virtual frame, and offsetting by the bottom
  // band centres the board between them. With only a bottom band that is
  // `fullH - height` (the bottom slice); with only a top band, 0 (the top
  // slice); equal bands cancel.
  const fullH = height * (1 + b + t);
  // Each axis is offset by the band on the side its coordinate grows toward
  // (x rightward, so the right band; y downward, so the bottom band).
  cam.setViewOffset(fullW, fullH, width * r, height * b, width, height);
}

/**
 * The distance that frames the whole board at every angle the controls allow.
 *
 * The maximum of `cameraDistance` over reachable elevations. It must be an upper
 * bound, or zooming fully out cuts off the map at some angles, and constant as
 * the camera moves: OrbitControls clamps distance against it, so a limit that
 * shrank with tilt would dolly the camera in as it tilted down.
 *
 * Sampled because the requirement peaks around 80 degrees, not at an end. Runs
 * on resize, not per frame.
 */
export function framingDistance(aspect: number, extent: BoardExtent, headroom = 0): number {
  let most = 0;
  for (let deg = MIN_CAMERA_ELEVATION_DEG; deg <= 90; deg += 2.5) {
    most = Math.max(most, cameraDistance(aspect, extent, deg, headroom));
  }
  return most;
}

/**
 * The cylinder that contains the board at every bearing. The zoom-out limit has
 * to hold as the camera turns, and a cylinder looks the same from every
 * bearing, so sweeping elevation is enough.
 */
export function boundingCylinderPoints(
  extent: BoardExtent,
  headroom = 0,
  steps = 72,
): THREE.Vector3[] {
  const centre = frameTarget(extent);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i * 2 * Math.PI) / steps;
    const x = centre.x + extent.radius * Math.cos(a);
    const z = centre.z + extent.radius * Math.sin(a);
    pts.push(new THREE.Vector3(x, 0, z));
    if (headroom > 0) pts.push(new THREE.Vector3(x, headroom, z));
  }
  return pts;
}

/**
 * The zoom-out limit, solved against the projection.
 *
 * Same sweep over elevations as `framingDistance`, but fitted against `cam`'s
 * real frustum, so the HUD view offset's shift is part of the solve (a simple
 * `(1 + bottomInset)` scale misses it and overflows slightly).
 *
 * `cam` must already carry this window's aspect and insets, which in Board3D
 * means `applyViewport` has run.
 */
export function framingDistanceFor(
  cam: THREE.PerspectiveCamera,
  extent: BoardExtent,
  headroom = 0,
  bounds: FrameBounds = FULL_FRAME,
): number {
  const target = frameTarget(extent);
  const points = boundingCylinderPoints(extent, headroom);
  let most = 0;
  for (let deg = MIN_CAMERA_ELEVATION_DEG; deg <= 90; deg += 2.5) {
    most = Math.max(most, fitDistance(cam, target, orbitDir(deg), points, bounds));
  }
  return most;
}

/** Elevation of `cam` above the board plane through `target`, in degrees. */
export function cameraElevationDeg(cam: THREE.PerspectiveCamera, target: THREE.Vector3): number {
  const d = cam.position.distanceTo(target);
  if (d <= 0) return CAMERA_TILT_DEG;
  return (Math.asin(Math.min(1, Math.max(-1, (cam.position.y - target.y) / d))) * 180) / Math.PI;
}

/**
 * Near and far, derived from the scene.
 *
 * Depth resolution goes as z²·(f−n)/(f·n), so a tiny near plane wastes the
 * depth buffer, and at the sea's far edge the ocean's wave sheet and the hull
 * 0.05 beneath it would no longer separate.
 *
 * `near` is pushed as far out as the board's size allows, then capped by the
 * clearance the zoom-in limit keeps above the board (see `minCameraDistance`):
 * dollied fully in and overhead, a piece top is `MIN_CAMERA_CLEARANCE` from
 * the camera whatever the board's size. `far` covers the sea's far edge from
 * the back of the dolly range. The ratio ends up in the hundreds.
 */
export function cameraPlanes(extent: BoardExtent, aspect = 1): { near: number; far: number } {
  return {
    near: Math.min(extent.radius * NEAR_PLANE_FRACTION, MIN_CAMERA_CLEARANCE * NEAR_PLANE_SHARE),
    far: oceanRadius(extent, aspect) * FAR_PLANE_MARGIN,
  };
}

/**
 * The far plane a camera standing `standoff` from the pivot needs, given the
 * one `cameraPlanes` set.
 *
 * `cameraPlanes` assumes the camera never stands further back than the plain
 * full-window framing. HUD insets can break that: fitting to a small band
 * (e.g. the home page at 390x844, with copy over the top 57%) can put the
 * camera behind the far plane.
 *
 * Only ever raised, and only to the fog's far edge: beyond it everything is the
 * page colour (see `oceanFog`).
 */
export function farPlaneFor(far: number, extent: BoardExtent, standoff: number): number {
  return Math.max(far, oceanFog(extent, standoff).far);
}

/** How far out the near plane reaches, as a fraction of board radius. */
const NEAR_PLANE_FRACTION = 0.05;
/** ...and at most this much of the clearance the zoom-in limit guarantees. */
const NEAR_PLANE_SHARE = 0.75;
/** How far past the sea's own radius the far plane sits. */
const FAR_PLANE_MARGIN = 2.2;

/**
 * How little air the camera may leave above the tallest thing on the board.
 *
 * Small, to allow a low raking look along the board without going under it
 * (the tiles have no authored undersides). Shared with the zoom-in limit; see
 * `minCameraDistance`.
 */
export const CAMERA_HEADROOM = 0.05;

/**
 * The steepest the camera may be swung, given how far out it is standing.
 *
 * Two fences; the stricter wins. This is the single value Board3D assigns to
 * `orbit.maxPolarAngle`, recomputed on every control change.
 *
 * The first is a height, not an angle: `y = target.y + d cos(polar)`, so the
 * clearing angle depends on `d`. When `d` is below `above - target.y` the ratio
 * exceeds 1 and the clamp returns 0, a fence that can't hold the camera up;
 * `minCameraDistance` keeps `d` out of that region.
 *
 * The second is `MAX_CAMERA_POLAR_RAD`, which stops the view raking past the
 * sea's edge. It binds far out, where the height fence is slack; the height
 * fence binds close in.
 */
export function maxPolarAngle(distance: number, ceiling: number, targetY = 0): number {
  if (!(distance > 0)) return 0;
  const above = Math.max(0, ceiling) + CAMERA_HEADROOM;
  const clearsBoard = Math.acos(Math.min(1, Math.max(-1, (above - targetY) / distance)));
  return Math.min(clearsBoard, MAX_CAMERA_POLAR_RAD);
}

/**
 * How much air the camera keeps above the board's tallest piece when it is
 * dollied all the way in.
 *
 * Larger than `CAMERA_HEADROOM`: skimming rooftops at a raking angle is a
 * view, but being dollied onto them tips the camera overhead and fills the
 * frame with one roof. Three units is about a hex's circumradius, roughly one
 * hex in frame at the limit. It is also what the near plane spends (see
 * `cameraPlanes`).
 */
export const MIN_CAMERA_CLEARANCE = 3;

/**
 * The zoom-in limit: how close the camera may come to its pivot.
 *
 * Measured against the tallest thing on the board, which Board3D measures as
 * it builds (its `ceiling`).
 *
 * Independent of the live elevation, for the same reasons as
 * `framingDistance`: it must bound every reachable pose, and the worst is
 * straight down, where the distance is the height; and it must be constant,
 * because OrbitControls clamps against `minDistance` on every update and a
 * tilt-dependent limit would push the camera back as the viewer orbited.
 */
export function minCameraDistance(ceiling: number): number {
  return Math.max(0, ceiling) + MIN_CAMERA_CLEARANCE;
}

/**
 * How far past its own edge the board may be dragged out of the way, as a
 * fraction of the board's half-span on that axis.
 *
 * Fences the pivot, so a drag can't walk the board off screen. Measured from
 * the edge, so panning to a corner is free. Relative to the span rather than
 * the radius: at the opening zoom half a span past the edge leaves about a
 * third of the board on screen, whereas on a coastline map the radius is far
 * larger than the short axis.
 */
export const PAN_MARGIN = 0.5;

/**
 * The pivot, put back inside the board's neighbourhood.
 *
 * Per axis against the board's span rather than its radius, as in
 * `defaultCameraDistance`: a coastline map's bounding circle is mostly sea.
 *
 * `zoomFrac` is the live distance over the zoom-out limit (1 framed whole,
 * toward 0 dollied in). The leash shortens with it, because the frame's ground
 * footprint shrinks with distance; a fixed leash let a zoomed-in view pan into
 * open water, unrecoverable without the reset button (absent on phones, see
 * `flatView`). The reach is interpolated linearly between:
 *
 *  - framed whole: `half * (1 + PAN_MARGIN)`;
 *  - dollied fully in: `half - pad`, the tile footprint (`halfSpans` pads by a
 *    lattice cell and a beach), so the frame centre is always over a tile and
 *    every tile is still reachable.
 *
 * The region is an ellipse through the per-axis reaches, not the box, whose
 * corners are open water (`sqrt(2)` times the reach) and could still lose the
 * board mid-zoom.
 *
 * Returns the clamped point rather than mutating, so the caller can apply the
 * same correction to the camera; moving only the pivot would rotate the view.
 */
export function clampPanTarget(
  x: number,
  z: number,
  extent: BoardExtent,
  zoomFrac = 1,
): { x: number; z: number } {
  const centre = frameTarget(extent);
  const half = halfSpans(extent);
  const t = Math.min(1, Math.max(0, zoomFrac));
  const reach = (h: number) => {
    // Never negative: a board whose span is all padding (a single tile) would
    // get an inverted leash.
    const tight = Math.max(0, h - SPAN_PAD);
    return tight + t * (h * (1 + PAN_MARGIN) - tight);
  };
  const rx = reach(half.x);
  const rz = reach(half.z);
  const dx = x - centre.x;
  const dz = z - centre.z;
  // Only degenerate if the board has no span; then the pivot is pinned to its
  // centre.
  if (!(rx > 0) || !(rz > 0)) return { x: centre.x, z: centre.z };
  // In units of each semi-axis the ellipse is the unit circle: one length test
  // and a scale that keeps the pan's direction.
  const over = Math.hypot(dx / rx, dz / rz);
  if (over <= 1) return { x, z };
  return { x: centre.x + dx / over, z: centre.z + dz / over };
}

// --- Smoothing ------------------------------------------------------------
//
// Three knobs, because the gestures differ:
//
// Rotate and pan are continuous drags, damped by OrbitControls
// (`enableDamping`): the camera chases the pointer and glides out on release.
// Pinch and middle-drag dolly are left undamped so they track the fingers.
//
// The mouse wheel is a discrete impulse that OrbitControls doesn't damp (its
// `_scale` accumulator is applied whole on the next update; see
// three.js#13342), so the board handles the wheel itself and pays a notch out
// over several frames.

/**
 * How much of the way the camera closes on the pointer each 60Hz frame.
 *
 * OrbitControls' `dampingFactor` is per frame, not per second (three ignores
 * frame time except for `autoRotate`), so `dampingForFrame` corrects it; this
 * is the value at 60Hz.
 *
 * Well above three's default 0.05, which suits spinning a model. A board is
 * aimed: 0.15 settles in about a tenth of a second, which reads as weight
 * rather than lag.
 */
export const CAMERA_DAMPING = 0.15;

/**
 * The same, for the wheel's own smoothing. See `dollyStep`. Faster than drag
 * damping: a notch is already over, so a long tail is just lateness. About four
 * frames.
 */
export const ZOOM_DAMPING = 0.25;

/**
 * How far the camera turns for a given drag, against OrbitControls' own scale.
 *
 * Three's default of 1 turns half a revolution for a drag across the canvas
 * height, which overshoots small corrections. A quarter of it matches intent.
 * Only the gain changes; fences and the leash are untouched.
 *
 * Three normalises by canvas height on both axes (`_handleMouseMoveRotate`),
 * so the turn is `360 * this / clientHeight` degrees per pixel (at 1280x720,
 * 0.25 turns about 24.6 degrees for 200px).
 */
export const CAMERA_ROTATE_SPEED = 0.25;

/** The frame the factors above are quoted for, in milliseconds. */
const REFERENCE_FRAME_MS = 1000 / 60;

/**
 * A per-frame smoothing fraction, corrected for how long the frame took.
 *
 * Exponential smoothing keeps `1 - f` of the error per step, `(1 - f)^n` over
 * `n` steps. Holding the amount kept per unit of time constant across frame
 * lengths gives the expression below (the identity behind three's
 * `MathUtils.damp`). At exactly 60Hz it returns `base`.
 *
 * Capped short of 1: a long frame (the ticker clamps stalls at 100ms) would
 * otherwise leave OrbitControls' velocity at exactly zero mid-gesture.
 */
export function dampingForFrame(base: number, dtMs: number): number {
  const f = Math.min(1, Math.max(0, base));
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  if (!(dtMs > 0)) return f;
  return Math.min(0.999, 1 - Math.pow(1 - f, dtMs / REFERENCE_FRAME_MS));
}

/**
 * How much one wheel notch is worth, as a factor to multiply the camera's
 * distance by.
 *
 * OrbitControls' own curve (0.95 per hundredth of a delta unit), so the reach
 * is unchanged and only smoothness differs. One expression: below 1 pulls in,
 * above 1 pushes out.
 *
 * `deltaMode` is normalised as three does it, since Firefox reports lines and
 * some devices pages.
 */
export const WHEEL_ZOOM_SPEED = 1;

export function wheelDollyFactor(deltaY: number, deltaMode = 0, speed = WHEEL_ZOOM_SPEED): number {
  const scaled = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  return Math.pow(0.95, -scaled * 0.01 * speed);
}

/**
 * The part of an outstanding dolly to spend on this frame.
 *
 * The debt is a ratio, so it is split multiplicatively: `pending^f` now leaves
 * `pending^(1-f)`, and they multiply back to `pending`. Additive splitting
 * would make a notch worth more zoomed out than in. This is exponential
 * smoothing in log space.
 */
export function dollyStep(pending: number, fraction: number): number {
  if (!(pending > 0)) return 1;
  return Math.pow(pending, Math.min(1, Math.max(0, fraction)));
}

/**
 * How far a world-space movement moves the picture, in CSS pixels.
 *
 * Board sizes vary and the camera stands further from large ones, so the rest
 * test can't use world units. What the viewer sees is the angle (`step /
 * distance` radians), and the frame is `2 tan(fov/2)` radians across
 * `viewportPx` pixels.
 */
export function screenMotionPx(
  stepWorld: number,
  distance: number,
  viewportPx: number,
  fovDeg = CAMERA_FOV_DEG,
): number {
  if (!(distance > 0) || !(viewportPx > 0)) return 0;
  const frameRad = 2 * Math.tan((fovDeg * Math.PI) / 360);
  return (Math.abs(stepWorld) / distance / frameRad) * viewportPx;
}

/**
 * Half a tenth of a pixel per frame: the point the board is done moving.
 *
 * Damped motion never reaches zero, so the animation loop needs a threshold or
 * it never stops. 0.05px per frame on a decaying tail means the rest of the
 * journey is a fraction of a pixel, and bounds the tail at about a second
 * after a hard fling. See `cameraAtRest`.
 */
export const CAMERA_REST_PX = 0.05;

/**
 * Has the camera come to rest?
 *
 * `stepWorld` is the larger of how far the camera and the pivot moved this
 * frame: a settling pan moves the pivot, a rotation only the camera.
 */
export function cameraAtRest(
  stepWorld: number,
  distance: number,
  viewportPx: number,
  fovDeg = CAMERA_FOV_DEG,
): boolean {
  return screenMotionPx(stepWorld, distance, viewportPx, fovDeg) < CAMERA_REST_PX;
}

export function makeCamera(
  aspect: number,
  extent: BoardExtent,
  flat = false,
): THREE.PerspectiveCamera {
  const planes = cameraPlanes(extent, aspect);
  const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, aspect, planes.near, planes.far);

  const target = frameTarget(extent);
  // The pose the board reframes to on the first resize, so the opening frame
  // doesn't jump.
  const pose = openingPose(aspect, flat);
  const dist = defaultCameraDistance(aspect, extent, pose.tiltDeg, pose.azimuthRad);
  const dir = orbitDir(pose.tiltDeg, pose.azimuthRad).multiplyScalar(dist);
  cam.position.set(target.x + dir.x, dir.y, target.z + dir.z);
  cam.lookAt(target);
  return cam;
}

/**
 * Aim the camera at a viewport of this size: the aspect.
 *
 * The board is not re-centred in the frame. A tilted camera projects a disc
 * asymmetrically, so the outline sits low while the centre is centred. Fixing
 * that with a view offset moves the aim point off screen centre, and the aim
 * point is the orbit pivot, so the board would swing oddly when rotated. The
 * pivot wins.
 */
export function applyViewport(
  cam: THREE.PerspectiveCamera,
  width: number,
  height: number,
  insets: HudInsets = { bottom: HUD_BOTTOM_INSET },
  extent?: BoardExtent,
): void {
  cam.aspect = height > 0 ? width / height : 1;
  // The far plane follows the sea, which depends on aspect, or the horizon
  // clips on a narrow window.
  if (extent) {
    const planes = cameraPlanes(extent, cam.aspect);
    cam.near = planes.near;
    cam.far = planes.far;
  }
  // The view offset is part of the projection, so it is reapplied after any
  // rebuild; setViewOffset calls updateProjectionMatrix, so it goes last.
  applyHudInset(cam, width, height, insets);
}

/**
 * Render layer carrying the seat-tinted pieces. three gathers lights per render
 * against `camera.layers`, not per object, so in practice both rigs light every
 * visible mesh (see the layer test in scene.test.ts).
 */
export const TINTED_LAYER = 1;

/**
 * The water, the only thing on an idle board that moves. Its own layer so it
 * can be drawn without re-rendering the rest of the board. See `oceanPass.ts`.
 */
export const OCEAN_LAYER = 2;

/**
 * Transparent marks that have to land on top of the water: placement markers,
 * ghosts, the hover highlight, seat numerals.
 *
 * Not in the cached half: the water is opaque and redrawn each frame, so a
 * cached marker on the sea would be painted over. Drawn after the water, which
 * matches three's opaque-then-transparent order anyway.
 */
export const OVERLAY_LAYER = 3;

/**
 * The light rigs, on layers of their own rather than on their geometry's.
 *
 * Lights are gathered per render against `camera.layers` (see
 * `projectObject`), so a pass with different geometry but the same lighting
 * must enable the lights separately. Both passes enable both rigs.
 */
export const BOARD_LIGHT_LAYER = 4;
export const TINTED_LIGHT_LAYER = 5;

/**
 * Direction the key light comes from. Shared so the rigs agree on shading, and
 * exported so the water's reflected sun matches it (see `oceanEnv.ts`).
 */
export const KEY_DIR = new THREE.Vector3(-1, 2.2, 1.4).normalize();

/**
 * The key light's shadow map, sized so a big board's shadows are as sharp as a
 * small one's.
 *
 * The shadow camera must contain the whole board (see `makeLights`), so a fixed
 * 2048 map gives a four-player base board about 56 texels a unit and a board
 * twice as wide half that. The map doubles until the density is back to the
 * base board's, capped at 4096 (a 64MB depth map) and the GPU's limit. The pass
 * only runs when a caster moves, so the cost is memory.
 */
export const SHADOW_MAP_MIN = 2048;
export const SHADOW_MAP_MAX = 4096;
/** Texels per world unit the base board's 2048 map buys. The target. */
export const SHADOW_TEXELS_PER_UNIT = 56;
/** The shadow camera's half-width over the board's radius. */
export const SHADOW_REACH = 1.25;

export function shadowMapSize(extent: BoardExtent, maxTextureSize = SHADOW_MAP_MAX): number {
  const want = 2 * SHADOW_REACH * extent.radius * SHADOW_TEXELS_PER_UNIT;
  let size = SHADOW_MAP_MIN;
  // A fifth of slack before doubling: the base board itself is a hair over the
  // round number, and quadrupling memory needs a visible difference.
  while (size * 1.2 < want && size < SHADOW_MAP_MAX) size *= 2;
  return Math.max(Math.min(size, maxTextureSize), Math.min(SHADOW_MAP_MIN, maxTextureSize));
}

/**
 * Two rigs. Terrain and props take the full lighting; seat-tinted materials
 * take a flatter, ambient-heavy treatment so a piece's rendered colour stays
 * close to its authored hex. Without that, two colours the server validated as
 * deltaE >= 12 apart can read identically when one sits on a lit face and the
 * other in shadow.
 *
 * Tinted meshes go on TINTED_LAYER. Lights are not filtered per object, though,
 * so both rigs currently light every visible mesh (see scene.test.ts).
 */
export function makeLights(
  extent: BoardExtent,
  look: BoardLook = BOARD_LOOKS.light,
  maxTextureSize = SHADOW_MAP_MAX,
): { board: THREE.Group; tinted: THREE.Group } {
  const board = new THREE.Group();
  // Key plus ambient should land near 1.0 on a surface facing the light, or
  // the tone mapper spends saturation pulling the board back down.
  const key = new THREE.DirectionalLight(look.key.hex, look.key.intensity);
  key.position.copy(KEY_DIR).multiplyScalar(extent.radius * 3);
  // Shadows by day only: under a moon they read as dirt on the tiles. Off also
  // skips the shadow-map pass.
  key.castShadow = look.key.castShadow;
  // The shadow camera is orthographic and must contain the whole board, or
  // tiles outside it lose their shadows.
  const reach = extent.radius * SHADOW_REACH;
  key.shadow.camera.left = -reach;
  key.shadow.camera.right = reach;
  key.shadow.camera.top = reach;
  key.shadow.camera.bottom = -reach;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = extent.radius * 8;
  // three builds the shadow camera's projection at construction with a
  // half-extent of 5; without this the map covers only the board's middle.
  key.shadow.camera.updateProjectionMatrix();
  const mapSize = shadowMapSize(extent, maxTextureSize);
  key.shadow.mapSize.set(mapSize, mapSize);
  // Props sit directly on the tile they shadow, so the bias must be small or
  // the contact shadow detaches.
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  board.add(key, key.target);
  board.add(new THREE.AmbientLight(look.ambient.hex, look.ambient.intensity));
  // On their own layers apart from the geometry, so both draw passes gather
  // the same lights. See BOARD_LIGHT_LAYER.
  board.traverse((n) => n.layers.set(BOARD_LIGHT_LAYER));

  const tinted = new THREE.Group();
  const soft = new THREE.DirectionalLight(look.key.hex, look.tinted.softIntensity);
  soft.position.copy(KEY_DIR).multiplyScalar(extent.radius * 3);
  tinted.add(soft, soft.target);
  tinted.add(new THREE.AmbientLight(look.ambient.hex, look.tinted.ambientIntensity));
  tinted.traverse((n) => n.layers.set(TINTED_LIGHT_LAYER));

  return { board, tinted };
}

/**
 * How far the framing distance must move before the camera is worth touching:
 * a tenth of a percent, below which no pixel changes.
 */
export const REFRAME_EPSILON = 1e-3;

/**
 * Whether a side band (the seat rail, the feed island) that arrived after the
 * board opened should re-open the camera at the exact fit.
 *
 * Only for a camera nobody has touched, with no showcase turn, and when the fit
 * moved by more than the reframe's 2%. Otherwise HUD changes never move the
 * camera; the side columns are the exception because they mount just after the
 * board opens (see Board3D's `reframe`).
 */
export function reopenForSideBand(o: {
  viewerMoved: boolean;
  showcasing: boolean;
  /** The camera's distance from the target now. */
  at: number;
  /** The opening fit's distance for the new bands. */
  fit: number;
}): boolean {
  if (o.viewerMoved || o.showcasing || !(o.fit > 0)) return false;
  return Math.abs(o.at - o.fit) > o.fit * 0.02;
}

/**
 * Whether a new framing distance is worth moving the camera for.
 *
 * The board re-frames on every content commit, and re-framing ends in
 * `settleCamera`, which disables damping and calls `orbit.update()`. During a
 * drag that applies the accumulated damped motion in one jump (up to 13% of
 * the viewing distance). Most rebuilds ask for the same distance, so this skips
 * them.
 *
 * `framed <= 0` means the host has never been measured, so the first call is
 * the opening view and always counts.
 */
export function reframeNeeded(want: number, framed: number): boolean {
  if (!(want > 0)) return false;
  if (framed <= 0) return true;
  return Math.abs(want / framed - 1) >= REFRAME_EPSILON;
}

/**
 * How far the ceiling must move before the board is worth re-fitting.
 *
 * The ceiling (tallest piece) is the one framing input that changes during a
 * game, by amounts the framing distance barely notices. But `refit` bypasses
 * `resize`'s guard and rescales the viewer's distance, so without this the
 * camera shifted whenever a knight activated or the robber moved.
 *
 * One unit clears the whole range a game moves it through, not just one step:
 * the floor is the terrain (mountains, 2.29), the top a mighty knight's raised
 * sword (3.007), with the robber (2.50 on desert, 2.69 on a chip) and a
 * metropolis (2.78) between, a range of 0.717.
 *
 * Skipping the refit doesn't skip the fences: `ceiling` updates immediately and
 * `keepAboveBoard` re-solves the zoom-in stop and tilt floor on every
 * OrbitControls `change`. Only the standoff waits for the next resize.
 *
 * Absolute rather than relative, because pieces are the same size on every map
 * (see `minCameraDistance`). A new board takes the ceiling through zero, which
 * `ceilingMoved` always counts.
 */
export const CEILING_EPSILON = 1;

/**
 * Whether a new ceiling is worth re-fitting the board for. `prev <= 0` is the
 * board's first measurement, which always counts (it takes the opening view
 * from the flat framing to the real one).
 */
export function ceilingMoved(prev: number, next: number): boolean {
  if (!(prev > 0)) return next > 0;
  return Math.abs(next - prev) >= CEILING_EPSILON;
}
