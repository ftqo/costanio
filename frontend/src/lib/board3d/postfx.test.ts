import { expect, test } from "vitest";
import {
  BLOOM_LEVELS,
  applyGradeLinear,
  bloomContribution,
  bloomMipSizes,
  gradedPageHex,
  linearToHex,
  neutralToneMap,
} from "./postfx";
import { boardLook } from "./boardTheme";
import { hexToLinear } from "./seaColor";

test("an ungraded page comes back exactly as it went in", () => {
  // The JS grade and the fragment shader implement one formula; the identity
  // case must survive a round trip through linear, the tone mapper and back to
  // hex.
  for (const mode of ["light", "dark"] as const) {
    const look = boardLook(mode, false);
    expect(gradedPageHex(look)).toBe(look.pageHex);
  }
});

test("a graded page moves, and moves the way the water does", () => {
  // A graded sea needs a graded page behind it, or the ocean grows a rim.
  const look = boardLook("light", true);
  expect(gradedPageHex(look)).not.toBe(look.pageHex);
  const graded = hexToLinear(gradedPageHex(look));
  const raw = hexToLinear(look.pageHex);
  // Vibrant lifts exposure and saturation, so the page must get brighter.
  expect(graded[2]).toBeGreaterThan(raw[2]);
});

test("the far water never blooms", () => {
  // `gradedPageHex` assumes the page colour stays under the bloom threshold:
  // the far sea is fogged to it, and a glow there would brighten the horizon
  // against an unchanged DOM background. The bright pass keys on the brightest
  // channel, so that is what is compared.
  for (const mode of ["light", "dark"] as const) {
    const look = boardLook(mode, true);
    if (!look.bloom) continue;
    const page = hexToLinear(gradedPageHex(look));
    expect(Math.max(...page)).toBeLessThan(look.bloom.threshold);
  }
});

test("the tone mapper leaves the ordinary range alone", () => {
  // Khronos PBR Neutral is nearly the identity below its compression knee (why
  // the board uses it over ACES); a transcription error would move midtones.
  const mid: [number, number, number] = [0.2, 0.3, 0.4];
  const out = neutralToneMap(mid);
  for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(mid[i] - 0.04, 3);
});

test("the tone mapper compresses what would clip", () => {
  const out = neutralToneMap([4, 2, 1]);
  for (const c of out) expect(c).toBeLessThanOrEqual(1.0001);
  expect(Math.max(...out)).toBeGreaterThan(0.8);
});

test("an identity grade is arithmetically the identity", () => {
  // The maths must agree with `isIdentityGrade`, or a style that sets one
  // field to its default would take the slow path and look different.
  const grade = boardLook("light", false).grade;
  const rgb: [number, number, number] = [0.1, 0.42, 0.9];
  const out = applyGradeLinear(rgb, grade);
  for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(rgb[i], 6);
});

test("hex survives a round trip through linear", () => {
  for (const hex of ["#1159c1", "#05070d", "#ffffff", "#000000", "#7cc6ef"]) {
    expect(linearToHex(hexToLinear(hex))).toBe(hex);
  }
});

test("the pyramid halves and never reaches zero", () => {
  // An off-by-one here is a half-texel drift per level, a glow leaning toward
  // one corner: hard to see, easy to assert.
  const mips = bloomMipSizes(1920, 1080);
  expect(mips).toEqual([
    { width: 960, height: 540 },
    { width: 480, height: 270 },
    { width: 240, height: 135 },
    { width: 120, height: 67 },
    { width: 60, height: 33 },
  ]);
  expect(mips).toHaveLength(BLOOM_LEVELS);
});

test("a tiny canvas bottoms out instead of allocating 1x1 targets", () => {
  // A board can be mounted in a tiny preview; levels below one pixel are waste.
  const mips = bloomMipSizes(8, 4);
  expect(mips[mips.length - 1]).toEqual({ width: 1, height: 1 });
  expect(mips.length).toBeLessThan(BLOOM_LEVELS);
  for (const m of mips) {
    expect(m.width).toBeGreaterThanOrEqual(1);
    expect(m.height).toBeGreaterThanOrEqual(1);
  }
});

test("a non-square canvas floors each axis independently", () => {
  // The wide axis keeps halving after the short one bottoms out, or the glow
  // stretches.
  const mips = bloomMipSizes(1024, 2);
  expect(mips[0]).toEqual({ width: 512, height: 1 });
  expect(mips[1]).toEqual({ width: 256, height: 1 });
});

test("the threshold has a knee rather than an edge", () => {
  // A hard threshold makes the bloom edge a contour that crawls across the sea
  // as the sun's reflection moves. The knee makes it a ramp: a pixel just under
  // the threshold contributes something, rising smoothly.
  const threshold = 1;
  expect(bloomContribution(0.4, threshold)).toBe(0);
  const under = bloomContribution(0.8, threshold);
  const at = bloomContribution(1.0, threshold);
  const over = bloomContribution(1.4, threshold);
  expect(under).toBeGreaterThan(0);
  expect(under).toBeLessThan(at);
  expect(at).toBeLessThan(over);
});

test("nothing contributes more than itself", () => {
  // A fraction of the pixel's own colour, so hue is kept (a warm highlight
  // stays warm). Above 1 would invent light.
  for (const luma of [0, 0.5, 1, 2, 8, 64]) {
    const keep = bloomContribution(luma, 1);
    expect(keep).toBeGreaterThanOrEqual(0);
    expect(keep).toBeLessThanOrEqual(1);
  }
});

test("a bright pixel keeps almost all of itself", () => {
  // Well above the threshold a value passes essentially intact.
  expect(bloomContribution(64, 1)).toBeGreaterThan(0.95);
});

test("nothing survives a threshold nothing reaches", () => {
  // A threshold above every pixel means no glow, not a uniform wash.
  expect(bloomContribution(0.9, 4)).toBe(0);
});
