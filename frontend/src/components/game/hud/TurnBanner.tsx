import * as React from "react";
import { HeldActions } from "@/components/game/CommandHold";
import { cn } from "@/lib/utils";

/**
 * Top-center turn/phase banner, with the mode selectors hanging beneath it.
 * Move-mode (robber/pirate) and place-mode (road/ship) appear only while
 * armed, right under the banner at the top of the board, near what they
 * govern.
 */
export function TurnBanner({
  turnLabel,
  color,
  mine,
  children,
}: {
  turnLabel: React.ReactNode;
  /**
   * The colour of the seat whose turn it is, as a dot at the front of the pill,
   * matching the seat card and pieces. Omitted when there is no turn (game
   * over).
   */
  color?: string;
  /**
   * It is the viewer's own turn: the pill switches to the loud face, since the
   * banner is telling you to act.
   */
  mine?: boolean;
  /** Mode-selector chips; rendered under the pill only when present. */
  children?: React.ReactNode;
}) {
  const hasChips = React.Children.toArray(children).some(Boolean);
  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* One cap for two jobs, in one declaration. `70vw` keeps a long name from
          spanning the screen; `100%` lets the pill yield when it shares the
          line with the islands. The label is `whitespace-nowrap` (from
          `truncate`), so without a percentage cap it would overflow its grid
          track over the utility orbs. See HudTopRow, which sizes that track. */}
      <div
        // Yours: the yellow face (styles/pb-hud.css), the same mark as the
        // active seat's strip. Somebody else's: the neutral panel.
        data-turn-banner
        data-mine={mine ? "true" : undefined}
        className={cn(
          // A pill of the same glass as the panels, sentence case, 16/600. Your
          // own turn takes the solid fill and a ring in your colour.
          "hud-pc flex max-w-[min(70vw,100%)] items-center gap-2.5 rounded-full px-3.5 sm:px-[18px] py-1.5 sm:py-2.5 text-[13px] sm:text-[16px] font-semibold leading-none",
          // Your own turn: the solid fill and a larger glowing dot; the colour
          // is the dot's job.
          mine ? "hud-surf-solid" : "hud-surf",
          mine ? "text-[var(--hud-banner-mine-ink)]" : "text-[var(--hud-banner-ink)]",
        )}
        style={color ? ({ "--pc": color } as React.CSSProperties) : undefined}
      >
        {color && (
          <span
            aria-hidden
            className={cn("shrink-0 rounded-full", mine ? "h-2.5 w-2.5" : "h-2 w-2")}
            style={{
              background: "var(--pc-ink)",
              boxShadow: `0 0 0 ${mine ? 4 : 3}px color-mix(in srgb, var(--pc-ink) ${mine ? 30 : 22}%, var(${mine ? "--hud-banner-mine-bg" : "--hud-banner-bg"}))`,
            }}
          />
        )}
        <span className="min-w-0 truncate">{turnLabel}</span>
      </div>
      {hasChips && (
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          {/* The choices say how the next board tap resolves, so they wait
              for the board like the game's other controls (CommandHold). */}
          <HeldActions>{children}</HeldActions>
        </div>
      )}
    </div>
  );
}
