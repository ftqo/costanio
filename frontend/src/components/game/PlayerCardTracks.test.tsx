import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlayerCard, type PlayerCardData } from "./PlayerCard";
import { seatTracks } from "./hud/SeatRail";
import { COMMOD } from "@/lib/cardFace";

// The seat card's improvement row, rendered. hud/knightsHudShape.test.ts proves
// the data is in display order; this proves the card renders it that way and
// the metropolis underline stays with its own track. jsdom has no layout, so
// everything is read off the DOM tree and inline styles.

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

// Trade(0) at level 4 holding the metropolis, Politics(1) at 1, Science(2) at 5.
const card = (tracks: string): PlayerCardData => ({
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
  knights: {
    commodityCount: 3,
    progressCount: 1,
    knightsActive: 1,
    knightsTotal: 2,
    defenderVp: 0,
    extraVp: 0,
    tracks: seatTracks(tracks),
  },
});

function render(p: PlayerCardData) {
  act(() => root.render(<PlayerCard p={p} variant="knights" density="full" />));
}

/**
 * The three track columns, in DOM order. Anchored on the 5-segment bar stack,
 * which only a track column has. `[class~=]` matches one class without the
 * CSS escaping Tailwind's bracket names would need.
 */
function columns() {
  return Array.from(host.querySelectorAll<HTMLElement>('span[class~="gap-[1.5px]"]')).map((bar) => {
    const stack = bar.parentElement!; // bars + the underline rule
    return {
      segments: Array.from(bar.children as HTMLCollectionOf<HTMLElement>),
      rule: stack.querySelector<HTMLElement>("span[aria-hidden]")!,
    };
  });
}

describe("PlayerCard improvement row", () => {
  it("draws the three tracks as science, trade, politics", () => {
    render(card("4:true|1:false|5:false"));
    // Each column's bar is drawn in its track's commodity mark colour (the
    // commodity icon beside it stays blank in jsdom, which loads no image):
    // science is paper, trade cloth, politics coin.
    const ink = (key: string) => COMMOD.find((c) => c.key === key)!.ink;
    expect(columns().map((c) => c.segments[0].style.background)).toEqual([
      ink("paper"),
      ink("cloth"),
      ink("coin"),
    ]);
  });

  it("fills each bar to its own track's level, not its column's", () => {
    render(card("4:true|1:false|5:false"));
    // Science 5, Trade 4, Politics 1: the levels follow the track through the
    // reorder. Segments are "filled" when their background is the track colour.
    const filled = columns().map(
      (c) => c.segments.filter((s) => !s.style.background.includes("--color-line")).length,
    );
    expect(filled).toEqual([5, 4, 1]);
  });

  it("underlines the metropolis on the track that holds it", () => {
    render(card("4:true|1:false|5:false"));
    // Only Trade holds one, and Trade is the middle column. A positional
    // reorder would put the underline under Science.
    expect(columns().map((c) => c.rule.style.background !== "")).toEqual([false, true, false]);
  });

  it("draws a temporary metropolis dashed and a permanent one solid", () => {
    // Trade at level 4 with the metropolis is still steal-able → dashed.
    render(card("4:true|0:false|0:false"));
    expect(columns()[1].rule.style.background).toContain("repeating-linear-gradient");
    // At level 5 it is permanent → solid, in that track's own commodity colour.
    render(card("5:true|0:false|0:false"));
    const solid = columns()[1].rule.style.background;
    expect(solid).not.toContain("repeating-linear-gradient");
    // Trade's commodity is cloth (COMMOD index 0), drawn in its mark colour
    // (COMMOD.ink), not the card face. Asserted exactly, since "--color-cloth"
    // would also match `var(--color-cloth-ink)`.
    expect(solid).toBe("var(--color-cloth-ink)");
    expect(COMMOD[0].ink).toBe("var(--color-cloth-ink)");
    expect(COMMOD[0].color).toBe("var(--color-cloth)");
  });
});
