// When the table stops accepting input because the connection went away.
//
// `GameSocket.send` drops a frame that cannot go out, and there is no outbound
// queue (a command replayed after a reconnect would act on a board that has
// moved on). So a dropped link needs handling in two stages:
//
//   Immediately, per click: `cmd` reports whether the frame left, and a
//     command that did not leave stages nothing (no piece, no spend, no
//     in-flight entry) and says so. Otherwise an optimistic piece would appear
//     and then vanish at the TTL.
//
//   After a grace, as a state: the screen goes inert and says why. The wait
//     lets a deploy blip reconnect unnoticed.
//
// The grace is longer than ConnectionIndicator's SHOW_AFTER_MS (1500ms), so the
// banner explaining the problem is up before the table stops responding.
import * as React from "react";
import { useGameSocket, shallowEqual, type Status } from "./ws";

export const LINK_GRACE_MS = 2000;

/**
 * Whether the link counts as down, given how long it has been in its current
 * state. Pure, so the policy is testable without a socket or a clock.
 *
 * `wantOpen` false means the session was torn down on purpose (logout), which
 * must never lock a table.
 */
export function isLinkDown(
  status: Status,
  wantOpen: boolean,
  downForMs: number,
  grace: number = LINK_GRACE_MS,
): boolean {
  if (!wantOpen || status === "open") return false;
  return downForMs >= grace;
}

/**
 * The other kind of dead link: the socket still says open and nothing comes
 * back.
 *
 * `isLinkDown` only sees connections that closed. A half-open socket (network
 * pulled from under it) keeps `readyState` OPEN and accepts writes silently;
 * the server's close frame cannot reach it, and browsers answer WebSocket pings
 * without telling script. The only signal is a request with no answer.
 *
 * An expired in-flight command is that: nothing at all came back during the
 * TTL (no event, no refusal, no resync hint). A live actor answers commands
 * synchronously.
 *
 * Both conditions are required: a command can expire on a healthy link (a
 * frame dropped server-side), and if anything else arrived meanwhile the link
 * is alive and the resync already repairs the lost command.
 */
export function isAckLost(expiredCount: number, msSinceLastFrame: number, ttl: number): boolean {
  return expiredCount > 0 && msSinceLastFrame >= ttl;
}

/**
 * `true` once the session socket has been away longer than the grace.
 *
 * Flips back to `false` as soon as the socket reopens, with no grace. The
 * subscription is narrowed to the two connection fields, so it does not
 * re-render its host on game events.
 */
export function useLinkDown(grace: number = LINK_GRACE_MS): boolean {
  const { status, wantOpen } = useGameSocket(
    (s) => ({ status: s.status, wantOpen: s.wantOpen }),
    shallowEqual,
  );
  // Keyed on "is it down at all", not on `status`: a reconnect walks
  // closed -> connecting -> closed with jittered backoff, and restarting the
  // timer on each status change would delay or prevent the lock. The boolean is
  // stable across the walk, so the timer runs once.
  const down = wantOpen && status !== "open";
  const [elapsed, setElapsed] = React.useState(false);
  React.useEffect(() => {
    if (!down) {
      setElapsed(false);
      return;
    }
    const t = setTimeout(() => setElapsed(true), grace);
    return () => clearTimeout(t);
  }, [down, grace]);
  return down && elapsed;
}
