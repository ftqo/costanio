import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RiverCoinsPanel } from "./RiverCoinsPanel";
import { coinTrades } from "@/lib/rivers";
import type { FullView } from "@/lib/types";

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

/**
 * Offers are built by the real `coinTrades` over a fake view, as
 * `FishSpendPanel.test.tsx` does with `fishOffers`, so the tests cover which
 * rows the rules leave live, not just markup.
 */
function view(over: Record<string, unknown> = {}, bank = [0, 19, 19, 19, 19, 19]): FullView {
  return {
    ext: { rivers: { coins: [4], coin_per_res: 2, spends_left: 2, ...over } },
    bank,
    bank_ratios: [0, 4, 3, 2, 4, 4],
  } as unknown as FullView;
}

interface Sent {
  kind: "buy" | "spend";
  idx: number;
}

function render(v: FullView, held = 4, onTurn = true) {
  const sent: Sent[] = [];
  act(() =>
    root.render(
      <RiverCoinsPanel
        trades={coinTrades(v, 0, () => held, onTurn)}
        onBuy={(idx) => sent.push({ kind: "buy", idx })}
        onSpend={(idx) => sent.push({ kind: "spend", idx })}
        onClose={() => {}}
      />,
    ),
  );
  return sent;
}

const q = (sel: string) => document.body.querySelector<HTMLButtonElement>(sel);
const buy = (res: string) => q(`[data-rivers-buy="${res}"]`)!;
const spend = (res: string) => q(`[data-rivers-spend="${res}"]`)!;
const click = (el: HTMLElement) => act(() => el.click());

describe("coin rate", () => {
  it("prices each resource at this seat's own ratio", () => {
    // Four for wood, three at a generic harbour, two at ore's own: one command,
    // three prices.
    render(view());
    expect(buy("wood").textContent).toContain("4 for 1");
    expect(buy("brick").textContent).toContain("3 for 1");
    // Two, not three: a coin is priced at the seat's own harbour rate for what
    // it gives, 2:1 included.
    expect(buy("sheep").textContent).toContain("2 for 1");
  });

  it("disables but keeps an unaffordable row", () => {
    // Holding three of everything: the 4:1 rows are short, the 3:1 and 2:1 rows
    // aren't. Drawn rather than hidden, because the price is the plan.
    render(view(), 3);
    expect(buy("wood").disabled).toBe(true);
    expect(buy("brick").disabled).toBe(false);
    expect(buy("sheep").disabled).toBe(false);
  });

  it("sends the resource the row names", () => {
    const sent = render(view());
    click(buy("ore"));
    expect(sent).toEqual([{ kind: "buy", idx: 5 }]);
  });
});

describe("spending coins", () => {
  it("is open while the coins and the cap both allow it", () => {
    const sent = render(view());
    expect(spend("wheat").disabled).toBe(false);
    click(spend("wheat"));
    expect(sent).toEqual([{ kind: "spend", idx: 4 }]);
  });

  it("closes on the cap and says so", () => {
    // The two-a-turn cap must be stated; nothing else on screen shows it.
    render(view({ spends_left: 0 }));
    expect(spend("wheat").disabled).toBe(true);
    expect(document.body.textContent).toContain("already bought twice this turn");
  });

  it("counts down what is left of the two", () => {
    render(view({ spends_left: 1 }));
    expect(document.body.textContent).toContain("1 of 2 left this turn");
  });

  it("closes on a short coin count", () => {
    render(view({ coins: [1] }));
    expect(spend("wheat").disabled).toBe(true);
    // Five disabled rows need a reason; being short is the usual one.
    expect(document.body.textContent).toContain("Each costs 2 coins, and you have 1");
    // The sale stays open: being short of coins is the reason to sell.
    expect(buy("sheep").disabled).toBe(false);
  });

  it("disables only resources the bank lacks, showing the stock", () => {
    // An empty bank stack refuses the purchase and spends no coins, so it is
    // drawn; one empty stack must not close the other four.
    render(view({}, [0, 0, 19, 19, 19, 19]));
    expect(spend("wood").disabled).toBe(true);
    expect(spend("wood").textContent).toContain("0 left");
    expect(spend("brick").disabled).toBe(false);
  });
});

describe("off turn", () => {
  it("goes dark on both halves at once", () => {
    // Both trades go through RequireActionableTurn, so a panel left open across
    // a lost turn offers neither.
    render(view(), 9, false);
    for (const res of ["wood", "brick", "sheep", "wheat", "ore"]) {
      expect(buy(res).disabled, res).toBe(true);
      expect(spend(res).disabled, res).toBe(true);
    }
  });
});

describe("the coin count", () => {
  it("is drawn as a number", () => {
    // Coins sit outside the hand limit, aren't discarded on a 7 and can't be
    // stolen, so they aren't drawn as a pile of cards.
    render(view({ coins: [7] }));
    expect(
      document.body.querySelector("[data-rivers-coins]")?.getAttribute("data-rivers-coins"),
    ).toBe("7");
    expect(document.body.textContent).toContain("7 coins");
  });
});

describe("alongside Knights, commodities sell for coins", () => {
  function renderGoods(commodities: number[]) {
    const v = {
      ...view(),
      good_maritime_ratios: { cloth: 4, paper: 3, coin: 4 },
      ext: {
        rivers: { coins: [4], coin_per_res: 2, spends_left: 2 },
        cak: { players: [{ commodities }] },
      },
    } as unknown as FullView;
    const sold: string[] = [];
    act(() =>
      root.render(
        <RiverCoinsPanel
          trades={coinTrades(v, 0, () => 0, true)}
          onBuy={() => {}}
          onSpend={() => {}}
          onSellGood={(g) => sold.push(g)}
          onClose={() => {}}
        />,
      ),
    );
    return sold;
  }
  it("as rows priced 'N for 1'", () => {
    // The Knights commodity is called Coin, so "Coin 4:1" in a panel titled
    // Coins would read as coins for coins.
    renderGoods([4, 1, 0]);
    const cloth = q('[data-rivers-good="cloth"]')!;
    expect(cloth.textContent).toContain("4 for 1");
    expect(cloth.textContent).not.toContain(":1");
    expect(cloth.disabled).toBe(false);
    expect(q('[data-rivers-good="paper"]')!.disabled).toBe(true);
    expect(document.body.querySelector("[data-rivers-goods]")?.textContent).toMatch(
      /Sell a commodity for a coin/,
    );
  });
  it("sends the commodity the row names", () => {
    const sold = renderGoods([4, 1, 0]);
    click(q('[data-rivers-good="cloth"]')!);
    expect(sold).toEqual(["cloth"]);
  });
  it("every row is a 40px touch target", () => {
    renderGoods([4, 1, 0]);
    for (const b of document.body.querySelectorAll(
      "[data-rivers-good], [data-rivers-buy], [data-rivers-spend]",
    )) {
      // Cells are 58px tall (art over a rate); the floor that matters is 40px,
      // so any min-height class at or above it holds.
      const floor = [...b.classList]
        // min-h-N is the spacing scale (N x 4px); min-h-[Npx] an arbitrary px.
        .map((c) => {
          const scale = /^min-h-(\d+(?:\.\d+)?)$/.exec(c)?.[1];
          if (scale) return Number(scale) * 4;
          return Number(/^min-h-\[(\d+)px\]$/.exec(c)?.[1] ?? 0);
        })
        .reduce((a, x) => Math.max(a, x), 0);
      expect(floor).toBeGreaterThanOrEqual(40);
    }
  });
});
