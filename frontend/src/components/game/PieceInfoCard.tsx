import * as React from "react";
import { createPortal } from "react-dom";
import { placeMenu, type Placement } from "@/lib/anchoredMenu";
import { zoomFactor, toLayoutPoint, toLayoutSize, layoutViewport } from "@/lib/zoom";
import type { PieceInfo } from "@/lib/boardInfo";
import { cn } from "@/lib/utils";

/**
 * What the pointer is resting on, named.
 *
 * AnchoredMenu's read-only twin: same placement maths, portal and box, so the
 * two arrive the same way at the same anchor. Differences: `pointer-events-none`
 * (it must not steal the click meant for the piece, or flicker), no Escape or
 * outside-press handling (it goes when the pointer moves off), and
 * `role="status"` with `aria-live` off, since announcing every hover would be
 * noise.
 */
export function PieceInfoCard({
  info,
  at,
  ownerName,
  ownerColor,
  className,
}: {
  info: PieceInfo;
  at: { x: number; y: number };
  /** Resolved by the caller: this component does not know what a seat is. */
  ownerName?: string;
  ownerColor?: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = React.useState<Placement | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured in visual px, consumed as layout px; see lib/zoom and
    // AnchoredMenu.
    const z = zoomFactor();
    const box = el.getBoundingClientRect();
    setPlace(placeMenu(toLayoutPoint(at, z), toLayoutSize(box, z), layoutViewport(z)));
    // `info.title` is in the deps because a card that changes what it describes
    // changes size and must be re-placed.
  }, [at, info.title]);

  return createPortal(
    <div
      ref={ref}
      role="status"
      data-piece-info=""
      className={cn(
        "fixed z-45 pointer-events-none select-none max-w-60",
        "rounded-[14px] border-2 border-border bg-secondary-background px-3 py-2",
        className,
      )}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        // Hidden for the one frame before it is measured, as in AnchoredMenu.
        visibility: place ? "visible" : "hidden",
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-extrabold">{info.title}</span>
        {ownerName && (
          <span className="text-[12px] font-extrabold" style={{ color: ownerColor }}>
            {ownerName}
          </span>
        )}
      </div>
      {info.facts.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {info.facts.map((f) => (
            <li key={f} className="text-[11px] font-bold text-muted leading-snug">
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
