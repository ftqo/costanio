import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { gameSocket } from "@/lib/ws";
import type { FullView } from "@/lib/types";
import { TurnTimerEdge } from "./TurnTimerEdge";

// The strip shows only a decision the viewer owes, never just the active seat's
// clock: several seats can be on the clock at once (discard-on-7).

function view(over: Partial<FullView> = {}): FullView {
  return {
    seq: 1,
    viewer: 0,
    config: { turn_timer_sec: 60 } as never,
    phase: "play",
    cur: 0,
    board: {} as never,
    bank: [0, 0, 0, 0, 0, 0],
    players: [],
    buildings: [],
    roads: [],
    dev_deck_count: 0,
    longest_road: -1,
    largest_army: -1,
    winner: -1,
    ...over,
  };
}

let roots: Root[] = [];

function render(v: FullView, botControlled = false) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  gameSocket.ingest({ t: "state", game: "g", seq: v.seq, full: v });
  act(() => root.render(<TurnTimerEdge frozen={false} botControlled={botControlled} />));
  return el;
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  roots = [];
  document.body.innerHTML = "";
  gameSocket.disconnect();
  vi.useRealTimers();
});

test("draws the viewer's own countdown", () => {
  const el = render(view({ seat_deadlines: { 0: 30_000 }, seat_budgets: { 0: 60_000 } }));
  expect(el.querySelector(".seat-timer")).not.toBeNull();
});

test("draws nothing when only another seat is on the clock", () => {
  const el = render(view({ cur: 2, seat_deadlines: { 2: 30_000 }, seat_budgets: { 2: 60_000 } }));
  expect(el.querySelector(".seat-timer")).toBeNull();
});

test("draws the viewer's discard clock while another seat is up", () => {
  // A 7 on seat 2's turn: both owe something, and the strip counts the viewer's
  // own deadline.
  const el = render(
    view({
      cur: 2,
      seat_deadlines: { 0: 15_000, 2: 30_000 },
      seat_budgets: { 0: 20_000, 2: 60_000 },
    }),
  );
  expect(el.querySelector(".seat-timer")).not.toBeNull();
});

test("a spectator gets nothing", () => {
  const el = render(view({ viewer: -1, seat_deadlines: { 0: 30_000 } }));
  expect(el.querySelector(".seat-timer")).toBeNull();
});

test("a seat handed to a bot gets nothing", () => {
  // "Leave & Spectate" keeps the seat for a bot, so the viewer index stays real
  // and the server still stamps deadlines on it. Only the roster knows; the
  // spectator guard above can't catch it.
  const el = render(view({ seat_deadlines: { 0: 30_000 }, seat_budgets: { 0: 60_000 } }), true);
  expect(el.querySelector(".seat-timer")).toBeNull();
});

test("timers switched off draw nothing", () => {
  const el = render(
    view({ config: { turn_timer_sec: 0 } as never, seat_deadlines: { 0: 30_000 } }),
  );
  expect(el.querySelector(".seat-timer")).toBeNull();
});

// `SeatTimerBar` is `aria-hidden` and running out plays a move for you, so the
// countdown must also be spoken. These cover that.

const said = () => document.body.querySelector<HTMLElement>('[role="status"]');

test("the live region is mounted before there is a clock to announce", () => {
  // A region created in the same commit as its first sentence announces
  // nothing (the announcement is the change), so it is always mounted, even for
  // a spectator.
  const el = render(view({ viewer: -1 }));
  expect(el.querySelector(".seat-timer")).toBeNull();
  expect(said()).not.toBeNull();
  expect(said()!.textContent).toBe("");
});

test("says how long is left at a mark, off a single server frame", () => {
  // Nothing ticks this: marks come off timeouts armed against a monotonic
  // anchor, as the colour does.
  render(view({ seat_deadlines: { 0: 120_000 }, seat_budgets: { 0: 120_000 } }));
  expect(said()!.textContent).toBe("");
  act(() => void vi.advanceTimersByTime(59_000)); // 61s left
  expect(said()!.textContent).toBe("");
  act(() => void vi.advanceTimersByTime(1_000)); // 60s left
  expect(said()!.textContent).toBe("60 seconds left");
  act(() => void vi.advanceTimersByTime(30_000)); // 30s left
  expect(said()!.textContent).toBe("30 seconds left");
  act(() => void vi.advanceTimersByTime(20_000)); // 10s left
  expect(said()!.textContent).toBe("10 seconds left");
  act(() => void vi.advanceTimersByTime(5_000)); // 5s left
  expect(said()!.textContent).toBe("5 seconds left");
});

test("announces four marks per decision", () => {
  // A region changing every second would talk over everything all turn.
  render(view({ seat_deadlines: { 0: 120_000 }, seat_budgets: { 0: 120_000 } }));
  const seen: string[] = [];
  for (let i = 0; i < 120; i++) {
    act(() => void vi.advanceTimersByTime(1_000));
    const now = said()!.textContent ?? "";
    if (now && now !== seen[seen.length - 1]) seen.push(now);
  }
  expect(seen).toEqual(["60 seconds left", "30 seconds left", "10 seconds left", "5 seconds left"]);
});

test("repeats an announcement for a second decision", () => {
  // A live region announces a change, and the same sentence twice is not one.
  // The mark carries a counter that keys the node, so a repeat is a fresh
  // insertion. Counted with a MutationObserver because the text is identical;
  // what matters is that the region was written to.
  render(view({ seat_deadlines: { 0: 12_000 }, seat_budgets: { 0: 12_000 } }));
  const region = said()!;
  const obs = new MutationObserver(() => {});
  obs.observe(region, { childList: true, subtree: true, characterData: true });
  // Drained by hand: the observer callback is a microtask, and these tests run
  // on fake timers with no await between write and assertion.
  const writes = () => obs.takeRecords().length;

  act(() => void vi.advanceTimersByTime(2_000)); // 10s left
  expect(region.textContent).toBe("10 seconds left");
  expect(writes()).toBeGreaterThan(0);

  // A fresh decision on the same seat, run down to the same mark.
  act(() => {
    gameSocket.ingest({
      t: "state",
      game: "g",
      seq: 2,
      full: view({ seq: 2, seat_deadlines: { 0: 13_000 }, seat_budgets: { 0: 13_000 } }),
    });
  });
  // lib/ws coalesces its wake-ups onto a frame, so the new deadline (and the
  // re-armed chain) arrives a frame later.
  act(() => void vi.advanceTimersByTime(50));
  act(() => void vi.advanceTimersByTime(3_000));
  expect(region.textContent).toBe("10 seconds left");
  expect(writes()).toBeGreaterThan(0);
  obs.disconnect();
});

test("ignores a clock a bot is answering", () => {
  render(view({ seat_deadlines: { 0: 12_000 }, seat_budgets: { 0: 12_000 } }), true);
  act(() => void vi.advanceTimersByTime(11_000));
  expect(said()!.textContent).toBe("");
});

test("clears the announcement when the game ends", () => {
  // A finished game must not leave "10 seconds left" in the region on the
  // post-game screen.
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  const v = view({ seat_deadlines: { 0: 12_000 }, seat_budgets: { 0: 12_000 } });
  gameSocket.ingest({ t: "state", game: "g", seq: v.seq, full: v });
  act(() => root.render(<TurnTimerEdge frozen={false} botControlled={false} />));
  act(() => void vi.advanceTimersByTime(2_000)); // 10s left
  expect(said()!.textContent).toBe("10 seconds left");
  act(() => root.render(<TurnTimerEdge frozen botControlled={false} />));
  // The region stays mounted (see the first spoken test); only the sentence
  // goes.
  expect(said()).not.toBeNull();
  expect(said()!.textContent).toBe("");
});
