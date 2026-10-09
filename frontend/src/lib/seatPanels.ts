// How much of each player's card shows.
//
// Two sizes, chosen by breakpoint only. Desktop draws the whole card; a phone
// draws one line per seat and opens every card on a tap, like the bank strip.
// The size is not fitted to window height, so a card shows the same thing on
// every machine; a big table scrolls instead (with the fade cue, and the
// active seat scrolled into view each turn).
export type SeatDensity = "full" | "micro";

/** Base game, or Knights, which adds a row of improvement tracks. */
export type SeatVariant = "base" | "knights";

/**
 * Height of one panel at each tier, in CSS pixels.
 *
 * Declared, not estimated: the panel renders at exactly this height with
 * `overflow-hidden`, so the arithmetic below is exact and a card stays the
 * same size whatever it holds.
 *
 * Each includes SEAT_TIMER_H for the countdown strip, reserved whether or not
 * the seat is on the clock, plus 2px headroom so sub-pixel rounding under
 * index.css's `zoom` cannot clip the strip.
 *
 * No separate set is needed for Chinese or Japanese. Han line boxes are taller
 * than Latin ones at the same font size, but every line height in the app is a
 * ratio (Tailwind preflight's unitless 1.5), so a row's height depends on
 * font-size alone. Measured with a CJK name and translated tracks, `full`
 * renders 87.5 and `micro` 41 in every locale, inside the 93 and 43 these
 * numbers leave within the panel's `p-1`.
 *
 * A translation can make a row too wide; rows are `nowrap` over
 * `overflow-hidden` (see PlayerCard) because a wrapped line is height this
 * panel has not reserved.
 */
export const SEAT_PANEL_HEIGHT: Record<SeatDensity, Record<SeatVariant, number>> = {
  // A Knights panel is its base counterpart plus the improvement-track row.
  // The counters and awards rows have declared heights in PlayerCard; the
  // card's content is 93px inside a 95px client box (measured in Chrome at
  // 1280, 1600 and 1920 wide). A held award is a badge beside the score, so
  // there is no awards row.
  full: { base: 87, knights: 107 },
  // `micro` draws no track row, so both variants are the same height.
  micro: { base: 51, knights: 51 },
};

/**
 * What the counters row costs a card: the row plus the gap above it. Memory
 * mode (GameConfig.memory_mode) removes the row, and the panel must stop
 * reserving it.
 *
 * Measured, like the heights above: a 26px chip row plus the 6px `gap-1.5`
 * above it. `micro` draws no counters row (see `seatPanelHeight`).
 */
export const SEAT_COUNTERS_H = 32;

/**
 * The panel height for one card, which memory mode makes shorter. Every reader
 * goes through this rather than indexing SEAT_PANEL_HEIGHT, so the declared
 * height, the fit arithmetic and the scroll-fade agree.
 */
export function seatPanelHeight(
  density: SeatDensity,
  variant: SeatVariant = "base",
  memory = false,
  counterRows = 1,
): number {
  const h = SEAT_PANEL_HEIGHT[density][variant];
  // Asks `seatFields` rather than the density name, so this follows any tier
  // that changes whether it draws the row.
  if (!seatFields(density).counters) return h;
  if (memory) return h - SEAT_COUNTERS_H;
  return h + Math.max(0, counterRows - 1) * SEAT_COUNTER_ROW_H;
}

/**
 * What each counters line after the first adds to a card: one 26px counter
 * chip (PlayerCard's COUNTER, `h-[26px]`, the same at both widths) plus the
 * row's 4px `gap-y-1`. Measured on the live rail: rows at y 107 and 137.
 */
export const SEAT_COUNTER_ROW_H = 30;

/**
 * The most counters one line of a card holds and still reads.
 *
 * A counter is a 16px icon, a 2px gap and the value (a 2ch box, wider for a
 * fraction like "1/1") in a 2px padded pill: 41px at its widest (PlayerCard's
 * COUNTER). The 252px card has 232px of row, so five fit (43px a cell); the
 * sideways phone's card, at least 200px, has 180, so four (42px a cell).
 * Narrower cells clip fractions and overlap the next icon.
 *
 * `squat` is the sideways phone (SQUAT_QUERY in lib/hudChrome; the card's own
 * `squat:w-[clamp(200px,25vw,224px)]` is the same media query).
 */
export const SEAT_COUNTER_COLS_MAX = { wide: 5, squat: 4 } as const;

/**
 * How a card lays out `count` counters: as few lines as fit, then as even as
 * possible (seven is four over three, not five over two).
 *
 * Every card in a game has the same counters (a property of the ruleset, see
 * `seatCounterCount`), so the columns line up down the rail.
 */
export function seatCounterGrid(count: number, squat: boolean): { rows: number; cols: number } {
  const max = squat ? SEAT_COUNTER_COLS_MAX.squat : SEAT_COUNTER_COLS_MAX.wide;
  const n = Math.max(1, count);
  const rows = Math.ceil(n / max);
  return { rows, cols: Math.ceil(n / rows) };
}

/**
 * How many counters a card draws at `full` in a game with these caps. Mirrors
 * PlayerCard's counters row cell for cell (PlayerCardCounters.test checks it)
 * because the rail sizes the panel from this before any card renders.
 */
export function seatCounterCount(caps: {
  hasKnightPieces: boolean;
  hasDevCards: boolean;
  hasLargestArmy: boolean;
  hasRaiders: boolean;
  hasWagons: boolean;
  hasExplorers: boolean;
  hasFish: boolean;
  hasHarbormaster: boolean;
  hasRivers: boolean;
  hasCaravans?: boolean;
}): number {
  let n = 2; // the hand, and the route length that closes the row
  if (caps.hasKnightPieces)
    n += 2; // progress cards, knights on the board
  else n += (caps.hasDevCards ? 1 : 0) + (caps.hasLargestArmy ? 1 : 0);
  // Gold, except where Wagons' gold is the Rivers coin purse (Wagons + Rivers,
  // without Raiders' own gold): that purse is the coin counter below.
  if (caps.hasRaiders || caps.hasExplorers || (caps.hasWagons && !caps.hasRivers)) n += 1;
  if (caps.hasRaiders) n += 2; // prisoners, riders on the board
  if (caps.hasWagons) n += 2; // wagon level, deliveries
  if (caps.hasExplorers) n += 2; // cargo ships, mission points
  if (caps.hasFish) n += 1;
  if (caps.hasHarbormaster) n += 1;
  if (caps.hasRivers) n += 1; // coins
  if (caps.hasCaravans) n += 1; // points from the camels
  return n;
}

/** The countdown strip's own height. It sits in the card's bottom padding. */
export const SEAT_TIMER_H = 3;

/**
 * The gap between panels at full size. Part of the pitch, so part of the fit;
 * `seatPanelGap` starts from it. Cards carry their own 2px border, so 6px is
 * enough separation.
 */
export const SEAT_PANEL_GAP = 6;

/**
 * The gap between panels in the phone strip, where the rail is a row. Cards
 * are far wider than tall, so 6px would read as a wide gutter side by side.
 *
 * No breakpoint needed: the rail is `flex-row` below lg and `flex-col` from
 * lg, and `column-gap` only applies in a row, `row-gap` only in a column.
 */
export const SEAT_STRIP_GAP = 4;

/** Space left below the rail so it never runs into the bottom of the window. */
export const SEAT_RAIL_BOTTOM_INSET = 16;

/**
 * The least room the column is given: one full card and a glimpse of the
 * next, so it reads as scrollable.
 *
 * On a short landscape window (874x402, four seats) the top and bottom rows
 * take nearly the whole viewport and `room - bottomInset` goes negative.
 * Clamping to 0 would mean "not measured" and apply no max-height, leaving
 * the column off the bottom of the window and unscrollable. Overlapping the
 * shelf a little is better: a scrolling rail can still reach every seat.
 */
export const SEAT_RAIL_MIN_H = 120;

/**
 * The column's `max-height`: the room it has less what the shelf claims, but
 * never below a scrollable minimum and never past the window.
 *
 * `room` is the distance from the rail's top edge to the bottom of the window,
 * in layout pixels; 0 or less means not measured yet, and 0 back out means
 * "leave the height alone".
 */
export function railMaxHeight(room: number, bottomInset: number): number {
  if (room <= 0) return 0;
  // The floor is capped by the edge inset: it may overlap the shelf, not the
  // screen edge.
  const ceiling = Math.max(0, room - SEAT_RAIL_BOTTOM_INSET);
  return Math.min(ceiling, Math.max(room - bottomInset, SEAT_RAIL_MIN_H));
}

/**
 * The gap between panels for the room the rail has: the widest that still
 * fits, down to flush. At ten seats the full gap is 72px of column.
 *
 * A rail whose panels alone overflow keeps the full gap, since it scrolls
 * either way.
 *
 * `available` is the column's room in layout pixels, or 0 for unconstrained:
 * before the first measurement, and below `lg`, where the rail is a
 * horizontal strip and a vertical measurement must not shrink the gap.
 */
export function seatPanelGap(
  count: number,
  density: SeatDensity,
  variant: SeatVariant = "base",
  available = 0,
  memory = false,
  counterRows = 1,
): number {
  // One panel has no gaps, and an unmeasured or horizontal rail has no
  // vertical fit to make.
  if (count <= 1 || available <= 0) return SEAT_PANEL_GAP;
  const spare = available - count * seatPanelHeight(density, variant, memory, counterRows);
  if (spare < 0) return SEAT_PANEL_GAP;
  return Math.min(SEAT_PANEL_GAP, Math.floor(spare / (count - 1)));
}

/**
 * Total height `count` panels occupy at `density`, gaps included. The rail
 * uses it to decide whether it overflows, which turns on the scroll-fade.
 *
 * Pass the gap `seatPanelGap` resolved; a mismatch lights the fade wrongly.
 */
export function seatRailHeight(
  count: number,
  density: SeatDensity,
  variant: SeatVariant = "base",
  gap = SEAT_PANEL_GAP,
  memory = false,
  counterRows = 1,
): number {
  if (count <= 0) return 0;
  return count * seatPanelHeight(density, variant, memory, counterRows) + (count - 1) * gap;
}

/** Whether this tier shows a given field. */
export interface SeatFields {
  name: boolean;
  vp: boolean;
  /** The full counters row (hand, dev, knights, and the Knights extras). */
  counters: boolean;
  /**
   * The least urgent Knights counter, the progress-card count. On wherever
   * the counters row is. Kept as a field because the phone strip's row is a
   * fixed 168px and may not wrap (the panel is a declared height and clips).
   */
  extras: boolean;
  /** Just the hand count, inline on the identity row. */
  handOnly: boolean;
  awards: boolean;
  tracks: boolean;
}

/**
 * `memory` is the table's memory mode (GameConfig.memory_mode): whatever the
 * tier draws, the score and counters row are hidden. It never turns a field
 * on.
 */
export function seatFields(density: SeatDensity, memory = false): SeatFields {
  if (memory) {
    const f = seatFields(density);
    return { ...f, vp: false, counters: false, extras: false, handOnly: false };
  }
  switch (density) {
    case "full":
      return {
        name: true,
        vp: true,
        counters: true,
        extras: true,
        handOnly: false,
        awards: true,
        tracks: true,
      };
    case "micro":
      // The phone strip, closed: who is playing and their score. The strip
      // opens as a whole (see SeatRail's `expandedRail`), so the detail costs
      // one press for the whole table rather than one per seat. Never less
      // than this: a panel must always say whose it is.
      return {
        name: true,
        vp: true,
        counters: false,
        extras: false,
        handOnly: false,
        awards: false,
        tracks: false,
      };
  }
}

/**
 * The clear gap between the opponents' stack and your own seat panel at the
 * foot of the column. A minimum: the column's spare height joins it.
 */
export const OWN_SEAT_GAP = 16;

/**
 * From this many seats the desktop column draws the opponents as the compact
 * one-line rail rather than as whole panels. Six whole panels plus your own
 * still fit a 1080p column; seven do not without scrolling.
 */
export const COMPACT_RAIL_AT = 7;

/** One line of the compact rail, in layout px (the row's own height plus its 1px gap). */
export const COMPACT_ROW_H = 31;

/**
 * The sideways phone's seat rail while closed, in CSS px: one line per seat
 * (name, hand, score), the whole card a tap away. 164px holds the colour dot,
 * a name of eight or nine characters at 13px, the hand count and a two-digit
 * score.
 */
export const SQUAT_RAIL_W = 164;

/** SQUAT_RAIL_W as the class that draws it (Tailwind's 0.25rem step: 41 x 4px). */
export const SQUAT_RAIL_WIDTH = "w-41";

/**
 * How the rail draws its seats: the tier, whether opponents are one-line rows,
 * and whether those rows are the sideways phone's narrow ones.
 *
 * - A desktop column is always `full`, and goes to one-line rows from
 *   COMPACT_RAIL_AT seats. `railOpen` is a phone's choice and never shrinks it.
 * - The portrait strip is `micro` until opened, and never rows: it runs off
 *   the side, not down.
 * - A sideways phone is a column that behaves like the strip: closed by
 *   default (the same stored choice), and closed it is narrow rows at every
 *   table size. Opened, it is the desktop column.
 */
export function seatRailMode(o: {
  wide: boolean;
  squat: boolean;
  railOpen: boolean;
  count: number;
}): { density: SeatDensity; compact: boolean; narrow: boolean } {
  if (o.wide && o.squat && !o.railOpen) return { density: "micro", compact: true, narrow: true };
  if (o.wide) return { density: "full", compact: o.count >= COMPACT_RAIL_AT, narrow: false };
  return { density: o.railOpen ? "full" : "micro", compact: false, narrow: false };
}
