import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..");

/**
 * No source file may contain a raw NUL byte.
 *
 * grep and ripgrep treat a file containing NUL as binary and skip it silently,
 * hiding it from every search. Write the escape (backslash-u-0000) instead; it
 * produces the same string at runtime.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("no source file contains a raw NUL byte", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const buf = readFileSync(file);
    const at = buf.indexOf(0);
    if (at !== -1) {
      const line = buf.subarray(0, at).toString("utf8").split("\n").length;
      offenders.push(`${relative(SRC, file)}:${line}`);
    }
  }
  expect(
    offenders,
    `NUL byte(s) found; use the escape "\\u0000" instead:\n  ${offenders.join("\n  ")}`,
  ).toEqual([]);
});
