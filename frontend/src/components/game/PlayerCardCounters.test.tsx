import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlayerCard, type PlayerCardData } from "./PlayerCard";
import { seatCounterCount } from "@/lib/seatPanels";

// The counters row. Order matters as much as values: the two card counts on the
// left (the hand, then the ruleset's face-down deck) and the two board counters
// on the right (knights, then route length). The middle cell branches on
// Knights, so each arm needs its own fixture.
//
// jsdom has no layout, so counters are read as the ordered list of Stat's
// reserved `min-w-[3ch]` value boxes, which only the counters draw at `full`.

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

const knightsCard: PlayerCardData = {
  ...base,
  knights: {
    commodityCount: 3,
    progressCount: 1,
    knightsActive: 1,
    knightsTotal: 2,
    defenderVp: 0,
    extraVp: 0,
    tracks: [],
  },
};

function counters(p: PlayerCardData, variant: "base" | "knights") {
  act(() => root.render(<PlayerCard p={p} variant={variant} density="full" />));
  return [...host.querySelectorAll('[class*="min-w-[3ch]"]')].map((el) => el.textContent);
}

describe("PlayerCard counter order", () => {
  it("puts the cards left and the board right in a base game", () => {
    // hand, dev, knights played, route.
    expect(counters(base, "base")).toEqual(["4", "2", "3", "5"]);
  });

  it("keeps the same two halves under Knights", () => {
    // hand (resources + commodities), progress, knights, route. No dev count
    // and no knights-played: Knights has no development deck or army.
    expect(counters(knightsCard, "knights")).toEqual(["7", "1", "1/2", "5"]);
  });

  it("shows a seat with no roads as 0 rather than blank", () => {
    expect(counters({ ...base, routeLength: 0 }, "base")[3]).toBe("0");
  });
});

describe("PlayerCard harbour-point counter", () => {
  // The chip says who holds the Harbormaster; this counter shows how close
  // everyone else is.
  const harbor = (harbourPoints: number, harbourThreshold?: number): PlayerCardData => ({
    ...base,
    harbormaster: true,
    harbourPoints,
    harbourThreshold,
  });

  it("is not drawn at all in a ruleset without the module", () => {
    expect(counters(base, "base")).toEqual(["4", "2", "3", "5"]);
  });

  it("shows a fraction of the threshold between the board counters", () => {
    // hand, dev, knights played, harbour points, route.
    expect(counters(harbor(2, 3), "base")).toEqual(["4", "2", "3", "2/3", "5"]);
  });

  it("shows the fraction at zero", () => {
    // Not a bare "0" that later becomes "1/3": the value keeps one shape from
    // the start, like the knight counter's "active/total".
    expect(counters(harbor(0, 3), "base")[3]).toBe("0/3");
  });

  it("shows a bare count when the server sent no threshold", () => {
    // The denominator comes off the wire (`ext.harbormaster.threshold`), so it
    // matches the engine. Absent means an older server; don't invent a 3.
    expect(counters(harbor(2), "base")[3]).toBe("2");
  });

  it("drops the denominator where fish and coins share the row", () => {
    // Seven cells in 232px: "0/3" overflowed onto the coin icon beside it
    // (Caravans+Fishermen+Harbormaster+Rivers, 1280x800).
    const crowded = { ...harbor(0, 3), fishermen: true, rivers: true };
    expect(counters(crowded, "base")).toContain("0");
    expect(counters(crowded, "base")).not.toContain("0/3");
  });

  it("shares the row equally, like every other counter", () => {
    act(() => root.render(<PlayerCard p={harbor(2, 3)} variant="base" density="full" />));
    const cells = [...host.querySelectorAll('[class*="min-w-[3ch]"]')].map(
      (el) => el.parentElement!,
    );
    expect(cells).toHaveLength(5);
    // Equal shares are the grid's columns (see CounterRow), so every cell is a
    // direct child of the counters grid.
    for (const cell of cells) expect(cell.parentElement!.hasAttribute("data-counters")).toBe(true);
  });
});

describe("PlayerCard counters row", () => {
  // Every counter takes an equal share of the row, like the award chips, so
  // icons line up across cards in the rail.
  it("gives each counter an equal share in both rulesets", () => {
    for (const [p, variant] of [
      [base, "base"],
      [knightsCard, "knights"],
    ] as const) {
      act(() => root.render(<PlayerCard p={p} variant={variant} density="full" />));
      const cells = [...host.querySelectorAll('[class*="min-w-[3ch]"]')].map(
        (el) => el.parentElement!,
      );
      expect(cells).toHaveLength(4);
      for (const cell of cells) {
        expect(cell.parentElement!.hasAttribute("data-counters")).toBe(true);
        // Safe centring: a cell narrower than its contents overflows right, not
        // past the row's left edge.
        expect(cell.className.split(" ")).toContain("justify-center-safe");
      }
    }
  });
});

describe("PlayerCard in a game without the base deck", () => {
  // Raiders and Explorers remove the development deck and Largest Army, so no
  // dev-card, knights-played or army counters; Raiders shows gold and prisoners
  // instead.
  const raiders: PlayerCardData = {
    ...base,
    devDeckInPlay: false,
    largestArmyInPlay: false,
    gold: 6,
    prisoners: 3,
    prisonersPerVp: 2,
  };

  it("drops the dev and army counters and shows gold and prisoners", () => {
    // hand, gold, prisoners, route.
    expect(counters(raiders, "base")).toEqual(["4", "6", "3", "5"]);
  });

  it("drops the Largest Army chip", () => {
    act(() => root.render(<PlayerCard p={raiders} variant="base" density="full" />));
    expect(host.querySelector('[data-award="army"]')).toBeNull();
    // Awards draw only on the holder, so the control is a base seat that holds
    // the army; under Raiders even a held flag draws nothing.
    act(() =>
      root.render(
        <PlayerCard p={{ ...raiders, largestArmy: true }} variant="base" density="full" />,
      ),
    );
    expect(host.querySelector('[data-award="army"]')).toBeNull();
    act(() =>
      root.render(<PlayerCard p={{ ...base, largestArmy: true }} variant="base" density="full" />),
    );
    expect(host.querySelector('[data-award="army"]')).not.toBeNull();
  });

  // Gold draws as bars, distinct from the Rivers coin. (Wagons + Rivers, where
  // the gold is the coin purse, draws no gold counter: see hud/seatGold.test.)
  it("draws gold as bullion", () => {
    act(() => root.render(<PlayerCard p={raiders} variant="base" density="full" />));
    expect(host.querySelectorAll('svg[data-glyph="gold"]')).toHaveLength(1);
  });

  it("a seat with neither gold nor prisoners shows neither", () => {
    const explorers = { ...base, devDeckInPlay: false, largestArmyInPlay: false };
    expect(counters(explorers, "base")).toEqual(["4", "5"]);
  });
});

describe("PlayerCard counters row with every module on", () => {
  // The worst case: Knights, Fishermen, Harbormaster, Raiders, Rivers and Wagons
  // draw nine counters. The row is a grid, and the rail reserves its extra lines
  // from `seatCounterCount`, so the two must agree cell for cell.
  const caps = {
    hasKnightPieces: false,
    hasDevCards: true,
    hasLargestArmy: true,
    hasRaiders: false,
    hasWagons: false,
    hasExplorers: false,
    hasFish: false,
    hasHarbormaster: false,
    hasRivers: false,
    hasCaravans: false,
  };
  type Caps = typeof caps;
  // The card data SeatRail's selectSeat derives from the same caps.
  const card = (c: Caps): PlayerCardData => ({
    ...(c.hasKnightPieces ? knightsCard : base),
    devDeckInPlay: c.hasDevCards,
    largestArmyInPlay: c.hasLargestArmy,
    // No gold under Wagons + Rivers without Raiders: that gold is the coins.
    gold: c.hasRaiders || c.hasExplorers || (c.hasWagons && !c.hasRivers) ? 3 : undefined,
    prisoners: c.hasRaiders ? 1 : undefined,
    ridersOut: c.hasRaiders ? 2 : undefined,
    wagonLevel: c.hasWagons ? 1 : undefined,
    deliveries: c.hasWagons ? 0 : undefined,
    ships: c.hasExplorers ? 1 : undefined,
    missionVp: c.hasExplorers ? 0 : undefined,
    fishermen: c.hasFish,
    harbormaster: c.hasHarbormaster,
    harbourPoints: 0,
    rivers: c.hasRivers,
    caravans: c.hasCaravans,
    camelVp: 0,
  });
  const all: Caps = {
    ...caps,
    hasKnightPieces: true,
    hasDevCards: false,
    hasLargestArmy: false,
    hasRaiders: true,
    hasWagons: true,
    hasFish: true,
    hasHarbormaster: true,
    hasRivers: true,
    hasCaravans: true,
  };
  const grid = (c: Caps) => {
    act(() =>
      root.render(
        <PlayerCard p={card(c)} variant={c.hasKnightPieces ? "knights" : "base"} density="full" />,
      ),
    );
    return host.querySelector<HTMLElement>("[data-counters]")!;
  };

  it("matches the rail's counter count in every ruleset", () => {
    const flags = Object.keys(caps) as (keyof Caps)[];
    // Every subset of the ten flags (1024 rulesets, most impossible): the count
    // must not depend on which are real.
    for (let mask = 0; mask < 1 << flags.length; mask++) {
      const c = { ...caps };
      flags.forEach((f, i) => (c[f] = !!(mask & (1 << i))));
      const g = grid(c);
      expect(g.children.length, JSON.stringify(c)).toBe(seatCounterCount(c));
    }
  });

  // Thirteen with every module on: the Raiders riders, the Wagons level and
  // deliveries, and Caravans' camel points. Three lines of five on a card, four
  // of four on a sideways phone. No real ruleset enables everything; this is
  // the ceiling the rail must hold.
  it("wraps thirteen counters to three lines, four on a landscape phone", () => {
    const g = grid(all);
    expect(g.children).toHaveLength(13);
    expect(seatCounterCount(all)).toBe(13);
    expect(g.dataset.rows).toBe("3");
    expect(g.dataset.rowsSquat).toBe("4");
    expect(g.style.getPropertyValue("--seat-cols")).toBe("5");
    expect(g.style.getPropertyValue("--seat-cols-squat")).toBe("4");
    expect(g.className).toContain("grid-cols-[repeat(var(--seat-cols),minmax(0,1fr))]");
    expect(g.className).toContain("squat:grid-cols-[repeat(var(--seat-cols-squat),minmax(0,1fr))]");
    expect(g.className).not.toContain("flex-nowrap");
  });

  it("keeps a base game's four counters on one line at both widths", () => {
    const g = grid(caps);
    expect(g.children).toHaveLength(4);
    expect(g.dataset.rows).toBe("1");
    expect(g.dataset.rowsSquat).toBe("1");
  });
});
