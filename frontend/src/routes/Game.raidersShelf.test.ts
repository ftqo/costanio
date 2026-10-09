import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The game screen cannot be mounted in jsdom, so this pins the wiring at the
// source level, like the prompt and picker guards.
//
// Every dark tile on the build shelf says why ("Roll the dice first.", "You
// need 1 brick."), including the Raiders deck tile when the hand cannot pay.
const src = readFileSync(join(process.cwd(), "src/routes/Game.tsx"), "utf8");

it("the Raiders deck tile explains a dark tile like every other tile", () => {
  const at = src.indexOf('context: "shelf tile: buy a Raiders card"');
  expect(at).toBeGreaterThan(0);
  const tile = src.slice(at, at + 2400);
  expect(tile).toContain('buildWhy("dev", canBuild && canBuyRaiders');
  expect(tile).not.toMatch(/!canBuyRaiders\s*\?\s*undefined/);
});
