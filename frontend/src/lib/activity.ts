import type { DiscordSDK } from "@discord/embedded-app-sdk";
import { setBearer } from "./session";

// The SDK is a type import here; the value is loaded inside
// runActivityBootstrap. It is ~48 kB gzipped and only the Discord Activity
// iframe runs it, but this module is imported eagerly across the app (for
// `inActivityMode`), so a value import would put it in the entry chunk.
//
// Do not point those importers at ./session instead: activityGuards.test.ts
// forbids it, because the Activity-suppression tests mock `@/lib/activity`.
//
// The Activity check lives in lib/session, which imports nothing, so
// lib/preconnect can use it early. Re-exported here for callers.
export { inActivityMode } from "./session";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;

// The authenticated SDK instance, kept at module scope so later callers (Rich
// Presence, see lib/richPresence.ts) use the same client. Null until
// runActivityBootstrap completes.
let activitySdk: DiscordSDK | null = null;

/** The authenticated Embedded App SDK, or null before the bootstrap finishes
 *  (or outside the Activity). Callers must tolerate null. */
export function getActivitySdk(): DiscordSDK | null {
  return activitySdk;
}

export interface ActivityResult {
  gameId: string;
  role: string;
  /** The call's game is private, so spectators must present this invite to
   * subscribe (the WS `sub` gate requires it). Undefined only for a public game. */
  invite?: string;
  status: string; // "lobby" | "active" | "finished"
}

interface ActivityLobbyResponse {
  role: string;
  summary: { game: { id: string; status: string; invite_code?: string } };
}

/** Maps the `/api/activity/lobby` response to the bootstrap result, carrying the
 * private game's invite through so the spectator path can subscribe. */
export function activityResult(data: ActivityLobbyResponse): ActivityResult {
  return {
    gameId: data.summary.game.id,
    role: data.role,
    invite: data.summary.game.invite_code,
    status: data.summary.game.status,
  };
}

/** Decides where to land after the bootstrap, by game status rather than role:
 * "active" goes to the board, "finished" to the scoreboard (with the rematch
 * tally), and only "lobby" to the waiting room. The invite always goes in `inv`
 * so the WS `sub` passes the private-game gate, as Lobby and Game read it. */
export function activityRoute(result: ActivityResult): {
  to: "/game" | "/lobby";
  search: { g: string; inv?: string };
} {
  const to = result.status === "lobby" ? "/lobby" : "/game";
  return { to, search: { g: result.gameId, inv: result.invite } };
}

/**
 * Runs the Discord Embedded App SDK bootstrap: ready, OAuth code, /api/token
 * (sets the bearer session), authenticate, /api/activity/lobby (find or create
 * the call's game). Returns the game id and this user's role.
 *
 * Routing is same-origin: the Developer Portal maps the proxy root
 * (`<app-id>.discordsays.com`) to `costan.io`, so relative `/api` fetches and
 * the `wss://${location.host}/ws` socket (see ws.ts) reach the backend through
 * the proxy. Do not call `patchUrlMappings`: with a self-referential target it
 * prepends the prefix, turning `/api/token` into `/api/api/token` (404).
 */
export async function runActivityBootstrap(): Promise<ActivityResult> {
  if (!CLIENT_ID) throw new Error("VITE_DISCORD_CLIENT_ID is not set");
  // The only value use of the SDK; see the top of the file.
  const { DiscordSDK } = await import("@discord/embedded-app-sdk");
  const sdk = new DiscordSDK(CLIENT_ID);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    // rpc.activities.write is needed for sdk.commands.setActivity (Rich
    // Presence, see lib/richPresence.ts).
    scope: ["identify", "rpc.activities.write"],
  });

  const tokenRes = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, instance_id: sdk.instanceId }),
  });
  if (!tokenRes.ok) throw new Error("Discord token exchange failed");
  const { access_token, session_token } = (await tokenRes.json()) as {
    access_token: string;
    session_token: string;
  };
  setBearer(session_token);

  await sdk.commands.authenticate({ access_token });
  activitySdk = sdk; // expose the authorized client for Rich Presence updates

  const lobbyRes = await fetch("/api/activity/lobby", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session_token}` },
    body: JSON.stringify({ instance_id: sdk.instanceId }),
  });
  if (!lobbyRes.ok) throw new Error("Could not join the call's table");
  const result = activityResult((await lobbyRes.json()) as ActivityLobbyResponse);

  // The call's game now exists, so start mirroring the activity's live
  // participant set into the lobby roster (drops seats when someone leaves).
  startActivityPresenceSync(sdk, sdk.instanceId, session_token);
  return result;
}

/**
 * Keeps the lobby roster in sync with who is in the Discord activity. Discord
 * keeps the iframe and its websocket alive after a participant leaves, so the
 * server's disconnect cleanup never runs. Every client reports the live
 * participant set; the backend acts only on the host's report and drops seats
 * whose Discord account is gone.
 */
function startActivityPresenceSync(
  sdk: DiscordSDK,
  instanceID: string,
  sessionToken: string,
): void {
  const report = (participants: ReadonlyArray<{ id: string; bot: boolean }>) => {
    const ids = participants.filter((p) => !p.bot).map((p) => p.id);
    void fetch("/api/activity/participants", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ instance_id: instanceID, discord_ids: ids }),
    }).catch(() => {
      /* best-effort; the next update corrects a dropped report */
    });
  };

  // React to joins/leaves as Discord reports them...
  void sdk.subscribe("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE", (data) => report(data.participants));
  // ...and seed the current roster now, since the event only fires on change.
  sdk.commands
    .getInstanceConnectedParticipants()
    .then((data) => report(data.participants))
    .catch(() => {
      /* ignore; the next participants-update covers it */
    });
}
