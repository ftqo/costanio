import { msg } from "@lingui/core/macro";
import { raidersExt, riversExt, wagonsExt, type FullView, type TradeExtra } from "./types";
export type CurrencyKey = "coins" | "gold" | "wagon_gold";
export type CurrencyAmounts = Partial<Record<CurrencyKey, number>>;
// "Coins", matching the Rivers panel, seat card and wagon panel, so Rivers +
// Wagons' shared purse has one name.
export const CURRENCY_NAMES = {
  coins: msg({ message: "Coins", context: "trade row: the Rivers coin purse" }),
  gold: msg`Gold`,
  wagon_gold: msg`Wagon gold`,
};
export function scenarioCurrencies(view: FullView, seat: number) {
  const river = riversExt(view),
    wagon = wagonsExt(view),
    raider = raidersExt(view);
  const out: { key: CurrencyKey; held: number }[] = [];
  if (river) out.push({ key: "coins", held: river.coins?.[seat] ?? 0 });
  if (raider) out.push({ key: "gold", held: raider.gold?.[seat] ?? 0 });
  if (wagon?.started && !wagon.shared_currency)
    out.push({ key: raider ? "wagon_gold" : "gold", held: wagon.gold?.[seat] ?? 0 });
  return out;
}
export function currencyCount(amounts: CurrencyAmounts) {
  return Object.values(amounts).reduce((a, b) => a + (b ?? 0), 0);
}
export function tradeExtra(
  commodities: number[],
  amounts: CurrencyAmounts,
): TradeExtra | undefined {
  const hasCom = commodities.some((n) => n > 0);
  if (currencyCount(amounts) > 0) return { ...amounts, ...(hasCom ? { commodities } : {}) };
  return hasCom ? commodities : undefined;
}
export function extraCommodities(extra?: TradeExtra): number[] | undefined {
  return Array.isArray(extra) ? extra : extra?.commodities;
}
export function extraCurrencies(extra?: TradeExtra): CurrencyAmounts {
  return Array.isArray(extra) ? {} : (extra ?? {});
}
