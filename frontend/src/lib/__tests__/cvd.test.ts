// Checks the seat counts lib/colorblind claims for each colourblind palette.
// The palettes are opaque hex tables, so an edit can destroy their separation
// without any visible change for a normally sighted reviewer.
//
// Self-contained: it simulates the deficiency and measures distance with its
// own maths, independent of the app's.
import { test, expect } from "vitest";
import { CB_PALETTES, CB_MODES, type CbActiveMode } from "../colorblind";

// --- sRGB <-> linear --------------------------------------------------------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

type V3 = [number, number, number];
const mul = (m: number[][], v: V3): V3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const RGB2XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
// Hunt-Pointer-Estevez, the cone space Brettel's projection is defined in.
const XYZ2LMS = [
  [0.4002, 0.7076, -0.0808],
  [-0.2263, 1.1653, 0.0457],
  [0.0, 0.0, 0.9182],
];
const LMS2XYZ = [
  [1.8600666, -1.1294801, 0.2198983],
  [0.3612229, 0.6388043, -0.0000064],
  [0.0, 0.0, 1.0890873],
];
const XYZ2RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

const hexToLms = (hex: string): V3 => mul(XYZ2LMS, mul(RGB2XYZ, hexToRgb(hex).map(toLinear) as V3));

// --- Brettel-Vienot-Mollon 1997 dichromat simulation ------------------------
//
// The stimulus is projected onto the half-plane spanned by white and one of two
// monochromatic anchors, chosen by which side of the neutral plane it falls on.

const WHITE = hexToLms("#ffffff");
const LMS_475: V3 = [0.1284565, 0.222726, 0.362414];
const LMS_575: V3 = [0.985617, 0.7325, 0.001142];
const LMS_485: V3 = [0.174867, 0.3271, 0.279516];
const LMS_660: V3 = [0.494131, 0.1216, 0.0];

function simulate(hex: string, kind: CbActiveMode): V3 {
  const [L, M, S] = hexToLms(hex);
  const missing = kind === "deutan" ? "M" : kind === "protan" ? "L" : "S";
  let a: V3;
  if (missing === "S") {
    a = (L === 0 ? Infinity : M / L) < WHITE[1] / WHITE[0] ? LMS_485 : LMS_660;
  } else {
    a = (L === 0 ? Infinity : S / L) < WHITE[2] / WHITE[0] ? LMS_475 : LMS_575;
  }
  // Normal of the plane through the origin containing white and the anchor.
  const n: V3 = [
    WHITE[1] * a[2] - WHITE[2] * a[1],
    WHITE[2] * a[0] - WHITE[0] * a[2],
    WHITE[0] * a[1] - WHITE[1] * a[0],
  ];
  if (missing === "L") return [-(n[1] * M + n[2] * S) / n[0], M, S];
  if (missing === "M") return [L, -(n[0] * L + n[2] * S) / n[1], S];
  return [L, M, -(n[0] * L + n[1] * M) / n[2]];
}

// --- CIELAB + CIEDE2000 -----------------------------------------------------

type Lab = [number, number, number];

function xyzToLab([X, Y, Z]: V3): Lab {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y / 1.0), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Lab of the simulated colour as a display would show it. The projection often
 * lands outside the sRGB gamut and the display clamps it, so clamp before
 * measuring; the unclamped error is large.
 */
function simLab(hex: string, kind: CbActiveMode): Lab {
  const lin = mul(XYZ2RGB, mul(LMS2XYZ, simulate(hex, kind)));
  const clamped = lin.map((c) => Math.max(0, Math.min(1, c))) as V3;
  return xyzToLab(mul(RGB2XYZ, clamped));
}

const plainLab = (hex: string): Lab => xyzToLab(mul(RGB2XYZ, hexToRgb(hex).map(toLinear) as V3));

const rad = (d: number) => (d * Math.PI) / 180;

function ciede2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = a1p || b1 ? ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360 : 0;
  const h2p = a2p || b2 ? ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360 : 0;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp: number;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63));
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dth)) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/**
 * Separation of two seat colours for a viewer with `kind`.
 *
 * Takes the lower of the full distance and a lightness-neutralised one, because
 * the 3D board's lighting can swap the lightness of two pieces.
 */
function separation(a: string, b: string, kind: CbActiveMode): number {
  const [la, lb] = [simLab(a, kind), simLab(b, kind)];
  const full = ciede2000(la, lb);
  const chromaOnly = ciede2000([50, la[1], la[2]], [50, lb[1], lb[2]]);
  return Math.max(chromaOnly, 0.45 * full);
}

function worstPair(pal: readonly string[], n: number, kind: CbActiveMode) {
  let worst = { d: Infinity, a: "", b: "" };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = separation(pal[i], pal[j], kind);
      if (d < worst.d) worst = { d, a: `${i + 1}:${pal[i]}`, b: `${j + 1}:${pal[j]}` };
    }
  }
  return worst;
}

// --- the simulation itself has to be right ----------------------------------

test("simulation reproduces known dichromat behaviour", () => {
  // Greys carry no chroma, so no deficiency changes them.
  for (const kind of CB_MODES) {
    for (const grey of ["#ffffff", "#808080", "#000000"]) {
      const [, a, b] = simLab(grey, kind);
      expect(Math.hypot(a, b), `${grey} ${kind}`).toBeLessThan(1);
    }
  }
  // The classic collapses, and the classic survivals.
  expect(separation("#ff0000", "#00ff00", "deutan")).toBeLessThan(12);
  expect(separation("#0000ff", "#ffff00", "deutan")).toBeGreaterThan(20);
  expect(separation("#0000ff", "#ffff00", "protan")).toBeGreaterThan(20);
  // Tritanopia keeps red-green and loses blue-yellow: the blue and green of the
  // Okabe-Ito palette are one colour to a tritanope.
  expect(separation("#ff0000", "#00ff00", "tritan")).toBeGreaterThan(20);
  expect(separation("#0072b2", "#009e73", "tritan")).toBeLessThan(8);
});

test("simulation is idempotent", () => {
  // Projection is idempotent: simulating twice must not move the colour.
  // Catches sign or anchor-choice errors.
  for (const kind of CB_MODES) {
    for (const hex of CB_PALETTES[kind]) {
      const once = simulate(hex, kind);
      const twice = simulate(hex, kind);
      for (let i = 0; i < 3; i++) expect(twice[i]).toBeCloseTo(once[i], 10);
    }
  }
});

// --- the palettes hold up to what lib/colorblind claims ---------------------

/**
 * Seats each palette is claimed safe for, matching lib/colorblind. Raise only
 * when a palette improves.
 */
const SAFE_THROUGH: Record<CbActiveMode, number> = { deutan: 7, protan: 8, tritan: 5 };
/** Below this two seats read as one colour; no palette may reach it at 10 seats. */
const USABLE = 8;
const SAFE = 12;

test.each(CB_MODES)("%s palette is safe through its claimed table size", (kind) => {
  const pal = CB_PALETTES[kind];
  for (let n = 3; n <= SAFE_THROUGH[kind]; n++) {
    const w = worstPair(pal, n, kind);
    expect(w.d, `${kind} @${n} seats: ${w.a} vs ${w.b}`).toBeGreaterThanOrEqual(SAFE);
  }
});

test.each(CB_MODES)("%s palette stays usable out to 10 seats", (kind) => {
  // Past the safe size the numeral carries identity (numberPieces), but the
  // colours still may not merge outright.
  const w = worstPair(CB_PALETTES[kind], 10, kind);
  expect(w.d, `${kind} @10 seats: ${w.a} vs ${w.b}`).toBeGreaterThanOrEqual(USABLE);
});

test("each palette beats the Okabe-Ito baseline", () => {
  // The Okabe-Ito extension collapses at three seats under tritanopia
  // (blue vs green) and at seven under deuteranopia (orange vs vermillion).
  const OKABE_ITO = [
    "#0072b2",
    "#e69f00",
    "#009e73",
    "#cc79a7",
    "#f0e442",
    "#56b4e9",
    "#d55e00",
    "#999999",
    "#117733",
    "#882255",
  ];
  for (const kind of CB_MODES) {
    for (const n of [3, 6, 10]) {
      const now = worstPair(CB_PALETTES[kind], n, kind).d;
      const before = worstPair(OKABE_ITO, n, kind).d;
      expect(now, `${kind} @${n} seats`).toBeGreaterThan(before);
    }
  }
});

test("no seat colour matches a terrain colour", () => {
  // A piece must not match the hex it sits on. These are the 3D board's
  // terrain materials plus the ocean (public/models/palette.json).
  const TERRAIN = [
    "#53885b", // forest
    "#97bb76", // pasture
    "#cbc076", // fields
    "#bc8772", // hills
    "#8b919c", // mountains
    "#edce96", // desert
    "#aa9965", // gold
    "#27619b", // ocean
    "#1d458b", // ocean water
    "#efe4c5", // shore sand
  ];
  const FLOOR = 8;
  for (const kind of CB_MODES) {
    for (const seat of CB_PALETTES[kind]) {
      for (const t of TERRAIN) {
        expect(separation(seat, t, kind), `${kind} ${seat} on ${t}`).toBeGreaterThanOrEqual(FLOOR);
      }
    }
  }
});

test("palettes are distinct under normal vision", () => {
  // Most colourblind people are anomalous trichromats with partial
  // discrimination, so also require separation in plain sight.
  for (const kind of CB_MODES) {
    const pal = CB_PALETTES[kind];
    for (let i = 0; i < pal.length; i++) {
      for (let j = i + 1; j < pal.length; j++) {
        const d = ciede2000(plainLab(pal[i]), plainLab(pal[j]));
        expect(d, `${kind} ${pal[i]} vs ${pal[j]}`).toBeGreaterThan(10);
      }
    }
  }
});
