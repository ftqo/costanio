import * as React from "react";
import { useLingui } from "@lingui/react/macro";
import { Moon, Sun } from "@/lib/icons";
import { applyTheme, getStoredPref, resolveTheme, subscribeTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The one-click light/dark toggle, as state rather than as a button.
 *
 * It toggles light and dark only; "system" stays in Settings. A click always
 * lands on an explicit theme, opposite to what is currently showing (including
 * what `system` resolves to).
 *
 * `applyTheme` is the only writer (localStorage's "theme" key, the root `.dark`
 * class); this hook re-reads and subscribes, so every toggle and the Settings
 * panel stay in sync.
 */
export function useThemeToggle(): {
  resolved: "light" | "dark";
  /** Ready-to-use accessible label for the action the next click performs. */
  label: string;
  toggle: () => void;
} {
  const { t } = useLingui();
  const [, forceRender] = React.useState(0);
  React.useEffect(() => subscribeTheme(() => forceRender((n) => n + 1)), []);
  const prefersDark =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(getStoredPref(), prefersDark);
  return {
    resolved,
    label: resolved === "dark" ? t`Switch to light mode` : t`Switch to dark mode`,
    toggle: () => applyTheme(resolved === "dark" ? "light" : "dark"),
  };
}

/** The current theme's icon: what you are in, matching the orb in the game HUD. */
export function ThemeIcon({ resolved, size = 16 }: { resolved: "light" | "dark"; size?: number }) {
  return resolved === "dark" ? (
    <Moon weight="bold" size={size} />
  ) : (
    <Sun weight="bold" size={size} />
  );
}

/**
 * The site-header form of the toggle, beside the pip balance and in the same
 * chrome. Drawn for everybody, since signed-out visitors cannot reach Settings.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, label, toggle } = useThemeToggle();
  return (
    <button
      type="button"
      // The site button's quiet hover (index.css, site-material block).
      data-ui-button=""
      data-variant="secondary"
      title={label}
      aria-label={label}
      onClick={toggle}
      className={cn(
        // The header's control shape: 32px, control radius, 1px rim, soft lift.
        "flex items-center justify-center w-8 h-8 rounded-control border border-border bg-secondary-background text-foreground shadow-hard-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0",
        className,
      )}
    >
      <ThemeIcon resolved={resolved} />
    </button>
  );
}
