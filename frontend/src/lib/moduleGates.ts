// The engine's two module gates, mirrored separately because they differ.
//
// `engine.Hooks` carries both:
//
//   - `BlocksTurnActions` (narrow). `engine.requireUninterruptedTurn` uses it
//     to refuse build, trade and module commands from the active seat while a
//     module still owes that seat something.
//   - `Blocks` (strict). `decideEndTurn` (engine/turn.go) uses it, and it holds
//     the whole table while any seat has a module obligation.
//
// A module may release the first and hold the second. Caravans does: a seat
// that has bid keeps playing during the auction, but no turn passes while a
// camel vote is open (engine/scenarios/caravans.go).
//
// So `moduleBlocksActions` is per-seat and narrow; `moduleBlocksEndTurn` is
// table-wide and strict. Do not substitute one for the other.
import type { FullView } from "./types";
import { knightsExt, caravansExt, islandsExt, raidersExt, wagonsExt, explorersExt } from "./types";
import { camelRole } from "./caravans";
import { ridersMustLeave } from "./raiders";

/** How many progress cards a Knights hand may hold (engine/knights progressHandSize). */
const PROGRESS_HAND_SIZE = 4;

/**
 * Whether a module has taken the active seat's voluntary actions away.
 *
 * Mirrors `Caravans.blocksTurnActions` (engine/scenarios/caravans.go): while a vote
 * owes the seat on turn something, it may not build, trade or spend fish. A
 * seat that has already bid, or anyone but the placer once the round closes,
 * keeps playing. Whether the turn may end is `moduleBlocksEndTurn`.
 *
 * Knights (`engine/knights`) sets the same hook on a wider condition
 * (`hardPending`, or any seat over the progress-hand limit) that is not
 * mirrored; those cases have their own overlays and `pending_discards`.
 */
export function moduleBlocksActions(view: FullView, seat: number): boolean {
  if (view.cur !== seat) return false;
  // Raiders' narrow gate is its pending: while one is open the engine refuses
  // every build, trade and module command from the seat on turn, whoever owes
  // the decision.
  //
  // A castle rider that must leave is not here: the engine holds only the
  // strict gate for it, so the player keeps building and trading and only
  // ending the turn is refused.
  if (raidersExt(view)?.pend?.kind) return true;
  const discarding = Object.keys(view.pending_discards ?? {}).length > 0;
  if (
    !discarding &&
    ((wagonsExt(view)?.barb_seat ?? -1) >= 0 || (explorersExt(view)?.pirate_by ?? -1) >= 0)
  )
    return true;
  const role = camelRole(view, seat);
  return role === "bid" || role === "place";
}

/**
 * Whether a module refuses to let the turn pass at all.
 * Mirrors every module's strict `Blocks` hook (checked by `decideEndTurn`).
 * Takes no seat: any seat's unresolved obligation freezes the pass.
 *
 *   - Caravans: `x.Voting`, held for the whole round, even for a seat that has
 *     bid.
 *   - Islands: any seat owing a gold-hex pick (`pending_gold`).
 *   - Knights: `hardPending` plus any seat over the progress-hand limit.
 *
 * The Spy and Master Merchant thief fields are published only to the thief;
 * since the active player plays those cards, the only End Turn at stake is
 * theirs.
 */
export function moduleBlocksEndTurn(view: FullView): boolean {
  if (caravansExt(view)?.voting) return true;
  const wagon = wagonsExt(view);
  if (
    wagon?.has_trade &&
    Object.keys(view.pending_discards ?? {}).length === 0 &&
    ((wagon.barb_seat ?? -1) >= 0 ||
      (wagon.started &&
        view.phase === "play" &&
        view.rolled &&
        !wagon.move_done &&
        wagon.turn_seat === view.cur))
  )
    return true;
  if ((explorersExt(view)?.pirate_by ?? -1) >= 0) return true;

  const isl = islandsExt(view);
  if (isl?.pending_gold && Object.values(isl.pending_gold).some((n) => n > 0)) return true;

  const knightsState = knightsExt(view);
  if (knightsState) {
    if (
      nonEmptyCount(knightsState.pending_give) ||
      nonEmptyCount(knightsState.harbor_give) ||
      (knightsState.aqueduct?.length ?? 0) > 0 ||
      (knightsState.barbarian_downgrade?.length ?? 0) > 0 ||
      (knightsState.defender_draws?.length ?? 0) > 0 ||
      knightsState.metropolis_pick ||
      knightsState.spy ||
      knightsState.master_merchant ||
      knightsState.deserter_victim >= 0 ||
      (knightsState.deserter_level ?? 0) > 0 ||
      knightsState.reloc_player >= 0
    ) {
      return true;
    }
    if ((knightsState.players ?? []).some((p) => p.progress_count > PROGRESS_HAND_SIZE))
      return true;
  }

  // Raiders holds the strict gate on two things.
  //
  // A pending: a decision owed now (a landing tie, a Muster, a Treason, the 7's
  // steal).
  //
  // A castle rider that must leave: the turn is refused while a rider that
  // could leave still stands at the castle. A rider with nowhere legal to go
  // may stay. `ridersMustLeave` reads the engine's mark rather than
  // re-deriving free paths.
  //
  // `rider_moves` is viewer-only, but the only End Turn this gates is the seat
  // on turn's, and for that viewer it is the right list.
  const rd = raidersExt(view);
  if (rd?.pend?.kind) return true;
  if (ridersMustLeave(view).length > 0) return true;
  return false;
}

function nonEmptyCount(m: Record<number, unknown> | undefined): boolean {
  return !!m && Object.keys(m).length > 0;
}

/**
 * The wagon's movement phase is the only thing holding the pass.
 *
 * Declining is always legal and ends the turn (docs/rules/wagons.md). When this
 * is true, End Turn stays live and sends the decline (`wagons_halt`) before the
 * pass, so the player need not open the wagon panel every turn.
 */
export function wagonMoveOnlyBlocksEnd(view: FullView): boolean {
  const wagon = wagonsExt(view);
  if (!wagon?.has_trade || !wagon.started || wagon.move_done) return false;
  if ((wagon.barb_seat ?? -1) >= 0) return false;
  if (!moduleBlocksEndTurn(view)) return false;
  const declined = {
    ...view,
    ext: { ...view.ext, wagons: { ...wagon, move_done: true } },
  } as FullView;
  return !moduleBlocksEndTurn(declined);
}

/**
 * Whether the wagon of the seat on turn is on the move, which closes building
 * and trading until it stops.
 *
 * Mirrors `Wagons.blocksBuildTrade` (engine/wagons/rules.go), the engine's
 * third module gate (`BlocksBuildTrade`): it refuses builds, bank and player
 * trades and development-card purchases with `BUILDING_OVER`, leaving the
 * wagon's commands and ending the turn open. Explorers' Movement phase sets the
 * same hook.
 */
export function wagonMovingClosesBuilding(view: FullView): boolean {
  const wagon = wagonsExt(view);
  return !!wagon?.has_trade && !!wagon.started && !!wagon.move_open && wagon.turn_seat === view.cur;
}
