// Two coordinate spaces.
//
// Wide displays scale the UI with `html { zoom }` (see index.css). Zoom
// multiplies a fixed element's `left: 800px` before it reaches the screen,
// while pointer events and getBoundingClientRect report visual pixels,
// already scaled. Writing a visual coordinate straight into `style.left`
// scales it twice: an error of `point * (zoom - 1)`, zero at the top-left and
// hundreds of pixels across a 4K screen.
//
// So do the arithmetic in layout px: divide measured values by the zoom and
// let the browser scale `style` back. A no-op at zoom 1 (every display under
// 1700px).

/** The zoom factor in force, or 1 where the browser does not report one. */
export function zoomFactor(el: Element = document.documentElement): number {
  const raw = parseFloat(getComputedStyle(el).zoom);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** A visual-space point in layout px. */
export function toLayoutPoint(p: { x: number; y: number }, zoom: number): { x: number; y: number } {
  return { x: p.x / zoom, y: p.y / zoom };
}

/** A visual-space size in layout px. */
export function toLayoutSize(
  s: { width: number; height: number },
  zoom: number,
): { width: number; height: number } {
  return { width: s.width / zoom, height: s.height / zoom };
}

/**
 * The viewport in layout px. `innerWidth`/`innerHeight` are visual, so
 * clamping a layout-px box against them lets it overhang the edge by the zoom
 * factor.
 */
export function layoutViewport(zoom: number): { width: number; height: number } {
  return { width: window.innerWidth / zoom, height: window.innerHeight / zoom };
}
