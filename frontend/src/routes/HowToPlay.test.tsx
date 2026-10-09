import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// The rules page must never write the URL hash from a scroll handler. TanStack
// Router wraps `history`, so even a bare `history.replaceState` counts as a
// navigation and the router scrolls the hash's element into view: a scroll-spy
// syncing the address bar pulls the reader back to the previous chapter, and
// sidebar picks land one section short.
//
// jsdom has no layout or scrolling, so the test pins the mechanism: scrolling
// must not touch history or call scrollIntoView. Picking a chapter goes through
// the router, the one thing allowed to scroll.
const h = vi.hoisted(() => ({ navigate: vi.fn(), search: {} }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
  useSearch: () => h.search,
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
}));
// The header pulls in auth/query providers this page does not otherwise need.
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
// Art is renders and baked files, which jsdom lacks and this test does not
// need.
vi.mock("@/components/asset/AssetParts", () => ({
  ResIcon: () => null,
  CardFace: () => null,
}));
vi.mock("@/components/game/PieceIcon", () => ({ PieceArt: () => null }));
vi.mock("@/lib/useRulesProps", () => ({ useRulesProps: () => ({}) }));

import { HowToPlay, HOW_TO_PLAY_TABS } from "./HowToPlay";

let container: HTMLDivElement;
let root: Root;

// jsdom's requestAnimationFrame is a timer, so a handler that defers work to
// the next frame does nothing observable in a synchronous test. Collect the
// callbacks and run them on demand.
let pendingFrames: FrameRequestCallback[] = [];
function flushFrames() {
  const due = pendingFrames;
  pendingFrames = [];
  for (const cb of due) cb(performance.now());
}

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(HowToPlay)));
}

beforeEach(() => {
  h.navigate.mockClear();
  h.search = {};
  window.history.replaceState(null, "", "/how-to-play");
  // jsdom has no scrollIntoView. Define one so a call that should never
  // happen is observable rather than a TypeError.
  Element.prototype.scrollIntoView = () => {};
  pendingFrames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pendingFrames.push(cb);
    return pendingFrames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  container.remove();
});

describe("HowToPlay scrolling", () => {
  it("does not touch history on mount or scroll", () => {
    // Spied before mount: the scroll-spy publishes its first chapter during
    // mount, and a later spy would miss that write.
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    mount();

    // The spy coalesces work into a rAF, so each scroll is followed by the
    // frame it waits for.
    for (let i = 0; i < 10; i++) {
      act(() => {
        window.scrollY = i * 400;
        window.dispatchEvent(new Event("scroll"));
      });
      act(() => {
        flushFrames();
      });
    }

    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    replaceState.mockRestore();
    pushState.mockRestore();
  });

  it("navigates when a chapter is picked", () => {
    mount();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    const chapter = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Rolling a 7"),
    );
    expect(chapter, "sidebar chapter button").toBeTruthy();
    act(() => chapter!.click());

    // The router is handed the hash and does the scrolling; our own
    // scrollIntoView would race it.
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ hash: "base-seven", replace: true }),
    );
    scrollIntoView.mockRestore();
  });

  it("clears the hash when switching tabs", () => {
    mount();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    const knights = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Knights",
    );
    expect(knights, "Knights tab button").toBeTruthy();
    act(() => knights!.click());

    expect(h.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { tab: "knights" }, hash: "" }),
    );
    // A tab switch must not scroll on its own; the router puts a new tab at
    // the top.
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });

  it("exports every tab key", () => {
    mount();
    // A tab the route validator does not know cannot be linked to.
    const rendered = [...container.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(HOW_TO_PLAY_TABS).toContain("online");
    expect(HOW_TO_PLAY_TABS.length).toBeGreaterThanOrEqual(5);
    for (const label of ["Base Game", "Islands", "Knights", "Scenarios", "Playing online"]) {
      expect(rendered).toContain(label);
    }
  });
});
