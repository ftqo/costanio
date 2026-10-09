import { describe, it, test, expect } from "vitest";
import {
  autoDiscardToast,
  autoAqueductToast,
  autoResolveToasts,
  pendingSnapshot,
  AUTO_RESOLVE_KINDS,
  AUTO_RESOLVE_MESSAGES,
  NO_PENDINGS,
  PROGRESS_HAND_LIMIT,
  PENDING_RESOLVED_BY,
  aqueductResourceFrom,
  resolvedKinds,
  resolvesPending,
  type AutoResolveKind,
  type PendingSnapshot,
} from "./autoResolveToast";
import type { KnightsExt, FullView } from "./types";

describe("autoDiscardToast", () => {
  it("pluralizes the card count", () => {
    expect(autoDiscardToast(1)).toBe("Time ran out. 1 card discarded automatically.");
    expect(autoDiscardToast(3)).toBe("Time ran out. 3 cards discarded automatically.");
  });
});

describe("autoAqueductToast", () => {
  it("names the resource the player was forced to receive", () => {
    expect(autoAqueductToast("wheat")).toBe(
      "Time ran out. Automatically received wheat (Aqueduct).",
    );
  });
  it("explains an empty bank instead of naming a resource", () => {
    const msg = autoAqueductToast("");
    expect(msg).toContain("bank was empty");
    expect(msg).not.toContain("Automatically received");
  });
});

// ---- totality ----
//
// The types guarantee a message per kind. These check the message is usable
// and the snapshot has a slot to detect each kind.
test("every auto-resolve kind is detectable and has a message", () => {
  expect(AUTO_RESOLVE_KINDS.length).toBe(14);
  for (const kind of AUTO_RESOLVE_KINDS) {
    expect(NO_PENDINGS, kind).toHaveProperty(kind);
    const msg = AUTO_RESOLVE_MESSAGES[kind]({ n: 2, res: "ore" });
    expect(msg, kind).toMatch(/^Time ran out\. /);
    expect(msg.length, kind).toBeGreaterThan(24);
    // No raw wire identifiers in player-facing text.
    expect(msg, kind).not.toContain("_");
  }
  // The detector is driven by that list, not a hand-written switch.
  const all: PendingSnapshot = Object.fromEntries(
    AUTO_RESOLVE_KINDS.map((k) => [k, 1]),
  ) as PendingSnapshot;
  expect(autoResolveToasts(all, { ...NO_PENDINGS })).toHaveLength(AUTO_RESOLVE_KINDS.length);
});

// ---- detection ----

const snap = (over: Partial<PendingSnapshot> = {}): PendingSnapshot => ({
  ...NO_PENDINGS,
  ...over,
});

test("reports each pending that cleared without a command", () => {
  const cases: {
    name: string;
    prev: Partial<PendingSnapshot>;
    next?: Partial<PendingSnapshot>;
    want: string[];
  }[] = [
    {
      name: "the 7-roll discard keeps its count from the previous frame",
      prev: { discard: 4 },
      want: ["Time ran out. 4 cards discarded automatically."],
    },
    {
      name: "the Wedding give",
      prev: { give: 2 },
      want: ["Time ran out. 2 cards handed over automatically (Wedding)."],
    },
    {
      name: "the Commercial Harbor commodity",
      prev: { harbor: 1 },
      want: ["Time ran out. A commodity was handed over automatically (Commercial Harbor)."],
    },
    {
      name: "the Spy pick",
      prev: { spy: 1 },
      want: ["Time ran out. A progress card was taken for you (Spy)."],
    },
    {
      name: "the Master Merchant pick",
      prev: { master_merchant: 1 },
      want: ["Time ran out. Cards were taken for you (Master Merchant)."],
    },
    {
      name: "the Deserter's two halves, victim then taker",
      prev: { deserter_surrender: 1 },
      want: ["Time ran out. Your strongest knight was surrendered automatically (Deserter)."],
    },
    {
      name: "the Deserter's replacement placement",
      prev: { deserter_place: 1 },
      want: ["Time ran out. Your replacement knight was placed for you (Deserter)."],
    },
    {
      name: "the displaced knight's relocation",
      prev: { relocate_knight: 1 },
      want: ["Time ran out. Your displaced knight was relocated for you."],
    },
    {
      name: "the tied defender's draw",
      prev: { defender_draw: 1 },
      want: ["Time ran out. A progress card was drawn for you (top defender)."],
    },
    {
      // Without detection this card leaves the hand with no toast and no log line.
      name: "the over-limit progress discard",
      prev: { progress_discard: 1 },
      want: ["Time ran out. A progress card was discarded for you (over the hand limit)."],
    },
    {
      name: "a pending still owed says nothing yet",
      prev: { discard: 3 },
      next: { discard: 3 },
      want: [],
    },
    {
      name: "a partially-served discard is still owed",
      prev: { discard: 3 },
      next: { discard: 1 },
      want: [],
    },
    {
      name: "two pendings resolving in one frame get one line each",
      prev: { spy: 1, aqueduct: 1 },
      want: [
        "Time ran out. A progress card was taken for you (Spy).",
        "Time ran out. The bank was empty, so the Aqueduct gave nothing.",
      ],
    },
  ];
  for (const c of cases) {
    expect(autoResolveToasts(snap(c.prev), snap(c.next ?? {})), c.name).toEqual(c.want);
  }
});

test("reports nothing on the first frame", () => {
  // A player joining mid-decision has no `prev`; nothing just resolved.
  expect(autoResolveToasts(null, snap({ discard: 4 }))).toEqual([]);
  expect(autoResolveToasts(undefined, snap())).toEqual([]);
});

test("does not report a kind the player resolved", () => {
  // The wire cannot tell a confirm from a timeout, so the caller says which
  // ones it just sent, like the `*Initiated` refs.
  const prev = snap({ discard: 2, spy: 1 });
  expect(autoResolveToasts(prev, snap(), { initiated: ["discard"] })).toEqual([
    "Time ran out. A progress card was taken for you (Spy).",
  ]);
  expect(autoResolveToasts(prev, snap(), { initiated: ["discard", "spy"] })).toEqual([]);
});

test("aqueduct message names the given resource", () => {
  expect(autoResolveToasts(snap({ aqueduct: 1 }), snap(), { aqueductRes: "ore" })).toEqual([
    "Time ran out. Automatically received ore (Aqueduct).",
  ]);
});

// ---- reading the view ----

const view = (viewer: number, knights?: Partial<KnightsExt>, discards?: Record<number, number>) =>
  ({
    viewer,
    pending_discards: discards,
    ext: knights ? { cak: { players: [], ...knights } } : undefined,
  }) as unknown as FullView;

test("pendingSnapshot reads what the viewer owes", () => {
  expect(pendingSnapshot(null)).toEqual(NO_PENDINGS);
  // A spectator owes nothing by construction.
  expect(pendingSnapshot(view(-1, { deserter_victim: 1 }, { 1: 3 }))).toEqual(NO_PENDINGS);
  // Base game, no Knights ext at all.
  expect(pendingSnapshot(view(1, undefined, { 1: 3 }))).toEqual({ ...NO_PENDINGS, discard: 3 });

  const cases: { name: string; knights: Partial<KnightsExt>; want: Partial<PendingSnapshot> }[] = [
    { name: "wedding give", knights: { pending_give: { 1: 2 } }, want: { give: 2 } },
    { name: "harbor", knights: { harbor_give: { 1: 4 } }, want: { harbor: 1 } },
    // harbor_give maps a seat to the offered resource; 0 (wood) is a real
    // offer, so test presence, not truthiness.
    { name: "harbor with wood", knights: { harbor_give: { 1: 0 } }, want: { harbor: 1 } },
    { name: "not my harbor", knights: { harbor_give: { 2: 4 } }, want: {} },
    { name: "spy", knights: { spy: { victim: 0, cards: ["spy"] } }, want: { spy: 1 } },
    {
      name: "master merchant",
      knights: { master_merchant: { victim: 0 } },
      want: { master_merchant: 1 },
    },
    { name: "deserter victim", knights: { deserter_victim: 1 }, want: { deserter_surrender: 1 } },
    { name: "deserter taker", knights: { deserter_taker: 1 }, want: { deserter_place: 1 } },
    { name: "aqueduct", knights: { aqueduct: [0, 1] }, want: { aqueduct: 1 } },
    { name: "relocation", knights: { reloc_player: 1 }, want: { relocate_knight: 1 } },
    // Only the seat at the front of the queue draws next; the timer cannot
    // resolve the others yet.
    {
      name: "defender draw, my turn",
      knights: { defender_draws: [1, 2] },
      want: { defender_draw: 1 },
    },
    { name: "defender draw, waiting", knights: { defender_draws: [2, 1] }, want: {} },
    // The barbarian sacrifice is simultaneous: every listed seat owes now.
    {
      name: "barbarian sacrifice, listed first",
      knights: { barbarian_downgrade: [1, 2] },
      want: { barbarian_downgrade: 1 },
    },
    {
      name: "barbarian sacrifice, listed second",
      knights: { barbarian_downgrade: [2, 1] },
      want: { barbarian_downgrade: 1 },
    },
    { name: "someone else's barbarian sacrifice", knights: { barbarian_downgrade: [2] }, want: {} },
    {
      name: "over the progress hand limit",
      knights: {
        players: [{}, { progress_count: PROGRESS_HAND_LIMIT + 1 }] as KnightsExt["players"],
      },
      want: { progress_discard: 1 },
    },
    {
      name: "at the progress hand limit",
      knights: { players: [{}, { progress_count: PROGRESS_HAND_LIMIT }] as KnightsExt["players"] },
      want: {},
    },
  ];
  for (const c of cases) {
    expect(
      pendingSnapshot(
        view(1, { deserter_victim: -1, deserter_taker: -1, reloc_player: -1, ...c.knights }),
      ),
      c.name,
    ).toEqual({ ...NO_PENDINGS, ...c.want });
  }
});

test("reports a timed-out gold pick with or without knights", () => {
  // Islands alone has no ext.cak, so gold must be read before the Knights return.
  const islandsOnly = (n: number) =>
    ({
      viewer: 1,
      ext: { islands: { ships: [], ships_left: [], moved_ship: false, pending_gold: { 1: n } } },
    }) as unknown as FullView;
  expect(pendingSnapshot(islandsOnly(2))).toEqual({ ...NO_PENDINGS, gold: 2 });
  expect(
    autoResolveToasts(pendingSnapshot(islandsOnly(2)), pendingSnapshot(islandsOnly(0))),
  ).toEqual(["Time ran out. 2 resources were picked for you from the gold hex."]);
  // A pick the player made is theirs, not the clock's.
  expect(
    autoResolveToasts(pendingSnapshot(islandsOnly(1)), pendingSnapshot(islandsOnly(0)), {
      initiated: [resolvesPending("choose_gold", false)!],
    }),
  ).toEqual([]);
});

test("produces toasts from a view-to-view transition", () => {
  // The shape a caller uses: snapshot each frame, diff against the last one.
  const owed = view(1, { deserter_victim: 1, deserter_taker: -1, reloc_player: -1 });
  const done = view(1, { deserter_victim: -1, deserter_taker: -1, reloc_player: -1 });
  const kinds: AutoResolveKind[] = [];
  const msgs = autoResolveToasts(pendingSnapshot(owed), pendingSnapshot(done), {
    initiated: kinds,
  });
  expect(msgs).toEqual([
    "Time ran out. Your strongest knight was surrendered automatically (Deserter).",
  ]);
});

// ---------------------------------------------------------------------------
// resolvedKinds / the `initiated` bookkeeping
// ---------------------------------------------------------------------------
//
// The client cannot tell "you confirmed" from "the timer fired" (the state
// frame is identical), so a submit path that does not flag itself produces a
// false "Time ran out" toast on a manual play.

describe("resolvedKinds", () => {
  const owed = (o: Partial<PendingSnapshot>): PendingSnapshot => ({ ...NO_PENDINGS, ...o });

  it("lists only the kinds that went from owed to clear", () => {
    expect(resolvedKinds(owed({ discard: 3, spy: 1 }), owed({ spy: 1 }))).toEqual(["discard"]);
  });

  it("is empty with no previous frame", () => {
    expect(resolvedKinds(null, owed({ discard: 3 }))).toEqual([]);
  });

  it("ignores a pending that shrank", () => {
    expect(resolvedKinds(owed({ discard: 4 }), owed({ discard: 2 }))).toEqual([]);
  });

  it("ignores a pending that just appeared", () => {
    expect(resolvedKinds(owed({}), owed({ harbor: 1 }))).toEqual([]);
  });

  it("matches the kinds autoResolveToasts reports", () => {
    const prev = owed({ discard: 2, give: 1, aqueduct: 1 });
    const next = owed({ give: 1 });
    expect(resolvedKinds(prev, next)).toEqual(["discard", "aqueduct"]);
    // Both, once nothing is flagged as self-initiated.
    expect(autoResolveToasts(prev, next)).toHaveLength(2);
  });
});

describe("initiated suppression", () => {
  const owed = (o: Partial<PendingSnapshot>): PendingSnapshot => ({ ...NO_PENDINGS, ...o });

  it("suppresses a kind the player resolved", () => {
    expect(autoResolveToasts(owed({ spy: 1 }), owed({}), { initiated: ["spy"] })).toEqual([]);
  });

  it("still reports other kinds in the same frame", () => {
    // Confirming a discard and letting the Aqueduct time out is one frame.
    const msgs = autoResolveToasts(owed({ discard: 2, aqueduct: 1 }), owed({}), {
      initiated: ["discard"],
      aqueductRes: "ore",
    });
    expect(msgs).toEqual(["Time ran out. Automatically received ore (Aqueduct)."]);
  });

  it("ignores a flag for a kind that did not resolve", () => {
    expect(
      autoResolveToasts(owed({ discard: 1 }), owed({}), { initiated: ["harbor"] }),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The command → pending table
// ---------------------------------------------------------------------------

describe("PENDING_RESOLVED_BY / resolvesPending", () => {
  it("covers every force-resolvable kind", () => {
    // Every kind needs a command mapped to it, or it can never be flagged as
    // self-initiated. `progress_discard` maps via discard_progress;
    // play_progress is its conditional second route.
    const covered = new Set(Object.values(PENDING_RESOLVED_BY));
    expect([...AUTO_RESOLVE_KINDS].filter((k) => !covered.has(k))).toEqual([]);
  });

  it("maps each command to the pending it clears", () => {
    expect(resolvesPending("discard_cards", false)).toBe("discard");
    expect(resolvesPending("harbor_give", false)).toBe("harbor");
    expect(resolvesPending("master_merchant_pick", false)).toBe("master_merchant");
    expect(resolvesPending("deserter_surrender", false)).toBe("deserter_surrender");
    expect(resolvesPending("deserter_place", false)).toBe("deserter_place");
    expect(resolvesPending("relocate_knight", false)).toBe("relocate_knight");
    expect(resolvesPending("defender_draw", false)).toBe("defender_draw");
    expect(resolvesPending("discard_progress", false)).toBe("progress_discard");
  });

  // Rivers with Knights: paying 5 coins and giving up a city both clear
  // `barbarian_downgrade`.
  it("treats a pillage buyout as answering the sacrifice", () => {
    expect(resolvesPending("pillage_buyout", false)).toBe("barbarian_downgrade");
    expect(resolvesPending("barbarian_downgrade", false)).toBe("barbarian_downgrade");
  });

  it("ignores commands that resolve nothing", () => {
    expect(resolvesPending("build_road", false)).toBeNull();
    expect(resolvesPending("end_turn", true)).toBeNull();
  });

  it("play_progress clears an over-limit hand only", () => {
    // docs/rules/knights.md: playing a card down to the limit is the other way
    // out of an over-limit hand, so it is a manual resolution, not a timeout.
    expect(resolvesPending("play_progress", true)).toBe("progress_discard");
    expect(resolvesPending("play_progress", false)).toBeNull();
  });
});

describe("aqueductResourceFrom", () => {
  const ev = (type: string, data: unknown) => ({ type, data });

  it("reads the newest matching event for the seat", () => {
    const events = [
      ev("cak_aqueduct_taken", { player: 1, res: "brick" }),
      ev("cak_aqueduct_taken", { player: 0, res: "wood" }),
      ev("dice_rolled", { d1: 3, d2: 4 }),
      ev("cak_aqueduct_taken", { player: 0, res: "ore" }),
    ];
    expect(aqueductResourceFrom(events, 0)).toBe("ore");
    expect(aqueductResourceFrom(events, 1)).toBe("brick");
  });

  it('reads the empty-bank pick ("none") as no resource', () => {
    expect(aqueductResourceFrom([ev("cak_aqueduct_taken", { player: 0, res: "none" })], 0)).toBe(
      "",
    );
  });

  it("returns nothing for a spectator, missing seat or empty log", () => {
    expect(aqueductResourceFrom([ev("cak_aqueduct_taken", { player: 0, res: "ore" })], -1)).toBe(
      "",
    );
    expect(aqueductResourceFrom([ev("cak_aqueduct_taken", { player: 0, res: "ore" })], 2)).toBe("");
    expect(aqueductResourceFrom([], 0)).toBe("");
    expect(aqueductResourceFrom(undefined, 0)).toBe("");
  });
});

// The metropolis city choice is force-resolvable: on timeout the server puts
// it on the first eligible city in board order. Detected from the field that
// drives the prompt.
describe("metropolis city pick", () => {
  const view = (pick?: { player: number; track: number; prev: number }) =>
    ({
      viewer: 1,
      ext: { cak: { metropolis_pick: pick, players: [{}, {}] } },
    }) as unknown as FullView;

  test("owed only by the seat that earned it", () => {
    expect(pendingSnapshot(view({ player: 1, track: 0, prev: -1 })).metropolis_pick).toBe(1);
    expect(pendingSnapshot(view({ player: 0, track: 0, prev: -1 })).metropolis_pick).toBe(0);
    expect(pendingSnapshot(view(undefined)).metropolis_pick).toBe(0);
  });

  test("clearing it unannounced produces a toast", () => {
    const before = pendingSnapshot(view({ player: 1, track: 2, prev: -1 }));
    const after = pendingSnapshot(view(undefined));
    expect(autoResolveToasts(before, after)).toEqual([
      AUTO_RESOLVE_MESSAGES.metropolis_pick({ n: 1, res: "" }),
    ]);
    // ...unless the player answered it themselves.
    expect(autoResolveToasts(before, after, { initiated: ["metropolis_pick"] })).toEqual([]);
  });

  test("the pick command is wired to the pending it resolves", () => {
    expect(resolvesPending("metropolis_pick", false)).toBe("metropolis_pick");
  });
});
