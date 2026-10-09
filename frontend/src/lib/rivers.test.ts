import { describe, it, expect } from "vitest";
import {
  bridgeCost,
  bridgeSupply,
  buyoutWealthCost,
  coinTrades,
  isPoorest,
  PILLAGE_BUYOUT_COINS,
  pillageBuyoutOffer,
  poorestInPlay,
  poorestVP,
  seatBridgesLeft,
  seatCoins,
  wealthiestSeat,
  wealthiestVP,
} from "./rivers";
import type { FullView } from "./types";

/** The thinnest view these helpers actually read. */
function view(over: {
  rivers?: Record<string, unknown> | undefined;
  bank?: number[];
  ratios?: number[];
}): FullView {
  return {
    ext: over.rivers === undefined ? {} : { rivers: over.rivers },
    bank: over.bank ?? [0, 19, 19, 19, 19, 19],
    bank_ratios: over.ratios,
  } as unknown as FullView;
}

/** A hand that holds `n` of everything. */
const flat = (n: number) => () => n;

describe("reading a seat off the wire", () => {
  it("answers zero for a game with no Rivers in it, never undefined", () => {
    // Readouts get a number, never undefined. A base game has no coins.
    const v = view({});
    expect(seatCoins(v, 0)).toBe(0);
    expect(seatBridgesLeft(v, 0)).toBe(0);
    expect(wealthiestSeat(v)).toBe(-1);
    expect(isPoorest(v, 0)).toBe(false);
    expect(poorestInPlay(v)).toBe(false);
  });

  it("reads each seat's own row, and a spectator's -1 seat as nothing", () => {
    const v = view({ rivers: { coins: [3, 0, 8], bridges_left: [1, 3, 2] } });
    expect(seatCoins(v, 2)).toBe(8);
    expect(seatBridgesLeft(v, 0)).toBe(1);
    // A spectator is -1, and `coins[-1]` is silently undefined.
    expect(seatCoins(v, -1)).toBe(0);
    expect(seatBridgesLeft(v, -1)).toBe(0);
  });

  it("lets several seats hold the Poorest tile", () => {
    // One tile per seat, so several (at setup, all) can hold one.
    const v = view({ rivers: { poorest: [true, false, true], poorest_in_play: true } });
    expect(isPoorest(v, 0)).toBe(true);
    expect(isPoorest(v, 1)).toBe(false);
    expect(isPoorest(v, 2)).toBe(true);
  });

  it("says nobody holds the Wealthiest tile on a tie", () => {
    // -1 is the wire's answer (engine.NoPlayer): with no single leader the tile
    // goes back to the supply.
    expect(wealthiestSeat(view({ rivers: { wealthiest: -1 } }))).toBe(-1);
    expect(wealthiestSeat(view({ rivers: { wealthiest: 2 } }))).toBe(2);
  });

  it("takes the tiles' point values off the wire", () => {
    const v = view({ rivers: { wealthiest_vp: 1, poorest_vp: -2 } });
    expect(wealthiestVP(v)).toBe(1);
    expect(poorestVP(v)).toBe(-2);
  });
});

describe("the bridge's price and supply", () => {
  it("reads the value from the wire", () => {
    const v = view({ rivers: { bridge_cost: [0, 1, 2, 0, 0, 0], bridge_supply: 3 } });
    expect(bridgeCost(v)).toEqual({ 1: 1, 2: 2 });
    expect(bridgeSupply(v)).toBe(3);
  });

  it("falls back to the default price", () => {
    // The fallback lets a client newer than its server still show a price; it
    // matches the engine's 2 brick + 1 lumber.
    expect(bridgeCost(view({}))).toEqual({ 2: 2, 1: 1 });
    expect(bridgeSupply(view({}))).toBe(3);
    // An all-zero hand is a malformed frame, not a free bridge.
    expect(bridgeCost(view({ rivers: { bridge_cost: [0, 0, 0, 0, 0, 0] } }))).toEqual({
      2: 2,
      1: 1,
    });
  });
});

describe("what a coin can be traded for", () => {
  const rivers = { coins: [5], coin_per_res: 2, spends_left: 2 };

  it("prices a sale at this seat's rate per resource", () => {
    // The coin costs the seat's own maritime rate (4:1, or 3:1 / 2:1 at a
    // port), which nothing else on screen shows. There is no floor, so the
    // sheep harbour really is worth 2.
    const v = view({ rivers, ratios: [0, 4, 3, 2, 4, 4] });
    const { buys } = coinTrades(v, 0, flat(3), true);
    expect(buys.map((b) => b.ratio)).toEqual([4, 3, 2, 4, 4]);
    // Three of everything: the 4:1 rows are short, the 3:1 and the 2:1 are not.
    expect(buys.map((b) => b.ok)).toEqual([false, true, true, false, false]);
    // Two cards suffice at the 2:1 harbour and nowhere else.
    const tight = coinTrades(v, 0, flat(2), true);
    expect(tight.buys.map((b) => b.ok)).toEqual([false, false, true, false, false]);
  });

  it("quotes 4 when the view sent no rates at all", () => {
    // A spectator, or an older server. Four (no harbour) is the safe guess.
    const { buys } = coinTrades(view({ rivers }), 0, flat(4), true);
    expect(buys.map((b) => b.ratio)).toEqual([4, 4, 4, 4, 4]);
    expect(buys.every((b) => b.ok)).toBe(true);
  });

  it("prices a sale against the hand minus staged cards", () => {
    // The optimistic spend overlay: a brick already committed to a staged
    // settlement must not buy a coin (as with `costShortfall`).
    const v = view({ rivers, ratios: [0, 4, 4, 4, 4, 4] });
    expect(coinTrades(v, 0, flat(4), true).buys[0].ok).toBe(true);
    expect(coinTrades(v, 0, flat(3), true).buys[0].ok).toBe(false);
  });

  it("closes both halves off-turn", () => {
    // Both trades go through RequireActionableTurn, so off turn every row is
    // refused.
    const v = view({ rivers, ratios: [0, 2, 2, 2, 2, 2] });
    const off = coinTrades(v, 0, flat(9), false);
    expect(off.buys.some((b) => b.ok)).toBe(false);
    expect(off.spends.some((s) => s.ok)).toBe(false);
  });

  it("stops the spend at the two-a-turn cap", () => {
    const v = (left: number) =>
      coinTrades(view({ rivers: { ...rivers, spends_left: left } }), 0, flat(9), true);
    expect(v(2).spends.every((s) => s.ok)).toBe(true);
    expect(v(1).spends.every((s) => s.ok)).toBe(true);
    expect(v(0).spends.some((s) => s.ok)).toBe(false);
    expect(v(0).spendsLeft).toBe(0);
  });

  it("stops the spend when the coins run short of the price", () => {
    const at = (coins: number) =>
      coinTrades(view({ rivers: { ...rivers, coins: [coins] } }), 0, flat(9), true);
    expect(at(2).spends.every((s) => s.ok)).toBe(true);
    expect(at(1).spends.some((s) => s.ok)).toBe(false);
    expect(at(0).coins).toBe(0);
  });

  it("refuses only the resource the bank has run out of", () => {
    // Refused per resource when the bank lacks it, so one empty stack must not
    // close the other four.
    const v = view({ rivers, bank: [0, 0, 5, 5, 5, 5] });
    const { spends } = coinTrades(v, 0, flat(9), true);
    expect(spends[0].stock).toBe(0);
    expect(spends[0].ok).toBe(false);
    expect(spends.slice(1).every((s) => s.ok)).toBe(true);
  });

  it("lists all five rows", () => {
    const { buys, spends } = coinTrades(view({ rivers }), 0, flat(0), true);
    expect(buys).toHaveLength(5);
    expect(spends).toHaveLength(5);
    expect(buys.map((b) => b.idx)).toEqual([1, 2, 3, 4, 5]);
  });
});

// Rivers alongside Knights: 5 coins keep a city the barbarians came for. The
// offer needs the seat to owe one, a module to sell one, and the coins; each is
// tested separately.
describe("the pillage buyout offer", () => {
  const owing = (seats: number[], coins: number[]) =>
    ({
      ext: { cak: { barbarian_downgrade: seats }, rivers: { coins } },
      bank: [0, 19, 19, 19, 19, 19],
    }) as unknown as FullView;

  it("offers the seat that owes a city, and nobody else", () => {
    const v = owing([1], [9, 9, 9, 9]);
    expect(pillageBuyoutOffer(v, 1, true).offered).toBe(true);
    expect(pillageBuyoutOffer(v, 0, true).offered).toBe(false);
    // A spectator's -1 is never in the pending list, so no guard is needed.
    expect(pillageBuyoutOffer(v, -1, true).offered).toBe(false);
  });

  it("offers nothing where no module sells a buyout", () => {
    // base+cak: the debt exists but no way out. Mirrors engine.HasPillageBuyout,
    // a ruleset question.
    expect(pillageBuyoutOffer(owing([1], [9, 9, 9, 9]), 1, false).offered).toBe(false);
  });

  it("offers nothing when no city is owed at all", () => {
    expect(pillageBuyoutOffer(owing([], [9, 9, 9, 9]), 1, true).offered).toBe(false);
  });

  it("separates being offered from being able to pay", () => {
    // A seat one coin short is still offered, so the prompt can explain the
    // dead button and name the alternative (give up a city).
    const short = pillageBuyoutOffer(owing([1], [0, PILLAGE_BUYOUT_COINS - 1, 0, 0]), 1, true);
    expect(short.offered).toBe(true);
    expect(short.afford).toBe(false);
    const exact = pillageBuyoutOffer(owing([1], [0, PILLAGE_BUYOUT_COINS, 0, 0]), 1, true);
    expect(exact.afford).toBe(true);
  });
});

// The buyout can cost more than it saves: a Wealthiest Settler holder dropping
// to zero coins goes from +1 to -2. The dialog warns first.
describe("what the pillage buyout costs in wealth tiles", () => {
  const riv = (coins: number[], wealthiest: number, poorest: boolean[]) =>
    view({ rivers: { coins, wealthiest, poorest, poorest_in_play: true } });

  it("warns the leader who would drop to the bottom", () => {
    const c = buyoutWealthCost(riv([1, 5, 0], 1, [false, false, true]), 1);
    expect(c).toEqual({ losesWealthiest: true, gainsPoorest: true, after: 0 });
  });

  it("says nothing when the seat stays ahead", () => {
    const c = buyoutWealthCost(riv([1, 9, 2], 1, [true, false, false]), 1);
    expect(c.losesWealthiest).toBe(false);
    expect(c.gainsPoorest).toBe(false);
  });

  it("skips held or absent Poorest tiles", () => {
    expect(buyoutWealthCost(riv([5, 7], 1, [true, false]), 0).gainsPoorest).toBe(false);
    const off = view({ rivers: { coins: [5, 7], wealthiest: 1, poorest: [] } });
    expect(buyoutWealthCost(off, 0).gainsPoorest).toBe(false);
  });
});
