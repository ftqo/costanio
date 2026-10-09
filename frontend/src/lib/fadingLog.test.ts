import { describe, it, expect, vi, afterEach } from "vitest";
import { firstVisible, LOG_LIFE_MS, LOG_FADE_MS } from "./fadingLog";
import type { GameEvent } from "./gamestate";

// The window arithmetic on its own; the hook is tested in
// fadingLogHook.test.tsx.

const ev = (seq: number): GameEvent => ({ seq, type: "x", data: null });

/** A log whose rows arrived at the given times, oldest first. */
function log(times: number[]) {
  const events = times.map((_, i) => ev(i));
  const arrivals = new Map(times.map((t, i) => [i, t]));
  // Pruned rows answer -Infinity, exactly as the hook's lookup does.
  return {
    events,
    at: (seq: number) => arrivals.get(seq) ?? Number.NEGATIVE_INFINITY,
  };
}

const TOTAL = LOG_LIFE_MS + LOG_FADE_MS;

afterEach(() => {
  vi.useRealTimers();
});

describe("firstVisible", () => {
  it("keeps a row until its life and its fade are both spent", () => {
    const now = 1_000_000;
    const { events, at } = log([now - TOTAL - 1, now - TOTAL, now - TOTAL + 1, now]);
    // Row 0 is past the end, row 1 lands exactly on it (and is also out: the
    // fade has finished), row 2 has a millisecond left.
    expect(firstVisible(events, at, now)).toBe(2);
  });

  it("is 0 for a log nothing has expired out of", () => {
    const now = 1_000_000;
    const { events, at } = log([now - 10, now - 5, now]);
    expect(firstVisible(events, at, now)).toBe(0);
  });

  it("is the length for a log that has expired entirely", () => {
    const now = 1_000_000;
    const { events, at } = log([now - TOTAL * 3, now - TOTAL * 2]);
    expect(firstVisible(events, at, now)).toBe(events.length);
  });

  it("handles an empty log", () => {
    expect(firstVisible([], () => 0, 1)).toBe(0);
  });

  it("finds the boundary in a long log", () => {
    // A big input with a known answer: 2000 rows, one per 10ms, the newest at
    // `now`. Everything older than the life plus the fade is gone.
    const now = 1_000_000;
    const times = Array.from({ length: 2000 }, (_, i) => now - (1999 - i) * 10);
    const { events, at } = log(times);
    const want = times.findIndex((t) => t > now - TOTAL);
    expect(firstVisible(events, at, now)).toBe(want);
    // Sanity on the fixture itself: the answer is genuinely inside the log.
    expect(want).toBeGreaterThan(0);
    expect(want).toBeLessThan(2000);
  });
});
