import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { gameSocket, useGameSocket, shallowEqual, type State } from "./ws";
import type { FullView } from "./types";

// The hook binds to the app's single session socket, so the tests drive that
// singleton and reset it to EMPTY afterwards.

function view(seq: number): FullView {
  return {
    seq,
    viewer: 0,
    config: {} as never,
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
  };
}

let roots: Root[] = [];

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(ui));
  return el;
}

// Let the queued once-per-frame notification fire, inside act so React commits.
function frame() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    roots.forEach((r) => r.unmount());
  });
  roots = [];
  document.body.innerHTML = "";
  gameSocket.disconnect(); // back to EMPTY for the next test
  vi.useRealTimers();
});

// A component that counts its own renders and reports the value it read.
function counter<T>(read: () => T) {
  const renders: T[] = [];
  const C = () => {
    renders.push(read());
    return null;
  };
  return { renders, C };
}

test("the whole-state form re-renders on any field change", () => {
  const { renders, C } = counter(() => useGameSocket());
  render(<C />);
  expect(renders.length).toBe(1);

  gameSocket.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "hi" });
  frame();
  expect(renders.length).toBe(2); // chat woke a subscriber that never reads chat
});

test("a selector re-renders only when its own slice changes", () => {
  const { renders, C } = counter(() =>
    useGameSocket((s: State) => ({ status: s.status, wantOpen: s.wantOpen }), shallowEqual),
  );
  render(<C />);
  expect(renders.length).toBe(1);
  expect(renders[0]).toEqual({ status: "closed", wantOpen: false });

  // Traffic that has nothing to do with the connection: no render at all.
  gameSocket.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "hi" });
  gameSocket.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  gameSocket.ingest({ t: "presence", game: "g", spectators: [{ user_id: 7, name: "W" }] });
  frame();
  expect(renders.length).toBe(1);

  // The slice itself changing does render, with the new value.
  act(() => gameSocket.ensureOpen());
  frame();
  expect(renders.length).toBe(2);
  expect(renders[1]).toEqual({ status: "connecting", wantOpen: true });
});

test("a scalar selector holds still until its field changes", () => {
  const { renders, C } = counter(() => useGameSocket((s: State) => s.matchGame));
  render(<C />);
  expect(renders.length).toBe(1);
  expect(renders[0]).toBeUndefined();

  gameSocket.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "hi" });
  frame();
  expect(renders.length).toBe(1); // the provider that wraps the whole app stays put

  gameSocket.ingest({ t: "ranked_match_found", game: "g9" });
  frame();
  expect(renders.length).toBe(2);
  expect(renders[1]).toBe("g9");

  // consumeMatch clears the id straight off the store; the effect that owns the
  // navigation still sees exactly one arrival.
  expect(gameSocket.consumeMatch()).toBe("g9");
  expect(gameSocket.consumeMatch()).toBeUndefined();
});

test("a burst of frames collapses into one render of a whole-state consumer", () => {
  const { renders, C } = counter(() => useGameSocket());
  render(<C />);
  gameSocket.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  for (let i = 1; i <= 12; i++) {
    gameSocket.ingest({ t: "ev", game: "g", seq: i, ev: { seq: i, type: "x", data: null } });
  }
  frame();
  expect(renders.length).toBe(2); // one initial + one for the whole burst
  expect(renders[1].events.length).toBe(12); // and it shows all of it
});

test("a component mounting mid-burst reads the current state", () => {
  gameSocket.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  gameSocket.ingest({ t: "ev", game: "g", seq: 1, ev: { seq: 1, type: "x", data: null } });
  // Notification still queued: a fresh subscriber must not see the pre-burst state.
  const { renders, C } = counter(() => useGameSocket((s: State) => s.lastSeq));
  render(<C />);
  expect(renders[0]).toBe(1);
  frame();
  expect(renders.length).toBe(1); // nothing changed for it, so no second render
});
