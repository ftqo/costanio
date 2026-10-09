// No user-facing English outside Lingui.
//
// A literal that was never wrapped is in no catalogue, so no translator sees
// it. This walks every non-test source file with ./untranslatedScan and fails
// on any finding the allow-list does not name.
//
// To fix a failure, wrap the text (`t`, `msg`, `<Trans>`, with a `context`
// where the English is ambiguous) or, for a list, use `formatList`. Only if the
// text must stay English (a brand, the wordmark, a dev-only control) add it to
// ./untranslatedAllow.json, with the reason.
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isAllowed, scanSource, type AllowEntry, type Finding } from "./untranslatedScan";
import allowJson from "./untranslatedAllow.json";

const SRC = join(__dirname, "..");
const allow = allowJson as AllowEntry[];

/** Every shipped .ts/.tsx under src, relative and with forward slashes. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // Tests, fixtures and the catalogues are not shipped copy; src/test
        // holds test harnesses (this scanner among them). dev-gallery is the
        // dev-only style gallery (/dev/gallery), English by design.
        if (["__tests__", "__fixtures__", "locales", "test", "dev-gallery"].includes(e.name))
          continue;
        walk(p);
      } else if (
        /\.tsx?$/.test(e.name) &&
        !/\.(test|spec)\.tsx?$/.test(e.name) &&
        !e.name.endsWith(".d.ts")
      ) {
        out.push(relative(SRC, p).split(sep).join("/"));
      }
    }
  };
  walk(SRC);
  return out.sort();
}

let cached: Finding[] | undefined;
function findings(): Finding[] {
  cached ??= sourceFiles().flatMap((f) => scanSource(f, readFileSync(join(SRC, f), "utf8")));
  return cached;
}

describe("untranslated user-facing text", () => {
  test("walks the source tree", () => {
    expect(sourceFiles().length).toBeGreaterThan(200);
  });

  test("every user-facing literal goes through Lingui or is allow-listed", () => {
    const bad = findings()
      .filter((f) => !isAllowed(f, allow))
      .map((f) => `${f.file}:${f.line} [${f.kind}] ${JSON.stringify(f.text)}`);
    expect(
      bad,
      "wrap these in t/msg/<Trans> (or formatList), or allow-list them with a reason",
    ).toEqual([]);
  });

  test("every allow-list entry has a reason and still matches something", () => {
    const all = findings();
    const stale = allow.filter((a) => !all.some((f) => isAllowed(f, [a])));
    expect(stale.map((a) => `${a.file} ${a.text ?? `(${a.kind ?? "any"})`}`)).toEqual([]);
    expect(allow.filter((a) => !a.reason?.trim())).toEqual([]);
  });
});

// The scanner itself. Each case is a shape that once shipped unwrapped.
describe("the scanner", () => {
  const kinds = (src: string, file = "x.tsx") =>
    scanSource(file, src).map((f) => `${f.kind}:${f.text}`);

  test("finds each class of unwrapped copy", () => {
    expect(kinds(`const A = () => <p>Last updated: {d}</p>;`)).toEqual(["jsx-text:Last updated:"]);
    expect(kinds(`const A = () => <b>{Math.ceil(ms / 1000)}s</b>;`)).toEqual(["jsx-text:s"]);
    expect(kinds(`const A = () => <i title="Open the menu" />;`)).toEqual([
      "jsx-attr:Open the menu",
    ]);
    expect(kinds(`const A = () => <i>{busy ? "Saving" : "Save"}</i>;`)).toEqual([
      "jsx-expr:Saving",
      "jsx-expr:Save",
    ]);
    expect(kinds(`const TABS = [{ id: "a", label: "Match history" }];`, "x.ts")).toEqual([
      "prop:Match history",
    ]);
    expect(kinds("const s = { seat, name: known ?? `Seat ${n}` };", "x.ts")).toEqual([
      "prop:Seat ${}",
    ]);
    expect(kinds(`function f() { return "Waiting for players"; }`, "x.ts")).toEqual([
      "return:Waiting for players",
    ]);
    expect(kinds(`toast.error("Could not save");`, "x.ts")).toEqual(["call:Could not save"]);
    expect(kinds(`const s = names.join(", ");`, "x.ts")).toEqual([`join:.join(", ")`]);
    expect(kinds(`new Intl.NumberFormat("en-US").format(n);`, "x.ts")).toEqual([
      `locale:Intl.NumberFormat("en-US")`,
    ]);
    expect(kinds(`n.toLocaleString();`, "x.ts")).toEqual(["locale:n.toLocaleString()"]);
  });

  test("leaves translated text, code and tokens alone", () => {
    const clean = [
      "const A = () => <p><Trans>Last updated: {d}</Trans></p>;",
      "const A = () => <i title={t`Open the menu`} />;",
      'const L = msg({ message: "Match history", context: "tab" });',
      'const L = t({ message: `Seat ${n}`, context: "seat" });',
      'const A = () => <div className="flex items-center gap-2 text-muted" />;',
      'const A = () => <Button variant="secondary" size="sm" />;',
      'console.warn("Socket closed early");',
      'if (x.status === "Game over") y();',
      'const s = "uniform float uTime; float f(vec2 p) { return 1.0; }";',
      "const m = { body: 'Mat_RobberSkin_Body' };",
      "const A = () => <b>2&times;</b>;",
      'const r = [a, b].join("|");',
    ];
    for (const src of clean) expect(kinds(src), src).toEqual([]);
  });
});
