import { describe, expect, it } from "vitest";
import { clamp, DEFAULT_HOLD_MS, holdMs, initial, reduce, type Bounds } from "./driver";

const B: Bounds = { first: 2, last: 10 };
const LOOPING: Bounds = { ...B, loop: true };

describe("replay driver", () => {
  it("starts at the first playable frame, not at zero", () => {
    expect(initial(B).index).toBe(2);
  });

  it("clamps seeks to the window", () => {
    expect(clamp(B, -5)).toBe(2);
    expect(clamp(B, 99)).toBe(10);
  });

  it("stops at the last frame when not looping", () => {
    const s = reduce({ index: 10, playing: true, speed: 1 }, { t: "tick" }, B);
    expect(s).toEqual({ index: 10, playing: false, speed: 1 });
  });

  it("wraps to the start when looping, and keeps playing", () => {
    const s = reduce({ index: 10, playing: true, speed: 1 }, { t: "tick" }, LOOPING);
    expect(s).toEqual({ index: 2, playing: true, speed: 1 });
  });

  it("ignores ticks while paused", () => {
    const s = { index: 5, playing: false, speed: 1 };
    expect(reduce(s, { t: "tick" }, B)).toBe(s);
  });

  it("restarts from the beginning when play is pressed at the end", () => {
    const s = reduce({ index: 10, playing: false, speed: 1 }, { t: "play" }, B);
    expect(s).toEqual({ index: 2, playing: true, speed: 1 });
  });

  it("does not restart at the end when looping (the tick handles the wrap)", () => {
    const s = reduce({ index: 10, playing: false, speed: 1 }, { t: "play" }, LOOPING);
    expect(s.index).toBe(10);
    expect(s.playing).toBe(true);
  });

  it("stepping pauses, so the chosen frame does not slide away", () => {
    const s = reduce({ index: 5, playing: true, speed: 1 }, { t: "step", by: 1 }, B);
    expect(s).toEqual({ index: 6, playing: false, speed: 1 });
  });

  it("holds a build longer than a turn boundary", () => {
    expect(holdMs("settlement_built", 1)).toBeGreaterThan(holdMs("turn_started", 1));
  });

  it("falls back to the default hold for an unknown event", () => {
    expect(holdMs("something_new", 1)).toBe(DEFAULT_HOLD_MS);
  });

  it("speed divides the hold and never reaches zero", () => {
    expect(holdMs("dice_rolled", 2)).toBe(holdMs("dice_rolled", 1) / 2);
    expect(holdMs("turn_ended", 10_000)).toBeGreaterThanOrEqual(16);
  });
});
