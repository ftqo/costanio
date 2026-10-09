import { describe, test, expect } from "vitest";
import { dynamicPiecesKey } from "./piecesKey";
import { makeEdge } from "@/lib/hexgeo";
import type { FullView, Vertex } from "@/lib/types";

// The board rebuilds its pieces only when this key moves, so a piece whose
// state is missing from it doesn't appear when placed (e.g. a built bridge
// stayed invisible until an unrelated road went down).

const v = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const A = v(0, 0, 0);
const B = v(1, -1, 1);
const C = v(1, 0, 0);

function view(ext: Record<string, unknown>): FullView {
  return {
    viewer: 0,
    buildings: [],
    roads: [],
    board: {
      radius: 1,
      robber: { q: 0, r: 0 },
      harbors: [],
      tiles: [
        { hex: { q: 0, r: 0 }, res: "none", num: 0 },
        { hex: { q: 1, r: 0 }, res: "wood", num: 8 },
      ],
    },
    config: { ruleset: "base" },
    ext,
  } as unknown as FullView;
}

test("a bridge being built moves the key", () => {
  const before = view({ rivers: { bridges: [] } });
  const after = view({ rivers: { bridges: [{ player: 1, e: makeEdge(A, B) }] } });
  expect(dynamicPiecesKey(after)).not.toBe(dynamicPiecesKey(before));
});

test("a camel being placed moves the key", () => {
  const spoke = { caravan: 0, arrow: makeEdge(A, B), corner: A };
  // One camel already down, so the spoke has gone either way and only the
  // camel itself can move the key.
  const before = view({
    caravans: {
      oasis: { q: 0, r: 0 },
      caravans: [spoke],
      camels: [{ caravan: 0, e: makeEdge(A, B) }],
      occupied: [makeEdge(A, B)],
    },
  });
  const after = view({
    caravans: {
      oasis: { q: 0, r: 0 },
      caravans: [spoke],
      camels: [
        { caravan: 0, e: makeEdge(A, B) },
        { caravan: 0, e: makeEdge(B, C) },
      ],
      occupied: [makeEdge(A, B), makeEdge(B, C)],
    },
  });
  expect(dynamicPiecesKey(after)).not.toBe(dynamicPiecesKey(before));
});

test("a coin changing hands does not move the key", () => {
  // The key names what is drawn, so Rivers' coin count (which changes on most
  // builds) must not rebuild the board on its own.
  const a = view({ rivers: { bridges: [], coins: [0, 1] } });
  const b = view({ rivers: { bridges: [], coins: [3, 1] } });
  expect(dynamicPiecesKey(b)).toBe(dynamicPiecesKey(a));
});

// Each case is a module piece actually moving or appearing, since the key is
// built from what is drawn rather than from the module's whole slice.
describe("the key follows every module's pieces", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    [
      "wagons: a wagon drives",
      { wagons: { started: true, wagons: [{ player: 0, v: A }] } },
      { wagons: { started: true, wagons: [{ player: 0, v: C }] } },
    ],
    [
      "wagons: a barbarian moves",
      { wagons: { has_trade: true, barbarians: [makeEdge(A, B)] } },
      { wagons: { has_trade: true, barbarians: [makeEdge(B, C)] } },
    ],
    [
      "explorers: a ship sails",
      { explorers: { ships: [{ id: 1, owner: 0, e: makeEdge(A, B), hold: {}, left: 2 }] } },
      { explorers: { ships: [{ id: 1, owner: 0, e: makeEdge(B, C), hold: {}, left: 2 }] } },
    ],
    [
      "fishermen: a weir appears",
      { fishermen: { grounds: [] } },
      { fishermen: { grounds: [{ v: [A], number: 4, hex: { q: 0, r: 0 } }] } },
    ],
    ["raiders", { raiders: { marker: 1 } }, { raiders: { marker: 2 } }],
    ["cak", { cak: { marker: 1 } }, { cak: { marker: 2 } }],
    ["islands", { islands: { marker: 1 } }, { islands: { marker: 2 } }],
  ];
  for (const [name, before, after] of cases) {
    test(name, () => {
      expect(dynamicPiecesKey(view(after))).not.toBe(dynamicPiecesKey(view(before)));
    });
  }
});
