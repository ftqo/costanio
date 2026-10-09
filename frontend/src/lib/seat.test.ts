import { describe, it, expect } from "vitest";
import { actingSeat, seatBotControlled, seatDisplayName } from "./seat";
import type { Seat } from "./types";

const seat = (status: Seat["status"]): Seat => ({
  game_id: "g",
  no: 0,
  user_id: 1,
  status,
  user_name: "Alice",
  is_guest: false,
  color: "",
});

describe("seatDisplayName", () => {
  it("prefixes Bot for an auto (voluntarily-left) seat", () => {
    expect(seatDisplayName("Alice", "auto")).toBe("Bot Alice");
  });
  it("leaves active seats unchanged", () => {
    expect(seatDisplayName("Alice", "active")).toBe("Alice");
  });
  it("leaves original bot seats unchanged (already named Bot …)", () => {
    expect(seatDisplayName("Bot Beaker", "bot")).toBe("Bot Beaker");
  });
});

describe("seatBotControlled", () => {
  it("is true only for auto seats", () => {
    expect(seatBotControlled(seat("auto"))).toBe(true);
    expect(seatBotControlled(seat("active"))).toBe(false);
    expect(seatBotControlled(seat("bot"))).toBe(false);
    expect(seatBotControlled(undefined)).toBe(false);
  });
});

describe("actingSeat", () => {
  it("passes a seat we are playing through unchanged", () => {
    expect(actingSeat(2, false)).toBe(2);
    expect(actingSeat(0, false)).toBe(0);
  });
  it("collapses a bot-played seat to the spectator sentinel", () => {
    // "Leave & Spectate" keeps the seat, so viewer stays 2; without this every
    // `x?.[viewer]` prompt lookup (discard toast, progress-card overlays,
    // trade Accept/Reject) fired for the bot's moves.
    expect(actingSeat(2, true)).toBe(-1);
  });
  it("leaves a real spectator a spectator", () => {
    expect(actingSeat(-1, false)).toBe(-1);
    expect(actingSeat(-1, true)).toBe(-1);
  });
  it("never indexes into per-seat arrays for a non-acting viewer", () => {
    // -1 rather than undefined: call sites read `arr?.[seat]`, and -1 misses
    // on both arrays and includes().
    const pendingDiscards = [0, 0, 8];
    expect(pendingDiscards[actingSeat(2, true)] ?? 0).toBe(0);
    expect([2].includes(actingSeat(2, true))).toBe(false);
  });
});
