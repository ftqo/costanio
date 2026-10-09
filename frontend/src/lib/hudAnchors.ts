// Where the chrome currently is.
//
// A card flying from a hex lands on a HUD element: a seat coin, one of your
// hand cards, the bank's counts. None has a fixed position (the coin column
// becomes a strip below `lg`, the shelf reflows, the bank strip's width depends
// on the ruleset), so the element is asked where it is when the card needs it.
//
// A registry rather than refs threaded through props: the three publishers and
// the one consumer are far apart in the tree, and registration writes into a
// Map without touching state, so nothing re-renders.
import * as React from "react";
import type { CardFace, Endpoint, ScreenPoint } from "@/lib/board3d/cardflight";

export interface HudAnchors {
  /**
   * A callback ref that files `el` under `id`.
   *
   * Memoised per id: a fresh function each render makes React detach and
   * re-attach the ref, leaving the registry empty during exactly the re-render
   * that starts a flight.
   */
  ref(id: string): (el: HTMLElement | null) => void;
  /** The element filed under `id`, or null if nothing has claimed it. */
  el(id: string): HTMLElement | null;
}

export function createHudAnchors(): HudAnchors {
  const els = new Map<string, HTMLElement>();
  const refs = new Map<string, (el: HTMLElement | null) => void>();
  return {
    ref(id) {
      let cb = refs.get(id);
      if (!cb) {
        cb = (el: HTMLElement | null) => {
          if (el) els.set(id, el);
          else els.delete(id);
        };
        refs.set(id, cb);
      }
      return cb;
    },
    el(id) {
      return els.get(id) ?? null;
    },
  };
}

/** One registry for the life of the component that owns it. */
export function useHudAnchors(): HudAnchors {
  const ref = React.useRef<HudAnchors | null>(null);
  ref.current ??= createHudAnchors();
  return ref.current;
}

/** The anchor a viewer's own card lands on, by what is drawn on it. */
export function handAnchorId(face: CardFace): string {
  switch (face.k) {
    case "res":
      return `hand:res:${face.idx}`;
    case "com":
      return `hand:com:${face.idx}`;
    case "dev":
    case "progress":
      return "hand:dev";
    default:
      return "hand";
  }
}

/**
 * The anchor an endpoint resolves to, or null when it is not a piece of chrome.
 *
 * A hex returns null: it is a world position for the camera, not the DOM. The
 * viewer's own seat resolves to the specific hand card the resource lands in,
 * since that is the pile that changes.
 */
export function anchorIdFor(e: Endpoint, viewer: number, face: CardFace): string | null {
  switch (e.k) {
    case "hex":
      return null;
    case "seat":
      return e.seat === viewer ? handAnchorId(face) : `seat:${e.seat}`;
    case "bank":
    case "deck":
      // The dev deck has no permanent home on screen (it is inside the usually
      // closed build shelf), so it resolves to the bank strip, "the supply".
      return "bank";
  }
}

/**
 * Where to fly from or to when the anchor is not on screen.
 *
 * Not a failure path: the hand shelf is absent for a spectator, the bank strip
 * can be switched off, and a seat coin can be scrolled out of view. Flying to
 * the nearest screen edge reads as "off that way", better than no flight.
 */
export function fallbackPoint(id: string): ScreenPoint {
  if (id.startsWith("hand")) return { fx: 0.5, fy: 0.95 };
  if (id.startsWith("seat")) return { fx: 0.04, fy: 0.5 };
  // bank / deck: the counts strip, centred above the hand shelf.
  return { fx: 0.5, fy: 0.86 };
}

/**
 * An element's centre as a fraction of `within`'s box.
 *
 * Fractions, not pixels: above 1700px index.css zooms the UI, and a rect is
 * reported in zoomed pixels while `style.left` is read as unzoomed. Dividing
 * one rect by another cancels the factor.
 */
export function centerWithin(el: DOMRect, within: DOMRect): ScreenPoint {
  if (!(within.width > 0) || !(within.height > 0)) return { fx: 0.5, fy: 0.5 };
  return {
    fx: (el.left + el.width / 2 - within.left) / within.width,
    fy: (el.top + el.height / 2 - within.top) / within.height,
  };
}
