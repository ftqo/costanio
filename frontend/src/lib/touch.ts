/**
 * Touch input primitives: what a coarse pointer has instead of hover.
 *
 * Without hover, the tooltips (`components/game/Tip`), the board's piece
 * readout (`components/game/PieceInfoCard`) and the legal-spot sweep
 * (`lib/board3d/markers`) are simply absent on a phone. The replacement:
 *
 *   Long press is the shortcut. It is hidden, so it must never be the only way
 *   to reach anything.
 *
 *   Tap is primary, but only where a tap means nothing else. Most taps here
 *   commit (build, play a card, move the robber), and overloading those loses
 *   a player pieces.
 *
 *   Explain mode (lib/explainMode) is the discoverable path: a visible orb
 *   turns every tap into a question while it is lit.
 *
 * Everything here is viewer-local and stateless.
 */
import * as React from "react";
import { useMediaQuery } from "./useMediaQuery";

/**
 * "This pointer cannot hover". `hover: none` rather than `pointer: coarse`: a
 * touchscreen laptop reports both pointer kinds and a stylus is fine but cannot
 * hover. Consumers want to know whether hover will ever fire.
 */
export const NO_HOVER_QUERY = "(hover: none)";

/** Whether the primary pointer can hover. See `NO_HOVER_QUERY`. */
export function useNoHover(): boolean {
  return useMediaQuery(NO_HOVER_QUERY);
}

/**
 * How long a press must be held to count as a long press. Below ~300ms a slow
 * tap fires it; above ~600ms it feels unresponsive. iOS fires its own text
 * callout at 500ms, so this lands first.
 */
export const LONG_PRESS_MS = 400;

/**
 * How far a finger may drift and still be pressing rather than dragging. The
 * board pans with the same finger; 10 layout px covers a still finger's jitter
 * and is well under a deliberate 400ms pan.
 */
export const LONG_PRESS_SLOP_PX = 10;

/**
 * A short buzz confirming the hold fired, since the panel may appear under the
 * player's thumb. Absent on desktop, on iOS (no Vibration API), and under
 * reduced motion.
 */
export function haptic(ms = 10): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // A vibrate that throws (permissions policy, an embedded webview) must not
    // break the gesture. The panel still opens.
  }
}

/** What `useLongPress` hands back to spread onto the trigger element. */
export type LongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.SyntheticEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};

/**
 * Press and hold, without the hold also doing what a tap does.
 *
 * A long press also produces a click on lift, which on a build control would
 * buy the thing the player held to ask about. So a press that fired swallows
 * the following click in the capture phase, before any handler below sees it.
 *
 * It cancels on drift past the slop (panning), early lift (a tap), or
 * `pointercancel` (a scroll gesture took the pointer).
 *
 * `onContextMenu` is prevented during the press because Android opens the
 * native context menu on this gesture.
 */
export function useLongPress(
  fire: () => void,
  opts: {
    /** Off entirely, e.g. on a pointer that can hover. */
    enabled?: boolean;
    /** Mouse presses too. Off by default: a mouse has hover and does not need a hold. */
    mouse?: boolean;
    delay?: number;
  } = {},
): { handlers: LongPressHandlers; pressing: boolean } {
  const { enabled = true, mouse = false, delay = LONG_PRESS_MS } = opts;
  const [pressing, setPressing] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const from = React.useRef<{ x: number; y: number } | null>(null);
  // Set when the timer fired; read and cleared by the following click. A ref,
  // because the click arrives in the same tick as the lift, before a re-render.
  const fired = React.useRef(false);
  // The live callback, so consumers need not memoise to avoid restarting the
  // timer.
  const fireRef = React.useRef(fire);
  fireRef.current = fire;

  const clear = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    from.current = null;
    setPressing(false);
  }, []);

  React.useEffect(() => clear, [clear]);

  const handlers = React.useMemo<LongPressHandlers>(
    () => ({
      onPointerDown: (e) => {
        if (!enabled) return;
        if (e.pointerType === "mouse" && !mouse) return;
        // Secondary buttons are a right-click, which has its own menu.
        if (e.button !== 0 && e.pointerType === "mouse") return;
        fired.current = false;
        from.current = { x: e.clientX, y: e.clientY };
        setPressing(true);
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          setPressing(false);
          haptic();
          fireRef.current();
        }, delay);
      },
      onPointerMove: (e) => {
        const start = from.current;
        if (!start || !timer.current) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (dx * dx + dy * dy > LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onContextMenu: (e) => {
        // Only while our press is live or has just fired; otherwise the
        // context menu is the browser's.
        if (timer.current || fired.current) e.preventDefault();
      },
      onClickCapture: (e) => {
        if (!fired.current) return;
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [enabled, mouse, delay, clear],
  );

  return { handlers, pressing };
}

/** What `useTapOnly` hands back to spread onto the control. */
export type TapOnlyHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onClickCapture: (e: React.MouseEvent) => void;
};

/**
 * A click that only counts if the pointer did not travel.
 *
 * A touch scroll usually, but not always, cancels the tap that started it.
 * These controls sit inside a horizontal scroller (the build shelf), and a
 * flick that starts and ends on the development-card tile while the shelf is
 * already at its end is a click to the browser, costing three resources.
 *
 * So if the pointer moved more than the slop between down and up, the click
 * is stopped in the capture phase. `pointercancel` counts as movement.
 *
 * Applies to every pointer type: a mouse drag is not a click either, and a
 * trackpad flick scrolls the same shelf.
 */
export function useTapOnly(slop = LONG_PRESS_SLOP_PX): TapOnlyHandlers {
  const from = React.useRef<{ x: number; y: number } | null>(null);
  const travelled = React.useRef(false);

  return React.useMemo<TapOnlyHandlers>(
    () => ({
      onPointerDown: (e) => {
        from.current = { x: e.clientX, y: e.clientY };
        travelled.current = false;
      },
      onPointerMove: (e) => {
        const start = from.current;
        if (!start || travelled.current) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (dx * dx + dy * dy > slop * slop) travelled.current = true;
      },
      onPointerCancel: () => {
        travelled.current = true;
      },
      onClickCapture: (e) => {
        if (!travelled.current) return;
        travelled.current = false;
        from.current = null;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [slop],
  );
}

/**
 * The CSS a long-press target needs. A held finger otherwise starts a text
 * selection or raises iOS's callout. `touch-none` is left out: it would stop
 * scrolling past the element, and the slop check already tells a scroll from
 * a press.
 */
export const LONG_PRESS_CSS = "select-none [-webkit-touch-callout:none]";
