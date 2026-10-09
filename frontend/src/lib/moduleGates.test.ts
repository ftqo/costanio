import { describe, it, expect } from "vitest";
import {
  moduleBlocksActions,
  moduleBlocksEndTurn,
  wagonMoveOnlyBlocksEnd,
  wagonMovingClosesBuilding,
} from "./moduleGates";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnightsExt, CaravansExt, FullView } from "./types";

const view = (cur: number, ext: Record<string, unknown>) =>
  ({
    cur,
    players: [{}, {}, {}],
    ext,
  }) as unknown as FullView;

const car = (cur: number, x: CaravansExt) => view(cur, { caravans: x });

// The same table, with a legal placement list on the viewer's own view.
//
// The engine publishes `camel_paths` (via `PendingTargets`) only to the seat on
// the clock while bidding is open, and to the placer once it closes. Bidding is
// sequential, so several seats can be unanswered while only one may bid.
const carMine = (cur: number, x: CaravansExt) =>
  ({
    ...car(cur, x),
    legal: { camel_paths: [{ caravan: 0, e: { a: {}, b: {} } }] },
  }) as unknown as FullView;

/** A Knights ext with nothing pending, to be amended per case. */
const knightsState = (over: Partial<KnightsExt> = {}): KnightsExt =>
  ({
    players: [{ progress_count: 0 }, { progress_count: 0 }, { progress_count: 0 }],
    deserter_victim: -1,
    deserter_taker: -1,
    reloc_player: -1,
    ...over,
  }) as unknown as KnightsExt;

describe("the narrow gate: a module has taken the active seat's actions away", () => {
  // `canAct` once consulted nothing a module set, so under
  // base+fishermen+caravans a seat with a camel vote open could press
  // Build/Trade/Fish and get an `err` frame.
  it("blocks the seat on turn while it still owes the vote a bid", () => {
    expect(moduleBlocksActions(carMine(0, { voting: true, placer: -1, bidded: [1] }), 0)).toBe(
      true,
    );
  });

  // The round is sequential: the engine only takes actions away from the seat
  // it is waiting on, so "has this seat bid" is the wrong key.
  it("leaves an unanswered seat alone until its go comes round", () => {
    expect(moduleBlocksActions(car(0, { voting: true, placer: -1, bidded: [1] }), 0)).toBe(false);
  });

  it("releases it the moment it has answered", () => {
    // The engine's gate is narrow (blocksTurnActions, not the strict blocks): a
    // seat that owes the vote nothing keeps playing.
    expect(moduleBlocksActions(car(0, { voting: true, placer: -1, bidded: [0, 1] }), 0)).toBe(
      false,
    );
  });

  it("blocks the placer, and nobody else, once the round has closed", () => {
    const x: CaravansExt = { voting: true, placer: 0, bidded: [0, 1, 2] };
    expect(moduleBlocksActions(car(0, x), 0)).toBe(true);
    expect(moduleBlocksActions(car(2, x), 2)).toBe(false);
  });

  it("never blocks a seat that is not on turn", () => {
    expect(moduleBlocksActions(car(0, { voting: true, placer: -1, bidded: [] }), 1)).toBe(false);
  });

  it("is false with no vote open, and for a spectator", () => {
    expect(moduleBlocksActions(car(0, {}), 0)).toBe(false);
    expect(moduleBlocksActions(car(0, { voting: true, placer: -1 }), -1)).toBe(false);
  });
});

describe("the strict gate: a module refuses to let the turn pass", () => {
  // Two hooks: `decideEndTurn` (engine/turn.go) checks the strict `Blocks`, and
  // `Caravans.blocks` is `x.Voting` for the whole round, while
  // `blocksTurnActions` releases a seat that has bid. End Turn must stay dark
  // after the active seat bids, or pressing it returns `ErrModulePending`.
  it("holds the pass for a seat that has already bid", () => {
    const bidded = car(0, { voting: true, placer: -1, bidded: [0, 1] });
    expect(moduleBlocksActions(bidded, 0)).toBe(false); // build and trade reopen
    expect(moduleBlocksEndTurn(bidded)).toBe(true); // the turn still may not pass
  });

  it("holds it for every seat, not only the one the vote owes something", () => {
    const open = car(0, { voting: true, placer: -1, bidded: [] });
    expect(moduleBlocksEndTurn(open)).toBe(true);
    // Still held once the round has closed and someone else is placing.
    expect(moduleBlocksEndTurn(car(0, { voting: true, placer: 2, bidded: [0, 1, 2] }))).toBe(true);
  });

  it("is clear with no vote open", () => {
    expect(moduleBlocksEndTurn(car(0, {}))).toBe(false);
    expect(moduleBlocksEndTurn(car(0, { voting: false, placer: -1 }))).toBe(false);
    expect(moduleBlocksEndTurn(view(0, {}))).toBe(false);
  });

  it("mirrors the Islands gold pick held by any seat", () => {
    expect(moduleBlocksEndTurn(view(0, { islands: { pending_gold: { 2: 1 } } }))).toBe(true);
    expect(moduleBlocksEndTurn(view(0, { islands: { pending_gold: {} } }))).toBe(false);
  });

  it("mirrors Knights hard pendings and over-limit hands", () => {
    expect(moduleBlocksEndTurn(view(0, { cak: knightsState() }))).toBe(false);
    expect(moduleBlocksEndTurn(view(0, { cak: knightsState({ aqueduct: [1] }) }))).toBe(true);
    expect(moduleBlocksEndTurn(view(0, { cak: knightsState({ pending_give: { 1: 2 } }) }))).toBe(
      true,
    );
    expect(moduleBlocksEndTurn(view(0, { cak: knightsState({ reloc_player: 2 }) }))).toBe(true);
    // progressHandSize is 4: five cards is over, four is not.
    const over = knightsState();
    over.players[2].progress_count = 5;
    expect(moduleBlocksEndTurn(view(0, { cak: over }))).toBe(true);
    over.players[2].progress_count = 4;
    expect(moduleBlocksEndTurn(view(0, { cak: over }))).toBe(false);
  });
});

describe("the End Turn affordance actually consults the strict gate", () => {
  // Game.tsx composes the gates and has no render harness, so the composition
  // is pinned at the source; this fails if the guard is deleted.
  const src = readFileSync(join(__dirname, "..", "routes", "Game.tsx"), "utf8");

  it("canEnd is gated on moduleBlocksEndTurn, not only on canBuild", () => {
    expect(src).toMatch(/const endBlocked = moduleBlocksEndTurn\(view\);/);
    // Relaxed only for the wagon decline, which End Turn sends itself.
    expect(src).toMatch(
      /const canEnd =\s*canTurnAction && \(!endBlocked \|\| endDeclinesWagon\) &&/,
    );
    expect(src).toMatch(/const endDeclinesWagon = wagonMoveOnlyBlocksEnd\(view\);/);
    expect(src).toMatch(/if \(endDeclinesWagon\) send\("wagons_halt", \{\}\);/);
    expect(src).toContain("const canSpend = canTurnAction && !explorersExt(view)?.movement;");
    expect(src).toContain("const canBuild = canSpend && !wagonMovingClosesBuilding(view);");
  });

  it("canBuild uses the narrow gate", () => {
    expect(src).toMatch(/const moduleBlocked = moduleBlocksActions\(view, actorSeat\);/);
    // The old single-gate name is gone.
    expect(src).not.toMatch(/moduleBlocksTurn\b/);
  });

  it("canTrade mirrors canBuild, module block included", () => {
    // `canTrade` is a second copy of the build gate (it sits above the loading
    // early-returns) and must include the module block, or a staged basket
    // survives a camel vote opening behind a closed panel.
    expect(src).toMatch(
      /!moduleBlocksActions\(view, actingSeat\(view\.viewer, myBotControlled\)\)/,
    );
  });
});

describe("scenario turn obligations", () => {
  it("keeps building available while holding End Turn for wagon movement", () => {
    const v = {
      ...view(0, { wagons: { has_trade: true, started: true, turn_seat: 0, barb_seat: -1 } }),
      phase: "play",
      rolled: true,
    } as FullView;
    expect(moduleBlocksActions(v, 0)).toBe(false);
    expect(moduleBlocksEndTurn(v)).toBe(true);
    v.ext!.wagons = {
      has_trade: true,
      started: true,
      turn_seat: 0,
      barb_seat: -1,
      move_done: true,
    };
    expect(moduleBlocksEndTurn(v)).toBe(false);
  });
  it("blocks voluntary actions during wagon and pirate interrupts", () => {
    for (const ext of [
      { wagons: { has_trade: true, barb_seat: 1 } },
      { explorers: { pirate_by: 1 } },
    ]) {
      const v = view(0, ext);
      expect(moduleBlocksActions(v, 0)).toBe(true);
      expect(moduleBlocksEndTurn(v)).toBe(true);
    }
  });
});

describe("wagonMoveOnlyBlocksEnd", () => {
  // Declining the move is always legal and ends the turn, so End Turn must not
  // wait for the player to open the wagon panel and press Finish movement.
  const wagonView = (over: Record<string, unknown> = {}) =>
    ({
      phase: "play",
      rolled: true,
      cur: 1,
      viewer: 1,
      ext: {
        wagons: {
          has_trade: true,
          started: true,
          move_done: false,
          turn_seat: 1,
          barb_seat: -1,
          ...over,
        },
      },
    }) as unknown as FullView;

  it("is true when only the unmoved wagon holds the pass", () => {
    expect(moduleBlocksEndTurn(wagonView())).toBe(true);
    expect(wagonMoveOnlyBlocksEnd(wagonView())).toBe(true);
  });
  it("is false once the move is done, or while a barbarian is owed", () => {
    expect(wagonMoveOnlyBlocksEnd(wagonView({ move_done: true }))).toBe(false);
    expect(wagonMoveOnlyBlocksEnd(wagonView({ barb_seat: 1 }))).toBe(false);
  });
  it("is false when another module also holds the pass", () => {
    const v = wagonView();
    (v.ext as Record<string, unknown>).caravans = { voting: true };
    expect(wagonMoveOnlyBlocksEnd(v)).toBe(false);
  });
});

describe("wagonMovingClosesBuilding", () => {
  // The engine closes building and trading while the wagon is moving
  // (engine/wagons blocksBuildTrade, BUILDING_OVER) and reopens them when it
  // stops.
  const moving = (over: Record<string, unknown> = {}) =>
    ({
      phase: "play",
      rolled: true,
      cur: 1,
      viewer: 1,
      ext: {
        wagons: {
          has_trade: true,
          started: true,
          move_open: true,
          move_done: false,
          turn_seat: 1,
          barb_seat: -1,
          ...over,
        },
      },
    }) as unknown as FullView;

  it("is true while the seat on turn has a movement action open", () => {
    expect(wagonMovingClosesBuilding(moving())).toBe(true);
  });
  it("is false before the wagon sets off and after it stops", () => {
    expect(wagonMovingClosesBuilding(moving({ move_open: false }))).toBe(false);
    expect(wagonMovingClosesBuilding(moving({ move_open: false, move_done: true }))).toBe(false);
  });
  it("is false for a stale turn seat and outside the scenario", () => {
    expect(wagonMovingClosesBuilding(moving({ turn_seat: 0 }))).toBe(false);
    expect(wagonMovingClosesBuilding(moving({ has_trade: false }))).toBe(false);
    expect(wagonMovingClosesBuilding({ ...moving(), ext: {} })).toBe(false);
  });
});
