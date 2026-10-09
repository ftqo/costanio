// What is pointable on the 3D board right now, and where it is in the world.
//
// One list drives both the ghost markers and click snapping, so they cannot
// drift apart.
//
// Membership is not re-derived here: `lib/boardTargets` turns (mode,
// view.legal) into the clickable key sets, and this module only adds world
// positions.
import type { Edge, FullView, Hex, Vertex } from "@/lib/types";
import { islandsExt, knightsExt, raidersExt } from "@/lib/types";
import { edgeKey, enumerateGrid, hexKey, vertexKey } from "@/lib/hexgeo";
import {
  allowedEdgeKeys,
  allowedHexKeys,
  allowedVertexKeys,
  hexClickable,
  inspectableEdgeKeys,
  inspectableVertexKeys,
  type BoardMode,
} from "@/lib/boardTargets";
import { planInfoTargets, type PieceInfo } from "@/lib/boardInfo";
import { edgeToWorld, hexToWorld, vertexToWorld, type Vec3 } from "./coords";
import { SURFACE } from "./seating";
import { anyVertexToWorld } from "./layers/wagons";
import { riderHurryPayable } from "@/lib/raiders";

/**
 * How far above the surface a marker floats. Small, so it reads as painted on
 * the board; markers draw without depth testing anyway (see `markers.ts`).
 */
const MARKER_LIFT = 0.02;

/** The y a marker of each kind is drawn at. */
export const MARKER_Y = {
  /** Vertices and edge midpoints sit in the gutter between tiles. */
  gutter: SURFACE.gutter + MARKER_LIFT,
  /** A hex marker covers the tile's own face. */
  land: SURFACE.land + MARKER_LIFT,
} as const;

/**
 * A pointable spot: its geometry (`kind`), the callback a hit fires
 * (`action`), and its position. A vertex hit can mean "place a settlement",
 * "this is my knight" or "open this spot's menu"; only the mode decides. `kind`
 * drives snapping and sizing; `action` is what the board does.
 */
export type PickTarget =
  | { kind: "vertex"; action: "vertex" | "knight" | "inspect"; key: string; v: Vertex; pos: Vec3 }
  | { kind: "edge"; action: "edge" | "ship" | "inspect"; key: string; e: Edge; pos: Vec3 }
  | { kind: "hex"; action: "hex"; key: string; h: Hex; pos: Vec3 };

/**
 * What a mode points at: the geometry its key set is keyed by, or `null` for a
 * mode with no key set. Unlike `PickTarget["kind"]`, this is known before any
 * target is produced.
 */
export type TargetShape = "edge" | "vertex" | "hex" | null;

/**
 * The shape each board mode points at.
 *
 * A total `Record` over `BoardMode`, so a new mode without a row fails the
 * build (a Set would accept a missing mode silently). One table works because
 * the shapes are disjoint: a mode targets edges, vertices or hexes, never two.
 *
 * Exported for the test that pins every row; only a test catches a row that is
 * present and wrong.
 */
export const MODE_SHAPE: Record<BoardMode, TargetShape> = {
  road: "edge",
  ship: "edge",
  bridge: "edge",
  fishbridge: "edge",
  fishedge: "edge",
  shipmove: "edge",
  pedge: "edge",
  diplomatto: "edge",
  // Wagons: where an owed barbarian may be put down.
  wagonbarbarian: "edge",
  // Explorers: where a ship may be built, and the one step it may sail.
  cargoship: "edge",
  sail: "edge",

  settlement: "vertex",
  city: "vertex",
  wall: "vertex",
  knight: "vertex",
  knightmove: "vertex",
  // Wagons: where this seat's wagon may drive to.
  wagonmove: "vertex",
  pvertex: "vertex",
  deserterplace: "vertex",
  relocateknight: "vertex",
  barbariandowngrade: "vertex",
  // Which of your cities takes a newly earned metropolis. The engine places it
  // itself when only one city qualifies, so the board is only asked when
  // several do.
  metropolispick: "vertex",
  // Explorers: the intersection a harbour settlement takes, and the corner a
  // ship works from where it stands.
  harbour: "vertex",
  shipact: "vertex",

  robber: "hex",
  phex: "hex",
  pirate: "hex",
  inventor1: "hex",
  inventor2: "hex",
  chaserobber: "hex",
  chasepirate: "hex",

  // Raiders. Both rider modes are edges (a rider stands on a path; with
  // Knights, a knight becomes an edge piece in Raiders). The hex modes are
  // hexes.
  riderplace: "edge",
  ridermove: "edge",
  raiderhex: "hex",
  treasonfrom: "hex",
  treasonto: "hex",

  // `none` offers nothing. `inspect` is null because its targets are not a key
  // set over the grid; it walks the legal lists in its own pass below.
  none: null,
  inspect: null,
};

export interface PlanTargetsOptions {
  view: FullView;
  mode: BoardMode;
  moveFromVertex?: Vertex;
  moveFromEdge?: Edge;
  /** Inventor step 1's hex, excluded from step 2's targets. See BoardProps.moveFromHex. */
  moveFromHex?: Hex;
  progressCard?: string | null;
  /** Explorers: the chosen ship and armed job. See BoardProps.moveFromShip. */
  moveFromShip?: number | null;
  shipJob?: string | null;
  /** The caller handles ship taps (Islands): the viewer's own ships become pointable. */
  ships?: boolean;
  /** The caller handles knight taps (Knights): the viewer's own knights become pointable. */
  knights?: boolean;
}

/**
 * Everything the viewer may point at, in draw order.
 *
 * Own ships and knights come last so a placement marker wins a tie with a piece
 * at the same spot: the marker is what the player sees.
 */
export function planPickTargets(opts: PlanTargetsOptions): PickTarget[] {
  const {
    view,
    mode,
    moveFromVertex,
    moveFromEdge,
    moveFromHex,
    progressCard,
    moveFromShip,
    shipJob,
  } = opts;
  const legal = view.legal;
  const out: PickTarget[] = [];
  const seen = new Set<string>();

  const addVertex = (v: Vertex, action: "vertex" | "knight" | "inspect") => {
    const key = `${action}:${vertexKey(v)}`;
    if (seen.has(key)) return;
    seen.add(key);
    // A Wagons plaza is a vertex with a third side at its hex's centre, which
    // `vertexToWorld` does not know; `anyVertexToWorld` places both.
    const [x, , z] = anyVertexToWorld(v);
    out.push({ kind: "vertex", action, key, v, pos: [x, MARKER_Y.gutter, z] });
  };
  const addEdge = (e: Edge, action: "edge" | "ship" | "inspect") => {
    const key = `${action}:${edgeKey(e)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const [x, , z] = edgeToWorld(e);
    out.push({ kind: "edge", action, key, e, pos: [x, MARKER_Y.gutter, z] });
  };
  const addHex = (h: Hex) => {
    const key = `hex:${hexKey(h)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const [x, , z] = hexToWorld(h);
    out.push({ kind: "hex", action: "hex", key, h, pos: [x, MARKER_Y.land, z] });
  };

  const shape = MODE_SHAPE[mode];

  // Only key-set modes need the grid. Inspect and the piece passes use the
  // legal lists, and hexes come from the board's tile list.
  const needsGrid = shape === "edge" || shape === "vertex";
  const grid = needsGrid ? enumerateGrid(view.board.tiles) : { vertices: [], edges: [] };

  if (shape === "edge") {
    // A null set means no legal data and renders nothing: a stale build mode is
    // not a licence to click anywhere.
    const allowed = allowedEdgeKeys(
      mode,
      legal,
      moveFromEdge,
      progressCard,
      raidersExt(view),
      moveFromShip,
      mode === "ridermove" ? riderHurryPayable(view) : true,
    );
    const extraEdges =
      mode === "riderplace"
        ? (raidersExt(view)?.pend?.edges ?? [])
        : mode === "wagonbarbarian"
          ? (legal?.barbarian_edges ?? [])
          : [];
    const edges = [...grid.edges];
    const known = new Set(edges.map(edgeKey));
    for (const e of extraEdges)
      if (!known.has(edgeKey(e))) {
        edges.push(e);
        known.add(edgeKey(e));
      }
    if (allowed) for (const e of edges) if (allowed.has(edgeKey(e))) addEdge(e, "edge");
  }

  if (shape === "vertex") {
    const allowed = allowedVertexKeys(
      mode,
      legal,
      moveFromVertex,
      progressCard,
      moveFromShip,
      shipJob,
    );
    // As the edge branch widens for riders and barbarians: a wagon may step onto
    // a plaza, which is not a board corner and so is not in the grid.
    const vertices = [...grid.vertices];
    if (mode === "wagonmove") {
      const known = new Set(vertices.map(vertexKey));
      for (const v of legal?.wagon_steps ?? [])
        if (!known.has(vertexKey(v))) {
          vertices.push(v);
          known.add(vertexKey(v));
        }
    }
    if (allowed) for (const v of vertices) if (allowed.has(vertexKey(v))) addVertex(v, "vertex");
  }

  if (shape === "hex") {
    const islands = islandsExt(view);
    const allowed = allowedHexKeys(mode, legal, progressCard, moveFromHex, raidersExt(view));
    for (const t of view.board.tiles) {
      const ok = allowed
        ? allowed.has(hexKey(t.hex))
        : hexClickable(mode, t, view.board.robber, islands?.pirate);
      if (ok) addHex(t.hex);
    }
  }

  if (mode === "inspect") {
    // Unlike the 2D board, these are drawn at rest rather than revealed on
    // hover: on a perspective scene hover-to-discover means scrubbing the
    // surface, and the set is small (only places you can act).
    //
    // Because they are visible, affordability is checked here. Build modes are
    // already gated by disabled build buttons (Game.tsx `canSettlement`), but
    // inspect is the default on your turn and `view.legal` is positional only,
    // so an unaffordable spot would otherwise promise an action and open a
    // menu saying "Nothing to do here." Such spots are hidden rather than
    // dimmed; the build shelf's disabled buttons already show their recipes.
    const knightsState = knightsExt(view);
    const ownKnights = (knightsState?.knights ?? [])
      .filter((k) => k.owner === view.viewer)
      .map((k) => k.v);
    for (const e of inspectableEdgeKeysAsEdges(view)) addEdge(e, "inspect");
    for (const v of inspectableVertexList(view, ownKnights)) addVertex(v, "inspect");
  }

  // Own pieces, pointable in any mode the way they are on the 2D board.
  if (opts.ships) {
    // Only ships that can move: Game.tsx's ship handler ignores a ship with no
    // move, and a hover that promises nothing reads as a dropped click.
    // `ship_moves` is keyed by `from`; an empty `to` means the ship is pinned.
    const movable = new Set<string>();
    for (const g of legal?.ship_moves ?? []) {
      if (g.to.length) movable.add(edgeKey(g.from));
    }
    for (const s of islandsExt(view)?.ships ?? []) {
      if (s.owner === view.viewer && movable.has(edgeKey(s.e))) addEdge(s.e, "ship");
    }
  }
  if (opts.knights) {
    for (const k of knightsExt(view)?.knights ?? []) {
      if (k.owner === view.viewer) addVertex(k.v, "knight");
    }
  }

  return out;
}

/**
 * A described spot, placed in the world: a `PickTarget` without the action.
 * Snapped by the same maths (picking.ts `Snappable`) but never dispatched;
 * hovering describes the spot, and a click does whatever the action list says
 * there, if anything.
 */
export interface InfoPick {
  kind: "vertex" | "hex";
  key: string;
  pos: Vec3;
  info: PieceInfo;
}

/**
 * Everything on the board worth describing, positioned. Membership and
 * wording come from `lib/boardInfo`; this adds world coordinates, using the
 * same `*ToWorld` functions the pieces are drawn with.
 */
export function planInfoPicks(view: FullView): InfoPick[] {
  const out: InfoPick[] = [];
  for (const t of planInfoTargets(view)) {
    if (t.kind === "vertex" && t.v) {
      const [x, , z] = vertexToWorld(t.v);
      out.push({ kind: "vertex", key: t.key, pos: [x, MARKER_Y.gutter, z], info: t.info });
    } else if (t.kind === "hex" && t.h) {
      const [x, , z] = hexToWorld(t.h);
      out.push({ kind: "hex", key: t.key, pos: [x, MARKER_Y.land, z], info: t.info });
    }
  }
  return out;
}

/**
 * The inspectable edges as edges rather than keys. `inspectableEdgeKeys`
 * returns keys; here the objects are wanted, so this walks the same `legal`
 * lists instead of parsing keys back.
 */
function inspectableEdgeKeysAsEdges(view: FullView): Edge[] {
  const legal = view.legal;
  const raiders = raidersExt(view);
  const want = inspectableEdgeKeys(legal, raiders);
  if (!want.size) return [];
  const out: Edge[] = [];
  const seen = new Set<string>();
  const take = (e: Edge) => {
    const k = edgeKey(e);
    if (!want.has(k) || seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  for (const e of legal?.roads ?? []) take(e);
  for (const e of legal?.ships ?? []) take(e);
  for (const g of legal?.ship_moves ?? []) take(g.from);
  // Movable riders come from the module's own view, not `legal`; without them
  // the first step of a rider move would be unclickable.
  for (const m of raiders?.rider_moves ?? []) take(m.from);
  return out;
}

/** As above, for vertices. */
function inspectableVertexList(view: FullView, ownKnights: Vertex[]): Vertex[] {
  const legal = view.legal;
  const want = inspectableVertexKeys(legal, ownKnights);
  if (!want.size) return [];
  const out: Vertex[] = [];
  const seen = new Set<string>();
  const take = (v: Vertex) => {
    const k = vertexKey(v);
    if (!want.has(k) || seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  for (const v of legal?.settlements ?? []) take(v);
  for (const v of legal?.cities ?? []) take(v);
  for (const v of legal?.knights ?? []) take(v);
  for (const v of legal?.walls ?? []) take(v);
  for (const v of ownKnights) take(v);
  return out;
}
