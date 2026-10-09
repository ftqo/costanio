// Resolve any CSS color string (a `var(--color-*)`, a named color, or a hex) to
// a concrete #rrggbb. Seat colors arrive as CSS variables but tone derivation
// needs channels, so each unique string is resolved once via a hidden probe
// and memoized.

const cache = new Map<string, string>();
let probe: HTMLElement | null = null;

function rgbToHex(rgb: string): string | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb);
  if (!m) return null;
  const c = (n: string) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, "0");
  return `#${c(m[1])}${c(m[2])}${c(m[3])}`;
}

export function resolveCssColorToHex(color: string): string {
  const hit = cache.get(color);
  if (hit) return hit;
  if (typeof document === "undefined") return color;
  if (!probe) {
    probe = document.createElement("span");
    probe.style.cssText = "display:none;position:absolute";
    document.body.appendChild(probe);
  }
  probe.style.color = "";
  probe.style.color = color;
  const resolved =
    rgbToHex(getComputedStyle(probe).color) ?? (/^#[0-9a-f]{6}$/i.test(color) ? color : "#888888");
  cache.set(color, resolved);
  return resolved;
}
