// How a pile of identical cards in the hand shelf is drawn: as a stack, with
// the count badge kept for the exact figure (see ResCard's `showBadge`).
//
// Measured in card widths, not pixels, since cards change size across the
// breakpoint; the caller multiplies by a `--cw` custom property.
//
// Pure and layout-free. Shapes are memoised rather than prebuilt since a pile
// has no maximum depth.

/**
 * How far each card behind the front one peeks out, in card widths.
 *
 * Sideways only, so the shelf's top edge stays level across piles. An eighth of
 * a card keeps a deep pile affordable: ten cards take 2.1 card widths.
 */
export const HAND_STACK_STEP = 0.125;

export interface HandStack {
  /**
   * The cards behind the front one, as offsets from the slot's left edge in card
   * widths, back-most first: DOM order is paint order, so no z-index is needed.
   */
  behind: number[];
  /**
   * How wide the whole pile is, in card widths, and so how wide its slot in the
   * row is. Counting the backs in the slot keeps piles from drawing under their
   * neighbours.
   */
  width: number;
}

/**
 * The pile fans left, and the front card is the rightmost one.
 *
 * Fanned left, every visible sliver is a card's own left edge and the pile
 * reads as one card with depth behind it; fanned right, the slivers would trail
 * into the next pile. So `behind` ascends from the slot's left edge (also
 * back-to-front for paint order), and the front card (picture, badge, click
 * target) takes the right of the slot.
 *
 * No cap: a pile is drawn at its true depth, since the count matters most
 * around the discard threshold. The badge still carries the exact figure.
 */
function shapeFor(n: number): HandStack {
  const behind: number[] = [];
  for (let k = 0; k < n - 1; k++) behind.push(k * HAND_STACK_STEP);
  return { behind, width: 1 + Math.max(0, n - 1) * HAND_STACK_STEP };
}

// Depths a real hand reaches are built once and shared; deeper piles are built
// on demand so a nonsense count cannot grow the table.
const MEMO_TO = 32;
const SHAPES: HandStack[] = [];
for (let n = 0; n <= MEMO_TO; n++) SHAPES.push(shapeFor(n));

/**
 * How to draw a pile of `count` identical cards. Shared, frozen-by-convention
 * objects: callers read them, never mutate them.
 */
export function handStack(count: number): HandStack {
  if (!(count > 0)) return SHAPES[0];
  const n = Math.floor(count);
  return n <= MEMO_TO ? SHAPES[n] : shapeFor(n);
}
