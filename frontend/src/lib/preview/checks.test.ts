import { describe, it, expect } from "vitest";
import { runChecks, failingHexes, reportJSON, bagCap, type CheckResult } from "./checks";
import type { FullView, Hex, PreviewEnvelope } from "@/lib/types";
import fixture from "@/lib/__fixtures__/previewBoard.json";

/**
 * The preview's shape checks, over a real generated board.
 *
 * `previewBoard.json` is a genuine `/api/preview` response for
 * `base+caravans+fishermen+raiders+rivers+wagons` at seed 42, ext blobs
 * included, so the checks run against shapes the engine actually sends.
 *
 * Each test asserts the real board passes, then breaks one thing and asserts
 * the same check fails and points at the right hexes.
 */

const envelope = fixture as unknown as PreviewEnvelope;

/** The synthetic view `lib/preview/view.ts` builds, duplicated by shape rather
 *  than imported, so a change has to be made in both. */
function viewOf(e: PreviewEnvelope): FullView {
  return {
    seq: 0,
    viewer: 0,
    phase: "play",
    cur: 0,
    legal: {},
    players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [0, 0, 0, 0, 0, 0] })),
    config: e.config,
    board: e.board,
    buildings: [],
    roads: [],
    ext: e.ext,
  } as unknown as FullView;
}

/** A deep copy, so one test's sabotage cannot reach the next one's fixture. */
function clone(): PreviewEnvelope {
  return JSON.parse(JSON.stringify(envelope)) as PreviewEnvelope;
}

function byId(results: CheckResult[], id: string): CheckResult {
  const found = results.find((r) => r.id === id);
  if (!found) throw new Error(`no check ${id} in [${results.map((r) => r.id).join(", ")}]`);
  return found;
}

function keys(hexes: Hex[]): string[] {
  return hexes.map((h) => `${h.q},${h.r}`).sort();
}

describe("the preview shape checks", () => {
  it("passes every check on a board the engine really dealt", () => {
    const results = runChecks(viewOf(envelope));
    const failed = results.filter((r) => r.status === "fail");
    expect(
      failed.map((r) => `${r.id}: ${r.detail}`),
      "a real generated board must not trip its own shape checks",
    ).toEqual([]);
    expect(failingHexes(results)).toEqual([]);
  });

  it("runs one check per enabled module", () => {
    const all = runChecks(viewOf(envelope)).map((r) => r.id);
    // The base four always run; the module rows follow the fixture's ruleset.
    expect(all).toEqual([
      "chips-on-producing",
      "reds-apart",
      "number-spread",
      "harbours",
      "river-tiles",
      "river-chains",
      "rivers-apart",
      "bridge-sites",
      "castle",
      "trade-hexes",
      "oasis",
      "lake-grounds",
    ]);

    // Declared as plain base, the module rows disappear rather than pass.
    const base = clone();
    base.config.ruleset = "base";
    expect(runChecks(viewOf(base)).map((r) => r.id)).toEqual([
      "chips-on-producing",
      "reds-apart",
      "number-spread",
      "harbours",
    ]);
  });

  it("catches a chip left on a tile that pays nothing", () => {
    // Rivers repaints a hex to swamp and Fishermen floods the desert to a lake,
    // both after the numbers are dealt.
    const bad = clone();
    const swamp = bad.board.tiles.find((t) => t.res === "swamp")!;
    swamp.num = 8;
    const check = byId(runChecks(viewOf(bad)), "chips-on-producing");
    expect(check.status).toBe("fail");
    expect(keys(check.hexes)).toEqual([`${swamp.hex.q},${swamp.hex.r}`]);
  });

  it("catches two reds touching, and points at both hexes", () => {
    const bad = clone();
    const six = bad.board.tiles.find((t) => t.num === 6)!;
    const neighbour = bad.board.tiles.find(
      (t) =>
        t.num > 0 &&
        t.num !== 6 &&
        t.num !== 8 &&
        [
          [1, 0],
          [0, 1],
          [-1, 1],
          [-1, 0],
          [0, -1],
          [1, -1],
        ].some(([dq, dr]) => t.hex.q === six.hex.q + dq && t.hex.r === six.hex.r + dr),
    )!;
    neighbour.num = 8;
    const check = byId(runChecks(viewOf(bad)), "reds-apart");
    expect(check.status).toBe("fail");
    expect(keys(check.hexes)).toEqual(keys([six.hex, neighbour.hex]));
  });

  it("catches a number dealt more often than the bag holds it", () => {
    const bad = clone();
    // A third 5 and a second 12. On this standard-sized board the bag is the
    // base game's: two each of 3..11, one each of 2 and 12. (A bigger board's
    // bag scales; see bagCap.)
    const spare = bad.board.tiles.filter((t) => t.num > 0 && t.num !== 5 && t.num !== 12);
    spare[0].num = 5;
    spare[1].num = 5;
    spare[2].num = 5;
    spare[3].num = 12;
    spare[4].num = 12;
    const check = byId(runChecks(viewOf(bad)), "number-spread");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("5 appears");
    expect(check.detail).toContain("12 appears");
  });

  it("reads the number spread as information on a board that is fine", () => {
    // Info, not pass or fail: the total varies (18 plain, 17 once Rivers paints
    // a swamp over a numbered hex), but the counts are worth seeing.
    const check = byId(runChecks(viewOf(envelope)), "number-spread");
    expect(check.status).toBe("info");
    expect(check.detail).toMatch(/^2x1 /);
  });

  it("catches two harbours sharing one sea hex", () => {
    const bad = clone();
    bad.board.harbors[1] = { ...bad.board.harbors[0], ratio: 3 };
    const check = byId(runChecks(viewOf(bad)), "harbours");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("two harbours on the sea hex");
    expect(check.hexes.length).toBeGreaterThan(0);
  });

  it("catches a river hex with no channel", () => {
    // `planRiverTiles` skips an unknown shape, and the hex draws plain terrain
    // with its number still on it.
    const bad = clone();
    const rivers = (bad.ext.rivers as { rivers: { hexes: Hex[]; shapes: string[] }[] }).rivers;
    rivers[0].shapes[1] = "not_a_shape";
    const check = byId(runChecks(viewOf(bad)), "river-tiles");
    expect(check.status).toBe("fail");
    expect(keys(check.hexes)).toEqual([`${rivers[0].hexes[1].q},${rivers[0].hexes[1].r}`]);
  });

  it("catches a chain whose mouth is not its last hex", () => {
    const bad = clone();
    const rivers = (bad.ext.rivers as { rivers: { mouth: number }[] }).rivers;
    rivers[0].mouth = 0;
    const check = byId(runChecks(viewOf(bad)), "river-chains");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("mouth is at index 0");
  });

  it("catches two different rivers running alongside each other", () => {
    // A river touching itself is fine, so the sabotage is a second chain laid
    // next to the first.
    const bad = clone();
    const ext = bad.ext.rivers as {
      rivers: { hexes: Hex[]; mouth: number; shapes: string[]; variants: number[] }[];
    };
    const first = ext.rivers[0];
    const beside = { q: first.hexes[0].q + 1, r: first.hexes[0].r };
    ext.rivers.push({
      hexes: [beside, { q: beside.q + 1, r: beside.r }],
      mouth: 1,
      shapes: ["e_w", "e_w"],
      variants: [0, 0],
    });
    const check = byId(runChecks(viewOf(bad)), "rivers-apart");
    expect(check.status).toBe("fail");
    expect(check.hexes.length).toBeGreaterThan(0);
  });

  it("catches a bridge site with no river on either side", () => {
    const bad = clone();
    const ext = bad.ext.rivers as { sites: { a: unknown; b: unknown }[] };
    ext.sites.push({
      a: { q: 9, r: 9, side: 0 },
      b: { q: 9, r: 10, side: 1 },
    });
    const check = byId(runChecks(viewOf(bad)), "bridge-sites");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("no river hex on either side");
  });

  it("catches a castle that is not a tile on the board", () => {
    const bad = clone();
    (bad.ext.raiders as { castle: Hex }).castle = { q: 9, r: 9 };
    const check = byId(runChecks(viewOf(bad)), "castle");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("not a tile on this board");
    expect(keys(check.hexes)).toEqual(["9,9"]);
  });

  it("catches anything other than three trade hexes", () => {
    const bad = clone();
    const ext = bad.ext.wagons as { trade: unknown[] };
    ext.trade = ext.trade.slice(0, 2);
    const check = byId(runChecks(viewOf(bad)), "trade-hexes");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("2 trade hexes, not 3");
  });

  it("catches an oasis on a terrain the renderer will not draw it on", () => {
    // The layer only draws the oasis over a desert or lake; elsewhere it would
    // silently show plain terrain.
    const bad = clone();
    const oasis = (bad.ext.caravans as { oasis: Hex }).oasis;
    bad.board.tiles.find((t) => t.hex.q === oasis.q && t.hex.r === oasis.r)!.res = "wheat";
    const check = byId(runChecks(viewOf(bad)), "oasis");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("wheat");
  });

  it("catches a fishing ground notched into land", () => {
    const bad = clone();
    const grounds = (bad.ext.fishermen as { grounds: { hex: Hex }[] }).grounds;
    const land = bad.board.tiles.find((t) => t.res === "wheat")!;
    grounds[0].hex = land.hex;
    const check = byId(runChecks(viewOf(bad)), "lake-grounds");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("not water");
  });
});

describe("the report", () => {
  it("carries the ruleset, the seed and only the failures", () => {
    const bad = clone();
    (bad.ext.raiders as { castle: Hex }).castle = { q: 9, r: 9 };
    const results = runChecks(viewOf(bad));
    const report = JSON.parse(reportJSON(bad.ruleset, bad.seed, results)) as {
      ruleset: string;
      seed: string;
      failures: { id: string }[];
    };
    expect(report.ruleset).toBe(bad.ruleset);
    // A string: the seed is a uint64, and a rounded one names a different board.
    expect(report.seed).toBe("42");
    expect(report.failures.map((f) => f.id)).toEqual(["castle"]);
  });

  it("names no failures on a good board", () => {
    const report = JSON.parse(
      reportJSON(envelope.ruleset, envelope.seed, runChecks(viewOf(envelope))),
    ) as { failures: unknown[] };
    expect(report.failures).toEqual([]);
  });
});

/**
 * The bag scales with the board. `numberTokens` (engine/board/generate.go)
 * deals `n * share / 18` per value with leftovers by largest remainder, so each
 * value gets the floor of its share or one more, and only when there is a
 * leftover.
 */
describe("the number bag's per-value cap", () => {
  it("is exactly the base bag on an 18-token board", () => {
    // Eighteen divides evenly, so nothing may exceed its share.
    expect(bagCap(2, 18)).toBe(1);
    expect(bagCap(12, 18)).toBe(1);
    for (const n of [3, 4, 5, 6, 8, 9, 10, 11]) expect(bagCap(n, 18)).toBe(2);
  });

  it("stays the base bag when a swamp has taken a numbered hex out", () => {
    for (const n of [3, 6, 11]) expect(bagCap(n, 17)).toBe(2);
    expect(bagCap(2, 17)).toBe(1);
  });

  it("widens on Shores (Small)", () => {
    // generate.go names this board: 27 tokens, so three 3s is correct.
    for (const n of [3, 4, 5, 6, 8, 9, 10, 11]) expect(bagCap(n, 27)).toBeGreaterThanOrEqual(3);
    expect(bagCap(2, 27)).toBeGreaterThanOrEqual(2);
  });

  it("never allows a 7, at any size", () => {
    for (const n of [18, 27, 35, 60]) expect(bagCap(7, n)).toBe(0);
  });

  it("grows monotonically with the board", () => {
    for (let n = 1; n <= 60; n++) {
      for (const num of [2, 3, 6, 11, 12]) {
        const share = num === 2 || num === 12 ? 1 : 2;
        expect(bagCap(num, n)).toBeLessThanOrEqual(Math.floor((n * share) / 18) + 1);
        if (n > 1) expect(bagCap(num, n)).toBeGreaterThanOrEqual(bagCap(num, n - 1));
      }
    }
  });
});
