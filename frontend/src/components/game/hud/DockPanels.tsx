import * as React from "react";
import { useLingui } from "@lingui/react/macro";
import { GLASS, HudOrb } from "./HudLayer";
import { DOCK_TRIGGER_ICON, DOCK_TRIGGER_PILL, SQUAT_DOCK_PANEL } from "@/lib/hudChrome";
import { cn } from "@/lib/utils";

export type DockPanel = {
  key: string;
  /** Glyph for the orb form of the trigger, and its fallback when `pill` is absent. */
  icon: React.ReactNode;
  /** Accessible name + tooltip on both the trigger and the panel it raises. */
  title: string;
  /**
   * Wide-trigger content. The bank's five counts are what players ask for most,
   * so its trigger shows them; everything else gets the icon and a 36px orb.
   */
  pill?: React.ReactNode;
  /** Dot on the trigger: something arrived while this panel was closed. */
  badge?: boolean;
  content: React.ReactNode;
  /**
   * Published to the flight overlay, so spent and drawn cards have somewhere to
   * fly (the bank's trigger stands for the supply). A ref rather than the
   * element; see lib/hudAnchors.
   */
  anchorRef?: (el: HTMLElement | null) => void;
};

/**
 * A pill on the dock's trigger row: the bank's counts, and anything else the
 * screen parks down here.
 *
 * Exported because the game screen also puts the Rejoin button on this row
 * where the seat rail is horizontal; it needs the same height and press.
 *
 * The press matches the orbs beside it (see hudOrbClasses) but is spelled out,
 * since a trigger here is sized by its contents rather than a 36px square.
 */
export const DOCK_PILL = cn(
  GLASS,
  // A glass pill that brightens under the pointer, no hard press.
  "relative pointer-events-auto cursor-pointer transition-colors",
  "hover:bg-[var(--hud-raised)] active:bg-[var(--hud-well)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "rounded-full px-3 py-1.5 flex items-center gap-2",
  DOCK_TRIGGER_PILL,
);

/**
 * The reference surfaces raised from the dock: the bank, the table feed, both,
 * or neither.
 *
 * Which are here is the host's decision. Each has a home elsewhere on a large
 * enough window (the bank off the orb row, the feed in the bottom-right island)
 * and drops to the dock when the window can't hold it: the bank by width, the
 * feed by width or height (see lib/hudChrome). So the row may hold one or
 * none, and renders nothing when given nothing.
 *
 * A surface is bounded by the furniture below it, not the screen edge: it is
 * anchored to the top of the dock cluster (`bottom: 100%`), so it never covers
 * the hotbar, and being out of flow it can't grow the cluster it is measured
 * against.
 *
 * One panel at a time, as on the orb row. Both are reference surfaces: the
 * board stays live and pannable, with no scrim and no focus trap.
 */
export function DockPanels({
  panels,
  leading,
  trailing,
  maxH,
  lift,
  openRef,
}: {
  panels: DockPanel[];
  /**
   * Content pinned to the left end of the trigger row, opposite the panels: a
   * table action with nowhere better to be at this size (the Rejoin button).
   * Inside this row so both ends share one baseline and height, and an empty
   * screen still draws no row.
   */
  leading?: React.ReactNode;
  /**
   * Content pinned to the right end of the row, past the triggers: End turn
   * below `lg`, where the corner cluster has come apart to give the hand shelf
   * its width (see `turnControlsPlacement`). It keeps the corner nearest the
   * thumb.
   */
  trailing?: React.ReactNode;
  /**
   * How tall the raised panel may be, in layout pixels: the room between the
   * top row and the dock, measured against the visible area (see
   * lib/hudChrome). Absent before the first measurement, when the panel falls
   * back to a share of the small viewport.
   */
  maxH?: number;
  /**
   * Pixels to raise the panel above the dock. Non-zero only while the
   * on-screen keyboard is up: it doesn't resize the layout viewport, so a panel
   * anchored to the dock would sit behind the keys with the chat composer.
   */
  lift?: number;
  /**
   * Filled with a function that raises a panel by key, for chrome elsewhere. A
   * ref rather than lifting `open`, so there is one copy of the open state and
   * the dismissal rules stay here.
   */
  openRef?: React.MutableRefObject<((key: string) => void) | null>;
}) {
  const { t } = useLingui();
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!openRef) return;
    openRef.current = (key: string) => setOpen(key);
    return () => {
      openRef.current = null;
    };
  }, [openRef]);

  // A panel whose trigger has gone must not stay up with no way to close it
  // (widening the window moves the bank to the orb row mid-open).
  const shown = panels.find((p) => p.key === open) ?? null;
  const shownTitle = shown?.title;

  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    // `pointerdown`, not `click`, as in AnchoredMenu: the board acts on pointerup,
    // so a click dismissal would let the same press place a piece underneath.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rowRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  // Nothing belongs on the dock at this size (the bank is in the orb row, the
  // feed in its island). An empty row would leave its `mb-1.5` behind. Below
  // every hook, so the hook count is stable across breakpoints.
  //
  // `trailing` makes a row and `leading` doesn't: Rejoin has a home in the top
  // row at these widths, but End turn has none (see `turnControlsPlacement`),
  // so when the panels stand down for a trade offer the row stays.
  if (panels.length === 0 && !trailing) return null;

  return (
    <>
      {shown && (
        <div
          ref={panelRef}
          role="group"
          aria-label={shown.title}
          style={{
            ...(maxH == null ? null : { maxHeight: maxH }),
            // `bottom: 100%` puts the panel's bottom margin edge on the dock's
            // top edge, so a bottom margin is the whole keyboard lift.
            ...(lift ? { marginBottom: lift } : null),
          }}
          className={cn(
            GLASS,
            "absolute bottom-full z-10 pointer-events-auto",
            // Inset by hand, not by the cluster's padding: an absolutely
            // positioned box is laid out against its ancestor's padding box, so
            // `left-0` would hit the screen edge. The same `max()` the clusters
            // use keeps it clear of a landscape notch (see HudLayer).
            "left-[max(var(--hud-inset,0.5rem),env(safe-area-inset-left))]",
            "right-[max(var(--hud-inset,0.5rem),env(safe-area-inset-right))]",
            // The bottom-right corner, just above the dice, and capped: full
            // width is right on a phone and absurd on a wide monitor. The feed's
            // island sits in this corner on taller windows, so the feed stays in
            // one place at every size. No `w-full`: with `left`, `right` and a
            // width, CSS drops `right`. Width stays auto to fill the insets, and
            // `ml-auto` pins it right once the cap binds.
            //
            // On a phone the cap never binds (402px less insets is 386px against
            // a 416px cap), so corner and full width are the same box.
            "ml-auto max-w-[26rem]",
            "flex flex-col gap-2 p-2.5 pt-1.5 text-[13px] min-h-0",
            // Sideways phone: the dock is a column on the right edge, so the
            // panel opens beside it over the board, from the column's top edge.
            SQUAT_DOCK_PANEL,
            // The frame before the dock is measured. `svh` is wrong once a
            // keyboard is up (that's what `maxH` is for); this is only the
            // fallback.
            maxH == null && "max-h-[60svh]",
          )}
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label={t`Close ${shownTitle}`}
            className="mx-auto shrink-0 py-1.5 px-6 cursor-pointer"
          >
            <span className="block h-1 w-10 rounded-full bg-muted2" />
          </button>
          {/* The scroll lives here so a child can take the leftover height: the
              feed fills the panel and scrolls its own log pane, while the bank's
              blocks scroll here if the window is too short. `min-h-0` lets
              either give height back. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto no-scrollbar">
            {shown.content}
          </div>
        </div>
      )}

      {/* Above the hotbar and against the right edge, under the panel they
          raise, near the shelf. `justify-end` because the panel opens in the
          corner; on a phone the row is nearly full width anyway.

          One height for every control (from lib/hudChrome): the pill is sized by
          its counts and the icon buttons from the pill. */}
      <div
        ref={rowRef}
        // Sideways phone: a column, where Rejoin plus three triggers can outgrow
        // its narrowest width, so wrap.
        className="flex items-center justify-end gap-2 mb-1.5 squat:flex-wrap squat:gap-y-1.5"
      >
        {/* `mr-auto` rather than `justify-between`: the row stays `justify-end`
            so the panels keep their corner, and one auto margin moves this end
            to the other corner. */}
        {leading && <div className="mr-auto flex items-center gap-2">{leading}</div>}
        {panels.map((p) => {
          const active = open === p.key;
          const toggle = () => setOpen((o) => (o === p.key ? null : p.key));
          const badge = p.badge && !active && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red border-2 border-border"
            />
          );
          if (!p.pill) {
            return (
              <HudOrb
                key={p.key}
                ref={p.anchorRef}
                round
                title={p.title}
                aria-label={p.title}
                aria-pressed={active}
                active={active}
                onClick={toggle}
                // Overrides the orb's 36px square (a later utility of the same
                // group wins). The orb's coarse-pointer halo isn't a size, so it
                // survives and keeps a finger-sized target at 34px.
                className={cn("pointer-events-auto", DOCK_TRIGGER_ICON)}
              >
                {p.icon}
                {badge}
              </HudOrb>
            );
          }
          return (
            <button
              key={p.key}
              ref={p.anchorRef}
              type="button"
              title={p.title}
              aria-label={p.title}
              aria-pressed={active}
              onClick={toggle}
              className={cn(
                DOCK_PILL,
                // Held down while its panel is up, as an orb is (see
                // hudOrbClasses), spelled out because this trigger doesn't go
                // through hudOrbClasses. Yellow is a fixed light accent, so it
                // owns its on-accent text.
                active &&
                  "bg-yellow text-ink translate-x-boxShadowX translate-y-boxShadowY shadow-[0_0_0_0_var(--border)]",
              )}
            >
              {p.pill}
              {badge}
            </button>
          );
        })}
        {/* Last in the source as on the line, so reading order matches. */}
        {trailing && <div className="flex items-center gap-2">{trailing}</div>}
      </div>
    </>
  );
}
