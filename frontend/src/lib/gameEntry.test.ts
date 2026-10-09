import { expect, test, describe } from "vitest";
import { canEnterGame, nextEntryCheckMs, ENTRY_MIN_DWELL_MS, ENTRY_MAX_WAIT_MS } from "./gameEntry";

describe("canEnterGame", () => {
  test("no view means no entry, however long we wait", () => {
    // Nothing to draw without a state frame. The "Connecting to game…" state has
    // its own escapes; the ceiling must not skip past a game that never loaded.
    expect(
      canEnterGame({ viewReady: false, assetsReady: true, boardReady: true, elapsedMs: 0 }),
    ).toBe(false);
    expect(
      canEnterGame({
        viewReady: false,
        assetsReady: true,
        boardReady: true,
        elapsedMs: ENTRY_MAX_WAIT_MS * 10,
      }),
    ).toBe(false);
  });

  test("assets ready but too soon: the floor stops a two-frame flash", () => {
    // The warm path resolves in tens of milliseconds; a flashed loading card
    // reads as a glitch.
    expect(
      canEnterGame({ viewReady: true, assetsReady: true, boardReady: true, elapsedMs: 0 }),
    ).toBe(false);
    expect(
      canEnterGame({
        viewReady: true,
        assetsReady: true,
        boardReady: true,
        elapsedMs: ENTRY_MIN_DWELL_MS - 1,
      }),
    ).toBe(false);
  });

  test("assets ready and the floor met: enter", () => {
    expect(
      canEnterGame({
        viewReady: true,
        assetsReady: true,
        boardReady: true,
        elapsedMs: ENTRY_MIN_DWELL_MS,
      }),
    ).toBe(true);
  });

  test("assets still pending: hold, but only up to the ceiling", () => {
    expect(
      canEnterGame({
        viewReady: true,
        assetsReady: false,
        boardReady: true,
        elapsedMs: ENTRY_MAX_WAIT_MS - 1,
      }),
    ).toBe(false);
    // Everything behind the gate degrades on its own, so a stuck model fetch
    // costs a rough first second, not entry.
    expect(
      canEnterGame({
        viewReady: true,
        assetsReady: false,
        boardReady: true,
        elapsedMs: ENTRY_MAX_WAIT_MS,
      }),
    ).toBe(true);
  });

  test("a built board that has never drawn is not ready", () => {
    // `assetsReady` only means the .glb bytes are parsed: no renderer, scene or
    // frame yet.
    expect(
      canEnterGame({
        viewReady: true,
        assetsReady: true,
        boardReady: false,
        elapsedMs: ENTRY_MIN_DWELL_MS,
      }),
    ).toBe(false);
  });

  test("a board that never draws is still let through at the ceiling", () => {
    // An optimisation, not a gate: a stuck GPU costs a rough first second.
    expect(
      canEnterGame({
        viewReady: true,
        assetsReady: true,
        boardReady: false,
        elapsedMs: ENTRY_MAX_WAIT_MS,
      }),
    ).toBe(true);
  });

  test("the ceiling is longer than the floor, or the floor would never apply", () => {
    expect(ENTRY_MAX_WAIT_MS).toBeGreaterThan(ENTRY_MIN_DWELL_MS);
  });
});

describe("nextEntryCheckMs", () => {
  test("nothing to schedule once the gate is open", () => {
    expect(
      nextEntryCheckMs({
        viewReady: true,
        assetsReady: true,
        boardReady: true,
        elapsedMs: ENTRY_MIN_DWELL_MS,
      }),
    ).toBeNull();
  });

  test("nothing to schedule while waiting on the network", () => {
    // The socket wakes the component; a timer would just spin.
    expect(
      nextEntryCheckMs({ viewReady: false, assetsReady: false, boardReady: true, elapsedMs: 0 }),
    ).toBeNull();
  });

  test("waiting on the floor: aim at the floor", () => {
    expect(
      nextEntryCheckMs({ viewReady: true, assetsReady: true, boardReady: true, elapsedMs: 100 }),
    ).toBe(ENTRY_MIN_DWELL_MS - 100);
  });

  test("waiting on the board: aim at the ceiling, not the floor", () => {
    // The board resolves on its own, so only the ceiling needs a timer.
    expect(
      nextEntryCheckMs({ viewReady: true, assetsReady: true, boardReady: false, elapsedMs: 100 }),
    ).toBe(ENTRY_MAX_WAIT_MS - 100);
  });

  test("waiting on assets: aim at the ceiling", () => {
    expect(
      nextEntryCheckMs({ viewReady: true, assetsReady: false, boardReady: true, elapsedMs: 100 }),
    ).toBe(ENTRY_MAX_WAIT_MS - 100);
  });

  test("never schedules a negative delay", () => {
    // A tab backgrounded across a deadline comes back with elapsed past it.
    expect(
      nextEntryCheckMs({
        viewReady: true,
        assetsReady: false,
        boardReady: true,
        elapsedMs: ENTRY_MAX_WAIT_MS + 5000,
      }),
    ).toBeNull();
    expect(
      nextEntryCheckMs({
        viewReady: true,
        assetsReady: true,
        boardReady: true,
        elapsedMs: ENTRY_MIN_DWELL_MS + 1,
      }),
    ).toBeNull();
  });
});

describe("the shape of a whole entry", () => {
  test("a warm entry waits only the floor, not the ceiling", () => {
    // Everything cached: the player should be in almost at once, not after a
    // fixed wait.
    const warm = (elapsedMs: number) =>
      canEnterGame({ viewReady: true, assetsReady: true, boardReady: true, elapsedMs });
    expect(warm(ENTRY_MIN_DWELL_MS)).toBe(true);
    expect(warm(1000)).toBe(true);
  });

  test("a cold entry is not held past the ceiling even if nothing resolves", () => {
    const cold = (elapsedMs: number) =>
      canEnterGame({ viewReady: true, assetsReady: false, boardReady: true, elapsedMs });
    expect(cold(2000)).toBe(false);
    expect(cold(ENTRY_MAX_WAIT_MS + 1)).toBe(true);
  });
});
