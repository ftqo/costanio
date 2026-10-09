import { describe, it, expect, vi } from "vitest";
import { scrollOffsetToCenter, revealActiveCard } from "./scrollReveal";

// The player rail auto-scrolls to keep the active player's card centred. jsdom
// has no layout, so the decision lives in this pure helper. Cases mirror the
// mobile strip (~350px wide, 168px cards) and the desktop column.
describe("scrollOffsetToCenter", () => {
  it("centres a card sitting past the trailing edge", () => {
    // card at 400..568 of a 700px strip, 350px viewport: middle wants 400+84-175
    expect(scrollOffsetToCenter(0, 350, 400, 168, 700)).toBe(309);
  });

  it("centres a card that is already fully visible", () => {
    // visible at 100..268, but its middle (184) is not the viewport's (175)
    expect(scrollOffsetToCenter(0, 350, 100, 168, 700)).toBe(9);
  });

  it("returns null when the card is already centred", () => {
    // card at 91..259 puts its middle exactly on 175
    expect(scrollOffsetToCenter(0, 350, 91, 168, 700)).toBeNull();
  });

  it("counts the current offset", () => {
    // same on-screen position, but the strip is already scrolled 200px in
    expect(scrollOffsetToCenter(200, 350, 400, 168, 900)).toBe(509);
  });

  it("clamps at the start rather than scrolling to a negative offset", () => {
    // the first card cannot be pulled into the middle; the rail settles at 0
    expect(scrollOffsetToCenter(30, 350, -30, 168, 700)).toBe(0);
  });

  it("clamps at the end rather than scrolling past the last card", () => {
    // 700px of content in a 350px viewport can never scroll past 350
    expect(scrollOffsetToCenter(0, 350, 700, 168, 700)).toBe(350);
  });

  it("returns null when it is already as centred as the ends allow", () => {
    // already parked at the start, and the first card still wants to go left
    expect(scrollOffsetToCenter(0, 350, -30, 168, 700)).toBeNull();
  });

  it("centres a card larger than the viewport on its own middle", () => {
    // viewport 100, card 50..250: middle 150 against the viewport's 50
    expect(scrollOffsetToCenter(0, 100, 50, 200, 400)).toBe(100);
  });

  it("ignores a sub-pixel difference rather than restarting a smooth scroll", () => {
    // a smooth scroll leaves fractional offsets behind; 0.4px is not a move
    expect(scrollOffsetToCenter(100.4, 350, 175, 0, 700)).toBeNull();
  });
});

// jsdom has no layout, so fake the rail's measurements to exercise the wiring:
// which axis overflows, finding the card by data-seat, and the scrollTo payload.
//
// `zoom` is the root's CSS zoom (index.css applies it at both ends of the size
// range). Rects are given in layout pixels and scaled by it on the way out, as
// the browser does.
function fakeRail(opts: {
  card: { left?: number; top?: number; width?: number; height?: number } | null;
  scrollWidth?: number;
  clientWidth?: number;
  scrollLeft?: number;
  scrollHeight?: number;
  clientHeight?: number;
  scrollTop?: number;
  zoom?: number;
}) {
  const scrollTo = vi.fn();
  const z = opts.zoom ?? 1;
  const card = opts.card && {
    getBoundingClientRect: () => ({
      left: (opts.card!.left ?? 0) * z,
      top: (opts.card!.top ?? 0) * z,
      width: (opts.card!.width ?? 168) * z,
      height: (opts.card!.height ?? 100) * z,
    }),
  };
  const rail = {
    querySelector: () => card,
    // The scale is measured as the rail's rect size over its offset size.
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: (opts.clientWidth ?? 0) * z,
      height: (opts.clientHeight ?? 0) * z,
    }),
    offsetWidth: opts.clientWidth ?? 0,
    offsetHeight: opts.clientHeight ?? 0,
    scrollWidth: opts.scrollWidth ?? 0,
    clientWidth: opts.clientWidth ?? 0,
    scrollLeft: opts.scrollLeft ?? 0,
    scrollHeight: opts.scrollHeight ?? 0,
    clientHeight: opts.clientHeight ?? 0,
    scrollTop: opts.scrollTop ?? 0,
    scrollTo,
  };
  return { rail: rail as unknown as HTMLElement, scrollTo };
}

describe("revealActiveCard", () => {
  it("centres the active card in a mobile horizontal strip", () => {
    // 350px viewport over 700px of cards; active card sits at 400..568, off-screen
    const { rail, scrollTo } = fakeRail({
      card: { left: 400, width: 168 },
      scrollWidth: 700,
      clientWidth: 350,
    });
    revealActiveCard(rail, 3);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", left: 309 });
  });

  it("jumps without animating when the caller asks for reduced motion", () => {
    const { rail, scrollTo } = fakeRail({
      card: { left: 400, width: 168 },
      scrollWidth: 700,
      clientWidth: 350,
    });
    revealActiveCard(rail, 3, "auto");
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", left: 309 });
  });

  it("does not scroll when a wrapper is passed instead of the scroll box", () => {
    // A container that never overflows reports scrollWidth === clientWidth on
    // both axes, so there is nothing to centre.
    const { rail, scrollTo } = fakeRail({
      card: { left: 400, width: 168 },
      scrollWidth: 350,
      clientWidth: 350,
      scrollHeight: 400,
      clientHeight: 400,
    });
    revealActiveCard(rail, 3);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("recentres a card that is visible but off to one side", () => {
    // Fully visible at 20..188, but at the near edge; it should still centre.
    const { rail, scrollTo } = fakeRail({
      card: { left: 20, width: 168 },
      scrollWidth: 700,
      clientWidth: 350,
      scrollLeft: 100,
    });
    revealActiveCard(rail, 3);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", left: 29 });
  });

  it("does not scroll when the active card is already centred", () => {
    const { rail, scrollTo } = fakeRail({
      card: { left: 91, width: 168 },
      scrollWidth: 700,
      clientWidth: 350,
    });
    revealActiveCard(rail, 3);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("centres a desktop vertical column on its own axis", () => {
    // no horizontal overflow; 400px tall viewport over 900px, card at 500..620
    const { rail, scrollTo } = fakeRail({
      card: { top: 500, height: 120 },
      scrollWidth: 260,
      clientWidth: 260,
      scrollHeight: 900,
      clientHeight: 400,
    });
    revealActiveCard(rail, 1);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 360 });
  });

  it("settles the last seat against the end of the column", () => {
    // The bottom seat can never reach the middle; it lands flush with the end
    // rather than the rail refusing to move.
    const { rail, scrollTo } = fakeRail({
      card: { top: 380, height: 120 },
      scrollWidth: 260,
      clientWidth: 260,
      scrollHeight: 900,
      clientHeight: 400,
      scrollTop: 400,
    });
    revealActiveCard(rail, 9);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 500 });
  });

  it("scrolls the whole distance under a zoomed-out root", () => {
    // 874x402, a landscape phone, which index.css renders at `zoom: 0.75`.
    // Rect numbers arrive scaled and scroll offsets do not; mixing them moved
    // the rail only three quarters of the way each turn.
    const plain = fakeRail({
      card: { top: 500, height: 120 },
      scrollHeight: 900,
      clientHeight: 400,
      clientWidth: 260,
      scrollWidth: 260,
    });
    const zoomed = fakeRail({
      card: { top: 500, height: 120 },
      scrollHeight: 900,
      clientHeight: 400,
      clientWidth: 260,
      scrollWidth: 260,
      zoom: 0.75,
    });
    revealActiveCard(plain.rail, 1);
    revealActiveCard(zoomed.rail, 1);
    expect(zoomed.scrollTo.mock.calls).toEqual(plain.scrollTo.mock.calls);
    expect(zoomed.scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 360 });
  });

  it("does not overshoot under a zoomed-in root", () => {
    // Above 1700px the root zooms to 1.2, where unconverted rects overshoot.
    const { rail, scrollTo } = fakeRail({
      card: { left: 400, width: 168 },
      scrollWidth: 700,
      clientWidth: 350,
      zoom: 1.2,
    });
    revealActiveCard(rail, 3);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", left: 309 });
  });

  it("is a no-op when no card matches the active seat", () => {
    const { rail, scrollTo } = fakeRail({
      card: null,
      scrollWidth: 700,
      clientWidth: 350,
    });
    revealActiveCard(rail, 9);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
