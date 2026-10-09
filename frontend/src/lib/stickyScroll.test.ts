import { describe, expect, test, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { isAtBottom, useStickyScroll, STICK_SLACK_PX } from "./stickyScroll";

// jsdom has no layout: scrollHeight and clientHeight are 0 and assigning
// scrollTop moves nothing. The rule is tested as arithmetic, and the hook
// through a scroll box whose numbers are set by hand.

describe("what counts as being at the bottom", () => {
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 200 });

  test("exactly at the bottom", () => {
    expect(isAtBottom(box(800))).toBe(true);
  });

  // Sub-pixel layout leaves a box that is visually at the bottom a pixel or
  // two short; the slack absorbs it.
  test("a rounding error short of it", () => {
    expect(isAtBottom(box(800 - 1))).toBe(true);
    expect(isAtBottom(box(800 - STICK_SLACK_PX))).toBe(true);
  });

  test("deliberately scrolled up", () => {
    expect(isAtBottom(box(800 - STICK_SLACK_PX - 1))).toBe(false);
    expect(isAtBottom(box(0))).toBe(false);
  });

  // Short content and a `display: none` pane both measure this way.
  test("nothing to scroll", () => {
    expect(isAtBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(true);
    expect(isAtBottom({ scrollTop: 0, scrollHeight: 40, clientHeight: 200 })).toBe(true);
  });
});

// ---- the hook ----

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

/**
 * A scroll box with faked layout. `scrollTop` records what the hook writes and
 * reads back clamped like a real one, so a pin is visible to the assertions
 * and to the hook's `onScroll`.
 */
function fakeLayout(el: HTMLElement, opts: { scrollHeight: number; clientHeight: number }) {
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => opts.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => opts.clientHeight });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, opts.scrollHeight - opts.clientHeight));
    },
  });
}

/** The surface: a scroll box whose visibility and content the test drives. */
function Harness({ dep, visible }: { dep: unknown; visible: boolean }) {
  const s = useStickyScroll<HTMLDivElement>(dep);
  // As TableFeed does: only the surface knows whether its pane is on screen.
  React.useLayoutEffect(() => {
    s.setVisible(visible);
    return () => s.setVisible(false);
  }, [s, visible]);
  return React.createElement("div", { ref: s.ref, onScroll: s.onScroll, id: "feed" });
}

function mount(props: { dep: unknown; visible: boolean }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(React.createElement(Harness, props)));
  const el = host.querySelector("#feed") as HTMLDivElement;
  fakeLayout(el, { scrollHeight: 1000, clientHeight: 200 });
  return {
    el,
    render: (next: { dep: unknown; visible: boolean }) =>
      act(() => root!.render(React.createElement(Harness, next))),
    // Browsers fire this after any scroll, programmatic included; jsdom does
    // not, so the harness does.
    scrollTo: (top: number) => {
      el.scrollTop = top;
      act(() => el.dispatchEvent(new Event("scroll", { bubbles: true })));
    },
  };
}

// The feed is raised by a control, so its box appears with no content change
// to react to; it must still open on the newest row.
test("a pane opens on its newest row", () => {
  const box = mount({ dep: 1, visible: false });
  expect(box.el.scrollTop).toBe(0);
  box.render({ dep: 1, visible: true });
  expect(box.el.scrollTop).toBe(800);
});

test("it follows new rows while it is at the bottom", () => {
  const box = mount({ dep: 1, visible: true });
  box.scrollTo(800);
  box.render({ dep: 2, visible: true });
  expect(box.el.scrollTop).toBe(800);
});

// A feed must not yank the reader back to the bottom while they read history.
test("it stays put once the reader has scrolled up", () => {
  const box = mount({ dep: 1, visible: true });
  box.scrollTo(120);
  box.render({ dep: 2, visible: true });
  expect(box.el.scrollTop).toBe(120);
  box.render({ dep: 3, visible: true });
  expect(box.el.scrollTop).toBe(120);
});

test("scrolling back to the bottom resumes following", () => {
  const box = mount({ dep: 1, visible: true });
  box.scrollTo(120);
  box.render({ dep: 2, visible: true });
  expect(box.el.scrollTop).toBe(120);
  box.scrollTo(800);
  box.render({ dep: 3, visible: true });
  expect(box.el.scrollTop).toBe(800);
});

// Reopening must land at the bottom and follow again.
test("closing and reopening returns to the bottom, following again", () => {
  const box = mount({ dep: 1, visible: true });
  box.scrollTo(120);
  box.render({ dep: 1, visible: false });
  box.render({ dep: 1, visible: true });
  expect(box.el.scrollTop).toBe(800);
  box.render({ dep: 2, visible: true });
  expect(box.el.scrollTop).toBe(800);
});

// A hidden pane measures 0, so writes while it is down are lost; nothing is
// written, and the pin happens when it is raised.
test("a pane that is down is not scrolled", () => {
  const box = mount({ dep: 1, visible: true });
  box.scrollTo(800);
  box.render({ dep: 1, visible: false });
  box.el.scrollTop = 0;
  box.render({ dep: 2, visible: false });
  expect(box.el.scrollTop).toBe(0);
  box.render({ dep: 2, visible: true });
  expect(box.el.scrollTop).toBe(800);
});

// ---- resizes ----
//
// A resize leaves scrollTop where it was, and the reflow's scroll event must
// not read as the reader scrolling up.

function resizableBox() {
  const dims = { scrollHeight: 1000, clientHeight: 200, clientWidth: 300 };
  const box = mount({ dep: 1, visible: true });
  let top = box.el.scrollTop;
  Object.defineProperty(box.el, "scrollHeight", {
    configurable: true,
    get: () => dims.scrollHeight,
  });
  Object.defineProperty(box.el, "clientHeight", {
    configurable: true,
    get: () => dims.clientHeight,
  });
  Object.defineProperty(box.el, "clientWidth", { configurable: true, get: () => dims.clientWidth });
  Object.defineProperty(box.el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, dims.scrollHeight - dims.clientHeight));
    },
  });
  return { ...box, dims, setTop: (v: number) => (top = v) };
}

test("a resize scroll event does not stop following", () => {
  const box = resizableBox();
  box.scrollTo(800); // at the bottom, and the hook has seen the box's size
  // The box grows; the browser re-anchors scrollTop mid-feed and fires a
  // scroll event.
  box.dims.clientHeight = 400;
  box.dims.clientWidth = 240;
  box.scrollTo(300);
  expect(box.el.scrollTop).toBe(600); // pinned back to the newest row
  box.render({ dep: 2, visible: true });
  expect(box.el.scrollTop).toBe(600); // and still following
});

test("a reader who scrolled up is not yanked down by a resize", () => {
  const box = resizableBox();
  box.scrollTo(120);
  box.dims.clientHeight = 400;
  box.scrollTo(120);
  expect(box.el.scrollTop).toBe(120);
});

test("a resize with no scroll event re-pins a follower", () => {
  const callbacks: (() => void)[] = [];
  const Real = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      callbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    const box = resizableBox();
    box.render({ dep: 2, visible: true }); // the pin effect starts observing
    box.scrollTo(800);
    box.dims.clientHeight = 100; // shorter box, scrollTop left where it was
    box.setTop(800);
    act(() => callbacks.forEach((cb) => cb()));
    expect(box.el.scrollTop).toBe(900);
  } finally {
    globalThis.ResizeObserver = Real;
  }
});
