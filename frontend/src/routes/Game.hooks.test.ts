import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards the Rules of Hooks in Game: it has loading early-returns (`if (!g)` /
// `if (!view)`), and a top-level hook after them changes the hook count
// between the loading and loaded renders (React error #310). The Discord
// Activity always renders the loading state first, so it crashes there.
//
// No `react-hooks/rules-of-hooks` ESLint rule runs here, so this parses the
// Game function body and asserts no top-level hook call follows its first
// early return. (Hooks in nested helper components are deeper-indented and
// ignored.)
function gameSource(): string {
  // vitest runs from the frontend package root.
  return readFileSync(join(process.cwd(), "src/routes/Game.tsx"), "utf8");
}

function gameBodyLines(): { line: number; text: string }[] {
  const src = gameSource().split("\n");
  const start = src.findIndex((l) => l.startsWith("export function Game()"));
  expect(start, "Game() function not found").toBeGreaterThanOrEqual(0);
  // The Game function body is fully indented; its sole column-0 `}` closes it.
  let end = src.length - 1;
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === "}") {
      end = i;
      break;
    }
  }
  return src.slice(start, end + 1).map((text, i) => ({ line: start + 1 + i, text }));
}

describe("Game component hook ordering", () => {
  it("declares every top-level hook before the early returns", () => {
    const body = gameBodyLines();
    const guardRe = /^ {2}if \(!(g|view)\)/;
    // Every shape a top-level hook call takes in this file, including
    // destructuring (`const [x, setX] = React.useState(...)`) and custom hooks
    // (`useMeasure`, `useGameSocket`). The optional generic is for
    // `useMeasure<number>({ ... })`.
    const hookRe =
      /^ {2}(?:(?:const|let|var)\s+(?:\[[^\]]*\]|\{[^}]*\}|\w+)\s*(?::[^=]+?)?=\s*)?(?:React\.)?use[A-Z]\w*(?:<[^>]*>)?\(/;

    const guard = body.find((l) => guardRe.test(l.text));
    expect(guard, "expected an `if (!g)`/`if (!view)` loading guard in Game()").toBeTruthy();

    const lateHooks = body
      .filter((l) => l.line > guard!.line && hookRe.test(l.text))
      .map((l) => `Game.tsx:${l.line}  ${l.text.trim()}`);

    expect(
      lateHooks,
      "top-level hooks after the loading early-return (React #310); move them above it:\n" +
        lateHooks.join("\n"),
    ).toEqual([]);
  });
});
