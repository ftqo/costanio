import { expect, test } from "vitest";
import {
  scenarioCurrencies,
  tradeExtra,
  extraCommodities,
  extraCurrencies,
} from "./scenarioCurrency";
import type { FullView } from "./types";
test("Rivers and Wagons expose one shared purse", () => {
  const v = {
    ext: { rivers: { coins: [7] }, wagons: { started: true, shared_currency: true, gold: [7] } },
  } as unknown as FullView;
  expect(scenarioCurrencies(v, 0)).toEqual([{ key: "coins", held: 7 }]);
});
test("separate Raiders and Wagons purses have unambiguous trade keys", () => {
  const v = {
    ext: { raiders: { gold: [2] }, wagons: { started: true, gold: [7] } },
  } as unknown as FullView;
  expect(scenarioCurrencies(v, 0)).toEqual([
    { key: "gold", held: 2 },
    { key: "wagon_gold", held: 7 },
  ]);
});
test("currency and commodity offers roundtrip together", () => {
  const extra = tradeExtra([2, 0, 1], { coins: 3 });
  expect(extra).toEqual({ commodities: [2, 0, 1], coins: 3 });
  expect(extraCommodities(extra)).toEqual([2, 0, 1]);
  expect(extraCurrencies(extra).coins).toBe(3);
  expect(tradeExtra([0, 0, 0], {})).toBeUndefined();
  expect(tradeExtra([1, 0, 0], {})).toEqual([1, 0, 0]);
});
