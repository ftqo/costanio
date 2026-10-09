import { test, expect } from "vitest";
import { decorationFor } from "./decorations";

test("unknown / empty id => null", () => {
  expect(decorationFor(undefined, false)).toBeNull();
  expect(decorationFor("", false)).toBeNull();
  expect(decorationFor("decoration.nope", false)).toBeNull();
});

test("each support method maps to its sparkle colour; staff to fire", () => {
  expect(decorationFor("decoration.booster", false)?.className).toContain(
    "decorated--sparkle-pink",
  );
  expect(decorationFor("decoration.supporter", false)?.className).toContain(
    "decorated--sparkle-blue",
  );
  expect(decorationFor("decoration.kofi", false)?.className).toContain("decorated--sparkle-yellow");
  expect(decorationFor("decoration.staff", false)?.className).toContain("decorated--fire-red");
});

test("reduced motion adds the static modifier", () => {
  const fx = decorationFor("decoration.booster", true);
  expect(fx?.className).toContain("decorated--sparkle-pink");
  expect(fx?.className).toContain("decorated--static");
});
