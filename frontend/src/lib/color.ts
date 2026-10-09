// Perceptual color distance, ported from the backend (cosmetics/ciede2000.go +
// cosmetics/color.go) so the client disables the same "too close to another
// player" picks the server would reject.

import { resolveCssColorToHex } from "./colorResolve";

// Minimum CIEDE2000 distance two players' colors must keep in the same game.
// Mirrors cosmetics.ColorThreshold.
export const COLOR_THRESHOLD = 12.0;

type Lab = [number, number, number];

// hexToLab converts "#rrggbb" (or "rrggbb") sRGB to CIE L*a*b* (D65).
function hexToLab(hex: string): Lab {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // sRGB -> linear.
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const rl = lin(r),
    gl = lin(g),
    bl = lin(b);
  // linear sRGB -> XYZ (D65).
  const x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
  // XYZ -> Lab, D65 reference white.
  const xn = 0.95047,
    yn = 1.0,
    zn = 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : t * (841 / 108) + 4 / 29);
  const fx = f(x / xn),
    fy = f(y / yn),
    fz = f(z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// deltaE2000 is the CIE ΔE 2000 perceptual distance between two L*a*b* colors.
function deltaE2000(lab1: Lab, lab2: Lab): number {
  const d2r = Math.PI / 180;
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const p7 = (x: number) => Math.pow(x, 7);
  const g = 0.5 * (1 - Math.sqrt(p7(avgC) / (p7(avgC) + p7(25))));

  const a1p = a1 * (1 + g);
  const a2p = a2 * (1 + g);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const hp = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0;
    let h = (Math.atan2(b, ap) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  };
  const h1p = hp(b1, a1p);
  const h2p = hp(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * d2r);

  const avgLp = (L1 + L2) / 2;
  const avgCp = (C1p + C2p) / 2;
  let avghp: number;
  if (C1p * C2p === 0) avghp = h1p + h2p;
  else if (Math.abs(h1p - h2p) > 180) avghp = (h1p + h2p + 360) / 2;
  else avghp = (h1p + h2p) / 2;

  const T =
    1 -
    0.17 * Math.cos((avghp - 30) * d2r) +
    0.24 * Math.cos(2 * avghp * d2r) +
    0.32 * Math.cos((3 * avghp + 6) * d2r) -
    0.2 * Math.cos((4 * avghp - 63) * d2r);
  const dTheta = 30 * Math.exp(-Math.pow((avghp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(p7(avgCp) / (p7(avgCp) + p7(25)));
  const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(2 * dTheta * d2r) * Rc;

  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  );
}

// tooSimilar reports whether cand is perceptually within COLOR_THRESHOLD of any
// color in others, i.e. a pick the server would reject as "too close". Mirrors
// the negation of cosmetics.AllowedColor.
export function tooSimilar(cand: string, others: string[]): boolean {
  const candLab = hexToLab(cand);
  return others.some((o) => deltaE2000(candLab, hexToLab(o)) < COLOR_THRESHOLD);
}

// --- Seat tone derivation -------------------------------------------------
// A recolorable piece's body takes the seat color (`--seat-color`). From it we
// derive a darker `shade` for depth and a `detail` accent for small parts
// (doors, windows, road end posts).
//
// All three tones share the hue so a piece reads as one object in one
// player's color. Both derived tones are moves along HSL lightness, so the hue
// survives any input: the ten presets, a custom hex, or the CVD palette. (A
// fixed near-black/near-white detail read as a sticker on the 3D pieces.)

export interface SeatTones {
  shade: string;
  detail: string;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

// --- Legibility on a seat color -------------------------------------------
// Seat colors span yellow through navy and may be an arbitrary hex, so text on
// them must derive its foreground.
//
// The two constants are the ends of the theme's text scale. `--color-ink` and
// `--main-foreground` are defined in `:root` and not redefined under `.dark`
// (see index.css), so one computed answer serves both themes; the tests
// assert that.

const INK = "#1c2b4a"; // --color-ink
const PAPER = "#ffffff"; // --main-foreground

/**
 * WCAG 2 contrast floor for this app's tinted buttons. 4.5, not 3.0: they
 * render at `size="sm"` (13px), under the 18.66px-bold large-text cutoff.
 */
export const AA_CONTRAST = 4.5;

/** WCAG relative luminance of an #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two #rrggbb colors, in [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A background and the text color that is readable on it. */
export interface LegibleFill {
  /** The (possibly adjusted) background hex. */
  bg: string;
  /** Which end of the text scale to use. */
  fg: "ink" | "paper";
}

/** How far one lightness step moves when a fill has to be nudged. */
const NUDGE_STEP = 0.01;

/**
 * Pick a readable foreground for `hex`, darkening or lightening the fill itself
 * if neither end of the text scale clears `target` on its own.
 *
 * A mid-luminance fill (the purple and brown seats, the colorblind vermillion)
 * tops out near 4.0 with either. Those move along HSL lightness, away from the
 * chosen text color, until they clear; hue and saturation stay, as in
 * `deriveSeatTones`.
 */
export function legibleOn(hex: string, target = AA_CONTRAST): LegibleFill {
  const inkFirst = contrastRatio(hex, INK) >= contrastRatio(hex, PAPER);
  const fg: "ink" | "paper" = inkFirst ? "ink" : "paper";
  const text = inkFirst ? INK : PAPER;
  if (contrastRatio(hex, text) >= target) return { bg: hex, fg };

  // Short of the floor: walk away from the text color (ink wants a lighter
  // fill, paper a darker one). Bounded by the steps to the end of the scale;
  // both ends reach 21, so the target is always reachable.
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const dir = inkFirst ? 1 : -1;
  let best = hex;
  for (let i = 1; i <= Math.ceil(1 / NUDGE_STEP); i++) {
    const nl = Math.min(1, Math.max(0, l + dir * i * NUDGE_STEP));
    const [nr, ng, nb] = hslToRgb(h, s, nl);
    best = rgbToHex(nr, ng, nb);
    if (contrastRatio(best, text) >= target) break;
    if (nl === 0 || nl === 1) break;
  }
  return { bg: best, fg };
}

/**
 * Inline style for a surface filled with an arbitrary seat/resource color.
 *
 * Accepts any CSS color the app uses (presets arrive as `var(--color-red)`)
 * and returns a background plus a token-valued text color, so callers never
 * hardcode a foreground over a fill they do not control.
 */
export function seatSurface(color: string): { background: string; color: string } {
  const { bg, fg } = legibleOn(resolveCssColorToHex(color));
  return {
    background: bg,
    color: fg === "ink" ? "var(--color-ink)" : "var(--color-main-foreground)",
  };
}

/** How far `detail` moves along HSL lightness, away from the body. */
const DETAIL_STEP = 0.3;

/** Below this body lightness `detail` lightens instead of darkening. */
const DETAIL_FLIP = 0.4;

export function deriveSeatTones(hex: string): SeatTones {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);

  // A grey body has no hue (rgbToHsl reports h=0, red), so saturating it would
  // tint it pink. Only push saturation on a body that has some.
  const sat = (delta: number) => (s === 0 ? 0 : Math.min(1, Math.max(0, s + delta)));

  // Depth: nudge saturation up and lightness down, clamped to [0.10, 0.80] so a
  // near-black body still gets a lighter facet and a near-white body darkens.
  const ll = Math.min(0.8, Math.max(0.1, l - 0.16));
  const [sr, sg, sb] = hslToRgb(h, sat(0.06), ll);
  const shade = rgbToHex(sr, sg, sb);

  // Accent: the same hue, DETAIL_STEP away in lightness, darker unless the body
  // has no room. Darkening is the default because a lightened accent on a
  // low-saturation body (brown, slate) washes out toward white, while darkened
  // it reads as stained wood. Only bodies short of headroom (saturated or
  // near-black) lighten, where a tint keeps its hue.
  //
  // The result lands in [0.14, 0.70]: never ink, never paper.
  const darker = l >= DETAIL_FLIP;
  const dl = darker ? Math.max(0.14, l - DETAIL_STEP) : l + DETAIL_STEP;
  // Darker deepens like `shade`; lighter is a tint and eases saturation so a
  // dark saturated body does not get a neon accent.
  const [dr, dg, db] = hslToRgb(h, darker ? sat(0.06) : s * 0.82, dl);
  const detail = rgbToHex(dr, dg, db);

  return { shade, detail };
}
