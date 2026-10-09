import { describe, expect, it, test } from "vitest";
import { hudOrbClasses } from "./HudLayer";
import { seatFields } from "@/lib/seatPanels";

// The orbs' interaction is a class string and jsdom has no layout, so these pin
// the string, as button.test.ts / iconButton.test.ts do.
const SHAPES = [
  { active: false, round: false },
  { active: false, round: true },
  { active: true, round: false },
  { active: true, round: true },
] as const;

describe("every orb", () => {
  for (const opts of SHAPES) {
    const c = hudOrbClasses(opts);
    const name = `active=${opts.active} round=${opts.round}`;

    // An orb is a small glass panel that brightens under the pointer, with no
    // hard shadow; the HUD's one raised control is the primary turn action.
    it(`brightens when pressed (${name})`, () => {
      expect(c).not.toContain("translate-x-boxShadowX");
      expect(c).not.toContain("shadow-shadow");
      expect(c).toContain("active:bg-[var(--hud-well)]");
      if (!opts.active) expect(c).toContain("hover:bg-[var(--hud-raised)]");
    });

    it(`does not lift on hover (${name})`, () => {
      expect(c).not.toContain("hover:-translate-y-0.5");
      expect(c).not.toContain("transition-transform");
      expect(c).toContain("transition-colors");
    });

    it(`is keyboard-focusable like every other button (${name})`, () => {
      expect(c).toContain("focus-visible:outline-none");
      expect(c).toContain("focus-visible:ring-2");
      expect(c).toContain("focus-visible:ring-ring");
    });

    it(`goes inert and dim when disabled (${name})`, () => {
      expect(c).toContain("disabled:pointer-events-none");
      // On the glyph, so the orb itself stays opaque over the board.
      expect(c).toContain("disabled:*:opacity-50");
      expect(c).not.toContain("disabled:opacity-");
    });

    it(`keeps the glass surface and the orb's size (${name})`, () => {
      expect(c.split(" ")).toContain("hud-surf");
      expect(c).toContain("w-9");
      expect(c).toContain("h-9");
    });

    // A finger gets its 44px as a halo, not a bigger orb, so the orbs stay level
    // with the 36px hamburger and avatar on the row.
    //
    // 1.5 (6px) rather than 1 (4px): the halo is measured from the padding box,
    // so the orb's 2px border comes out first, leaving 4px a side (36 to 44).
    it(`grows its touch hit area, not its face (${name})`, () => {
      expect(c).toContain("pointer-coarse:before:absolute");
      expect(c).toContain("pointer-coarse:before:-inset-1.5");
      expect(c).toContain("pointer-coarse:before:content-['']");
      // A pattern rather than the two class names, since Tailwind scans this
      // file and would generate the very rules this keeps out of the bundle.
      expect(c).not.toMatch(/pointer-coarse:[wh]-11/);
      // The halo is positioned against the orb (the class string's `relative`).
      expect(c.split(" ")).toContain("relative");
    });
  }
});

test("shape follows `round`", () => {
  expect(hudOrbClasses({ round: true })).toContain("rounded-full");
  expect(hudOrbClasses({ round: false })).not.toContain("rounded-full");
  expect(hudOrbClasses({ round: false })).toContain("rounded-[12px]");
  // The default is the panel-orb shape, matching the rest of the cluster.
  expect(hudOrbClasses()).toContain("rounded-[12px]");
});

// `active` means "this orb's panel is open": a held toggle in the primary's hue
// with an inset ring, so it reads as on rather than hovered. Hover keeps that
// fill, so it doesn't flicker.
test("lights only an open orb in the primary hue", () => {
  const open = hudOrbClasses({ active: true });
  expect(open).toContain(
    "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--hud-primary)_55%,var(--hud-fill-solid))]",
  );
  expect(open).toContain("bg-[color-mix(in_srgb,var(--hud-primary)_16%,var(--hud-fill-solid))]");
  const closed = hudOrbClasses({});
  expect(closed).not.toContain("--hud-primary");
});

// The seat rail must never fall back to showing a bare score, on the desktop
// card or the phone one.
test("shows the panel's owner at every seat density", () => {
  for (const d of ["full", "micro"] as const) {
    const f = seatFields(d);
    // A name and a score. `micro` is the closed half of a toggle that opens the
    // whole strip, so nothing is unreachable (see lib/seatPanels).
    expect(f.name, d).toBe(true);
    expect(f.vp, d).toBe(true);
  }
});
