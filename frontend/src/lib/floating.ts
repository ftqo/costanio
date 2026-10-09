// Pure geometry for placing a floating element (tooltip/hint) next to a trigger,
// kept free of the DOM so it can be unit-tested. All inputs and outputs are in
// layout (CSS) pixels; the caller is responsible for any zoom normalization.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PlaceOpts {
  /** Space between the trigger and the tip. */
  gap?: number;
  /** Minimum distance the tip keeps from every viewport edge. */
  margin?: number;
}

export interface Placement {
  left: number;
  top: number;
  placement: "above" | "below";
}

/**
 * Position a tip of size `tip` against trigger `anchor`, kept inside `viewport`.
 *
 * Prefers above the trigger and flips below without headroom. Horizontally it
 * centres on the trigger, then clamps so the tip never crosses a viewport edge
 * (left-panel hints would otherwise slide off screen).
 */
export function placeTooltip(
  anchor: Box,
  tip: Size,
  viewport: Size,
  opts: PlaceOpts = {},
): Placement {
  const gap = opts.gap ?? 8;
  const margin = opts.margin ?? 6;

  // Vertical: above if it fits with headroom, else below.
  const fitsAbove = anchor.top - gap - tip.height >= margin;
  const placement: "above" | "below" = fitsAbove ? "above" : "below";
  const rawTop = fitsAbove ? anchor.top - gap - tip.height : anchor.bottom + gap;
  const top = clamp(rawTop, margin, viewport.height - margin - tip.height);

  // Horizontal: center on the trigger, then clamp into the viewport.
  const center = anchor.left + anchor.width / 2;
  const left = clamp(center - tip.width / 2, margin, viewport.width - margin - tip.width);

  return { left, top, placement };
}

function clamp(v: number, lo: number, hi: number): number {
  // If the tip is larger than the room, lo can exceed hi; favour the low edge so
  // it never goes off the top/left.
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(v, hi));
}
