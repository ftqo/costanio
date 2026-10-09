import { describe, expect, test } from "vitest";
import { collapseSteps } from "./logCollapse";
import { describeEvent, logMessageText } from "./eventlog";
import type { GameEvent } from "./gamestate";

const P = (s: number) => `P${s}`;
let seq = 0;
const ev = (type: string, data: unknown): GameEvent => ({ seq: ++seq, type, data });
const e = (a: number, b: number) => ({
  a: { q: a, r: 0, side: 0 },
  b: { q: a, r: 0, side: 1 },
  n: b,
});
/** The feed's own words for a list of events, in order, one entry per line. */
const read = (events: readonly GameEvent[]) =>
  events.flatMap((x) => describeEvent(x, P, false).map((l) => logMessageText(l)));

const ship = (player: number, ship_id: number, from: unknown, to: unknown, extra = {}) =>
  ev("explorers_ship_moved", { player, ship_id, from, to, path: [to], steps: 1, ...extra });

describe("an Explorers voyage is one line, however many taps it took", () => {
  test("three one-edge moves of one ship read as one move", () => {
    // A phone sails a ship one edge per tap (boardTap sends a one-edge path),
    // each its own `explorers_ship_moved`.
    const log = [
      ship(0, 7, e(0, 0), e(1, 0)),
      ship(0, 7, e(1, 0), e(2, 0)),
      ship(0, 7, e(2, 0), e(3, 0)),
    ];
    expect(read(log)).toEqual(["P0 moved a ship", "P0 moved a ship", "P0 moved a ship"]);
    const got = collapseSteps(log);
    expect(read(got)).toEqual(["P0 moved a ship"]);
    const d = got[0].data as { from: unknown; to: unknown; steps: number };
    expect(d.from).toEqual(e(0, 0));
    expect(d.to).toEqual(e(3, 0));
    expect(d.steps).toBe(3);
    // Keyed on the voyage's first step, so the live row does not remount as
    // each further step lands.
    expect(got[0].seq).toBe(log[0].seq);
  });

  test("tribute paid on any step is still said, once, and summed", () => {
    const log = [
      ship(0, 7, e(0, 0), e(1, 0)),
      ship(0, 7, e(1, 0), e(2, 0), { tribute: 1 }),
      ship(0, 7, e(2, 0), e(3, 0)),
    ];
    expect(read(collapseSteps(log))).toEqual(["P0 moved a ship and paid 1 gold in tribute"]);
  });

  test("a different ship, a different player, or a jump is a new line", () => {
    const log = [
      ship(0, 7, e(0, 0), e(1, 0)),
      ship(0, 8, e(5, 0), e(6, 0)),
      ship(1, 9, e(6, 0), e(7, 0)),
      ship(1, 9, e(9, 0), e(10, 0)),
    ];
    expect(collapseSteps(log)).toHaveLength(4);
  });

  test("a line of its own between two steps ends the voyage", () => {
    const log = [
      ship(0, 7, e(0, 0), e(1, 0)),
      ev("explorers_ship_sped", { player: 0, ship_id: 7 }),
      ship(0, 7, e(1, 0), e(2, 0)),
    ];
    expect(collapseSteps(log)).toHaveLength(3);
  });

  test("a silent event between two steps does not", () => {
    const log = [
      ship(0, 7, e(0, 0), e(1, 0)),
      ev("explorers_movement_began", { player: 0 }),
      ship(0, 7, e(1, 0), e(2, 0)),
    ];
    expect(read(collapseSteps(log))).toEqual(["P0 moved a ship"]);
  });

  test("a turn boundary always ends it", () => {
    const log = [
      ship(0, 7, e(0, 0), e(1, 0)),
      ev("turn_started", { player: 0 }),
      ship(0, 7, e(1, 0), e(2, 0)),
    ];
    expect(collapseSteps(log)).toHaveLength(3);
  });

  test("a log with nothing to collapse comes back as the same array", () => {
    const log = [ev("dice_rolled", { player: 0, d1: 3, d2: 4 }), ship(0, 7, e(0, 0), e(1, 0))];
    expect(collapseSteps(log)).toBe(log);
  });

  test("a rebuild hands back the same merged object, so the row memo holds", () => {
    const log = [ship(0, 7, e(0, 0), e(1, 0)), ship(0, 7, e(1, 0), e(2, 0))];
    expect(collapseSteps(log)[0]).toBe(collapseSteps([...log])[0]);
  });
});

const v = (q: number) => ({ q, r: 0, side: 0 });
const wagon = (player: number, from: number, to: number, toll = 0, paid = -1) =>
  ev("wagons_moved", { player, from: v(from), to: v(to), mp: 1, ...(toll ? { toll, paid } : {}) });

describe("a wagon's tolls on one drive are one line", () => {
  test("a toll per path, to the same owner, sums", () => {
    const log = [wagon(0, 0, 1, 1, 2), wagon(0, 1, 2), wagon(0, 2, 3, 1, 2), wagon(0, 3, 4, 1, 2)];
    expect(read(log)).toHaveLength(3);
    expect(read(collapseSteps(log))).toEqual(["P0 paid P2 3 gold in tolls"]);
  });

  test("tolls to two owners stay two lines", () => {
    const log = [wagon(0, 0, 1, 1, 2), wagon(0, 1, 2, 1, 3)];
    expect(read(collapseSteps(log))).toEqual([
      "P0 paid P2 1 gold in tolls",
      "P0 paid P3 1 gold in tolls",
    ]);
  });
});
