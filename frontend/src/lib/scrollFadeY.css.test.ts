import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The seat rail's edge fade is a mask, which jsdom neither applies nor
// resolves custom properties in, so this reads the stylesheet as text.
//
// Neither stop may be a constant: a fade means "another seat past this edge",
// so SeatRail's `ends` must be able to turn each end off from the scroll
// position.
const css = readFileSync(join(__dirname, "..", "index.css"), "utf8");

/**
 * The brace-balanced body of `.scroll-fade-y`, opener included. Fails on a
 * missing selector rather than returning an empty string that `not.toMatch`
 * would pass.
 */
function rule(opener: string): string {
  const start = css.indexOf(opener);
  if (start < 0) throw new Error(`index.css no longer contains ${JSON.stringify(opener)}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after ${JSON.stringify(opener)}`);
}

const fade = rule(".scroll-fade-y {");

test("both edge stops come from the rail, not from the stylesheet", () => {
  expect(fade).toContain("var(--scroll-fade-top,");
  expect(fade).toContain("var(--scroll-fade-bottom,");
  // A stop the rail cannot turn off.
  expect(fade).not.toMatch(/#000\s+12px/);
});

test("an unset rail gets no fade at all", () => {
  // Both defaults are 0, so the mask is opaque end to end until the rail sets
  // them; an element wearing the class without driving them shows no fade.
  expect(fade).toMatch(/var\(--scroll-fade-top,\s*0px\)/);
  expect(fade).toMatch(/var\(--scroll-fade-bottom,\s*0px\)/);
});
