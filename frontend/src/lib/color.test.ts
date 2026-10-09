import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tooSimilar, deriveSeatTones, contrastRatio, legibleOn, AA_CONTRAST } from "./color";
import { SEAT_COLORS } from "./hexgeo";
import { CB_PALETTES, CB_MODES } from "./colorblind";

/** Every color any colorblind mode can paint a seat. */
const CB_ALL = CB_MODES.flatMap((m) => [...CB_PALETTES[m]]);
import { RES, COMMOD } from "./cardFace";

// The 10 free presets (cosmetics/color.go freeColors). The backend asserts they
// are mutually ≥ ColorThreshold apart, so none should read as "too similar".
const FREE = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#ffaa00",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#aa00ff",
  "#ff00ff",
];

test("tooSimilar: free presets are mutually distinct", () => {
  for (let i = 0; i < FREE.length; i++) {
    const others = FREE.filter((_, j) => j !== i);
    expect(tooSimilar(FREE[i], others)).toBe(false);
  }
});

test("tooSimilar: near-twin reds clash", () => {
  expect(tooSimilar("#ff0000", ["#ee0000"])).toBe(true);
  expect(tooSimilar("#ff0000", ["#ff0000"])).toBe(true); // exact match
});

test("tooSimilar: distinct hues do not clash", () => {
  expect(tooSimilar("#ff0000", ["#0000ff"])).toBe(false);
  expect(tooSimilar("#00ff00", ["#ff00ff"])).toBe(false);
});

test("tooSimilar: empty others always allows", () => {
  expect(tooSimilar("#ff0000", [])).toBe(false);
});

// Relative luminance (sRGB) for ordering assertions in tests.
function lum(hex: string): number {
  const h = hex.slice(1);
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = ch.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("deriveSeatTones: shade is darker than a mid/bright body", () => {
  const { shade } = deriveSeatTones("#ff4f64"); // preset red
  expect(lum(shade)).toBeLessThan(lum("#ff4f64"));
});

test("deriveSeatTones: near-black body gets a lighter shade", () => {
  const { shade } = deriveSeatTones("#000000");
  expect(shade).not.toBe("#000000");
  expect(lum(shade)).toBeGreaterThan(lum("#000000"));
});

test("deriveSeatTones: near-white body still darkens for depth", () => {
  const { shade } = deriveSeatTones("#ffffff");
  expect(lum(shade)).toBeLessThan(lum("#ffffff"));
});

test("deriveSeatTones: detail steps toward the side with room", () => {
  expect(lum(deriveSeatTones("#ffffff").detail)).toBeLessThan(lum("#ffffff"));
  expect(lum(deriveSeatTones("#000000").detail)).toBeGreaterThan(lum("#000000"));
});

test("deriveSeatTones: accepts 3-digit hex", () => {
  expect(deriveSeatTones("#fff")).toEqual(deriveSeatTones("#ffffff"));
});

// --- the seat inputs the tones actually have to survive ---------------------
// Everything that can reach deriveSeatTones: the ten defaults (lib/hexgeo
// SEAT_COLORS, resolved from index.css), the CVD palettes (lib/colorblind), the
// free custom presets (FREE above, including pure black and white), and some
// awkward custom picks.
const DEFAULT_SEATS = [
  "#ff4f64", // red
  "#3d8bff", // blue
  "#ffb02e", // amber
  "#8c6fd1", // purple
  "#2fa45c", // green
  "#ff8a4a", // orange
  "#2bb3b3", // fishermen teal
  "#f06fae", // rose
  "#a07850", // caravans brown
  "#5b7494", // slate
];

// Tracks the real palettes, since anything a mode can paint must survive tone
// derivation.
const CVD_SEATS = CB_ALL;

const CUSTOM_EDGE_CASES = [
  "#fff2b0", // pale yellow: light enough that a lighter accent would vanish
  "#101a33", // near-black navy: dark enough that a darker accent would vanish
  "#808080", // achromatic mid grey
  "#00ff00", // fully saturated primary
  "#7f8080", // HSL lightness sitting on the direction boundary
];

const ALL_SEATS = [...DEFAULT_SEATS, ...CVD_SEATS, ...FREE, ...CUSTOM_EDGE_CASES];

// HSL lightness, (max+min)/2: the axis deriveSeatTones moves along and its
// guarantees are stated in. `lum` is perceptual and the wrong ruler here.
function hslL(hex: string): number {
  const h = hex.slice(1);
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return (Math.max(...ch) + Math.min(...ch)) / 2;
}

/** Hue in turns, or null for an achromatic color (which has none). */
function hue(hex: string): number | null {
  const h = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  let x: number;
  if (max === r) x = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) x = (b - r) / d + 2;
  else x = (r - g) / d + 4;
  return x / 6;
}

// `detail` must not be a near-black or near-white accent stamped on a colored
// piece (the old #1c2b4a / #eef2f8 flip).
test("deriveSeatTones: detail is never near-black or near-white ink", () => {
  for (const seat of ALL_SEATS) {
    const { detail } = deriveSeatTones(seat);
    const l = hslL(detail);
    // The guaranteed range: [0.14, 0.70], loosened a hair for 8-bit rounding.
    expect(l, `${seat} -> ${detail}`).toBeGreaterThanOrEqual(0.13);
    expect(l, `${seat} -> ${detail}`).toBeLessThanOrEqual(0.71);
  }
});

test("deriveSeatTones: every tone keeps the seat's hue", () => {
  for (const seat of ALL_SEATS) {
    const h = hue(seat);
    if (h === null) continue; // a grey seat has no hue to keep
    const { shade, detail } = deriveSeatTones(seat);
    for (const [name, tone] of [
      ["shade", shade],
      ["detail", detail],
    ] as const) {
      const th = hue(tone);
      expect(th, `${seat} ${name} -> ${tone}`).not.toBeNull();
      // Circular distance in turns. 8-bit rounding moves the hue slightly; past
      // this it is a different color.
      const d = Math.abs((th as number) - h);
      expect(Math.min(d, 1 - d), `${seat} ${name} -> ${tone}`).toBeLessThan(0.02);
    }
  }
});

test("deriveSeatTones: an achromatic seat stays achromatic", () => {
  // rgbToHsl reports hue 0 (red) for a grey, so a naive saturation bump tints
  // it pink (#ffffff once shaded to #cfc9c9).
  for (const seat of ["#000000", "#808080", "#999999", "#ffffff"]) {
    const { shade, detail } = deriveSeatTones(seat);
    expect(hue(shade), `${seat} shade -> ${shade}`).toBeNull();
    expect(hue(detail), `${seat} detail -> ${detail}`).toBeNull();
  }
});

test("deriveSeatTones: detail separates from both the body and the shade", () => {
  for (const seat of ALL_SEATS) {
    const { shade, detail } = deriveSeatTones(seat);
    expect(Math.abs(hslL(detail) - hslL(seat)), `${seat} vs body`).toBeGreaterThanOrEqual(0.25);
    expect(Math.abs(hslL(detail) - hslL(shade)), `${seat} vs shade`).toBeGreaterThanOrEqual(0.09);
  }
});

test("deriveSeatTones: a light body ramps body -> shade -> detail", () => {
  // All three step the same way, so a settlement reads as wall, roof, door.
  for (const seat of ALL_SEATS.filter((c) => hslL(c) >= 0.5)) {
    const { shade, detail } = deriveSeatTones(seat);
    expect(hslL(shade), seat).toBeLessThan(hslL(seat));
    expect(hslL(detail), seat).toBeLessThan(hslL(shade));
  }
});

test("deriveSeatTones: is a pure function of the resolved hex", () => {
  // Colorblind mode and custom colors arrive as different strings; tint.ts
  // memoizes per string and clears on a CVD toggle, so this must be stateless.
  for (const seat of ALL_SEATS) {
    expect(deriveSeatTones(seat)).toEqual(deriveSeatTones(seat));
  }
});

// --- Legibility ------------------------------------------------------------
// The seat and resource palettes are read from index.css, so a palette change
// fails these tests rather than drifting past a stale copy.

const CSS = readFileSync(join(__dirname, "..", "index.css"), "utf-8");

function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(CSS);
  if (!m) throw new Error(`--color-${name} not found in index.css`);
  return m[1];
}

/** The seat presets, resolved from the var() names in SEAT_COLORS. */
const SEAT_HEXES = SEAT_COLORS.map((c) => token(/--color-([a-z]+)/.exec(c)![1]));
/** Resource + commodity fills, which take text on the trade overlays. */
const CARD_HEXES = [...RES, ...COMMOD].map((r) =>
  token(/--color-([a-z]+)/.exec(r.color)?.[1] ?? ""),
);

const INK = token("ink");

test("contrastRatio matches the WCAG endpoints", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  // Order does not matter.
  expect(contrastRatio("#ff0000", "#00ff00")).toBeCloseTo(contrastRatio("#00ff00", "#ff0000"), 10);
});

test("the theme's text tokens are theme-independent", () => {
  // legibleOn returns one answer for both themes, which holds only while both
  // ends of the text scale are defined in :root and not overridden in .dark.
  const dark = /^\.dark\s*\{([^}]*)\}/m.exec(CSS)?.[1] ?? "";
  expect(dark).not.toMatch(/--main-foreground:/);
  expect(dark).not.toMatch(/--color-ink:/);
});

test("legibleOn clears AA for every seat, colorblind and resource color", () => {
  const fail: string[] = [];
  for (const hex of [...SEAT_HEXES, ...CB_ALL, ...CARD_HEXES]) {
    const { bg, fg } = legibleOn(hex);
    const text = fg === "ink" ? INK : "#ffffff";
    const ratio = contrastRatio(bg, text);
    if (ratio < AA_CONTRAST) fail.push(`${hex} -> ${bg} on ${fg} = ${ratio.toFixed(2)}`);
  }
  expect(fail, fail.join("\n")).toEqual([]);
});

test("the unfixed palette fails contrast", () => {
  // Guards the guard: white on amber was the reported bug, at 1.83:1.
  expect(contrastRatio(token("amber"), "#ffffff")).toBeLessThan(2);
  const broken = [...SEAT_HEXES, ...CB_ALL].filter(
    (h) => contrastRatio(h, "#ffffff") < AA_CONTRAST,
  );
  expect(broken.length).toBeGreaterThan(10);
});

test("legibleOn leaves a fill alone when a text swap is enough", () => {
  // Amber is bright: ink on it is 7.7:1, so the fill must not be touched.
  const amber = token("amber");
  expect(legibleOn(amber)).toEqual({ bg: amber, fg: "ink" });
  // Near-black takes paper, untouched.
  expect(legibleOn("#101820")).toEqual({ bg: "#101820", fg: "paper" });
});

test("legibleOn nudges only the mid-luminance fills, and keeps their hue", () => {
  // Purple and brown are too dark for ink and too light for paper, so the fill
  // must move.
  for (const name of ["purple", "caravans"]) {
    const hex = token(name);
    expect(contrastRatio(hex, INK), name).toBeLessThan(AA_CONTRAST);
    expect(contrastRatio(hex, "#ffffff"), name).toBeLessThan(AA_CONTRAST);
    const { bg } = legibleOn(hex);
    expect(bg, `${name} should have been nudged`).not.toBe(hex);
    expect(Math.abs(hue(bg)! - hue(hex)!), `${name} hue drift`).toBeLessThan(0.01);
  }
});

test("legibleOn survives arbitrary custom colors", () => {
  // A lobby may set any hex, so the guarantee cannot depend on the presets.
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 1000; i++) {
    const hex = `#${Math.floor(rand() * 0xffffff)
      .toString(16)
      .padStart(6, "0")}`;
    const { bg, fg } = legibleOn(hex);
    expect(bg, hex).toMatch(/^#[0-9a-f]{6}$/);
    const text = fg === "ink" ? INK : "#ffffff";
    expect(contrastRatio(bg, text), `${hex} -> ${bg}`).toBeGreaterThanOrEqual(AA_CONTRAST - 1e-9);
  }
});
