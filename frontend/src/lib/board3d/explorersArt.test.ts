// The Explorers tiles, measured off the shipped files.
//
// No Explorers module draws these yet, so no board test would notice a broken
// tile; these tests measure the art directly.
//
// There is no face-down tile: an unrevealed hex is hidden information, which
// the engine masks to the wire-only `fog` resource (`MaskBoard`) and the
// manifest's `RESOURCE_FALLBACK` draws as sea with a mist treatment.
//
// `make check-hexes` measures the blends (slab, socket, gutter); this measures
// the .glb a browser downloads, after the exporter's recentring and Z-up to
// Y-up flip. It checks that the shoal is the sea tile's own hull, that the two
// land tiles are land, and that the two spaces another branch's props land in
// are clear.
//
// Each tile is modelled on top of the shipped tile it derives from, keeping
// its slab, relief, rim and props, so it matches its neighbours. That is
// measurable: the goldfield's ground must be the hills' ground face for face
// and material for material.
//
// Geometric checks are per vertex, not per bounding box: parts are merged per
// material on export, so `Spice_huts` is one object spanning five huts round a
// yard, and its box covers the empty yard.
//
// Read straight from the GLB like `scenarioArt.test.ts` and
// `knightSwordArt.test.ts`, since the loader needs WebGL.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TILES } from "./manifest.generated";
import { EXPLORERS_TILES, tileFileFor, boardModelFiles } from "./loader";
import { OCEAN_MAX_Y, OCEAN_MEAN_Y } from "./ocean";
import { SHOAL_DRAWN_PREFIXES, SHOAL_CUT_PREFIXES } from "./layers/explorers";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies: what ships is meshopt-encoded, and this parses the
// container. See testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

type Vec3 = [number, number, number];

interface Glb {
  gltf: any;
  bin: Buffer;
}

const cache = new Map<string, Glb>();

/** The JSON chunk and the BIN chunk of a plain (uncompressed) .glb. */
function open(file: string): Glb {
  const hit = cache.get(file);
  if (hit) return hit;
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  // Chunks are 4-byte aligned and each carries an 8-byte header.
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  const bin = buf.subarray(binHeader + 8, binHeader + 8 + binLen);
  const out = { gltf, bin };
  cache.set(file, out);
  return out;
}

const COMPONENT_SIZE: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

/** One accessor's values, flattened. Handles the strides the exporter emits. */
function readAccessor({ gltf, bin }: Glb, index: number): number[] {
  const acc = gltf.accessors[index];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type as string]!;
  const view = gltf.bufferViews[acc.bufferView];
  const size = COMPONENT_SIZE[acc.componentType];
  const stride = view.byteStride ?? components * size;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < components; c++) {
      const at = base + i * stride + c * size;
      switch (acc.componentType) {
        case 5126:
          out.push(bin.readFloatLE(at));
          break;
        case 5125:
          out.push(bin.readUInt32LE(at));
          break;
        case 5123:
          out.push(bin.readUInt16LE(at));
          break;
        case 5121:
          out.push(bin.readUInt8(at));
          break;
        default:
          throw new Error(`unhandled componentType ${acc.componentType}`);
      }
    }
  }
  return out;
}

interface Part {
  name: string;
  /** Vertex positions in the file's own frame, node transform applied. */
  points: Vec3[];
  /** Triangles as index triples into `points`. */
  triangles: [number, number, number][];
  /** Per-vertex normals, node rotation ignored: only equality is asked of them. */
  normals: Vec3[];
  materials: string[];
}

/** Every node named `prefix*`, with its geometry brought into the tile frame. */
function partsOf(file: string, prefix: string): Part[] {
  const glb = open(file);
  const { gltf } = glb;
  const out: Part[] = [];
  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined) continue;
    // The mesh's name where the node has none: a slab is merged on export and
    // comes back as an unnamed node wrapping a named mesh.
    const name: string = node.name ?? gltf.meshes[node.mesh].name ?? "";
    if (!name.startsWith(prefix)) continue;
    // A tipped node would skew every measurement below, so assert it.
    const q = node.rotation ?? [0, 0, 0, 1];
    expect(Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]), `${name} is rotated`).toBeLessThan(
      1e-6,
    );
    const t = (node.translation ?? [0, 0, 0]) as Vec3;
    const s = (node.scale ?? [1, 1, 1]) as Vec3;

    for (const prim of gltf.meshes[node.mesh].primitives) {
      const raw = readAccessor(glb, prim.attributes.POSITION);
      const points: Vec3[] = [];
      for (let i = 0; i < raw.length; i += 3) {
        points.push([raw[i] * s[0] + t[0], raw[i + 1] * s[1] + t[1], raw[i + 2] * s[2] + t[2]]);
      }
      const nraw =
        prim.attributes.NORMAL === undefined ? [] : readAccessor(glb, prim.attributes.NORMAL);
      const normals: Vec3[] = [];
      for (let i = 0; i < nraw.length; i += 3) normals.push([nraw[i], nraw[i + 1], nraw[i + 2]]);
      const indices = readAccessor(glb, prim.indices);
      const triangles: [number, number, number][] = [];
      for (let i = 0; i < indices.length; i += 3) {
        triangles.push([indices[i], indices[i + 1], indices[i + 2]]);
      }
      out.push({
        name,
        points,
        triangles,
        normals,
        materials: prim.material === undefined ? [] : [gltf.materials[prim.material].name],
      });
    }
  }
  expect(out.length, `${prefix}: no geometry found in ${file}`).toBeGreaterThan(0);
  return out;
}

/** Every vertex of every part named `prefix*`. */
function points(file: string, prefix: string): Vec3[] {
  return partsOf(file, prefix).flatMap((p) => p.points);
}

function bounds(file: string, prefix: string): { lo: Vec3; hi: Vec3 } {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points(file, prefix)) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  }
  return { lo, hi };
}

function materialsOf(file: string, prefix: string): string[] {
  return [...new Set(partsOf(file, prefix).flatMap((p) => p.materials))].sort();
}

function faceCount(file: string, prefix = ""): number {
  return partsOf(file, prefix).reduce((n, p) => n + p.triangles.length, 0);
}

const GOLDFIELD = "tiles/goldfield.glb";
const SHOAL = "tiles/sea_shoal.glb";
const SPICE = "tiles/spice.glb";
const ALL = [GOLDFIELD, SHOAL, SPICE];

// Rims here are measured against the shipped tiles they derive from, so no
// apothem helper is needed. If one is, use `hexcontract.apothem`: radius is
// the wrong measure at a tile edge (a pointy-top hexagon's boundary is 2.5981
// out at an edge midpoint and 3.0 at a corner).

/**
 * The chip socket, in the glTF frame. The blend mounts it at (0, +1.5) and the
 * exporter maps Blender (x, y, z) to glTF (x, z, -y), so it is at -z. Read from
 * the manifest, as the renderer will.
 */
const SOCKET_XZ: [number, number] = [0, -1.5];
const KEEP_CLEAR = 1.05;
const CHIP_UNDERSIDE = 0.25;

// --- what the manifest promises ----------------------------------------

test("all three tiles resolve to a file that parses", () => {
  // While no module draws these, this is the only check that each manifest
  // key reaches a readable model.
  for (const res of EXPLORERS_TILES) {
    const file = tileFileFor(res);
    expect(file, `${res} resolves to no file`).toBe(TILES[res].file);
    expect(faceCount(file!), `${file} parsed to nothing`).toBeGreaterThan(20);
  }
});

test("no ruleset that exists today pays for any of them", () => {
  // The three are gated on an `explorers` ruleset part that does not exist, so
  // no board today may fetch them; an ungated tile adds download weight for
  // every visitor.
  const files = new Set(EXPLORERS_TILES.map((res) => TILES[res].file));
  for (const ruleset of ["base", "base+islands", "base+cak", "base+fishermen", "base+caravans"]) {
    for (const file of boardModelFiles(ruleset)) {
      expect(files.has(file), `${ruleset} prefetches ${file}`).toBe(false);
    }
  }
});

test("every face ships flat-shaded", () => {
  // Flat shading, checked on normals rather than vertex reuse (Blender's
  // exporter shares a vertex between faces that agree on its normal). A flat
  // triangle has the same normal at all three corners.
  for (const file of ALL) {
    for (const part of partsOf(file, "")) {
      expect(part.normals.length, `${file}/${part.name} ships no normals`).toBe(part.points.length);
      for (const [a, b, c] of part.triangles) {
        for (let axis = 0; axis < 3; axis++) {
          expect(part.normals[b][axis], `${file}/${part.name} is smooth-shaded`).toBeCloseTo(
            part.normals[a][axis],
            4,
          );
          expect(part.normals[c][axis], `${file}/${part.name} is smooth-shaded`).toBeCloseTo(
            part.normals[a][axis],
            4,
          );
        }
      }
    }
  }
});

test("every tile is inside the face budget and keeps its material slots", () => {
  // A collapsed material slot cannot be restyled by palette.json, which is why
  // tiles ship as named meshes.
  for (const file of ALL) {
    expect(faceCount(file), `${file} is over the 3000-face tile budget`).toBeLessThanOrEqual(3000);
    const materials = materialsOf(file, "");
    expect(materials.length, `${file} collapsed to one material slot`).toBeGreaterThan(1);
    for (const name of materials) {
      // Terrain belongs to nobody, so no seat slot (as `loader.test.ts` pins
      // for the oasis and the lake).
      expect(name, `${file} carries a seat-tinted material`).toMatch(/^Mat_/);
    }
  }
});

test("nothing on a land tile grows through its number chip", () => {
  // The socket is at (0, +1.5) in the blend and nothing may rise above the
  // chip's underside within 1.05 of it. `make check-hexes` is the main gate;
  // this checks the shipped file per vertex.
  for (const file of [GOLDFIELD, SPICE]) {
    for (const part of partsOf(file, "")) {
      for (const [x, y, z] of part.points) {
        if (y <= CHIP_UNDERSIDE) continue;
        const r = Math.hypot(x - SOCKET_XZ[0], z - SOCKET_XZ[1]);
        expect(
          r,
          `${file}/${part.name} at y=${y.toFixed(3)} is inside the chip's margin`,
        ).toBeGreaterThan(KEEP_CLEAR);
      }
    }
  }
});

// --- the shoal is the sea tile, not a copy of it ------------------------

test("the shoal matches the ocean's hull and wave sheet exactly", () => {
  // `hexcontract`'s WATER_TOP_Z and WATER_BOTTOM_Z were measured off
  // `ocean.blend`, the tile is authored a lattice cell wide and scaled back on
  // export, and the runtime sinks the hull and moves the surface by material
  // name. Appending the ocean's own objects keeps all of that in step; this
  // checks they were appended, not retyped.
  const shoal = bounds(SHOAL, "Hex_Shoal");
  const ocean = bounds("tiles/sea.glb", "Hex_Ocean");
  for (const axis of [0, 1, 2]) {
    expect(shoal.lo[axis], `slab floor on axis ${axis}`).toBeCloseTo(ocean.lo[axis], 6);
    expect(shoal.hi[axis], `slab ceiling on axis ${axis}`).toBeCloseTo(ocean.hi[axis], 6);
  }
  expect(materialsOf(SHOAL, "Hex_Shoal")).toEqual(["Mat_Ocean"]);

  // `dressOcean` finds the surface by material name, so waves with their own
  // material would sit flat in a moving sea.
  expect(materialsOf(SHOAL, "Shoal_waves")).toEqual(["Mat_Ocean_water"]);
  expect(faceCount(SHOAL, "Shoal_waves")).toBe(faceCount("tiles/sea.glb", "Ocean_waves"));
});

test("the two land tiles are land, measured against the tiles they are not", () => {
  // A water slab is a full lattice cell wide (scaled to fill it at load); a
  // land slab keeps its authored 3.0 and leaves the perimeter for roads and
  // buildings. Measured against the desert and the sea, as `scenarioArt.test.ts`
  // does for the lake.
  const desert = bounds("tiles/none.glb", "Hex_Desert");
  const sea = bounds("tiles/sea.glb", "Hex_Ocean");
  for (const [file, prefix] of [
    [GOLDFIELD, "Hex_Goldfield"],
    [SPICE, "Hex_Spice"],
  ] as const) {
    const slab = bounds(file, prefix);
    expect(slab.hi[2] - slab.lo[2], `${prefix} circumradius`).toBeCloseTo(
      desert.hi[2] - desert.lo[2],
      4,
    );
    expect(slab.hi[1], `${prefix} top face`).toBeCloseTo(desert.hi[1], 4);
    expect(slab.lo[1], `${prefix} underside`).toBeCloseTo(desert.lo[1], 4);
    expect(slab.hi[2] - slab.lo[2]).not.toBeCloseTo(sea.hi[2] - sea.lo[2], 2);
  }
});

// --- the holes another branch's props land in ---------------------------

test("the spice village leaves the cargo pad clear at the height it promises", () => {
  // Spice sacks stack here (branch `art/cargo`). The pad is 0.88 x 0.88 at
  // y = 0.25 and nothing of this tile may stand in it. The pad's position is
  // read from the `Spice_pad` part rather than hard-coded, since the layout
  // moved it off centre.
  const pad = bounds(SPICE, "Spice_pad");
  expect(pad.hi[1], "the pad's own surface").toBeCloseTo(0.25, 3);
  expect(pad.hi[0] - pad.lo[0], "pad width").toBeGreaterThanOrEqual(0.85);
  expect(pad.hi[2] - pad.lo[2], "pad depth").toBeGreaterThanOrEqual(0.85);

  // The inherited ground is dug flat under the pad; the pasture's 25cm of
  // relief would otherwise poke through.
  for (const part of partsOf(SPICE, "")) {
    if (part.name.startsWith("Spice_pad") || part.name.startsWith("Hex_")) continue;
    for (const [x, y, z] of part.points) {
      if (y <= 0.25) continue;
      expect(
        x > pad.lo[0] && x < pad.hi[0] && z > pad.lo[2] && z < pad.hi[2],
        `${part.name} stands in the cargo pad at y=${y.toFixed(3)}`,
      ).toBe(false);
    }
  }
});

test("the shoal leaves its middle open for the fish haul", () => {
  // A fish haul lands at the middle of this tile (branch `art/cargo`), so the
  // middle must be flat water.
  //
  // Measured from the pale patch's surface rather than an absolute height: a
  // water tile is authored a lattice cell wide and scaled back on export, so
  // its heights differ from land tiles' by 5%.
  const surface = bounds(SHOAL, "Shoal_shallows").hi[1];
  for (const part of partsOf(SHOAL, "")) {
    if (part.name.startsWith("Hex_") || part.name.startsWith("Shoal_shallows")) continue;
    for (const [x, y, z] of part.points) {
      if (y <= surface) continue;
      expect(
        Math.hypot(x, z),
        `${part.name} stands ${(y - surface).toFixed(3)} above the shoal in the haul's landing`,
      ).toBeGreaterThan(1.0);
    }
  }
});

test("the goldfield's chip socket is empty for the lair", () => {
  // This tile keeps its chip socket empty for a pirate-lair token (branch
  // `art/tokens`), with a wider margin than the chip's 1.05 since a lair stands
  // up.
  //
  // The inherited terrain is exempt: the hills' relief comes to 1.071 from the
  // socket at y 0.26, and that is the ground the token stands on. The rule
  // applies to what the goldfield added (sluice, windlass, spoil heaps, tent),
  // all on the creek's north-east bank, with the creek routed clear of the
  // mount.
  const inherited = ["Goldfield_ground", "Goldfield_rim", "Goldfield_scrub"];
  expect(TILES["goldfield"].socket).toEqual([0.0, 0.26, -1.5]);
  for (const part of partsOf(GOLDFIELD, "")) {
    if (part.name.startsWith("Hex_") || inherited.includes(part.name)) continue;
    for (const [x, y, z] of part.points) {
      if (y <= CHIP_UNDERSIDE) continue;
      expect(
        Math.hypot(x - SOCKET_XZ[0], z - SOCKET_XZ[1]),
        `${part.name} crowds the pirate lair's socket`,
      ).toBeGreaterThan(1.25);
    }
  }
  // The exempt three still keep the chip's own margin, as every land tile does.
  for (const part of partsOf(GOLDFIELD, "")) {
    if (!inherited.includes(part.name)) continue;
    for (const [x, y, z] of part.points) {
      if (y <= CHIP_UNDERSIDE) continue;
      expect(
        Math.hypot(x - SOCKET_XZ[0], z - SOCKET_XZ[1]),
        `${part.name} grows through the chip`,
      ).toBeGreaterThan(KEEP_CLEAR);
    }
  }
});

// --- each tile is made of the one it derives from -----------------------

/** Faces of the hills' scrub taken off the goldfield to clear the crew ranks. */
const SCRUB_CLEARED_FOR_CREWS = 40;

test("the goldfield is the hills tile without its industry", () => {
  // `Goldfield_ground` is `Hills_ground` appended from `art/hexes/hills.blend`
  // and deformed (a channel carved, some faces reassigned to other slots), so
  // it has the same triangles and the same material family. Its rim and rocks
  // are equal face for face. The brickworks and kiln were not brought over;
  // this tile is not brick.
  expect(faceCount(GOLDFIELD, "Goldfield_ground")).toBe(
    faceCount("tiles/brick.glb", "Hills_ground"),
  );
  expect(faceCount(GOLDFIELD, "Goldfield_rim")).toBe(faceCount("tiles/brick.glb", "Hills_rim"));
  // The scrub is the hills' own minus the bush and rock where the crews' ranks
  // beside the lair token stand: 40 triangles between them.
  expect(faceCount(GOLDFIELD, "Goldfield_scrub")).toBe(
    faceCount("tiles/brick.glb", "Hills_terrainprops") - SCRUB_CLEARED_FOR_CREWS,
  );
  expect(materialsOf(GOLDFIELD, "Goldfield_rim")).toEqual(
    materialsOf("tiles/brick.glb", "Hills_rim"),
  );
  expect(materialsOf(GOLDFIELD, "Hex_Goldfield")).toEqual(["Mat_Hills"]);
  // The hills' palette plus the tailings fan's gold (Mat_Goldfield_pay/_lit/
  // _dk). The creek's gravel bars are ground lattice triangles, so their stones
  // (mountain scree, mine tailings) are ground colours.
  for (const name of materialsOf(GOLDFIELD, "Goldfield_ground")) {
    expect(name, "the ground kept the hills' palette").toMatch(
      /^Mat_(Hills_|Goldfield_|Mountains_scree(_dk)?$|Gold_tailings$)/,
    );
  }
  expect(materialsOf(GOLDFIELD, "").filter((m) => /brick|kiln|soot/.test(m))).toEqual([]);
});

test("the creek is cut into the hills' relief rather than laid on top of it", () => {
  // The creek has banks: every water sample has ground within 0.6 at least
  // 6cm higher. Checked per water vertex because the channel falls 14cm across
  // the tile.
  const water = points(GOLDFIELD, "Goldfield_creek");
  const ground = points(GOLDFIELD, "Goldfield_ground");
  expect(water.length).toBeGreaterThan(20);
  for (const [x, y, z] of water) {
    const banked = ground.some((g) => Math.hypot(g[0] - x, g[2] - z) < 0.6 && g[1] > y + 0.06);
    expect(banked, `the creek at (${x.toFixed(2)}, ${z.toFixed(2)}) has no bank`).toBe(true);
  }
});

test("this is a placer claim, not the gold mine", () => {
  // The claim and the mine share a subject, so they differ structurally: the
  // mine is hard rock with a headframe over two units tall, and this is worked
  // at ground level from a creek bed. Measured against `gold.glb`.
  //
  // The claim has a small timber headframe over its shaft (without one it read
  // as wheat at the opening camera), kept shorter than the mine's. Islands
  // draws the mine, Explorers the claim, so they never share a board.
  const mine = bounds("tiles/gold.glb", "Gold_headframe").hi[1];
  expect(mine).toBeGreaterThan(2.0);
  for (const part of partsOf(GOLDFIELD, "")) {
    if (part.name.startsWith("Hex_")) continue;
    for (const [, y] of part.points) {
      expect(y, `${part.name} stands as tall as the mine's headframe`).toBeLessThan(mine);
    }
  }
  // The gold is confined to one part.
  expect(materialsOf(GOLDFIELD, "Goldfield_nuggets")).toContain("Mat_Gold_nugget");
  for (const part of partsOf(GOLDFIELD, "")) {
    // The tailings heaps are capped with nuggets too.
    if (part.name.startsWith("Goldfield_nuggets") || part.name.startsWith("Goldfield_heaps"))
      continue;
    expect(part.materials, `${part.name} wears the gold`).not.toContain("Mat_Gold_nugget");
  }
});

test("the spice village is the pasture tile without its farm", () => {
  // Same claim for the village: its additions use the barn's red, thatch and
  // stone plus the harbour's timber and the merchant's saffron, so it adds no
  // colours (the new palette entries are the shoal's).
  expect(faceCount(SPICE, "Spice_ground")).toBe(faceCount("tiles/sheep.glb", "Pasture_ground"));
  expect(faceCount(SPICE, "Spice_rim")).toBe(faceCount("tiles/sheep.glb", "Pasture_rim"));
  expect(materialsOf(SPICE, "Spice_rim")).toEqual(materialsOf("tiles/sheep.glb", "Pasture_rim"));
  expect(materialsOf(SPICE, "Hex_Spice")).toEqual(["Mat_Pasture"]);
  // Every material on the tile is one another shipped tile already wears: the
  // pasture's grass and barn palette, the forest's bark and leaf for the two
  // broadleaves, the harbour's timber and the merchant's saffron.
  for (const name of materialsOf(SPICE, "")) {
    expect(name, `${name} is not borrowed from a shipped tile`).toMatch(
      /^Mat_(Pasture|Forest|Port|Trader)(_|$)/,
    );
  }
});

test("keeps both thatch tones, with the spice brightest", () => {
  // The roofs are shaded by face normal (the sunward slope takes the lighter
  // thatch). A bmesh face has a zero normal until computed, which once sent
  // every slope to the shade material, so both tones are checked on the
  // shipped file.
  expect(materialsOf(SPICE, "Spice_roofs")).toEqual([
    "Mat_Forest_bark",
    "Mat_Forest_leaf_gold",
    "Mat_Pasture_hay_dk",
  ]);
  // The drying racks carry two saffron tones nothing else on the board wears,
  // so the spice is visible from the board camera.
  expect(materialsOf(SPICE, "Spice_heaps")).toContain("Mat_Trader_merchant_flag");
  expect(materialsOf(SPICE, "Spice_heaps")).toContain("Mat_Trader_merchant_goods");
  for (const file of ALL) {
    if (file === SPICE) continue;
    expect(materialsOf(file, ""), `${file} also wears the spice`).not.toContain(
      "Mat_Trader_merchant_flag",
    );
  }
});

test("everything on the shoal stands above the swell's crest", () => {
  // The pale patch and fish must stand above the opaque sheet, which the
  // runtime raises to `OCEAN_MAX_Y`; otherwise they flicker in and out of the
  // waves.
  //
  // In the .glb's frame, the frame `ocean.ts`'s constants were measured in
  // (the sea tile is authored a lattice cell wide and scaled back, so blend
  // heights differ by 4.8%).
  for (const prefix of [
    "Shoal_shallows",
    "Shoal_bars",
    "Shoal_fish",
    "Shoal_rocks",
    "Shoal_buoy",
  ]) {
    expect(bounds(SHOAL, prefix).hi[1], `${prefix} is drowned by the swell`).toBeGreaterThan(
      OCEAN_MAX_Y,
    );
  }
  // Their flanks fall away under the surface, or the bank is a plate on the sea.
  expect(bounds(SHOAL, "Shoal_bars").lo[1], "the bars have no underwater flank").toBeLessThan(
    OCEAN_MEAN_Y,
  );
  expect(bounds(SHOAL, "Shoal_fringe").lo[1], "the shallows have no underwater flank").toBeLessThan(
    OCEAN_MEAN_Y,
  );
});

test("the sandbars are dry sand over a wet skirt", () => {
  // A bank must be partly out of the water and partly under: per vertex, the
  // bar mesh holds points above the crest and below the mean, in different
  // materials. Pale shapes at water height read as holes.
  const bars = partsOf(SHOAL, "Shoal_bars");
  expect(materialsOf(SHOAL, "Shoal_bars")).toEqual(["Mat_Shore_sand", "Mat_Shore_wetsand"]);
  const dry = bars.filter((p) => p.materials.includes("Mat_Shore_sand")).flatMap((p) => p.points);
  const wet = bars
    .filter((p) => p.materials.includes("Mat_Shore_wetsand"))
    .flatMap((p) => p.points);
  expect(Math.min(...dry.map((p) => p[1])), "the dry sand dips under the swell").toBeGreaterThan(
    OCEAN_MAX_Y,
  );
  expect(Math.min(...wet.map((p) => p[1])), "the skirt never reaches the sea bed").toBeLessThan(
    OCEAN_MEAN_Y,
  );

  // The dry caps stay out of the haul's landing; the wet skirts may run into
  // it, since only what stands above the pale patch is in the way.
  const surface = bounds(SHOAL, "Shoal_shallows").hi[1];
  for (const [x, y, z] of dry) {
    if (y <= surface) continue;
    expect(Math.hypot(x, z), "a sand island stands in the haul's landing").toBeGreaterThan(1.0);
  }
});

test("every part of the shoal is either drawn or deliberately cut", () => {
  // The board draws the shoal through a prefix list (`SHOAL_DRAWN_PREFIXES`),
  // leaving the wet-sand flat out. Every shipped part must be on one list or
  // the other, or a new part is silently dropped.
  const accounted = [...SHOAL_DRAWN_PREFIXES, ...SHOAL_CUT_PREFIXES];
  for (const part of partsOf(SHOAL, "")) {
    expect(
      accounted.some((p) => part.name.startsWith(p)),
      `${part.name} is in sea_shoal.glb and neither drawn nor cut`,
    ).toBe(true);
  }
  // And every cut names a part that exists.
  for (const cut of SHOAL_CUT_PREFIXES) {
    expect(partsOf(SHOAL, cut).length, `${cut} is not in the file`).toBeGreaterThan(0);
  }
});
