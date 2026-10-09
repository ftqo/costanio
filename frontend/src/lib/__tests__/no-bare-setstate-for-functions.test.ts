import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..");

/**
 * `useState` setters must not be passed straight to a callback whose value is
 * a function.
 *
 * Passed a function, the setter treats it as an updater and calls it with the
 * previous state. `onProjector={setProjector}` would call the projector with
 * `null` and throw during render. Use a thunk: `setProjector(() => p)`.
 *
 * The type system cannot catch this (`Projector | null` is assignable to
 * `SetStateAction<Projector | null>`), and the projector is only published
 * under WebGL, which jsdom lacks, so this is a source scan.
 */

/** Callback props whose argument is itself a function. */
const FUNCTION_VALUED_PROPS = ["onProjector"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("function-valued callbacks are not bound to a bare setter", () => {
  // `onProjector={setFoo}`: a bare identifier starting with `set`. Inline
  // arrows, useCallback and the rest are fine.
  const patterns = FUNCTION_VALUED_PROPS.map(
    (prop) => [prop, new RegExp(`${prop}=\\{set[A-Z]\\w*\\}`)] as const,
  );

  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const [prop, re] of patterns) {
      if (re.test(src)) offenders.push(`${relative(SRC, file)}: ${prop}`);
    }
  }

  expect(offenders).toEqual([]);
});
