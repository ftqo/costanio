// The Explorers harbour art, measured off the shipped file.
//
// There is no Explorers layer to hold the art against yet, so this pins what
// the asset promises:
//
//   1. the quay is an add-on: it stands beside whatever building the player's
//      piece set draws on the vertex and never draws one itself;
//   2. it stands far enough off the vertex to clear the largest settlement and
//      city any shipped set can put there, at drawn scale;
//   3. the basin is a real recess with a floor at a known height;
//   4. the cargo slot matches the cargo ship's, so a figure moved between ship
//      and quay keeps its size and footing.
//
// (2) is why this opens the piece-set .glbs: a set is a drop-in (see
// `lib/pieceSets.ts`), so the quay must clear all of them.
//
// (4) is a contract with `art/vessels.blend`, written down as numbers only
// here and in `tools/blender/gen/harbors.py`.
//
// Read straight out of the plain GLB rather than through the loader, like
// `scenarioArt.test.ts` and `knightSwordArt.test.ts`: the loader needs WebGL and
// the shipped copies are meshopt-encoded. See testGlbFixtures.ts.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAIN_MODELS } from "@/testGlbFixtures";
import { PIECE_SETS } from "@/lib/pieceSets";
import { EXPLORERS_MODELS } from "./loader";
import { PIECE_SCALE } from "./pieceArt";

const FILE = "harbors.glb";

// Three decimals: `npm run models:compress` quantises positions to 16 bits per
// mesh range, so coordinates arrive about 1e-5 off. Real drift is in
// hundredths.

// --- the cargo slot ------------------------------------------------------
//
// Restated from `tools/blender/gen/harbors.py` in the renderer's axes. Blender
// is Z-up and glTF Y-up, so the generator's (x, y, z) arrives as (x, z, -y):
// the basin's 0.18 runs along X in both, its 0.34 along Blender's Y and glTF's
// Z, and its floor height is a Y here.
const SLOT_X = 0.18;
const SLOT_Z = 0.34;
const SLOT_FLOOR_Y = 0.06;
/** Centre of the basin, as an offset from the vertex the harbour stands on. */
const SLOT_CENTRE: [number, number] = [0.71, 0.0];

// --- the clearance -------------------------------------------------------
//
// The quay is drawn at the settlement's factor (vertex furniture, not a
// building). Read from PIECE_SCALE so a change there re-prices the clearance.
const QUAY_SCALE = PIECE_SCALE.settlement;

/**
 * The least gap, in world units, between the quay's near edge and the largest
 * thing a set can put on the vertex.
 *
 * The gap is what shows the dock is separate from the house; at the board's 56
 * degrees of elevation a tenth of a unit is about the narrowest strip that
 * still reads as ground.
 */
const MIN_GAP = 0.1;

interface Part {
  name: string;
  material: string;
  /** World-space vertices, node transform applied. */
  verts: [number, number, number][];
  /** Triangles as index triples into `verts`. */
  tris: [number, number, number][];
  /** Per-vertex normals, in the same order as `verts`. */
  normals: [number, number, number][];
}

/** Every mesh node of a plain .glb, keyed by name. */
function parts(file: string): Map<string, Part> {
  const buf = readFileSync(join(PLAIN_MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);

  // Walk the chunks: the JSON chunk is padded to four bytes, so
  // "20 + jsonLength" is the BIN chunk's header and only sometimes its data.
  let offset = 12;
  let json: Record<string, never> | null = null;
  let bin: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32LE(offset);
    const kind = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + len);
    if (kind === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
    if (kind === 0x004e4942) bin = body;
    offset += 8 + len + ((4 - (len % 4)) % 4);
  }
  expect(json, `${file} has no JSON chunk`).not.toBeNull();
  expect(bin, `${file} has no BIN chunk`).not.toBeNull();
  const g = json as unknown as {
    nodes: { name?: string; mesh?: number; translation?: number[]; scale?: number[] }[];
    meshes: {
      name?: string;
      primitives: { attributes: Record<string, number>; indices: number }[];
    }[];
    materials: { name: string }[];
    accessors: {
      bufferView: number;
      byteOffset?: number;
      componentType: number;
      count: number;
      type: string;
    }[];
    bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  };
  const data = bin as unknown as Buffer;

  const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  // Every component type glTF allows for the two things read here. Indices are
  // written at whatever width each mesh needs, so parts in one file can differ.
  const WIDTH: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  function read(index: number): number[] {
    const acc = g.accessors[index];
    const view = g.bufferViews[acc.bufferView];
    const n = SIZE[acc.type];
    const width = WIDTH[acc.componentType];
    expect(width, `unhandled componentType ${acc.componentType}`).toBeDefined();
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = view.byteStride ?? n * width;
    const out: number[] = [];
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < n; c++) {
        const at = base + i * stride + c * width;
        out.push(
          acc.componentType === 5126
            ? data.readFloatLE(at)
            : acc.componentType === 5125
              ? data.readUInt32LE(at)
              : acc.componentType === 5123
                ? data.readUInt16LE(at)
                : acc.componentType === 5122
                  ? data.readInt16LE(at)
                  : acc.componentType === 5120
                    ? data.readInt8(at)
                    : data.readUInt8(at),
        );
      }
    }
    return out;
  }
  function vec3(index: number): [number, number, number][] {
    const flat = read(index);
    const out: [number, number, number][] = [];
    for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
    return out;
  }

  const found = new Map<string, Part>();
  for (const node of g.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = g.meshes[node.mesh];
    const name = node.name ?? mesh.name ?? "";
    const t = node.translation ?? [0, 0, 0];
    const s = node.scale ?? [1, 1, 1];
    const verts: [number, number, number][] = [];
    const normals: [number, number, number][] = [];
    const tris: [number, number, number][] = [];
    const materials = new Set<string>();
    for (const prim of mesh.primitives) {
      const base = verts.length;
      for (const v of vec3(prim.attributes.POSITION)) {
        verts.push([v[0] * s[0] + t[0], v[1] * s[1] + t[1], v[2] * s[2] + t[2]]);
      }
      for (const n of vec3(prim.attributes.NORMAL)) normals.push(n);
      const idx = read(prim.indices);
      for (let i = 0; i < idx.length; i += 3) {
        tris.push([base + idx[i], base + idx[i + 1], base + idx[i + 2]]);
      }
      materials.add(g.materials[(prim as unknown as { material: number }).material].name);
    }
    expect(materials.size, `${name} wears more than one material`).toBe(1);
    found.set(name, { name, material: [...materials][0], verts, tris, normals });
  }
  expect(found.size, `${file} parsed to no meshes`).toBeGreaterThan(0);
  return found;
}

const HARBOR = parts(FILE);

/** Axis-aligned bounds of every part of `file` whose name starts with `prefix`. */
function spanIn(
  from: Map<string, Part>,
  prefix: string,
): { lo: [number, number, number]; hi: [number, number, number] } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = 0;
  for (const part of from.values()) {
    if (!part.name.startsWith(prefix)) continue;
    found++;
    for (const v of part.verts) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], v[i]);
        hi[i] = Math.max(hi[i], v[i]);
      }
    }
  }
  expect(found, `${prefix}: nothing found`).toBeGreaterThan(0);
  return { lo, hi };
}

function span(prefix: string): { lo: [number, number, number]; hi: [number, number, number] } {
  return spanIn(HARBOR, prefix);
}

// --- what ships ----------------------------------------------------------

test("the file is listed in the manifest constant", () => {
  // With no Explorers module, the manifest constant is the only route from
  // source to this file.
  expect(EXPLORERS_MODELS).toContain(FILE);
});

test("three items, ten parts, and no building among them", () => {
  // The names are the contract. No `Harbor_wall`, `Harbor_roof` or
  // `Harbor_trim`: the building on the vertex comes from the player's piece
  // set, and this file supplies only the dock.
  //
  // Every part is seat-tinted; a quay and its cargo belong to someone, so a
  // stray `Mat_*` would ship as an unrestylable shared colour.
  const names = [...HARBOR.keys()].sort();
  expect(names).toEqual([
    "Crew_body",
    "Crew_head",
    "Crew_sash",
    "Harbor_bollard",
    "Harbor_crate",
    "Harbor_derrick",
    "Harbor_quay",
    "Settler_body",
    "Settler_hat",
    "Settler_head",
  ]);
  for (const part of HARBOR.values()) {
    expect(part.material, `${part.name} is not seat-tinted`).toMatch(/^Seat_(Body|Shade|Detail)$/);
  }
  // All three slots are used on each item, so a piece recolours as a
  // structure rather than a silhouette.
  for (const prefix of ["Harbor_", "Settler_", "Crew_"]) {
    const used = new Set(
      [...HARBOR.values()].filter((p) => p.name.startsWith(prefix)).map((p) => p.material),
    );
    expect([...used].sort(), `${prefix} does not use all three tint slots`).toEqual([
      "Seat_Body",
      "Seat_Detail",
      "Seat_Shade",
    ]);
  }
});

test("every face is flat-shaded", () => {
  // Blender defaults to smooth shading, which makes a low-poly piece look
  // melted. Asserted per triangle: flat shading means a face's three corners
  // share one normal.
  for (const part of HARBOR.values()) {
    for (const [a, b, c] of part.tris) {
      for (let i = 0; i < 3; i++) {
        expect(part.normals[b][i], `${part.name} is smooth-shaded`).toBeCloseTo(
          part.normals[a][i],
          5,
        );
        expect(part.normals[c][i], `${part.name} is smooth-shaded`).toBeCloseTo(
          part.normals[a][i],
          5,
        );
      }
    }
  }
});

test("the family is between 200 and 600 triangles", () => {
  // 138 faces across three items, a quarter of one tile. Pinned loosely: a
  // subdivided or bevelled rebuild would be an order of magnitude off.
  const tris = [...HARBOR.values()].reduce((n, p) => n + p.tris.length, 0);
  expect(tris).toBeLessThan(600);
  expect(tris).toBeGreaterThan(200);
});

// --- the quay is an add-on ----------------------------------------------

test("the harbour stands on y = 0, the plane the knights and ships stand on", () => {
  // Not the plane pieces.glb uses. Settlements start at 0.25; everything
  // authored in its own file since (knights, metropolises, ships, merchant)
  // starts at 0, and `assetBaseY` reads whichever off the art.
  for (const prefix of ["Harbor_", "Settler_", "Crew_"]) {
    expect(spanIn(HARBOR, prefix).lo[1], `${prefix} does not start at y = 0`).toBeCloseTo(0, 4);
  }
});

test("nothing on the quay reaches back over the vertex", () => {
  // The vertex is where the building goes. Asserted on every vertex of every
  // part, since a jib or gangplank is what would creep back over the origin.
  const whole = span("Harbor_");
  expect(whole.lo[0], "the quay reaches back toward the vertex").toBeCloseTo(0.5, 3);
  for (const part of HARBOR.values()) {
    if (!part.name.startsWith("Harbor_")) continue;
    for (const v of part.verts) {
      expect(v[0], `${part.name} reaches back past the quay's near edge`).toBeGreaterThanOrEqual(
        whole.lo[0] - 1e-3,
      );
    }
  }
  // Seaward is +x (yaw zero means water at +x). The near edge is perpendicular
  // to x and the deck is centred on z = 0, so that edge is the closest approach
  // at every yaw and the clearance is one number.
  expect(whole.lo[2] + whole.hi[2], "the deck is off-centre across the water line").toBeCloseTo(
    0,
    4,
  );
  // The envelope a placement has to reserve on the board, in authored units.
  expect(whole.hi[0] - whole.lo[0], "footprint along x").toBeCloseTo(0.42, 3);
  expect(whole.hi[2] - whole.lo[2], "footprint along z").toBeCloseTo(0.55, 3);
});

test("the quay clears the largest settlement and city of every set", () => {
  // Every set in `PIECE_SETS` is a drop-in for the stock one, so the quay has
  // to miss all of their buildings, at drawn size, at any yaw.
  //
  // Radius, not a box half-width: the building takes its family's yaw and the
  // quay the bearing of the water, so only distance from the shared vertex
  // holds for every combination.
  const nearEdge = span("Harbor_").lo[0] * QUAY_SCALE;

  let worst = 0;
  let worstName = "";
  for (const { file } of Object.values(PIECE_SETS)) {
    const set = parts(file);
    for (const [kind, prefix] of [
      ["settlement", "Settlement_A"],
      ["city", "City_A"],
    ] as const) {
      let radius = 0;
      for (const part of set.values()) {
        if (!part.name.startsWith(prefix)) continue;
        for (const v of part.verts) radius = Math.max(radius, Math.hypot(v[0], v[2]));
      }
      expect(radius, `${file} has no ${prefix}`).toBeGreaterThan(0);
      const drawn = radius * PIECE_SCALE[kind];
      expect(
        drawn,
        `${file} ${kind} reaches ${drawn.toFixed(3)}, past the quay at ${nearEdge.toFixed(3)}`,
      ).toBeLessThan(nearEdge - MIN_GAP);
      if (drawn > worst) {
        worst = drawn;
        worstName = `${file} ${kind}`;
      }
    }
  }
  // The binding case: the stock city, drawn at 2.58, reaches 0.834.
  expect(worstName).toBe("pieces.glb city");
  expect(worst, "the stock city's drawn radius").toBeCloseTo(0.834, 3);
  expect(nearEdge, "the quay's near edge, drawn").toBeCloseTo(1.0, 3);
});

// --- the deck ------------------------------------------------------------

test("the deck is low and the derrick is what carries the silhouette", () => {
  const quay = span("Harbor_quay");
  // Low, so the cargo stays visible from a camera 56 degrees above the board.
  expect(quay.hi[1], "the deck").toBeCloseTo(0.14, 3);
  // The mooring derrick gives the piece height: a mast with a jib arm over the
  // water, in `Seat_Body` so the seat colour is on the most visible part. The
  // arm keeps it from reading as a third cargo figure.
  const derrick = span("Harbor_derrick");
  expect(derrick.hi[1], "the derrick is the tallest thing on the quay").toBeCloseTo(0.46, 3);
  expect(derrick.hi[1]).toBeGreaterThan(span("Harbor_").hi[1] - 1e-3);
  expect(HARBOR.get("Harbor_derrick")!.material).toBe("Seat_Body");
  expect(derrick.hi[0] - derrick.lo[0], "the jib reaches out over the water").toBeGreaterThan(0.25);
  // The crates sit landward of the basin and the derrick's arm hangs seaward,
  // which shows which end the water is at.
  expect(span("Harbor_crate").hi[0], "the crates are not at the landward end").toBeLessThan(
    SLOT_CENTRE[0],
  );
});

// --- the basin ----------------------------------------------------------

test("the basin is a recess at the cargo ship's size and depth", () => {
  // The contract with `art/vessels.blend`. A bounding box cannot see a hole,
  // so this reads the vertices: the pocket has four corners at floor height.
  const quay = HARBOR.get("Harbor_quay")!;
  // By position, not vertex: flat shading splits each corner into one vertex
  // per face (a floor and two walls).
  const floor = [
    ...new Set(
      quay.verts
        .filter((v) => Math.abs(v[1] - SLOT_FLOOR_Y) < 1e-3)
        .map((v) => `${v[0].toFixed(3)},${v[2].toFixed(3)}`),
    ),
  ].map((k) => k.split(",").map(Number));
  expect(floor.length, "deck pocket floor faces").toBe(4);

  const xs = floor.map((v) => v[0]);
  const zs = floor.map((v) => v[1]);
  expect(Math.max(...xs) - Math.min(...xs), "slot along x").toBeCloseTo(SLOT_X, 3);
  expect(Math.max(...zs) - Math.min(...zs), "slot along z").toBeCloseTo(SLOT_Z, 3);
  expect((Math.max(...xs) + Math.min(...xs)) / 2, "slot centre x").toBeCloseTo(SLOT_CENTRE[0], 3);
  expect((Math.max(...zs) + Math.min(...zs)) / 2, "slot centre z").toBeCloseTo(SLOT_CENTRE[1], 3);
  // Equidistant from both ends of the deck, so a loaded basin looks moored.
  const deck = span("Harbor_quay");
  expect(Math.min(...xs) - deck.lo[0], "landward margin").toBeCloseTo(
    deck.hi[0] - Math.max(...xs),
    3,
  );

  // A recess: the floor is below the deck by enough that a figure in it looks
  // held rather than perched.
  expect(deck.hi[1] - SLOT_FLOOR_Y, "recess depth").toBeCloseTo(0.08, 3);

  // Every other part of the harbour clears the slot's column, so a dropped
  // figure is not inside the bollards or under the hoist block.
  for (const part of HARBOR.values()) {
    if (!part.name.startsWith("Harbor_") || part.name === "Harbor_quay") continue;
    const inside = part.verts.some(
      (v) =>
        Math.abs(v[0] - SLOT_CENTRE[0]) < SLOT_X / 2 &&
        Math.abs(v[2] - SLOT_CENTRE[1]) < SLOT_Z / 2 &&
        v[1] > SLOT_FLOOR_Y,
    );
    expect(inside, `${part.name} stands in the basin`).toBe(false);
  }
});

test("one settler fills the basin, and two crew fit abreast in it", () => {
  // The cargo pieces must fit the slot.
  const settler = span("Settler_");
  const body = span("Settler_body");
  const crew = span("Crew_");

  // The settler's body must fit between the basin walls. The hat is wider on
  // purpose: the brim rides above the rim.
  expect(body.hi[0] - body.lo[0], "settler body width").toBeLessThan(SLOT_X);
  expect(settler.hi[0] - settler.lo[0], "the hat is what makes it read").toBeCloseTo(0.16, 3);
  expect(settler.hi[0] - settler.lo[0]).toBeGreaterThan(body.hi[0] - body.lo[0]);
  const brimY = span("Settler_hat").lo[1];
  expect(brimY, "the brim would foul the rim").toBeGreaterThan(span("Harbor_quay").hi[1]);

  // Two crew side by side across the slot's long axis: 0.11 each in 0.34
  // leaves 0.12 of clearance.
  const wide = crew.hi[2] - crew.lo[2];
  expect(wide, "crew width").toBeCloseTo(0.11, 3);
  expect(2 * wide, "two crew abreast do not fit").toBeLessThan(SLOT_Z);
  expect(SLOT_Z - 2 * wide, "two crew fit only just").toBeGreaterThan(0.08);
  // A settler is bigger than one crew in every axis ("large" vs "small" cargo).
  expect(settler.hi[1]).toBeCloseTo(0.32, 3);
  expect(crew.hi[1]).toBeCloseTo(0.22, 3);
  expect(settler.hi[1]).toBeGreaterThan(crew.hi[1]);
});

test("a settler in the basin stays below the derrick", () => {
  // Why the basin floor is sunk: the cargo must not be the tallest thing on
  // the quay (the derrick is), or it reads as the building.
  const mast = span("Harbor_derrick").hi[1];
  const settler = span("Settler_").hi[1];
  expect(SLOT_FLOOR_Y + settler, "a loaded settler overtops the derrick").toBeLessThan(mast);
  expect(mast - (SLOT_FLOOR_Y + settler), "and it is not lost behind it").toBeLessThan(0.1);
  // Two crew still clear the deck in front of them, so a loaded basin is
  // legible from the side.
  expect(SLOT_FLOOR_Y + span("Crew_").hi[1]).toBeGreaterThan(span("Harbor_quay").hi[1]);
});

test("the cargo figures are centred on their origin", () => {
  // A layer drops a figure at the harbour's (or ship's) position plus the slot
  // offset, so each figure's origin must be the middle of its footprint. Not
  // everything on the board is authored that way (the weir is off-centre).
  for (const prefix of ["Settler_", "Crew_"]) {
    const { lo, hi } = span(prefix);
    expect(lo[0] + hi[0], `${prefix} is off-centre along x`).toBeCloseTo(0, 4);
    expect(lo[2] + hi[2], `${prefix} is off-centre along z`).toBeCloseTo(0, 4);
  }
});
