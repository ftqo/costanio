import { i18n } from "@lingui/core";
import { describe, it, expect } from "vitest";
import { rulesetCaps } from "./caps";
import type { PlayerStat, VPBreakdown } from "./types";
import { vpBreakdownOf, vpOther, vpSources } from "./vp";

function breakdown(over: Partial<VPBreakdown> = {}): VPBreakdown {
  return {
    settlements: 0,
    cities: 0,
    longest_road: 0,
    largest_army: 0,
    dev_vp: 0,
    island_vp: 0,
    metropolis: 0,
    defender: 0,
    merchant: 0,
    extra_cak: 0,
    caravan: 0,
    harbormaster: 0,
    ...over,
  };
}

function stat(over: Partial<PlayerStat> = {}): PlayerStat {
  return {
    seat: 0,
    vp: 0,
    settlements: 0,
    cities: 0,
    roads: 0,
    knights: 0,
    dev_cards: 0,
    longest_road: 0,
    has_longest_road: false,
    has_largest_army: false,
    produced: 0,
    expected: 0,
    robber_loss: 0,
    stolen: 0,
    steals: 0,
    bank_trades: 0,
    player_trades: 0,
    luck_rel: 0,
    ...over,
  };
}

describe("vpSources", () => {
  it("columns only the sources a base game can produce", () => {
    const keys = vpSources(rulesetCaps("base")).map((s) => s.key);
    expect(keys).toEqual(["settlements", "cities", "longest_road", "largest_army", "dev_vp"]);
  });

  // Explorers has no cities unless Knights is on (engine/explorers NoCities).
  it("drops the Cities column where the ruleset has no cities", () => {
    expect(vpSources(rulesetCaps("base+explorers")).map((s) => s.key)).not.toContain("cities");
    expect(vpSources(rulesetCaps("base+cak+explorers")).map((s) => s.key)).toContain("cities");
  });

  it("drops Largest Army and VP cards under Knights, which has neither", () => {
    const keys = vpSources(rulesetCaps("base+cak")).map((s) => s.key);
    expect(keys).not.toContain("largest_army");
    expect(keys).not.toContain("dev_vp");
    // Every point the Knights module can hand out has a column of its own.
    expect(keys).toEqual([
      "settlements",
      "cities",
      "longest_road",
      "metropolis",
      "defender",
      "merchant",
      "extra_cak",
    ]);
  });

  it("names the route column by ruleset", () => {
    // An Islands route can run over water, so the two are separate messages,
    // chosen by ruleset.
    const routeOf = (ruleset: string) =>
      i18n._(vpSources(rulesetCaps(ruleset)).find((s) => s.key === "longest_road")!.label);
    expect(routeOf("base")).toBe("Longest Road");
    expect(routeOf("base+islands")).toBe("Longest Trade Route");
  });

  it("adds the island and camel sources with their modules", () => {
    expect(vpSources(rulesetCaps("base+islands")).map((s) => s.key)).toContain("island_vp");
    expect(vpSources(rulesetCaps("base+caravans")).map((s) => s.key)).toContain("caravan");
    expect(vpSources(rulesetCaps("base")).map((s) => s.key)).not.toContain("island_vp");
  });

  it("gives the Harbormaster card a column of its own", () => {
    expect(vpSources(rulesetCaps("base+harbormaster")).map((s) => s.key)).toContain("harbormaster");
    expect(vpSources(rulesetCaps("base")).map((s) => s.key)).not.toContain("harbormaster");
  });

  // Synthetic caps: the scoreboard must obey the cap whatever computes it, so
  // the test states it directly rather than through `rulesetCaps`.
  it("drops the Longest Road column when the ruleset has no such award", () => {
    // Wagons removes the title outright.
    const caps = { ...rulesetCaps("base"), hasLongestRoad: false };
    expect(vpSources(caps).map((s) => s.key)).not.toContain("longest_road");
    expect(vpSources(rulesetCaps("base")).map((s) => s.key)).toContain("longest_road");
  });

  it("drops the Defender column when the barbarians are not in play", () => {
    // The Raiders pairing switches the Knights fleet off, so no attack is ever
    // repelled.
    const caps = { ...rulesetCaps("base+cak"), hasBarbarians: false };
    expect(vpSources(caps).map((s) => s.key)).not.toContain("defender");
    expect(vpSources(rulesetCaps("base+cak")).map((s) => s.key)).toContain("defender");
  });

  it("scores cities at 2 VP from the server's city count", () => {
    const cities = vpSources(rulesetCaps("base")).find((s) => s.key === "cities")!;
    expect(cities.value(breakdown({ cities: 3 }))).toBe(6);
  });
});

describe("vpOther", () => {
  it("is zero when the columns explain the whole total", () => {
    const caps = rulesetCaps("base");
    const r = stat({
      vp: 10,
      vp_breakdown: breakdown({ settlements: 2, cities: 2, longest_road: 2, dev_vp: 2 }),
    });
    expect(vpOther(r, vpSources(caps))).toBe(0);
  });

  it("reports points no column claimed", () => {
    const caps = rulesetCaps("base");
    // A total larger than the breakdown accounts for: 3 points unattributed.
    const r = stat({ vp: 8, vp_breakdown: breakdown({ settlements: 3, cities: 1 }) });
    expect(vpOther(r, vpSources(caps))).toBe(3);
  });

  // The card is 2 transferable points folded into the total by the module's
  // VictoryCheck; without a column they would show up in `vpOther`.
  it("attributes the Harbormaster card's 2 points", () => {
    const caps = rulesetCaps("base+harbormaster");
    const b = breakdown({ settlements: 2, cities: 3, longest_road: 2, harbormaster: 2 });
    const r = stat({ vp: 2 + 6 + 2 + 2, vp_breakdown: b });
    expect(vpOther(r, vpSources(caps))).toBe(0);
    // Worth nothing to a seat that does not hold it.
    const none = stat({ vp: 8, vp_breakdown: breakdown({ settlements: 2, cities: 3 }) });
    expect(vpOther(none, vpSources(caps))).toBe(0);
  });

  // The field is optional on the wire; `undefined` in the sum would make the
  // total NaN.
  it("survives a breakdown with no harbormaster key on it", () => {
    const b = { ...breakdown({ settlements: 4, cities: 1 }), harbormaster: undefined };
    const r = stat({ vp: 6, vp_breakdown: b });
    expect(vpOther(r, vpSources(rulesetCaps("base+harbormaster")))).toBe(0);
    expect(Number.isNaN(vpOther(r, vpSources(rulesetCaps("base"))))).toBe(false);
  });

  // The Rivers wealth tiles are public points that can be negative.
  it("attributes the Rivers wealth tiles, the -2 included", () => {
    const caps = rulesetCaps("base+fishermen+rivers");
    expect(vpSources(caps).map((s) => s.key)).toContain("wealth");
    expect(vpSources(rulesetCaps("base")).map((s) => s.key)).not.toContain("wealth");
    const poor = stat({ vp: 4 - 2, vp_breakdown: breakdown({ settlements: 4, wealth: -2 }) });
    expect(vpOther(poor, vpSources(caps))).toBe(0);
    const rich = stat({ vp: 4 + 1, vp_breakdown: breakdown({ settlements: 4, wealth: 1 }) });
    expect(vpOther(rich, vpSources(caps))).toBe(0);
  });

  it("accounts for every point of a full Knights breakdown", () => {
    const caps = rulesetCaps("base+cak");
    const b = breakdown({
      settlements: 2,
      cities: 3,
      longest_road: 2,
      metropolis: 4,
      defender: 1,
      merchant: 1,
      extra_cak: 1,
    });
    const r = stat({ vp: 2 + 6 + 2 + 4 + 1 + 1 + 1, vp_breakdown: b });
    expect(vpOther(r, vpSources(caps))).toBe(0);
  });
});

describe("vpBreakdownOf", () => {
  it("passes the server's breakdown through untouched", () => {
    const b = breakdown({ settlements: 4 });
    expect(vpBreakdownOf(stat({ vp: 4, vp_breakdown: b }))).toBe(b);
  });

  it("reconstructs a breakdown for records saved without one", () => {
    // Old match record: 3 settlements, 2 cities, longest road, and 10 VP total,
    // so the missing point has to be a hidden VP card.
    const r = stat({
      vp: 10,
      settlements: 3,
      cities: 2,
      has_longest_road: true,
      longest_road: 6,
    });
    const b = vpBreakdownOf(r);
    expect(b).toMatchObject({ settlements: 3, cities: 2, longest_road: 2, dev_vp: 1 });
    expect(vpOther(r, vpSources(rulesetCaps("base")))).toBe(0);
  });

  it("reconstructs module points from the expansion stat blocks", () => {
    const r = stat({
      vp: 13,
      settlements: 1,
      cities: 3,
      cak: {
        knights_total: 4,
        knights_active: 2,
        knight_levels: [2, 1, 1],
        metropolis: 2,
        improve: [3, 4, 2],
        walls: 1,
        commodities_produced: 20,
        progress_played: 5,
        barbarian_defenses_won: 3,
        cities_lost_to_barbarians: 0,
        defender_vp: 1,
        merchant_vp: 1,
        extra_vp: 0,
      },
    });
    expect(vpBreakdownOf(r)).toMatchObject({ metropolis: 4, defender: 1, merchant: 1 });
    expect(vpOther(r, vpSources(rulesetCaps("base+cak")))).toBe(0);
  });
});

describe("the scenarios' own points have columns", () => {
  // The missions and each harbour settlement's second point must be
  // attributed, not left under "Other".
  it("explains an Explorers total with nothing left over", () => {
    const sources = vpSources(rulesetCaps("explorers"));
    const r = stat({
      vp: 17,
      vp_breakdown: breakdown({ settlements: 8, explorer_harbours: 3, missions: 6 }),
    });
    expect(vpOther(r, sources)).toBe(0);
    expect(sources.map((s) => s.key)).toEqual(
      expect.arrayContaining(["explorer_harbours", "missions"]),
    );
  });

  it("explains a Raiders total, conquest included, with nothing left over", () => {
    const sources = vpSources(rulesetCaps("base+raiders"));
    const r = stat({
      vp: 9,
      vp_breakdown: breakdown({ settlements: 5, cities: 2, prisoners: 2, conquered: -2 }),
    });
    expect(vpOther(r, sources)).toBe(0);
  });

  it("explains a Wagons total with nothing left over", () => {
    const sources = vpSources(rulesetCaps("base+wagons"));
    const r = stat({
      vp: 12,
      vp_breakdown: breakdown({ settlements: 3, cities: 3, delivered: 2, wagon_level: 1 }),
    });
    expect(vpOther(r, sources)).toBe(0);
  });

  it("adds none of them to a base game", () => {
    const keys = vpSources(rulesetCaps("base")).map((s) => s.key);
    for (const k of ["prisoners", "conquered", "delivered", "wagon_level", "missions"])
      expect(keys).not.toContain(k);
  });
});
