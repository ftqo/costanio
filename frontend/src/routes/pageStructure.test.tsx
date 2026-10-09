import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every non-game page uses one frame: one content width, a compact header, a
 * heading, and radii from the scale. Source-level guards rather than render
 * tests, since the thing protected is that no route hand-rolls the frame, and
 * reading the route is the cheapest way to see that.
 */

const routesDir = join(import.meta.dirname, ".");
const componentsDir = join(import.meta.dirname, "..", "components");

function sourcesIn(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

const pageSources = [...sourcesIn(routesDir), ...sourcesIn(componentsDir)];

describe("the shared page frame", () => {
  // There is no 920px column and `PageBody` takes no width.
  it("has exactly one content width", () => {
    const offenders = pageSources.filter(
      (f) => /<PageBody[^>]*\swidth=/.test(f.text) || f.text.includes("max-w-[920px]"),
    );
    expect(
      offenders.map((f) => f.name),
      "PageBody has one width; a reading measure belongs on the block of prose that needs it",
    ).toEqual([]);
  });

  // `compact` is the page header; without it a page's header is taller and its
  // content shifts down.
  it("draws every page header compact", () => {
    const bad: string[] = [];
    for (const f of pageSources) {
      for (const tag of f.text.match(/<SiteHeader[^>]*>/g) ?? []) {
        if (!tag.includes("compact")) bad.push(`${f.name}: ${tag}`);
      }
    }
    expect(bad, "every page header is <SiteHeader compact />").toEqual([]);
  });

  // Every page names itself with a heading (PageTitle renders a single <h1>).
  // This asserts the pairing rather than the markup, so Profile can promote its
  // identity card instead of adding a redundant "Profile" row.
  it("gives every page body a heading", () => {
    const offenders = pageSources.filter(
      (f) => f.text.includes("<PageBody") && !/<PageTitle|<h1/.test(f.text),
    );
    expect(
      offenders.map((f) => f.name),
      "a page with a content body needs a PageTitle (or its own single h1)",
    ).toEqual([]);
  });

  // rounded-card (20px) is the token; 18px cards are off the scale.
  it("keeps page-level cards on the radius scale", () => {
    const offenders = pageSources.filter(
      // GameDock is game chrome, not a page, and has its own shape.
      (f) => f.name !== "GameDock.tsx" && f.text.includes("rounded-[18px]"),
    );
    expect(
      offenders.map((f) => f.name),
      "use rounded-card (20px) rather than an off-scale literal",
    ).toEqual([]);
  });
});
