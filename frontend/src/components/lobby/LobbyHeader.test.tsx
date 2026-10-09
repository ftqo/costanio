import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The lobby header's layout rules, as source-level guards (jsdom has no
 * layout; same style as routes/pageStructure): the desktop row wraps instead
 * of overflowing, and neither title is centred on anything but the space
 * actually left over.
 *
 * Checked in headless Chromium: no width from 320 to 1400 overflows, the
 * privacy Segmented keeps its 123px, and the title and right cluster never
 * overlap. The page root clips (`overflow-x-hidden`), so overflow would hide
 * the profile avatar, the Discord Activity's only route to the store.
 */

const src = readFileSync(join(import.meta.dirname, "LobbyHeader.tsx"), "utf8");

// The two layout roots, so each assertion says which header it is about.
// Anchored on the breakpoint rather than the whole class list, so a header
// that gains a class is still found rather than passing by accident.
const desktopAt = src.search(/className="[^"]*min-\[720px\]:flex/);
const mobileAt = src.search(/className="[^"]*min-\[720px\]:hidden/);
expect(desktopAt, "the desktop header is missing").toBeGreaterThan(-1);
expect(mobileAt, "the mobile header is missing").toBeGreaterThan(-1);
const desktop = src.slice(desktopAt);
const mobile = src.slice(mobileAt, desktopAt);

describe("the desktop lobby header", () => {
  // The row's contents can't shrink usefully (a crushed Segmented prints
  // "Public" over "Show code"), so the row wraps and the clusters hold their
  // size. A larger breakpoint would only move the overflow to the next control.
  it("wraps rather than overflowing", () => {
    expect(desktop.slice(0, desktop.indexOf(">"))).toContain("flex-wrap");
  });

  it("lets neither cluster shrink", () => {
    // Left (brand pill plus seat buttons) and right (chrome) are the whole row.
    const clusters = desktop.match(/className="[^"]*flex items-center gap-[^"]*"/g) ?? [];
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    for (const c of clusters) expect(c, c).toContain("shrink-0");
  });

  // Absolute centring can't see where the right cluster begins; a flex item
  // gets only what is left.
  it("never centres the title absolutely", () => {
    expect(desktop).not.toContain("absolute");
    expect(desktop).not.toContain("-translate-x-1/2");
  });

  it("has one truncating title with a min width", () => {
    const titles = desktop.match(/'s table/g) ?? [];
    expect(titles).toHaveLength(1);
    const title = desktop.match(/className="([^"]*)"[^>]*>\s*<Trans>\{host\}'s table/)?.[1] ?? "";
    expect(title).toContain("flex-1");
    expect(title).toContain("truncate");
    // Without a floor the flex item gets 20px at 940px: an ellipsis and one
    // letter.
    expect(title).toMatch(/min-w-\[\d/);
  });

  // Reachability: inside the Activity this menu is the only way to the store.
  it("draws the profile menu", () => {
    expect(desktop).toContain("{profileMenu}");
  });
});

describe("the mobile lobby header", () => {
  // Clean at 320/360/390. The title truncating to four characters at 320px is
  // the accepted tradeoff.
  it("keeps its title a truncating flex item", () => {
    const title = mobile.match(/className="([^"]*)"[^>]*>\s*<Trans>\{host\}'s table/)?.[1] ?? "";
    expect(title).toContain("flex-1");
    expect(title).toContain("min-w-0");
    expect(title).toContain("truncate");
  });

  it("draws the profile menu", () => {
    expect(mobile).toContain("{profileMenu}");
  });
});
