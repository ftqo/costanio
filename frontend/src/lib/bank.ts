// Bank-stock helpers for resource pickers (gold, Year of Plenty). The bank is a
// length-6 Hand array indexed 1..5 = wood/brick/sheep/wheat/ore (index 0
// unused, as in the engine). These mirror the engine's per-resource and total
// stock clamps so a picker never offers more than the bank holds.

// bankTotal: total resource cards in the bank (sum of indices 1..5).
export function bankTotal(bank: readonly number[] | undefined): number {
  if (!bank) return 0;
  let total = 0;
  for (let i = 1; i <= 5; i++) total += bank[i] ?? 0;
  return total;
}

// clampGoldTarget: how many cards a gold/take-from-bank pick may total; the
// owed amount clamped to the bank's total stock (engine: take = min(owed, total)).
export function clampGoldTarget(owed: number, bank: readonly number[] | undefined): number {
  return Math.min(Math.max(0, owed), bankTotal(bank));
}

export interface MaritimePlan {
  rates: number[]; // each staked give kind's own bank ratio, index 1..5 (0 elsewhere)
  giveKinds: number[]; // staked give kinds, ascending
  wantKinds: number[]; // requested kinds, ascending
  wantTotal: number; // cards requested
  funded: number; // cards the stake actually pays for (whole units only)
  stranded: number; // staked cards that don't complete a unit at their own rate
  overlap: boolean; // a resource staked on both sides: two trades, never one
  consistent: boolean; // the stake pays for the request exactly
  ok: boolean; // consistent, affordable from hand, and the bank can supply it
  cmd: { spend: number[]; want: number[] }; // the single bank_trade payload
}

// maritimeTrade plans a base-game bank trade: any mix of give kinds funding
// any mix of requested kinds, in one command. Each give kind is priced at its
// own ratio, so with 2:1 wood and 2:1 brick ports, 2 wood + 2 brick buys 2
// sheep. Each requested card is paid in full by a single kind, so each kind's
// stake must be a whole multiple of its ratio (no partial units, no change).
//
// Returns null only when a side is empty. A resource staged on both sides
// returns a plan with `overlap` set, so the caller can explain. Indices are
// 1..5 (wood/brick/sheep/wheat/ore); index 0 is unused.
export function maritimeTrade(
  give: readonly number[],
  want: readonly number[],
  ratios: readonly number[] | undefined,
  bank: readonly number[] | undefined,
  hand: readonly number[] | undefined,
): MaritimePlan | null {
  const giveKinds: number[] = [];
  const wantKinds: number[] = [];
  const rates = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i <= 5; i++) {
    if ((give[i] ?? 0) > 0) {
      giveKinds.push(i);
      rates[i] = ratios?.[i] ?? 4;
    }
    if ((want[i] ?? 0) > 0) wantKinds.push(i);
  }
  if (giveKinds.length < 1 || wantKinds.length < 1) return null;

  const overlap = giveKinds.some((k) => wantKinds.includes(k));
  const wantTotal = wantKinds.reduce((a, k) => a + (want[k] ?? 0), 0);
  let funded = 0;
  let stranded = 0;
  for (const k of giveKinds) {
    const n = give[k] ?? 0;
    // A rate of 0 would be a server bug; treat it as unpriced.
    const r = rates[k] > 0 ? rates[k] : 4;
    funded += Math.floor(n / r);
    stranded += n % r;
  }
  const consistent = !overlap && wantTotal >= 1 && stranded === 0 && funded === wantTotal;
  const ok =
    consistent &&
    giveKinds.every((k) => (hand?.[k] ?? 0) >= (give[k] ?? 0)) &&
    wantKinds.every((k) => (bank?.[k] ?? 0) >= (want[k] ?? 0));
  const spend = [0, 0, 0, 0, 0, 0];
  const take = [0, 0, 0, 0, 0, 0];
  for (const k of giveKinds) spend[k] = give[k] ?? 0;
  for (const k of wantKinds) take[k] = want[k] ?? 0;
  return {
    rates,
    giveKinds,
    wantKinds,
    wantTotal,
    funded,
    stranded,
    overlap,
    consistent,
    ok,
    cmd: { spend, want: take },
  };
}

// --- The Knights commodity lane ------------------------------------------
//
// Wire keys for `good_ratios`, which the server publishes per commodity. Index
// order matches the engine's Commodity constants (0 cloth, 1 paper, 2 coin) and
// the COMMOD table in cardFace.ts.
export const COMMODITY_KEYS = ["cloth", "paper", "coin"] as const;

// The Trade level 3 Trading House: 2 of one commodity for one different good,
// one good per use, so a multi-unit ask cannot use it in one command.
export const TRADING_HOUSE_COST = 2;
const TRADING_HOUSE_LEVEL = 3;

// One side of a Knights bank trade: exactly one of a resource index (1..5) or a
// commodity index (0..2).
export interface GoodRef {
  res?: number;
  com?: number;
}

export interface CommodityPlan {
  /** Which server command honours this price. */
  lane: "commodity_trade" | "trading_house";
  ratio: number; // unit price of the give good on the chosen lane
  getN: number; // units the command delivers (the Trading House delivers 1)
  giveNeeded: number; // ratio × getN: what the server will actually take
  consistent: boolean; // the staged give exactly funds the staged ask
  ok: boolean; // consistent, affordable from hand, and the bank can supply it
  cmd: { type: string; data: Record<string, number> };
}

/** One good in a basket: a commodity index (0..2) or a resource index (1..5). */
export interface BasketGood {
  com: boolean;
  idx: number;
  n: number;
  rate: number;
}

export interface GoodsBasketPlan {
  give: BasketGood[]; // staked kinds, resources then commodities
  want: BasketGood[]; // requested kinds, resources then commodities (rate unused)
  wantTotal: number; // goods requested
  funded: number; // goods the stake actually pays for (whole units only)
  stranded: number; // staked cards that don't complete a unit at their own rate
  overlap: boolean; // a good staked on both sides: two trades, never one
  consistent: boolean; // the stake pays for the request exactly
  ok: boolean; // consistent, affordable, and every pile can supply its part
  cmd: {
    type: "commodity_trade";
    data: { spend_res: number[]; spend_com: number[]; want_res: number[]; want_com: number[] };
  };
}

/**
 * goodsBasket plans a Knights bank trade that involves a commodity and settles
 * the whole basket in one command: any mix of give kinds funding any mix of
 * taken kinds, each priced at its own rate, across resources and commodities.
 * The commodity counterpart of maritimeTrade.
 *
 * A commodity give is priced by `goodMaritimeRatios`, not `goodRatios`.
 * `goodRatios` publishes the cheapest lane, which at Trade 3 is the Trading
 * House at 2:1, but a basket goes through the maritime lane (the Trading House
 * gives one good per use). A single-kind commodity give still routes to
 * commodityTrade, which picks the cheaper lane.
 *
 * Returns null when a side is empty or no commodity is involved (that is the
 * base lane, maritimeTrade).
 */
export function goodsBasket(t: {
  giveRes: readonly number[]; // index 1..5
  giveCom: readonly number[]; // index 0..2
  wantRes: readonly number[];
  wantCom: readonly number[];
  bankRatios?: readonly number[];
  /** The cheapest lane per commodity. Used only as a fallback for the maritime rate. */
  goodRatios?: Record<string, number>;
  /** What the maritime lane charges per commodity: the rate a basket is priced at. */
  goodMaritimeRatios?: Record<string, number>;
  hand?: readonly number[];
  commodities?: readonly number[];
  bank?: readonly number[];
  commoditySupply?: readonly number[];
}): GoodsBasketPlan | null {
  // A rate of 0 is a server bug and a missing one is a spectator view; either
  // way use the worst rate.
  const resRate = (i: number) => {
    const r = t.bankRatios?.[i] ?? 4;
    return r > 0 ? r : 4;
  };
  const comRate = (i: number) => {
    const k = COMMODITY_KEYS[i];
    const r = t.goodMaritimeRatios?.[k] ?? t.goodRatios?.[k] ?? 4;
    return r > 0 ? r : 4;
  };
  const side = (res: readonly number[], com: readonly number[]): BasketGood[] => {
    const out: BasketGood[] = [];
    for (let i = 1; i <= 5; i++) {
      const n = res[i] ?? 0;
      if (n > 0) out.push({ com: false, idx: i, n, rate: resRate(i) });
    }
    for (let i = 0; i <= 2; i++) {
      const n = com[i] ?? 0;
      if (n > 0) out.push({ com: true, idx: i, n, rate: comRate(i) });
    }
    return out;
  };
  const give = side(t.giveRes, t.giveCom);
  const want = side(t.wantRes, t.wantCom);
  if (!give.length || !want.length) return null;
  // No commodity anywhere is the base bank lane, with its own planner and command.
  if (!give.some((g) => g.com) && !want.some((g) => g.com)) return null;

  const overlap = give.some((g) => want.some((w) => w.com === g.com && w.idx === g.idx));
  const wantTotal = want.reduce((a, w) => a + w.n, 0);
  let funded = 0;
  let stranded = 0;
  for (const g of give) {
    funded += Math.floor(g.n / g.rate);
    stranded += g.n % g.rate;
  }
  const consistent = !overlap && wantTotal >= 1 && stranded === 0 && funded === wantTotal;
  const held = (g: BasketGood) => (g.com ? (t.commodities?.[g.idx] ?? 0) : (t.hand?.[g.idx] ?? 0));
  // Each output comes from its own pile: a resource from the bank, a commodity
  // from its supply stack. A missing supply array means unknown, which stays
  // permissive.
  const supplied = (w: BasketGood) =>
    w.com ? (t.commoditySupply?.[w.idx] ?? Infinity) >= w.n : (t.bank?.[w.idx] ?? 0) >= w.n;
  const ok = consistent && give.every((g) => held(g) >= g.n) && want.every(supplied);

  const pack = (goods: BasketGood[]) => {
    const res = [0, 0, 0, 0, 0, 0];
    const com = [0, 0, 0];
    for (const g of goods) (g.com ? com : res)[g.idx] = g.n;
    return { res, com };
  };
  const g = pack(give);
  const w = pack(want);
  return {
    give,
    want,
    wantTotal,
    funded,
    stranded,
    overlap,
    consistent,
    ok,
    cmd: {
      type: "commodity_trade",
      data: { spend_res: g.res, spend_com: g.com, want_res: w.res, want_com: w.com },
    },
  };
}

/**
 * commodityTrade plans a Knights bank trade where at least one side is a
 * commodity, choosing the cheaper of the server's two lanes:
 *
 * - `commodity_trade`, the maritime lane, priced at the give good's own rate
 *   (4:1, 3:1 with a generic port, 2:1 with a Merchant Fleet naming it). Any
 *   number of units in one command.
 * - `trading_house`, the Trade level 3 ability: 2 of one commodity for any one
 *   other good, one good at a time.
 *
 * At Trade 3 the Trading House is never worse than the maritime rate (which
 * bottoms out at 2:1), so a commodity give always routes there. `good_ratios`
 * publishes the cheapest lane, so this only quotes it on the lane that
 * honours it.
 *
 * Returns null unless the trade is one kind in and one kind out with a
 * commodity on at least one side (resource to resource is the base lane), or
 * when give and get are the same good.
 */
export function commodityTrade(t: {
  give: GoodRef;
  giveN: number; // how many of the give kind are staged
  want: GoodRef;
  wantN: number; // how many of the want kind are asked for
  bankRatios?: readonly number[]; // resource rates, index 1..5
  goodRatios?: Record<string, number>; // commodity rates, keyed by wire name
  tradeLevel?: number; // the player's Trade improvement level
  hand?: readonly number[];
  commodities?: readonly number[];
  bank?: readonly number[];
  /** Remaining cards per commodity stack, the commodity side of `bank`. */
  commoditySupply?: readonly number[];
}): CommodityPlan | null {
  const { res: giveRes, com: giveCom } = t.give;
  const { res: getRes, com: getCom } = t.want;
  // Exactly one kind per side, at least one a commodity: resource to resource
  // belongs to the base bank lane.
  if ((giveRes == null) === (giveCom == null)) return null;
  if ((getRes == null) === (getCom == null)) return null;
  if (giveCom == null && getCom == null) return null;
  // Can't buy back what you're spending (both server lanes reject it).
  if (giveCom != null && getCom === giveCom) return null;
  if (giveRes != null && getRes === giveRes) return null;
  if (t.wantN < 1) return null;

  const house = giveCom != null && (t.tradeLevel ?? 0) >= TRADING_HOUSE_LEVEL;
  const ratio = house
    ? TRADING_HOUSE_COST
    : giveCom != null
      ? (t.goodRatios?.[COMMODITY_KEYS[giveCom]] ?? 4)
      : (t.bankRatios?.[giveRes!] ?? 4);
  // The Trading House gives one good per use, so it can only fund a single
  // unit. A bigger ask is marked inconsistent and the caller shows the deal it
  // would do; repeating costs only clicks since every unit is 2:1.
  const getN = house ? 1 : t.wantN;
  const giveNeeded = ratio * getN;
  const consistent = t.wantN === getN && t.giveN === giveNeeded;

  const held = giveCom != null ? (t.commodities?.[giveCom] ?? 0) : (t.hand?.[giveRes!] ?? 0);
  // Both outputs come from a finite pile, and either being short is refused by
  // the server. A missing supply array means unknown, which stays permissive.
  const supplied =
    getRes != null
      ? (t.bank?.[getRes] ?? 0) >= getN
      : (t.commoditySupply?.[getCom!] ?? Infinity) >= getN;
  const ok = consistent && held >= giveNeeded && supplied;

  const out: Record<string, number> = getRes != null ? { get_res: getRes } : { get_com: getCom! };
  const cmd = house
    ? { type: "trading_house", data: { give: giveCom, ...out } }
    : {
        type: "commodity_trade",
        data: {
          ...(giveCom != null ? { give_com: giveCom } : { give_res: giveRes! }),
          ...out,
          count: getN,
        },
      };
  return {
    lane: house ? "trading_house" : "commodity_trade",
    ratio,
    getN,
    giveNeeded,
    consistent,
    ok,
    cmd,
  };
}
