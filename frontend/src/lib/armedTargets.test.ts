import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FullView } from "@/lib/types";
import { makeEdge } from "@/lib/hexgeo";
import { ARMED_TARGET_MODES, armedTargetsGone } from "./armedTargets";

// Armed modes are local state the server cannot withdraw, so when the server
// resolves what they were waiting on (timer moved the castle rider, the wagon
// ran out of movement, the ship took its last step) the client must notice.
// See lib/armedTargets.

const V = (q: number, r: number, side: 0 | 1) => ({ q, r, side });
const EDGE_A = makeEdge(V(0, 0, 0), V(1, -1, 1));
const EDGE_B = makeEdge(V(0, 0, 1), V(0, 1, 0));
const EDGE_C = makeEdge(V(0, 0, 0), V(0, -1, 1));

function view(over: Partial<FullView> = {}): FullView {
  return {
    viewer: 0,
    phase: "play",
    players: [{ seat: 0, hand: [0, 9, 9, 9, 9, 9] }],
    board: {
      radius: 1,
      robber: { q: 0, r: 0 },
      harbors: [],
      tiles: [
        { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
        { hex: { q: 1, r: 0 }, res: "brick", num: 5 },
        { hex: { q: 0, r: 1 }, res: "sea", num: 0 },
      ],
    },
    buildings: [],
    roads: [],
    legal: {},
    ...over,
  } as unknown as FullView;
}

const riders = (moves: unknown[]) => view({ ext: { raiders: { rider_moves: moves } } });

describe("armedTargetsGone", () => {
  it("keeps a rider move while the rider has targets", () => {
    const v = riders([{ from: EDGE_A, to: [EDGE_B] }]);
    expect(armedTargetsGone({ view: v, mode: "ridermove", moveFromEdge: EDGE_A })).toBe(false);
  });

  it("drops a rider move the server no longer offers", () => {
    // The timer moved the castle rider while "Rider 1" was open, so the next
    // view has no move from that edge.
    expect(armedTargetsGone({ view: riders([]), mode: "ridermove", moveFromEdge: EDGE_A })).toBe(
      true,
    );
    // Or offers a different rider; the chosen one is still gone.
    const other = riders([{ from: EDGE_C, to: [EDGE_B] }]);
    expect(armedTargetsGone({ view: other, mode: "ridermove", moveFromEdge: EDGE_A })).toBe(true);
  });

  it("drops a wagon drive when the movement runs out", () => {
    const moving = view({ legal: { wagon_steps: [V(0, 0, 0)] } });
    const spent = view({ legal: { wagon_steps: [] } });
    expect(armedTargetsGone({ view: moving, mode: "wagonmove" })).toBe(false);
    expect(armedTargetsGone({ view: spent, mode: "wagonmove" })).toBe(true);
  });

  it("drops an explorers ship mode with no step or job left", () => {
    const ships = (moves: unknown[], acts: unknown[]) =>
      view({
        legal: { explorer_ships: [{ ship: 7, moves, acts }] },
      } as unknown as Partial<FullView>);
    const sail = { mode: "sail" as const, moveFromShip: 7 };
    expect(armedTargetsGone({ view: ships([EDGE_A], []), ...sail })).toBe(false);
    expect(armedTargetsGone({ view: ships([], []), ...sail })).toBe(true);
    const job = { mode: "shipact" as const, moveFromShip: 7, shipJob: "found" };
    expect(armedTargetsGone({ view: ships([], [{ job: "found", v: V(0, 0, 0) }]), ...job })).toBe(
      false,
    );
    // A job the ship can no longer do, even though it can still do another.
    expect(
      armedTargetsGone({ view: ships([], [{ job: "land_crew", v: V(0, 0, 0) }]), ...job }),
    ).toBe(true);
  });

  it("drops a fish bridge or free road when no site is left", () => {
    expect(
      armedTargetsGone({ view: view({ legal: { bridges: [EDGE_A] } }), mode: "fishbridge" }),
    ).toBe(false);
    expect(armedTargetsGone({ view: view({ legal: { bridges: [] } }), mode: "fishbridge" })).toBe(
      true,
    );
    expect(armedTargetsGone({ view: view({ legal: { roads: [EDGE_A] } }), mode: "fishedge" })).toBe(
      false,
    );
    // No legal moves at all (the turn has moved on) also means nothing lit.
    expect(armedTargetsGone({ view: view({ legal: undefined }), mode: "fishedge" })).toBe(true);
  });

  it("never marks forced or build modes stale", () => {
    // Forced modes come from the view and end by themselves; a build tile
    // checks its own affordability.
    for (const m of ["robber", "pirate", "riderplace", "wagonbarbarian", "road", "none"] as const) {
      expect(ARMED_TARGET_MODES.has(m)).toBe(false);
      expect(armedTargetsGone({ view: view({ legal: {} }), mode: m })).toBe(false);
    }
  });
});

describe("Game.tsx armed-mode wiring", () => {
  // jsdom cannot drive the 3D board, so this holds Game.tsx to the wiring:
  // each armed state is asked of armedTargetsGone, and the effect clears it.
  const src = readFileSync(resolve(__dirname, "../routes/Game.tsx"), "utf8");
  const start = src.indexOf("const armedStale:");
  const block = src.slice(start, src.indexOf("}, [armedStale]);", start));

  it("asks for each armed mode", () => {
    expect(start).toBeGreaterThan(0);
    for (const m of ARMED_TARGET_MODES) expect(block, m).toContain(`"${m}"`);
  });

  it("clears the state behind each one", () => {
    for (const set of [
      "setRiderFrom(null)",
      "setExplorersShip(null)",
      "setExplorersJob(null)",
      "setFishPending(null)",
      "setShipMoveFrom(null)",
      "setKnightMoveFrom(null)",
      'setMode("none")',
    ])
      expect(block, set).toContain(set);
  });

  it("runs before the early returns", () => {
    expect(start).toBeLessThan(src.indexOf("if (!view) return entryScreen;"));
  });
});
