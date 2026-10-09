// The lake's number chip, composed from the shipped chip art.
//
// Measured off the real chips.glb: every claim is about that file (which parts
// make a chip, numeral size, and whether four fit on one face).
import { test, expect, describe, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { newGLTFLoader, assetSpanY, subsetByPrefix, type LoadedAsset } from "./loader";
import { CHIPS } from "./manifest.generated";
import {
  chipArt,
  chipPrefix,
  composeLakeChip,
  lakeChipSlots,
  LAKE_CHIP_SCALE,
  CHIP_BODY_MATERIAL,
} from "./lakeChip";

const MODELS = join(__dirname, "..", "..", "..", "public", "models");

let chips: LoadedAsset;
beforeAll(async () => {
  const buf = readFileSync(join(MODELS, "chips.glb"));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    newGLTFLoader().parse(ab, "", resolve, reject),
  );
  chips = { scene: gltf.scene, byMaterial: new Map() };
});

/** Every vertex of the meshes whose name starts with `prefix`, in asset space. */
function points(asset: LoadedAsset, prefix = ""): THREE.Vector3[] {
  asset.scene.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  asset.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.name.startsWith(prefix)) return;
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

function box(pts: THREE.Vector3[]): THREE.Box3 {
  return new THREE.Box3().setFromPoints(pts);
}

function materialsOf(asset: LoadedAsset): Set<string> {
  const out = new Set<string>();
  asset.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      out.add(m.name);
    }
  });
  return out;
}

describe("a chip's art is the whole chip", () => {
  // 13 of the 19 chip nodes in chips.glb carry their body as an unnamed child,
  // which three names after its mesh data ("Chip_body_mesh.001"), so a cut by
  // node-name prefix misses it and the chip draws as a bare face disc.
  test("every chip, every variant, has its body", () => {
    for (const { number, variants } of CHIPS) {
      for (let v = 1; v <= variants; v++) {
        const art = chipArt(chips, chipPrefix(number, v));
        expect(materialsOf(art).has(CHIP_BODY_MATERIAL), `chip ${number}_${v}`).toBe(true);
      }
    }
  });

  test("so every chip is the same height, which is what the robber stands on", () => {
    const heights = CHIPS.map(({ number }) => {
      const [lo, hi] = assetSpanY(chipArt(chips, chipPrefix(number, 1)));
      return hi - lo;
    });
    for (const h of heights) expect(h).toBeCloseTo(heights[0], 3);
  });

  test("and the blank chip the lake is built on is one of them, less the ink", () => {
    const blank = chipArt(chips, "Chip_blank");
    expect(materialsOf(blank).has(CHIP_BODY_MATERIAL)).toBe(true);
    // Body and face stand exactly as a numbered chip's do; only the numeral
    // and pips, which the blank has none of, reach above the face.
    const [lo, hi] = assetSpanY(blank);
    const six = chipArt(chips, chipPrefix(6, 1));
    const [lo6] = assetSpanY(six);
    const face6 = assetSpanY(chipArt(chips, chipPrefix(6, 1) + "_face"))[1];
    expect(hi - lo).toBeCloseTo(face6 - lo6, 3);
  });

  test("cuts by prefix without neighbouring chips", () => {
    const art = chipArt(chips, chipPrefix(4, 1));
    // One face, one numeral: a chip that picked up a sibling's parts would
    // draw two numbers on top of each other.
    let faces = 0;
    art.scene.traverse((n) => {
      if ((n as THREE.Mesh).isMesh && n.name.endsWith("_face")) faces++;
    });
    expect(faces).toBe(1);
    expect(subsetByPrefix(chips, chipPrefix(4, 1)).scene.children.length).toBeLessThan(
      art.scene.children.length,
    );
  });
});

describe("where a lake's numbers go on its chip", () => {
  test("two numbers side by side, in order, mirrored about the centre", () => {
    const s = lakeChipSlots(2);
    expect(s).toHaveLength(2);
    expect(s[0].x).toBeLessThan(0);
    expect(s[1].x).toBeCloseTo(-s[0].x, 9);
    expect(s[0].z).toBeCloseTo(s[1].z, 9);
  });

  test("four in two rows of two, read left to right and top to bottom", () => {
    const s = lakeChipSlots(4);
    expect(s).toHaveLength(4);
    // -z is away from the viewer, so the first row is the upper one on screen.
    expect(s[0].z).toBeLessThan(s[2].z);
    expect(s[0].x).toBeLessThan(s[1].x);
    expect(s[2].x).toBeLessThan(s[3].x);
  });

  test("one number keeps a chip's own layout; none has nowhere to go", () => {
    expect(lakeChipSlots(1)).toEqual([{ x: 0, z: 0, k: 1 }]);
    expect(lakeChipSlots(0)).toEqual([]);
  });
});

describe("the composed lake chip", () => {
  const faceOf = (a: LoadedAsset) => box(points(a, "Chip_blank_face"));

  for (const numbers of [
    [4, 10],
    [2, 3, 11, 12],
  ]) {
    const label = numbers.join("-");

    test(`${label}: a whole chip, the size of the socket it sits on`, () => {
      const art = composeLakeChip(chips, numbers);
      expect(materialsOf(art).has(CHIP_BODY_MATERIAL)).toBe(true);
      const b = box(points(art));
      const r = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z);
      // The blank's own radius, scaled: 1.0 is the socket's disc (the tile-art
      // contract), and the keep-clear round it is 1.05 on every tile.
      expect(r).toBeCloseTo(LAKE_CHIP_SCALE, 2);
      expect(LAKE_CHIP_SCALE).toBeLessThanOrEqual(1.1);
    });

    test(`${label}: as tall as every other chip`, () => {
      const [lo, hi] = assetSpanY(composeLakeChip(chips, numbers));
      const [lo6, hi6] = assetSpanY(chipArt(chips, chipPrefix(6, 1)));
      expect(hi - lo).toBeCloseTo(hi6 - lo6, 3);
    });

    test(`${label}: every number's ink lies on the face, clear of the others`, () => {
      const art = composeLakeChip(chips, numbers);
      const face = faceOf(art);
      const faceR = (face.max.x - face.min.x) / 2;
      const inks = numbers.map((n) => box(points(art, chipPrefix(n, 1))));
      for (const [i, ink] of inks.entries()) {
        for (const p of points(art, chipPrefix(numbers[i], 1))) {
          // A little inside the rim, which is its own colour.
          expect(Math.hypot(p.x, p.z), `${numbers[i]}`).toBeLessThan(faceR - 0.05);
        }
        // Printed on the face: its underside just into the face, never below.
        expect(ink.min.y).toBeGreaterThan(face.max.y - 0.02);
        expect(ink.min.y).toBeLessThan(face.max.y);
        for (let j = i + 1; j < inks.length; j++) {
          expect(ink.intersectsBox(inks[j]), `${numbers[i]} vs ${numbers[j]}`).toBe(false);
        }
      }
    });

    test(`${label}: numerals big enough to read at game zoom`, () => {
      const art = composeLakeChip(chips, numbers);
      const one = (a: LoadedAsset, prefix: string) => {
        const b = box(points(a, prefix + "_numeral"));
        return b.max.z - b.min.z;
      };
      for (const n of numbers) {
        const own = one(chipArt(chips, chipPrefix(n, 1)), chipPrefix(n, 1));
        const onLake = one(art, chipPrefix(n, 1));
        // Two numbers keep most of a chip's numeral; four share the face and
        // still keep more than half of it.
        expect(onLake / own).toBeGreaterThan(numbers.length === 2 ? 0.75 : 0.5);
      }
    });

    test(`${label}: each number keeps its own pips`, () => {
      const art = composeLakeChip(chips, numbers);
      for (const n of numbers) {
        const pips = new Set<string>();
        art.scene.traverse((node) => {
          if ((node as THREE.Mesh).isMesh && node.name.startsWith(chipPrefix(n, 1) + "_pip")) {
            pips.add(node.name);
          }
        });
        // 6 - |7 - n| dots, the chip's own probability count.
        expect(pips.size, `${n}`).toBe(6 - Math.abs(7 - n));
      }
    });
  }

  test("numbers without art are left off rather than drawn blank", () => {
    const art = composeLakeChip(chips, [7, 10]);
    expect(points(art, chipPrefix(10, 1)).length).toBeGreaterThan(0);
    expect(points(art, "Chip_07").length).toBe(0);
  });
});
