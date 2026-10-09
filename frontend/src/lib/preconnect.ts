import { gameSocket } from "./ws";
import { hasCachedIdentity, inActivityMode } from "./session";

/**
 * Start the session websocket's handshake before the app exists.
 *
 * Without this, the first code to ask for a socket ran in React's mount
 * effects, after the whole module graph had evaluated (~700ms on the dev
 * server), though the handshake itself takes ~13ms. Importing this module first
 * dials while the rest of the graph evaluates, so by the time `Lobby` calls
 * `follow()` the socket is open and its `sub` goes straight out. On a busy
 * machine that evaluation time is what shows up as the "Connecting to the
 * table…" pill.
 *
 * Safe to dial early: the socket is session-scoped and `Root` opens it on every
 * route for anyone with a session anyway. `ensureOpen` is idempotent against a
 * CONNECTING or OPEN socket, so `Root` leaves this one alone.
 *
 * Two guards:
 *
 *  - A cached identity (`hasCachedIdentity`, the same optimism lib/auth uses to
 *    paint a returning user's profile). If it is wrong, `Root` sees
 *    `me === null` and calls `disconnect()`. Without it every logged-out visitor
 *    would open a socket the hub never admits.
 *
 *  - Not the Discord Activity. There the session only exists after the SDK
 *    bootstrap trades an OAuth code for a bearer, and `GameSocket.open` sends
 *    the `auth` frame from `getBearer()` at open time, so an early socket would
 *    stay unauthenticated. `Root` opens it after the bootstrap instead.
 *
 * Returns whether it dialled (for the test).
 */
export function preconnectSession(): boolean {
  if (inActivityMode()) return false;
  if (!hasCachedIdentity()) return false;
  gameSocket.ensureOpen();
  return true;
}

// Runs on import: the saving comes from evaluating before the rest of the
// graph. `main.tsx` imports this first, and main.preconnect.test.ts fails if
// that import is moved or dropped.
preconnectSession();
