// Which session mechanism is in play, known before the app has run.
//
// Keep this module dependency-free: lib/preconnect evaluates it first to open
// the websocket ahead of the module graph, and importing anything heavy (the
// Discord SDK, react-query, the api client) would defeat that.

// In-memory bearer token, set only in the Discord Activity, where the iframe
// cannot rely on cookies. Not persisted. The web app leaves this null and uses
// the session cookie.
let bearer: string | null = null;

export function setBearer(token: string | null) {
  bearer = token;
}
export function getBearer(): string | null {
  return bearer;
}

/** localStorage key holding the cached public `Me` (never a token; the session
 * itself is an httpOnly cookie). Written by lib/auth on every identity refresh
 * and removed when the server reports no session. */
export const ME_CACHE_KEY = "costan.me";

/** Whether this visitor looked logged in as of their last visit.
 *
 * Optimistic: the cookie may have expired, and `GET /api/users/me` settles it.
 * lib/auth uses it to render a returning user's profile on first paint, and
 * lib/preconnect to start the websocket early. If wrong, the live check clears
 * `me` and Root tears the socket down. */
export function hasCachedIdentity(): boolean {
  try {
    return localStorage.getItem(ME_CACHE_KEY) !== null;
  } catch {
    return false; // storage unavailable (private mode): assume nothing
  }
}

const ACTIVITY_LATCH_KEY = "costan.activity";

/**
 * Whether we are running inside the Discord Activity. Discord loads the iframe
 * with a `frame_id` query param, but client-side navigation drops it, so the
 * first detection is latched in sessionStorage for the rest of the session.
 * Otherwise the hidden Leave button and inert brand pill would come back after
 * a navigation.
 *
 * Lives here rather than lib/activity (which re-exports it) so preconnect can
 * ask without loading the Discord SDK.
 */
export function inActivityMode(): boolean {
  if (new URLSearchParams(window.location.search).has("frame_id")) {
    try {
      sessionStorage.setItem(ACTIVITY_LATCH_KEY, "1");
    } catch {
      /* storage unavailable (private mode / disabled); fall through */
    }
    return true;
  }
  try {
    return sessionStorage.getItem(ACTIVITY_LATCH_KEY) === "1";
  } catch {
    return false;
  }
}
