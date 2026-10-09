import { test, expect, describe, it } from "vitest";
import * as THREE from "three";
import {
  reframeNeeded,
  reopenForSideBand,
  ceilingMoved,
  CEILING_EPSILON,
  boardExtent,
  boardFitPoints,
  fitDistance,
  framingDistanceFor,
  orbitDir,
  cameraReadout,
  usableFrame,
  fitBounds,
  FLAT_FRAME_MARGIN,
  oceanRadius,
  __resetOceanRadiusCache,
  __oceanRadiusSolves,
  makeCamera,
  makeLights,
  frameTarget,
  applyViewport,
  cameraDistance,
  cameraElevationDeg,
  showcaseSettle,
  showcaseSpin,
  SHOWCASE_SETTLE_MS,
  SHOWCASE_SPINUP_MS,
  SHOWCASE_TURN_DEG_PER_SEC,
  framingDistance,
  cameraPlanes,
  farPlaneFor,
  defaultCameraDistance,
  openingPose,
  flatView,
  FLAT_MAX_PX,
  applyHudInset,
  halfSpans,
  clampPanTarget,
  oceanBackdropRadius,
  PAN_MARGIN,
  minCameraDistance,
  maxPolarAngle,
  MIN_CAMERA_CLEARANCE,
  CAMERA_HEADROOM,
  CAMERA_FOV_DEG,
  HUD_BOTTOM_INSET,
  MIN_CAMERA_ELEVATION_DEG,
  MAX_CAMERA_POLAR_RAD,
  FLAT_VIEW_QUERY,
  CAMERA_TILT_DEG,
  TINTED_LAYER,
  OCEAN_LAYER,
  OVERLAY_LAYER,
  BOARD_LIGHT_LAYER,
  TINTED_LIGHT_LAYER,
  OCEAN_NEAR_BAND,
  OCEAN_FOG_REACH,
  nearOceanRadius,
  oceanFadeFor,
  oceanRadiusAnyAspect,
  oceanFog,
  configureShadows,
  CAMERA_DAMPING,
  ZOOM_DAMPING,
  CAMERA_REST_PX,
  dampingForFrame,
  wheelDollyFactor,
  dollyStep,
  screenMotionPx,
  cameraAtRest,
  invalidateShadows,
  type BoardExtent,
  boardShapeKey,
  shadowMapSize,
  SHADOW_MAP_MIN,
  SHADOW_MAP_MAX,
} from "./scene";
import type { BoardTile } from "@/lib/types";
import { LATTICE_SIZE, hexToWorld } from "./coords";
import { BEACH_ENVELOPE } from "./beachGeometry";
import { HULL_CLEARANCE } from "./ocean";

/** How far the camera stands from the point it is aiming at. */
function standoff(aspect: number, e: BoardExtent): number {
  return makeCamera(aspect, e).position.distanceTo(frameTarget(e));
}

/**
 * Where the board's own footprint lands in normalised device coordinates.
 *
 * The direct check that the board is in frame. Uses the padded box the extent
 * describes, not its bounding circle; they differ a lot on a coastline (see
 * `defaultCameraDistance`). The zoom-out limit still owes the circle, tested
 * in "the zoom-out limit frames the board at every angle".
 */
function boardNdc(
  aspect: number,
  e: BoardExtent,
  cam = makeCamera(aspect, e),
  shape: "box" | "circle" = "box",
): { x: number[]; y: number[] } {
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const cx = (e.minX + e.maxX) / 2;
  const cz = (e.minZ + e.maxZ) / 2;
  const half = halfSpans(e);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < 360; i++) {
    const a = (i * Math.PI) / 180;
    // The box's boundary, walked by the same angle sweep: whichever side the
    // ray leaves through clamps it.
    const t =
      shape === "circle"
        ? e.radius
        : Math.min(
            half.x / Math.max(1e-9, Math.abs(Math.cos(a))),
            half.z / Math.max(1e-9, Math.abs(Math.sin(a))),
          );
    const p = new THREE.Vector3(cx + t * Math.cos(a), 0, cz + t * Math.sin(a));
    p.project(cam);
    x.push(p.x);
    y.push(p.y);
  }
  return { x, y };
}

/** A camera at a given elevation and distance, aimed at the board's centre. */
function camAt(aspect: number, e: BoardExtent, elevDeg: number, dist: number) {
  const cam = makeCamera(aspect, e);
  const t = frameTarget(e);
  const rad = (elevDeg * Math.PI) / 180;
  cam.position.set(t.x, t.y + Math.sin(rad) * dist, t.z + Math.cos(rad) * dist);
  cam.lookAt(t);
  return cam;
}

const tiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 2, r: 0 }, res: "sea", num: 0 },
  { hex: { q: 0, r: 2 }, res: "ore", num: 5 },
];

/** The lights in a rig. A rig also holds its directional lights' targets. */
function lightsOf(group: THREE.Group): THREE.Light[] {
  return group.children.filter((c) => (c as THREE.Light).isLight) as THREE.Light[];
}

/** Fraction of a rig's total intensity that comes from ambient light. */
function ambientShare(group: THREE.Group): number {
  let ambient = 0;
  let total = 0;
  for (const light of lightsOf(group)) {
    total += light.intensity;
    if ((light as THREE.AmbientLight).isAmbientLight) ambient += light.intensity;
  }
  return ambient / total;
}

test("the extent covers every tile center", () => {
  const e = boardExtent(tiles);
  expect(e.minX).toBeLessThanOrEqual(0);
  expect(e.maxX).toBeGreaterThan(0);
  expect(e.radius).toBeGreaterThan(0);
});

test("an empty board yields a finite extent rather than Infinity", () => {
  const e = boardExtent([]);
  expect(Number.isFinite(e.radius)).toBe(true);
});

test("the ocean is strictly larger than the board it surrounds", () => {
  // A finite ocean must still cover the frustum at max zoom-out, or the sea
  // visibly ends on large Islands boards.
  const e = boardExtent(tiles);
  expect(oceanRadius(e)).toBeGreaterThan(e.radius);
});

test("the ocean scales with the board rather than being a fixed size", () => {
  const small = boardExtent([{ hex: { q: 0, r: 0 }, res: "sea", num: 0 }]);
  const large = boardExtent([
    { hex: { q: -6, r: -6 }, res: "sea", num: 0 },
    { hex: { q: 6, r: 6 }, res: "sea", num: 0 },
  ]);
  expect(oceanRadius(large)).toBeGreaterThan(oceanRadius(small));
});

test("the ocean radius is memoised by argument value", () => {
  // `oceanRadius` is a ~500k-iteration sweep and must be memoised by value:
  // `oceanHexes` builds a fresh `boardExtent` per call while `Board3D` passes a
  // memoised one, and an identity-keyed slot made them evict each other.
  const a = boardExtent(tiles);
  const b = boardExtent(tiles);
  expect(a).not.toBe(b); // distinct objects, equal values, as in real use
  __resetOceanRadiusCache();

  expect(oceanRadius(a, 16 / 9)).toBe(oceanRadius(b, 16 / 9));
  expect(__oceanRadiusSolves()).toBe(1);

  // Alternating between the two callers' extents must not thrash the cache.
  for (let i = 0; i < 8; i++) oceanRadius(i % 2 ? a : b, 16 / 9);
  expect(__oceanRadiusSolves()).toBe(1);

  // A genuinely different argument still recomputes.
  oceanRadius(a, 9 / 16);
  expect(__oceanRadiusSolves()).toBe(2);
});

test("nothing the static build draws depends on the aspect", () => {
  // A resize doesn't rerun the static half of the build (it is rebuilt only
  // when the board changes), so anything static sized against the viewport
  // would keep a stale aspect and show a gap at the horizon.
  //
  // These are the values the static passes take an `aspect` for; each is
  // clamped to the board, not the frame. If one becomes aspect-dependent it
  // must move onto the resize path.
  for (const name of ["small", "large"] as const) {
    const e = name === "small" ? boardExtent(tiles) : boards.large;
    const at = (a: number) => ({
      near: nearOceanRadius(e, a),
      backdrop: oceanBackdropRadius(e, a),
      fade: oceanFadeFor(e, a),
    });
    const base = at(1.78);
    for (const a of [0.3, 0.9, 4]) {
      expect(at(a), `${name} @ ${a}`).toEqual(base);
    }
  }
});

test("the annulus is sized for the worst aspect, found at an edge", () => {
  // `oceanRadiusAnyAspect` samples only the two ends of the range, which is
  // sound only if the requirement is quasi-convex in aspect (lowest near
  // square). Otherwise an interior peak would end the sea inside the frame.
  const ASPECTS = [0.3, 0.4, 0.5, 0.7, 0.9, 1.1, 1.4, 1.78, 2.2, 2.8, 3.4, 4];
  for (const e of [boardExtent(tiles), boards.large, boards.small]) {
    const vals = ASPECTS.map((a) => oceanRadius(e, a));
    const interiorMax = Math.max(...vals.slice(1, -1));
    const endpointMax = Math.max(vals[0], vals[vals.length - 1]);
    expect(interiorMax).toBeLessThanOrEqual(endpointMax);
    // And the ring actually covers every one of them.
    expect(oceanRadiusAnyAspect(e)).toBeGreaterThanOrEqual(Math.max(...vals));
  }
});

test("the ocean radius cache keeps more than one board in it at a time", () => {
  // A single slot would make two live boards (a game plus a preview, or two
  // aspects during a resize) evict each other every frame.
  const small = boardExtent([{ hex: { q: 0, r: 0 }, res: "sea", num: 0 }]);
  const large = boardExtent(tiles);
  __resetOceanRadiusCache();

  oceanRadius(small, 16 / 9);
  oceanRadius(large, 16 / 9);
  expect(__oceanRadiusSolves()).toBe(2);

  oceanRadius(small, 16 / 9);
  oceanRadius(large, 16 / 9);
  expect(__oceanRadiusSolves()).toBe(2);
});

test("the camera is perspective and tilted, not top-down", () => {
  // Orthographic has no convergence, so the board would read as a flat
  // illustration at any tilt.
  const cam = makeCamera(16 / 9, boardExtent(tiles));
  expect(cam.isPerspectiveCamera).toBe(true);
  expect(cam.position.y).toBeGreaterThan(0);
  expect(CAMERA_TILT_DEG).toBeGreaterThan(0);
  expect(CAMERA_TILT_DEG).toBeLessThan(90);
});

test("the camera pulls back far enough to frame a narrow window", () => {
  // Fitting only the vertical axis crops a wide board off the sides, so a
  // portrait aspect has to stand further off than a landscape one.
  const e = boardExtent(tiles);
  expect(standoff(9 / 16, e)).toBeGreaterThan(standoff(16 / 9, e));
});

test("a bigger board is framed from further away", () => {
  const large = boardExtent([
    { hex: { q: -8, r: -8 }, res: "sea", num: 0 },
    { hex: { q: 8, r: 8 }, res: "sea", num: 0 },
  ]);
  expect(standoff(16 / 9, large)).toBeGreaterThan(standoff(16 / 9, boardExtent(tiles)));
});

test("the whole board is inside the frame, near edge included", () => {
  // The near edge is closer than the centre and subtends more angle; this
  // checks the fit accounts for that at every window shape.
  for (const aspect of [21 / 9, 16 / 9, 4 / 3, 1, 3 / 4, 9 / 16]) {
    for (const e of [
      boardExtent(tiles),
      boardExtent([
        { hex: { q: -8, r: -8 }, res: "sea", num: 0 },
        { hex: { q: 8, r: 8 }, res: "sea", num: 0 },
      ]),
    ]) {
      const { x, y } = boardNdc(aspect, e);
      expect(Math.max(...x.map(Math.abs)), `aspect ${aspect} horizontally`).toBeLessThanOrEqual(1);
      expect(Math.max(...y.map(Math.abs)), `aspect ${aspect} vertically`).toBeLessThanOrEqual(1);
    }
  }
});

test("the camera orbits about the board's centre, whatever the window shape", () => {
  // Dragging must turn the view around the island; any other pivot swings the
  // island around the frame, and an aspect-dependent pivot jumps on resize.
  const off = boardExtent([
    { hex: { q: 3, r: 1 }, res: "wood", num: 8 },
    { hex: { q: 7, r: 5 }, res: "ore", num: 5 },
  ]);
  const centre = new THREE.Vector3((off.minX + off.maxX) / 2, 0, (off.minZ + off.maxZ) / 2);
  expect(frameTarget(off).distanceTo(centre)).toBeLessThan(1e-9);
  // And the camera looks straight at the pivot, or the first drag snaps the
  // view.
  for (const aspect of [21 / 9, 1, 9 / 16]) {
    const cam = makeCamera(aspect, off);
    const look = centre.clone().sub(cam.position).normalize();
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(look.distanceTo(facing), `aspect ${aspect}`).toBeLessThan(1e-6);
  }
});

test("tinted pieces get a flatter rig than the board", () => {
  // Shading widens a color into a range; the server's deltaE >= 12 guarantee is
  // computed on flat hex, so seat-tinted materials must stay near their
  // authored color.
  const { board, tinted } = makeLights(boardExtent(tiles));
  expect(ambientShare(tinted)).toBeGreaterThan(ambientShare(board));
});

test("each rig is on a layer of its own, apart from the geometry it lights", () => {
  // three.js gathers lights once per render against `camera.layers` (see
  // WebGLRenderer's projectObject); there is no per-object light filtering, so
  // both rigs light every visible mesh, tinted or not. Making them separate
  // would change how the board looks, so that is left as is.
  //
  // What the layers do provide, and this pins, is the two-pass split: lights
  // sit apart from geometry, so a pass can enable the lights without the
  // meshes, which lets the water be drawn alone over a cached board with the
  // same lighting. See `oceanPass.ts`.
  const { board, tinted } = makeLights(boardExtent(tiles));
  const geometryLayers = [0, TINTED_LAYER, OCEAN_LAYER, OVERLAY_LAYER];

  for (const [rig, layer] of [
    [board, BOARD_LIGHT_LAYER],
    [tinted, TINTED_LIGHT_LAYER],
  ] as const) {
    for (const light of lightsOf(rig)) {
      const probe = new THREE.Object3D();
      probe.layers.set(layer);
      expect(light.layers.test(probe.layers)).toBe(true);
      for (const other of geometryLayers) {
        const mesh = new THREE.Object3D();
        mesh.layers.set(other);
        expect(light.layers.test(mesh.layers)).toBe(false);
      }
    }
  }
});

test("the key light casts, and its shadow camera covers the board", () => {
  const e = boardExtent(tiles);
  const { board } = makeLights(e);
  const key = lightsOf(board).find((c) => (c as THREE.DirectionalLight).isDirectionalLight);
  const light = key as THREE.DirectionalLight;
  expect(light.castShadow).toBe(true);
  // A shadow camera smaller than the board drops the shadows of every tile
  // outside it.
  expect(light.shadow.camera.right).toBeGreaterThanOrEqual(e.radius);
  expect(light.shadow.camera.top).toBeGreaterThanOrEqual(e.radius);
  expect(light.shadow.camera.far).toBeGreaterThan(light.position.length());
});

/** Where a world point lands on screen, as NDC in [-1, 1]. */
function projectNdc(cam: THREE.PerspectiveCamera, p: THREE.Vector3): THREE.Vector3 {
  // Without a renderer the camera's matrixWorld is still the identity and
  // project() returns nonsense.
  cam.updateMatrixWorld(true);
  return p.clone().project(cam);
}

test("the board's centre sits one HUD inset above the middle of the screen", () => {
  // This offset is a fixed fraction of the frame chosen to clear the HUD's
  // hand shelf, identical at every aspect and elevation (the next test pins
  // that) and resolution-independent. Set HUD_BOTTOM_INSET to 0 and every
  // expectation here returns to dead centre. (Centring the bounding disc with
  // a camera-derived pixel offset would move the orbit pivot and vary with
  // resolution.)
  //
  // Accepted: the pivot projects one inset above the window's middle, so
  // rotation turns about that point.
  const e = boardExtent(tiles);
  for (const aspect of [16 / 9, 1, 3 / 4]) {
    const cam = makeCamera(aspect, e);
    applyViewport(cam, 1600, 1600 / aspect);
    const ndc = projectNdc(cam, frameTarget(e));
    expect(ndc.x, `x at aspect ${aspect}`).toBeCloseTo(0, 6);
    expect(ndc.y, `y at aspect ${aspect}`).toBeCloseTo(HUD_BOTTOM_INSET, 6);
  }
});

test("the board's offset is the same at every elevation", () => {
  // The offset must not drift as the camera orbits, or the board creeps up
  // and down the screen while you turn it.
  const e = boardExtent(tiles);
  const cam = makeCamera(16 / 11, e);
  applyViewport(cam, 1600, 1100);
  const t = frameTarget(e);
  const d = cam.position.distanceTo(t);
  for (const deg of [40, 70, 89]) {
    const a = (deg * Math.PI) / 180;
    cam.position.set(t.x, Math.sin(a) * d, t.z + Math.cos(a) * d);
    cam.lookAt(t);
    const ndc = projectNdc(cam, t);
    expect(ndc.y, `elevation ${deg}`).toBeCloseTo(HUD_BOTTOM_INSET, 6);
  }
});

test("a resize updates the aspect", () => {
  // The camera's aspect must track the window. With a view offset, cam.aspect
  // describes the virtual frame (three.js sets it to fullWidth/fullHeight), so
  // the canvas aspect is that times (1 + inset).
  const cam = makeCamera(1, boardExtent(tiles));
  applyViewport(cam, 1600, 900);
  expect(cam.aspect * (1 + HUD_BOTTOM_INSET)).toBeCloseTo(1600 / 900, 6);
});

test("framing the board includes the beach it puts in the water", () => {
  // The radius drives the zoom-out limit and the ocean's reach, so it must
  // include the beach: BEACH_ENVELOPE, the furthest the wandering ribbon can
  // go, not its average width.
  const e = boardExtent(tiles);
  const cornerOnly = Math.max(e.maxX - e.minX, e.maxZ - e.minZ) / 2 + LATTICE_SIZE;
  expect(e.radius).toBeGreaterThan(cornerOnly);
  expect(e.radius - cornerOnly).toBeCloseTo(BEACH_ENVELOPE, 6);
});

test("how far back the whole map needs depends on the tilt", () => {
  // Counter-intuitively the steeper camera needs the most room: straight down
  // shows the board's full width in the frame's short axis, while tilting
  // foreshortens it. So a limit pinned to the default tilt is too near when
  // orbiting up toward top-down.
  const e = boardExtent(tiles);
  const steep = cameraDistance(16 / 9, e, 80);
  const mid = cameraDistance(16 / 9, e, CAMERA_TILT_DEG);
  const shallow = cameraDistance(16 / 9, e, 40);
  expect(steep).toBeGreaterThan(mid);
  expect(mid).toBeGreaterThan(shallow);
});

test("elevation is read back off the camera the rig built", () => {
  const e = boardExtent(tiles);
  const cam = makeCamera(16 / 9, e);
  expect(cameraElevationDeg(cam, frameTarget(e))).toBeCloseTo(CAMERA_TILT_DEG, 6);
});

test("the zoom-out limit does not move when the camera tilts", () => {
  // A bound over every reachable angle, not the requirement at one: a limit
  // that tracked the live tilt would shrink as the camera dropped, and
  // OrbitControls would dolly the camera in as it tilted.
  const e = boardExtent(tiles);
  const limit = framingDistance(16 / 9, e);
  for (let deg = MIN_CAMERA_ELEVATION_DEG; deg <= 90; deg += 5) {
    expect(cameraDistance(16 / 9, e, deg)).toBeLessThanOrEqual(limit + 1e-9);
  }
});

test("the limit is the peak requirement, which is not at either end", () => {
  // The requirement peaks around 80 degrees, so the bound can't be read off an
  // endpoint.
  const e = boardExtent(tiles);
  const limit = framingDistance(16 / 9, e);
  expect(limit).toBeGreaterThan(cameraDistance(16 / 9, e, MIN_CAMERA_ELEVATION_DEG));
  expect(limit).toBeGreaterThan(cameraDistance(16 / 9, e, 90));
});

test("the ocean reaches as far as the camera may stand back", () => {
  // The sea must reach past the back of the dolly range, or the horizon shows
  // its edge.
  const e = boardExtent(tiles);
  expect(oceanRadius(e, 16 / 9)).toBeGreaterThan(framingDistance(16 / 9, e) * 0.5);
});

// --- camera planes -------------------------------------------------------
// The depth buffer has to separate the ocean's wave sheet from the hull sunk
// beneath it at the distance the sea is drawn from. Pins the ratio rather than
// the plane values, so it survives a retune of either.

/** A synthetic extent of the given radius, centred on the origin. */
function ext(radius: number): BoardExtent {
  return { radius, minX: -radius, maxX: radius, minZ: -radius, maxZ: radius };
}

/** Depth resolution at distance z for a 24-bit buffer. */
function depthStep(z: number, near: number, far: number): number {
  return (z * z * (far - near)) / (far * near * (2 ** 24 - 1));
}

test("the depth buffer separates water from hull at the sea's far edge", () => {
  for (const radius of [2, 3, 4]) {
    for (const aspect of [0.5, 1, 1.6, 2.2]) {
      const extent = ext(radius);
      const { near, far } = cameraPlanes(extent, aspect);
      // The worst case on screen: the far edge of the sea.
      const z = oceanRadius(extent, aspect);
      const ratio = HULL_CLEARANCE / depthStep(z, near, far);
      expect(ratio, `r=${radius} aspect=${aspect} -> ${ratio.toFixed(1)}x`).toBeGreaterThan(8);
    }
  }
});

test("the near plane never clips the board at the dolly minimum", () => {
  // Bounded by the air the zoom-in limit holds open, not by the closest dolly
  // to the pivot: fully dollied in, the camera is nearly overhead and a piece
  // top below it is MIN_CAMERA_CLEARANCE away at any board radius.
  for (const extent of [ext(2), ext(4), boards.large, boards.huge]) {
    for (const aspect of [0.5, 1, 1.6, 2.4]) {
      const { near } = cameraPlanes(extent, aspect);
      const where = `r=${extent.radius.toFixed(1)} aspect=${aspect}`;
      expect(near, where).toBeGreaterThan(0);
      expect(near, where).toBeLessThan(MIN_CAMERA_CLEARANCE);
    }
  }
});

test("the far plane still reaches past the sea", () => {
  for (const aspect of [0.5, 1.6]) {
    const extent = ext(3);
    expect(cameraPlanes(extent, aspect).far).toBeGreaterThan(oceanRadius(extent, aspect));
  }
});

// --- the zoom-in limit ---------------------------------------------------
//
// The camera is held above the board by a height, enforced by two numbers:
// `maxPolarAngle` tips the camera up as it comes down
// (`y = target.y + d cos(polar)`), and `minCameraDistance` keeps `d` out of the
// range where no angle can do it (inside `d = ceiling + CAMERA_HEADROOM` the
// angle saturates at zero).
//
// The heights below are those the board is built at: nothing at SURFACE.land
// reaches a quarter of a unit, and a city or knight at twice its authored
// scale is about three.

/** Ceilings worth checking: an empty board through to one with cities on it. */
const CEILINGS = [0, 0.25, 1.6, 3, 4.5];

/** Every pose the fence leaves reachable at a given distance, as camera heights. */
function reachableHeights(distance: number, ceiling: number, targetY = 0): number[] {
  const most = maxPolarAngle(distance, ceiling, targetY);
  const out: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const polar = (most * i) / 40;
    out.push(targetY + distance * Math.cos(polar));
  }
  return out;
}

test("the camera stays above the board at the closest the controls can dolly", () => {
  for (const ceiling of CEILINGS) {
    const d = minCameraDistance(ceiling);
    for (const y of reachableHeights(d, ceiling)) {
      expect(y, `ceiling ${ceiling}`).toBeGreaterThanOrEqual(ceiling + CAMERA_HEADROOM - 1e-9);
    }
    // The angle fence must not saturate (straight down only, height unheld):
    // at the limit there is still most of a quadrant of tilt left.
    expect(maxPolarAngle(d, ceiling), `ceiling ${ceiling}`).toBeGreaterThan(Math.PI / 4);
  }
});

test("the camera stays above the board anywhere inside the dolly range", () => {
  // The fence must hold at every distance on the way out too, not just the
  // limit.
  for (const ceiling of CEILINGS) {
    const min = minCameraDistance(ceiling);
    for (let d = min; d <= min + 120; d += 1.5) {
      for (const y of reachableHeights(d, ceiling)) {
        expect(y, `ceiling ${ceiling} at ${d.toFixed(1)}`).toBeGreaterThanOrEqual(
          ceiling + CAMERA_HEADROOM - 1e-9,
        );
      }
    }
  }
});

test("panning at the zoom-in limit cannot get the camera under the board", () => {
  // Panning while zoomed in: Board3D sets screenSpacePanning = false, so pans
  // are along the ground and the pivot keeps its y. Checked, since a sinking
  // pivot (via `clampPanTarget`) would take the camera down with it.
  for (const board of [boards.small, boards.large, boards.huge, boards.wide]) {
    const centre = frameTarget(board);
    expect(centre.y).toBe(0);
    for (const [px, pz] of [
      [1e6, 1e6],
      [-1e6, 1e6],
      [0, -1e6],
      [centre.x, centre.z],
    ]) {
      const clamped = clampPanTarget(px, pz, board);
      // The pivot's height is not among the things a pan may move.
      expect(Object.keys(clamped).sort()).toEqual(["x", "z"]);
      const pivot = new THREE.Vector3(clamped.x, centre.y, clamped.z);
      const d = minCameraDistance(3);
      for (const y of reachableHeights(d, 3, pivot.y)) {
        expect(y, `pan to ${clamped.x.toFixed(1)},${clamped.z.toFixed(1)}`).toBeGreaterThan(3);
      }
    }
  }
});

test("the zoom-in limit does not move as the camera is orbited", () => {
  // As for `framingDistance`: OrbitControls clamps against minDistance on
  // every update, so a tilt-dependent limit would push the camera back as the
  // viewer orbited down. It reads the ceiling only.
  const d = minCameraDistance(3);
  for (let deg = 1; deg <= 90; deg += 1) {
    const cam = orbitDir(deg, deg / 10).multiplyScalar(d);
    expect(cam.length()).toBeCloseTo(d, 10);
  }
});

test("the zoom-in limit still comes close enough to read a single hex", () => {
  // And not too large, or zooming in does nothing. A hex is
  // `sqrt(3) * LATTICE_SIZE` across the flats, and at the limit the frame is
  // about one hex tall.
  const acrossFlats = Math.sqrt(3) * LATTICE_SIZE;
  const frame = (ceiling: number) =>
    2 * minCameraDistance(ceiling) * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  expect(frame(0)).toBeLessThan(acrossFlats);
  expect(frame(3)).toBeLessThan(acrossFlats * 1.5);
});

test("the zoom-in limit sits well inside the zoom-out limit on a real board", () => {
  // Computed independently; if they crossed, OrbitControls would get an empty
  // range. Board3D caps one against the other anyway; the cap should never
  // act.
  for (const board of [boards.small, boards.large, boards.huge, boards.wide]) {
    for (const [w, h] of WINDOWS) {
      const out = framingDistance(w / h, board, 3);
      expect(minCameraDistance(3), `${w}x${h}`).toBeLessThan(out * 0.5);
    }
  }
});

// --- the near field, and where the flat sea takes over -------------------

/** Roughly how many hexes a sea of this radius costs. See oceanHexes. */
function hexCount(radius: number): number {
  const rings = Math.ceil(radius / (LATTICE_SIZE * 1.5)) + 1;
  return 3 * rings * (rings + 1) + 1;
}

/**
 * Extents across the whole range, including the themed presets.
 *
 * `small` and `large` keep the ocean join off frame; `huge` (the biggest gallery
 * map, radius 14, tiles spanning ~120 units) brings it into the picture.
 * `wide` is a coastline, much broader than deep, whose bounding circle is
 * mostly sea.
 */
const boards = {
  small: boardExtent([
    { hex: { q: -2, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 2, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 0, r: -2 }, res: "sea", num: 0 },
    { hex: { q: 0, r: 2 }, res: "sea", num: 0 },
  ]),
  large: boardExtent([
    { hex: { q: -4, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 4, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 0, r: -4 }, res: "sea", num: 0 },
    { hex: { q: 0, r: 4 }, res: "sea", num: 0 },
  ]),
  huge: boardExtent([
    { hex: { q: -13, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 13, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 0, r: -13 }, res: "sea", num: 0 },
    { hex: { q: 0, r: 13 }, res: "sea", num: 0 },
  ]),
  wide: boardExtent([
    { hex: { q: -13, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 13, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 0, r: -4 }, res: "sea", num: 0 },
    { hex: { q: 0, r: 4 }, res: "sea", num: 0 },
  ]),
};

test("the tessellated sea stops where the water fades out, not where it ends", () => {
  // The swell is a collar on the coastline; past it is one flat ring, and past
  // the fog the page. Neither depends on how far back the camera may stand.
  for (const [name, e] of Object.entries(boards)) {
    expect(nearOceanRadius(e, 16 / 9), name).toBeLessThan(oceanRadius(e, 16 / 9));
  }
  // Measured against the field the camera would have asked for; the big board
  // is where it matters most.
  expect(hexCount(nearOceanRadius(boards.large, 16 / 9))).toBeLessThan(
    hexCount(oceanRadius(boards.large, 16 / 9)) / 4,
  );
});

test("the collar is measured from the coastline, not from the viewport", () => {
  // The collar depends only on the coast, so every window gets the same one;
  // sizing hexes off the frustum would add thousands for tall windows or big
  // boards.
  for (const [name, e] of Object.entries(boards)) {
    const wide = nearOceanRadius(e, 21 / 9);
    const tall = nearOceanRadius(e, 9 / 16);
    expect(tall, name).toBeCloseTo(wide, 9);
    expect(wide - e.radius, `${name} band`).toBeCloseTo(OCEAN_NEAR_BAND, 9);
  }
});

test("every board has water past its coast, and the swell fades inside it", () => {
  // The collar must exist (or the swell is a ripple trim) and the fade must
  // complete inside it. `oceanFadeFor` clamps its inner edge to the coastline,
  // so an over-wide fade would silently shrink; this pins that the swell is
  // done before the flat ring starts.
  for (const [name, e] of Object.entries(boards)) {
    const near = nearOceanRadius(e, 16 / 9);
    expect(near - e.radius, `${name} band`).toBeGreaterThan(LATTICE_SIZE);
    const fade = oceanFadeFor(e, 16 / 9);
    expect(fade.outer, `${name} fade ends at the join`).toBeCloseTo(near, 9);
    expect(fade.inner, `${name} fade starts at sea`).toBeGreaterThanOrEqual(e.radius);
    expect(fade.inner, `${name} fade is a band`).toBeLessThan(fade.outer);
  }
});

/**
 * Every ground point the frustum can show, and how far each is from the camera.
 *
 * Independent of scene.ts's own solve, so it actually checks it. Rays are
 * traced through a grid of the frame, corners included (corner rays have a
 * shallower depression and travel further).
 *
 * Panning is swept too: the pivot may be dragged `PAN_MARGIN` past the board's
 * half-span, while the ocean stays a disc about the lattice origin.
 */
function worstBarePage(
  extent: BoardExtent,
  aspect: number,
  standoff: number,
  sea: number,
): { fromOrigin: number; fromCamera: number } | null {
  const halfV = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const halfH = halfV * aspect;
  const centre = frameTarget(extent);
  const half = halfSpans(extent);
  let worst: { fromOrigin: number; fromCamera: number } | null = null;
  for (const px of [-1, 0, 1]) {
    for (const pz of [-1, 0, 1]) {
      const pivotX = centre.x + px * half.x * (1 + PAN_MARGIN);
      const pivotZ = centre.z + pz * half.z * (1 + PAN_MARGIN);
      // 3.7 degrees and 7 bearings, so every pose sampled here falls between
      // the ones scene.ts solves at.
      for (let deg = MIN_CAMERA_ELEVATION_DEG; deg <= 90; deg += 3.7) {
        const e = (deg * Math.PI) / 180;
        for (let a = 0; a < 7; a++) {
          const az = (a * 2 * Math.PI) / 7;
          const ux = Math.sin(az) * Math.cos(e);
          const uy = Math.sin(e);
          const uz = Math.cos(az) * Math.cos(e);
          const camX = pivotX + ux * standoff;
          const camY = uy * standoff;
          const camZ = pivotZ + uz * standoff;
          const fx = -ux;
          const fy = -uy;
          const fz = -uz;
          // right = normalise(forward x up); straight down is degenerate and any
          // right vector will do.
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
          const ux2 = -rz * fy;
          const uy2 = rz * fx - rx * fz;
          const uz2 = rx * fy;
          for (let i = 0; i <= 4; i++) {
            const x = -1 + i / 2;
            for (let j = 0; j <= 8; j++) {
              const y = -1 + j / 4;
              let dx = fx + x * halfH * rx + y * halfV * ux2;
              let dy = fy + y * halfV * uy2;
              let dz = fz + x * halfH * rz + y * halfV * uz2;
              const dl = Math.hypot(dx, dy, dz);
              dx /= dl;
              dy /= dl;
              dz /= dl;
              // Rays at or above the horizon never meet the water; nothing is
              // drawn there and the page is the fog colour.
              if (dy >= -1e-6) continue;
              const t = -camY / dy;
              if (!(t > 0)) continue;
              const fromOrigin = Math.hypot(camX + dx * t, camZ + dz * t);
              if (fromOrigin <= sea) continue; // there is water there
              // The worst offender is the one the fog has faded LEAST.
              if (!worst || t < worst.fromCamera) worst = { fromOrigin, fromCamera: t };
            }
          }
        }
      }
    }
  }
  return worst;
}

test("the ocean outlasts the fade at every pose the controls allow", () => {
  // The invariant: water that has faded to the page's colour can end, but
  // water must never end while it is still visibly water.
  //
  // Both ends of the dolly are swept: the far end reaches furthest; the near
  // end has the fog's shortest reach.
  for (const [name, e] of Object.entries(boards)) {
    for (const aspect of [21 / 9, 16 / 9, 1, 9 / 16]) {
      const sea = oceanRadius(e, aspect);
      const back = framingDistance(aspect, e);
      for (const standoff of [back, back * 0.63, minCameraDistance(3)]) {
        const fog = oceanFog(e, standoff);
        const bare = worstBarePage(e, aspect, standoff, sea);
        if (!bare) continue; // water everywhere the frame reaches
        expect(
          bare.fromCamera,
          `${name} @${aspect.toFixed(2)} d=${standoff.toFixed(1)}: unfogged bare page ${bare.fromOrigin.toFixed(1)} from centre`,
        ).toBeGreaterThanOrEqual(fog.far);
      }
    }
  }
});

test("the fog fades the sea and never the island", () => {
  // THREE.Fog measures from the camera, so both ends are recomputed from the
  // live standoff; a fixed pair fogs the island when zoomed out. The near end
  // clears the island's far side, or the back row hazes first.
  for (const [name, e] of Object.entries(boards)) {
    for (const standoff of [minCameraDistance(3), 50, framingDistance(16 / 9, e)]) {
      const fog = oceanFog(e, standoff);
      expect(fog.near, `${name} clears the island`).toBeGreaterThan(standoff + e.radius);
      expect(fog.far - fog.near, `${name} reach`).toBeCloseTo(OCEAN_FOG_REACH, 9);
    }
  }
});

// --- the join between the hexes and the flat ring ------------------------
//
// The hex field and the flat ring are the same water at the same height, so
// wherever they overlap the depth buffer can't choose between them. A hexagon
// of rings over a circle overlapped by 15% of the radius, growing with the
// board; a disc of hexes keeps the overlap to about one cell.

test("the backdrop covers every point the flat ring starts from", () => {
  // The gap case. A hex centred inside `oceanBackdropRadius` exists for every
  // point out to `nearOceanRadius`, since a cell's centre is never more than
  // one circumradius from a point inside it. Otherwise the sea has holes at the
  // join.
  //
  // Compared with a tenth of a millimetre of tolerance: the backdrop is the
  // near radius plus one circumradius, and the subtraction can land an ULP
  // short.
  for (const [name, e] of Object.entries(boards)) {
    const backdrop = oceanBackdropRadius(e, 16 / 9);
    expect(backdrop - nearOceanRadius(e, 16 / 9), name).toBeGreaterThanOrEqual(LATTICE_SIZE - 1e-9);
  }
});

test("the double-covered band is two hexes wide at every size", () => {
  // A hexagon of rings overlapped by `0.155 * radius` (4 units on a 3-player
  // board, 24 on a themed one). A disc of hexes overlaps by at most one cell at
  // any radius.
  for (const [name, e] of Object.entries(boards)) {
    const near = nearOceanRadius(e, 16 / 9);
    const overlap = oceanBackdropRadius(e, 16 / 9) + LATTICE_SIZE - near;
    expect(overlap, name).toBeLessThanOrEqual(2 * LATTICE_SIZE + 1e-9);
    // And the band stays the same absolute width from the smallest map to the
    // largest.
    expect(overlap, `${name} scale-free`).toBeCloseTo(2 * LATTICE_SIZE, 9);
  }
});

// --- the view the board opens at -----------------------------------------

test("the opening view frames the board's footprint, not its circle", () => {
  // `radius` is the larger span used for both axes, right for anything that
  // must hold at every azimuth but wrong for the opening view: on a coastline
  // the short axis is about half the long one, and framing the circle opened
  // the map at two thirds of its proper size.
  const wide = boards.wide;
  const half = halfSpans(wide);
  expect(half.z).toBeLessThan(half.x * 0.6);
  expect(defaultCameraDistance(16 / 9, wide)).toBeLessThan(cameraDistance(16 / 9, wide) * 0.8);
  // ...and costs nothing on a board that really is as deep as it is wide.
  const square = boards.large;
  expect(defaultCameraDistance(16 / 9, square)).toBeLessThanOrEqual(
    cameraDistance(16 / 9, square) * 1.2,
  );
});

test("the opening view holds the whole board, at every window shape and size", () => {
  // The near edge is closer than the centre and subtends more angle; this
  // checks the fit accounts for it.
  for (const aspect of [21 / 9, 16 / 9, 4 / 3, 1, 3 / 4, 9 / 16]) {
    for (const [name, e] of Object.entries(boards)) {
      const { x, y } = boardNdc(aspect, e);
      expect(Math.max(...x.map(Math.abs)), `${name} @ ${aspect} horizontally`).toBeLessThanOrEqual(
        1,
      );
      expect(Math.max(...y.map(Math.abs)), `${name} @ ${aspect} vertically`).toBeLessThanOrEqual(1);
    }
  }
});

test("the opening view fills the frame on small and huge boards", () => {
  // How much of the frame the board fills must not depend on the map's size or
  // roundness.
  //
  // Whichever axis the board is longest on: a wide map is held by the sides, a
  // deep one by top and bottom. What's not allowed is neither, a board floating
  // with room all round (what framing the bounding circle produced).
  const fills: number[] = [];
  for (const [name, e] of Object.entries(boards)) {
    const { x, y } = boardNdc(16 / 9, e);
    // Never the full 2.0: `FRAME_MARGIN` gives away 5%, and perspective spends
    // more of the rest on the near half of a tilted board.
    const fill = Math.max(Math.max(...x) - Math.min(...x), Math.max(...y) - Math.min(...y));
    expect(fill, `${name} fills the frame`).toBeGreaterThan(1.6);
    fills.push(fill);
  }
  // And close to each other: 1.64 to 1.90 across boards. The spread is a wide
  // board being held by its sides, which is correct.
  expect(Math.max(...fills) / Math.min(...fills)).toBeLessThan(1.2);
});

test("the zoom-out limit frames the board at every bearing", () => {
  // `defaultCameraDistance` frames the footprint from one azimuth; the limit
  // must survive the board turned side-on, so it keeps the bounding circle.
  // Checked by projection, since the claim is about what's on screen.
  for (const [name, e] of Object.entries(boards)) {
    const limit = framingDistance(16 / 9, e);
    for (let deg = MIN_CAMERA_ELEVATION_DEG; deg <= 90; deg += 10) {
      const { x, y } = boardNdc(16 / 9, e, camAt(16 / 9, e, deg, limit), "circle");
      expect(Math.max(...x.map(Math.abs)), `${name} @ ${deg} wide`).toBeLessThanOrEqual(1);
      expect(Math.max(...y.map(Math.abs)), `${name} @ ${deg} tall`).toBeLessThanOrEqual(1);
    }
  }
});

// --- panning -------------------------------------------------------------

test("the pivot cannot be dragged off the map", () => {
  // Without a pan fence a drag could walk the board off screen. Asked one axis
  // at a time: the leash is an ellipse through the two per-axis reaches, so a
  // diagonal request is short of both maxima.
  for (const [name, e] of Object.entries(boards)) {
    const half = halfSpans(e);
    const centre = frameTarget(e);
    const farX = clampPanTarget(1e6, centre.z, e);
    const farZ = clampPanTarget(centre.x, -1e6, e);
    expect(farX.x - centre.x, `${name} x`).toBeCloseTo(half.x * (1 + PAN_MARGIN), 9);
    expect(centre.z - farZ.z, `${name} z`).toBeCloseTo(half.z * (1 + PAN_MARGIN), 9);
  }
});

test("the stop still leaves the board on screen at the opening zoom", () => {
  // Measured off the radius, a coastline map (radius far wider than the short
  // axis) could be panned out of frame. The board must stay findable.
  for (const [name, e] of Object.entries(boards)) {
    const half = halfSpans(e);
    const centre = frameTarget(e);
    const at = clampPanTarget(1e6, 1e6, e);
    // The pivot is mid-frame and the fit puts the half-span near the frame's
    // edge, so the board's far side must stay within a span of the pivot.
    expect(Math.abs(at.x - centre.x) - half.x, `${name} x`).toBeLessThan(half.x);
    expect(Math.abs(at.z - centre.z) - half.z, `${name} z`).toBeLessThan(half.z);
  }
});

test("panning anywhere over the board itself is never touched", () => {
  // Ordinary pans must pass: every corner of the board, and a good margin past
  // it, is unchanged.
  for (const [name, e] of Object.entries(boards)) {
    const half = halfSpans(e);
    const centre = frameTarget(e);
    for (const sx of [-1, 0, 1]) {
      for (const sz of [-1, 0, 1]) {
        const x = centre.x + sx * half.x;
        const z = centre.z + sz * half.z;
        const at = clampPanTarget(x, z, e);
        expect(at.x, `${name} ${sx},${sz} x`).toBeCloseTo(x, 9);
        expect(at.z, `${name} ${sx},${sz} z`).toBeCloseTo(z, 9);
      }
    }
  }
});

test("the pan stop is measured off the board, not off the origin", () => {
  // Coastline presets are baked around their own coordinates, so an
  // origin-centred box wouldn't contain them.
  const off = boardExtent([
    { hex: { q: 20, r: 12 }, res: "sea", num: 0 },
    { hex: { q: 26, r: 18 }, res: "sea", num: 0 },
  ]);
  const centre = frameTarget(off);
  expect(centre.x).toBeGreaterThan(50);
  const at = clampPanTarget(centre.x, centre.z, off);
  expect(at.x).toBeCloseTo(centre.x, 9);
  expect(at.z).toBeCloseTo(centre.z, 9);
});

test("a sea entirely inside the near field asks for no annulus at all", () => {
  // `oceanRadius` has floors of its own, so this is reachable; the caller draws
  // the ring only when there is something past the hexes.
  const tiny: BoardExtent = { radius: 0.1, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  expect(nearOceanRadius(tiny)).toBeLessThanOrEqual(oceanRadius(tiny));
});

test("the fade ends exactly where the hexes do, and starts outside the board", () => {
  for (const [name, e] of Object.entries(boards)) {
    const band = oceanFadeFor(e, 16 / 9);
    // Ending anywhere but the hexes' edge is a step in the water: short and the
    // annulus meets live swell, long and the swell is cut off mid-fade.
    expect(band.outer, name).toBeCloseTo(nearOceanRadius(e, 16 / 9), 9);
    // The fade must never reach in far enough to still the swell at the beach.
    expect(band.inner, `${name} inner`).toBeGreaterThanOrEqual(e.radius);
    expect(band.inner, `${name} width`).toBeLessThan(band.outer);
  }
});

// --- shadows -------------------------------------------------------------

test("the shadow map is on, but is not recomputed every frame", () => {
  // With `autoUpdate`, the shadow pass redrew an identical map every frame
  // (the swell keeps the loop running), about half the frame's draw calls.
  const shadowMap = { enabled: false, autoUpdate: true, needsUpdate: false };
  configureShadows(shadowMap);
  expect(shadowMap.enabled).toBe(true);
  expect(shadowMap.autoUpdate).toBe(false);
  // With autoUpdate off, the first render still needs a map.
  expect(shadowMap.needsUpdate).toBe(true);
});

test("anything that moves a caster can ask for one more pass", () => {
  const renderer = { shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false } };
  invalidateShadows(renderer);
  expect(renderer.shadowMap.needsUpdate).toBe(true);
  // Callable before the rig exists: the content effect runs against a ref that
  // is null until the renderer is built.
  expect(() => invalidateShadows(null)).not.toThrow();
});

// ---- the exact fit: what the board actually opens at --------------------

/** The hexes at exactly `radius` steps from the centre. */
function hexRing(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) === radius) out.push({ q, r });
    }
  }
  return out;
}

/**
 * A board shaped like a real one: a land disc with a ring of sea around it.
 * Harbour docks stand on the sea ring (see layers/harbors.ts), so land alone
 * would make the port-visibility assertions vacuous.
 */
function seaRingBoard(landRadius: number): BoardTile[] {
  const out: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "wood", num: 8 }];
  for (let k = 1; k <= landRadius; k++) {
    for (const hex of hexRing(k)) out.push({ hex, res: "ore", num: 5 });
  }
  for (const hex of hexRing(landRadius + 1)) out.push({ hex, res: "sea", num: 0 });
  return out;
}

/** Windows worth checking: ultrawide through to a phone held upright. */
const WINDOWS: [number, number][] = [
  [2560, 1080],
  [1920, 1080],
  [1440, 1080],
  [1080, 1080],
  [820, 1180],
  [430, 932],
];

/** The rig as Board3D assembles it: a camera, this window, these dead bands. */
function riggedCamera(
  e: BoardExtent,
  width: number,
  height: number,
  insets: { left?: number; bottom?: number },
) {
  const cam = makeCamera(width / height, e);
  applyViewport(cam, width, height, insets, e);
  return cam;
}

/**
 * Stand `cam` off from the pivot along `dir`, aimed at it, matrices current.
 * The matrix update is done once here rather than per projected point, which
 * keeps the sweep below fast.
 */
function standAt(
  cam: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  dir: THREE.Vector3,
  dist: number,
) {
  cam.position.copy(target).addScaledVector(dir, dist);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
}

/** Where a point lands, for a camera `standAt` has already brought up to date. */
const scratch = new THREE.Vector3();
function ndcOf(cam: THREE.PerspectiveCamera, p: THREE.Vector3): THREE.Vector3 {
  return scratch.copy(p).project(cam);
}

test("the exact fit matches the closed form on a disc", () => {
  // fitDistance is the general case and cameraDistance its specialisation to a
  // disc, so on a disc they must agree.
  const e = ext(3);
  const target = frameTarget(e);
  const disc: THREE.Vector3[] = [];
  for (let i = 0; i < 720; i++) {
    const a = (i * Math.PI) / 360;
    disc.push(
      new THREE.Vector3(target.x + e.radius * Math.cos(a), 0, target.z + e.radius * Math.sin(a)),
    );
  }
  for (const aspect of [21 / 9, 16 / 9, 1, 9 / 16]) {
    for (const tilt of [MIN_CAMERA_ELEVATION_DEG, CAMERA_TILT_DEG, 89]) {
      const cam = makeCamera(aspect, e);
      applyViewport(cam, 1000 * aspect, 1000, {}, e);
      const got = fitDistance(cam, target, orbitDir(tilt), disc);
      const want = cameraDistance(aspect, e, tilt);
      expect(Math.abs(got - want) / want, `aspect ${aspect} tilt ${tilt}`).toBeLessThan(0.005);
    }
  }
});

test("every corner of the board is on screen at the opening view", () => {
  // The rig's main guarantee, checked against the board's real corners rather
  // than the padded box. Sea tiles are included, so this also checks that no
  // port is cut off (the disc bound had them at NDC x = 1.12 on a 430x932
  // phone).
  const insets = { left: 0.12, bottom: HUD_BOTTOM_INSET };
  const bounds = usableFrame(insets);
  for (const landRadius of [2, 3, 4]) {
    const board = seaRingBoard(landRadius);
    const e = boardExtent(board);
    const points = boardFitPoints(board);
    const target = frameTarget(e);
    const dir = orbitDir(CAMERA_TILT_DEG);
    for (const [w, h] of WINDOWS) {
      const cam = riggedCamera(e, w, h, insets);
      standAt(cam, target, dir, fitDistance(cam, target, dir, points, bounds));
      for (const p of points) {
        const ndc = ndcOf(cam, p);
        const where = `radius ${landRadius} on ${w}x${h}`;
        expect(ndc.x, `${where} left`).toBeGreaterThanOrEqual(bounds.minX);
        expect(ndc.x, `${where} right`).toBeLessThanOrEqual(bounds.maxX);
        expect(ndc.y, `${where} bottom`).toBeGreaterThanOrEqual(bounds.minY);
        expect(ndc.y, `${where} top`).toBeLessThanOrEqual(bounds.maxY);
      }
    }
  }
});

test("a piece standing above the board is framed too", () => {
  // Height doesn't always cost distance. At the rig's tilt the binding point is
  // the near edge against the bottom of the frame, and raising it moves it up,
  // away from the bound. Height binds only as the camera nears overhead. Both
  // are asserted, since assuming headroom always costs distance would open the
  // board smaller than needed.
  const board = seaRingBoard(3);
  const e = boardExtent(board);
  const target = frameTarget(e);
  const bounds = usableFrame({ bottom: HUD_BOTTOM_INSET });
  const cam = riggedCamera(e, 1920, 1080, { bottom: HUD_BOTTOM_INSET });
  const flat = boardFitPoints(board);
  const tall = boardFitPoints(board, 3);

  const fit = (dir: THREE.Vector3, pts: THREE.Vector3[]) =>
    fitDistance(cam, target, dir, pts, bounds);
  const tilted = orbitDir(CAMERA_TILT_DEG);
  expect(fit(tilted, tall)).toBeGreaterThanOrEqual(fit(tilted, flat));
  const overhead = orbitDir(88);
  expect(fit(overhead, tall)).toBeGreaterThan(fit(overhead, flat));

  // Wherever the camera is, the raised points are on screen at the distance
  // the fit returns.
  for (const dir of [tilted, overhead, orbitDir(MIN_CAMERA_ELEVATION_DEG)]) {
    standAt(cam, target, dir, fit(dir, tall));
    for (const p of tall) {
      const ndc = ndcOf(cam, p);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
      expect(ndc.y).toBeLessThanOrEqual(bounds.maxY);
      expect(ndc.y).toBeGreaterThanOrEqual(bounds.minY);
    }
  }
});

test("the fit uses more of the window than a disc bound", () => {
  // The disc bound has to survive rotation; the opening view doesn't, and
  // using the disc there opened a 2560x1080 window with the board across 38%
  // of its width.
  const board = seaRingBoard(3);
  const e = boardExtent(board);
  const target = frameTarget(e);
  const points = boardFitPoints(board);
  for (const [w, h] of WINDOWS) {
    const cam = riggedCamera(e, w, h, { bottom: HUD_BOTTOM_INSET });
    const fitted = fitDistance(cam, target, orbitDir(CAMERA_TILT_DEG), points);
    const bound = framingDistance(w / h, e) * (1 + HUD_BOTTOM_INSET);
    expect(fitted, `${w}x${h}`).toBeLessThan(bound);
  }
});

test("the zoom-out limit holds the board at every elevation and bearing", () => {
  // The limit keeps the disc so it survives the camera turning; this checks
  // that bound really contains the board's geometry, including the height of
  // what stands on it.
  const board = seaRingBoard(4);
  const e = boardExtent(board);
  const target = frameTarget(e);
  const points = boardFitPoints(board, 3);
  const insets = { left: 0.12, bottom: HUD_BOTTOM_INSET };
  const bounds = usableFrame(insets);
  let escaped: string | null = null;
  for (const [w, h] of WINDOWS) {
    const rig = riggedCamera(e, w, h, insets);
    const dist = framingDistanceFor(rig, e, 3, bounds);
    for (const elev of [MIN_CAMERA_ELEVATION_DEG, CAMERA_TILT_DEG, 71, 90]) {
      for (const az of [0, Math.PI / 4, Math.PI / 2, 4]) {
        standAt(rig, target, orbitDir(elev, az), dist);
        const cam = rig;
        for (const p of points) {
          const ndc = ndcOf(cam, p);
          // Plain code rather than four expect() calls per point: this runs
          // hundreds of thousands of times. Only a violation builds one.
          const off =
            ndc.x < bounds.minX
              ? "left"
              : ndc.x > bounds.maxX
                ? "right"
                : ndc.y < bounds.minY
                  ? "bottom"
                  : ndc.y > bounds.maxY
                    ? "top"
                    : null;
          if (off) {
            escaped = `${w}x${h} at ${elev}deg, bearing ${az.toFixed(2)}: off ${off} (${ndc.x.toFixed(4)}, ${ndc.y.toFixed(4)})`;
          }
        }
      }
    }
  }
  expect(escaped, "a board point left the usable frame").toBeNull();
});

test("the zoom-out limit is never nearer than the view the board opens at", () => {
  // Solved against different shapes (a cylinder for any bearing, the corners
  // at one bearing), so nothing guarantees the order. If the limit came out
  // nearer, OrbitControls would clamp the opening view closer than intended.
  const insets = { left: 0.12, bottom: HUD_BOTTOM_INSET };
  const bounds = usableFrame(insets);
  for (const landRadius of [2, 4]) {
    const board = seaRingBoard(landRadius);
    const e = boardExtent(board);
    const points = boardFitPoints(board, 3);
    for (const [w, h] of WINDOWS) {
      const cam = riggedCamera(e, w, h, insets);
      const open = fitDistance(cam, frameTarget(e), orbitDir(CAMERA_TILT_DEG), points, bounds);
      expect(framingDistanceFor(cam, e, 3, bounds), `${w}x${h}`).toBeGreaterThanOrEqual(open);
    }
  }
});

test("a piece-sized change in the ceiling barely moves the zoom-out limit", () => {
  // Why Board3D's `reframe` must not cancel the camera's momentum, and why the
  // ceiling commit re-frames only when it moved.
  //
  // The ceiling (top of the tallest drawn thing) changes during a game. On a
  // base board the robber is tallest at 2.50, 2.69 on a number chip; a city
  // reaches 1.78 and a metropolis 2.78. That range is about a tenth of a
  // percent of the framing distance, so anything a reframe does beyond scaling
  // (settling the camera, dropping pending wheel zoom) is pure harm.
  const e = boardExtent(seaRingBoard(3));
  const insets = { left: 0.12, bottom: HUD_BOTTOM_INSET };
  const bounds = usableFrame(insets);
  for (const [w, h] of WINDOWS) {
    const cam = riggedCamera(e, w, h, insets);
    const lowest = framingDistanceFor(cam, e, 1.78, bounds);
    const highest = framingDistanceFor(cam, e, 2.78, bounds);
    expect(highest, `${w}x${h}`).toBeGreaterThan(lowest);
    expect(highest / lowest - 1, `${w}x${h}`).toBeLessThan(0.005);
  }
});

test("the fit points reach past the land, where the ports are", () => {
  // boardExtent pads the land by a hex and a beach; the ports are further out,
  // on the sea ring, so the set must carry them as themselves.
  const landOnly = boardFitPoints([{ hex: { q: 0, r: 0 }, res: "wood", num: 8 }]);
  const withSea = boardFitPoints(seaRingBoard(1));
  const reach = (ps: THREE.Vector3[]) => Math.max(...ps.map((p) => Math.hypot(p.x, p.z)));
  expect(reach(withSea)).toBeGreaterThan(reach(landOnly) + LATTICE_SIZE);
});

test("an empty board still yields a fittable point set", () => {
  expect(boardFitPoints([]).length).toBeGreaterThan(0);
});

// A hexagonal island: nearly as wide as it is deep. A coastline preset: not.
const HEXISH: BoardExtent = { radius: 20.6, minX: -18, maxX: 18, minZ: -15.8, maxZ: 15.8 };
const COASTLINE: BoardExtent = { radius: 20.6, minX: -18, maxX: 18, minZ: -8, maxZ: 8 };
const DESKTOP = 16 / 9;
const PHONE = 390 / 844;

/** Half-extent of the board's projected silhouette, in NDC. */
function projectedHalf(aspect: number, e: BoardExtent, tiltDeg: number, azimuthRad: number) {
  const cam = makeCamera(aspect, e);
  const dist = defaultCameraDistance(aspect, e, tiltDeg, azimuthRad);
  const t = frameTarget(e);
  const dir = orbitDir(tiltDeg, azimuthRad).multiplyScalar(dist);
  cam.position.set(t.x + dir.x, dir.y, t.z + dir.z);
  cam.lookAt(t);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const { x: hx, z: hz } = halfSpans(e);
  const cx = (e.minX + e.maxX) / 2;
  const cz = (e.minZ + e.maxZ) / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 360; i++) {
    const a = (i * Math.PI) / 180;
    const s = Math.min(
      hx / Math.max(1e-9, Math.abs(Math.cos(a))),
      hz / Math.max(1e-9, Math.abs(Math.sin(a))),
    );
    const p = new THREE.Vector3(cx + s * Math.cos(a), 0, cz + s * Math.sin(a)).project(cam);
    xs.push(p.x);
    ys.push(p.y);
  }
  return {
    w: (Math.max(...xs) - Math.min(...xs)) / 2,
    h: (Math.max(...ys) - Math.min(...ys)) / 2,
  };
}

const openedHalf = (aspect: number, e: BoardExtent) => {
  const p = openingPose(aspect);
  return projectedHalf(aspect, e, p.tiltDeg, p.azimuthRad);
};

test("a landscape window still opens at the rig's own tilt, square on", () => {
  // The desktop framing must be unchanged at every aspect that already worked.
  const p = openingPose(DESKTOP);
  expect(p.tiltDeg).toBeCloseTo(CAMERA_TILT_DEG, 6);
  expect(p.azimuthRad).toBe(0);
});

test("a portrait window rakes the camera up rather than backing it off", () => {
  // Portrait is bound by width, so the vertical extent a shallow tilt wastes
  // can be reclaimed by tilting up, not by moving closer.
  const p = openingPose(PHONE);
  expect(p.tiltDeg).toBeGreaterThan(CAMERA_TILT_DEG);
  const before = projectedHalf(PHONE, HEXISH, CAMERA_TILT_DEG, 0);
  const after = openedHalf(PHONE, HEXISH);
  expect(after.h).toBeGreaterThan(before.h);
  // Still inside the frame on the axis that binds.
  expect(after.w).toBeLessThanOrEqual(1);
  expect(after.h).toBeLessThanOrEqual(1);
});

test("no window turns the board, however elongated it is", () => {
  // The map faces the same way for everyone; players can rotate the board or
  // the phone, but the opening pose doesn't.
  for (const e of [HEXISH, COASTLINE]) {
    for (const aspect of [DESKTOP, 1, PHONE, 0.3]) {
      expect(openingPose(aspect).azimuthRad).toBe(0);
      // Whatever the tilt does, the board still fits the frame it opens in.
      const half = openedHalf(aspect, e);
      expect(half.w).toBeLessThanOrEqual(1);
      expect(half.h).toBeLessThanOrEqual(1);
    }
  }
});

test("a small box is flat whichever way round it is small", () => {
  // The trigger is the room the board has, not the device: a phone on its side
  // and a small desktop window both count.
  expect(flatView(390, 844)).toBe(true);
  expect(flatView(844, 390)).toBe(true);
  expect(flatView(900, 560)).toBe(true);
  expect(flatView(1920, 1080)).toBe(false);
  expect(flatView(834, 1112)).toBe(false);
  // Exactly at the line is not small; one px under is.
  expect(flatView(FLAT_MAX_PX, 2000)).toBe(false);
  expect(flatView(FLAT_MAX_PX - 1, 2000)).toBe(true);
});

test("a flat view pins the rake instead of letting the aspect choose it", () => {
  // A small viewport gets the steep camera. Reading the tilt off the aspect
  // would give a small landscape window the shallowest pose.
  const wide = openingPose(844 / 390, true);
  const tall = openingPose(390 / 844, true);
  expect(wide.tiltDeg).toBeCloseTo(tall.tiltDeg, 6);
  expect(wide.tiltDeg).toBeGreaterThan(CAMERA_TILT_DEG);
  // And it is still square on, like every other pose.
  expect(wide.azimuthRad).toBe(0);
  expect(tall.azimuthRad).toBe(0);
  // A full-size viewport is untouched by the flag's existence.
  expect(openingPose(DESKTOP).tiltDeg).toBeCloseTo(CAMERA_TILT_DEG, 6);
});

test("a flat view still fits the board in the frame", () => {
  for (const e of [HEXISH, COASTLINE]) {
    for (const aspect of [844 / 390, 1, 390 / 844]) {
      const p = openingPose(aspect, true);
      const half = projectedHalf(aspect, e, p.tiltDeg, p.azimuthRad);
      expect(half.w).toBeLessThanOrEqual(1);
      expect(half.h).toBeLessThanOrEqual(1);
    }
  }
});

test("the top inset takes a band out of the frame", () => {
  expect(usableFrame({ top: 0.25 }).maxY).toBeCloseTo(0.5, 6);
  expect(usableFrame({ top: 0.25 }).minY).toBeCloseTo(-1, 6);
  // Negatives are chrome that isn't there, not a frame larger than the window.
  expect(usableFrame({ top: -0.3 }).maxY).toBeCloseTo(1, 6);
});

test("the right inset takes a band out of the frame", () => {
  expect(usableFrame({ right: 0.25 }).maxX).toBeCloseTo(0.5, 6);
  expect(usableFrame({ right: 0.25 }).minX).toBeCloseTo(-1, 6);
  expect(usableFrame({ right: -0.3 }).maxX).toBeCloseTo(1, 6);
  // Both sides at once is the desktop case: a band off each edge.
  const both = usableFrame({ left: 0.13, right: 0.13 });
  expect(both.minX).toBeCloseTo(-0.74, 6);
  expect(both.maxX).toBeCloseTo(0.74, 6);
  // Symmetric, so the region the board fits into is still centred.
  expect(both.minX + both.maxX).toBeCloseTo(0, 6);
});

/** Where the virtual frame's centre (the board) lands inside the window. */
function boardX(insets: Parameters<typeof applyHudInset>[3]): number {
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  applyHudInset(cam, 400, 800, insets);
  if (!cam.view) return 200;
  return cam.view.fullWidth / 2 - cam.view.offsetX;
}

test("left and right bands shift the board without double-counting", () => {
  const cam = () => new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  // Left-only: a wider virtual frame whose left slice is drawn, so the board
  // sits right of centre.
  const l = cam();
  applyHudInset(l, 400, 800, { left: 0.1 });
  expect(l.view?.fullWidth).toBeCloseTo(440, 6);
  expect(l.view?.offsetX).toBeCloseTo(0, 6);
  expect(boardX({ left: 0.1 })).toBeGreaterThan(200);

  // Right-only mirrors it, and moves the board the other way.
  const r = cam();
  applyHudInset(r, 400, 800, { right: 0.1 });
  expect(r.view?.fullWidth).toBeCloseTo(440, 6);
  expect(r.view?.offsetX).toBeCloseTo(40, 6);
  expect(boardX({ right: 0.1 })).toBeLessThan(200);

  // Equal bands cancel: the rail is cleared on the left, the feed island on
  // the right, and the board stays on the window's centre line.
  expect(boardX({ left: 0.13, right: 0.13 })).toBeCloseTo(200, 6);
  expect(boardX({})).toBeCloseTo(200, 6);
  // The clearance is real even so: the frame is narrower than the window.
  const both = cam();
  applyHudInset(both, 400, 800, { left: 0.13, right: 0.13 });
  expect(both.view?.fullWidth).toBeCloseTo(504, 6);
});

test("top and bottom bands shift the board without double-counting", () => {
  const cam = () => new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  // Bottom-only is unchanged: the bottom slice of a taller virtual frame.
  const b = cam();
  applyHudInset(b, 400, 800, { bottom: 0.1 });
  expect(b.view?.fullHeight).toBeCloseTo(880, 6);
  expect(b.view?.offsetY).toBeCloseTo(80, 6);
  // Top-only takes the top slice, so the board moves down instead.
  const t = cam();
  applyHudInset(t, 400, 800, { top: 0.1 });
  expect(t.view?.fullHeight).toBeCloseTo(880, 6);
  expect(t.view?.offsetY).toBeCloseTo(0, 6);
  // Equal bands cancel: the free region is still centred on the window.
  const both = cam();
  applyHudInset(both, 400, 800, { top: 0.1, bottom: 0.1 });
  expect(both.view?.fullHeight).toBeCloseTo(960, 6);
  expect(both.view?.offsetY).toBeCloseTo(80, 6);
  expect(both.view!.fullHeight - both.view!.offsetY - 800).toBeCloseTo(80, 6);
});

// --- Smoothing ------------------------------------------------------------

test("the damping fraction is the one quoted at exactly 60Hz", () => {
  expect(dampingForFrame(CAMERA_DAMPING, 1000 / 60)).toBeCloseTo(CAMERA_DAMPING, 12);
  // No measurement yet (the ticker's first frame) is the reference frame.
  expect(dampingForFrame(CAMERA_DAMPING, 0)).toBeCloseTo(CAMERA_DAMPING, 12);
});

test("damping keeps the same amount per unit of time whatever the frame rate", () => {
  // N frames of a fast display leave the same residue as one frame of a slow
  // one covering the same time.
  const slow = 1000 / 30;
  const fast = 1000 / 240;
  let a = 1;
  a *= 1 - dampingForFrame(CAMERA_DAMPING, slow);
  let b = 1;
  for (let i = 0; i < 8; i++) b *= 1 - dampingForFrame(CAMERA_DAMPING, fast);
  expect(b).toBeCloseTo(a, 12);
  // And a 60Hz display over the same interval agrees with both.
  let c = 1;
  for (let i = 0; i < 2; i++) c *= 1 - dampingForFrame(CAMERA_DAMPING, 1000 / 60);
  expect(c).toBeCloseTo(a, 12);
});

test("a damping fraction is never 1", () => {
  // The ticker clamps a stalled frame at 100ms, but nothing stops it arriving.
  for (const dt of [100, 1000, 60_000]) {
    const f = dampingForFrame(CAMERA_DAMPING, dt);
    expect(f).toBeLessThan(1);
    expect(f).toBeGreaterThan(CAMERA_DAMPING);
  }
  // Degenerate factors pass straight through rather than producing NaN.
  expect(dampingForFrame(0, 33)).toBe(0);
  expect(dampingForFrame(1, 33)).toBe(1);
});

test("a wheel notch pulls in scrolling up and pushes out scrolling down", () => {
  // Below 1 shrinks the distance to the pivot, above 1 grows it.
  expect(wheelDollyFactor(-100)).toBeLessThan(1);
  expect(wheelDollyFactor(100)).toBeGreaterThan(1);
  expect(wheelDollyFactor(0)).toBe(1);
  // Symmetric in log space: a notch each way is exactly where you started.
  expect(wheelDollyFactor(-100) * wheelDollyFactor(100)).toBeCloseTo(1, 12);
});

test("the wheel matches OrbitControls in line and page modes", () => {
  // three's own curve: 0.95 per hundredth of a delta unit.
  expect(wheelDollyFactor(-100, 0)).toBeCloseTo(Math.pow(0.95, 1), 12);
  // A Firefox notch is reported in lines; taken at face value it would be a
  // sixteenth of a Chrome notch.
  expect(wheelDollyFactor(-3, 1)).toBeCloseTo(wheelDollyFactor(-48, 0), 12);
  expect(wheelDollyFactor(-1, 2)).toBeCloseTo(wheelDollyFactor(-100, 0), 12);
});

test("a dolly debt paid in slices multiplies back to exactly the whole", () => {
  const owed = wheelDollyFactor(-240);
  let left = owed;
  let paid = 1;
  for (let i = 0; i < 200; i++) {
    const step = dollyStep(left, ZOOM_DAMPING);
    paid *= step;
    left /= step;
  }
  expect(paid * left).toBeCloseTo(owed, 12);
  // And the debt is essentially discharged well inside that many frames.
  expect(Math.abs(Math.log(left))).toBeLessThan(1e-6);
});

test("a dolly step is a fraction of the debt, never more than it", () => {
  const out = wheelDollyFactor(120);
  expect(dollyStep(out, 0)).toBe(1);
  expect(dollyStep(out, 1)).toBeCloseTo(out, 12);
  expect(dollyStep(out, ZOOM_DAMPING)).toBeGreaterThan(1);
  expect(dollyStep(out, ZOOM_DAMPING)).toBeLessThan(out);
  // Nonsense in, nothing owed out.
  expect(dollyStep(0, 0.5)).toBe(1);
});

test("screen motion is the angle a step subtends, not the step itself", () => {
  // Twice as far away is half the picture moved, for the same world step.
  expect(screenMotionPx(1, 20, 800)).toBeCloseTo(2 * screenMotionPx(1, 40, 800), 12);
  // A step spanning the whole vertical field fills the frame's height.
  const frame = 2 * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  expect(screenMotionPx(frame * 30, 30, 800)).toBeCloseTo(800, 9);
  // Degenerate rigs answer "nothing moved" rather than dividing by zero.
  expect(screenMotionPx(1, 0, 800)).toBe(0);
  expect(screenMotionPx(1, 30, 0)).toBe(0);
});

test("the rest test is independent of board size", () => {
  // A small board framed from 12 units and a gallery board from 60 look the
  // same, so the same fraction of the picture gives the same answer.
  const step = (d: number) =>
    (d * CAMERA_REST_PX * 2 * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360)) / 800;
  for (const d of [12, 30, 60]) {
    expect(cameraAtRest(step(d) * 0.9, d, 800)).toBe(true);
    expect(cameraAtRest(step(d) * 1.1, d, 800)).toBe(false);
  }
});

test("a damped fling reaches rest in a bounded number of frames", () => {
  // Geometric decay never reaches zero, so the loop needs a threshold. It must
  // hold on the fastest display, which takes the most frames to cover the
  // tail.
  const distance = 40;
  const view = 900;
  for (const hz of [30, 60, 144, 240]) {
    const dt = 1000 / hz;
    const f = dampingForFrame(CAMERA_DAMPING, dt);
    // A hard fling: a tenth of the frame's width crossed in one 60Hz frame.
    let velocity = distance * 0.1;
    let frames = 0;
    while (frames < 5000) {
      frames++;
      const moved = velocity * f;
      velocity *= 1 - f;
      if (cameraAtRest(moved, distance, view)) break;
    }
    expect(frames).toBeLessThan(hz * 1.5);
    expect(cameraAtRest(velocity * f, distance, view)).toBe(true);
  }
});

// --- the elevation floor ---------------------------------------------------
//
// One number fences the tilt on every surface that builds controls (via
// Board3D's `orbit` and `maxPolarAngle`). These pin the floor, its polar
// complement, and that no distance or board height can bypass it.

test("the elevation floor is at least 30 degrees above the board", () => {
  // The product requirement, pinned so it can't drift as a side effect of
  // tuning the ocean, which also reads it.
  expect(MIN_CAMERA_ELEVATION_DEG).toBeGreaterThanOrEqual(30);
  expect(MIN_CAMERA_ELEVATION_DEG).toBeLessThan(90);
});

test("the polar cap is the exact complement of the elevation floor", () => {
  // Elevation is from the ground plane and OrbitControls' polar angle from
  // straight up; inverted, the fence would hold the camera overhead and leave
  // the shallow end open.
  const elevationAtCap = 90 - (MAX_CAMERA_POLAR_RAD * 180) / Math.PI;
  expect(elevationAtCap).toBeCloseTo(MIN_CAMERA_ELEVATION_DEG, 9);
});

test("no distance or board height lets the tilt drop below the floor", () => {
  // The height fence goes slack far out (a distant camera clears every city),
  // so the flat cap must hold there. Swept well past any real framing
  // distance.
  for (const ceiling of CEILINGS) {
    for (let d = minCameraDistance(ceiling); d < 5000; d *= 1.25) {
      const elevation = 90 - (maxPolarAngle(d, ceiling) * 180) / Math.PI;
      expect(elevation, `ceiling ${ceiling} @ ${d.toFixed(1)}`).toBeGreaterThanOrEqual(
        MIN_CAMERA_ELEVATION_DEG - 1e-9,
      );
    }
  }
});

test("the height fence still wins wherever it is the stricter of the two", () => {
  // Close in, the height fence binds and the flat cap must not override it.
  for (const ceiling of CEILINGS) {
    const d = minCameraDistance(ceiling);
    for (const y of reachableHeights(d, ceiling)) {
      expect(y, `ceiling ${ceiling}`).toBeGreaterThanOrEqual(ceiling + CAMERA_HEADROOM - 1e-9);
    }
  }
});

// --- the pan leash shortens with the zoom ----------------------------------

test("at the zoom-out limit the leash is the full pan margin", () => {
  // The margin was measured for the opening zoom, so the leash there is
  // unchanged.
  for (const [name, e] of Object.entries(boards)) {
    const half = halfSpans(e);
    const centre = frameTarget(e);
    const atX = clampPanTarget(1e6, centre.z, e, 1);
    const atZ = clampPanTarget(centre.x, -1e6, e, 1);
    expect(atX.x - centre.x, `${name} x`).toBeCloseTo(half.x * (1 + PAN_MARGIN), 9);
    expect(centre.z - atZ.z, `${name} z`).toBeCloseTo(half.z * (1 + PAN_MARGIN), 9);
  }
});

test("dollying in shortens the leash, and never lengthens it", () => {
  for (const [name, e] of Object.entries(boards)) {
    const centre = frameTarget(e);
    let previous = Infinity;
    for (let frac = 1; frac >= 0; frac -= 0.05) {
      const reach = clampPanTarget(1e6, centre.z, e, frac).x - centre.x;
      expect(reach, `${name} @ ${frac.toFixed(2)}`).toBeLessThanOrEqual(previous + 1e-9);
      previous = reach;
    }
  }
});

test("dollied all the way in, the frame is centred on the board's own tiles", () => {
  // At the tightest zoom the middle of the screen is over a tile, so the board
  // can never be lost off frame. This is what allows dropping the reset button
  // on a phone.
  for (const [name, e] of Object.entries(boards)) {
    const half = halfSpans(e);
    const centre = frameTarget(e);
    const at = clampPanTarget(1e6, -1e6, e, 0);
    // Inside the padded half-span by exactly the padding `halfSpans` added to
    // the raw tile-centre span.
    expect(at.x - centre.x, `${name} x`).toBeLessThanOrEqual(half.x + 1e-9);
    expect(centre.z - at.z, `${name} z`).toBeLessThanOrEqual(half.z + 1e-9);
  }
});

test("a phone cannot pan or zoom the board out of its own frame", () => {
  // Why the reset control can go below FLAT_MAX_PX: across every combination of
  // dolly (zoom-out limit to zoom-in stop) and pan (to the leash's corner),
  // some of the board stays on screen.
  const board = seaRingBoard(3);
  const e = boardExtent(board);
  // Tile centres, not `boardFitPoints` (hex corners only): at the zoom-in stop
  // the frame is narrower than a hex and can be full of a tile without
  // containing any of its corners.
  const points = board.map((t) => {
    const [x, , z] = hexToWorld(t.hex, LATTICE_SIZE);
    return new THREE.Vector3(x, 0, z);
  });
  const centre = frameTarget(e);
  const cam = riggedCamera(e, 402, 874, { bottom: HUD_BOTTOM_INSET });
  const framed = framingDistance(402 / 874, e);
  // A flat view does not rotate, so this is the only bearing there is.
  const dir = orbitDir(openingPose(402 / 874, true).tiltDeg);

  for (let frac = 1; frac >= 0.02; frac -= 0.02) {
    const d = Math.max(minCameraDistance(3), framed * frac);
    for (const sx of [-1, 0, 1]) {
      for (const sz of [-1, 0, 1]) {
        const at = clampPanTarget(centre.x + sx * 1e6, centre.z + sz * 1e6, e, d / framed);
        const target = new THREE.Vector3(at.x, centre.y, at.z);
        standAt(cam, target, dir, d);
        // Either some of the board is on screen, or the frame's middle stands
        // on a tile. Zoomed out the frame is board-sized and the pivot may sit
        // off the edge; zoomed in the pivot's footing is what shows where the
        // board is.
        const seen = points.some((p) => {
          const ndc = ndcOf(cam, p);
          return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z <= 1;
        });
        // A hex covers everything within its inradius of its centre, so this
        // means "the pivot is inside some tile".
        const inradius = (Math.sqrt(3) / 2) * LATTICE_SIZE;
        const standingOn = points.some((p) => Math.hypot(p.x - at.x, p.z - at.z) <= inradius);
        expect(seen || standingOn, `zoom ${frac.toFixed(2)} corner ${sx},${sz}`).toBe(true);
      }
    }
  }
});

// --- the flat-view media query ---------------------------------------------

test("a viewport matching the flat query guarantees a flat board", () => {
  // The HUD's reset orb depends on this one-way implication: the host box is
  // never bigger than the viewport, so matching the query means the board is
  // flat. The orb may linger on a flat board; it must never vanish from one
  // that orbits.
  const matches = (w: number, h: number) => w < FLAT_MAX_PX || h < FLAT_MAX_PX;
  for (const [w, h] of [
    [402, 874], // phone, upright
    [874, 402], // the same phone, turned
    [390, 844],
    [599, 599],
    [1920, 1080],
    [1024, 768],
    [800, 601],
  ]) {
    if (!matches(w, h)) continue;
    // Any host box the page could hand the board, up to the whole viewport.
    for (const shrink of [1, 0.8, 0.5]) {
      expect(flatView(w * shrink, h * shrink), `${w}x${h} @ ${shrink}`).toBe(true);
    }
  }
});

test("the flat query is written from FLAT_MAX_PX and covers both axes", () => {
  // Width-only would show a reset button on a landscape phone (874x402), since
  // the board's trigger is the short side; height-only would miss the upright
  // phone.
  expect(FLAT_VIEW_QUERY).toContain(`${FLAT_MAX_PX - 1}px`);
  expect(FLAT_VIEW_QUERY).toContain("max-width");
  expect(FLAT_VIEW_QUERY).toContain("max-height");
});

describe("reframeNeeded", () => {
  it("says yes the first time, when there is no framing yet", () => {
    expect(reframeNeeded(80, 0)).toBe(true);
  });

  it("says no when the distance has not meaningfully moved", () => {
    // A content rebuild re-frames on every commit, and re-framing calls
    // settleCamera(), which disables damping and applies the accumulated drag
    // at once (up to seven world units in a frame). Most rebuilds want the
    // same distance, so they must be skipped.
    expect(reframeNeeded(84.4, 84.4)).toBe(false);
    expect(reframeNeeded(84.42, 84.4)).toBe(false);
  });

  it("says yes for a change big enough to see", () => {
    // ~0.4% of the distance is over the line: a real re-frame. A ceiling move
    // is this size, which is why the ceiling is filtered first (see
    // `ceilingMoved`): worth it when the host changes shape, not when a knight
    // activates.
    expect(reframeNeeded(84.7, 84.3)).toBe(true);
    expect(reframeNeeded(111.1, 110.7)).toBe(true);
  });

  it("ignores a zero or negative want, which means unmeasured", () => {
    expect(reframeNeeded(0, 84)).toBe(false);
    expect(reframeNeeded(-1, 84)).toBe(false);
  });
});

describe("ceilingMoved", () => {
  // Heights measured off the shipped art, the same ones `CEILING_EPSILON` is
  // chosen against. Knight tips are the gold, raised (activated) swords:
  // activation swaps the art, so that tip is what the ceiling sees.
  const ROBBER_DESERT = 2.5;
  const ROBBER_ON_CHIP = 2.69;
  const METROPOLIS = 2.78;
  const KNIGHT_BASIC = 2.198;
  const KNIGHT_STRONG = 2.626;
  const KNIGHT_MIGHTY = 3.007;

  it("re-fits on the board's first measurement", () => {
    // The first measurement takes the opening view from the flat framing to
    // the real one.
    expect(ceilingMoved(0, ROBBER_DESERT)).toBe(true);
  });

  it("does not re-fit when a knight is activated", () => {
    // A knight's raised sword becoming the tallest thing must not re-frame and
    // rescale the viewer's distance mid-game.
    expect(ceilingMoved(ROBBER_DESERT, KNIGHT_MIGHTY)).toBe(false);
    expect(ceilingMoved(ROBBER_DESERT, KNIGHT_STRONG)).toBe(false);
    expect(ceilingMoved(METROPOLIS, KNIGHT_MIGHTY)).toBe(false);
    // And the same on the way back down, when the knight is spent or expelled.
    expect(ceilingMoved(KNIGHT_MIGHTY, ROBBER_DESERT)).toBe(false);
  });

  it("does not re-fit for the rest of the moves a game makes", () => {
    // The robber stepping on and off a number chip (every seven), and a
    // metropolis going up.
    expect(ceilingMoved(ROBBER_DESERT, ROBBER_ON_CHIP)).toBe(false);
    expect(ceilingMoved(ROBBER_ON_CHIP, ROBBER_DESERT)).toBe(false);
    expect(ceilingMoved(ROBBER_DESERT, METROPOLIS)).toBe(false);
    expect(ceilingMoved(KNIGHT_BASIC, KNIGHT_MIGHTY)).toBe(false);
  });

  it("covers the whole range a game can move the ceiling through", () => {
    // No pair of in-game ceilings is far enough apart to re-fit, so no
    // sequence of play re-frames the board. Mountains are the floor rather
    // than a city (1.78), because terrain is always drawn.
    const inGame = [
      2.29, // mountains
      ROBBER_DESERT,
      ROBBER_ON_CHIP,
      METROPOLIS,
      KNIGHT_BASIC,
      KNIGHT_STRONG,
      KNIGHT_MIGHTY,
    ];
    for (const from of inGame) {
      for (const to of inGame) {
        expect(ceilingMoved(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("still re-fits when the board itself changes", () => {
    // A new board, a different preset, a preview swapping out: the ceiling
    // drops to nothing and comes back elsewhere. That is a real re-frame.
    expect(ceilingMoved(KNIGHT_MIGHTY, 0)).toBe(true);
    expect(ceilingMoved(0.4, ROBBER_DESERT)).toBe(true);
  });

  it("costs under a percent of the framing distance to defer", () => {
    // The cost of deferring the re-fit: the fences aren't deferred (they
    // re-solve on OrbitControls' `change`), so only the standoff is solved
    // against a ceiling up to CEILING_EPSILON stale. Noise at every window.
    const e = boardExtent(seaRingBoard(3));
    const insets = { left: 0.12, bottom: HUD_BOTTOM_INSET };
    const bounds = usableFrame(insets);
    for (const [w, h] of WINDOWS) {
      const cam = riggedCamera(e, w, h, insets);
      const low = framingDistanceFor(cam, e, 2.29, bounds);
      const high = framingDistanceFor(cam, e, 2.29 + CEILING_EPSILON, bounds);
      expect(Math.abs(high / low - 1), `${w}x${h}`).toBeLessThan(0.01);
    }
  });
});

describe("the showcase turn", () => {
  it("leaves and arrives at a standstill", () => {
    expect(showcaseSettle(0)).toBe(0);
    expect(showcaseSettle(SHOWCASE_SETTLE_MS)).toBe(1);
    // Past the end is still the end, not an overshoot: the ticker keeps
    // calling for as long as the board turns.
    expect(showcaseSettle(SHOWCASE_SETTLE_MS * 100)).toBe(1);
    // Eased at both ends; a linear ramp would leave at full speed.
    const step = SHOWCASE_SETTLE_MS / 100;
    expect(showcaseSettle(step)).toBeLessThan(step / SHOWCASE_SETTLE_MS);
    expect(1 - showcaseSettle(SHOWCASE_SETTLE_MS - step)).toBeLessThan(step / SHOWCASE_SETTLE_MS);
  });

  it("winds the bearing up from nothing to the full rate", () => {
    const full = (dt: number) => (SHOWCASE_TURN_DEG_PER_SEC * dt * Math.PI) / 180_000;
    expect(showcaseSpin(0, 16)).toBe(0);
    expect(showcaseSpin(SHOWCASE_SPINUP_MS, 16)).toBeCloseTo(full(16), 12);
    expect(showcaseSpin(SHOWCASE_SPINUP_MS * 10, 16)).toBeCloseTo(full(16), 12);
    // Monotonic on the way there, so the turn never hesitates mid-wind-up.
    let prev = -1;
    for (let t = 0; t <= SHOWCASE_SPINUP_MS; t += SHOWCASE_SPINUP_MS / 20) {
      const step = showcaseSpin(t, 16);
      expect(step).toBeGreaterThanOrEqual(prev);
      prev = step;
    }
  });

  it("integrates to the same bearing whatever the frame rate", () => {
    // The rate depends on elapsed time, so 30Hz and 120Hz displays must agree
    // on where the board has got to.
    const turn = (frameMs: number) => {
      let bearing = 0;
      for (let t = frameMs; t <= 20_000; t += frameMs) bearing += showcaseSpin(t, frameMs);
      return bearing;
    };
    expect(turn(1000 / 30)).toBeCloseTo(turn(1000 / 120), 2);
  });
});

describe("the camera readout is orbitDir run backwards", () => {
  // A number from the dev console readout should paste straight into
  // `CAMERA_TILT_DEG` or an `openingPose` arm, which holds only while this is
  // an exact inverse.
  const target = new THREE.Vector3(3, 0, -2);

  it("round-trips every pose the board can be put in", () => {
    const cam = new THREE.PerspectiveCamera(45, 1.6, 0.1, 500);
    for (const elev of [5, 20, 45, 56, 72, 89]) {
      for (const azDeg of [-170, -90, -33, 0, 33, 90, 170]) {
        const az = (azDeg * Math.PI) / 180;
        standAt(cam, target, orbitDir(elev, az), 42);
        const r = cameraReadout(cam, target);
        expect(r.elevationDeg, `elev ${elev} az ${azDeg}`).toBeCloseTo(elev, 6);
        expect(r.azimuthDeg, `elev ${elev} az ${azDeg}`).toBeCloseTo(azDeg, 6);
        expect(r.distance, `dist ${elev}/${azDeg}`).toBeCloseTo(42, 6);
      }
    }
  });

  it("reports the pivot and the lens it was handed", () => {
    const cam = new THREE.PerspectiveCamera(45, 1.6, 0.1, 500);
    standAt(cam, target, orbitDir(56), 30);
    const r = cameraReadout(cam, target);
    expect(r.target).toEqual({ x: 3, y: 0, z: -2 });
    expect(r.fovDeg).toBe(45);
    expect(r.aspect).toBeCloseTo(1.6, 6);
    expect(r.position.y).toBeCloseTo(30 * Math.sin((56 * Math.PI) / 180), 6);
  });

  // Unreachable (the dolly is fenced above zero), but NaN in a template string
  // prints "NaNdeg", so zeroes are better.
  it("a camera on its pivot reports zeroes, not NaN", () => {
    const cam = new THREE.PerspectiveCamera(45, 1.6, 0.1, 500);
    cam.position.copy(target);
    cam.updateMatrixWorld(true);
    const r = cameraReadout(cam, target);
    expect(r.distance).toBe(0);
    expect(Number.isNaN(r.elevationDeg)).toBe(false);
    expect(Number.isNaN(r.azimuthDeg)).toBe(false);
  });
});

describe("a flat view's breathing room sizes the fit and nothing else", () => {
  // A margin expressed as an inset both narrows `usableFrame` and makes
  // `applyHudInset` shift the virtual frame. For a symmetric margin these
  // cancel, leaving the board on the edge with its harbour piers off screen.
  it("takes the margin off all four sides", () => {
    const full = usableFrame();
    const cut = fitBounds(full, true);
    const m = 2 * FLAT_FRAME_MARGIN;
    expect(cut.minX).toBeCloseTo(full.minX + m, 9);
    expect(cut.maxX).toBeCloseTo(full.maxX - m, 9);
    expect(cut.minY).toBeCloseTo(full.minY + m, 9);
    expect(cut.maxY).toBeCloseTo(full.maxY - m, 9);
  });

  it("is symmetric, so it moves the board nowhere", () => {
    const cut = fitBounds(usableFrame(), true);
    expect(cut.minX + cut.maxX).toBeCloseTo(0, 9);
    expect(cut.minY + cut.maxY).toBeCloseTo(0, 9);
  });

  it("composes with the chrome rather than replacing it", () => {
    const chrome = { bottom: 0.2, top: 0.05 };
    const cut = fitBounds(usableFrame(chrome), true);
    const bare = usableFrame(chrome);
    // The chrome's asymmetry survives: the bottom band is still the bigger cut.
    expect(cut.minY - bare.minY).toBeCloseTo(
      cut.maxY - bare.maxY === 0 ? 0 : 2 * FLAT_FRAME_MARGIN,
      9,
    );
    expect(Math.abs(cut.minY)).toBeLessThan(Math.abs(cut.maxY));
  });

  it("leaves a board that is not flat exactly as it was", () => {
    const full = usableFrame({ bottom: 0.12 });
    expect(fitBounds(full, false)).toEqual(full);
  });
});

// The seat rail and the feed island land just after the board opens, so an
// untouched camera is re-opened for them; otherwise at 1280x800 the coast sat
// under both columns until "Reset view".
describe("reopenForSideBand", () => {
  const base = { viewerMoved: false, showcasing: false, at: 100, fit: 120 };
  it("re-opens an untouched camera whose fit moved", () => {
    expect(reopenForSideBand(base)).toBe(true);
  });
  it("leaves a camera the viewer has zoomed or turned", () => {
    expect(reopenForSideBand({ ...base, viewerMoved: true })).toBe(false);
  });
  it("leaves the showcase turn alone", () => {
    expect(reopenForSideBand({ ...base, showcasing: true })).toBe(false);
  });
  it("does nothing when the camera is already at the fit", () => {
    expect(reopenForSideBand({ ...base, at: 120.5 })).toBe(false);
    expect(reopenForSideBand({ ...base, fit: 0 })).toBe(false);
  });
});

test("the rig's key is the board's shape, and a reveal does not move it", () => {
  // Board3D disposes the renderer and reframes the camera when this key
  // changes, so terrain must not be in it: an Explorers reveal would snap a
  // zoomed-in viewer back to the opening view.
  const fogged: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    { hex: { q: 1, r: 0 }, res: "fog", num: 0 },
  ];
  const revealed: BoardTile[] = [fogged[0], { hex: { q: 1, r: 0 }, res: "gold", num: 5 }];
  expect(boardShapeKey({ radius: 2, tiles: revealed })).toBe(
    boardShapeKey({ radius: 2, tiles: fogged }),
  );
  // A different board is still a different rig.
  expect(boardShapeKey({ radius: 2, tiles: [fogged[0]] })).not.toBe(
    boardShapeKey({ radius: 2, tiles: fogged }),
  );
  expect(boardShapeKey({ radius: 3, tiles: fogged })).not.toBe(
    boardShapeKey({ radius: 2, tiles: fogged }),
  );
});

test("a big board's shadow map grows to keep shadows sharp", () => {
  // A fixed map spreads its texels over the board's width. The four-player
  // base board is the reference and keeps exactly what it had.
  const ring = (radius: number): BoardTile[] => {
    const out: BoardTile[] = [];
    for (let q = -radius; q <= radius; q++)
      for (let r = -radius; r <= radius; r++)
        if (Math.abs(q + r) <= radius) out.push({ hex: { q, r }, res: "wood", num: 0 });
    return out;
  };
  const base = boardExtent(ring(2));
  const explorers = boardExtent(ring(5));
  expect(shadowMapSize(base)).toBe(SHADOW_MAP_MIN);
  expect(shadowMapSize(explorers)).toBe(SHADOW_MAP_MAX);
  // The density the bigger map buys is back within a fifth of the base board's.
  const density = (e: ReturnType<typeof boardExtent>) => shadowMapSize(e) / (2.5 * e.radius);
  expect(density(explorers)).toBeGreaterThan(density(base) * 0.8);
  // Never past what the GPU can hold, and never under the old floor on one
  // that can hold it.
  expect(shadowMapSize(explorers, 2048)).toBe(2048);
  expect(shadowMapSize(explorers, 16384)).toBe(SHADOW_MAP_MAX);
  const { board } = makeLights(explorers);
  const key = lightsOf(board).find((c) => (c as THREE.DirectionalLight).isDirectionalLight);
  expect((key as THREE.DirectionalLight).shadow.mapSize.x).toBe(SHADOW_MAP_MAX);
});

// --- the far plane against a camera framed into a small band -------------------

test("a camera fitted into a small band keeps the board inside the far plane", () => {
  // The home page at 390x844: the copy holds the top 57% and the footer the
  // bottom 15%, so the island is fitted into a band 28% tall. The fit stands
  // the camera far enough back that the planes `applyViewport` set would put
  // the board behind the far plane. Board3D raises it with `farPlaneFor`
  // before every frame.
  const e = ext(10);
  const insets = { left: 0.03, right: 0.03, top: 0.57, bottom: 0.15 };
  const cam = makeCamera(390 / 844, e);
  applyViewport(cam, 390, 844, insets, e);
  const target = frameTarget(e);
  const dir = orbitDir(74);
  const disc: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    disc.push(new THREE.Vector3(Math.cos(a) * e.radius, 0, Math.sin(a) * e.radius));
  }
  const d = fitDistance(cam, target, dir, disc, usableFrame(insets));
  // The precondition: without the raise, the board's far side is clipped.
  expect(d + e.radius).toBeGreaterThan(cam.far);
  const far = farPlaneFor(cam.far, e, d);
  expect(far).toBeGreaterThan(d + e.radius);
  // Only ever raised: an ordinary framing keeps the plane `cameraPlanes` chose.
  expect(farPlaneFor(cam.far, e, 0)).toBe(cam.far);
});
