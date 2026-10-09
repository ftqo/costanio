import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ScrollFade } from "./scroll-fade";

/**
 * Horizontal scrolling for ScrollFade: the wheel handler and nudge arrows,
 * which are the only way a mouse can scroll the hand shelf (no scrollbar, no
 * horizontal wheel axis). jsdom does no layout, so the box geometry is stubbed.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return el;
}

/** Give the scroll container a size it cannot measure for itself. */
function stub(
  box: HTMLElement,
  geom: { scrollWidth: number; clientWidth: number; scrollHeight?: number; clientHeight?: number },
) {
  const set = (k: string, v: number) =>
    Object.defineProperty(box, k, { configurable: true, value: v });
  set("scrollWidth", geom.scrollWidth);
  set("clientWidth", geom.clientWidth);
  // Equal by default: a box that also scrolled vertically must keep its wheel.
  set("scrollHeight", geom.scrollHeight ?? 40);
  set("clientHeight", geom.clientHeight ?? 40);
}

function scroller(el: HTMLElement): HTMLElement {
  return el.firstElementChild!.firstElementChild as HTMLElement;
}

test("maps the wheel to horizontal scroll on a sideways box", () => {
  const el = render(
    <ScrollFade className="overflow-x-auto">
      <div>hand</div>
    </ScrollFade>,
  );
  const box = scroller(el);
  stub(box, { scrollWidth: 1000, clientWidth: 500 });

  const e = new WheelEvent("wheel", { deltaY: 120, cancelable: true, bubbles: true });
  act(() => {
    box.dispatchEvent(e);
  });

  expect(box.scrollLeft).toBe(120);
  // Claimed, because it moved: the page must not scroll as well.
  expect(e.defaultPrevented).toBe(true);
});

test("deltaMode 1 counts lines, not pixels", () => {
  const el = render(
    <ScrollFade className="overflow-x-auto">
      <div>hand</div>
    </ScrollFade>,
  );
  const box = scroller(el);
  stub(box, { scrollWidth: 1000, clientWidth: 500 });

  act(() => {
    box.dispatchEvent(new WheelEvent("wheel", { deltaY: 3, deltaMode: 1, cancelable: true }));
  });

  // Three lines, not three pixels.
  expect(box.scrollLeft).toBe(48);
});

test("a box that scrolls vertically keeps its wheel", () => {
  const el = render(
    <ScrollFade className="overflow-y-auto">
      <div>log</div>
    </ScrollFade>,
  );
  const box = scroller(el);
  stub(box, { scrollWidth: 1000, clientWidth: 500, scrollHeight: 900, clientHeight: 300 });

  const e = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
  act(() => {
    box.dispatchEvent(e);
  });

  expect(box.scrollLeft).toBe(0);
  expect(e.defaultPrevented).toBe(false);
});

test("real sideways input is left alone", () => {
  const el = render(
    <ScrollFade className="overflow-x-auto">
      <div>hand</div>
    </ScrollFade>,
  );
  const box = scroller(el);
  stub(box, { scrollWidth: 1000, clientWidth: 500 });

  const e = new WheelEvent("wheel", { deltaX: 40, deltaY: 10, cancelable: true });
  act(() => {
    box.dispatchEvent(e);
  });

  // The browser is already scrolling this box; adding to it would double the move.
  expect(box.scrollLeft).toBe(0);
  expect(e.defaultPrevented).toBe(false);
});

test("ignores the wheel when nothing overflows", () => {
  const el = render(
    <ScrollFade className="overflow-x-auto">
      <div>hand</div>
    </ScrollFade>,
  );
  const box = scroller(el);
  stub(box, { scrollWidth: 500, clientWidth: 500 });

  const e = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
  act(() => {
    box.dispatchEvent(e);
  });

  expect(box.scrollLeft).toBe(0);
  expect(e.defaultPrevented).toBe(false);
});

test("shows arrows only on overflowing edges when enabled", () => {
  const withArrows = render(
    <ScrollFade className="overflow-x-auto" arrows>
      <div>hand</div>
    </ScrollFade>,
  );
  const box = scroller(withArrows);
  stub(box, { scrollWidth: 1000, clientWidth: 500 });
  // Scrolled to the start: content past the right edge only.
  act(() => {
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  let glyphs = Array.from(withArrows.querySelectorAll("button")).map((b) => b.textContent);
  expect(glyphs).toEqual(["›"]);

  // Scrolled to the end: content past the left edge only.
  box.scrollLeft = 500;
  act(() => {
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  glyphs = Array.from(withArrows.querySelectorAll("button")).map((b) => b.textContent);
  expect(glyphs).toEqual(["‹"]);

  // Without `arrows` it is only a fade; the log and chat use it that way.
  const plain = render(
    <ScrollFade className="overflow-x-auto">
      <div>hand</div>
    </ScrollFade>,
  );
  stub(scroller(plain), { scrollWidth: 1000, clientWidth: 500 });
  act(() => {
    scroller(plain).dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(plain.querySelectorAll("button").length).toBe(0);
});

// The landscape-phone dock is a column that scrolls down with its scrollbar
// hidden, so rows past the bottom need a nudge.
test("shows vertical nudges only on overflowing edges when enabled", () => {
  const col = render(
    <ScrollFade className="overflow-y-auto" vArrows>
      <div>tiles</div>
    </ScrollFade>,
  );
  const box = scroller(col);
  stub(box, { scrollWidth: 200, clientWidth: 200, scrollHeight: 213, clientHeight: 194 });
  act(() => {
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const sides = () =>
    Array.from(col.querySelectorAll("[data-scroll-nudge]")).map((b) =>
      b.getAttribute("data-scroll-nudge"),
    );
  expect(sides()).toEqual(["bottom"]);

  box.scrollTop = 19;
  act(() => {
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(sides()).toEqual(["top"]);

  // `arrows` alone gives only the sideways pair.
  const side = render(
    <ScrollFade className="overflow-x-auto" arrows>
      <div>hand</div>
    </ScrollFade>,
  );
  stub(scroller(side), {
    scrollWidth: 200,
    clientWidth: 200,
    scrollHeight: 213,
    clientHeight: 194,
  });
  act(() => {
    scroller(side).dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(side.querySelectorAll("[data-scroll-nudge]").length).toBe(0);
});
