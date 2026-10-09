import { describe, expect, it } from "vitest";
import { CARRY_PACE, GHOST_SLIDE } from "./carry";
import { ROBBER_TRAVEL, tripMs } from "./markerMotion";
import type { Vec3 } from "./coords";

const HOME: Vec3 = [0, 0, 0];
const NEXT_DOOR: Vec3 = [5.45, 0, 0];
const ACROSS: Vec3 = [26, 0, 8];

describe("CARRY_PACE", () => {
  it("is much faster than a committed move", () => {
    // A committed move is something the table should follow; a carry answers
    // the pointer and must keep up with it.
    expect(tripMs(CARRY_PACE, HOME, ACROSS)).toBeLessThan(tripMs(ROBBER_TRAVEL, HOME, ACROSS) / 2);
    expect(tripMs(CARRY_PACE, HOME, NEXT_DOOR)).toBeLessThan(
      tripMs(ROBBER_TRAVEL, HOME, NEXT_DOOR) / 2,
    );
  });

  it("keeps its worst case under the reaction budget", () => {
    // The ceiling is a pointer thrown across the board. Past about a quarter
    // second the piece visibly lags.
    expect(tripMs(CARRY_PACE, HOME, ACROSS)).toBeLessThanOrEqual(
      CARRY_PACE.maxMs + CARRY_PACE.settleMs,
    );
    expect(CARRY_PACE.maxMs).toBeLessThanOrEqual(280);
  });

  it("still arcs", () => {
    expect(CARRY_PACE.arcMin).toBeGreaterThan(0);
    // A hop rather than a throw: flatter than the committed move's.
    expect(CARRY_PACE.arcMax).toBeLessThan(ROBBER_TRAVEL.arcMax);
  });
});

describe("GHOST_SLIDE", () => {
  it("is lower and faster than a carry", () => {
    // A translucent preview has no mass; an arc on it reads as it jumping.
    expect(tripMs(GHOST_SLIDE, HOME, ACROSS)).toBeLessThan(tripMs(CARRY_PACE, HOME, ACROSS));
    expect(GHOST_SLIDE.arcMax).toBeLessThan(CARRY_PACE.arcMax);
  });

  it("does not squash on arrival", () => {
    // Squash is contact with the board, and a ghost is not touching it.
    expect(GHOST_SLIDE.settleSquash).toBe(0);
    // But the settle is never zero: `tripPose` divides by it.
    expect(GHOST_SLIDE.settleMs).toBeGreaterThan(0);
  });
});
