// Scroll offset that centres an item in a scroll container along one axis, or
// null when it is already as close to centred as it can get. Pass horizontal
// measurements for an x-scroller, vertical for a y-scroller.
//
//   current    the container's current scrollLeft / scrollTop
//   viewport   the container's clientWidth / clientHeight
//   itemStart  the item's leading edge relative to the container's visible origin
//              (itemRect.left - containerRect.left, or the top equivalent)
//   itemSize   the item's width / height
//   scrollSize the container's scrollWidth / scrollHeight, which caps how
//              far the last item can be pulled toward the middle
//
// Centring (rather than the minimal nudge into view) keeps the table visible on
// both sides of the active seat. Seats at either end settle short of the
// middle; `scrollSize` is a parameter so the caller can tell a real move from
// one the browser would clamp to a no-op.
export function scrollOffsetToCenter(
  current: number,
  viewport: number,
  itemStart: number,
  itemSize: number,
  scrollSize: number,
): number | null {
  // itemStart is relative to the visible origin, so the item's position within
  // the scrolled content is current + itemStart.
  const want = current + itemStart + itemSize / 2 - viewport / 2;
  const max = Math.max(0, scrollSize - viewport);
  const next = Math.round(Math.min(max, Math.max(0, want)));
  // Ignore sub-pixel moves: smooth scrolling leaves fractional offsets, and
  // re-firing on them would restart the animation each time the effect ran.
  return Math.abs(next - current) < 1 ? null : next;
}

// Scroll a player rail so the active player's `[data-seat]` card is centred.
// Only the rail's own scroll offset moves, and only on the axis that
// overflows: horizontal on the mobile strip, vertical on the desktop column.
// No-op if the card is missing or already centred. `behavior` is "auto" for
// callers honouring prefers-reduced-motion.
//
// `rail` must be the element that scrolls, not a wrapper: a non-scrolling
// parent reports no overflow and the call does nothing.
//
// Units: scroll offsets are layout pixels, but `getBoundingClientRect` is
// scaled by CSS `zoom`, which index.css applies to the root (0.75 on a
// landscape phone, up to 2 on a large display). Rect numbers are divided back
// into layout pixels by the rail's measured scale, as SeatRail does for height.
export function revealActiveCard(
  rail: HTMLElement,
  activeSeat: number,
  behavior: ScrollBehavior = "smooth",
): void {
  const card = rail.querySelector<HTMLElement>(`[data-seat="${activeSeat}"]`);
  if (!card) return;
  const c = rail.getBoundingClientRect();
  const a = card.getBoundingClientRect();
  // Each axis measures its own scale, falling back to 1 when there is nothing
  // to divide by (a zero-sized rail, or jsdom).
  const scaleX = rail.offsetWidth ? c.width / rail.offsetWidth : 1;
  const scaleY = rail.offsetHeight ? c.height / rail.offsetHeight : 1;
  const opts: ScrollToOptions = { behavior };
  if (rail.scrollWidth > rail.clientWidth + 1) {
    const left = scrollOffsetToCenter(
      rail.scrollLeft,
      rail.clientWidth,
      (a.left - c.left) / (scaleX || 1),
      a.width / (scaleX || 1),
      rail.scrollWidth,
    );
    if (left != null) opts.left = left;
  }
  if (rail.scrollHeight > rail.clientHeight + 1) {
    const top = scrollOffsetToCenter(
      rail.scrollTop,
      rail.clientHeight,
      (a.top - c.top) / (scaleY || 1),
      a.height / (scaleY || 1),
      rail.scrollHeight,
    );
    if (top != null) opts.top = top;
  }
  if (opts.left != null || opts.top != null) rail.scrollTo(opts);
}
