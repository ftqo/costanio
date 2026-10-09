import { describe, expect, test } from "vitest";
import * as THREE from "three";
import {
  HOVER_FLOOR_PX,
  RELEASE_RATIO,
  SWITCH_RATIO,
  chooseSticky,
  hoverPickAt,
  pointerRay,
  segmentMiss,
  worldPerPixel,
  type Hoverable,
} from "./hoverPick";
import { INFO_SNAP_RADIUS, PICK_PLANE_Y, SNAP_RADIUS } from "./picking";
import { CAMERA_FOV_DEG } from "./scene";
import { LATTICE_SIZE } from "./coords";

const rect = { left: 100, top: 50, width: 800, height: 400 };

/** The rig's usual pose: above the board, tilted, looking at it. */
function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, rect.width / rect.height, 0.1, 500);
  cam.position.set(0, 40, 28);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** Where a world point is drawn, in client coordinates. */
function toClient(cam: THREE.Camera, x: number, y: number, z: number) {
  const ndc = new THREE.Vector3(x, y, z).project(cam);
  return {
    cx: rect.left + ((ndc.x + 1) / 2) * rect.width,
    cy: rect.top + ((1 - ndc.y) / 2) * rect.height,
  };
}

const vertex = (key: string, x: number, z: number): Hoverable => ({
  key,
  kind: "vertex",
  pos: [x, PICK_PLANE_Y, z],
});

const s = (key: string, score: number) => ({ target: { key }, score });

describe("chooseSticky", () => {
  test("with nothing held, the nearest target inside its radius wins", () => {
    expect(chooseSticky([s("a", 0.8), s("b", 0.5)], null)?.key).toBe("b");
    expect(chooseSticky([s("a", 1.2), s("b", 1.01)], null)).toBeNull();
  });

  test("a tie goes to the earlier target", () => {
    expect(chooseSticky([s("marker", 0.4), s("piece", 0.4)], null)?.key).toBe("marker");
  });

  test("a held target survives a drift past its radius, up to the release", () => {
    // The bug this replaces: one step off a spot dropped it, and the step
    // back did not restore the cursor.
    expect(chooseSticky([s("a", 1.2)], "a")?.key).toBe("a");
    expect(chooseSticky([s("a", RELEASE_RATIO)], "a")?.key).toBe("a");
    expect(chooseSticky([s("a", RELEASE_RATIO + 0.01)], "a")).toBeNull();
  });

  test("a neighbour takes over only when clearly nearer", () => {
    // On the border: both about equal, so the held one stays.
    expect(chooseSticky([s("a", 0.9), s("b", 0.85)], "a")?.key).toBe("a");
    // Clearly nearer: it switches.
    expect(chooseSticky([s("a", 0.9), s("b", 0.9 * SWITCH_RATIO - 0.01)], "a")?.key).toBe("b");
    // Held but drifting away while a neighbour is under the pointer.
    expect(chooseSticky([s("a", 1.3), s("b", 0.3)], "a")?.key).toBe("b");
  });

  test("a held key no longer on offer is forgotten", () => {
    // After a commit the spot is not legal, so it is not a candidate at all.
    expect(chooseSticky([s("b", 0.95)], "a")?.key).toBe("b");
    expect(chooseSticky([s("b", 1.1)], "a")).toBeNull();
  });
});

describe("segmentMiss", () => {
  const ray = (o: [number, number, number], d: [number, number, number]) =>
    new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());

  test("a ray through the segment misses by nothing", () => {
    expect(segmentMiss(ray([5, 1, 0], [-1, 0, 0]), 0, 0, 0, 2)).toBeCloseTo(0, 9);
  });

  test("a ray passing beside it misses by the gap", () => {
    expect(segmentMiss(ray([5, 1, 0.7], [-1, 0, 0]), 0, 0, 0, 2)).toBeCloseTo(0.7, 9);
  });

  test("a ray passing over the top is measured from the top", () => {
    expect(segmentMiss(ray([5, 3, 0], [-1, 0, 0]), 0, 0, 0, 2)).toBeCloseTo(1, 9);
  });

  test("a ray aimed away is measured from its origin", () => {
    expect(segmentMiss(ray([5, 1, 0], [1, 0, 0]), 0, 0, 0, 2)).toBeCloseTo(5, 9);
  });
});

describe("hoverPickAt", () => {
  test("a piece's body is pickable where its footprint is not", () => {
    // On a tilted camera the upper body is drawn well above the base, so a
    // ray through it lands on the ground behind the piece: the robber could
    // only be hovered by pointing at the chip it covers.
    const cam = camera();
    const base: Hoverable = { key: "robber", kind: "hex", pos: [0, PICK_PLANE_Y, 0] };
    const body = { y0: PICK_PLANE_Y, y1: PICK_PLANE_Y + 3, r: 0.6 };
    const head = toClient(cam, 0, PICK_PLANE_Y + 2.7, 0);
    const opts = { radii: INFO_SNAP_RADIUS, floorPx: 0 };
    expect(hoverPickAt(cam, rect, head.cx, head.cy, [base], null, opts)).toBeNull();
    expect(hoverPickAt(cam, rect, head.cx, head.cy, [{ ...base, body }], null, opts)?.key).toBe(
      "robber",
    );
    // And not everywhere: well to the side of the body is still a miss.
    const beside = toClient(cam, 2.5, PICK_PLANE_Y + 1.5, 0);
    expect(
      hoverPickAt(cam, rect, beside.cx, beside.cy, [{ ...base, body }], null, opts),
    ).toBeNull();
  });

  test("a drift off a vertex keeps it, and a fresh pick would not", () => {
    const cam = camera();
    const a = vertex("a", 0, 0);
    const off = toClient(cam, SNAP_RADIUS.vertex * 1.2, PICK_PLANE_Y, 0);
    const opts = { floorPx: 0 };
    expect(hoverPickAt(cam, rect, off.cx, off.cy, [a], null, opts)).toBeNull();
    expect(hoverPickAt(cam, rect, off.cx, off.cy, [a], "a", opts)?.key).toBe("a");
  });

  test("the pixel floor keeps a zoomed-out vertex reachable", () => {
    // About as far back as a phone puts the camera.
    const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, rect.width / rect.height, 0.1, 2000);
    cam.position.set(0, 280, 0.001);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const a = vertex("a", 0, 0);
    const perPx = worldPerPixel(cam, rect, a.pos);
    // The precondition: here the world radius is under the floor.
    expect(SNAP_RADIUS.vertex / perPx).toBeLessThan(HOVER_FLOOR_PX);
    const near = toClient(cam, (HOVER_FLOOR_PX - 1) * perPx, PICK_PLANE_Y, 0);
    expect(hoverPickAt(cam, rect, near.cx, near.cy, [a], null, { floorPx: 0 })).toBeNull();
    expect(hoverPickAt(cam, rect, near.cx, near.cy, [a], null)?.key).toBe("a");
  });

  test("worldPerPixel matches the lattice's size on screen", () => {
    const cam = camera();
    const a = toClient(cam, 0, PICK_PLANE_Y, 0);
    const b = toClient(cam, LATTICE_SIZE, PICK_PLANE_Y, 0);
    const px = Math.hypot(b.cx - a.cx, b.cy - a.cy);
    expect(LATTICE_SIZE / px).toBeCloseTo(worldPerPixel(cam, rect, [0, PICK_PLANE_Y, 0]), 2);
  });

  test("off the canvas is no ray", () => {
    expect(pointerRay(camera(), { ...rect, width: 0 }, 0, 0)).toBeNull();
  });
});
