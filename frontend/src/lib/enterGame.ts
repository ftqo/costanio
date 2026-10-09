/**
 * Whether a client sitting in the waiting room should now navigate into the
 * live game. Any one of three independent signals means the game is active:
 *
 *  - `started`: the one-shot `started:true` lobby broadcast was received.
 *  - `status === "active"`: an authoritative summary (REST `getGame` or a lobby
 *    frame) reports the game already in progress.
 *  - `hasFullState`: a `state` frame has arrived. The server sends these only
 *    for an active game, so this covers a missed `started` broadcast (a
 *    reconnect around start, or a late subscribe) while the summary may still
 *    read "lobby".
 */
export function shouldEnterGame(
  started: boolean,
  status: string | undefined,
  hasFullState: boolean,
): boolean {
  return started || status === "active" || hasFullState;
}
