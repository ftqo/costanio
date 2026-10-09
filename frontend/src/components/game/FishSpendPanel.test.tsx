import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FishSpendPanel } from "./FishSpendPanel";
import { fishOffers, type FishMix } from "@/lib/fish";
import { gameCaps } from "@/lib/caps";
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

// A robber on a tile of this board: the 2-fish spend is refused with no robber
// to remove, so `fishOffers` needs a tile. `legal` likewise keeps the 5-fish
// rung (dropped for a seat with nowhere to build), so all five rows show unless
// the ruleset removes one.
const ROBBER_HEX = { q: 0, r: 0 };
const legal = { roads: [{ a: { q: 0, r: 0, d: 0 }, b: { q: 1, r: 0, d: 0 } }] };
const view = (
  ruleset: string,
  ext: Record<string, unknown> = {},
  robber: { q: number; r: number } = ROBBER_HEX,
) =>
  ({
    config: { ruleset },
    ext,
    board: { tiles: [{ hex: ROBBER_HEX, res: "wood", num: 5 }], robber },
    legal,
    players: [{}, {}, {}],
  }) as unknown as FullView;

function render(
  ruleset: string,
  mix: FishMix,
  ext: Record<string, unknown> = {},
  robber: { q: number; r: number } = ROBBER_HEX,
) {
  const v = view(ruleset, ext, robber);
  act(() =>
    root.render(
      <FishSpendPanel
        offers={fishOffers(v, gameCaps(v), mix, true)}
        mix={mix}
        onSpend={() => {}}
        onClose={() => {}}
      />,
    ),
  );
  return document.body;
}

/** The tile chips inside one spend's row, as "value x count" strings. */
function tilesFor(spend: string): string[] {
  const row = document.body.querySelector(`[data-fish-spend="${spend}"]`)!;
  return [...row.querySelectorAll("[data-fish-tile]")].map(
    (el) => el.getAttribute("data-fish-tile")!,
  );
}

describe("spends are paid in tiles", () => {
  it("a lone 3-fish tile pays the 2-fish spend, whole", () => {
    // The core case: the tile doesn't break, so all three fish go and one is
    // destroyed. "2 fish" would be wrong.
    render("base+fishermen", [0, 0, 1]);
    expect(tilesFor("remove_robber")).toEqual(["3x1"]);
    expect(
      document.body.querySelector('[data-fish-spend="remove_robber"] [data-fish-waste]'),
    ).not.toBeNull();
  });

  it("says nothing about waste when the payment is exact", () => {
    render("base+fishermen", [2, 0, 0]);
    expect(tilesFor("remove_robber")).toEqual(["1x2"]);
    expect(
      document.body.querySelector('[data-fish-spend="remove_robber"] [data-fish-waste]'),
    ).toBeNull();
  });

  it("two different spends off the same holding take different tiles", () => {
    // 1 + 2 + 3 in hand. The 2-fish spend takes the 2-tile; the 4-fish spend
    // takes the 1 and the 3. Neither is readable off the price column.
    render("base+fishermen", [1, 1, 1]);
    expect(tilesFor("remove_robber")).toEqual(["2x1"]);
    expect(tilesFor("take_resource")).toEqual(["1x1", "3x1"]);
  });

  it("an unaffordable spend shows no tiles and cannot be pressed", () => {
    render("base+fishermen", [1, 0, 0]);
    expect(tilesFor("dev_card")).toEqual([]);
    const row = document.body.querySelector('[data-fish-spend="dev_card"]') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
  });
});

describe("hides spends the ruleset or board refuses", () => {
  const rich: FishMix = [10, 10, 10];

  it("base offers all five rungs", () => {
    render("base+fishermen", rich);
    expect(document.body.querySelectorAll("[data-fish-spend]")).toHaveLength(5);
  });

  // The 7-fish rung is a free development card, or one progress card of a
  // named discipline in a ruleset with no development deck
  // (docs/rules/scenarios.md). The engine refuses whichever the ruleset lacks,
  // so only one ever appears.
  it("Knights swaps the 7-fish rung for a progress card", () => {
    render("base+cak+fishermen", rich, { cak: { attacks: 4 } });
    expect(document.body.querySelector('[data-fish-spend="dev_card"]')).toBeNull();
    expect(document.body.querySelector('[data-fish-spend="progress_card"]')).not.toBeNull();
    // Absent, not merely disabled: a disabled row would still quote a price for
    // a deck this game doesn't have.
    expect(document.body.querySelectorAll("[data-fish-spend]")).toHaveLength(5);
  });

  it("removes the robber spend while the robber is locked away", () => {
    render("base+cak+fishermen", rich, { cak: { attacks: 0 } });
    expect(document.body.querySelector('[data-fish-spend="remove_robber"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    render("base+cak+fishermen", rich, { cak: { attacks: 1 } });
    expect(document.body.querySelector('[data-fish-spend="remove_robber"]')).not.toBeNull();
  });

  // Two fish remove the robber, refused when there is no robber on the board.
  // A Fishermen game is in that state from setup until the first 7, and after
  // every such spend.
  it("hides the 2-fish spend while the robber is beside the board", () => {
    render("base+fishermen", rich, {}, { q: -9999, r: -9999 });
    expect(document.body.querySelector('[data-fish-spend="remove_robber"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    render("base+fishermen", rich);
    expect(document.body.querySelector('[data-fish-spend="remove_robber"]')).not.toBeNull();
  });
});

// A seat holding seven fish tokens draws no more, but may exchange one for a
// fresh one from the supply once per turn. Nothing else on screen tells a
// player why catches stopped arriving.
describe("the seven-token holding cap is stated", () => {
  it("says the cap, and sharpens the line at it", () => {
    render("base+fishermen", [1, 0, 0]);
    expect(document.body.querySelector("[data-fish-cap]")!.textContent).toMatch(/7 tiles at most/);

    act(() => root.unmount());
    root = createRoot(host);
    render("base+fishermen", [7, 0, 0]);
    const line = document.body.querySelector("[data-fish-cap]")!;
    expect(line.getAttribute("data-fish-cap")).toBe("7");
    expect(line.textContent).toMatch(/draw no more/);
  });

  it("counts tiles, not fish, toward the cap", () => {
    render("base+fishermen", [0, 0, 7]);
    const line = document.body.querySelector("[data-fish-cap]")!;
    expect(line.getAttribute("data-fish-cap")).toBe("7");
    expect(document.body.querySelector("[data-fish-holding]")!.textContent).toContain("21");
  });
});

describe("the waste warning is legible in both themes", () => {
  // --color-red (#ff4f64) is a fill token: 3.2:1 on --secondary-background,
  // under the 4.5:1 floor at 10px. --red-ink (#c20017, 6.35:1) is the prose
  // token, and this line is the one saying the payment is lossy.
  it("uses the ink token for the destroyed-fish line", () => {
    render("base+fishermen", [0, 0, 1]);
    const warn = document.body.querySelector<HTMLElement>(
      '[data-fish-spend="remove_robber"] [data-fish-waste]',
    )!;
    expect(warn.className).toContain("text-red-ink");
    // As a whole class, not a substring: `text-red-ink` contains "text-red".
    expect(warn.className.split(/\s+/)).not.toContain("text-red");
  });
});

describe("spend copy", () => {
  it("describes the 5-fish road as built on the picked edge", () => {
    // Game.tsx's fishRoad effect builds on the tapped edge as soon as the credit
    // lands, so there is no "place afterwards" step to describe.
    render("base+fishermen", [0, 1, 1]);
    const row = document.body.querySelector('[data-fish-spend="free_road"]')!;
    expect(row.textContent).not.toMatch(/afterwards/i);
    expect(row.textContent).toMatch(/built there/i);
  });

  it("the 6-fish bridge names the three-bridge supply", () => {
    const v = {
      ...view("base+fishermen+rivers"),
      legal: { ...legal, bridges: legal.roads },
    } as unknown as FullView;
    act(() =>
      root.render(
        <FishSpendPanel
          offers={fishOffers(v, gameCaps(v), [0, 0, 2], true)}
          mix={[0, 0, 2]}
          onSpend={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    const row = document.body.querySelector('[data-fish-spend="bridge"]')!;
    expect(row).not.toBeNull();
    expect(row.textContent).toMatch(/bridge left/);
    expect(row.textContent).not.toMatch(/within your three/);
  });

  it("an empty holding draws no stray dash beside '0 fish held'", () => {
    render("base+fishermen", [0, 0, 0]);
    const holding = document.body.querySelector("[data-fish-holding]")!;
    expect(holding.textContent?.trim()).toBe("0 fish held");
  });
});

describe("Raiders rider hurry", () => {
  function renderRaiders(riderHurry: boolean) {
    const v = view("base+fishermen+raiders");
    act(() =>
      root.render(
        <FishSpendPanel
          offers={fishOffers(v, gameCaps(v), [0, 1, 0], true)}
          mix={[0, 1, 0]}
          riderHurry={riderHurry}
          onSpend={() => {}}
          onClose={() => {}}
        />,
      ),
    );
  }
  it("mentions that two fish hurry a rider", () => {
    renderRaiders(true);
    expect(document.body.querySelector("[data-fish-rider]")?.textContent).toMatch(/Two fish/);
  });
  it("omits riders in a game without them", () => {
    renderRaiders(false);
    expect(document.body.querySelector("[data-fish-rider]")).toBeNull();
  });
});

describe("resource nouns match the base game's", () => {
  it("the whole panel says wheat, never grain", () => {
    // The UI's resource name is Wheat everywhere, including the wagon boost row.
    const v = view("base+fishermen+wagons", {
      wagons: { started: true, has_trade: true, boosted: false, move_done: false },
    });
    act(() =>
      root.render(
        <FishSpendPanel
          offers={fishOffers(v, gameCaps(v), [0, 1, 0], true)}
          mix={[0, 1, 0]}
          onSpend={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    const boost = document.body.querySelector('[data-fish-spend="wagon_boost"]');
    expect(boost).not.toBeNull();
    expect(boost!.textContent).toMatch(/wheat/);
    expect(document.body.textContent).not.toMatch(/\b(grain|wool|lumber)\b/);
  });
});

// Spending is two taps (the rung, then Spend); the second is where the rule and
// the waste are read.
describe("choosing a rung, then spending it", () => {
  function renderSpy(mix: FishMix) {
    const v = view("base+fishermen");
    const spent: string[] = [];
    act(() =>
      root.render(
        <FishSpendPanel
          offers={fishOffers(v, gameCaps(v), mix, true)}
          mix={mix}
          onSpend={(s) => spent.push(s)}
          onClose={() => {}}
        />,
      ),
    );
    return spent;
  }
  const send = () => document.body.querySelector<HTMLButtonElement>("[data-fish-send]")!;

  it("sends nothing until a rung is chosen", () => {
    const spent = renderSpy([0, 0, 1]);
    expect(send().disabled).toBe(true);
    act(() => send().click());
    expect(spent).toEqual([]);
  });

  it("sends the chosen rung and warns of waste first", () => {
    const spent = renderSpy([0, 0, 1]);
    const rung = document.body.querySelector<HTMLButtonElement>(
      '[data-fish-spend="remove_robber"]',
    )!;
    act(() => rung.click());
    expect(rung.getAttribute("aria-pressed")).toBe("true");
    const detail = document.body.querySelector("[data-fish-detail]")!;
    expect(detail.textContent).toMatch(/1 fish destroyed/);
    expect(send().textContent).toContain("Spend 2 fish");
    act(() => send().click());
    expect(spent).toEqual(["remove_robber"]);
  });
});
