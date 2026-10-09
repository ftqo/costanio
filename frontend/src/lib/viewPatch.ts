// One board change, as data, with the two operations on it: apply it to a
// view, and test whether a view already has it.
//
// The optimistic overlay (never draw a piece twice), the in-flight registry
// (did a command settle) and the event fold (a redelivered event is a no-op)
// all ask "has this landed?", and answer it here so they cannot disagree.
//
// No rules live here. A patch states what is on the board, not whether it was
// legal; every caller builds it from a server event or a target the server
// published in `legal`. The one rule-like step is shrinking `legal`: a
// location that just received a piece leaves every placement set. Under-
// offering costs a round trip; over-offering costs an error toast. Nothing
// here ever adds a target.
import type { KnightsExt, Edge, FullView, Hex, IslandsExt, LegalTargets, Vertex } from "./types";
import { edgeKey, hexKey, vertexKey } from "./hexgeo";

/** One board change: a piece arrives, a piece moves, or a marker moves. */
export type ViewPatch =
  | { kind: "settlement"; v: Vertex; owner: number }
  | { kind: "city"; v: Vertex; owner: number }
  | { kind: "road"; e: Edge; owner: number }
  | { kind: "ship"; e: Edge; owner: number }
  | { kind: "ship_move"; from: Edge; to: Edge }
  | {
      kind: "knight";
      v: Vertex;
      owner: number;
      level: number;
      active: boolean;
      /** Placed active but locked for this turn (the Deserter replacement). */
      fresh?: boolean;
    }
  | { kind: "knight_move"; from: Vertex; to: Vertex }
  | { kind: "knight_remove"; v: Vertex }
  | { kind: "knight_activate"; v: Vertex }
  /** `to` is the level the knight ends at. The event does not state it (the
   * engine applies `k.Level++`), so the caller reads the current level off the
   * view and adds one; the applied-check needs it. */
  | { kind: "knight_promote"; v: Vertex; to: number }
  | { kind: "wall"; v: Vertex; owner: number }
  | { kind: "robber"; hex: Hex }
  | { kind: "pirate"; hex: Hex };

/** The vertex a patch is about, when it is about one. Used for `legal` pruning. */
function patchVertex(p: ViewPatch): Vertex | null {
  switch (p.kind) {
    case "settlement":
    case "city":
    case "knight":
    case "wall":
      return p.v;
    case "knight_move":
      return p.to;
    default:
      return null;
  }
}

/**
 * The hex a patch is about, when it is about one: marker moves (robber,
 * pirate, chase). Needed so `pruneLegal` withdraws hex targets too.
 */
function patchHex(p: ViewPatch): Hex | null {
  switch (p.kind) {
    case "robber":
    case "pirate":
      return p.hex;
    default:
      return null;
  }
}

/** The edge a patch is about, when it is about one. */
function patchEdge(p: ViewPatch): Edge | null {
  switch (p.kind) {
    case "road":
    case "ship":
      return p.e;
    case "ship_move":
      return p.to;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Has it landed?
// ---------------------------------------------------------------------------

/**
 * Whether `view` already reflects `patch`.
 *
 * Tests the observable result, not which event or command produced it, so an
 * optimistic apply, a folded event and a snapshot all read the same and the
 * overlay expires against whichever arrives first.
 *
 * A patch whose module state is absent (a Knights patch in a base game) is
 * never satisfied; the in-flight TTL is the backstop, as for a dropped frame.
 */
export function patchApplied(view: FullView, patch: ViewPatch): boolean {
  const islands = view.ext?.islands as IslandsExt | undefined;
  const knightsState = view.ext?.cak as KnightsExt | undefined;
  switch (patch.kind) {
    case "settlement":
      return view.buildings.some((b) => vertexKey(b.v) === vertexKey(patch.v));
    case "city":
      // A city is the only patch that finds its vertex occupied and is still
      // outstanding: the settlement it upgrades is standing there.
      return view.buildings.some((b) => vertexKey(b.v) === vertexKey(patch.v) && b.city);
    case "road":
      return view.roads.some((r) => edgeKey(r.e) === edgeKey(patch.e));
    case "ship":
      return (islands?.ships ?? []).some((s) => edgeKey(s.e) === edgeKey(patch.e));
    case "ship_move":
      return (islands?.ships ?? []).some((s) => edgeKey(s.e) === edgeKey(patch.to));
    case "knight":
      return (knightsState?.knights ?? []).some((k) => vertexKey(k.v) === vertexKey(patch.v));
    case "knight_move":
      // An in-place "move" is the engine's deactivation (see knights/decide.go),
      // so the source must be empty too, or an unsent move would read as
      // settled.
      if (vertexKey(patch.from) === vertexKey(patch.to)) {
        return !(knightsState?.knights ?? []).some(
          (k) => vertexKey(k.v) === vertexKey(patch.to) && k.active,
        );
      }
      return (
        (knightsState?.knights ?? []).some((k) => vertexKey(k.v) === vertexKey(patch.to)) &&
        !(knightsState?.knights ?? []).some((k) => vertexKey(k.v) === vertexKey(patch.from))
      );
    case "knight_remove":
      return !(knightsState?.knights ?? []).some((k) => vertexKey(k.v) === vertexKey(patch.v));
    case "knight_activate":
      return (knightsState?.knights ?? []).some(
        (k) => vertexKey(k.v) === vertexKey(patch.v) && k.active,
      );
    case "knight_promote":
      // Compare against the level the promotion ends at. `level > 1` would be
      // true before a 2 -> 3 promotion is sent (maxKnightLevel is 3,
      // engine/knights/knights.go), so the patch would draw nothing and settle at once.
      return (knightsState?.knights ?? []).some(
        (k) => vertexKey(k.v) === vertexKey(patch.v) && k.level >= patch.to,
      );
    case "wall":
      return (knightsState?.walled ?? []).some((v) => vertexKey(v) === vertexKey(patch.v));
    case "robber":
      // A board with no robber yet reads as not applied (the TTL backstops
      // it) rather than throwing over frame ordering.
      return !!view.board?.robber && hexKey(view.board.robber) === hexKey(patch.hex);
    case "pirate":
      return !!islands?.pirate && hexKey(islands.pirate) === hexKey(patch.hex);
  }
}

// ---------------------------------------------------------------------------
// Put it in
// ---------------------------------------------------------------------------

/** Shallow-clone the Islands ext so a patch never mutates a shared view. */
function withIslands(view: FullView, fn: (x: IslandsExt) => IslandsExt): FullView {
  const cur = view.ext?.islands as IslandsExt | undefined;
  if (!cur) return view;
  return { ...view, ext: { ...view.ext, islands: fn(cur) } };
}

function withKnights(view: FullView, fn: (x: KnightsExt) => KnightsExt): FullView {
  const cur = view.ext?.cak as KnightsExt | undefined;
  if (!cur) return view;
  return { ...view, ext: { ...view.ext, cak: fn(cur) } };
}

/**
 * The view with `patch` in it, and the patch's location withdrawn from `legal`.
 *
 * Returns `view` unchanged when the patch is already applied, so repeated
 * folds and overlay redraws are idempotent and a no-op produces no new object
 * and no render.
 */
export function applyPatch(view: FullView, patch: ViewPatch): FullView {
  if (patchApplied(view, patch)) return view;
  const placed = place(view, patch);
  const legal = pruneLegal(placed.legal, patch);
  return legal === placed.legal ? placed : { ...placed, legal };
}

function place(view: FullView, patch: ViewPatch): FullView {
  switch (patch.kind) {
    case "settlement":
      return {
        ...view,
        buildings: [...view.buildings, { v: patch.v, owner: patch.owner, city: false }],
      };
    case "city": {
      // An upgrade of a standing settlement (base build_city) or a city placed
      // on an empty vertex (Knights round-two setup). Read off the board.
      const at = view.buildings.findIndex((b) => vertexKey(b.v) === vertexKey(patch.v));
      if (at < 0)
        return {
          ...view,
          buildings: [...view.buildings, { v: patch.v, owner: patch.owner, city: true }],
        };
      const buildings = view.buildings.slice();
      buildings[at] = { ...buildings[at], city: true };
      return { ...view, buildings };
    }
    case "road":
      return { ...view, roads: [...view.roads, { e: patch.e, owner: patch.owner }] };
    case "ship":
      return withIslands(view, (x) => ({
        ...x,
        ships: [...x.ships, { e: patch.e, owner: patch.owner }],
      }));
    case "ship_move":
      return withIslands(view, (x) => ({
        ...x,
        ships: x.ships.map((s) =>
          edgeKey(s.e) === edgeKey(patch.from) ? { ...s, e: patch.to } : s,
        ),
      }));
    case "knight":
      return withKnights(view, (x) => ({
        ...x,
        knights: [
          ...x.knights,
          {
            v: patch.v,
            owner: patch.owner,
            // The engine writes 0 for the default (same as omitted on the
            // wire); the board needs the real tier.
            level: patch.level || 1,
            active: patch.active,
            // As the engine writes it (engine/knights/apply.go, EvKnightBuilt):
            // `active && fresh`. Only the Deserter replacement sets `fresh`: it
            // arrives active mid-Action-phase and may not act until the taker's
            // next turn.
            freshly_activated: patch.active && patch.fresh === true,
            // EvKnightBuilt leaves PromotedThisTurn false, so a new knight is
            // promotable this turn.
            promoted_this_turn: false,
          },
        ],
      }));
    case "knight_move":
      return withKnights(view, (x) => ({
        ...x,
        knights: x.knights.map((k) =>
          vertexKey(k.v) === vertexKey(patch.from)
            ? // Moving deactivates: engine/knights/apply.go's EvKnightMoved sets
              // Active and FreshlyActivated false, including the in-place
              // chase-robber case.
              { ...k, v: patch.to, active: false, freshly_activated: false }
            : k,
        ),
      }));
    case "knight_remove":
      return withKnights(view, (x) => ({
        ...x,
        knights: x.knights.filter((k) => vertexKey(k.v) !== vertexKey(patch.v)),
      }));
    case "knight_activate":
      return withKnights(view, (x) => ({
        ...x,
        knights: x.knights.map((k) =>
          vertexKey(k.v) === vertexKey(patch.v)
            ? { ...k, active: true, freshly_activated: true }
            : k,
        ),
      }));
    case "knight_promote":
      return withKnights(view, (x) => ({
        ...x,
        knights: x.knights.map((k) =>
          vertexKey(k.v) === vertexKey(patch.v)
            ? // The cap is per knight, so spend it on this one; otherwise
              // Promote stays lit on it until the round trip returns.
              { ...k, level: patch.to, promoted_this_turn: true }
            : k,
        ),
      }));
    case "wall":
      return withKnights(view, (x) => ({ ...x, walled: [...(x.walled ?? []), patch.v] }));
    case "robber":
      return { ...view, board: { ...view.board, robber: patch.hex } };
    case "pirate":
      return withIslands(view, (x) => ({ ...x, pirate: patch.hex }));
  }
}

// ---------------------------------------------------------------------------
// Withdraw the spot
// ---------------------------------------------------------------------------

function withoutVertex(vs: Vertex[] | undefined, v: Vertex): Vertex[] | undefined {
  if (!vs) return vs;
  const out = vs.filter((x) => vertexKey(x) !== vertexKey(v));
  return out.length === vs.length ? vs : out;
}

function withoutHex(hs: Hex[] | undefined, h: Hex): Hex[] | undefined {
  if (!hs) return hs;
  const out = hs.filter((x) => hexKey(x) !== hexKey(h));
  return out.length === hs.length ? hs : out;
}

function withoutEdge(es: Edge[] | undefined, e: Edge): Edge[] | undefined {
  if (!es) return es;
  const out = es.filter((x) => edgeKey(x) !== edgeKey(e));
  return out.length === es.length ? es : out;
}

/**
 * `legal` with the patch's location removed from every set that could place a
 * piece there.
 *
 * Only ever shrinks (see the header). The cities set is pruned too, though a
 * fresh settlement does become a legal city: the next snapshot will say so.
 *
 * `undefined` sets stay `undefined` and an untouched `legal` is returned by
 * identity, so a patch that prunes nothing produces no new object.
 *
 * Hex sets are included: the board's hex targets come only from these sets
 * (`targets.ts`'s `allowedHexKeys`), and a landed robber whose hex was still
 * offered left its hover ghost standing on the real piece until the server
 * frame arrived.
 */
export function pruneLegal(
  legal: LegalTargets | undefined,
  patch: ViewPatch,
): LegalTargets | undefined {
  if (!legal) return legal;
  const v = patchVertex(patch);
  const e = patchEdge(patch);
  const h = patchHex(patch);
  if (!v && !e && !h) return legal;
  const next: LegalTargets = { ...legal };
  if (v) {
    next.settlements = withoutVertex(legal.settlements, v);
    next.cities = withoutVertex(legal.cities, v);
    next.knights = withoutVertex(legal.knights, v);
    next.walls = withoutVertex(legal.walls, v);
    next.deserter_placements = withoutVertex(legal.deserter_placements, v);
    next.knight_relocations = withoutVertex(legal.knight_relocations, v);
    next.barbarian_downgrades = withoutVertex(legal.barbarian_downgrades, v);
    next.metropolis_cities = withoutVertex(legal.metropolis_cities, v);
  }
  if (e) {
    next.roads = withoutEdge(legal.roads, e);
    next.ships = withoutEdge(legal.ships, e);
  }
  if (h) {
    // All four whichever move this was: the robber and pirate cannot share a
    // hex, and pruning a set the patch could not have filled is harmless.
    next.robber_hexes = withoutHex(legal.robber_hexes, h);
    next.pirate_hexes = withoutHex(legal.pirate_hexes, h);
    next.chase_robber_hexes = withoutHex(legal.chase_robber_hexes, h);
    next.chase_pirate_hexes = withoutHex(legal.chase_pirate_hexes, h);
  }
  // A move consumes the mover: the source and its per-source destination
  // list are withdrawn too.
  if (patch.kind === "ship_move")
    next.ship_moves = legal.ship_moves?.filter((g) => edgeKey(g.from) !== edgeKey(patch.from));
  if (patch.kind === "knight_move")
    next.knight_moves = legal.knight_moves?.filter(
      (g) => vertexKey(g.from) !== vertexKey(patch.from),
    );
  const changed = (Object.keys(next) as (keyof LegalTargets)[]).some((k) => next[k] !== legal[k]);
  return changed ? next : legal;
}
