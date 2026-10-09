import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gameCaps, rulesetCaps } from "./caps";

const view = (ruleset: string) => ({ config: { ruleset }, ext: {} }) as any;

describe("gameCaps", () => {
  it("base has dev cards & largest army, no expansion features", () => {
    const c = gameCaps(view("base"));
    expect(c.hasDevCards).toBe(true);
    expect(c.hasLargestArmy).toBe(true);
    expect(c.hasKnightPieces).toBe(false);
  });
  it("Knights removes dev cards & largest army, adds knights features", () => {
    const c = gameCaps(view("base+cak"));
    expect(c.hasDevCards).toBe(false);
    expect(c.hasLargestArmy).toBe(false);
    expect(c.hasKnightPieces).toBe(true);
    expect(c.hasCommodities).toBe(true);
    expect(c.hasWalls).toBe(true);
  });
  // The route's name (road vs trade route) is chosen from hasShips and tested
  // in vp.test.ts.
  it("islands keeps dev cards and adds island VP", () => {
    const c = gameCaps(view("base+islands"));
    expect(c.hasDevCards).toBe(true);
    expect(c.hasShips).toBe(true);
    expect(c.hasIslandVP).toBe(true);
  });
  // A ruleset question: the module publishes its ext from the first frame, but
  // reading the ext would leave the UI one server change from popping in
  // mid-game (as `hasKnights` and `hasFish` avoid). `ext: {}` must not read as "no
  // Harbormaster".
  it("harbormaster is read off the ruleset, not off the module's state", () => {
    expect(gameCaps(view("base+harbormaster")).hasHarbormaster).toBe(true);
    expect(gameCaps(view("base")).hasHarbormaster).toBe(false);
    // No other cap moves, in either direction.
    const alone = gameCaps(view("base"));
    const withIt = gameCaps(view("base+harbormaster"));
    for (const k of Object.keys(alone) as (keyof typeof alone)[]) {
      if (k === "hasHarbormaster") continue;
      expect(withIt[k], k).toBe(alone[k]);
    }
  });
  // The engine drops the Knights barbarians in a Raiders game (`barbariansSail`,
  // engine/knights/hooks.go), so there is no barbarian track or Defender of the
  // Realm column.
  it("Knights with Raiders has no barbarian fleet, and keeps everything else Knights", () => {
    const c = gameCaps(view("base+cak+raiders"));
    expect(c.hasBarbarians).toBe(false);
    expect(c.hasKnightPieces).toBe(true);
    expect(c.hasMetropolis).toBe(true);
    expect(c.hasWalls).toBe(true);
    // The event die still rolls and deals progress cards; only the barbarian
    // consequence is dropped.
    expect(c.hasEventDie).toBe(true);
    // And Knights alone is unaffected.
    expect(gameCaps(view("base+cak")).hasBarbarians).toBe(true);
  });
  it("combined Knights and Islands: no dev cards, has both feature sets", () => {
    const c = gameCaps(view("base+cak+islands"));
    expect(c.hasDevCards).toBe(false);
    expect(c.hasLargestArmy).toBe(false);
    expect(c.hasKnightPieces).toBe(true);
    expect(c.hasShips).toBe(true);
  });
  it("explorers: no base deck, no Largest Army, no route title, no robber", () => {
    for (const rs of ["explorers", "cak+explorers"]) {
      const c = gameCaps(view(rs));
      expect(c.hasDevCards, rs).toBe(false);
      expect(c.hasLargestArmy, rs).toBe(false);
      expect(c.hasLongestRoad, rs).toBe(false);
      expect(c.hasRobber, rs).toBe(false);
    }
  });
  it("wagons keeps its deck and Largest Army but has no robber", () => {
    const c = gameCaps(view("base+wagons"));
    expect(c.hasDevCards).toBe(true);
    expect(c.hasLargestArmy).toBe(true);
    expect(c.hasRobber).toBe(false);
  });
});

// The lobby hides the friendly-robber switch where the engine says a ruleset
// has no robber (engine.RulesetHasRobber). Go's TestEveryRulesetsRobberAnswer
// holds this fixture to the engine, so the client's `hasRobber` is checked
// against it.

describe("hasRobber matches the engine", () => {
  const rows = readFileSync("../engine/ruletest/testdata/robber.txt", "utf8")
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  it("covers every valid ruleset", () => {
    expect(rows.length).toBeGreaterThan(100);
  });
  for (const [ruleset, has] of rows) {
    it(ruleset, () => {
      expect(rulesetCaps(ruleset).hasRobber).toBe(has === "1");
    });
  }
});
