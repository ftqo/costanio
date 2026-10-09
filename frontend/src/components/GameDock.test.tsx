import { describe, it, expect } from "vitest";
import { dockStatus } from "./GameDock";

// The dock's caption says whether the table is waiting on you.
const base = { viewer: 1, cur: 1, phase: "play" as const, seat_names: { 0: "Ana", 1: "Bo" } };

describe("dockStatus", () => {
  it("says it is your turn when the seat to move is yours", () => {
    expect(dockStatus(base)).toEqual({ kind: "yours" });
  });

  it("names the seat to move otherwise", () => {
    expect(dockStatus({ ...base, cur: 0 })).toEqual({ kind: "theirs", name: "Ana" });
  });

  it("puts an owed discard first", () => {
    expect(dockStatus({ ...base, cur: 0, pending_discards: { 1: 4 } })).toEqual({
      kind: "discard",
    });
  });

  it("falls back to the plain caption when it cannot tell", () => {
    expect(dockStatus(undefined)).toBeNull();
    expect(dockStatus({ ...base, phase: "finished" })).toBeNull();
    expect(dockStatus({ ...base, viewer: -1 })).toBeNull();
    expect(dockStatus({ ...base, cur: 0, seat_names: {} })).toBeNull();
  });
});
