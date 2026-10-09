import { test, expect } from "vitest";
import { goodsBasket } from "./bank";

// goodsBasket plans the commodity lane's basket, the twin of maritimeTrade: any
// mix of give kinds funding any mix of taken kinds, each at its own rate, in
// one command. Resource indices are 1..5 (wood/brick/sheep/wheat/ore),
// commodity indices 0..2 (cloth/paper/coin).

const none = [0, 0, 0, 0, 0, 0];
const noCom = [0, 0, 0];
const all4 = [0, 4, 4, 4, 4, 4];
const rich = [0, 20, 20, 20, 20, 20];
const richCom = [20, 20, 20];
// A 2:1 wheat rate and 4:1 elsewhere, two give kinds funding one commodity
// ask: legal as two trades, so it must be expressible as one.
test("goodsBasket: mixed give rates fund a commodity ask", () => {
  const plan = goodsBasket({
    giveRes: [0, 4, 0, 0, 2, 0], // 4 wood at 4:1, 2 wheat at 2:1
    giveCom: noCom,
    wantRes: none,
    wantCom: [0, 0, 2], // 2 coin
    bankRatios: [0, 4, 4, 4, 2, 4],
    hand: [0, 4, 0, 0, 2, 0],
    bank: rich,
    commoditySupply: richCom,
  });
  expect(plan).not.toBeNull();
  expect(plan!.funded).toBe(2);
  expect(plan!.stranded).toBe(0);
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(true);
  expect(plan!.cmd).toEqual({
    type: "commodity_trade",
    data: {
      spend_res: [0, 4, 0, 0, 2, 0],
      spend_com: [0, 0, 0],
      want_res: [0, 0, 0, 0, 0, 0],
      want_com: [0, 0, 2],
    },
  });
});

test("goodsBasket: a stake that doesn't divide by its own rate is not ok", () => {
  const plan = goodsBasket({
    giveRes: [0, 5, 0, 0, 0, 0], // 5 wood at 4:1 leaves one stranded
    giveCom: noCom,
    wantRes: none,
    wantCom: [0, 0, 1],
    bankRatios: all4,
    hand: rich,
    bank: rich,
    commoditySupply: richCom,
  });
  expect(plan!.stranded).toBe(1);
  expect(plan!.consistent).toBe(false);
  expect(plan!.ok).toBe(false);
});

test("goodsBasket: a stake that divides but underfunds the ask is not ok", () => {
  const plan = goodsBasket({
    giveRes: [0, 4, 0, 0, 0, 0],
    giveCom: noCom,
    wantRes: none,
    wantCom: [0, 0, 2],
    bankRatios: all4,
    hand: rich,
    bank: rich,
    commoditySupply: richCom,
  });
  expect(plan!.funded).toBe(1);
  expect(plan!.wantTotal).toBe(2);
  expect(plan!.ok).toBe(false);
});

// A commodity give is priced at the maritime rate, not the published
// good_ratios (which include the Trading House). At Trade 3 those are 4 and 2;
// quoting 2 would light the button for a trade the server refuses.
test("goodsBasket: a commodity give uses the maritime rate", () => {
  const plan = goodsBasket({
    giveRes: none,
    giveCom: [4, 0, 0], // 4 cloth
    wantRes: [0, 0, 0, 0, 0, 1], // 1 ore
    wantCom: noCom,
    bankRatios: all4,
    goodRatios: { cloth: 2, paper: 2, coin: 2 }, // Trade 3: the Trading House price
    goodMaritimeRatios: { cloth: 4, paper: 4, coin: 4 },
    hand: none,
    commodities: richCom,
    bank: rich,
    commoditySupply: richCom,
  });
  expect(plan!.funded).toBe(1);
  expect(plan!.ok).toBe(true);
});

test("goodsBasket: a good on both sides is not one trade", () => {
  const plan = goodsBasket({
    giveRes: [0, 4, 0, 0, 0, 0],
    giveCom: [4, 0, 0],
    wantRes: none,
    wantCom: [1, 0, 1], // cloth spent and bought
    bankRatios: all4,
    goodMaritimeRatios: { cloth: 4, paper: 4, coin: 4 },
    hand: rich,
    commodities: richCom,
    bank: rich,
    commoditySupply: richCom,
  });
  expect(plan!.overlap).toBe(true);
  expect(plan!.ok).toBe(false);
});

test("goodsBasket: cards the player doesn't hold are not ok", () => {
  const plan = goodsBasket({
    giveRes: [0, 4, 0, 0, 0, 0],
    giveCom: noCom,
    wantRes: none,
    wantCom: [0, 0, 1],
    bankRatios: all4,
    hand: [0, 3, 0, 0, 0, 0], // one wood short
    bank: rich,
    commoditySupply: richCom,
  });
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(false);
});

test("goodsBasket: an exhausted commodity stack is not ok", () => {
  const plan = goodsBasket({
    giveRes: [0, 8, 0, 0, 0, 0],
    giveCom: noCom,
    wantRes: none,
    wantCom: [0, 0, 2],
    bankRatios: all4,
    hand: rich,
    bank: rich,
    commoditySupply: [20, 20, 1],
  });
  expect(plan!.consistent).toBe(true);
  expect(plan!.ok).toBe(false);
});

// A basket with no commodity is the base bank lane, which has its own planner
// and command.
test("goodsBasket: a pure resource basket belongs to the base lane", () => {
  expect(
    goodsBasket({
      giveRes: [0, 4, 0, 0, 0, 0],
      giveCom: noCom,
      wantRes: [0, 0, 0, 0, 0, 1],
      wantCom: noCom,
      bankRatios: all4,
      hand: rich,
      bank: rich,
    }),
  ).toBeNull();
});

test("goodsBasket: an empty side has nothing to quote", () => {
  expect(
    goodsBasket({
      giveRes: none,
      giveCom: noCom,
      wantRes: none,
      wantCom: [0, 0, 1],
      bankRatios: all4,
      hand: rich,
      bank: rich,
      commoditySupply: richCom,
    }),
  ).toBeNull();
});
