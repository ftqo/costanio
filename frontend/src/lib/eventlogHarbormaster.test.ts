import { test, expect, describe } from "vitest";
import { describeEvent, logMessageText, type LogMessage } from "./eventlog";
import type { GameEvent } from "./gamestate";

/**
 * The Harbormaster's one event. The engine emits `harbormaster_standings`
 * whenever the holder or any seat's harbour points change, so it fires on
 * ordinary builds and the log must stay silent for most of them. Three
 * sentences (taken from nobody, taken from someone, lost by everyone) and one
 * silence.
 */

const P = (s: number) => `P${s}`;
const ev = (type: string, data: unknown): GameEvent => ({ seq: 0, type, data });
const text = (lines: LogMessage[]): string[] => lines.map((l) => logMessageText(l));
const say = (data: unknown) => text(describeEvent(ev("harbormaster_standings", data), P, false));

describe("the title moving is the only thing the log says", () => {
  test("says nothing when a build moves the points but not the card", () => {
    // The common case: a harbour settlement restates the standings with the
    // same holder. No line, or every coastal settlement would get one.
    expect(say({ holder: -1, prev: -1, points: [1, 0, 0, 0] })).toEqual([]);
    expect(say({ holder: 2, prev: 2, points: [1, 0, 4, 0] })).toEqual([]);
  });

  test("names the taker when the card was unheld", () => {
    expect(say({ holder: 1, prev: -1, points: [0, 3, 0, 0] })).toEqual([
      "P1 took the Harbormaster",
    ]);
  });

  test("names both when it changes hands", () => {
    expect(say({ holder: 0, prev: 3, points: [4, 0, 0, 3] })).toEqual([
      "P0 took the Harbormaster from P3",
    ]);
  });

  test("says it is open when nobody is left holding it", () => {
    // Either the holder's total falls under the threshold (a barbarian razing a
    // harbour city), or a loss leaves two others tied at the top.
    expect(say({ holder: -1, prev: 2, points: [1, 1, 2, 0] })).toEqual([
      "Harbormaster is up for grabs",
    ]);
  });
});

describe("the sentinel is a sentinel, not a seat", () => {
  test("never names seat -1 as the taker or the loser", () => {
    // NoPlayer is -1 on the wire. Through `name()` it would print "P-1", which
    // is truthy and would pick the wrong sentence.
    for (const line of [
      ...say({ holder: -1, prev: 0, points: [] }),
      ...say({ holder: 1, prev: -1, points: [] }),
    ]) {
      expect(line).not.toContain("-1");
    }
  });

  test("treats a payload with no prev as taken from nobody", () => {
    // Defensive: StandingsData always carries Prev, but if absent "took it" is
    // the safe reading.
    expect(say({ holder: 1, points: [0, 3] })).toEqual(["P1 took the Harbormaster"]);
  });

  test("says nothing at all for a payload with neither seat", () => {
    // Both absent read as -1 and -1: no change, so silence.
    expect(say({ points: [0, 0] })).toEqual([]);
    expect(say({})).toEqual([]);
  });
});

describe("the wording is the house style", () => {
  test("carries no em dash and no wire vocabulary", () => {
    const all = [
      ...say({ holder: 1, prev: -1, points: [] }),
      ...say({ holder: 0, prev: 3, points: [] }),
      ...say({ holder: -1, prev: 2, points: [] }),
    ];
    expect(all).toHaveLength(3);
    for (const line of all) {
      expect(line).not.toContain("\u2014");
      expect(line.toLowerCase()).not.toContain("harbormaster_standings");
      expect(line).toContain("Harbormaster");
    }
  });
});
