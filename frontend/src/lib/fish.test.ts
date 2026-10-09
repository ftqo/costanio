import { describe, it, expect } from "vitest";
import {
  FISH_COSTS,
  FISH_TILE_CAP,
  tileCount,
  fishPriceRange,
  fishRoadNext,
  bootTargets,
  fishOffers,
  fishStealVictims,
  fishTotal,
  lakeNumbers,
  myFishMix,
  robberSuppressed,
  revealedFishMix,
  seatFishTiles,
  spendTiles,
  type FishMix,
  type FishOffer,
  type FishRoadPending,
} from "./fish";
import { gameCaps } from "./caps";
import type { FullView } from "./types";

// A one-tile board with the robber on that tile. `OFF_BOARD` stands in for the
// engine's `board.OffBoard`; the client never tests for that coordinate, only
// whether the robber's hex is a tile on this board.
const ON_TILE = { q: 0, r: 0 };
const OFF_BOARD = { q: -9999, r: -9999 };

// One legal road edge, since `fishOffers` drops the 5-fish rung for a seat with
// nowhere to build. The road-gate tests override it.
const EDGE = { a: { q: 0, r: 0, d: 0 }, b: { q: 1, r: 0, d: 0 } };

const view = (
  ruleset: string,
  ext: Record<string, unknown> = {},
  players = 4,
  robber: { q: number; r: number } = ON_TILE,
  over: Record<string, unknown> = {},
) =>
  ({
    config: { ruleset },
    ext,
    board: { tiles: [{ hex: ON_TILE, res: "wood", num: 5 }], robber },
    legal: { roads: [EDGE] },
    players: Array.from({ length: players }, () => ({})),
    ...over,
  }) as unknown as FullView;

const caps = (ruleset: string) => gameCaps(view(ruleset));

describe("spendTiles: the tiles, not the price", () => {
  // A lone 3-tile pays for the 2-fish spend and the spare fish is destroyed.
  it("hands over a whole 3-tile for a 2-fish spend, wasting one", () => {
    const pay = spendTiles([0, 0, 1], FISH_COSTS.remove_robber)!;
    expect(pay).toEqual([0, 0, 1]);
    expect(fishTotal(pay)).toBe(3);
    expect(fishTotal(pay) - FISH_COSTS.remove_robber).toBe(1);
  });

  it("prefers the exact-change combination over the smaller pile", () => {
    // Holding 1+1+3: the 3-tile is fewer tiles but wastes a fish; the two
    // 1-tiles are exact. Waste is the first tiebreak.
    expect(spendTiles([2, 0, 1], 2)).toEqual([2, 0, 0]);
  });

  it("breaks a waste tie on the fewest tiles", () => {
    // Cost 4 from 2x1 + 2x2: 2+2 and 1+1+2 are both exact, so only the tile
    // count separates them. Exercises the second tiebreak.
    expect(spendTiles([2, 2, 0], 4)).toEqual([0, 2, 0]);
  });

  it("returns null when the holding cannot reach the price", () => {
    expect(spendTiles([1, 1, 0], FISH_COSTS.dev_card)).toBeNull();
  });

  it("matches the engine on an overpayment it cannot avoid", () => {
    // Only 3-tiles held, 4 fish owed: two tiles, six fish, two destroyed.
    const pay = spendTiles([0, 0, 3], FISH_COSTS.take_resource)!;
    expect(pay).toEqual([0, 0, 2]);
    expect(fishTotal(pay) - FISH_COSTS.take_resource).toBe(2);
  });
});

describe("fishOffers: a spend the ruleset or the board refuses is never offered", () => {
  const rich: FishMix = [10, 10, 10];

  it("base offers all five rungs, the 7 being the development card", () => {
    const ids = fishOffers(view("base+fishermen"), caps("base+fishermen"), rich, true).map(
      (o) => o.spend,
    );
    expect(ids).toEqual(["remove_robber", "steal", "take_resource", "free_road", "dev_card"]);
  });

  // rivers.md "With Fishermen": a bridge for 6 fish, between the 5-fish road
  // and the 7-fish card.
  it("alongside Rivers the 6-fish bridge sits between the road and the card", () => {
    const v = view("base+fishermen+rivers", {}, 4, ON_TILE, {
      legal: { roads: [EDGE], bridges: [EDGE] },
    });
    const offers = fishOffers(v, gameCaps(v), rich, true);
    expect(offers.map((o) => o.spend)).toEqual([
      "remove_robber",
      "steal",
      "take_resource",
      "free_road",
      "bridge",
      "dev_card",
    ]);
    expect(offers.find((o) => o.spend === "bridge")?.cost).toBe(6);
  });

  it("offers no bridge without Rivers, or on a turn with no site to bridge", () => {
    const plain = view("base+fishermen", {}, 4, ON_TILE, {
      legal: { roads: [EDGE], bridges: [EDGE] },
    });
    expect(fishOffers(plain, gameCaps(plain), rich, true).map((o) => o.spend)).not.toContain(
      "bridge",
    );
    const nowhere = view("base+fishermen+rivers");
    expect(fishOffers(nowhere, gameCaps(nowhere), rich, true).map((o) => o.spend)).not.toContain(
      "bridge",
    );
  });

  // docs/rules/scenarios.md: the 7-fish rung is a development card, or with no
  // development deck, a progress card of the named discipline. The engine
  // refuses the other with SPEND_UNAVAILABLE.
  it("under Knights the 7 rung is a progress card, not a dev card", () => {
    const v = view("base+cak+fishermen", { cak: { attacks: 3 } });
    const ids = fishOffers(v, gameCaps(v), rich, true).map((o) => o.spend);
    expect(ids).not.toContain("dev_card");
    expect(ids).toContain("progress_card");
  });

  it("and without Knights the progress card is the one that is absent", () => {
    const ids = fishOffers(view("base+fishermen"), caps("base+fishermen"), rich, true).map(
      (o) => o.spend,
    );
    expect(ids).toContain("dev_card");
    expect(ids).not.toContain("progress_card");
  });

  it("the robber spend is off while the barbarians have never landed", () => {
    const v = view("base+cak+fishermen", { cak: { attacks: 0 } });
    expect(robberSuppressed(v, gameCaps(v))).toBe(true);
    expect(fishOffers(v, gameCaps(v), rich, true).map((o) => o.spend)).not.toContain(
      "remove_robber",
    );
  });

  it("and it returns once the first attack lands", () => {
    // A state, not a ruleset ban: the robber returns after the first attack.
    const v = view("base+cak+fishermen", { cak: { attacks: 1 } });
    expect(robberSuppressed(v, gameCaps(v))).toBe(false);
    expect(fishOffers(v, gameCaps(v), rich, true).map((o) => o.spend)).toContain("remove_robber");
  });

  // Two fish remove the robber, and the spend is refused when there is no
  // robber on the board, which in a Fishermen game is the case from setup to the
  // first 7 and after each such spend.
  it("is off whenever the robber is not on the board at all", () => {
    const v = view("base+fishermen", {}, 4, OFF_BOARD);
    expect(robberSuppressed(v, gameCaps(v))).toBe(false); // not a Knights lock
    expect(fishOffers(v, gameCaps(v), rich, true).map((o) => o.spend)).not.toContain(
      "remove_robber",
    );
  });

  it("and comes back the moment a 7 puts the robber on a tile", () => {
    const v = view("base+fishermen", {}, 4, ON_TILE);
    expect(fishOffers(v, gameCaps(v), rich, true).map((o) => o.spend)).toContain("remove_robber");
  });

  it("lists an unaffordable spend", () => {
    const offers = fishOffers(view("base+fishermen"), caps("base+fishermen"), [1, 0, 0], true);
    expect(offers).toHaveLength(5);
    expect(offers.every((o) => !o.affordable)).toBe(true);
    expect(offers.every((o) => o.pay === null)).toBe(true);
  });

  it("carries the tiles and the waste, per row", () => {
    const offers = fishOffers(view("base+fishermen"), caps("base+fishermen"), [0, 0, 1], true);
    const robber = offers.find((o) => o.spend === "remove_robber")!;
    expect(robber.pay).toEqual([0, 0, 1]);
    expect(robber.waste).toBe(1);
    const steal = offers.find((o) => o.spend === "steal")!;
    expect(steal.pay).toEqual([0, 0, 1]);
    expect(steal.waste).toBe(0);
  });
});

// The seven-tile holding cap (engine/scenarios/fishermen.go) counts tiles, not fish:
// seven 3-fish tiles is legal, eight 1-fish tiles is not.
describe("the seven-token holding cap", () => {
  it("is seven, and is counted in tiles", () => {
    expect(FISH_TILE_CAP).toBe(7);
    expect(tileCount([7, 0, 0])).toBe(FISH_TILE_CAP);
    // Three times the fish, still inside the cap.
    expect(tileCount([0, 0, 7])).toBe(FISH_TILE_CAP);
    expect(fishTotal([0, 0, 7])).toBe(21);
  });
});

describe("the view accessors degrade rather than crash", () => {
  it("an older server sending no fishermen ext reads as an empty holding", () => {
    const v = view("base+fishermen", {});
    expect(myFishMix(v)).toEqual([0, 0, 0]);
    expect(seatFishTiles(v, 2)).toBe(0);
    expect(revealedFishMix(v, 2)).toBeNull();
  });
  it("tile counts without a mix still give the public numbers", () => {
    const v = view("base+fishermen", { fishermen: { tiles: [1, 4, 0, 2] } });
    expect(seatFishTiles(v, 1)).toBe(4);
    expect(myFishMix(v)).toEqual([0, 0, 0]);
  });
  // The public per-seat number is the tile count, never the value
  // (engine/scenarios/fishermen.go, FishExt.Tiles). An old `fish` value field must not
  // be read as a count.
  it("does not read the per-seat fish value as a tile count", () => {
    const v = view("base+fishermen", { fishermen: { fish: [1, 9, 0, 2] } });
    expect(seatFishTiles(v, 1)).toBe(0);
  });
  // A finished game's replay reveals every seat's tiles, as it does cards; a
  // live view never carries them.
  it("a revealed replay hands over every seat's mix", () => {
    const v = view("base+fishermen", {
      fishermen: {
        tiles: [3, 1, 0, 0],
        mixes: [
          [1, 1, 1],
          [0, 0, 1],
          [0, 0, 0],
          [0, 0, 0],
        ],
      },
    });
    expect(revealedFishMix(v, 0)).toEqual([1, 1, 1]);
    expect(fishTotal(revealedFishMix(v, 0)!)).toBe(6);
    expect(revealedFishMix(v, 1)).toEqual([0, 0, 1]);
  });
});

describe("the 3-fish steal asks two questions, not one", () => {
  // The fish steal respects the friendly-robber shield like every other steal
  // (base robber, pirate, knight chase, Bishop). The server sends the shield's
  // threshold only where it applies.
  const seated = (friendly: boolean, count: number) =>
    ({
      config: { ruleset: "base+fishermen", friendly_robber: friendly },
      friendly_robber_max_vp: friendly ? 2 : undefined,
      ext: {},
      players: Array.from({ length: count }, (_, seat) => ({ seat })),
    }) as unknown as FullView;

  const held = () => 3; // everyone is holding cards
  const vp = [2, 2, 5, 7]; // seats 0 and 1 are inside the shield (<= 2)

  it("shield off: every opponent holding a card is a target", () => {
    expect(fishStealVictims(seated(false, 4), 0, held, (s) => vp[s])).toEqual([1, 2, 3]);
  });

  it("shield on: the seats still at their starting score drop out", () => {
    expect(fishStealVictims(seated(true, 4), 0, held, (s) => vp[s])).toEqual([2, 3]);
  });

  it("shield on and nobody is above it: no target at all", () => {
    expect(fishStealVictims(seated(true, 2), 0, held, () => 2)).toEqual([]);
  });

  it("an empty hand is still disqualifying, shield or no shield", () => {
    const empty = (seat: number) => (seat === 2 ? 0 : 3);
    expect(fishStealVictims(seated(true, 4), 0, empty, (s) => vp[s])).toEqual([3]);
  });

  it("the switch alone shields nobody", () => {
    // Wagons+Fishermen with the switch on: no robber, so no threshold is sent
    // and the steal may take from anyone.
    const v = { ...seated(true, 4), friendly_robber_max_vp: undefined } as FullView;
    expect(fishStealVictims(v, 0, held, (s) => vp[s])).toEqual([1, 2, 3]);
  });

  it("never offers the spender their own seat", () => {
    expect(fishStealVictims(seated(false, 4), 2, held, (s) => vp[s])).not.toContain(2);
  });
});

describe("give-boot eligibility follows public victory points", () => {
  // The engine compares PublicVPWithModules; a private total including hidden
  // VP cards would offer the wrong seats.
  const v = view("base+fishermen", { fishermen: { boot_holder: 0 } }, 4);
  const publicVp = [5, 5, 6, 4];
  const privateVp = [7, 5, 6, 4]; // seat 0 holds two VP cards

  it("offers every seat doing at least as well in public", () => {
    expect(bootTargets(v, 0, (s) => publicVp[s])).toEqual([1, 2]);
  });

  it("uses the served total, not the private one", () => {
    expect(bootTargets(v, 0, (s) => privateVp[s])).toEqual([]);
  });

  it("never offers the holder their own seat", () => {
    expect(bootTargets(v, 2, (s) => publicVp[s])).not.toContain(2);
  });

  it("nobody holds the boot: nothing to offer", () => {
    expect(bootTargets(v, -1, (s) => publicVp[s])).toEqual([]);
  });
});

describe("what the shelf tile advertises", () => {
  // The tile shows the range actually on offer. Under base+cak+fishermen before
  // the first attack the 2-fish and 7-fish dev rungs are both absent.
  const offer = (cost: number): FishOffer => ({
    spend: "steal",
    cost,
    pay: null,
    waste: 0,
    affordable: true,
  });

  it("is the cheapest and dearest of what is on offer, not the price list", () => {
    expect(fishPriceRange([offer(3), offer(4), offer(5)])).toEqual({ min: 3, max: 5 });
  });

  it("collapses to one price when one row is left", () => {
    expect(fishPriceRange([offer(4)])).toEqual({ min: 4, max: 4 });
  });

  it("is null when the panel offers nothing at all", () => {
    expect(fishPriceRange([])).toBeNull();
  });
});

describe("fishRoadNext: the 5-fish spend places the road it named", () => {
  // The engine answers the spend with a road credit; the chosen edge is held
  // until the credit lands, then built, rather than asking for it again.
  const e: FishRoadPending["e"] = { a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: 0, side: 1 } };
  const other: FishRoadPending["e"] = { a: { q: 1, r: 0, side: 0 }, b: { q: 1, r: 0, side: 1 } };
  const pending: FishRoadPending = { e, ref: "c7", owed: 0 };

  it("waits while the spend is unanswered", () => {
    expect(fishRoadNext(pending, { free_roads: 0, legal: { roads: [e] } }, true, true)).toBe(
      "wait",
    );
  });

  it("builds the chosen edge once the credit lands and it is still legal", () => {
    expect(
      fishRoadNext(pending, { free_roads: 1, legal: { roads: [other, e] } }, true, false),
    ).toBe("build");
  });

  it("drops the edge when the credit lands but the edge is no longer legal", () => {
    expect(fishRoadNext(pending, { free_roads: 1, legal: { roads: [other] } }, true, false)).toBe(
      "drop",
    );
  });

  it("drops the edge when the spend was refused", () => {
    // No credit, and the spend left the in-flight registry (refused or timed
    // out). Holding the edge would place a road on the next credit of any kind.
    expect(fishRoadNext(pending, { free_roads: 0, legal: { roads: [e] } }, true, false)).toBe(
      "drop",
    );
  });

  it("drops the edge when the seat stops acting", () => {
    expect(fishRoadNext(pending, { free_roads: 1, legal: { roads: [e] } }, false, false)).toBe(
      "drop",
    );
  });

  it("does not spend a Road Building credit already in hand on the fish road", () => {
    // free_roads was 2 when the spend left. Still 2 means the fish credit has
    // not arrived; 3 means it has.
    const held: FishRoadPending = { ...pending, owed: 2 };
    expect(fishRoadNext(held, { free_roads: 2, legal: { roads: [e] } }, true, true)).toBe("wait");
    expect(fishRoadNext(held, { free_roads: 3, legal: { roads: [e] } }, true, false)).toBe("build");
  });
});

// The 5-fish rung is the one spend that can have nowhere to land. (The 2-fish
// rung only asks whether there is a robber; see the suppression tests above.)
describe("a spend with nowhere to land is not offered", () => {
  const rich: FishMix = [10, 10, 10];

  const spends = (over: Record<string, unknown>, mix: FishMix = rich, canBuild = true) =>
    fishOffers(
      view("base+fishermen", {}, 4, ON_TILE, over),
      caps("base+fishermen"),
      mix,
      canBuild,
    ).map((o) => o.spend);

  it("drops the 5-fish road when this seat has no legal edge", () => {
    // The engine checks the named edge against legal roads (ErrBadPlacement).
    // `legal` is omitted when every list in it is empty.
    expect(spends({ legal: undefined })).not.toContain("free_road");
    expect(spends({ legal: { roads: [] } })).not.toContain("free_road");
    expect(spends({ legal: { roads: [EDGE] } })).toContain("free_road");
  });

  it("keeps it for a seat whose only legal placement is a ship", () => {
    // Under Islands the credit buys either piece, so a ship edge suffices.
    expect(spends({ legal: { roads: [], ships: [EDGE] } })).toContain("free_road");
  });

  it("shows the whole ladder off turn", () => {
    // `legal` is only sent on the seat's own turn, so off turn its absence does
    // not mean "nowhere"; the shelf advertises the full ladder.
    expect(spends({ legal: undefined }, rich, false)).toContain("free_road");
  });
});

it("offers two fish for a wagon boost, sharing the grain limit", () => {
  const v = view("base+fishermen+wagons", {
    wagons: { has_trade: true, started: true, boosted: false, move_done: false },
  });
  const offer = fishOffers(v, gameCaps(v), [0, 0, 1], true).find((o) => o.spend === "wagon_boost");
  expect(offer).toMatchObject({ cost: 2, affordable: true, pay: [0, 0, 1], waste: 1 });
  for (const blocked of [{ boosted: true }, { move_done: true }, { started: false }]) {
    const x = view("base+fishermen+wagons", {
      wagons: { has_trade: true, started: true, boosted: false, move_done: false, ...blocked },
    });
    expect(fishOffers(x, gameCaps(x), [0, 0, 1], true).some((o) => o.spend === "wagon_boost")).toBe(
      false,
    );
  }
});

describe("lakeNumbers: each lake and what it pays on", () => {
  const lakeAt = (q: number, r: number) => ({ hex: { q, r }, res: "lake" as const, num: 0 });
  const board = (tiles: unknown[]) => ({ tiles, robber: { q: 9, r: 9 } });
  const withFish = (tiles: unknown[], fishermen: unknown) =>
    ({ board: board(tiles), ext: { fishermen } }) as unknown as FullView;

  it("reads each lake's own set off `lakes` (derivation 13 and later)", () => {
    const v = withFish(
      [lakeAt(0, 0), lakeAt(2, -1), { hex: { q: 1, r: 0 }, res: "wood", num: 8 }],
      {
        lake_numbers: [2, 3, 11, 12],
        lakes: [
          { hex: { q: 2, r: -1 }, numbers: [4, 10] },
          { hex: { q: 0, r: 0 }, numbers: [2, 3, 11, 12] },
        ],
      },
    );
    // Board order, not wire order: the tiles are what the board draws from.
    expect(lakeNumbers(v)).toEqual([
      { hex: { q: 0, r: 0 }, numbers: [2, 3, 11, 12] },
      { hex: { q: 2, r: -1 }, numbers: [4, 10] },
    ]);
  });

  it("falls back to `lake_numbers` for every lake of an older game", () => {
    const v = withFish([lakeAt(0, 0), lakeAt(2, -1)], { lake_numbers: [2, 3, 11, 12] });
    expect(lakeNumbers(v)).toEqual([
      { hex: { q: 0, r: 0 }, numbers: [2, 3, 11, 12] },
      { hex: { q: 2, r: -1 }, numbers: [2, 3, 11, 12] },
    ]);
  });

  it("an unlisted lake pays on nothing and skips the fallback", () => {
    const v = withFish([lakeAt(0, 0), lakeAt(2, -1)], {
      lake_numbers: [2, 3, 11, 12],
      lakes: [{ hex: { q: 0, r: 0 }, numbers: [2, 3, 11, 12] }],
    });
    expect(lakeNumbers(v)).toEqual([{ hex: { q: 0, r: 0 }, numbers: [2, 3, 11, 12] }]);
  });

  it("no module, or a server that sends no numbers, gives no lakes", () => {
    expect(lakeNumbers(withFish([lakeAt(0, 0)], undefined))).toEqual([]);
    expect(lakeNumbers(withFish([lakeAt(0, 0)], {}))).toEqual([]);
  });
});
