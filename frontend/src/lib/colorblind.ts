// Colorblind player colors. In colorblind mode the board recolors every
// player's pieces from a fixed color-vision-deficiency (CVD) safe palette by
// seat index, and buildings carry the seat number, so identity never rests on
// color alone. Viewer-local: stored in localStorage, never sent to the server.
//
// One palette per deficiency: deuteranopia and protanopia remove the red-green
// axis, tritanopia the blue-yellow one. A universal palette must separate on
// both and runs out at five or six seats; a per-deficiency one carries seven
// or eight. Past that the seat numeral carries identity, so `numberPieces` is
// on for every mode.
//
// Each palette was found by simulated annealing over CIEDE2000 distance under
// a Brettel-Vienot-Mollon simulation of the deficiency, with three constraints:
//   * prefix-optimal: seats fill in order, so every prefix is scored, weighted
//     toward small tables.
//   * terrain-aware: every color stands off the eight terrain bases and the
//     ocean.
//   * shading-robust: a pair separated only by lightness scores as weak, since
//     3D lighting can make a dark piece's lit face brighter than a light
//     piece's shadow.
//
// Worst-pair separation by table size (CIEDE2000; >=12 comfortable, >=8 usable):
//   deuteranopia  safe to 7 seats, usable to 10
//   protanopia    safe to 8 seats, usable to 10
//   tritanopia    safe to 5 seats, usable to 9
//
// Literal hex values: fixed accessible identity colors like SEAT_COLORS
// (lib/hexgeo) and AVATAR_COLORS (lib/avatarColor), not themeable chrome.
// Exempted in no-hardcoded-colors.test.ts.
import * as React from "react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/** Which deficiency the viewer is asking the board to be legible under. */
export type CbMode = "off" | "deutan" | "protan" | "tritan";

/** The modes that recolor the board, in the order the settings menu lists them. */
export const CB_MODES = ["deutan", "protan", "tritan"] as const;
export type CbActiveMode = (typeof CB_MODES)[number];

/**
 * Menu copy: plain-language label, clinical name as the tooltip.
 *
 * "Green-weak" rather than "deuteranopia" so it works for someone without a
 * diagnosis. The two red-green types are hard to tell apart yourself, so the
 * tooltips suggest trying both.
 *
 * Message descriptors so this module constant follows the current locale via
 * `i18n._(descriptor)`.
 */
export const CB_MODE_LABELS: Record<
  CbActiveMode,
  { label: MessageDescriptor; hint: MessageDescriptor }
> = {
  deutan: {
    label: msg`Green-weak`,
    hint: msg`Deuteranopia / deuteranomaly (the most common type)`,
  },
  protan: { label: msg`Red-weak`, hint: msg`Protanopia / protanomaly (the other red-green type)` },
  tritan: { label: msg`Blue-weak`, hint: msg`Tritanopia / tritanomaly (rare)` },
};

export const CB_PALETTES: Record<CbActiveMode, readonly string[]> = {
  deutan: [
    "#9cbbff", // periwinkle
    "#852a52", // wine
    "#ff6300", // orange
    "#095558", // deep teal
    "#f9d2e8", // pale pink
    "#4c4f0e", // dark olive
    "#1111ff", // blue
    "#3ef4ee", // aqua
    "#036c5b", // green
    "#c10803", // red
  ],
  protan: [
    "#eb6c03", // orange
    "#6666ff", // periwinkle
    "#218b7a", // teal
    "#812e52", // wine
    "#ffb3d2", // pale pink
    "#22ff00", // green
    "#6f4433", // brown
    "#f1a7ff", // orchid
    "#b01100", // red
    "#71eee8", // aqua
  ],
  // Tritan has the least room. This set was searched with the 10-seat minimum
  // as a hard constraint, lifting its weakest pair above the "reads as one
  // colour" line at no cost to small tables.
  tritan: [
    "#6c5399", // violet
    "#0bf4ff", // cyan
    "#ff3300", // red
    "#774747", // maroon
    "#b3e3fc", // pale blue
    "#931739", // crimson
    "#72643f", // drab
    "#0099cc", // blue
    "#46496b", // slate
    "#dd7733", // orange
  ],
};

/**
 * The seat color for `mode`, wrapping like `seatColor` so any seat index
 * resolves. `off` has no palette (callers should use the player's chosen
 * color), so it falls back to deutan rather than painting a piece black.
 */
export function cbSeatColor(seat: number, mode: CbMode = "deutan"): string {
  const pal = CB_PALETTES[mode === "off" ? "deutan" : mode];
  const n = pal.length;
  return pal[((seat % n) + n) % n];
}

const KEY = "costan.colorblind";
const listeners = new Set<() => void>();

function isMode(v: string | null): v is CbMode {
  return v === "off" || v === "deutan" || v === "protan" || v === "tritan";
}

export function readCbMode(): CbMode {
  try {
    const raw = localStorage.getItem(KEY);
    if (isMode(raw)) return raw;
    // Migration: the setting was once a boolean on this key. Those users wanted
    // a red-green palette, so "1" maps to deutan.
    if (raw === "1") return "deutan";
    return "off";
  } catch {
    return "off";
  }
}

export function setCbMode(mode: CbMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function subscribeCbMode(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Reactive across components that don't share a hook instance (the settings
// panel sets it, the board reads it).
export function useCbMode(): CbMode {
  return React.useSyncExternalStore(subscribeCbMode, readCbMode, () => "off");
}
