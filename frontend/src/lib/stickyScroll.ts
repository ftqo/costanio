import * as React from "react";

/**
 * A scroll box that opens on the newest row and follows new ones until the
 * reader scrolls away. Used by the event log and the table chat, both written
 * oldest-first.
 *
 * 1. Follow while the reader is at the bottom.
 * 2. Stop following once they scroll up, and stay where they put it until they
 *    scroll back down.
 * 3. Open at the bottom. The feed's scroll element is created (dock panel) or
 *    un-hidden (island orb) by a press, at scrollTop 0, with no content change
 *    to react to.
 *
 * Rule 3 needs a visibility signal: a `display: none` box measures 0, so a
 * scrollTop write while hidden is lost and its height cannot tell hidden from
 * empty. The surface that owns visibility reports it (see `setVisible`).
 */

/**
 * How close to the bottom still counts as being at it, in pixels. Sub-pixel
 * layout and fractional device pixel ratios leave a box a pixel or two short.
 * A log row is about 15px, so this is under two rows.
 */
export const STICK_SLACK_PX = 24;

/** The three numbers stickiness is decided from. An element satisfies this. */
export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/**
 * Whether a box is at (or near enough to) its bottom to keep following. Pure so
 * it can be tested with numbers, since jsdom reports 0 for every height.
 *
 * A box with nothing to scroll (short content, or a hidden pane measuring 0)
 * reads as at the bottom.
 */
export function isAtBottom(m: ScrollMetrics, slack: number = STICK_SLACK_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= slack;
}

export type StickyScroll<T extends HTMLElement> = {
  /** Attach to the scrolling element. */
  ref: React.RefObject<T | null>;
  /** Attach to the same element's `onScroll`. */
  onScroll: React.UIEventHandler<T>;
  /**
   * Tell the hook whether this box is on screen, from a layout effect in the
   * surface that owns its visibility.
   *
   * Hidden (or never stated) to shown means the player opened it, and pins to
   * the bottom. Shown to hidden only records the fact, so nothing is written to
   * a box that cannot receive it. A layout effect, so the pin lands in the frame
   * the pane appears and the top of the log never flashes.
   */
  setVisible: (visible: boolean) => void;
};

/**
 * Keeps a scroll container pinned to the bottom (see the rules above).
 *
 * Pass the content (or its length) as `dep`; the pin runs in a layout effect
 * whenever it changes, before paint.
 *
 * The returned object is stable, so it can sit in an effect's dependency list.
 * The game view re-renders on every websocket frame, and a re-running
 * `setVisible` effect would re-pin a reader who had scrolled up.
 */
export function useStickyScroll<T extends HTMLElement>(dep: unknown): StickyScroll<T> {
  const ref = React.useRef<T>(null);
  const stuck = React.useRef(true);
  // `null` means no surface has said, which behaves as visible: the hook just
  // follows new content.
  const visible = React.useRef<boolean | null>(null);

  // Instant, never smooth: on a live feed an animated scroll would still be
  // moving when the next row lands, and on open there is no prior position to
  // animate from.
  const pin = React.useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // The box's size when last seen. A scroll event arriving with a different
  // size came from the reflow (the browser clamping or re-anchoring
  // scrollTop), not the reader.
  const size = React.useRef<{ w: number; h: number } | null>(null);
  const resized = React.useCallback((el: HTMLElement) => {
    const was = size.current;
    size.current = { w: el.clientWidth, h: el.clientHeight };
    return was !== null && (was.w !== el.clientWidth || was.h !== el.clientHeight);
  }, []);

  const onScroll = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (resized(el) && stuck.current) {
      pin();
      return;
    }
    stuck.current = isAtBottom(el);
  }, [pin, resized]);

  // 4. Stay at the bottom when the box changes size (window resize, rotation,
  //    HUD rescale). scrollTop stays put and the browser's reflow scroll event
  //    would otherwise read as the reader scrolling up. A follower re-pins on
  //    every size change.
  //
  //    Observed lazily from the pin, because the element mounts and unmounts
  //    with the pane.
  const observer = React.useRef<{ ro: ResizeObserver; el: Element } | null>(null);
  const observe = React.useCallback(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    if (observer.current?.el === el) return;
    observer.current?.ro.disconnect();
    const ro = new ResizeObserver(() => {
      const box = ref.current;
      if (!box) return;
      resized(box);
      if (stuck.current && visible.current !== false) pin();
    });
    ro.observe(el);
    observer.current = { ro, el };
  }, [pin, resized]);
  React.useEffect(() => () => observer.current?.ro.disconnect(), []);

  const setVisible = React.useCallback(
    (next: boolean) => {
      if (visible.current === next) return;
      visible.current = next;
      if (!next) return;
      // Opening resets the follow as well as the position; otherwise a reader
      // who scrolled up, closed and reopened would open at the bottom but not
      // follow.
      stuck.current = true;
      observe();
      pin();
    },
    [pin, observe],
  );

  React.useLayoutEffect(() => {
    observe();
    if (visible.current !== false && stuck.current) pin();
  }, [dep, pin, observe]);

  return React.useMemo(() => ({ ref, onScroll, setVisible }), [onScroll, setVisible]);
}
