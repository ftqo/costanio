import { test, expect } from "vitest";
import { swatchVariants } from "./swatch";

// Selected is a two-ring halo from theme tokens (panel, then selected ink).
test("swatchVariants: selected is a token halo, not a faint ring", () => {
  const sel = swatchVariants({ selected: true });
  expect(sel).toContain("var(--color-selected)");
  expect(sel).not.toContain("ring-ring/40");
});

test("swatchVariants: unselected has no selected emphasis", () => {
  const un = swatchVariants({ selected: false });
  expect(un).not.toContain("var(--color-selected)");
});
