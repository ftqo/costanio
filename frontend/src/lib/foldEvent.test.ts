import { test, expect } from "vitest";
import { foldEvent } from "./foldEvent";
import type { KnightsExt, FullView } from "./types";

const V = (q: number, r: number, side: 0 | 1 = 0) => ({ q, r, side });
const E = (a: object, b: object) => ({ a, b });

/** A view is only consulted for the one event whose result depends on it. */
function view(knights: KnightsExt["knights"] = []): FullView {
  return {
    seq: 1,
    viewer: 0,
    config: {} as never,
    phase: "play",
    cur: 0,
    board: { radius: 2, tiles: [], robber: { q: 0, r: 0 }, harbors: [] },
    bank: [0, 0, 0, 0, 0, 0],
    players: [],
    buildings: [],
    roads: [],
    dev_deck_count: 0,
    longest_road: -1,
    largest_army: -1,
    winner: -1,
    ext: { cak: { knights } as unknown as KnightsExt },
  };
}
const V0 = view();

// The payload shapes are the engine's JSON tags: engine/events.go (BuiltData,
// RobberMovedData), engine/islands/decide.go (shipData, shipMoveData,
// pirateData) and engine/knights/events.go (knightData, knightMoveData,
// knightRemovedData, wallData). A change on either side breaks these tests.
test("a built settlement folds to a settlement patch", () => {
  expect(
    foldEvent({ seq: 4, type: "settlement_built", data: { player: 2, v: V(1, 1) } }, V0),
  ).toEqual({
    kind: "settlement",
    v: V(1, 1),
    owner: 2,
  });
});

test("setup placements fold to the same patches as their build twins", () => {
  const at = { player: 0, v: V(0, 0) };
  expect(foldEvent({ seq: 1, type: "settlement_placed", data: at }, V0)).toEqual(
    foldEvent({ seq: 1, type: "settlement_built", data: at }, V0),
  );
  const road = { player: 0, e: E(V(0, 0), V(0, 0, 1)) };
  expect(foldEvent({ seq: 2, type: "road_placed", data: road }, V0)).toEqual(
    foldEvent({ seq: 2, type: "road_built", data: road }, V0),
  );
  // Knights' round-two setup places a city outright, not an upgrade.
  expect(foldEvent({ seq: 3, type: "setup_city_placed", data: at }, V0)).toEqual({
    kind: "city",
    v: V(0, 0),
    owner: 0,
  });
});

test("islands ship events fold to ship and ship_move", () => {
  const e = E(V(2, 0), V(2, 0, 1));
  expect(foldEvent({ seq: 5, type: "ship_built", data: { player: 1, e } }, V0)).toEqual({
    kind: "ship",
    e,
    owner: 1,
  });
  const to = E(V(3, 0), V(3, 0, 1));
  expect(foldEvent({ seq: 6, type: "ship_moved", data: { player: 1, from: e, to } }, V0)).toEqual({
    kind: "ship_move",
    from: e,
    to,
  });
});

test("markers fold; the theft that follows them does not", () => {
  expect(
    foldEvent({ seq: 7, type: "robber_moved", data: { player: 1, hex: { q: 1, r: 2 } } }, V0),
  ).toEqual({ kind: "robber", hex: { q: 1, r: 2 } });
  expect(
    foldEvent({ seq: 8, type: "pirate_moved", data: { player: 1, hex: { q: 4, r: 4 } } }, V0),
  ).toEqual({ kind: "pirate", hex: { q: 4, r: 4 } });
  // Which card was stolen is hidden information.
  expect(foldEvent({ seq: 9, type: "card_stolen", data: { thief: 1, victim: 2 } }, V0)).toBeNull();
});

test("a normal knight build carries neither level nor active on the wire", () => {
  expect(
    foldEvent({ seq: 10, type: "cak_knight_built", data: { player: 3, v: V(1, 0) } }, V0),
  ).toEqual({
    kind: "knight",
    v: V(1, 0),
    owner: 3,
    level: 0, // "the default"; viewPatch turns it into 1
    active: false,
    fresh: false,
  });
});

test("a Deserter replacement keeps strength and status", () => {
  expect(
    foldEvent(
      {
        seq: 11,
        type: "cak_knight_built",
        data: { player: 3, v: V(1, 0), free: true, level: 3, active: true, fresh: true },
      },
      V0,
    ),
  ).toEqual({ kind: "knight", v: V(1, 0), owner: 3, level: 3, active: true, fresh: true });
});

test("knight move, activate, promote and remove all fold", () => {
  expect(
    foldEvent(
      {
        seq: 12,
        type: "cak_knight_moved",
        data: { player: 1, from: V(0, 0), to: V(1, 0) },
      },
      V0,
    ),
  ).toEqual({ kind: "knight_move", from: V(0, 0), to: V(1, 0) });
  expect(
    foldEvent({ seq: 13, type: "cak_knight_activated", data: { player: 1, v: V(0, 0) } }, V0),
  ).toEqual({ kind: "knight_activate", v: V(0, 0) });
  expect(
    foldEvent(
      { seq: 14, type: "cak_knight_promoted", data: { player: 1, v: V(0, 0) } },
      view([
        {
          v: V(0, 0),
          owner: 1,
          level: 2,
          active: true,
          freshly_activated: false,
          promoted_this_turn: false,
        },
      ]),
    ),
  ).toEqual({ kind: "knight_promote", v: V(0, 0), to: 3 });
  expect(
    foldEvent({ seq: 15, type: "cak_knight_removed", data: { owner: 1, v: V(0, 0) } }, V0),
  ).toEqual({
    kind: "knight_remove",
    v: V(0, 0),
  });
});

test("does not fold a wall", () => {
  // Go's `omitempty` does nothing on a struct field, so an unset board.Vertex
  // marshals as a valid-looking vertex. This is the Engineer card's actual
  // payload (checked against engine.NewEvent); the designated case looks the
  // same, so neither folds.
  expect(
    foldEvent({ seq: 16, type: "cak_wall_built", data: { player: 1, free: true, v: V(0, 0) } }, V0),
  ).toBeNull();
  expect(
    foldEvent({ seq: 17, type: "cak_wall_built", data: { player: 1, v: V(2, 2) } }, V0),
  ).toBeNull();
});

test("Medicine's discounted city folds like any other city", () => {
  expect(
    foldEvent({ seq: 18, type: "cak_cheap_city", data: { player: 2, v: V(3, 1) } }, V0),
  ).toEqual({ kind: "city", v: V(3, 1), owner: 2 });
});

test("displacement and relocation are declined", () => {
  // Two knights move at once and the displaced one may be off the board in
  // between (engine state, not a wire position).
  expect(
    foldEvent({ seq: 18, type: "cak_knight_displaced", data: { mover: 1, at: V(1, 1) } }, V0),
  ).toBeNull();
  expect(
    foldEvent({ seq: 19, type: "cak_knight_relocated", data: { player: 1, v: V(1, 1) } }, V0),
  ).toBeNull();
});

test("malformed or missing positions are declined rather than half-decoded", () => {
  expect(foldEvent({ seq: 20, type: "settlement_built", data: { player: 1 } }, V0)).toBeNull();
  expect(
    foldEvent({ seq: 21, type: "settlement_built", data: { player: 1, v: { q: 1, r: 1 } } }, V0),
  ).toBeNull(); // no side
  expect(
    foldEvent({ seq: 22, type: "road_built", data: { player: 1, e: { a: V(0, 0) } } }, V0),
  ).toBeNull();
  expect(foldEvent({ seq: 23, type: "settlement_built", data: null }, V0)).toBeNull();
  // A spectator's redacted view can carry a negative seat sentinel.
  expect(
    foldEvent({ seq: 24, type: "settlement_built", data: { player: -1, v: V(0, 0) } }, V0),
  ).toBeNull();
});

test("the events that are not about the board are declined", () => {
  for (const type of [
    "dice_rolled",
    "resources_distributed",
    "cards_discarded",
    "trade_executed",
    "dev_card_bought",
    "longest_road",
    "largest_army",
    "turn_ended",
    "game_finished",
  ]) {
    expect(foldEvent({ seq: 30, type, data: {} }, V0)).toBeNull();
  }
});

test("a promotion with no knight in view states nothing rather than a level", () => {
  // The event carries no level (Apply is `k.Level++`), so with no knight there
  // the snapshot has to answer.
  expect(
    foldEvent({ seq: 40, type: "cak_knight_promoted", data: { player: 1, v: V(9, 9) } }, V0),
  ).toBeNull();
});
