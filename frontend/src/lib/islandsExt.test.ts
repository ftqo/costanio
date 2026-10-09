import { describe, expect, test } from "vitest";
import { ISLANDS_MAX_SHIPS, islandsExt, type FullView } from "./types";

// `ext.islands` does not exist until the module folds its first event (after
// the first opening placement), and Islands controls (setup Road/Ship choice,
// Ship tile, ship supply) must still appear before that.
const view = (ruleset: string, ext?: Record<string, unknown>) =>
  ({ config: { ruleset }, players: [{}, {}, {}], ext }) as unknown as FullView;

describe("islandsExt", () => {
  test("an Islands game with no module state yet reads as the fresh state", () => {
    const x = islandsExt(view("base+islands"));
    expect(x).toBeDefined();
    expect(x!.ships).toEqual([]);
    expect(x!.ships_left).toEqual([ISLANDS_MAX_SHIPS, ISLANDS_MAX_SHIPS, ISLANDS_MAX_SHIPS]);
    expect(x!.pirate).toBeUndefined();
  });

  test("the fallback is one object per view", () => {
    const v = view("base+cak+islands");
    expect(islandsExt(v)).toBe(islandsExt(v));
  });

  test("published state wins", () => {
    const published = { ships: [], ships_left: [3, 4, 5], moved_ship: true };
    expect(islandsExt(view("base+islands", { islands: published }))).toBe(published);
  });

  test("no Islands in the ruleset is still no Islands state", () => {
    expect(islandsExt(view("base+cak"))).toBeUndefined();
    expect(islandsExt(view("explorers"))).toBeUndefined();
  });
});
