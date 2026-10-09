// The Rivers bridge, measured off the shipped file.
//
// A bridge is a road that crosses a river: same edge, same owner, same slot.
// These check the ways it could fail to behave like one: authored across its
// edge instead of along it, lopsided so it faces backwards on some edges,
// seated on the wrong plane, or too similar to a road at game camera angle.
//
// Read straight from the GLB like `scenarioArt.test.ts` and
// `assetAnchors.test.ts`, since the loader needs WebGL.
//
// No layer draws this yet: `loader.ts` names the file in `RIVERS_MODELS` and
// stops there. The art is pinned anyway so it does not drift before the layer
// exists.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PIECE_PREFIX, PIECE_SCALE } from "./pieceArt";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies: what ships is meshopt-encoded and quantised, and this reads
// raw float32 positions and normals. See src/testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

const BRIDGES = "bridges.glb";
const PREFIX = "Bridge_";

/** The node name each part ships under, keyed by how this file refers to it. */
const PARTS = {
  span: "Bridge_span",
  rails: "Bridge_rails",
  abutments: "Bridge_abutments",
} as const;

/**
 * A parsed .glb: the JSON chunk and the raw BIN chunk.
 *
 * `any` on the JSON because typing the glTF schema here would restate the
 * spec; each read narrows at the point of use.
 */
interface Glb {
  json: Record<string, any>;
  bin: Buffer;
}

function readGlb(file: string): Glb {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  // Chunk 1 starts after chunk 0's 8-byte header and its (4-aligned) payload.
  const binStart = 20 + jsonLen + 8;
  const binLen = buf.readUInt32LE(20 + jsonLen);
  return { json, bin: buf.subarray(binStart, binStart + binLen) };
}

/** One accessor's elements, as flat arrays of `numbers`. */
function read(glb: Glb, index: number): number[][] {
  const acc = glb.json.accessors[index];
  const view = glb.json.bufferViews[acc.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type as string];
  expect(size, `unsupported accessor type ${acc.type}`).toBeDefined();
  const width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType as number];
  expect(width, `unsupported component type ${acc.componentType}`).toBeDefined();
  const stride = view.byteStride ?? size! * width!;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < acc.count; i++) {
    const el: number[] = [];
    for (let c = 0; c < size!; c++) {
      const at = base + i * stride + c * width!;
      el.push(
        acc.componentType === 5126
          ? glb.bin.readFloatLE(at)
          : acc.componentType === 5125
            ? glb.bin.readUInt32LE(at)
            : acc.componentType === 5123
              ? glb.bin.readUInt16LE(at)
              : glb.bin.readUInt8(at),
      );
    }
    out.push(el);
  }
  return out;
}

type Vec3 = [number, number, number];

interface Part {
  name: string;
  positions: Vec3[];
  normals: Vec3[];
  /** Triangles, as triples of indices into the two arrays above. */
  triangles: [number, number, number][];
  materials: string[];
}

/** Rotate `v` by the glTF quaternion `q` = [x, y, z, w]. */
function rotate(q: number[], v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + w * v), the standard expansion.
  const ix = y * v[2] - z * v[1] + w * v[0];
  const iy = z * v[0] - x * v[2] + w * v[1];
  const iz = x * v[1] - y * v[0] + w * v[2];
  const iw = -(x * v[0] + y * v[1] + z * v[2]);
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/**
 * Every node whose name starts `prefix`, with geometry in world space.
 *
 * The node rotation is applied. `Road_A` was modelled on an edge of the
 * showcase board, and the exporter cancels that 30 degrees with a node
 * transform while the mesh keeps the turn (`anchors.AUTHORED_TURN`). Ignoring
 * the quaternion would measure the road as 2.32 long instead of 1.96.
 */
function parts(glb: Glb, prefix: string): Part[] {
  const out: Part[] = [];
  for (const node of glb.json.nodes as Record<string, any>[]) {
    if (node.mesh === undefined) continue;
    const name: string = node.name ?? glb.json.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    const q = (node.rotation ?? [0, 0, 0, 1]) as number[];
    const t = (node.translation ?? [0, 0, 0]) as Vec3;
    const s = (node.scale ?? [1, 1, 1]) as Vec3;
    const part: Part = { name, positions: [], normals: [], triangles: [], materials: [] };
    for (const prim of glb.json.meshes[node.mesh].primitives) {
      expect(prim.mode ?? 4, `${name} is not triangles`).toBe(4);
      const offset = part.positions.length;
      for (const p of read(glb, prim.attributes.POSITION)) {
        const r = rotate(q, [p[0] * s[0], p[1] * s[1], p[2] * s[2]]);
        part.positions.push([r[0] + t[0], r[1] + t[1], r[2] + t[2]]);
      }
      for (const n of read(glb, prim.attributes.NORMAL)) part.normals.push(rotate(q, n as Vec3));
      const idx = read(glb, prim.indices).map((v) => v[0] + offset);
      for (let i = 0; i < idx.length; i += 3) {
        part.triangles.push([idx[i], idx[i + 1], idx[i + 2]]);
      }
      part.materials.push(glb.json.materials[prim.material].name);
    }
    out.push(part);
  }
  expect(out.length, `${prefix}: nothing found in the file`).toBeGreaterThan(0);
  return out;
}

interface Span {
  lo: Vec3;
  hi: Vec3;
}

function span(items: Part[]): Span {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of items) {
    for (const p of part.positions) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], p[i]);
        hi[i] = Math.max(hi[i], p[i]);
      }
    }
  }
  return { lo, hi };
}

const bridge = (): Part[] => parts(readGlb(BRIDGES), PREFIX);
const part = (key: keyof typeof PARTS): Part[] => parts(readGlb(BRIDGES), PARTS[key]);

/**
 * The piece plane: the top of a land tile, where everything modelled on a
 * tile starts (roads, the camel, the waypost).
 */
const PLANE = 0.25;

// --- the footprint ------------------------------------------------------

test("the bridge matches the road footprint", () => {
  // A bridge takes a road's slot, so it has the same length along the edge and
  // is no wider. Measured against the road so a re-authored road forces the
  // bridge to follow.
  const road = span(parts(readGlb("pieces.glb"), PIECE_PREFIX.road));
  const all = span(bridge());

  expect(all.hi[0] - all.lo[0], "length along the edge").toBeCloseTo(road.hi[0] - road.lo[0], 3);
  // Wider only by the abutments, within 0.30, or it touches neighbours at a
  // junction.
  const width = all.hi[2] - all.lo[2];
  expect(width).toBeGreaterThan(road.hi[2] - road.lo[2]);
  // 0.301: quantisation turns an authored 0.300 into 0.30004.
  expect(width, "across the edge").toBeLessThanOrEqual(0.301);
});

test("the bridge nodes carry no rotation", () => {
  // Unlike the road (which needs `anchors.AUTHORED_TURN`), the bridge is
  // generated at the origin along +x, so every node must have identity
  // rotation. Otherwise the renderer's turn would be added on top.
  for (const node of readGlb(BRIDGES).json.nodes as Record<string, unknown>[]) {
    if (node.mesh === undefined) continue;
    const name = String(node.name ?? "");
    if (!name.startsWith(PREFIX)) continue;
    const q = (node.rotation ?? [0, 0, 0, 1]) as number[];
    expect(Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]), `${name} is turned`).toBeLessThan(
      1e-6,
    );
  }
});

test("the bridge runs along +x", () => {
  const { lo, hi } = span(bridge());
  expect(hi[0] - lo[0], "longer than it is wide").toBeGreaterThan((hi[2] - lo[2]) * 4);
  // It straddles the origin along its length, because the origin is the edge
  // midpoint.
  expect(lo[0]).toBeLessThan(0);
  expect(hi[0]).toBeGreaterThan(0);
});

test("the bridge is mirror-symmetric", () => {
  // An Edge is an unordered pair and `edgeRotationY` derives an angle from its
  // endpoints, so swapping them turns the piece half a turn. The bridge must
  // be symmetric end to end; fix an asymmetric part rather than loosening the
  // tolerance.
  for (const key of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
    const { lo, hi } = span(part(key));
    expect(lo[0] + hi[0], `${PARTS[key]} is lopsided along the edge`).toBeCloseTo(0, 5);
    expect(lo[2] + hi[2], `${PARTS[key]} is lopsided across the edge`).toBeCloseTo(0, 5);
  }
});

test("the bridge stands on the piece plane", () => {
  // 0.25 is where pieces modelled on a tile start (see seating.ts and
  // loader.assetBaseY). Anchored at 0 like the knights, the seat call would
  // bury it.
  expect(span(bridge()).lo[1], "the bridge's foot").toBeCloseTo(PLANE, 4);
  // The abutments in particular, the only parts that touch down along their
  // whole length.
  expect(span(part("abutments")).lo[1]).toBeCloseTo(PLANE, 4);
});

// --- the arch -----------------------------------------------------------

test("the span has an open arch under its crown", () => {
  // An arch, not a bent road: `Bridge_span` is flat on the ground outboard of
  // the springings and open underneath between them. The opening reads in plan
  // as well as elevation, so it survives the 56-degree camera better than
  // height does.
  const masonry = part("span");
  const positions = masonry.flatMap((p) => p.positions);

  // At the crown the underside is clear of the ground by a real margin.
  const atCrown = positions.filter((p) => Math.abs(p[0]) < 0.05);
  expect(atCrown.length, "no geometry at the crown").toBeGreaterThan(0);
  const soffit = Math.min(...atCrown.map((p) => p[1]));
  expect(soffit - PLANE, "the arch opening at the crown").toBeGreaterThan(0.1);

  // At the springing it comes back to the ground, so the arch lands on
  // something.
  const atEnd = positions.filter((p) => Math.abs(p[0]) > 0.85);
  expect(Math.min(...atEnd.map((p) => p[1])), "the span meets the ground at its ends").toBeCloseTo(
    PLANE,
    4,
  );

  // The roadway rises 0.30 above the plane at the crown.
  expect(span(masonry).hi[1] - PLANE, "deck rise").toBeCloseTo(0.3, 4);
});

test("the parapets stand on the deck along its length", () => {
  // Two rails in Seat_Detail against the span's Seat_Body outline the bridge by
  // material where a cast shadow cannot (as the terrain rims do; see
  // art/README.md).
  const deck = span(part("span"));
  const rails = span(part("rails"));

  // They are the highest thing on the piece, above the deck's crown.
  expect(rails.hi[1], "rail top vs deck").toBeGreaterThan(deck.hi[1]);
  expect(rails.lo[1], "rail base vs deck").toBeGreaterThan(PLANE + 0.05);
  // Full length, so they read as part of the structure.
  expect(rails.hi[0] - rails.lo[0]).toBeCloseTo(deck.hi[0] - deck.lo[0], 4);
  // And they are the span's own edges, leaving a roadway between them.
  expect(rails.hi[2], "rail edge vs deck edge").toBeCloseTo(deck.hi[2], 4);
});

test("the abutments cap the parapets", () => {
  // Abutments cap the rail ends, in the same place as the road's end blocks so
  // the two pieces read as related. Seat_Shade rather than Seat_Detail, so a
  // dark foot under a light coping makes the arch look supported.
  const abut = span(part("abutments"));
  const rails = span(part("rails"));
  const all = span(bridge());

  expect(abut.hi[0], "abutment end vs piece end").toBeCloseTo(all.hi[0], 5);
  expect(abut.lo[0], "abutment end vs piece end").toBeCloseTo(all.lo[0], 5);
  // Taller than the rail ends they cap.
  const railEnd = Math.max(
    ...part("rails")
      .flatMap((p) => p.positions)
      .filter((p) => Math.abs(p[0]) > 0.85)
      .map((p) => p[1]),
  );
  expect(abut.hi[1], "abutment top vs rail end").toBeGreaterThan(railEnd);
  // Wider than the span, so they read as footings.
  expect(abut.hi[2]).toBeGreaterThan(rails.hi[2]);
});

// --- telling it apart from a road ---------------------------------------

test("a bridge stands much taller than a road", () => {
  // The board is seen from 56 degrees of elevation, so a vertical length
  // reaches the screen at cos(56) = 56% (up is 90 + 56 degrees from a ray
  // pointing 56 degrees down, and sin(146) = cos(56)).
  //
  // Both pieces use the road's scale (anything spanning an edge would overrun
  // neighbouring tiles if scaled up), so compare authored height times one
  // factor.
  const road = span(parts(readGlb("pieces.glb"), PIECE_PREFIX.road));
  const all = span(bridge());

  const roadRise = road.hi[1] - PLANE;
  const bridgeRise = all.hi[1] - PLANE;
  expect(roadRise, "road rise").toBeCloseTo(0.16, 4);
  // 2.28x the road's authored height; the arch is the other half of the
  // difference.
  expect(bridgeRise / roadRise, "bridge/road rise ratio").toBeGreaterThan(2.2);

  // On screen at game elevation and drawn scale: the bridge adds 0.132 of
  // height against a road 0.103 tall in total.
  const projected = (rise: number) => rise * PIECE_SCALE.road * Math.cos((56 * Math.PI) / 180);
  expect(
    projected(bridgeRise) - projected(roadRise),
    "the height difference that actually reaches the screen",
  ).toBeGreaterThan(projected(roadRise));
});

// --- house style --------------------------------------------------------

test("the bridge has three parts using the three seat slots", () => {
  // Only the shared Seat_* materials are recoloured per seat; an authored
  // Mat_Bridge_* would ship one colour for all players. The split follows the
  // robber's (art/README.md): Body the mass, Shade the plinths, Detail the
  // accent.
  const found = new Map(bridge().map((p) => [p.name, p.materials]));
  expect([...found.keys()].sort()).toEqual(["Bridge_abutments", "Bridge_rails", "Bridge_span"]);
  expect(found.get("Bridge_span")).toEqual(["Seat_Body"]);
  expect(found.get("Bridge_rails")).toEqual(["Seat_Detail"]);
  expect(found.get("Bridge_abutments")).toEqual(["Seat_Shade"]);
});

test("every face is flat-shaded within the face budget", () => {
  // No smooth shading on this board. Checked on the normals: a flat-shaded
  // triangle repeats one normal at all three corners.
  let triangles = 0;
  for (const p of bridge()) {
    triangles += p.triangles.length;
    for (const [a, b, c] of p.triangles) {
      for (let i = 0; i < 3; i++) {
        expect(p.normals[b][i], `${p.name} is smooth-shaded`).toBeCloseTo(p.normals[a][i], 4);
        expect(p.normals[c][i], `${p.name} is smooth-shaded`).toBeCloseTo(p.normals[a][i], 4);
      }
    }
  }
  // 82 faces as authored (18 for the span, 52 for the two parapets, 12 for the
  // abutments), triangulated to 188. Pinned exactly so a smoothing pass, bevel
  // or extra arch segments show up here. The road beside it has 18 faces; the
  // ceiling for a piece is 120.
  expect(triangles, "triangles in the shipped file").toBe(188);
});
