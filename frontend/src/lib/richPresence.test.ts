import { describe, expect, test } from "vitest";
import {
  buildActivity,
  PresenceController,
  type PresenceInput,
  type RichPresence,
} from "./richPresence";

const base: PresenceInput = {
  gameId: "g123",
  status: "active",
  ruleset: "base",
  seatedPlayers: 4,
  maxPlayers: 4,
  viewerSeat: 0,
  curSeat: 0,
  viewerVP: 7,
};

const STARTED = 1_700_000_000;

describe("buildActivity", () => {
  test("lobby: waiting state, party size, no elapsed timer", () => {
    const a = buildActivity({ ...base, status: "lobby", seatedPlayers: 2 }, STARTED);
    expect(a.type).toBe(0);
    expect(a.details).toBe("Base Game · 4 players");
    expect(a.state).toBe("Waiting for players");
    expect(a.party).toEqual({ id: "g123", size: [2, 4] });
    expect(a.timestamps).toBeUndefined();
    expect(a.assets).toEqual({ large_image: "logo", large_text: "costan.io" });
  });

  test("active, viewer's own turn: 'Your turn' with own VP and elapsed timer", () => {
    const a = buildActivity({ ...base, viewerSeat: 2, curSeat: 2, viewerVP: 6 }, STARTED);
    expect(a.state).toBe("Your turn · 6 VP");
    expect(a.timestamps).toEqual({ start: STARTED });
    expect(a.party).toEqual({ id: "g123", size: [4, 4] });
  });

  test("active, opponent's turn: names the current seat and keeps own VP", () => {
    const a = buildActivity({ ...base, viewerSeat: 0, curSeat: 2, viewerVP: 5 }, STARTED);
    expect(a.state).toBe("Player 3's turn · 5 VP");
  });

  test("active spectator: no own VP suffix", () => {
    const a = buildActivity({ ...base, viewerSeat: -1, curSeat: 0, viewerVP: null }, STARTED);
    expect(a.state).toBe("Player 1's turn");
  });

  test("finished: 'Game over', no elapsed timer", () => {
    const a = buildActivity({ ...base, status: "finished" }, STARTED);
    expect(a.state).toBe("Game over");
    expect(a.timestamps).toBeUndefined();
  });

  test("ruleset label flows through for expansions", () => {
    const a = buildActivity({ ...base, ruleset: "base+cak+islands", maxPlayers: 6 }, STARTED);
    // Module labels are sentence-case messages, uppercased by CSS where needed.
    // Rich presence is plain text, so it gets the words as written.
    expect(a.details).toBe("Knights + Islands · 6 players");
  });
});

describe("PresenceController", () => {
  function harness(clockValues: number[]) {
    const sent: RichPresence[] = [];
    let i = 0;
    const clock = () => clockValues[Math.min(i++, clockValues.length - 1)];
    const c = new PresenceController((a) => sent.push(a), clock);
    return { c, sent };
  }

  test("latches the elapsed-timer start", () => {
    const { c, sent } = harness([1000, 2000, 3000]);
    c.update({ ...base, status: "active", curSeat: 0, viewerSeat: 0 });
    c.update({ ...base, status: "active", curSeat: 1, viewerSeat: 0 }); // turn advances
    expect(sent.map((a) => a.timestamps?.start)).toEqual([1000, 1000]);
  });

  test("dedupes identical snapshots", () => {
    const { c, sent } = harness([1000]);
    const snap: PresenceInput = { ...base, status: "active" };
    c.update(snap);
    c.update({ ...snap });
    expect(sent).toHaveLength(1);
  });

  test("re-emits when the snapshot meaningfully changes", () => {
    const { c, sent } = harness([1000]);
    c.update({ ...base, status: "active", curSeat: 0, viewerSeat: 0, viewerVP: 5 });
    c.update({ ...base, status: "active", curSeat: 0, viewerSeat: 0, viewerVP: 8 });
    expect(sent).toHaveLength(2);
    expect(sent[1].state).toBe("Your turn · 8 VP");
  });

  test("does not latch a start while still in the lobby", () => {
    const { c, sent } = harness([1000, 2000]);
    c.update({ ...base, status: "lobby", seatedPlayers: 2 });
    c.update({ ...base, status: "active" });
    expect(sent[0].timestamps).toBeUndefined();
    expect(sent[1].timestamps).toEqual({ start: 2000 });
  });

  test("clear() lets the next identical update resend", () => {
    const { c, sent } = harness([1000, 1000]);
    const snap: PresenceInput = { ...base, status: "active" };
    c.update(snap);
    c.clear();
    c.update(snap);
    expect(sent).toHaveLength(2);
  });
});
