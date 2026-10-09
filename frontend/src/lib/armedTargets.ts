import type { BoardMode } from "./boardTargets";
import { planPickTargets, type PlanTargetsOptions } from "./board3d/targets";

/**
 * Board modes a player arms (a panel button, a piece picked up) that then wait
 * for a board tap, with a prompt.
 *
 * Forced modes (robber, Raiders, Deserter placement, ...) are derived from the
 * view each render, so they end when the server stops asking. An armed mode is
 * local state the server cannot clear, so if its target is resolved elsewhere
 * (the timer moves the castle rider, the wagon's movement runs out, the ship
 * takes its last step, the last bridge site is taken) the prompt stays up with
 * nothing to tap.
 */
export const ARMED_TARGET_MODES: ReadonlySet<BoardMode> = new Set<BoardMode>([
  "ridermove",
  "wagonmove",
  "sail",
  "shipact",
  "fishbridge",
  "fishedge",
  "shipmove",
  "knightmove",
]);

/**
 * Whether an armed mode has lost every target it could offer.
 *
 * Uses `planPickTargets`, the same function the board draws from, so "nothing
 * to tap" here always matches "nothing lit" on the board.
 *
 * Non-armed modes always return false, so callers can ask about any mode.
 */
export function armedTargetsGone(opts: PlanTargetsOptions): boolean {
  if (!ARMED_TARGET_MODES.has(opts.mode)) return false;
  return planPickTargets(opts).length === 0;
}
