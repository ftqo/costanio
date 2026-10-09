import { describe, it, expect } from "vitest";
import type { Edge, FullView, Hand, Hex, RaidersExt } from "./types";
import {
  CONQUERED,
  GOLD_PER_RESOURCE,
  NO_PLAYER,
  RIDERS_PER_SEAT,
  canBuyRaidersCard,
  conqueredKeys,
  deckCounts,
  goldBuyOffers,
  goldBuysLeft,
  goldOf,
  goldSellOffers,
  goldSellRatio,
  isHurryTarget,
  landingNumber,
  pendEdges,
  pendHexes,
  prisonerVP,
  raidersAsking,
  raidersOn,
  raidersRole,
  riderMoveFrom,
  riderMoves,
  riderTargets,
  ridersLeft,
  ridersMustLeave,
  stealVictims,
  treasonMoveCount,
} from "./raiders";

const hex = (q: number, r: number): Hex => ({ q, r });
const edge = (q: number, r: number, side: 0 | 1, q2: number, r2: number, side2: 0 | 1): Edge => ({
  a: { q, r, side },
  b: { q: q2, r: r2, side: side2 },
});

/** The thinnest FullView these functions actually read. */
function viewWith(raiders?: RaidersExt, extra: Partial<FullView> = {}): FullView {
  return {
    players: [{ seat: 0 }, { seat: 1 }, { seat: 2 }],
    ext: raiders ? { raiders } : {},
    ...extra,
  } as unknown as FullView;
}

describe("the open decision is read off the wire, never derived", () => {
  it("no ext at all is not a decision", () => {
    expect(raidersRole(viewWith(), 0)).toBe("none");
    expect(raidersAsking(viewWith())).toBe(NO_PLAYER);
  });

  it("an inert module (ext present, no pend) is not a decision either", () => {
    const v = viewWith({ coast: [hex(1, 0)], raider_count: [1] });
    expect(raidersRole(v, 0)).toBe("none");
  });

  // `pend.seat` reaches every viewer and decides the role. `view.cur` would be
  // wrong in four of six cases: a landing interrupts the builder, Intrigue is
  // answered by whoever bought it, and the sweep hands prisoners to seats not
  // playing.
  it("names the kind for the asked seat, 'waiting' for others", () => {
    const v = viewWith({ pend: { kind: "raiders_landing", seat: 1, hexes: [hex(2, 0)] } });
    expect(raidersRole(v, 1)).toBe("raiders_landing");
    expect(raidersRole(v, 0)).toBe("waiting");
    expect(raidersRole(v, 2)).toBe("waiting");
    expect(raidersAsking(v)).toBe(1);
  });

  it("a spectator is always waiting, never asked", () => {
    const v = viewWith({ pend: { kind: "raiders_steal", seat: 0 } });
    // -1 can never be a pending seat; the guard matters because seat 0 is real
    // and a reversed comparison would hand seat 0's steal to every watcher.
    expect(raidersRole(v, NO_PLAYER)).toBe("waiting");
  });

  it("the pick lists are whatever the wire sent, unsorted and unfilled", () => {
    const v = viewWith({
      pend: {
        kind: "raiders_muster",
        seat: 0,
        edges: [edge(0, 0, 0, 1, 0, 1), edge(0, 0, 1, 0, 1, 0)],
      },
    });
    expect(pendEdges(v)).toHaveLength(2);
    expect(pendHexes(v)).toEqual([]);
  });
});

describe("rider moves", () => {
  const from = edge(0, 0, 0, 1, 0, 1);
  const free = edge(1, 0, 1, 1, 0, 0);
  const paid = edge(2, 0, 0, 2, 0, 1);
  const v = viewWith({
    rider_moves: [{ from, to: [free], hurry: [paid], must_leave: true }],
  });

  it("is viewer-only, so an absent list means nothing of yours may move", () => {
    expect(riderMoves(viewWith({ coast: [] }))).toEqual([]);
  });

  it("finds one rider's offer by the path it stands on", () => {
    expect(riderMoveFrom(v, from)?.to).toHaveLength(1);
    expect(riderMoveFrom(v, free)).toBeUndefined();
  });

  // The grain is per rider, so the panel must know which destination costs it
  // before the player commits.
  it("separates the free three paths from the five one grain buys", () => {
    const m = riderMoves(v)[0];
    expect(isHurryTarget(m, free)).toBe(false);
    expect(isHurryTarget(m, paid)).toBe(true);
    expect(riderTargets(m)).toHaveLength(2);
  });

  // A rider with nowhere to go is not marked (it may stay), so an empty list
  // does not mean the castle is clear.
  it("lists only the castle riders the turn is actually refused for", () => {
    expect(ridersMustLeave(v)).toHaveLength(1);
    const stuck = viewWith({ rider_moves: [{ from, to: [] }] });
    expect(ridersMustLeave(stuck)).toEqual([]);
  });
});

describe("raiders on the coast", () => {
  const x: RaidersExt = {
    coast: [hex(2, 0), hex(2, -1), hex(0, 2)],
    raider_count: [1, CONQUERED, 0],
    conquered: [hex(2, -1)],
  };

  it("counts by hex, off the two parallel arrays", () => {
    expect(raidersOn(x, hex(2, 0))).toBe(1);
    expect(raidersOn(x, hex(2, -1))).toBe(CONQUERED);
    expect(raidersOn(x, hex(0, 2))).toBe(0);
  });

  // An interior hex is never landed on, so zero is correct.
  it("answers zero for a hex that is not on the coast", () => {
    expect(raidersOn(x, hex(0, 0))).toBe(0);
    expect(raidersOn(undefined, hex(0, 0))).toBe(0);
  });

  // `conquered` comes from the wire so the three-raider rule is not
  // duplicated.
  it("takes the conquered set from the wire, not from a comparison", () => {
    expect(conqueredKeys(x).size).toBe(1);
    expect(conqueredKeys({ coast: x.coast, raider_count: x.raider_count }).size).toBe(0);
  });
});

describe("prisoners are worth a point in pairs, and a lone one is worth nothing", () => {
  it("floors, and never rounds a single prisoner up to a half", () => {
    expect(prisonerVP(0, false)).toBe(0);
    expect(prisonerVP(1, false)).toBe(0);
    expect(prisonerVP(2, false)).toBe(1);
    expect(prisonerVP(3, false)).toBe(1);
    expect(prisonerVP(7, false)).toBe(3);
  });

  it("takes three alongside Knights", () => {
    expect(prisonerVP(2, true)).toBe(0);
    expect(prisonerVP(3, true)).toBe(1);
    expect(prisonerVP(8, true)).toBe(2);
  });
});

describe("the per-seat counters", () => {
  const x: RaidersExt = {
    gold: [6, 0, 1],
    prisoners: [3, 0, 0],
    riders_left: [2, 6, 6],
    riders_per_seat: RIDERS_PER_SEAT,
    deck: [14, 4, 4, 4],
  };

  it("reads gold and riders per seat, and answers nothing for a spectator", () => {
    expect(goldOf(x, 0)).toBe(6);
    expect(goldOf(x, NO_PLAYER)).toBe(0);
    expect(ridersLeft(x, 0)).toEqual({ left: 2, perSeat: 6 });
    expect(ridersLeft(undefined, 0)).toEqual({ left: 6, perSeat: 6 });
  });

  it("counts the deck without hardcoding its composition", () => {
    expect(deckCounts(x)).toEqual({ counts: [14, 4, 4, 4], total: 26 });
    expect(deckCounts(undefined).total).toBe(0);
  });

  // Absent means an older server. Assume the full allowance: the engine refuses
  // a third buy anyway, and hiding the control is worse.
  it("assumes the full allowance when the field is missing", () => {
    expect(goldBuysLeft({ gold_buys_left: 0 })).toBe(0);
    expect(goldBuysLeft({})).toBe(2);
  });
});

describe("the gold spends", () => {
  const hand = [0, 0, 0, 4, 1, 0] as Hand; // four sheep, one wheat

  it("refuses a purchase the bank cannot fill, before the gold is spent", () => {
    const v = viewWith(
      { gold: [4, 0], gold_buys_left: 2 },
      {
        bank: [0, 5, 5, 0, 5, 5],
      },
    );
    const offers = goldBuyOffers(v, 0);
    expect(offers.find((o) => o.res === 1)?.affordable).toBe(true);
    // Sheep: the bank has none, so the row is listed and refused, not hidden.
    expect(offers.find((o) => o.res === 3)?.stock).toBe(0);
    expect(offers.find((o) => o.res === 3)?.affordable).toBe(false);
  });

  it("refuses every purchase once both of the turn's buys are used", () => {
    const v = viewWith(
      { gold: [10, 0], gold_buys_left: 0 },
      {
        bank: [0, 5, 5, 5, 5, 5],
      },
    );
    expect(goldBuyOffers(v, 0).every((o) => !o.affordable)).toBe(true);
  });

  it("refuses every purchase below the price", () => {
    const v = viewWith(
      { gold: [GOLD_PER_RESOURCE - 1, 0], gold_buys_left: 2 },
      {
        bank: [0, 5, 5, 5, 5, 5],
      },
    );
    expect(goldBuyOffers(v, 0).every((o) => !o.affordable)).toBe(true);
  });

  it("quotes each resource’s own maritime rate, including specific harbours", () => {
    expect(goldSellRatio(viewWith({}), 1)).toBe(4);
    const view = viewWith({}, { bank_ratios: [0, 2, 3, 3, 3, 3] });
    expect(goldSellRatio(view, 1)).toBe(2);
    expect(goldSellRatio(view, 2)).toBe(3);
    expect(goldSellOffers(view, [0, 2, 2, 0, 0, 0] as Hand).slice(0, 2)).toEqual([
      { res: 1, ratio: 2, held: 2, affordable: true },
      { res: 2, ratio: 3, held: 2, affordable: false },
    ]);
  });

  it("offers the sale only where the hand actually holds the pile", () => {
    const v = viewWith({}, { bank_ratios: [0, 4, 4, 4, 4, 4] });
    const offers = goldSellOffers(v, hand);
    expect(offers.find((o) => o.res === 3)).toEqual({
      res: 3,
      ratio: 4,
      held: 4,
      affordable: true,
    });
    expect(offers.find((o) => o.res === 4)?.affordable).toBe(false);
  });

  it("a generic harbour makes a pile of three enough", () => {
    const three = [0, 0, 0, 3, 0, 0] as Hand;
    const v = viewWith({}, { bank_ratios: [0, 3, 3, 3, 3, 3] });
    expect(goldSellOffers(v, three).find((o) => o.res === 3)?.affordable).toBe(true);
  });
});

describe("buying a card costs one ore, one wool and one grain", () => {
  it("reads the three cards and nothing else", () => {
    expect(canBuyRaidersCard([0, 0, 0, 1, 1, 1] as Hand)).toBe(true);
    expect(canBuyRaidersCard([0, 9, 9, 0, 1, 1] as Hand)).toBe(false);
    expect(canBuyRaidersCard(undefined)).toBe(false);
  });
});

describe("Treason names its whole plan in one command", () => {
  // The command carries the whole plan and a wrong-length plan is refused.
  it("asks for two when the board and the coast can furnish them", () => {
    const v = viewWith({
      supply: 12,
      pend: {
        kind: "raiders_treason",
        seat: 0,
        treason_from: [hex(2, 0), hex(0, 2)],
        treason_to: [hex(2, -1), hex(-2, 0), hex(1, 1)],
      },
    });
    expect(treasonMoveCount(v, false)).toBe(2);
  });

  it("asks for fewer when there is nowhere to put a second one", () => {
    const v = viewWith({
      supply: 12,
      pend: {
        kind: "raiders_treason",
        seat: 0,
        treason_from: [hex(2, 0), hex(0, 2)],
        treason_to: [hex(2, -1)],
      },
    });
    expect(treasonMoveCount(v, false)).toBe(1);
  });

  // With one raider on the board and an empty supply, the card moves one.
  it("counts the supply as a source only while it has raiders in it", () => {
    const pend = {
      kind: "raiders_treason" as const,
      seat: 0,
      treason_from: [hex(2, 0)],
      treason_to: [hex(2, -1), hex(-2, 0)],
    };
    expect(treasonMoveCount(viewWith({ supply: 4, pend }), false)).toBe(2);
    expect(treasonMoveCount(viewWith({ supply: 0, pend }), false)).toBe(1);
    // Unbounded alongside Knights.
    expect(treasonMoveCount(viewWith({ supply: 0, pend }), true)).toBe(2);
  });

  // The engine's count wins: here the only destination is also the only
  // source, so the plan moves nothing, while the fallback would ask for one
  // move the engine refuses.
  it("takes the engine's treason_count over its own arithmetic", () => {
    const pend = {
      kind: "raiders_treason" as const,
      seat: 0,
      treason_from: [hex(2, 0)],
      treason_to: [hex(2, 0)],
    };
    expect(treasonMoveCount(viewWith({ supply: 4, pend }), false)).toBe(1);
    expect(
      treasonMoveCount(viewWith({ supply: 4, pend: { ...pend, treason_count: 0 } }), false),
    ).toBe(0);
    expect(
      treasonMoveCount(viewWith({ supply: 4, pend: { ...pend, treason_count: 2 } }), false),
    ).toBe(2);
  });
});

describe("the 7 takes one card from a player of your choice", () => {
  // The wider test: the engine also applies the friendly-robber shield using
  // state the client cannot see. A rejected offer costs a toast; a hidden valid
  // seat costs the steal.
  it("offers every seat but the thief that is holding something", () => {
    const v = viewWith({});
    const held = (seat: number) => (seat === 2 ? 0 : 3);
    expect(stealVictims(v, 0, held)).toEqual([1]);
    expect(stealVictims(v, 2, held)).toEqual([0, 1]);
  });
});

describe("landingNumber names the roll a landing tie is about", () => {
  const board = {
    tiles: [
      { hex: hex(2, 0), res: "wood", num: 6 },
      { hex: hex(-2, 2), res: "ore", num: 6 },
      { hex: hex(0, 2), res: "wheat", num: 9 },
    ],
  } as unknown as FullView["board"];
  it("is the chip the offered hexes share", () => {
    const v = viewWith(
      { pend: { kind: "raiders_landing", seat: 0, hexes: [hex(-2, 2), hex(2, 0)] } },
      { board },
    );
    expect(landingNumber(v)).toBe(6);
  });
  it("is null when nothing is offered or the chips disagree", () => {
    expect(landingNumber(viewWith({}, { board }))).toBeNull();
    const mixed = viewWith(
      { pend: { kind: "raiders_landing", seat: 0, hexes: [hex(0, 2), hex(2, 0)] } },
      { board },
    );
    expect(landingNumber(mixed)).toBeNull();
  });
});

describe("the 7's steal waits for the discards", () => {
  // The steal dialog must not open over the seat's own owed discard.
  it("is hidden while this seat owes a discard, waits on others, then opens", async () => {
    const { stealGate } = await import("./raiders");
    const at = (pending_discards: Record<number, number>) =>
      stealGate({ pending_discards } as unknown as FullView, 0);
    expect(at({ 0: 5 })).toBe("hidden");
    expect(at({ 0: 0, 2: 4 })).toBe("waiting");
    expect(at({})).toBe("open");
    expect(stealGate({} as FullView, 0)).toBe("open");
  });
});

describe("whether a rider's hurry can be paid for", () => {
  it("is a wheat, or two fish under Fishermen", async () => {
    const { riderHurryPayable } = await import("./raiders");
    const v = (hand: number[], ruleset = "base+raiders", fish?: object) =>
      ({
        viewer: 0,
        config: { ruleset },
        players: [{ hand }],
        ext: fish ? { fishermen: fish } : {},
      }) as unknown as FullView;
    expect(riderHurryPayable(v([0, 0, 0, 0, 1, 0]))).toBe(true);
    expect(riderHurryPayable(v([0, 1, 1, 1, 0, 1]))).toBe(false);
    expect(riderHurryPayable(v([0, 0, 0, 0, 0, 0], "base+fishermen+raiders"))).toBe(false);
  });
});
