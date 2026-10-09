import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..");

// Board and game-art files, where hardcoded colours are intended.
const EXEMPT = new Set([
  "lib/board.ts",
  "lib/hexgeo.ts",
  "components/board/MapPreview.tsx",
  "components/board/Hex.tsx",
  "components/board/HexCluster.tsx",
  "components/board/ZoomControls.tsx",
  "components/ui/swatch.tsx", // arbitrary player/cosmetic fill, by design
  "lib/avatarColor.ts", // arbitrary player identity colors, by design
  "lib/colorblind.ts", // CVD-safe player identity colors, by design
  "lib/board3d/seatNumerals.ts", // board art: the seat numeral's digit fill + ink, by design
  "components/ProviderIcons.tsx", // OAuth brand logos (Google four-color G), fixed by brand guidelines
  "lib/color.ts", // seat-tone derivation (game-art accents), by design
  "lib/colorResolve.ts", // CSS-color → hex resolver fallback, by design
  "lib/board3d/freeColors.ts", // mirrors the server's free seat palette (cosmetics.Palette), by design
  "lib/board3d/seaColor.ts", // board art: the sea/sky blue, pinned to --background by its own test
  "lib/board3d/boardTheme.ts", // board art: the day/night look tables, pinned to the theme tokens by their own test
  // card art: the title plate's colours are frozen spec (lib/cardTitle.ts)
  // and must not follow the UI theme.
  "lib/cardTitle.ts",
]);

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const BANNED_CLASSES = /\b(?:text|bg|border)-(?:white|black)\b/;

// Strip comments so prose mentioning a banned token is not flagged. Done over
// the whole file so block comments that wrap across lines (the JSX {/* */}
// form usually does) are cleared too. Comments are blanked to spaces, keeping
// newlines, so reported line numbers still match the file.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    // dev-gallery is the dev-only style gallery: fixtures carry raw colours.
    if (statSync(p).isDirectory()) {
      if (name !== "dev-gallery") out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function offenders() {
  const bad: { file: string; line: number; text: string }[] = [];
  for (const abs of walk(SRC)) {
    const rel = relative(SRC, abs).replace(/\\/g, "/");
    if (EXEMPT.has(rel)) continue;
    const src = readFileSync(abs, "utf8");
    const raw = src.split("\n");
    stripComments(src)
      .split("\n")
      .forEach((line, i) => {
        if (HEX.test(line) || BANNED_CLASSES.test(line)) {
          bad.push({ file: rel, line: i + 1, text: raw[i].trim().slice(0, 100) });
        }
      });
  }
  return bad;
}

test("no hardcoded theme colors in non-exempt chrome", () => {
  const bad = offenders();
  expect(bad, bad.map((b) => `${b.file}:${b.line}  ${b.text}`).join("\n")).toEqual([]);
});

// A wrapped comment must not be read as code.
test("stripComments clears wrapped comments without moving line numbers", () => {
  const src = [
    `const a = 1;`,
    `{/* on-background, not the card inks: the muted card grey is`,
    `    #495f79 on the #1159c1 ocean, and text-foreground is darker. */}`,
    `<div className="text-red-500" />`,
    `// a trailing note about text-white`,
    `/* one-liner #abcdef */ const b = "#123456";`,
  ].join("\n");
  const out = stripComments(src).split("\n");

  expect(out).toHaveLength(6); // line numbers still address the same lines
  expect(out[1]).not.toMatch(HEX);
  expect(out[2]).not.toMatch(HEX); // the wrapped line of a block comment
  expect(out[4]).not.toMatch(BANNED_CLASSES);
  expect(out[5]).toMatch(HEX); // real code beside a comment is still scanned
});
