import type {
  Summary,
  GameDetail,
  Me,
  GameConfig,
  LeaderboardEntry,
  Friend,
  ApiError,
  Board,
  PreviewEnvelope,
  MapIssue,
  MapRow,
  ColorView,
  CosmeticItem,
  WalletEntry,
  SupporterView,
} from "./types";
import type { ReplaySource } from "./replay/types";
import { getBearer } from "./session";

/**
 * A failed API call.
 *
 * `message` is the code, not the server's wording, so a screen that renders
 * `e.message` by mistake shows an obvious token rather than backend prose.
 * Render with `apiErrorText(e, fallback)` from lib/errorCopy.
 */
export class ApiErr extends Error {
  code: string;
  status: number;
  params?: Record<string, unknown>;
  constructor(status: number, code: string, params?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

/**
 * True for a 4xx that a retry will not fix: 404 (no such game), 403 (private
 * or not yours), 401 (logged out). A screen may treat these as terminal.
 *
 * 429 is not fatal: a rate limit is transient, and the server meters the game
 * endpoints, so treating it as terminal would walk a player out of their game.
 * 5xx and dropped connections are retryable too.
 */
export function isFatalApiError(err: unknown): boolean {
  return err instanceof ApiErr && err.status >= 400 && err.status < 500 && err.status !== 429;
}

/**
 * TanStack Query `retry` for the shared ["game", id] query: retries transient
 * errors and stops on terminal 4xx so the screen's redirect fires.
 */
export function retryUnlessFatal(count: number, err: unknown): boolean {
  return !isFatalApiError(err) && count < 4;
}

/** Exponential backoff for the above, capped so a long outage keeps polling. */
export function retryBackoffMs(count: number): number {
  return Math.min(500 * 2 ** count, 15_000);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const bearer = getBearer();
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`; // Discord Activity
  const res = await fetch(path, {
    method,
    credentials: "include", // session cookie (same-origin via Vite proxy / prod)
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    // Only the code and its parameters pass through; `debug` is dropped so no
    // screen can render it.
    const e = (data ?? {}) as Partial<ApiError>;
    throw new ApiErr(res.status, e.code ?? "INTERNAL", e.params);
  }
  return data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return req<T>("GET", path);
}

export const api = {
  // auth
  me: () => req<Me>("GET", "/api/users/me"),
  /**
   * Who is signed in: the same profile as `me`, or null for a visitor. Used as
   * the page-load probe because the server answers 204 here instead of 401,
   * and browsers log every 4xx to the console.
   */
  session: async (): Promise<Me | null> =>
    (await req<Me | undefined>("GET", "/api/session")) ?? null,
  // Create an anonymous guest session. The player picks a name later in the
  // waiting room.
  anon: () => req<{ id: number; name: string; guest: boolean }>("POST", "/auth/guest"),
  updateMe: (name: string) => req<Me>("PATCH", "/api/users/me", { name }),
  logout: () => req<void>("POST", "/auth/logout"),
  // The profile menu's feedback form. `page` is the path the player was on.
  feedback: (msg: string, page: string) => req<void>("POST", "/api/feedback", { msg, page }),

  // lobby & games
  browse: () => req<{ games: Summary[] }>("GET", "/api/games"),
  liveGames: () => req<{ games: Summary[] }>("GET", "/api/games/live"),
  createGame: (config: GameConfig, priv: boolean) =>
    req<Summary>("POST", "/api/games", { config, private: priv }),
  // `since` is where the caller's event log resumes: 0 (or omitted) asks for
  // the whole redacted log; a reconnecting client passes the first seq it is
  // missing.
  //
  // `invite` is the route's `?inv=` code. Without it the server refuses a
  // private game to a spectator, as with the websocket `sub` frame.
  getGame: (id: string, since?: number, invite?: string) => {
    const q = new URLSearchParams();
    if (since) q.set("since", String(since));
    if (invite) q.set("inv", invite);
    const s = q.toString();
    return req<GameDetail>("GET", `/api/games/${id}${s ? `?${s}` : ""}`);
  },
  join: (id: string, invite?: string) =>
    req<Summary>("POST", `/api/games/${id}/join`, { invite: invite ?? "" }),
  leave: (id: string) => req<void>("POST", `/api/games/${id}/leave`),
  spectate: (id: string) => req<Summary>("POST", `/api/games/${id}/spectate`),
  rejoin: (id: string) => req<void>("POST", `/api/games/${id}/return`),
  start: (id: string) => req<void>("POST", `/api/games/${id}/start`),
  reset: (id: string) => req<void>("POST", `/api/games/${id}/reset`),
  updateConfig: (id: string, config: GameConfig) =>
    req<Summary>("POST", `/api/games/${id}/config`, config),
  setPrivacy: (id: string, priv: boolean) =>
    req<Summary>("POST", `/api/games/${id}/privacy`, { private: priv }),
  addBot: (id: string) => req<Summary>("POST", `/api/games/${id}/bots`),
  kick: (id: string, seat: number) => req<Summary>("DELETE", `/api/games/${id}/seats/${seat}`),
  transferHost: (id: string, newHostID: number) =>
    req<Summary>("POST", `/api/games/${id}/transfer-host`, { new_host_id: newHostID }),
  setSeatColor: (id: string, color: string) =>
    req<Summary>("POST", `/api/games/${id}/color`, { color }),
  setSeatName: (id: string, name: string) =>
    req<Summary>("POST", `/api/games/${id}/name`, { name }),
  setSeatDecoration: (id: string, decoration: string) =>
    req<Summary>("POST", `/api/games/${id}/decoration`, { decoration }),
  colors: () => req<{ colors: ColorView[] }>("GET", "/api/colors"),
  loadout: () => req<{ loadout: Record<string, string> }>("GET", "/api/me/loadout"),
  setLoadout: (slot: string, itemId: string) =>
    req<{ loadout: Record<string, string> }>("PUT", "/api/me/loadout", { slot, item_id: itemId }),
  cosmetics: () => req<{ items: CosmeticItem[] }>("GET", "/api/cosmetics"),
  // Self role status. GET self-heals (TTL-gated Discord re-pull); refreshRoles
  // forces an unconditional pull (the manual "sync roles" button, rate-limited).
  supporter: () => req<SupporterView>("GET", "/api/me/supporter"),
  refreshRoles: () => req<SupporterView>("POST", "/api/me/supporter/refresh"),
  wallet: () => req<{ balance: number; recent: WalletEntry[] }>("GET", "/api/me/wallet"),
  purchase: (id: string) =>
    req<{ owned: boolean; balance: number }>(
      "POST",
      `/api/cosmetics/${encodeURIComponent(id)}/purchase`,
    ),
  // Replay frames: the log folded into the board after each event, the only
  // form a client can draw (see lib/replay/types). One endpoint for a game the
  // server holds and one for a file the viewer holds; both return the same
  // shape. `invite` lets someone invited to a private game watch it back
  // (mayReadOver on the server).
  gameFrames: (id: string, invite?: string) =>
    req<ReplaySource>(
      "GET",
      `/api/games/${id}/frames${invite ? `?inv=${encodeURIComponent(invite)}` : ""}`,
    ),
  foldReplay: (file: { game?: string; events: unknown[] }) =>
    req<ReplaySource>("POST", "/api/replay/frames", file),
  // The finished log as raw text, for the fairness verifier. Not `req`,
  // because JSON.parse turns the uint64 seed into a double and the commitment
  // check would fail. The verifier reads the digits from the text (see
  // verify/verify.mjs, exactSeeds).
  replayText: async (id: string, invite?: string): Promise<string> => {
    const headers: Record<string, string> = {};
    const bearer = getBearer();
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    const res = await fetch(
      `/api/games/${id}/replay${invite ? `?inv=${encodeURIComponent(invite)}` : ""}`,
      { credentials: "include", headers },
    );
    const text = await res.text();
    if (!res.ok) {
      let code = "INTERNAL";
      try {
        code = (JSON.parse(text) as Partial<ApiError>).code ?? code;
      } catch {
        // A non-JSON error body: the code stays INTERNAL.
      }
      throw new ApiErr(res.status, code);
    }
    return text;
  },
  invite: (code: string) => req<Summary>("GET", `/api/invites/${code}`),

  // profiles & social
  user: (id: number) => req<Me>("GET", `/api/users/${id}`),
  leaderboard: (ruleset: string) =>
    req<{ ruleset: string; entries: LeaderboardEntry[] }>(
      "GET",
      `/api/leaderboard?ruleset=${encodeURIComponent(ruleset)}`,
    ),
  presets: () => req<{ presets: string[] }>("GET", "/api/presets"),
  presetBoard: (name: string) =>
    req<{ board: Board }>("GET", `/api/presets/${encodeURIComponent(name)}/board`),
  friends: () => req<{ friends: Friend[] }>("GET", "/api/social/friends"),

  // custom maps
  saveMap: (name: string, board: Board) => req<MapRow>("POST", "/api/maps", { name, board }),
  listMaps: () => req<{ maps: MapRow[] }>("GET", "/api/maps"),
  listMyMaps: () => req<{ maps: MapRow[] }>("GET", "/api/maps?mine=1"),
  getMap: (id: string) => req<MapRow>("GET", `/api/maps/${id}`),
  deleteMap: (id: string) => req<void>("DELETE", `/api/maps/${id}`),
  encodeMap: (board: Board) => req<{ code: string }>("POST", "/api/maps/encode", { board }),
  decodeMap: (code: string) => req<{ board: Board }>("POST", "/api/maps/decode", { code }),
  frameMap: (board: Board) =>
    req<{ board: Board }>("POST", "/api/maps/frame", { board }).then((r) => r.board),
  lintMap: (board: Board, ruleset = "base") =>
    req<{ issues: MapIssue[] }>("POST", "/api/maps/lint", { board, ruleset }),
  /**
   * Roll a fair (or random) fill onto a shape. `seed` rolls the tiles and
   * `portSeed` the ports; both are decimal strings (see `previewBoard`). Omit
   * `seed` to get a random one, omit `portSeed` to derive ports from the tile
   * seed. The reply reports the seeds used, so the same seeds on the same
   * shape roll the same board.
   */
  randomizeMap: (board: Board, opts: { mode?: string; seed?: string; portSeed?: string } = {}) =>
    req<{ board: Board; seed: string; harbor_seed: string }>("POST", "/api/maps/randomize", {
      board,
      mode: opts.mode,
      seed: opts.seed || undefined,
      harbor_seed: opts.portSeed || undefined,
    }),
  /** Replace the board's ports with a freshly generated set (engine placement), from `seed` when given. */
  harborsMap: (board: Board, seed?: string) =>
    req<{ board: Board; seed: string }>("POST", "/api/maps/harbors", {
      board,
      seed: seed || undefined,
    }),

  /**
   * The map builder's board, dealt the way a table would deal it: framed,
   * resolved from the seed where blank, ported, and reshaped by every module
   * in the ruleset. Nothing is saved; see server/preview.go.
   *
   * The seed is a string both ways because it is a uint64 and JSON numbers are
   * float64. Omit it to get a random one, which the response reports.
   */
  previewBoard: (body: { ruleset: string; seed?: string; board: Board; players?: number }) =>
    req<PreviewEnvelope>("POST", "/api/preview", { ...body, seed: body.seed || undefined }),

  // ranked queue
  rankedJoin: (queue: string) => req<void>("POST", "/api/ranked/queue", { queue }),
  rankedLeave: () => req<void>("DELETE", "/api/ranked/queue"),
  rankedStatus: () =>
    req<{ queued: boolean; queue: string; pool: number }>("GET", "/api/ranked/queue"),

  // identity management
  unlinkProvider: (provider: string) => req<void>("DELETE", `/api/users/me/identities/${provider}`),

  // account merge
  mergePreview: (token: string) =>
    req<MergePreview>("GET", `/api/merge/preview?token=${encodeURIComponent(token)}`),
  mergeConfirm: (token: string) => req<void>("POST", "/api/merge", { token }),
};

export type MergePreview = {
  provider: string;
  victim: { name: string; avatar: string; games: number; isSupporter: boolean; createdAt: number };
  blocked: "" | "shared_game";
};
