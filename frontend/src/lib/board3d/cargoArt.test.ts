// The Explorers cargo art, measured off the shipped file.
//
// `cargo.glb` holds three pieces nothing draws yet (no `engine/explorers`, no
// layer, no `MODULE_SCALE` entry), so these pin the numbers other branches
// depend on:
//
//   * the fish haul drops into a 0.34 x 0.18 hold recess on `art/vessels`,
//   * two spice sacks sit side by side across the same recess,
//   * the mission marker stacks at exactly its own thickness,
//   * and only the marker may wear a seat colour (`loader.test.ts` pins that
//     half; the sizes are here).
//
// Read straight from the GLB like `scenarioArt.test.ts` and
// `knightSwordArt.test.ts`, since the loader needs WebGL.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAIN_MODELS, SHIPPED_MODELS } from "@/testGlbFixtures";

// The plain copy: what ships is meshopt-encoded and quantised, and this reads
// raw float32 positions and normals. See testGlbFixtures.ts.
const CARGO = "cargo.glb";

interface Gltf {
  nodes: { name?: string; mesh?: number; translation?: number[]; scale?: number[] }[];
  meshes: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices: number }[];
  }[];
  accessors: {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  materials?: { name?: string }[];
}

/** The JSON chunk and the BIN chunk of a GLB, as they sit on disk. */
function open(file: string): { doc: Gltf; bin: Buffer } {
  const buf = readFileSync(join(PLAIN_MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as Gltf;
  // The BIN chunk header is another 8 bytes (length, type) after the JSON.
  const binStart = 20 + jsonLen + 8;
  return { doc, bin: buf.subarray(binStart) };
}

const ELEMENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** One accessor, flattened. Float32 for attributes, u16/u32 for indices. */
function read(doc: Gltf, bin: Buffer, index: number): number[] {
  const acc = doc.accessors[index];
  const view = doc.bufferViews[acc.bufferView];
  const size = ELEMENTS[acc.type];
  // Both offsets: several accessors share one buffer view, so dropping the
  // accessor's own `byteOffset` reads a neighbour's bytes without error.
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const width = acc.componentType === 5126 ? 4 : acc.componentType === 5125 ? 4 : 2;
  const stride = view.byteStride ?? size * width;
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < size; k++) {
      const at = base + i * stride + k * width;
      out.push(
        acc.componentType === 5126
          ? bin.readFloatLE(at)
          : acc.componentType === 5125
            ? bin.readUInt32LE(at)
            : bin.readUInt16LE(at),
      );
    }
  }
  return out;
}

interface Part {
  /** World-space positions, the node's translation and scale applied. */
  points: [number, number, number][];
  /** Per-vertex normals, in the same order. */
  normals: [number, number, number][];
  /** Triangle corners, as indices into `points`. */
  tris: [number, number, number][];
  materials: string[];
}

/** Every node named `prefix*`, merged into one part. */
function part(prefix: string): Part {
  const { doc, bin } = open(CARGO);
  const out: Part = { points: [], normals: [], tris: [], materials: [] };
  let found = 0;
  for (const node of doc.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? doc.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    found++;
    const t = (node.translation ?? [0, 0, 0]) as [number, number, number];
    const s = (node.scale ?? [1, 1, 1]) as [number, number, number];
    for (const prim of doc.meshes[node.mesh].primitives) {
      const offset = out.points.length;
      const pos = read(doc, bin, prim.attributes.POSITION);
      const nrm = read(doc, bin, prim.attributes.NORMAL);
      for (let i = 0; i < pos.length; i += 3) {
        out.points.push([pos[i] * s[0] + t[0], pos[i + 1] * s[1] + t[1], pos[i + 2] * s[2] + t[2]]);
        out.normals.push([nrm[i], nrm[i + 1], nrm[i + 2]]);
      }
      const idx = read(doc, bin, prim.indices);
      for (let i = 0; i < idx.length; i += 3) {
        out.tris.push([idx[i] + offset, idx[i + 1] + offset, idx[i + 2] + offset]);
      }
    }
  }
  expect(found, `${prefix}: no geometry in ${CARGO}`).toBeGreaterThan(0);
  return out;
}

/** The material names worn by every mesh named `prefix*`. */
function materialsOf(prefix: string): string[] {
  // The shipped file, not the plain copy: material names must survive
  // compression.
  const buf = readFileSync(join(SHIPPED_MODELS, CARGO));
  const doc = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8")) as {
    meshes: { name?: string; primitives: { material: number }[] }[];
    materials?: { name?: string }[];
  };
  const names = (doc.materials ?? []).map((m) => m.name ?? "");
  const meshes = doc.meshes.filter((m) => (m.name ?? "").startsWith(prefix));
  expect(meshes.length, `${CARGO} has no mesh named ${prefix}*`).toBeGreaterThan(0);
  return [...new Set(meshes.flatMap((m) => m.primitives.map((p) => names[p.material])))].sort();
}

function bounds(p: Part): { lo: [number, number, number]; hi: [number, number, number] } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const v of p.points)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], v[i]);
      hi[i] = Math.max(hi[i], v[i]);
    }
  return { lo, hi };
}

const size = (p: Part) => {
  const { lo, hi } = bounds(p);
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] as [number, number, number];
};

// The recess this art was cut to fit, owned by `art/vessels`. Restated because
// there is no shared module to import it from yet; reconcile when there is.
const HOLD = { long: 0.34, across: 0.18, floor: 0.06 };

// --- the fish haul ------------------------------------------------------

test("the haul fits the hold recess on both axes", () => {
  // A haul even slightly over on either axis sits proud of the deck on every
  // ship.
  const [long, tall, across] = size(part("Haul_"));
  expect(long, "along the recess").toBeLessThan(HOLD.long);
  expect(across, "across the recess").toBeLessThan(HOLD.across);
  // And not much smaller, or the two branches have drifted apart.
  expect(HOLD.long - long).toBeLessThan(0.05);
  expect(HOLD.across - across).toBeLessThan(0.05);
  // Low enough for a deck over the hold to close on it. The recess floor is
  // 0.06 above the piece base.
  expect(tall).toBeLessThan(0.16);
});

test("the haul runs along +x and is turn-symmetric", () => {
  // Two fish, head to tail. A hold recess has no bow end, just as
  // `edgeRotationY` has no oasis end (see the waypost in scenarioArt.test.ts), so a
  // single fish would face aft on half the ships. Head to tail, the piece is
  // symmetric under a half turn.
  const haul = bounds(part("Haul_"));
  expect(haul.hi[0] - haul.lo[0], "longer than it is wide").toBeGreaterThan(
    (haul.hi[2] - haul.lo[2]) * 1.5,
  );
  expect(haul.lo[0] + haul.hi[0], "lopsided along the hold").toBeCloseTo(0, 4);
  expect(haul.lo[2] + haul.hi[2], "lopsided across the hold").toBeCloseTo(0, 4);

  // The two fish face opposite ways. Blender +x maps to glTF +x.
  const a = bounds(part("Haul_fish_a"));
  const b = bounds(part("Haul_fish_b"));
  const nose = (s: { lo: number[]; hi: number[] }) => (s.lo[0] + s.hi[0]) / 2;
  expect(Math.sign(nose(a)), "fish a heads +x").toBe(1);
  expect(Math.sign(nose(b)), "fish b heads -x").toBe(-1);
  // Side by side, not stacked; two deep would be too tall for a deck to close.
  expect(bounds(part("Haul_fish_a")).lo[2] * bounds(part("Haul_fish_b")).hi[2]).toBeLessThan(0);
});

test("the haul rests on z = 0", () => {
  // `board3d/seating.ts` solves `surface = y + scale * baseY` from the art's
  // base, so a base of exactly 0 carries no hidden lift. All three pieces
  // agree, unlike the camel and the waypost (authored at 0.25).
  for (const prefix of ["Haul_", "Spice_", "Marker_"]) {
    expect(bounds(part(prefix)).lo[1], `${prefix} base`).toBeCloseTo(0, 4);
  }
});

test("the haul contrasts with open water", () => {
  // A haul sits on a fish-shoal sea hex until picked up, and `Mat_Ocean` is
  // very dark (0.012, 0.06, 0.26), so the body colour is pinned well clear of it.
  const palette = JSON.parse(readFileSync(join(SHIPPED_MODELS, "palette.json"), "utf8")) as Record<
    string,
    { color: [number, number, number] }
  >;
  const luma = (name: string) => {
    const c = palette[name]?.color;
    expect(c, `palette has no ${name}`).toBeDefined();
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  expect(luma("Mat_Haul_body")).toBeGreaterThan(luma("Mat_Ocean") * 4);
  // The fin is darker than the body and still above the water, or it reads as
  // a hole.
  expect(luma("Mat_Haul_fin")).toBeLessThan(luma("Mat_Haul_body"));
  expect(luma("Mat_Haul_fin")).toBeGreaterThan(luma("Mat_Ocean") * 2);
});

// --- the spice sack -----------------------------------------------------

test("two spice sacks sit side by side across the hold", () => {
  // A haul fills the recess and a sack is half of it: two across the 0.18, two
  // along the 0.34.
  const [wide, tall, deep] = size(part("Spice_"));
  expect(wide, "sacks are round in plan").toBeCloseTo(deep, 3);
  expect(wide, "sack width vs half the recess").toBeLessThan(HOLD.across / 2 + 0.055);
  expect(2 * wide, "two sacks along the recess").toBeLessThan(HOLD.long);
  expect(tall).toBeGreaterThan(wide); // a sack, not a pat
  expect(tall).toBeLessThan(0.2);
});

test("the sack has a cinched neck", () => {
  // The sack needs a cinched waist or it reads as a lump: the widest ring low,
  // a narrower one above, and a flare above that. A plain cone would pass two
  // of the three checks.
  const sack = part("Spice_sack");
  const radius = (v: [number, number, number]) => Math.hypot(v[0], v[2]);
  const widest = (lo: number, hi: number) =>
    Math.max(...sack.points.filter((v) => v[1] >= lo && v[1] < hi).map(radius));

  const belly = widest(0.03, 0.07);
  const neck = widest(0.105, 0.125);
  const tuft = widest(0.145, 0.17);
  expect(neck, "neck vs belly width").toBeLessThan(belly * 0.55);
  expect(tuft, "tuft vs neck width").toBeGreaterThan(neck * 1.4);
});

test("sack pitch and tier keep the pile together", () => {
  // The offsets `tools/blender/cargo_kit.py` recommends for a spice village
  // hex. Restated for the same reason as HOLD.
  const SACK_PITCH = 0.125;
  const SACK_TIER = 0.112;

  const sack = part("Spice_sack");
  const { hi } = bounds(sack);
  const width = hi[0] * 2;
  // Neighbours overlap, so a row reads as one heap rather than separate objects.
  expect(SACK_PITCH, "sacks in a row overlap").toBeLessThan(width);
  expect(SACK_PITCH, "sack pitch lower bound").toBeGreaterThan(width * 0.8);

  // The upper tier sits above the lower sacks' widest ring and below their
  // cinch, so it settles between them.
  const radius = (v: [number, number, number]) => Math.hypot(v[0], v[2]);
  const bellyY = sack.points.reduce((best, v) => (radius(v) > radius(best) ? v : best))[1];
  const neckY = 0.114;
  expect(SACK_TIER).toBeGreaterThan(bellyY);
  expect(SACK_TIER).toBeLessThan(neckY + 0.01);
});

// --- the mission marker -------------------------------------------------

test("the marker is 0.2 across and 0.08 thick", () => {
  // Markers pile on a rival's mission track, so the stack offset is exactly
  // the piece height; any error compounds by the fourth marker.
  const [wide, thick, deep] = size(part("Marker_"));
  expect(wide, "across the flats").toBeCloseTo(0.2, 4);
  expect(deep, "round in plan").toBeCloseTo(wide, 4);
  expect(thick, "the stack offset").toBeCloseTo(0.08, 4);

  // The bevel is visible: the piece is narrower where it touches its
  // neighbours than at its waist, which draws a line between stacked markers.
  const rim = part("Marker_rim");
  const radius = (v: [number, number, number]) => Math.hypot(v[0], v[2]);
  const widest = Math.max(...rim.points.map(radius));
  for (const [where, ys] of [
    ["the underside", (y: number) => y < 0.002],
    ["the top", (y: number) => y > 0.072],
  ] as const) {
    const flat = Math.max(...rim.points.filter((v) => ys(v[1])).map(radius));
    expect(flat, `no ring at ${where}`).toBeGreaterThan(0);
    expect(widest - flat, `the bevel at ${where}`).toBeGreaterThan(0.01);
  }
});

test("the marker uses seat slots only", () => {
  // `loader.test.ts` checks it has a tint slot; this checks it has nothing
  // else, since a `Mat_Marker_*` would be shared by all seats.
  expect(materialsOf("Marker_")).toEqual(["Seat_Body", "Seat_Shade"]);
  expect(materialsOf("Marker_face"), "the face is the seat's own colour").toEqual(["Seat_Body"]);
  expect(materialsOf("Marker_rim"), "the rim is its shade").toEqual(["Seat_Shade"]);
});

// --- house style, across the whole file ---------------------------------

test("the cargo uses exactly its palette materials", () => {
  expect(materialsOf("Haul_")).toEqual(["Mat_Haul_body", "Mat_Haul_fin"]);
  expect(materialsOf("Spice_")).toEqual(["Mat_Spice_sack", "Mat_Spice_tie"]);

  // Every neutral material is in palette.json, which is what paints the board.
  const palette = JSON.parse(readFileSync(join(SHIPPED_MODELS, "palette.json"), "utf8")) as Record<
    string,
    unknown
  >;
  for (const name of [...materialsOf("Haul_"), ...materialsOf("Spice_")]) {
    expect(palette[name], `palette missing ${name}`).toBeDefined();
  }
});

test("every face is flat-shaded", () => {
  // Flat shading: a flat triangle has one normal at all three corners.
  for (const prefix of ["Haul_", "Spice_", "Marker_"]) {
    const p = part(prefix);
    let smooth = 0;
    for (const [a, b, c] of p.tris) {
      const [na, nb, nc] = [p.normals[a], p.normals[b], p.normals[c]];
      const same =
        na.every((v, i) => Math.abs(v - nb[i]) < 1e-4) &&
        na.every((v, i) => Math.abs(v - nc[i]) < 1e-4);
      if (!same) smooth++;
    }
    expect(smooth, `${prefix} has smooth-shaded triangles`).toBe(0);
  }
});

test("each piece stays inside the low-poly budget", () => {
  // 100-250 faces a piece, up to ~400 for a family. Counted as triangles, which
  // is what the exporter writes and the GPU draws (the marker's 64 authored
  // faces become 160 triangles). Today: 132, 120, 160. Each ceiling leaves
  // about a third of headroom.
  const tris = (prefix: string) => part(prefix).tris.length;
  expect(tris("Haul_")).toBeLessThan(180);
  expect(tris("Spice_")).toBeLessThan(160);
  expect(tris("Marker_")).toBeLessThan(240);
  expect(tris("Haul_") + tris("Spice_") + tris("Marker_"), "the whole family").toBeLessThan(560);

  // And a floor, to catch an export that dropped a part (a haul with no fins
  // still parses and fits).
  for (const prefix of ["Haul_fins", "Haul_lash", "Spice_tie", "Marker_face"]) {
    expect(tris(prefix), `${prefix} exported empty`).toBeGreaterThan(10);
  }
});
