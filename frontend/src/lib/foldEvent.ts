// Turning an authoritative event into a board change.
//
// `ev` frames arrive one round trip after a command, already persisted. Folding
// them directly saves the snapshot debounce and a second round trip.
//
// Pure wire decoding: every function reads fields the engine wrote and returns
// them in lib/viewPatch's shape. Nothing is inferred. Anything the payload does
// not state is declined (`null` means "wait for the snapshot", which is always
// correct). Two notable cases:
//
//   - `cak_wall_built`, entirely. Go's `omitempty` does nothing on a struct
//     field, so an unset `board.Vertex` marshals as a valid `{"q":0,"r":0,
//     "side":0}`, and the Engineer card (which lets Apply pick
//     firstUnwalledCity) is indistinguishable from a wall at that vertex. The
//     optimistic half is unaffected: lib/cmdPatch still states a wall for
//     `build_wall`, where the client chose the vertex.
//   - any missing or malformed positional field (an older log format or a
//     redaction).
//
// Only geometry is folded. Victory points, longest road, hands and phase flags
// are derived quantities and must not be computed client-side.
import type { ViewPatch } from "./viewPatch";
import { knightsExt, type Edge, type FullView, type Hex, type Vertex } from "./types";
import type { GameEvent } from "./gamestate";

function asVertex(x: unknown): Vertex | null {
  if (!x || typeof x !== "object") return null;
  const v = x as Record<string, unknown>;
  if (typeof v.q !== "number" || typeof v.r !== "number") return null;
  if (v.side !== 0 && v.side !== 1) return null;
  return { q: v.q, r: v.r, side: v.side };
}

function asEdge(x: unknown): Edge | null {
  if (!x || typeof x !== "object") return null;
  const e = x as Record<string, unknown>;
  const a = asVertex(e.a);
  const b = asVertex(e.b);
  return a && b ? { a, b } : null;
}

function asHex(x: unknown): Hex | null {
  if (!x || typeof x !== "object") return null;
  const h = x as Record<string, unknown>;
  if (typeof h.q !== "number" || typeof h.r !== "number") return null;
  return { q: h.q, r: h.r };
}

/** Vertex identity, local to this module so it needs no geometry import. */
function keyOf(v: Vertex): string {
  return `${v.q},${v.r},${v.side}`;
}

function asSeat(x: unknown): number | null {
  return typeof x === "number" && x >= 0 ? x : null;
}

/**
 * The board change an event describes, or null when it describes none we fold.
 *
 * Most of the ~45 event types are about resources, cards, trades and
 * bookkeeping and return null; only a dozen move something on the board.
 */
export function foldEvent(ev: GameEvent, view: FullView): ViewPatch | null {
  const d = (ev.data ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    // A build and its setup-phase twin put the same piece in the same place.
    case "settlement_built":
    case "settlement_placed": {
      const v = asVertex(d.v);
      const owner = asSeat(d.player);
      return v && owner !== null ? { kind: "settlement", v, owner } : null;
    }
    case "city_built":
    case "setup_city_placed": {
      const v = asVertex(d.v);
      const owner = asSeat(d.player);
      return v && owner !== null ? { kind: "city", v, owner } : null;
    }
    case "road_built":
    case "road_placed": {
      const e = asEdge(d.e);
      const owner = asSeat(d.player);
      return e && owner !== null ? { kind: "road", e, owner } : null;
    }
    case "ship_built": {
      const e = asEdge(d.e);
      const owner = asSeat(d.player);
      return e && owner !== null ? { kind: "ship", e, owner } : null;
    }
    case "ship_moved": {
      const from = asEdge(d.from);
      const to = asEdge(d.to);
      return from && to ? { kind: "ship_move", from, to } : null;
    }
    case "robber_moved": {
      const hex = asHex(d.hex);
      return hex ? { kind: "robber", hex } : null;
    }
    case "pirate_moved": {
      const hex = asHex(d.hex);
      return hex ? { kind: "pirate", hex } : null;
    }
    case "cak_knight_built": {
      const v = asVertex(d.v);
      const owner = asSeat(d.player);
      if (!v || owner === null) return null;
      return {
        kind: "knight",
        v,
        owner,
        // Both are omitempty: a normal build sends neither, and Deserter's
        // replacement sends the strength and status of the knight it replaces.
        level: typeof d.level === "number" ? d.level : 0,
        active: d.active === true,
        fresh: d.fresh === true,
      };
    }
    case "cak_knight_moved": {
      const from = asVertex(d.from);
      const to = asVertex(d.to);
      return from && to ? { kind: "knight_move", from, to } : null;
    }
    case "cak_cheap_city": {
      // Medicine's discounted city: always a set vertex, same shape as any
      // other city.
      const v = asVertex(d.v);
      const owner = asSeat(d.player);
      return v && owner !== null ? { kind: "city", v, owner } : null;
    }
    case "cak_knight_removed": {
      // Folded, unlike its siblings: `cak_knight_displaced` moves two knights
      // and may leave one off the board pending relocation, and
      // `cak_knight_relocated` puts it back. That interim is engine state, not
      // a wire position, so both wait for the snapshot.
      const v = asVertex(d.v);
      return v ? { kind: "knight_remove", v } : null;
    }
    case "cak_knight_activated": {
      const v = asVertex(d.v);
      return v ? { kind: "knight_activate", v } : null;
    }
    case "cak_knight_promoted": {
      // The event does not say the resulting level (Apply does `k.Level++`), so
      // it is read off the knight standing there. No knight, no patch.
      const v = asVertex(d.v);
      if (!v) return null;
      const k = (knightsExt(view)?.knights ?? []).find((x) => keyOf(x.v) === keyOf(v));
      return k ? { kind: "knight_promote", v, to: k.level + 1 } : null;
    }
    // cak_wall_built is absent: the wire cannot distinguish a designated city
    // from the engine's board-order fallback. See the header.
    default:
      return null;
  }
}
