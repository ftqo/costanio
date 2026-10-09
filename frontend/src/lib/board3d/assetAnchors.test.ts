// Every exported asset must be centred on its own anchor.
//
// The blend is a showcase board (Hex_Forest on hex (-2, 1), Settlement_A on
// one of its vertices, chips on a staging grid). Each layer computes a world
// position and instances the art there, so art exported at its authoring
// position would land at `authored offset + computed position`.
// tools/blender/anchors.py moves each item onto the origin at export; this
// checks it stayed that way.
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type * as THREE from "three";
import { TILES, HEX_SIZE } from "./manifest.generated";
import { beachStripGeometry, beachConnectorGeometry, type SandKind } from "./beachGeometry";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies: what ships is meshopt-compressed, and this parses the
// container. See src/testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

type Vec3 = [number, number, number];
type Mat4 = number[]; // column-major, as glTF stores them

interface Node {
  name: string;
  translation: Vec3;
  /** World-space corners of this node's geometry, if it has any. */
  corners: Vec3[];
  children: Node[];
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return out;
}

/** glTF TRS -> matrix. Rotation is a quaternion [x, y, z, w]. */
function trs(t: Vec3, q: number[], s: Vec3): Mat4 {
  const [x, y, z, w] = q;
  const [sx, sy, sz] = s;
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

function apply(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Parse a .glb's JSON chunk into a node tree with world-space geometry. */
function readGlb(file: string): Node[] {
  const buf = readFileSync(join(MODELS, file));
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

  const build = (index: number, parent: Mat4): Node => {
    const n = gltf.nodes[index];
    // Some nodes are rotated (Chip_09_1_body is turned 180 degrees, and the
    // Z-up to Y-up conversion leaves a quarter turn on some empties), so the
    // bounds need the whole transform.
    const local: Mat4 =
      n.matrix ?? trs(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]);
    const world = multiply(parent, local);

    const corners: Vec3[] = [];
    if (n.mesh !== undefined) {
      for (const prim of gltf.meshes[n.mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        if (!acc.min) continue;
        for (let bit = 0; bit < 8; bit++) {
          const p: Vec3 = [
            bit & 1 ? acc.max[0] : acc.min[0],
            bit & 2 ? acc.max[1] : acc.min[1],
            bit & 4 ? acc.max[2] : acc.min[2],
          ];
          corners.push(apply(world, p));
        }
      }
    }
    return {
      name: n.name,
      translation: [world[12], world[13], world[14]],
      corners,
      children: (n.children ?? []).map((c: number) => build(c, world)),
    };
  };

  const scene = gltf.scenes[gltf.scene ?? 0];
  return scene.nodes.map((i: number) => build(i, IDENTITY));
}

function flatten(nodes: Node[]): Node[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** XZ centre of the bounding box of every mesh under `nodes`. */
function xzCenter(nodes: Node[]): [number, number] {
  const pts = flatten(nodes).flatMap((n) => n.corners);
  expect(pts.length, "no geometry to measure").toBeGreaterThan(0);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[2]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
}

test("every tile's hex sits on the origin", () => {
  // The layer instances a tile at hexToWorld(hex), so the hex slab must be
  // centred there. An offset shifts a whole terrain type.
  for (const entry of Object.values(TILES)) {
    const roots = readGlb(entry.file);
    expect(roots.length, `${entry.file} should export one hex root`).toBe(1);
    const [x, , z] = roots[0].translation;
    expect(x, `${entry.file} root x`).toBeCloseTo(0, 4);
    expect(z, `${entry.file} root z`).toBeCloseTo(0, 4);
  }
});

test("every number chip is centred", () => {
  // planChips places a chip at tileCentre + socket. A chip still at its
  // staging-grid position lands far out in the water.
  const roots = readGlb("chips.glb");
  expect(roots.length).toBeGreaterThan(10);
  for (const root of roots) {
    const [x, , z] = root.translation;
    expect(x, `${root.name} x`).toBeCloseTo(0, 4);
    expect(z, `${root.name} z`).toBeCloseTo(0, 4);
  }
});

test("every number chip has the same thickness", () => {
  // Board3D measures chip height from the art once per (number, variant) group
  // and keeps the last group's answer, used as the robber's standing height
  // and the flip axis. The groups present depend on the board's numbers, which
  // the Inventor changes mid-game, so every chip must be the same thickness
  // (0.19) or a swap would move the robber and the flip plane.
  const spans = new Map<string, [number, number]>();
  for (const root of readGlb("chips.glb")) {
    const chip = /^(Chip_\d\d_\d)/.exec(root.name)?.[1];
    if (!chip) continue;
    const ys = flatten([root]).flatMap((n) => n.corners.map((c) => c[1]));
    if (!ys.length) continue;
    const [lo, hi] = spans.get(chip) ?? [Infinity, -Infinity];
    spans.set(chip, [Math.min(lo, ...ys), Math.max(hi, ...ys)]);
  }
  expect(spans.size).toBeGreaterThan(10);
  for (const [chip, [lo, hi]] of spans) {
    expect(hi - lo, `${chip} thickness`).toBeCloseTo(0.19, 4);
  }
});

test("each piece family straddles the origin", () => {
  // Buildings and roads were modelled in place with the object origin at the
  // world origin, so the anchor is in the geometry; measure the bounding box.
  // subsetByPrefix pulls out each family, so each is centred independently.
  const roots = readGlb("pieces.glb");
  for (const prefix of ["Settlement_A", "City_A", "Road_A", "Road_B"]) {
    const family = roots.filter((n) => n.name.startsWith(prefix));
    expect(family.length, `${prefix} missing from pieces.glb`).toBeGreaterThan(0);
    const [x, z] = xzCenter(family);
    expect(x, `${prefix} x`).toBeCloseTo(0, 2);
    expect(z, `${prefix} z`).toBeCloseTo(0, 2);
  }
});

/** World-space bounding box of a shipped node's geometry, rounded. */
function shippedBox(node: Node): number[] {
  const pts = flatten([node]).flatMap((n) => n.corners);
  expect(pts.length, `${node.name} has no geometry`).toBeGreaterThan(0);
  return [0, 1, 2].flatMap((axis) => [
    round(Math.min(...pts.map((p) => p[axis]))),
    round(Math.max(...pts.map((p) => p[axis]))),
  ]);
}

/** The same box for a geometry the renderer builds, for comparison. */
function builtBox(geo: THREE.BufferGeometry): number[] {
  const pos = geo.getAttribute("position");
  return [0, 1, 2].flatMap((axis) => {
    const vals = Array.from({ length: pos.count }, (_, i) => pos.getComponent(i, axis));
    return [round(Math.min(...vals)), round(Math.max(...vals))];
  });
}

const round = (v: number): number => Math.round(v * 1e3) / 1e3;

test("the shipped beach matches the renderer", () => {
  // beachGeometry.ts generates the coastline now. beach.glb still supplies
  // Mat_Shore_sand and Mat_Shore_wetsand, which the generated geometry borrows
  // so palette.json keeps the colour. tools/blender/lattice.py builds the same
  // cross-section from the same constants, and this checks the two still agree.
  const strips = readGlb("beach.glb").filter((n) => n.name.startsWith("Beach_canonical"));
  expect(strips.length, "beach.glb should carry a dry and a wet strip").toBe(2);
  for (const strip of strips) {
    const kind: SandKind = strip.name.endsWith("_wet") ? "wet" : "dry";
    expect(shippedBox(strip), `${strip.name} has drifted from beachStripGeometry`).toEqual(
      builtBox(beachStripGeometry(kind)),
    );
  }
});

test("the beach connector matches the renderer's corner wedge", () => {
  const wedges = readGlb("beach.glb").filter((n) => n.name.startsWith("Connector_beach"));
  expect(wedges.length).toBe(2);
  for (const wedge of wedges) {
    const kind: SandKind = wedge.name.endsWith("_wet") ? "wet" : "dry";
    expect(shippedBox(wedge), `${wedge.name} has drifted from beachConnectorGeometry`).toEqual(
      builtBox(beachConnectorGeometry(kind)),
    );
  }
  // And it sits out at the corner, not near the hex centre.
  const [x, z] = xzCenter(wedges);
  expect(Math.hypot(x, z), "the wedge sits out near corner 0").toBeGreaterThan(HEX_SIZE / 2);
});

test("the robber is centred on its tile", () => {
  // planRobber places it at hexToWorld(tile), so it must be centred rather than
  // staged on the desert's chip socket, or it lands on the number chip.
  const [x, z] = xzCenter(readGlb("pieces.glb").filter((n) => n.name.startsWith("Robber_")));
  expect(x).toBeCloseTo(0, 2);
  expect(z).toBeCloseTo(0, 2);
});

test("city-improvement props sit on the origin at their size", () => {
  // Not instanced: these three are only photographed for shop tiles
  // (lib/board3d/thumbnail.ts SHOP_SHOTS), so no anchor rule moves them (see
  // tools/blender/anchors.py). They must still be authored on the origin,
  // standing on z = 0, inside a shared footprint, so the three tiles appear at
  // the same scale.
  //
  // Skipped until the blend is re-exported; thumbnail.test.ts's PENDING_EXPORT
  // fails once the file lands.
  const file = "improvements.glb";
  if (!existsSync(join(MODELS, file))) return;
  const roots = readGlb(file);
  for (const prefix of ["Improve_Science", "Improve_Trade", "Improve_Politics"]) {
    const family = roots.filter((n) => n.name.startsWith(prefix));
    expect(family.length, `${prefix} missing from ${file}`).toBeGreaterThan(0);
    const [x, z] = xzCenter(family);
    expect(x, `${prefix} x`).toBeCloseTo(0, 1);
    expect(z, `${prefix} z`).toBeCloseTo(0, 1);
    const pts = flatten(family).flatMap((n) => n.corners);
    const span = (axis: number) =>
      Math.max(...pts.map((p) => p[axis])) - Math.min(...pts.map((p) => p[axis]));
    // Y is up after the glTF conversion; the base sits on the ground plane.
    expect(Math.min(...pts.map((p) => p[1])), `${prefix} base`).toBeCloseTo(0, 1);
    expect(Math.max(span(0), span(2)), `${prefix} footprint`).toBeLessThanOrEqual(0.7);
    expect(span(1), `${prefix} height`).toBeGreaterThan(0.3);
    expect(span(1), `${prefix} height`).toBeLessThanOrEqual(0.7);
  }
});
