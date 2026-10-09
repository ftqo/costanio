// The two merchant stalls, measured off the shipped files.
//
// `trader.glb` ships and draws; `trader_v2.glb` is a rebuild in the house
// style, exported for side-by-side review and wired to nothing (see
// `TRADER_CANDIDATE` in loader.ts). One goes when somebody picks.
//
// Of the pair: are they two separate pieces, with no export swallowing the
// other's parts. Of the candidate: does it meet the shipped stall's contract
// (base at zero, standing on a hex centre at `MODULE_SCALE.merchant`, clear of
// the number chip's socket).
//
// Read straight from the GLB, as `scenarioArt.test.ts` and `cargoArt.test.ts` do,
// since the loader needs WebGL.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_SCALE } from "./pieceArt";
import { TRADER_CANDIDATE, boardModelFiles } from "./loader";
import { MERCHANT_PREFIX } from "./layers/knights";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies: the shipped files are meshopt-encoded. See
// testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

const SHIPPED = "trader.glb";
const CANDIDATE = "trader_v2.glb";
const CANDIDATE_PREFIX = "Trader2_merchant";

// The number chip's mount and keep-clear disc, from
// `tools/blender/hexcontract.py`, in Blender coordinates. A merchant stands on
// the hex centre, so the mount is also its offset from the piece.
const CHIP_AT: [number, number] = [0.0, 1.5];
const CHIP_KEEP_CLEAR = 1.05;

interface Gltf {
  nodes: { name?: string; mesh?: number; translation?: number[]; scale?: number[] }[];
  meshes: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices: number; material?: number }[];
  }[];
  materials?: { name?: string }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

function open(file: string): { json: Gltf; buf: Buffer; binAt: number } {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as Gltf;
  return { json, buf, binAt: 20 + jsonLen + 8 };
}

function nodesOf(g: { json: Gltf }, prefix: string) {
  return g.json.nodes.filter((n) => {
    if (n.mesh === undefined) return false;
    const name = n.name ?? g.json.meshes[n.mesh].name;
    return typeof name === "string" && name.startsWith(prefix);
  });
}

/**
 * Every vertex of every node named `prefix*`, in the file's own space. For
 * these two that is also the drawn frame up to `MODULE_SCALE.merchant` (hex
 * centre, no turn). glTF is Y-up, so the blend's +y (toward the chip) is -z.
 */
function points(file: string, prefix: string): [number, number, number][] {
  const g = open(file);
  const out: [number, number, number][] = [];
  for (const node of nodesOf(g, prefix)) {
    const t = (node.translation ?? [0, 0, 0]) as [number, number, number];
    const s = (node.scale ?? [1, 1, 1]) as [number, number, number];
    for (const prim of g.json.meshes[node.mesh!].primitives) {
      const acc = g.json.accessors[prim.attributes.POSITION];
      expect(acc.componentType, `${file} is not plain float32`).toBe(5126);
      const view = g.json.bufferViews[acc.bufferView];
      const stride = view.byteStride ?? 12;
      const base = g.binAt + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) {
        const at = base + i * stride;
        out.push([
          g.buf.readFloatLE(at) * s[0] + t[0],
          g.buf.readFloatLE(at + 4) * s[1] + t[1],
          g.buf.readFloatLE(at + 8) * s[2] + t[2],
        ]);
      }
    }
  }
  expect(out.length, `${prefix}: no vertices in ${file}`).toBeGreaterThan(0);
  return out;
}

function span(file: string, prefix: string) {
  const p = points(file, prefix);
  const lo = [0, 1, 2].map((i) => Math.min(...p.map((v) => v[i]))) as [number, number, number];
  const hi = [0, 1, 2].map((i) => Math.max(...p.map((v) => v[i]))) as [number, number, number];
  return { lo, hi };
}

function materialsOf(file: string, prefix: string): string[] {
  const g = open(file);
  const out = new Set<string>();
  for (const node of nodesOf(g, prefix)) {
    for (const prim of g.json.meshes[node.mesh!].primitives) {
      if (prim.material === undefined) continue;
      const name = g.json.materials?.[prim.material]?.name;
      if (name) out.add(name);
    }
  }
  return [...out].sort();
}

function triangles(file: string, prefix: string): number {
  const g = open(file);
  let total = 0;
  for (const node of nodesOf(g, prefix)) {
    for (const prim of g.json.meshes[node.mesh!].primitives) {
      total += g.json.accessors[prim.indices].count / 3;
    }
  }
  return total;
}

// --- the pair -------------------------------------------------------------

test("the two stalls are two pieces, and neither prefix reaches the other", () => {
  // `subsetByPrefix` and the exporter cut on a string, so `Trader_v2_*` would
  // be picked up by every `Trader_` call site and draw two stalls in one spot.
  // Hence `Trader2_merchant`, which shares no prefix with `Trader_merchant`.
  expect(CANDIDATE_PREFIX.startsWith(MERCHANT_PREFIX)).toBe(false);
  expect(MERCHANT_PREFIX.startsWith(CANDIDATE_PREFIX)).toBe(false);
  expect(nodesOf(open(SHIPPED), CANDIDATE_PREFIX)).toHaveLength(0);
  expect(nodesOf(open(CANDIDATE), MERCHANT_PREFIX)).toHaveLength(0);
  expect(nodesOf(open(CANDIDATE), CANDIDATE_PREFIX).length).toBeGreaterThan(0);
});

test("the candidate is not fetched by any board", () => {
  // Named, because `loader.test.ts` fails any model in public/models that no
  // source names. Fetched by nothing, so no ruleset downloads it until someone
  // picks between the stalls.
  expect(TRADER_CANDIDATE).toBe(CANDIDATE);
  for (const ruleset of [
    "base",
    "base+cak",
    "base+islands+cak+caravans+fishermen+raiders+wagons+explorers+rivers",
  ]) {
    expect(boardModelFiles(ruleset), ruleset).not.toContain(CANDIDATE);
    expect(boardModelFiles(ruleset), ruleset).toContain(SHIPPED);
  }
});

// --- the candidate --------------------------------------------------------

test("the candidate stands on y = 0, the plane a hex-centre piece starts at", () => {
  // `seatY` solves `surface = y + scale * baseY` with `assetBaseY` read off the
  // art. Both stalls are authored on the origin, so both start at zero.
  expect(span(SHIPPED, MERCHANT_PREFIX).lo[1]).toBeCloseTo(0, 4);
  expect(span(CANDIDATE, CANDIDATE_PREFIX).lo[1]).toBeCloseTo(0, 4);
});

test("the candidate is a stall at a knight's height, not a landmark", () => {
  // The shipped stall draws 1.63 tall at `MODULE_SCALE.merchant`: half again a
  // drawn knight (0.55 x 2.0 = 1.10) and four fifths of a city, for a neutral
  // marker. The candidate is 1.095, level with a knight. Banded rather than
  // pinned.
  const drawn = (file: string, prefix: string) => {
    const { lo, hi } = span(file, prefix);
    return (hi[1] - lo[1]) * MODULE_SCALE.merchant;
  };
  expect(drawn(SHIPPED, MERCHANT_PREFIX)).toBeGreaterThan(1.5);
  expect(drawn(CANDIDATE, CANDIDATE_PREFIX)).toBeGreaterThan(0.95);
  expect(drawn(CANDIDATE, CANDIDATE_PREFIX)).toBeLessThan(1.25);
});

test("the candidate keeps clear of the number chip on the hex it stands on", () => {
  // A merchant is placed at `hexToWorld(hex)` (`planMerchant`), and that hex's
  // chip mounts 1.5 away with a 1.05 keep-clear. Art under a chip is an
  // occlusion no camera angle fixes.
  //
  // Per vertex, since the box's nearest corner is not the piece's nearest point
  // and that difference is most of the margin. glTF is Y-up: the blend's +y is
  // -z.
  const s = MODULE_SCALE.merchant;
  const nearest = (file: string, prefix: string) =>
    Math.min(
      ...points(file, prefix).map((v) => Math.hypot(v[0] * s - CHIP_AT[0], -v[2] * s - CHIP_AT[1])),
    );
  expect(nearest(CANDIDATE, CANDIDATE_PREFIX)).toBeGreaterThan(CHIP_KEEP_CLEAR);

  // Contrast: the shipped stall does not clear it, so scaling the original
  // down would not be enough.
  expect(nearest(SHIPPED, MERCHANT_PREFIX)).toBeLessThan(CHIP_KEEP_CLEAR);
});

test("the candidate is five warm values and no seat slot", () => {
  // A small warm set, one accent, nothing tinted. The stall changes hands with
  // the hex it stands on, so a seat slot would be wrong (the shipped one has
  // none either).
  const mats = materialsOf(CANDIDATE, CANDIDATE_PREFIX);
  expect(mats).toEqual([
    "Mat_Trader2_canopy_a",
    "Mat_Trader2_canopy_b",
    "Mat_Trader2_frame",
    "Mat_Trader2_goods",
    "Mat_Trader2_trim",
  ]);
  expect(mats.some((m) => m.startsWith("Seat_"))).toBe(false);
  // The shipped one has ten, which is hard to restyle.
  expect(materialsOf(SHIPPED, MERCHANT_PREFIX)).toHaveLength(10);
});

test("the candidate is inside the low-poly budget and flat-shaded throughout", () => {
  // House style is 100-250 authored faces; 113 here against the shipped 372.
  // Counted as triangles, what the exporter writes and the GPU pays for.
  expect(triangles(CANDIDATE, CANDIDATE_PREFIX)).toBeLessThan(280);
  expect(triangles(CANDIDATE, CANDIDATE_PREFIX)).toBeLessThan(triangles(SHIPPED, MERCHANT_PREFIX));

  // Flat shading survives into glTF as per-triangle normals (the exporter
  // splits vertices), so a triangle's three normals match. One smoothed polygon
  // catches the light differently from the rest.
  const g = open(CANDIDATE);
  let checked = 0;
  for (const node of nodesOf(g, CANDIDATE_PREFIX)) {
    for (const prim of g.json.meshes[node.mesh!].primitives) {
      const nAcc = g.json.accessors[prim.attributes.NORMAL];
      const nView = g.json.bufferViews[nAcc.bufferView];
      const nStride = nView.byteStride ?? 12;
      const nBase = g.binAt + (nView.byteOffset ?? 0) + (nAcc.byteOffset ?? 0);
      const normal = (i: number) =>
        [0, 1, 2].map((k) => g.buf.readFloatLE(nBase + i * nStride + k * 4));

      const iAcc = g.json.accessors[prim.indices];
      const iView = g.json.bufferViews[iAcc.bufferView];
      const iBase = g.binAt + (iView.byteOffset ?? 0) + (iAcc.byteOffset ?? 0);
      const width = iAcc.componentType === 5123 ? 2 : 4;
      const index = (i: number) =>
        width === 2 ? g.buf.readUInt16LE(iBase + i * 2) : g.buf.readUInt32LE(iBase + i * 4);

      for (let t = 0; t < iAcc.count; t += 3) {
        checked++;
        const [a, b, c] = [index(t), index(t + 1), index(t + 2)];
        const na = normal(a);
        for (const other of [normal(b), normal(c)]) {
          for (let k = 0; k < 3; k++) {
            expect(other[k], `${node.name} tri ${t / 3} is smooth`).toBeCloseTo(na[k], 5);
          }
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(100);
});
