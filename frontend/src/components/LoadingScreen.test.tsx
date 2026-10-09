import { test, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The wordmark is a router link on the web and plain text in the Activity, so
// render as the Activity to avoid needing a router.
vi.mock("@/lib/activity", () => ({ inActivityMode: () => true }));

const { LoadingScreen } = await import("./LoadingScreen");

afterEach(() => {
  document.body.innerHTML = "";
});

function render(node: React.ReactNode) {
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => root.render(node));
  return el;
}

const slider = (el: HTMLElement) => el.querySelector(".animate-loading-shuttle");

test("LoadingScreen: shuttles the slider and reports itself busy", () => {
  const el = render(<LoadingScreen message="Preparing the board…" />);
  expect(slider(el)).toBeTruthy();
  const status = el.querySelector('[role="status"]')!;
  expect(status.getAttribute("aria-busy")).toBe("true");
  expect(el.textContent).toContain("Preparing the board…");
});

test("LoadingScreen: renders children above the message", () => {
  const el = render(
    <LoadingScreen message="Starting game…">
      <span data-testid="roster">Bot William</span>
    </LoadingScreen>,
  );
  expect(el.querySelector('[data-testid="roster"]')).toBeTruthy();
  // Still a live wait, so the slider stays.
  expect(slider(el)).toBeTruthy();
});

test("LoadingScreen: actions replace the slider and end the busy state", () => {
  // A failed wait replaces the track with the escape hatches, as the game's
  // entry screen does when the socket errors or stalls.
  const el = render(
    <LoadingScreen message="Couldn’t load this game." actions={<button>Retry</button>} />,
  );
  expect(slider(el)).toBe(null);
  expect(el.querySelector("button")!.textContent).toBe("Retry");
  expect(el.querySelector('[role="status"]')!.getAttribute("aria-busy")).toBe("false");
});
