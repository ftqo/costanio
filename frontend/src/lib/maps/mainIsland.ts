import type { Board, Hex } from "@/lib/types";

// The Islands main island, matching the engine's `islands.MainIsland`
// (engine/islands/mainisland.go), which the rules enforce. This copy lets the
// lobby show which starting rule a map gets before the game exists.
//
// The largest landmass is the main island when it has at least twice the land
// of the next largest and more than half of all land. Otherwise the board is an
// archipelago and any island is a legal start.
//
// `mainIsland.vectors.json`, written by the Go test from the engine's answers
// (gallery maps plus threshold cases), is checked against this function by
// `mainIsland.test.ts`. Change Go first and regenerate the vectors.

const DIRS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Land as the engine's `board.Land` counts it: anything but sea and border. */
function isLand(res: string): boolean {
  return res !== "sea" && res !== "border";
}

/** Land hexes of each connected landmass, largest first. */
export function landmasses(board: Board): Hex[][] {
  const land = new Map<string, Hex>();
  for (const t of board.tiles) if (isLand(t.res)) land.set(`${t.hex.q},${t.hex.r}`, t.hex);
  const seen = new Set<string>();
  const out: Hex[][] = [];
  for (const [start, hex] of land) {
    if (seen.has(start)) continue;
    seen.add(start);
    const comp: Hex[] = [];
    const stack: Hex[] = [hex];
    while (stack.length) {
      const h = stack.pop()!;
      comp.push(h);
      for (const [dq, dr] of DIRS) {
        const k = `${h.q + dq},${h.r + dr}`;
        const n = land.get(k);
        if (n && !seen.has(k)) {
          seen.add(k);
          stack.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** The main island's land hexes, or null when the board has none. */
export function mainIsland(board: Board): Hex[] | null {
  const comps = landmasses(board);
  if (comps.length === 0) return null;
  const total = comps.reduce((n, c) => n + c.length, 0);
  const best = comps[0].length;
  const second = comps[1]?.length ?? 0;
  if (best < 2 * second || best * 2 <= total) return null;
  return comps[0];
}

/** The lobby's start-island setting (engine `islands.Config.StartIsland`). */
export type StartIsland = "auto" | "any";

/**
 * Where starting settlements may go for a chosen map and setting:
 * "main" (the main island only), "archipelago" (auto, but the map has no main
 * island, so any island), or "any" (the host chose any island). A procedural
 * board (no board chosen) always has a main island: the carve cuts one
 * mainland and a few small outer islands (engine
 * TestEveryProceduralBoardHasAMainIsland).
 */
export function startIslandRule(
  board: Board | undefined,
  setting: StartIsland | undefined,
): "main" | "archipelago" | "any" {
  if (setting === "any") return "any";
  if (!board) return "main";
  return mainIsland(board) ? "main" : "archipelago";
}
