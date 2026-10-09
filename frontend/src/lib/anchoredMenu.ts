// Where a small menu goes when anchored to a clicked point. Pure, like
// lib/floating and lib/hudAnchors, so the edge cases are testable without a DOM.

/** Gap between the click point and the menu, so the menu never sits under the cursor. */
export const ANCHOR_GAP = 14;
/** Keep this far clear of the viewport edge. */
export const VIEWPORT_MARGIN = 8;

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Which side of the anchor the menu ended up on. */
  side: "below" | "above";
}

/**
 * Place a `menu`-sized box near `point` inside `viewport`.
 *
 * Below the click by default, flipping above only when below does not fit, so
 * the menu does not cover the spot just chosen. Centred horizontally on the
 * click, then clamped.
 */
export function placeMenu(point: { x: number; y: number }, menu: Size, viewport: Size): Placement {
  const roomBelow = viewport.height - point.y - ANCHOR_GAP - VIEWPORT_MARGIN;
  const roomAbove = point.y - ANCHOR_GAP - VIEWPORT_MARGIN;
  // Flip only when below does not fit and above fits better. A menu taller
  // than the viewport is clamped, not flipped.
  const side: Placement["side"] =
    menu.height <= roomBelow || roomBelow >= roomAbove ? "below" : "above";

  const rawTop = side === "below" ? point.y + ANCHOR_GAP : point.y - ANCHOR_GAP - menu.height;
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - menu.height - VIEWPORT_MARGIN);
  const top = Math.min(Math.max(rawTop, VIEWPORT_MARGIN), maxTop);

  const rawLeft = point.x - menu.width / 2;
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - menu.width - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(rawLeft, VIEWPORT_MARGIN), maxLeft);

  return { left, top, side };
}

/**
 * Place a `menu`-sized box centred on `point` and above it, for a row of cards
 * that points at the spot (`placeMenu` puts a list beside it instead).
 *
 * `anchorY` is how far down the box the point falls. Absent, the whole box
 * sits above the point. The location menu uses it to straddle the spot: cards
 * above, readout below.
 *
 * Centred on the box's full width, since the readout is usually wider than the
 * row of cards. Clamping can still pull the box off the point near an edge.
 */
export function placeAbove(
  point: { x: number; y: number },
  menu: Size,
  viewport: Size,
  /** Distance from the box's top to the point, for a box that straddles it. */
  anchorY?: number,
): { left: number; top: number } {
  const clamp = (raw: number, extent: number, span: number) =>
    Math.min(
      Math.max(raw, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, extent - span - VIEWPORT_MARGIN),
    );
  return {
    left: clamp(point.x - menu.width / 2, viewport.width, menu.width),
    top: clamp(point.y - (anchorY ?? menu.height + ANCHOR_GAP), viewport.height, menu.height),
  };
}
