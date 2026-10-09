// The Raiders rider, measured off the shipped file.
//
// Pins facing, ground plane, size and seat slots in the art itself, so a layer
// is never tuned to compensate for an unmeasured defect. Same approach as
// `scenarioArt.test.ts` (camel, waypost, weir).
//
// Read straight from the GLB, like `scenarioArt.test.ts`, `knightSwordArt.test.ts`
// and `pieceFacing.test.ts`: the loader needs WebGL and the geometry doesn't.
// Node transforms are applied because the export writes placement as a
// transform.
//
// glTF is Y-up and Blender Z-up: Blender (x, y, z) maps to (x, z, -y). So
// height is y, across the edge is z, and Blender +y comes back at -z.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { newGLTFLoader, boardModelFiles } from "./loader";
import { MODULE_SCALE, PIECE_PREFIX, PIECE_SCALE } from "./pieceArt";
import { RIDER_PREFIX as SHIPPED_RIDER_PREFIX } from "./layers/raiders";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies, not the shipped ones: what ships is meshopt-encoded and
// this file parses the container. See testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

const RIDERS = "riders.glb";

/** The prefix every part of the piece shares, and that a layer would cut on. */
const RIDER_PREFIX = "Rider_";

/**
 * The ten parts, named. Flat siblings with one shared origin: unlike the
 * knight's sword (a child, so `anchors` recentres the pair together), nothing
 * here rides along with anything else.
 */
const PARTS = [
  "Rider_helm",
  "Rider_horse_body",
  "Rider_horse_head",
  "Rider_horse_legs",
  "Rider_horse_mane",
  "Rider_horse_neck",
  "Rider_lance",
  "Rider_saddle",
  "Rider_shield",
  "Rider_torso",
];

interface Span {
  lo: [number, number, number];
  hi: [number, number, number];
}

/** The combined bounds of every node named `prefix*` in a GLB. */
function span(file: string, prefix: string): Span {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = 0;
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? gltf.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    // A tipped node would skew every number below invisibly, so it is
    // asserted.
    const q = node.rotation ?? [0, 0, 0, 1];
    expect(Math.abs(q[0]) + Math.abs(q[2]), `${name} is tipped, not just turned`).toBeLessThan(
      1e-6,
    );
    found++;
    const t = (node.translation ?? [0, 0, 0]) as [number, number, number];
    const s = (node.scale ?? [1, 1, 1]) as [number, number, number];
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const acc = gltf.accessors[prim.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], acc.min[i] * s[i] + t[i], acc.max[i] * s[i] + t[i]);
        hi[i] = Math.max(hi[i], acc.min[i] * s[i] + t[i], acc.max[i] * s[i] + t[i]);
      }
    }
  }
  expect(found, `${prefix}: no geometry found in ${file}`).toBeGreaterThan(0);
  return { lo, hi };
}

/** Every mesh node in a GLB, by name, with its material names. */
function nodeMaterials(file: string): Map<string, string[]> {
  const buf = readFileSync(join(MODELS, file));
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const out = new Map<string, string[]>();
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const mesh = gltf.meshes[node.mesh];
    const name = (node.name ?? mesh.name) as string;
    out.set(
      name,
      mesh.primitives.map((p: { material: number }) => gltf.materials[p.material].name as string),
    );
  }
  return out;
}

async function sceneOf(file: string): Promise<THREE.Group> {
  const buf = readFileSync(join(MODELS, file));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    newGLTFLoader().parse(ab, "", resolve, reject),
  );
  return gltf.scene;
}

// --- where it is authored -------------------------------------------------

test("the rider is authored along +x, the way a road and a camel are", () => {
  // A rider occupies an edge, so it follows the edge convention: long axis on
  // +x, edge midpoint at the origin. Along z it would lie across every road.
  const { lo, hi } = span(RIDERS, RIDER_PREFIX);
  const long = hi[0] - lo[0];
  const wide = hi[2] - lo[2];
  expect(long, "the rider is longer than it is wide").toBeGreaterThan(wide * 2);
  // It straddles the origin along its length; anchored at its nose it would
  // sit most of a body length down the path.
  expect(lo[0]).toBeLessThan(0);
  expect(hi[0]).toBeGreaterThan(0);
});

test("the rider faces +x, so it needs a bearing, not an axis", () => {
  // Which way it points, not just that it straddles the origin. `edgeRotationY`
  // gives only an axis (an Edge is an unordered vertex pair), so it flips a
  // piece on about half the edges: harmless for a road or the symmetric
  // waypost, a backwards horse here. `planCamels` takes its bearing from the
  // caravan chain; a rider needs a bearing source too.
  const head = span(RIDERS, "Rider_horse_head");
  const body = span(RIDERS, "Rider_horse_body");
  const bodyMid = (body.lo[0] + body.hi[0]) / 2;
  expect(head.lo[0], "the head must be forward of the body's middle").toBeGreaterThan(bodyMid);
  expect(head.lo[0], "the head must be on the +x side outright").toBeGreaterThan(0);
  // And the tail is on the other side of the animal.
  expect(span(RIDERS, "Rider_horse_mane").lo[0], "the tail trails at -x").toBeLessThan(-0.3);

  // Unlike the camel's test, no assertion that the whole box is lopsided: nose
  // and tail cancel and the box is nearly centred (0.008 off 0.90). The two
  // assertions above are the ones that can tell.
  const road = span("pieces.glb", PIECE_PREFIX.road);
  expect(road.lo[0] + road.hi[0], "the road is symmetric about its middle").toBeCloseTo(0, 5);
});

test("the rider stands on y = 0, the knights' plane and not the camel's", () => {
  // Pieces differ here, which is why `seating.seat` reads `assetBaseY` off the
  // art: buildings and chips start at 0.25, while knights, metropolises,
  // walls and the merchant start at 0. The rider is the second kind.
  expect(span(RIDERS, RIDER_PREFIX).lo[1], "the rider's feet").toBeCloseTo(0, 4);
  expect(span("camels.glb", "Camel_").lo[1], "the camel's, for contrast").toBeCloseTo(0.25, 4);
  expect(span("knights.glb", "Knight_basic").lo[1], "the knight's").toBeCloseTo(0, 4);
});

// --- how big it is --------------------------------------------------------

test("the rider sits between the knight and the camel", () => {
  // Measured against its neighbours: shorter than a knight it would vanish
  // behind one; taller than a camel it would be the biggest thing on a board
  // with cities.
  const rider = span(RIDERS, RIDER_PREFIX);
  const knight = span("knights.glb", "Knight_basic");
  const camel = span("camels.glb", "Camel_");

  const tall = rider.hi[1] - rider.lo[1];
  expect(tall, "taller than a knight").toBeGreaterThan(knight.hi[1] - knight.lo[1]);
  expect(tall, "shorter than a camel").toBeLessThan(camel.hi[1] - camel.lo[1]);
});

test("the rider fits the road footprint it may use", () => {
  // It may use the whole road (1.8 x 0.25) but takes about half its length,
  // which keeps it clear of the settlements at either end (as for the camel).
  // Measured against the road itself rather than a restated number.
  const rider = span(RIDERS, RIDER_PREFIX);
  const road = span("pieces.glb", PIECE_PREFIX.road);
  const long = rider.hi[0] - rider.lo[0];
  expect(long, "shorter than the road it stands on").toBeLessThan(road.hi[0] - road.lo[0]);
  expect(long, "and not so short it reads as a token").toBeGreaterThan(0.6);

  // The authored envelope, pinned. Change it together with
  // `tools/blender/gen/riders.py`.
  expect(long).toBeCloseTo(0.902, 2);
  expect(rider.hi[1] - rider.lo[1], "height, to the lance tip").toBeCloseTo(0.754, 2);
  expect(rider.hi[2] - rider.lo[2], "width, across the edge").toBeCloseTo(0.265, 2);
});

test("the lance is the tallest thing on the piece", () => {
  // At the game camera's 56-degree elevation a horse alone reads as a lump on
  // a road; the near-upright lance makes the rider legible, so it must stay the
  // high point.
  const whole = span(RIDERS, RIDER_PREFIX);
  const lance = span(RIDERS, "Rider_lance");
  expect(lance.hi[1]).toBeCloseTo(whole.hi[1], 6);
  // Above the helmet, by enough to read as a separate shape.
  expect(lance.hi[1] - span(RIDERS, "Rider_helm").hi[1]).toBeGreaterThan(0.01);
});

// --- how big it is drawn --------------------------------------------------

test("at the shipped scale the rider still fits the path it stands on", () => {
  // The tests above measure the authored piece; this one measures what the
  // board draws, i.e. times `MODULE_SCALE.rider`. The rider takes the road's
  // 1.15 rather than the knight's 2.0: it shares its path with roads, camels
  // and wagons, and scaling an edge piece up runs it over neighbouring tiles.
  const rider = span(RIDERS, RIDER_PREFIX);
  const road = span("pieces.glb", PIECE_PREFIX.road);
  const drawnRider = (rider.hi[0] - rider.lo[0]) * MODULE_SCALE.rider;
  const drawnRoad = (road.hi[0] - road.lo[0]) * PIECE_SCALE.road;
  expect(drawnRider, "still shorter than the drawn road").toBeLessThan(drawnRoad);

  // And the prefix the renderer looks up: a drifted prefix draws nothing
  // rather than failing, so the two share one constant.
  expect(RIDER_PREFIX).toBe(SHIPPED_RIDER_PREFIX);
});

// --- what it is made of ---------------------------------------------------

test("every rider part is seat-tinted and nothing else is in the file", () => {
  // The other half of the tint contract: `loader.test.ts` holds that the piece
  // has seat slots, this holds it has nothing else. A baked `Mat_Rider_*`
  // would leave one part the same colour for every seat. (The knight's crest
  // and sword are exempt because they encode rank and activation; nothing on a
  // rider means anything but "whose".)
  const mats = nodeMaterials(RIDERS);
  expect([...mats.keys()].sort()).toEqual(PARTS);
  for (const [name, used] of mats) {
    expect(used.length, `${name} carries more than one material`).toBe(1);
    expect(used[0], `${name} is not seat-tinted`).toMatch(/^Seat_/);
  }
  expect(new Set([...mats.values()].flat())).toEqual(
    new Set(["Seat_Body", "Seat_Shade", "Seat_Detail"]),
  );
});

test("every polygon of the rider is flat-shaded", async () => {
  // House style: flat shading. Smooth-shaded blocky low-poly looks melted.
  // Each triangle's three vertices must share a normal (the exporter splits
  // vertices for it), so this measures the result rather than a flag.
  const scene = await sceneOf(RIDERS);
  let triangles = 0;
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const normal = mesh.geometry.getAttribute("normal");
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : normal.count;
    triangles += count / 3;
    for (let i = 0; i < count; i += 3) {
      const at = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
      for (let c = 0; c < 3; c++) {
        const v = normal.getComponent(at[0], c);
        expect(
          Math.abs(normal.getComponent(at[1], c) - v),
          `${mesh.name} is smooth-shaded`,
        ).toBeLessThan(1e-5);
        expect(
          Math.abs(normal.getComponent(at[2], c) - v),
          `${mesh.name} is smooth-shaded`,
        ).toBeLessThan(1e-5);
      }
    }
  });

  // The face budget, in shipped units. The house budget is 100-250 polygons
  // per piece; this is 218 (216 quads and the shield's two hexagons), which
  // triangulates to 216*2 + 2*4 = 440. Pinned exactly.
  expect(triangles, "triangles in riders.glb").toBe(440);
  expect(triangles / 2, "polygons, against the 250 ceiling for a piece").toBeLessThan(250);
});

// --- what downloads it ----------------------------------------------------

test("only a Raiders game downloads the rider", () => {
  // In the lobby prefetch only for rulesets that include Raiders; listed
  // unconditionally, every base game would download it.
  for (const ruleset of ["base", "base+cak", "base+islands+fishermen+caravans"]) {
    expect(boardModelFiles(ruleset), ruleset).not.toContain(RIDERS);
  }
  expect(boardModelFiles("base+raiders")).toContain(RIDERS);
  expect(boardModelFiles("base+cak+raiders")).toContain(RIDERS);
});
