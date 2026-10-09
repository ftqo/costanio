import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI = join(__dirname);

function read(f: string) {
  return readFileSync(join(UI, f), "utf8");
}

test("switch/slider thumbs use bg-secondary-background, not bg-white", () => {
  expect(read("switch.tsx")).not.toContain("bg-white");
  expect(read("slider.tsx")).not.toContain("bg-white");
});

test("slider uses the shadow token, not a hardcoded rgba shadow", () => {
  expect(read("slider.tsx")).not.toContain("rgba(28,43,74");
  expect(read("slider.tsx")).toContain("shadow-hard-sm");
});

test("interactive primitives use the focus-visible ring", () => {
  for (const f of ["switch.tsx", "slider.tsx"]) {
    expect(read(f)).toContain("focus-visible:ring-ring");
  }
});
