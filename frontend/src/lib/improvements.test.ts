import { describe, it, expect } from "vitest";
import { improvedLevel, improvementReward, nextImprovementReward } from "./improvements";

describe("improvement reward copy", () => {
  it("describes the level a player already has, and the next one", () => {
    // Trade(0) level 3 is the Merchant Guild; the next (4) is the metropolis.
    expect(improvementReward(0, 3)).toMatch(/Merchant Guild/);
    expect(nextImprovementReward(0, 3)).toMatch(/Metropolis/);
    // Politics(1) L3 fortress, Science(2) L3 aqueduct.
    expect(improvementReward(1, 3)).toMatch(/Fortress/);
    expect(improvementReward(2, 3)).toMatch(/Aqueduct/);
  });

  it("has no reward below level 1 and none past the cap", () => {
    expect(improvementReward(0, 0)).toBeNull();
    expect(improvementReward(0, 6)).toBeNull();
    expect(nextImprovementReward(0, 5)).toBeNull(); // already maxed
  });
});

describe("improvedLevel", () => {
  const imp = (seq: number, player: number, track: number) => ({
    seq,
    type: "cak_improved",
    data: { player, track },
  });

  it("counts the buyer's own buys on that track, up to the event asked about", () => {
    const log = [
      imp(1, 0, 0),
      { seq: 2, type: "dice_rolled", data: { d1: 3, d2: 4 } },
      imp(3, 1, 0), // another seat, same track
      imp(4, 0, 2), // same seat, another track
      imp(5, 0, 0),
      imp(6, 0, 0),
    ];
    expect(improvedLevel(log, 1, 0, 0)).toBe(1);
    expect(improvedLevel(log, 5, 0, 0)).toBe(2);
    expect(improvedLevel(log, 6, 0, 0)).toBe(3);
    // Neither the neighbour's climb nor the other track's counts toward it.
    expect(improvedLevel(log, 3, 1, 0)).toBe(1);
    expect(improvedLevel(log, 4, 0, 2)).toBe(1);
    // Later buys on the same track do not raise an earlier one's level: this is
    // what reading the level off current state would get wrong.
    expect(improvedLevel(log.slice(0, 1), 1, 0, 0)).toBe(1);
  });

  it("falls back to the bottom rung when the payload is unreadable", () => {
    expect(improvedLevel([], 1, undefined, 0)).toBe(1);
    expect(improvedLevel([], 1, 0, undefined)).toBe(1);
    // A log that never saw the event still answers with something playable.
    expect(improvedLevel([], 1, 0, 0)).toBe(1);
  });
});
