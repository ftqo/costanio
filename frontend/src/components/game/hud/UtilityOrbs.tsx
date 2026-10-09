import * as React from "react";
import { GLASS, HudOrb } from "./HudLayer";
import { cn } from "@/lib/utils";

/**
 * Top-right cluster: the acting controls, and the reference card the window is
 * wide enough to hang beneath them.
 *
 * Most controls here act (camera reset, theme toggle, profile menu): each is a
 * `HudOrb` that does its thing and reveals nothing, so no state.
 *
 * The exception is `TopPanelOrb`, the bank from `lg` up: an orb with a card
 * hanging off the row's right edge. Desktop only; below `lg` the panel is
 * raised from the dock (see DockPanels), since a 264px card in a phone's top
 * corner would cover the seat rail and half the board.
 *
 * `relative`, because the card hangs off this row as a popover rather than in
 * flow; otherwise the top row (which the seat rail is parked beneath) would
 * grow by 300-odd pixels and shove the HUD down when the bank opened.
 */
export function UtilityOrbs({ children }: { children: React.ReactNode }) {
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  return (
    <OrbRowContext.Provider value={rowRef}>
      <div ref={rowRef} className="relative flex items-center gap-1.5">
        {children}
      </div>
    </OrbRowContext.Provider>
  );
}

/**
 * The row's own box, handed down. A hanging card needs it as its containing
 * block (`right-0` is the row's right edge, flush with the screen inset) and as
 * the boundary for inside/outside presses: a press on a neighbouring orb is
 * inside and must not close the card, which is why card and orbs are one
 * component.
 */
const OrbRowContext = React.createContext<React.RefObject<HTMLDivElement | null> | null>(null);

/**
 * An orb in the top-right row with a card of reference state hanging off it.
 * Rendered only where there is a right-hand column to hang in; the host
 * decides, and renders nothing at the widths where the panel is on the dock.
 */
export function TopPanelOrb({
  title,
  icon,
  badge,
  children,
  pinned,
  maxH,
  anchorRef,
  contentRef,
  onOpenChange,
}: {
  /** Accessible name + tooltip on the orb, and the card's own label. */
  title: string;
  /** Glyph for the orb. */
  icon: React.ReactNode;
  /** Dot on the orb: something arrived while the card was closed. */
  badge?: boolean;
  /** The card's contents. */
  children: React.ReactNode;
  /**
   * Open this card by default, and keep it open until its own orb closes it.
   * True on screens with room to leave a reference surface up: the bank, trade
   * rates and barbarian track are read while deciding.
   */
  pinned?: boolean;
  /**
   * How tall the card may be, in layout pixels: the room before whatever is
   * parked below it in the right-hand column (the table feed's island).
   * Computed by the game screen (see lib/hudChrome). Absent (no island, or not
   * yet measured), the card falls back to a share of the viewport.
   */
  maxH?: number;
  /**
   * The ref the orb should carry: the bank orb is where spent and drawn cards
   * fly to and from. See lib/hudAnchors for why this returns a ref.
   */
  anchorRef?: (el: HTMLElement | null) => void;
  /**
   * The card's content box, for a host that needs its natural height. Not the
   * card itself, which carries the cap: measuring that would feed the cap back
   * into the reserve. The content box overflows the card rather than being
   * bounded by it, so its height is stable.
   */
  contentRef?: React.Ref<HTMLDivElement>;
  /**
   * Told whenever the card opens or closes, the pin included. The card hangs
   * down over the column where the barbarian rail sits, so the rail needs to
   * know to keep clear (see `barbRailRight`).
   *
   * Reported from an effect rather than the toggle, so the pin following the
   * media query (which sets state during render) is reported too.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(() => !!pinned);

  // The pin follows the query in both directions (a phone rotating, a window
  // dragged small), so a card can't stay open where there's no room. It touches
  // only the pinned state; a card opened by hand stays the player's to close.
  const wasPinned = React.useRef(pinned);
  if (wasPinned.current !== pinned) {
    wasPinned.current = pinned;
    setOpen(!!pinned);
  }

  // Reported here rather than from the toggle so every route into `open` is
  // covered: the orb, Escape, an outside press, and the pin (set during
  // render).
  React.useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const rowRef = React.useContext(OrbRowContext);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // `pointerdown`, not `click`, as in AnchoredMenu: the board acts on
    // pointerup, so a click dismissal would let the same press place a piece.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rowRef?.current?.contains(t) || cardRef.current?.contains(t)) return;
      // The pinned card isn't a popover: closing it on any outside press made
      // unrelated controls (a die, the feed switch) close the bank. It closes
      // on its orb, mirroring how the pin opens it.
      if (pinned) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, pinned, rowRef]);

  return (
    <>
      <HudOrb
        ref={anchorRef}
        title={title}
        aria-label={title}
        aria-pressed={open}
        active={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {badge && !open && (
          <span
            aria-hidden
            data-unread-dot
            className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red border-2 border-border"
          />
        )}
      </HudOrb>
      {/* Laid out whether or not it is open, hidden rather than unmounted. The
          right-hand column must reserve this card's height while it is closed
          (between lg and 1280px it starts closed), or opening the bank would
          shove the feed's composer from under the pointer. In the layout, its
          height is a measurement rather than a guess.

          `visibility: hidden`, not `display: none`, so it still has a height.
          While hidden it is out of the accessibility tree and tab order, it is
          absolutely positioned so it moves nothing, and its contents are
          memoised on their own socket slices. */}
      <div
        ref={cardRef}
        role="group"
        aria-label={title}
        // A measured cap beats `max-h-[60vh]` whenever something sits below.
        // It binds only on a window with no room for the feed's island (the
        // island yields first; see lib/hudChrome); the class is the fallback
        // before the dock is measured.
        style={{
          ...(maxH == null ? null : { maxHeight: maxH }),
          ...(open ? null : { visibility: "hidden" as const }),
        }}
        className={cn(
          GLASS,
          // Against the row, via the context above.
          "absolute top-full right-0 mt-2 z-10",
          "w-[264px] max-w-[calc(100vw-var(--hud-inset,0.5rem)*2)] p-2.5 text-[13px]",
          "overflow-y-auto no-scrollbar",
          maxH == null && "max-h-[60vh]",
          !open && "pointer-events-none",
        )}
      >
        {/* Its own box so the host can measure it: the card carries the cap
            and scroll, this carries the height. */}
        <div ref={contentRef} className="flex flex-col gap-2">
          {children}
        </div>
      </div>
    </>
  );
}
