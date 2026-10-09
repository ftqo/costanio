import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The seat timer's keyframe is a performance contract that jsdom cannot see
// (it runs no animation and has no compositor), so these read the stylesheet
// as text.
//
// The drain must animate `transform` and nothing else. Gecko only composites
// an animation whose every property is compositable (transform, opacity); a
// non-compositable property such as `stroke-dashoffset` restyles and rebuilds
// the display list on every frame.
const css = readFileSync(join(__dirname, "..", "index.css"), "utf8");

/**
 * The brace-balanced body of one rule, opener included. Bounding the rule at
 * its own closing brace stops a later rule from satisfying a check, and a
 * missing selector fails instead of yielding an empty slice.
 */
function rule(opener: string, from = 0): string {
  const start = css.indexOf(opener, from);
  if (start < 0) throw new Error(`index.css is missing ${JSON.stringify(opener)}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after ${JSON.stringify(opener)}`);
}

const keyframe = rule("@keyframes seat-timer-deplete");
const fill = rule(".seat-timer-fill {");

test("the seat timer drains from full to empty", () => {
  expect(keyframe).toContain("transform: scaleX(1);");
  expect(keyframe).toContain("transform: scaleX(0);");
});

test("the seat timer animates only transform", () => {
  // Every declaration inside the keyframe, as bare property names.
  const props = [...keyframe.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]);
  expect(props.length).toBeGreaterThan(0);
  expect(new Set(props)).toEqual(new Set(["transform"]));
  // Not compositable.
  expect(keyframe).not.toContain("stroke-dashoffset");
});

test("the seat timer drains toward the left and holds at the end", () => {
  // Pinned left so the bar's right edge retreats; a centre origin would shrink
  // it from both ends.
  expect(fill).toMatch(/transform-origin:\s*left center;/);
  // `forwards` keeps an expired bar empty rather than snapping back to full;
  // `1` stops it looping.
  expect(fill).toMatch(/animation: seat-timer-deplete linear 1 forwards;/);
});

test("the seat timer honours reduced motion", () => {
  // Find the reduced-motion block that mentions `.seat-timer-fill`, not just
  // any reduced-motion query in the stylesheet.
  const blocks: string[] = [];
  for (let at = css.indexOf("@media (prefers-reduced-motion"); at >= 0; ) {
    const block = rule("@media (prefers-reduced-motion", at);
    blocks.push(block);
    at = css.indexOf("@media (prefers-reduced-motion", at + block.length);
  }
  const mine = blocks.filter((b) => b.includes(".seat-timer-fill"));
  expect(
    mine,
    "no @media (prefers-reduced-motion) block turns .seat-timer-fill's drain off",
  ).toHaveLength(1);
  expect(mine[0]).toMatch(/animation:\s*none;/);
});
