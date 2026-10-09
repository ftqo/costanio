import { test, expect } from "vitest";
import { bankTotal, clampGoldTarget, commodityTrade, maritimeTrade } from "./bank";

// Bank arrays are length-6, indices 1..5 = wood/brick/sheep/wheat/ore (index 0
// unused). bankTotal sums the resource entries; clampGoldTarget mirrors the
// engine's take = min(owed, total).

test("bankTotal: sums indices 1..5 and ignores index 0", () => {
  expect(bankTotal([99, 1, 2, 3, 4, 5])).toBe(15);
});

test("bankTotal: undefined bank is 0", () => {
  expect(bankTotal(undefined)).toBe(0);
});

test("bankTotal: empty bank is 0", () => {
  expect(bankTotal([0, 0, 0, 0, 0, 0])).toBe(0);
});

test("clampGoldTarget: owed below stock returns owed", () => {
  expect(clampGoldTarget(2, [0, 5, 5, 5, 5, 5])).toBe(2);
});

test("clampGoldTarget: drained bank clamps to total stock", () => {
  expect(clampGoldTarget(3, [0, 1, 0, 0, 0, 0])).toBe(1);
});

test("clampGoldTarget: fully drained bank clamps to 0", () => {
  expect(clampGoldTarget(3, [0, 0, 0, 0, 0, 0])).toBe(0);
});

test("clampGoldTarget: never negative even with negative owed", () => {
  expect(clampGoldTarget(-2, [0, 5, 5, 5, 5, 5])).toBe(0);
});

test("clampGoldTarget: undefined bank clamps to 0", () => {
  expect(clampGoldTarget(2, undefined)).toBe(0);
});

// maritimeTrade. Indices 1..5 = wood/brick/sheep/wheat/ore. All-4:1 ratios and a
// well-stocked bank/hand unless a test varies them.
const R4 = [0, 4, 4, 4, 4, 4]; // every resource trades 4:1
const FULL = [0, 9, 9, 9, 9, 9]; // bank with plenty of each
const give = (m: Record<number, number>) => Object.assign([0, 0, 0, 0, 0, 0], m);

test("maritimeTrade: 8 of one resource buys 2 different resources", () => {
  // 8 wheat (idx 4) at 4:1 → 1 brick (2) + 1 ore (5).
  const plan = maritimeTrade(give({ 4: 8 }), give({ 2: 1, 5: 1 }), R4, FULL, give({ 4: 8 }));
  expect(plan).not.toBeNull();
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(true);
  // One command, whatever the shape of the basket.
  expect(plan!.cmd).toEqual({ spend: give({ 4: 8 }), want: give({ 2: 1, 5: 1 }) });
});

test("maritimeTrade: 8 of one resource buys 2 of a single other resource", () => {
  const plan = maritimeTrade(give({ 4: 8 }), give({ 2: 2 }), R4, FULL, give({ 4: 8 }));
  expect(plan!.ok).toBe(true);
  expect(plan!.cmd).toEqual({ spend: give({ 4: 8 }), want: give({ 2: 2 }) });
});

// The feature this file exists for: two 2:1 ports, two give kinds, one trade.
test("maritimeTrade: 2 wood + 2 brick at 2:1 buys 2 sheep", () => {
  const ratios = [0, 2, 2, 4, 4, 4]; // wood and brick have 2:1 ports
  const plan = maritimeTrade(
    give({ 1: 2, 2: 2 }),
    give({ 3: 2 }),
    ratios,
    FULL,
    give({ 1: 2, 2: 2 }),
  );
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(true);
  expect(plan!.funded).toBe(2);
  expect(plan!.stranded).toBe(0);
  expect(plan!.cmd).toEqual({ spend: give({ 1: 2, 2: 2 }), want: give({ 3: 2 }) });
});

test("maritimeTrade: prices each give kind at its own rate", () => {
  const ratios = [0, 4, 4, 4, 4, 2]; // only ore has a 2:1 port
  // 2 ore (2:1) + 4 wheat (4:1) = 2 cards.
  const plan = maritimeTrade(
    give({ 4: 4, 5: 2 }),
    give({ 1: 1, 3: 1 }),
    ratios,
    FULL,
    give({ 4: 4, 5: 2 }),
  );
  expect(plan!.rates[4]).toBe(4);
  expect(plan!.rates[5]).toBe(2);
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(true);
});

test("maritimeTrade: rejects a mixed stake with a leftover card", () => {
  const ratios = [0, 2, 4, 4, 4, 4]; // wood 2:1
  // 2 wood pays for one card; 3 wheat pays for none and strands three.
  const plan = maritimeTrade(
    give({ 1: 2, 4: 3 }),
    give({ 3: 1 }),
    ratios,
    FULL,
    give({ 1: 2, 4: 3 }),
  );
  expect(plan!.funded).toBe(1);
  expect(plan!.stranded).toBe(3);
  expect(plan!.consistent).toBe(false);
  expect(plan!.ok).toBe(false);
});

test("maritimeTrade: honors a per-resource port ratio (3:1)", () => {
  const ratios = [0, 4, 4, 4, 3, 4]; // wheat has a 3:1 port
  const plan = maritimeTrade(give({ 4: 6 }), give({ 2: 1, 5: 1 }), ratios, FULL, give({ 4: 6 }));
  expect(plan!.rates[4]).toBe(3);
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(true);
});

test("maritimeTrade: defaults to 4:1 without ratios", () => {
  const plan = maritimeTrade(give({ 4: 8 }), give({ 2: 2 }), undefined, FULL, give({ 4: 8 }));
  expect(plan!.rates[4]).toBe(4);
  expect(plan!.ok).toBe(true);
});

test("maritimeTrade: an underfunded stake is inconsistent", () => {
  // 7 wheat can't fund two 4:1 buys (needs 8); plan is returned but not ok.
  const plan = maritimeTrade(give({ 4: 7 }), give({ 2: 1, 5: 1 }), R4, FULL, give({ 4: 7 }));
  expect(plan!.consistent).toBe(false);
  expect(plan!.ok).toBe(false);
});

// Buying back what you sell is refused, but as a plan with a reason rather
// than null.
test("maritimeTrade: flags a resource on both sides", () => {
  const plan = maritimeTrade(give({ 4: 8 }), give({ 4: 2 }), R4, FULL, give({ 4: 8 }));
  expect(plan!.overlap).toBe(true);
  expect(plan!.consistent).toBe(false);
  expect(plan!.ok).toBe(false);
});

test("maritimeTrade: flags an overlap in an otherwise legal basket", () => {
  const plan = maritimeTrade(
    give({ 1: 4, 4: 4 }),
    give({ 4: 1, 5: 1 }),
    R4,
    FULL,
    give({ 1: 4, 4: 4 }),
  );
  expect(plan!.overlap).toBe(true);
  expect(plan!.ok).toBe(false);
});

test("maritimeTrade: null when nothing is requested", () => {
  expect(maritimeTrade(give({ 4: 8 }), give({}), R4, FULL, give({ 4: 8 }))).toBeNull();
});

test("maritimeTrade: null when nothing is staked", () => {
  expect(maritimeTrade(give({}), give({ 2: 1 }), R4, FULL, give({ 4: 8 }))).toBeNull();
});

test("maritimeTrade: not ok when the hand can't cover the stake", () => {
  const plan = maritimeTrade(give({ 4: 8 }), give({ 2: 1, 5: 1 }), R4, FULL, give({ 4: 5 }));
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(false);
});

test("maritimeTrade: not ok when the bank can't supply a requested kind", () => {
  const drained = [0, 9, 0, 9, 9, 9]; // no brick left
  const plan = maritimeTrade(give({ 4: 8 }), give({ 2: 1, 5: 1 }), R4, drained, give({ 4: 8 }));
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(false);
});

// commodityTrade. Commodity indices are 0 cloth / 1 paper / 2 coin; resource
// indices stay 1..5. G4 is the rate with no port and no Trade track, G2 the
// rate once the Trading House is open.
const G4 = { cloth: 4, paper: 4, coin: 4 };
const G2 = { cloth: 2, paper: 2, coin: 2 };
const COMS = (m: Record<number, number>) => Object.assign([0, 0, 0], m);

// Two cloth for one wheat at Trade 3 is a legal Trading House use and must be
// priced at 2:1, not the maritime rate.
test("commodityTrade: Trade 3 buys 1 resource for 2 commodities", () => {
  const plan = commodityTrade({
    give: { com: 0 },
    giveN: 2,
    want: { res: 4 },
    wantN: 1,
    goodRatios: G2,
    tradeLevel: 3,
    commodities: COMS({ 0: 2 }),
    bank: FULL,
  });
  expect(plan!.lane).toBe("trading_house");
  expect(plan!.ratio).toBe(2);
  expect(plan!.giveNeeded).toBe(2);
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(true);
  expect(plan!.cmd).toEqual({ type: "trading_house", data: { give: 0, get_res: 4 } });
});

test("commodityTrade: Trading House can output a commodity", () => {
  const plan = commodityTrade({
    give: { com: 1 },
    giveN: 2,
    want: { com: 2 },
    wantN: 1,
    goodRatios: G2,
    tradeLevel: 3,
    commodities: COMS({ 1: 2 }),
    bank: FULL,
  });
  expect(plan!.ok).toBe(true);
  expect(plan!.cmd).toEqual({ type: "trading_house", data: { give: 1, get_com: 2 } });
});

// Commodities are finite, so the button must not light for a trade the server
// will refuse because the stack is empty.
test("commodityTrade: an empty commodity stack blocks the trade", () => {
  const staged = {
    give: { com: 1 },
    giveN: 2,
    want: { com: 2 },
    wantN: 1,
    goodRatios: G2,
    tradeLevel: 3,
    commodities: COMS({ 1: 2 }),
    bank: FULL,
  };
  expect(commodityTrade({ ...staged, commoditySupply: [5, 5, 0] })!.ok).toBe(false);
  expect(commodityTrade({ ...staged, commoditySupply: [5, 5, 1] })!.ok).toBe(true);
  // Unknown supply stays permissive rather than greying out a legal trade.
  expect(commodityTrade(staged)!.ok).toBe(true);
});

test("commodityTrade: below Trade 3 the stake trades at 4:1", () => {
  const plan = commodityTrade({
    give: { com: 0 },
    giveN: 2,
    want: { res: 4 },
    wantN: 1,
    goodRatios: G4,
    tradeLevel: 2,
    commodities: COMS({ 0: 2 }),
    bank: FULL,
  });
  expect(plan!.lane).toBe("commodity_trade");
  expect(plan!.ratio).toBe(4);
  expect(plan!.giveNeeded).toBe(4);
  // 2 staged against a 4:1 price is not ready.
  expect(plan!.consistent).toBe(false);
  expect(plan!.ok).toBe(false);
});

test("commodityTrade: 4 commodities for 1 resource at 4:1 is ready", () => {
  const plan = commodityTrade({
    give: { com: 0 },
    giveN: 4,
    want: { res: 4 },
    wantN: 1,
    goodRatios: G4,
    commodities: COMS({ 0: 4 }),
    bank: FULL,
  });
  expect(plan!.lane).toBe("commodity_trade");
  expect(plan!.ok).toBe(true);
  expect(plan!.cmd).toEqual({
    type: "commodity_trade",
    data: { give_com: 0, get_res: 4, count: 1 },
  });
});

test("commodityTrade: charges a generic port's 3:1", () => {
  const plan = commodityTrade({
    give: { com: 2 },
    giveN: 6,
    want: { res: 1 },
    wantN: 2,
    goodRatios: { cloth: 3, paper: 3, coin: 3 },
    commodities: COMS({ 2: 6 }),
    bank: FULL,
  });
  expect(plan!.ratio).toBe(3);
  expect(plan!.giveNeeded).toBe(6);
  expect(plan!.ok).toBe(true);
  expect(plan!.cmd.data.count).toBe(2);
});

test("commodityTrade: Trading House fills one good per use", () => {
  // 4 cloth for 2 wheat is two Trading House uses, not one command.
  const plan = commodityTrade({
    give: { com: 0 },
    giveN: 4,
    want: { res: 4 },
    wantN: 2,
    goodRatios: G2,
    tradeLevel: 3,
    commodities: COMS({ 0: 4 }),
    bank: FULL,
  });
  expect(plan!.lane).toBe("trading_house");
  expect(plan!.getN).toBe(1);
  expect(plan!.consistent).toBe(false);
  expect(plan!.ok).toBe(false);
});

test("commodityTrade: buying a commodity uses the resource ratio", () => {
  const plan = commodityTrade({
    give: { res: 1 },
    giveN: 4,
    want: { com: 0 },
    wantN: 1,
    bankRatios: R4,
    goodRatios: G2,
    tradeLevel: 3, // the Trading House takes commodities only, so it doesn't apply
    hand: give({ 1: 4 }),
    bank: FULL,
  });
  expect(plan!.lane).toBe("commodity_trade");
  expect(plan!.ratio).toBe(4);
  expect(plan!.ok).toBe(true);
  expect(plan!.cmd).toEqual({
    type: "commodity_trade",
    data: { give_res: 1, get_com: 0, count: 1 },
  });
});

test("commodityTrade: a 2:1 resource port lowers a resource give", () => {
  const plan = commodityTrade({
    give: { res: 5 },
    giveN: 2,
    want: { com: 1 },
    wantN: 1,
    bankRatios: [0, 4, 4, 4, 4, 2],
    hand: give({ 5: 2 }),
    bank: FULL,
  });
  expect(plan!.ratio).toBe(2);
  expect(plan!.ok).toBe(true);
});

test("commodityTrade: rejects buying back the commodity you spend", () => {
  expect(
    commodityTrade({
      give: { com: 0 },
      giveN: 4,
      want: { com: 0 },
      wantN: 1,
      goodRatios: G4,
      commodities: COMS({ 0: 4 }),
    }),
  ).toBeNull();
});

test("commodityTrade: returns null for resource-for-resource", () => {
  expect(
    commodityTrade({
      give: { res: 4 },
      giveN: 4,
      want: { res: 1 },
      wantN: 1,
      bankRatios: R4,
      hand: give({ 4: 4 }),
      bank: FULL,
    }),
  ).toBeNull();
});

test("commodityTrade: null when a side mixes resources and commodities", () => {
  expect(
    commodityTrade({
      give: { res: 4, com: 0 },
      giveN: 4,
      want: { com: 1 },
      wantN: 1,
      goodRatios: G4,
    }),
  ).toBeNull();
});

test("commodityTrade: not ready when the hand cannot cover the price", () => {
  const plan = commodityTrade({
    give: { com: 0 },
    giveN: 4,
    want: { res: 4 },
    wantN: 1,
    goodRatios: G4,
    commodities: COMS({ 0: 3 }),
    bank: FULL,
  });
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(false);
});

test("commodityTrade: not ready when the bank is out of the resource", () => {
  const plan = commodityTrade({
    give: { com: 0 },
    giveN: 2,
    want: { res: 2 },
    wantN: 1,
    goodRatios: G2,
    tradeLevel: 3,
    commodities: COMS({ 0: 2 }),
    bank: [0, 9, 0, 9, 9, 9], // no brick left
  });
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(false);
});

test("commodityTrade: defaults to 4:1 when no rates have arrived", () => {
  const plan = commodityTrade({
    give: { com: 0 },
    giveN: 4,
    want: { res: 4 },
    wantN: 1,
    commodities: COMS({ 0: 4 }),
    bank: FULL,
  });
  expect(plan!.ratio).toBe(4);
  expect(plan!.ok).toBe(true);
});
