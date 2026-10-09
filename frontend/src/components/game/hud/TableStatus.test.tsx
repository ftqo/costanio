import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { gameSocket } from "@/lib/ws";
import type { FullView } from "@/lib/types";
import { BankRow } from "./TableStatus";

// Each bank cell (card art over a count) carries `role="img"` and the tip's
// sentence as its name, as Stat does for the seat rail's counters; otherwise a
// screen reader hears five bare numbers. The role is required: a name on a
// role-less span is dropped.

function view(over: Partial<FullView> = {}): FullView {
  return {
    seq: 1,
    viewer: 0,
    config: {} as never,
    phase: "play",
    cur: 0,
    board: {} as never,
    bank: [19, 18, 17, 16, 15, 0],
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

function render(v: FullView) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  gameSocket.ingest({ t: "state", game: "g", seq: v.seq, full: v });
  act(() => root.render(<BankRow />));
  return el;
}

afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  roots = [];
  document.body.innerHTML = "";
  gameSocket.disconnect();
});

const cells = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[role="img"]')];

test("every bank cell says which pile it is counting", () => {
  const el = render(view());
  // The tooltip's sentence, cell for cell, in the engine's bank order. An empty
  // pile is a rule, so it must be readable, not only red.
  expect(cells(el).map((c) => c.getAttribute("aria-label"))).toEqual([
    "18 wood left in the bank",
    "17 bricks left in the bank",
    "16 sheep left in the bank",
    "15 wheat left in the bank",
    "0 ore left in the bank",
    // The dev deck is the bank's sixth pile where the ruleset has one; it
    // doesn't recycle, so it is a stock like the others.
    "0 development cards left in the deck",
  ]);
});

test("the cells are not tab stops", () => {
  // Five of these, plus three commodities and a rate each, in front of the
  // panel's own controls. Only named cells earn a tab stop.
  const el = render(view());
  for (const c of cells(el)) expect(c.hasAttribute("tabindex")).toBe(false);
});

// The Islands module state appears on the first Islands event, so a setup view
// has no `ext.islands`; absent state means the untouched supply, not 0.
test("an Islands game with no module state yet shows a full ship supply", async () => {
  const { selectStatus } = await import("./TableStatus");
  const islandsView = view({
    phase: "setup",
    config: { ruleset: "base+islands" } as never,
    players: [{ seat: 0, roads_left: 15, settlements_left: 5, cities_left: 4 } as never],
  });
  expect(selectStatus({ full: islandsView } as never).ships).toBe(15);
  // Once the state exists its count is the truth, including a real zero.
  const spent = {
    ...islandsView,
    ext: { islands: { ships: [], ships_left: [0], moved_ship: false } },
  };
  expect(selectStatus({ full: spent } as never).ships).toBe(0);
  // A game without ships keeps its sentinel.
  expect(
    selectStatus({ full: view({ config: { ruleset: "base" } as never }) } as never).ships,
  ).toBe(-1);
});

// Explorers has no cities (a settlement upgrades to a harbour settlement), so no
// city count. Knights brings the city back.
test("the city supply is absent where the ruleset has no cities", async () => {
  const { selectStatus } = await import("./TableStatus");
  const players = [{ seat: 0, roads_left: 15, settlements_left: 5, cities_left: 4 } as never];
  const explorers = view({ config: { ruleset: "explorers" } as never, players });
  expect(selectStatus({ full: explorers } as never).cities).toBe(-1);
  const withKnights = view({ config: { ruleset: "cak+explorers" } as never, players });
  expect(selectStatus({ full: withKnights } as never).cities).toBe(4);
  const base = view({ config: { ruleset: "base" } as never, players });
  expect(selectStatus({ full: base } as never).cities).toBe(4);
});

// Knights + Raiders has knights and walls but no barbarian fleet (Raiders brings
// its own barbarians), so the own-supply rows must not be gated on the fleet.
test("the knight and wall supply follows the pieces, not the fleet", async () => {
  const { selectStatus } = await import("./TableStatus");
  const seated = [{ seat: 0, roads_left: 15, settlements_left: 5, cities_left: 4 } as never];
  for (const ruleset of ["base+cak", "base+cak+islands+raiders", "base+cak+raiders"]) {
    const s = selectStatus({
      full: view({ config: { ruleset } as never, players: seated }),
    } as never);
    expect(s.hasMine, ruleset).toBe(true);
    expect([s.knights1, s.knights2, s.knights3], ruleset).toEqual([2, 2, 2]);
  }
  const base = selectStatus({
    full: view({ config: { ruleset: "base+raiders" } as never, players: seated }),
  } as never);
  expect(base.hasMine).toBe(false);
});
