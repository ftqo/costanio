import { describe, expect, test } from "vitest";
import {
  CARGO,
  ROLE,
  barbarianTargets,
  canBoost,
  canBuyWithGold,
  carrying,
  delivered,
  destinations,
  driveOffFloor,
  gold,
  level,
  movementLeft,
  owedBarbarian,
  swiftHeld,
  wagonRole,
  wagonSteps,
} from "./wagons";
import type { FullView, LegalTargets, WagonsExt } from "./types";

// A view with a wagons ext and nothing else; the readers only touch
// `ext.wagons` and `legal`.
function viewWith(ext: Partial<WagonsExt>, legal?: LegalTargets): FullView {
  return { ext: { wagons: ext }, legal } as unknown as FullView;
}

const READY: Partial<WagonsExt> = {
  has_trade: true,
  started: true,
  turn_seat: 0,
  barb_seat: -1,
  barb_index: -1,
  gold: [5, 0, 0, 0],
  level: [1, 3, 5, 1],
  cargo: [CARGO.none, CARGO.marble, CARGO.tools, CARGO.none],
  delivered: [0, 2, 0, 0],
  mp_track: [4, 5, 6, 7, 7],
  drive_floors: [7, 6, 5, 4, 3],
  gold_price: 2,
  buys_a_turn: 2,
  bought: 0,
  trade: [
    {
      hex: { q: -2, r: 2 },
      role: ROLE.castle,
      plaza: { q: -2, r: 2, side: 2 },
      accepts: [CARGO.marble, CARGO.glass],
      ships: [CARGO.tools, CARGO.sand],
      left: 12,
    },
    {
      hex: { q: 0, r: -2 },
      role: ROLE.quarry,
      plaza: { q: 0, r: -2, side: 2 },
      accepts: [CARGO.tools],
      ships: [CARGO.marble, CARGO.sand],
      left: 12,
    },
    {
      hex: { q: 2, r: 0 },
      role: ROLE.glassworks,
      plaza: { q: 2, r: 0, side: 2 },
      accepts: [CARGO.sand],
      ships: [CARGO.glass, CARGO.tools],
      left: 12,
    },
  ],
};

describe("what a seat owes", () => {
  // The engine's priority: while a barbarian is owed, BlocksTurnActions
  // refuses everything else.
  test("an owed barbarian outranks an open movement phase", () => {
    const v = viewWith({ ...READY, barb_seat: 0, barb_index: -1 });
    expect(wagonRole(v, 0)).toBe("barbarian");
  });

  test("the movement phase belongs to the seat whose turn it is", () => {
    const v = viewWith(READY);
    expect(wagonRole(v, 0)).toBe("move");
    expect(wagonRole(v, 1)).toBe(null);
  });

  test("a halted or finished movement owes nothing", () => {
    expect(wagonRole(viewWith({ ...READY, move_done: true }), 0)).toBe(null);
  });

  test("nothing is owed before the wagons are on the board", () => {
    expect(wagonRole(viewWith({ ...READY, started: false }), 0)).toBe(null);
  });

  // A board with no cape triple carries no scenario. The engine keys every
  // hook off that flag, so the client does too rather than inferring it from
  // an empty list.
  test("a board with no trade hexes owes nothing to anyone", () => {
    expect(wagonRole(viewWith({ ...READY, has_trade: false }), 0)).toBe(null);
  });

  test("a drive-off names its barbarian; a 7 and a Knight do not", () => {
    expect(owedBarbarian(viewWith({ ...READY, barb_seat: 0, barb_index: 2 }))).toBe(2);
    expect(owedBarbarian(viewWith({ ...READY, barb_seat: 0, barb_index: -1 }))).toBe(null);
  });
});

describe("the targets come off the server, not off a rule here", () => {
  // The server has priced every path against movement points and toll, so
  // lighting up exactly these never offers a refused move.
  test("the steps are the server's priced set, verbatim", () => {
    const steps = [{ q: 0, r: 0, side: 1 }];
    expect(wagonSteps(viewWith(READY, { wagon_steps: steps }))).toEqual(steps);
    expect(wagonSteps(viewWith(READY))).toEqual([]);
  });

  test("the barbarian's homes are the server's set too", () => {
    const edges = [{ a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: 0, side: 1 } }];
    expect(barbarianTargets(viewWith(READY, { barbarian_edges: edges }))).toEqual(edges);
  });
});

describe("where a wagon is going", () => {
  // An empty wagon may go to any plaza, since each deals a load; a loaded one
  // goes to the single hex that takes its cargo.
  test("an empty wagon is heading for all three", () => {
    expect(destinations(viewWith(READY), 0)).toHaveLength(3);
  });

  test("a loaded wagon is heading for the hex that accepts its cargo", () => {
    const going = destinations(viewWith(READY), 1); // carrying marble
    expect(going).toHaveLength(1);
    expect(going[0].role).toBe(ROLE.castle);
  });

  // A hex never ships what it accepts, so a load always points elsewhere. A
  // wrong table here would send a player to the hex they are standing on.
  test("no trade hex ships a cargo it also accepts", () => {
    for (const t of READY.trade ?? []) {
      for (const out of t.ships) expect(t.accepts).not.toContain(out);
    }
  });
});

describe("the numbers the panel shows", () => {
  test("movement is the open action's remainder, or the level's allowance", () => {
    expect(movementLeft(viewWith({ ...READY, move_open: true, mp: 3 }), 0)).toBe(3);
    // No action open: the whole allowance, off the engine's published track.
    expect(movementLeft(viewWith(READY), 0)).toBe(4);
    expect(movementLeft(viewWith(READY), 1)).toBe(6);
  });

  test("a finished move leaves nothing, not the next turn's allowance", () => {
    // Movement is spent once the wagon has arrived for the turn.
    expect(movementLeft(viewWith({ ...READY, move_done: true }), 0)).toBe(0);
    // Another seat's finished turn says nothing about this seat.
    expect(movementLeft(viewWith({ ...READY, move_done: true }), 1)).toBe(6);
  });

  test("gold, level, cargo and deliveries read per seat", () => {
    const v = viewWith(READY);
    expect(gold(v, 0)).toBe(5);
    expect(gold(v, 1)).toBe(0);
    expect(level(v, 2)).toBe(5);
    expect(carrying(v, 1)).toBe(CARGO.marble);
    expect(delivered(v, 1)).toBe(2);
  });

  // A seat the view says nothing about (a spectator, or a frame from a
  // shorter table) reads as zero, not NaN.
  test("a seat outside the table reads as empty rather than as NaN", () => {
    const v = viewWith(READY);
    expect(gold(v, 9)).toBe(0);
    expect(level(v, 9)).toBe(1);
    expect(carrying(v, -1)).toBe(CARGO.none);
  });

  // Level 1 cannot attempt a drive-off: the engine publishes 7, a roll no die
  // makes.
  test("level 1 has no drive-off, and every level above it does", () => {
    const v = viewWith(READY);
    expect(driveOffFloor(v, 0)).toBe(null);
    expect(driveOffFloor(v, 1)).toBe(5);
    expect(driveOffFloor(v, 2)).toBe(3);
  });

  test("gold buys a resource while there is gold and a purchase left", () => {
    expect(canBuyWithGold(viewWith(READY), 0)).toBe(true);
    expect(canBuyWithGold(viewWith(READY), 1)).toBe(false); // no gold
    expect(canBuyWithGold(viewWith({ ...READY, bought: 2 }), 0)).toBe(false);
  });

  test("the grain purchase is once per turn", () => {
    expect(canBoost(viewWith(READY), 0)).toBe(true);
    expect(canBoost(viewWith({ ...READY, boosted: true }), 0)).toBe(false);
    // And only for the seat whose phase it is.
    expect(canBoost(viewWith(READY), 1)).toBe(false);
  });

  // The viewer's own playable count; a card bought this turn is locked, like
  // a base development card.
  test("swift journeys count the playable ones", () => {
    expect(swiftHeld(viewWith({ ...READY, swift: 2, swift_new: 1 }))).toBe(2);
    expect(swiftHeld(viewWith(READY))).toBe(0);
  });
});

describe("a barbarian is named by where it stands", () => {
  // The pieces are identical and unnumbered on the board, so they are named
  // by the hexes their path runs between.
  const tiles = [
    { hex: { q: 0, r: 0 }, res: "wheat", num: 6 },
    { hex: { q: 0, r: -1 }, res: "ore", num: 8 },
    { hex: { q: 1, r: -1 }, res: "sea" },
  ];
  const view = (ext: Partial<WagonsExt>, raiders?: object) =>
    ({
      board: { tiles },
      ext: { wagons: ext, ...(raiders ? { raiders } : {}) },
    }) as unknown as FullView;
  // The north corner of (0,0) and the south corner of (0,-1) bound the path
  // between the wheat 6 and the ore 8.
  const between = { a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: -1, side: 1 } };

  test("between two land hexes", async () => {
    const { barbarianPlace } = await import("./wagons");
    expect(barbarianPlace(view({}), between)).toBe("between wheat 6 and ore 8");
  });

  test("ids are the wire's, alone and in the shared raider population", async () => {
    const { movableBarbarians } = await import("./wagons");
    const e = between;
    expect(movableBarbarians(view({ barbarians: [e, e, e] })).map((b) => b.id)).toEqual([0, 1, 2]);
    const shared = view(
      { barbarians: [] },
      {
        shared_paths: true,
        path_figures: [
          { alive: false, on_path: true, edge: e },
          { alive: true, on_path: true, edge: e },
          { alive: true, on_path: false, edge: e },
          { alive: true, on_path: true, edge: e },
        ],
      },
    );
    expect(movableBarbarians(shared).map((b) => b.id)).toEqual([1, 3]);
  });
});
