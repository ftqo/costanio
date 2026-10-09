import { test, expect } from "vitest";
import { buttonVariants } from "./button";

test("buttonVariants: non-pill uses the base radius token", () => {
  expect(buttonVariants({ pill: false })).toContain("rounded-base");
  expect(buttonVariants({ pill: false })).not.toContain("rounded-[14px]");
});

// `pill` uses the control radius token: 10px on the site, fully round in the HUD.
test("buttonVariants: pill reads the control radius token", () => {
  expect(buttonVariants({ pill: true })).toContain("rounded-control");
});

test("buttonVariants: accent tones own their on-accent text + fill", () => {
  expect(buttonVariants({ tone: "danger" })).toContain("bg-btn-danger");
  expect(buttonVariants({ tone: "danger" })).toContain("text-btn-danger-ink");
  expect(buttonVariants({ tone: "success" })).toContain("bg-btn-success");
  expect(buttonVariants({ tone: "accent" })).toContain("bg-btn-accent");
  expect(buttonVariants({ tone: "discord" })).toContain("bg-discord");
  // accent tones never hardcode white
  expect(buttonVariants({ tone: "danger" })).not.toContain("text-white");
});

// The default primary is the amber action; a caller's own bg-* still replaces it through cn().
test("buttonVariants: only the default tone gets the primary fill", () => {
  expect(buttonVariants({ tone: "default" })).toContain("bg-btn-primary");
  expect(buttonVariants({ variant: "secondary" })).not.toContain("bg-btn-primary");
  expect(buttonVariants({ variant: "ghost" })).toContain("bg-transparent");
});

test("buttonVariants: no press travel and no hard outline", () => {
  for (const variant of ["primary", "secondary", "quiet", "ghost"] as const) {
    const c = buttonVariants({ variant });
    expect(c).not.toMatch(/translate-[xy]-boxShadow|border-2/);
  }
});

test("buttonVariants: has a focus-visible ring", () => {
  expect(buttonVariants({})).toContain("focus-visible:ring-2");
  expect(buttonVariants({})).toContain("focus-visible:ring-ring");
});
