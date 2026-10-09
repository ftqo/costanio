// The arithmetic behind the two post-game charts, kept apart from the drawing
// so it can be tested without a DOM. The charts are hand-rolled (like
// MapPreview, ShapeEditor, BarbarianRail) rather than using a charting library.

/** Every total two dice can make, in the order the chart draws them. */
export const DICE_TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * How many of the 36 ordered outcomes make this total: 1 for 2 and 12, 6 for 7.
 */
export function waysToRoll(total: number): number {
  const ways = 6 - Math.abs(7 - total);
  return ways > 0 ? ways : 0;
}

/** The chance of one roll landing on this total. */
export function chanceOf(total: number): number {
  return waysToRoll(total) / 36;
}

/** How many times this total should have come up in `rolls` rolls. */
export function expectedCount(total: number, rolls: number): number {
  return rolls * chanceOf(total);
}

/**
 * One seat's victory points across the game, read from the server's track
 * (`[turn][seat]`). A row shorter than the seat list reads as zero for the
 * missing seats. Nothing here computes victory points (see game/scoreboard.go).
 */
export function vpSeries(track: number[][], seat: number): number[] {
  return track.map((row) => row[seat] ?? 0);
}

/**
 * Which rows of the race to draw: the start of every round (every `seats`
 * turns) and the final row. A row per turn drew each seat as long flats with
 * a jump on its own turn, so even smoothed the lines were staircases; one
 * point a round gives a curve that shows the trend. The last row is always
 * kept, so the line ends on the final score.
 */
export function raceSamples(rows: number, seats: number): number[] {
  if (rows <= 0) return [];
  const step = Math.max(1, seats);
  const out: number[] = [];
  for (let i = 0; i < rows; i += step) out.push(i);
  if (out[out.length - 1] !== rows - 1) out.push(rows - 1);
  return out;
}

/**
 * Whole-number ticks from 0 to `top`, about five of them, always including
 * `top` itself (the winning score), so the axis reads 0 2 4 6 8 10 rather
 * than whatever a generic scale picks.
 */
export function scoreTicks(top: number): number[] {
  const step = Math.max(1, Math.ceil(top / 5));
  const out: number[] = [];
  // A regular tick closer to `top` than half a step would crowd its label
  // (12 under 13), so it gives way.
  for (let v = 0; v < top - step / 2; v += step) out.push(v);
  out.push(top);
  return out;
}

/**
 * At most about six of the sampled turns as axis ticks, evenly spaced, always
 * the first and the last. The final sample is the game's last turn, usually
 * part way into a round, so the tick before it can sit close; when the last
 * gap is at most half the one before, that tick gives way so the two labels
 * never touch (17 beside 19).
 */
export function turnTicks(turns: number[]): number[] {
  const n = turns.length;
  if (n <= 2) return turns;
  const step = Math.max(1, Math.ceil((n - 1) / 5));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) out.push(turns[i]);
  out.push(turns[n - 1]);
  const k = out.length;
  if (k >= 3 && out[k - 1] - out[k - 2] <= (out[k - 2] - out[k - 3]) / 2) out.splice(k - 2, 1);
  return out;
}
