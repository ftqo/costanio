// The cloud bank over an unrevealed hex.
//
// Three of these are rules properties rather than art tests: a fog hex's look
// depends only on which hexes are fogged (so the renderer cannot leak withheld
// terrain), the bank stays off the coast, and it never hides the next hex's
// chip.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import {
  planFog,
  planFogFloor,
  fogTiles,
  fogTileArt,
  fogPuffGeometry,
  fogMaterial,
  resetFogMaterial,
  hexPuffs,
  hexFloor,
  fogSightReach,
  puffTop,
  fogHash,
  fogSwell,
  FOG_RESOURCE,
  FOG_TILE,
  FOG_MAX_Y,
  FOG_EDGE_CLEARANCE,
  FOG_SLAB_APOTHEM,
  FOG_PUFF_SQUASH,
  FOG_PUFF_JITTER,
  FOG_FLOOR_SQUASH,
  FOG_CLOUD_COLOR,
  FOG_PUFF_BASE,
  FOG_MODEL,
  FOG_BILLOW_PREFIXES,
  FOG_FLOOR_PREFIXES,
  fogKitGeometry,
  fogKitMeshes,
  fogKitMaterial,
  planFogShore,
  planFogLandBeach,
  FOG_LAND_BEACH_DEPTH,
  FOG_LAND_BEACH_Y,
  planFogPlates,
  fogPlateGeometry,
  fogKeys,
  FOG_SHORE_MATERIALS,
  FOG_SHORE_CLEARANCE,
  FOG_SHORE_REACH,
  FOG_PLATE_Y,
  type PlacedPuff,
  type PuffSpec,
} from "./fog";
import { planBeaches } from "./beaches";
import { BEACH_ENVELOPE, TOP_Y } from "../beachGeometry";
import { newGLTFLoader, EXPLORERS_MODELS, type LoadedAsset } from "../loader";
import { applyPalette, type Palette } from "../palette";
import { planTiles, tileScale } from "./tiles";
import { planGapSand } from "./gap";
import { instanceGeometry, disposeInstances } from "../instancing";
import { hexToWorld, hexKey, LATTICE_SIZE, worldToHex, cornerToWorld, neighbor } from "../coords";
import { SURFACE } from "../seating";
import { TILES } from "../manifest.generated";
import { hexesInRadius } from "@/lib/hexgeo";
import type { BoardTile, Hex } from "@/lib/types";

const SQRT3 = Math.sqrt(3);
const fog = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: FOG_RESOURCE, num: 0 });
const land = (q: number, r: number, res: BoardTile["res"] = "wood"): BoardTile => ({
  hex: { q, r },
  res,
  num: 8,
});
const sea = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "sea", num: 0 });

/**
 * Distance from the origin on the hexagon, in world units: the apothem of the
 * smallest pointy-top hexagon through (x, z). A disc of radius s at (x, z)
 * reaches `hexExtent(x, z) + s` on this measure.
 */
function hexExtent(x: number, z: number): number {
  const h = SQRT3 / 2;
  return Math.max(Math.abs(x), Math.abs(0.5 * x - h * z), Math.abs(0.5 * x + h * z));
}

/** The worst case of the jittered icosahedron: every corner pushed out. */
const radiusOf = (p: PuffSpec) => p.s * (1 + FOG_PUFF_JITTER);

/** A board of every hex out to `radius`, fogged or not by `isFog`. */
function board(
  radius: number,
  isFog: (h: Hex) => boolean,
  other: BoardTile["res"] = "wood",
): BoardTile[] {
  return hexesInRadius(radius).map((h) => (isFog(h) ? fog(h.q, h.r) : land(h.q, h.r, other)));
}

const everything = (tiles: BoardTile[]): PlacedPuff[] => [
  ...planFog(tiles),
  ...planFogFloor(tiles),
];

// --- the slab --------------------------------------------------------------

test("a fogged hex draws the blank slab, at LAND scale", () => {
  // `fog` falls back to the sea tile through the manifest, and the sea is
  // drawn a lattice cell wide; unscaled, the slab would be 5% too big and
  // overlap the gutter.
  const tiles = [fog(0, 0), land(1, 0)];
  const art = fogTileArt(tiles);
  const placed = planTiles(tiles, art.files, undefined, art.land);
  expect(placed[0].file).toBe(TILES[FOG_TILE].file);
  expect(placed[0].scale).toBe(1);
  expect(placed[0].scale).not.toBe(tileScale(FOG_RESOURCE));
  expect(placed[1].file).toBe(TILES.wood.file);
});

test("a fogged hex is land for the gutter, so it is not ringed in bare seam", () => {
  const tiles = [fog(0, 0)];
  expect(planGapSand(tiles)).toHaveLength(0);
  expect(planGapSand(tiles, fogTileArt(tiles).land)).toHaveLength(6);
});

test("the override names every fog hex and only fog hexes", () => {
  const tiles = [fog(0, 0), land(1, 0), fog(2, -1)];
  const art = fogTileArt(tiles);
  expect([...art.files.keys()].sort()).toEqual(
    [hexKey({ q: 0, r: 0 }), hexKey({ q: 2, r: -1 })].sort(),
  );
  expect(art.land.has(hexKey({ q: 1, r: 0 }))).toBe(false);
  expect(fogTiles(tiles)).toHaveLength(2);
});

// --- the claim the mask rests on -----------------------------------------

test("the bank depends only on which hexes are fogged", () => {
  // The client is never told what is under a fog hex, so the renderer could
  // leak it only by reading something correlated (a neighbour's terrain, a
  // number, a resource name). Repaint every non-fog hex with three terrains
  // and the sea, and the cloud must come out identical, bridges and all.
  const isFog = (h: Hex) => (((h.q * 7 + h.r * 3) % 5) + 5) % 5 !== 0;
  const drawn = (other: BoardTile["res"]) => JSON.stringify(everything(board(3, isFog, other)));
  const wood = drawn("wood");
  expect(drawn("ore")).toBe(wood);
  expect(drawn("gold")).toBe(wood);
  expect(drawn("sea")).toBe(wood);
  // And the tiles' numbers do not reach it either.
  const renumbered = board(3, isFog).map((t) => ({ ...t, num: 11 }));
  expect(JSON.stringify(everything(renumbered))).toBe(wood);
});

test("the bank is deterministic: the same fog draws the same cloud", () => {
  // A replay, a spectator and a reconnecting player must see the same
  // weather.
  const tiles = board(2, (h) => h.q >= 0);
  expect(JSON.stringify(everything(tiles))).toBe(JSON.stringify(everything(tiles)));
  expect(fogHash(3, -2, 5)).toBe(fogHash(3, -2, 5));
  // Two hexes do not wear the same cluster.
  expect(JSON.stringify(hexPuffs({ q: 0, r: 0 }))).not.toBe(
    JSON.stringify(hexPuffs({ q: 1, r: 0 })),
  );
  for (let i = 0; i < 200; i++) {
    const n = fogSwell(i * 1.7 - 150, i * 0.9 - 80);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(1);
  }
});

test("a board with nothing hidden builds no cloud at all", () => {
  // Every base game, and every Explorers game once the last hex is turned over.
  const tiles = [land(0, 0), sea(1, 0)];
  expect(planFog(tiles)).toEqual([]);
  expect(planFogFloor(tiles)).toEqual([]);
  expect(instanceGeometry(fogPuffGeometry(), fogMaterial(), planFog(tiles), "fog")).toEqual([]);
});

// --- keeping out of the play ----------------------------------------------

test("a hex's own cloud stays off its coast, on every hex of a big board", () => {
  // The edge of a fog hex is where a ship explores from and where the target
  // is drawn, so the bank holds FOG_EDGE_CLEARANCE inside the slab on every
  // side. Measured on the hexagon against the icosahedron's worst jitter, for
  // every hex of a ten-player Explorers board, since the jitter is hashed per
  // hex.
  const limit = FOG_SLAB_APOTHEM - FOG_EDGE_CLEARANCE;
  for (const h of hexesInRadius(7)) {
    for (const p of [...hexPuffs(h), ...hexFloor(h)]) {
      expect(
        hexExtent(p.x, p.z) + radiusOf(p),
        `${hexKey(h)} ${JSON.stringify(p)}`,
      ).toBeLessThanOrEqual(limit);
    }
  }
});

test("a bridge only ever covers a gutter that is fog on both sides", () => {
  // The only place the bank crosses the cell edge: an edge between two
  // unrevealed hexes is inland to the unexplored, so nothing can moor on it or
  // stand at either end. An edge between fog and anything else gets no bridge,
  // keeping the known coast clear.
  const tiles = [fog(0, 0), fog(1, 0), land(0, 1), sea(-1, 0), fog(1, -1)];
  const floor = planFogFloor(tiles);
  const bridges = floor.filter((p) => p.role === "bridge");
  const junctions = floor.filter((p) => p.role === "junction");
  // Three fog hexes in a triangle: three shared edges and one shared corner.
  expect(bridges).toHaveLength(3);
  expect(junctions).toHaveLength(1);
  const fogCentres = [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 1, r: -1 },
  ].map((h) => hexToWorld(h));
  for (const b of bridges) {
    // Each bridge sits exactly half-way between two fog centres.
    const [x, , z] = b.position;
    const near = fogCentres
      .map(([cx, , cz]) => Math.hypot(cx - x, cz - z))
      .filter((d) => Math.abs(d - (LATTICE_SIZE * SQRT3) / 2) < 1e-6);
    expect(near).toHaveLength(2);
  }
  // A lone fog hex gets none.
  expect(planFogFloor([fog(0, 0), land(1, 0)]).filter((p) => p.role !== "hex")).toEqual([]);
});

test("no puff can hide the chip on the next hex, from the lowest camera", () => {
  // A cloud between the camera and a neighbour's chip would hide the number.
  // The camera never goes below MIN_CAMERA_ELEVATION_DEG, so a puff of top h
  // hides (h - chip) / tan(elevation) behind itself; the bank's worst reach
  // from its hex centre must stop short of the neighbour's chip. The chip
  // radius here is generous (a chip is about 0.6 across the face).
  const chipTop = SURFACE.land + 0.2;
  const neighbourChipNear = LATTICE_SIZE * SQRT3 - 0.6;
  for (const h of hexesInRadius(5)) {
    for (const p of [...hexPuffs(h), ...hexFloor(h)]) {
      expect(fogSightReach(p, chipTop)).toBeLessThan(neighbourChipNear);
      expect(puffTop(p)).toBeLessThanOrEqual(FOG_MAX_Y);
    }
  }
  // Bridges and junctions are measured from their own edge or corner, which
  // is further from every neighbouring centre than a hex's own puffs.
  for (const p of planFogFloor(board(2, () => true))) {
    expect(puffTop(p.spec)).toBeLessThanOrEqual(FOG_MAX_Y);
  }
});

// --- geometry -------------------------------------------------------------

test("a puff is a closed, faceted solid with its base cut flat", () => {
  for (const squash of [FOG_PUFF_SQUASH, FOG_FLOOR_SQUASH]) {
    const g = fogPuffGeometry(squash);
    const pos = g.getAttribute("position");
    const normal = g.getAttribute("normal");
    // Closed: every edge of every face is shared with exactly one other face.
    // A corner jittered differently for two faces would open a crack.
    const edges = new Map<string, number>();
    const key = (i: number) =>
      `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    for (let f = 0; f < pos.count; f += 3) {
      for (const [a, b] of [
        [f, f + 1],
        [f + 1, f + 2],
        [f + 2, f],
      ]) {
        const e = [key(a), key(b)].sort().join("|");
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
    for (const count of edges.values()) expect(count).toBe(2);
    // Faceted: a face's three corners share one normal, so each face is one
    // flat shade, like every prop on the shipped tiles.
    for (let f = 0; f < pos.count; f += 3) {
      for (const c of [1, 2]) {
        expect(normal.getX(f + c)).toBeCloseTo(normal.getX(f), 5);
        expect(normal.getY(f + c)).toBeCloseTo(normal.getY(f), 5);
        expect(normal.getZ(f + c)).toBeCloseTo(normal.getZ(f), 5);
      }
    }
    // Squashed and cut: nothing above `squash` (plus the jitter) and nothing
    // below the cut.
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.max.y).toBeLessThanOrEqual(squash * (1 + FOG_PUFF_JITTER) + 1e-6);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.25 * squash - 1e-6);
    g.dispose();
  }
});

test("a puff's top is the material colour and its belly darker", () => {
  // The vertex colour multiplies the material colour, so a factor above 1
  // would be brighter than FOG_CLOUD_COLOR, which is held under the brightest
  // lit surface the board ships (see the next test).
  const g = fogPuffGeometry();
  const pos = g.getAttribute("position");
  const colour = g.getAttribute("color");
  let top = { y: -Infinity, rgb: [0, 0, 0] };
  let bottom = { y: Infinity, rgb: [0, 0, 0] };
  for (let i = 0; i < pos.count; i++) {
    const rgb = [colour.getX(i), colour.getY(i), colour.getZ(i)];
    for (const c of rgb) expect(c).toBeLessThanOrEqual(1 + 1e-6);
    if (pos.getY(i) > top.y) top = { y: pos.getY(i), rgb };
    if (pos.getY(i) < bottom.y) bottom = { y: pos.getY(i), rgb };
  }
  expect(bottom.rgb[0]).toBeLessThan(top.rgb[0]);
  // Cooler: the belly loses more red than blue.
  expect(bottom.rgb[2] / bottom.rgb[0]).toBeGreaterThan(1);
  g.dispose();
});

test("the cloud is no brighter than the snow the mountains already wear", () => {
  // Lit, so each look's rig decides the brightness. The albedo is held at or
  // under the brightest lit albedo already shipped, the snow, which is known
  // not to cross either post-processed look's bloom threshold.
  const palette = JSON.parse(
    readFileSync(
      join(__dirname, "..", "..", "..", "..", "public", "models", "palette.json"),
      "utf8",
    ),
  ) as Record<string, { color: number[] }>;
  const snow = palette.Mat_Mountains_snow.color;
  expect(snow).toHaveLength(3);
  FOG_CLOUD_COLOR.forEach((c, i) => expect(c).toBeLessThanOrEqual(snow[i]));
});

// --- the draw ------------------------------------------------------------

test("a whole board of fog is two draws, and frees its geometry", () => {
  // One InstancedMesh of billows and one of floor for every fogged hex, each
  // with a generated geometry the build owns so `disposeInstances` frees it.
  const tiles = [fog(0, 0), fog(1, 0), fog(1, -1), land(-1, 0)];
  const billows = fogPuffGeometry();
  const floorGeometry = fogPuffGeometry(FOG_FLOOR_SQUASH);
  const meshes = [
    ...instanceGeometry(billows, fogMaterial(), planFog(tiles), "fog"),
    ...instanceGeometry(floorGeometry, fogMaterial(), planFogFloor(tiles), "fog_floor"),
  ];
  expect(meshes).toHaveLength(2);
  expect(meshes[0].count).toBe(3 * hexPuffs({ q: 0, r: 0 }).length);

  const m = new THREE.Matrix4();
  const at = new THREE.Vector3();
  meshes[0].getMatrixAt(0, m);
  at.setFromMatrixPosition(m);
  const [x, , z] = hexToWorld({ q: 0, r: 0 });
  const core = hexPuffs({ q: 0, r: 0 })[0];
  expect(at.x).toBeCloseTo(x + core.x, 5);
  expect(at.z).toBeCloseTo(z + core.z, 5);

  let freed = 0;
  billows.addEventListener("dispose", () => freed++);
  floorGeometry.addEventListener("dispose", () => freed++);
  disposeInstances(meshes);
  expect(freed, "geometries freed").toBe(2);
});

test("the material is one lit, faceted object for the tab", () => {
  resetFogMaterial();
  const a = fogMaterial();
  expect(fogMaterial()).toBe(a);
  expect(a).toBeInstanceOf(THREE.MeshStandardMaterial);
  expect(a.flatShading).toBe(true);
  expect(a.vertexColors).toBe(true);
  // Opaque: nothing to composite, so no zoom at which it thins.
  expect(a.transparent).toBe(false);
  expect(a.opacity).toBe(1);
  // Not named like the sea, so `add` gives it shadows and bakes it into the
  // cached board rather than sending it to the water pass.
  expect(a.name).not.toMatch(/Ocean/);
  resetFogMaterial();
  expect(fogMaterial()).not.toBe(a);
});

// --- the authored kit ------------------------------------------------------
//
// The billows and pads are authored (`fog.glb`). The guarantees above are
// measured on the recipes (where a puff goes and how big it is) against the
// icosahedron's worst case; the envelope test below holds each kit variant
// inside that worst case, so the art reaches no further, taller or lower.

const MODELS_DIR = join(__dirname, "..", "..", "..", "..", "public", "models");

async function loadKit(): Promise<LoadedAsset> {
  const buf = readFileSync(join(MODELS_DIR, FOG_MODEL));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    newGLTFLoader().parse(ab, "", resolve, reject),
  );
  const palette = JSON.parse(readFileSync(join(MODELS_DIR, "palette.json"), "utf8")) as Palette;
  const byMaterial = new Map<string, THREE.Mesh[]>();
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial) applyPalette(mat, palette);
      byMaterial.set(mat.name, [...(byMaterial.get(mat.name) ?? []), mesh]);
    }
  });
  return { scene: gltf.scene, byMaterial };
}

const KIT = [
  ...FOG_BILLOW_PREFIXES.map((prefix) => ({ prefix, squash: FOG_PUFF_SQUASH })),
  ...FOG_FLOOR_PREFIXES.map((prefix) => ({ prefix, squash: FOG_FLOOR_SQUASH })),
];

test("only an Explorers board fetches the kit", () => {
  expect(EXPLORERS_MODELS).toContain(FOG_MODEL);
});

test("every kit variant fits the measured envelope", async () => {
  const kit = await loadKit();
  for (const { prefix, squash } of KIT) {
    const g = fogKitGeometry(kit, prefix);
    expect(g, `${prefix} is missing from ${FOG_MODEL}`).not.toBeNull();
    const pos = g!.getAttribute("position");
    let reach = 0;
    let top = -Infinity;
    let bottom = Infinity;
    for (let i = 0; i < pos.count; i++) {
      reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
      top = Math.max(top, pos.getY(i));
      bottom = Math.min(bottom, pos.getY(i));
    }
    // Unit radius: the placement's uniform scale is the puff's `s`.
    expect(reach, `${prefix} reach`).toBeLessThanOrEqual(1 + FOG_PUFF_JITTER);
    expect(top, `${prefix} top`).toBeLessThanOrEqual(squash * (1 + FOG_PUFF_JITTER));
    // The flat base, where the icosahedron is cut: hidden in the slab.
    expect(bottom, `${prefix} base`).toBeGreaterThanOrEqual(-FOG_PUFF_BASE * squash - 1e-3);
    // A real puff, not a sliver: at least half the envelope wide.
    expect(reach, `${prefix} is a real puff`).toBeGreaterThan(0.5);
    g!.dispose();
  }
});

test("every kit variant is a closed, faceted solid", async () => {
  // A crack in a billow is the slab showing through a cloud.
  const kit = await loadKit();
  for (const { prefix } of KIT) {
    const g = fogKitGeometry(kit, prefix)!;
    const pos = g.getAttribute("position");
    const normal = g.getAttribute("normal");
    const edges = new Map<string, number>();
    const key = (i: number) =>
      `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    for (let f = 0; f < pos.count; f += 3) {
      for (const [a, b] of [
        [f, f + 1],
        [f + 1, f + 2],
        [f + 2, f],
      ]) {
        const e = [key(a), key(b)].sort().join("|");
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
      for (const c of [1, 2]) expect(normal.getY(f + c)).toBeCloseTo(normal.getY(f), 5);
    }
    const open = [...edges.values()].filter((n) => n % 2 !== 0).length;
    expect(open, `${prefix} has ${open} open edges`).toBe(0);
    g.dispose();
  }
});

test("the kit's colours are the palette's and no brighter than snow", async () => {
  const kit = await loadKit();
  const palette = JSON.parse(readFileSync(join(MODELS_DIR, "palette.json"), "utf8")) as Record<
    string,
    { color: number[] }
  >;
  const cloud = palette.Mat_Fog_cloud.color;
  const belly = palette.Mat_Fog_cloud_belly.color;
  const snow = palette.Mat_Mountains_snow.color;
  cloud.forEach((c, i) => expect(c).toBeLessThanOrEqual(snow[i]));
  belly.forEach((c, i) => expect(c).toBeLessThan(cloud[i]));
  // Cooler as well as darker, as the generated belly was.
  expect(belly[2] / belly[0]).toBeGreaterThan(cloud[2] / cloud[0]);
  for (const { prefix } of KIT) {
    const g = fogKitGeometry(kit, prefix)!;
    const colour = g.getAttribute("color");
    const pos = g.getAttribute("position");
    const seen = new Set<string>();
    let topY = -Infinity;
    let topRgb = "";
    for (let i = 0; i < colour.count; i++) {
      const rgb = [colour.getX(i), colour.getY(i), colour.getZ(i)]
        .map((c) => c.toFixed(3))
        .join(",");
      seen.add(rgb);
      if (pos.getY(i) > topY) {
        topY = pos.getY(i);
        topRgb = rgb;
      }
    }
    // Two colours, exactly the palette's two, and the top of the puff is the cloud.
    expect([...seen].sort(), prefix).toEqual(
      [cloud, belly].map((c) => c.map((x) => x.toFixed(3)).join(",")).sort(),
    );
    expect(topRgb, prefix).toBe(cloud.map((x) => x.toFixed(3)).join(","));
    g.dispose();
  }
  // White base: the vertex colours are the colour. Opaque, lit, faceted, and
  // not named like the sea (so it is baked and shadowed like scenery).
  resetFogMaterial();
  const m = fogKitMaterial();
  expect(m.color.getHex()).toBe(0xffffff);
  expect(m.vertexColors).toBe(true);
  expect(m.flatShading).toBe(true);
  expect(m.transparent).toBe(false);
  expect(m.opacity).toBe(1);
  expect(m.name).not.toMatch(/Ocean/);
  resetFogMaterial();
});

test("a fogged board is one draw per variant, each puff placed once", async () => {
  const kit = await loadKit();
  const tiles = board(3, (h) => (((h.q * 5 + h.r * 2) % 4) + 4) % 4 !== 0);
  const billows = planFog(tiles);
  const floor = planFogFloor(tiles);
  // Variety is real, and every variant index names a shape the kit has.
  expect(new Set(billows.map((p) => p.variant)).size).toBe(FOG_BILLOW_PREFIXES.length);
  expect(new Set(floor.map((p) => p.variant)).size).toBe(FOG_FLOOR_PREFIXES.length);
  const meshes = fogKitMeshes(kit, billows, floor)!;
  expect(meshes).not.toBeNull();
  expect(meshes.length).toBeLessThanOrEqual(FOG_BILLOW_PREFIXES.length + FOG_FLOOR_PREFIXES.length);
  const total = meshes.reduce((n, m) => n + m.count, 0);
  expect(total).toBe(billows.length + floor.length);
  // The first billow of variant 0 is where planFog put it.
  const first = billows.find((p) => p.variant === 0)!;
  const m0 = meshes.find((m) => m.name === "fog_0")!;
  const mat = new THREE.Matrix4();
  m0.getMatrixAt(0, mat);
  const at = new THREE.Vector3().setFromMatrixPosition(mat);
  expect(at.x).toBeCloseTo(first.position[0], 5);
  expect(at.y).toBeCloseTo(first.position[1], 5);
  expect(at.z).toBeCloseTo(first.position[2], 5);
  let freed = 0;
  for (const m of meshes) m.geometry.addEventListener("dispose", () => freed++);
  disposeInstances(meshes);
  expect(freed).toBe(meshes.length);
});

test("a kit missing a variant falls back to the icosahedra", async () => {
  const kit = await loadKit();
  const scene = new THREE.Group();
  kit.scene.traverse((n) => {
    if ((n as THREE.Mesh).isMesh && !n.name.startsWith("Fog_billow_c")) scene.add(n.clone());
  });
  const tiles = board(1, () => true);
  expect(
    fogKitMeshes({ scene, byMaterial: new Map() }, planFog(tiles), planFogFloor(tiles)),
  ).toBeNull();
});

// --- the shore: no ring round the bank ---------------------------------------

/** Every vertex of a geometry, as [x, y, z]. */
function vertsOf(geo: THREE.BufferGeometry): [number, number, number][] {
  const a = geo.getAttribute("position");
  return Array.from({ length: a.count }, (_, i) => [a.getX(i), a.getY(i), a.getZ(i)]);
}

/** Distance from point p to segment ab, in the XZ plane. */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

test("worldToHex inverts hexToWorld, and keeps a point in its own cell", () => {
  for (const h of hexesInRadius(6)) {
    const [x, , z] = hexToWorld(h);
    expect(worldToHex(x, z)).toEqual(h);
    // Anywhere inside the cell's inscribed circle is still that hex.
    for (let k = 0; k < 6; k++) {
      const a = k + 0.3;
      const d = (LATTICE_SIZE * SQRT3) / 2 - 0.05;
      expect(worldToHex(x + d * Math.cos(a), z + d * Math.sin(a))).toEqual(h);
    }
  }
});

test("a fog hex's coast is never drawn with the sand materials", () => {
  // The fog hex and a known island, apart: the fog hex's whole ring is mist,
  // the island's whole ring is sand.
  const tiles = [fog(0, 0), land(4, 0)];
  const keys = fogKeys(tiles);
  const built = planBeaches(tiles, fogTileArt(tiles).land, keys)!;
  expect(built.mist).not.toBeNull();
  const [fx, , fz] = hexToWorld({ q: 0, r: 0 });
  const [lx, , lz] = hexToWorld({ q: 4, r: 0 });
  const near = (p: number[], x: number, z: number) =>
    Math.hypot(p[0] - x, p[2] - z) < LATTICE_SIZE + BEACH_ENVELOPE + 1e-6;
  for (const kind of ["dry", "wet"] as const) {
    const sand = vertsOf(built[kind]);
    const mist = vertsOf(built.mist![kind]);
    expect(sand.length).toBeGreaterThan(0);
    expect(mist.length).toBeGreaterThan(0);
    for (const p of sand) expect(near(p, fx, fz), "sand round the fog hex").toBe(false);
    for (const p of mist) expect(near(p, lx, lz), "mist round known land").toBe(false);
  }
  // And the materials it is drawn in are the cloud's, which palette.json owns,
  // not the shore's.
  const palette = JSON.parse(
    readFileSync(
      join(__dirname, "..", "..", "..", "..", "public", "models", "palette.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  for (const name of Object.values(FOG_SHORE_MATERIALS)) {
    expect(name).not.toMatch(/Shore/);
    expect(palette[name], name).toBeDefined();
  }
});

test("revealing a hex recolours its shore and moves no coast", () => {
  // A fog hex on the end of a known island: the split ribbon, sand plus mist,
  // is exactly the ribbon the board draws once the hex is land, so the known
  // coast cannot shift at the reveal.
  const tiles = [land(0, 0), land(1, 0), fog(2, 0), fog(2, -1), sea(3, 0)];
  const art = fogTileArt(tiles);
  const split = planBeaches(tiles, art.land, fogKeys(tiles))!;
  const revealed = planBeaches(
    tiles.map((t) => (t.res === FOG_RESOURCE ? { ...t, res: "ore" as const } : t)),
  )!;
  const key = (p: number[]) => p.map((v) => v.toFixed(5)).join(",");
  for (const kind of ["dry", "wet"] as const) {
    const parts = [...vertsOf(split[kind]), ...vertsOf(split.mist![kind])].map(key).sort();
    expect(parts).toEqual(vertsOf(revealed[kind]).map(key).sort());
    // Some of each: the known island keeps sand, the fog hexes are mist.
    expect(vertsOf(split[kind]).length).toBeGreaterThan(0);
    expect(vertsOf(split.mist![kind]).length).toBeGreaterThan(0);
  }
  // With nothing fogged there is no mist at all.
  expect(planBeaches([land(0, 0)], undefined, new Set())!.mist).toBeNull();
});

test("a fog hex's cell is one flat plate of cloud, gutter and all", () => {
  const geo = fogPlateGeometry();
  const verts = vertsOf(geo);
  const tops = verts.filter((p) => Math.abs(p[1] - FOG_PLATE_Y) < 1e-6);
  // Out to the lattice cell's corners, so no slab rim or gutter shows.
  expect(Math.max(...tops.map((p) => Math.hypot(p[0], p[2])))).toBeCloseTo(LATTICE_SIZE, 5);
  // Level with the ribbon's crest, so the shore runs off it without a step.
  expect(FOG_PLATE_Y).toBe(TOP_Y);
  expect(FOG_PLATE_Y).toBeLessThan(SURFACE.land);
  // The top faces up, so it is lit like the ground.
  const n = geo.getAttribute("normal");
  const up = verts.findIndex((p, i) => Math.abs(p[1] - FOG_PLATE_Y) < 1e-6 && n.getY(i) > 0.99);
  expect(up).toBeGreaterThanOrEqual(0);
  verts.forEach((p, i) => {
    if (Math.abs(p[1] - FOG_PLATE_Y) < 1e-6) expect(n.getY(i)).toBeGreaterThan(-1e-6);
  });
  geo.dispose();
  // One per fog hex, and the gutter sand skips them.
  const tiles = [fog(0, 0), fog(1, 0), land(-1, 0)];
  expect(planFogPlates(tiles).map((p) => p.position)).toEqual([
    hexToWorld({ q: 0, r: 0 }),
    hexToWorld({ q: 1, r: 0 }),
  ]);
  expect(planGapSand(tiles, fogTileArt(tiles).land, fogKeys(tiles))).toHaveLength(6);
});

test("the shore puffs stay clear of every edge a ship can sail, and in the ribbon", () => {
  // A ship explores from a fog hex's sea-facing edge and can stand on any
  // edge of the water beyond it. Measured against the icosahedron's worst
  // jitter, for every edge of a ten-player board's worth of fog.
  const isFog = (h: Hex) => (((h.q * 7 + h.r * 3) % 5) + 5) % 5 < 3;
  const tiles = hexesInRadius(7).map((h) => (isFog(h) ? fog(h.q, h.r) : sea(h.q, h.r)));
  const { billows, floor } = planFogShore(tiles);
  const all = [...billows, ...floor];
  expect(all.length).toBeGreaterThan(0);
  const corners = (h: Hex): [number, number][] =>
    Array.from({ length: 6 }, (_, i) => {
      const [x, , z] = cornerToWorld(h, i);
      return [x, z];
    });
  const seaEdges: [[number, number], [number, number]][] = [];
  for (const t of tiles) {
    if (t.res === FOG_RESOURCE) continue;
    const c = corners(t.hex);
    for (let i = 0; i < 6; i++) seaEdges.push([c[i], c[(i + 1) % 6]]);
  }
  for (const p of all) {
    expect(p.role).toBe("shore");
    const at: [number, number] = [p.position[0], p.position[2]];
    const r = p.spec.s * (1 + FOG_PUFF_JITTER);
    let nearest = Infinity;
    for (const [a, b] of seaEdges) nearest = Math.min(nearest, segDist(at, a, b) - r);
    expect(nearest, JSON.stringify(p.spec)).toBeGreaterThanOrEqual(FOG_SHORE_CLEARANCE - 1e-9);
    expect(p.spec.z + r).toBeLessThanOrEqual(FOG_SHORE_REACH + 1e-9);
    expect(puffTop(p.spec)).toBeLessThanOrEqual(FOG_MAX_Y);
  }
  // The edge ends are reached by different amounts: not a row of beads.
  expect(new Set(floor.map((p) => p.spec.s.toFixed(3))).size).toBeGreaterThan(10);
});

test("the shore puffs face only water, and depend only on public facts", () => {
  // No puffs toward known land or another fog hex: no ribbon runs there.
  const ring = [0, 1, 2, 3, 4, 5].map((d) => neighbor({ q: 0, r: 0 }, d));
  const walled = planFogShore([fog(0, 0), ...ring.map((h) => land(h.q, h.r))]);
  expect([...walled.floor, ...walled.billows]).toEqual([]);
  const banked = planFogShore([fog(0, 0), ...ring.map((h) => fog(h.q, h.r))]);
  for (const p of [...banked.floor, ...banked.billows]) {
    expect(Math.hypot(p.position[0], p.position[2])).toBeGreaterThan(LATTICE_SIZE * SQRT3);
  }
  // A lone fog hex in open water gets puffs on all six sides.
  const lone = planFogShore([fog(0, 0)]);
  expect(
    new Set(
      lone.floor.map(
        (p) => (Math.round(Math.atan2(p.position[2], p.position[0]) / (Math.PI / 3)) + 6) % 6,
      ),
    ).size,
  ).toBe(6);
  // Repainting known land with another terrain changes nothing; what is under
  // a fog hex is never read.
  const isFog = (h: Hex) => (((h.q * 7 + h.r * 3) % 5) + 5) % 5 < 2;
  const drawn = (other: BoardTile["res"]) => JSON.stringify(planFogShore(board(3, isFog, other)));
  expect(drawn("ore")).toBe(drawn("wood"));
  // A water hex named in `avoid` (a harbour, the Council) gets none.
  const avoided = planFogShore([fog(0, 0)], undefined, new Set([hexKey({ q: 1, r: 0 })]));
  expect(avoided.floor.length).toBeLessThan(lone.floor.length);
  const [ax, , az] = hexToWorld({ q: 1, r: 0 });
  for (const p of [...avoided.floor, ...avoided.billows]) {
    expect(Math.hypot(p.position[0] - ax, p.position[2] - az)).toBeGreaterThan(
      (LATTICE_SIZE * SQRT3) / 2,
    );
  }
});

test("a known hex beside fog gets a beach on that side, inside the fog cell", () => {
  // Fog at the origin: known land on one side, sea on another, more fog on a
  // third. Only the edge shared with known land gets sand.
  const tiles = [fog(0, 0), land(1, 0), sea(-1, 0), fog(-1, 1)];
  const geo = planFogLandBeach(tiles)!;
  expect(geo).not.toBeNull();
  const [cx, , cz] = hexToWorld({ q: 0, r: 0 });
  const [lx, , lz] = hexToWorld({ q: 1, r: 0 });
  const len = Math.hypot(lx - cx, lz - cz);
  const apothem = len / 2;
  const tops = vertsOf(geo).filter((p) => p[1] > 0);
  expect(tops.length).toBeGreaterThan(0);
  for (const [x, y, z] of tops) {
    expect(y).toBeCloseTo(FOG_LAND_BEACH_Y, 6);
    // Along the normal to the known neighbour: between the inset line and the
    // lattice line, on the fog side.
    const along = ((x - cx) * (lx - cx) + (z - cz) * (lz - cz)) / len;
    expect(along).toBeGreaterThan(apothem - FOG_LAND_BEACH_DEPTH - 1e-4);
    expect(along).toBeLessThan(apothem + 1e-4);
  }
  geo.dispose();
  // Nothing known beside the fog: no strip.
  expect(planFogLandBeach([fog(0, 0), sea(1, 0), fog(0, 1)])).toBeNull();
  expect(planFogLandBeach([land(0, 0), sea(1, 0)])).toBeNull();
});
