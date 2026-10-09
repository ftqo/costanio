import { describe, it, expect } from "vitest";
import {
  detectMode,
  stripToShape,
  swapResource,
  swapNumber,
  setTileNumber,
  setTileResource,
  applyDrag,
  addLand,
} from "./board";
import { coastEdges, edgeSeaHex, setHarbor } from "./harbors";
import type { Board, BoardTile, Hex } from "@/lib/types";

const shape: Board = {
  radius: 2,
  robber: { q: 0, r: 0 },
  harbors: [],
  tiles: [
    { hex: { q: 0, r: 0 }, res: "land", num: 0 },
    { hex: { q: 1, r: 0 }, res: "none", num: 0 },
    { hex: { q: -1, r: 0 }, res: "sea", num: 0 },
  ],
};

const design: Board = {
  radius: 2,
  robber: { q: 1, r: 0 },
  harbors: [],
  tiles: [
    { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
    { hex: { q: 1, r: 0 }, res: "none", num: 0 },
  ],
};

describe("detectMode", () => {
  it("treats generic land + sea + no numbers as shape", () => {
    expect(detectMode(shape)).toBe("shape");
  });
  it("treats pinned resources/numbers as design", () => {
    expect(detectMode(design)).toBe("design");
  });
});

describe("swap", () => {
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
    { hex: { q: 1, r: 0 }, res: "wheat", num: 8 },
  ];
  it("swaps resources only", () => {
    const out = swapResource(tiles, { q: 0, r: 0 }, { q: 1, r: 0 });
    expect(out[0].res).toBe("wheat");
    expect(out[0].num).toBe(6); // number unchanged
    expect(out[1].res).toBe("ore");
  });
  it("swaps numbers only", () => {
    const out = swapNumber(tiles, { q: 0, r: 0 }, { q: 1, r: 0 });
    expect(out[0].num).toBe(8);
    expect(out[0].res).toBe("ore"); // resource unchanged
    expect(out[1].num).toBe(6);
  });
  it("is immutable", () => {
    swapResource(tiles, { q: 0, r: 0 }, { q: 1, r: 0 });
    expect(tiles[0].res).toBe("ore");
  });

  // Swapping with a desert: the number travels with the terrain that can carry
  // it, rather than being stranded invisibly on the desert.
  const withDesert: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
    { hex: { q: 1, r: 0 }, res: "none", num: 0 },
  ];
  it("carries the number with the resource when swapping with a desert", () => {
    const out = swapResource(withDesert, { q: 0, r: 0 }, { q: 1, r: 0 });
    expect(out[0].res).toBe("none");
    expect(out[0].num).toBe(0); // the desert arrives blank
    expect(out[1].res).toBe("ore");
    expect(out[1].num).toBe(6); // and the 6 went with the ore
  });
  it("carries the number in either drag direction", () => {
    const out = swapResource(withDesert, { q: 1, r: 0 }, { q: 0, r: 0 });
    expect(out[0].num).toBe(0);
    expect(out[1].num).toBe(6);
  });
  it("carries the number when swapping with water too", () => {
    const withSea: BoardTile[] = [
      { hex: { q: 0, r: 0 }, res: "wheat", num: 11 },
      { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
    ];
    const out = swapResource(withSea, { q: 0, r: 0 }, { q: 1, r: 0 });
    expect(out[0]).toMatchObject({ res: "sea", num: 0 });
    expect(out[1]).toMatchObject({ res: "wheat", num: 11 });
  });
  it("drops a stray token that was sitting on a tile which cannot hold one", () => {
    // Not reachable through the editor, but an older board or hand-edited code
    // can carry one; handing it to the resource would invent a number.
    const stray: BoardTile[] = [
      { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
      { hex: { q: 1, r: 0 }, res: "none", num: 5 },
    ];
    const out = swapResource(stray, { q: 0, r: 0 }, { q: 1, r: 0 });
    expect(out[0]).toMatchObject({ res: "none", num: 0 });
    expect(out[1]).toMatchObject({ res: "ore", num: 6 });
  });
  it("keeps numbers when both ends carry a token", () => {
    const withGold: BoardTile[] = [
      { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
      { hex: { q: 1, r: 0 }, res: "gold", num: 8 },
    ];
    const out = swapResource(withGold, { q: 0, r: 0 }, { q: 1, r: 0 });
    expect(out[0]).toMatchObject({ res: "gold", num: 6 });
    expect(out[1]).toMatchObject({ res: "ore", num: 8 });
  });
});

describe("stripToShape", () => {
  const painted: Board = {
    radius: 2,
    robber: { q: 0, r: 0 },
    harbors: [],
    tiles: [
      { hex: { q: 0, r: 0 }, res: "none", num: 0 }, // a desert the last roll carved
      { hex: { q: 1, r: 0 }, res: "wood", num: 6 },
      { hex: { q: 0, r: 1 }, res: "gold", num: 8 },
      { hex: { q: -1, r: 0 }, res: "sea", num: 0 },
      { hex: { q: -1, r: 1 }, res: "border", num: 0 },
    ],
  };

  it("collapses the fill, deserts included, to generic land with no numbers", () => {
    const out = stripToShape(painted);
    expect(out.tiles.map((t) => t.res)).toEqual(["land", "land", "gold", "sea", "border"]);
    expect(out.tiles.every((t) => t.num === 0)).toBe(true);
  });

  it("keeps the outline and everything else about the board", () => {
    const out = stripToShape(painted);
    expect(out.tiles.map((t) => t.hex)).toEqual(painted.tiles.map((t) => t.hex));
    expect(out.radius).toBe(painted.radius);
    expect(out.robber).toEqual(painted.robber);
  });

  it("is immutable", () => {
    stripToShape(painted);
    expect(painted.tiles[1]).toMatchObject({ res: "wood", num: 6 });
  });

  // detectMode must read the stripped board as a shape, the classification a
  // Shape -> Design promotion posts.
  it("produces a board detectMode calls a shape", () => {
    expect(detectMode(stripToShape(painted))).toBe("shape");
  });
});

describe("setTileNumber", () => {
  it("sets one tile's number", () => {
    const out = setTileNumber(design.tiles, { q: 0, r: 0 }, 9);
    expect(out.find((t) => t.hex.q === 0)!.num).toBe(9);
  });
  it("is a no-op for an unknown hex", () => {
    const out = setTileNumber(design.tiles, { q: 99, r: 99 }, 9);
    expect(out).toBe(design.tiles);
  });
});

describe("setTileResource", () => {
  const tiles: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "ore", num: 6 }];
  it("clears the number when set to a non-producing resource", () => {
    expect(setTileResource(tiles, { q: 0, r: 0 }, "none")[0].num).toBe(0);
    expect(setTileResource(tiles, { q: 0, r: 0 }, "sea")[0].num).toBe(0);
  });
  it("keeps the number when set to a producing resource", () => {
    expect(setTileResource(tiles, { q: 0, r: 0 }, "wheat")[0].num).toBe(6);
  });
  it("is a no-op for an unknown hex", () => {
    expect(setTileResource(tiles, { q: 99, r: 99 }, "wheat")).toBe(tiles);
  });
});

describe("applyDrag", () => {
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
    { hex: { q: 1, r: 0 }, res: "wheat", num: 8 },
  ];
  const base = { tiles, paintRes: "brick" as const, paintNum: 5 };

  it("swaps the number layer when dragged onto a different tile", () => {
    const out = applyDrag({
      ...base,
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      layer: "number",
      paintLayer: "number",
      moved: true,
    });
    expect(out.find((t) => t.hex.q === 0)!.num).toBe(8);
    expect(out.find((t) => t.hex.q === 0)!.res).toBe("ore"); // resource intact
    expect(out.find((t) => t.hex.q === 1)!.num).toBe(6);
  });

  it("swaps the resource layer when dragged onto a different tile", () => {
    const out = applyDrag({
      ...base,
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      layer: "resource",
      paintLayer: "resource",
      moved: true,
    });
    expect(out.find((t) => t.hex.q === 0)!.res).toBe("wheat");
    expect(out.find((t) => t.hex.q === 0)!.num).toBe(6); // number intact
    expect(out.find((t) => t.hex.q === 1)!.res).toBe("ore");
  });

  it("paints the active resource on a click (moved=false)", () => {
    const out = applyDrag({
      ...base,
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      layer: "resource",
      paintLayer: "resource",
      moved: false,
    });
    expect(out.find((t) => t.hex.q === 0)!.res).toBe("brick");
    expect(out.find((t) => t.hex.q === 1)!.res).toBe("wheat"); // other tile untouched
  });

  it("paints the active number on a click (moved=false)", () => {
    const out = applyDrag({
      ...base,
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      layer: "number",
      paintLayer: "number",
      moved: false,
    });
    expect(out.find((t) => t.hex.q === 0)!.num).toBe(5);
    expect(out.find((t) => t.hex.q === 1)!.num).toBe(8); // other tile untouched
  });

  it("paints when released on the same hex (no swap)", () => {
    const out = applyDrag({
      ...base,
      from: { q: 0, r: 0 },
      to: { q: 0, r: 0 },
      layer: "resource",
      paintLayer: "resource",
      moved: true,
    });
    expect(out.find((t) => t.hex.q === 0)!.res).toBe("brick");
  });

  it("paints when released on no tile (to=null)", () => {
    const out = applyDrag({
      ...base,
      from: { q: 0, r: 0 },
      to: null,
      layer: "number",
      paintLayer: "number",
      moved: true,
    });
    expect(out.find((t) => t.hex.q === 0)!.num).toBe(5);
  });

  // A click paints by paintLayer (the palette toggle), not by the press layer.
  // A numberless producing tile has no chip, so every click lands on the body
  // (layer="resource"), and the number palette must still paint the number.
  it("number palette click paints the number", () => {
    // Clicking a numberless tile (press layer = "resource") with the number
    // palette selected.
    const numberlessTiles: BoardTile[] = [
      { hex: { q: 0, r: 0 }, res: "wood", num: 0 }, // no chip rendered
    ];
    const out = applyDrag({
      tiles: numberlessTiles,
      from: { q: 0, r: 0 },
      to: { q: 0, r: 0 },
      layer: "resource", // press hit the body (no chip present)
      paintLayer: "number", // number palette is active
      moved: false,
      paintRes: "brick",
      paintNum: 9,
    });
    expect(out.find((t) => t.hex.q === 0)!.num).toBe(9); // number painted
    expect(out.find((t) => t.hex.q === 0)!.res).toBe("wood"); // resource unchanged
  });

  it("resource palette click paints the resource", () => {
    const out = applyDrag({
      ...base,
      from: { q: 0, r: 0 },
      to: { q: 0, r: 0 },
      layer: "number", // press hit the chip
      paintLayer: "resource", // but resource palette is active
      moved: false,
      paintRes: "brick",
      paintNum: 9,
    });
    expect(out.find((t) => t.hex.q === 0)!.res).toBe("brick"); // resource painted
    expect(out.find((t) => t.hex.q === 0)!.num).toBe(6); // number unchanged
  });

  // Drags still use press layer (layer), not paintLayer, for swap direction.
  it("drag swap uses press layer, not paintLayer, to decide what to swap", () => {
    // Press on chip (layer="number") with paintLayer="resource": swap by number.
    const out = applyDrag({
      ...base,
      from: { q: 0, r: 0 },
      to: { q: 1, r: 0 },
      layer: "number", // grabbed the chip
      paintLayer: "resource", // resource palette happens to be active
      moved: true,
    });
    expect(out.find((t) => t.hex.q === 0)!.num).toBe(8); // numbers swapped
    expect(out.find((t) => t.hex.q === 0)!.res).toBe("ore"); // resources intact
  });
});

describe("swap no-op", () => {
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
    { hex: { q: 1, r: 0 }, res: "wheat", num: 8 },
  ];
  it("returns the input unchanged when a hex is absent", () => {
    expect(swapResource(tiles, { q: 0, r: 0 }, { q: 99, r: 99 })).toBe(tiles);
    expect(swapNumber(tiles, { q: 99, r: 99 }, { q: 1, r: 0 })).toBe(tiles);
  });
});

/**
 * A harbor stands on a coast, and painting land into the water it faces removes
 * the coast. (`removeLand` handles the mirror case, erasing the land a port
 * stood against.)
 */
describe("painting land over the water a harbor faces", () => {
  const lone: Board = {
    radius: 1,
    robber: { q: 0, r: 0 },
    harbors: [],
    tiles: [{ hex: { q: 0, r: 0 }, res: "wood", num: 4 }],
  };

  /** The lone hex with a 3:1 port on one of its six coast edges. */
  function ported(): { board: Board; sea: Hex } {
    const edge = coastEdges(lone)[0];
    const sea = edgeSeaHex(lone, edge);
    expect(sea, "the lone hex's edge faces open water").toBeTruthy();
    return {
      board: { ...lone, harbors: setHarbor([], edge, { ratio: 3, res: "none" }) },
      sea: sea!,
    };
  }

  it("drops the harbor when land is drawn on the water side", () => {
    const { board, sea } = ported();
    expect(board.harbors).toHaveLength(1);
    const after = addLand(board, sea);
    expect(after.harbors, "harbor kept after building over it").toHaveLength(0);
  });

  it("keeps a harbor when the land goes somewhere else", () => {
    const { board } = ported();
    // Far enough away that neither of the port's two hexes is touched.
    const after = addLand(board, { q: 3, r: -3 });
    expect(after.harbors).toHaveLength(1);
  });

  it("keeps harbors on an islands board", () => {
    // Authored `sea` is water, so a port facing it is on a coast and must
    // survive painting elsewhere.
    const authored: Board = {
      radius: 1,
      robber: { q: 0, r: 0 },
      harbors: [],
      tiles: [
        { hex: { q: 0, r: 0 }, res: "wood", num: 4 },
        { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
      ],
    };
    const edge = coastEdges(authored).find((e) => {
      const s = edgeSeaHex(authored, e);
      return s !== null && s.q === 1 && s.r === 0;
    })!;
    expect(edge, "an edge between the land and the authored sea").toBeTruthy();
    const board = { ...authored, harbors: setHarbor([], edge, { ratio: 3, res: "none" }) };
    const after = addLand(board, { q: 0, r: -1 });
    expect(after.harbors, "harbor facing authored sea removed").toHaveLength(1);
  });
});
