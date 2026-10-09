import { test, expect } from "vitest";
import * as THREE from "three";
import { instanceAsset, instanceGeometry, disposeInstances, poseInstanceAt } from "./instancing";
import type { LoadedAsset } from "./loader";

/**
 * An asset with `n` meshes, each offset so local transforms are observable,
 * and each unmergeable so there is one draw per part.
 *
 * Roughness keeps them apart because it is in `drawSignature`; parts that
 * differ only by name or colour merge into one draw (see `colourAsset`).
 */
function fakeAsset(n: number): LoadedAsset {
  const scene = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: `Mat_${i}`, roughness: 0.1 * (i + 1) }),
    );
    mesh.name = `part_${i}`;
    mesh.position.set(0, i, 0);
    scene.add(mesh);
  }
  return { scene, byMaterial: new Map() };
}

test("one InstancedMesh is produced per source mesh", () => {
  const out = instanceAsset(fakeAsset(3), [{ position: [0, 0, 0] }]);
  expect(out).toHaveLength(3);
  expect(out[0].isInstancedMesh).toBe(true);
});

test("instance count equals the number of placements, not the mesh count", () => {
  // 300 ocean tiles are one InstancedMesh of 300 instances, not 300 cloned
  // scene graphs.
  const out = instanceAsset(fakeAsset(2), [
    { position: [0, 0, 0] },
    { position: [5, 0, 0] },
    { position: [10, 0, 0] },
  ]);
  for (const m of out) expect(m.count).toBe(3);
});

test("each instance lands at its placement position", () => {
  const out = instanceAsset(fakeAsset(1), [{ position: [0, 0, 0] }, { position: [5, 0, -7] }]);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  out[0].getMatrixAt(1, m);
  p.setFromMatrixPosition(m);
  expect(p.x).toBeCloseTo(5, 5);
  expect(p.z).toBeCloseTo(-7, 5);
});

test("a mesh's own local offset is preserved inside the instance", () => {
  // part_1 sits at y=1 within the asset, so an instance at the origin must
  // still put it at y=1, or every prop collapses onto the tile surface.
  const out = instanceAsset(fakeAsset(2), [{ position: [0, 0, 0] }]);
  const byName = new Map(out.map((m) => [m.name, m]));
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  byName.get("part_1")!.getMatrixAt(0, m);
  p.setFromMatrixPosition(m);
  expect(p.y).toBeCloseTo(1, 5);
});

test("rotationY is applied about the placement, not the mesh origin", () => {
  const out = instanceAsset(fakeAsset(1), [{ position: [4, 0, 0], rotationY: Math.PI / 2 }]);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  out[0].getMatrixAt(0, m);
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  const euler = new THREE.Euler().setFromQuaternion(q, "YXZ");
  expect(euler.y).toBeCloseTo(Math.PI / 2, 5);
});

test("no placements yields no meshes rather than a zero-count mesh", () => {
  expect(instanceAsset(fakeAsset(3), [])).toEqual([]);
});

test("disposing releases the instance buffers", () => {
  const out = instanceAsset(fakeAsset(1), [{ position: [0, 0, 0] }]);
  expect(() => disposeInstances(out)).not.toThrow();
});

test("generated geometry is freed on dispose; loaded geometry is not", () => {
  // A loaded asset's geometry is shared with the module cache and every board
  // built from it, so freeing it would blank a later game. The beach strips
  // and gap sand are built fresh per board and must be freed with it.
  const generated = instanceGeometry(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    [{ position: [0, 0, 0] }],
    "beach_dry",
  );
  const shared = new THREE.BoxGeometry(1, 1, 1);
  const borrowed = new THREE.InstancedMesh(shared, new THREE.MeshBasicMaterial(), 1);

  let generatedDisposed = false;
  generated[0].geometry.addEventListener("dispose", () => (generatedDisposed = true));
  let sharedDisposed = false;
  shared.addEventListener("dispose", () => (sharedDisposed = true));

  disposeInstances([...generated, borrowed]);
  expect(generatedDisposed, "generated geometry should be freed").toBe(true);
  expect(sharedDisposed, "cache-owned geometry must survive").toBe(false);
});

/** An asset whose `n` meshes SHARE one material, so they can be merged. */
function sharedMaterialAsset(n: number): LoadedAsset {
  const scene = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ name: "Mat_Shared" });
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.name = `part_${i}`;
    mesh.position.set(i + 1, 2 * i + 3, -i - 2);
    scene.add(mesh);
  }
  return { scene, byMaterial: new Map() };
}

/** Every vertex of every instance, in world space, rounded and sorted. */
function worldPoints(meshes: THREE.InstancedMesh[]): string[] {
  const out: string[] = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(m);
        out.push(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`);
      }
    }
  }
  return out.sort();
}

test("parts that share a material share one draw call", () => {
  // A draw call is per material but the art is authored per object, so a gold
  // tile cost 41 calls. Four parts under one material should be one call.
  const out = instanceAsset(sharedMaterialAsset(4), [{ position: [0, 0, 0] }]);
  expect(out).toHaveLength(1);
  expect(out[0].count).toBe(1);
});

test("merging moves no vertex: the merged board is the unmerged board", () => {
  // Each part's transform moves from the instance matrix into the vertices,
  // and both must give the same world position.
  const placements = [
    { position: [0, 0, 0] as [number, number, number] },
    { position: [5, 0, -7] as [number, number, number], rotationY: Math.PI / 3 },
    { position: [-2, 1, 4] as [number, number, number], scale: 1.5 },
  ];
  const merged = instanceAsset(sharedMaterialAsset(3), placements);
  expect(merged).toHaveLength(1);

  // The same asset with distinct materials cannot merge, so it is the
  // unmerged reference.
  const reference = instanceAsset(fakeAssetAt(3), placements);
  expect(reference).toHaveLength(3);

  expect(worldPoints(merged)).toEqual(worldPoints(reference));
});

/** `sharedMaterialAsset`'s geometry and offsets, but a material each. */
function fakeAssetAt(n: number): LoadedAsset {
  const scene = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      // Roughness, not just a distinct name: see `fakeAsset`.
      new THREE.MeshStandardMaterial({ name: `Mat_${i}`, roughness: 0.1 * (i + 1) }),
    );
    mesh.name = `part_${i}`;
    mesh.position.set(i + 1, 2 * i + 3, -i - 2);
    scene.add(mesh);
  }
  return { scene, byMaterial: new Map() };
}

test("a merged instance still poses about its own placement", () => {
  // The parts' transforms are baked into the geometry, so `state.local` is the
  // identity; posing multiplies by it innermost. The empty pose must reproduce
  // the built matrix exactly, since the ticker writes it one frame past the
  // end of every animation.
  const out = instanceAsset(sharedMaterialAsset(3), [
    { position: [4, 0, -3], rotationY: Math.PI / 5, key: "k", groundY: 0 },
  ]);
  const built = new THREE.Matrix4();
  out[0].getMatrixAt(0, built);
  const before = built.elements.slice();

  poseInstanceAt(out[0], 0, {});
  out[0].getMatrixAt(0, built);
  for (let i = 0; i < 16; i++) expect(built.elements[i]).toBeCloseTo(before[i], 6);

  // A real pose lifts it in place.
  poseInstanceAt(out[0], 0, { lift: 2 });
  out[0].getMatrixAt(0, built);
  expect(built.elements[13] - before[13]).toBeCloseTo(2, 6);
});

test("merged geometry is owned, so a rebuild frees it", () => {
  // Cloned and merged here, so unlike a loaded asset's geometry it is not
  // shared with the loader's cache and must be freed on rebuild.
  const out = instanceAsset(sharedMaterialAsset(3), [{ position: [0, 0, 0] }]);
  const geom = out[0].geometry;
  let disposed = false;
  geom.addEventListener("dispose", () => (disposed = true));
  disposeInstances(out);
  expect(disposed).toBe(true);
});

test("a placement's tint lands on the instance, keyed by material name", () => {
  // One draw call for the whole table: the seats differ only by instance
  // colour. Keyed by material name because one placement feeds several draws
  // (body and shade) with a different tone in each.
  const red = new THREE.Color(1, 0, 0);
  const green = new THREE.Color(0, 1, 0);
  const out = instanceAsset(fakeAsset(1), [
    { position: [0, 0, 0], tint: { Mat_0: red } },
    { position: [5, 0, 0], tint: { Mat_0: green } },
  ]);
  const c = new THREE.Color();
  out[0].getColorAt(0, c);
  expect(c.getHex()).toBe(red.getHex());
  out[0].getColorAt(1, c);
  expect(c.getHex()).toBe(green.getHex());
});

test("a tint for another material leaves this one at the identity", () => {
  // instanceColor multiplies the material colour, so anything but white would
  // darken an untinted part.
  const out = instanceAsset(fakeAsset(2), [
    { position: [0, 0, 0], tint: { Mat_0: new THREE.Color(1, 0, 0) } },
  ]);
  const c = new THREE.Color();
  out[1].getColorAt(0, c);
  expect(c.getHex()).toBe(0xffffff);
});

test("untinted placements allocate no instanceColor at all", () => {
  // An instanceColor buffer forces a second compiled program for the material
  // (three keys the program on USE_INSTANCING_COLOR).
  const out = instanceAsset(fakeAsset(1), [{ position: [0, 0, 0] }, { position: [5, 0, 0] }]);
  expect(out[0].instanceColor).toBeNull();
});

test("one tinted placement gives every instance on that mesh a colour", () => {
  // A mixed batch: the tinted piece must not leave its neighbours reading an
  // uninitialised buffer.
  const red = new THREE.Color(1, 0, 0);
  const out = instanceAsset(fakeAsset(1), [
    { position: [0, 0, 0], tint: { Mat_0: red } },
    { position: [5, 0, 0] },
  ]);
  const c = new THREE.Color();
  out[0].getColorAt(1, c);
  expect(c.getHex()).toBe(0xffffff);
});

/** `n` parts identical but for their base colour: the art's dominant shape. */
function colourAsset(n: number, colours: number[]): LoadedAsset {
  const scene = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: `Mat_${i}`, color: colours[i % colours.length] }),
    );
    mesh.name = `part_${i}`;
    mesh.position.set(0, i, 0);
    scene.add(mesh);
  }
  return { scene, byMaterial: new Map() };
}

test("parts differing only by colour share one draw call", () => {
  // Art is painted finely: a fields tile authors ground, crop rows, harvest,
  // hedgerow and scarecrow as five materials that differ only in colour. On
  // the full board, 262 materials are 45 real signatures.
  const out = instanceAsset(colourAsset(5, [0xff0000, 0x00ff00, 0x0000ff]), [
    { position: [0, 0, 0] },
  ]);
  expect(out).toHaveLength(1);
});

test("a colour-merged draw carries each part's colour in its vertices", () => {
  const red = 0xff0000;
  const green = 0x00ff00;
  const out = instanceAsset(colourAsset(2, [red, green]), [{ position: [0, 0, 0] }]);
  const colour = out[0].geometry.getAttribute("color");
  expect(colour).toBeTruthy();

  // A box is 24 vertices, so the first part's colour fills the first 24 and
  // the second's the next 24. Compared in three's working space, which is how
  // the attribute is read; converting on the way in would lighten it.
  const want = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  const at = (i: number) =>
    new THREE.Color(colour.getX(i), colour.getY(i), colour.getZ(i)).getHexString();
  expect(at(0)).toBe(want(red).getHexString());
  expect(at(24)).toBe(want(green).getHexString());
});

test("a colour-merged draw uses vertex colours with no tint", () => {
  // The material multiplies its colour by the vertex colour, so anything but
  // white would darken every part in the group.
  const out = instanceAsset(colourAsset(3, [0xff0000, 0x00ff00, 0x0000ff]), [
    { position: [0, 0, 0] },
  ]);
  const material = out[0].material as THREE.MeshStandardMaterial;
  expect(material.vertexColors).toBe(true);
  expect(material.color.getHexString()).toBe("ffffff");
});

test("the merged material is shared across rebuilds, not cloned each time", () => {
  // Two materials with the same settings are still two material ids, so two
  // uniform re-uploads a frame, and a board is rebuilt on every server message.
  const asset = colourAsset(3, [0xff0000, 0x00ff00, 0x0000ff]);
  const a = instanceAsset(asset, [{ position: [0, 0, 0] }]);
  const b = instanceAsset(asset, [{ position: [1, 0, 0] }]);
  expect(a[0].material).toBe(b[0].material);
});

test("the source materials are left alone", () => {
  // They belong to the loader's cache and are shared with every later board.
  const asset = colourAsset(2, [0xff0000, 0x00ff00]);
  const source = (asset.scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  const before = source.color.getHexString();
  instanceAsset(asset, [{ position: [0, 0, 0] }]);
  expect(source.color.getHexString()).toBe(before);
  expect(source.vertexColors).toBe(false);
});

test("a tinted material is never merged with anything else", () => {
  // The seat colour applies to the whole draw, so folding an untinted part in
  // beside a tinted one would paint it the seat's colour too.
  const scene = new THREE.Group();
  const tint = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ name: "Seat_Body", color: 0xffffff }),
  );
  tint.name = "tinted";
  const plain = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ name: "Mat_Roof", color: 0xffffff }),
  );
  plain.name = "plain";
  scene.add(tint, plain);

  const out = instanceAsset({ scene, byMaterial: new Map() }, [
    { position: [0, 0, 0], tint: { Seat_Body: new THREE.Color(1, 0, 0) } },
  ]);
  expect(out).toHaveLength(2);
  const tinted = out.find((m) => m.instanceColor !== null)!;
  const c = new THREE.Color();
  tinted.getColorAt(0, c);
  expect(c.getHex()).toBe(0xff0000);
  // The part beside it took no colour.
  expect(out.find((m) => m !== tinted)!.instanceColor).toBeNull();
});
