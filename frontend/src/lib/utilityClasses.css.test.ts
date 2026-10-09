import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A class Tailwind does not know cannot take a variant, and fails silently:
// `lg:no-scrollbar` on a plain `.no-scrollbar` rule generates no CSS and no
// warning. jsdom never compiles the stylesheet, so this reads it as text, as
// the seat-timer test does.

const src = join(__dirname, "..");
const css = readFileSync(join(src, "index.css"), "utf8");

/** Every class the stylesheet defines itself, and how. */
function definedAs(name: string): "utility" | "plain" | "absent" {
  if (new RegExp(`@utility\\s+${name}\\b`).test(css)) return "utility";
  if (new RegExp(`^\\.${name}[\\s{:,]`, "m").test(css)) return "plain";
  return "absent";
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

test("no variant prefixes a plain (non-utility) class", () => {
  // A hand-written class used bare is fine; once it takes a variant it must be
  // registered with `@utility` or the declaration generates nothing.
  const offenders: string[] = [];
  for (const file of sourceFiles(src)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/[a-z0-9][a-z0-9-]*:([a-z][a-z0-9-]*)\b/g)) {
      const cls = m[1];
      if (definedAs(cls) === "plain") offenders.push(`${file.slice(src.length + 1)}: ${m[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("no-scrollbar is registered as a utility", () => {
  expect(definedAs("no-scrollbar")).toBe("utility");
  // And it still hides the bar in all three engines.
  const rule = css.slice(css.indexOf("@utility no-scrollbar"));
  expect(rule).toContain("scrollbar-width: none");
  expect(rule).toContain("-ms-overflow-style: none");
  expect(rule).toContain("::-webkit-scrollbar");
});
