import { describe, expect, test, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { WagonPanel } from "./WagonPanel";
import { CARGO, ROLE } from "@/lib/wagons";
import type { FullView, WagonsExt } from "@/lib/types";

i18n.load("en", {});
i18n.activate("en");

const TRADE = [
  {
    hex: { q: -2, r: 2 },
    role: ROLE.castle,
    plaza: { q: -2, r: 2, side: 2 },
    accepts: [CARGO.marble, CARGO.glass],
    ships: [CARGO.tools, CARGO.sand],
    left: 12,
  },
  {
    hex: { q: 0, r: -2 },
    role: ROLE.quarry,
    plaza: { q: 0, r: -2, side: 2 },
    accepts: [CARGO.tools],
    ships: [CARGO.marble, CARGO.sand],
    left: 12,
  },
  {
    hex: { q: 2, r: 0 },
    role: ROLE.glassworks,
    plaza: { q: 2, r: 0, side: 2 },
    accepts: [CARGO.sand],
    ships: [CARGO.glass, CARGO.tools],
    left: 12,
  },
];

const BASE: Partial<WagonsExt> = {
  has_trade: true,
  started: true,
  turn_seat: 0,
  barb_seat: -1,
  barb_index: -1,
  gold: [5],
  level: [1],
  cargo: [CARGO.none],
  delivered: [0],
  mp_track: [4, 5, 6, 7, 7],
  drive_floors: [7, 6, 5, 4, 3],
  gold_price: 2,
  buys_a_turn: 2,
  bought: 0,
  trade: TRADE,
  wagons: [{ player: 0, v: { q: 0, r: 0, side: 0 } }],
  barbarians: [
    { a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: 0, side: 1 } },
    { a: { q: 0, r: 0, side: 0 }, b: { q: 1, r: 0, side: 1 } },
    { a: { q: 2, r: 0, side: 0 }, b: { q: 2, r: 0, side: 1 } },
  ],
};

let container: HTMLDivElement | null = null;

function render(
  ext: Partial<WagonsExt>,
  handlers: Record<string, unknown> = {},
  ruleset = "base+wagons",
) {
  const view = {
    config: { ruleset },
    board: {
      tiles: [
        { hex: { q: -2, r: 2 }, res: "none", num: 0 },
        { hex: { q: 0, r: -2 }, res: "wheat", num: 6 },
        { hex: { q: 2, r: 0 }, res: "ore", num: 5 },
      ],
    },
    ext: { wagons: ext },
    players: [{ hand: [0, 4, 4, 4, 4, 4] }],
    bank: [0, 19, 19, 19, 19, 19],
    legal: { wagon_steps: [{ q: 1, r: 0, side: 0 }] },
  } as unknown as FullView;
  const el = document.createElement("div");
  document.body.appendChild(el);
  container = el;
  const noop = () => {};
  const root = createRoot(el);
  act(() => {
    root.render(
      <I18nProvider i18n={i18n}>
        <WagonPanel
          view={view}
          seat={0}
          onMove={noop}
          onHalt={noop}
          onBoost={noop}
          onCharge={noop}
          onUpgrade={noop}
          onBuy={noop}
          onSell={noop}
          onSwift={noop}
          {...handlers}
        />
      </I18nProvider>,
    );
  });
  return el;
}

afterEach(() => {
  if (container) container.remove();
  container = null;
});

const has = (el: HTMLElement, id: string) => !!el.querySelector(`[data-testid="${id}"]`);
const click = (el: HTMLElement, id: string) =>
  act(() => {
    (el.querySelector(`[data-testid="${id}"]`) as HTMLElement).click();
  });

describe("the wagon panel", () => {
  test("shows the two numbers a driver decides on", () => {
    const el = render(BASE);
    // Movement at level 1 is the track's first entry; gold decides whether an
    // opponent's road can be crossed.
    expect(el.textContent).toContain("4");
    expect(el.textContent).toContain("5");
  });

  // Level 1 can't drive off at any roll (the engine publishes 7, which no die
  // makes), so no buttons.
  test("offers only adjacent barbarians at a sufficient level", () => {
    expect(has(render(BASE), "wagon-charge-0")).toBe(false);
    const el = render({ ...BASE, level: [3] });
    expect(has(el, "wagon-charge-0")).toBe(true);
    expect(has(el, "wagon-charge-1")).toBe(true);
    expect(has(el, "wagon-charge-2")).toBe(false);
  });

  // Each barbarian may be tried once per turn, so the button disables after.
  test("a barbarian already tried this turn is not pressable again", () => {
    const el = render({ ...BASE, level: [3], tried: [true, false, false] });
    const first = el.querySelector('[data-testid="wagon-charge-0"]') as HTMLButtonElement;
    const second = el.querySelector('[data-testid="wagon-charge-1"]') as HTMLButtonElement;
    expect(first.disabled).toBe(true);
    expect(second.disabled).toBe(false);
  });

  test("the grain purchase disappears once it is spent", () => {
    expect(has(render(BASE), "wagon-boost")).toBe(true);
    expect(has(render({ ...BASE, boosted: true }), "wagon-boost")).toBe(false);
  });

  // Two purchases a turn, only while there is gold; both numbers come from the
  // ext.
  test("hides gold buys when gold or purchases run out", () => {
    expect(has(render(BASE), "wagon-buy")).toBe(true);
    expect(has(render({ ...BASE, gold: [1] }), "wagon-buy")).toBe(false);
    expect(has(render({ ...BASE, bought: 2 }), "wagon-buy")).toBe(false);
  });

  // Which resource gold buys, and which surplus the bank takes, are the
  // player's decision, so each opens a row and sends what was clicked.
  test("buying and selling ask which resource, and send it", () => {
    const onBuy = vi.fn();
    const el = render(BASE, { onBuy });
    expect(has(el, "wagon-resources")).toBe(false);
    click(el, "wagon-buy");
    expect(has(el, "wagon-resources")).toBe(true);
    click(el, "wagon-res-ore");
    expect(onBuy).toHaveBeenCalledWith("ore");
    // And the row closes behind it.
    expect(has(el, "wagon-resources")).toBe(false);
  });

  test("a Swift Journey is offered only to a seat holding one", () => {
    expect(has(render(BASE), "wagon-swift")).toBe(false);
    expect(has(render({ ...BASE, swift: 1 }), "wagon-swift")).toBe(true);
  });

  // The Swift Journey card shows nowhere else (not the hand, not the seat
  // card). It sits with the driving, and a card bought this turn says when it
  // will play.
  test("a held Swift Journey is outside the Upgrade and trade box", () => {
    const el = render({ ...BASE, swift: 1, moved: true, move_done: true });
    const btn = el.querySelector('[data-testid="wagon-swift"]')!;
    expect(btn.closest("details")).toBeNull();
    expect(el.querySelector('[data-testid="wagon-swift-held"]')!.textContent).toContain(
      "Swift Journeys in hand: 1",
    );
    const locked = render({ ...BASE, swift: 0, swift_new: 1 });
    expect(has(locked, "wagon-swift")).toBe(false);
    expect(locked.querySelector('[data-testid="wagon-swift-held"]')!.textContent).toContain(
      "from your next turn",
    );
  });

  test("always offers drive and stop", () => {
    const el = render(BASE);
    expect(has(el, "wagon-move")).toBe(true);
    expect(has(el, "wagon-halt")).toBe(true);
  });

  test("prompts an empty wagon to load", () => {
    expect(render(BASE).textContent).toContain("Empty");
  });
});

test("upgrading is unavailable during movement or at maximum level", () => {
  for (const ext of [
    { ...BASE, move_open: true },
    { ...BASE, level: [5] },
  ]) {
    const el = render(ext);
    expect(el.querySelector<HTMLButtonElement>('[data-testid="wagon-upgrade"]')?.disabled).toBe(
      true,
    );
  }
});

describe("where the trade hexes are", () => {
  // The trade hexes have no building yet, so the panel lists all three by
  // terrain and number and marks the one this load is for.
  test("lists the three by terrain, with the load's destination marked", () => {
    const el = render({ ...BASE, cargo: [CARGO.sand] });
    const list = el.querySelector('[data-testid="wagon-trade-hexes"]')!;
    expect(list.textContent).toContain("Castle");
    expect(list.textContent).toContain("desert");
    expect(list.textContent).toContain("wheat 6");
    const marked = list.querySelectorAll("[data-wagon-trade-target]");
    expect(marked).toHaveLength(1);
    // Sand goes to the glassworks, which this fixture puts on the ore 5.
    expect(marked[0].textContent).toContain("Glassworks");
    expect(marked[0].textContent).toContain("ore 5");
  });
});

describe("the +2 boost under Fishermen", () => {
  // Two fish buy the same +2 from the Fish tile, so the panel says so when
  // there is no wheat.
  test("says two fish buy it too, only where Fishermen is in play", () => {
    expect(render(BASE).querySelector('[data-testid="wagon-boost-fish"]')).toBeNull();
    const el = render(BASE, {}, "base+fishermen+wagons");
    expect(el.querySelector('[data-testid="wagon-boost-fish"]')?.textContent).toContain("two fish");
  });
});

// Rivers + Wagons share one purse, called coins elsewhere in that ruleset, so
// this panel calls it coins too.
test("under Rivers the purse is called coins, not gold", () => {
  const shared = render({ ...BASE, shared_currency: true });
  const purse = shared.querySelector("[data-wagon-purse]")!.textContent;
  expect(purse).toBe("5 coins");
  expect(shared.textContent).toContain("Buy a resource for 2 coins");
  expect(shared.textContent).toContain("Sell to the bank for coins");
  expect(shared.textContent).not.toMatch(/\bgold\b/i);

  const alone = render(BASE);
  expect(alone.querySelector("[data-wagon-purse]")!.textContent).toBe("5 gold");
});

// Buttons get a 40px floor (as sibling panels do via ScenarioDialog's
// `[&_button]:min-h-10`), and the spends are open rows, so there is no summary
// target.
test("every control is a 40px touch target", () => {
  const el = render({ ...BASE, cargo: [CARGO.sand] });
  const panel = el.querySelector<HTMLElement>('[data-testid="wagon-panel"]')!;
  expect(panel.className).toContain("[&_button]:min-h-10");
  expect(panel.querySelector("summary")).toBeNull();
  expect(panel.querySelectorAll("button").length).toBeGreaterThan(2);
});

describe("the load line", () => {
  // With no trade hex accepting the load, there must be no empty destination
  // ("for the .").
  test("names the destination when a trade hex takes the load", () => {
    const el = render({ ...BASE, cargo: [CARGO.sand] });
    expect(el.textContent).toContain("Carrying sand, for the glassworks.");
  });
  test("says only what it carries when no trade hex takes the load", () => {
    const el = render({ ...BASE, cargo: [CARGO.sand], trade: TRADE.slice(0, 2) });
    expect(el.textContent).toContain("Carrying sand.");
    expect(el.textContent).not.toContain("for the");
  });
});

// The picture follows the noun: Wagons' own gold draws the bars; under Rivers
// it is the coin purse and keeps the coin.
describe("the purse glyph", () => {
  test("wagon gold draws the bullion glyph", () => {
    const purse = render(BASE).querySelector("[data-wagon-purse]")!;
    expect(purse.querySelector('svg[data-glyph="gold"]')).not.toBeNull();
  });
  test("the shared Rivers purse keeps the coin", () => {
    const purse = render({ ...BASE, shared_currency: true }).querySelector("[data-wagon-purse]")!;
    expect(purse.querySelector('svg[data-glyph="gold"]')).toBeNull();
    expect(purse.querySelector("svg")).not.toBeNull();
  });
});
