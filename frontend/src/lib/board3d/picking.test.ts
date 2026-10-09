import { test, expect, describe } from "vitest";
import * as THREE from "three";
import {
  CLICK_SLOP_PX,
  PICK_PLANE_Y,
  INFO_SNAP_RADIUS,
  SNAP_RADIUS,
  groundPointAt,
  isClick,
  ndcFromClient,
  nearestTarget,
  pickAt,
  pickTap,
  TOUCH_SNAP_PX,
} from "./picking";
import type { PickTarget } from "./targets";
import { LATTICE_SIZE, vertexToWorld, edgeToWorld } from "./coords";
import { makeEdge } from "@/lib/hexgeo";
import { CAMERA_FOV_DEG } from "./scene";

const rect = { left: 100, top: 50, width: 800, height: 400 };

/** A camera roughly where the rig puts one: above the board, tilted, looking at it. */
function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, rect.width / rect.height, 0.1, 500);
  cam.position.set(0, 40, 28);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function vertexTarget(v: { q: number; r: number; side: 0 | 1 }): PickTarget {
  const [x, , z] = vertexToWorld(v);
  return {
    kind: "vertex",
    action: "vertex",
    key: `v${v.q},${v.r},${v.side}`,
    v,
    pos: [x, 0.24, z],
  };
}

describe("ndcFromClient", () => {
  test("the centre of the canvas is the origin", () => {
    const ndc = ndcFromClient(rect, rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(ndc?.x).toBeCloseTo(0, 12);
    expect(ndc?.y).toBeCloseTo(0, 12);
  });

  test("y is flipped: the top of the canvas is +1", () => {
    expect(ndcFromClient(rect, rect.left, rect.top)).toEqual({ x: -1, y: 1 });
    expect(ndcFromClient(rect, rect.left + rect.width, rect.top + rect.height)).toEqual({
      x: 1,
      y: -1,
    });
  });

  test("it is a ratio within the rect, so a CSS zoom cannot skew it", () => {
    // index.css zooms the whole UI past 1700px. Under `zoom` the rect and the
    // event's client coordinates share the same scaled space, so the NDC must
    // not depend on the scale factor (dividing by window.innerWidth fails this).
    const zoom = 1.6;
    const scaled = {
      left: rect.left * zoom,
      top: rect.top * zoom,
      width: rect.width * zoom,
      height: rect.height * zoom,
    };
    const plain = ndcFromClient(rect, rect.left + 200, rect.top + 120);
    const zoomed = ndcFromClient(scaled, (rect.left + 200) * zoom, (rect.top + 120) * zoom);
    expect(zoomed?.x).toBeCloseTo(plain!.x, 10);
    expect(zoomed?.y).toBeCloseTo(plain!.y, 10);
  });

  test("a zero-sized canvas has no coordinates", () => {
    expect(ndcFromClient({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeNull();
  });
});

describe("groundPointAt", () => {
  test("round-trips a point on the board plane through the projection", () => {
    // Whatever the camera does, the picked point projects back to the pointer.
    const cam = camera();
    for (const [x, z] of [
      [0, 0],
      [7.5, -4.2],
      [-11, 9],
      [3, 14],
    ]) {
      const world = new THREE.Vector3(x, PICK_PLANE_Y, z);
      const ndc = world.clone().project(cam);
      const back = groundPointAt(cam, { x: ndc.x, y: ndc.y });
      expect(back?.x).toBeCloseTo(x, 6);
      expect(back?.z).toBeCloseTo(z, 6);
    }
  });

  test("a ray aimed above the horizon never reaches the board", () => {
    const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 2, 0.1, 500);
    cam.position.set(0, 5, 20);
    // Looking up and away: nothing in that direction is ever the board.
    cam.lookAt(0, 40, -100);
    cam.updateMatrixWorld(true);
    expect(groundPointAt(cam, { x: 0, y: 0 })).toBeNull();
  });

  test("a camera below the plane looking down does not pick behind itself", () => {
    const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 2, 0.1, 500);
    cam.position.set(0, -5, 0);
    cam.lookAt(0, -40, 0.001);
    cam.updateMatrixWorld(true);
    // The plane is above the camera and the ray points away: a negative `t`
    // would return a mirrored point on the board.
    expect(groundPointAt(cam, { x: 0, y: 0 })).toBeNull();
  });
});

describe("nearestTarget", () => {
  const v = vertexTarget({ q: 0, r: 0, side: 0 });

  test("a point on the target hits it", () => {
    expect(nearestTarget([v], { x: v.pos[0], z: v.pos[2] })?.key).toBe(v.key);
  });

  test("just inside the snap radius hits, just outside misses", () => {
    const inside = { x: v.pos[0] + SNAP_RADIUS.vertex * 0.98, z: v.pos[2] };
    const outside = { x: v.pos[0] + SNAP_RADIUS.vertex * 1.02, z: v.pos[2] };
    expect(nearestTarget([v], inside)?.key).toBe(v.key);
    expect(nearestTarget([v], outside)).toBeNull();
  });

  test("the nearest of several candidates wins", () => {
    const a = vertexTarget({ q: 0, r: 0, side: 0 });
    const b = vertexTarget({ q: 0, r: 0, side: 1 });
    expect(nearestTarget([a, b], { x: b.pos[0], z: b.pos[2] })?.key).toBe(b.key);
    expect(nearestTarget([b, a], { x: a.pos[0], z: a.pos[2] })?.key).toBe(a.key);
  });

  test("a vertex and the edge beside it are split down the middle", () => {
    // An edge midpoint is half a hex side from each end, so nothing between
    // them may be ambiguous.
    const vtx = { q: 0, r: 0, side: 0 } as const;
    const e = makeEdge(vtx, { q: 1, r: -1, side: 1 });
    const [ex, , ez] = edgeToWorld(e);
    const edge: PickTarget = { kind: "edge", action: "edge", key: "e", e, pos: [ex, 0.24, ez] };
    const vert = vertexTarget(vtx);
    const targets = [edge, vert];

    const lerp = (t: number) => ({
      x: vert.pos[0] + (ex - vert.pos[0]) * t,
      z: vert.pos[2] + (ez - vert.pos[2]) * t,
    });
    expect(nearestTarget(targets, lerp(0.1))?.key).toBe(vert.key);
    expect(nearestTarget(targets, lerp(0.9))?.key).toBe("e");
  });

  test("nothing at all is a miss, not a throw", () => {
    expect(nearestTarget([], { x: 0, z: 0 })).toBeNull();
  });

  test("a hex catches a click anywhere on its own tile", () => {
    const hex: PickTarget = {
      kind: "hex",
      action: "hex",
      key: "h",
      h: { q: 0, r: 0 },
      pos: [0, 0.27, 0],
    };
    // Well inside the tile but far outside a vertex's radius.
    expect(nearestTarget([hex], { x: LATTICE_SIZE * 0.7, z: 0 })?.key).toBe("h");
    // Two tiles away is not this tile.
    expect(nearestTarget([hex], { x: LATTICE_SIZE * 2.5, z: 0 })).toBeNull();
  });
});

describe("pickAt", () => {
  test("clicking where a vertex is drawn picks that vertex", () => {
    const cam = camera();
    const targets = [
      vertexTarget({ q: 0, r: 0, side: 0 }),
      vertexTarget({ q: 0, r: 0, side: 1 }),
      vertexTarget({ q: 1, r: 0, side: 0 }),
    ];
    for (const t of targets) {
      const ndc = new THREE.Vector3(t.pos[0], PICK_PLANE_Y, t.pos[2]).project(cam);
      const clientX = rect.left + ((ndc.x + 1) / 2) * rect.width;
      const clientY = rect.top + ((1 - ndc.y) / 2) * rect.height;
      expect(pickAt(cam, rect, clientX, clientY, targets)?.key).toBe(t.key);
    }
  });

  test("an empty target list never picks anything", () => {
    expect(pickAt(camera(), rect, 400, 200, [])).toBeNull();
  });
});

describe("isClick", () => {
  test("a still pointer is a click", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
  });

  test("a wobble within the slop is still a click", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(true);
  });

  test("a drag is not a click", () => {
    // An orbit must never also place a settlement.
    expect(isClick({ x: 10, y: 10 }, { x: 10 + CLICK_SLOP_PX + 1, y: 10 })).toBe(false);
    expect(isClick({ x: 10, y: 10 }, { x: 200, y: 140 })).toBe(false);
  });
});

describe("one radius for pointing and for clicking", () => {
  test("a hover and a click reach exactly as far as each other", () => {
    // One radius for hover and click: the hover previews what a click will
    // build, so it has to cover exactly the clicks that can be made.
    const v = { q: 0, r: 0, side: 0 as const };
    const [x, , z] = vertexToWorld(v);
    const cam = camera();
    const at = (dx: number) => {
      const s = new THREE.Vector3(x + dx, PICK_PLANE_Y, z).project(cam);
      return {
        cx: rect.left + ((s.x + 1) / 2) * rect.width,
        cy: rect.top + ((1 - s.y) / 2) * rect.height,
      };
    };
    // Just inside reaches, just outside doesn't, and both agree because there
    // is only one radius.
    const inside = at(SNAP_RADIUS.vertex * 0.9);
    const outside = at(SNAP_RADIUS.vertex * 1.1);
    expect(pickAt(cam, rect, inside.cx, inside.cy, [vertexTarget(v)])).not.toBeNull();
    expect(pickAt(cam, rect, outside.cx, outside.cy, [vertexTarget(v)])).toBeNull();
  });

  test("each kind stays inside its own half of the lattice", () => {
    // Under half the distance to the nearest neighbour of the same kind, so a
    // pointer between two spots is never inside both radii by more than the
    // hover's switch band. Describing a piece is tighter still: that must land
    // on the model.
    expect(SNAP_RADIUS.vertex).toBeLessThan(LATTICE_SIZE * 0.5);
    expect(SNAP_RADIUS.edge).toBeLessThan((LATTICE_SIZE * Math.sqrt(3)) / 4);
    expect(SNAP_RADIUS.vertex).toBeGreaterThan(INFO_SNAP_RADIUS.vertex);
    expect(SNAP_RADIUS.edge).toBeGreaterThan(INFO_SNAP_RADIUS.edge);
  });
});

describe("pickTap: a finger is forgiven where a mouse is not", () => {
  /**
   * A camera as far back as a phone puts it: a lattice side is about 16px
   * (Archipelago on a 390px portrait), so an edge's world radius (0.36 of a
   * side) is about 6px against a fingertip forty wide.
   */
  function farCamera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, rect.width / rect.height, 0.1, 2000);
    cam.position.set(0, 280, 0.001);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  }
  const toClient = (cam: THREE.Camera, p: readonly number[]) => {
    const ndc = new THREE.Vector3(p[0], PICK_PLANE_Y, p[2]).project(cam);
    return {
      x: rect.left + ((ndc.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  };

  test("the lattice is that small on this camera", () => {
    const cam = farCamera();
    const a = toClient(cam, vertexToWorld({ q: 0, r: 0, side: 0 }));
    const b = toClient(cam, vertexToWorld({ q: 0, r: 0, side: 1 }));
    const side = Math.hypot(a.x - b.x, a.y - b.y);
    expect(side).toBeGreaterThan(10);
    expect(side).toBeLessThan(24);
  });

  test("a tap a finger's width off the only legal spot still takes it", () => {
    const cam = farCamera();
    const t = vertexTarget({ q: 0, r: 0, side: 0 });
    const at = toClient(cam, t.pos);
    const x = at.x + 14;
    const y = at.y;
    // A mouse at the same spot misses: its radius is the lattice's.
    expect(pickAt(cam, rect, x, y, [t])).toBeNull();
    expect(pickTap(cam, rect, x, y, [t], false)).toBeNull();
    expect(pickTap(cam, rect, x, y, [t], true)?.key).toBe(t.key);
  });

  test("the nearest candidate wins, on screen", () => {
    const cam = farCamera();
    const a = vertexTarget({ q: 0, r: 0, side: 0 });
    const b = vertexTarget({ q: 1, r: 0, side: 0 });
    const pa = toClient(cam, a.pos);
    const pb = toClient(cam, b.pos);
    // Past the world radius of both, nearer to b.
    const x = pa.x + (pb.x - pa.x) * 0.7;
    const y = pa.y + (pb.y - pa.y) * 0.7;
    expect(Math.hypot(pb.x - x, pb.y - y)).toBeLessThanOrEqual(TOUCH_SNAP_PX);
    expect(pickAt(cam, rect, x, y, [a, b])).toBeNull();
    expect(pickTap(cam, rect, x, y, [a, b], true)?.key).toBe(b.key);
  });

  test("a tap well clear of everything is still nothing", () => {
    const cam = farCamera();
    const t = vertexTarget({ q: 0, r: 0, side: 0 });
    const at = toClient(cam, t.pos);
    expect(pickTap(cam, rect, at.x + TOUCH_SNAP_PX + 4, at.y, [t], true)).toBeNull();
  });

  test("a hit inside the world radius is the same answer as a mouse's", () => {
    const cam = camera();
    const targets = [vertexTarget({ q: 0, r: 0, side: 0 }), vertexTarget({ q: 0, r: 0, side: 1 })];
    for (const t of targets) {
      const at = toClient(cam, t.pos);
      expect(pickTap(cam, rect, at.x, at.y, targets, true)?.key).toBe(t.key);
    }
  });
});
