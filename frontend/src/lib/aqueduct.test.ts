import { describe, expect, it } from "vitest";
import { AQUEDUCT_RESOURCES, aqueductBankEmpty, aqueductCanTake } from "./aqueduct";
import type { Hand } from "./types";

// [gold/unused, wood, brick, sheep, wheat, ore]: index 0 is not a resource.
const bank = (...counts: number[]): Hand => [0, ...counts] as unknown as Hand;

describe("aqueductCanTake", () => {
  it("offers a resource the bank still stocks", () => {
    const b = bank(3, 0, 7, 0, 1);
    expect(AQUEDUCT_RESOURCES.filter((i) => aqueductCanTake(b, i))).toEqual([1, 3, 5]);
  });

  it("refuses a depleted resource, matching the engine", () => {
    // engine/knights decideAqueductPick rejects `s.Bank[res] < 1`.
    expect(aqueductCanTake(bank(0, 0, 0, 0, 0), 2)).toBe(false);
    expect(aqueductCanTake(bank(1, 0, 0, 0, 0), 1)).toBe(true);
  });

  it("fails closed with no bank at all", () => {
    // A spectator's redacted view has none; the pick would be refused anyway.
    expect(aqueductCanTake(undefined, 3)).toBe(false);
  });
});

describe("aqueductBankEmpty", () => {
  it("is true only when nothing at all can be taken", () => {
    expect(aqueductBankEmpty(bank(0, 0, 0, 0, 0))).toBe(true);
    expect(aqueductBankEmpty(undefined)).toBe(true);
  });

  it("is false while any single resource remains", () => {
    // The take-nothing pick is legal only on a fully empty bank (the engine
    // rejects ResNone otherwise).
    for (const i of AQUEDUCT_RESOURCES) {
      const b = bank(0, 0, 0, 0, 0);
      b[i] = 1;
      expect(aqueductBankEmpty(b), `res ${i}`).toBe(false);
    }
  });

  it("ignores index 0, which is not a resource", () => {
    // Slot 0 is unused; counting it would hide the take-nothing button.
    expect(aqueductBankEmpty([9, 0, 0, 0, 0, 0])).toBe(true);
  });
});
