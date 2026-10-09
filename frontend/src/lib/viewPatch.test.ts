import { test, expect } from "vitest";
import { applyPatch, patchApplied, pruneLegal, type ViewPatch } from "./viewPatch";
import type { KnightsExt, FullView, IslandsExt, Vertex } from "./types";

const V = (q: number, r: number, side: 0 | 1 = 0): Vertex => ({ q, r, side });
const E = (a: Vertex, b: Vertex) => ({ a, b });

function base(over: Partial<FullView> = {}): FullView {
  return {
    seq: 10,
    viewer: 0,
    config: {} as never,
    phase: "play",
    cur: 0,
    board: { radius: 2, tiles: [], robber: { q: 0, r: 0 }, harbors: [] },
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

function withIslands(v: FullView, x: Partial<IslandsExt>): FullView {
  const ext: IslandsExt = { ships: [], ships_left: [], moved_ship: false, ...x };
  return { ...v, ext: { ...v.ext, islands: ext } };
}

function withKnights(v: FullView, x: Partial<KnightsExt>): FullView {
  const ext = {
    players: [],
    knights: [],
    commodity_supply: [0, 0, 0],
    barbarians: 0,
    attacks: 0,
    decks: [0, 0, 0],
    deserter_victim: -1,
    deserter_taker: -1,
    ...x,
  } as unknown as KnightsExt;
  return { ...v, ext: { ...v.ext, cak: ext } };
}

// Applying a patch makes patchApplied true, and applying it again returns the
// same object, which keeps the optimistic overlay from re-rendering the board
// on every view change.
const ROUND_TRIP: { name: string; view: FullView; patch: ViewPatch }[] = [
  { name: "settlement", view: base(), patch: { kind: "settlement", v: V(0, 0), owner: 2 } },
  { name: "city on empty vertex", view: base(), patch: { kind: "city", v: V(1, 1), owner: 2 } },
  {
    name: "city upgrading a settlement",
    view: base({ buildings: [{ v: V(1, 1), owner: 2, city: false }] }),
    patch: { kind: "city", v: V(1, 1), owner: 2 },
  },
  { name: "road", view: base(), patch: { kind: "road", e: E(V(0, 0), V(0, 0, 1)), owner: 1 } },
  {
    name: "ship",
    view: withIslands(base(), {}),
    patch: { kind: "ship", e: E(V(2, 0), V(2, 0, 1)), owner: 1 },
  },
  {
    name: "ship move",
    view: withIslands(base(), { ships: [{ e: E(V(2, 0), V(2, 0, 1)), owner: 1 }] }),
    patch: { kind: "ship_move", from: E(V(2, 0), V(2, 0, 1)), to: E(V(3, 0), V(3, 0, 1)) },
  },
  {
    name: "knight",
    view: withKnights(base(), {}),
    patch: { kind: "knight", v: V(0, 0), owner: 1, level: 1, active: false },
  },
  {
    name: "knight move",
    view: withKnights(base(), {
      knights: [
        {
          v: V(0, 0),
          owner: 1,
          level: 1,
          active: true,
          freshly_activated: false,
          promoted_this_turn: false,
        },
      ],
    }),
    patch: { kind: "knight_move", from: V(0, 0), to: V(1, 0) },
  },
  {
    name: "knight activate",
    view: withKnights(base(), {
      knights: [
        {
          v: V(0, 0),
          owner: 1,
          level: 1,
          active: false,
          freshly_activated: false,
          promoted_this_turn: false,
        },
      ],
    }),
    patch: { kind: "knight_activate", v: V(0, 0) },
  },
  {
    name: "knight promote",
    view: withKnights(base(), {
      knights: [
        {
          v: V(0, 0),
          owner: 1,
          level: 1,
          active: true,
          freshly_activated: false,
          promoted_this_turn: false,
        },
      ],
    }),
    patch: { kind: "knight_promote", v: V(0, 0), to: 2 },
  },
  {
    name: "knight remove",
    view: withKnights(base(), {
      knights: [
        {
          v: V(0, 0),
          owner: 1,
          level: 1,
          active: true,
          freshly_activated: false,
          promoted_this_turn: false,
        },
      ],
    }),
    patch: { kind: "knight_remove", v: V(0, 0) },
  },
  { name: "wall", view: withKnights(base(), {}), patch: { kind: "wall", v: V(0, 0), owner: 1 } },
  { name: "robber", view: base(), patch: { kind: "robber", hex: { q: 1, r: 1 } } },
  { name: "pirate", view: withIslands(base(), {}), patch: { kind: "pirate", hex: { q: 3, r: 3 } } },
];

for (const { name, view, patch } of ROUND_TRIP) {
  test(`${name}: not applied, then applied, then idempotent`, () => {
    expect(patchApplied(view, patch)).toBe(false);
    const next = applyPatch(view, patch);
    expect(patchApplied(next, patch)).toBe(true);
    // Re-applying returns the same object, not an equal one.
    expect(applyPatch(next, patch)).toBe(next);
  });
}

test("promotion settles on the final level", () => {
  // A 2 -> 3 promotion (maxKnightLevel is 3): a `level > 1` check would be
  // satisfied before the command was sent.
  const v = withKnights(base(), {
    knights: [
      {
        v: V(0, 0),
        owner: 1,
        level: 2,
        active: true,
        freshly_activated: false,
        promoted_this_turn: false,
      },
    ],
  });
  const patch: ViewPatch = { kind: "knight_promote", v: V(0, 0), to: 3 };
  expect(patchApplied(v, patch)).toBe(false);
  const next = applyPatch(v, patch);
  expect((next.ext?.cak as KnightsExt).knights[0].level).toBe(3);
  expect(patchApplied(next, patch)).toBe(true);
});

test("a moved knight is deactivated, matching the engine", () => {
  // engine/knights/apply.go's EvKnightMoved sets Active and FreshlyActivated false.
  const v = withKnights(base(), {
    knights: [
      {
        v: V(0, 0),
        owner: 1,
        level: 2,
        active: true,
        freshly_activated: false,
        promoted_this_turn: false,
      },
    ],
  });
  const next = applyPatch(v, { kind: "knight_move", from: V(0, 0), to: V(1, 0) });
  const k = (next.ext?.cak as KnightsExt).knights[0];
  expect(k.v).toEqual(V(1, 0));
  expect(k.active).toBe(false);
  expect(k.freshly_activated).toBe(false);
});

test("a settlement does not satisfy the city patch that upgrades it", () => {
  const v = base({ buildings: [{ v: V(1, 1), owner: 2, city: false }] });
  expect(patchApplied(v, { kind: "city", v: V(1, 1), owner: 2 })).toBe(false);
  const next = applyPatch(v, { kind: "city", v: V(1, 1), owner: 2 });
  // Upgraded in place rather than added alongside.
  expect(next.buildings).toHaveLength(1);
  expect(next.buildings[0].city).toBe(true);
});

test("an in-place knight move is a deactivation, and settles on that", () => {
  const v = withKnights(base(), {
    knights: [
      {
        v: V(0, 0),
        owner: 1,
        level: 2,
        active: true,
        freshly_activated: false,
        promoted_this_turn: false,
      },
    ],
  });
  const patch: ViewPatch = { kind: "knight_move", from: V(0, 0), to: V(0, 0) };
  // Arriving is not enough: the knight is already "at" the destination.
  expect(patchApplied(v, patch)).toBe(false);
  const next = applyPatch(v, patch);
  const k = (next.ext?.cak as KnightsExt).knights[0];
  expect(k.active).toBe(false);
  expect(k.v).toEqual(V(0, 0));
  expect(patchApplied(next, patch)).toBe(true);
});

test("a knight move is unsettled until the source is empty too", () => {
  // Both ends occupied is a displacement mid-flight; arriving alone must not
  // read as done or the registry would drop the entry early.
  const v = withKnights(base(), {
    knights: [
      {
        v: V(0, 0),
        owner: 1,
        level: 1,
        active: true,
        freshly_activated: false,
        promoted_this_turn: false,
      },
      {
        v: V(1, 0),
        owner: 2,
        level: 1,
        active: true,
        freshly_activated: false,
        promoted_this_turn: false,
      },
    ],
  });
  expect(patchApplied(v, { kind: "knight_move", from: V(0, 0), to: V(1, 0) })).toBe(false);
});

test("a built knight arrives fresh, so it offers no actions this turn", () => {
  const v = withKnights(base(), {});
  const next = applyPatch(v, { kind: "knight", v: V(0, 0), owner: 1, level: 0, active: false });
  const k = (next.ext?.cak as KnightsExt).knights[0];
  expect(k.level).toBe(1); // 0 on the wire means "the default"
  expect(k.freshly_activated).toBe(false);
});

test("a built knight is freshly_activated only when the engine says fresh", () => {
  // engine/knights/apply.go writes FreshlyActivated = active && fresh. An active
  // knight without `fresh` (an older log) may act.
  const next = applyPatch(withKnights(base(), {}), {
    kind: "knight",
    v: V(2, 2),
    owner: 1,
    level: 3,
    active: true,
  });
  expect((next.ext?.cak as KnightsExt).knights[0].freshly_activated).toBe(false);
  // The Deserter replacement arrives active mid-Action-phase and is locked
  // until the taker's next turn.
  const deserter = applyPatch(withKnights(base(), {}), {
    kind: "knight",
    v: V(2, 2),
    owner: 1,
    level: 3,
    active: true,
    fresh: true,
  });
  expect((deserter.ext?.cak as KnightsExt).knights[0].freshly_activated).toBe(true);
});

test("a module patch against a view without that module is inert", () => {
  const v = base(); // no islands ext
  const patch: ViewPatch = { kind: "ship", e: E(V(2, 0), V(2, 0, 1)), owner: 1 };
  expect(patchApplied(v, patch)).toBe(false);
  // Never satisfied, never throws; the in-flight TTL is the backstop.
  expect(patchApplied(applyPatch(v, patch), patch)).toBe(false);
});

test("patchApplied is null-safe on a board with no robber resolved", () => {
  const v = base({ board: {} as never });
  expect(patchApplied(v, { kind: "robber", hex: { q: 1, r: 1 } })).toBe(false);
});

// ---------------------------------------------------------------------------
// Pruning: only ever shrinks
// ---------------------------------------------------------------------------

test("a placed vertex is withdrawn from every set that could place there", () => {
  const v = V(0, 0);
  const legal = {
    settlements: [v, V(1, 1)],
    cities: [v],
    knights: [v],
    walls: [v],
    metropolis_cities: [v],
    roads: [E(V(0, 0), V(0, 0, 1))],
  };
  const out = pruneLegal(legal, { kind: "settlement", v, owner: 1 })!;
  expect(out.settlements).toEqual([V(1, 1)]);
  expect(out.cities).toEqual([]);
  expect(out.knights).toEqual([]);
  expect(out.walls).toEqual([]);
  expect(out.metropolis_cities).toEqual([]);
  // An edge set is untouched by a vertex patch, and comes back by identity.
  expect(out.roads).toBe(legal.roads);
});

test("a move withdraws its source as well as its destination", () => {
  const from = E(V(2, 0), V(2, 0, 1));
  const to = E(V(3, 0), V(3, 0, 1));
  const legal = { ships: [to], ship_moves: [{ from, to: [to] }] };
  const out = pruneLegal(legal, { kind: "ship_move", from, to })!;
  expect(out.ships).toEqual([]);
  expect(out.ship_moves).toEqual([]);
});

// The board's hex targets come only from these sets, and hover ghosts clear
// when the hovered spot stops being a target, so a landed robber's hex must
// leave them or its ghost stays on top of the real piece.
test("a placed marker is withdrawn from every hex set", () => {
  const h = { q: 1, r: -1 };
  const other = { q: 2, r: 0 };
  const legal = {
    robber_hexes: [h, other],
    pirate_hexes: [h],
    chase_robber_hexes: [h, other],
    settlements: [V(0, 0)],
  };
  const out = pruneLegal(legal, { kind: "robber", hex: h })!;
  expect(out.robber_hexes).toEqual([other]);
  // Pruned whichever move it was: the two markers cannot share a hex.
  expect(out.pirate_hexes).toEqual([]);
  expect(out.chase_robber_hexes).toEqual([other]);
  // A vertex set is untouched by a hex patch, and comes back by identity.
  expect(out.settlements).toBe(legal.settlements);
});

test("the pirate prunes the hex sets too", () => {
  const h = { q: 0, r: 3 };
  const legal = { pirate_hexes: [h], robber_hexes: [h] };
  const out = pruneLegal(legal, { kind: "pirate", hex: h })!;
  expect(out.pirate_hexes).toEqual([]);
  expect(out.robber_hexes).toEqual([]);
});

test("a marker move that changes no hex set returns legal by identity", () => {
  const legal = { robber_hexes: [{ q: 5, r: 5 }] };
  expect(pruneLegal(legal, { kind: "robber", hex: { q: 0, r: 0 } })).toBe(legal);
});

test("pruning never adds a target; an untouched legal keeps identity", () => {
  const legal = { settlements: [V(5, 5)] };
  const out = pruneLegal(legal, { kind: "settlement", v: V(0, 0), owner: 1 });
  expect(out).toBe(legal);
});

test("undefined sets stay undefined rather than becoming empty arrays", () => {
  const legal = { settlements: [V(0, 0)] };
  const out = pruneLegal(legal, { kind: "settlement", v: V(0, 0), owner: 1 })!;
  expect(out.cities).toBeUndefined();
  expect(out.roads).toBeUndefined();
});

test("applyPatch prunes as it places", () => {
  const v = V(0, 0);
  const view = base({ legal: { settlements: [v], cities: [v] } });
  const next = applyPatch(view, { kind: "settlement", v, owner: 1 });
  expect(next.legal?.settlements).toEqual([]);
  expect(next.buildings).toHaveLength(1);
});
