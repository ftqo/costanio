import { hexEdges, hexVertices } from "@/lib/hexgeo";
import type { Edge, FullView, Hex, Resource } from "@/lib/types";

// The default map as a fixture: one of every piece kind, legally placed.
//
// dev/board-live.html (`make art-live`) composes this with the engine's dumped
// tiles; both are radius-2, so the fixture's vertices exist on that board.
//
// The standard opening board: nineteen land tiles, the desert in the middle,
// the classic number sequence spiralling in from a corner, nine harbours.
// Built here so it needs no backend. No sea tiles, as in a real base game,
// where the ocean is all backdrop; that case exercises the coastline and
// harbour markers.

const RADIUS = 2;

function hexDistance(h: Hex): number {
  return (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2;
}

/** The radius-2 board, ordered ring by ring from the outside in. */
function spiral(): Hex[] {
  const all: Hex[] = [];
  for (let q = -RADIUS; q <= RADIUS; q++) {
    for (let r = -RADIUS; r <= RADIUS; r++) {
      if (Math.abs(q + r) > RADIUS) continue;
      all.push({ q, r });
    }
  }
  // Outer ring first, each ring clockwise from due north, the order numbers
  // are traditionally dealt in.
  return all.sort((a, b) => {
    const ring = hexDistance(b) - hexDistance(a);
    if (ring !== 0) return ring;
    return Math.atan2(a.q + a.r / 2, -a.r) - Math.atan2(b.q + b.r / 2, -b.r);
  });
}

// 4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, and the desert, which goes in the
// middle and takes no number.
const RESOURCES = [
  "ore",
  "sheep",
  "wood",
  "wheat",
  "brick",
  "sheep",
  "brick",
  "wheat",
  "wood",
  "wheat",
  "wood",
  "ore",
  "wood",
  "ore",
  "brick",
  "sheep",
  "sheep",
  "wheat",
];

/** The classic sequence, dealt along the spiral and skipping the desert. */
const NUMBERS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

const order = spiral();
const centre = order[order.length - 1];

const tiles = order.map((hex, i) =>
  i === order.length - 1
    ? { hex, res: "none", num: 0 }
    : { hex, res: RESOURCES[i], num: NUMBERS[i] },
);

const land = new Set(order.map((h) => `${h.q},${h.r}`));

/**
 * Every outward-facing edge of the outer ring: land on one side, open sea on
 * the other. The harbours sit on these, and they are the only edges where both
 * a road and a ship are legal, which `legal` below uses for a spot with two
 * things to preview.
 */
function coastalEdges(): { hex: Hex; edge: ReturnType<typeof hexEdges>[number] }[] {
  const coastal: { hex: Hex; edge: ReturnType<typeof hexEdges>[number] }[] = [];
  for (const hex of order) {
    if (hexDistance(hex) !== RADIUS) continue;
    for (const [dir, edge] of hexEdges(hex).entries()) {
      // hexEdges runs clockwise from the north corner, so edge 0 spans N to NE
      // and the hex across it is the NE neighbour, not the N one. Off by one,
      // interior edges count as coastal and planPorts drops every harbour.
      const across = [
        { q: hex.q + 1, r: hex.r - 1 },
        { q: hex.q + 1, r: hex.r },
        { q: hex.q, r: hex.r + 1 },
        { q: hex.q - 1, r: hex.r + 1 },
        { q: hex.q - 1, r: hex.r },
        { q: hex.q, r: hex.r - 1 },
      ][dir];
      if (!land.has(`${across.q},${across.r}`)) coastal.push({ hex, edge });
    }
  }
  return coastal;
}

/** Nine harbours, spaced around the coast on outward-facing land edges. */
function harbors() {
  const coastal = coastalEdges();
  // `Resource`, not `string`, so the compiler rejects names the game doesn't
  // have (e.g. the retired `"wool"`, which matches no `Dock_*`/`Hwedge_*` art).
  const kinds: [number, Resource][] = [
    [3, "none"],
    [2, "wood"],
    [3, "none"],
    [2, "brick"],
    [3, "none"],
    [2, "wheat"],
    [3, "none"],
    [2, "ore"],
    [2, "sheep"],
  ];
  // Spread nine harbours evenly around however many coastal edges there are.
  const step = coastal.length / kinds.length;
  return kinds.map(([ratio, res], i) => {
    const { edge } = coastal[Math.floor(i * step)];
    return { verts: [edge.a, edge.b], ratio, res };
  });
}

// Corners and edges come from the geometry helpers, never hand-written. A
// hex's side 0 and side 1 are its north and south corners, so a hand-written
// "edge" between them runs through the tile. `hexVertices`/`hexEdges` can't
// express a non-edge.
const vAt = (q: number, r: number, i: number) => hexVertices({ q, r })[i];
const eAt = (q: number, r: number, i: number) => hexEdges({ q, r })[i];

/**
 * The end of `e` that is not `from`. `makeEdge` normalises endpoint order, so
 * `.b` is not reliably the other end.
 */
const farEnd = (e: ReturnType<typeof eAt>, from: ReturnType<typeof vAt>) =>
  e.a.q === from.q && e.a.r === from.r && e.a.side === from.side ? e.b : e.a;

/** Where each player has built, so roads and knights can be hung off it. */
const settled = [
  { hex: { q: 1, r: 0 }, corner: 0, owner: 0, city: false },
  { hex: { q: 0, r: 1 }, corner: 3, owner: 1, city: true },
  { hex: { q: -1, r: 1 }, corner: 0, owner: 2, city: false },
  { hex: { q: 1, r: -1 }, corner: 1, owner: 3, city: false },
];

/** The city that has been walled and carries a metropolis. */
const capital = vAt(0, 1, 3);

/**
 * A handful of spots seat 0 may act on, so the page can enter a build mode and
 * show the markers and the ghost piece (lib/board3d/ghost*).
 *
 * `legal` is positional only, as the engine emits it; affordability is the
 * hand's business. Coastal edges are in both `roads` and `ships` because both
 * are legal there, which makes it the one spot whose ghost cycles.
 */
const coast = coastalEdges();
const dualEdges: Edge[] = [coast[1].edge, coast[4].edge, coast[7].edge];

const legal = {
  // Corners of two untouched tiles on opposite sides of the board.
  settlements: [...hexVertices({ q: -2, r: 1 }), ...hexVertices({ q: 0, r: -2 })],
  // Seat 0's own settlement is the one thing it could upgrade.
  cities: [vAt(1, 0, 0)],
  roads: [eAt(1, 0, 1), eAt(1, 0, 2), eAt(2, -1, 3), ...dualEdges],
  ships: dualEdges,
  knights: [vAt(-1, -1, 2), vAt(-1, -1, 3)],
  walls: [],
  ship_moves: [],
  knight_moves: [],
};

const view = {
  seq: 0,
  viewer: 0,
  phase: "play",
  cur: 0,
  legal,
  // Enough of everything to afford every `legal` action: inspect mode hides
  // spots the viewer can't pay for (see planPickTargets).
  players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [0, 9, 9, 9, 9, 9] })),
  board: { radius: RADIUS, tiles, robber: centre, harbors: harbors() },
  buildings: settled.map((b) => ({
    v: vAt(b.hex.q, b.hex.r, b.corner),
    owner: b.owner,
    city: b.city,
  })),
  // One road per built player, on an edge that genuinely touches its building.
  roads: [
    { e: eAt(1, 0, 0), owner: 0 },
    { e: eAt(0, 1, 2), owner: 1 },
    { e: eAt(-1, 1, 5), owner: 2 },
    { e: eAt(1, -1, 1), owner: 3 },
  ],
  // The expansion pieces, so the page shows a Knights + Islands board.
  // Placement is the layers' job (lib/board3d/layers/{islands,knights}.ts);
  // this supplies the state in the shape the server sends.
  ext: {
    islands: {
      // Ring 3 and beyond is the only real sea on a radius-2 board, so the sea
      // edge is out there.
      ships: [
        { e: eAt(0, 3, 0), owner: 0 },
        { e: eAt(0, 3, 1), owner: 0 },
        { e: eAt(3, -1, 3), owner: 3 },
      ],
      ships_left: [12, 15, 15, 13],
      // Open water with no dock on it: a pirate on a dock tile buries the hut.
      pirate: { q: 1, r: 2 },
      moved_ship: false,
    },
    cak: {
      // A knight stands on its owner's network, so each goes on the far end of
      // that player's road (the near end is the building, and a knight can't
      // share its corner). A corner belongs to up to three hexes, so different
      // (hex, index) pairs can name one vertex: hexVertices({2,-1})[4] is
      // hexVertices({1,0})[0], where seat 0 built. The tests compare resolved
      // vertices.
      knights: [
        {
          v: farEnd(eAt(1, 0, 0), vAt(1, 0, 0)),
          owner: 0,
          level: 1,
          active: true,
          freshly_activated: false,
        },
        {
          v: farEnd(eAt(0, 1, 2), capital),
          owner: 1,
          level: 3,
          active: true,
          freshly_activated: false,
        },
        {
          v: farEnd(eAt(-1, 1, 5), vAt(-1, 1, 0)),
          owner: 2,
          level: 2,
          active: false,
          freshly_activated: false,
        },
      ],
      walled: [capital],
      players: [
        { improve: [1, 0, 0], metropolis: [false, false, false], metropolis_at: [] },
        {
          improve: [5, 0, 4],
          metropolis: [true, false, false],
          metropolis_at: [capital, capital, capital],
        },
        { improve: [0, 2, 0], metropolis: [false, false, false], metropolis_at: [] },
        { improve: [0, 0, 1], metropolis: [false, false, false], metropolis_at: [] },
      ],
      merchant: { q: -1, r: 0 },
      // Part way along the seven-step track, so the fleet stands off the coast.
      barbarians: 4,
      attacks: 1,
      decks: [6, 6, 6],
      deserter_victim: -1,
      deserter_taker: -1,
      reloc_player: -1,
    },
  },
} as unknown as FullView;

/** Exported so a test can check the fixture describes a legal board. */
export const previewView = view;
