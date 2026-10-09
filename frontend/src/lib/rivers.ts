// Rivers, as the game screen needs it: coins, the two wealth tiles, and what a
// coin can be traded for right now.
//
// Pure, reading only `ext.rivers` and the viewer's hand, so the coins panel and
// its tests need no socket or DOM (modelled on lib/fish).
//
// Coin prices come from `view.bank_ratios`: the engine prices the purchase
// through `s.BankRatio`, like a maritime trade, harbours and module overrides
// included. Do not re-derive it from the board's harbours.
import { knightsExt, riversExt, type Edge, type FullView } from "./types";
import { edgeKey } from "./hexgeo";

/**
 * The maritime rate when the view has not sent one.
 *
 * A spectator gets no `bank_ratios`, nor does an older server. Four (no
 * harbour) is the worst case and so the safe quote.
 */
const NO_HARBOR_RATIO = 4;

/** What a bridge costs when the view has not said. Mirrors `rivers.CostBridge`. */
const FALLBACK_BRIDGE_COST: Record<number, number> = { 2: 2, 1: 1 };

/** How many bridges a player may ever build, when the view has not said. */
const FALLBACK_BRIDGE_SUPPLY = 3;

/**
 * What it costs to keep a city the barbarians came for. Mirrors
 * `rivers.CoinsPerPillageBuyout`.
 *
 * Not on the wire: the offer is a rule of the Knights pairing, and the resolving
 * event carries only the seat. The client needs it to show the price before the
 * tap, so one constant serves the offer and the log row. The engine refuses a
 * seat that cannot pay (`NO_COINS`) regardless.
 */
export const PILLAGE_BUYOUT_COINS = 5;

/**
 * Whether seat `seat` is being offered the pillage buyout, and whether it can
 * pay for it.
 *
 * `owed` comes from the wire (`ext.cak.barbarian_downgrade`), `sold` from the
 * ruleset (only Rivers sells one, per `engine.HasPillageBuyout`), and `afford`
 * is arithmetic. Pure so it can be tested without the game screen.
 *
 * Affordability is advisory: the engine refuses a short seat with NO_COINS, and
 * a seat that is not owed with a bad-command error.
 */
export function pillageBuyoutOffer(
  view: FullView,
  seat: number,
  sold: boolean,
): { offered: boolean; afford: boolean } {
  // No `seat >= 0` guard needed: `owed` only ever lists real seats.
  const owed = (knightsExt(view)?.barbarian_downgrade ?? []).includes(seat);
  return {
    offered: owed && sold,
    afford: seatCoins(view, seat) >= PILLAGE_BUYOUT_COINS,
  };
}

/**
 * What paying the pillage buyout would do to seat `seat`'s wealth tiles.
 *
 * Coins decide the two Rivers tiles, so the 5-coin buyout can cost more than
 * the city it saves (a city is +1 over a settlement, Wealthiest Settler +1,
 * Poorest Settler -2). The dialog warns before the tap.
 *
 * Derived from public coin counts as the engine does (strict leader holds
 * Wealthiest; everyone tied for fewest holds a Poorest, when that tile is in
 * play). Advisory only.
 */
export function buyoutWealthCost(
  view: FullView,
  seat: number,
): { losesWealthiest: boolean; gainsPoorest: boolean; after: number } {
  const x = riversExt(view);
  const coins = x?.coins ?? [];
  const after = Math.max(0, (coins[seat] ?? 0) - PILLAGE_BUYOUT_COINS);
  const others = coins.filter((_, i) => i !== seat);
  const holdsWealthiest = (x?.wealthiest ?? -1) === seat;
  const stillLeads = others.every((c) => after > c);
  const heldPoorest = !!x?.poorest?.[seat];
  const fewest = others.length > 0 && others.every((c) => after <= c);
  return {
    losesWealthiest: holdsWealthiest && !stillLeads,
    gainsPoorest: !!x?.poorest_in_play && !heldPoorest && fewest,
    after,
  };
}

/** Seat `seat`'s coin count. Public: every seat may read every seat's. */
export function seatCoins(view: FullView, seat: number): number {
  const coins = riversExt(view)?.coins;
  return seat >= 0 ? (coins?.[seat] ?? 0) : 0;
}

/** Bridges seat `seat` has left of its three. */
export function seatBridgesLeft(view: FullView, seat: number): number {
  const left = riversExt(view)?.bridges_left;
  return seat >= 0 ? (left?.[seat] ?? 0) : 0;
}

/** How many bridges a player gets in total, so "1 of 3" needs no constant here. */
export function bridgeSupply(view: FullView): number {
  return riversExt(view)?.bridge_supply ?? FALLBACK_BRIDGE_SUPPLY;
}

/**
 * What a bridge costs, in the shape the build shelf prices everything else in.
 *
 * From the wire (`ext.rivers.bridge_cost`) rather than `lib/costs`, so it
 * cannot drift from what the server charges. The fallback is for older
 * servers.
 */
export function bridgeCost(view: FullView): Record<number, number> {
  const hand = riversExt(view)?.bridge_cost;
  if (!hand) return FALLBACK_BRIDGE_COST;
  const out: Record<number, number> = {};
  hand.forEach((n, idx) => {
    if (idx > 0 && n > 0) out[idx] = n;
  });
  return Object.keys(out).length ? out : FALLBACK_BRIDGE_COST;
}

/**
 * Every bridge site on the board, by `edgeKey`.
 *
 * From the flat `sites` list (the chains are watercourses; this is the set an
 * edge is tested against). Empty when Rivers is off.
 */
export function bridgeSiteKeys(view: FullView): Set<string> {
  return new Set((riversExt(view)?.sites ?? []).map(edgeKey));
}

/**
 * Whether the channel crosses this edge, so only a bridge may stand on it.
 *
 * As with `isBoatEdge` for ships: a bridge is impossible on almost every edge,
 * so the action is only offered where one could ever go.
 */
export function isBridgeSite(view: FullView, e: Edge): boolean {
  return bridgeSiteKeys(view).has(edgeKey(e));
}

/** The seat holding the Wealthiest Settler tile, or -1 when a tie means nobody. */
export function wealthiestSeat(view: FullView): number {
  return riversExt(view)?.wealthiest ?? -1;
}

/** Whether seat `seat` holds a Poorest Settler tile. Several seats can. */
export function isPoorest(view: FullView, seat: number): boolean {
  return seat >= 0 && !!riversExt(view)?.poorest?.[seat];
}

/**
 * Whether this table plays with the Poorest Settler tile at all.
 *
 * Dropped alongside Wagons and Raiders, where the rail hides the row. Absent
 * reads as off, which is fine since an older server sends no `poorest` either.
 */
export function poorestInPlay(view: FullView): boolean {
  return !!riversExt(view)?.poorest_in_play;
}

/** The two tiles' victory contributions, as the engine publishes them. */
export function wealthiestVP(view: FullView): number {
  return riversExt(view)?.wealthiest_vp ?? 1;
}
export function poorestVP(view: FullView): number {
  return riversExt(view)?.poorest_vp ?? -2;
}

/** One resource the supply will take for a coin, and what it takes. */
export interface CoinBuy {
  /** Hand index, 1..5. */
  idx: number;
  /** Cards of it one coin costs: 4, 3 at a generic harbour, 2 at its own. */
  ratio: number;
  /** Cards of it the player can actually spend right now. */
  held: number;
  /** Affordable, and this seat may act. */
  ok: boolean;
}

/** One resource two coins will buy, and whether the supply still has it. */
export interface CoinSpend {
  idx: number;
  /** Cards left in the bank. Zero refuses the purchase and spends nothing. */
  stock: number;
  ok: boolean;
}

/** Everything the coins panel draws. */
export interface CoinTrades {
  coins: number;
  /** Coins one resource costs. Two, and published rather than assumed. */
  price: number;
  /** Purchases still available this turn, of the two a turn allows. */
  spendsLeft: number;
  buys: CoinBuy[];
  goods?: { key: string; idx: number; ratio: number; held: number; ok: boolean }[];
  spends: CoinSpend[];
}

/**
 * The two trades, priced against this seat's hand, harbours and turn.
 *
 * `held` is passed in, as with `costShortfall`, because the shelf subtracts an
 * optimistic spend overlay the view does not know about yet.
 *
 * `onTurn` folds in the seat's right to act so every row goes dark together;
 * both trades are turn actions (purchase as often as you like, spend twice a
 * turn).
 *
 * Every resource is listed, affordable or not: the buy rate differs per
 * resource and player and is shown nowhere else.
 *
 * There is no coin rate floor: a coin trades like any maritime trade (4:1, 3:1
 * or 2:1 on what you give), at the rate in `view.bank_ratios`
 * (`engine.State.CurrencyRatio`).
 */
export function coinTrades(
  view: FullView,
  seat: number,
  held: (idx: number) => number,
  onTurn: boolean,
): CoinTrades {
  const ext = riversExt(view);
  const coins = seatCoins(view, seat);
  const price = ext?.coin_per_res ?? 2;
  const spendsLeft = ext?.spends_left ?? 0;
  const buys: CoinBuy[] = [];
  const spends: CoinSpend[] = [];
  for (let idx = 1; idx <= 5; idx++) {
    const ratio = view.bank_ratios?.[idx] ?? NO_HARBOR_RATIO;
    const have = held(idx);
    buys.push({ idx, ratio, held: have, ok: onTurn && have >= ratio });
    const stock = view.bank?.[idx] ?? 0;
    spends.push({
      idx,
      stock,
      ok: onTurn && spendsLeft > 0 && coins >= price && stock > 0,
    });
  }
  const commodities = knightsExt(view)?.players?.[seat]?.commodities;
  const goods = ["cloth", "paper", "coin"].flatMap((key, idx) => {
    const ratio = view.good_maritime_ratios?.[key];
    if (!ratio || !commodities) return [];
    const have = commodities[idx] ?? 0;
    return [{ key, idx, ratio, held: have, ok: onTurn && have >= ratio }];
  });
  return { coins, price, spendsLeft, buys, spends, goods };
}
