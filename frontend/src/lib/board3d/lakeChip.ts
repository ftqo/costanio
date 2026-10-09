// The number chip on a lake, and the cut every chip is drawn from.
//
// A lake pays fish on two numbers or four (engine/scenarios.fishLake: the first lake
// on 2, 3, 11 and 12, any others on 4 and 10).
//
// One chip per lake carries all its numbers. The lake tile's socket has the
// usual 1.0 disc and 1.05 keep-clear (the tile-art contract; the pond is in
// the northern half and the grass under the socket is flat, planted past
// 1.5). Four whole chips in a 2x2 there would be 0.43 of a chip each; four
// numerals on one face keep 0.55, since they share one rim and body. Two keep
// 0.8.
//
// Composed at runtime from chips.glb's parts: the blank chip's body and face,
// plus each number's numeral and pips lifted off its chip, shrunk and set into
// a slot. The ink keeps its authored height above the face.
import * as THREE from "three";
import { CHIPS } from "./manifest.generated";
import { assetCentreXZ, assetSpanY, type LoadedAsset } from "./loader";

/** The chip body's material in chips.glb: the part the rim and the thickness are. */
export const CHIP_BODY_MATERIAL = "Mat_Chip_Body";

/** The node-name prefix of number `n`'s chip, variant `v` (`Chip_04_1`). */
export function chipPrefix(n: number, v: number): string {
  return `Chip_${String(n).padStart(2, "0")}_${v}`;
}

/**
 * Every mesh that belongs to the chip named `prefix`: its own name starts with
 * the prefix, or one of its ancestors' does.
 *
 * Ancestors matter: 13 of the 19 chips in chips.glb keep their body as an
 * unnamed child of `Chip_NN_V_body`, and three names such a mesh after its
 * mesh data (`Chip_body_mesh.001`). A cut by the mesh's own name
 * (`subsetByPrefix`, right for every other file) drops the body, leaving a
 * bare face disc flush on the tile and a robber at inconsistent heights.
 *
 * Same shape as `subsetByPrefix` (fresh meshes carrying the node's world
 * matrix, indexed by material name), so it drops into every caller.
 */
export function chipArt(asset: LoadedAsset, prefix: string): LoadedAsset {
  const scene = new THREE.Group();
  const byMaterial = new Map<string, THREE.Mesh[]>();
  asset.scene.updateMatrixWorld(true);
  const belongs = (node: THREE.Object3D): boolean => {
    for (let n: THREE.Object3D | null = node; n && n !== asset.scene; n = n.parent) {
      if (n.name.startsWith(prefix)) return true;
    }
    return false;
  };
  asset.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !belongs(mesh)) return;
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    // Named for the chip it came from, so a body cut this way is still
    // recognisable as that chip's in `stats().byName` and in a test.
    copy.name = mesh.name.startsWith(prefix) ? mesh.name : `${prefix}_body`;
    copy.applyMatrix4(mesh.matrixWorld);
    scene.add(copy);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const key = mat.name || "unnamed";
      byMaterial.set(key, [...(byMaterial.get(key) ?? []), copy]);
    }
  });
  return { scene, byMaterial };
}

/**
 * How much bigger than a chip the lake's is, across. Height is left alone, so
 * the robber stands on it at exactly the height it stands on any chip.
 *
 * 1.05 is the socket's keep-clear on every tile, and on the lake tile the grass
 * under it is flat to about that (measured off tiles/lake.glb: 0.24 inside
 * |x| < 0.75, grass tufts to 0.47 at |x| = 1, trees from 1.5). A hair past
 * the disc buys the numerals room without reaching the planting.
 */
export const LAKE_CHIP_SCALE = 1.05;

/** One number's place on the lake chip's face: centre (x, z) and scale k. */
export interface LakeChipSlot {
  x: number;
  z: number;
  k: number;
}

/**
 * Where each of `n` numbers goes, in reading order: left to right, then the
 * upper row (-z, away from the viewer) before the lower.
 *
 * Sized against the widest thing a slot has to hold, a two-digit numeral over
 * its pips (0.73 x 1.08 on its own chip), inside the face (0.88 of a chip,
 * scaled by LAKE_CHIP_SCALE), with the rim left clear and a visible gutter
 * between neighbours. `lakeChip.test` checks all three off the real file.
 */
export function lakeChipSlots(n: number): LakeChipSlot[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, z: 0, k: 1 }];
  if (n === 2) {
    return [
      { x: -0.4, z: 0, k: 0.8 },
      { x: 0.4, z: 0, k: 0.8 },
    ];
  }
  // Three or four: two rows of two. Three leaves a slot empty; no ruleset
  // deals that today, but it draws rather than throws.
  const k = 0.55;
  const grid = [
    { x: -0.32, z: -0.39, k },
    { x: 0.32, z: -0.39, k },
    { x: -0.32, z: 0.39, k },
    { x: 0.32, z: 0.39, k },
  ];
  return grid.slice(0, Math.min(n, 4));
}

const HAS_ART = new Set(CHIPS.map((c) => c.number));

/**
 * The lake chip for `numbers`, as an asset in the chip file's own frame: centred
 * on the origin, standing where a chip stands, ready for `seat` and
 * `instanceAsset` like any other chip.
 *
 * Every number's ink is taken from variant 1 of its own chip: the numeral and
 * pips are the same in both variants (the variants differ in the body), so
 * which one does not show.
 */
export function composeLakeChip(chips: LoadedAsset, numbers: readonly number[]): LoadedAsset {
  const drawn = numbers.filter((n) => HAS_ART.has(n));
  const blank = chipArt(chips, "Chip_blank");
  const scene = new THREE.Group();
  const byMaterial = new Map<string, THREE.Mesh[]>();
  const keep = (mesh: THREE.Mesh, m: THREE.Matrix4) => {
    mesh.applyMatrix4(m);
    scene.add(mesh);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const key = mat.name || "unnamed";
      byMaterial.set(key, [...(byMaterial.get(key) ?? []), mesh]);
    }
  };

  // The blank, widened about its own centre and never thickened.
  const [bx, bz] = assetCentreXZ(blank);
  const widen = new THREE.Matrix4()
    .makeTranslation(bx, 0, bz)
    .multiply(new THREE.Matrix4().makeScale(LAKE_CHIP_SCALE, 1, LAKE_CHIP_SCALE))
    .multiply(new THREE.Matrix4().makeTranslation(-bx, 0, -bz));
  for (const mesh of [...blank.scene.children] as THREE.Mesh[]) keep(mesh, widen);
  const faceTop = assetSpanY(chipArt(chips, "Chip_blank_face"))[1];

  const slots = lakeChipSlots(drawn.length);
  drawn.forEach((n, i) => {
    const prefix = chipPrefix(n, 1);
    // The ink alone: numeral and pips, which is everything on a chip that is
    // not its body or its face.
    const ink = new THREE.Group();
    for (const part of [`${prefix}_numeral`, `${prefix}_pip`]) {
      for (const mesh of [...chipArt(chips, part).scene.children]) ink.add(mesh);
    }
    const inkAsset: LoadedAsset = { scene: ink, byMaterial: new Map() };
    const [cx, cz] = assetCentreXZ(inkAsset);
    // A chip's own face may sit at a different height from the blank's (the
    // bodies were authored at different y), so the ink is offset by the
    // difference and lands on the blank as it lay on its own face.
    const ownTop = assetSpanY(chipArt(chips, `${prefix}_face`))[1];
    const { x, z, k } = slots[i];
    const m = new THREE.Matrix4()
      .makeTranslation(bx + x * LAKE_CHIP_SCALE, faceTop - ownTop, bz + z * LAKE_CHIP_SCALE)
      .multiply(new THREE.Matrix4().makeScale(k, 1, k))
      .multiply(new THREE.Matrix4().makeTranslation(-cx, 0, -cz));
    for (const mesh of [...ink.children] as THREE.Mesh[]) keep(mesh, m);
  });
  return { scene, byMaterial };
}
