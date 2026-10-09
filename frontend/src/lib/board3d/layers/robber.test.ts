import { test, expect, describe } from "vitest";
import * as THREE from "three";
import {
  planRobber,
  robberGhostSeat,
  robberOnBoard,
  robberOnChip,
  ROBBER_KEY,
  robberAssetFile,
  applyRobberChroma,
} from "./robber";
import { ROBBERS } from "@/lib/robbers";
import type { LoadedAsset } from "../loader";
import { boardModelFiles } from "../loader";
import { CHIP_OFFSET_Z } from "./chips";
import { hexToWorld } from "../coords";
import { SURFACE } from "../seating";
import type { Board } from "@/lib/types";

const board = {
  radius: 2,
  tiles: [{ hex: { q: 1, r: -1 }, res: "none", num: 0 }],
  robber: { q: 1, r: -1 },
  harbors: [],
} as unknown as Board;

test("the robber stands on its hex", () => {
  const out = planRobber(board);
  expect(out).toHaveLength(1);
  const [x, , z] = hexToWorld({ q: 1, r: -1 });
  expect(out[0].position[0]).toBeCloseTo(x, 5);
  // The desert has no chip, but the robber still takes the chip's spot (flat
  // and kept clear on every tile), never the tile's centre.
  expect(out[0].position[2]).toBeCloseTo(z + CHIP_OFFSET_Z, 5);
});

test("the robber carries no height of its own", () => {
  // Height is seating.ts's job: the caller stands it on the chip's top face
  // where there is a chip, and on the tile otherwise. The art's base is at
  // 0.415 and it is drawn at 1.5x, so a hardcoded height would float it.
  expect(planRobber(board)[0].position[1]).toBe(0);
});

test("the robber stands on the number chip when the hex has one", () => {
  // On the chip, as on a physical board, so the blocked number is readable.
  // The desert (where it starts) has no number, so it stands on the bare tile
  // at the chip's spot, the one place every tile keeps flat and clear (the
  // oasis has a pond at its centre, the lake has water there).
  const desert = board;
  expect(robberOnChip(desert)).toBe(false);
  expect(planRobber(desert)[0].position[2]).toBeCloseTo(
    hexToWorld({ q: 1, r: -1 })[2] + CHIP_OFFSET_Z,
    5,
  );

  const numbered = {
    ...board,
    tiles: [{ hex: { q: 1, r: -1 }, res: "wood", num: 8 }],
  } as unknown as Board;
  expect(robberOnChip(numbered)).toBe(true);
  const [, , z] = hexToWorld({ q: 1, r: -1 });
  expect(planRobber(numbered)[0].position[2]).toBeCloseTo(z + CHIP_OFFSET_Z, 5);
});

test("the robber keeps the same identity wherever it stands", () => {
  // The key lets the renderer see the same piece at a new place and carry it
  // there. A key derived from the hex (as `pieceKey` does for buildings) would
  // change on every move, and the robber would blink between hexes.
  // Both hexes must be on the board: `planRobber` draws nothing off the tile
  // list, so an off-board destination would pass with two empty arrays.
  const twoTiles = {
    ...board,
    tiles: [
      { hex: { q: 1, r: -1 }, res: "none", num: 0 },
      { hex: { q: 0, r: 0 }, res: "wood", num: 5 },
    ],
  } as unknown as Board;
  const moved = { ...twoTiles, robber: { q: 0, r: 0 } };
  expect(planRobber(twoTiles)[0].key).toBe(ROBBER_KEY);
  expect(planRobber(moved)[0].key).toBe(ROBBER_KEY);
  expect(planRobber(moved)[0].position).not.toEqual(planRobber(twoTiles)[0].position);
});

// The rule (docs/rules/scenarios.md): "The robber starts beside the board and
// enters play on the first 7", and the two-fish spend puts it back there. The
// wire encodes this as a coordinate (`board.OffBoard`, a large negative pair)
// rather than a flag, and that coordinate is truthy, so the robber must be
// checked against the board's tiles.
describe("a robber that is not on the board is not drawn", () => {
  test("nothing is placed for a hex outside the tile list", () => {
    // Not the engine's own pair: the client tests membership of this board's
    // tiles, not a particular coordinate, so any outside hex must behave the
    // same.
    const beside: Board = { ...board, robber: { q: -9999, r: -9999 } };
    expect(planRobber(beside)).toEqual([]);
    expect(robberOnBoard(beside)).toBe(false);
    expect(robberOnChip(beside)).toBe(false);
  });

  test("it is drawn again once the robber lands on a tile", () => {
    expect(robberOnBoard(board)).toBe(true);
    expect(planRobber(board)).toHaveLength(1);
  });
});

test("the robber's preview obeys the same chip rule at a hex it is not on", () => {
  // The hover ghost asks about the hex under the pointer, which the robber is
  // not on, so it cannot use planRobber. Both follow this one rule.
  const numbered = {
    ...board,
    tiles: [
      { hex: { q: 1, r: -1 }, res: "none", num: 0 },
      { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    ],
  } as unknown as Board;
  const chipTop = SURFACE.land + 0.12;

  expect(robberGhostSeat(numbered, { q: 0, r: 0 }, chipTop)).toEqual({
    surface: chipTop,
    dz: CHIP_OFFSET_Z,
  });
  // The desert it stands on: no chip, so no lift, but the same nudge to the
  // chip's spot so it never stands in an oasis pond or a lake.
  expect(robberGhostSeat(numbered, { q: 1, r: -1 }, chipTop)).toEqual({
    surface: SURFACE.land,
    dz: CHIP_OFFSET_Z,
  });
});

test("a preview with no measured chip stands on the tile face", () => {
  // `chipTop` is measured off the loaded chip art and is null until it loads;
  // the tile face is the fallback.
  const numbered = {
    ...board,
    tiles: [{ hex: { q: 1, r: -1 }, res: "wood", num: 8 }],
  } as unknown as Board;
  expect(robberGhostSeat(numbered, { q: 1, r: -1 }, null)).toEqual({
    surface: SURFACE.land,
    dz: CHIP_OFFSET_Z,
  });
});

test("a board with no robber plans nothing", () => {
  const none = { ...board, robber: undefined } as unknown as Board;
  expect(planRobber(none)).toEqual([]);
});

describe("robberAssetFile", () => {
  test("no skin equipped is the stock art", () => {
    expect(robberAssetFile("")).toBe("pieces.glb");
    expect(robberAssetFile(undefined as unknown as string)).toBe("pieces.glb");
  });

  // A bundle can be older than the catalog: a skin ships, a player buys it,
  // and a client that has not reloaded is asked for an unknown file. It must
  // draw the stock robber; a failed cosmetic loses the decoration, not the
  // piece.
  test("a skin this client does not know is the stock art", () => {
    expect(robberAssetFile("robber.not_a_thing")).toBe("pieces.glb");
    expect(robberAssetFile("decoration.fire_blue")).toBe("pieces.glb");
  });

  test("a known skin resolves to its own file", () => {
    for (const [id, r] of Object.entries(ROBBERS)) {
      expect(robberAssetFile(id), id).toBe(r.file);
      expect(r.file, id).toMatch(/^robbers\/[a-z0-9_]+\.glb$/);
    }
  });
});

// The stock robber is in pieces.glb, which the board loads anyway. A skin is
// fetched on demand rather than preloaded, so tables where nobody owns one pay
// nothing.
test("no robber skin is in the preloaded board model set", () => {
  const preloaded = new Set([...boardModelFiles("base"), ...boardModelFiles("base+cak")]);
  for (const r of Object.values(ROBBERS)) {
    expect(preloaded.has(r.file), r.file).toBe(false);
  }
});

describe("applyRobberChroma", () => {
  function fakeSkin(): LoadedAsset {
    const material = new THREE.MeshStandardMaterial({ name: "Mat_RobberSkin_Body" });
    material.color.setRGB(0.075, 0.23, 0.33, THREE.LinearSRGBColorSpace);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = "Robber_shard";
    const scene = new THREE.Group();
    scene.add(mesh);
    return { scene, byMaterial: new Map([["Mat_RobberSkin_Body", [mesh]]]) };
  }

  test("a chroma recolours the slot it names", () => {
    const art = applyRobberChroma(fakeSkin(), "robber.shard.verdant");
    const mesh = art.scene.children[0] as THREE.Mesh;
    const want = ROBBERS["robber.shard.verdant"].colors!.body;
    const got = (mesh.material as THREE.MeshStandardMaterial).color.getRGB(
      { r: 0, g: 0, b: 0 },
      THREE.LinearSRGBColorSpace,
    );
    expect(got.r).toBeCloseTo(want[0], 5);
    expect(got.g).toBeCloseTo(want[1], 5);
    expect(got.b).toBeCloseTo(want[2], 5);
  });

  // subsetByPrefix returns meshes still pointing at the cached asset's
  // materials, so recolouring in place would repaint every other instance of
  // that file (buy the rose crystal and the azure one turns pink too).
  test("recolouring does not touch the material it was handed", () => {
    const art = fakeSkin();
    const original = (art.scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const before = original.color.getHex();
    const out = applyRobberChroma(art, "robber.shard.rose");
    const after = (out.scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(after).not.toBe(original);
    expect(original.color.getHex()).toBe(before);
  });

  test("a design is left exactly as it came", () => {
    const art = fakeSkin();
    const material = (art.scene.children[0] as THREE.Mesh).material;
    expect((applyRobberChroma(art, "robber.shard").scene.children[0] as THREE.Mesh).material).toBe(
      material,
    );
  });
});

// A lake pays on two or four numbers and its chip comes from the wire rather
// than the tile (`BoardTile.num` holds one number), so "does this hex have a
// chip" must ask the lakes too. The robber on a lake blocks every number it
// pays on, and stands on the chip like everywhere else.
describe("a lake's chip is a chip the robber stands on", () => {
  const lakeBoard = {
    ...board,
    tiles: [
      { hex: { q: 1, r: -1 }, res: "lake", num: 0 },
      { hex: { q: 0, r: 0 }, res: "lake", num: 0 },
    ],
  } as unknown as Board;
  const lakes = [{ hex: { q: 1, r: -1 }, numbers: [4, 10] }];

  test("on a lake with numbers it is on a chip; on one without, it is not", () => {
    expect(robberOnChip(lakeBoard, lakes)).toBe(true);
    expect(robberOnChip({ ...lakeBoard, robber: { q: 0, r: 0 } }, lakes)).toBe(false);
    // An older server that sends no numbers: the lake draws no chip.
    expect(robberOnChip(lakeBoard, [])).toBe(false);
  });

  test("the preview lifts onto the lake chip as it does onto any other", () => {
    const chipTop = SURFACE.land + 0.12;
    expect(robberGhostSeat(lakeBoard, { q: 1, r: -1 }, chipTop, lakes)).toEqual({
      surface: chipTop,
      dz: CHIP_OFFSET_Z,
    });
    expect(robberGhostSeat(lakeBoard, { q: 0, r: 0 }, chipTop, lakes)).toEqual({
      surface: SURFACE.land,
      dz: CHIP_OFFSET_Z,
    });
  });
});
