import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { animatable, instanceGeometry, poseInstance, poseInstanceAt } from "./instancing";

/**
 * One unit box, seated the way `seat` seats a piece: the art's base (local
 * y = -0.5, drawn at scale 2) lands exactly on groundY.
 */
function mesh() {
  const [inst] = instanceGeometry(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    [{ position: [3, 1.25, -2], rotationY: 0.4, scale: 2, key: "k", groundY: 0.25 }],
    "test",
  );
  return inst;
}

const matrixOf = (m: THREE.InstancedMesh) => {
  const out = new THREE.Matrix4();
  m.getMatrixAt(0, out);
  return out;
};

describe("animatable", () => {
  it("is attached only when placements carry keys", () => {
    expect(animatable(mesh())).toBeDefined();
    const [plain] = instanceGeometry(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      [{ position: [0, 0, 0] }],
      "plain",
    );
    expect(animatable(plain)).toBeUndefined();
  });

  it("maps a key back to its instance index", () => {
    expect(animatable(mesh())?.index.get("k")).toBe(0);
  });
});

describe("poseInstance", () => {
  it("at rest, reproduces the matrix the mesh was built with", () => {
    const m = mesh();
    const before = matrixOf(m);
    poseInstance(m, 0, 0, 1);
    expect(matrixOf(m).elements).toEqual(before.elements);
  });

  it("lifts along world Y only", () => {
    const m = mesh();
    const before = new THREE.Vector3().setFromMatrixPosition(matrixOf(m));
    poseInstance(m, 0, 1.5, 1);
    const after = new THREE.Vector3().setFromMatrixPosition(matrixOf(m));
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
    expect(after.y).toBeCloseTo(before.y + 1.5);
  });

  it("squashes about the ground, so the piece stays standing on it", () => {
    const m = mesh();
    poseInstance(m, 0, 0, 0.8);
    // Whatever the squash does, the point the piece stands on must not move;
    // squashing about the placement origin would lift it off the board.
    const base = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrixOf(m));
    expect(base.y).toBeCloseTo(0.25);
  });

  it("conserves volume: what it loses in height it gains across", () => {
    const m = mesh();
    poseInstance(m, 0, 0, 0.5);
    const scale = new THREE.Vector3().setFromMatrixScale(matrixOf(m));
    expect(scale.x * scale.y * scale.z).toBeCloseTo(2 * 2 * 2);
  });

  it("ignores a mesh with no animation state", () => {
    const [plain] = instanceGeometry(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      [{ position: [0, 0, 0] }],
      "plain",
    );
    const before = matrixOf(plain);
    poseInstance(plain, 0, 5, 0.5);
    expect(matrixOf(plain).elements).toEqual(before.elements);
  });
});

describe("poseInstanceAt", () => {
  it("at rest, reproduces the matrix the mesh was built with", () => {
    // The ticker poses one frame past the end of every animation, so an empty
    // pose must be the identity to the bit.
    const m = mesh();
    const before = matrixOf(m);
    poseInstanceAt(m, 0, {});
    expect(matrixOf(m).elements).toEqual(before.elements);
  });

  it("is what poseInstance is made of", () => {
    const a = mesh();
    const b = mesh();
    poseInstance(a, 0, 1.5, 0.8);
    poseInstanceAt(b, 0, { lift: 1.5, squashY: 0.8 });
    expect(matrixOf(b).elements).toEqual(matrixOf(a).elements);
  });

  it("offsets in world space, by exactly the amount asked for", () => {
    const m = mesh();
    const before = new THREE.Vector3().setFromMatrixPosition(matrixOf(m));
    poseInstanceAt(m, 0, { offsetX: -2.5, offsetZ: 4 });
    const after = new THREE.Vector3().setFromMatrixPosition(matrixOf(m));
    expect(after.x).toBeCloseTo(before.x - 2.5, 9);
    expect(after.z).toBeCloseTo(before.z + 4, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("offsets by the same amount however far from the board's centre it is", () => {
    // The offset sits outside the pivot pair the scales run through, so it is
    // pure translation and doesn't scale with the squash.
    const far = [{ position: [12, 0, -9] as [number, number, number], rotationY: 0, key: "k" }];
    const m = instanceGeometry(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), far)[0];
    poseInstanceAt(m, 0, { offsetX: 3, offsetZ: -1, squashY: 0.6 });
    const at = new THREE.Vector3().setFromMatrixPosition(matrixOf(m));
    expect(at.x).toBeCloseTo(15, 6);
    expect(at.z).toBeCloseTo(-10, 6);
  });

  it("grows about the ground, so the piece stays standing on it", () => {
    const m = mesh();
    poseInstanceAt(m, 0, { scale: 1.2 });
    const base = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrixOf(m));
    expect(base.y).toBeCloseTo(0.25);
    const scale = new THREE.Vector3().setFromMatrixScale(matrixOf(m));
    // Uniform, and volume is not conserved: a pulse grows, unlike a squash.
    expect(scale.x).toBeCloseTo(2 * 1.2);
    expect(scale.y).toBeCloseTo(2 * 1.2);
    expect(scale.z).toBeCloseTo(2 * 1.2);
  });

  it("keeps a growing piece where it stands, however far from the centre", () => {
    // A world-space scale about the origin would push the robber outward in
    // proportion to its distance from the board's centre every time it pulsed.
    const far = [{ position: [12, 0, -9] as [number, number, number], rotationY: 0, key: "k" }];
    const m = instanceGeometry(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), far)[0];
    poseInstanceAt(m, 0, { scale: 1.18 });
    const at = new THREE.Vector3().setFromMatrixPosition(matrixOf(m));
    expect(at.x).toBeCloseTo(12, 6);
    expect(at.z).toBeCloseTo(-9, 6);
  });

  it("composes a carry, an arc, a squash and a pulse in one pose", () => {
    // The robber can be mid-flight and mid-pulse at once; the four must be
    // independent.
    const m = mesh();
    poseInstanceAt(m, 0, { offsetX: 1, offsetZ: -2, lift: 0.75, squashY: 0.9, scale: 1.1 });
    // Tracked through the point the piece stands on, which both scales pivot
    // about, so the carry and lift move it by exactly their own amounts.
    const base = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrixOf(m));
    expect(base.x).toBeCloseTo(3 + 1, 9);
    expect(base.y).toBeCloseTo(0.25 + 0.75, 9);
    expect(base.z).toBeCloseTo(-2 - 2, 9);
  });

  it("ignores a mesh with no animation state", () => {
    const [plain] = instanceGeometry(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      [{ position: [0, 0, 0] }],
      "plain",
    );
    const before = matrixOf(plain);
    poseInstanceAt(plain, 0, { lift: 5, scale: 2 });
    expect(matrixOf(plain).elements).toEqual(before.elements);
  });
});

it("keeps a squashing piece in place anywhere on the board", () => {
  // A horizontal squash bulge about the world origin flings a piece outward in
  // proportion to its distance from the centre, worst at the rim of a
  // 10-player board.
  const far = [{ position: [12, 0, -9] as [number, number, number], rotationY: 0, key: "k" }];
  const mesh = instanceGeometry(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), far)[0];

  poseInstance(mesh, 0, 0, 0.6); // mid-squash, well past anything we ship
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(0, m);
  const at = new THREE.Vector3().setFromMatrixPosition(m);

  // Its footprint hasn't moved, only its height.
  expect(at.x).toBeCloseTo(12, 6);
  expect(at.z).toBeCloseTo(-9, 6);
});

describe("poseInstanceAt tilt", () => {
  /** Element-wise comparison; matrices are floats and the maths goes through trig. */
  const near = (a: THREE.Matrix4, b: THREE.Matrix4) => {
    a.elements.forEach((v, i) => expect(v).toBeCloseTo(b.elements[i], 5));
  };

  /**
   * What the pose did, in world space: `posed = delta * built`. Asserting on
   * `delta` avoids baking in the art's transform and the placement, and fails
   * if the rotation runs about the wrong point.
   */
  const delta = (built: THREE.Matrix4, posed: THREE.Matrix4) =>
    posed.clone().multiply(built.clone().invert());

  it("with no tilt, reproduces the matrix the mesh was built with", () => {
    const m = mesh();
    const before = matrixOf(m);
    poseInstanceAt(m, 0, { tilt: 0 });
    expect(matrixOf(m).elements).toEqual(before.elements);
  });

  it("a full turn comes back to where it started", () => {
    const m = mesh();
    const before = matrixOf(m);
    poseInstanceAt(m, 0, { tilt: Math.PI * 2, tiltPivotY: 0.03 });
    near(matrixOf(m), before);
  });

  it("turns about the piece's own middle, not the board origin", () => {
    // A transform about the world origin looks nearly right at the board's
    // centre and throws a piece far at its edge, so the box sits at x = 3,
    // z = -2.
    const m = mesh();
    const built = matrixOf(m);
    poseInstanceAt(m, 0, { tilt: Math.PI / 2, tiltPivotY: 0.5 });
    const centre = new THREE.Vector3(3, 0.25 + 0.5, -2); // placement x/z, groundY + tiltPivotY
    const expected = new THREE.Matrix4()
      .makeTranslation(centre.x, centre.y, centre.z)
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    near(delta(built, matrixOf(m)), expected);
  });

  it("tiltAxisY names the axis within the ground plane", () => {
    // A quarter turn of azimuth puts the axis on +Z instead of +X.
    const m = mesh();
    const built = matrixOf(m);
    poseInstanceAt(m, 0, { tilt: Math.PI / 3, tiltAxisY: Math.PI / 2, tiltPivotY: 0 });
    const centre = new THREE.Vector3(3, 0.25, -2);
    const expected = new THREE.Matrix4()
      .makeTranslation(centre.x, centre.y, centre.z)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 3))
      .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    near(delta(built, matrixOf(m)), expected);
  });

  it("tilts and lifts at once, without the two interfering", () => {
    const m = mesh();
    const built = matrixOf(m);
    poseInstanceAt(m, 0, { tilt: Math.PI, tiltPivotY: 0.03, lift: 0.4 });
    const centre = new THREE.Vector3(3, 0.25 + 0.03, -2);
    const expected = new THREE.Matrix4()
      .makeTranslation(0, 0.4, 0)
      .multiply(new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI))
      .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    near(delta(built, matrixOf(m)), expected);
  });

  it("tiltPivotX and tiltPivotZ move the axis sideways", () => {
    // A knight's sword: the placement is the knight's vertex, and the turn
    // happens at the hand, a third of a hex to the side.
    const m = mesh();
    const built = matrixOf(m);
    poseInstanceAt(m, 0, {
      tilt: Math.PI / 3,
      tiltPivotX: -0.45,
      tiltPivotY: 0.46,
      tiltPivotZ: 0.1,
    });
    const centre = new THREE.Vector3(3 - 0.45, 0.25 + 0.46, -2 + 0.1);
    const expected = new THREE.Matrix4()
      .makeTranslation(centre.x, centre.y, centre.z)
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 3))
      .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    near(delta(built, matrixOf(m)), expected);
  });

  it("holds the point on the axis still while everything else turns", () => {
    // The point of the sideways pivot: without it the sword's grip circles the
    // knight; with it, the grip doesn't move.
    const m = mesh();
    const built = matrixOf(m);
    poseInstanceAt(m, 0, {
      tilt: 2.6,
      tiltAxisY: Math.PI / 2,
      tiltPivotX: -0.45,
      tiltPivotY: 0.46,
    });
    const moved = delta(built, matrixOf(m));
    const grip = new THREE.Vector3(3 - 0.45, 0.25 + 0.46, -2);
    // 1e-6 rather than 0: `delta` goes through a float32 matrix inverse.
    expect(grip.clone().applyMatrix4(moved).distanceTo(grip)).toBeLessThan(1e-6);
    // And a point off the axis does move, so this isn't an identity transform.
    const tip = new THREE.Vector3(3 - 0.45, 0.25 + 1.3, -2);
    expect(tip.clone().applyMatrix4(moved).distanceTo(tip)).toBeGreaterThan(0.5);
  });

  it("with a sideways pivot and no tilt, still reproduces the built matrix", () => {
    // The rotation block is skipped on a zero tilt, so the pivot fields can't
    // add drift after an animation ends.
    const m = mesh();
    const before = matrixOf(m);
    poseInstanceAt(m, 0, { tilt: 0, tiltPivotX: -0.45, tiltPivotY: 0.46, tiltPivotZ: 2 });
    expect(matrixOf(m).elements).toEqual(before.elements);
  });
});

describe("spinY", () => {
  const apply = (pose: Parameters<typeof poseInstanceAt>[2]) => {
    const m = mesh();
    poseInstanceAt(m, 0, pose);
    return matrixOf(m);
  };

  it("leaves the matrix untouched when it is zero", () => {
    // Same contract as `tilt`: an unspun piece keeps its built matrix bit for
    // bit.
    expect(apply({ spinY: 0 }).elements).toEqual(matrixOf(mesh()).elements);
  });

  it("turns about the vertical, which no tilt axis can express", () => {
    // `tilt`'s axis is built as (cos a, 0, sin a) and is therefore always in
    // the ground plane. A quarter turn about Y sends the piece's own +X to -Z.
    const spun = apply({ spinY: Math.PI / 2 });
    const x = new THREE.Vector3(1, 0, 0).transformDirection(spun).normalize();
    const flat = new THREE.Vector3(1, 0, 0).transformDirection(matrixOf(mesh())).normalize();
    expect(x.y).toBeCloseTo(0, 6);
    expect(x.dot(flat)).toBeCloseTo(0, 6);
  });

  it("keeps the piece's height, unlike a tilt", () => {
    // A dead robber spins rather than somersaulting: a spin is flat, so the
    // piece stays as low as the tip left it.
    const spun = apply({ spinY: 1.1 });
    const rest = matrixOf(mesh());
    expect(new THREE.Vector3().setFromMatrixPosition(spun).y).toBeCloseTo(
      new THREE.Vector3().setFromMatrixPosition(rest).y,
      6,
    );
  });

  it("composes outside the tilt, so a lying piece spins flat", () => {
    // Order matters: inside the tilt pair the spin would drag the tilt axis
    // round and sweep a cone; outside, it turns the piece as it lies.
    const laid = apply({ tilt: Math.PI / 2, tiltAxisY: 0 });
    const spun = apply({ tilt: Math.PI / 2, tiltAxisY: 0, spinY: Math.PI });
    const up = (m: THREE.Matrix4) => new THREE.Vector3(0, 1, 0).transformDirection(m).normalize();
    // Laid over, the piece's up-axis is horizontal and stays horizontal
    // through the spin.
    expect(up(laid).y).toBeCloseTo(0, 6);
    expect(up(spun).y).toBeCloseTo(0, 6);
    // And it moved: half a turn reverses it.
    expect(up(spun).dot(up(laid))).toBeCloseTo(-1, 6);
  });
});
