import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import {
  recommendedBarbarianDistance,
  recommendedDiscardLimit,
  recommendedMap,
  mapPlayers,
  recommendedPlayers,
  mapSupportsIslands,
  recommendedVP,
  retargetVP,
  maxVP,
  boardWithoutIslandsTerrain,
  mapNeedsShips,
  MIN_PLAYERS,
  MAX_PLAYERS,
  PLAYER_COUNTS,
  BETA_EXPANSIONS,
  EXPANSION_GROUP,
  EXPANSION_MODULE,
  STANDALONE_EXPANSIONS,
  groupedExpansions,
  defaultConfig,
  VISIBLE_EXPANSIONS,
  FILTER_MODULES,
  assembleRuleset,
  parseExpansions,
  offeredRulesetLabel,
  type Expansions,
  boardSeats,
  playersChange,
  harbormasterMapWarning,
  HARBORMASTER_MIN_HARBOURS,
} from "./format";
import { GALLERY } from "./maps/gallery";

const mapById = (id: string) => GALLERY.find((m) => m.id === id)!;

// Mirrors engine/harbormaster MapIssues: an authored map with 1 harbour can
// never award the card; none is fine (the engine deals a full set), and so is 2.
describe("harbormasterMapWarning", () => {
  const withHarbours = (n: number) => {
    const board = GALLERY[0].board;
    const hb = { verts: [], ratio: 3, res: "" } as unknown as (typeof board.harbors)[number];
    return { ...board, harbors: Array.from({ length: n }, () => hb) };
  };
  it("blocks Harbormaster on a map with fewer harbours than the card needs", () => {
    const w = harbormasterMapWarning({
      ...defaultConfig(),
      ruleset: "base+harbormaster",
      board: withHarbours(1),
    });
    expect(w?.severity).toBe("block");
    expect(w?.text).toContain("at least 2 harbours");
  });
  it("says nothing for none, enough, or without the module", () => {
    expect(HARBORMASTER_MIN_HARBOURS).toBe(2);
    for (const [ruleset, n] of [
      ["base+harbormaster", 0],
      ["base+harbormaster", 2],
      ["base", 1],
    ] as const) {
      expect(
        harbormasterMapWarning({ ...defaultConfig(), ruleset, board: withHarbours(n) }),
      ).toBeNull();
    }
  });
});

describe("mapNeedsShips", () => {
  it("is false for a procedural board and for one solid landmass", () => {
    expect(mapNeedsShips(undefined)).toBe(false);
    expect(mapNeedsShips(mapById("small").board)).toBe(false);
  });

  it("is true for an islands map, whose pieces only ships can reach", () => {
    expect(mapNeedsShips(mapById("shores").board)).toBe(true);
  });
});

describe("boardWithoutIslandsTerrain", () => {
  it("leaves a board with no gold alone", () => {
    expect(boardWithoutIslandsTerrain(mapById("small").board)).toBeNull();
    expect(boardWithoutIslandsTerrain(undefined)).toBeNull();
  });

  it("demotes gold to land so the board is legal without Islands", () => {
    const gold = GALLERY.find((m) => m.board.tiles.some((t) => t.res === "gold"))!;
    const out = boardWithoutIslandsTerrain(gold.board)!;
    expect(out.tiles.some((t) => t.res === "gold")).toBe(false);
    expect(out.tiles).toHaveLength(gold.board.tiles.length);
    // Same board otherwise, and the input is not mutated.
    expect(out.radius).toBe(gold.board.radius);
    expect(gold.board.tiles.some((t) => t.res === "gold")).toBe(true);
  });
});

describe("mapPlayers", () => {
  it("uses a gallery map's authored range when present", () => {
    // Shores (Small) is a 28-tile board the formula would call 4-6; the authored
    // label overrides it to 3-4.
    expect(mapPlayers(mapById("shores"))).toEqual({ min: 3, max: 4 });
    expect(mapPlayers(mapById("shores-expanded"))).toEqual({ min: 5, max: 6 });
    expect(mapPlayers(mapById("shores-large"))).toEqual({ min: 7, max: 10 });
  });

  it("falls back to the tile-count formula when a map has no authored range", () => {
    const small = mapById("small"); // standard map, no authored range
    expect(small.players).toBeUndefined();
    expect(mapPlayers(small)).toEqual(recommendedPlayers(small.board));
  });
});

describe("recommendedMap honors authored labels", () => {
  it("picks an islands tier by the authored range, not the raw tile count", () => {
    // The formula would call Small Shores 4-6; the authored 3-4 label makes it
    // win for 4 players. A 10-player table only fits Large's authored 7-10.
    expect(recommendedMap(4, "base+islands", mapById("small").board)?.id).toBe("shores");
    expect(recommendedMap(10, "base+islands", mapById("small").board)?.id).toBe("shores-large");
  });

  it("nudges to a board that actually seats a mid-size table", () => {
    // 6 fits Medium (5-6) and Archipelago (5-7); the tiebreak favours the
    // roomier Archipelago. Either way not Small or Large.
    const rec = recommendedMap(6, "base+islands", mapById("small").board);
    expect(["shores-expanded", "archipelago"]).toContain(rec?.id);
  });
});

// Every ruleset the lobby can assemble, in the canonical order the server
// normalises to.
const ALL_RULESETS: string[] = (() => {
  const out: string[] = [];
  for (let mask = 0; mask < 256; mask++) {
    out.push(
      assembleRuleset({
        knights: !!(mask & 1),
        islands: !!(mask & 2),
        fishermen: !!(mask & 4),
        caravans: !!(mask & 8),
        harbormaster: !!(mask & 16),
        rivers: !!(mask & 32),
        raiders: !!(mask & 64),
        wagons: !!(mask & 128),
        // Explorers is standalone (assembleRuleset returns it alone), so it has
        // its own row below.
        explorers: false,
      }),
    );
  }
  return out;
})();

// Go's TestEveryValidRulesetResolvesItsTarget checks this fixture against the
// engine's configuration resolution.
describe("frontend targets match the engine", () => {
  const rows = readFileSync("../engine/ruletest/testdata/target_vp.txt", "utf8")
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  for (const [ruleset, rawTarget] of rows) {
    it(ruleset, () => {
      for (const players of [3, 4, 6, 8, 10]) {
        const target = Number(rawTarget);
        expect(recommendedVP(players, ruleset)).toBe(target);
        expect(defaultConfig({ ruleset, players }).target_vp).toBe(target);
        expect(target).toBeLessThanOrEqual(maxVP(ruleset, players));
      }
    });
  }
  it("preserves an explicit target", () => {
    expect(defaultConfig({ ruleset: "base+caravans", target_vp: 8 }).target_vp).toBe(8);
  });
});

// `Lobby.expPatch` is this function plus module-option pruning; the fiddly
// half is tested here.
describe("retargetVP", () => {
  it("raises an untouched target when a scenario with a premium goes on", () => {
    expect(retargetVP(10, 4, "base", "base+caravans")).toBe(12);
    expect(retargetVP(10, 4, "base", "base+cak")).toBe(13);
    expect(retargetVP(10, 4, "base", "base+islands")).toBe(10);
  });

  it("lowers it again when the scenario goes back off", () => {
    expect(retargetVP(12, 4, "base+caravans", "base")).toBe(10);
    expect(retargetVP(13, 4, "base+cak", "base")).toBe(10);
    // On and straight back off is a round trip.
    const on = retargetVP(10, 4, "base", "base+caravans");
    expect(retargetVP(on, 4, "base+caravans", "base")).toBe(10);
  });

  it("does not move for an expansion with no premium", () => {
    expect(retargetVP(10, 4, "base", "base+fishermen")).toBe(10);
    expect(retargetVP(12, 4, "base+caravans", "base+caravans+fishermen")).toBe(12);
  });

  it("keeps a target the host set on purpose", () => {
    // 8 is nobody's default, so it is the host's choice and survives both
    // directions.
    expect(retargetVP(8, 4, "base", "base+caravans")).toBe(8);
    expect(retargetVP(8, 4, "base+caravans", "base")).toBe(8);
    expect(retargetVP(18, 4, "base+cak", "base+cak+caravans")).toBe(18);
  });

  it("clamps a host-set target the new ceiling cannot hold", () => {
    // Turning Knights off drops the ceiling from 20 to 13, which the server
    // enforces.
    expect(retargetVP(20, 4, "base+cak", "base")).toBe(13);
    expect(retargetVP(20, 4, "base+cak", "base+caravans")).toBe(15);
  });

  it("treats a missing target as untouched", () => {
    expect(retargetVP(undefined, 4, "base", "base+caravans")).toBe(12);
    expect(retargetVP(undefined, 4, "base", "base")).toBe(10);
  });

  it("follows the engine default on a large table", () => {
    expect(retargetVP(10, 10, "base", "base+caravans")).toBe(12);
    expect(retargetVP(12, 10, "base+caravans", "base")).toBe(10);
  });

  it("never returns a target the server would reject", () => {
    const failures: string[] = [];
    for (const players of PLAYER_COUNTS) {
      const ceilings = new Map(ALL_RULESETS.map((rs) => [rs, maxVP(rs, players)]));
      for (const from of ALL_RULESETS) {
        const current = recommendedVP(players, from);
        for (const to of ALL_RULESETS) {
          if (retargetVP(current, players, from, to) > ceilings.get(to)!) {
            failures.push(`${players}: ${from} -> ${to}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("recommendedBarbarianDistance", () => {
  it("keeps the standard 7 for 3-4 players", () => {
    expect(recommendedBarbarianDistance(3)).toBe(7);
    expect(recommendedBarbarianDistance(4)).toBe(7);
  });

  it("pushes the fleet back as the table grows, capped at 12", () => {
    expect(recommendedBarbarianDistance(5)).toBe(9);
    expect(recommendedBarbarianDistance(6)).toBe(9);
    expect(recommendedBarbarianDistance(7)).toBe(11);
    expect(recommendedBarbarianDistance(8)).toBe(11);
    expect(recommendedBarbarianDistance(9)).toBe(12);
    expect(recommendedBarbarianDistance(10)).toBe(12);
  });

  it("stays within the engine's [4,12] band", () => {
    for (let p = 1; p <= 12; p++) {
      const d = recommendedBarbarianDistance(p);
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThanOrEqual(12);
    }
  });
});

describe("recommendedDiscardLimit", () => {
  it("keeps the standard 7 for 3-6 players", () => {
    expect(recommendedDiscardLimit(3)).toBe(7);
    expect(recommendedDiscardLimit(4)).toBe(7);
    expect(recommendedDiscardLimit(6)).toBe(7);
  });

  it("scales the threshold for the large-board modes", () => {
    expect(recommendedDiscardLimit(7)).toBe(8);
    expect(recommendedDiscardLimit(8)).toBe(8);
    expect(recommendedDiscardLimit(9)).toBe(9);
    expect(recommendedDiscardLimit(10)).toBe(9);
  });
});

describe("mapSupportsIslands", () => {
  it("exempts procedural, rejects solid land, accepts split landmasses", () => {
    expect(mapSupportsIslands(undefined)).toBe(true); // procedural; engine carves sea
    expect(mapSupportsIslands(mapById("small").board)).toBe(false); // one solid landmass
    // Shores is authored as land only but splits into separate islands; Frame
    // fills the channels.
    expect(mapSupportsIslands(mapById("shores").board)).toBe(true); // islands map
  });
});

describe("recommendedMap", () => {
  it("recommends a map matching the ruleset", () => {
    expect(recommendedMap(10, "base", mapById("small").board)?.kind).toBe("standard");
    expect(recommendedMap(8, "base+islands", mapById("small").board)?.kind).toBe("islands");
  });

  it("never recommends a sea-less map when Islands is on", () => {
    const rec = recommendedMap(4, "base+islands", mapById("small").board);
    expect(rec).not.toBeNull();
    expect(mapSupportsIslands(rec!.board)).toBe(true);
  });

  it("returns null when the board already fits", () => {
    // Small seats 3-4 and is a base map, so a 4-player base game needs no nudge.
    expect(recommendedMap(4, "base", mapById("small").board)).toBeNull();
  });

  it("nudges to a bigger board when the table outgrows the current one", () => {
    const rec = recommendedMap(10, "base", mapById("small").board);
    expect(rec?.kind).toBe("standard");
    expect(rec?.id).not.toBe("small");
  });
});

describe("maxVP", () => {
  it("base ceiling is 13", () => {
    expect(maxVP("base", 4)).toBe(13);
    expect(maxVP("base+islands", 8)).toBe(13);
  });
  it("knights adds 7", () => {
    expect(maxVP("base+cak", 4)).toBe(20);
    expect(maxVP("base+cak+islands", 4)).toBe(20);
  });
  it("Caravans raises the ceiling with its target adjustment", () => {
    expect(maxVP("base+caravans", 4)).toBe(15);
    expect(maxVP("base+fishermen+caravans", 4)).toBe(15);
  });
  // Harbormaster's card is 2 transferable points reachable without development
  // cards, so it raises the ceiling like Knights does. Mirrors the module's
  // MaxVPWithoutCards.
  it("harbormaster adds its card's 2, on top of Knights' 7", () => {
    expect(maxVP("base+harbormaster", 4)).toBe(15);
    expect(maxVP("base+caravans+harbormaster", 4)).toBe(17);
    expect(maxVP("base+cak+harbormaster", 4)).toBe(22);
  });
});

describe("offeredRulesetLabel", () => {
  // The landing page's one-line summary, derived from what the lobby offers.
  it("names the base game and every expansion the lobby offers", () => {
    expect(offeredRulesetLabel()).toBe(
      "Base + Knights + Islands + Fishermen + Caravans + Harbormaster + Rivers + Raiders + Wagons + Explorers",
    );
  });

  it("stays in step with VISIBLE_EXPANSIONS", () => {
    for (const [, label] of VISIBLE_EXPANSIONS) {
      expect(offeredRulesetLabel()).toContain(i18n._(label));
    }
  });
});

// The seat range must match the server's (`lobby.validateConfig` accepts
// 2..10, `lobby.Start` needs MIN_PLAYERS seated).
describe("the seat range", () => {
  it("spans 2 to 10, the same as the server accepts", () => {
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(10);
  });

  it("is one list, low to high, with no gaps", () => {
    expect(PLAYER_COUNTS[0]).toBe(MIN_PLAYERS);
    expect(PLAYER_COUNTS[PLAYER_COUNTS.length - 1]).toBe(MAX_PLAYERS);
    expect(PLAYER_COUNTS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // A fresh game is still four players.
  it("does not move the default", () => {
    expect(defaultConfig().players).toBe(4);
  });
});

describe("VISIBLE_EXPANSIONS", () => {
  it("offers every expansion, so every scenario is reachable", () => {
    expect(VISIBLE_EXPANSIONS.map(([k]) => k)).toEqual([
      "knights",
      "islands",
      "fishermen",
      "caravans",
      "harbormaster",
      "rivers",
      "raiders",
      "wagons",
      "explorers",
    ]);
  });

  it("names only keys parseExpansions round-trips", () => {
    const all = parseExpansions(
      "base+cak+islands+fishermen+caravans+harbormaster+rivers+raiders+wagons",
    );
    for (const [key] of VISIBLE_EXPANSIONS) {
      // Explorers is standalone and round-trips through its own name.
      if (key === "explorers") continue;
      expect(all[key]).toBe(true);
    }
    expect(parseExpansions("explorers").explorers).toBe(true);
  });
});

describe("FILTER_MODULES", () => {
  // The browse filters are matched directly against a game's ruleset string, so
  // they are wire keys (knights is "cak"), not Expansions keys.
  it("covers every visible expansion, so a browsable game is also filterable", () => {
    const wire = assembleRuleset(
      parseExpansions("base+cak+islands+fishermen+caravans+harbormaster+rivers+raiders+wagons"),
    )
      .split("+")
      .filter((p) => p !== "base");
    // Explorers is standalone; its filter key is its whole ruleset name.
    wire.push(assembleRuleset(parseExpansions("explorers")));
    expect([...FILTER_MODULES].sort()).toEqual(wire.sort());
  });
});

describe("assembleRuleset", () => {
  // A standalone ruleset is its own name: engine.modulesFor refuses
  // `base+explorers`.
  it("emits a standalone ruleset alone, with no base in front of it", () => {
    expect(assembleRuleset(parseExpansions("explorers"))).toBe("explorers");
    expect(parseExpansions("explorers")).toEqual({
      islands: false,
      knights: false,
      fishermen: false,
      caravans: false,
      harbormaster: false,
      rivers: false,
      raiders: false,
      wagons: false,
      explorers: true,
    });
  });

  // A standalone's one companion. assembleRuleset short-circuits on the
  // standalone, so without this the companion would be dropped.
  it("keeps a standalone's companion, and still refuses base", () => {
    const both = { ...parseExpansions("explorers"), knights: true };
    expect(assembleRuleset(both)).toBe("cak+explorers");
    // Sorted, with no "base", matching engine.CanonicalRuleset so the lobby is
    // not rewritten under the host.
    expect(assembleRuleset(both)).not.toContain("base");
    expect(parseExpansions("cak+explorers")).toEqual({
      islands: false,
      knights: true,
      fishermen: false,
      caravans: false,
      harbormaster: false,
      rivers: false,
      raiders: false,
      wagons: false,
      explorers: true,
    });
    // A non-companion partner is still dropped: Islands is refused beside
    // Explorers.
    expect(assembleRuleset({ ...both, islands: true })).toBe("cak+explorers");
  });

  it("plays the Knights pairing to 22, the sheet's scenario + 5", () => {
    for (const players of [2, 4, 6, 8, 10]) {
      expect(recommendedVP(players, "cak+explorers")).toBe(22);
    }
  });

  it("gives Explorers a fixed target and ceiling", () => {
    for (const players of [2, 4, 6, 8, 10]) {
      expect(recommendedVP(players, "explorers")).toBe(17);
    }
    expect(maxVP("explorers", 4)).toBe(25);
  });

  // engine.CanonicalRuleset is "base" + module names sorted lexicographically.
  it("emits modules in canonical (lexicographic) order, not display order", () => {
    const all = parseExpansions(
      "base+cak+islands+fishermen+caravans+harbormaster+rivers+raiders+wagons",
    );
    expect(assembleRuleset(all)).toBe(
      "base+cak+caravans+fishermen+harbormaster+islands+raiders+rivers+wagons",
    );
  });

  it("is canonical for the scenario pairs the picker can now produce", () => {
    expect(assembleRuleset(parseExpansions("base+islands+caravans"))).toBe("base+caravans+islands");
    expect(assembleRuleset(parseExpansions("base+fishermen+caravans"))).toBe(
      "base+caravans+fishermen",
    );
    expect(assembleRuleset(parseExpansions("base+cak+fishermen"))).toBe("base+cak+fishermen");
  });

  it("round-trips through parseExpansions", () => {
    const rs = "base+cak+caravans+fishermen+harbormaster+islands";
    expect(assembleRuleset(parseExpansions(rs))).toBe(rs);
  });

  // Harbormaster sorts between `fishermen` and `islands`, though it is last in
  // the picker.
  it("puts harbormaster where the sort puts it, not where the picker does", () => {
    expect(assembleRuleset(parseExpansions("base+islands+harbormaster"))).toBe(
      "base+harbormaster+islands",
    );
    expect(assembleRuleset(parseExpansions("base+harbormaster+fishermen"))).toBe(
      "base+fishermen+harbormaster",
    );
  });

  it("is base alone when nothing is selected", () => {
    expect(assembleRuleset(parseExpansions("base"))).toBe("base");
  });
});

describe("a new table opens on a board that seats it", () => {
  // The board must seat the table. Small (radius 2, 19 hexes) seats 4, and a
  // 10-player setup on it could not place every settlement. Checked for every
  // supported count.
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])("seats %d players", (players) => {
    const cfg = defaultConfig({ players });
    expect(cfg.board).toBeDefined();
    const range = recommendedPlayers(cfg.board!);
    expect(range.max).toBeGreaterThanOrEqual(players);
  });

  it("still honours a board the caller hands over", () => {
    const small = GALLERY.find((m) => m.id === "small")!;
    expect(defaultConfig({ players: 10, board: small.board }).board).toBe(small.board);
  });
});

describe("beta expansions", () => {
  // Established, not beta.
  const ESTABLISHED = ["knights", "islands"] as const;

  it("marks every expansion that is not knights or islands", () => {
    for (const [key] of VISIBLE_EXPANSIONS) {
      const established = (ESTABLISHED as readonly string[]).includes(key);
      expect(BETA_EXPANSIONS.has(key)).toBe(!established);
    }
  });

  // A new expansion is beta unless added to ESTABLISHED, so this fails until
  // someone decides. It also fails if the set and ESTABLISHED disagree.
  it("classifies every visible expansion one way or the other", () => {
    const visible = VISIBLE_EXPANSIONS.map(([k]) => k);
    for (const k of BETA_EXPANSIONS) expect(visible).toContain(k);
    expect(visible.length).toBe(BETA_EXPANSIONS.size + ESTABLISHED.length);
  });
});

describe("expansion picker grouping", () => {
  it("puts every visible expansion on exactly one shelf", () => {
    const grouped = groupedExpansions().flatMap(([, entries]) => entries.map(([k]) => k));
    expect([...grouped].sort()).toEqual(VISIBLE_EXPANSIONS.map(([k]) => k).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("keeps each shelf in the order VISIBLE_EXPANSIONS sets", () => {
    const order = VISIBLE_EXPANSIONS.map(([k]) => k);
    for (const [, entries] of groupedExpansions()) {
      const idx = entries.map(([k]) => order.indexOf(k));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  // Grouping and beta are independent: a scenario that leaves beta is still a
  // scenario.
  it("does not conflate the scenario shelf with the beta set", () => {
    expect(EXPANSION_GROUP.knights).toBe("core");
    expect(EXPANSION_GROUP.fishermen).toBe("scenario");
    expect(BETA_EXPANSIONS.has("knights")).toBe(false);
  });
});

/**
 * The path from `Expansions` to the wire, checked against the interface rather
 * than any one list.
 *
 * The tests above derive their expectations from `VISIBLE_EXPANSIONS`, so they
 * cannot catch a module that has a field, a `MODULE_TAGS` entry and a wire name
 * but is missing from the picker.
 *
 * `EXPANSION_MODULE` and `EXPANSION_GROUP` are `Record<keyof Expansions, ...>`
 * and so exhaustive by type, but are checked anyway in case that changes.
 * `VISIBLE_EXPANSIONS` and the order list behind `assembleRuleset` are arrays
 * with no exhaustiveness check.
 *
 * `parseExpansions` returns an `Expansions` object literal, so its keys are the
 * interface's keys at runtime.
 */
describe("every expansion reaches the player", () => {
  const ALL_KEYS = Object.keys(parseExpansions("base")) as (keyof Expansions)[];

  it("has a key for each of the nine modules", () => {
    // Removing a module should also be an explicit change here.
    expect(ALL_KEYS.length).toBe(9);
  });

  it("offers every key in the picker", () => {
    const visible = VISIBLE_EXPANSIONS.map(([k]) => k);
    for (const k of ALL_KEYS) expect(visible).toContain(k);
    expect(visible.length).toBe(ALL_KEYS.length);
  });

  it("puts every key on a shelf", () => {
    for (const k of ALL_KEYS) expect(["core", "scenario"]).toContain(EXPANSION_GROUP[k]);
  });

  it("gives every key a wire name", () => {
    for (const k of ALL_KEYS) expect(EXPANSION_MODULE[k]).toBeTruthy();
    // Distinct, or two switches would be one module on the wire.
    const wire = ALL_KEYS.map((k) => EXPANSION_MODULE[k]);
    expect(new Set(wire).size).toBe(wire.length);
  });

  it("carries every key into the ruleset string on its own", () => {
    for (const k of ALL_KEYS) {
      const only = { ...parseExpansions("base"), [k]: true };
      const ruleset = assembleRuleset(only);
      expect(ruleset.split("+")).toContain(EXPANSION_MODULE[k]);
      // And back again: the lobby reads its own string.
      expect(parseExpansions(ruleset)[k]).toBe(true);
    }
  });

  it("carries every combinable key into one string together", () => {
    // Standalone rulesets cannot join a combined string (see
    // STANDALONE_EXPANSIONS), so they are checked singly above.
    const combinable = ALL_KEYS.filter((k) => !STANDALONE_EXPANSIONS.has(k));
    const all = { ...parseExpansions("base") };
    for (const k of combinable) all[k] = true;
    const parts = assembleRuleset(all).split("+");
    expect(parts[0]).toBe("base");
    for (const k of combinable) expect(parts).toContain(EXPANSION_MODULE[k]);
    expect(parts.length).toBe(combinable.length + 1);
  });

  it("gives every key a browse filter, so a table made with it can be found", () => {
    for (const k of ALL_KEYS) expect(FILTER_MODULES).toContain(EXPANSION_MODULE[k]);
  });
});

// The server refuses a seat count the map cannot hold with only a generic
// error, so the lobby adjusts first.
describe("playersChange", () => {
  const byId = (id: string) => GALLERY.find((m) => m.id === id)!;
  const small = byId("small");

  it("mirrors the server's seat rule for the standard maps", () => {
    // board.TestMaxPlayersForMatchesTheGallery pins the same three numbers.
    expect(boardSeats(small.board)).toBe(4);
    expect(boardSeats(byId("medium").board)).toBe(8);
    expect(boardSeats(byId("large").board)).toBe(14);
    expect(boardSeats(undefined)).toBe(Infinity);
  });

  it("sends a count the map seats as it is", () => {
    expect(playersChange(4, "base", small.board, small)).toEqual({ kind: "ok", players: 4 });
  });

  it("moves a standard map up to one that seats the table", () => {
    const c = playersChange(6, "base", small.board, small);
    expect(c.kind).toBe("switch");
    if (c.kind !== "switch") return;
    expect(c.players).toBe(6);
    expect(c.map.kind).toBe("standard");
    expect(boardSeats(c.map.board)).toBeGreaterThanOrEqual(6);
  });

  it("keeps a themed map and stops at what it seats", () => {
    // Every shipped themed map seats ten, so make one that holds four.
    const themed = { ...small, id: "themed-four", kind: "themed" as const };
    const c = playersChange(10, "base", themed.board, themed);
    expect(c).toEqual({
      kind: "capped",
      players: boardSeats(themed.board),
      seats: boardSeats(themed.board),
    });
  });

  it("does not limit a table with no board to check", () => {
    expect(playersChange(10, "base+explorers", undefined, undefined)).toEqual({
      kind: "ok",
      players: 10,
    });
  });
});
