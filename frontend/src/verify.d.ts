/**
 * Types for the fairness verifier at the repo root.
 *
 * verify/ is plain JavaScript so auditors can read and run it directly,
 * including from a browser console. This declaration lets the app use it
 * without copying it or loosening its own strictness. Keep it in step with
 * verify/verify.mjs by hand: two functions and the result shape the audit page
 * renders.
 */
declare module "@verify/verify.mjs" {
  export type CheckStatus = "ok" | "FAILED" | "skipped";

  export interface Check {
    name: string;
    status: CheckStatus;
    detail?: string;
  }

  export interface Roll {
    /** The event's log position. */
    seq: number;
    /** Which roll of the game this was, counting from 1. */
    n: number;
    logged: [number, number];
    /** null when the roll was declared rather than derived (Alchemist). */
    expected: [number, number] | null;
    status: string;
  }

  export interface VerifyResult {
    game: string;
    verdict: "verified" | "failed" | "unauditable";
    checks: Check[];
    rolls: Roll[];
  }

  /**
   * Audits a replay. Pass the raw response text: seeds are 64-bit and do not
   * survive JSON.parse.
   */
  export function verify(input: string | object): VerifyResult;
  export function format(result: VerifyResult): string;
}
