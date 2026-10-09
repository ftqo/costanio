import { test, expect } from "vitest";
import {
  DICE_TOTALS,
  chanceOf,
  expectedCount,
  raceSamples,
  scoreTicks,
  turnTicks,
  vpSeries,
  waysToRoll,
} from "./stats";

test("the eleven totals two dice can make, in order", () => {
  expect([...DICE_TOTALS]).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("waysToRoll: the 36 outcomes are fully accounted for", () => {
  expect(DICE_TOTALS.map(waysToRoll)).toEqual([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);
  expect(DICE_TOTALS.reduce((a, n) => a + waysToRoll(n), 0)).toBe(36);
  // Nothing outside the range claims a share of the probability.
  expect(waysToRoll(1)).toBe(0);
  expect(waysToRoll(13)).toBe(0);
});

test("the chances sum to one, and expectation follows the roll count", () => {
  expect(DICE_TOTALS.reduce((a, n) => a + chanceOf(n), 0)).toBeCloseTo(1, 12);
  expect(expectedCount(7, 36)).toBeCloseTo(6, 12);
  expect(expectedCount(2, 72)).toBeCloseTo(2, 12);
});

// The band must bracket the expected count and be wide enough that ordinary
// scatter falls inside it.
test("vpSeries reads one seat's column, and a short row reads as zero", () => {
  const track = [
    [0, 0, 0],
    [2, 1, 0],
    [3, 1],
  ];
  expect(vpSeries(track, 0)).toEqual([0, 2, 3]);
  expect(vpSeries(track, 1)).toEqual([0, 1, 1]);
  expect(vpSeries(track, 2)).toEqual([0, 0, 0]);
});

test("raceSamples: the start of every round, and always the final row", () => {
  expect(raceSamples(10, 4)).toEqual([0, 4, 8, 9]);
  // The last row already falls on a round boundary: not repeated.
  expect(raceSamples(9, 4)).toEqual([0, 4, 8]);
  expect(raceSamples(3, 1)).toEqual([0, 1, 2]);
  expect(raceSamples(1, 4)).toEqual([0]);
  expect(raceSamples(0, 4)).toEqual([]);
  // A bad seat count never loops forever or skips the end.
  expect(raceSamples(3, 0)).toEqual([0, 1, 2]);
});

test("scoreTicks: whole numbers up to the target, the target always shown", () => {
  expect(scoreTicks(10)).toEqual([0, 2, 4, 6, 8, 10]);
  // 12 would sit on top of 13, so it gives way.
  expect(scoreTicks(13)).toEqual([0, 3, 6, 9, 13]);
  expect(scoreTicks(17)).toEqual([0, 4, 8, 12, 17]);
  expect(scoreTicks(1)).toEqual([0, 1]);
});

test("turnTicks: about six sampled turns, first and last, never crowded", () => {
  expect(turnTicks([1, 5, 9])).toEqual([1, 5, 9]);
  // Rounds of four over 19 turns: 17 would touch 19, so it gives way.
  expect(turnTicks([1, 5, 9, 13, 17, 19])).toEqual([1, 5, 9, 13, 19]);
  // A last turn a full round on keeps every tick.
  expect(turnTicks([1, 5, 9, 13, 17, 21])).toEqual([1, 5, 9, 13, 17, 21]);
  const long = Array.from({ length: 16 }, (_, i) => 1 + i * 4).concat(63);
  const ticks = turnTicks(long);
  expect(ticks[0]).toBe(1);
  expect(ticks[ticks.length - 1]).toBe(63);
  expect(ticks.length).toBeLessThanOrEqual(7);
});
