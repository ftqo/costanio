// One geometry, one material, ten seats.
//
// Seat colour is an instance property: one material per asset with its colour
// set to white, and the seat's tone in `InstancedMesh.instanceColor` (see
// instancing.ts). The shader does `diffuseColor *= vColor`, so white times the
// tone gives the tone, and every seat's pieces draw in one call. Per-seat
// material clones cost a material switch each, and profiling showed 48% of
// render time in `setProgram` re-uploading uniforms.
//
// White matters because it is the multiplicative identity; the authored colour
// is discarded.
//
// Geometry is shared by reference. The source asset is the shared cache entry
// and must not be mutated, so the white material is a clone, cached per source.
import * as THREE from "three";
import type { LoadedAsset } from "./loader";
import { isTintSlot } from "./tint";

/**
 * Cloned-to-white materials, keyed by source material object (not name: after
 * `applyPalette` two materials can share a name). A WeakMap, since
 * `clearAssetCache()` can drop the source at any time.
 */
const whitened = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();

/**
 * The asset with its tint slots ready for a per-instance seat colour. The
 * result is shared across seats and boards; callers must not mutate it.
 */
export function tintableAsset(asset: LoadedAsset): LoadedAsset {
  const scene = new THREE.Group();
  const byMaterial = new Map<string, THREE.Mesh[]>();

  asset.scene.updateMatrixWorld(true);
  asset.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | THREE.MeshStandardMaterial
      | undefined;
    if (!source) return;

    let material = source;
    if (isTintSlot(source.name)) {
      const hit = whitened.get(source);
      if (hit) {
        material = hit;
      } else {
        material = source.clone();
        // The identity for `diffuseColor *= vColor`. See the header.
        material.color.setRGB(1, 1, 1);
        whitened.set(source, material);
      }
    }

    const copy = new THREE.Mesh(mesh.geometry, material);
    copy.name = mesh.name;
    copy.applyMatrix4(mesh.matrixWorld);
    scene.add(copy);

    const key = material.name || "unnamed";
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), copy]);
  });

  return { scene, byMaterial };
}
