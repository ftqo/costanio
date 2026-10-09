// The Wagons wagon, measured off the shipped file. `layers/wagons.ts` plans
// it at `MODULE_SCALE.wagon`, and the art carries four facts that layer
// depends on but cannot check:
//
//   1. Which way it points. A wagon has a front and is turned by a bearing;
//      symmetric or reversed art is wrong on every board.
//   2. Where its base is. `seatY` solves `surface = y + scale * baseY` with
//      `assetBaseY` read off the art, so lifting the wheels off zero moves
//      every wagon silently.
//   3. That it tints. Several may share a vertex, and colour is the only owner
//      cue. (`loader.test.ts` holds the slots; this holds which part wears
//      which: a canopy in the shade slot is unreadable at board distance.)
//   4. Its size next to a settlement: a ratio to the building beside it, at
//      drawn scale, since authored sizes are not what the board shows.
//
// Read straight from the GLB, as `scenarioArt.test.ts` and `pieceFacing.test.ts`
// do, since the loader needs WebGL.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WAGONS_MODELS } from "./loader";
import { BUILDING_HALF_EXTENT, WAGON_TAIL } from "./layers/wagons";
import { MODULE_SCALE, PIECE_PREFIX, PIECE_SCALE } from "./pieceArt";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies: the shipped files are meshopt-encoded. See
// testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

const WAGONS = "wagons.glb";
const PREFIX = "Wagon_";

interface Gltf {
  json: {
    nodes: {
      name?: string;
      mesh?: number;
      translation?: number[];
      rotation?: number[];
      scale?: number[];
    }[];
    meshes: {
      name?: string;
      primitives: { attributes: Record<string, number>; indices?: number; material: number }[];
    }[];
    accessors: {
      bufferView: number;
      byteOffset?: number;
      count: number;
      componentType: number;
      type: string;
      min?: number[];
      max?: number[];
    }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
    materials: { name?: string }[];
  };
  bin: number;
  buf: Buffer;
}

function open(file: string): Gltf {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  return {
    json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")),
    bin: 20 + jsonLen + 8,
    buf,
  };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** One accessor, read out flat. Float32 for attributes, u16/u32 for indices. */
function read(g: Gltf, index: number): number[] {
  const acc = g.json.accessors[index];
  const view = g.json.bufferViews[acc.bufferView];
  const n = COMPONENTS[acc.type];
  const width = acc.componentType === 5126 ? 4 : acc.componentType === 5125 ? 4 : 2;
  const stride = view.byteStride ?? n * width;
  const base = g.bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < n; c++) {
      const at = base + i * stride + c * width;
      out.push(
        acc.componentType === 5126
          ? g.buf.readFloatLE(at)
          : acc.componentType === 5125
            ? g.buf.readUInt32LE(at)
            : g.buf.readUInt16LE(at),
      );
    }
  }
  return out;
}

/** The named nodes whose name starts `prefix`, with their mesh resolved. */
function nodesOf(g: Gltf, prefix: string) {
  const out = g.json.nodes
    .map((node, i) => ({ node, i }))
    .filter(({ node }) => node.mesh !== undefined && (node.name ?? "").startsWith(prefix));
  expect(out.length, `${prefix}: nothing in ${WAGONS}`).toBeGreaterThan(0);
  return out;
}

interface Span {
  lo: [number, number, number];
  hi: [number, number, number];
}

/**
 * Combined bounds of every node named `prefix*`, in the node's own axes.
 *
 * Translation and scale are applied but not yaw, as in `scenarioArt.test.ts`: the
 * export writes a family's canonicalising turn as a node rotation (see
 * `recenter` in export_assets.py), e.g. -20 degrees on a settlement, and a
 * rotated box would measure a diagonal. A tip would break every number, so
 * that is asserted.
 */
function span(g: Gltf, prefix: string): Span {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { node } of nodesOf(g, prefix)) {
    const q = node.rotation ?? [0, 0, 0, 1];
    expect(Math.abs(q[0]) + Math.abs(q[2]), `${node.name} is tipped, not just turned`).toBeLessThan(
      1e-6,
    );
    const t = (node.translation ?? [0, 0, 0]) as [number, number, number];
    const s = (node.scale ?? [1, 1, 1]) as [number, number, number];
    for (const prim of g.json.meshes[node.mesh!].primitives) {
      const acc = g.json.accessors[prim.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], acc.min![i] * s[i] + t[i], acc.max![i] * s[i] + t[i]);
        hi[i] = Math.max(hi[i], acc.min![i] * s[i] + t[i], acc.max![i] * s[i] + t[i]);
      }
    }
  }
  return { lo, hi };
}

/** Material name per node named `prefix*`. */
function materialsOf(g: Gltf, prefix: string): string[] {
  const names = new Set<string>();
  for (const { node } of nodesOf(g, prefix)) {
    for (const prim of g.json.meshes[node.mesh!].primitives) {
      names.add(g.json.materials[prim.material].name ?? "");
    }
  }
  return [...names].sort();
}

// --- what it is -----------------------------------------------------------

test("the wagon ships as the file loader.ts names, in six parts", () => {
  // Pins only the wagon; the list also holds the barbarian warrior (shared
  // with Raiders) and the Caravans waypost (a placeholder for the trade-hex
  // tile). The rest is loader.test.ts's job.
  expect(WAGONS_MODELS).toContain(WAGONS);
  const g = open(WAGONS);
  const names = nodesOf(g, PREFIX)
    .map(({ node }) => node.name)
    .sort();
  expect(names).toEqual([
    "Wagon_bed",
    "Wagon_canopy",
    "Wagon_hubs",
    "Wagon_tailcloth",
    "Wagon_tongue",
    "Wagon_wheels",
  ]);
});

test("every part wears a seat slot, and the canopy wears the body one", () => {
  // The canopy is the arch's top face and the board is seen from 56 degrees
  // of elevation, so it is most of what a player sees and must carry the seat
  // colour. In `Seat_Shade` every wagon would be a dark lump.
  const g = open(WAGONS);
  expect(materialsOf(g, PREFIX)).toEqual(["Seat_Body", "Seat_Detail", "Seat_Shade"]);
  expect(materialsOf(g, "Wagon_canopy")).toEqual(["Seat_Body"]);
  expect(materialsOf(g, "Wagon_bed")).toEqual(["Seat_Shade"]);
  expect(materialsOf(g, "Wagon_wheels")).toEqual(["Seat_Shade"]);
  // The one accent, on the parts that read as machinery: hubs and tongue.
  expect(materialsOf(g, "Wagon_hubs")).toEqual(["Seat_Detail"]);
  expect(materialsOf(g, "Wagon_tongue")).toEqual(["Seat_Detail"]);
  // No fourth material: a `Mat_Wagon_*` would be one colour for every seat.
  expect(g.json.materials.map((m) => m.name).sort()).toEqual([
    "Seat_Body",
    "Seat_Detail",
    "Seat_Shade",
  ]);
});

test("the wagon nodes carry no authored rotation", () => {
  // `anchors.AUTHORED_TURN` cancels the yaw of art composed on the showcase
  // board. This art was authored at the origin, so its nodes carry no
  // rotation (the settlement, by contrast, carries -20 degrees), and a layer
  // can apply its bearing with no per-family correction.
  const g = open(WAGONS);
  for (const { node } of nodesOf(g, PREFIX)) {
    const q = node.rotation ?? [0, 0, 0, 1];
    expect(Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]), `${node.name} is turned`).toBeLessThan(
      1e-6,
    );
  }
  // Node scale is not asserted: `npm run models:compress` parks the
  // quantisation factor on the node, and the plain copies undo the accessor
  // quantisation without folding it back. The measurements above apply it.
});

// --- how it sits ----------------------------------------------------------

test("the wagon stands on y = 0, the knights' plane and not the settlement's", () => {
  // Art staged on the showcase board starts at 0.25 (settlement, road, camel);
  // art authored at the origin starts at 0 (knights, metropolises).
  // `assetBaseY` reads either, but a change would float the wagon by a quarter
  // hex, which looks like a placement bug.
  const { lo } = span(open(WAGONS), PREFIX);
  expect(lo[1]).toBeCloseTo(0, 5);
});

test("the four wheels are what touches the ground", () => {
  // Not the bed or the tongue: a wagon resting on its floor is a crate.
  const g = open(WAGONS);
  expect(span(g, "Wagon_wheels").lo[1]).toBeCloseTo(0, 5);
  for (const part of ["Wagon_bed", "Wagon_tongue", "Wagon_canopy"]) {
    expect(span(g, part).lo[1], `${part} is on the ground`).toBeGreaterThan(0.02);
  }
});

// --- which way it points --------------------------------------------------

test("the wagon faces +x, and says so in its silhouette", () => {
  // `layers/wagons.ts` builds its yaw on this. +x is the board's reference
  // direction for long pieces (road, camel), and a piece that only straddles
  // the axis would pass a length test either way round. Three independent
  // cues:
  const g = open(WAGONS);
  const whole = span(g, PREFIX);
  expect(whole.hi[0] - whole.lo[0], "longer than it is wide").toBeGreaterThan(
    (whole.hi[2] - whole.lo[2]) * 1.4,
  );

  // 1. The tongue is wholly forward of the origin, so a reversed wagon is
  //    visibly hitched backwards.
  expect(span(g, "Wagon_tongue").lo[0]).toBeGreaterThan(0);

  // 2. The open back is wholly behind it; this cue survives the top-down view.
  expect(span(g, "Wagon_tailcloth").hi[0]).toBeLessThan(0);

  // 3. The front wheels are the small ones, by height rather than by name.
  const wheels = span(g, "Wagon_wheels");
  expect(wheels.hi[1], "the tall rear wheels set the wheel height").toBeGreaterThan(0.18);
});

// --- how big it is --------------------------------------------------------

test("the wagon fits beside a settlement on a junction", () => {
  // A ratio to the settlement beside it, at drawn scale: a settlement draws at
  // `PIECE_SCALE.settlement` and a wagon at `MODULE_SCALE.wagon`, so authored
  // envelopes describe a board nobody sees. (Authored, 0.551 x 0.35 x 0.45
  // against 0.470 x 0.440 x 0.40 looked right but drew smaller than the house
  // in every dimension.)
  //
  // At 1.5 it drew 0.827 x 0.525 x 0.675: about as long as a settlement is
  // wide, well narrower (no overlap on a shared corner), and just under it in
  // height (not hiding the building). It ships at 1.65, the top of that band
  // (0.909 x 0.578 x 0.743), and every ratio below still holds.
  const g = open(WAGONS);
  const wagon = span(g, PREFIX);
  const house = span(open("pieces.glb"), PIECE_PREFIX.settlement);

  const wagonLong = (wagon.hi[0] - wagon.lo[0]) * MODULE_SCALE.wagon;
  const wagonWide = (wagon.hi[2] - wagon.lo[2]) * MODULE_SCALE.wagon;
  const wagonTall = (wagon.hi[1] - wagon.lo[1]) * MODULE_SCALE.wagon;
  const houseWide =
    Math.max(house.hi[0] - house.lo[0], house.hi[2] - house.lo[2]) * PIECE_SCALE.settlement;
  const houseTall = (house.hi[1] - house.lo[1]) * PIECE_SCALE.settlement;

  expect(wagonLong / houseWide).toBeGreaterThan(0.8);
  expect(wagonLong / houseWide).toBeLessThan(1.05);
  expect(wagonWide).toBeLessThan(houseWide * 0.7);
  expect(wagonTall / houseTall).toBeGreaterThan(0.75);
  expect(wagonTall / houseTall).toBeLessThan(0.95);

  // The authored envelope, so art drift shows as a number rather than as a
  // ratio moving with a scale factor.
  expect(wagon.hi[0] - wagon.lo[0]).toBeCloseTo(0.551, 2);
  expect(wagon.hi[2] - wagon.lo[2]).toBeCloseTo(0.35, 2);
  expect(wagon.hi[1] - wagon.lo[1]).toBeCloseTo(0.45, 2);
});

test("the building clearance in layers/wagons matches the shipped meshes", () => {
  // `planWagons` keeps a wagon clear of a settlement or city by these drawn
  // half-extents and the wagon's drawn tail. They are constants because the
  // meshes are not readable at runtime; this holds them to the art.
  const pieces = open("pieces.glb");
  for (const kind of ["settlement", "city"] as const) {
    const b = span(pieces, PIECE_PREFIX[kind]);
    const [hx, hz] = BUILDING_HALF_EXTENT[kind];
    expect(Math.max(-b.lo[0], b.hi[0]) * PIECE_SCALE[kind], `${kind} x`).toBeCloseTo(hx, 2);
    expect(Math.max(-b.lo[2], b.hi[2]) * PIECE_SCALE[kind], `${kind} z`).toBeCloseTo(hz, 2);
  }
  const w = span(open(WAGONS), PREFIX);
  expect(-w.lo[0] * MODULE_SCALE.wagon).toBeCloseTo(WAGON_TAIL, 2);
});

test("the ring radii recommended for 2-4 wagons on one vertex still clear", () => {
  // Several wagons may share a vertex. The ring offsets in
  // tools/blender/gen/wagons.py (0.22 for two, 0.38 for three, 0.47 for four,
  // authored units, each wagon yawed outward) follow from this geometry, so
  // growing the wagon fails here.
  //
  // Authored units on both sides: `planWagons` scales the radii by
  // `MODULE_SCALE.wagon`, so the comparisons are scale invariant, provided the
  // factor is applied to both.
  const { lo, hi } = span(open(WAGONS), PREFIX);
  const long = hi[0] - lo[0];
  const wide = hi[2] - lo[2];

  // Four, the binding case. Two wagons on perpendicular bearings, each along
  // its radius, miss when the near end of one clears the other's half-width:
  // r > (long + wide) / 2. A laager (tangential wagons) gives the same
  // threshold with the terms swapped.
  expect((long + wide) / 2).toBeLessThan(0.47);

  // Three, at 120 degrees. Bounded by the circumscribed circle, which holds at
  // any yaw: centres 2 * r * sin(60) apart must exceed its diameter.
  expect(2 * 0.38 * Math.sin(Math.PI / 3)).toBeGreaterThan(Math.hypot(long, wide));

  // Two, side by side across the junction: only the widths meet.
  expect(2 * 0.22).toBeGreaterThan(wide);
});

// --- house style ----------------------------------------------------------

test("every face is flat-shaded", () => {
  // A smoothed part is invisible in Blender's solid view but catches the light
  // differently on the board. Flat shading survives into glTF as per-triangle
  // normals (the exporter splits vertices), so a triangle's three normals
  // match.
  const g = open(WAGONS);
  let triangles = 0;
  for (const { node } of nodesOf(g, PREFIX)) {
    for (const prim of g.json.meshes[node.mesh!].primitives) {
      const normals = read(g, prim.attributes.NORMAL);
      const idx = read(g, prim.indices!);
      expect(idx.length % 3, `${node.name} is not triangulated`).toBe(0);
      for (let t = 0; t < idx.length; t += 3) {
        triangles++;
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
        for (let k = 0; k < 3; k++) {
          expect(normals[b * 3 + k], `${node.name} tri ${t / 3} is smooth`).toBeCloseTo(
            normals[a * 3 + k],
            5,
          );
          expect(normals[c * 3 + k], `${node.name} tri ${t / 3} is smooth`).toBeCloseTo(
            normals[a * 3 + k],
            5,
          );
        }
      }
    }
  }
  // The budget: 100-250 authored faces a piece. 153 quads and n-gons here,
  // triangulated to 351.
  expect(triangles).toBe(351);
  expect(triangles).toBeLessThan(520); // ~250 authored quads, the ceiling
});
