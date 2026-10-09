/**
 * Which shape the landing page is in, and what the camera is told about it.
 *
 * One page, two arrangements, chosen by window shape rather than device:
 *
 *   COLUMNS  the board is full bleed with the copy over open water beside it.
 *            Landscape and wide enough for both (desktop, laptop, a tablet or
 *            phone turned sideways).
 *   STACKED  the board is full bleed with the copy over open water above it.
 *            Portrait has no room beside a roughly circular island (a 47% strip
 *            of a 768px window is 360px wide) but plenty above.
 *
 * No third arrangement and no width floor for the board: a small window gets a
 * small island. The cost is that a phone downloads several megabytes of .glb
 * and runs a render loop.
 */
import type { BoardProps } from "@/components/board/props";

export type HomeTier = "wide" | "short" | "stacked";

/**
 * Landscape, and either wide enough for a column beside the board or a phone
 * held sideways.
 *
 * Not `COLUMN_LAYOUT_QUERY`, which is the game HUD's (pinned to `lg` by its own
 * test) and asks where the seat rail and hotbar go. This asks whether a
 * paragraph fits beside an island.
 *
 * The 700px floor keeps narrow landscape windows from getting a column they
 * can't draw; they stack. Except when also short: a 667x375 sideways phone has
 * no room to stack (the invite row went under the footer), so it gets the
 * SHORT column arrangement sized for that screen.
 */
export const HOME_COLUMNS_QUERY =
  "(min-aspect-ratio: 1/1) and ((min-width: 700px) or (max-height: 600px))";

/** Too short for the column's own spacing: a phone held sideways, mostly. */
export const HOME_SHORT_QUERY = "(max-height: 600px)";

/** Resolve the two media answers into the one arrangement to draw. */
export function homeTier(columns: boolean, short: boolean): HomeTier {
  if (!columns) return "stacked";
  return short ? "short" : "wide";
}

/**
 * Breathing room kept between the copy and the island, as a fraction of the
 * viewport. Small, because the gradient scrim already separates them.
 */
export const HOME_GAP_FRAC = 0.02;

/**
 * The least of the frame's height the stacked island may be left, between the
 * copy above it and the footer below.
 *
 * A last resort, not the working limit: the island is framed below the copy at
 * any band, just smaller (see `farPlaneFor` in `lib/board3d/scene.ts` for what
 * once made small bands vanish). On 360x780 to 430x932 in English the band is
 * about 0.3. This catches only a copy block so tall (a long translation on a
 * tiny phone) that the island would be a speck; then the island's top goes
 * under the scrim rather than off the page.
 */
export const HOME_STACKED_BAND_MIN = 0.2;

/** How far down the top band may reach, given what the footer takes below. */
export function stackedTopMax(bottom: number): number {
  return Math.max(0, 1 - bottom - HOME_STACKED_BAND_MIN);
}

export type HomeChrome = NonNullable<BoardProps["hudChrome"]>;

/**
 * What the board is told, given the copy block the page actually drew.
 *
 * Every argument is a measured fraction of the viewport (as `railFrac` is in
 * the game screen), since no constant is right at more than one window size:
 *
 * - `copyFrac`: the copy's band, its right edge over the width in COLUMNS, its
 *   bottom edge over the height in STACKED.
 * - `footFrac`: the site footer's band along the bottom (one row of links on a
 *   desktop, a column on a phone, nothing in the Discord Activity).
 * - `headFrac`: the site header's bottom edge over the height. In COLUMNS the
 *   island sits top right, under the header's controls, so its top band is at
 *   least the header (a fixed 0.08 was 31px against a 50px header at 844x390).
 *
 * Each arrangement caps what the copy may claim, differently: a column that
 * took the width still leaves room for a small island, while a stacked band
 * that took the height loses it. See `stackedTopMax`.
 */
export function homeChrome(
  tier: HomeTier,
  copyFrac: number,
  footFrac: number,
  headFrac = 0,
): HomeChrome {
  const clear = Math.max(0, copyFrac) + HOME_GAP_FRAC;
  // The footer gets the gap too, so the coast stops above it.
  const foot = Math.min(0.3, Math.max(0, footFrac) + HOME_GAP_FRAC);
  if (tier === "stacked") {
    return { left: 0.03, right: 0.03, top: Math.min(stackedTopMax(foot), clear), bottom: foot };
  }
  // Asymmetric on purpose, hence `left`/`right` rather than the symmetric
  // `railFrac` the game screen uses.
  const top = Math.max(0.08, Math.max(0, headFrac) + HOME_GAP_FRAC);
  return { left: Math.min(0.7, clear), right: 0.02, top, bottom: foot };
}
