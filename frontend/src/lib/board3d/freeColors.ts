// The ten free seat colours, mirrored from cosmetics.Palette[:FreeCount].
//
// These are worth keeping on disk: they are the seat-order defaults, so nearly
// every table uses some of them. Supporter colours are rendered on the fly and
// kept only for the life of the tab (see shotStore).
//
// Mirrored rather than fetched because /api/cosmetics is auth-gated and guests
// benefit from the bake too. cosmetics/freecolors_drift_test.go reads this file
// and fails if the two lists disagree.
export const FREE_SEAT_COLORS = [
  "#000000", // Black
  "#ffffff", // White
  "#ff0000", // Red
  "#ffaa00", // Orange
  "#ffff00", // Yellow
  "#00ff00", // Green
  "#00ffff", // Cyan
  "#0000ff", // Blue
  "#aa00ff", // Purple
  "#ff00ff", // Magenta
] as const;

const FREE = new Set<string>(FREE_SEAT_COLORS);

/**
 * Whether this seat colour is one of the free presets, and so worth persisting.
 *
 * Case-insensitive and tolerant of a missing `#`: the seat wire, the
 * colourblind override and cosmetics loadouts do not all agree on the form.
 */
export function isFreeSeatColor(color: string | null | undefined): boolean {
  if (!color) return false;
  const hex = color.startsWith("#") ? color : `#${color}`;
  return FREE.has(hex.toLowerCase());
}
