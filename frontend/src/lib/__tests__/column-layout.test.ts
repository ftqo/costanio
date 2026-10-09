import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COLUMN_LAYOUT_QUERY, SQUAT_QUERY } from "@/lib/hudChrome";

/**
 * The CSS decides where the boxes go and the JS tells the camera about them.
 * These must agree, or the board is framed for the wrong layout on some
 * screen shapes.
 */
const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** The media query text of a `@custom-variant NAME { @media ... }` block. */
function variantQuery(name: string): string {
  const at = CSS.indexOf(`@custom-variant ${name} {`);
  expect(at, `no @custom-variant ${name}`).toBeGreaterThan(0);
  const media = CSS.indexOf("@media", at);
  const brace = CSS.indexOf("{", media);
  // Whitespace collapsed: Prettier breaks a long query across lines.
  return CSS.slice(media + "@media".length, brace)
    .replace(/\s+/g, " ")
    .trim();
}

describe("column layout CSS matches hudChrome", () => {
  it("lg variant equals COLUMN_LAYOUT_QUERY", () => {
    expect(variantQuery("lg")).toBe(COLUMN_LAYOUT_QUERY);
  });

  // `max-lg` is its own variant, not derived from `lg`. If only one were
  // overridden a landscape phone would match both.
  it("max-lg is the complement of lg without `not`", () => {
    const q = variantQuery("max-lg");
    // Lightning CSS rewrites `not ((A) or (B))` into an invalid condition.
    expect(q).not.toContain("not ");
    for (const [w, h] of GRID) {
      expect(matches(q, w, h), `max-lg at ${w}x${h}`).toBe(!matches(COLUMN_LAYOUT_QUERY, w, h));
    }
  });

  it("squat variant equals SQUAT_QUERY", () => {
    expect(variantQuery("squat")).toBe(SQUAT_QUERY);
  });

  // A landscape phone has its own column layout, so every size it names must
  // also be `lg`.
  it("every squat size is also lg", () => {
    for (const [w, h] of GRID) {
      if (matches(SQUAT_QUERY, w, h))
        expect(matches(COLUMN_LAYOUT_QUERY, w, h), `${w}x${h}`).toBe(true);
    }
  });
});

/**
 * The root `zoom: 0.75` no longer applies to landscape phones, which have
 * their own `squat` layout at zoom 1. The grid below checks that the new query
 * is the old one minus squat at every size, and the column layout is the old
 * one plus squat.
 */
describe("the landscape zoom", () => {
  const OLD_ZOOM = "(min-width: 700px) and (max-height: 600px)";
  const OLD_LG = "(min-width: 1024px), (min-width: 700px) and (max-height: 600px)";
  const zoomQuery = () => {
    const at = CSS.search(/@media [^{]*\{\s*html\s*\{\s*zoom:\s*0?\.75/);
    expect(at, "no zoom: 0.75 rule").toBeGreaterThan(0);
    return CSS.slice(at + "@media".length, CSS.indexOf("{", at))
      .replace(/\s+/g, " ")
      .trim();
  };

  it("never applies to a sideways phone", () => {
    const q = zoomQuery();
    for (const [w, h] of PHONES_SIDEWAYS) {
      expect(matches(SQUAT_QUERY, w, h), `${w}x${h} is squat`).toBe(true);
      expect(matches(q, w, h), `zoom at ${w}x${h}`).toBe(false);
    }
  });

  it("otherwise matches the old zoom rule", () => {
    const q = zoomQuery();
    for (const [w, h] of GRID) {
      expect(matches(q, w, h), `zoom at ${w}x${h}`).toBe(
        matches(OLD_ZOOM, w, h) && !matches(SQUAT_QUERY, w, h),
      );
    }
  });

  it("lg is the old lg plus squat", () => {
    for (const [w, h] of GRID) {
      expect(matches(COLUMN_LAYOUT_QUERY, w, h), `lg at ${w}x${h}`).toBe(
        matches(OLD_LG, w, h) || matches(SQUAT_QUERY, w, h),
      );
    }
  });

  it("leaves portrait phones, tablets and desktops unchanged", () => {
    for (const [w, h] of UNCHANGED) {
      expect(matches(SQUAT_QUERY, w, h), `${w}x${h}`).toBe(false);
      expect(matches(COLUMN_LAYOUT_QUERY, w, h), `${w}x${h}`).toBe(matches(OLD_LG, w, h));
    }
  });
});

/** Phones held sideways: the sizes the brief names, and the largest in use. */
const PHONES_SIDEWAYS = [
  [667, 375],
  [740, 360],
  [844, 390],
  [915, 412],
  [932, 430],
] as const;

const UNCHANGED = [
  [320, 568],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1920, 1080],
  [2560, 1440],
  [1280, 550],
] as const;

/** Every 20px from 300 to 2000 wide, 300 to 1200 tall, plus the half-pixel edges. */
const GRID: (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  const ws = [559.98, 560, 699.98, 700, 1023.98, 1024];
  const hs = [500, 500.02, 600, 600.02];
  for (let w = 300; w <= 2000; w += 20) for (let h = 300; h <= 1200; h += 20) out.push([w, h]);
  for (const w of ws) for (const h of hs) out.push([w, h]);
  return out;
})();

/**
 * Evaluates a media query of the shape this file writes (a comma list of
 * conjunctions of `(min|max-width|height: Npx)`) at one size. jsdom has no
 * media queries.
 */
function matches(query: string, w: number, h: number): boolean {
  return query.split(",").some((arm) =>
    [...arm.matchAll(/\((min|max)-(width|height):\s*([\d.]+)px\)/g)].every(([, mm, axis, n]) => {
      const v = axis === "width" ? w : h;
      return mm === "min" ? v >= Number(n) : v <= Number(n);
    }),
  );
}
