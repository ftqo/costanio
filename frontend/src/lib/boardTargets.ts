// Pure target-set computation for the live board: which vertices/edges are
// clickable in a given build mode, and which hexes for the robber/pirate. Kept
// out of the renderer so it is testable without a DOM or GPU. The engine is the
// authority; these mirror the server's legal sets so the board never offers an
// illegal target.
import { type Edge, type Hex, type LegalTargets, type RaidersExt, type Vertex } from "./types";
import { edgeKey, hexKey, vertexKey } from "./hexgeo";

export type BoardMode =
  | "none"
  | "inspect"
  | "road"
  // The edge the Fishermen 5-fish spend names. Roads, plus ships under Islands,
  // where the credit buys either.
  | "fishedge"
  // Rivers: the empty bridge sites this seat's network reaches. Its own mode
  // because bridge sites and road edges are disjoint by rule.
  | "bridge"
  // The site the Fishermen 6-fish spend builds its bridge on, with Rivers. The
  // same set as "bridge"; its own mode so a press spends fish, not bricks.
  | "fishbridge"
  | "settlement"
  | "city"
  | "wall"
  | "robber"
  | "ship"
  | "knight"
  | "knightmove"
  | "shipmove"
  | "phex"
  | "pvertex"
  | "pedge"
  | "inventor1"
  | "inventor2"
  | "deserterplace"
  | "relocateknight"
  | "barbariandowngrade"
  | "metropolispick"
  | "pirate"
  | "chaserobber"
  | "chasepirate"
  // Explorers. `harbour` upgrades one of your coastal settlements (and places a
  // starting one in the module's first setup round). `cargoship` is where a
  // ship may be built, beside your harbour settlement. `sail` is one movement
  // point from the picked ship, and `shipact` the corners that ship may work
  // from where it stands: land a crew, take one back, load a haul, found a
  // settlement.
  //
  // `sail` is one step rather than the whole reachable set because a discovery
  // ends a ship's movement.
  | "harbour"
  | "cargoship"
  | "sail"
  | "shipact"
  // There is no `fishrobber`: the 2-fish spend removes the robber from the
  // board and takes no target, so it is sent straight from the fish panel.
  | "diplomatto"
  // ---- Raiders ----
  //
  // These read `ext.raiders`, not `legal`: Raiders pieces live on edges and hexes
  // `LegalTargets` has no field for, so the pick lists travel in the module's
  // own view. They are the only modes that work with no `legal` at all, which
  // is the state a landing interrupt leaves the turn in.
  //
  // Placing one of your riders, from a Muster (the castle's six paths) or a
  // Swift Rider (any free path). One mode; only the server's list differs.
  | "riderplace"
  // Moving one of your riders: from, then to, like `shipmove` and `knightmove`.
  | "ridermove"
  // The hex a landing tie or an Intrigue names. One mode: both are answered by
  // `raiders_pick_hex` against `pend.hexes`; only the prompt differs.
  | "raiderhex"
  // Treason's two halves. These add a move to the plan the panel is building
  // and send nothing; the card sends its whole plan in one message.
  | "treasonfrom"
  | "treasonto"
  // Wagons: where this seat's wagon may drive, and where an owed barbarian may
  // be put. Both come from the engine's priced sets, so no client-side pricing
  // rule is needed.
  | "wagonmove"
  | "wagonbarbarian";

/**
 * The mode the board is put into, given the mode the game screen resolved.
 *
 * Inspect is the default on your own build turn when nothing else claims the
 * board. A forced step (placing the Deserter replacement knight, relocating a
 * displaced knight) can be owed by the current player, and meanwhile the
 * engine's `LegalTargetsFor` returns only that step's vertices, so inspect
 * would offer nothing.
 *
 * Hence this tests the resolved `effMode`, into which the screen has already
 * folded setup / robber / deserter-place / relocate. A forced mode is never
 * armed by a click, so the armed mode stays "none" during one.
 */
export function boardModeFor(effMode: BoardMode, canBuild: boolean): BoardMode {
  return effMode === "none" && canBuild ? "inspect" : effMode;
}

// allowedVertexKeys returns the set of clickable vertex keys for `mode`, or null
// to mean "no legal data, fall back to the full grid". When `legal` is present
// but the relevant set is empty, returns an empty Set (render nothing), not null.
export function allowedVertexKeys(
  mode: BoardMode,
  legal: LegalTargets | undefined,
  moveFromVertex?: Vertex,
  progressCard?: string | null,
  moveFromShip?: number | null,
  shipJob?: string | null,
): Set<string> | null {
  if (!legal) return null;
  switch (mode) {
    case "settlement":
      return new Set((legal.settlements ?? []).map(vertexKey));
    case "city":
      return new Set((legal.cities ?? []).map(vertexKey));
    case "wall":
      // Knights: the viewer's own unwalled cities. The player picks which (it
      // raises that city's discard limit and shields it from the barbarians'
      // first pillage); see `wallShopIntent` in lib/reachability.
      return new Set((legal.walls ?? []).map(vertexKey));
    case "knight":
      return new Set((legal.knights ?? []).map(vertexKey));
    case "knightmove": {
      const to = moveFromVertex
        ? ((legal.knight_moves ?? []).find((g) => vertexKey(g.from) === vertexKey(moveFromVertex))
            ?.to ?? [])
        : [];
      return new Set(to.map(vertexKey));
    }
    case "deserterplace":
      return new Set((legal.deserter_placements ?? []).map(vertexKey));
    case "relocateknight":
      return new Set((legal.knight_relocations ?? []).map(vertexKey));
    case "barbariandowngrade":
      return new Set((legal.barbarian_downgrades ?? []).map(vertexKey));
    case "metropolispick":
      // Knights: which of your metropolis-free cities gets the metropolis just
      // earned (a metropolis city cannot be pillaged). Asked only when more
      // than one qualifies.
      return new Set((legal.metropolis_cities ?? []).map(vertexKey));
    case "wagonmove":
      // Priced by the server: a step is offered only when the wagon can pay the
      // path and its toll (an unpayable toll makes the path illegal).
      return new Set((legal.wagon_steps ?? []).map(vertexKey));
    case "harbour":
      return new Set((legal.harbours ?? []).map(vertexKey));
    case "shipact": {
      // Keyed on the ship rather than the vertex, since two of the seat's ships
      // can touch one corner. Filtered by job too, since two jobs can be legal
      // at one corner and founding spends the ship; the panel arms one job and
      // the board lights only what it can reach.
      const acts = moveFromShip
        ? ((legal.explorer_ships ?? []).find((g) => g.ship === moveFromShip)?.acts ?? [])
        : [];
      return new Set(acts.filter((a) => !shipJob || a.job === shipJob).map((a) => vertexKey(a.v)));
    }
    case "pvertex":
      // Medicine / Intrigue: the vertices that card may target.
      return new Set((legal.progress_targets?.[progressCard ?? ""]?.vertices ?? []).map(vertexKey));
    default:
      return null;
  }
}

// allowedEdgeKeys returns the set of clickable edge keys for `mode`, or null for
// the full-grid fallback. Empty-but-present -> empty Set (render nothing).
export function allowedEdgeKeys(
  mode: BoardMode,
  legal: LegalTargets | undefined,
  moveFromEdge?: Edge,
  progressCard?: string | null,
  /** The Raiders view, for the two edge modes whose picks are not in `legal`. */
  raiders?: RaidersExt,
  moveFromShip?: number | null,
  /**
   * Whether the seat can pay for a rider's hurry (a wheat, or two fish).
   * Hurried destinations are lit only then. Defaults to true for callers that
   * do not know the hand.
   */
  hurryPayable = true,
): Set<string> | null {
  // Before the `legal` guard: a Raiders pending blocks the turn's actions, so
  // `legal` is empty exactly when these modes are needed.
  switch (mode) {
    case "riderplace":
      return new Set((raiders?.pend?.edges ?? []).map(edgeKey));
    case "ridermove": {
      // Like `shipmove`: with no rider chosen this is an empty set, not null,
      // so nothing renders. Choosing a rider is `inspectableEdgeKeys`' job.
      const move = moveFromEdge
        ? (raiders?.rider_moves ?? []).find((m) => edgeKey(m.from) === edgeKey(moveFromEdge))
        : undefined;
      // Hurried destinations are offered alongside free ones; the confirm step
      // states the grain cost.
      return new Set(
        [...(move?.to ?? []), ...(hurryPayable ? (move?.hurry ?? []) : [])].map(edgeKey),
      );
    }
    default:
      break;
  }
  if (!legal) return null;
  switch (mode) {
    case "road":
      return new Set((legal.roads ?? []).map(edgeKey));
    case "ship":
      return new Set((legal.ships ?? []).map(edgeKey));
    case "bridge":
      // `legal.bridges`, not `ext.rivers.sites`: the engine has already applied
      // the connection rule, occupancy and the three-bridge supply.
      return new Set((legal.bridges ?? []).map(edgeKey));
    case "fishbridge":
      return new Set((legal.bridges ?? []).map(edgeKey));
    // The union: the engine validates the 5-fish edge against both
    // (engine/scenarios/fishermen.go). Without Islands `legal.ships` is absent, so
    // this equals `road`.
    case "fishedge":
      return new Set([...(legal.roads ?? []), ...(legal.ships ?? [])].map(edgeKey));
    case "shipmove": {
      const to = moveFromEdge
        ? ((legal.ship_moves ?? []).find((g) => edgeKey(g.from) === edgeKey(moveFromEdge))?.to ??
          [])
        : [];
      return new Set(to.map(edgeKey));
    }
    case "wagonbarbarian":
      // Wagons: where an owed barbarian may go. Any road-able path no barbarian
      // holds, road or not: a barbarian blocks nothing, and landing on a road is
      // how it steals.
      return new Set((legal.barbarian_edges ?? []).map(edgeKey));
    case "cargoship":
      return new Set((legal.ships ?? []).map(edgeKey));
    case "sail": {
      const to = moveFromShip
        ? ((legal.explorer_ships ?? []).find((g) => g.ship === moveFromShip)?.moves ?? [])
        : [];
      return new Set(to.map(edgeKey));
    }
    case "pedge":
      // Diplomat: the open roads it may target as a source.
      return new Set((legal.progress_targets?.[progressCard ?? ""]?.edges ?? []).map(edgeKey));
    case "diplomatto": {
      // Diplomat relocation destinations for the chosen source road (moveFromEdge).
      const to = moveFromEdge
        ? ((legal.progress_targets?.diplomat?.moves ?? []).find(
            (g) => edgeKey(g.from) === edgeKey(moveFromEdge),
          )?.to ?? [])
        : [];
      return new Set(to.map(edgeKey));
    }
    default:
      return null;
  }
}

// hexClickable filters the hex overlay so robber/pirate offer only valid hexes
// (the engine still enforces this; the filter just avoids offering rejects).
// Land robber: any land tile (incl. desert) except its current hex. Pirate: any
// sea tile except the current pirate hex. phex/inventor keep every tile.
export function hexClickable(
  mode: BoardMode,
  tile: { hex: Hex; res: string },
  robber: Hex,
  pirate?: Hex,
): boolean {
  if (mode === "robber" || mode === "chaserobber") {
    // Chase-robber picks a land hex to push the robber to, same as a normal move.
    if (tile.res === "sea") return false;
    return !(tile.hex.q === robber.q && tile.hex.r === robber.r);
  }
  if (mode === "chasepirate") {
    // And chase-pirate picks a sea hex, same as a normal pirate move.
    if (tile.res !== "sea") return false;
    return !pirate || !(tile.hex.q === pirate.q && tile.hex.r === pirate.r);
  }
  if (mode === "pirate") {
    if (tile.res !== "sea") return false;
    return !pirate || !(tile.hex.q === pirate.q && tile.hex.r === pirate.r);
  }
  return true; // phex / inventor1 / inventor2: all tiles
}

// allowedHexKeys returns the backend-computed clickable hex set for a mode, or
// null to mean "no backend set, fall back to hexClickable". The robber/pirate
// destinations come straight from the engine (legal.robber_hexes/pirate_hexes),
// so the board never offers a hex the move would reject (incl. friendly-robber).
export function allowedHexKeys(
  mode: BoardMode,
  legal: LegalTargets | undefined,
  progressCard?: string | null,
  /**
   * Inventor's chosen first hex (`inventor2` only), not offered again: swapping
   * a number with itself is accepted by the engine and wastes the card.
   */
  moveFromHex?: Hex | null,
  /** The Raiders view, for the three hex modes whose picks are not in `legal`. */
  raiders?: RaidersExt,
): Set<string> | null {
  // Before the `legal` guard, as in `allowedEdgeKeys`.
  switch (mode) {
    case "raiderhex":
      return new Set((raiders?.pend?.hexes ?? []).map(hexKey));
    case "treasonfrom":
      return new Set((raiders?.pend?.treason_from ?? []).map(hexKey));
    case "treasonto":
      return new Set((raiders?.pend?.treason_to ?? []).map(hexKey));
    default:
      break;
  }
  if (!legal) return null;
  switch (mode) {
    case "robber":
      return new Set((legal.robber_hexes ?? []).map(hexKey));
    case "pirate":
      return new Set((legal.pirate_hexes ?? []).map(hexKey));
    case "chaserobber":
      return new Set((legal.chase_robber_hexes ?? []).map(hexKey));
    case "chasepirate":
      return new Set((legal.chase_pirate_hexes ?? []).map(hexKey));
    case "phex":
      // Merchant / Bishop: the hexes that card may target.
      return new Set((legal.progress_targets?.[progressCard ?? ""]?.hexes ?? []).map(hexKey));
    case "inventor1":
      return new Set((legal.progress_targets?.inventor?.hexes ?? []).map(hexKey));
    case "inventor2": {
      const ks = new Set((legal.progress_targets?.inventor?.hexes ?? []).map(hexKey));
      if (moveFromHex) ks.delete(hexKey(moveFromHex));
      return ks;
    }
    default:
      return null;
  }
}

// inspectableEdgeKeys / inspectableVertexKeys return the union of all locations
// that have any legal action right now, used by the location-first ("inspect")
// flow to render a clickable overlay everywhere the player could act. Own
// knights are passed in (they're actionable via activate/promote/move even when
// not in any legal placement set). See lib/locationActions for the per-location
// action composition.
export function inspectableEdgeKeys(
  legal: LegalTargets | undefined,
  raiders?: RaidersExt,
): Set<string> {
  const ks = new Set<string>();
  // Riders first, outside the `legal` guard: `rider_moves` is on the module's
  // own view, and makes the first step of a two-step move clickable, like
  // `ship_moves[].from`.
  for (const m of raiders?.rider_moves ?? []) ks.add(edgeKey(m.from));
  if (!legal) return ks;
  for (const e of legal.roads ?? []) ks.add(edgeKey(e));
  for (const e of legal.ships ?? []) ks.add(edgeKey(e));
  for (const e of legal.bridges ?? []) ks.add(edgeKey(e));
  for (const g of legal.ship_moves ?? []) ks.add(edgeKey(g.from));
  return ks;
}

export function inspectableVertexKeys(
  legal: LegalTargets | undefined,
  ownKnights: Vertex[],
): Set<string> {
  const ks = new Set<string>();
  if (legal) {
    for (const v of legal.settlements ?? []) ks.add(vertexKey(v));
    for (const v of legal.cities ?? []) ks.add(vertexKey(v));
    for (const v of legal.knights ?? []) ks.add(vertexKey(v));
    for (const v of legal.walls ?? []) ks.add(vertexKey(v));
  }
  for (const v of ownKnights) ks.add(vertexKey(v));
  return ks;
}
