import { test, expect } from "vitest";
import { iconButtonVariants } from "./iconButton";

test("iconButtonVariants: rimmed round surface, token-based, no press", () => {
  const c = iconButtonVariants({ size: "md" });
  expect(c).not.toContain("border-2");
  expect(c).not.toContain("translate-x-boxShadowX");
  expect(c).toContain("border-border");
  expect(c).toContain("bg-secondary-background");
  expect(c).toContain("rounded-full");
});
