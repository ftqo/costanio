// Which resources the Aqueduct (Knights, Science level 3) may be spent on now.
//
// `decideAqueductPick` (engine/knights/decide.go) rejects a resource the bank
// cannot cover (`s.Bank[d.Res] < 1`) and accepts the take-nothing pick only
// when the bank is empty. Kept here, pure, so the rule is stated once and
// tested against the engine's.
import type { Hand } from "./types";

/** The resource indices the picker offers, matching `RES` in lib/cardFace. */
export const AQUEDUCT_RESOURCES = [1, 2, 3, 4, 5] as const;

/**
 * Whether the bank can pay out `res`. A missing bank (a spectator's redacted
 * view) reads as "cannot".
 */
export function aqueductCanTake(bank: Hand | undefined, res: number): boolean {
  return (bank?.[res] ?? 0) > 0;
}

/**
 * Whether the bank cannot pay out anything. The only state in which the
 * engine accepts the take-nothing pick.
 */
export function aqueductBankEmpty(bank: Hand | undefined): boolean {
  return !AQUEDUCT_RESOURCES.some((i) => aqueductCanTake(bank, i));
}
