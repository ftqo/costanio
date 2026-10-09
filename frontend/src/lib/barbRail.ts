// Geometry for the barbarian descent rail.
//
// The rail is a vertical hex tack: the fleet hops down a narrow column at the
// top right of the HUD as the event die advances it, alternating south-east and
// south-west.
//
// The board is pointy-top (see hexgeo), so there is no neighbour due north and
// a vertical path must alternate SE and SW. The zigzag is the real shortest
// path on the grid.
//
// The box is fixed and the hex size is solved to fill it. `barbarian_distance`
// is clamped to [4,12] (see `barbDist`) and `recommendedBarbarianDistance`
// raises it at bigger tables (9 at five or six players, 11 at seven or eight,
// 12 at nine or ten). A fixed hex size would swing the height from 112px to
// 280px, and the event feed's layout depends on it (see lib/hudChrome).

/** The default height budget. Not a constant of the design: see `hexSizeFor`. */
export const RAIL_BOX_H = 175;

/**
 * The shortest track the lobby can configure (`barbDist` clamps to [4,12]).
 * Fewest steps means the largest hexes, so this distance sets the box width.
 */
export const MIN_DIST = 4;

/**
 * Width of the box the layout reserves, for a given height budget.
 *
 * A tack is `3 * (√3/2) * s` wide: half a hex width between the two columns,
 * plus a full hex width of overhang on each side. Solved at `MIN_DIST` so every
 * longer track (smaller hexes) fits inside. Rounded up to a whole pixel because
 * other boxes are positioned against it. 57 at the default 175px budget.
 */
export function railBoxW(boxH: number = RAIL_BOX_H): number {
  return Math.ceil(3 * (Math.sqrt(3) / 2) * hexSizeFor(MIN_DIST, boxH));
}

/** The reserved width at the default budget. */
export const RAIL_BOX_W = railBoxW(RAIL_BOX_H);

/**
 * Hex size that fits `dist + 1` positions into `boxH`.
 *
 * N steps occupy N+1 hex centres spaced `1.5 * s` apart, plus half a hex of
 * overhang at each end: `1.5 * s * N + 2 * s` of height, solved for `s`.
 *
 * `boxH` is a budget so a short landscape phone can pass a smaller one. Steps
 * are never dropped; the track length is a table rule.
 */
export function hexSizeFor(dist: number, boxH: number = RAIL_BOX_H): number {
  return boxH / (1.5 * dist + 2);
}

export interface RailCell {
  /** Centre, in the box's own coordinates. */
  x: number;
  y: number;
  /** Step this cell stands for: 0 is the standoff, `dist` is landfall. */
  step: number;
}

/**
 * Every hex centre down the tack, from the standoff to the shore.
 *
 * The two columns straddle the centre line by half a hex width each. Ordered
 * by step, top to bottom.
 */
export function railCells(dist: number, boxH: number = RAIL_BOX_H): RailCell[] {
  const s = hexSizeFor(dist, boxH);
  const half = (Math.sqrt(3) / 2) * s;
  const mid = railBoxW(boxH) / 2;
  const cells: RailCell[] = [];
  for (let step = 0; step <= dist; step++) {
    cells.push({
      // Even steps west of the centre line, odd east.
      x: mid + (step % 2 === 0 ? -half / 2 : half / 2),
      y: s + 1.5 * s * step,
      step,
    });
  }
  return cells;
}

/**
 * An SVG `points` list for a pointy-top hex (vertices at top and bottom, as on
 * the board). `hexgeo.hexCorners` gives the same shape in board space; this is
 * a 2D HUD glyph with no board coordinates.
 */
export function hexPoints(cx: number, cy: number, s: number): string {
  const w = (Math.sqrt(3) / 2) * s;
  return [
    [cx, cy - s],
    [cx + w, cy - s / 2],
    [cx + w, cy + s / 2],
    [cx, cy + s],
    [cx - w, cy + s / 2],
    [cx - w, cy - s / 2],
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
}

/**
 * Below this hex size, 1px cell outlines start disappearing. A distance-12
 * track puts hexes at 8.75 units; the stroke widens so the cells keep their
 * hex outlines.
 */
export const RAIL_FINE_HEX = 11;

/** Stroke width for a cell at hex size `s`. */
export function railStroke(s: number): number {
  return s < RAIL_FINE_HEX ? 1.4 : 1.1;
}

// --- The horizontal rail -----------------------------------------------------
//
// Below `lg` the seat rail becomes a strip under the top row and the fleet
// follows, since a 175px column would take a quarter of a phone's board.
//
// It runs straight: east is a pointy-top neighbour, so a horizontal path needs
// no zigzag. The row is 2*s tall against the column's 12.5*s.

/**
 * The horizontal rail's design width. The SVG scales to the strip, so this only
 * fixes proportions (strip height against width, hex size against the seat
 * card).
 */
export const RAIL_ROW_W = 320;

/** Hex size that fits `dist + 1` hexes across `boxW`, edge to edge. */
export function hexSizeForRow(dist: number, boxW: number): number {
  return boxW / ((dist + 1) * Math.sqrt(3));
}

/** How tall the horizontal rail comes out for a given width budget. */
export function railRowH(dist: number, boxW: number): number {
  return 2 * hexSizeForRow(dist, boxW);
}

/**
 * Every hex centre across the row, from the standoff to the shore.
 *
 * Spaced by a full hex width (edge to edge for pointy-top). Ordered left to
 * right, like the HUD's other tracks (see TrackPips).
 */
export function railRowCells(dist: number, boxW: number): RailCell[] {
  const s = hexSizeForRow(dist, boxW);
  const w = Math.sqrt(3) * s;
  const cells: RailCell[] = [];
  for (let step = 0; step <= dist; step++) cells.push({ x: w / 2 + w * step, y: s, step });
  return cells;
}
