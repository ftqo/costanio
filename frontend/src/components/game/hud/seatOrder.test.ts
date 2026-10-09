import { describe, expect, it } from "vitest";
import { opponentsAfter } from "./SeatRail";

describe("the opponents' stack", () => {
  it("starts after the viewer and wraps", () => {
    expect(opponentsAfter([0, 1, 2, 3], 0)).toEqual([1, 2, 3]);
    expect(opponentsAfter([0, 1, 2, 3], 2)).toEqual([3, 0, 1]);
    expect(opponentsAfter([0, 1, 2, 3], 3)).toEqual([0, 1, 2]);
  });
});
