import { test, expect } from "vitest";
import { patchForCommand } from "./cmdPatch";
import type { KnightsExt, FullView, Vertex } from "./types";

const V = (q: number, r: number, side: 0 | 1 = 0): Vertex => ({ q, r, side });
const E = (a: Vertex, b: Vertex) => ({ a, b });

function base(over: Partial<FullView> = {}): FullView {
  return {
    seq: 10,
    viewer: 1,
    config: {} as never,
    phase: "play",
    cur: 1,
    board: { radius: 2, tiles: [], robber: { q: 0, r: 0 }, harbors: [] },
    bank: [0, 0, 0, 0, 0, 0],
    players: [],
    buildings: [],
    roads: [],
    dev_deck_count: 0,
    longest_road: -1,
    largest_army: -1,
    winner: -1,
    ...over,
  };
}

const p = (type: string, data?: unknown, view = base()) => patchForCommand(type, data, 1, view);

test("setup placements state the piece straight away", () => {
  expect(p("place_settlement", { v: V(0, 0) })).toEqual({
    kind: "settlement",
    v: V(0, 0),
    owner: 1,
  });
  const e = E(V(0, 0), V(0, 0, 1));
  expect(p("place_road", { e })).toEqual({ kind: "road", e, owner: 1 });
});

test("the setup road is a ship when the dock's toggle says so", () => {
  const e = E(V(2, 0), V(2, 0, 1));
  expect(p("place_road", { e, ship: true })).toEqual({ kind: "ship", e, owner: 1 });
});

test("every build states its own piece, owned by the acting seat", () => {
  expect(p("build_settlement", { v: V(1, 1) })).toEqual({
    kind: "settlement",
    v: V(1, 1),
    owner: 1,
  });
  expect(p("build_city", { v: V(1, 1) })).toEqual({ kind: "city", v: V(1, 1), owner: 1 });
  expect(p("build_wall", { v: V(1, 1) })).toEqual({ kind: "wall", v: V(1, 1), owner: 1 });
  expect(p("build_knight", { v: V(1, 1) })).toEqual({
    kind: "knight",
    v: V(1, 1),
    owner: 1,
    level: 1,
    active: false,
  });
});

test("moves carry both endpoints, and the two kinds are told apart by shape", () => {
  expect(p("move_knight", { from: V(0, 0), to: V(1, 0) })).toEqual({
    kind: "knight_move",
    from: V(0, 0),
    to: V(1, 0),
  });
  const from = E(V(2, 0), V(2, 0, 1));
  const to = E(V(3, 0), V(3, 0, 1));
  expect(p("move_ship", { from, to })).toEqual({ kind: "ship_move", from, to });
  // A vertex payload on the edge command (and vice versa) states nothing.
  expect(p("move_ship", { from: V(0, 0), to: V(1, 0) })).toBeNull();
  expect(p("move_knight", { from, to })).toBeNull();
});

test("the Deserter replacement takes the strength the server published", () => {
  const view = base({
    ext: { cak: { deserter_level: 3, knights: [] } as unknown as KnightsExt },
  });
  expect(patchForCommand("deserter_place", { v: V(1, 1) }, 1, view)).toEqual({
    kind: "knight",
    v: V(1, 1),
    owner: 1,
    level: 3,
    // Drawn inactive: the replaced knight's state is not on the wire, and
    // inactive offers fewer actions.
    active: false,
  });
});

test("the robber and pirate move, and nothing about the theft is stated", () => {
  expect(p("move_robber", { hex: { q: 1, r: 2 }, victim: 3 })).toEqual({
    kind: "robber",
    hex: { q: 1, r: 2 },
  });
  expect(p("chase_robber", { v: V(0, 0), hex: { q: 1, r: 2 } })).toEqual({
    kind: "robber",
    hex: { q: 1, r: 2 },
  });
  expect(p("move_pirate", { hex: { q: 4, r: 4 } })).toEqual({
    kind: "pirate",
    hex: { q: 4, r: 4 },
  });
});

test("randomness, other players and engine state are gated, never drawn", () => {
  for (const type of [
    "roll_dice",
    "buy_dev_card",
    "end_turn",
    "offer_trade",
    "counter_trade",
    "respond_trade",
    "execute_trade",
    "bank_trade",
    "offer_draw",
    "respond_draw",
    "surrender",
    "play_progress",
    "relocate_knight",
    "metropolis_pick",
    "barbarian_downgrade",
    "improve_city",
  ]) {
    expect(p(type, { v: V(0, 0), hex: { q: 0, r: 0 } })).toBeNull();
  }
});

test("a command with no position states nothing rather than half a patch", () => {
  expect(p("build_settlement", {})).toBeNull();
  expect(p("build_settlement", undefined)).toBeNull();
  expect(p("move_robber", { victim: 2 })).toBeNull();
});
