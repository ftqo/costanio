import { test, expect } from "vitest";
import { cn } from "./utils";

// The press toggles between the offset shadow (`shadow-shadow`) and a
// flattened zero-size box (`shadow-[0_0_0_0_var(--border)]`). cn() must treat
// these as one conflict group so the later one wins; otherwise both survive
// and the offset shadow renders on a flat element.
test("cn: a later custom box-shadow override replaces the earlier one", () => {
  expect(cn("shadow-shadow", "shadow-[0_0_0_0_var(--border)]")).toBe(
    "shadow-[0_0_0_0_var(--border)]",
  );
  expect(cn("shadow-shadow", "shadow-none")).toBe("shadow-none");
  expect(cn("shadow-[0_0_0_0_var(--border)]", "shadow-shadow")).toBe("shadow-shadow");
  expect(cn("shadow-hard-sm", "shadow-shadow")).toBe("shadow-shadow");
});

// Variant-scoped shadows are independent of the resting one.
test("cn: variant-scoped shadows don't merge with the resting shadow", () => {
  const out = cn("shadow-shadow", "hover:shadow-[0_0_0_0_var(--border)]");
  expect(out).toContain("shadow-shadow");
  expect(out).toContain("hover:shadow-[0_0_0_0_var(--border)]");
});

// tailwind-merge files an unknown `font-*` as a family, so it must be told
// `font-heavy` is a weight: otherwise `font-semibold` survives beside it and a
// family utility beside it is dropped.
test("cn: font-heavy merges as a weight, not a family", () => {
  expect(cn("font-heavy", "font-semibold")).toBe("font-semibold");
  expect(cn("font-semibold", "font-heavy")).toBe("font-heavy");
  expect(cn("font-display", "font-heavy")).toBe("font-display font-heavy");
  expect(cn("font-num", "font-display")).toBe("font-display");
});
