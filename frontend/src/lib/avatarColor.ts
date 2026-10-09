// Player identity colours: arbitrary avatar fills (like cosmetic swatch data),
// not themeable UI chrome, so fixed in light and dark.
const AVATAR_COLORS = [
  "var(--color-red)",
  "var(--color-blue)",
  "var(--color-amber)",
  "var(--color-purple)",
  "var(--color-green)",
  "var(--color-orange)",
];

export function avatarColor(id: number) {
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
}
