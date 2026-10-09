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

describe("the old boot is never a victory point", () => {
  it("holding it leaves the VP chip exactly where the server put it", () => {
    // The boot adds one to its holder's win threshold; it is not a point either
    // way, so the VP chip shows the server's number untouched.
    draw({ ...base, fishermen: true, fish: 5, hasBoot: true });
    expect(vpChip()).toBe("7");

    draw({ ...base, fishermen: true, fish: 5, hasBoot: false });
    expect(vpChip()).toBe("7");
  });

  it("shows as a held chip in the awards row instead", () => {
    draw({ ...base, fishermen: true, hasBoot: true });
    expect(award("boot")).not.toBeNull();
  });

  it("is drawn only on the seat holding it", () => {
    // An award is a badge in the fixed-height identity row, so appearing
    // doesn't change the card's shape.
    draw({ ...base, fishermen: true, hasBoot: false });
    expect(award("boot")).toBeNull();
  });

  it("is absent in a game without the scenario", () => {
    draw({ ...base, fishermen: false });
    expect(award("boot")).toBeNull();
  });
});

describe("the fish counter", () => {
  it("joins the counters row on its value, not its tile count", () => {
    // Value is what spends are priced in; the mix behind it is the holder's
    // own information and not on an opponent's card.
    draw({ ...base, fishermen: true, fish: 6 });
    expect(counters()).toEqual(["4", "2", "3", "6", "5"]);
  });

  it("is absent in a game without fish, leaving the base row untouched", () => {
    draw({ ...base, fishermen: false });
    expect(counters()).toEqual(["4", "2", "3", "5"]);
  });

  it("reads 0 rather than vanishing before the first catch", () => {
    draw({ ...base, fishermen: true, fish: 0 });
    expect(counters()).toEqual(["4", "2", "3", "0", "5"]);
  });
});

describe("the fish counter and the boot chip have names of their own", () => {
  // Stat and Award need accessible names: Tip's title is in the DOM only while
  // open, so without one the fish counter read as a bare "3" and the boot chip
  // as nothing. This covers every HUD counter using them.
  const named = (frag: string) =>
    [...host.querySelectorAll<HTMLElement>("[aria-label]")].find((el) =>
      el.getAttribute("aria-label")!.includes(frag),
    );

  it("the fish counter says what it counts as well as how many", () => {
    draw({ ...base, fishermen: true, fish: 5 });
    const el = named("Fish")!;
    expect(el).toBeDefined();
    // Both halves in one name: a role="img" is read as one thing.
    expect(el.getAttribute("aria-label")).toBe("Fish: 5");
    // The role is what makes the label count; on a bare span aria-label is
    // ignored and the reader falls through to the number.
    expect(el.getAttribute("role")).toBe("img");
  });

  it("the boot chip names its held state", () => {
    // Held and empty must differ by more than colour (WCAG 1.4.1), including
    // for a screen reader.
    draw({ ...base, fishermen: true, hasBoot: true });
    const on = award("boot")!.getAttribute("aria-label")!;
    expect(on).toContain("boot");
    expect(on).toContain("held by this player");
  });

  it("distinguishes boot states without colour", () => {
    // For the sighted half of 1.4.1 (greyscale, colour-vision deficiency): the
    // award is held-only, so the difference is presence itself.
    draw({ ...base, fishermen: true, hasBoot: true });
    expect(award("boot")!.className).toContain("border-solid");
    draw({ ...base, fishermen: true, hasBoot: false });
    expect(award("boot")).toBeNull();
  });
});
