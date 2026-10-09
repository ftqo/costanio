import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFadingLog, LOG_LIFE_MS, LOG_FADE_MS, type FadingLog } from "./fadingLog";
import type { GameEvent } from "./gamestate";

/**
 * The hook, driven as the game screen drives it: a growing log, and a clock
 * that must empty it while nothing else happens. Fake timers throughout, since
 * `Date.now` stamps arrivals and `setTimeout` notices expiry.
 */

const ev = (seq: number): GameEvent => ({ seq, type: "x", data: null });
const T0 = 1_700_000_000_000;
const TOTAL = LOG_LIFE_MS + LOG_FADE_MS;

let host: HTMLDivElement;
let root: Root;
let seen: FadingLog;

function Probe({ events, enabled }: { events: readonly GameEvent[]; enabled: boolean }) {
  const log = useFadingLog(events, enabled);
  // Published from an effect, not assigned during render; every read happens
  // after an `act()` flush, when effects have run.
  useEffect(() => {
    seen = log;
  });
  return null;
}

function render(events: readonly GameEvent[], enabled = true) {
  act(() => root.render(<Probe events={events} enabled={enabled} />));
}

/** Move the clock AND run the timers that were waiting on it. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const seqs = () => seen.events.map((e) => e.seq);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("useFadingLog", () => {
  it("hands the log straight back when the mode is off", () => {
    const events = [ev(1), ev(2), ev(3)];
    render(events, false);
    // The same array: the feed is memoised on its identity.
    expect(seen.events).toBe(events);
    expect(seen.fadeAt).toBeNull();
    advance(TOTAL * 5);
    expect(seen.events).toBe(events);
  });

  it("starts a joining client with an empty log, not with the whole game", () => {
    // A join, reload or reconnect delivers the whole log, which must not
    // replay for fifteen seconds.
    render([ev(1), ev(2), ev(3)]);
    expect(seqs()).toEqual([]);
  });

  it("shows a row that arrives after the anchor, and drops it on time", () => {
    const backfill = [ev(1), ev(2)];
    render(backfill);
    expect(seqs()).toEqual([]);

    advance(1000);
    render([...backfill, ev(3)]);
    expect(seqs()).toEqual([3]);

    // Still there a millisecond before the fade has finished...
    advance(TOTAL - 1);
    expect(seqs()).toEqual([3]);
    // ...and gone once it has, with no event to prompt it: the hook's own timer.
    advance(2);
    expect(seqs()).toEqual([]);
  });

  it("expires rows one at a time, in the order they arrived", () => {
    render([ev(1)]);
    advance(1000);
    render([ev(1), ev(2)]);
    advance(2000);
    render([ev(1), ev(2), ev(3)]);
    expect(seqs()).toEqual([2, 3]);

    // 2 arrived at +1000 and 3 at +3000, so 2 goes first: the window is a tail.
    advance(TOTAL - 2000 + 1);
    expect(seqs()).toEqual([3]);
    advance(2000);
    expect(seqs()).toEqual([]);
  });

  it("gives each row a fade deadline of its own arrival plus its life", () => {
    render([ev(1)]);
    advance(500);
    render([ev(1), ev(2)]);
    advance(400);
    render([ev(1), ev(2), ev(3)]);
    expect(seen.fadeAt!(2)).toBe(T0 + 500 + LOG_LIFE_MS);
    expect(seen.fadeAt!(3)).toBe(T0 + 900 + LOG_LIFE_MS);
    // The deadline does not drift with the clock, or rows would re-render and
    // restart their fade.
    advance(4100);
    render([ev(1), ev(2), ev(3)]);
    expect(seen.fadeAt!(2)).toBe(T0 + 500 + LOG_LIFE_MS);
  });

  it("does not resurrect a row it has already forgotten", () => {
    // Stamps are pruned as rows leave; the watermark keeps a pruned row from
    // reading as brand new.
    render([ev(1)]);
    advance(100);
    render([ev(1), ev(2)]);
    expect(seqs()).toEqual([2]);

    advance(TOTAL + 1);
    expect(seqs()).toEqual([]);

    // A later event arrives; the expired ones must stay expired.
    advance(50);
    render([ev(1), ev(2), ev(3)]);
    expect(seqs()).toEqual([3]);
  });

  it("re-anchors when the mode goes off and comes back", () => {
    render([ev(1)]);
    advance(100);
    render([ev(1), ev(2)]);
    expect(seqs()).toEqual([2]);

    // Off: the whole log, unfiltered.
    render([ev(1), ev(2)], false);
    expect(seqs()).toEqual([1, 2]);

    // On again: what is in hand is a backfill again.
    render([ev(1), ev(2)], true);
    expect(seqs()).toEqual([]);
  });
});
