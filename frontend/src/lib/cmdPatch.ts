// What the board would look like if the command we just sent succeeds.
//
// The mirror of lib/foldEvent, which decodes committed events; this decodes a
// command about to be sent. Same output and consumer, and it reads only the
// command's own arguments: no legality, no predicted outcome.
//
// Safe because every position it names came from a `legal` set the server
// published for the snapshot being acted on, so it restates a decision the
// server already made.
//
// Commands not listed get no patch (only gating), whenever the result is not a
// position:
//
//   - Randomness. `roll_dice` and `buy_dev_card` have server-side outcomes; the
//     spend is handled by lib/optimistic and the values arrive on the event.
//   - Another player's agency: every trade and draw command.
//   - State we do not hold. `relocate_knight` restores a knight held off the
//     board, whose strength is engine state; `metropolis_pick` and
//     `barbarian_downgrade` change what a city is, which the view has no field
//     for.
import type { KnightsExt, Edge, FullView, Hex, Vertex } from "./types";
import type { ViewPatch } from "./viewPatch";

/** The commands whose data we read, as they are written at the call sites. */
interface CmdData {
  v?: Vertex;
  e?: Edge;
  from?: Vertex | Edge;
  to?: Vertex | Edge;
  hex?: Hex;
  ship?: boolean;
  level?: number; // deserter_place: the chosen tier
}

function isVertex(x: unknown): x is Vertex {
  return !!x && typeof x === "object" && "side" in x;
}
function isEdge(x: unknown): x is Edge {
  return !!x && typeof x === "object" && "a" in x && "b" in x;
}

/**
 * The optimistic board change for `type`, or null when there is none to state.
 *
 * `seat` is the acting seat (the viewer). Payloads never carry it: the server
 * takes the seat from the session (server/ws.go).
 */
export function patchForCommand(
  type: string,
  data: unknown,
  seat: number,
  view: FullView,
): ViewPatch | null {
  const d = (data ?? {}) as CmdData;
  switch (type) {
    // Setup: strictly turn-based, free, no randomness, nobody else can act.
    case "place_settlement":
      return d.v ? { kind: "settlement", v: d.v, owner: seat } : null;
    case "place_road":
      // One command, two pieces: Islands lets the setup road be a ship, via the
      // dock's `ship` toggle.
      return d.e ? { kind: d.ship ? "ship" : "road", e: d.e, owner: seat } : null;

    case "build_settlement":
      return d.v ? { kind: "settlement", v: d.v, owner: seat } : null;
    case "build_city":
      return d.v ? { kind: "city", v: d.v, owner: seat } : null;
    case "build_road":
      return d.e ? { kind: "road", e: d.e, owner: seat } : null;
    case "build_ship":
      return d.e ? { kind: "ship", e: d.e, owner: seat } : null;
    case "build_wall":
      return d.v ? { kind: "wall", v: d.v, owner: seat } : null;
    case "build_knight":
      return d.v ? { kind: "knight", v: d.v, owner: seat, level: 1, active: false } : null;
    case "activate_knight":
      return d.v ? { kind: "knight_activate", v: d.v } : null;
    case "promote_knight": {
      // The level it ends at, read off the knight there. The engine applies
      // `k.Level++` without stating the result, and "better than basic" is
      // already true before a 2 -> 3 promotion.
      if (!d.v) return null;
      const knightsState = view.ext?.cak as KnightsExt | undefined;
      const k = (knightsState?.knights ?? []).find(
        (x) => x.v.q === d.v!.q && x.v.r === d.v!.r && x.v.side === d.v!.side,
      );
      return k ? { kind: "knight_promote", v: d.v, to: k.level + 1 } : null;
    }

    case "move_knight": {
      if (!isVertex(d.from) || !isVertex(d.to)) return null;
      // A displacement is not a move, but the command is identical: the server
      // lists displacement destinations in the same `knight_moves[].to`
      // (engine/knights/hooks.go). A relocation patch drew two knights on one
      // vertex, and the fold ignores `cak_knight_displaced`, so nothing fixed
      // it. If the destination is occupied, say nothing.
      const knightsState = view.ext?.cak as KnightsExt | undefined;
      const occupied = (knightsState?.knights ?? []).some(
        (k) =>
          k.v.q === (d.to as Vertex).q &&
          k.v.r === (d.to as Vertex).r &&
          k.v.side === (d.to as Vertex).side,
      );
      return occupied ? null : { kind: "knight_move", from: d.from, to: d.to };
    }
    case "move_ship":
      return isEdge(d.from) && isEdge(d.to) ? { kind: "ship_move", from: d.from, to: d.to } : null;

    case "deserter_place": {
      // The ceiling is published (`deserter_level`). Whether it arrives active
      // mirrors the replaced knight, which is not published, so draw it
      // inactive (the conservative direction: fewer actions offered). The
      // event corrects it.
      // The tier is the taker's pick up to the ceiling ("the same strength or
      // lower"), sent as `level`; absent means the ceiling.
      const knightsState = view.ext?.cak as KnightsExt | undefined;
      const level =
        typeof d.level === "number" && d.level > 0 ? d.level : knightsState?.deserter_level || 1;
      return d.v ? { kind: "knight", v: d.v, owner: seat, level, active: false } : null;
    }

    // The marker only: the stolen card is server randomness and lands in a
    // hidden hand.
    case "move_robber":
      return d.hex ? { kind: "robber", hex: d.hex } : null;
    // A chase names a hex, which says which blocker moves: from a sea
    // intersection this same command chases the pirate.
    case "chase_robber": {
      if (!d.hex) return null;
      const onSea =
        view.board?.tiles?.find((tl) => tl.hex.q === d.hex!.q && tl.hex.r === d.hex!.r)?.res ===
        "sea";
      return onSea ? { kind: "pirate", hex: d.hex } : { kind: "robber", hex: d.hex };
    }
    case "move_pirate":
      return d.hex ? { kind: "pirate", hex: d.hex } : null;

    default:
      return null;
  }
}
