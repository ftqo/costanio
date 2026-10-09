import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlayerCard, type PlayerCardData } from "./PlayerCard";

// The awards row holds every VP source that isn't a building: Longest Road,
// Defender of the realm, the kept VP cards (Printer, Constitution), and Islands'
// discovery points. Largest Army is base-game only (Knights has no army).
// jsdom has no layout, so chips are read by their data-award name, as in
// PlayerCardTracks.test.tsx.

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
  devCount: 0,
  knightsPlayed: 0,
  routeLength: 0,
  longestRoad: false,
  longestRoadLabel: "ROAD",
  largestArmy: false,
  islandVp: 0,
  islands: false,
  // Spelled out like the two above: these are ruleset flags, and the fixture
  // should state "no Harbormaster" rather than inherit it from undefined.
  harbormaster: false,
  harbourPoints: 0,
  hasHarbormaster: false,
};

/** A seat in a Harbormaster game, holding the card or not. */
function harborCard(held: boolean, points = held ? 3 : 1): PlayerCardData {
  return { ...base, harbormaster: true, harbourPoints: points, hasHarbormaster: held };
}

function knightsCard(extraVp: number): PlayerCardData {
  return {
    ...base,
    knights: {
      commodityCount: 3,
      progressCount: 1,
      knightsActive: 1,
      knightsTotal: 2,
      defenderVp: 0,
      extraVp,
      tracks: [],
    },
  };
}

function render(p: PlayerCardData, density: "full" | "micro" = "full") {
  act(() => root.render(<PlayerCard p={p} variant="knights" density={density} />));
}

function award(name: string) {
  return host.querySelector<HTMLElement>(`[data-award="${name}"]`);
}
// The HUD draws an award only on the seat that holds it, as a filled badge
// beside the score; `data-held` still says so on the element.
function held(el: HTMLElement | null) {
  return el?.getAttribute("data-held") === "true";
}

describe("PlayerCard kept-VP award", () => {
  it("draws nothing when extra_vp is 0", () => {
    render(knightsCard(0));
    expect(award("kept-vp")).toBeNull();
  });

  it("has no slot at all in a base game", () => {
    render(base);
    expect(award("kept-vp")).toBeNull();
  });

  it("shows the count as a held chip when extra_vp is positive", () => {
    render(knightsCard(2));
    const chip = award("kept-vp");
    expect(held(chip)).toBe(true);
    expect(chip!.textContent).toBe("+2");
  });

  it("tracks the count exactly, not just presence", () => {
    render(knightsCard(1));
    expect(award("kept-vp")!.textContent).toBe("+1");
    render(knightsCard(5));
    expect(award("kept-vp")!.textContent).toBe("+5");
  });

  it("goes with the awards row at the micro tier", () => {
    // The phone strip is name, score and hand size (the full card is a tap
    // away), so it drops every bonus chip. The score badge still counts them.
    render(knightsCard(3), "micro");
    expect(award("kept-vp")).toBeNull();
    expect(award("road")).toBeNull();
  });

  it("renders as a badge in the award group", () => {
    // Held awards sit with the points: badges between the name and the score.
    render({ ...knightsCard(7), vp: 7 });
    const identity = host.querySelector<HTMLElement>("[data-seat] [data-identity]")!;
    const chip = identity.querySelector("[data-award='kept-vp']")!;
    expect(chip.closest("[data-awards]")).not.toBeNull();
    expect(identity.querySelector("[data-vp]")!.textContent).toBe("7");
  });
});

describe("PlayerCard awards row", () => {
  it("drops Largest Army in a Knights game", () => {
    // No development deck means no soldier cards, so the title can't be won and
    // has no slot. Defender of the realm stands in its place.
    render({
      ...knightsCard(0),
      largestArmy: true,
      knights: { ...knightsCard(0).knights!, defenderVp: 1 },
    });
    expect(award("army")).toBeNull();
    expect(award("defender")).not.toBeNull();
  });

  it("keeps Largest Army in a base game, and adds no Knights slots", () => {
    render({ ...base, largestArmy: true, longestRoad: true });
    expect(award("army")).not.toBeNull();
    expect(award("road")).not.toBeNull();
    expect(award("defender")).toBeNull();
    expect(award("kept-vp")).toBeNull();
  });

  it("drops Longest Road in a game that has no such award", () => {
    // Wagons removes the title (`Hooks.NoLongestRoad`), so no chip. The cap
    // arrives as a field, not a ruleset string, so the fixture states it.
    render({ ...base, longestRoadInPlay: false, longestRoad: true, largestArmy: true });
    expect(award("road")).toBeNull();
    // The rest of the row is untouched.
    expect(award("army")).not.toBeNull();
  });

  it("keeps Longest Road when the field is absent", () => {
    // `longestRoadInPlay` is optional and undefined reads as "yes", since every
    // ruleset but Wagons has the award.
    render({ ...base, longestRoad: true });
    expect(base.longestRoadInPlay).toBeUndefined();
    expect(award("road")).not.toBeNull();
  });

  it("keeps the route COUNTER when the award is gone", () => {
    // Only the chip goes; the route length still shows, and its hint stops
    // promising a title (see PlayerCard).
    render({ ...base, longestRoadInPlay: false, routeLength: 6 });
    const counter = [...host.querySelectorAll<HTMLElement>('[role="img"]')].find((el) =>
      el.getAttribute("aria-label")?.startsWith("Longest road:"),
    );
    expect(counter, "the route-length counter").toBeTruthy();
    expect(counter!.getAttribute("aria-label")).toBe("Longest road: 6");
  });

  it("does not change the card height", () => {
    // The badges live in the fixed-height identity row, so a title changing
    // hands never re-flows the rail.
    render(knightsCard(0));
    expect(host.querySelectorAll("[data-award]").length).toBe(0);
    render({ ...knightsCard(3), largestArmy: true, longestRoad: true });
    const chips = host.querySelectorAll("[data-award]");
    expect(chips.length).toBe(2); // Longest Road and kept VP; no army in Knights
    for (const c of chips) expect(c.closest("[data-identity]")).not.toBeNull();
  });
});

describe("PlayerCard Harbormaster award", () => {
  it("has no slot at all when the module is not in the ruleset", () => {
    render(base);
    expect(award("harbormaster")).toBeNull();
  });

  it("draws nothing on a seat that does not hold the card", () => {
    render(harborCard(false, 0));
    expect(award("harbormaster")).toBeNull();
  });

  it("fills the same slot when this seat takes the card", () => {
    render(harborCard(true));
    expect(held(award("harbormaster"))).toBe(true);
  });

  it("appears when the card changes hands to this seat", () => {
    render(harborCard(false));
    expect(award("harbormaster")).toBeNull();
    render(harborCard(true));
    expect(award("harbormaster")).not.toBeNull();
  });

  // The one chip memory mode keeps besides Longest Road: harbour points are
  // arithmetic over the board, but who holds the title is a fact about a card.
  it("survives memory mode, like the two base titles", () => {
    act(() =>
      root.render(
        <PlayerCard p={{ ...harborCard(true), longestRoad: true }} variant="base" memory />,
      ),
    );
    expect(award("harbormaster")).not.toBeNull();
    expect(award("road")).not.toBeNull();
    // The island chip still goes, so memory mode is applied.
    act(() =>
      root.render(
        <PlayerCard
          p={{ ...harborCard(true), islands: true, islandVp: 2 }}
          variant="base"
          memory
        />,
      ),
    );
    expect(award("island")).toBeNull();
    expect(award("harbormaster")).not.toBeNull();
  });
});
