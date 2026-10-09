// The Explorers vessels in `vessels.glb`, measured off the shipped file.
//
// The art carries contracts nothing else checks: the beam a side-by-side pair
// depends on, the recess the settler figures stand in, and the corsair's
// clearance from a number chip. They involve pieces authored elsewhere (the
// harbour figures) and a board-wide rule, so they are pinned here.
//
// Read straight from the GLB, as `scenarioArt.test.ts` and
// `knightSwordArt.test.ts` do, since the loader needs WebGL.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SURFACE } from "./seating";
import { TILES } from "./manifest.generated";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies: the shipped files are meshopt-encoded and quantised.
const MODELS = PLAIN_MODELS;
const VESSELS = "vessels.glb";
const SHIPS = "ships.glb";

interface Gltf {
  nodes: {
    name?: string;
    mesh?: number;
    translation?: [number, number, number];
    scale?: [number, number, number];
    rotation?: number[];
  }[];
  meshes: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices?: number }[];
  }[];
  accessors: {
    bufferView?: number;
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

function readGlb(file: string): { gltf: Gltf; bin: Buffer } {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as Gltf;
  // The BIN chunk follows the JSON one: 8 bytes of chunk header, then payload.
  const binStart = 20 + jsonLen + 8;
  return { gltf, bin: buf.subarray(binStart) };
}

interface Span {
  lo: [number, number, number];
  hi: [number, number, number];
}

/** The combined bounds of every node named `prefix*` in a GLB. */
function span(file: string, prefix: string): Span {
  const { gltf } = readGlb(file);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = 0;
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? gltf.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    // A tipped or turned node would silently break every number below. These
    // are authored and exported square, so assert it.
    const q = node.rotation ?? [0, 0, 0, 1];
    expect(Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]), `${name} is turned`).toBeLessThan(
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

/** Every node name in a file that starts with `prefix`. */
function partsOf(file: string, prefix: string): string[] {
  const { gltf } = readGlb(file);
  return gltf.nodes
    .filter((n) => n.mesh !== undefined)
    .map((n) => n.name ?? gltf.meshes[n.mesh!].name ?? "")
    .filter((n) => n.startsWith(prefix));
}

/** Triangles across every primitive whose node name starts with `prefix`. */
function triangleCount(file: string, prefix: string): number {
  const { gltf } = readGlb(file);
  let tris = 0;
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? gltf.meshes[node.mesh].name ?? "";
    if (!name.startsWith(prefix)) continue;
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const acc = gltf.accessors[prim.indices ?? prim.attributes.POSITION];
      tris += acc.count / 3;
    }
  }
  return tris;
}

const COMPONENT_READ: Record<number, (b: Buffer, o: number) => number> = {
  5121: (b, o) => b.readUInt8(o),
  5123: (b, o) => b.readUInt16LE(o),
  5125: (b, o) => b.readUInt32LE(o),
  5126: (b, o) => b.readFloatLE(o),
};
const COMPONENT_SIZE: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_LEN: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * An accessor's values, flat. Interleaved: the dequantised copies keep
 * position and normal in one buffer view with a `byteStride` of 24, so a
 * contiguous walk would read every other vector. No sparse accessors.
 */
function read(gltf: Gltf, bin: Buffer, index: number): number[] {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView!];
  const size = COMPONENT_SIZE[acc.componentType];
  const len = TYPE_LEN[acc.type];
  const stride = view.byteStride ?? size * len;
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < len; c++) {
      out.push(COMPONENT_READ[acc.componentType](bin, start + i * stride + c * size));
    }
  }
  return out;
}

/**
 * True if every triangle's three vertex normals agree, i.e. the mesh is flat.
 * The house rule is `use_smooth = False`; Blender writes flat shading as split
 * vertices with one normal per face. A smoothed hull blurs on the board.
 */
function isFlatShaded(file: string, prefix: string): boolean {
  const { gltf, bin } = readGlb(file);
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? gltf.meshes[node.mesh].name ?? "";
    if (!name.startsWith(prefix)) continue;
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const normals = read(gltf, bin, prim.attributes.NORMAL);
      const idx = prim.indices !== undefined ? read(gltf, bin, prim.indices) : null;
      const count = idx ? idx.length : normals.length / 3;
      for (let t = 0; t < count; t += 3) {
        const v = [0, 1, 2].map((k) => (idx ? idx[t + k] : t + k));
        for (const axis of [0, 1, 2]) {
          const first = normals[v[0] * 3 + axis];
          for (const w of v) {
            if (Math.abs(normals[w * 3 + axis] - first) > 1e-4) return false;
          }
        }
      }
    }
  }
  return true;
}

/** The distinct heights (glTF +y) in one node's geometry, ascending. */
function distinctHeights(file: string, name: string): number[] {
  const { gltf, bin } = readGlb(file);
  const node = gltf.nodes.find(
    (n) => n.mesh !== undefined && (n.name ?? gltf.meshes[n.mesh].name) === name,
  );
  expect(node, `${file} has no node called ${name}`).toBeDefined();
  const scale = (node!.scale ?? [1, 1, 1])[1];
  const offset = (node!.translation ?? [0, 0, 0])[1];
  const seen = new Set<string>();
  for (const prim of gltf.meshes[node!.mesh!].primitives) {
    const pos = read(gltf, bin, prim.attributes.POSITION);
    for (let i = 1; i < pos.length; i += 3) seen.add((pos[i] * scale + offset).toFixed(3));
  }
  return [...seen].map(Number).sort((a, b) => a - b);
}

/** A constant lifted out of tools/blender/hexcontract.py, so it cannot drift. */
function hexContract(name: string): number {
  const src = readFileSync(
    join(__dirname, "..", "..", "..", "..", "tools", "blender", "hexcontract.py"),
    "utf8",
  );
  const m = new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, "m").exec(src);
  expect(m, `hexcontract.py no longer defines ${name}`).not.toBeNull();
  return Number(m![1]);
}

// --- the cargo ship -----------------------------------------------------
//
// The contract, restated from tools/blender/gen/vessels.py:
//
//   length 1.10 along +x, bow at +x, edge midpoint at the origin, base at 0
//   beam 0.28 or under, so two fit side by side on one sea edge
//   deck at 0.20, the route ship's own
//   hold 0.34 x 0.18, floor 0.06 above the base

test("the cargo ship lies along +x, centred on the origin, base at 0", () => {
  // `edgeRotationY` turns art authored along +x onto its edge and is the only
  // thing that turns this piece; authored along z it would lie across the
  // edge.
  const { lo, hi } = span(VESSELS, "Cargo_");
  expect(hi[0] - lo[0], "length").toBeCloseTo(1.1, 3);
  expect(hi[0] - lo[0], "longer than it is wide").toBeGreaterThan((hi[2] - lo[2]) * 3);
  // The origin is the edge midpoint, so the ship straddles it.
  expect(lo[0] + hi[0], "lopsided along the edge").toBeCloseTo(0, 3);
  expect(lo[2] + hi[2], "lopsided across the edge").toBeCloseTo(0, 3);
  // It stands on its own base, like the Islands route ship. Re-anchoring it to
  // the piece plane (like the camels) would change `assetBaseY` and float it.
  expect(lo[1], "base plane").toBeCloseTo(0, 4);
  expect(lo[1], "the same base plane the route ship uses").toBeCloseTo(
    span(SHIPS, "Ship_route").lo[1],
    4,
  );
});

test("the cargo ship's beam leaves room for the pair the rules allow", () => {
  // Two cargo ships may share a sea edge, drawn at z = +/-0.17, so the beam has
  // a ceiling: at 0.28 the pair leaves 0.06 of water between hulls, and at 0.34
  // they interpenetrate.
  const SIDE_BY_SIDE = 0.17;
  const { lo, hi } = span(VESSELS, "Cargo_");
  const beam = hi[2] - lo[2];
  expect(beam, "beam").toBeCloseTo(0.28, 3);
  expect(2 * SIDE_BY_SIDE - beam, "clearance between two hulls").toBeGreaterThan(0.02);

  // Narrower than the route ship it sits beside, since the cargo ship is the
  // one that doubles up.
  expect(beam).toBeLessThan(span(SHIPS, "Ship_route").hi[2] - span(SHIPS, "Ship_route").lo[2]);
});

test("the hold is the recess the harbour figures stand in", () => {
  // The settler and crew figures are authored elsewhere against these three
  // numbers; a hold re-cut to 0.30 x 0.16 would leave them on the coaming.
  const hold = span(VESSELS, "Cargo_hold");
  expect(hold.hi[0] - hold.lo[0], "hold length").toBeCloseTo(0.34, 4);
  expect(hold.hi[2] - hold.lo[2], "hold width").toBeCloseTo(0.18, 4);
  expect(hold.lo[1], "hold floor above the base").toBeCloseTo(0.06, 4);

  // A recess, not a tray: its floor is below the deck (the route ship's 0.20).
  const deck = span(VESSELS, "Cargo_hull").hi[1];
  expect(deck, "deck height").toBeCloseTo(0.2, 4);
  expect(deck, "the route ship's deck height exactly").toBeCloseTo(
    span(SHIPS, "Ship_route_hull").hi[1],
    4,
  );
  expect(deck - hold.lo[1], "recess depth").toBeCloseTo(0.14, 4);
  expect(hold.hi[1], "the hold opens at the deck").toBeCloseTo(deck, 4);

  // Centred on the edge midpoint, so a figure in it lands over the edge.
  expect(hold.lo[0] + hold.hi[0]).toBeCloseTo(0, 4);
  expect(hold.lo[2] + hold.hi[2]).toBeCloseTo(0, 4);
});

test("nothing but the coaming stands over the hold", () => {
  // Hence the mast stepped forward and the sail furled: the board is seen from
  // 56 degrees of elevation, so anything over the hold's footprint hides it.
  // Checked as footprint overlap.
  const hold = span(VESSELS, "Cargo_hold");
  const rim = span(VESSELS, "Cargo_coaming");
  // The coaming is the exception: it frames the opening and is allowed over it.
  expect(rim.lo[0], "the coaming brackets the hold").toBeLessThan(hold.lo[0]);
  expect(rim.hi[1], "the coaming stands proud of the deck").toBeGreaterThan(hold.hi[1]);

  const exempt = new Set(["Cargo_hull", "Cargo_hold", "Cargo_coaming"]);
  const above = partsOf(VESSELS, "Cargo_").filter((p) => !exempt.has(p));
  expect(above.length, "the rig and the castle are missing").toBeGreaterThan(3);
  for (const part of above) {
    const s = span(VESSELS, part);
    const overlaps = s.lo[0] < hold.hi[0] && s.hi[0] > hold.lo[0];
    expect(overlaps, `${part} stands over the open hold`).toBe(false);
  }
});

test("the cargo ship has a bow, and it is at +x", () => {
  // An edge is unordered, so `edgeRotationY` gives an axis, not a bearing; a
  // directional piece needs its layer to take a bearing elsewhere, as
  // `planCamels` does. The stem is wholly forward and the castle wholly aft.
  expect(span(VESSELS, "Cargo_prow").lo[0], "the stem is forward").toBeGreaterThan(0);
  expect(span(VESSELS, "Cargo_castle").hi[0], "the castle is aft").toBeLessThan(0);
  expect(span(VESSELS, "Cargo_mast").lo[0], "the mast is stepped forward").toBeGreaterThan(0);
});

// --- the corsair --------------------------------------------------------

test("the corsair is a hex-centre piece: centred on the origin, base at 0", () => {
  const { lo, hi } = span(VESSELS, "Corsair_");
  expect(lo[0] + hi[0], "off-centre along its length").toBeCloseTo(0, 3);
  expect(lo[2] + hi[2], "off-centre across its beam").toBeCloseTo(0, 3);
  expect(lo[1], "base plane").toBeCloseTo(0, 4);
  expect(hi[0] - lo[0], "length").toBeCloseTo(1.2, 3);
  expect(hi[1] - lo[1], "height").toBeCloseTo(0.9, 3);
});

test("the corsair clears the number chip", () => {
  // A chip mounts at (0, -1.5) in the piece's frame with a 1.05 keep-clear, so
  // a 1.2-long ship authored across the board would cover the number. Both
  // values come from their owning files (the socket from the generated
  // manifest, the radius from hexcontract.py).
  const socket = TILES["wood"].socket;
  expect(socket, "the manifest has no socket for a land tile").not.toBeNull();
  const [sx, , sz] = socket!;
  const keepClear = hexContract("KEEP_CLEAR_RADIUS");
  expect(keepClear).toBeCloseTo(1.05, 4);

  const { lo, hi } = span(VESSELS, "Corsair_");
  // Nearest approach from the piece's bounding box to the socket centre.
  const nx = Math.max(lo[0], Math.min(sx, hi[0]));
  const nz = Math.max(lo[2], Math.min(sz, hi[2]));
  expect(Math.hypot(nx - sx, nz - sz), "the corsair stands in the number").toBeGreaterThan(
    keepClear,
  );

  // It also stays inside a hex (3.0 across), so it can move onto any hex
  // without a per-tile exception.
  const reach = Math.max(...[lo, hi].flatMap((p) => [Math.abs(p[0]), Math.abs(p[2])]));
  expect(reach, "the corsair reaches past a 1.0 radius").toBeLessThan(1.0);

  // Under the prop ceiling, measured on the land surface (the higher of the
  // two it can be seated on).
  expect(SURFACE.land + hi[1]).toBeLessThan(hexContract("PROP_CEILING_Z"));
});

test("the corsair is a different ship from the Islands pirate, in outline", () => {
  // An Islands+Explorers game can show both, and at play distance only the
  // silhouette tells pieces apart: shorter, much beamier, a lower hull, and
  // taller overall because of the rig.
  const corsair = span(VESSELS, "Corsair_");
  const pirate = span(SHIPS, "Ship_pirate");
  expect(corsair.hi[0] - corsair.lo[0], "shorter").toBeLessThan(pirate.hi[0] - pirate.lo[0]);
  expect(corsair.hi[2] - corsair.lo[2], "beamier").toBeGreaterThan(
    (pirate.hi[2] - pirate.lo[2]) * 1.2,
  );
  expect(corsair.hi[1], "taller overall").toBeGreaterThan(pirate.hi[1]);
  expect(
    span(VESSELS, "Corsair_hull").hi[1],
    "the hull itself must be lower, not just narrower",
  ).toBeLessThan(span(SHIPS, "Ship_pirate_hull").hi[1]);

  // Two masts against one: a cue that survives as a dark shape.
  expect(partsOf(VESSELS, "Corsair_mast_").length, "two masts").toBe(2);
  expect(partsOf(SHIPS, "Ship_pirate_mast").length).toBe(1);

  // The sails are torn. A straight-hemmed sail plate has two distinct heights
  // (head and foot); this one is cut into steps. The raggedness must be in the
  // outline, since the sail reads as a dark shape on a light sea. Separate
  // boxes per mast read as a picket fence, so this checks the hem of one sheet.
  const heights = distinctHeights(VESSELS, "Corsair_sail_main");
  expect(heights.length, "the main sail's hem is straight").toBeGreaterThan(3);
  const foot = heights[0];
  const head = heights[heights.length - 1];
  expect(head - foot, "the sail has no depth to tear").toBeGreaterThan(0.15);
  // A sheet, not a post: wider across the beam than it is deep.
  const sail = span(VESSELS, "Corsair_sail_main");
  expect(sail.hi[2] - sail.lo[2], "the sail is taller than it is wide").toBeGreaterThan(
    sail.hi[1] - sail.lo[1],
  );
});

// --- both, and the house style ------------------------------------------

test("both vessels are seat-tinted and wear nothing else", () => {
  // `loader.test.ts` checks they carry a tint slot; this checks there is no
  // baked colour, so a `Mat_Vessel_*` part would not stay one colour for all
  // seats.
  const { gltf } = readGlb(VESSELS);
  const names = (gltf.materials ?? []).map((m) => m.name ?? "").sort();
  expect(names).toEqual(["Seat_Body", "Seat_Detail", "Seat_Shade"]);
});

test("both vessels are flat-shaded and within the ships budget", () => {
  expect(isFlatShaded(VESSELS, "Cargo_"), "the cargo ship is smooth-shaded").toBe(true);
  expect(isFlatShaded(VESSELS, "Corsair_"), "the corsair is smooth-shaded").toBe(true);

  // Banded so a shape can be revised, but a subdivision or smooth modifier
  // cannot slip in. The band is the family on the shipped files: route ship
  // 56 triangles, Islands pirate 136, camel 224, barbarian ship 432. These two
  // are 161 and 224.
  const cargo = triangleCount(VESSELS, "Cargo_");
  const corsair = triangleCount(VESSELS, "Corsair_");
  const barbarian = triangleCount(SHIPS, "Ship_barbarian");
  for (const [what, n] of [
    ["cargo ship", cargo],
    ["corsair", corsair],
  ] as const) {
    expect(n, `${what} triangles`).toBeGreaterThan(triangleCount(SHIPS, "Ship_route"));
    expect(n, `${what} triangles`).toBeLessThan(barbarian);
  }

  // One object per part, flat siblings, no parenting (unlike the knight's
  // sword).
  const { gltf } = readGlb(VESSELS);
  for (const node of gltf.nodes) {
    expect((node as { children?: number[] }).children ?? [], `${node.name} has children`).toEqual(
      [],
    );
  }
});
