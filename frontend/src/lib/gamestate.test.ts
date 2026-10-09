import { test, expect } from "vitest";
import {
  appendCapped,
  capTail,
  eventsAfter,
  hasGap,
  lastEventSeq,
  mergeEvents,
  nextNeededSeq,
  RateGate,
  CHAT_CAP,
  type GameEvent,
  forcedTurnOver,
} from "./gamestate";

const ev = (seq: number, type = "x"): GameEvent => ({ seq, type, data: null });
const seqs = (l: GameEvent[]) => l.map((e) => e.seq);

test("chat is still a window; the event log is not", () => {
  expect(CHAT_CAP).toBe(50);
  // The log has no cap at all: a thousand events all stay.
  let log: GameEvent[] = [];
  for (let i = 0; i < 1000; i++) log = mergeEvents(log, [ev(i)]);
  expect(log.length).toBe(1000);
  expect(log[0].seq).toBe(0);
});

test("appendCapped keeps the last cap items", () => {
  let list: number[] = [];
  for (let i = 0; i < 60; i++) list = appendCapped(list, i, 50);
  expect(list.length).toBe(50);
  expect(list[0]).toBe(10);
  expect(list[49]).toBe(59);
});

test("appendCapped does not mutate the input", () => {
  const input = [1, 2, 3];
  const out = appendCapped(input, 4, 50);
  expect(input).toEqual([1, 2, 3]);
  expect(out).toEqual([1, 2, 3, 4]);
});

test("capTail trims to the last cap items", () => {
  expect(capTail([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  expect(capTail([1, 2], 5)).toEqual([1, 2]);
});

test("hasGap: null baseline never reports a gap", () => {
  expect(hasGap(null, 100)).toBe(false);
});

test("hasGap: contiguous and behind are not gaps; skip-ahead is", () => {
  expect(hasGap(10, 11)).toBe(false); // next expected
  expect(hasGap(10, 10)).toBe(false); // duplicate/behind
  expect(hasGap(10, 9)).toBe(false); // stale
  expect(hasGap(10, 12)).toBe(true); // skipped 11
});

// --- the retained event log ------------------------------------------------
//
// The client keeps the whole redacted log, so every delivery path (live stream,
// HTTP seed on mount, gap refetch) must be idempotent on seq: a reconnect can
// neither duplicate nor lose a line.

test("mergeEvents appends the live stream's next event", () => {
  const log = [ev(0), ev(1)];
  expect(seqs(mergeEvents(log, [ev(2)]))).toEqual([0, 1, 2]);
  expect(seqs(log)).toEqual([0, 1]); // never mutates
});

test("mergeEvents is idempotent", () => {
  const log = [ev(0), ev(1), ev(2)];
  expect(seqs(mergeEvents(log, [ev(0), ev(1), ev(2)]))).toEqual([0, 1, 2]);
  expect(seqs(mergeEvents(log, [ev(1)]))).toEqual([0, 1, 2]);
});

test("mergeEvents fills a gap without duplicating the overlap", () => {
  // A drop lost 2 and 3; the refetch comes back from 2 and overlaps 4-5.
  const log = [ev(0), ev(1), ev(4), ev(5)];
  const back = [ev(2), ev(3), ev(4), ev(5), ev(6)];
  expect(seqs(mergeEvents(log, back))).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

test("mergeEvents prepends earlier history a client never had", () => {
  // Entering a game in progress: live events land first, the seed backfills.
  const live = [ev(80), ev(81)];
  expect(seqs(mergeEvents(live, [ev(78), ev(79), ev(80)]))).toEqual([78, 79, 80, 81]);
});

test("mergeEvents lets the incoming copy win a seq collision", () => {
  // Same event, refetched with a wider redaction (the viewer is now seated).
  const log = [{ seq: 3, type: "card_stolen", data: {} }];
  const merged = mergeEvents(log, [{ seq: 3, type: "card_stolen", data: { res: "ore" } }]);
  expect(merged.length).toBe(1);
  expect(merged[0].data).toEqual({ res: "ore" });
});

test("mergeEvents tolerates an unordered, duplicate-carrying batch", () => {
  expect(seqs(mergeEvents([], [ev(3), ev(1), ev(3), ev(2)]))).toEqual([1, 2, 3]);
});

test("nextNeededSeq: 0 when empty, otherwise the first hole", () => {
  expect(nextNeededSeq([])).toBe(0);
  expect(nextNeededSeq([ev(0), ev(1), ev(2)])).toBe(3);
  // A hole at 2 must be refetched, not sealed over by asking from the end.
  expect(nextNeededSeq([ev(0), ev(1), ev(4), ev(5)])).toBe(2);
  // A log that does not start at 0 is missing its beginning.
  expect(nextNeededSeq([ev(7), ev(8)])).toBe(0);
});

test("eventsAfter returns exactly the tail past a seq", () => {
  const log = [ev(0), ev(1), ev(5), ev(9)];
  expect(seqs(eventsAfter(log, -1))).toEqual([0, 1, 5, 9]);
  expect(seqs(eventsAfter(log, 1))).toEqual([5, 9]);
  expect(seqs(eventsAfter(log, 4))).toEqual([5, 9]);
  expect(eventsAfter(log, 9)).toEqual([]);
  expect(eventsAfter([], 3)).toEqual([]);
});

test("lastEventSeq reads the highest seq, -1 when empty", () => {
  expect(lastEventSeq([])).toBe(-1);
  expect(lastEventSeq([ev(0), ev(4)])).toBe(4);
});

test("RateGate allows 1 per interval using an injected clock", () => {
  let now = 1000;
  const gate = new RateGate(1000, () => now);
  expect(gate.try()).toBe(true); // first
  expect(gate.try()).toBe(false); // same instant
  now = 1500;
  expect(gate.try()).toBe(false); // <1s later
  now = 2000;
  expect(gate.try()).toBe(true); // exactly 1s later
  now = 2999;
  expect(gate.try()).toBe(false);
  now = 3000;
  expect(gate.try()).toBe(true);
});

import { seatCountdownMs, seatBudgetMs, timerBarPct } from "./gamestate";

test("seatCountdownMs returns the seat's deadline when timers are on", () => {
  const view = { config: { turn_timer_sec: 60 }, seat_deadlines: { 0: 30000, 2: 30000 } } as any;
  expect(seatCountdownMs(view, 0)).toBe(30000);
  expect(seatCountdownMs(view, 2)).toBe(30000);
});

test("seatCountdownMs returns null for a seat not on the clock", () => {
  const view = { config: { turn_timer_sec: 60 }, seat_deadlines: { 0: 30000 } } as any;
  expect(seatCountdownMs(view, 1)).toBeNull();
});

test("seatCountdownMs returns null when timers are disabled", () => {
  const view = { config: { turn_timer_sec: 0 }, seat_deadlines: undefined } as any;
  expect(seatCountdownMs(view, 0)).toBeNull();
});

test("seatBudgetMs returns the seat's decision budget when present", () => {
  const view = { seat_budgets: { 0: 60000, 2: 30000 } } as any;
  expect(seatBudgetMs(view, 0)).toBe(60000);
  expect(seatBudgetMs(view, 2)).toBe(30000);
});

test("seatBudgetMs returns null for a seat with no stamped budget", () => {
  const view = { seat_budgets: { 0: 60000 } } as any;
  expect(seatBudgetMs(view, 1)).toBeNull();
  expect(seatBudgetMs({} as any, 0)).toBeNull();
});

// With 9s left of a 10s budget the bar reads 90%: it scales to the fixed
// budget, not a peak inferred from the remaining stream.
test("timerBarPct scales remaining to the fixed budget", () => {
  expect(timerBarPct(10000, 10000)).toBe(100);
  expect(timerBarPct(9000, 10000)).toBe(90);
  // Main-turn inactivity floor: 15s left of a 60s budget reads as 25%, not full.
  expect(timerBarPct(15000, 60000)).toBe(25);
});

test("timerBarPct clamps to [0, 100]", () => {
  expect(timerBarPct(70000, 60000)).toBe(100); // remaining can briefly exceed budget at a frame edge
  expect(timerBarPct(-500, 60000)).toBe(0);
});

test("timerBarPct falls back to a full bar when the budget is unknown", () => {
  // No peak inference: an absent budget shows full.
  expect(timerBarPct(9000, null)).toBe(100);
  expect(timerBarPct(9000, 0)).toBe(100);
});

// ---------------------------------------------------------------------------
// A turn taken by the timer, on a snapshot that has not caught up
// ---------------------------------------------------------------------------
//
// Events are not folded for phase flags, so until the next snapshot the view
// still says you owe the move the server just made for you, and the board would
// keep offering spots for it.

/** An event that names a seat, which is all `forcedTurnOver` reads. */
const bySeat = (seq: number, type: string, player: number) => ({ seq, type, data: { player } });

test("a settlement placed for this seat ends its forced turn", () => {
  // Setup: the timer expires, the server places at a vertex of its choosing,
  // and the snapshot is a round trip away.
  expect(forcedTurnOver([bySeat(40, "settlement_placed", 2)], 40, 2)).toBe(true);
});

test("someone else's placement does not disarm this seat", () => {
  expect(forcedTurnOver([bySeat(40, "settlement_placed", 1)], 40, 2)).toBe(false);
});

test("a turn starting for anybody else ends this seat's turn", () => {
  expect(forcedTurnOver([bySeat(40, "turn_started", 1)], 40, 2)).toBe(true);
  // Your own turn starting is not the end of it.
  expect(forcedTurnOver([bySeat(40, "turn_started", 2)], 40, 2)).toBe(false);
});

test("the other forced steps the timer can answer for you", () => {
  for (const type of ["road_placed", "robber_moved", "cards_discarded"]) {
    expect(forcedTurnOver([bySeat(40, type, 2)], 40, 2), type).toBe(true);
  }
});

// An event the snapshot already includes says nothing about what is owed now;
// counting it would disarm the board on every re-render.
test("events the snapshot has already applied are ignored", () => {
  const events = [bySeat(10, "settlement_placed", 2), bySeat(11, "turn_started", 1)];
  expect(forcedTurnOver(events, 40, 2)).toBe(false);
  // A FullView's seq is its NextSeq, so the event at that seq is the first one
  // it has not seen.
  expect(forcedTurnOver([bySeat(40, "settlement_placed", 2)], 41, 2)).toBe(false);
  expect(forcedTurnOver([bySeat(41, "settlement_placed", 2)], 41, 2)).toBe(true);
});

test("a spectator has no forced turn to lose", () => {
  expect(forcedTurnOver([bySeat(40, "turn_started", 1)], 40, -1)).toBe(false);
});

test("events that say nothing about whose move it is leave the board armed", () => {
  const events = [bySeat(40, "dice_rolled", 2), bySeat(41, "resources_distributed", 2)];
  expect(forcedTurnOver(events, 40, 2)).toBe(false);
});
