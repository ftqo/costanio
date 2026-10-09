// Pure navigation decisions for the waiting room, testable without rendering
// the route.

/** Whether an unseated viewer of a still-open lobby was kicked (and should be
 * bounced to the lobby browser) rather than legitimately watching.
 *
 * `everSeated` means this view has at some point seen us holding a seat. Losing
 * it while the table stays open reads as a kick, unless:
 *  - we chose to spectate (`spectating`),
 *  - we're inside the Discord Activity (it owns its own routing),
 *  - or we're the host, who can never be kicked. An unseated host is
 *    spectating their own lobby (e.g. back from the map builder); this also
 *    covers a stale-cache remount briefly replaying a pre-spectate "seated"
 *    summary.
 */
export function wasKickedFromLobby(args: {
  everSeated: boolean;
  spectating: boolean;
  inActivity: boolean;
  isHost: boolean;
}): boolean {
  const { everSeated, spectating, inActivity, isHost } = args;
  return everSeated && !spectating && !inActivity && !isHost;
}
