import { test, expect } from "vitest";
import {
  planPorts,
  portWaterPlacements,
  wedgePrefix,
  dockPrefix,
  signPlacement,
  signRotationY,
  groupDockArt,
  groupSignArt,
  SIGN_PIVOT_X,
  SIGN_UPRIGHT_Y,
} from "./harbors";
import { LATTICE_SCALE } from "../coords";
import { TILE_ROTATION_Y } from "./tiles";
import { hexEdges } from "@/lib/hexgeo";
import type { BoardTile, Harbor } from "@/lib/types";

const tiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 0, r: -1 }, res: "sea", num: 0 },
  { hex: { q: 1, r: -1 }, res: "sea", num: 0 },
];

// These two vertices share hexes (0,0) (land) and (1,-1) (sea).
const harbor: Harbor = {
  verts: [
    { q: 0, r: 0, side: 0 },
    { q: 1, r: -1, side: 1 },
  ],
  ratio: 2,
  res: "wood",
};

test("each trade takes its own dock art", () => {
  // The wire's resource names, unchanged: the Dock_* families in docks.glb
  // are named for them, so there is no translation table.
  expect(dockPrefix("wood", 2)).toBe("Dock_wood");
  expect(dockPrefix("brick", 2)).toBe("Dock_brick");
  expect(dockPrefix("sheep", 2)).toBe("Dock_sheep");
  expect(dockPrefix("wheat", 2)).toBe("Dock_wheat");
  expect(dockPrefix("ore", 2)).toBe("Dock_ore");
});

test("a 3:1 harbour takes the general-market dock rather than none", () => {
  // The 3:1 has a family of its own rather than a bare pier.
  expect(dockPrefix("none", 3)).toBe("Dock_generic");
  // Ratio wins over resource, the same way the sign decides it.
  expect(dockPrefix("wood", 3)).toBe("Dock_generic");
});

// `seaSide` is shared, so these two guards hold `planPorts` to the same
// promise.
test("a harbour with no adjacent sea is skipped rather than placed at NaN", () => {
  const landlocked: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    { hex: { q: 1, r: -1 }, res: "ore", num: 5 },
  ];
  expect(planPorts([harbor], landlocked)).toEqual([]);
});

test("a malformed harbour with fewer than two vertices is skipped", () => {
  const bad = { verts: [{ q: 0, r: 0, side: 0 }], ratio: 3, res: "none" } as unknown as Harbor;
  expect(planPorts([bad], tiles)).toEqual([]);
});

test("every trade flies its own ratio sign", () => {
  // Keyed on the engine's resource names (`sheep` and `wheat`, not `wool` and
  // `grain`): a mismatch makes the prefix miss and the subset come back empty.
  // Pin all five.
  expect(wedgePrefix("wood", 2)).toBe("Hwedge_wood");
  expect(wedgePrefix("brick", 2)).toBe("Hwedge_brick");
  expect(wedgePrefix("sheep", 2)).toBe("Hwedge_sheep");
  expect(wedgePrefix("wheat", 2)).toBe("Hwedge_wheat");
  expect(wedgePrefix("ore", 2)).toBe("Hwedge_ore");
});

test("a generic harbour flies the 3:1 sign", () => {
  expect(wedgePrefix("none", 3)).toBe("Hwedge_3to1");
  // Ratio wins over resource: a 3:1 is generic whatever else the row says.
  expect(wedgePrefix("wood", 3)).toBe("Hwedge_3to1");
});

test("the sign rides the dock, carrying no placement of its own", () => {
  // The sign is modelled on the pier, so it is instanced at the dock's
  // placement with no offset arithmetic to drift from the art. Only the
  // rotation is the sign's own (see the ratio-orientation tests below).
  const [port] = planPorts([harbor], tiles);
  expect(port.position.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(port.rotationY ?? NaN)).toBe(true);
  expect(port.scale).toBeGreaterThan(0);
});

// --- Ratio orientation ------------------------------------------------
//
// One sea hex ringed by land, with a harbour on each of its six edges, so the
// six dock rotations come from the geometry rather than written by hand.
const ringTiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "sea", num: 0 },
  { hex: { q: 1, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 0, r: 1 }, res: "brick", num: 5 },
  { hex: { q: -1, r: 1 }, res: "sheep", num: 6 },
  { hex: { q: -1, r: 0 }, res: "wheat", num: 9 },
  { hex: { q: 0, r: -1 }, res: "ore", num: 4 },
  { hex: { q: 1, r: -1 }, res: "wood", num: 10 },
];
const ringHarbors: Harbor[] = hexEdges({ q: 0, r: 0 }).map((e) => ({
  verts: [e.a, e.b],
  ratio: 3,
  res: "none",
}));

/**
 * Which way the ratio's glyphs point on screen, in world (x, z), for a sign
 * drawn at Y rotation `y`.
 *
 * The glyphs stand along the sign's local -x (see SIGN_UPRIGHT_Y), and a Y
 * rotation of `y` sends local -x to (-cos y, sin y). World -z is the top of
 * the screen, so a readable ratio has a negative z here and an upside-down
 * one a positive z.
 */
function glyphUp(y: number): [number, number] {
  return [-Math.cos(y), Math.sin(y)];
}

/** Angle between the ratio's up axis and the top of the screen, in degrees. */
function tiltDeg(y: number): number {
  const [x, z] = glyphUp(y);
  return (Math.abs(Math.atan2(x, -z)) * 180) / Math.PI;
}

test("all six edge directions produce the six hex-aligned dock rotations", () => {
  const docks = planPorts(ringHarbors, ringTiles);
  expect(docks).toHaveLength(6);
  const sixtieths = docks.map((d) => Math.round(((d.rotationY ?? 0) * 180) / Math.PI / 60));
  // Multiples of 60 degrees, all six distinct: a hex centre to an edge
  // midpoint and nothing else.
  expect(sixtieths.every((n) => Number.isInteger(n))).toBe(true);
  expect(new Set(sixtieths.map((n) => ((n % 6) + 6) % 6)).size).toBe(6);
});

test("a fixed sign orientation leaves half the harbours upside down", () => {
  // At the dock's own rotation, the three harbours whose piers point back
  // toward the camera carry their ratios pointing down the screen.
  const upsideDown = planPorts(ringHarbors, ringTiles).filter(
    (d) => glyphUp(d.rotationY ?? 0)[1] > 0,
  );
  expect(upsideDown).toHaveLength(3);
});

test("every harbour's ratio reads the right way up", () => {
  for (const dock of planPorts(ringHarbors, ringTiles)) {
    const sign = signPlacement(dock);
    const [, z] = glyphUp(sign.rotationY ?? 0);
    expect(z).toBeLessThan(0); // pointing up the screen, not down it
    // Dock rotations are multiples of 60 and upright is an odd multiple of
    // 90, so 30 degrees off is the best possible, and every one achieves it,
    // so the board reads as a set.
    expect(tiltDeg(sign.rotationY ?? 0)).toBeCloseTo(30, 6);
  }
});

test("the sign is spun in place, not turned about the hex centre", () => {
  // A third of a turn maps the equilateral wedge onto itself, so the sign is
  // still the same triangle on the same pier: its centroid has not moved and
  // its rotation differs from the dock's by a multiple of 120 degrees.
  for (const dock of planPorts(ringHarbors, ringTiles)) {
    const sign = signPlacement(dock);
    const scale = dock.scale ?? 1;
    const pivot = (p: typeof dock | typeof sign): [number, number] => {
      const y = p.rotationY ?? 0;
      const c = scale * SIGN_PIVOT_X;
      return [p.position[0] + c * Math.cos(y), p.position[2] - c * Math.sin(y)];
    };
    const [dx, dz] = pivot(dock);
    const [sx, sz] = pivot(sign);
    expect(sx).toBeCloseTo(dx, 9);
    expect(sz).toBeCloseTo(dz, 9);
    expect(sign.scale).toBe(dock.scale);

    const thirds = (((sign.rotationY ?? 0) - (dock.rotationY ?? 0)) * 3) / (2 * Math.PI);
    expect(thirds).toBeCloseTo(Math.round(thirds), 9);
  }
});

test("a sign already upright is left where it is", () => {
  // Nothing to gain from turning it; the check keeps the search from picking
  // an arbitrary member of the three.
  expect(signRotationY(SIGN_UPRIGHT_Y)).toBeCloseTo(SIGN_UPRIGHT_Y, 9);
  const at = signPlacement({ position: [3, 0, -4], rotationY: SIGN_UPRIGHT_Y, scale: 2 });
  expect(at.position).toEqual([3, 0, -4]);
});

test("every harbour gets a dock, one per water hex", () => {
  // A second harbour on its own water hex, (0,-1), the other sea tile. Both
  // docks must appear: generation, validation and the map builder keep two
  // harbours off one hex, so the layer does not drop either.
  const other: Harbor = {
    verts: [
      { q: 0, r: 0, side: 0 },
      { q: 0, r: -1, side: 1 },
    ],
    ratio: 3,
    res: "none",
  };
  const docks = planPorts([harbor, other], tiles);
  expect(docks).toHaveLength(2);
  const keys = docks.map((d) => `${d.hex.q},${d.hex.r}`);
  expect(new Set(keys).size).toBe(2);
});

test("a dock's water is laid down on the ocean's lattice, not the dock's", () => {
  // The wave relief is carved into the tile, so a sheet turned with the pier
  // put every harbour in a hexagon of sea running across the rest. Five of
  // the six dock rotations are wrong for water; the half turn is right for
  // all six.
  const docks = planPorts(ringHarbors, ringTiles);
  const water = portWaterPlacements(docks);
  expect(water).toHaveLength(docks.length);
  expect(docks.filter((d) => d.rotationY !== TILE_ROTATION_Y)).toHaveLength(5);
  for (const w of water) expect(w.rotationY).toBe(TILE_ROTATION_Y);
});

test("only the facing is taken off a dock's water", () => {
  // It must stand where the dock stands and fill the cell the same way, or the
  // sheet separates from the pier.
  for (const [i, w] of portWaterPlacements(planPorts(ringHarbors, ringTiles)).entries()) {
    const dock = planPorts(ringHarbors, ringTiles)[i];
    expect(w.position).toEqual(dock.position);
    expect(w.scale).toBe(dock.scale);
  }
});

// --- Dressing vs. sign ------------------------------------------------
//
// The two harbour layers differ in one thing: the dressing must not be
// instanced at `signPlacement`.

test("the dressing rides the dock's own placement, not the sign's spin", () => {
  // A hall, a roof or a heap is authored on the pier in the dock's frame, so
  // its placement is the dock's: position, facing and the water tile's scale.
  for (const dock of planPorts(ringHarbors, ringTiles)) {
    const at = groupDockArt([dock]).get(dockPrefix(dock.res, dock.ratio));
    expect(at).toHaveLength(1);
    expect(at![0]).toEqual({
      position: dock.position,
      rotationY: dock.rotationY,
      scale: dock.scale,
    });
  }
});

test("the sign's spin displaces it on four of six orientations", () => {
  // How far off it would be. Spinning about the wedge's centroid is a rigid
  // displacement for anything not three-fold symmetric, and the pivot is well
  // out along the pier: 2 * r * sin(60deg) with r the scaled pivot distance,
  // 2.34 world units, over three quarters of a hex (HEX_SIZE 3). Roofs adrift
  // in open water.
  const thrown = 2 * LATTICE_SCALE * Math.abs(SIGN_PIVOT_X) * Math.sin(Math.PI / 3);
  const docks = planPorts(ringHarbors, ringTiles);
  const spun = docks.filter((d) => signPlacement(d).rotationY !== d.rotationY);
  // Only the two orientations whose land side is away from the camera are
  // already upright; the other four are affected.
  expect(spun).toHaveLength(4);
  for (const dock of spun) {
    const sign = signPlacement(dock);
    const moved = Math.hypot(
      sign.position[0] - dock.position[0],
      sign.position[2] - dock.position[2],
    );
    expect(moved).toBeCloseTo(thrown, 6);
    expect(moved).toBeCloseTo(2.336, 3);
  }
});

test("each harbour's dressing is grouped under its own trade", () => {
  // One dock model carries all six trades, so the grouping decides which
  // subset each harbour draws: six trades, six keys, one placement each.
  const trades: Pick<Harbor, "ratio" | "res">[] = [
    { ratio: 2, res: "wood" },
    { ratio: 2, res: "brick" },
    { ratio: 2, res: "sheep" },
    { ratio: 2, res: "wheat" },
    { ratio: 2, res: "ore" },
    { ratio: 3, res: "none" },
  ];
  const mixed: Harbor[] = hexEdges({ q: 0, r: 0 }).map((e, i) => ({
    verts: [e.a, e.b],
    ...trades[i],
  }));
  const byArt = groupDockArt(planPorts(mixed, ringTiles));
  expect([...byArt.keys()].sort()).toEqual([
    "Dock_brick",
    "Dock_generic",
    "Dock_ore",
    "Dock_sheep",
    "Dock_wheat",
    "Dock_wood",
  ]);
  for (const at of byArt.values()) expect(at).toHaveLength(1);
});

test("the sign is still spun upright", () => {
  // Moving the grouping out of the renderer must not undo the spin that keeps
  // the far half of a round board's ratios upright.
  const at = groupSignArt(planPorts(ringHarbors, ringTiles)).get("Hwedge_3to1");
  expect(at).toHaveLength(6);
  for (const sign of at!) {
    expect(glyphUp(sign.rotationY ?? 0)[1]).toBeLessThan(0);
    expect(tiltDeg(sign.rotationY ?? 0)).toBeCloseTo(30, 6);
  }
});

test("a board with no harbours groups to nothing", () => {
  // Board3D guards on ports.length, but the helper should handle an empty
  // board too.
  expect(groupDockArt([]).size).toBe(0);
  expect(groupSignArt([]).size).toBe(0);
});
