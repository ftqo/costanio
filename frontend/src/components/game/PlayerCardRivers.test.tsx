import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlayerCard, type PlayerCardData } from "./PlayerCard";

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

const base: PlayerCardData = {
  seat: 0,
  name: "Ada",
  color: "var(--color-red)",
  vp: 7,
  active: false,
  handCount: 4,
  devCount: 2,
  knightsPlayed: 3,
  routeLength: 5,
  longestRoad: false,
  longestRoadLabel: "ROAD",
  largestArmy: false,
  islandVp: 0,
  islands: false,
};

const draw = (p: PlayerCardData) => {
  act(() => root.render(<PlayerCard p={p} variant="base" density="full" />));
  return host;
};

const counters = () =>
  [...host.querySelectorAll('[class*="min-w-[3ch]"]')].map((el) => el.textContent);
const vpChip = () => host.querySelector("[data-vp]")?.textContent;
const award = (name: string) => host.querySelector(`[data-award="${name}"]`);
const held = (el: Element | null) => el?.getAttribute("data-held") === "true";

describe("the coin counter", () => {
  it("appears based on the ruleset, not the seat's coins", () => {
    // Like the fish counter, drawn from the ruleset: a counter appearing on the
    // first river build would re-divide the row on every card.
    draw({ ...base, rivers: true, coins: 0 });
    expect(counters()).toContain("0");
    const withCoins = [...draw({ ...base, rivers: true, coins: 6 }).querySelectorAll("*")];
    expect(withCoins.some((el) => el.textContent === "6")).toBe(true);
  });

  it("is absent from a game with no rivers in it", () => {
    draw({ ...base, coins: 6 });
    // No `rivers` flag: no coin counter, whatever the number says.
    expect(counters()).not.toContain("6");
  });
});

describe("the two wealth tiles", () => {
  it("do not change the VP chip", () => {
    // The chip is the server's number, already including both tiles
    // (engine/rivers' VictoryCheck adds +1 and -2), so it must be unchanged
    // across all four combinations.
    for (const [wealthiest, poorest] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      draw({ ...base, rivers: true, poorestInPlay: true, wealthiest, poorest });
      expect(vpChip()).toBe("7");
    }
  });

  it("show as chips, labelled with what they are worth", () => {
    draw({ ...base, rivers: true, poorestInPlay: true, wealthiest: true, poorest: false });
    expect(held(award("wealthiest"))).toBe(true);
    expect(award("wealthiest")?.textContent).toContain("+1");
    expect(held(award("poorest"))).toBe(false);

    // The penalty is labelled as one: it is a subtraction, and a held chip with
    // no label reads as a prize.
    draw({ ...base, rivers: true, poorestInPlay: true, wealthiest: false, poorest: true });
    expect(held(award("poorest"))).toBe(true);
    expect(award("poorest")?.textContent).toContain("-2");
    // Drawn as a penalty, not in the prize yellow: "-2" and "+1" in the same
    // fill would read alike.
    expect(award("poorest")?.getAttribute("data-penalty")).toBe("true");
    draw({ ...base, rivers: true, poorestInPlay: true, wealthiest: true, poorest: false });
    expect(award("wealthiest")?.hasAttribute("data-penalty")).toBe(false);
  });

  it("draw each tile only on the seat holding it", () => {
    // An award is a badge on its holder's panel, beside the score.
    draw({ ...base, rivers: true, poorestInPlay: true });
    expect(award("wealthiest")).toBeNull();
    expect(award("poorest")).toBeNull();
    draw({ ...base, rivers: true, poorestInPlay: true, wealthiest: true });
    expect(held(award("wealthiest"))).toBe(true);
    draw({ ...base, rivers: true, poorestInPlay: true, poorest: true });
    expect(held(award("poorest"))).toBe(true);
  });

  it("hides the Poorest slot in the pairings that drop the tile", () => {
    // Alongside Wagons and Raiders the Poorest tile isn't in the game, so no
    // slot. The Wealthiest tile survives both pairings.
    draw({ ...base, rivers: true, poorestInPlay: false, wealthiest: true, poorest: true });
    expect(award("wealthiest")).not.toBeNull();
    expect(award("poorest")).toBeNull();
  });

  it("draws neither slot in a game without Rivers", () => {
    draw({ ...base });
    expect(award("wealthiest")).toBeNull();
    expect(award("poorest")).toBeNull();
  });
});
