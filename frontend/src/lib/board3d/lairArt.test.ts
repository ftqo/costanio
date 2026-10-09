// The round-2 Explorers and Caravans pieces, measured off the shipped files.
//
//   lairs.glb    `Lair_*`, the pirate lair token (the skull rock), and
//                `Boarder_*`, the crew figure that stands on a hex.
//   camels.glb   `Raft_*`, the punt a camel rides on a pure sea path.
//   the tiles    the goldfield's `LairSlot_<n>` and the spice farm's
//                `FarmSlot_<n>`, which reach the renderer through the
//                manifest, and the ground at every one of them kept clear.
//
// Asserted: what the renderer relies on and a blend cannot show from one
// camera: budgets, bases, which parts carry a seat slot, and that a figure on
// a slot stands on ground rather than in a bush, a tent or the token. Read
// through the loader's GLTF parser, as `explorersCouncil.test.ts` does, so it
// measures what a browser gets.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { newGLTFLoader, EXPLORERS_MODELS, CARAVANS_MODELS } from "./loader";
import { TILES, TINT_SLOTS } from "./manifest.generated";
import { LAIR_PREFIX, BOARDER_PREFIX, LAIR_CAPTURE_CREWS } from "./layers/explorers";
import {
  CAMEL_PREFIX,
  RAFT_PREFIX,
  RAFT_WATERLINE,
  RAFT_SHIFT,
  SHIP_SHIFT,
} from "./layers/caravans";
import { SHIP_PREFIX } from "./layers/islands";
import { LATTICE_SIZE } from "./coords";
import { HEX_SIZE } from "./manifest.generated";
import { MODULE_SCALE } from "./pieceArt";

const MODELS = join(__dirname, "..", "..", "..", "public", "models");

interface Part {
  name: string;
  points: THREE.Vector3[];
  triangles: number;
  materials: string[];
  flat: boolean;
}

const cache = new Map<string, Promise<Part[]>>();

/** Every mesh in a shipped model, with its world-space points. */
function parts(file: string): Promise<Part[]> {
  const hit = cache.get(file);
  if (hit) return hit;
  const p = (async () => {
    const buf = readFileSync(join(MODELS, file));
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
      newGLTFLoader().parse(ab, "", resolve, reject),
    );
    gltf.scene.updateMatrixWorld(true);
    const out: Part[] = [];
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry;
      const pos = g.getAttribute("position");
      const nrm = g.getAttribute("normal");
      const index = g.getIndex();
      const tri = (i: number) => (index ? index.getX(i) : i);
      const count = index ? index.count : pos.count;
      let flat = true;
      for (let i = 0; i < count && nrm; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(nrm, tri(i));
        for (const j of [1, 2]) {
          const b = new THREE.Vector3().fromBufferAttribute(nrm, tri(i + j));
          if (a.distanceTo(b) > 1e-3) flat = false;
        }
      }
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < pos.count; i++) {
        points.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
      }
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
        (m) => m.name,
      );
      out.push({ name: mesh.name, points, triangles: count / 3, materials: mats, flat });
    });
    return out;
  })();
  cache.set(file, p);
  return p;
}

async function family(file: string, prefix: string): Promise<Part[]> {
  const all = await parts(file);
  // A node and its primitives can share a prefix; the GLTF parser names each
  // primitive after its node, so this is the node's own parts.
  return all.filter((p) => p.name.startsWith(prefix));
}

const pts = (ps: Part[]) => ps.flatMap((p) => p.points);
const tris = (ps: Part[]) => ps.reduce((a, p) => a + p.triangles, 0);
const mats = (ps: Part[]) => [...new Set(ps.flatMap((p) => p.materials))].sort();
const lo = (ps: THREE.Vector3[], k: "x" | "y" | "z") => Math.min(...ps.map((p) => p[k]));
const hi = (ps: THREE.Vector3[], k: "x" | "y" | "z") => Math.max(...ps.map((p) => p[k]));

// --- lairs.glb -------------------------------------------------------------

test("lairs.glb ships with Explorers, and only the two families", async () => {
  expect(EXPLORERS_MODELS).toContain("lairs.glb");
  const names = (await parts("lairs.glb")).map((p) => p.name);
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) {
    expect(
      n.startsWith(LAIR_PREFIX) || n.startsWith(BOARDER_PREFIX),
      `${n} is neither the lair nor the crew`,
    ).toBe(true);
  }
});

test("the lair token is within budget, flat, and unowned", async () => {
  const lair = await family("lairs.glb", LAIR_PREFIX);
  expect(tris(lair)).toBe(452);
  expect(
    lair.every((p) => p.flat),
    "every face ships flat-shaded",
  ).toBe(true);
  for (const m of mats(lair)) {
    expect(m, "a lair belongs to nobody: no seat slot").toMatch(/^Mat_/);
    expect(TINT_SLOTS as readonly string[]).not.toContain(m);
  }
  const p = pts(lair);
  // Base on its origin (it is seated on the land surface), under the prop
  // ceiling, and inside a lair's share of the goldfield: 1.8 wide.
  expect(lo(p, "y")).toBeGreaterThan(-0.02);
  expect(lo(p, "y")).toBeLessThan(0.01);
  expect(hi(p, "y")).toBeLessThan(2.3);
  expect(hi(p, "x") - lo(p, "x")).toBeLessThan(1.85);
});

test("the crew figure has its budget, seat slots, base and front", async () => {
  const fig = await family("lairs.glb", BOARDER_PREFIX);
  expect(tris(fig)).toBe(128);
  expect(fig.every((p) => p.flat)).toBe(true);
  // Three seat slots, so a seat's colour reaches it, plus the pale skin and
  // blade which stay the same for every seat.
  expect(mats(fig)).toEqual(
    ["Mat_Boarder_skin", "Mat_Ship_pirate_bone", "Seat_Body", "Seat_Detail", "Seat_Shade"].sort(),
  );
  const p = pts(fig);
  // Base exactly on 0: a slot's y is the ground there, so a figure is placed
  // at it without being seated.
  expect(lo(p, "y")).toBeCloseTo(0, 4);
  // Between a settlement (0.40) and a city (0.78) to the raised blade.
  expect(hi(p, "y") * MODULE_SCALE.boarder).toBeGreaterThan(0.6);
  expect(hi(p, "y") * MODULE_SCALE.boarder).toBeLessThan(0.78);
  // The front is +x (the cutlass), which is what the plan aims at the token.
  expect(hi(p, "x")).toBeGreaterThan(-lo(p, "x"));
});

// --- the raft ----------------------------------------------------------------

test("the punt ships in camels.glb in the camel's frame", async () => {
  expect(CARAVANS_MODELS).toContain("camels.glb");
  const raft = await family("camels.glb", RAFT_PREFIX);
  const camel = await family("camels.glb", CAMEL_PREFIX);
  expect(tris(raft)).toBe(172);
  expect(raft.every((p) => p.flat)).toBe(true);
  // The camel's own cut does not pick it up.
  expect(camel.some((p) => p.name.startsWith(RAFT_PREFIX))).toBe(false);
  for (const m of mats(raft)) expect(m).toMatch(/^Mat_/);
  const r = pts(raft);
  const c = pts(camel);
  // The deck is under the camel's feet, a hair below them...
  const deck = hi(pts(raft.filter((p) => p.name.startsWith("Raft_deck"))), "y");
  expect(lo(c, "y") - deck).toBeGreaterThanOrEqual(0);
  expect(lo(c, "y") - deck).toBeLessThan(0.02);
  // ...the waterline the renderer floats it at is on the hull, under the deck...
  expect(RAFT_WATERLINE).toBeGreaterThan(lo(r, "y"));
  expect(RAFT_WATERLINE).toBeLessThan(deck);
  // ...and the camel stands on it end to end, head over the bow.
  expect(lo(c, "x")).toBeGreaterThan(lo(r, "x"));
  expect(hi(r, "x") - lo(r, "x")).toBeLessThan(1.7);
});

// --- the slots ---------------------------------------------------------------

/** The parts of a tile that are its ground, which a figure stands on rather than in. */
const GROUND =
  /^(Hex_|Goldfield_ground|Goldfield_rim|Goldfield_creek|Spice_ground|Spice_rim|Spice_pad)/;

/** How far round a slot the ground must be clear: the figure's widest reach, the cutlass. */
const FIGURE_RADIUS = 0.23;

async function slotsClear(tileKey: string, extra: THREE.Vector3[] = []) {
  const entry = TILES[tileKey];
  const slots = entry.slots ?? [];
  const tile = await parts(entry.file);
  const props = tile.filter((p) => !GROUND.test(p.name));
  const fig = pts(await family("lairs.glb", BOARDER_PREFIX));
  const top = hi(fig, "y");
  for (const [i, [x, y, z]] of slots.entries()) {
    for (const part of props) {
      for (const p of part.points) {
        if (p.y <= y + 0.02 || p.y >= y + top) continue;
        expect(
          Math.hypot(p.x - x, p.z - z),
          `${tileKey} slot ${i + 1}: ${part.name} stands in it at y=${p.y.toFixed(3)}`,
        ).toBeGreaterThan(FIGURE_RADIUS);
      }
    }
    for (const p of extra) {
      if (p.y <= y + 0.02) continue;
      expect(
        Math.hypot(p.x - x, p.z - z),
        `${tileKey} slot ${i + 1} is in the lair`,
      ).toBeGreaterThan(0.14);
    }
  }
}

test("the goldfield has eight crew slots, three to a rank", async () => {
  const slots = TILES["goldfield"].slots ?? [];
  expect(slots.length).toBe(8);
  // The first rank is the capture: three abreast, level with one another in
  // plan, all on one side of the token.
  const rank = slots.slice(0, LAIR_CAPTURE_CREWS);
  expect(new Set(rank.map((s) => s[2])).size).toBe(1);
  const socket = TILES["goldfield"].socket!;
  expect(rank.every((s) => s[0] < socket[0])).toBe(true);
  // The second rank is on the token's other side.
  expect(slots.slice(3, 6).every((s) => s[0] > socket[0])).toBe(true);
  // Every slot is on the tile and clear of its chip mount by the chip's margin.
  for (const [x, , z] of slots) {
    expect(Math.hypot(x - socket[0], z - socket[2])).toBeGreaterThan(1.05);
    expect(Math.abs(x) * 0.5 + Math.abs(z) * (Math.sqrt(3) / 2)).toBeLessThan(2.47);
    expect(Math.abs(x)).toBeLessThan(2.47);
  }
});

test("the goldfield's crew slots are clear", async () => {
  // The bush and rock that a crew stood on were removed and the ridge tent
  // moved back 0.15. The lair token sits on the socket in the same frame, so
  // it is measured here too.
  const socket = TILES["goldfield"].socket!;
  const lair = pts(await family("lairs.glb", LAIR_PREFIX)).map(
    (p) => new THREE.Vector3(p.x + socket[0], p.y + 0.25, p.z + socket[2]),
  );
  await slotsClear("goldfield", lair);
});

test("the spice farm has ten clear farmer slots in two ranks", async () => {
  const slots = TILES["spice"].slots ?? [];
  expect(slots.length).toBe(10);
  expect(new Set(slots.slice(0, 5).map((s) => s[2])).size).toBe(1);
  expect(new Set(slots.slice(5).map((s) => s[2])).size).toBe(1);
  await slotsClear("spice");
});

test("no other tile carries slots", () => {
  const withSlots = Object.entries(TILES)
    .filter(([, t]) => t.slots && t.slots.length)
    .map(([k]) => k)
    .sort();
  expect(withSlots).toEqual(["goldfield", "spice"]);
});

test("a shared sea path keeps punt, camel and ship on the path", async () => {
  // Camel and punt sit 0.78 toward the caravan's head, the route ship 0.8 the
  // other way. Along the path nothing spills sideways, so only the ends
  // matter: past a path's end corner the third hex's tile starts
  // LATTICE_SIZE - HEX_SIZE (0.144) beyond it. And ship and punt must not
  // touch.
  const half = LATTICE_SIZE / 2;
  const reach = half + (LATTICE_SIZE - HEX_SIZE);
  const raft = pts(await family("camels.glb", RAFT_PREFIX));
  const camel = pts(await family("camels.glb", CAMEL_PREFIX));
  const ship = pts(await family("ships.glb", SHIP_PREFIX));
  const bow = hi(raft, "x") + RAFT_SHIFT;
  const head = hi(camel, "x") + RAFT_SHIFT;
  const stern = lo(raft, "x") + RAFT_SHIFT;
  const shipFar = -SHIP_SHIFT + lo(ship, "x") * MODULE_SCALE.ship;
  const shipNear = -SHIP_SHIFT + hi(ship, "x") * MODULE_SCALE.ship;
  expect(bow, "the punt's bow").toBeLessThan(reach);
  expect(head, "the camel's head").toBeLessThan(reach);
  expect(-shipFar, "the ship's stern").toBeLessThan(reach);
  expect(stern - shipNear, "open water between the ship and the punt").toBeGreaterThan(0.05);
});
