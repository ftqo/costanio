import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RaidersGoldPanel } from "./RaidersGoldPanel";
import { goldBuyOffers, goldSellOffers } from "@/lib/raiders";
import type { FullView, Hand } from "@/lib/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

/** The thinnest view the two offer builders read: a bank and a gold column. */
const view = (gold: number, buysLeft: number, bank: number[], ratios?: number[]) =>
  ({
    ext: { raiders: { gold: [gold, 0], gold_buys_left: buysLeft } },
    bank,
    bank_ratios: ratios,
    players: [{ seat: 0 }, { seat: 1 }],
  }) as unknown as FullView;

const FULL_BANK = [0, 5, 5, 5, 5, 5];

function render(opts: {
  gold?: number;
  buysLeft?: number;
  bank?: number[];
  ratios?: number[];
  hand?: Hand;
  onBuy?: (res: number) => void;
  onSell?: (res: number) => void;
}) {
  const gold = opts.gold ?? 6;
  const buysLeft = opts.buysLeft ?? 2;
  const v = view(gold, buysLeft, opts.bank ?? FULL_BANK, opts.ratios);
  act(() =>
    root.render(
      <RaidersGoldPanel
        gold={gold}
        buysLeft={buysLeft}
        buys={goldBuyOffers(v, 0)}
        sells={goldSellOffers(v, opts.hand ?? ([0, 0, 0, 0, 0, 0] as Hand))}
        onBuy={opts.onBuy ?? (() => {})}
        onSell={opts.onSell ?? (() => {})}
        onClose={() => {}}
      />,
    ),
  );
  return document.body;
}

const buyBtn = (res: number) =>
  document.body.querySelector(`[data-raiders-buy="${res}"]`) as HTMLButtonElement;
const sellBtn = (res: number) =>
  document.body.querySelector(`[data-raiders-sell="${res}"]`) as HTMLButtonElement;

describe("buying a resource for gold", () => {
  it("offers all five resources", () => {
    render({ gold: 0 });
    for (const res of [1, 2, 3, 4, 5]) expect(buyBtn(res), `res ${res}`).toBeTruthy();
  });

  // The engine checks the bank before taking the gold, so trying an empty
  // stack costs nothing; the row stays so the player can see why.
  it("refuses the row the bank cannot fill, and keeps it on screen", () => {
    render({ gold: 6, bank: [0, 5, 5, 0, 5, 5] });
    expect(buyBtn(1).disabled).toBe(false);
    expect(buyBtn(3)).toBeTruthy();
    expect(buyBtn(3).disabled).toBe(true);
  });

  it("disables all rows after two buys and names the rule", () => {
    render({ gold: 20, buysLeft: 0 });
    for (const res of [1, 2, 3, 4, 5]) expect(buyBtn(res).disabled, `res ${res}`).toBe(true);
    expect(document.body.querySelector("[data-raiders-buys-left]")?.textContent).toContain(
      "already bought twice",
    );
  });

  it("refuses every row below the price of two gold", () => {
    render({ gold: 1 });
    for (const res of [1, 2, 3, 4, 5]) expect(buyBtn(res).disabled, `res ${res}`).toBe(true);
  });

  it("sends the resource that was pressed, and nothing for a refused row", () => {
    const sent: number[] = [];
    render({ gold: 6, bank: [0, 5, 0, 5, 5, 5], onBuy: (r) => sent.push(r) });
    act(() => buyBtn(1).click());
    act(() => buyBtn(2).click());
    expect(sent).toEqual([1]);
  });
});

describe("selling resources for gold", () => {
  // Strictly worse than the 4:1 bank trade (two gold buy a resource) but in the
  // rules (docs/rules/raiders.md), so it is offered.
  it("prices a sale at four and offers only held resources", () => {
    render({ hand: [0, 0, 0, 4, 3, 0] as Hand });
    expect(sellBtn(3).disabled).toBe(false);
    expect(sellBtn(4).disabled).toBe(true);
    expect(sellBtn(3).textContent).toContain("4 for 1 gold");
  });

  // Each resource uses the server’s own maritime rate.
  it("prices each sale using its resource-specific harbour rate", () => {
    render({ hand: [0, 3, 0, 0, 0, 0] as Hand, ratios: [0, 3, 3, 3, 3, 3] });
    expect(sellBtn(1).disabled).toBe(false);
    expect(sellBtn(1).textContent).toContain("3 for 1 gold");

    act(() => root.unmount());
    root = createRoot(host);
    // A specific wood harbour quotes two wood for one gold.
    render({ hand: [0, 3, 0, 0, 0, 0] as Hand, ratios: [0, 2, 4, 4, 4, 4] });
    expect(sellBtn(1).disabled).toBe(false);
    expect(sellBtn(1).textContent).toContain("2 for 1 gold");
  });

  it("sends the resource that was pressed", () => {
    const sent: number[] = [];
    render({ hand: [0, 0, 0, 0, 0, 9] as Hand, onSell: (r) => sent.push(r) });
    act(() => sellBtn(5).click());
    act(() => sellBtn(1).click());
    expect(sent).toEqual([5]);
  });
});

describe("gold explanation", () => {
  // Gold is a counter, not a card: not counted toward the 7-discard, can't be
  // stolen, invisible to effects naming resource cards. Never drawn as a card,
  // and the rule is stated since nothing else shows it.
  it("shows the counter and states that it is not a card", () => {
    const body = render({ gold: 7 });
    expect(body.querySelector("[data-raiders-gold]")?.getAttribute("data-raiders-gold")).toBe("7");
    expect(body.textContent).toContain("not a card");
  });
});

// Gold draws the bullion glyph (it has no baked slot), never the Rivers coin.
describe("the gold glyph", () => {
  it("draws the bars on the purse chip", () => {
    render({ gold: 6 });
    expect(
      document.body.querySelector('[data-raiders-gold] svg[data-glyph="gold"]'),
    ).not.toBeNull();
  });
});
