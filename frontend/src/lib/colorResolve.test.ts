import { test, expect } from "vitest";
import { resolveCssColorToHex } from "./colorResolve";

test("resolveCssColorToHex returns a #rrggbb string", () => {
  // jsdom may return rgb() or the raw hex; either way the helper yields
  // #rrggbb.
  expect(resolveCssColorToHex("#ff0000")).toMatch(/^#[0-9a-f]{6}$/i);
});

test("resolveCssColorToHex caches per input (second call is stable)", () => {
  const a = resolveCssColorToHex("#00ff00");
  expect(resolveCssColorToHex("#00ff00")).toBe(a);
});
