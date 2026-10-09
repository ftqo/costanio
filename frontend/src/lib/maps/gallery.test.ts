import { test, expect } from "vitest";
import { GALLERY } from "./gallery";

// Every gallery board must be structurally sane: tiles inside the radius, a
// robber on a real tile, and some land. (The backend re-validates, but a
// broken board would fail to start a game.)
test("gallery: all boards are structurally valid", () => {
  for (const m of GALLERY) {
    const ring = (h: { q: number; r: number }) =>
      Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));
    expect(m.board.tiles.length, m.id).toBeGreaterThan(0);
    for (const t of m.board.tiles)
      expect(ring(t.hex), `${m.id} ${t.hex.q},${t.hex.r}`).toBeLessThanOrEqual(m.board.radius);
    const land = m.board.tiles.filter((t) => t.res !== "sea");
    expect(land.length, m.id).toBeGreaterThanOrEqual(3);
    const onTile = m.board.tiles.some(
      (t) => t.hex.q === m.board.robber.q && t.hex.r === m.board.robber.r,
    );
    expect(onTile, `${m.id} robber off-board`).toBe(true);
  }
});

// Island maps author land only; the ocean comes from the Go `Frame` transform.
// So check the land: it reaches base+islands, has the expected gold count, and
// splits into the intended number of islands (a merge would collapse the
// scenario). No sea may be authored here.
const DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
function landmasses(tiles: { hex: { q: number; r: number }; res: string }[]): number[] {
  const land = new Map(
    tiles.filter((t) => t.res !== "sea").map((t) => [`${t.hex.q},${t.hex.r}`, t]),
  );
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const start of land.keys()) {
    if (seen.has(start)) continue;
    let n = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const [q, r] = stack.pop()!.split(",").map(Number);
      n++;
      for (const [dq, dr] of DIRS) {
        const k = `${q + dq},${r + dr}`;
        if (land.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push(k);
        }
      }
    }
    sizes.push(n);
  }
  return sizes.sort((a, b) => b - a);
}

test("gallery: islands maps have sea, gold, and the right island structure", () => {
  const islands = GALLERY.filter((m) => m.kind === "islands");
  expect(islands.map((m) => m.id)).toEqual([
    "shores",
    "shores-expanded",
    "shores-large",
    "archipelago",
  ]);
  // [expected gold, expected separate landmasses]
  const want: Record<string, [number, number]> = {
    shores: [1, 4],
    "shores-expanded": [2, 5],
    "shores-large": [4, 5],
    archipelago: [2, 6],
  };
  for (const m of islands) {
    expect(m.ruleset).toContain("islands");
    // Land-only authoring: no sea.
    expect(
      m.board.tiles.some((t) => t.res === "sea"),
      `${m.id} authored sea (ocean must come from Frame)`,
    ).toBe(false);
    // No hex authored twice (a land/gold overlap would double-tile it).
    const keys = m.board.tiles.map((t) => `${t.hex.q},${t.hex.r}`);
    expect(new Set(keys).size, `${m.id} duplicate tiles`).toBe(keys.length);
    const [gold, masses] = want[m.id];
    expect(m.board.tiles.filter((t) => t.res === "gold").length, `${m.id} gold`).toBe(gold);
    const sizes = landmasses(m.board.tiles);
    expect(sizes.length, `${m.id} landmasses ${sizes}`).toBe(masses);
    // At least two islands so the island-VP chip is reachable.
    expect(sizes.length, `${m.id} needs multiple islands`).toBeGreaterThanOrEqual(2);
  }
});

// The Shores family's authored Small/Medium/Large "best with" ranges, as
// advertised in the picker.
test("gallery: islands maps carry authored player ranges", () => {
  const byId = Object.fromEntries(GALLERY.map((m) => [m.id, m]));
  const want: Record<string, { name: string; min: number; max: number }> = {
    shores: { name: "Shores (Small)", min: 3, max: 4 },
    "shores-expanded": { name: "Shores (Medium)", min: 5, max: 6 },
    "shores-large": { name: "Shores (Large)", min: 7, max: 10 },
    archipelago: { name: "Archipelago", min: 5, max: 7 },
  };
  for (const [id, w] of Object.entries(want)) {
    expect(byId[id], `${id} missing`).toBeTruthy();
    expect(byId[id].name, `${id} name`).toBe(w.name);
    expect(byId[id].players, `${id} authored range`).toEqual({ min: w.min, max: w.max });
  }
});
