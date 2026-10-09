import { test, expect, describe } from "vitest";
import {
  planChips,
  chipFor,
  chipKey,
  isChipKey,
  chipsMatching,
  planLakeChips,
  hasChip,
  CHIP_OFFSET_Z,
} from "./chips";
import { SURFACE } from "../seating";
import { CHIPS, TILES } from "../manifest.generated";
import { hexToWorld } from "../coords";
import type { BoardTile } from "@/lib/types";

test("a numbered tile gets a chip, carrying no height of its own", () => {
  // Height is seating.ts's job; the art already starts at 0.25, so adding the
  // socket's y here would float the chip.
  const out = planChips([{ hex: { q: 0, r: 0 }, res: "wood", num: 8 }]);
  expect(out).toHaveLength(1);
  expect(out[0].number).toBe(8);
  expect(out[0].position[1]).toBe(0);
});

test("the chip sits at the front of its tile, at the socket's height", () => {
  const out = planChips([{ hex: { q: 1, r: 0 }, res: "brick", num: 5 }]);
  const [cx, , cz] = hexToWorld({ q: 1, r: 0 });
  expect(out[0].position[0]).toBeCloseTo(cx, 5);
  // +z is toward the viewer. The blend's sockets put chips at the back of the
  // tile, where the tile behind crowds them.
  expect(out[0].position[2]).toBeGreaterThan(cz);
  expect(out[0].position[1]).toBe(0);
});

test("the ground under a chip is below it, so nothing has to be lifted", () => {
  // edits/0006_clear_chip_footprint.py caps the ground under every chip, so
  // the chip sits at the tile's own surface with no extra lift.
  const cappedGroundUnderChip = 0.235;
  expect(cappedGroundUnderChip).toBeLessThan(SURFACE.land);
});

test("chipFor answers whether a hex carries a chip", () => {
  const tiles = [
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    { hex: { q: 1, r: 0 }, res: "none", num: 0 },
  ] as unknown as BoardTile[];
  expect(chipFor(tiles, { q: 0, r: 0 })?.number).toBe(8);
  // The desert has no number, so nothing for the robber to stand on.
  expect(chipFor(tiles, { q: 1, r: 0 })).toBeUndefined();
  expect(chipFor(tiles, { q: 5, r: 5 })).toBeUndefined();
});

test("every tile mounts its chip in the same place", () => {
  // The blend's Token_<Terrain> empties were placed by eye: most sit at
  // z = -1.5, the generic tile's is dead centre and the desert's is nudged
  // sideways. Chips are UI that players scan, so they sit in one place.
  const kinds = ["brick", "wood", "sheep", "wheat", "ore", "gold", "generic"] as const;
  const offsets = kinds.map((res) => {
    const [p] = planChips([{ hex: { q: 0, r: 0 }, res, num: 5 } as BoardTile]);
    return p && `${p.position[0].toFixed(4)},${p.position[2].toFixed(4)}`;
  });
  expect(new Set(offsets.filter(Boolean)).size).toBe(1);
});

test("desert and sea tiles get no chip", () => {
  const out = planChips([
    { hex: { q: 0, r: 0 }, res: "none", num: 0 },
    { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
  ]);
  expect(out).toEqual([]);
});

test("a chip never asks for a variant the blend does not have", () => {
  // 2 and 12 ship a single variant; everything else ships two. Picking
  // variant 2 for a 2 requests a Chip_02_2 that does not exist.
  const available = new Map(CHIPS.map((c) => [c.number, c.variants]));
  const tiles: BoardTile[] = [];
  for (let q = -3; q <= 3; q++) {
    for (const num of [2, 6, 12]) {
      tiles.push({ hex: { q, r: q }, res: "wood", num });
    }
  }
  for (const c of planChips(tiles)) {
    expect(c.variant).toBeGreaterThanOrEqual(1);
    expect(c.variant, `number ${c.number}`).toBeLessThanOrEqual(available.get(c.number)!);
  }
});

test("no chip is planned for a number the exporter never produced", () => {
  // 7 never appears on a tile, so no chip art exists for it.
  expect(planChips([{ hex: { q: 0, r: 0 }, res: "wood", num: 7 }])).toEqual([]);
  expect(CHIPS.some((c) => c.number === 7)).toBe(false);
});

test("chip choice is deterministic so replays look identical", () => {
  const tiles: BoardTile[] = [{ hex: { q: 2, r: -1 }, res: "wood", num: 6 }];
  expect(planChips(tiles)[0].variant).toBe(planChips(tiles)[0].variant);
});

test("a chip's key is stable for its hex and unique across the board", () => {
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    { hex: { q: 1, r: 0 }, res: "brick", num: 8 },
    { hex: { q: 0, r: 1 }, res: "wheat", num: 5 },
  ];
  const keys = planChips(tiles).map((c) => c.key);
  expect(new Set(keys).size).toBe(3);
  // Stable: the board is replanned on every update, and a key that changed
  // with it would name a different instance every frame.
  expect(planChips(tiles).map((c) => c.key)).toEqual(keys);
  expect(keys[0]).toBe(chipKey({ q: 0, r: 0 }));
});

test("a chip key is recognisable as one", () => {
  expect(isChipKey(chipKey({ q: 2, r: -1 }))).toBe(true);
  expect(isChipKey("robber")).toBe(false);
  expect(isChipKey("settlement:0:v1")).toBe(false);
});

test("a roll names every chip carrying that number", () => {
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    { hex: { q: 1, r: 0 }, res: "brick", num: 8 },
    { hex: { q: 0, r: 1 }, res: "wheat", num: 5 },
  ];
  // Every chip showing the number, whether or not anyone is on it.
  expect(chipsMatching(tiles, undefined, 8).sort()).toEqual(
    [chipKey({ q: 0, r: 0 }), chipKey({ q: 1, r: 0 })].sort(),
  );
});

test("the chip the robber stands on is not named", () => {
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    { hex: { q: 1, r: 0 }, res: "brick", num: 8 },
  ];
  // It cannot flip: the robber is standing on it (see layers/robber).
  expect(chipsMatching(tiles, { q: 0, r: 0 }, 8)).toEqual([chipKey({ q: 1, r: 0 })]);
});

test("a seven, and a number nothing carries, name nothing", () => {
  // The desert is "none" on the wire, and carries no number either way.
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    { hex: { q: 1, r: 0 }, res: "none", num: 0 },
    { hex: { q: 2, r: 0 }, res: "sea", num: 0 },
  ];
  expect(chipsMatching(tiles, undefined, 7)).toEqual([]);
  expect(chipsMatching(tiles, undefined, 4)).toEqual([]);
  expect(chipsMatching(tiles, undefined, 0)).toEqual([]);
});

test("a terrain with no socket names nothing even when it carries a number", () => {
  // Two separate reasons a tile takes no chip: no socket for the terrain, and
  // no art for the number. A numbered sea tile separates them: there is art
  // for an 8, but a sea variant has nowhere to put it. Islands boards do carry
  // numbered water (gold and fog reveals).
  expect(chipsMatching([{ hex: { q: 0, r: 0 }, res: "sea", num: 8 }], undefined, 8)).toEqual([]);
});

// --- the lake's chip ----------------------------------------------------
//
// A lake pays on two or four numbers (engine/scenarios.fishLake) and the tile holds
// one, so the numbers come from `ext.fishermen`: one chip per lake, on the
// usual socket, carrying every number the lake pays on.
describe("lake chips", () => {
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "lake", num: 0 },
    { hex: { q: 2, r: -1 }, res: "lake", num: 0 },
    { hex: { q: 1, r: 0 }, res: "wood", num: 4 },
  ];
  const lakes = [
    { hex: { q: 0, r: 0 }, numbers: [2, 3, 11, 12] },
    { hex: { q: 2, r: -1 }, numbers: [4, 10] },
  ];

  test("one chip per lake, on the chip socket, keyed on its hex", () => {
    const out = planLakeChips(tiles, lakes);
    expect(out.map((c) => c.numbers)).toEqual([
      [2, 3, 11, 12],
      [4, 10],
    ]);
    const [cx, , cz] = hexToWorld({ q: 2, r: -1 });
    expect(out[1].position[0]).toBeCloseTo(cx, 6);
    expect(out[1].position[1]).toBe(0);
    expect(out[1].position[2]).toBeCloseTo(cz + CHIP_OFFSET_Z, 6);
    expect(out[1].key).toBe(chipKey({ q: 2, r: -1 }));
    expect(isChipKey(out[0].key)).toBe(true);
  });

  test("the socket is the lake tile's own, at the same spot as every chip", () => {
    // The chip goes where the tile keeps its footprint clear; a lake tile
    // re-authored without a socket would take none.
    expect(TILES.lake?.socket).toBeTruthy();
    const [land] = planChips([{ hex: { q: 0, r: 0 }, res: "wood", num: 5 }]);
    const [lake] = planLakeChips([{ hex: { q: 0, r: 0 }, res: "lake", num: 0 }], [lakes[0]]);
    expect(lake.position).toEqual(land.position);
  });

  test("no chip for a numberless lake, a non-lake hex, or missing art", () => {
    expect(planLakeChips(tiles, [])).toEqual([]);
    expect(planLakeChips(tiles, [{ hex: { q: 1, r: 0 }, numbers: [4, 10] }])).toEqual([]);
    expect(planLakeChips(tiles, [{ hex: { q: 2, r: -1 }, numbers: [7, 10] }])[0].numbers).toEqual([
      10,
    ]);
    expect(planLakeChips(tiles, [{ hex: { q: 2, r: -1 }, numbers: [7] }])).toEqual([]);
  });

  test("a paying roll turns a lake's chip unless the robber is on it", () => {
    expect(chipsMatching(tiles, undefined, 4, lakes)).toEqual([
      chipKey({ q: 1, r: 0 }),
      chipKey({ q: 2, r: -1 }),
    ]);
    expect(chipsMatching(tiles, undefined, 12, lakes)).toEqual([chipKey({ q: 0, r: 0 })]);
    // The robber on a lake blocks every number it pays on.
    expect(chipsMatching(tiles, { q: 2, r: -1 }, 4, lakes)).toEqual([chipKey({ q: 1, r: 0 })]);
    expect(chipsMatching(tiles, { q: 2, r: -1 }, 10, lakes)).toEqual([]);
    // Without lakes the result is unchanged.
    expect(chipsMatching(tiles, undefined, 4)).toEqual([chipKey({ q: 1, r: 0 })]);
  });

  test("chipFor covers numbered tiles; hasChip also covers lakes", () => {
    expect(chipFor(tiles, { q: 0, r: 0 })).toBeUndefined();
    expect(hasChip(tiles, { q: 0, r: 0 }, lakes)).toBe(true);
    expect(hasChip(tiles, { q: 1, r: 0 }, lakes)).toBe(true);
    expect(hasChip(tiles, { q: 0, r: 0 }, [])).toBe(false);
    expect(hasChip(tiles, { q: 5, r: 5 }, lakes)).toBe(false);
  });
});
