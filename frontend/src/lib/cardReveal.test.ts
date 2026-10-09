import { describe, expect, test } from "vitest";
import {
  REVEAL_FLIP_END_MS,
  REVEAL_FLIP_START_MS,
  REVEAL_HOLD_MS,
  REVEAL_TRAVEL_MS,
  dockPending,
  lastDrawn,
  revealDurationMs,
  revealPose,
  revealsIn,
  schedule,
} from "./cardReveal";
import type { GameEvent } from "./gamestate";

let seq = 0;
const ev = (type: string, data: unknown): GameEvent => ({ seq: ++seq, type, data });

describe("which events turn a card over, and for whom", () => {
  test("the buyer's Raiders card leaves the shop tile and joins the prompt", () => {
    const [r] = revealsIn([ev("raiders_card", { player: 2, card: "muster" })], 2);
    expect(r).toMatchObject({
      kind: "raiders",
      id: "muster",
      seat: 2,
      mine: true,
      act: "drew",
      from: "shop",
      to: "prompt",
      void: false,
    });
  });

  test("an opponent's leaves the drawing seat and settles toward the log", () => {
    const [r] = revealsIn([ev("raiders_card", { player: 2, card: "treason", gold: 2 })], 0);
    expect(r).toMatchObject({ id: "treason", mine: false, from: "seat", to: "log" });
  });

  test("a spectator sees every card as an opponent does", () => {
    const [r] = revealsIn([ev("raiders_card", { player: 0, card: "intrigue" })], -1);
    expect(r).toMatchObject({ mine: false, from: "seat", to: "log" });
  });

  test("a void card starts no step, even for the buyer", () => {
    const rs = revealsIn(
      [
        ev("raiders_card", { player: 1, card: "intrigue", void: true }),
        ev("raiders_card", { player: 1, card: "muster" }),
      ],
      1,
    );
    expect(rs.map((r) => [r.id, r.void, r.to])).toEqual([
      ["intrigue", true, "log"],
      ["muster", false, "prompt"],
    ]);
  });

  test("a granted card leaves the seat, not the shop", () => {
    const [r] = revealsIn([ev("raiders_card", { player: 1, card: "muster", free: true })], 1);
    expect(r.from).toBe("seat");
  });

  test("Swift Journey: bought into the hand, played out of it", () => {
    const [mineBuy] = revealsIn([ev("wagons_swift_bought", { player: 3 })], 3);
    expect(mineBuy).toMatchObject({
      kind: "dev",
      id: "swift_journey",
      act: "bought",
      from: "shop",
      to: "hand",
    });
    const [oppBuy] = revealsIn([ev("wagons_swift_bought", { player: 3 })], 0);
    expect(oppBuy).toMatchObject({ act: "bought", from: "seat", to: "seat", mine: false });
    const [minePlay] = revealsIn([ev("wagons_swift_played", { player: 3 })], 3);
    expect(minePlay).toMatchObject({ act: "played", from: "hand", to: "log" });
    const [oppPlay] = revealsIn([ev("wagons_swift_played", { player: 3 })], 1);
    expect(oppPlay).toMatchObject({ act: "played", from: "seat", to: "log" });
  });
});

// Only what the server sent: a base development card is never turned over
// (even though the buyer's copy carries the kind), and a Raiders event with no
// nameable card reveals nothing.
describe("redaction", () => {
  test("a base development card purchase is never revealed, to anyone", () => {
    const evs = [
      ev("dev_card_bought", { player: 0, card: 0 }),
      ev("dev_card_bought", { player: 0, card: "knight" }),
      ev("dev_card_bought", { player: 0 }),
    ];
    expect(revealsIn(evs, 0)).toEqual([]);
    expect(revealsIn(evs, 1)).toEqual([]);
  });

  test("no card named, or one this client does not know: nothing", () => {
    expect(revealsIn([ev("raiders_card", { player: 0 })], 1)).toEqual([]);
    expect(revealsIn([ev("raiders_card", { player: 0, card: "sabotage" })], 1)).toEqual([]);
    expect(revealsIn([ev("raiders_card", { player: 0, card: "toString" })], 1)).toEqual([]);
  });

  test("no seat, no reveal", () => {
    expect(revealsIn([ev("raiders_card", { card: "muster" })], 0)).toEqual([]);
    expect(revealsIn([ev("wagons_swift_bought", { player: -1 })], 0)).toEqual([]);
  });

  test("events that are not draws or plays reveal nothing", () => {
    expect(
      revealsIn(
        [
          ev("raiders_rider_placed", { player: 0, card: "muster" }),
          ev("turn_started", { player: 0 }),
        ],
        0,
      ),
    ).toEqual([]);
  });
});

describe("the motion", () => {
  const full = { reduced: false, to: "prompt" as const };

  test("it leaves face down and is face up before it arrives", () => {
    expect(revealPose(10, full).rotY).toBe(180);
    expect(revealPose(REVEAL_FLIP_START_MS, full).rotY).toBe(180);
    const mid = revealPose((REVEAL_FLIP_START_MS + REVEAL_FLIP_END_MS) / 2, full).rotY;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(180);
    expect(revealPose(REVEAL_FLIP_END_MS, full).rotY).toBe(0);
    expect(REVEAL_FLIP_END_MS).toBeLessThan(REVEAL_TRAVEL_MS);
  });

  test("it travels on the card flight's clock, then holds with its caption", () => {
    expect(REVEAL_TRAVEL_MS).toBe(520);
    const early = revealPose(100, full);
    expect(early.phase).toBe("travel");
    expect(early.caption).toBe(false);
    expect(early.t).toBeGreaterThan(0);
    expect(early.t).toBeLessThan(1);
    const held = revealPose(REVEAL_TRAVEL_MS + 700, full);
    expect(held).toMatchObject({
      phase: "hold",
      t: 1,
      rotY: 0,
      scale: 1,
      opacity: 1,
      caption: true,
    });
    // About a second and a half on the table.
    expect(REVEAL_HOLD_MS).toBeGreaterThanOrEqual(1400);
    expect(REVEAL_HOLD_MS).toBeLessThanOrEqual(1600);
  });

  test("then it shrinks to its resting place and is gone", () => {
    const exitAt = REVEAL_TRAVEL_MS + REVEAL_HOLD_MS;
    const a = revealPose(exitAt + 60, { ...full, rest: 0.15 });
    const b = revealPose(exitAt + 240, { ...full, rest: 0.15 });
    expect(a.phase).toBe("exit");
    expect(b.t).toBeGreaterThan(a.t);
    expect(b.scale).toBeLessThan(a.scale);
    expect(a.caption).toBe(false);
    expect(revealPose(revealDurationMs(false), full).phase).toBe("done");
    // Toward the log it fades as it goes; into the prompt it stays solid.
    const toLog = revealPose(exitAt + 240, { reduced: false, to: "log" });
    expect(toLog.opacity).toBeLessThan(b.opacity);
  });

  test("reduced motion fades the face in place", () => {
    const r = { reduced: true, to: "prompt" as const };
    for (const at of [0, 50, 149, 400, 1200, 1700]) {
      const p = revealPose(at, r);
      expect(p.rotY, `at ${at}`).toBe(0);
      expect(p.t, `at ${at}`).toBe(p.phase === "exit" ? 0 : 1);
      expect(p.scale, `at ${at}`).toBe(1);
    }
    expect(revealPose(0, r).opacity).toBe(0);
    expect(revealPose(75, r).opacity).toBeCloseTo(0.5);
    expect(revealPose(400, r)).toMatchObject({ phase: "hold", opacity: 1, caption: true });
    expect(revealPose(revealDurationMs(true), r).phase).toBe("done");
    expect(revealDurationMs(true)).toBeLessThan(revealDurationMs(false));
  });
});

describe("the queue", () => {
  const card = (key: string, mine = false) =>
    ({
      key,
      kind: "raiders",
      id: "muster",
      seat: 0,
      mine,
      act: "drew",
      from: "seat",
      to: mine ? "prompt" : "log",
      void: false,
    }) as const;

  test("a batch plays one card after another, and a repeat is not queued twice", () => {
    const dur = revealDurationMs(false);
    const q = schedule([], [card("1:0"), card("2:0")], 1000, false);
    expect(q.map((s) => s.startAt)).toEqual([1000, 1000 + dur]);
    const again = schedule(q, [card("2:0"), card("3:0")], 1500, false);
    expect(again.map((s) => s.reveal.key)).toEqual(["1:0", "2:0", "3:0"]);
    expect(again[2].startAt).toBe(1000 + 2 * dur);
  });

  test("finished reveals drop out, and a new one starts now", () => {
    const dur = revealDurationMs(false);
    const q = schedule([], [card("1:0")], 0, false);
    const later = schedule(q, [card("2:0")], dur + 5, false);
    expect(later.map((s) => [s.reveal.key, s.startAt])).toEqual([["2:0", dur + 5]]);
  });

  test("the prompt thumbnail waits for the viewer's own card", () => {
    const land = REVEAL_TRAVEL_MS + REVEAL_HOLD_MS + 300;
    const mine = schedule([], [card("1:0", true)], 0, false);
    expect(dockPending(mine, 10, false)).toBe(true);
    expect(dockPending(mine, land - 1, false)).toBe(true);
    expect(dockPending(mine, land, false)).toBe(false);
    const theirs = schedule([], [card("1:0")], 0, false);
    expect(dockPending(theirs, 10, false)).toBe(false);
    // The viewer's own card that goes elsewhere (a void card to the log, a
    // Swift Journey into the hand) leaves the prompt alone.
    const own = revealsIn(
      [
        { seq: 90, type: "raiders_card", data: { player: 0, card: "muster", void: true } },
        { seq: 91, type: "wagons_swift_bought", data: { player: 0 } },
      ],
      0,
    );
    expect(dockPending(schedule([], own, 0, false), 10, false)).toBe(false);
    // Reduced motion lands when the held face goes.
    const reduced = schedule([], [card("1:0", true)], 0, true);
    expect(dockPending(reduced, 1000, true)).toBe(true);
    expect(dockPending(reduced, 1700, true)).toBe(false);
  });
});

describe("the last drawn tab", () => {
  test("shows the seat's latest draw until that seat's next turn begins", () => {
    const log = [
      ev("turn_started", { player: 1 }),
      ev("raiders_card", { player: 1, card: "intrigue", void: true }),
      ev("raiders_card", { player: 1, card: "treason" }),
      ev("turn_started", { player: 2 }),
      ev("raiders_card", { player: 2, card: "muster" }),
    ];
    expect(lastDrawn(log, 1)).toEqual({ kind: "raiders", id: "treason" });
    expect(lastDrawn(log, 2)).toEqual({ kind: "raiders", id: "muster" });
    expect(lastDrawn(log, 0)).toBeNull();
    // Another seat's turn does not clear it; its own next turn does.
    expect(lastDrawn([...log, ev("turn_started", { player: 3 })], 1)).not.toBeNull();
    expect(lastDrawn([...log, ev("turn_started", { player: 1 })], 1)).toBeNull();
  });

  test("a Swift Journey bought is a draw; playing one is not", () => {
    const log = [ev("turn_started", { player: 0 }), ev("wagons_swift_bought", { player: 0 })];
    expect(lastDrawn(log, 0)).toEqual({ kind: "dev", id: "swift_journey" });
    const played = [ev("turn_started", { player: 0 }), ev("wagons_swift_played", { player: 0 })];
    expect(lastDrawn(played, 0)).toBeNull();
  });

  test("never a base development card", () => {
    const log = [
      ev("turn_started", { player: 0 }),
      ev("dev_card_bought", { player: 0, card: "knight" }),
    ];
    expect(lastDrawn(log, 0)).toBeNull();
  });
});
