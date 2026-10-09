import { describe, expect, it } from "vitest";
import { shouldEnterGame } from "./enterGame";

describe("shouldEnterGame", () => {
  it("stays in the waiting room while the game is still a lobby", () => {
    expect(shouldEnterGame(false, "lobby", false)).toBe(false);
  });

  it("enters on the one-shot started broadcast", () => {
    expect(shouldEnterGame(true, "lobby", false)).toBe(true);
  });

  it("enters when an authoritative summary already reports the game active", () => {
    expect(shouldEnterGame(false, "active", false)).toBe(true);
  });

  // A client that missed the one-shot `started` broadcast still gets a `state`
  // frame on (re)subscribe, which the server only sends for an active game.
  it("enters on a full state frame despite a stale lobby summary", () => {
    expect(shouldEnterGame(false, "lobby", true)).toBe(true);
  });

  it("stays put when there is no signal at all", () => {
    expect(shouldEnterGame(false, undefined, false)).toBe(false);
  });
});
