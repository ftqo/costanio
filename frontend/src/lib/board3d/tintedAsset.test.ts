import { test, expect } from "vitest";
import * as THREE from "three";
import { tintableAsset } from "./tintedAsset";
import type { LoadedAsset } from "./loader";

function piece(): LoadedAsset {
  const scene = new THREE.Group();
  for (const name of ["Seat_Body", "Seat_Shade", "Mat_Robber"]) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ name, color: 0x336699 }),
    );
    mesh.name = `part_${name}`;
    scene.add(mesh);
  }
  return { scene, byMaterial: new Map() };
}

function materialNamed(asset: LoadedAsset, name: string): THREE.MeshStandardMaterial {
  let found: THREE.MeshStandardMaterial | undefined;
  asset.scene.traverse((n) => {
    const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && m.name === name) found = m;
  });
  return found!;
}

test("Seat_ materials come out white", () => {
  // White is the identity for `diffuseColor *= vColor`, so the instance colour
  // comes out exactly as the seat colour.
  const tintable = tintableAsset(piece());
  expect(materialNamed(tintable, "Seat_Body").color.getHexString()).toBe("ffffff");
  expect(materialNamed(tintable, "Seat_Shade").color.getHexString()).toBe("ffffff");
});

test("non-seat materials are untouched", () => {
  const before = materialNamed(piece(), "Mat_Robber").color.getHexString();
  const after = materialNamed(tintableAsset(piece()), "Mat_Robber").color.getHexString();
  expect(after).toBe(before);
});

test("non-seat materials are shared with the source, not cloned", () => {
  const base = piece();
  expect(materialNamed(tintableAsset(base), "Mat_Robber")).toBe(materialNamed(base, "Mat_Robber"));
});

test("every seat shares ONE material per slot", () => {
  // A per-seat clone would cost a material switch (and draw call) per seat.
  const base = piece();
  expect(materialNamed(tintableAsset(base), "Seat_Body")).toBe(
    materialNamed(tintableAsset(base), "Seat_Body"),
  );
});

test("geometry is shared, not duplicated", () => {
  const base = piece();
  const geomOf = (asset: LoadedAsset) => {
    let g: THREE.BufferGeometry | undefined;
    asset.scene.traverse((n) => {
      if ((n as THREE.Mesh).isMesh && !g) g = (n as THREE.Mesh).geometry;
    });
    return g;
  };
  expect(geomOf(tintableAsset(base))).toBe(geomOf(tintableAsset(base)));
});

test("whitening does not mutate the source asset", () => {
  // The source is the shared cache entry; mutating it would affect every later
  // board.
  const base = piece();
  const before = materialNamed(base, "Seat_Body").color.getHexString();
  tintableAsset(base);
  expect(materialNamed(base, "Seat_Body").color.getHexString()).toBe(before);
  expect(before).not.toBe("ffffff");
});
