// The scenario art (lake tile, camels, fishing weir), measured off the shipped
// files. Each carries a number the renderer depends on but cannot check: the
// camel's scale, the weir's depth in the water, the weir's facing. A TS
// constant that agrees with the art only by coincidence passes typecheck and
// looks fine in Blender's showcase board.
//
// Read straight from the GLB, as `knightSwordArt.test.ts` and
// `pieceFacing.test.ts` do, since the loader needs WebGL. Node transforms are
// applied because the export writes placement as a node transform.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_SCALE } from "./pieceArt";
import { SURFACE, seatY } from "./seating";
import { OCEAN_MAX_Y, OCEAN_WATER_MATERIAL } from "./ocean";
import { tileScale } from "./layers/tiles";
import { TILES } from "./manifest.generated";
import { WEIR_PREFIX, WEIR_FACES, weirBearingY } from "./layers/fishermen";
import { CAMEL_PREFIX, SPOKE_PREFIX } from "./layers/caravans";
import { PIECE_SCALE, PIECE_PREFIX } from "./pieceArt";
import * as THREE from "three";
import { newGLTFLoader, subsetByPrefix, tileFileFor, assetBaseY, type LoadedAsset } from "./loader";
import { instanceAsset } from "./instancing";
import { seat as seatOn } from "./seating";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies: the shipped files are meshopt-encoded. See
// testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

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
    // Fall back to the mesh name: a tile's merged slab comes back as an unnamed
    // node wrapping a mesh called `Hex_<Terrain>`.
    const name = node.name ?? gltf.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    // A tipped node would silently break every number below, so assert it.
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

/**
 * Every vertex of every node named `prefix*`, in the file's own space. Needed
 * where a box cannot answer, e.g. the gap between a camel's legs.
 *
 * Reads floats from the BIN chunk, which only the plain copies carry (see
 * `MODELS`); the shipped files are quantised.
 */
function points(file: string, prefix: string): [number, number, number][] {
  const buf = readFileSync(join(MODELS, file));
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  // The BIN chunk follows the JSON one, each with an 8-byte header.
  const binAt = 20 + jsonLen + 8;

  const out: [number, number, number][] = [];
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? gltf.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    const t = (node.translation ?? [0, 0, 0]) as [number, number, number];
    const s = (node.scale ?? [1, 1, 1]) as [number, number, number];
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const acc = gltf.accessors[prim.attributes.POSITION];
      expect(acc.componentType, `${file} is not plain float32`).toBe(5126);
      const view = gltf.bufferViews[acc.bufferView];
      const stride = view.byteStride ?? 12;
      const base = binAt + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) {
        const at = base + i * stride;
        out.push([
          buf.readFloatLE(at) * s[0] + t[0],
          buf.readFloatLE(at + 4) * s[1] + t[1],
          buf.readFloatLE(at + 8) * s[2] + t[2],
        ]);
      }
    }
  }
  expect(out.length, `${prefix}: no vertices found in ${file}`).toBeGreaterThan(0);
  return out;
}

/** The glTF JSON chunk of one model, parsed. */
function gltfOf(file: string): {
  nodes: { name?: string; mesh?: number }[];
  meshes: { name?: string; primitives: { material?: number; indices: number }[] }[];
  materials?: { name?: string }[];
  accessors: { count: number }[];
} {
  const buf = readFileSync(join(MODELS, file));
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
}

/** Every material worn by a node named `prefix*`, sorted and deduplicated. */
function materialsOf(file: string, prefix: string): string[] {
  const gltf = gltfOf(file);
  const out = new Set<string>();
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? gltf.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    for (const prim of gltf.meshes[node.mesh].primitives) {
      if (prim.material === undefined) continue;
      const mat = gltf.materials?.[prim.material]?.name;
      if (mat) out.add(mat);
    }
  }
  expect(out.size, `${prefix}: no materials found in ${file}`).toBeGreaterThan(0);
  return [...out].sort();
}

/**
 * Triangles in every node named `prefix*`. The exporter triangulates and flat
 * shading splits vertices, so triangles are the countable quantity (and what a
 * frame costs).
 */
function triangles(file: string, prefix: string): number {
  const gltf = gltfOf(file);
  let total = 0;
  let found = 0;
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const name = node.name ?? gltf.meshes[node.mesh].name;
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    found++;
    for (const prim of gltf.meshes[node.mesh].primitives) {
      total += gltf.accessors[prim.indices].count / 3;
    }
  }
  expect(found, `${prefix}: no geometry found in ${file}`).toBeGreaterThan(0);
  return total;
}

// --- the camel ----------------------------------------------------------

const CAMELS = "camels.glb";

test("the camel is authored along +x, the way a road is", () => {
  // `edgeRotationY` turns art authored along +x onto its edge and is the only
  // thing that turns a camel; art along z would lie across every road.
  const { lo, hi } = span(CAMELS, CAMEL_PREFIX);
  const long = hi[0] - lo[0];
  const wide = hi[2] - lo[2];
  expect(long, "the camel is longer than it is wide").toBeGreaterThan(wide * 2);
  // It straddles the origin, which is the edge midpoint.
  expect(lo[0]).toBeLessThan(0);
  expect(hi[0]).toBeGreaterThan(0);
});

test("the camel faces +x, so it needs a bearing, not an axis", () => {
  // The test above would also pass for a headless bar; this checks direction.
  // The head is wholly on the +x side, so a half turn is visible.
  // `edgeRotationY` derives an axis from a normalised Edge and gets this wrong
  // on about half the edges, so `planCamels` takes its bearing from the caravan
  // chain instead.
  const head = span(CAMELS, "Camel_head");
  const body = span(CAMELS, "Camel_body");
  const bodyMid = (body.lo[0] + body.hi[0]) / 2;
  expect(head.lo[0], "the head must be forward of the body's middle").toBeGreaterThan(bodyMid);
  expect(head.lo[0], "the head must be on the +x side outright").toBeGreaterThan(0);

  // The whole animal is off-centre along its length by about a tenth of a hex.
  const whole = span(CAMELS, CAMEL_PREFIX);
  expect(Math.abs(whole.lo[0] + whole.hi[0])).toBeGreaterThan(0.1);

  // Contrast: the road really is symmetric about its middle, which is why
  // `edgeRotationY` suits it. 5 digits because the road is symmetric to 6e-7
  // (export precision) and the camel's asymmetry is 0.261.
  const road = span("pieces.glb", PIECE_PREFIX.road);
  expect(road.lo[0] + road.hi[0], "the road is symmetric about its middle").toBeCloseTo(0, 5);
});

test("the camel is authored at drawn size (MODULE_SCALE.camel = 1)", () => {
  // Every other MODULE_SCALE entry corrects art modelled at true scale; this
  // one asserts there is nothing to correct, by measuring the camel against the
  // road at the road's drawn size.
  expect(MODULE_SCALE.camel).toBe(1);

  const camel = span(CAMELS, CAMEL_PREFIX);
  const road = span("pieces.glb", PIECE_PREFIX.road);
  // The body: its belly must clear the road between the legs.
  const body = span(CAMELS, "Camel_body");

  // Both sit on the gutter. The road is scaled by PIECE_SCALE.road; the camel is
  // drawn at its authored height.
  const roadTop =
    seatY(SURFACE.gutter, road.lo[1], PIECE_SCALE.road) + PIECE_SCALE.road * road.hi[1];
  const belly = seatY(SURFACE.gutter, camel.lo[1], MODULE_SCALE.camel) + body.lo[1];
  expect(belly, "the camel's belly must clear the road it straddles").toBeGreaterThan(roadTop);

  // True scale would put the belly under the road; double scaling would float
  // it half a hex over. About a quarter hex of daylight is intended.
  expect(belly - roadTop).toBeLessThan(0.75);
});

test("the camel's feet stand outside the road it straddles", () => {
  // A leg's inner face is inside the camel's AABB, so this reads vertices.
  //
  // The road is 0.25 wide as authored, drawn half-width 0.1438. Only the leg
  // below the road's top must clear it, so the legs can splay out from under a
  // narrower barrel.
  const road = span("pieces.glb", PIECE_PREFIX.road);
  const roadTop =
    seatY(SURFACE.gutter, road.lo[1], PIECE_SCALE.road) + PIECE_SCALE.road * road.hi[1];
  // Not from the bounding box: the road node has a 30 degree turn that `span`
  // does not apply, so its box is 1.197 across against the bar's real 0.25.
  // The narrowest projection of the footprint is the bar's width.
  const road2d = points("pieces.glb", PIECE_PREFIX.road).map((p) => [p[0], p[2]]);
  let width = Infinity;
  for (let k = 0; k < 900; k++) {
    const a = (Math.PI * k) / 1800;
    const at = road2d.map(([x, z]) => x * Math.cos(a) + z * Math.sin(a));
    width = Math.min(width, Math.max(...at) - Math.min(...at));
  }
  const roadHalf = (PIECE_SCALE.road * width) / 2;
  expect(roadHalf, "the road is 0.25 wide authored").toBeCloseTo(0.1438, 3);

  const lift = seatY(SURFACE.gutter, span(CAMELS, CAMEL_PREFIX).lo[1], MODULE_SCALE.camel);
  const low = points(CAMELS, "Camel_legs").filter((p) => p[1] + lift <= roadTop);
  expect(low.length, "some of the leg is down at road height").toBeGreaterThan(0);
  const inner = Math.min(...low.map((p) => Math.abs(p[2])));
  expect(inner, "a foot inside the road is a leg drawn through it").toBeGreaterThan(roadHalf);
});

test("the camel stands on the piece plane", () => {
  // 0.25 is where every piece modelled on a tile starts (see seating.ts), so
  // `seatOn(..., SURFACE.gutter, assetBaseY(art), 1)` puts the feet on the
  // gutter. Re-anchoring the art to y = 0 would bury it.
  expect(span(CAMELS, CAMEL_PREFIX).lo[1]).toBeCloseTo(0.25, 4);
});

test("the camel has four values and a stepped hump and barrel", () => {
  // The house figure style, from `render_barbarians.py`'s family frame: a body
  // value, a shade one step darker, one pale silhouette-breaking prop, and
  // detail as a step in the profile rather than another loft ring. Counted
  // from the shipped file so a smooth loft cannot come back unnoticed.
  expect(materialsOf(CAMELS, CAMEL_PREFIX)).toEqual([
    "Mat_Camel_blanket",
    "Mat_Camel_body",
    "Mat_Camel_leg",
    "Mat_Camel_pack",
  ]);

  // The hump: two rings, a base and a cap. 8 sides x 1 segment plus two
  // octagonal caps is 28 triangles.
  expect(triangles(CAMELS, "Camel_hump")).toBe(28);
  // The barrel: four stations plus a four-sided tail. 8 sides x 3 segments and
  // two octagonal caps is 60, plus 12 for the tail.
  expect(triangles(CAMELS, "Camel_body")).toBe(72);
  // An upper bound on the whole animal.
  expect(triangles(CAMELS, CAMEL_PREFIX)).toBeLessThan(508);
});

// --- the spoke waypost --------------------------------------------------

const SPOKES = "spokes.glb";

test("the waypost brackets its edge: a pair, spread along +x", () => {
  // Two posts, one at each end, so it reads as a gateway. Authored along +x
  // like the camel and road, so `edgeRotationY` lays it across the edge.
  const { lo, hi } = span(SPOKES, SPOKE_PREFIX);
  expect(hi[0] - lo[0], "wider than it is deep").toBeGreaterThan((hi[2] - lo[2]) * 2);
  expect(hi[0] - lo[0], "as wide as the edge it brackets").toBeCloseTo(1.8, 3);
});

test("the waypost is mirror-symmetric", () => {
  // `planSpokes` turns a spoke with `edgeRotationY`, and an Edge is an
  // unordered pair, so it says nothing about which end is the oasis. Swapping
  // the ends is a half turn, so any directional cue would point the wrong way
  // on about half the spokes. Hence no arrowhead.
  //
  // Any piece turned by `edgeRotationY` must be symmetric (road, ship, spoke).
  // The camel is not: it has a head, which is why `planCamels` takes its
  // bearing from the caravan chain. If this fails because of a finial, remove
  // it or orient the spoke from its caravan's `corner`; do not loosen the
  // tolerance.
  for (const part of ["Spoke_stone", "Spoke_post", "Spoke_cap"]) {
    const { lo, hi } = span(SPOKES, part);
    expect(lo[0] + hi[0], `${part} is lopsided along the edge`).toBeCloseTo(0, 6);
    expect(lo[2] + hi[2], `${part} is lopsided across the edge`).toBeCloseTo(0, 6);
  }
});

test("the waypost stands on the piece plane, the same ground the camel does", () => {
  // Both are seated on SURFACE.gutter and drawn at 1, so a camel replacing a
  // spoke lands in the same place at the same size.
  expect(span(SPOKES, SPOKE_PREFIX).lo[1]).toBeCloseTo(0.25, 4);
  expect(span(CAMELS, CAMEL_PREFIX).lo[1]).toBeCloseTo(0.25, 4);
  expect(MODULE_SCALE.spoke).toBe(1);
  expect(MODULE_SCALE.spoke).toBe(MODULE_SCALE.camel);
});

test("a camel fits between the wayposts rather than through them", () => {
  // `planSpokes` drops a spoke when a camel takes the edge, so they never share
  // one. But a spoke and a camel on the next edge meet at the shared corner, so
  // the posts must sit clear of the camel's body.
  const posts = span(SPOKES, "Spoke_post");
  const camel = span(CAMELS, CAMEL_PREFIX);
  // The posts are outboard of the camel's own length: they bracket it.
  expect(posts.hi[0]).toBeGreaterThan(camel.hi[0] * 0.7);
  // And they are narrow across the path, so a camel passing is not clipped.
  expect(posts.hi[2] - posts.lo[2]).toBeLessThan(camel.hi[2] - camel.lo[2]);
});

// --- the weir -----------------------------------------------------------

const FISHING = "fishing.glb";

test("the weir is not symmetric: it stands off to one side of its own origin", () => {
  // Why the layer yaws it: the marker sits on a coastal corner and fishes the
  // water on one side of it, so the art stands clear of its origin. Left
  // unrotated, the stakes land on dry land or off the board at some corners.
  const { lo, hi } = span(FISHING, WEIR_PREFIX);
  expect(hi[2], "the weir crosses its own origin in z").toBeLessThan(0);
  // Centred across its width: the corner is the middle of the fence line.
  expect(lo[0] + hi[0]).toBeCloseTo(0, 2);
});

test("WEIR_FACES is the direction the art points", () => {
  // Blender authors the marker along +y and the glTF export maps (x, y, z) to
  // (x, z, -y), so it points along -z. Re-authoring it the other way would turn
  // every weir 180 degrees.
  const { lo, hi } = span(FISHING, WEIR_PREFIX);
  const centre: [number, number] = [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2];
  const len = Math.hypot(centre[0], centre[1]);
  expect(len, "the weir has no facing at all").toBeGreaterThan(0.1);
  expect(centre[0] / len).toBeCloseTo(WEIR_FACES[0], 2);
  expect(centre[1] / len).toBeCloseTo(WEIR_FACES[1], 2);

  // Asked for the direction the art already points, the bearing is zero.
  expect(weirBearingY(WEIR_FACES[0], WEIR_FACES[1])).toBeCloseTo(0, 6);
});

test("the weir is planted in the water and never seated", () => {
  // Other pieces are seated so their lowest point rests on a surface. The
  // weir's stakes are driven into the seabed, so Board3D places it at y = 0
  // with the authored heights; seating it would lift it out of the water.
  const { lo, hi } = span(FISHING, WEIR_PREFIX);
  const S = MODULE_SCALE.fishingGround;
  expect(S).toBe(1.4);

  const base = lo[1] * S;
  expect(base, "the weir's foot, in world units").toBeCloseTo(0.035, 3);

  // Against the sea tile as drawn: water tiles are exported at their own size
  // and `tileScale` scales them to the lattice cell at load, which lifts the
  // top face. The authored 0.1596 is the wrong reference.
  const seaTop = span("tiles/sea.glb", "Hex_Ocean").hi[1] * tileScale("sea");
  expect(base, "driven below the sea tile's own top face").toBeLessThan(seaTop);
  expect(seaTop - base, "how deep it is driven").toBeGreaterThan(0.1);

  // The top must stand above the highest the swell reaches.
  expect(hi[1] * S).toBeGreaterThan(OCEAN_MAX_Y);
});

// --- the lake tile ------------------------------------------------------

test("the lake is a land slab", () => {
  // A water tile is authored a full lattice cell wide (circumradius 3.1443,
  // top at 0.1596) and scaled up at load; a land tile is authored at 3.0 with
  // its top at 0.22 and keeps its size, leaving the perimeter for roads and
  // buildings. The lake is a land tile, and `board.Land` is true for it.
  //
  // `make check-hexes` is the primary gate (the `wat` column); this is the
  // frontend's copy, since the frontend is what would draw it wrong.
  const lake = span("tiles/lake.glb", "Hex_Lake");
  const desert = span("tiles/none.glb", "Hex_Desert");
  const ocean = span("tiles/sea.glb", "Hex_Ocean");

  // The lake matches the desert's shape to four places and not the ocean's.
  expect(lake.hi[2] - lake.lo[2], "circumradius").toBeCloseTo(desert.hi[2] - desert.lo[2], 4);
  expect(lake.hi[1], "top face").toBeCloseTo(desert.hi[1], 4);
  expect(lake.hi[2] - lake.lo[2]).not.toBeCloseTo(ocean.hi[2] - ocean.lo[2], 2);

  // The renderer keeps its authored size.
  expect(tileScale("lake")).toBe(1);
  expect(tileScale("sea")).toBeGreaterThan(1);
});

// --- the whole path, plan to instanced mesh -----------------------------
//
// The join between art tests and `layers/*.test.ts` plan tests: the shipped
// file is parsed by the app's loader, cut by the layer's prefix, and instanced
// at the layer's placements. A bad prefix, a misplaced file or an empty subset
// all show up here as "no meshes".

async function assetOf(file: string): Promise<LoadedAsset> {
  const buf = readFileSync(join(MODELS, file));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    newGLTFLoader().parse(ab, "", resolve, reject),
  );
  const byMaterial = new Map<string, THREE.Mesh[]>();
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) byMaterial.set(mat.name, [...(byMaterial.get(mat.name) ?? []), mesh]);
  });
  return { scene: gltf.scene, byMaterial };
}

/** Where instance `i` of a built mesh actually ended up. */
function instanceAt(meshes: THREE.InstancedMesh[], i: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  meshes[0].getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

test("a camel plan becomes instanced geometry on its edge", async () => {
  const art = subsetByPrefix(await assetOf(CAMELS), CAMEL_PREFIX);
  expect(art.scene.children.length, "the camel prefix cut nothing").toBeGreaterThan(0);

  const at = [
    { position: [3, 0, 4] as [number, number, number], rotationY: 0.5, key: "camel:a" },
    { position: [-2, 0, 1] as [number, number, number], rotationY: -1.1, key: "camel:b" },
  ];
  const meshes = instanceAsset(
    art,
    seatOn(at, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.camel),
  );
  expect(meshes.length, "no meshes built").toBeGreaterThan(0);
  for (const m of meshes) expect(m.count).toBe(2);
  // Absolute, because the camel's parts export at the origin. The weir below
  // cannot be checked this way: its parts carry their own offsets.
  expect(instanceAt(meshes, 0).x).toBeCloseTo(3, 6);
  expect(instanceAt(meshes, 0).z).toBeCloseTo(4, 6);
});

test("a weir plan becomes instanced geometry at its draw scale", async () => {
  const art = subsetByPrefix(await assetOf(FISHING), WEIR_PREFIX);
  expect(art.scene.children.length, "the weir prefix cut nothing").toBeGreaterThan(0);

  const at = (p: [number, number, number]) => [
    { position: p, rotationY: 0.3, scale: MODULE_SCALE.fishingGround, key: "weir:a" },
  ];
  const meshes = instanceAsset(art, at([1, 0, 2]));
  expect(meshes.length, "no meshes built").toBeGreaterThan(0);
  for (const m of meshes) expect(m.count).toBe(1);

  // Checked as a difference: each weir part carries its own node offset and
  // `instanceAsset` composes placement * local, so moving the placement must
  // move the piece one for one.
  const moved = instanceAt(instanceAsset(art, at([3, 5, 6])), 0);
  const base = instanceAt(meshes, 0);
  expect(moved.x - base.x).toBeCloseTo(2, 6);
  expect(moved.y - base.y).toBeCloseTo(5, 6);
  expect(moved.z - base.z).toBeCloseTo(4, 6);
  expect(MODULE_SCALE.fishingGround).toBe(1.4);
});

test("the loader can parse and place the lake tile", async () => {
  // `planTiles` names a file string; check it reaches a parseable model.
  const file = tileFileFor("lake");
  expect(file).toBe("tiles/lake.glb");
  const asset = await assetOf(file!);
  let meshes = 0;
  asset.scene.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) meshes++;
  });
  expect(meshes, "the lake tile parsed to nothing").toBeGreaterThan(20);
  // The water inset uses the same palette colour as the oasis pond.
  expect([...asset.byMaterial.keys()]).toContain("Mat_Lake_water");
});

// --- the lake's own geometry --------------------------------------------
//
// The same claims as the oasis pond, plus the border: the water is level, sunk
// below the slab top, banked, big, and clear of the chip socket, and the tile
// carries a rim that ramps down to the gutter sand.

test("the lake is a level sheet of water, sunk into the tile", () => {
  const file = TILES["lake"].file;
  const water = span(file, "Lake_water");
  const slab = span(file, "Hex_Lake");

  // Level: every vertex of the sheet is authored at one height, so this needs
  // no tolerance. (Two colours, shoal band and open water, one height.)
  expect(water.hi[1] - water.lo[1], "the lake surface is not level").toBeCloseTo(0, 6);
  expect(water.lo[1]).toBeCloseTo(0.19, 4);

  // Sunk below the opaque slab's top face, or the sheet is a decal. Measured
  // against the slab in the same file.
  expect(slab.hi[1], "the slab is not at its contract height").toBeCloseTo(0.22, 3);
  expect(water.hi[1], "the lake is not below the slab top").toBeLessThan(slab.hi[1]);

  // Banked from under the waterline up to the ground's lip, with its top (the
  // verge shelf) under the 0.25 chip underside.
  const bank = span(file, "Lake_bank");
  expect(bank.lo[1], "the bank does not reach the water").toBeLessThan(water.lo[1] + 0.005);
  expect(bank.hi[1] - water.hi[1], "the bank is too shallow to read").toBeGreaterThan(0.04);
  expect(bank.hi[1], "the bank stands into the chip's keep-clear height").toBeLessThan(0.25);

  // Big: the sheet spans most of a hex (apothem 2.598). Absolute numbers rather
  // than a comparison with the oasis, which changes independently.
  expect(water.hi[0] - water.lo[0], "the lake is not wide enough to be a lake").toBeGreaterThan(
    2.6,
  );
  expect(water.hi[2] - water.lo[2]).toBeGreaterThan(2.0);

  // Clear of the socket: the chip mounts at (0, -1.5) in glTF axes with a
  // keep-clear radius of 1.05, so the water is pushed south. Checked on the
  // bounding box, which is stricter than the mesh.
  const socket = TILES["lake"].socket;
  // Throw rather than `!`: water tiles legitimately have no socket, but a land
  // tile that lost one should fail loudly.
  if (socket === null) throw new Error("the lake tile has no chip socket");
  const [sx, , sz] = socket;
  const near = (lo: number, hi: number, at: number) => Math.min(Math.max(at, lo), hi);
  const gap = Math.hypot(
    near(water.lo[0], water.hi[0], sx) - sx,
    near(water.lo[2], water.hi[2], sz) - sz,
  );
  expect(gap, "the lake crowds the number chip").toBeGreaterThan(1.05);
});

test("the lake carries a rim, and it ends in a cutbank at the gutter", () => {
  // `art/README.md`'s terrain-rim contract: the chamfer runs inward from the
  // art apothem by half the gutter and drops to the gutter sand's height. This
  // rim is `Pasture_rim` itself, which `gen/lake.py` appends and rebuilds in
  // this tile's frame, so border and lip colour match the pasture. (`Desert_rim`
  // is the same mesh in other colours.)
  const file = TILES["lake"].file;
  const rim = span(file, "Lake_rim");
  const slab = span(file, "Hex_Lake");

  // It stops at the slab edge; the gutter is for roads and settlements.
  expect(rim.hi[0] - rim.lo[0], "the rim is not the slab's own width").toBeCloseTo(
    slab.hi[0] - slab.lo[0],
    3,
  );

  // Its outer edge sits 0.0005 above the shared 0.220 of gutter sand, slab top
  // and rim: the tie-break against z-fighting that the shipped rims use.
  expect(rim.lo[1], "the rim's outer edge is not on the gutter tie-break").toBeCloseTo(0.2205, 4);
  expect(rim.lo[1], "the rim's outer edge is under the slab top").toBeGreaterThan(slab.hi[1]);

  // A real ramp: from 0.290 down 6.9cm to the sand.
  expect(rim.hi[1] - rim.lo[1], "the rim has no fall").toBeGreaterThan(0.05);
  expect(rim.hi[1], "the rim stands into the chip's keep-clear height").toBeCloseTo(0.29, 3);

  // The exact pasture mesh: it varies its middle ring in radius as well as
  // height and carries three materials on that band and two on the next, so an
  // approximation gets the lip wrong. Measured against `sheep.glb`.
  const pasture = span(TILES["sheep"].file, "Pasture_rim");
  for (const i of [0, 1, 2]) {
    expect(rim.lo[i], `rim lo[${i}] is not the pasture's`).toBeCloseTo(pasture.lo[i], 4);
    expect(rim.hi[i], `rim hi[${i}] is not the pasture's`).toBeCloseTo(pasture.hi[i], 4);
  }
});

test("the lake wears a still material, never the sea's", async () => {
  const asset = await assetOf(TILES["lake"].file);
  const materials = [...asset.byMaterial.keys()];
  // `ocean.ts` displaces exactly one material name (pinned by `ocean.test.ts`),
  // so the lake uses its own names to avoid a swell.
  expect(materials).toContain("Mat_Lake_water");
  expect(materials).toContain("Mat_Lake_shoal");
  expect(materials).not.toContain(OCEAN_WATER_MATERIAL);
  // The recess surfaces: mud cutbank, green verge, wet margin.
  expect(materials).toContain("Mat_Lake_mud");
  expect(materials).toContain("Mat_Lake_verge");
  expect(materials).toContain("Mat_Lake_shallows");
  // The ground and border are the pasture's, appended rather than retyped, so
  // a `PALETTE_CONFLICT` is impossible. Green ground is what distinguishes this
  // tile from the oasis, so sand is asserted absent.
  expect(materials).toContain("Mat_Pasture_grass_lit");
  expect(materials).toContain("Mat_Pasture_grass_dk");
  expect(materials).toContain("Mat_Pasture_mud");
  expect(materials.filter((m) => m.startsWith("Mat_Desert"))).toEqual([]);

  // The slab too: its 0.47 side wall is the most visible surface at the tile
  // edge, and a brown one would outline a green tile. `Mat_Lake_slab` is gone
  // (`palette.test.ts`'s dead-override guard keeps palette.json in step).
  expect(materials).toContain("Mat_Pasture");
  expect(materials).not.toContain("Mat_Lake_slab");
  // The jetty and boat use the harbour's timber: one wood on the board.
  expect(materials).toContain("Mat_Port_deck");
  expect(materials).toContain("Mat_Port_frame");
});

// --- the oasis pond -----------------------------------------------------
//
// The pool must be a recess, not a decal sitting on the sand: level, sunk below
// the slab top, banked, and clear of the chip socket, measured off the shipped
// file.

test("the oasis pond is a flat sheet of water, sunk into the tile", () => {
  const file = TILES["oasis"].file;
  const water = span(file, "Oasis_water");
  const slab = span(file, "Hex_Oasis");

  // Flat: a single n-gon in the blend, so this needs no tolerance.
  expect(water.hi[1] - water.lo[1], "the pond surface is not level").toBeCloseTo(0, 6);
  expect(water.lo[1]).toBeCloseTo(0.19, 4);

  // Sunk below the opaque slab's top face, or the sheet is a decal. Measured
  // against the slab in the same file.
  expect(slab.hi[1], "the slab is not at its contract height").toBeCloseTo(0.22, 3);
  expect(water.hi[1], "the pond is not below the slab top").toBeLessThan(slab.hi[1]);

  // Banked from the water up to the ground's lip; its top (the verge shelf)
  // stays under the 0.25 chip underside.
  const bank = span(file, "Oasis_bank");
  expect(bank.lo[1], "the bank does not reach the water").toBeLessThan(water.lo[1] + 0.005);
  expect(bank.hi[1] - water.hi[1], "the bank is too shallow to read").toBeGreaterThan(0.04);
  expect(bank.hi[1], "the bank stands into the chip's keep-clear height").toBeLessThan(0.25);

  // Clear of the socket: the chip mounts at (0, -1.5) in glTF axes with a
  // keep-clear radius of 1.05, so the pond is pushed south. Checked on the
  // bounding box, which is stricter than the mesh.
  const socket = TILES["oasis"].socket;
  // Throw rather than `!`: water tiles legitimately have no socket, but a land
  // tile that lost one should fail loudly.
  if (socket === null) throw new Error("the oasis tile has no chip socket");
  const [sx, , sz] = socket;
  const near = (lo: number, hi: number, at: number) => Math.min(Math.max(at, lo), hi);
  const gap = Math.hypot(
    near(water.lo[0], water.hi[0], sx) - sx,
    near(water.lo[2], water.hi[2], sz) - sz,
  );
  expect(gap, "the pond crowds the number chip").toBeGreaterThan(1.05);
});

test("the oasis pond wears a still material, never the sea's", async () => {
  const asset = await assetOf(TILES["oasis"].file);
  const materials = [...asset.byMaterial.keys()];
  // `ocean.ts` displaces exactly one material name (pinned by `ocean.test.ts`),
  // so the pond has its own name, at the lake water's colour.
  expect(materials).toContain("Mat_Oasis_water");
  expect(materials).not.toContain(OCEAN_WATER_MATERIAL);
  // The recess surfaces: the cutbank and the wet margin.
  expect(materials).toContain("Mat_Oasis_bank");
  expect(materials).toContain("Mat_Oasis_shallows");
});

// The border. `make check-hexes` checks it on the Blender side
// (`hexcontract.rim_violations`); this checks the shipped file.
test("the oasis carries a rim, and it is the shared border's profile", async () => {
  const file = TILES["oasis"].file;
  const rim = span(file, "Oasis_rim");

  // Down to the gutter sand at the outer edge, up to the ground at the inner.
  // The extra 0.0005 is the tie-break where three surfaces meet at 0.220, as on
  // the other shared-border tiles.
  expect(rim.lo[1], "the rim does not reach the gutter").toBeCloseTo(0.2205, 4);
  expect(rim.hi[1], "the rim does not climb to the ground").toBeCloseTo(0.29, 4);
  expect(rim.hi[1] - rim.lo[1], "a rim that does not climb is a decal").toBeGreaterThan(0.02);

  // Full width, to the art hexagon's edge midpoint, or the coplanar slab and
  // gutter sand z-fight in the gap.
  expect(rim.hi[0], "the rim is short of the hexagon").toBeCloseTo(2.5981, 3);

  // The lip: `Mat_Oasis_gravel` is the dark band at the cutbank edge, standing
  // in for the outline shadow the sunken slab no longer casts.
  const asset = await assetOf(file);
  expect([...asset.byMaterial.keys()]).toContain("Mat_Oasis_gravel");
});
