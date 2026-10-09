// The pirate lairs and the crews standing on hexes, planned from the view.
//
// An uncaptured gold field carries the lair token and its crews (three in a
// rank beside the token is the capture); a captured one carries no token; a
// spice farm carries one figure per seat that has landed its crew. Every
// figure is in its owner's colour.
import { test, expect } from "vitest";
import { planLairs, planHexCrews, tileSlotsWorld, LAIR_CAPTURE_CREWS } from "./explorers";
import { hexToWorld, hexKey, TILE_ROTATION_Y } from "../coords";
import { TILES } from "../manifest.generated";
import {
  EXPLORERS_KIND,
  type BoardTile,
  type ExplorersHex,
  type FullView,
  type Hex,
} from "@/lib/types";

const GOLD: Hex = { q: 1, r: -1 };
const FARM: Hex = { q: -1, r: 1 };
const tiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: GOLD, res: "gold", num: 0 },
  { hex: FARM, res: "none", num: 0 },
  { hex: { q: 2, r: 0 }, res: "fog", num: 0 },
];

function view(revealed: ExplorersHex[], board = tiles): FullView {
  return {
    board: { tiles: board, robber: { q: 0, r: 0 }, harbors: [] },
    ext: { explorers: { revealed } },
  } as unknown as FullView;
}

const lair = (crews?: number[], captured = false): ExplorersHex => ({
  h: GOLD,
  region: 0,
  kind: EXPLORERS_KIND.gold,
  crews,
  captured,
});
const farm = (farmers?: boolean[]): ExplorersHex => ({
  h: FARM,
  region: 0,
  kind: EXPLORERS_KIND.spice,
  farmers,
});

/** Where the goldfield's socket lands in the world on `h`. */
function socketAt(h: Hex): [number, number] {
  const [x, , z] = hexToWorld(h);
  const s = TILES["goldfield"].socket!;
  // The half turn every tile is laid at: (x, z) -> (-x, -z).
  return [x - s[0], z - s[2]];
}

test("an uncaptured lair draws its token on the goldfield socket", () => {
  const out = planLairs(view([lair([0, 0, 0])]));
  expect(out).toHaveLength(1);
  const [sx, sz] = socketAt(GOLD);
  expect(out[0].position[0]).toBeCloseTo(sx, 9);
  expect(out[0].position[2]).toBeCloseTo(sz, 9);
  // The socket is the near side of the hex, toward the camera (+z).
  expect(out[0].position[2]).toBeGreaterThan(hexToWorld(GOLD)[2]);
  expect(out[0].rotationY).toBe(TILE_ROTATION_Y);
  expect(out[0].owner).toBe(-1);
  expect(out[0].key).toBe(`lair:-1:${hexKey(GOLD)}`);
});

test("a captured lair draws no token, and a farm or a shoal never draws one", () => {
  expect(planLairs(view([lair([2, 1], true)]))).toEqual([]);
  expect(planLairs(view([farm([true])]))).toEqual([]);
  expect(planLairs(view([]))).toEqual([]);
});

test("no lair on a hex the board does not draw as the goldfield", () => {
  // Fogged, off the board, or on water: the tile override refuses each, and
  // the token follows it.
  const recolour = (res: string) =>
    tiles.map((t) => (hexKey(t.hex) === hexKey(GOLD) ? { ...t, res } : t)) as BoardTile[];
  for (const board of [
    recolour("fog"),
    tiles.filter((t) => hexKey(t.hex) !== hexKey(GOLD)),
    recolour("sea"),
  ]) {
    expect(planLairs(view([lair([1, 1, 1])], board))).toEqual([]);
    expect(planHexCrews(view([lair([1, 1, 1])], board))).toEqual([]);
  }
});

test("crews on a lair: 0, 1, 2, 3 and more fill the slots in order", () => {
  const slots = tileSlotsWorld("goldfield", GOLD);
  expect(slots).toHaveLength(8);
  for (const n of [0, 1, 2, 3, 4, 6, 8]) {
    const out = planHexCrews(view([lair([n])]));
    expect(out, `${n} crews`).toHaveLength(n);
    out.forEach((c, i) => {
      expect(c.position).toEqual(slots[i]);
      expect(c.owner).toBe(0);
    });
  }
});

test("three crews stand in one rank beside the token", () => {
  const out = planHexCrews(view([lair([1, 2])]));
  expect(out).toHaveLength(LAIR_CAPTURE_CREWS);
  // One line in plan (same world z), all on the same side of the token.
  const zs = new Set(out.map((c) => c.position[2].toFixed(6)));
  expect(zs.size).toBe(1);
  const [sx] = socketAt(GOLD);
  const sides = new Set(out.map((c) => Math.sign(c.position[0] - sx)));
  expect(sides.size).toBe(1);
  // In seat order, each seat's crews together.
  expect(out.map((c) => c.owner)).toEqual([0, 1, 1]);
});

test("more crews than slots draws every slot and no more", () => {
  const out = planHexCrews(view([lair([5, 5])]));
  expect(out).toHaveLength(8);
  expect(out.map((c) => c.owner)).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
});

test("each crew is its seat's, so it wears that seat's colour", () => {
  const out = planHexCrews(view([lair([0, 1, 0, 2])]));
  expect(out.map((c) => c.owner)).toEqual([1, 3, 3]);
  // Keys carry the seat and the slot, so a new arrival drops into its own slot.
  expect(new Set(out.map((c) => c.key)).size).toBe(3);
  expect(out[0].key).toBe(`boarder:1:${hexKey(GOLD)}:0`);
});

test("a crew faces the token it is storming", () => {
  const [sx, sz] = socketAt(GOLD);
  for (const c of planHexCrews(view([lair([3, 3])]))) {
    // Local +x under a Y turn of a is (cos a, -sin a) in the world.
    const fx = Math.cos(c.rotationY!);
    const fz = -Math.sin(c.rotationY!);
    const dx = sx - c.position[0];
    const dz = sz - c.position[2];
    const n = Math.hypot(dx, dz);
    expect(fx * (dx / n) + fz * (dz / n)).toBeCloseTo(1, 9);
  }
});

test("a figure stands at its slot's own ground height, not on a flat surface", () => {
  const out = planHexCrews(view([lair([3])]));
  const heights = TILES["goldfield"].slots!.slice(0, 3).map((s) => s[1]);
  expect(out.map((c) => c.position[1])).toEqual(heights);
  // The goldfield rises under the first rank: they are not all one height.
  expect(new Set(heights).size).toBeGreaterThan(1);
});

test("survivors stay on a captured field, drawn without the token", () => {
  const v = view([lair([0, 2], true)]);
  expect(planLairs(v)).toEqual([]);
  expect(planHexCrews(v).map((c) => c.owner)).toEqual([1, 1]);
});

test("a spice farm stands one farmer per seat that has landed, in seat order", () => {
  const slots = tileSlotsWorld("spice", FARM);
  expect(slots).toHaveLength(10);
  expect(planHexCrews(view([farm([])]))).toEqual([]);
  expect(planHexCrews(view([farm(undefined)]))).toEqual([]);
  const out = planHexCrews(view([farm([true, false, true, true])]));
  expect(out.map((c) => c.owner)).toEqual([0, 2, 3]);
  out.forEach((c, i) => expect(c.position).toEqual(slots[i]));
  // Into the village, away from the camera: +x aimed at world -z.
  for (const c of out) {
    expect(Math.cos(c.rotationY!)).toBeCloseTo(0, 9);
    expect(-Math.sin(c.rotationY!)).toBeCloseTo(-1, 9);
  }
  expect(out[0].key).toBe(`farmer:0:${hexKey(FARM)}`);
});

test("the slots are carried through the tile's half turn", () => {
  const [hx, , hz] = hexToWorld(GOLD);
  const raw = TILES["goldfield"].slots!;
  tileSlotsWorld("goldfield", GOLD).forEach(([x, y, z], i) => {
    expect(x).toBeCloseTo(hx - raw[i][0], 9);
    expect(y).toBe(raw[i][1]);
    expect(z).toBeCloseTo(hz - raw[i][2], 9);
  });
  expect(tileSlotsWorld("wood", GOLD)).toEqual([]);
});

test("nothing is planned outside Explorers", () => {
  const v = { board: { tiles, robber: { q: 0, r: 0 }, harbors: [] } } as unknown as FullView;
  expect(planLairs(v)).toEqual([]);
  expect(planHexCrews(v)).toEqual([]);
});
