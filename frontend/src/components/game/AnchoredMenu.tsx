import * as React from "react";
import { createPortal } from "react-dom";
import { placeAbove, placeMenu, type Placement } from "@/lib/anchoredMenu";
import { zoomFactor, toLayoutPoint, toLayoutSize, layoutViewport } from "@/lib/zoom";
import { cn } from "@/lib/utils";

/**
 * A small menu pinned next to a point on screen. Not an `Overlay`, which is a
 * centred, dimmed modal for things that halt play; this is a quick choice about
 * the spot under the pointer, and the board stays visible.
 *
 * No backdrop. Dismissed by Escape, a press outside, or the caller acting on a
 * choice.
 */
export function AnchoredMenu({
  at,
  onClose,
  children,
  className,
  above,
  anchorY,
}: {
  at: { x: number; y: number };
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /**
   * Draw the menu above the point, centred on it, instead of beside it. For a
   * row of cards pointing at the spot. See `placeAbove`.
   */
  above?: boolean;
  /** How far down the box the anchor point falls; see `placeAbove`. */
  anchorY?: number;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  // Placed after mount, once its real size is known (the width depends on the
  // caller's labels). Rendered hidden for that frame so it never jumps.
  const [place, setPlace] = React.useState<Placement | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured in visual px and consumed as layout px, so all three inputs are
    // normalized together (see lib/zoom; Tip does the same). Without it the
    // menu lands `point * (zoom - 1)` away from the click on zoomed displays.
    const z = zoomFactor();
    const box = el.getBoundingClientRect();
    const pt = toLayoutPoint(at, z);
    const size = toLayoutSize(box, z);
    const vp = layoutViewport(z);
    setPlace(
      above ? { ...placeAbove(pt, size, vp, anchorY), side: "above" } : placeMenu(pt, size, vp),
    );
  }, [at, above, anchorY]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // `pointerdown`, not `click`: the board acts on pointerup, so a click
    // listener would let the dismissing press also place a piece underneath.
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  // Portalled to <body> so the dock's `overflow-x: auto` (which forces
  // overflow-y to clip) cannot cut it off, as with Tip.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-anchored-menu=""
      className={cn(
        "fixed z-45 rounded-[14px] border-2 border-border bg-secondary-background p-2",
        className,
      )}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        visibility: place ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
