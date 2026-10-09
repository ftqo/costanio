import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Board, Hex } from "@/lib/types";
import { GALLERY } from "./gallery";
import { mainIsland, startIslandRule } from "./mainIsland";

// The engine's answers, written by engine/islands TestMainIslandOnTheGallery.
// If this file and the TS classifier disagree, one of the two definitions moved.
interface Vector {
  id?: string;
  land?: Hex[];
  main: number;
  total: number;
}
const vectors: Vector[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "mainIsland.vectors.json"), "utf8"),
);

function landBoard(land: Hex[]): Board {
  return {
    radius: 20,
    tiles: land.map((hex) => ({ hex, res: "land", num: 0 })),
    robber: land[0] ?? { q: 0, r: 0 },
    harbors: [],
  };
}

test("mainIsland agrees with the engine on every vector", () => {
  expect(vectors.length).toBeGreaterThan(8);
  for (const v of vectors) {
    let board: Board;
    if (v.id) {
      const m = GALLERY.find((g) => g.id === v.id);
      expect(m, `gallery has ${v.id}`).toBeDefined();
      board = m!.board;
    } else {
      board = landBoard(v.land!);
    }
    const got = mainIsland(board)?.length ?? 0;
    expect(got, v.id ?? JSON.stringify(v.land?.length)).toBe(v.main);
  }
});

test("every islands gallery map is classified by the vectors", () => {
  const ids = new Set(vectors.map((v) => v.id));
  for (const m of GALLERY) {
    if (m.ruleset.includes("islands")) expect(ids.has(m.id), m.id).toBe(true);
  }
});

test("startIslandRule: the lobby's three answers", () => {
  const archipelago = GALLERY.find((g) => g.id === "archipelago")!.board;
  const shores = GALLERY.find((g) => g.id === "shores")!.board;
  expect(startIslandRule(shores, "auto")).toBe("main");
  expect(startIslandRule(shores, undefined)).toBe("main");
  expect(startIslandRule(archipelago, "auto")).toBe("archipelago");
  expect(startIslandRule(shores, "any")).toBe("any");
  expect(startIslandRule(archipelago, "any")).toBe("any");
  // Procedural: the carve always leaves a main island.
  expect(startIslandRule(undefined, "auto")).toBe("main");
});
