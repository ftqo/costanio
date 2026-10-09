import { test, expect } from "vitest";
import {
  isProvisional,
  highestRating,
  highestRankedRating,
  isRanked,
  PROVISIONAL_GAMES,
} from "./rating";

test("provisional below the games threshold", () => {
  expect(isProvisional(0)).toBe(true);
  expect(isProvisional(PROVISIONAL_GAMES - 1)).toBe(true);
  expect(isProvisional(PROVISIONAL_GAMES)).toBe(false);
  expect(isProvisional(50)).toBe(false);
});

test("highestRating picks the best ELO, or null", () => {
  expect(highestRating(null)).toBeNull();
  expect(highestRating([])).toBeNull();
  const stats = [
    { ruleset: "base", games: 20, wins: 10, elo: 1100 },
    { ruleset: "base+islands", games: 5, wins: 3, elo: 1240 },
  ];
  expect(highestRating(stats)?.ruleset).toBe("base+islands");
  expect(highestRating(stats)?.elo).toBe(1240);
});

test("isRanked only matches the ranked queues", () => {
  expect(isRanked("base")).toBe(true);
  expect(isRanked("base+cak")).toBe(true);
  expect(isRanked("base+islands")).toBe(false);
  expect(isRanked("base+islands+cak")).toBe(false);
  expect(isRanked("base+fishermen")).toBe(false);
});

test("highestRankedRating ignores non-ranked rulesets", () => {
  expect(highestRankedRating(null)).toBeNull();
  expect(highestRankedRating([])).toBeNull();
  // Non-ranked rulesets carry a placeholder 1000; they must never be surfaced.
  const onlyCasual = [{ ruleset: "base+islands+cak", games: 6, wins: 2, elo: 1000 }];
  expect(highestRankedRating(onlyCasual)).toBeNull();
  const mixed = [
    { ruleset: "base", games: 20, wins: 10, elo: 1100 },
    { ruleset: "base+islands", games: 5, wins: 3, elo: 1240 }, // higher ELO, but not ranked
    { ruleset: "base+cak", games: 12, wins: 7, elo: 1080 },
  ];
  expect(highestRankedRating(mixed)?.ruleset).toBe("base");
  expect(highestRankedRating(mixed)?.elo).toBe(1100);
});
