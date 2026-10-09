import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SeatTimerBar } from "./SeatTimerBar";

// The colour must keep up with a countdown nobody re-renders: the drain is one
// compositor CSS animation, and the remaining budget only arrives with server
// frames. These advance the clock without re-rendering, which is what the
// timeout chain is for.

let roots: Root[] = [];

function render(remainingMs: number | null, budgetMs: number | null, frozen = false) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() =>
    root.render(<SeatTimerBar remainingMs={remainingMs} budgetMs={budgetMs} frozen={frozen} />),
  );
  return el;
}

const fill = (el: HTMLElement) =>
  (el.querySelector(".seat-timer-fill") as HTMLElement).style.background;

// `performance` too: the chain measures elapsed time against a monotonic
// anchor, so faking only setTimeout would compute that no time had passed.
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));

afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  roots = [];
  document.body.innerHTML = "";
  vi.useRealTimers();
});

test("walks green -> yellow -> red off a single server frame", () => {
  const el = render(60_000, 60_000);
  expect(fill(el)).toBe("var(--color-green)");

  act(() => void vi.advanceTimersByTime(29_000)); // 31s left
  expect(fill(el)).toBe("var(--color-green)");
  act(() => void vi.advanceTimersByTime(1_000)); // 30s left
  expect(fill(el)).toBe("var(--color-yellow)");

  act(() => void vi.advanceTimersByTime(19_000)); // 11s left
  expect(fill(el)).toBe("var(--color-yellow)");
  act(() => void vi.advanceTimersByTime(1_000)); // 10s left
  expect(fill(el)).toBe("var(--color-red)");

  // Red is the end: nothing re-arms, so it can't cycle back.
  act(() => void vi.advanceTimersByTime(120_000));
  expect(fill(el)).toBe("var(--color-red)");
});

test("a decision that starts inside a tier starts in that tier's colour", () => {
  expect(fill(render(8_000, 30_000))).toBe("var(--color-red)");
  expect(fill(render(20_000, 30_000))).toBe("var(--color-yellow)");
});

// `frozen` is the endgame overlay: the drain is paused, so the colour must not
// keep moving toward red behind the scoreboard.
test("a frozen bar holds its colour", () => {
  const el = render(60_000, 60_000, true);
  expect(fill(el)).toBe("var(--color-green)");
  act(() => void vi.advanceTimersByTime(120_000));
  expect(fill(el)).toBe("var(--color-green)");
});
