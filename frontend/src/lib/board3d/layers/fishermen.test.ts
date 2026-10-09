import { test, expect } from "vitest";
import {
  planWeirs,
  planGroundChips,
  groundFitPoints,
  GROUND_CHIP_FIT_RADIUS,
  groundHex,
  weirBearingY,
  WEIR_FACES,
  planFishingGrounds,
  FISHGROUND_PREFIX,
  FISHGROUND_Y,
  FISHGROUND_UNDER_CHIP_Y,
} from "./fishermen";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as T3 from "three";
import { newGLTFLoader, FISHERMEN_MODELS } from "../loader";
import { SURFACE } from "../seating";
import { OCEAN_MAX_Y } from "../ocean";
import { hexVertices, vertexKey } from "@/lib/hexgeo";
import { hexToWorld, vertexToWorld, hexKey } from "../coords";
import { chipKey } from "./chips";
import { planPorts } from "./harbors";
import type { BoardTile, FullView, Harbor, Hex, Vertex } from "@/lib/types";

// A coastal notch, built as the engine builds one: a sea hex whose shore run
// of corners touches the island. `deriveGrounds` scans land hexes, takes their
// water neighbours, and keeps the contiguous corners of that water hex that
// touch land, so every corner of a ground is on one sea hex's ring.
const NOTCH: Hex = { q: 0, r: 0 };
const RING = hexVertices(NOTCH);

/**
 * The notch itself is water and everything round it is land.
 *
 * The sea hex is in the tile list here even though real boards often omit it
 * (the base game ships no sea tiles); both must resolve to the same hex. The
 * omitted case has its own test below.
 */
function board(extra: BoardTile[] = []): BoardTile[] {
  const tiles: BoardTile[] = [{ hex: NOTCH, res: "sea", num: 0 }];
  const seen = new Set([hexKey(NOTCH)]);
  for (const v of RING) {
    for (const h of [
      { q: v.q, r: v.r },
      { q: v.q, r: v.r - 1 },
      { q: v.q + 1, r: v.r - 1 },
      { q: v.q, r: v.r + 1 },
      { q: v.q - 1, r: v.r + 1 },
    ]) {
      if (seen.has(hexKey(h))) continue;
      seen.add(hexKey(h));
      tiles.push({ hex: h, res: "wood", num: 8 });
    }
  }
  return [...tiles, ...extra];
}

/**
 * A harbour on the fixture board.
 *
 * A board with no harbours is the one shape where a ground and a dock cannot
 * collide. This harbour sits on an edge of the notch whose other side is land,
 * so its dock stands on the notch. This layer does not resolve the collision
 * (see the test at the bottom); the engine does.
 */
const HARBOR: Harbor = { verts: [RING[0], RING[1]], res: "none", ratio: 3 };

function viewWith(
  grounds: { v: Vertex[]; number: number; hex?: Hex }[] | undefined,
  tiles = board(),
  harbors: Harbor[] = [HARBOR],
): FullView {
  return {
    board: { tiles, robber: { q: 9, r: 9 }, harbors },
    ext: grounds ? { fishermen: { grounds } } : undefined,
  } as unknown as FullView;
}

/** Three contiguous corners of the notch: the shape the engine prefers. */
const THREE = [RING[0], RING[1], RING[2]];
const ground = { v: THREE, number: 8, hex: NOTCH };

// --- which hex a ground is the notch of ---------------------------------
//
// The engine publishes the hex; the layer must take it as given.

test("a ground's hex is the one the wire names", () => {
  expect(groundHex(ground)).toEqual(NOTCH);
});

test("the wire wins over anything the corners could be made to suggest", () => {
  // The layer must not re-derive the hex, so this ground names a hex its
  // corners do not touch at all; any inference could not produce this.
  const elsewhere: Hex = { q: 5, r: -3 };
  expect(groundHex({ ...ground, hex: elsewhere })).toEqual(elsewhere);
  const [wx, , wz] = hexToWorld(elsewhere);
  const weirs = planWeirs(viewWith([{ ...ground, hex: elsewhere }]));
  expect(weirs).toHaveLength(3);
  const chips = planGroundChips(viewWith([{ ...ground, hex: elsewhere }]));
  expect(chips[0].position[0]).toBeCloseTo(wx, 6);
  expect(chips[0].position[2]).toBeCloseTo(wz, 6);
});

test("a two-corner ground in a strait draws the hex the engine picked", () => {
  // Two adjacent corners of a hex are also corners of the hex across the edge
  // between them, so the corners narrow to two candidates; in a one-hex-wide
  // strait both are water and nothing in the view separates them.
  //
  // `{-1, 1}` is the rival, and it sorts before the notch on (q, r), so a
  // (q, r) tie-break would pick it. Both are water here.
  const rival: Hex = { q: -1, r: 1 };
  expect(rival.q).toBeLessThan(NOTCH.q);
  const strait: BoardTile[] = board().map((t) =>
    hexKey(t.hex) === hexKey(rival) ? { ...t, res: "sea", num: 0 } : t,
  );
  const two = { v: [RING[3], RING[4]], number: 5, hex: NOTCH };
  expect(groundHex(two)).toEqual(NOTCH);

  // And it reaches the board: every weir on this ground faces the notch,
  // which a wrong hex would mirror.
  const [sx, , sz] = hexToWorld(NOTCH);
  const [rx, , rz] = hexToWorld(rival);
  for (const w of planWeirs(viewWith([two], strait))) {
    const a = w.rotationY!;
    const faced: [number, number] = [-Math.sin(a), -Math.cos(a)];
    const toNotch = Math.hypot(sx - w.position[0], sz - w.position[2]);
    const toRival = Math.hypot(rx - w.position[0], rz - w.position[2]);
    expect(faced[0]).toBeCloseTo((sx - w.position[0]) / toNotch, 6);
    expect(faced[1]).toBeCloseTo((sz - w.position[2]) / toNotch, 6);
    // The rival is a different bearing, so the check above cannot be met by
    // both answers.
    expect(
      Math.abs(faced[0] - (rx - w.position[0]) / toRival) +
        Math.abs(faced[1] - (rz - w.position[2]) / toRival),
    ).toBeGreaterThan(0.1);
  }
});

test("a server that never sent a hex draws nothing rather than guessing", () => {
  // `hex` is missing only from an older server. Drawing nothing is better than
  // a marker on a corner that does not pay.
  const { hex: _hex, ...noHex } = ground;
  expect(groundHex(noHex)).toBeNull();
  expect(planWeirs(viewWith([noHex]))).toEqual([]);
  expect(planGroundChips(viewWith([noHex]))).toEqual([]);
});

// --- the weirs ----------------------------------------------------------

test("one weir per corner, each turned to face its own sea hex", () => {
  const weirs = planWeirs(viewWith([ground]));
  expect(weirs).toHaveLength(3);

  const [sx, , sz] = hexToWorld(NOTCH);
  for (const [i, w] of weirs.entries()) {
    const v = THREE[i];
    const [vx, , vz] = vertexToWorld(v);
    // On the corner, which is where a settlement is built.
    expect(w.position[0]).toBeCloseTo(vx, 6);
    expect(w.position[2]).toBeCloseTo(vz, 6);
    expect(w.key).toBe(`weir:${vertexKey(v)}`);

    // Turned: the marker's face starts on WEIR_FACES and a Y rotation of `a`
    // sends it to (-sin a, -cos a); the layer's answer must land it on the
    // bearing from this corner to the middle of the notch.
    const a = w.rotationY!;
    const faced: [number, number] = [-Math.sin(a), -Math.cos(a)];
    const want = [sx - vx, sz - vz];
    const len = Math.hypot(want[0], want[1]);
    expect(faced[0]).toBeCloseTo(want[0] / len, 6);
    expect(faced[1]).toBeCloseTo(want[1] / len, 6);
  }
});

test("the three weirs of one ground face different ways", () => {
  // Each corner sees the notch from a different side, so a layer returning a
  // constant could still pass a loose "faces the sea hex" check. Three
  // distinct angles show the turn is per corner.
  const turns = planWeirs(viewWith([ground])).map((w) => w.rotationY);
  expect(new Set(turns).size).toBe(3);
  // None is the square pose, which would put the stakes on dry land as often
  // as not.
  for (const t of turns) expect(Math.abs(t!)).toBeGreaterThan(1e-6);
});

test("weirBearingY answers zero for the direction the art already points", () => {
  expect(weirBearingY(WEIR_FACES[0], WEIR_FACES[1])).toBeCloseTo(0, 9);
  // A quarter turn for the perpendicular axis, in three.js's sign (a positive
  // Y rotation carries +x toward -z).
  expect(weirBearingY(-1, 0)).toBeCloseTo(Math.PI / 2, 9);
  expect(weirBearingY(1, 0)).toBeCloseTo(-Math.PI / 2, 9);
});

// --- the number chip ----------------------------------------------------

test("a ground's number is one chip at the middle of its sea hex", () => {
  const chips = planGroundChips(viewWith([ground]));
  expect(chips).toHaveLength(1);
  const [cx, , cz] = hexToWorld(NOTCH);
  expect(chips[0].number).toBe(8);
  expect(chips[0].position[0]).toBeCloseTo(cx, 6);
  expect(chips[0].position[2]).toBeCloseTo(cz, 6);
  // Dead centre, not CHIP_OFFSET_Z: that offset keeps a chip clear of a land
  // tile's props, and a ground's hex is open water.
  expect(chips[0].position[2]).toBeCloseTo(cz, 6);
  // Keyed on the hex like every other chip, so nothing downstream needs to
  // tell a ground's chip from a terrain one.
  expect(chips[0].key).toBe(chipKey(NOTCH));
});

test("the number is on the chip and never on the weir", () => {
  // The number is on a chip, not on the weirs: six weirs carrying numerals
  // would give the player two places to read a number. `fishing.glb` has no
  // numeral geometry.
  const weirs = planWeirs(viewWith([ground]));
  for (const w of weirs) expect(w).not.toHaveProperty("number");
  expect(planGroundChips(viewWith([ground]))).toHaveLength(1);
});

test("every number a ground can be has chip art, red 6 and 8 included", () => {
  // The engine's `groundNumbers`. Each needs chip art or the ground loses its
  // number; 6 and 8 matter most, since they are the red ones.
  const all = [4, 5, 6, 8, 9, 10].map((n) => ({ v: THREE, number: n, hex: NOTCH }));
  for (const g of all) {
    expect(planGroundChips(viewWith([g])), `number ${g.number} has no chip`).toHaveLength(1);
  }
});

test("the same board always draws the same chip variant", () => {
  // Deterministic off the hex like `planChips`, so a replay matches the live
  // game.
  const a = planGroundChips(viewWith([ground]))[0];
  const b = planGroundChips(viewWith([ground]))[0];
  expect(a.variant).toBe(b.variant);
  expect(a.variant).toBeGreaterThan(0);
});

// --- an inert module ----------------------------------------------------

test("a board with no Fishermen module draws none of it", () => {
  const view = viewWith(undefined);
  expect(planWeirs(view)).toEqual([]);
  expect(planGroundChips(view)).toEqual([]);
});

test("a Fishermen module that derived no grounds draws none of it", () => {
  // The module is loaded and its ext present; `grounds` is empty, as on a
  // board with no coastal notches.
  const view = viewWith([]);
  expect(planWeirs(view)).toEqual([]);
  expect(planGroundChips(view)).toEqual([]);
});

// --- a harbour on the ground's hex -----------------------------------------

test("a dock and a ground chip on one hex are drawn in the same place", () => {
  // Why the engine must keep them apart: both are drawn at their hex's centre
  // (`planPorts` puts the dock at `hexToWorld(sea)` and `planGroundChips` the
  // chip at `hexToWorld(groundHex(g))`), so a shared hex puts the chip inside
  // the pier, z-fighting the planks with the ratio sign covering its number.
  //
  // There is no client-side fix: offsetting the chip moves it off the water it
  // names, and hiding it hides a ground that pays.
  // `engine/scenarios.TestGroundsAvoidHarborDocks` is the guard; this documents what
  // it guards against.
  const ports = planPorts([HARBOR], board());
  expect(ports, "the fixture harbour must actually place a dock").toHaveLength(1);
  expect(hexKey(ports[0].hex), "the dock stands on the notch").toBe(hexKey(NOTCH));

  const chips = planGroundChips(viewWith([ground]));
  expect(chips).toHaveLength(1);
  expect(chips[0].position[0]).toBeCloseTo(ports[0].position[0], 9);
  expect(chips[0].position[2]).toBeCloseTo(ports[0].position[2], 9);
});

test("a harbour on the board changes nothing the Fishermen layer draws", () => {
  // The fixtures above carry a harbour, and that must not be why any of them
  // pass: same weirs and chips with and without it, so a collision fix in this
  // layer would show up here.
  const withPort = viewWith([ground]);
  const without = viewWith([ground], board(), []);
  expect(planWeirs(withPort)).toEqual(planWeirs(without));
  expect(planGroundChips(withPort)).toEqual(planGroundChips(without));
});

// --- the camera keeps the chips in frame ----------------------------------

test("every ground chip hands the camera fit its whole extent", () => {
  // The opening view is fitted to the tiles, and a ground stands on a sea hex
  // the base board does not carry, so without these the chips open off screen.
  const pts = groundFitPoints(viewWith([ground]));
  const [cx, , cz] = hexToWorld(NOTCH);
  const r = GROUND_CHIP_FIT_RADIUS;
  expect(pts).toHaveLength(4);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  expect(Math.min(...xs)).toBeCloseTo(cx - r, 6);
  expect(Math.max(...xs)).toBeCloseTo(cx + r, 6);
  expect(Math.min(...zs)).toBeCloseTo(cz - r, 6);
  expect(Math.max(...zs)).toBeCloseTo(cz + r, 6);
});

test("a game without grounds adds nothing to the fit", () => {
  expect(groundFitPoints(viewWith(undefined))).toEqual([]);
});

// --- the shallows under the chip -----------------------------------------
//
// `Fishground_*` in fishing.glb: a lobed patch of paler water with a sand bar,
// three rocks awash and a few fins, one per ground at its sea hex's centre,
// under the chip. It is turned so the sand bar is on the shore side, and it
// never stands in front of the number.

const MODELS_DIR = join(__dirname, "..", "..", "..", "..", "public", "models");

async function shallowsPoints(): Promise<T3.Vector3[]> {
  const buf = readFileSync(join(MODELS_DIR, "fishing.glb"));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const gltf = await new Promise<{ scene: T3.Group }>((resolve, reject) =>
    newGLTFLoader().parse(ab, "", resolve, reject),
  );
  gltf.scene.updateMatrixWorld(true);
  const out: T3.Vector3[] = [];
  gltf.scene.traverse((node) => {
    const mesh = node as T3.Mesh;
    if (!mesh.isMesh || !mesh.name.startsWith(FISHGROUND_PREFIX)) return;
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      out.push(new T3.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

test("one shallows patch per ground, at its sea hex and waterline", () => {
  const placed = planFishingGrounds(viewWith([ground]));
  expect(placed).toHaveLength(1);
  const [sx, , sz] = hexToWorld(NOTCH);
  expect(placed[0].position[0]).toBeCloseTo(sx, 9);
  expect(placed[0].position[2]).toBeCloseTo(sz, 9);
  expect(placed[0].position[1]).toBe(SURFACE.sea);
  expect(FISHGROUND_Y).toBe(SURFACE.sea);
  // Authored in world units: not the weir's MODULE_SCALE.fishingGround.
  expect(placed[0].scale).toBe(1);
  // One per ground, not per corner, and nothing without the module or a hex.
  expect(planFishingGrounds(viewWith(undefined))).toEqual([]);
  expect(planFishingGrounds(viewWith([{ v: THREE, number: 8 }]))).toEqual([]);
});

test("the sand bar is turned onto the shore the ground fishes", () => {
  // The file's landward side is its -z (the weir's WEIR_FACES); a Y rotation
  // of `a` sends -z to (-sin a, -cos a), which must point from the sea hex at
  // the centroid of the ground's corners, for grounds on every side.
  for (let start = 0; start < 6; start++) {
    const v = [RING[start], RING[(start + 1) % 6], RING[(start + 2) % 6]];
    const [p] = planFishingGrounds(viewWith([{ v, number: 5, hex: NOTCH }]));
    const [sx, , sz] = hexToWorld(NOTCH);
    const land = v.map((x) => vertexToWorld(x)).reduce((a, b) => [a[0] + b[0], 0, a[2] + b[2]]);
    const want = [land[0] / 3 - sx, land[2] / 3 - sz];
    const len = Math.hypot(want[0], want[1]);
    const a = p.rotationY!;
    expect(-Math.sin(a), `start ${start}`).toBeCloseTo(want[0] / len, 9);
    expect(-Math.cos(a), `start ${start}`).toBeCloseTo(want[1] / len, 9);
  }
});

test("the shipped shallows reach further landward (-z) than seaward", async () => {
  // If a re-author flipped the file, every sand bar would sit out at sea and
  // the plan above would not know.
  const pts = await shallowsPoints();
  expect(pts.length).toBeGreaterThan(100);
  const minZ = Math.min(...pts.map((p) => p.z));
  const maxZ = Math.max(...pts.map((p) => p.z));
  expect(-minZ).toBeGreaterThan(maxZ + 0.2);
});

test("the shallows lie under the chip and never in front of it", async () => {
  // Inside the chip's radius nothing stands above FISHGROUND_UNDER_CHIP_Y, and
  // laid on the mean waterline that is still below where the chip is seated
  // (the ocean's highest crest), so the number reads over the water.
  const pts = await shallowsPoints();
  const under = pts.filter((p) => Math.hypot(p.x, p.z) < GROUND_CHIP_FIT_RADIUS);
  expect(under.length).toBeGreaterThan(10);
  for (const p of under) expect(p.y).toBeLessThanOrEqual(FISHGROUND_UNDER_CHIP_Y + 1e-4);
  expect(FISHGROUND_Y + FISHGROUND_UNDER_CHIP_Y).toBeLessThan(OCEAN_MAX_Y);
  // And the whole thing is low: shallows, not an island.
  for (const p of pts) expect(p.y).toBeLessThan(0.2);
});

test("the shallows ride in the file a Fishermen board already fetches", () => {
  expect(FISHERMEN_MODELS).toContain("fishing.glb");
});
