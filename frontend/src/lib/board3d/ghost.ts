// What the board does when you point at a spot.
//
// There are two answers, chosen by what the click would do to the piece
// standing there:
//
//   GHOST: a translucent piece where it would stand. Used whenever the board is
//     about to look different here: something arrives (a build, a destination)
//     or something leaves (Diplomat lifting a road, Intrigue evicting a knight,
//     a city downgraded). Translucent means "not settled" either way: a piece
//     not there yet, or one on its way out.
//
//   BULGE: the piece already here grows and settles. Used when the action is
//     against a piece that stays: activate, promote, wall, metropolis, open its
//     menu.
//
// Two rules apply to both:
//
//   - Roads and ships never bulge: a swollen bar in a gutter is a few pixels
//     and reads as a rendering wobble. They still ghost.
//   - A knight's sword moves with the knight, including this swell (see
//     knightSword.ts). Walls are exempt and stay put.
//
// Only the choice lives here. Building the mesh needs the loaded pieces.glb
// and belongs to Board3D, so the table can be tested without a GL context.
import type { BoardMode } from "@/lib/boardTargets";
import type { PickTarget } from "./targets";
import type { LocationAction } from "@/lib/locationActions";
import type { FullView } from "@/lib/types";
import { parseExpansions } from "@/lib/format";
import { isExplorers, setupStep as explorersSetupStep } from "@/lib/explorers";
import { progressGhost } from "@/lib/progressCards";

/** Piece families that can be previewed. Everything else ghosts as nothing. */
export type GhostKind =
  | "settlement"
  | "city"
  | "road"
  | "ship"
  // The Rivers bridge. Its own kind because its mode exists for spots a road
  // cannot go; previewing it as a road would show the piece the engine refuses.
  | "bridge"
  | "knight"
  // The three knight tiers are three models. Building always places `knight`;
  // the other two let a standing knight preview itself at its own tier.
  | "knight_strong"
  | "knight_mighty"
  | "wall"
  | "merchant"
  // The Raiders rider, a seat's own piece standing on a path like a road. A
  // Muster places one and a move names a destination, so both preview it.
  | "rider"
  // The two unowned markers. They are placed rather than built, but the
  // question is the same: what would be standing here if I clicked?
  | "robber"
  | "pirate";

/**
 * What a mode or a card previews: a named piece, the piece already standing
 * here, or nothing.
 *
 * `"standing"` encodes a removal, where the piece is not knowable from the
 * table: Diplomat lifts whichever road you point at, Intrigue evicts whichever
 * knight. Keeping it distinct from `null` stops a removal from being treated
 * like a card that previews nothing.
 */
export type GhostPreview = GhostKind | "standing" | null;

/**
 * The piece each board mode is about to put down, for every mode there is.
 *
 * A total map over `BoardMode`, so adding a mode fails the build until someone
 * writes down what it previews, `null` included.
 *
 * `null` means the mode places nothing new:
 *
 * - `none` / `inspect`: not a placement. Inspect is handled above by action.
 * - `inventor1` / `inventor2`: number tokens swap. Nothing is placed.
 *
 * `"card"` is the one answer that is not a piece: the three progress modes are
 * one mode per target shape, so the card in play names the piece
 * (`progressGhost`). It is a row here rather than a separate Set so a new
 * progress mode cannot be missed (compare `targets.ts` MODE_SHAPE).
 *
 * The moves that do preview (`shipmove`, `knightmove`, `relocateknight`,
 * `robber`, `pirate`, `chaserobber`) do so because their targets are
 * destinations: the piece is not there yet, so the ghost answers "what would
 * arrive here". The hex the robber stands on is not a target (it is `blocked`,
 * see Board3D), so the ghost can never double the real piece.
 */
const MODE_GHOST: Record<BoardMode, GhostPreview | "card"> = {
  none: null,
  inspect: null,
  settlement: "settlement",
  city: "city",
  // The ring alone, for the same reason `build_wall` ghosts as one below: the
  // city it goes around is already standing there in full colour.
  wall: "wall",
  road: "road",
  ship: "ship",
  bridge: "bridge",
  // The 6-fish rung builds a real bridge on the site pressed.
  fishbridge: "bridge",
  // Wagons, both null. A wagon move and an owed barbarian both move a piece
  // already on the board, so like the robber they get the lit target and no
  // ghost.
  wagonmove: null,
  wagonbarbarian: null,
  // Explorers. A harbour settlement is drawn as the settlement it upgrades,
  // since the quay is an add-on beside it. A cargo ship and a sailing step both
  // ghost as a ship. `shipact` ghosts nothing: the corner is where the ship
  // reaches, and its four jobs put different things (or nothing) in different
  // places.
  harbour: "settlement",
  cargoship: "ship",
  sail: "ship",
  shipact: null,
  // Null rather than "road": the Fishermen 5-fish spend names an edge only to
  // prove the credit has somewhere to go. The piece is placed later with an
  // ordinary build, and under Islands the tapped spot may be a ship edge.
  fishedge: null,
  knight: "knight",
  // Destinations, not sources: nothing stands there yet.
  shipmove: "ship",
  knightmove: "knight",
  relocateknight: "knight",
  // The Deserter's compensation knight is a new piece on an empty vertex of
  // your choosing.
  deserterplace: "knight",
  // Diplomat's second step: the road it lifted comes back down here.
  diplomatto: "road",
  // A downgrade is a city being lost, so it previews the piece that goes: the
  // city, translucent, where it stands. `"standing"`, like Diplomat's road,
  // because the piece is whichever city you point at; `hides` blanks the solid
  // one so the city fades in place.
  barbariandowngrade: "standing",
  // The metropolis bulges: nothing is placed or lost, the city stays and gains
  // a district, so the answer is that city growing.
  metropolispick: null,
  // Destinations too. `chaserobber` is the Knights effect that moves the same
  // robber, so it previews the same piece.
  robber: "robber",
  pirate: "pirate",
  chaserobber: "robber",
  // The Knights effect that drives the pirate off. Its own mode rather than a
  // sea-hex case of `chaserobber`, since this table answers per mode and a
  // robber ghost on open water would be wrong.
  chasepirate: "pirate",
  inventor1: null,
  inventor2: null,

  // Raiders. `riderplace` is a placement and `ridermove` a destination; the
  // piece is not there yet in either case.
  riderplace: "rider",
  ridermove: "rider",
  // The three hex picks preview nothing; none places a piece of yours.
  // `raiderhex` names where an enemy figure lands (a landing tie) or which is
  // taken prisoner (Intrigue); the Treason modes move enemy figures as part of
  // an unsent plan.
  raiderhex: null,
  treasonfrom: null,
  treasonto: null,
  // Card-dependent, not piece-less. See `"card"` above.
  phex: "card",
  pvertex: "card",
  pedge: "card",
};

// The piece a progress card's board target would place lives in
// lib/progressCards (the required `ghost` field), so the card table is total
// like `MODE_GHOST`. The progress modes (`phex`, `pvertex`, `pedge`) are one
// per target shape, so the card names the piece: Medicine upgrades a
// settlement to a city through `pvertex`, which says only "some vertex".

/**
 * The piece each location action would put on the board.
 *
 * Partial: `activate_knight`, `promote_knight`, `chase_robber` and the move
 * actions change a piece already on the board or place nothing.
 * `move_knight` and `move_ship` are excluded because the piece is already
 * there and the ghost would double it.
 *
 * `build_wall` places the wall ring. Ghosting the ring alone is right: the
 * city it goes around is already standing there, so the two read as the
 * walled city.
 */
const ACTION_GHOST: Record<string, GhostKind> = {
  build_settlement: "settlement",
  build_city: "city",
  build_road: "road",
  build_ship: "ship",
  build_bridge: "bridge",
  build_knight: "knight",
  build_wall: "wall",
};

/**
 * Whether the setup placement now on offer is a city rather than a settlement.
 *
 * Knights', Raiders' and Wagons' round-2 setup places a city
 * (`SetupRound2City`, engine/setup.go; Knights with Explorers does it in round
 * 1, see below), but the command is still `place_settlement` and the mode is
 * still "settlement": the engine converts. So the preview asks the ruleset.
 *
 * It asks the ruleset rather than `view.ext.cak`: that state is created by the
 * module's first event and is absent for all of setup. Game.tsx makes the same
 * distinction for the build shelf.
 */
export function setupPlacesCity(view: FullView): boolean {
  if (view.phase !== "setup") return false;
  // Explorers owns its own draft, and with Knights its first placement is the
  // city (combination sheet; engine/explorers/decide.go harbourRound).
  if (isExplorers(view)) return explorersSetupStep(view) === "city";
  if ((view.setup_round ?? 0) !== 1) return false;
  // Every module that sets `SetupRound2City`: Knights (engine/knights/hooks.go),
  // Raiders (engine/raiders/raiders.go) and Wagons (engine/wagons/wagons.go).
  const x = parseExpansions(view.config.ruleset);
  return x.knights || x.raiders || x.wagons;
}

/** What the preview needs beyond the mode and the spot. */
export interface GhostContext {
  /** The setup placement about to be made is a city; see `setupPlacesCity`. */
  setupCity?: boolean;
  /** The progress card being targeted, when the mode is one the table answers `"card"` for. */
  progressCard?: string | null;
  /**
   * The viewer's own piece standing at this spot, if there is one.
   *
   * Read from the view by the caller (see `standingPiece`) so this module stays
   * a pure decision about art.
   */
  standing?: GhostKind | null;
}

/**
 * The pieces that never swell, whatever is being done to them.
 *
 * Both are bars lying flat in a gutter. At `BULGE_SCALE` (1.12) a road grows by
 * a couple of pixels, which reads as a rendering wobble, so the cursor carries
 * the affordance instead. They still ghost when built or removed.
 */
const NEVER_BULGES: ReadonlySet<GhostKind> = new Set<GhostKind>(["road", "ship"]);

/**
 * What the board should do at a hovered spot. Exactly one of three.
 *
 * `leaving` marks a removal, where the translucency means the opposite of
 * usual: every other ghost is an arrival, but a removal's ghost is the piece
 * already there on its way out. `hides` cannot tell them apart, since both
 * blank the piece under them.
 *
 * It matters for the slide: a sliding preview travels to where a click would
 * put the piece, and a removal has no such spot. Board3D's `applyHover`
 * refuses to slide it.
 */
export type HoverEffect =
  /**
   * Draw these, translucent, in this order. `hides` blanks the piece standing
   * here; `leaving` says the translucency means the opposite of usual.
   */
  | { kind: "ghost"; pieces: GhostKind[]; hides: boolean; leaving: boolean }
  /** Swell the piece standing here. */
  | { kind: "bulge" }
  /** Say nothing. The cursor is already saying the spot is live. */
  | { kind: "none" };

const NONE: HoverEffect = { kind: "none" };
const BULGE: HoverEffect = { kind: "bulge" };

/**
 * The answer for a piece that is being acted on but not moved or removed.
 *
 * The road rule lives here, consulted last rather than filtering the whole
 * decision: a road still ghosts when built or lifted; only the swell is
 * refused.
 */
function bulgeUnlessFlat(standing: GhostKind | null | undefined): HoverEffect {
  if (!standing) return NONE;
  return NEVER_BULGES.has(standing) ? NONE : BULGE;
}

/**
 * What a hover at `target` should do.
 *
 * One decision, so the art and "is a piece in the way" cannot overrule each
 * other. In order:
 *
 *  1. an inspect spot with something of yours on it: the menu acts on that
 *     piece, so the piece answers (and a road stays quiet);
 *  2. an inspect spot with nothing on it: the menu builds, so the buildable
 *     options cycle as ghosts;
 *  3. a mode that removes the piece here: ghost the piece, on its way out;
 *  4. a mode that places a piece: ghost that piece, hiding whatever it stands
 *     in place of;
 *  5. a mode that does neither, pointed at a piece: it acts on that piece, so
 *     the piece answers;
 *  6. nothing applies.
 */
export function hoverEffectFor(
  target: PickTarget,
  mode: BoardMode,
  actions: readonly LocationAction[],
  ctx: GhostContext = {},
): HoverEffect {
  if (target.action === "inspect") {
    // Something of yours is standing here, so that piece answers. A hover is
    // not a request to upgrade: a ghost city that came and went with the ore
    // in your hand would make the same gesture mean different things. Arming
    // the city in the shelf goes through the mode path below.
    if (ctx.standing) return bulgeUnlessFlat(ctx.standing);

    const pieces: GhostKind[] = [];
    for (const a of actions) {
      // Blocked only. `actionsAt` returns the whole roster, including entries
      // the menu greys out, and a ghost settlement where the distance rule
      // forbids one would be wrong. `short` is kept: the spot can take the
      // piece and you just cannot pay, which the menu explains.
      if (a.status === "blocked") continue;
      const kind = ACTION_GHOST[a.id];
      // Same order as actionsAt, so the cycle matches the action menu.
      if (kind && !pieces.includes(kind)) pieces.push(kind);
    }
    // `hides` is false: this branch is reached only when nothing of yours
    // stands here, so every piece in the list is an arrival.
    return pieces.length ? { kind: "ghost", pieces, hides: false, leaving: false } : NONE;
  }

  const piece = pieceForMode(mode, ctx);

  // A removal. The card names no piece because it is whichever one you point
  // at, and it previews that piece going translucent where it stands. With
  // nothing here there is nothing to take or draw.
  if (piece === "standing") {
    return ctx.standing
      ? { kind: "ghost", pieces: [ctx.standing], hides: true, leaving: true }
      : NONE;
  }

  if (piece) {
    return {
      kind: "ghost",
      pieces: [piece],
      // Hidden when the ghost replaces what is there: a city over a settlement
      // (Medicine), a settlement over a city (the downgrade). A wall is an
      // addition, so the city stays visible.
      hides: !!ctx.standing && piece !== "wall",
      leaving: false,
    };
  }

  // The mode places and removes nothing, and you are pointing at a piece:
  // the mode acts on that piece.
  return bulgeUnlessFlat(ctx.standing);
}

/**
 * The one piece a mode is about to place, or null for the modes that place none.
 *
 * Two special cases, both where the mode alone cannot name the piece. Keep it
 * to these two.
 */
export function pieceForMode(mode: BoardMode, ctx: GhostContext = {}): GhostPreview {
  // 1. Knights' round-2 setup places a city through the settlement mode.
  if (mode === "settlement" && ctx.setupCity) return "city";
  const piece = MODE_GHOST[mode];
  // 2. A progress card's target shape says nothing about what the card does, so
  // the table defers and the card answers. No card in hand yet means no answer.
  if (piece === "card") return ctx.progressCard ? progressGhost(ctx.progressCard) : null;
  return piece;
}

/** How long each piece holds the spot before the cycle advances. */
export const GHOST_CYCLE_MS = 500;

/**
 * Which entry a cycle is showing after `elapsedMs`.
 *
 * Pure, so the cadence is testable without a clock. A single-entry cycle is
 * pinned at 0: there is nothing to advance to, and the caller uses that to skip
 * arming a timer at all.
 */
export function ghostCycleIndex(elapsedMs: number, count: number): number {
  if (count <= 1) return 0;
  const step = Math.floor(Math.max(0, elapsedMs) / GHOST_CYCLE_MS);
  return step % count;
}

/** How long a preview takes to appear. */
export const GHOST_FADE_MS = 300;

/**
 * How far through its fade a preview is, 0 to 1.
 *
 * Eased rather than linear: with an instant swap the abrupt part is the first
 * frame, and a straight ramp keeps most of that. Starts slow and settles.
 *
 * Pure, so the curve is testable without a clock. Under
 * `prefers-reduced-motion` the ticker never calls back and the caller shows
 * the end state at once, so the caller must not rely on being handed 0.
 */
export function ghostFade(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / GHOST_FADE_MS));
  // Cubic ease-out.
  return 1 - Math.pow(1 - t, 3);
}

/** How long a piece takes to swell under the pointer. */
export const BULGE_MS = 160;

/**
 * How much bigger a piece gets while it is pointed at.
 *
 * Small enough that a city does not look like it grew a storey and neighbouring
 * pieces do not overlap, large enough to read on a settlement across the board.
 */
export const BULGE_SCALE = 1.12;

/**
 * The scale a pointed-at piece is drawn at, `elapsedMs` into the swell.
 *
 * Swelling marks the piece you point at while leaving it solid where it is;
 * a translucent copy would read as the piece being removed. Overshoots slightly
 * and settles back. Pure and clock-free like `ghostFade`; under
 * `prefers-reduced-motion` the caller writes `BULGE_SCALE` once.
 */
export function bulgeScale(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / BULGE_MS));
  return 1 + (BULGE_SCALE - 1) * bulgeEase(t);
}

/**
 * How far through the swell it is, 0 to 1, with the overshoot.
 *
 * Separate from `bulgeScale` because the swell can start partway: a pointer
 * that leaves and returns finds the piece mid-shrink, and the swell resumes
 * from there. The caller interpolates its own endpoints; this supplies the
 * shape. `sin(pi t)` is zero at both ends, so the overshoot never moves the
 * endpoints.
 */
export function bulgeEase(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - k, 3) + Math.sin(Math.PI * k) * 0.25;
}

/**
 * How far through the shrink it is, 0 to 1.
 *
 * Plain ease-out with no overshoot: the pointer has left, so the piece should
 * not dip under its own size. Without it the piece snapped back to size on the
 * frame the pointer left.
 */
export function shrinkEase(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - k, 3);
}
