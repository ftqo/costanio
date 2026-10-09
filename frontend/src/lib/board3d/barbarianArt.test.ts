// The raider, measured off the shipped file.
//
// Pins the facts a layer needs that only the geometry can tell: which way it
// faces, where its feet are, how big it is beside the other pieces, and how
// three fit on one hex without covering the number chip. `layers/raiders.ts`
// and `layers/wagons.ts` draw it, and this file reads their constants.
//
// Read straight from the container like `scenarioArt.test.ts` and
// `knightSwordArt.test.ts`, since the loader needs WebGL. Uses the plain
// copies, because what ships is meshopt-encoded and quantised and these tests
// read float32 accessors. See `src/testGlbFixtures.ts`.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_SCALE, PIECE_SCALE, PIECE_PREFIX, ROBBER_SCALE } from "./pieceArt";
import { RAIDERS_MODELS } from "./loader";
import {
  MUSTER_BEARINGS,
  MUSTER_RADIUS,
  MUSTER_SCALE,
  MUSTER_SHIFT,
  RAIDER_PREFIX,
} from "./layers/raiders";
import { PLAIN_MODELS } from "@/testGlbFixtures";

const MODELS = PLAIN_MODELS;
const FILE = "barbarians.glb";
// The layer's own constant, so a renamed node fails here instead of drawing
// nothing.
const PREFIX = RAIDER_PREFIX;

/**
 * The eight parts, bottom to top, in build order.
 *
 * Every figure on this board is a turned solid with no limbs or face
 * (`Knight_basic` is one mesh; the settler and crew are three), so this one is
 * eight turned parts. The list is pinned so added anatomy shows up here.
 */
const PARTS = [
  "Barbarian_plinth",
  "Barbarian_body",
  "Barbarian_cloak",
  "Barbarian_shoulders",
  "Barbarian_brow",
  "Barbarian_helm",
  "Barbarian_axe_haft",
  "Barbarian_axe_head",
];

interface Gltf {
  nodes: {
    name?: string;
    mesh?: number;
    translation?: number[];
    scale?: number[];
    rotation?: number[];
  }[];
  meshes: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices?: number }[];
  }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  materials?: { name?: string }[];
}

function read(file: string): { gltf: Gltf; bin: Buffer } {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as Gltf;
  // The BIN chunk follows the JSON chunk's 8-byte header + payload.
  const binStart = 20 + jsonLen + 8;
  return { gltf, bin: buf.subarray(binStart) };
}

const doc = read(FILE);

/** Every element of an accessor, as rows of `size` numbers. */
function rows(gltf: Gltf, bin: Buffer, index: number): number[][] {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  expect(size, `unsupported accessor type ${acc.type}`).toBeDefined();
  const width = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
  expect(width, `unsupported componentType ${acc.componentType}`).toBeDefined();
  const stride = view.byteStride ?? width! * size!;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < acc.count; i++) {
    const row: number[] = [];
    for (let c = 0; c < size!; c++) {
      const at = base + i * stride + c * width!;
      row.push(
        acc.componentType === 5126
          ? bin.readFloatLE(at)
          : acc.componentType === 5125
            ? bin.readUInt32LE(at)
            : acc.componentType === 5123
              ? bin.readUInt16LE(at)
              : bin.readUInt8(at),
      );
    }
    out.push(row);
  }
  return out;
}

interface Span {
  lo: [number, number, number];
  hi: [number, number, number];
}

/** The combined bounds of every node named `prefix*`, in the file's own space. */
function span(file: string, prefix: string): Span {
  const { gltf } = file === FILE ? doc : read(file);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = 0;
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? gltf.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    const q = node.rotation ?? [0, 0, 0, 1];
    expect(Math.abs(q[0]) + Math.abs(q[2]), `${name} is tipped, not just turned`).toBeLessThan(
      1e-6,
    );
    found++;
    const t = node.translation ?? [0, 0, 0];
    const s = node.scale ?? [1, 1, 1];
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const acc = gltf.accessors[prim.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], acc.min![i] * s[i] + t[i], acc.max![i] * s[i] + t[i]);
        hi[i] = Math.max(hi[i], acc.min![i] * s[i] + t[i], acc.max![i] * s[i] + t[i]);
      }
    }
  }
  expect(found, `${prefix}: no geometry found in ${file}`).toBeGreaterThan(0);
  return { lo, hi };
}

// --- what the file holds -------------------------------------------------

test("RAIDERS_MODELS names the exported file", () => {
  // `barbarians.glb` must be named somewhere in the source (loader.test.ts),
  // and RAIDERS_MODELS is that name. `toContain` because the constant covers
  // the whole Raiders family, including the rider.
  expect(RAIDERS_MODELS).toContain(FILE);
});

test("has eight named parts with barbarian materials only", () => {
  const { gltf } = doc;
  const named = gltf.nodes
    .filter((n) => n.mesh !== undefined)
    .map((n) => n.name ?? gltf.meshes[n.mesh!].name);
  expect([...named].sort()).toEqual([...PARTS].sort());

  const materials = (gltf.materials ?? []).map((m) => m.name ?? "");
  // Four materials. Seat figures wear the three `Seat_*` slots, but a raider
  // belongs to nobody, so it uses four flat colours: near-black leather
  // (plinth, brow, cloak, haft), mid iron (body, shoulders), dark iron (helm)
  // and pale steel (axe only).
  expect(materials.length).toBe(4);
  for (const name of materials)
    expect(name, `${name} is not a barbarian material`).toMatch(/^Mat_Barbarian_/);
  // No seat slot exists in the file at all (loader.test.ts checks per mesh).
  expect(materials.filter((n) => n.startsWith("Seat_"))).toEqual([]);
});

test("every face is flat shaded", () => {
  // Flat shading: each face owns its vertices, so a triangle's three normals
  // match. Measured from the data rather than trusting `use_smooth`.
  const { gltf, bin } = doc;
  let triangles = 0;
  for (const mesh of gltf.meshes) {
    for (const prim of mesh.primitives) {
      const normals = rows(gltf, bin, prim.attributes.NORMAL);
      const index = rows(gltf, bin, prim.indices!).map((r) => r[0]);
      expect(index.length % 3, `${mesh.name} has a partial triangle`).toBe(0);
      for (let i = 0; i < index.length; i += 3) {
        triangles++;
        const [a, b, c] = [normals[index[i]], normals[index[i + 1]], normals[index[i + 2]]];
        for (let k = 0; k < 3; k++) {
          expect(a[k], `${mesh.name} triangle ${i / 3} is smooth shaded`).toBeCloseTo(b[k], 5);
          expect(a[k], `${mesh.name} triangle ${i / 3} is smooth shaded`).toBeCloseTo(c[k], 5);
        }
      }
    }
  }
  // 132 authored faces triangulate to this (the house budget is 100-250 faces
  // per piece). Pinned so a change to the figure must update it. The horns
  // are part of `Barbarian_helm`, so the figure is still eight parts.
  expect(triangles).toBe(352);
});

// --- how it stands -------------------------------------------------------

test("stands on y = 0", () => {
  // For `seating.ts`. Settlements, roads, chips and camels start at 0.25
  // (modelled on a tile); knights, walls, ships, the merchant and this start at
  // 0, so `seat(..., surface, assetBaseY, scale)` puts it on `surface`.
  //
  // Below zero is checked exactly, since a dip sinks every copy. Above zero is
  // checked to 1e-4, because the plain copy is dequantised from the shipped
  // file and the plinth comes back 7.2e-6 high.
  const base = span(FILE, PREFIX).lo[1];
  expect(base, "a part dips below the ground plane").toBeGreaterThanOrEqual(0);
  expect(base, "the figure floats above it").toBeLessThan(1e-4);
});

test("faces +x", () => {
  // Raiders and Wagons need a front. Wagons stands one across a road edge, and
  // `edgeRotationY` derives only an axis from an Edge (an unordered vertex
  // pair), so placement alone faces backwards on about half the edges.
  //
  // Three parts show the front: the cloak is wholly behind, the helm juts
  // forward of the plinth (the column leans), and the axe is on the front half.
  const cloak = span(FILE, "Barbarian_cloak");
  expect(cloak.hi[0], "cloak max x").toBeLessThan(0);

  const plinth = span(FILE, "Barbarian_plinth");
  const helm = span(FILE, "Barbarian_helm");
  const mid = (s: Span) => (s.lo[0] + s.hi[0]) / 2;
  expect(mid(helm), "helm centre x vs plinth").toBeGreaterThan(mid(plinth));

  expect(span(FILE, "Barbarian_axe_head").lo[0], "axe head min x").toBeGreaterThan(0);
});

test("the axe and the cloak hang on opposite sides of the body", () => {
  // One prop held clear of the mass, like the knight's sword and the rider's
  // lance, makes the figure deeper (0.599) than wide (0.449) and readable at
  // 56 degrees. glTF is y-up, so the blend's y (where the axe swings out) is z
  // here, sign flipped.
  const axe = span(FILE, "Barbarian_axe_head");
  const cloak = span(FILE, "Barbarian_cloak");
  expect(axe.lo[2] * axe.hi[2], "axe head z span").toBeGreaterThan(0);
  expect(cloak.lo[2] * cloak.hi[2], "cloak z span").toBeLessThan(0);
  const whole = span(FILE, PREFIX);
  expect(whole.hi[2] - whole.lo[2]).toBeGreaterThan(whole.hi[0] - whole.lo[0]);
});

test("authored envelope matches the pinned size", () => {
  // The figure is modelled by hand in Blender (see `art/README.md`), so these
  // are measured off the export and nothing else checks them.
  //
  // glTF y-up: the blend's (x, y, z) is (x, z, -y).
  const { lo, hi } = span(FILE, PREFIX);
  expect(hi[1] - lo[1], "height").toBeCloseTo(0.92, 4);
  expect(hi[0] - lo[0], "depth").toBeCloseTo(0.4488, 3);
  // The horns reach 0.312 either side of the helm.
  expect(hi[2] - lo[2], "width").toBeCloseTo(0.6731, 3);
  // As a comparison, so it survives a retune.
  expect(hi[1] - lo[1], "height under 1.0").toBeLessThan(1.0);
  expect(hi[0] - lo[0]).toBeLessThan(0.49);
  expect(hi[2] - lo[2]).toBeLessThan(0.772);
});

// --- how big it is drawn -------------------------------------------------
//
// Reads `MODULE_SCALE.raider`, the constant `layers/raiders.ts` draws with.
//
// `raider`, not `barbarian`: `MODULE_SCALE.barbarian` is the Knights fleet
// marker (`Ship_barbarian` in ships.glb), and both appear when Knights and
// Raiders are combined.
const RECOMMENDED_SCALE = MODULE_SCALE.raider;

test("drawn taller than a knight and shorter than the robber", () => {
  // A raider must be taller than a knight (it is what knights muster against)
  // and shorter than the robber, the board's one landmark-sized neutral.
  // Measured against both so a restyle of either moves this.
  const height = (s: Span) => s.hi[1] - s.lo[1];
  const barbarian = height(span(FILE, PREFIX)) * RECOMMENDED_SCALE;
  const knight = height(span("knights.glb", "Knight_basic")) * MODULE_SCALE.knight;
  const robber = height(span("pieces.glb", "Robber_")) * ROBBER_SCALE;
  const settlement = height(span("pieces.glb", PIECE_PREFIX.settlement)) * PIECE_SCALE.settlement;

  expect(barbarian, "raider vs knight height").toBeGreaterThan(knight);
  expect(barbarian, "raider vs settlement height").toBeGreaterThan(settlement);
  expect(barbarian, "raider vs robber height").toBeLessThan(robber);
});

// --- three on one hex ----------------------------------------------------
//
// The muster: `layers/raiders.ts` stands up to three barbarians on one coastal
// hex as a splayed triangle (a row reads as one long object at this angle, a
// stack as a tower). The numbers come from `render_barbarians.py` and are
// imported, so this measures what the board draws.
//
// They are in the tile's authored frame, which the layer turns twice to reach
// world space (see `tileFrameToWorld`). The chip position is in the same
// frame, so the turns cancel and are not applied here.

// The number chip's mount and the disc that must stay clear of art, from
// `tools/blender/hexcontract.py`, in Blender coordinates (the muster's frame).
const CHIP_AT: [number, number] = [0.0, 1.5];
const CHIP_KEEP_CLEAR = 1.05;
// Hex circumradius 3.0, so this is the apothem art must stay inside.
const TILE_APOTHEM = (3.0 * Math.sqrt(3)) / 2;

/** Distance from `point` to a box `[lo,hi]` centred at `at` and turned `yaw`. */
function distanceToBox(
  point: [number, number],
  at: [number, number],
  yawDeg: number,
  lo: [number, number],
  hi: [number, number],
): number {
  const a = (-yawDeg * Math.PI) / 180;
  const dx = point[0] - at[0];
  const dy = point[1] - at[1];
  // Into the box's own frame, then clamp: the nearest point of an oriented box
  // to an outside point is the clamp of that point into its extents.
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const cx = Math.min(Math.max(lx, lo[0]), hi[0]);
  const cy = Math.min(Math.max(ly, lo[1]), hi[1]);
  return Math.hypot(lx - cx, ly - cy);
}

test("three fit on a hex clear of the number chip", () => {
  // The chip mounts at (0, +1.5) with a 1.05 keep-clear. A triangle centred on
  // the hex puts the northern figure's axe inside it, so MUSTER_SHIFT pushes
  // the group south.
  const { lo, hi } = span(FILE, PREFIX);

  let nearestChip = Infinity;
  let furthestOut = 0;
  for (const [k, bearing] of MUSTER_BEARINGS.entries()) {
    // Each slot at its own size: the third figure stands taller (MUSTER_SCALE).
    const scale = RECOMMENDED_SCALE * (MUSTER_SCALE[k] ?? 1);
    // Back into Blender's frame: blender x is glTF x, blender y is -glTF z.
    const footLo: [number, number] = [lo[0] * scale, -hi[2] * scale];
    const footHi: [number, number] = [hi[0] * scale, -lo[2] * scale];
    const a = (bearing * Math.PI) / 180;
    const at: [number, number] = [
      MUSTER_SHIFT[0] + MUSTER_RADIUS * Math.cos(a),
      MUSTER_SHIFT[1] + MUSTER_RADIUS * Math.sin(a),
    ];
    nearestChip = Math.min(nearestChip, distanceToBox(CHIP_AT, at, bearing, footLo, footHi));
    // The far corner of the turned footprint, as a radius from the hex centre.
    for (const cx of [footLo[0], footHi[0]]) {
      for (const cy of [footLo[1], footHi[1]]) {
        const wx = at[0] + cx * Math.cos(a) - cy * Math.sin(a);
        const wy = at[1] + cx * Math.sin(a) + cy * Math.cos(a);
        furthestOut = Math.max(furthestOut, Math.hypot(wx, wy));
      }
    }
  }
  expect(nearestChip, "muster distance to chip").toBeGreaterThan(CHIP_KEEP_CLEAR);
  expect(furthestOut, "muster reach from hex centre").toBeLessThan(TILE_APOTHEM);
  // Pinned margins. At scale 1.7
  // the nearest figure is 1.186 from the chip (0.136 outside the keep-clear).
  // The third figure at 1.3x (MUSTER_SCALE) is the slot furthest from the chip.
  // With the helm's horns the muster reaches 1.815 from the centre, 0.78
  // inside the tile's edge; the horns point away from the chip.
  expect(nearestChip).toBeCloseTo(1.186, 2);
  expect(furthestOut).toBeCloseTo(1.815, 2);
});
