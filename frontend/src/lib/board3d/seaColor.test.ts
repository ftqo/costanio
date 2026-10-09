import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAGE_BLUE_HEX, SKY_HEX, SKY_LINEAR, hexToLinear, scaleRGB } from "./seaColor";

test("both colours are the tokens index.css declares", () => {
  // Read the stylesheet so the page and the sea cannot drift apart.
  // process.cwd() is the frontend root under vitest; import.meta.url is a
  // transformed module URL there, not a file: one.
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const bg = css.match(/--background:\s*(#[0-9a-fA-F]{6})\s*;/);
  expect(bg, "--background hex literal in index.css").toBeTruthy();
  expect(PAGE_BLUE_HEX.toLowerCase()).toBe(bg![1].toLowerCase());

  const fog = css.match(/--color-fog:\s*(#[0-9a-fA-F]{6})\s*;/);
  expect(fog, "--color-fog hex literal in index.css").toBeTruthy();
  // The sky is the fog colour.
  expect(SKY_HEX.toLowerCase()).toBe(fog![1].toLowerCase());
});

test("hexToLinear uses the real sRGB curve, not a 2.2 power", () => {
  // This red channel is in the linear segment, where the 2.2 approximation is
  // off by nearly a third.
  const [r, g, b] = hexToLinear("#1159c1");
  expect(r).toBeCloseTo(0.005605, 5);
  expect(g).toBeCloseTo(0.099899, 5);
  expect(b).toBeCloseTo(0.533276, 5);
  // The naive 2.2 power would give ~0.0035 here; assert we are not that.
  expect(r).toBeGreaterThan((17 / 255) ** 2.2);
});

test("black and white survive the round trip", () => {
  expect(hexToLinear("#000000")).toEqual([0, 0, 0]);
  const w = hexToLinear("#ffffff");
  for (const c of w) expect(c).toBeCloseTo(1, 6);
});

test("the sky keeps one hue at every elevation", () => {
  // Only brightness varies; an independently picked horizon colour would give
  // the sea a pale cyan sheen.
  const ratio = (c: number[]) => [c[1] / c[2], c[0] / c[2]];
  const base = ratio(SKY_LINEAR);
  for (const k of [0.06, 0.3, 1.0]) {
    const [gb, rb] = ratio(scaleRGB(SKY_LINEAR, k));
    expect(gb).toBeCloseTo(base[0], 6);
    expect(rb).toBeCloseTo(base[1], 6);
  }
});

test("the sky is a neutral haze, not a tint", () => {
  // Pale blue-grey: blue leads slightly and red is close behind green, so it
  // reads as haze rather than a coloured filter.
  const [r, g, b] = SKY_LINEAR;
  expect(b).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(r);
  expect(g - r).toBeLessThan(b - r); // no green spike: not cyan
  expect(r / b).toBeGreaterThan(0.4); // desaturated, not a blue filter
});
