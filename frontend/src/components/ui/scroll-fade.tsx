import * as React from "react";
import { useMeasure, SKIP } from "@/lib/measure";
import { cn } from "@/lib/utils";
import { CaretDown } from "@/lib/icons";

/** Which edges still have content past them. */
type Edges = { top: boolean; bottom: boolean; left: boolean; right: boolean };

/** A pure layout read with no state, safe to run in a batched read phase. */
function readEdges(el: HTMLElement): Edges {
  return {
    top: el.scrollTop > 4,
    bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
    left: el.scrollLeft > 4,
    right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
  };
}

function sameEdges(a: Edges, b: Edges): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

// ScrollFade wraps a scrolling region and fades each edge that still has
// content past it. Both axes are handled, so a box that scrolls either way (or
// switches axis across breakpoints) needs no configuration. The gradients are
// pointer-events-none and follow the scroll position.
//
// `className` styles the inner scroll container (it owns the overflow).
// `fadeFrom` is the Tailwind `from-*` colour to fade from; match the box's
// background. `wrapperClassName` styles the positioned outer wrapper.
//
// `scrollRef` and `onScroll` let a caller observe the scroll element (e.g. a
// stick-to-bottom hook). They compose with the internal edge tracking.
export function ScrollFade({
  className,
  wrapperClassName = "flex flex-col min-h-0 lg:flex-1",
  fadeFrom = "from-secondary-background",
  scrollRef,
  onScroll,
  scrollProps,
  arrows,
  vArrows,
  children,
}: {
  className?: string;
  wrapperClassName?: string;
  fadeFrom?: string;
  scrollRef?: React.Ref<HTMLDivElement>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  /**
   * ARIA and `role` for the scrolling box, not the wrapper. A live region on
   * the wrapper would also announce the gradient bars and nudge arrows as they
   * come and go. Only these are accepted; the box's ref, handler and classes
   * are owned here.
   */
  scrollProps?: React.AriaAttributes & { role?: string };
  /**
   * Show a nudge button on each horizontal edge that still has content.
   * Off by default. A sideways-scrolling box has no scrollbar (`no-scrollbar`)
   * and the mouse wheel has no horizontal axis, so it needs these.
   */
  arrows?: boolean;
  /**
   * The same nudge on the top and bottom edges, for a box that scrolls down
   * with its scrollbar hidden (the landscape-phone dock).
   *
   * A separate switch because the axis cannot be read off the element:
   * `overflow-x: auto` computes `overflow-y` to auto too, so the hand shelf
   * scrolls vertically by a few pixels of badge overhang.
   */
  vArrows?: boolean;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Point ScrollFade's own ref at the node and forward it to the caller's ref.
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      if (typeof scrollRef === "function") scrollRef(el);
      else if (scrollRef) scrollRef.current = el;
    },
    [scrollRef],
  );
  const [edges, setEdges] = React.useState<Edges>({
    top: false,
    bottom: false,
    left: false,
    right: false,
  });
  const apply = React.useCallback((next: Edges) => {
    setEdges((prev) => (sameEdges(prev, next) ? prev : next));
  }, []);
  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    apply(readEdges(el));
  }, [apply]);
  // Recompute after every render (contents change) and on resize; onScroll
  // covers the common case.
  React.useLayoutEffect(update);
  // Resize goes through the shared frame-coalesced scheduler rather than a
  // `resize` listener per instance. `equals` is false because scrolling writes
  // the same state outside the scheduler, so a cached value would go stale;
  // `apply` bails instead.
  useMeasure<Edges>({
    read: () => (ref.current ? readEdges(ref.current) : SKIP),
    write: apply,
    equals: () => false,
  });

  /**
   * A wheel over a sideways-scrolling box scrolls it sideways. A wheel only
   * has a vertical axis, and the game has no vertically scrollable ancestor to
   * spend it on.
   *
   * A native listener because React registers wheel handlers as passive, and a
   * passive listener cannot preventDefault.
   */
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Only for a box that scrolls sideways and not vertically, so the wheel
      // is not taken from the axis the player meant.
      if (el.scrollWidth <= el.clientWidth) return;
      if (el.scrollHeight > el.clientHeight) return;
      // Real sideways input (trackpad, tilt wheel) already works.
      if (e.deltaX !== 0) return;
      // deltaMode 1 counts lines, not pixels.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const before = el.scrollLeft;
      el.scrollLeft += dy;
      // Only claim the event if it moved, so at either end the wheel still
      // reaches whatever is underneath.
      if (el.scrollLeft !== before) e.preventDefault();
      update();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [update]);

  // Most of a page, leaving a card or two of overlap for context.
  const nudge = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };
  const nudgeV = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: "smooth" });
  };

  return (
    <div className={cn("relative", wrapperClassName)}>
      <div
        {...scrollProps}
        ref={setRef}
        onScroll={(e) => {
          update();
          onScroll?.(e);
        }}
        className={className}
      >
        {children}
      </div>
      <div
        data-ui-fade=""
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b to-transparent transition-opacity duration-150",
          fadeFrom,
          edges.top ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        data-ui-fade=""
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t to-transparent transition-opacity duration-150",
          fadeFrom,
          edges.bottom ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        data-ui-fade=""
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r to-transparent transition-opacity duration-150",
          fadeFrom,
          edges.left ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        data-ui-fade=""
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent transition-opacity duration-150",
          fadeFrom,
          edges.right ? "opacity-100" : "opacity-0",
        )}
      />
      {arrows &&
        (
          [
            ["left", edges.left, -1, "‹"],
            ["right", edges.right, 1, "›"],
          ] as const
        ).map(([side, on, dir, glyph]) =>
          on ? (
            <button
              key={side}
              type="button"
              // Not tabbable: tabbing through the cards already scrolls each into view.
              tabIndex={-1}
              aria-hidden
              onClick={() => nudge(dir)}
              // The HUD keeps its 2px edge and no lift (index.css, site-material block).
              data-ui-nudge=""
              className={cn(
                "absolute top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full",
                "border border-border bg-secondary-background shadow-hard-sm",
                "flex items-center justify-center text-[13px] font-extrabold leading-none",
                "cursor-pointer hover:bg-panel",
                side === "left" ? "left-0" : "right-0",
              )}
            >
              {glyph}
            </button>
          ) : null,
        )}
      {vArrows &&
        (
          [
            ["top", edges.top, -1],
            ["bottom", edges.bottom, 1],
          ] as const
        ).map(([side, on, dir]) =>
          on ? (
            // A 40px-tall hit area around a 24px pill.
            <button
              key={side}
              type="button"
              tabIndex={-1}
              aria-hidden
              data-scroll-nudge={side}
              onClick={() => nudgeV(dir)}
              className={cn(
                "absolute left-1/2 -translate-x-1/2 z-10 h-10 w-12 flex justify-center cursor-pointer",
                side === "top"
                  ? "top-0 -translate-y-1/2 items-center"
                  : "bottom-0 translate-y-1/2 items-center",
              )}
            >
              <span
                data-ui-nudge=""
                className="w-8 h-6 rounded-full border border-border bg-secondary-background shadow-hard-sm flex items-center justify-center text-[13px] font-extrabold leading-none hover:bg-panel"
              >
                {/* An icon, not a text caret: the modifier-letter carets sat
                    off-centre and too small to read. */}
                <CaretDown
                  weight="bold"
                  size={14}
                  className={side === "top" ? "rotate-180" : undefined}
                />
              </span>
            </button>
          ) : null,
        )}
    </div>
  );
}
