import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The HUD's own button, for in-game dialogs and prompts. The site's `Button`
 * is a hard-shadow press; dialogs over the board use these instead:
 *
 *  - `primary`: the one filled control (amber, `hud-primary`), on the answer
 *    that commits (Confirm, Take 2/2, Give 3/3). One per dialog.
 *  - `secondary`: the glass button beside it (`hud-secondary`): Cancel, Auto,
 *    Clear, a non-committing toggle.
 *  - `danger`: the secondary's shape in the bad ink, for a destructive answer
 *    (Reset, the Diplomat's Remove). Not filled: amber stays the one fill, and
 *    red on a button already means "refused".
 *
 * `pressed` draws a toggle's on state (Skip on a Commercial Harbor row) as a
 * focus-coloured ring, so a selected secondary never reads as the primary.
 */
export type HudButtonKind = "primary" | "secondary" | "danger";

export const HudButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    kind?: HudButtonKind;
    size?: "sm" | "md";
    pressed?: boolean;
  }
>(function HudButton({ kind = "secondary", size = "sm", pressed, className, type, ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      data-hud-button={kind}
      data-pressed={pressed ? "true" : undefined}
      aria-pressed={pressed}
      className={cn(
        "hud-btn",
        kind === "primary" ? "hud-primary" : "hud-secondary",
        kind === "danger" && "hud-btn-danger",
        size === "sm" ? "h-9 px-4 text-[13px]" : "h-10 px-5 text-[14px]",
        className,
      )}
      {...props}
    />
  );
});
