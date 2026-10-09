import { HudOrb } from "./HudLayer";
import { ThemeIcon, useThemeToggle } from "@/components/ThemeToggle";

/**
 * A one-click light/dark toggle in the HUD's top-right utility row, the last
 * acting control before the profile menu (see `extras` in routes/Game.tsx), so
 * the theme is one step away mid-turn instead of four through Settings.
 *
 * The behaviour (light/dark only, flipping away from what `system` resolves
 * to, agreeing with every other control) is `useThemeToggle`, shared with the
 * site header's toggle.
 */
export function ThemeOrb() {
  const { resolved, label, toggle } = useThemeToggle();
  return (
    <HudOrb title={label} aria-label={label} onClick={toggle}>
      <ThemeIcon resolved={resolved} />
    </HudOrb>
  );
}
