import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { GameSocket } from "./ws";
import type { FullView } from "./types";

// Minimal FullView factory; only `seq` matters for these tests.
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

// A controllable stand-in for the browser WebSocket.
class FakeWS {
  static last: FakeWS | null = null;
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWS.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  recv(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

let now = 0;
function makeSocket() {
  return new GameSocket({ wsFactory: (url) => new FakeWS(url), now: () => now });
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  FakeWS.last = null;
});
afterEach(() => {
  vi.useRealTimers();
});

test("seed sets full/log/chat and clears the connecting gate", () => {
  const s = makeSocket();
  s.seed({
    view: view(5),
    log: [{ seq: 4, type: "x", data: null }],
    chat: [{ scope: "game:g", from: "a", user_id: 1, msg: "hi" }],
  });
  expect(s.getSnapshot().full?.seq).toBe(5);
  expect(s.getSnapshot().events.length).toBe(1);
  expect(s.getSnapshot().chat.length).toBe(1);
});

test("seq-wins: a stale seed does not clobber newer live full", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 10, full: view(10) });
  s.seed({ view: view(7) }); // older
  expect(s.getSnapshot().full?.seq).toBe(10);
});

test("seq-wins: ws state never regresses to an older seq", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 10, full: view(10) });
  s.ingest({ t: "state", game: "g", seq: 8, full: view(8) }); // stale arrival
  expect(s.getSnapshot().full?.seq).toBe(10);
});

test("the event log is kept in full, not capped to a window", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) }); // baseline lastSeq=0
  for (let i = 1; i <= 200; i++) {
    s.ingest({ t: "ev", game: "g", seq: i, ev: { seq: i, type: "x", data: null } });
  }
  const events = s.getSnapshot().events;
  expect(events.length).toBe(200);
  expect(events[0].seq).toBe(1); // the oldest line is still there to scroll back to
  expect(events.at(-1)!.seq).toBe(200);
});

test("a seed backfills history in front of events already streamed", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  // The websocket answers first; the HTTP getGame lands after, carrying the
  // whole game up to that point.
  s.ingest({ t: "state", game: "g", seq: 41, full: view(41) });
  s.ingest({ t: "ev", game: "g", seq: 41, ev: { seq: 41, type: "x", data: null } });
  s.seed({ log: Array.from({ length: 41 }, (_, i) => ({ seq: i, type: "x", data: null })) });
  expect(s.getSnapshot().events.map((e) => e.seq)).toEqual(Array.from({ length: 42 }, (_, i) => i));
});

test("a reconnect's refetch neither duplicates nor drops log lines", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 0, full: view(0) });
  for (let i = 0; i <= 5; i++) {
    s.ingest({ t: "ev", game: "g", seq: i, ev: { seq: i, type: "x", data: null } });
  }
  // Events 6 and 7 happen while the socket is down, then 8 arrives live: the
  // client detects the gap and the screen refetches from logSince().
  expect(s.logSince()).toBe(6);
  s.ingest({ t: "ev", game: "g", seq: 8, ev: { seq: 8, type: "x", data: null } });
  expect(s.logSince()).toBe(6); // the hole, not the end
  // The refetch answers ?since=6, overlapping the 8 already applied.
  s.seed({
    log: [
      { seq: 6, type: "x", data: null },
      { seq: 7, type: "x", data: null },
      { seq: 8, type: "x", data: null },
    ],
  });
  expect(s.getSnapshot().events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(s.logSince()).toBe(9);
});

test("logSince asks for the whole log when the client holds none", () => {
  const s = makeSocket();
  expect(s.logSince()).toBe(0);
  s.follow("g");
  s.seed({ log: [{ seq: 0, type: "x", data: null }] });
  expect(s.logSince()).toBe(1);
  s.unfollow(); // leaving the table drops the log; re-entering re-fetches all of it
  expect(s.logSince()).toBe(0);
});

test("chat buffer caps at 50", () => {
  const s = makeSocket();
  for (let i = 0; i < 60; i++) {
    s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: `m${i}` });
  }
  expect(s.getSnapshot().chat.length).toBe(50);
});

test("seq-gap schedules exactly one reconcile per burst", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) }); // lastSeq=0
  const before = s.getSnapshot().reconcile;
  // Burst of out-of-order/ahead events: each is a gap relative to lastSeq.
  s.ingest({ t: "ev", game: "g", seq: 5, ev: { seq: 5, type: "x", data: null } });
  s.ingest({ t: "ev", game: "g", seq: 9, ev: { seq: 9, type: "x", data: null } });
  vi.advanceTimersByTime(200); // fire the debounce (never runAllTimers: the reconnect and stall loops are unbounded by design)
  expect(s.getSnapshot().reconcile).toBe(before + 1);
});

test("a snapshot that jumps past the log reconciles the missing lines", () => {
  // A state frame ahead of the last event means events were lost with an old
  // subscription; the log must notice and backfill.
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 0, full: view(0) });
  for (let i = 0; i <= 3; i++) {
    s.ingest({ t: "ev", game: "g", seq: i, ev: { seq: i, type: "x", data: null } });
  }
  const before = s.getSnapshot().reconcile;
  // In step: a snapshot right behind the last event is not a gap.
  s.ingest({ t: "state", game: "g", seq: 4, full: view(4) });
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(before);
  // Events 4 and 5 were lost with the old subscription; the snapshot is at 6.
  s.ingest({ t: "state", game: "g", seq: 6, full: view(6) });
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(before + 1);
  expect(s.logSince()).toBe(4);
});

test("a resumed re-subscribe neither reconciles nor duplicates", () => {
  // A re-subscribe resumes the old stream: owed events arrive as ev frames,
  // then a snapshot exactly at the next seq. That is in step, so no backfill,
  // and an overlapping refetch must not double a line or replay a roll.
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 0, full: view(0) });
  const ev = (seq: number, type = "x", data: unknown = null) =>
    s.ingest({ t: "ev", game: "g", seq, ev: { seq, type, data } });
  for (let i = 0; i <= 3; i++) ev(i);
  const before = s.getSnapshot().reconcile;
  // The re-sub: owed 4 (a roll) and 5, then the snapshot at 6.
  ev(4, "dice_rolled", { d1: 3, d2: 4 });
  ev(5);
  s.ingest({ t: "state", game: "g", seq: 6, full: view(6) });
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(before);
  expect(s.getSnapshot().events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  const roll = s.getSnapshot().lastRoll;
  expect(roll).toEqual({ d1: 3, d2: 4, seq: 4 });
  // A reconcile for some other reason refetches an overlapping tail: nothing
  // doubles, and the live roll is not swapped for a seeded copy of itself.
  s.seed({
    log: [3, 4, 5].map((seq) => ({
      seq,
      type: seq === 4 ? "dice_rolled" : "x",
      data: seq === 4 ? { d1: 3, d2: 4 } : null,
    })),
  });
  expect(s.getSnapshot().events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(s.getSnapshot().lastRoll).toBe(roll);
});

test("a snapshot on a cold load does not reconcile before the seed lands", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 40, full: view(40) });
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(0);
});

test("resync frame triggers a reconcile", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  const before = s.getSnapshot().reconcile;
  s.ingest({ t: "resync", game: "g" });
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(before + 1);
});

test("reconnect triggers a reconcile, but the first connect does not", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open(); // first connect
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(0); // no reconcile on first open
  FakeWS.last!.close(); // drop
  vi.advanceTimersByTime(1000); // backoff reconnect timer
  FakeWS.last!.open(); // reconnect
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(1);
});

test("resync re-subscribes to recover a dropped started broadcast", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  // Sitting in the waiting room on a lobby subscription. The one-shot
  // started:true broadcast is dropped to this busy connection (hub trySend), so
  // none of the enter-game signals arrive.
  s.ingest({ t: "lobby", game: "g" }); // lobby summary, still "lobby"
  expect(s.getSnapshot().started).toBe(false);
  expect(s.getSnapshot().full).toBeNull();

  const ws = FakeWS.last!;
  ws.sent.length = 0;
  s.resync(); // the waiting-room heartbeat re-subscribes
  expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({ t: "sub", game: "g" });

  // The server answers a sub to a now-active game with started + full state
  // (ws.go active branch). That recovers the missed transition.
  s.ingest({ t: "lobby", game: "g", started: true });
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  expect(s.getSnapshot().started).toBe(true);
  expect(s.getSnapshot().full?.seq).toBe(1);
});

test("resync is a no-op when not following a game", () => {
  const s = makeSocket();
  s.resync(); // no socket, no game: must not throw or send
  expect(FakeWS.last).toBeNull();
});

test("frames delivered via the socket onmessage are ingested", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  FakeWS.last!.recv({ t: "state", game: "g", seq: 3, full: view(3) });
  expect(s.getSnapshot().full?.seq).toBe(3);
});

test("the first open after disconnect does not reconcile", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open(); // first connect
  FakeWS.last!.close();
  vi.advanceTimersByTime(1000);
  FakeWS.last!.open(); // reconnect -> reconcile 1
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(1);

  s.disconnect(); // logout: resets reconcile nonce + everConnected
  s.follow("g");
  FakeWS.last!.open(); // first connect again -> must not reconcile
  vi.advanceTimersByTime(200);
  expect(s.getSnapshot().reconcile).toBe(0);
});

test("wantOpen is true while live and false after logout", () => {
  const s = makeSocket();
  expect(s.getSnapshot().wantOpen).toBe(false); // nothing opened yet
  s.follow("g");
  FakeWS.last!.open();
  expect(s.getSnapshot().wantOpen).toBe(true); // session live
  FakeWS.last!.close(); // transient drop: still wants to be open -> genuinely reconnecting
  expect(s.getSnapshot().wantOpen).toBe(true);
  s.disconnect(); // logout: socket intentionally torn down
  expect(s.getSnapshot().wantOpen).toBe(false); // not reconnecting -> indicator must stay silent
});

// ---- automatic reconnection ----
//
// No button in the app reconnects a socket, so these cover the only recovery
// path.

test("the retry loop has no attempt limit", () => {
  const s = makeSocket();
  s.ensureOpen();
  // A hundred consecutive failures: each open answered by a close, as from a
  // backend that is down for a long time.
  for (let i = 0; i < 100; i++) {
    FakeWS.last!.close();
    vi.advanceTimersByTime(60_000);
  }
  // Still dialling, on a bounded delay.
  const dialled = FakeWS.last!;
  expect(s.getSnapshot().status).toBe("connecting");
  dialled.open();
  expect(s.getSnapshot().status).toBe("open");
});

test("the reconnect delay is jittered and capped", () => {
  const delays: number[] = [];
  const s = new GameSocket({
    wsFactory: (url) => new FakeWS(url),
    now: () => now,
    random: () => 1, // the top of the full-jitter range, i.e. the backoff itself
  });
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: () => void, ms?: number) => {
    if (typeof ms === "number" && ms > 0) delays.push(ms);
    return realSetTimeout(fn, ms);
  });
  try {
    s.ensureOpen();
    for (let i = 0; i < 12; i++) {
      FakeWS.last!.close();
      vi.advanceTimersByTime(60_000);
    }
  } finally {
    vi.mocked(globalThis.setTimeout).mockRestore();
  }
  const backoffs = delays.filter((d) => d >= 500 && d <= 15_000);
  expect(backoffs[0]).toBe(500); // starts small: a blip is back near-instantly
  expect(Math.max(...backoffs)).toBeLessThanOrEqual(15_000); // and never runs away
});

test("everOpen survives a connect and a close inside one frame", () => {
  // `everOpen` is latched on the transition, so a socket that opens and closes
  // before the next frame boundary still counts as having been open, and the
  // pill calls the next connect a reconnect.
  const s = makeSocket();
  s.ensureOpen();
  const ws = FakeWS.last!;
  ws.open();
  ws.close(); // both inside one frame: no listener has run yet
  expect(s.getSnapshot().everOpen).toBe(true);
  s.disconnect(); // logout forgets it, so a re-login's first connect reads right
  expect(s.getSnapshot().everOpen).toBe(false);
});

test("a silent socket is probed, and an unanswered probe is redialled", () => {
  const s = makeSocket();
  s.follow("g");
  const dead = FakeWS.last!;
  dead.open();
  dead.sent.length = 0;
  // Nothing arrives for the idle threshold: half-open looks like quiet, so ask.
  now = 20_000;
  vi.advanceTimersByTime(20_000);
  expect(dead.sent.map((r) => JSON.parse(r).t)).toContain("ping");
  // Still nothing back: the socket is dropped and a new one dialled.
  now = 31_000;
  vi.advanceTimersByTime(11_000);
  vi.advanceTimersByTime(1_000); // the reconnect's jittered delay
  expect(FakeWS.last).not.toBe(dead);
  expect(dead.readyState).toBe(3);
});

test("an answered probe leaves the socket alone", () => {
  const s = makeSocket();
  s.follow("g");
  const ws = FakeWS.last!;
  ws.open();
  now = 20_000;
  vi.advanceTimersByTime(20_000);
  now = 22_000;
  ws.recv({ t: "pong" }); // the server is alive after all
  now = 40_000;
  vi.advanceTimersByTime(20_000);
  expect(FakeWS.last).toBe(ws);
  expect(s.getSnapshot().status).toBe("open");
});

test("any frame at all counts as an answer, not just the pong", () => {
  const s = makeSocket();
  s.follow("g");
  const ws = FakeWS.last!;
  ws.open();
  now = 20_000;
  vi.advanceTimersByTime(20_000); // probe goes out
  now = 25_000;
  ws.recv({ t: "state", game: "g", seq: 1, full: view(1) });
  now = 34_000;
  vi.advanceTimersByTime(9_000);
  expect(FakeWS.last).toBe(ws); // not torn down
  expect(s.getSnapshot().full?.seq).toBe(1);
});

test("an expired session stops the retry loop", () => {
  const s = makeSocket();
  s.follow("g");
  const ws = FakeWS.last!;
  ws.open();
  s.ingest({ t: "err", code: "AUTH_REQUIRED", ref: "r" });
  expect(s.getSnapshot().sessionGone).toBe(true);
  expect(s.getSnapshot().status).toBe("closed");
  // `wantOpen` stays true: the visitor did not log out, so this is not the
  // silent teardown path. Root turns the flag into a trip through auth.
  expect(s.getSnapshot().wantOpen).toBe(true);
  vi.advanceTimersByTime(300_000);
  expect(FakeWS.last).toBe(ws); // no redial, at all
  s.ensureOpen();
  expect(FakeWS.last).toBe(ws); // and ensureOpen does not restart it either
  s.disconnect(); // a fresh login clears the flag
  expect(s.getSnapshot().sessionGone).toBe(false);
});

test("an invalid session token is treated the same way", () => {
  const s = makeSocket();
  s.ensureOpen();
  FakeWS.last!.open();
  s.ingest({ t: "err", code: "INVALID_SESSION", ref: "r" });
  expect(s.getSnapshot().sessionGone).toBe(true);
});

test("an ordinary refusal is not an expired session", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "err", code: "GAME_NOT_FOUND", ref: "r" });
  expect(s.getSnapshot().sessionGone).toBe(false);
  expect(s.getSnapshot().status).toBe("open");
});

test("reconnectNow drops a socket the browser still believes in", () => {
  const s = makeSocket();
  s.follow("g");
  const dead = FakeWS.last!;
  dead.open();
  expect(dead.readyState).toBe(1); // OPEN: nothing in the socket can see the fault
  s.reconnectNow();
  expect(dead.readyState).toBe(3);
  vi.advanceTimersByTime(1_000);
  expect(FakeWS.last).not.toBe(dead);
  FakeWS.last!.open();
  expect(s.getSnapshot().status).toBe("open");
  // ...and it re-subscribes to the game it was following, unasked.
  expect(
    FakeWS.last!.sent.map((r) => JSON.parse(r) as { t: string; game?: string }),
  ).toContainEqual(expect.objectContaining({ t: "sub", game: "g" }));
});

test("reconnectNow stays put after a logout", () => {
  const s = makeSocket();
  s.ensureOpen();
  FakeWS.last!.open();
  s.disconnect();
  const after = FakeWS.last;
  s.reconnectNow();
  vi.advanceTimersByTime(60_000);
  expect(FakeWS.last).toBe(after);
  expect(s.getSnapshot().status).toBe("closed");
});

test("chat send throttles to 1/sec", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  const ws = FakeWS.last!;
  const chatCount = () => ws.sent.filter((r) => JSON.parse(r).t === "chat").length;
  now = 1000;
  expect(s.chat("game:g", "a")).toBe(true);
  expect(s.chat("game:g", "b")).toBe(false); // same instant -> dropped
  now = 1500;
  expect(s.chat("game:g", "c")).toBe(false); // <1s -> dropped
  now = 2000;
  expect(s.chat("game:g", "d")).toBe(true); // 1s later -> sent
  expect(chatCount()).toBe(2);
});

test("each err frame bumps errorSeq so a toast effect refires", () => {
  const s = makeSocket();
  expect(s.getSnapshot().errorSeq).toBe(0);
  s.ingest({ t: "err", code: "BAD", debug: "nope", ref: "r1" });
  expect(s.getSnapshot().errorSeq).toBe(1);
  // The server's `debug` string is dropped at this boundary: the screen renders
  // its own copy from the code (see lib/errorCopy).
  expect(s.getSnapshot().error).toEqual({ code: "BAD", params: undefined, ref: "r1" });
  // An identical error must still bump the nonce, so a repeated mistake (e.g.
  // tapping an illegal move twice) toasts again rather than going silent.
  s.ingest({ t: "err", code: "BAD", debug: "nope", ref: "r1" });
  expect(s.getSnapshot().errorSeq).toBe(2);
});

test("a state frame clears the error without bumping errorSeq", () => {
  const s = makeSocket();
  s.ingest({ t: "err", code: "BAD", debug: "nope", ref: "r1" });
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  expect(s.getSnapshot().error).toBeNull();
  expect(s.getSnapshot().errorSeq).toBe(1); // unchanged -> no spurious toast
});

test("supporter_updated frame is delivered to the registered handler", () => {
  const s = makeSocket();
  const got: unknown[] = [];
  s.setSupporterHandler((v) => got.push(v));
  s.ingest({
    t: "supporter_updated",
    supporter: {
      active: true,
      boosting: false,
      kofi: false,
      staff: true,
      since: 0,
      tier: "supporter",
    },
  });
  expect(got).toEqual([
    { active: true, boosting: false, kofi: false, staff: true, since: 0, tier: "supporter" },
  ]);
});

test("following a game the server never answers marks the socket stalled", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open(); // socket opens, but the sub is never answered
  expect(s.getSnapshot().stalled).toBe(false);
  vi.advanceTimersByTime(12_000);
  expect(s.getSnapshot().stalled).toBe(true); // never stuck silently: surfaced
});

test("a state frame before the timeout keeps the socket un-stalled", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  vi.advanceTimersByTime(30_000);
  expect(s.getSnapshot().stalled).toBe(false);
});

test("a lobby summary prevents stall (a lobby never sends a state frame)", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "lobby", game: "g" });
  vi.advanceTimersByTime(30_000);
  expect(s.getSnapshot().stalled).toBe(false);
});

test("an err frame stops the stall watchdog (the error UI takes over)", () => {
  const s = makeSocket();
  s.follow("g");
  s.ingest({ t: "err", code: "INTERNAL", debug: "x", ref: "r" });
  vi.advanceTimersByTime(30_000);
  expect(s.getSnapshot().stalled).toBe(false);
});

test("a late server frame clears an existing stall", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  vi.advanceTimersByTime(12_000);
  expect(s.getSnapshot().stalled).toBe(true);
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  expect(s.getSnapshot().stalled).toBe(false);
});

test("unfollow cancels the stall watchdog", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.unfollow();
  vi.advanceTimersByTime(30_000);
  expect(s.getSnapshot().stalled).toBe(false);
});

test("a stalled subscription re-sends sub on its own", () => {
  const s = makeSocket();
  s.follow("g");
  const ws = FakeWS.last!;
  ws.open();
  vi.advanceTimersByTime(12_000);
  expect(s.getSnapshot().stalled).toBe(true);
  ws.sent.length = 0;
  // Nothing calls anything: the watchdog is the retry loop.
  vi.advanceTimersByTime(60_000);
  const subs = ws.sent.map((raw) => JSON.parse(raw) as { t: string }).filter((f) => f.t === "sub");
  expect(subs.length).toBeGreaterThan(0);
  // ...and it keeps saying "stalled" throughout rather than flickering back to
  // "connecting" each attempt.
  expect(s.getSnapshot().stalled).toBe(true);
});

test("an answer to one of those re-asks ends the loop", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  vi.advanceTimersByTime(12_000);
  expect(s.getSnapshot().stalled).toBe(true);
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  expect(s.getSnapshot().stalled).toBe(false);
  const ws = FakeWS.last!;
  ws.sent.length = 0;
  vi.advanceTimersByTime(120_000);
  expect(ws.sent.filter((raw) => raw.includes('"sub"'))).toHaveLength(0);
});

test("following a new game re-arms the watchdog from scratch", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  s.follow("h"); // switch to a game that never answers
  expect(s.getSnapshot().stalled).toBe(false);
  vi.advanceTimersByTime(12_000);
  expect(s.getSnapshot().stalled).toBe(true);
});

test("presence frame populates the spectator list", () => {
  const s = makeSocket();
  s.ingest({ t: "presence", game: "g", spectators: [{ user_id: 7, name: "Watcher" }] });
  expect(s.getSnapshot().spectators).toEqual([{ user_id: 7, name: "Watcher" }]);
});

test("the spectator list does not survive following another game", () => {
  // Presence is per game and the server only pushes it when a watcher arrives
  // or leaves, so after spectating the watcher list (including the viewer) must
  // not carry into the next lobby's "Watching:".
  const s = makeSocket();
  s.follow("g");
  s.ingest({ t: "presence", game: "g", spectators: [{ user_id: 7, name: "Watcher" }] });
  s.follow("h");
  expect(s.getSnapshot().spectators).toEqual([]);
  s.follow("g");
  s.unfollow();
  expect(s.getSnapshot().spectators).toEqual([]);
});

test("postgame carries the rematch next id and private invite", () => {
  const s = makeSocket();
  s.ingest({
    t: "postgame",
    game: "g",
    rematch: { want: 1, eligible: 2, next: "g2", next_invite: "abc123" },
  });
  expect(s.getSnapshot().next).toBe("g2");
  expect(s.getSnapshot().nextInvite).toBe("abc123");
});

// The same for a reset: the reset table is a new private game with a new
// code, so a spectator redirected without one is refused at its `sub` gate.
test("a reset redirect carries the new lobby's invite", () => {
  const s = makeSocket();
  s.ingest({ t: "lobby", game: "g", next: "g2", next_invite: "abc123" });
  expect(s.getSnapshot().next).toBe("g2");
  expect(s.getSnapshot().nextInvite).toBe("abc123");
});

test("sends a report frame with the chat id", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.report(123);
  expect(JSON.parse(FakeWS.last!.sent.at(-1)!)).toEqual({ t: "report", chat_id: 123 });
});

test("attaches the row id to incoming chat messages", () => {
  const s = makeSocket();
  s.ingest({ t: "chat", id: 7, scope: "lobby", from: "al", user_id: 1, msg: "hi" });
  expect(s.getSnapshot().chat.at(-1)).toMatchObject({ id: 7, msg: "hi" });
});

// --- notification batching -------------------------------------------------
//
// The server sends one `ev` frame per engine event, so one command arrives as a
// burst of messages. The store applies every patch immediately but wakes its
// listeners at most once a frame, so a burst costs one game-screen render.

// Watch a socket's notifications, capturing the snapshot each one carries.
function watch(s: ReturnType<typeof makeSocket>) {
  const seen: ReturnType<typeof s.getSnapshot>[] = [];
  const off = s.subscribe(() => seen.push(s.getSnapshot()));
  return { seen, off };
}

// Advance past a frame boundary, firing whichever of rAF/timeout is armed.
function frame() {
  vi.advanceTimersByTime(20);
}

test("a burst of event frames wakes the listeners exactly once", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const w = watch(s);

  // A dice roll fans out into a dozen `ev` frames, the measured burst size.
  for (let i = 1; i <= 12; i++) {
    s.ingest({ t: "ev", game: "g", seq: i, ev: { seq: i, type: "x", data: null } });
  }
  expect(w.seen.length).toBe(0); // nothing yet: the burst is still landing
  frame();
  expect(w.seen.length).toBe(1); // twelve frames, one render
});

test("state is applied synchronously even while the notification waits", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  watch(s);
  s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "hi" });
  // No frame boundary has passed, yet an imperative reader (consumeMatch,
  // applySummary, ingest's own read-modify-write) already sees the change.
  expect(s.getSnapshot().chat.length).toBe(1);
});

test("the notification carries the fully merged state", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const w = watch(s);

  s.ingest({
    t: "ev",
    game: "g",
    seq: 1,
    ev: { seq: 1, type: "dice_rolled", data: { d1: 3, d2: 4 } },
  });
  s.ingest({ t: "ev", game: "g", seq: 2, ev: { seq: 2, type: "gained", data: null } });
  s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "nice" });
  s.ingest({ t: "presence", game: "g", spectators: [{ user_id: 7, name: "Watcher" }] });
  frame();

  expect(w.seen.length).toBe(1);
  const snap = w.seen[0];
  // Every one of the four frames is visible in the one snapshot React reads.
  expect(snap.lastRoll).toEqual({ d1: 3, d2: 4, seq: 1 });
  expect(snap.events.map((e) => e.seq)).toEqual([1, 2]);
  expect(snap.lastSeq).toBe(2);
  expect(snap.chat.length).toBe(1);
  expect(snap.spectators.length).toBe(1);
  expect(snap).toBe(s.getSnapshot()); // and it is the live snapshot, not a stale copy
});

test("separate frames still notify separately", () => {
  const s = makeSocket();
  const w = watch(s);
  s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "one" });
  frame();
  s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "two" });
  frame();
  expect(w.seen.length).toBe(2); // coalescing is per-frame, not a global mute
});

test("a queued notification does not fire after disconnect", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  const w = watch(s);
  s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "hi" }); // queues a notify
  s.disconnect();
  const afterTeardown = w.seen.length;
  frame(); // the frame the queued notify was waiting for
  expect(w.seen.length).toBe(afterTeardown); // nothing fires into a torn-down app
  expect(w.seen.at(-1)!.wantOpen).toBe(false); // teardown itself was announced, synchronously
});

test("every err frame notifies on its own", () => {
  const s = makeSocket();
  const w = watch(s);
  // Two illegal moves in the same frame (a double-tap). errorSeq is a nonce the
  // screen watches to toast each one; coalescing would swallow the second.
  s.ingest({ t: "err", code: "BAD", debug: "nope", ref: "r1" });
  s.ingest({ t: "err", code: "BAD", debug: "nope", ref: "r1" });
  expect(w.seen.map((x) => x.errorSeq)).toEqual([1, 2]);
  frame();
  expect(w.seen.length).toBe(2); // and no stale extra wake-up trailing behind
});

test("an err frame flushes the pending burst", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const w = watch(s);
  s.ingest({ t: "ev", game: "g", seq: 1, ev: { seq: 1, type: "x", data: null } });
  s.ingest({ t: "err", code: "BAD", debug: "nope", ref: "r1" });
  expect(w.seen.length).toBe(1);
  expect(w.seen[0].events.length).toBe(1); // the queued event rode along
  expect(w.seen[0].errorSeq).toBe(1);
  frame();
  expect(w.seen.length).toBe(1);
});

test("batching falls back to a timer where requestAnimationFrame is absent", () => {
  const raf = globalThis.requestAnimationFrame;
  // @ts-expect-error simulating an environment without rAF
  delete globalThis.requestAnimationFrame;
  try {
    const s = makeSocket();
    const w = watch(s);
    s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "a" });
    s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "b" });
    expect(w.seen.length).toBe(0);
    frame();
    expect(w.seen.length).toBe(1);
    expect(w.seen[0].chat.length).toBe(2);
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
});

test("the schedule seam decides when listeners wake", () => {
  let queued: (() => void) | null = null;
  const s = new GameSocket({
    wsFactory: (url) => new FakeWS(url),
    now: () => now,
    schedule: (fn) => {
      queued = fn;
      return () => {
        queued = null;
      };
    },
  });
  const w = watch(s);
  s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "a" });
  s.ingest({ t: "chat", scope: "game:g", from: "a", user_id: 1, msg: "b" });
  expect(queued).not.toBeNull();
  expect(w.seen.length).toBe(0);
  queued!();
  expect(w.seen.length).toBe(1);
  expect(w.seen[0].chat.length).toBe(2);
});

// A roll is identified by the seq of the event that produced it, not by the
// dice values or the identity of the object holding them. The board animates
// a roll (chips turn over, the robber pulses), so answering it twice shows.

test("a redelivered roll is the same roll", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const rolled = { seq: 4, type: "dice_rolled", data: { d1: 3, d2: 4 } };
  s.ingest({ t: "ev", game: "g", seq: 4, ev: rolled });
  frame();

  // A re-subscribe or a gap refetch redelivers events this client already
  // holds; `events` dedupes on seq, and the roll must too.
  s.ingest({ t: "ev", game: "g", seq: 4, ev: { ...rolled, data: { ...rolled.data } } });
  frame();

  expect(s.getSnapshot().lastRoll).toEqual({ d1: 3, d2: 4, seq: 4 });
});

test("a later roll of the same numbers is a different roll", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  s.ingest({
    t: "ev",
    game: "g",
    seq: 4,
    ev: { seq: 4, type: "dice_rolled", data: { d1: 3, d2: 4 } },
  });
  frame();
  s.ingest({
    t: "ev",
    game: "g",
    seq: 9,
    ev: { seq: 9, type: "dice_rolled", data: { d1: 3, d2: 4 } },
  });
  frame();

  // Two sevens in a row are two sevens: only the seq can tell them apart.
  expect(s.getSnapshot().lastRoll).toEqual({ d1: 3, d2: 4, seq: 9 });
});

test("an out-of-order older roll does not displace the newest one", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  s.ingest({
    t: "ev",
    game: "g",
    seq: 9,
    ev: { seq: 9, type: "dice_rolled", data: { d1: 6, d2: 6 } },
  });
  frame();
  // A refetch filling a gap can deliver an older roll after a newer one. The
  // dock must keep showing the roll that actually stands.
  s.ingest({
    t: "ev",
    game: "g",
    seq: 4,
    ev: { seq: 4, type: "dice_rolled", data: { d1: 1, d2: 1 } },
  });
  frame();

  expect(s.getSnapshot().lastRoll).toEqual({ d1: 6, d2: 6, seq: 9 });
});

// ---------------------------------------------------------------------------
// The positional fold
// ---------------------------------------------------------------------------

const SETTLEMENT = { player: 2, v: { q: 1, r: 1, side: 0 } };

test("an event's board change lands in the view before a snapshot", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  s.ingest({
    t: "ev",
    game: "g",
    seq: 1,
    ev: { seq: 1, type: "settlement_built", data: SETTLEMENT },
  });
  // No sub, no state frame: the fold skips the round trip and the 80ms
  // debounce.
  expect(s.getSnapshot().full?.buildings).toEqual([{ v: SETTLEMENT.v, owner: 2, city: false }]);
});

test("the fold leaves full.seq unchanged", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  s.ingest({
    t: "ev",
    game: "g",
    seq: 1,
    ev: { seq: 1, type: "settlement_built", data: SETTLEMENT },
  });
  // Bumping the seq would expire the seq-gated spend overlay while the fold,
  // being purely geometric, has not touched the hand.
  expect(s.getSnapshot().full?.seq).toBe(1);
});

test("a redelivered event does not place the piece twice", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const ev = {
    t: "ev",
    game: "g",
    seq: 1,
    ev: { seq: 1, type: "settlement_built", data: SETTLEMENT },
  } as const;
  s.ingest(ev);
  s.ingest(ev);
  expect(s.getSnapshot().full?.buildings).toHaveLength(1);
});

test("an authoritative frame at the same seq supersedes the folded view", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  s.ingest({
    t: "ev",
    game: "g",
    seq: 1,
    ev: { seq: 1, type: "settlement_built", data: SETTLEMENT },
  });
  // The snapshot is the truth; a fold must never block it, including at the
  // equal seq the fold leaves in place.
  s.ingest({ t: "state", game: "g", seq: 2, full: { ...view(2), buildings: [] } });
  expect(s.getSnapshot().full?.buildings).toEqual([]);
});

test("an event that is not about the board leaves the view object untouched", () => {
  const s = makeSocket();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const before = s.getSnapshot().full;
  s.ingest({ t: "ev", game: "g", seq: 1, ev: { seq: 1, type: "cards_discarded", data: {} } });
  expect(s.getSnapshot().full).toBe(before);
});

test("folding is harmless before any view has arrived", () => {
  const s = makeSocket();
  s.ingest({
    t: "ev",
    game: "g",
    seq: 1,
    ev: { seq: 1, type: "settlement_built", data: SETTLEMENT },
  });
  expect(s.getSnapshot().full).toBeNull();
});

// ---------------------------------------------------------------------------
// Send results
// ---------------------------------------------------------------------------

test("cmd reports whether the frame actually left", () => {
  const s = makeSocket();
  s.follow("g");
  // Socket still CONNECTING: there is no outbound queue, so this is dropped.
  expect(s.cmd("build_road", { e: 1 })).toBe(false);
  FakeWS.last!.open();
  expect(s.cmd("build_road", { e: 1 })).toBe(true);
});

test("cmd reports false when no game is followed", () => {
  const s = makeSocket();
  s.ensureOpen();
  FakeWS.last!.open();
  expect(s.cmd("build_road")).toBe(false);
});

test("a dropped command puts nothing on the wire", () => {
  const s = makeSocket();
  s.follow("g");
  s.cmd("build_road", { e: 1 }); // socket not open yet
  FakeWS.last!.open();
  // The frames sent on open are the sub (and any auth), never the command: a
  // move replayed after a reconnect would act on a board that has moved on.
  expect(FakeWS.last!.sent.filter((r) => JSON.parse(r).t === "cmd")).toEqual([]);
});

test("chat returns false when down and keeps the rate token", () => {
  const s = makeSocket();
  s.follow("g");
  now = 1000;
  expect(s.chat("game:g", "a")).toBe(false); // not open
  FakeWS.last!.open();
  // Same instant: a failed send must not spend the one-per-second token.
  expect(s.chat("game:g", "b")).toBe(true);
});

// ---------------------------------------------------------------------------
// Refresh debounce
// ---------------------------------------------------------------------------
//
// The snapshot is the only thing that moves the phase flags (events are folded
// for geometry only), so a screen without one keeps believing it owes a move
// already taken. A stream of events faster than the debounce (e.g. a timed-out
// setup followed by bots) must still get a refresh.

test("a continuous event stream still gets snapshots", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const subsSoFar = () =>
    FakeWS.last!.sent.map((raw) => JSON.parse(raw) as { t: string }).filter((f) => f.t === "sub")
      .length;
  const before = subsSoFar();

  // Events every 50ms, forever: each one lands inside the 80ms window.
  for (let i = 0; i < 20; i++) {
    s.ingest({
      t: "ev",
      game: "g",
      seq: 2 + i,
      ev: { seq: 2 + i, type: "turn_started", data: {} },
    });
    vi.advanceTimersByTime(50);
  }
  // Refreshed, but not once per event: unbounded re-arming would leave this
  // at zero, and refreshing per event would request a dozen full snapshots for
  // one burst.
  const asked = subsSoFar() - before;
  expect(asked).toBeGreaterThan(0);
  expect(asked).toBeLessThan(8);
});

test("a short burst is still exactly one refresh", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const subs = () =>
    FakeWS.last!.sent.map((raw) => JSON.parse(raw) as { t: string }).filter((f) => f.t === "sub")
      .length;
  const before = subs();
  // Four events inside one window, which is what an ordinary move looks like.
  for (let i = 0; i < 4; i++) {
    s.ingest({ t: "ev", game: "g", seq: 2 + i, ev: { seq: 2 + i, type: "x", data: null } });
    vi.advanceTimersByTime(10);
  }
  vi.advanceTimersByTime(200);
  expect(subs()).toBe(before + 1);
});

test("the refresh re-arms after it has fired", () => {
  const s = makeSocket();
  s.follow("g");
  FakeWS.last!.open();
  s.ingest({ t: "state", game: "g", seq: 1, full: view(1) });
  const subs = () =>
    FakeWS.last!.sent.map((raw) => JSON.parse(raw) as { t: string }).filter((f) => f.t === "sub")
      .length;
  const before = subs();

  s.ingest({ t: "ev", game: "g", seq: 2, ev: { seq: 2, type: "turn_started", data: {} } });
  vi.advanceTimersByTime(100);
  expect(subs()).toBe(before + 1);
  // A later burst gets a fresh window: the handle must be released when the
  // timer fires, or every refresh after the first is lost.
  s.ingest({ t: "ev", game: "g", seq: 3, ev: { seq: 3, type: "turn_started", data: {} } });
  vi.advanceTimersByTime(100);
  expect(subs()).toBe(before + 2);
});

// A page loaded mid-game gets its history from the seed, not from live frames.
// The newest roll in the backfill stands in for the dice, marked so the board
// shows it without replaying it.
test("a seeded history supplies the last roll, marked as seeded", () => {
  const s = makeSocket();
  s.seed({
    log: [
      { seq: 3, type: "dice_rolled", data: { d1: 2, d2: 5 } },
      { seq: 4, type: "cak_event_die", data: { face: "ship" } },
      { seq: 9, type: "dice_rolled", data: { d1: 4, d2: 4 } },
      { seq: 10, type: "x", data: null },
    ],
  });
  expect(s.getSnapshot().lastRoll).toEqual({ d1: 4, d2: 4, seq: 9, seeded: true });
  expect(s.getSnapshot().lastEventDie).toBe("ship");
});

test("a seeded roll never replaces a newer one that arrived live", () => {
  const s = makeSocket();
  s.ingest({
    t: "ev",
    game: "g",
    seq: 12,
    ev: { seq: 12, type: "dice_rolled", data: { d1: 1, d2: 1 } },
  } as never);
  s.seed({ log: [{ seq: 9, type: "dice_rolled", data: { d1: 4, d2: 4 } }] });
  expect(s.getSnapshot().lastRoll).toEqual({ d1: 1, d2: 1, seq: 12 });
});
