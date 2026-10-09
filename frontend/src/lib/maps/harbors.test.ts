import { describe, it, expect } from "vitest";
import { canPlaceHarbor, coastEdges, edgeSeaHex, setHarbor } from "./harbors";
import { hexKey } from "@/lib/hexgeo";
import type { Board, Edge, Harbor } from "@/lib/types";

const single: Board = {
  radius: 1,
  robber: { q: 0, r: 0 },
  harbors: [],
  tiles: [{ hex: { q: 0, r: 0 }, res: "wood", num: 4 }], // lone hex: all 6 edges are coast
};

describe("coastEdges", () => {
  it("returns the 6 boundary edges of a lone hex", () => {
    expect(coastEdges(single).length).toBe(6);
  });
});

describe("setHarbor over one edge", () => {
  it("walks none → 3:1 → 2:1 wood → 2:1 ore → none", () => {
    const e = coastEdges(single)[0];
    let h: Harbor[] = [];
    h = setHarbor(h, e, { ratio: 3, res: "none" });
    expect(h.length).toBe(1);
    expect(h[0].ratio).toBe(3);
    h = setHarbor(h, e, { ratio: 2, res: "wood" });
    expect(h[0].ratio).toBe(2);
    expect(h[0].res).toBe("wood");
    h = setHarbor(h, e, { ratio: 2, res: "ore" });
    expect(h[0].res).toBe("ore");
    h = setHarbor(h, e, "erase");
    expect(h.length).toBe(0);
  });
});

// A lone land hex: each coast edge faces a different water hex, so none clash.
// Two land hexes with a water hex between them both face the same water.
const withBay: Board = {
  radius: 3,
  robber: { q: 0, r: 0 },
  harbors: [],
  // (1,0) is left as open water; (0,0) and (2,0) both border it.
  tiles: [
    { hex: { q: 0, r: 0 }, res: "wood", num: 4 },
    { hex: { q: 2, r: 0 }, res: "ore", num: 5 },
    { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
  ],
};

/** The two coast edges of `withBay` that both face the water hex (1,0). */
function bayEdges(): [Edge, Edge] {
  const facing = coastEdges(withBay).filter((e) => {
    const sea = edgeSeaHex(withBay, e);
    return sea !== null && hexKey(sea) === hexKey({ q: 1, r: 0 });
  });
  // Pick two that do not share a vertex, so only the water-hex rule applies.
  expect(facing.length).toBeGreaterThanOrEqual(2);
  return [facing[0], facing[facing.length - 1]];
}

describe("edgeSeaHex", () => {
  it("names the single water hex beside a coast edge", () => {
    for (const e of coastEdges(single)) expect(edgeSeaHex(single, e)).not.toBeNull();
  });

  it("gives the six edges of a lone hex six different water hexes", () => {
    const keys = coastEdges(single).map((e) => hexKey(edgeSeaHex(single, e)!));
    expect(new Set(keys).size).toBe(6);
  });
});

describe("canPlaceHarbor", () => {
  it("allows an edge whose water hex is free", () => {
    const [e] = bayEdges();
    expect(canPlaceHarbor(withBay, e)).toBe(true);
  });

  it("blocks a second harbour on the same water hex", () => {
    const [e1, e2] = bayEdges();
    const board = { ...withBay, harbors: setHarbor([], e1, { ratio: 3, res: "none" }) };
    expect(canPlaceHarbor(board, e2)).toBe(false);
  });

  it("still allows editing the harbour that owns the water hex", () => {
    const [e1] = bayEdges();
    const board = { ...withBay, harbors: setHarbor([], e1, { ratio: 3, res: "none" }) };
    expect(canPlaceHarbor(board, e1)).toBe(true);
  });

  it("frees the water hex again once its harbour is cleared", () => {
    const [e1, e2] = bayEdges();
    let harbors = setHarbor([], e1, { ratio: 3, res: "none" }); // 3:1
    harbors = setHarbor(harbors, e1, { ratio: 2, res: "wood" }); // 2:1 wood
    harbors = setHarbor(harbors, e1, "erase"); // none
    expect(harbors.length).toBe(0);
    expect(canPlaceHarbor({ ...withBay, harbors }, e2)).toBe(true);
  });
});

describe("setHarbor", () => {
  const edge = () => coastEdges(single)[0];

  it("places the brushed port type in one step", () => {
    const harbors = setHarbor([], edge(), { ratio: 2, res: "ore" });
    expect(harbors).toEqual([{ verts: [edge().a, edge().b], ratio: 2, res: "ore" }]);
  });

  it("replaces an existing port of a different type", () => {
    let harbors = setHarbor([], edge(), { ratio: 3, res: "none" });
    harbors = setHarbor(harbors, edge(), { ratio: 2, res: "wheat" });
    expect(harbors.length).toBe(1);
    expect(harbors[0].ratio).toBe(2);
    expect(harbors[0].res).toBe("wheat");
  });

  it("toggles off when the brushed type is already there", () => {
    let harbors = setHarbor([], edge(), { ratio: 2, res: "wheat" });
    harbors = setHarbor(harbors, edge(), { ratio: 2, res: "wheat" });
    expect(harbors).toEqual([]);
  });

  it("erases whatever the edge carries", () => {
    const harbors = setHarbor(setHarbor([], edge(), { ratio: 3, res: "none" }), edge(), "erase");
    expect(harbors).toEqual([]);
  });

  it("leaves other edges alone", () => {
    const [e1, e2] = coastEdges(single);
    let harbors = setHarbor([], e1, { ratio: 3, res: "none" });
    harbors = setHarbor(harbors, e2, { ratio: 2, res: "sheep" });
    expect(harbors.length).toBe(2);
  });
});
