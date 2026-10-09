import { i18n } from "@lingui/core";
import { test, expect, beforeEach } from "vitest";
import {
  CB_PALETTES,
  CB_MODES,
  CB_MODE_LABELS,
  cbSeatColor,
  readCbMode,
  setCbMode,
  subscribeCbMode,
} from "../colorblind";

beforeEach(() => {
  localStorage.clear();
});

test("every mode has a palette of 10 unique colors", () => {
  for (const m of CB_MODES) {
    expect(CB_PALETTES[m], m).toHaveLength(10);
    expect(new Set(CB_PALETTES[m]).size, m).toBe(10);
    for (const c of CB_PALETTES[m]) expect(c, `${m} ${c}`).toMatch(/^#[0-9a-f]{6}$/);
  }
});

test("every mode is labelled for the settings picker", () => {
  for (const m of CB_MODES) {
    expect(i18n._(CB_MODE_LABELS[m].label), m).toBeTruthy();
    expect(i18n._(CB_MODE_LABELS[m].hint), m).toBeTruthy();
  }
});

test("cbSeatColor wraps around like seatColor", () => {
  const pal = CB_PALETTES.deutan;
  expect(cbSeatColor(0, "deutan")).toBe(pal[0]);
  expect(cbSeatColor(9, "deutan")).toBe(pal[9]);
  expect(cbSeatColor(10, "deutan")).toBe(pal[0]);
  expect(cbSeatColor(-1, "deutan")).toBe(pal[9]);
});

test("cbSeatColor picks the palette for the mode", () => {
  expect(cbSeatColor(0, "protan")).toBe(CB_PALETTES.protan[0]);
  expect(cbSeatColor(0, "tritan")).toBe(CB_PALETTES.tritan[0]);
});

test("cbSeatColor never returns undefined, including for 'off'", () => {
  // "off" has no palette. A stray call must still return a colour.
  expect(cbSeatColor(3, "off")).toBe(CB_PALETTES.deutan[3]);
  expect(cbSeatColor(3)).toBe(CB_PALETTES.deutan[3]);
});

test("read/set round-trips through localStorage", () => {
  expect(readCbMode()).toBe("off");
  setCbMode("protan");
  expect(readCbMode()).toBe("protan");
  expect(localStorage.getItem("costan.colorblind")).toBe("protan");
  setCbMode("off");
  expect(readCbMode()).toBe("off");
});

test("the old boolean setting migrates to a red-green mode", () => {
  // The key used to hold "1"/"0"; "1" maps to a red-green palette.
  localStorage.setItem("costan.colorblind", "1");
  expect(readCbMode()).toBe("deutan");
  localStorage.setItem("costan.colorblind", "0");
  expect(readCbMode()).toBe("off");
});

test("an unrecognized stored value falls back to off", () => {
  localStorage.setItem("costan.colorblind", "banana");
  expect(readCbMode()).toBe("off");
});

test("subscribe fires on set and unsubscribe stops it", () => {
  let count = 0;
  const unsub = subscribeCbMode(() => {
    count++;
  });
  setCbMode("deutan");
  expect(count).toBe(1);
  unsub();
  setCbMode("off");
  expect(count).toBe(1);
});
