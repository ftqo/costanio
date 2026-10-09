import * as React from "react";

// usePanZoom adds a zoom + pan camera to an SVG whose content lives inside a
// single <g transform={transform}>. The default (identity) transform shows the
// whole board, since the SVG's viewBox already frames it. Coordinates stay in
// the SVG's user space, so click handlers and getScreenCTM()-based hit-testing
// keep working; the wrapping <g> just scales/translates everything together.

export interface PanZoom {
  transform: string;
  scale: number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

// The board extent in SVG user space, the same rect as the <svg> viewBox, which
// frames the map at rest (k=1). Used to clamp panning so the camera never leaves
// the map.
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Opts {
  svgRef: React.RefObject<SVGSVGElement | null>;
  // Mouse buttons (PointerEvent.button) that start a pan-drag. Default: middle
  // only, so primary-click stays free for placement/painting. The left mouse
  // button (0) never pans; listing 0 only enables single-contact touch/pen panning.
  panButtons?: number[];
  // Map extent to keep framed. When set, pan is clamped so the transformed board
  // always covers the viewBox; when omitted, panning is unconstrained.
  bounds?: Bounds;
  min?: number;
  max?: number;
  // Scale to open at, and to return to on reset. Defaults to 1, the resting
  // frame the viewBox describes. Clamped into [min, max].
  initial?: number;
}

const ZOOM_STEP = 1.25;

// How far the map builder may zoom out past the resting frame, to see edge hexes
// and whole coastlines. Four ZOOM_STEPs out (1.25^-4 ≈ 0.41).
export const BUILDER_MIN_ZOOM = 0.41;

// Design mode opens one step out so harbors outside the land (which the viewBox
// ignores) are on screen.
export const BUILDER_DESIGN_ZOOM = 0.8;

// panStarts reports whether a pointerdown should begin a pan-drag. The left
// mouse button never pans; touch and pen pan with their primary contact
// (button 0); other mouse buttons pan per panButtons.
export function panStarts(
  pointerType: string,
  button: number,
  panButtons: readonly number[],
): boolean {
  if (pointerType === "mouse" && button === 0) return false;
  return panButtons.includes(button);
}

// Clamp a camera offset (x,y) so the board, drawn at scale k, still covers the
// viewBox window. A content point c renders at (offset + k·c); for the span
// [B, B+W] to cover the window [B, B+W], offset must be in [(1-k)(B+W), (1-k)B].
// At k=1 that collapses to {0}.
//
// Below k=1 the interval inverts, so the board is centered at (1-k)(B + W/2).
export function clampPan(
  bounds: Bounds | undefined,
  k: number,
  x: number,
  y: number,
): { x: number; y: number } {
  if (!bounds) return { x, y };
  const fit = (lo: number, hi: number, v: number) =>
    // `+ 0` collapses -0 (e.g. (1-1)*-100) to 0, so the transform reads "0.00".
    (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v))) + 0;
  return {
    x: fit((1 - k) * (bounds.x + bounds.w), (1 - k) * bounds.x, x),
    y: fit((1 - k) * (bounds.y + bounds.h), (1 - k) * bounds.y, y),
  };
}

export function usePanZoom({
  svgRef,
  panButtons = [1],
  bounds,
  min = 1,
  max = 6,
  initial = 1,
}: Opts): PanZoom {
  const rest = Math.min(max, Math.max(min, initial));
  const [cam, setCam] = React.useState({ k: rest, x: 0, y: 0 });
  // Mirror svgRef.current into state so effects re-run when the <svg> mounts
  // (it may render after the hook's first run, e.g. behind an auth guard).
  const [svgEl, setSvgEl] = React.useState<SVGSVGElement | null>(null);
  // No deps: a ref's `.current` isn't reactive, so check after every render;
  // the inequality guard stops the setState from looping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (svgRef.current !== svgEl) setSvgEl(svgRef.current);
  });
  const drag = React.useRef<{ id: number; lastX: number; lastY: number } | null>(null);
  const clamp = React.useCallback((k: number) => Math.min(max, Math.max(min, k)), [min, max]);
  const clampCam = React.useCallback(
    (k: number, x: number, y: number) => clampPan(bounds, k, x, y),
    [bounds],
  );

  // Screen point → SVG user-space point (pre-camera-transform), via the SVG's
  // own CTM, which excludes the wrapping <g>.
  const toUser = React.useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return null;
      const p = svg.createSVGPoint();
      p.x = clientX;
      p.y = clientY;
      const u = p.matrixTransform(ctm.inverse());
      return { x: u.x, y: u.y, sx: ctm.a, sy: ctm.d };
    },
    [svgRef],
  );

  // Zoom by `factor` while keeping the user-space point (ux,uy) fixed on screen.
  const zoomAbout = React.useCallback(
    (factor: number, ux: number, uy: number) => {
      setCam((c) => {
        const k = clamp(c.k * factor);
        if (k === c.k) return c;
        const ratio = k / c.k;
        // Keep the cursor's point fixed, then clamp so the camera can't expose
        // dead space past the map edge (at k=min this snaps back to center).
        const p = clampCam(k, ux - ratio * (ux - c.x), uy - ratio * (uy - c.y));
        return { k, x: p.x, y: p.y };
      });
    },
    [clamp, clampCam],
  );

  // Zoom about the SVG's center (for the on-screen +/- buttons).
  const zoomCenter = React.useCallback(
    (factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const u = toUser(r.left + r.width / 2, r.top + r.height / 2);
      if (u) zoomAbout(factor, u.x, u.y);
    },
    [svgRef, toUser, zoomAbout],
  );

  // Native, non-passive wheel listener so we can preventDefault (stop the page
  // from scrolling while the cursor zooms the board).
  React.useEffect(() => {
    const svg = svgEl;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const u = toUser(e.clientX, e.clientY);
      if (!u) return;
      zoomAbout(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, u.x, u.y);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, [svgEl, toUser, zoomAbout]);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (!panStarts(e.pointerType, e.button, panButtons)) return;
      drag.current = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      svgRef.current?.setPointerCapture(e.pointerId);
    },
    [panButtons, svgRef],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const u = toUser(0, 0);
      const sx = u?.sx || 1;
      const sy = u?.sy || 1;
      const dx = (e.clientX - d.lastX) / sx;
      const dy = (e.clientY - d.lastY) / sy;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setCam((c) => ({ ...c, ...clampCam(c.k, c.x + dx, c.y + dy) }));
    },
    [toUser, clampCam],
  );

  const endDrag = React.useCallback(
    (e: React.PointerEvent) => {
      if (drag.current?.id === e.pointerId) {
        svgRef.current?.releasePointerCapture?.(e.pointerId);
        drag.current = null;
      }
    },
    [svgRef],
  );

  return {
    transform: `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.k.toFixed(3)})`,
    scale: cam.k,
    zoomIn: () => zoomCenter(ZOOM_STEP),
    zoomOut: () => zoomCenter(1 / ZOOM_STEP),
    reset: () => setCam({ k: rest, x: 0, y: 0 }),
    bind: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}
