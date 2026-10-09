// The river tiles, measured off the shipped files.
//
// `make check-hexes` holds every tile, rivers included, to the slab, socket,
// gutter and height contract. This file covers what a channel adds, measured
// on the exported file (the exporter recentres tiles, and none of it shows in
// Blender):
//
//   1. The channel meets the tile boundary exactly at the edge midpoint, or two
//      river hexes side by side show a step in the water.
//   2. The bank at that mouth is at or below 0.220, the gutter sand's height.
//      `art/bridges` puts a deck at 0.250, and a higher bank would poke through.
//   3. The water surface is below the slab's top face (0.220), so the channel
//      reads as cut rather than painted. See the Rivers section of
//      `art/README.md`.
//   4. The channel clears the chip. Every chip mounts at one fixed tile-local
//      spot, (0, +1.5) in the blend frame, and does not turn when a tile is
//      yawed, so a channel clear of it on one bearing can cross it on another.
//      The clearance is checked per shape here.
//
// Read straight out of the GLB, as `scenarioArt.test.ts` and `knightSwordArt.test.ts`
// do, from the plain copies: what ships is meshopt-encoded and this file parses
// the container.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAIN_MODELS } from "@/testGlbFixtures";
import { TILES } from "./manifest.generated";
import {
  RIVER_FAMILIES,
  RIVER_TILES,
  RIVER_TILE_FAMILIES,
  RIVER_TILE_SHAPES,
  SWAMP_TILE,
  type ChannelShape,
  type RiverFamily,
  type SourceShape,
} from "./layers/rivers";
import { CHIP_OFFSET_Z } from "./layers/chips";
import { TILE_ROTATION_Y } from "./coords";

/** Hex circumradius the tile art is drawn at, and its apothem. */
const HEX = 3.0;
const APOTHEM = (HEX * Math.sqrt(3)) / 2;

/** What `hexcontract` and `lattice` fix, restated as the renderer sees them. */
const SLAB_TOP_Y = 0.22;
const SLAB_BOTTOM_Y = -0.25;
/** Where `art/bridges` will put a deck. */
const BRIDGE_DECK_Y = 0.25;

interface Mesh {
  name: string;
  position: [number, number, number][];
  normal: [number, number, number][];
  triangles: number;
  materials: string[];
  /**
   * The triangle list, as indices into `position` and flattened across the
   * node's primitives. Needed for claims about the shape of the water (one
   * river or several), which a point cloud can't answer. See "a headwater
   * carries one river".
   */
  indices: number[];
  /**
   * Which material each run of `indices` was drawn with: one entry per
   * primitive, as a half-open range into `indices`. The tarn test needs to know
   * which triangles are the light sheet and which the dark disc of the one
   * `_water` mesh.
   */
  primitives: { material: string; start: number; count: number }[];
}

function readGlb(file: string): Mesh[] {
  const buf = readFileSync(join(PLAIN_MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  // The BIN chunk follows the JSON one, each with an 8-byte header.
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart);

  const vec3 = (index: number | undefined): [number, number, number][] => {
    if (index === undefined) return [];
    const acc = gltf.accessors[index];
    const view = gltf.bufferViews[acc.bufferView];
    const stride = view.byteStride ?? 12;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const out: [number, number, number][] = [];
    for (let i = 0; i < acc.count; i++) {
      const at = base + i * stride;
      out.push([bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)]);
    }
    return out;
  };

  // The index accessor is SCALAR in any of the three unsigned widths (the
  // exporter picks the narrowest, so all occur). `byteStride` is read rather
  // than assumed; a tightly packed view reports none.
  const scalars = (index: number): number[] => {
    const acc = gltf.accessors[index];
    const view = gltf.bufferViews[acc.bufferView];
    const width = acc.componentType === 5125 ? 4 : acc.componentType === 5123 ? 2 : 1;
    const stride = view.byteStride ?? width;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const out: number[] = [];
    for (let i = 0; i < acc.count; i++) {
      const at = base + i * stride;
      out.push(
        width === 4 ? bin.readUInt32LE(at) : width === 2 ? bin.readUInt16LE(at) : bin.readUInt8(at),
      );
    }
    return out;
  };

  const out: Mesh[] = [];
  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = gltf.meshes[node.mesh];
    // Nodes are placed by transform; a rotated child would falsify every height
    // below. The exporter never rotates them, so this asserts rather than
    // corrects.
    expect(node.rotation ?? [0, 0, 0, 1], `${mesh.name} is rotated`).toEqual([0, 0, 0, 1]);
    const t = (node.translation ?? [0, 0, 0]) as [number, number, number];
    const s = (node.scale ?? [1, 1, 1]) as [number, number, number];
    const position: [number, number, number][] = [];
    const normal: [number, number, number][] = [];
    let triangles = 0;
    const materials: string[] = [];
    const indices: number[] = [];
    const primitives: Mesh["primitives"] = [];
    for (const prim of mesh.primitives) {
      // Each primitive indexes its own vertices from zero; offset by what is
      // already in the concatenated list.
      const base = position.length;
      for (const p of vec3(prim.attributes.POSITION)) {
        position.push([p[0] * s[0] + t[0], p[1] * s[1] + t[1], p[2] * s[2] + t[2]]);
      }
      normal.push(...vec3(prim.attributes.NORMAL));
      triangles += gltf.accessors[prim.indices].count / 3;
      const start = indices.length;
      for (const i of scalars(prim.indices)) indices.push(base + i);
      const material = gltf.materials?.[prim.material]?.name;
      if (material) materials.push(material);
      primitives.push({ material: material ?? "", start, count: indices.length - start });
    }
    out.push({
      name: node.name ?? mesh.name,
      position,
      normal,
      triangles,
      materials,
      indices,
      primitives,
    });
  }
  expect(out.length, `${file} parsed to no meshes`).toBeGreaterThan(0);
  return out;
}

/**
 * Hexagonal radius of a point on the tile: 1.0 exactly on the tile's boundary.
 *
 * glTF is Y-up with the board in XZ. A pointy-top hex has corners at
 * 90 + 60k degrees, so its edge normals are at 60k; the max projection onto
 * them is the hexagonal norm.
 */
function hexRadius(x: number, z: number): number {
  let best = 0;
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    best = Math.max(best, (x * Math.cos(a) - z * Math.sin(a)) / APOTHEM);
  }
  return best;
}

/** Midpoint of edge `edge` in glTF coordinates. Edge 0 is the +x edge. */
function edgeMidpoint(edge: number): [number, number] {
  const a = (Math.PI / 3) * edge;
  return [APOTHEM * Math.cos(a), -APOTHEM * Math.sin(a)];
}

/**
 * Which two edges each authored channel opens on, as art edge indices.
 *
 * Hand-written on purpose: `artEdges` derives the same thing from the shape id,
 * and "every shape's mouths are where its name says" checks the two agree, so
 * a conversion bug can't rewrite both expectation and measurement.
 */
const MOUTHS: Record<string, number[]> = {};

/**
 * The mountains family, by the sorted compass pair of its two mouths.
 *
 * The art edge index is the mouth's blend angle divided by 60. The chip socket
 * is at blend 90, flanked by 60 and 120, so board E=180, NE=240, NW=300, W=0,
 * SW=60, SE=120.
 *
 * `src_*` have one mouth: a headwater fans into rivulets and ends at a tarn,
 * with no bridge site on any other edge.
 */
const SHAPE_EDGES: Record<string, number[]> = {
  river_mountains_e_w_a: [3, 0],
  river_mountains_e_w_b: [3, 0],
  river_mountains_ne_sw: [4, 1],
  river_mountains_nw_se: [5, 2],
  river_mountains_ne_w: [4, 0],
  river_mountains_e_nw: [3, 5],
  river_mountains_e_sw: [3, 1],
  river_mountains_w_se: [0, 2],
  river_mountains_ne_se: [4, 2],
  river_mountains_nw_sw: [5, 1],
  river_mountains_src_e: [3],
  river_mountains_src_w: [0],
  river_mountains_src_ne: [4],
  river_mountains_src_nw: [5],
  river_mountains_src_se: [2],
  river_mountains_src_sw: [1],
  // The hills family, same table and channel. Ten: no plain `e_w` (the straight
  // ships as its two meanders, see `riverTileKey`) and no `src_*`
  // (`engine/rivers.paint` puts mountains at every source hex).
  river_hills_e_w_a: [3, 0],
  river_hills_e_w_b: [3, 0],
  river_hills_ne_sw: [4, 1],
  river_hills_nw_se: [5, 2],
  river_hills_ne_w: [4, 0],
  river_hills_e_nw: [3, 5],
  river_hills_e_sw: [3, 1],
  river_hills_w_se: [0, 2],
  river_hills_ne_se: [4, 2],
  river_hills_nw_sw: [5, 1],
  // The pasture: ten, for the same two reasons.
  river_pasture_e_w_a: [3, 0],
  river_pasture_e_w_b: [3, 0],
  river_pasture_ne_sw: [4, 1],
  river_pasture_nw_se: [5, 2],
  river_pasture_ne_w: [4, 0],
  river_pasture_e_nw: [3, 5],
  river_pasture_e_sw: [3, 1],
  river_pasture_w_se: [0, 2],
  river_pasture_ne_se: [4, 2],
  river_pasture_nw_sw: [5, 1],
  // The swamp: ten, for the same reasons. Three of these are what the rules
  // draw at a river's mouth (`swamp_river*` is gone; see
  // `RIVER_STRAIGHT_TILES`).
  river_swamp_e_w_a: [3, 0],
  river_swamp_e_w_b: [3, 0],
  river_swamp_ne_sw: [4, 1],
  river_swamp_nw_se: [5, 2],
  river_swamp_ne_w: [4, 0],
  river_swamp_e_nw: [3, 5],
  river_swamp_e_sw: [3, 1],
  river_swamp_w_se: [0, 2],
  river_swamp_ne_se: [4, 2],
  river_swamp_nw_sw: [5, 1],
  // The two recipe-built families (`make compose-tiles`, art/recipes/): the
  // pasture's channel composed into the forest and fields tiles.
  river_forest_e_w_a: [3, 0],
  river_forest_e_w_b: [3, 0],
  river_forest_ne_sw: [4, 1],
  river_forest_nw_se: [5, 2],
  river_forest_ne_w: [4, 0],
  river_forest_e_nw: [3, 5],
  river_forest_e_sw: [3, 1],
  river_forest_w_se: [0, 2],
  river_forest_ne_se: [4, 2],
  river_forest_nw_sw: [5, 1],
  river_fields_e_w_a: [3, 0],
  river_fields_e_w_b: [3, 0],
  river_fields_ne_sw: [4, 1],
  river_fields_nw_se: [5, 2],
  river_fields_ne_w: [4, 0],
  river_fields_e_nw: [3, 5],
  river_fields_e_sw: [3, 1],
  river_fields_w_se: [0, 2],
  river_fields_ne_se: [4, 2],
  river_fields_nw_sw: [5, 1],
};
for (const [tile, edges] of Object.entries(SHAPE_EDGES)) MOUTHS[tile] = edges;

/**
 * The two board directions a shape's mouths sit on, from its id: `e_w` is east
 * and west, `ne_sw` north-east and south-west; a `src_*` has one mouth. The ids
 * are the engine's, in the board frame.
 */
const DIRECTION = ["e", "ne", "nw", "w", "sw", "se"];

function shapeDirs(shape: ChannelShape | SourceShape): number[] {
  if (shape.startsWith("src_")) return [DIRECTION.indexOf(shape.slice(4))];
  return shape.split("_").map((d) => DIRECTION.indexOf(d));
}

/**
 * Which art edges a shape's mouths are cut on.
 *
 * Art edge `e` lands on board direction `e + 3` (mod 6), because a tile is laid
 * at `TILE_ROTATION_Y`, a half turn. So board direction `d` is authored on art
 * edge `d + 3`.
 */
function artEdges(shape: ChannelShape | SourceShape): number[] {
  return shapeDirs(shape).map((d) => (d + 3) % 6);
}

/**
 * Every river tile the manifest holds.
 *
 * Driven off the manifest so a tile that stops being exported fails rather than
 * silently drops out. `SHIPPED` pins the count so the filter can't quietly
 * empty.
 */
const PRESENT: string[] = RIVER_TILES.filter((tile) => TILES[tile] !== undefined);

/** How many river tiles ship: sixty-six channels (twenty of them composed) and the marsh. */
const SHIPPED = 67;

/** Every tile with a channel in it, which is all of them but the marsh. */
const WIDE_TILES: readonly string[] = PRESENT.filter((tile) => tile !== SWAMP_TILE);
const CHANNELLED = WIDE_TILES;
/** Every river tile, for the checks that are about the tile and not the water. */
const ALL_RIVER_TILES: readonly string[] = PRESENT;

/** The channelled tiles of one terrain, read off the renderer's own table. */
const familyTiles = (family: RiverFamily): string[] =>
  WIDE_TILES.filter((tile) => RIVER_TILE_FAMILIES[tile] === family);

const RIVER_MOUNTAINS_SHAPE_TILES = familyTiles("mountains");
const RIVER_HILLS_SHAPE_TILES = familyTiles("hills");
const RIVER_PASTURE_SHAPE_TILES = familyTiles("pasture");
const RIVER_SWAMP_SHAPE_TILES = familyTiles("swamp");
const RIVER_FOREST_SHAPE_TILES = familyTiles("forest");
const RIVER_FIELDS_SHAPE_TILES = familyTiles("fields");

test("every river tile the manifest holds is measured here", () => {
  // A test driven off the manifest measures nothing if the manifest empties,
  // so the count is pinned.
  expect(PRESENT).toHaveLength(SHIPPED);
  expect(WIDE_TILES).toHaveLength(SHIPPED - 1);
  for (const tile of PRESENT) {
    expect(
      RIVER_TILE_SHAPES[tile] ?? (tile === SWAMP_TILE ? "marsh" : undefined),
      tile,
    ).toBeDefined();
  }
  // Every family is present, so no per-family test below can be vacuous.
  expect(new Set(PRESENT.map((t) => RIVER_TILE_FAMILIES[t]))).toEqual(new Set(RIVER_FAMILIES));
  expect(RIVER_MOUNTAINS_SHAPE_TILES).toHaveLength(16);
  for (const ten of [
    RIVER_HILLS_SHAPE_TILES,
    RIVER_PASTURE_SHAPE_TILES,
    RIVER_SWAMP_SHAPE_TILES,
    RIVER_FOREST_SHAPE_TILES,
    RIVER_FIELDS_SHAPE_TILES,
  ]) {
    expect(ten).toHaveLength(10);
  }
});

test("every shape's mouths are where its name says, in both frames", () => {
  // `SHAPE_EDGES` is hand-written, so check it against the rule (board
  // direction `d` on art edge `d + 3`). If both the art and the table were read
  // wrongly the same way, every claim here would be rotated and still pass.
  expect(Object.keys(SHAPE_EDGES).sort()).toEqual([...WIDE_TILES].sort());
  for (const tile of WIDE_TILES) {
    expect(SHAPE_EDGES[tile], tile).toEqual(artEdges(RIVER_TILE_SHAPES[tile]));
  }
});

/**
 * Half the water at a mouth. One number on every tile of every family.
 *
 * The channel is 0.60 bank to bank. The tightest mouth is 1.500 from the chip
 * mount, so water up to 2 * (1.500 - 1.050) = 0.900 would still clear the
 * keep-clear circle. (The earlier 0.42 tiles were deleted, so there is no
 * second width to match.)
 */
const HALF_CHANNEL_AT_MOUTH = 0.3;

/** Every original beside the mirror that is drawn from it. */
const MIRROR_PAIRS: readonly (readonly [string, string])[] = [
  ["river_mountains_e_w_a", "river_mountains_e_w_b"] as const,
  ["river_mountains_ne_sw", "river_mountains_nw_se"] as const,
  ["river_mountains_ne_w", "river_mountains_e_nw"] as const,
  ["river_mountains_e_sw", "river_mountains_w_se"] as const,
  ["river_mountains_ne_se", "river_mountains_nw_sw"] as const,
  ["river_mountains_src_e", "river_mountains_src_w"] as const,
  ["river_mountains_src_sw", "river_mountains_src_se"] as const,
  ["river_mountains_src_ne", "river_mountains_src_nw"] as const,
  ["river_hills_e_w_a", "river_hills_e_w_b"] as const,
  ["river_hills_ne_sw", "river_hills_nw_se"] as const,
  ["river_hills_ne_w", "river_hills_e_nw"] as const,
  ["river_hills_e_sw", "river_hills_w_se"] as const,
  ["river_hills_ne_se", "river_hills_nw_sw"] as const,
  ["river_pasture_e_w_a", "river_pasture_e_w_b"] as const,
  ["river_pasture_ne_sw", "river_pasture_nw_se"] as const,
  ["river_pasture_ne_w", "river_pasture_e_nw"] as const,
  ["river_pasture_e_sw", "river_pasture_w_se"] as const,
  ["river_pasture_ne_se", "river_pasture_nw_sw"] as const,
  ["river_swamp_e_w_a", "river_swamp_e_w_b"] as const,
  ["river_swamp_ne_sw", "river_swamp_nw_se"] as const,
  ["river_swamp_ne_w", "river_swamp_e_nw"] as const,
  ["river_swamp_e_sw", "river_swamp_w_se"] as const,
  ["river_swamp_ne_se", "river_swamp_nw_sw"] as const,
];

/**
 * Where a number chip mounts, in the tile-local frame the art is authored in.
 *
 * `hexcontract.SOCKET_OFFSET` and `check-hexes` hold each tile's `Token_*`
 * empty here, and `layers/chips.ts` mounts the disc at the same place on the
 * board (through the tile's half turn). In glTF's Y-up frame, blend +y is -z.
 */
const CHIP_XZ: [number, number] = [0.0, -1.5];
/** `hexcontract.KEEP_CLEAR_RADIUS`: the chip disc plus its margin. */
const CHIP_KEEP_CLEAR = 1.05;
/** `hexcontract.CHIP_UNDERSIDE_Z`: nothing may reach above this inside it. */
const CHIP_UNDERSIDE_Y = 0.25;
function tileFile(tile: string): string {
  const entry = TILES[tile];
  expect(entry, `${tile} is not in the manifest`).toBeDefined();
  return entry.file;
}

function meshNamed(file: string, suffix: string): Mesh {
  const meshes = readGlb(file).filter((m) => m.name.endsWith(suffix));
  expect(meshes.length, `${file} has no *${suffix} mesh`).toBe(1);
  return meshes[0];
}

test("every channel meets the tile boundary at the edge midpoint, exactly", () => {
  // The contract with `art/bridges` and the tile next door. Both mouths and the
  // edge pair are checked: a bend that drifted into a straight would still
  // have two mouths on midpoints.
  for (const tile of CHANNELLED) {
    const water = meshNamed(tileFile(tile), "_water");
    for (const edge of MOUTHS[tile]) {
      const [mx, mz] = edgeMidpoint(edge);
      const hit = water.position.some((p) => Math.hypot(p[0] - mx, p[2] - mz) < 1e-3);
      expect(hit, `${tile}: no water vertex at the midpoint of edge ${edge}`).toBe(true);
    }
    // And nowhere else: a third mouth would be a branch the renderer can't
    // place. Checked as clusters of distinct points (the art is flat-shaded, so
    // raw vertices count the triangulation): the water must reach the boundary
    // at exactly two places, both at their edge midpoints.
    const onBoundary = [
      ...new Set(
        water.position
          .filter((p) => hexRadius(p[0], p[2]) > 0.995)
          .map((p) => `${p[0].toFixed(4)},${p[2].toFixed(4)}`),
      ),
    ].map((s) => s.split(",").map(Number) as [number, number]);
    const half = HALF_CHANNEL_AT_MOUTH;
    const mouths = MOUTHS[tile].map((edge) => edgeMidpoint(edge));
    const stray = onBoundary.filter(
      ([x, z]) => !mouths.some(([mx, mz]) => Math.hypot(x - mx, z - mz) <= half + 1e-3),
    );
    expect(stray, `${tile}: water touches the boundary away from a mouth`).toHaveLength(0);
    for (const [mx, mz] of mouths) {
      const near = onBoundary.filter(([x, z]) => Math.hypot(x - mx, z - mz) <= half + 1e-3);
      expect(near.length, `${tile}: no water on the boundary at ${mx},${mz}`).toBeGreaterThan(1);
    }
  }
});

test("no river tile's water crosses into the gutter", () => {
  // Water at a mouth runs right to the tile's edge, so it is most likely to
  // spill into the gutter where roads and settlements are drawn. `check-hexes`
  // bounds the circumradius, which a point past the edge midpoint still
  // satisfies, so the hexagonal norm is checked here.
  //
  // One assertion per mesh on its furthest vertex: per-vertex `expect`s over
  // about half a million vertices took too long.
  for (const tile of ALL_RIVER_TILES) {
    for (const mesh of readGlb(tileFile(tile))) {
      let reach = 0;
      for (const p of mesh.position) reach = Math.max(reach, hexRadius(p[0], p[2]));
      expect(reach, `${tile}: ${mesh.name} reaches past the tile edge`).toBeLessThanOrEqual(
        1 + 1e-3,
      );
    }
  }
});

test("a bridge deck at 0.25 clears both banks", () => {
  // The bank at a mouth is at or below the gutter sand's 0.220, or a deck
  // across the joint pokes through. Boundary ring only; inland the bank rises.
  for (const tile of CHANNELLED) {
    const channel = meshNamed(tileFile(tile), "_channel");
    const atEdge = channel.position.filter((p) => hexRadius(p[0], p[2]) > 0.99);
    expect(atEdge.length, `${tile}: the channel does not reach the boundary`).toBeGreaterThan(0);
    for (const p of atEdge) {
      expect(p[1], `${tile}: the bank at a mouth stands above the gutter sand`).toBeLessThanOrEqual(
        SLAB_TOP_Y + 1e-3,
      );
      expect(p[1]).toBeLessThan(BRIDGE_DECK_Y);
    }
  }
});

test("the water sits below the slab's top face and above its bed", () => {
  // The water stays below 0.220 so the channel reads as cut, not as a blue
  // stripe.
  for (const tile of CHANNELLED) {
    const file = tileFile(tile);
    const water = meshNamed(file, "_water");
    const channel = meshNamed(file, "_channel");
    const ys = water.position.map((p) => p[1]);
    expect(Math.max(...ys), `${tile}: water is not below the slab top`).toBeLessThan(SLAB_TOP_Y);
    const bed = Math.min(...channel.position.map((p) => p[1]));
    expect(Math.min(...ys), `${tile}: water is not above its own bed`).toBeGreaterThan(bed);
  }
});

test("the swamp carries a channel only in its river variants", () => {
  // Eleven swamp tiles ship: the unnumbered marsh hex and the ten rivers run
  // through. A channel appearing on the plain one would be hard to spot, since
  // all eleven are the same green.
  const plain = readGlb(tileFile(SWAMP_TILE)).map((m) => m.name);
  expect(plain.some((n) => n.endsWith("_water"))).toBe(false);
  expect(plain.some((n) => n.endsWith("_channel"))).toBe(false);
  expect(plain).toContain("Swamp_ground");
  for (const tile of RIVER_SWAMP_SHAPE_TILES) {
    const names = readGlb(tileFile(tile)).map((m) => m.name);
    expect(
      names.some((n) => n.endsWith("_water")),
      `${tile} has no water`,
    ).toBe(true);
  }
});

test("every river tile is flat-shaded and inside the face budget", () => {
  // House style: smooth-shaded low-poly reads as melted. Flat shading in glTF
  // means each triangle owns its three vertices, so check at most one normal
  // per triangle's worth of vertices.
  for (const tile of ALL_RIVER_TILES) {
    let triangles = 0;
    for (const mesh of readGlb(tileFile(tile))) {
      triangles += mesh.triangles;
      if (!mesh.normal.length) continue;
      const distinct = new Set(mesh.normal.map((n) => n.map((v) => v.toFixed(4)).join(",")));
      expect(
        distinct.size,
        `${tile}: ${mesh.name} shares normals between faces, so it is smooth-shaded`,
      ).toBeLessThanOrEqual(mesh.triangles);
    }
    // The budget is set by the shipped tiles (`desert.glb` 3875 triangles,
    // `port.glb` 4753), not a round number. River tiles range from 1850 (the
    // swamp without a channel) to 3795 (the river pasture with barn, wall,
    // gate, hedge, pond and a flock of eight); the six headwaters land at
    // 4162-4216. Each family's accents are capped at 1.15x its base file.
    expect(triangles, `${tile} is over the tile face budget`).toBeLessThanOrEqual(4600);
  }
});

test("every river tile still measures as a land slab", () => {
  // The exporter's recentring can only be wrong in the shipped file, so this
  // repeats part of `make check-hexes` there.
  for (const tile of ALL_RIVER_TILES) {
    const slab = readGlb(tileFile(tile)).find((m) => m.name.startsWith("Hex_"));
    expect(slab, `${tile} has no Hex_* slab`).toBeDefined();
    const ys = slab!.position.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(SLAB_TOP_Y, 3);
    expect(Math.min(...ys)).toBeCloseTo(SLAB_BOTTOM_Y, 3);
    const reach = Math.max(...slab!.position.map((p) => Math.hypot(p[0], p[2])));
    expect(reach, `${tile}: the slab is not the art hexagon`).toBeCloseTo(HEX, 3);
  }
});

test("both mouths carry a wet-sand fan", () => {
  // Water can't cross the gutter: `gapGeometry.ts` fills the 0.25 between
  // tiles with sand at 0.220, above the surface. The shingle fan makes the
  // joint read as one river, which works only if both mouths have one in the
  // same material on every tile.
  for (const tile of CHANNELLED) {
    const fan = meshNamed(tileFile(tile), "_fan");
    expect(fan.materials, `${tile}: the fan is not shingle`).toContain("Mat_River_shingle");
    for (const edge of MOUTHS[tile]) {
      const [mx, mz] = edgeMidpoint(edge);
      const near = fan.position.filter((p) => Math.hypot(p[0] - mx, p[2] - mz) < 0.55);
      expect(near.length, `${tile}: no fan at the mouth of edge ${edge}`).toBeGreaterThan(0);
    }
  }
});

/**
 * What each terrain has to be wearing, by mesh-name suffix.
 *
 * Keyed off `RIVER_TILE_FAMILIES`: a family's props are the same whichever way
 * its channel runs. The marsh, which has no channel, is the one non-family
 * entry.
 */
const VOCABULARY: Record<string, string[]> = {
  [SWAMP_TILE]: ["_deadwood_01", "_pool_01", "_tussock_01", "_sedge_01"],
  // The swamp river tiles wear the marsh's own meshes from `swamp_river.blend`,
  // plus a raft of lily pads, which mark it as the slack-water estuary.
  ...Object.fromEntries(
    RIVER_SWAMP_SHAPE_TILES.map((tile) => [
      tile,
      ["_deadwood_01", "_tussock_01", "_sedge_01", "_pool_01", "_lily_01"],
    ]),
  ),
  // The mountains wear the shipped straight's props, moved off the channel
  // onto the new ground. Nothing is modelled fresh, so tiles match their
  // neighbours.
  ...Object.fromEntries(
    RIVER_MOUNTAINS_SHAPE_TILES.map((tile) => [
      tile,
      ["_peak_01", "_scree_01", "_tree_01", "_fall"],
    ]),
  ),
  // The hills wear `river_hills.blend`'s own kiln, brick works and spoil. The
  // kiln is the only handed prop, so it is the only one a mirror re-places by
  // hand.
  ...Object.fromEntries(
    RIVER_HILLS_SHAPE_TILES.map((tile) => [
      tile,
      ["_kiln", "_kilnyard_01", "_works_01", "_works_03", "_spoil_01", "_scrub_01", "_cascade"],
    ]),
  ),
  // The pasture wears `river_pasture.blend`'s barn, haystack, pond, field wall,
  // hedge and flock. Wall and hedge are lines: members the channel crosses are
  // dropped and the rest renumbered from 01, so `_wall_01` and `_hedge_01` are
  // asserted and no count.
  ...Object.fromEntries(
    RIVER_PASTURE_SHAPE_TILES.map((tile) => [
      tile,
      ["_farm", "_hay", "_pond", "_wall_01", "_hedge_01", "_sheep_01", "_reeds_01"],
    ]),
  ),
  // The recipe-built families wear their shipped tile's props, moved off the
  // channel by the composer: the forest's seven conifers (`_conifers_07` is the
  // seventh), three broadleaves and the woodcutter's hut over its undergrowth;
  // the fields' farmstead, scarecrow and harvest, with crop rows and a hedge.
  // Reeds on both banks, recoloured to the ground (fern, hedge).
  ...Object.fromEntries(
    RIVER_FOREST_SHAPE_TILES.map((tile) => [
      tile,
      ["_conifers_07", "_broadleaf_03", "_woodcutter_01", "_undergrowth_01", "_reeds_01"],
    ]),
  ),
  ...Object.fromEntries(
    RIVER_FIELDS_SHAPE_TILES.map((tile) => [
      tile,
      ["_farmstead", "_scarecrow", "_harvest_01", "_croprows_01", "_hedgerow_01", "_reeds_01"],
    ]),
  ),
};

test("every river tile wears its terrain's own vocabulary", () => {
  // Prop density: a river tile must carry its terrain's props, not a channel
  // through an empty field.
  //
  // Every name below is a mesh taken from the shipped tile of that terrain
  // (`Pasture_farm`, `Hills_kiln`, `Mountains_scree` and the rest), except the
  // swamp's, which has no shipped tile and carries its own.
  expect(Object.keys(VOCABULARY).sort()).toEqual([...PRESENT].sort());
  for (const [tile, wanted] of Object.entries(VOCABULARY)) {
    const names = readGlb(tileFile(tile)).map((m) => m.name);
    for (const suffix of wanted) {
      expect(
        names.some((n) => n.endsWith(suffix)),
        `${tile} has no *${suffix}: ${names.join(", ")}`,
      ).toBe(true);
    }
    // And enough of them: keeping one of each and dropping the scatter would
    // pass every line above.
    expect(names.length, `${tile} is too sparsely dressed`).toBeGreaterThanOrEqual(30);
  }
});

test("the river's own materials are the same three everywhere", () => {
  // One water, one bed, one shingle for every channel. The palette is keyed on
  // material name, so a `Mat_River_water_2` would never be restyled.
  for (const tile of CHANNELLED) {
    const materials = new Set(readGlb(tileFile(tile)).flatMap((m) => m.materials));
    for (const name of ["Mat_River_water", "Mat_River_bed", "Mat_River_shingle"]) {
      expect(materials, `${tile} is missing ${name}`).toContain(name);
    }
  }
});

// --- the chip ---------------------------------------------------------------

test("no channel comes near the number chip, on every river tile that exists", () => {
  // This is the whole chip claim. Every mouth direction is legal, so whether a
  // shape clears the chip depends on the authored path in the .glb, checked
  // here. The Go side (`engine/rivers/chip_test.go`) asserts only that a board
  // never asks for an unauthored tile.
  //
  // The chip doesn't turn with its tile (`layers/chips.ts` mounts every disc
  // at one fixed spot), so river tiles are never yawed: there is a file per
  // shape, drawn at `TILE_ROTATION_Y`. `check-hexes` measures keep-clear
  // against each tile's own socket, so it can't see this.
  //
  // Where it binds: six of the nine shapes touch SW or SE, where the mouth is
  // 1.500 from the mount and a perpendicular entry can't do better. The
  // centreline stays at 1.35 or more, putting the water's edge at the
  // keep-clear exactly.
  //
  // So two claims:
  //
  //   the water keeps out of the whole keep-clear circle (and the drawn disc,
  //   0.880, is a further 0.17 in);
  //
  //   the bank may enter it only at or below the chip's underside, which is
  //   `hexcontract`'s rule: nothing above 0.250 inside 1.05.
  const disc = chipFaceRadius();
  for (const tile of CHANNELLED) {
    const file = tileFile(tile);
    const water = meshNamed(file, "_water");
    const channel = meshNamed(file, "_channel");
    const near = (m: Mesh) =>
      Math.min(...m.position.map((p) => Math.hypot(p[0] - CHIP_XZ[0], p[2] - CHIP_XZ[1])));
    expect(near(water), `${tile}: the water crowds the number chip`).toBeGreaterThanOrEqual(
      CHIP_KEEP_CLEAR,
    );
    for (const p of channel.position) {
      if (Math.hypot(p[0] - CHIP_XZ[0], p[2] - CHIP_XZ[1]) >= CHIP_KEEP_CLEAR) continue;
      expect(p[1], `${tile}: the bank stands up inside the chip's keep-clear`).toBeLessThanOrEqual(
        CHIP_UNDERSIDE_Y,
      );
    }
    // And against the disc as drawn (0.880 off chips.glb) as well as the
    // contract's 1.05: the contract is the promise, the disc the consequence.
    expect(near(water), `${tile}: the water reaches under the drawn chip`).toBeGreaterThan(disc);
    expect(near(channel), `${tile}: the bank reaches under the drawn chip`).toBeGreaterThan(disc);
  }
});

test("the re-cut families carry the wider water, at every mouth", () => {
  // The channel width, measured across the mouth (the span the neighbour's
  // channel has to meet): 0.60 on every channelled tile.
  for (const tile of WIDE_TILES) {
    const water = meshNamed(tileFile(tile), "_water");
    for (const edge of MOUTHS[tile]) {
      const [mx, mz] = edgeMidpoint(edge);
      const onEdge = water.position.filter((p) => hexRadius(p[0], p[2]) > 0.9995);
      const span = onEdge
        .filter((p) => Math.hypot(p[0] - mx, p[2] - mz) < 0.45)
        .map((p) => Math.hypot(p[0] - mx, p[2] - mz));
      expect(span.length, `${tile}: no water on the boundary at edge ${edge}`).toBeGreaterThan(1);
      expect(Math.max(...span), `${tile}: the mouth is not 0.60 wide`).toBeCloseTo(0.3, 3);
    }
  }
});

test("a headwater has exactly one mouth", () => {
  // A rules fact: a river begins at a headwater in a mountains hex with one
  // mouth. A second mouth would make it a through-hex wearing a tarn.
  const sources = WIDE_TILES.filter((t) => t.includes("_src_"));
  expect(sources, "no headwater tiles").toHaveLength(6);
  for (const tile of sources) {
    expect(MOUTHS[tile], `${tile} is not a one-mouth tile`).toHaveLength(1);
    const water = meshNamed(tileFile(tile), "_water");
    const onEdge = [
      ...new Set(
        water.position
          .filter((p) => hexRadius(p[0], p[2]) > 0.995)
          .map((p) => `${p[0].toFixed(4)},${p[2].toFixed(4)}`),
      ),
    ].map((s) => s.split(",").map(Number) as [number, number]);
    const [mx, mz] = edgeMidpoint(MOUTHS[tile][0]);
    for (const [x, z] of onEdge) {
      expect(
        Math.hypot(x - mx, z - mz),
        `${tile}: water reaches the boundary away from its one mouth`,
      ).toBeLessThanOrEqual(0.3 + 1e-3);
    }
  }
});

// --- the headwater's rivulets -----------------------------------------------
//
// One mouth is not one river. "A headwater has exactly one mouth" constrains
// where water touches the boundary, not how much water is inside. Rivulets
// must read as trickles feeding the tarn, not as extra rivers: narrow, and
// tapering rather than lens-shaped.

/**
 * A rivulet is at most a third of the channel: 0.20 against 0.60. At board zoom
 * anything within about 1.5x of the channel width reads as a river.
 */
const RIVULET_MAX_WIDTH = 0.2;

/** How finely the water footprint is measured, in tile units. */
const FOOTPRINT_STEP = 0.01;

/**
 * The water mesh split into its connected bodies, as footprints in (x, z).
 *
 * Welded by position first: the exporter splits vertices per material and per
 * flat-shaded face, so walking `indices` alone would make each face an island.
 */
function waterBodies(file: string): [number, number, number][][] {
  const water = meshNamed(file, "_water");
  const at = new Map<string, number>();
  const welded = water.position.map((p) => {
    const key = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
    if (!at.has(key)) at.set(key, at.size);
    return at.get(key)!;
  });
  const parent = [...Array(at.size).keys()];
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const join = (a: number, b: number) => {
    const [x, y] = [find(a), find(b)];
    if (x !== y) parent[y] = x;
  };
  for (let i = 0; i < water.indices.length; i += 3) {
    join(welded[water.indices[i]], welded[water.indices[i + 1]]);
    join(welded[water.indices[i + 1]], welded[water.indices[i + 2]]);
  }
  const bodies = new Map<number, [number, number, number][]>();
  water.position.forEach((p, i) => {
    const root = find(welded[i]);
    if (!bodies.has(root)) bodies.set(root, []);
    bodies.get(root)!.push(p);
  });
  return [...bodies.values()].sort((a, b) => b.length - a.length);
}

/**
 * How much of the tile a water mesh covers, seen from above.
 *
 * Rasterised rather than summed off triangles: a water body has a skirt whose
 * projection overlaps its top, so summing counts much of it twice. A grid
 * counts each cell once.
 */
function footprintArea(triangles: [number, number, number][][]): number {
  const covered = new Set<number>();
  // The grid spans 4 units either side of centre (the hexagon has circumradius
  // 3), and the row stride is one wider than the widest column so
  // `iz * side + ix` can't alias across rows.
  const side = Math.ceil(8 / FOOTPRINT_STEP) + 1;
  for (const [a, b, c] of triangles) {
    const lo = (v: number[]) => Math.floor((Math.min(...v) + 4) / FOOTPRINT_STEP);
    const hi = (v: number[]) => Math.ceil((Math.max(...v) + 4) / FOOTPRINT_STEP);
    for (let ix = lo([a[0], b[0], c[0]]); ix <= hi([a[0], b[0], c[0]]); ix++) {
      for (let iz = lo([a[2], b[2], c[2]]); iz <= hi([a[2], b[2], c[2]]); iz++) {
        const key = iz * side + ix;
        if (covered.has(key)) continue;
        const x = ix * FOOTPRINT_STEP - 4;
        const z = iz * FOOTPRINT_STEP - 4;
        const cross = (p: number[], q: number[], r: number[]) =>
          (p[0] - r[0]) * (q[2] - r[2]) - (q[0] - r[0]) * (p[2] - r[2]);
        const P = [x, 0, z];
        const d = [cross(P, a, b), cross(P, b, c), cross(P, c, a)];
        if (d.some((v) => v < 0) && d.some((v) => v > 0)) continue;
        covered.add(key);
      }
    }
  }
  return covered.size * FOOTPRINT_STEP * FOOTPRINT_STEP;
}

/** Every triangle of a tile's water mesh, as three points. */
function waterTriangles(file: string): [number, number, number][][] {
  const water = meshNamed(file, "_water");
  const out: [number, number, number][][] = [];
  for (let i = 0; i < water.indices.length; i += 3) {
    out.push([
      water.position[water.indices[i]],
      water.position[water.indices[i + 1]],
      water.position[water.indices[i + 2]],
    ]);
  }
  return out;
}

test("a headwater carries one river, and its rivulets are trickles", () => {
  // A headwater shows less open water than a through-channel: its channel
  // runs from one edge to a tarn in the middle. The bound is the leanest
  // through-channel on the same terrain, read off the art. (Two-mouth
  // mountains tiles cover 2.84 to 3.50.)
  const sources = WIDE_TILES.filter((t) => t.includes("_src_"));
  const through = familyTiles("mountains").filter((t) => !t.includes("_src_"));
  expect(sources, "no headwater tiles").toHaveLength(6);
  expect(through.length, "no two-mouth mountains tiles to compare against").toBeGreaterThan(1);

  const budget = Math.min(...through.map((t) => footprintArea(waterTriangles(tileFile(t)))));
  for (const tile of sources) {
    expect(
      footprintArea(waterTriangles(tileFile(tile))),
      `${tile}: a headwater carries more open water than a river that crosses the whole tile`,
    ).toBeLessThanOrEqual(budget);
  }
});

test("no rivulet on a headwater is wide enough to read as a river", () => {
  // A headwater may have several water bodies (a tarn with trickles), but only
  // the one reaching the mouth is the river; every other is a trickle, at most
  // a third of the channel.
  //
  // Mean width (footprint over length) rather than caliper minimum, because a
  // curved rivulet's narrowest direction is across its bend.
  for (const tile of WIDE_TILES.filter((t) => t.includes("_src_"))) {
    const file = tileFile(tile);
    const bodies = waterBodies(file);
    const reachesMouth = (body: [number, number, number][]) =>
      body.some((p) => hexRadius(p[0], p[2]) > 0.995);
    expect(
      bodies.filter(reachesMouth).length,
      `${tile}: the water that reaches the mouth is not one body`,
    ).toBe(1);
    for (const body of bodies.filter((b) => !reachesMouth(b))) {
      let length = 0;
      for (const p of body) {
        for (const q of body) length = Math.max(length, Math.hypot(p[0] - q[0], p[2] - q[2]));
      }
      const set = new Set(
        body.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`),
      );
      const area = footprintArea(
        waterTriangles(file).filter((t) =>
          t.every((p) => set.has(`${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`)),
        ),
      );
      expect(
        area / length,
        `${tile}: rivulet length ${length.toFixed(2)}, area ${area.toFixed(2)}, ` +
          `mean width ${(area / length).toFixed(2)}, max ${RIVULET_MAX_WIDTH}`,
      ).toBeLessThanOrEqual(RIVULET_MAX_WIDTH);
    }
  }
});

/** A mesh's triangles drawn with `material`, as three points each. */
function trianglesIn(mesh: Mesh, material: string): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  for (const prim of mesh.primitives) {
    if (prim.material !== material) continue;
    for (let i = prim.start; i < prim.start + prim.count; i += 3) {
      out.push([
        mesh.position[mesh.indices[i]],
        mesh.position[mesh.indices[i + 1]],
        mesh.position[mesh.indices[i + 2]],
      ]);
    }
  }
  return out;
}

/** Height of triangle `t` over (x, z), or null when the point is outside it. */
function heightOver(t: [number, number, number][], x: number, z: number): number | null {
  const [a, b, c] = t;
  const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
  if (Math.abs(d) < 1e-9) return null;
  const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d;
  const v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
  if (u < 0 || v < 0 || u + v > 1) return null;
  return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
}

/**
 * How far under its dark centre the tarn's light sheet has to sit.
 *
 * `hexcontract.RIM_TIE_BREAK` (0.0005) is what the rim wins its z-fight with,
 * so anything at or above it resolves. The sheet is authored 0.005 under at its
 * own vertices and nears this bound only close to a shared edge.
 */
const TARN_SINK_MIN = 0.0005;

/**
 * How close to a shared edge a thin gap may sit.
 *
 * The sheet and the disc share their outline, so the gap is zero at a shared
 * edge and grows away from it; the band still under `TARN_SINK_MIN` is a
 * crease along the edge. Measured: 0.018 to 0.036.
 */
const TARN_CREASE = 0.05;

/** How much of the overlap must clear `TARN_SINK_MIN`. Measured: 85 to 88%. */
const TARN_CLEAR_FRACTION = 0.75;

/** Grid pitch the overlap is sampled at, in tile units. */
const TARN_STEP = 0.02;

test("a headwater's light sheet sits below its dark centre", () => {
  // The `_water` mesh is two primitives: `Mat_River_water` (the sheet) and
  // `Mat_River_water_dk` (the deep lane down the channel and the dark disc in
  // the tarn). Along the channel they sit side by side. In the tarn the disc
  // lies over the sheet; coplanar, they would z-fight into a shimmering edge.
  //
  // The sheet's vertices under the disc are sunk 0.005 (see the headwaters
  // section of art/README.md), so the two meet only along shared edges. This
  // samples the overlap on a grid (the vertices are the shared ones, where the
  // gap is zero) and holds two things: any too-thin sample sits on the crease
  // by a shared edge, and most of the overlap is clear.
  for (const tile of WIDE_TILES.filter((t) => t.includes("_src_"))) {
    const water = meshNamed(tileFile(tile), "_water");
    const light = trianglesIn(water, "Mat_River_water");
    const dark = trianglesIn(water, "Mat_River_water_dk");
    expect(light.length, `${tile}: no light water`).toBeGreaterThan(0);
    expect(dark.length, `${tile}: no dark water`).toBeGreaterThan(0);

    // The edges the two slots share: a dark triangle edge whose ends are both
    // also light vertices.
    const key = (p: [number, number, number]) => `${p[0].toFixed(4)},${p[2].toFixed(4)}`;
    const lightKeys = new Set(light.flat().map(key));
    const shared: [number, number, number][][] = [];
    for (const t of dark) {
      for (let i = 0; i < 3; i++) {
        const a = t[i];
        const b = t[(i + 1) % 3];
        if (lightKeys.has(key(a)) && lightKeys.has(key(b))) shared.push([a, b]);
      }
    }
    const creaseDistance = (x: number, z: number): number => {
      let best = Infinity;
      for (const [a, b] of shared) {
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const len = dx * dx + dz * dz;
        const u = len > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / len)) : 0;
        best = Math.min(best, Math.hypot(x - (a[0] + u * dx), z - (a[2] + u * dz)));
      }
      return best;
    };

    const xs = dark.flat().map((p) => p[0]);
    const zs = dark.flat().map((p) => p[2]);
    let overlap = 0;
    let clear = 0;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += TARN_STEP) {
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += TARN_STEP) {
        let disc: number | null = null;
        for (const t of dark) {
          const y = heightOver(t, x, z);
          if (y !== null && (disc === null || y > disc)) disc = y;
        }
        if (disc === null) continue;
        let sheet: number | null = null;
        for (const t of light) {
          const y = heightOver(t, x, z);
          if (y !== null && (sheet === null || y > sheet)) sheet = y;
        }
        if (sheet === null) continue; // a lane, beside the sheet rather than over it
        overlap++;
        if (disc - sheet >= TARN_SINK_MIN) {
          clear++;
          continue;
        }
        expect(
          creaseDistance(x, z),
          `${tile}: at (${x.toFixed(2)}, ${z.toFixed(2)}) dark centre ${disc.toFixed(4)} ` +
            `over light sheet ${sheet.toFixed(4)} away from a shared edge (z-fight)`,
        ).toBeLessThanOrEqual(TARN_CREASE);
      }
    }
    // The faceted tarn has no disc: the pool is toned triangle by triangle
    // (`art/README.md`, "The faceted re-cut"), so dark and light water are
    // neighbours in plan and can't z-fight. The per-sample rule above still
    // holds; the ratio applies only where a tarn carries a disc (enough
    // overlap to be one, not a stray sample on a shared edge).
    expect(dark.length, `${tile}: the tarn has no deep water`).toBeGreaterThan(0);
    if (overlap > 20) {
      expect(
        clear / overlap,
        `${tile}: only ${clear} of ${overlap} overlap samples clear the sheet by ${TARN_SINK_MIN}`,
      ).toBeGreaterThanOrEqual(TARN_CLEAR_FRACTION);
    }
  }
});

/**
 * How much of a triangle is left after it is pulled in toward its own centroid,
 * before the overlap test looks at it.
 *
 * The water is one welded sheet, so neighbouring triangles touch at edges and
 * corners. Shrinking both by 10% about their centroids separates those while
 * true overlaps remain. Not delicate: anything from 0.99 to 0.5 finds the same
 * folds.
 */
const OVERLAP_SHRINK = 0.9;

/** A triangle in plan, shrunk about its own centroid. */
function planShrink(t: [number, number, number][]): [number, number][] {
  const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
  const cz = (t[0][2] + t[1][2] + t[2][2]) / 3;
  return t.map(
    (p) =>
      [cx + (p[0] - cx) * OVERLAP_SHRINK, cz + (p[2] - cz) * OVERLAP_SHRINK] as [number, number],
  );
}

function planArea(t: [number, number][]): number {
  return (
    Math.abs(
      (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]),
    ) / 2
  );
}

/** Separating-axis test: do these two triangles cover any of the same ground? */
function planOverlap(a: [number, number][], b: [number, number][]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 3; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 3];
      const ax = -(q[1] - p[1]);
      const az = q[0] - p[0];
      let amin = Infinity;
      let amax = -Infinity;
      let bmin = Infinity;
      let bmax = -Infinity;
      for (const v of a) {
        const d = v[0] * ax + v[1] * az;
        amin = Math.min(amin, d);
        amax = Math.max(amax, d);
      }
      for (const v of b) {
        const d = v[0] * ax + v[1] * az;
        bmin = Math.min(bmin, d);
        bmax = Math.max(bmax, d);
      }
      if (amax <= bmin || bmax <= amin) return false;
    }
  }
  return true;
}

test("no river tile's water lies on top of itself", () => {
  // No two triangles of a `_water` mesh may cover the same ground in plan.
  // The water is a swept ribbon, and a bend tighter than the 0.300 bank turns
  // the inside of the ribbon over itself, coplanar; two coplanar translucent
  // layers z-fight in stripes that move with the camera.
  //
  // Checked in plan, not 3D, because layers a millimetre apart are exactly the
  // failure and a height tolerance would wave them through.
  //
  // One exception: a headwater's tarn is a dark disc over a light sheet (see
  // the test above), so on the six `_src_` tiles a pair in different slots is
  // allowed; a pair in the same slot is not. Elsewhere the slots are side by
  // side and may not overlap.
  //
  // `CHANNELLED` because the plain marsh has no `_water` mesh.
  for (const tile of CHANNELLED) {
    const water = meshNamed(tileFile(tile), "_water");
    const tris: { material: string; xz: [number, number][]; minX: number; maxX: number }[] = [];
    for (const prim of water.primitives) {
      for (let i = prim.start; i < prim.start + prim.count; i += 3) {
        const corners: [number, number, number][] = [
          water.position[water.indices[i]],
          water.position[water.indices[i + 1]],
          water.position[water.indices[i + 2]],
        ];
        const xz = planShrink(corners);
        if (planArea(xz) < 1e-9) continue; // a sliver covers no ground
        tris.push({
          material: prim.material,
          xz,
          minX: Math.min(...xz.map((p) => p[0])),
          maxX: Math.max(...xz.map((p) => p[0])),
        });
      }
    }
    expect(tris.length, `${tile}: no water triangles to measure`).toBeGreaterThan(0);
    // Sorted on x so the inner loop can stop early; otherwise this is 300x300
    // separating-axis tests per tile.
    tris.sort((a, b) => a.minX - b.minX);
    const tarn = tile.includes("_src_");
    for (let i = 0; i < tris.length; i++) {
      for (let j = i + 1; j < tris.length; j++) {
        if (tris[j].minX > tris[i].maxX) break;
        if (tarn && tris[i].material !== tris[j].material) continue;
        if (!planOverlap(tris[i].xz, tris[j].xz)) continue;
        const x = tris[i].xz.reduce((a, p) => a + p[0], 0) / 3;
        const z = tris[i].xz.reduce((a, p) => a + p[1], 0) / 3;
        expect.fail(
          `${tile}: water overlaps itself at (${x.toFixed(3)}, ${z.toFixed(3)}), ` +
            `${tris[i].material} over ${tris[j].material} (see tools/blender/unfold_river_water.py)`,
        );
      }
    }
  }
});

// --- the two hands ----------------------------------------------------------

test("each mirrored bend is its bend reflected, as real geometry", () => {
  // A `_bend_m` is not a negative scale of its bend (that flips winding, breaks
  // flat-shaded normals and leaves the instancing path) and not a rotation (no
  // turn of mouths {0, 4} gives {3, 5} in order).
  //
  // So the claim is about the water, which must mirror exactly for hexes to
  // meet mouth to mouth: reflect one tile's water through x = 0 and it is the
  // other's. Props are not held to this (a mirror-image barn isn't wanted).
  // Compared to 1e-3 because the exporter recentres each tile on its contents
  // (`hexcontract.TOL`); the pairs agree to about 1e-4.
  const TOL = 1e-3;
  for (const [bend, mirror] of MIRROR_PAIRS) {
    const order = (ps: [number, number, number][]) =>
      [...ps].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const a = order(
      meshNamed(tileFile(bend), "_water").position.map(
        (p) => [-p[0], p[1], p[2]] as [number, number, number],
      ),
    );
    const b = order(meshNamed(tileFile(mirror), "_water").position);
    expect(b.length, `${mirror}: the water is not the same mesh as ${bend}'s`).toBe(a.length);
    const off = a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1], p[2] - b[i][2]));
    expect(Math.max(...off), `${mirror}: the water is not ${bend}'s reflected`).toBeLessThanOrEqual(
      TOL,
    );
  }
});

// --- the kit ----------------------------------------------------------------

test("every river tile is built to the same kit", () => {
  // `art/README.md`'s "River kit", as counts off the shipped files, so the
  // families stay consistent (gravel bars, bank rocks and so on).
  const count = (names: string[], part: string) =>
    names.filter((n) => n.includes(`_${part}_`) || n.endsWith(`_${part}`)).length;
  for (const tile of ALL_RIVER_TILES) {
    const names = readGlb(tileFile(tile)).map((m) => m.name);
    expect(count(names, "rim"), `${tile}: the rim is not one unbroken mesh`).toBe(1);
    expect(count(names, "ground"), `${tile}: not exactly one ground`).toBe(1);
    if (tile === SWAMP_TILE) continue;
    expect(count(names, "water"), `${tile}: not exactly one water sheet`).toBe(1);
    expect(count(names, "channel"), `${tile}: not exactly one channel`).toBe(1);
    expect(count(names, "margin"), `${tile}: not exactly one wet margin`).toBe(1);
    expect(count(names, "fan"), `${tile}: not exactly one mouth-fan mesh`).toBe(1);
    expect(count(names, "bar"), `${tile}: not two gravel bars`).toBe(2);
    const rocks = count(names, "bankrock");
    expect(rocks, `${tile}: ${rocks} bank rocks, the kit is 3 to 5`).toBeGreaterThanOrEqual(3);
    expect(rocks, `${tile}: ${rocks} bank rocks, the kit is 3 to 5`).toBeLessThanOrEqual(5);
    // Reeds on the pasture, sedge on the marsh: the soft-banked terrains. The
    // forest and fields are composed on the pasture's channel and keep its
    // reeds, recoloured to fern and hedge. Mountains and hills carry neither.
    const soft = count(names, "reeds") + count(names, "sedge");
    const wanted = ["pasture", "swamp", "forest", "fields"].some((t) => tile.includes(t));
    expect(soft > 0, `${tile}: ${soft} reeds/sedge, wanted ${wanted ? "some" : "none"}`).toBe(
      wanted,
    );
  }
});

test("the kit's three heights hold on every channel", () => {
  // The water sheet, the bed and the wet margin make adjacent river tiles read
  // as one river. All share the same numbers: surface at 0.190 (dropping to the
  // thalweg and, in the mountains, over a fall), bed at 0.072, and the margin
  // between water and turf.
  for (const tile of CHANNELLED) {
    const file = tileFile(tile);
    const water = meshNamed(file, "_water");
    const channel = meshNamed(file, "_channel");
    const margin = meshNamed(file, "_margin");
    expect(Math.max(...water.position.map((p) => p[1])), `${tile}: water surface`).toBeCloseTo(
      0.193,
      3,
    );
    expect(Math.min(...channel.position.map((p) => p[1])), `${tile}: channel bed`).toBeCloseTo(
      0.072,
      3,
    );
    // The wet margin lies on the ground at the water's edge: its foot just
    // above the slab's top face (0.2825 to 0.2926), its head following the
    // bank. The steepest shipped is the mountains straight at 0.4273; the 0.45
    // bound means a band on the bank, not a wall.
    const my = margin.position.map((p) => p[1]);
    expect(Math.min(...my), `${tile}: the wet margin is under the water`).toBeGreaterThan(0.193);
    expect(Math.min(...my), `${tile}: the wet margin floats off the ground`).toBeLessThan(0.3);
    expect(Math.max(...my), `${tile}: the wet margin stands off the turf`).toBeLessThan(0.45);
    // The channel's last 0.125 passes under the rim, so the rim is unbroken at
    // the mouths.
    const rim = meshNamed(file, "_rim");
    const onEdge = rim.position.filter((p) => hexRadius(p[0], p[2]) > 0.995);
    for (const edge of MOUTHS[tile]) {
      const [mx, mz] = edgeMidpoint(edge);
      const over = onEdge.filter((p) => Math.hypot(p[0] - mx, p[2] - mz) < 0.3);
      expect(
        over.length,
        `${tile}: the rim is broken at the mouth of edge ${edge}`,
      ).toBeGreaterThan(0);
    }
  }
});

test("the hills cut their banks in the hills' own wet clay", () => {
  // Water, bed and shingle are shared; the bank is the terrain's own. The
  // mountains cut theirs in shale, the hills in `Mat_Hills_clay_wet` (what the
  // shipped hills river wets its margin with).
  for (const tile of RIVER_HILLS_SHAPE_TILES) {
    const file = tileFile(tile);
    for (const part of ["_channel", "_margin"]) {
      expect(
        meshNamed(file, part).materials,
        `${tile}: ${part} is not cut in the hills' wet clay`,
      ).toContain("Mat_Hills_clay_wet");
    }
    // and not in another terrain's bank material, as a copied tile would be.
    const all = new Set(readGlb(file).flatMap((m) => m.materials));
    for (const foreign of ["Mat_Mountains_shale", "Mat_Pasture_turf"]) {
      expect(all, `${tile} wears ${foreign}`).not.toContain(foreign);
    }
  }
});

test("a hills straight carries a ford and every hills tile a cascade", () => {
  // Two shape-conditional kit pieces.
  //
  // The ford is on the straights only: a track crosses a reach, not a bend
  // (the kit's rule: "ford: the straights only, 5 stones"). Straight means the
  // mouths are opposite: `e_w_a`/`e_w_b`, `ne_sw` and `nw_se`.
  const opposite = (tile: string) => {
    const [a, b] = MOUTHS[tile];
    return (a + 3) % 6 === b;
  };
  for (const tile of RIVER_HILLS_SHAPE_TILES) {
    const names = readGlb(tileFile(tile)).map((m) => m.name);
    const ford = names.filter((n) => n.includes("_ford_")).length;
    expect(ford, `${tile}: ${ford} ford stones`).toBe(opposite(tile) ? 5 : 0);
    // A cascade on every hills tile: a rock lip across the channel with the
    // surface dropping over it. Asserted by its effect too, since a ledge
    // without a step in the water is just a rock.
    expect(
      names.filter((n) => n.endsWith("_cascade")),
      `${tile}: no cascade`,
    ).toHaveLength(1);
    const ys = meshNamed(tileFile(tile), "_water").position.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys), `${tile}: the water does not step`).toBeGreaterThan(
      0.01,
    );
  }
});

test("every re-cut family meets every other at the mouth, to the millimetre", () => {
  // The seam, across families: hexes of different terrain meet mouth to mouth,
  // so the channel cross section must agree across the 0.25 gutter. The same
  // 0.60 of water on the same centre, the same 0.70 of cut, and a bank at
  // 0.2205 so a bridge deck lies flat on both. Everything else (shape of the
  // bends, bank materials) may differ.
  //
  // Held to one master (`river_mountains_ne_sw`) and to the absolute numbers,
  // so families can't agree by drifting together.
  const profile = (tile: string, edge: number) => {
    const [mx, mz] = edgeMidpoint(edge);
    const at = (suffix: string) =>
      meshNamed(tileFile(tile), suffix)
        .position.filter((p) => hexRadius(p[0], p[2]) > 0.9995)
        .filter((p) => Math.hypot(p[0] - mx, p[2] - mz) < 0.5);
    const water = at("_water");
    const channel = at("_channel");
    return {
      water: Math.max(...water.map((p) => Math.hypot(p[0] - mx, p[2] - mz))),
      cut: Math.max(...channel.map((p) => Math.hypot(p[0] - mx, p[2] - mz))),
      bank: Math.max(...channel.map((p) => p[1])),
    };
  };
  const mountains = profile("river_mountains_ne_sw", 4);
  // Anchored to the absolute numbers as well: half of 0.60 of water, half of
  // 0.70 of cut, and the bank at the gutter sand's 0.2205.
  expect(mountains.water, "the master's mouth is not 0.60 wide").toBeCloseTo(0.3, 3);
  expect(mountains.cut, "the master's cut is not 0.70 wide").toBeCloseTo(0.35, 3);
  // To three places: the exporter's recentring moves each by about 1e-4
  // (`hexcontract.TOL`).
  expect(mountains.bank, "the master's bank is not at the gutter sand").toBeCloseTo(0.2205, 3);
  // Every tile of every re-cut family, the master's own included, against it.
  expect(WIDE_TILES.length, "a family is missing from the seam").toBe(66);
  for (const tile of WIDE_TILES) {
    for (const edge of MOUTHS[tile]) {
      const p = profile(tile, edge);
      expect(p.water, `${tile}: mouth ${edge} water half-width`).toBeCloseTo(mountains.water, 3);
      expect(p.cut, `${tile}: mouth ${edge} cut half-width`).toBeCloseTo(mountains.cut, 3);
      expect(p.bank, `${tile}: mouth ${edge} bank height`).toBeCloseTo(mountains.bank, 3);
    }
  }
});

test("the pasture cuts its banks in the pasture's own wet mud", () => {
  // The pasture's bank is the mud its shipped river already wets its margin
  // with, not another terrain's.
  //
  // `hexcontract` reads the pasture rim's lip off `Mat_Pasture_mud` (see
  // `RIM_OUTLINE_BAND`), so the mouth's mark on the rim is cut in
  // `Mat_Pasture_dirt`: marking it in mud would spread that material across
  // the chamfer and lose the rim's shadow line. `make check-hexes` measures
  // the rim rule; this checks the two materials differ.
  for (const tile of RIVER_PASTURE_SHAPE_TILES) {
    const file = tileFile(tile);
    for (const part of ["_channel", "_margin"]) {
      expect(
        meshNamed(file, part).materials,
        `${tile}: ${part} is not cut in the pasture's wet mud`,
      ).toContain("Mat_Pasture_mud");
    }
    const rim = meshNamed(file, "_rim").materials;
    expect(rim, `${tile}: the rim's mouth is not marked`).toContain("Mat_Pasture_dirt");
    const all = new Set(readGlb(file).flatMap((m) => m.materials));
    for (const foreign of ["Mat_Mountains_shale", "Mat_Hills_clay_wet"]) {
      expect(all, `${tile} wears ${foreign}`).not.toContain(foreign);
    }
  }
});

test("a pasture straight carries a ford, and every pasture tile its reeds", () => {
  // Two shape-conditional kit pieces.
  //
  // The ford is on the straights only (the kit's rule: "ford: the straights
  // only, 5 stones"): `e_w_a`, `e_w_b`, `ne_sw` and `nw_se`.
  //
  // No bridge on any tile: a bridge is a piece a player builds (2 brick and 1
  // lumber, on one of the seven sites), so a modelled one would be unpaid and
  // possibly at an illegal site. `bridgeArt.test.ts` measures the piece.
  const opposite = (tile: string) => {
    const [a, b] = MOUTHS[tile];
    return (a + 3) % 6 === b;
  };
  for (const tile of RIVER_PASTURE_SHAPE_TILES) {
    const names = readGlb(tileFile(tile)).map((m) => m.name);
    const ford = names.filter((n) => n.includes("_ford_")).length;
    expect(ford, `${tile}: ${ford} ford stones`).toBe(opposite(tile) ? 5 : 0);
    expect(
      names.filter((n) => n.includes("_bridge")),
      `${tile}: a bridge is a piece, not a tile`,
    ).toHaveLength(0);
    // Reeds and sedge are asserted by count: one clump on a 5.2-unit reach is
    // decoration, not a bank.
    const reeds = names.filter((n) => n.includes("_reeds_")).length;
    expect(reeds, `${tile}: ${reeds} reed clumps, wanted at least 4`).toBeGreaterThanOrEqual(4);
  }
});

/**
 * How much of a channel's bank is wet: of the bank triangles touching the
 * channel's lip, the fraction painted `_margin` rather than `_ground`.
 *
 * The faceted tiles (see `art/README.md`, "The faceted re-cut") build channel,
 * water, margin and turf on the ground's 0.214 triangle lattice, sharing
 * lattice vertices, so a bank triangle is one of either mesh with a corner on a
 * channel vertex. Matched in plan to 3 mm, since the exporter quantises each
 * mesh separately.
 */
function wetCoverage(file: string, margin?: Mesh): number {
  const channel = meshNamed(file, "_channel");
  const wet = margin ?? meshNamed(file, "_margin");
  const turf = meshNamed(file, "_ground");
  const CELL = 0.01;
  const grid = new Map<string, [number, number][]>();
  for (const p of channel.position) {
    const k = `${Math.round(p[0] / CELL)},${Math.round(p[2] / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push([p[0], p[2]]);
  }
  const onLip = (p: [number, number, number]) => {
    const cx = Math.round(p[0] / CELL);
    const cz = Math.round(p[2] / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const q of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (Math.hypot(q[0] - p[0], q[1] - p[2]) < 0.003) return true;
        }
      }
    }
    return false;
  };
  const touching = (m: Mesh) => {
    let n = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      if ([0, 1, 2].some((k) => onLip(m.position[m.indices[i + k]]))) n++;
    }
    return n;
  };
  const a = touching(wet);
  const b = margin ? 0 : touching(turf);
  return a / (a + b);
}

test("the pasture's wet collar is intermittent, not a ribbon", () => {
  // A fixed-width wet margin along a smooth channel looks like a milled
  // groove; the River kit calls for "intermittent".
  //
  // The negative control is the metric's own ceiling: passing the turf in as
  // the margin (every bank triangle wet, i.e. a ribbon) must read 1. That
  // proves the function reaches its ceiling; the upper bound below keeps tiles
  // away from it.
  //
  // Calibrated on the faceted pasture: 0.40 to 0.71 (the wet phase is 70% of a
  // slow wave down the reach, out of phase on the two banks, and nothing wet
  // stands inside the chip's circle or climbs past the 0.44 margin ceiling).
  const file = tileFile("river_pasture_e_w_a");
  expect(wetCoverage(file, meshNamed(file, "_ground")), "a ribbon must read as one").toBe(1);
  for (const tile of RIVER_PASTURE_SHAPE_TILES) {
    const c = wetCoverage(tileFile(tile));
    expect(
      c,
      `${tile}: the wet margin covers ${c.toFixed(3)} of the bank, so it is a ribbon`,
    ).toBeLessThan(0.8);
    // And not zero: a bank with no wet ground also isn't intermittent.
    expect(c, `${tile}: the wet margin has all but vanished`).toBeGreaterThan(0.3);
  }
});

test("the swamp cuts its banks in the marsh's own silt, under a bog lip", () => {
  // The marsh's bank is the silt and peat its shipped tile already uses, not
  // another terrain's.
  //
  // The top of the bank is bog: a single brown cut from water to lip draws a
  // hard dark line down both sides at board zoom. A marsh is vegetated to the
  // waterline, so the outermost column of the section is `Mat_Swamp_bog_dk`
  // and silt is only the wet part.
  //
  // `hexcontract` reads the swamp rim's lip off `Mat_Swamp_silt_dk` (at apothem
  // 2.5968 to 2.5981, which is how that rim passes with a 0.0135 cutbank
  // against the geometry arm's 0.020). So the mouth's mark on the rim is cut in
  // `Mat_Swamp_bog`, as in `swamp_river.blend`; silt there would spread across
  // the chamfer and lose the rim's shadow line.
  for (const tile of RIVER_SWAMP_SHAPE_TILES) {
    const file = tileFile(tile);
    expect(
      meshNamed(file, "_channel").materials,
      `${tile}: the cut is not silt under a bog lip`,
    ).toEqual(expect.arrayContaining(["Mat_Swamp_mud", "Mat_Swamp_bog_dk"]));
    expect(
      meshNamed(file, "_margin").materials,
      `${tile}: the wet margin is not the marsh's own silt`,
    ).toContain("Mat_Swamp_silt_dk");
    const rim = meshNamed(file, "_rim").materials;
    expect(rim, `${tile}: the rim's mouth is not marked`).toContain("Mat_Swamp_bog");
    expect(rim, `${tile}: the mouth is marked in the rim's own lip material`).toContain(
      "Mat_Swamp_silt_dk",
    );
    const all = new Set(readGlb(file).flatMap((m) => m.materials));
    for (const foreign of ["Mat_Mountains_shale", "Mat_Hills_clay_wet", "Mat_Pasture_mud"]) {
      expect(all, `${tile} wears ${foreign}`).not.toContain(foreign);
    }
  }
});

test("a swamp river has no ford, and carries sedge, backwaters and lilies", () => {
  // The swamp drops the ford, even on the straights (`e_w_a`, `e_w_b`, `ne_sw`,
  // `nw_se`): tracks don't cross a swamp. No bridge either, for the pasture's
  // reason: a bridge is a piece a player builds.
  //
  // It carries its own three instead: sedge on the banks (by count; one clump
  // on a five-unit reach is decoration), two braided backwaters in the crook of
  // a bend, and lily pads on the slack water.
  for (const tile of RIVER_SWAMP_SHAPE_TILES) {
    const names = readGlb(tileFile(tile)).map((m) => m.name);
    expect(
      names.filter((n) => n.includes("_ford_")),
      `${tile}: a swamp river has no stepping stones`,
    ).toHaveLength(0);
    expect(
      names.filter((n) => n.includes("_bridge")),
      `${tile}: a bridge is a piece, not a tile`,
    ).toHaveLength(0);
    const sedge = names.filter((n) => n.includes("_sedge_")).length;
    expect(sedge, `${tile}: ${sedge} sedge clumps, wanted at least 6`).toBeGreaterThanOrEqual(6);
    expect(
      names.filter((n) => n.includes("_pool_")),
      `${tile}: two backwaters`,
    ).toHaveLength(2);
    expect(
      names.filter((n) => n.includes("_lily_")),
      `${tile}: lily pads`,
    ).toHaveLength(3);
  }
});

test("the swamp's lily pads float on water, not on the bank", () => {
  // A pad must lie on a water surface (the channel's sheet or one of the two
  // backwater lenses); spread past the lens, pads read as leaf litter on mud.
  // Checked in plan as "no pad further from a water surface than its own
  // reach".
  for (const tile of RIVER_SWAMP_SHAPE_TILES) {
    const meshes = readGlb(tileFile(tile));
    const wet = meshes.filter((m) => m.name.endsWith("_water") || m.name.includes("_pool_"));
    expect(wet.length, `${tile}: nothing for a pad to float on`).toBeGreaterThan(0);
    for (const pad of meshes.filter((m) => m.name.includes("_lily_"))) {
      const cx = pad.position.reduce((a, p) => a + p[0], 0) / pad.position.length;
      const cz = pad.position.reduce((a, p) => a + p[2], 0) / pad.position.length;
      // Which water first: a raft floats on one surface, and three surfaces at
      // different heights lie within a unit of each other, so a nearest-vertex
      // search over all of them could match the wrong one.
      const surfaces = wet.map((m) => ({
        name: m.name,
        near: Math.min(...m.position.map((p) => Math.hypot(p[0] - cx, p[2] - cz))),
        top: (ps: [number, number, number][]) => Math.max(...ps.map((p) => p[1])),
        under: m.position.filter((p) => Math.hypot(p[0] - cx, p[2] - cz) < 0.35),
      }));
      const on = surfaces.reduce((a, b) => (b.near < a.near ? b : a));
      expect(on.near, `${tile}: ${pad.name} lies on the bank`).toBeLessThan(0.3);
      // Then at that surface's height, which varies: the channel sheet is at
      // 0.193, under the slab's top, while a backwater lens lies on the bog
      // above it. A pad sits a couple of millimetres proud, never through.
      expect(on.under.length, `${tile}: ${pad.name} has no ${on.name} under it`).toBeGreaterThan(0);
      const surface = on.top(on.under);
      const ys = pad.position.map((p) => p[1]);
      expect(Math.min(...ys), `${tile}: ${pad.name} is sunk under ${on.name}`).toBeGreaterThan(
        surface - 0.005,
      );
      expect(Math.max(...ys), `${tile}: ${pad.name} floats off ${on.name}`).toBeLessThan(
        surface + 0.02,
      );
      // And flat: a pad is a leaf.
      expect(Math.max(...ys) - Math.min(...ys), `${tile}: ${pad.name} is not flat`).toBeLessThan(
        1e-3,
      );
    }
  }
});

test("the swamp's wet collar is intermittent, and wetter than the pasture's", () => {
  // The same `wetCoverage` metric as the pasture, with the swamp's band. The
  // swamp is the wettest family and still intermittent: its wet phase is 80% of
  // the slow wave against the pasture's 70%, and it measures 0.49 to 0.69.
  const file = tileFile("river_swamp_e_w_a");
  expect(wetCoverage(file, meshNamed(file, "_ground")), "a ribbon must read as one").toBe(1);
  const pasture = Math.max(...RIVER_PASTURE_SHAPE_TILES.map((t) => wetCoverage(tileFile(t))));
  const swamp: number[] = [];
  for (const tile of RIVER_SWAMP_SHAPE_TILES) {
    const c = wetCoverage(tileFile(tile));
    swamp.push(c);
    expect(c, `${tile}: wet margin coverage ${c.toFixed(3)}`).toBeLessThan(0.85);
    expect(c, `${tile}: the wet margin has all but vanished`).toBeGreaterThan(0.35);
  }
  // On average, the marsh's banks are wetter than the pasture's.
  const mean = swamp.reduce((a, b) => a + b, 0) / swamp.length;
  const pastureMean =
    RIVER_PASTURE_SHAPE_TILES.map((t) => wetCoverage(tileFile(t))).reduce((a, b) => a + b, 0) /
    RIVER_PASTURE_SHAPE_TILES.length;
  expect(mean, `the marsh (${mean.toFixed(3)}) is not wetter than the pasture`).toBeGreaterThan(
    pastureMean,
  );
  expect(pasture).toBeGreaterThan(0);
});

test("old river tile names are not in the manifest", () => {
  // Engine and art both use the shape ids now, so `layers/rivers.ts` has no
  // name map; this asserts the old names (`straight`, `bend`, `bend_m`) are
  // gone. A tile left in the manifest that nothing selects is still downloaded
  // by every rivers game.
  const dead = [
    "swamp_river",
    "swamp_river_bend",
    "swamp_river_bend_m",
    "river_mountains",
    "river_mountains_bend",
    "river_mountains_bend_m",
    "river_mountains_e_w",
    "river_hills",
    "river_hills_bend",
    "river_hills_bend_m",
    "river_pasture",
    "river_pasture_bend",
    "river_pasture_bend_m",
  ];
  for (const tile of dead) {
    expect(TILES[tile], `${tile} is still in the manifest`).toBeUndefined();
    expect(RIVER_TILES, `${tile} is still named by the renderer`).not.toContain(tile);
  }
  // The shapes the old files drew are all still available on every family:
  // straight is `e_w`, the bend `ne_w`, the mirrored bend `e_nw` (art edges
  // {3,0}, {4,0} and {3,5}).
  for (const family of RIVER_FAMILIES) {
    expect(MOUTHS[`river_${family}_e_w_a`].slice().sort()).toEqual([0, 3]);
    expect(MOUTHS[`river_${family}_ne_w`].slice().sort()).toEqual([0, 4]);
    expect(MOUTHS[`river_${family}_e_nw`].slice().sort()).toEqual([3, 5]);
  }
});

// --- and the same clearance through the RENDERER's own constants -------------
//
// The test above measures the art against `hexcontract` (socket at CHIP_XZ,
// keep-clear 1.05). But `layers/chips.ts` mounts every disc at a fixed board
// position and reads the socket only to decide whether a tile takes a chip, so
// these tests check the renderer's placement agrees.
//
// This is the frontend half of a claim whose Go half is
// `engine/rivers/chip_test.go`, which asserts over 200 boards per radius that a
// board asks only for authored shapes. Go has no geometry and vitest no board
// generator; the halves compose because river tiles are never turned.

/** The chip disc as the art actually draws it, not as a constant claims. */
function chipFaceRadius(): number {
  let radius = 0;
  for (const mesh of readGlb("chips.glb")) {
    // The face is the disc; the numeral and pips sit inside it.
    if (!mesh.name.endsWith("_face")) continue;
    for (const p of mesh.position) radius = Math.max(radius, Math.hypot(p[0], p[2]));
  }
  expect(radius, "chips.glb has no *_face mesh").toBeGreaterThan(0);
  return radius;
}

test("the art's chip contract matches the mounted chip", () => {
  // Three things must name one disc in one place: `hexcontract`'s CHIP_XZ and
  // KEEP_CLEAR_RADIUS (what tiles are authored against), `chips.glb` (the art),
  // and `CHIP_OFFSET_Z` with `TILE_ROTATION_Y` (where the renderer puts it).
  //
  // A tile is laid half a turn from how it was modelled, so the socket at -1.5
  // arrives at +1.5, exactly where the chip is mounted regardless of the tile.
  // That is why river tiles aren't yawed.
  const c = Math.cos(TILE_ROTATION_Y);
  const sn = Math.sin(TILE_ROTATION_Y);
  const [ax, az] = CHIP_XZ;
  expect(ax * c + az * sn).toBeCloseTo(0, 9);
  expect(-ax * sn + az * c, "the authored socket does not land where chips.ts mounts").toBeCloseTo(
    CHIP_OFFSET_Z,
    9,
  );
  // And the contract's radius covers the art: 0.880 against a keep-clear of
  // 1.05, so the bound above has margin.
  const measured = chipFaceRadius();
  expect(measured).toBeCloseTo(0.88, 2);
  expect(measured, "the chip art is wider than the keep-clear the tiles reserve").toBeLessThan(
    CHIP_KEEP_CLEAR,
  );
});

test("a yawed river tile puts water under the chip", () => {
  // The negative control, so the clearance assertions can't pass on art that
  // never goes near a chip: of the six yaws, the one the renderer uses must
  // keep water off the chip and the other five must put water under it.
  const disc = chipFaceRadius();
  const water = meshNamed(tileFile("river_pasture_e_w_a"), "_water");
  let collided = 0;
  for (let k = 0; k < 6; k++) {
    const turn = (Math.PI / 3) * k;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    let nearest = Infinity;
    for (const p of water.position) {
      const x = p[0] * c + p[2] * sn;
      const z = -p[0] * sn + p[2] * c;
      nearest = Math.min(nearest, Math.hypot(x, z - CHIP_OFFSET_Z));
    }
    if (Math.abs(turn - TILE_ROTATION_Y) < 1e-9) {
      expect(nearest, "the board's own facing is the one that clears").toBeGreaterThan(disc);
    } else if (nearest <= disc) {
      collided++;
    }
  }
  expect(collided, "yaws with water under the chip").toBe(5);
});
