// What the Explorers layer draws, and the two things it must never draw.
//
//   REDACTION   a hex the viewer has not been told about must not be repainted.
//               An unrevealed hex arrives masked as `fog`; drawing a goldfield
//               there would leak the module's secret. Asserted against a frame
//               the engine cannot produce, since that is what a guard is for.
//   FITTING     a cargo piece lands in the recess cut for it, on both hosts, at
//               the size both share. The numbers live in `harborArt.test.ts`,
//               `vesselArt.test.ts` and `cargoArt.test.ts`; this checks the
//               renderer agrees.
//   DEGRADING   every plan draws nothing rather than throwing when its field is
//               missing (a client one deploy behind the server).
import { test, expect } from "vitest";
import {
  tileArtOverrides,
  planCargoShips,
  planCorsair,
  planQuays,
  planHolds,
  planMarkers,
  explorersFrame,
  planShoalHauls,
  SHOAL_HAUL_Y,
  SHOAL_DRAWN_PREFIXES,
  SHOAL_CUT_PREFIXES,
  EXPLORERS_TILE_FOR_KIND,
  SLOT_LONG,
  SLOT_FLOOR_Y,
  QUAY_SLOT_X,
  QUAY_NEAR_EDGE_X,
  SMALL_PITCH,
  SHIP_ABREAST,
} from "./explorers";
import { hexKey, hexToWorld, vertexToWorld, edgeToWorld, edgeRotationY } from "../coords";
import { SURFACE } from "../seating";
import { MODULE_SCALE, PIECE_SCALE } from "../pieceArt";
import { OCEAN_MAX_Y } from "../ocean";
import { LATTICE_SCALE } from "../coords";
import { TILES } from "../manifest.generated";
import { hexEdges, makeEdge, hexesInRadius } from "@/lib/hexgeo";
import { boardFitPoints } from "../scene";
import {
  EXPLORERS_KIND,
  type BoardTile,
  type Edge,
  type FullView,
  type Hex,
  type Vertex,
} from "@/lib/types";

// A scrap of board: one land hex with water to its north, so its north corner is
// a coastal anchor, plus one hex of each thing the pool can turn out to be and
// one the viewer has been told nothing about.
//
//   (0, 0)   wood, the home island
//   (0, -1)  sea, north-west of it
//   (1, -1)  sea, north-east of it
//   (2, 0)   gold, revealed as a gold field
//   (3, 0)   sea, revealed as a shoal
//   (4, 0)   none, revealed as a spice farm
//   (5, 0)   fog, revealed by nobody
const tiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 0, r: -1 }, res: "sea", num: 0 },
  { hex: { q: 1, r: -1 }, res: "sea", num: 0 },
  { hex: { q: 2, r: 0 }, res: "gold", num: 4 },
  { hex: { q: 3, r: 0 }, res: "sea", num: 0 },
  { hex: { q: 4, r: 0 }, res: "none", num: 0 },
  { hex: { q: 5, r: 0 }, res: "fog", num: 0 },
];

/** The coastal corner: the north corner of the home hex. */
const anchor: Vertex = { q: 0, r: 0, side: 0 };
/** A sea edge, taken off a real hex so it is one the grid can produce. */
const seaEdge: Edge = hexEdges({ q: 0, r: -1 })[0];

/** The thinnest FullView these functions actually read. */
function viewWith(ext?: Record<string, unknown>, board = tiles): FullView {
  return {
    board: { tiles: board, robber: { q: 0, r: 0 }, harbors: [] },
    ext,
  } as unknown as FullView;
}

function explorers(state: Record<string, unknown>): Record<string, unknown> {
  return { explorers: state };
}

const revealedAll = [
  { h: { q: 2, r: 0 }, region: 0, kind: EXPLORERS_KIND.gold },
  { h: { q: 3, r: 0 }, region: 0, kind: EXPLORERS_KIND.shoal, shoal: 3 },
  { h: { q: 4, r: 0 }, region: 1, kind: EXPLORERS_KIND.spice, village: 0 },
];

const noCargo = {};

function ship(id: number, owner: number, e: Edge, hold: Record<string, number> = noCargo) {
  return { id, owner, e, hold, left: 2 };
}

/** Unit direction of a piece's own +x once it has been turned by `rotationY`. */
function facing(rotationY: number): [number, number] {
  return [Math.cos(rotationY), -Math.sin(rotationY)];
}

// --- degrading ------------------------------------------------------------

test("a board with no Explorers module draws none of it", () => {
  const view = viewWith(undefined);
  expect(tileArtOverrides(view).files.size).toBe(0);
  expect(tileArtOverrides(view).land.size).toBe(0);
  expect(planCargoShips(view)).toEqual([]);
  expect(planCorsair(view)).toEqual([]);
  expect(planQuays(view)).toEqual([]);
  expect(planHolds(view)).toEqual([]);
  expect(planMarkers(view)).toEqual([]);
});

test("an ext with nothing in it draws nothing either", () => {
  // A client one deploy behind the server: the module is present and every
  // field this layer reads is missing. Each plan must default, not throw.
  const view = viewWith(explorers({}));
  expect(tileArtOverrides(view).files.size).toBe(0);
  expect(planCargoShips(view)).toEqual([]);
  expect(planCorsair(view)).toEqual([]);
  expect(planQuays(view)).toEqual([]);
  expect(planHolds(view)).toEqual([]);
  expect(planMarkers(view)).toEqual([]);
});

// --- the tiles, and the redaction -----------------------------------------

test("a revealed special draws its own tile, and only that hex", () => {
  const view = viewWith(explorers({ revealed: revealedAll, fog: [{ q: 5, r: 0 }] }));
  const { files } = tileArtOverrides(view);
  expect(files.get(hexKey({ q: 2, r: 0 }))).toBe(TILES["goldfield"].file);
  expect(files.get(hexKey({ q: 3, r: 0 }))).toBe(TILES["sea_shoal"].file);
  expect(files.get(hexKey({ q: 4, r: 0 }))).toBe(TILES["spice"].file);
  // The manifest's own file, so a re-export that renames a tile fails here
  // instead of 404ing in a game.
  for (const kind of [EXPLORERS_KIND.gold, EXPLORERS_KIND.shoal, EXPLORERS_KIND.spice]) {
    expect(TILES[EXPLORERS_TILE_FOR_KIND[kind]]).toBeDefined();
  }
  // Nothing else on the board is touched, the home island included.
  expect(files.size).toBe(3);
  expect(files.has(hexKey({ q: 0, r: 0 }))).toBe(false);
});

test("a fogged hex never draws a special, whatever the frame claims", () => {
  // Redaction, against a frame the engine cannot produce: `revealed` carries a
  // hex only once it is turned over, so a hex still `fog` can never be in it.
  // If one is, the board draws the cloud; a gold field there would leak what
  // the module keeps hidden.
  const view = viewWith(
    explorers({
      revealed: [...revealedAll, { h: { q: 5, r: 0 }, region: 2, kind: EXPLORERS_KIND.gold }],
    }),
  );
  const { files, land } = tileArtOverrides(view);
  expect(files.has(hexKey({ q: 5, r: 0 })), "a fog hex was repainted").toBe(false);
  expect(land.has(hexKey({ q: 5, r: 0 }))).toBe(false);
  expect(files.size).toBe(3);
});

test("an unrevealed hex is repainted by nothing here", () => {
  // The ordinary case: the pool is fog and `revealed` is empty, as on every
  // board before the first ship sails.
  const view = viewWith(explorers({ fog: [{ q: 5, r: 0 }], revealed: [] }));
  expect(tileArtOverrides(view).files.size).toBe(0);
});

test("the shoal is water and the two land specials are land", () => {
  // `land` tells gap sand, beaches and tile scale that a hex is drawn as land
  // whatever its resource. The shoal is the ocean's own hull, so claiming it
  // as land would put a beach ring round a hex in open sea.
  const { land } = tileArtOverrides(viewWith(explorers({ revealed: revealedAll })));
  expect(land.has(hexKey({ q: 2, r: 0 })), "the gold field").toBe(true);
  expect(land.has(hexKey({ q: 4, r: 0 })), "the spice farm").toBe(true);
  expect(land.has(hexKey({ q: 3, r: 0 })), "the shoal is not land").toBe(false);
});

test("a special named on the wrong shape of terrain is refused", () => {
  // Guards against a malformed frame, like `oasisHex`: a land slab on open
  // water or a sea tile on the island is a hole, and off the board is the same
  // case. A plain tile is the better failure.
  const wrong = viewWith(
    explorers({
      revealed: [
        { h: { q: 3, r: 0 }, region: 0, kind: EXPLORERS_KIND.gold },
        { h: { q: 2, r: 0 }, region: 0, kind: EXPLORERS_KIND.shoal },
        { h: { q: 9, r: 9 }, region: 0, kind: EXPLORERS_KIND.spice },
      ],
    }),
  );
  expect(tileArtOverrides(wrong).files.size).toBe(0);
});

// --- the fleet ------------------------------------------------------------

test("a cargo ship lies along its edge, in its owner's colour", () => {
  const view = viewWith(explorers({ ships: [ship(1, 2, seaEdge)] }));
  const [drawn] = planCargoShips(view);
  const [x, , z] = edgeToWorld(seaEdge);
  expect(drawn.position[0]).toBeCloseTo(x, 6);
  expect(drawn.position[2]).toBeCloseTo(z, 6);
  expect(drawn.rotationY).toBeCloseTo(edgeRotationY(seaEdge), 6);
  expect(drawn.owner).toBe(2);
  // Keyed by what the piece is, so the next build recognises it at a new edge.
  expect(drawn.key).toContain("cargo");
});

test("two ships on one edge lie abreast rather than inside each other", () => {
  // The rules let a pair share a sea edge, and the hull's 0.28 beam is sized
  // for that. The offset is across the edge (along it, they would look like
  // two ships on two edges) and wide enough that the hulls do not touch.
  const view = viewWith(explorers({ ships: [ship(7, 0, seaEdge), ship(3, 1, seaEdge)] }));
  const drawn = planCargoShips(view);
  expect(drawn.length).toBe(2);
  // Ordered by ship id, so a replay puts the same ship on the same side.
  expect(drawn.map((d) => d.owner)).toEqual([1, 0]);

  const gap = Math.hypot(
    drawn[0].position[0] - drawn[1].position[0],
    drawn[0].position[2] - drawn[1].position[2],
  );
  expect(gap).toBeCloseTo(2 * SHIP_ABREAST * MODULE_SCALE.cargo, 6);
  const BEAM = 0.28;
  expect(gap, "two hulls interpenetrate").toBeGreaterThan(BEAM * MODULE_SCALE.cargo);

  // Perpendicular to the hull: the offset is along the ship's own +z.
  const [fx, fz] = facing(edgeRotationY(seaEdge));
  const dot =
    (drawn[0].position[0] - drawn[1].position[0]) * fx +
    (drawn[0].position[2] - drawn[1].position[2]) * fz;
  expect(dot, "the pair is strung out along the edge").toBeCloseTo(0, 6);
});

test("the corsair stands on its hex and is tinted only when told", () => {
  const nameless = viewWith(explorers({ pirate: { q: 3, r: 0 }, pirate_by: 3 }));
  const [drawn] = planCorsair(nameless);
  const [x, , z] = hexToWorld({ q: 3, r: 0 });
  expect(drawn.position[0]).toBeCloseTo(x, 6);
  expect(drawn.position[2]).toBeCloseTo(z, 6);
  // `pirate_by` is who owes an activation, not whose ship it is; tinting with
  // it would say the seat being robbed owns the robber.
  expect(drawn.owner, "pirate_by was mistaken for the owner").toBe(-1);

  const owned = viewWith(explorers({ pirate: { q: 3, r: 0 }, pirate_by: 3, pirate_owner: 2 }));
  expect(planCorsair(owned)[0].owner).toBe(2);
  // No ship on the board means no corsair.
  expect(planCorsair(viewWith(explorers({ pirate_owner: 2 })))).toEqual([]);
});

// --- the harbours ---------------------------------------------------------

const harbour = { v: anchor, owner: 1, basin: noCargo };

test("the quay stands at its vertex, clear of the building", () => {
  // An add-on: the placement is the vertex, like a settlement's, because the
  // building there comes from the player's own set and the quay stands beside
  // it. The art keeps them apart: `harbors.glb` begins 0.5 out along its +x,
  // so at drawn scale it is a full unit from the vertex and clears the largest
  // shipped city. Offsetting the placement too would push the dock a second
  // unit out (see `harborArt.test.ts`).
  const view = viewWith(explorers({ harbours: [harbour] }));
  const [drawn] = planQuays(view);
  const [vx, , vz] = vertexToWorld(anchor);
  expect(drawn.position[0]).toBeCloseTo(vx, 6);
  expect(drawn.position[2]).toBeCloseTo(vz, 6);
  expect(drawn.owner).toBe(1);

  // The stock city's drawn radius, the widest thing any shipped set puts on a
  // vertex, measured in `harborArt.test.ts`. The gap between them reads as
  // ground between dock and house.
  const nearEdge = QUAY_NEAR_EDGE_X * MODULE_SCALE.harbor;
  const STOCK_CITY_DRAWN = 0.834;
  const MIN_GAP = 0.1;
  expect(nearEdge, "the quay is drawn over the building").toBeGreaterThan(
    STOCK_CITY_DRAWN + MIN_GAP,
  );
  // And the factor is the one that clearance was priced at.
  expect(MODULE_SCALE.harbor).toBe(PIECE_SCALE.settlement);
});

test("the quay faces the water its vertex touches", () => {
  // Seaward is the art's +x; a quay square to the board would put its deck on
  // dry land at most island corners. This anchor has two sea hexes to its
  // north, so the dock faces between them.
  const [drawn] = planQuays(viewWith(explorers({ harbours: [harbour] })));
  const [vx, , vz] = vertexToWorld(anchor);
  let dx = 0;
  let dz = 0;
  for (const h of [
    { q: 0, r: -1 },
    { q: 1, r: -1 },
  ] as Hex[]) {
    const [hx, , hz] = hexToWorld(h);
    dx += hx - vx;
    dz += hz - vz;
  }
  const len = Math.hypot(dx, dz);
  const [fx, fz] = facing(drawn.rotationY ?? 0);
  expect(fx).toBeCloseTo(dx / len, 6);
  expect(fz).toBeCloseTo(dz / len, 6);
});

test("a harbour with no water beside it draws no quay", () => {
  // Not produced by the rules (harbours are built on coastal anchors). A dock
  // on dry land is worse than none, since the settlement beside it still shows
  // the owner. Same as the weir.
  const inland: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
    { hex: { q: 0, r: -1 }, res: "wood", num: 5 },
    { hex: { q: 1, r: -1 }, res: "brick", num: 6 },
  ];
  const view = viewWith(explorers({ harbours: [{ ...harbour, basin: { settler: 1 } }] }), inland);
  expect(planQuays(view)).toEqual([]);
  expect(planHolds(view), "its basin was drawn without it").toEqual([]);
});

// --- what rides in them ---------------------------------------------------

test("a ship's cargo stands on the hold floor, over the edge midpoint", () => {
  const view = viewWith(explorers({ ships: [ship(1, 2, seaEdge, { haul: 1 })] }));
  const [drawn] = planHolds(view);
  expect(drawn.part).toBe("haul");
  // The hold is centred on the edge midpoint, so a piece dropped into it lands
  // over the edge rather than over the water beside it.
  const [x, , z] = edgeToWorld(seaEdge);
  expect(drawn.position[0]).toBeCloseTo(x, 6);
  expect(drawn.position[2]).toBeCloseTo(z, 6);
  // ...and on the recess floor, at the ship's scale since the recess is part
  // of the ship. The hull's base is 0, so its origin is on the mean water line.
  expect(drawn.position[1]).toBeCloseTo(SURFACE.sea + MODULE_SCALE.cargo * SLOT_FLOOR_Y, 6);
  // The haul lies along the hold, which on a ship is the hull's own axis.
  expect(drawn.rotationY).toBeCloseTo(edgeRotationY(seaEdge), 6);
});

test("a basin's cargo stands in the basin, turned a quarter", () => {
  // The same slot, transposed. Both recesses are 0.34 by 0.18 with a floor
  // 0.06 up, so a figure moved between them neither resizes nor floats. The
  // quay's long axis runs across its deck and the ship's along its hull, so
  // long pieces turn a quarter turn; hence one test each.
  const view = viewWith(explorers({ harbours: [{ ...harbour, basin: { haul: 1 } }] }));
  const [quay] = planQuays(view);
  const [drawn] = planHolds(view);
  const [vx, , vz] = vertexToWorld(anchor);
  // The basin sits 0.71 out along the quay's +x, at the quay's scale, since
  // the offset belongs to the quay's art.
  const [fx, fz] = facing(quay.rotationY ?? 0);
  const out = QUAY_SLOT_X * MODULE_SCALE.harbor;
  expect(drawn.position[0]).toBeCloseTo(vx + fx * out, 6);
  expect(drawn.position[2]).toBeCloseTo(vz + fz * out, 6);
  expect(drawn.position[1]).toBeCloseTo(SURFACE.gutter + MODULE_SCALE.harbor * SLOT_FLOOR_Y, 6);
  expect(drawn.rotationY! - (quay.rotationY ?? 0)).toBeCloseTo(-Math.PI / 2, 6);
});

test("a piece is the same size in a hold as it is on a quay", () => {
  // Cargo does not take its host's factor: the ship is drawn at 1.15 and the
  // quay at 2.0, so a settler inheriting either would grow by three quarters
  // when unloaded. It uses the tighter one, filling the hold and sitting
  // comfortably in the larger basin.
  expect(MODULE_SCALE.cargoPiece).toBe(MODULE_SCALE.cargo);
  expect(MODULE_SCALE.cargoPiece).toBeLessThanOrEqual(MODULE_SCALE.harbor);
});

test("two small pieces sit along the slot at their art's pitch", () => {
  const view = viewWith(explorers({ ships: [ship(1, 0, seaEdge, { crew: 2 })] }));
  const drawn = planHolds(view);
  expect(drawn.map((d) => d.part)).toEqual(["crew", "crew"]);

  const [ax, , az] = drawn[0].position;
  const [bx, , bz] = drawn[1].position;
  const gap = Math.hypot(ax - bx, az - bz);
  expect(gap).toBeCloseTo(SMALL_PITCH.crew * MODULE_SCALE.cargoPiece, 6);

  // Along the hull, the slot's long axis on a ship; two crew across the 0.18
  // would stand in the coaming.
  const [fx, fz] = facing(edgeRotationY(seaEdge));
  expect(Math.abs((ax - bx) * fx + (az - bz) * fz), "the pair is not along the slot").toBeCloseTo(
    gap,
    6,
  );

  // ...and both are inside the recess, measured from its centre at the
  // ship's scale; a pair that overhung would sit on the deck.
  const [cx, , cz] = edgeToWorld(seaEdge);
  const halfSlot = (SLOT_LONG / 2) * MODULE_SCALE.cargo;
  for (const p of drawn) {
    expect(Math.hypot(p.position[0] - cx, p.position[2] - cz)).toBeLessThan(halfSlot);
  }
});

test("two spice sacks lean together rather than standing apart", () => {
  // The pitch is the piece's, not the slot's: sacks are 0.14 across and
  // overlap at 0.125 so a pile reads as a pile (`cargoArt.test.ts`). Crew keep
  // a gap between them.
  const view = viewWith(explorers({ ships: [ship(1, 0, seaEdge, { spice: 2 })] }));
  const drawn = planHolds(view);
  const gap = Math.hypot(
    drawn[0].position[0] - drawn[1].position[0],
    drawn[0].position[2] - drawn[1].position[2],
  );
  expect(gap).toBeCloseTo(SMALL_PITCH.spice * MODULE_SCALE.cargoPiece, 6);
  expect(SMALL_PITCH.spice).toBeLessThan(SMALL_PITCH.crew);
});

test("cargo is owned by whoever is carrying it", () => {
  // Figures are seat-tinted and goods are not, but both are planned with an
  // owner: the hold shows whose haul it is, and the caller needs the seat to
  // tint the settler beside it.
  const view = viewWith(
    explorers({
      ships: [ship(1, 3, seaEdge, { settler: 1 })],
      harbours: [{ ...harbour, owner: 4, basin: { crew: 1 } }],
    }),
  );
  const drawn = planHolds(view);
  expect(drawn.find((d) => d.part === "settler")!.owner).toBe(3);
  expect(drawn.find((d) => d.part === "crew")!.owner).toBe(4);
});

test("an empty hold and an empty basin draw nothing at all", () => {
  const view = viewWith(explorers({ ships: [ship(1, 0, seaEdge)], harbours: [harbour] }));
  expect(planCargoShips(view).length, "the ship itself is still drawn").toBe(1);
  expect(planQuays(view).length).toBe(1);
  expect(planHolds(view)).toEqual([]);
});

// --- the missions ---------------------------------------------------------

test("the mission markers are not on the board, so none is planned", () => {
  // A mission track has no hex, vertex or edge; it runs in the UI beside the
  // board. Markers parked at the map's edge could be mistaken for reachable
  // spots. See `planMarkers`.
  const view = viewWith(
    explorers({
      seats: [{ track: [3, 1, 0], mission_vp: 4 }],
      leaders: [0, -1, -1],
    }),
  );
  expect(planMarkers(view)).toEqual([]);
});

// --- the grid the fixtures are built on -----------------------------------

test("the fixture's anchor really is a coastal corner of the home hex", () => {
  // If the vertex stopped touching those two sea hexes, the quay tests would
  // pass while measuring nothing.
  const edge = makeEdge(anchor, { q: 0, r: 0, side: 1 });
  expect(edge).toBeDefined();
  const [vx, , vz] = vertexToWorld(anchor);
  const [hx, , hz] = hexToWorld({ q: 0, r: 0 });
  expect(vz, "the north corner is toward the back of the board").toBeLessThan(hz);
  expect(vx).toBeCloseTo(hx, 6);
});

// --- the frame -------------------------------------------------------------

/** An Explorers-shaped board: sea on the rim at `radius`, land inside it. */
function framed(radius: number, rimRes = "sea"): FullView {
  const board = hexesInRadius(radius).map((h) => {
    const d = (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2;
    return { hex: h, res: d === radius ? rimRes : d === radius - 1 ? "fog" : "wood", num: 0 };
  });
  return {
    board: { tiles: board, radius, robber: { q: 0, r: 0 }, harbors: [] },
    ext: { explorers: {} },
  } as unknown as FullView;
}

test("the camera frames the rim by centres and the interior as tiles", () => {
  // The rim is sea on every hex at distance R by construction. Fitting its
  // corners left a ring of empty water round the map at four fifths of the
  // available size.
  const view = framed(5);
  const { play, rim } = explorersFrame(view);
  expect(rim).toHaveLength(30);
  expect(play).toHaveLength(61);
  expect(play.every((t) => t.res !== "sea")).toBe(true);
  // The fit reaches a ring less far out, and every rim hex centre (the
  // furthest a ship or the pirate can stand) is still inside it.
  const far = (pts: { x: number; z: number }[]) =>
    Math.max(...pts.map((p) => Math.hypot(p.x, p.z)));
  const before = far(boardFitPoints(view.board.tiles));
  const after = far(boardFitPoints(play).concat(rim.map(([x, , z]) => ({ x, z }) as never)));
  expect(after).toBeLessThan(before * 0.9);
  for (const [x, , z] of rim) expect(Math.hypot(x, z)).toBeLessThanOrEqual(after + 1e-9);
});

test("every other board keeps its framing exactly", () => {
  // No module state: not an Explorers board, whatever its rim looks like.
  const plain = { ...framed(3), ext: undefined } as unknown as FullView;
  expect(explorersFrame(plain)).toEqual({ play: plain.board.tiles, rim: [] });
  // An Explorers board whose rim is not all water is framed as before, rather
  // than cropping land.
  const odd = framed(3, "wood");
  expect(explorersFrame(odd)).toEqual({ play: odd.board.tiles, rim: [] });
});

// --- the shoal -------------------------------------------------------------

test("a stocked shoal shows its haul, at its middle, clear of the swell", () => {
  // `hauls` names the shoals the fishing roll stocked; the board must draw a
  // haul on each.
  const view = viewWith({ explorers: { hauls: [{ q: 3, r: 0 }] } });
  const hauls = planShoalHauls(view);
  expect(hauls).toHaveLength(1);
  const [x, , z] = hexToWorld({ q: 3, r: 0 });
  expect(hauls[0].position[0]).toBeCloseTo(x, 9);
  expect(hauls[0].position[2]).toBeCloseTo(z, 9);
  // Above the crest in the world frame: the crest is authored in the water
  // tile's frame and the tile is drawn LATTICE_SCALE up.
  expect(SHOAL_HAUL_Y).toBeGreaterThan(OCEAN_MAX_Y * LATTICE_SCALE);
  // Nobody's, and keyed, so one that appears mid-game drops in.
  expect(hauls[0].owner).toBe(-1);
  expect(hauls[0].key).toBeTruthy();
});

test("a haul is drawn only on a water hex this board carries", () => {
  // Frames the engine cannot produce: a haul on land, on a hex not on the
  // board, and on no hex at all.
  const bad = viewWith({
    explorers: {
      hauls: [
        { q: 0, r: 0 },
        { q: 9, r: 9 },
        { q: 5, r: 0 },
      ],
    },
  });
  expect(planShoalHauls(bad)).toEqual([]);
  expect(planShoalHauls(viewWith({ explorers: {} }))).toEqual([]);
  expect(planShoalHauls(viewWith())).toEqual([]);
});

test("the shoal's cut keeps the sea and drops only the flat", () => {
  // The sea's hull and wave sheet must survive the cut or the shoal is a hole
  // in the ocean; only the two wet-sand parts are dropped.
  expect(SHOAL_DRAWN_PREFIXES).toContain("Hex_");
  expect(SHOAL_DRAWN_PREFIXES).toContain("Shoal_waves");
  for (const cut of SHOAL_CUT_PREFIXES) {
    expect(SHOAL_DRAWN_PREFIXES.some((p) => cut.startsWith(p))).toBe(false);
  }
});
