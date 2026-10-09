import { test, expect } from "vitest";
import { pillVariants } from "./pill";
import { cn } from "@/lib/utils";

// Tokens that apply at rest (no variant prefix like `hover:`/`active:`).
const restingTokens = (classes: string) =>
  classes.split(/\s+/).filter((c) => c && !c.includes(":"));

test("pillVariants: active uses the selected fill and ink", () => {
  const a = pillVariants({ tone: "active" });
  expect(a).toContain("bg-selected");
  expect(a).toContain("text-selected-ink");
  expect(a).not.toContain("text-white");
});

test("pillVariants: neutral uses the border token + foreground text", () => {
  const n = pillVariants({ tone: "neutral" });
  expect(n).toContain("border-border");
  expect(n).toContain("text-foreground");
});

// An unselected interactive chip rests with a soft lift; the selected one is
// flat and filled. Nothing translates.
test("pillVariants: interactive chips lift, count chip is borderless", () => {
  const i = pillVariants({ tone: "neutral", interactive: true });
  expect(i).toContain("shadow-hard-sm");
  expect(i).not.toMatch(/translate-[xy]-boxShadow/);
  expect(pillVariants({ tone: "count" })).toContain("border-0");
});

test("pillVariants: selected chip is flat, unselected is lifted", () => {
  const rest = restingTokens(cn(pillVariants({ tone: "active", interactive: true })));
  expect(rest).toContain("shadow-none");
  expect(rest).not.toContain("shadow-hard-sm");
  expect(rest.join(" ")).not.toMatch(/translate/);
  const upRest = restingTokens(cn(pillVariants({ tone: "neutral", interactive: true })));
  expect(upRest).toContain("shadow-hard-sm");
  expect(upRest.join(" ")).not.toMatch(/translate/);
});
