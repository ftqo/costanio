import { test, expect } from "vitest";
import { cardVariants } from "./card";

test("cardVariants: radius variants use the radius tokens, not arbitrary px", () => {
  expect(cardVariants({ radius: "base" })).toContain("rounded-base");
  expect(cardVariants({ radius: "card" })).toContain("rounded-card");
  expect(cardVariants({ radius: "lg" })).toContain("rounded-card-lg");
  // no hand-rolled arbitrary radii remain
  expect(cardVariants({ radius: "base" })).not.toContain("rounded-[");
});

test("cardVariants: default surface is token-based", () => {
  const c = cardVariants({});
  expect(c).toContain("border-rim");
  expect(c).not.toContain("border-2");
  expect(c).toContain("bg-secondary-background");
});
