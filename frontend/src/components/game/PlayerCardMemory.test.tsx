import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlayerCard, type PlayerCardData } from "./PlayerCard";

/**
 * The card under memory mode (GameConfig.memory_mode), where the table keeps no
 * score for you.
 *
 * A number is drawn only if the board can't be read for it. Score, hand, army
 * and route can all be counted by watching; a Defender chip, a kept VP card and
 * the two titles can't.
 *
 * So the key test renders the same fixture both ways and checks it loses
 * exactly the counters and score and keeps exactly the chips; checking only
 * absences would pass on a card that drew nothing.
 */

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
  longestRoad: true,
  longestRoadLabel: "ROAD",
  largestArmy: true,
  islandVp: 2,
  islands: false,
};

const knightsCard: PlayerCardData = {
  ...base,
  knights: {
    commodityCount: 3,
    progressCount: 1,
    knightsActive: 1,
    knightsTotal: 2,
    defenderVp: 2,
    extraVp: 1,
    tracks: [],
  },
};

function render(
  p: PlayerCardData,
  memory: boolean,
  variant: "base" | "knights" = "base",
  density: "full" | "micro" = "full",
) {
  act(() => root.render(<PlayerCard p={p} variant={variant} density={density} memory={memory} />));
}

// Stat's reserved value box, which at `full` nothing but the counters draws.
function counters() {
  return [...host.querySelectorAll('[class*="min-w-[3ch]"]')].map((el) => el.textContent);
}
function award(name: string) {
  return host.querySelector<HTMLElement>(`[data-award="${name}"]`);
}
function identity() {
  return host.querySelector<HTMLElement>("[data-seat] [data-identity]")!;
}

describe("PlayerCard in memory mode", () => {
  it("keeps the name and drops the score", () => {
    render(base, false);
    expect(identity().textContent).toBe("Ada7");
    render(base, true);
    // The name alone, with nothing standing in for the score: nothing is being
    // withheld, the table just isn't adding it up.
    expect(identity().textContent).toBe("Ada");
  });

  it("drops the whole counters row in both rulesets", () => {
    render(base, false);
    expect(counters()).toEqual(["4", "2", "3", "5"]);
    render(base, true);
    expect(counters()).toEqual([]);

    render(knightsCard, false, "knights");
    expect(counters()).toEqual(["7", "1", "1/2", "5"]);
    render(knightsCard, true, "knights");
    expect(counters()).toEqual([]);
  });

  it("keeps the two titles", () => {
    render(base, true);
    expect(award("road")).not.toBeNull();
    expect(award("army")).not.toBeNull();
  });

  it("keeps Defender of the realm and the kept VP cards, with their counts", () => {
    // These can't be read off the board (a raid repelled turns ago, a Printer
    // face up), so the awards row stays with its numbers.
    render(knightsCard, true, "knights");
    expect(award("defender")!.textContent).toBe("+2");
    expect(award("kept-vp")!.textContent).toBe("+1");
  });

  it("drops the island-discovery chip", () => {
    // The exception: a first landing is a settlement visible on an island, so
    // the chip is bookkeeping like the score.
    const isl = { ...base, islands: true };
    render(isl, false);
    expect(award("island")!.textContent).toBe("+2");
    render(isl, true);
    expect(award("island")).toBeNull();
  });

  it("leaves the phone strip with the name and nothing else", () => {
    // `micro` is name + score, so memory mode leaves only the name. The full
    // card is a tap away and follows the same rule.
    render(base, true, "base", "micro");
    expect(identity().textContent).toBe("Ada");
    expect(counters()).toEqual([]);
    expect(award("road")).toBeNull();
  });

  it("changes nothing when off", () => {
    // The default. Rendered without the prop rather than `memory={false}`, to
    // compare against a card that never heard of the mode.
    act(() => root.render(<PlayerCard p={knightsCard} variant="knights" density="full" />));
    const before = host.innerHTML;
    render(knightsCard, false, "knights");
    expect(host.innerHTML).toBe(before);
  });
});
