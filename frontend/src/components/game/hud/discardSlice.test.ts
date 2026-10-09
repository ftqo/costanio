import { describe, it, expect } from "vitest";
import { selectDiscard } from "./TableStatus";
import type { State } from "@/lib/ws";

// A view carrying only what selectDiscard reads.
const view = (over: Record<string, unknown>) =>
  ({
    full: {
      viewer: 0,
      config: { discard_limit: 7 },
      players: [{ seat: 0, hand_count: 15, ...over }],
      ext: {
        cak: { players: [{ commodity_count: 0, walls: 1 }], knights: [] },
      },
    },
  }) as unknown as State;

describe("selectDiscard", () => {
  it("takes the limit from the server, not from config plus walls", () => {
    const d = selectDiscard(view({ discard_at: 9 }));
    expect(d.show).toBe(true);
    expect(d.limit).toBe(9);
    // The parts must account for the whole, or the breakdown draws an
    // "Unaccounted" line.
    expect(d.limit - d.base - 2 * d.walls).toBe(0);
  });

  // A server older than the field sends no discard_at. Falling back to
  // config.discard_limit would ignore walls (a confident 7 for a real limit of
  // 9), so the readout is hidden.
  it("hides itself when the server sent no discard_at", () => {
    expect(selectDiscard(view({})).show).toBe(false);
    expect(selectDiscard(view({ discard_at: undefined })).show).toBe(false);
  });
});
