import { describe, it, expect } from "vitest";
import { clampPan, panStarts } from "./usePanZoom";

// A representative board extent (matches the shape of a board's viewBox `vb`):
// off-origin and asymmetric, so a bug that assumes a centered/origin box shows up.
const B = { x: -100, y: -50, w: 200, h: 100 };

describe("clampPan", () => {
  it("locks to center at min zoom (k=1) regardless of input offset", () => {
    expect(clampPan(B, 1, 999, -999)).toEqual({ x: 0, y: 0 });
    expect(clampPan(B, 1, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("allows a symmetric pan box that widens with zoom", () => {
    // k=2: xMax = (1-2)*B.x = 100, xMin = (1-2)*(B.x+B.w) = -100; y in [-50, 50].
    expect(clampPan(B, 2, 30, -10)).toEqual({ x: 30, y: -10 }); // inside → unchanged
    expect(clampPan(B, 2, 500, 500)).toEqual({ x: 100, y: 50 }); // clamped to far edge
    expect(clampPan(B, 2, -500, -500)).toEqual({ x: -100, y: -50 }); // clamped to near edge
  });

  it("centers the board when zoomed out past the resting frame (k<1)", () => {
    // Below k=1 the clamp interval inverts; the camera sits at the midpoint
    // (1-k)*(B.x + B.w/2), which is 0 for this centered box.
    expect(clampPan(B, 0.5, 999, -999)).toEqual({ x: 0, y: 0 });
    // An off-center box centers on its own midpoint, not the origin.
    const off = { x: 0, y: 0, w: 200, h: 100 };
    expect(clampPan(off, 0.5, 999, -999)).toEqual({ x: 50, y: 25 });
  });

  it("is idempotent", () => {
    const once = clampPan(B, 3, 1000, -1000);
    expect(clampPan(B, 3, once.x, once.y)).toEqual(once);
    const out = clampPan(B, 0.5, 1000, -1000);
    expect(clampPan(B, 0.5, out.x, out.y)).toEqual(out);
  });

  it("passes through unchanged when bounds are absent", () => {
    expect(clampPan(undefined, 2, 500, -500)).toEqual({ x: 500, y: -500 });
  });
});

describe("panStarts", () => {
  // The board offers button 0 only to enable touch/pen panning while viewing;
  // usePanZoom must still never pan on a left-mouse press in any mode.
  const VIEW = [0, 1, 2]; // view-only board: primary contact + middle + right
  const BUILD = [1, 2]; // interactive board: middle + right only

  it("never pans on the left mouse button, even when button 0 is listed", () => {
    expect(panStarts("mouse", 0, VIEW)).toBe(false);
    expect(panStarts("mouse", 0, BUILD)).toBe(false);
  });

  it("pans on middle/right mouse buttons when listed", () => {
    expect(panStarts("mouse", 1, VIEW)).toBe(true);
    expect(panStarts("mouse", 2, BUILD)).toBe(true);
  });

  it("does not pan on a mouse button that isn't listed", () => {
    expect(panStarts("mouse", 1, [2])).toBe(false);
  });

  it("pans on a primary touch or pen contact while viewing", () => {
    expect(panStarts("touch", 0, VIEW)).toBe(true);
    expect(panStarts("pen", 0, VIEW)).toBe(true);
  });

  it("does not pan on touch in build mode", () => {
    expect(panStarts("touch", 0, BUILD)).toBe(false);
  });
});
