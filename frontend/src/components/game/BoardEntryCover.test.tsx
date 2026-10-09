import { test, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoardEntryCover } from "./BoardEntryCover";
import { ENTRY_COVER_FADE_MS } from "@/lib/gameEntry";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  const render = (ready: boolean, reduced = false) =>
    act(() =>
      root.render(
        <BoardEntryCover ready={ready} reduced={reduced}>
          <div role="status" aria-busy="true">
            Preparing the board
          </div>
        </BoardEntryCover>,
      ),
    );
  return { el, render };
}

const cover = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-board-cover]");

test("covers its host only, not the viewport", () => {
  const { el, render } = mount();
  render(false);
  const c = cover(el)!;
  expect(c.className).toMatch(/\babsolute inset-0\b/);
  expect(c.className).not.toMatch(/\bfixed\b/);
  // z-0: over the board, under the HUD (z-10).
  expect(c.className).toMatch(/\bz-0\b/);
});

test("blocks clicks and keeps the status region while loading", () => {
  const { el, render } = mount();
  render(false);
  const c = cover(el)!;
  expect(c.className).not.toMatch(/pointer-events-none/);
  expect(c.hasAttribute("inert")).toBe(false);
  expect(c.getAttribute("aria-hidden")).toBeNull();
  expect(c.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("true");
});

test("fades out when ready, then unmounts", () => {
  vi.useFakeTimers();
  const { el, render } = mount();
  render(false);
  render(true);
  const c = cover(el)!;
  expect(c.className).toMatch(/opacity-0/);
  expect(c.className).toMatch(/pointer-events-none/);
  expect(c.hasAttribute("inert")).toBe(true);
  expect(c.getAttribute("aria-hidden")).toBe("true");
  act(() => vi.advanceTimersByTime(ENTRY_COVER_FADE_MS - 1));
  expect(cover(el)).not.toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(cover(el)).toBeNull();
});

test("unmounts at once with reduced motion", () => {
  vi.useFakeTimers();
  const { el, render } = mount();
  render(false, true);
  render(true, true);
  act(() => vi.advanceTimersByTime(0));
  expect(cover(el)).toBeNull();
});

test("the fade constant matches the transition class", () => {
  const src = readFileSync(join(process.cwd(), "src/components/game/BoardEntryCover.tsx"), "utf8");
  expect(src).toContain(`duration-${ENTRY_COVER_FADE_MS}`);
});

// The game screen's wiring: the cover sits in the board layer, under the HUD.
test("Game renders the entry cover in the board layer, under the HUD", () => {
  const src = readFileSync(join(process.cwd(), "src/routes/Game.tsx"), "utf8");
  // The old full-page cover is gone.
  expect(src).not.toMatch(/fixed inset-0 z-\[60\]/);
  const coverAt = src.indexOf("<BoardEntryCover ready={entry.ready}");
  const hudAt = src.indexOf("<HudLayer ref={attachHudLayer}>");
  // After the HUD in the DOM, so Tab reaches the header first; its z-0 keeps
  // it under the HUD's z-10.
  expect(hudAt).toBeGreaterThan(0);
  expect(coverAt).toBeGreaterThan(src.indexOf("</HudLayer>", hudAt));
  // The board itself is inert until the gate opens.
  expect(src).toContain(
    '<div className="absolute inset-0 isolate" inert={!entry.ready || undefined}>',
  );
  // The opening hold covers the board only, also under the HUD.
  const holdAt = src.indexOf('{startHold && <div className="absolute inset-0 cursor-wait" />}');
  expect(holdAt).toBeGreaterThan(0);
  expect(holdAt).toBeLessThan(hudAt);
  expect(src).not.toMatch(/startHold && <div className="[^"]*z-\d/);
});
