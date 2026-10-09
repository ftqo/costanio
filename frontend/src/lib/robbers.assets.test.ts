// Keeps the halves of a robber skin together: a row in cosmetics/catalog.go,
// an entry in ROBBERS, and the model under public/models/robbers/. A missing
// half otherwise shows up late, as a blank store card or a purchased skin
// falling back to the stock robber.
//
// A chroma is a design in another colourway: it names its design's file and
// carries three colours instead of geometry.
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROBBERS } from "./robbers";
import { ROBBER_PREFIX, STOCK_ROBBER_FILE } from "./board3d/layers/robber";
import { PLAIN_MODELS } from "@/testGlbFixtures";

const PUBLIC = join(__dirname, "..", "..", "public");

test("every robber skin has its model", () => {
  const missing: string[] = [];
  for (const [id, r] of Object.entries(ROBBERS)) {
    if (!existsSync(join(PUBLIC, "models", r.file))) missing.push(`${id} -> models/${r.file}`);
  }
  expect(missing).toEqual([]);
});

// A chroma costs no download; one with its own mesh would be a design under a
// chroma's id.
test("a chroma reuses its design's model and carries its own colours", () => {
  for (const [id, skin] of Object.entries(ROBBERS)) {
    const design = id.split(".").slice(0, 2).join(".");
    if (design === id) continue; // a design, not a chroma
    expect(ROBBERS[design], `${id} names a design that exists`).toBeTruthy();
    expect(skin.file, `${id} shares its design's model`).toBe(ROBBERS[design].file);
    expect(skin.colors, `${id} carries its own colours`).toBeTruthy();
  }
});

/**
 * The extents of the `Robber_*` nodes in a glb, in the model's own units.
 *
 * Reads the uncompressed copy from src/testGlbFixtures.ts (as
 * pieceFacing.test.ts does): the shipped file is meshopt-quantised, so its
 * accessor min/max are grid units. Accessor min/max suffice because the nodes
 * are neither tipped nor yawed, so the box transforms by translation and scale
 * only.
 */
function robberExtents(file: string): { height: number; width: number } {
  const buf = readFileSync(join(PLAIN_MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const node of gltf.nodes ?? []) {
    if (typeof node.name !== "string" || !node.name.startsWith(ROBBER_PREFIX)) continue;
    if (node.mesh === undefined) continue;
    const t = node.translation ?? [0, 0, 0];
    const s = node.scale ?? [1, 1, 1];
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const acc = gltf.accessors[prim.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], acc.min[i] * s[i] + t[i]);
        hi[i] = Math.max(hi[i], acc.max[i] * s[i] + t[i]);
      }
    }
  }
  expect(Number.isFinite(lo[1]), `${file} has no ${ROBBER_PREFIX}* nodes`).toBe(true);
  return { height: hi[1] - lo[1], width: Math.max(hi[0] - lo[0], hi[2] - lo[2]) };
}

/**
 * The stock robber's envelope, measured off the shipped art. flip.ts's lift
 * and markerMotion's bounds are solved against these numbers, so a re-export
 * that changes the size fails here.
 */
const STOCK = { height: 1.5, width: 0.9 };

/**
 * The band a skin must fit, taken from `tools/blender/test_robber_designs.py`.
 * That test measures the design function; this one measures the exported
 * bytes.
 *
 * The height band is wide at the bottom: a squat design (the keg) is fine.
 * What matters is height (flip.ts's lift is computed against 1.5, and a taller
 * piece turns through its tile) and width (past ~0.52 radius it overhangs the
 * number chip).
 */
const HEIGHT_MIN = 1.15;
const HEIGHT_MAX = 1.6;
/** Diameter cap, from the 0.52 radius clearance against the chip. */
const WIDTH_MAX = 1.04;

test("the stock robber still measures what the contract says it does", () => {
  const { height, width } = robberExtents(STOCK_ROBBER_FILE);
  expect(height).toBeCloseTo(STOCK.height, 1);
  expect(width).toBeCloseTo(STOCK.width, 1);
});

// Taller than stock clips through the tile during the flip (CHIP_FLIP_LIFT is
// computed from these dimensions); wider overhangs the number chip.
test("every robber skin fits the stock robber's envelope", () => {
  for (const [id, r] of Object.entries(ROBBERS)) {
    const { height, width } = robberExtents(r.file);
    expect(height, `${id} height`).toBeGreaterThanOrEqual(HEIGHT_MIN);
    expect(height, `${id} height`).toBeLessThanOrEqual(HEIGHT_MAX);
    expect(width, `${id} width`).toBeLessThanOrEqual(WIDTH_MAX);
  }
});
