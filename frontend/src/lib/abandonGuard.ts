import type { Me } from "./types";

/**
 * Whether to warn before an action that would hand the user's seat in an
 * in-progress game to a bot. Joining or creating another game detaches the
 * user from every other table, so confirm first, but only when the prior table
 * is live: a waiting lobby is low-stakes, and rejoining the same game is what
 * the user wants.
 *
 * `targetGameId` is the game being joined, or undefined when creating one
 * (which always abandons an active seat).
 */
export function needsAbandonWarning(me: Me | null, targetGameId?: string): boolean {
  if (!me || !me.game || me.game_status !== "active") return false;
  return targetGameId !== me.game;
}
