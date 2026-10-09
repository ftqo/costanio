import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Board } from "@/lib/types";

// Hoisted spy so the api mock can vary per test.
const h = vi.hoisted(() => ({ frameMap: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { frameMap: h.frameMap } }));

import { loadFramedGallery, frameForExport, __resetFramedGalleryCache } from "./framed-gallery";
import { GALLERY } from "./gallery";

const framed = (b: Board): Board => ({
  ...b,
  tiles: [...b.tiles, { hex: { q: 99, r: 99 }, res: "sea", num: 0 }],
});

describe("framed-gallery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetFramedGalleryCache();
  });
  afterEach(() => {
    __resetFramedGalleryCache();
  });

  it("frames every gallery map once and memoizes the result", async () => {
    // Each frameMap call returns a board with an extra sea tile (a stand-in for
    // the computed ocean), so we can tell framed boards from the land-only inputs.
    h.frameMap.mockImplementation((b: Board) => Promise.resolve(framed(b)));
    const first = await loadFramedGallery();
    expect(first.length).toBe(GALLERY.length);
    // Each framed board has the sentinel sea tile our mock appended.
    for (const m of first) expect(m.board.tiles.some((t) => t.hex.q === 99)).toBe(true);
    expect(h.frameMap).toHaveBeenCalledTimes(GALLERY.length);

    // Cached: a second call does not re-frame.
    const second = await loadFramedGallery();
    expect(second).toBe(first);
    expect(h.frameMap).toHaveBeenCalledTimes(GALLERY.length);
  });

  it("falls back to the unframed board when framing a map throws", async () => {
    h.frameMap.mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const maps = await loadFramedGallery();
    expect(maps.length).toBe(GALLERY.length);
    // Each returned map is the original land-only gallery entry (no sea sentinel).
    for (const m of maps) expect(m.board.tiles.some((t) => t.hex.q === 99)).toBe(false);
    warn.mockRestore();
  });

  it("frameForExport returns the framed board, or the raw board on error", async () => {
    const raw: Board = {
      radius: 2,
      tiles: [{ hex: { q: 0, r: 0 }, res: "land", num: 0 }],
      robber: { q: 0, r: 0 },
      harbors: [],
    };
    h.frameMap.mockResolvedValueOnce(framed(raw));
    expect((await frameForExport(raw)).tiles.some((t) => t.hex.q === 99)).toBe(true);

    h.frameMap.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await frameForExport(raw)).toBe(raw); // raw fallback
    warn.mockRestore();
  });
});
