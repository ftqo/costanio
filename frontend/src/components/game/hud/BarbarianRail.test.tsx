import { describe, it, expect } from "vitest";
import { selectRail, railVerdict } from "./BarbarianRail";
import type { State } from "@/lib/ws";
import type { FullView } from "@/lib/types";

/**
 * The barbarian rail: the fleet's one readout.
 *
 * The verdict has three colour states, amber being a lost raid that costs
 * nothing because the table's free first landfall is unspent. Each is paired
 * with a shape too (a tick when the cities hold, a warning when not).
 *
 * The selector must not gate on `ext.cak`, which doesn't exist until the
 * Knights module folds its first event (see knightsHudShape.test.ts).
 *
 * The tack's geometry is tested in lib/barbRail.test.ts. Legibility in both
 * themes isn't asserted: jsdom can't resolve the theme's custom properties.
 */

const view = (over: Partial<FullView> = {}): FullView =>
  ({
    config: { ruleset: "base+cak", modules: {} },
    viewer: 0,
    players: [{ seat: 0 }],
    buildings: [],
    bank: [19, 19, 19, 19, 19],
    ...over,
  }) as unknown as FullView;

const state = (v: FullView): State => ({ full: v }) as State;

describe("the selector", () => {
  it("gives a Knights table its whole track before anyone has rolled", () => {
    // `ext.cak` is absent through a Knights game's opening; gating on it would
    // make the rail appear mid-turn.
    const r = selectRail(state(view()));
    expect(r.dist).toBe(7);
    expect(r.at).toBe(0);
  });

  it("reads the table's configured distance, not the default", () => {
    const v = view({
      config: { ruleset: "base+cak", modules: { cak: { barbarian_distance: 12 } } },
    } as unknown as Partial<FullView>);
    expect(selectRail(state(v)).dist).toBe(12);
  });

  it("falls back to the default track when the setting is out of range", () => {
    const v = view({
      config: { ruleset: "base+cak", modules: { cak: { barbarian_distance: 99 } } },
    } as unknown as Partial<FullView>);
    expect(selectRail(state(v)).dist).toBe(7);
  });

  it("draws nothing at all in a base game", () => {
    // 0 is the sentinel: barbDist clamps to [4,12], so it can't be a real track.
    const v = view({ config: { ruleset: "base", modules: {} } } as unknown as Partial<FullView>);
    expect(selectRail(state(v)).dist).toBe(0);
  });

  it("counts defence from ACTIVE knights only, every seat together", () => {
    const v = view({
      ext: {
        cak: {
          barbarians: 2,
          knights: [
            { owner: 0, level: 3, active: true },
            { owner: 1, level: 2, active: true },
            { owner: 1, level: 3, active: false },
          ],
          players: [],
        },
      },
    });
    const r = selectRail(state(v));
    // The idle mighty knight contributes nothing: 3 + 2, not 3 + 2 + 3.
    expect(r.defense).toBe(5);
    expect(r.at).toBe(2);
  });

  it("counts one barbarian per city on the board, settlements excluded", () => {
    const v = view({
      buildings: [{ city: true }, { city: true }, { city: false }, {}],
    } as unknown as Partial<FullView>);
    expect(selectRail(state(v)).cities).toBe(2);
  });
});

describe("the raid verdict", () => {
  it("is exposed when the knights are short and the raid is real", () => {
    expect(railVerdict(4, 6, false)).toBe("exposed");
  });

  it("shows amber while the raid is free", () => {
    // With the free landfall unspent this raid costs nothing, so it must not be
    // red.
    expect(railVerdict(4, 6, true)).toBe("free");
  });

  it("is green on a holding defence either way", () => {
    expect(railVerdict(6, 6, false)).toBe("hold");
    expect(railVerdict(6, 6, true)).toBe("hold");
  });

  it("counts an exact match as holding, not as a loss", () => {
    // The knights must match the barbarians to repel them, not beat them.
    expect(railVerdict(6, 6, false)).toBe("hold");
    expect(railVerdict(5, 6, false)).toBe("exposed");
  });
});
