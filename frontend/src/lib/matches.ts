import type { PlayerStat } from "./types";
import { apiGet } from "./api";

export interface MatchSummaryRow {
  seat: number;
  user_id: number;
  name: string;
  is_bot: boolean;
  color?: string;
  vp: number;
}

export interface MatchSummary {
  game_id: string;
  ruleset: string;
  ranked: boolean;
  finished_at: number;
  winner: number;
  players: MatchSummaryRow[];
}

export interface MatchSeat {
  seat: number;
  user_id: number;
  name: string;
  is_bot: boolean;
  color?: string;
}

export interface MatchRecord {
  version: number;
  game_id: string;
  ruleset: string;
  ranked: boolean;
  finished_at: number;
  seats: MatchSeat[];
  scoreboard: {
    winner: number;
    players: PlayerStat[];
    rolls: Record<number, number>;
    turns: number;
    /** Absent on every record frozen before the VP chart existed. */
    vp_track?: number[][];
  };
}

const matchCache = new Map<string, MatchRecord>();

/** Synchronous cache read: the record if already fetched, else undefined. */
export function getCachedMatch(gameId: string): MatchRecord | undefined {
  return matchCache.get(gameId);
}

export async function fetchUserMatches(
  userId: number,
  before = 0,
  limit = 20,
): Promise<MatchSummary[]> {
  const qs = new URLSearchParams();
  if (before) qs.set("before", String(before));
  if (limit) qs.set("limit", String(limit));
  const data = await apiGet<{ matches: MatchSummary[] }>(`/api/users/${userId}/matches?${qs}`);
  return data.matches;
}

export async function fetchMatch(gameId: string): Promise<MatchRecord> {
  const cached = matchCache.get(gameId);
  if (cached) return cached;
  const rec = await apiGet<MatchRecord>(`/api/matches/${gameId}`);
  matchCache.set(gameId, rec);
  return rec;
}

/**
 * A game's whole event log: every move, in order, as the server recorded it.
 *
 * Not cached, unlike a match record: it can run to thousands of events, is
 * fetched on request and written straight to a file, and would otherwise stay
 * alive for the life of the tab.
 */
export interface Replay {
  game: string;
  events: unknown[];
  /**
   * Who held each seat over the game, anchored to log positions. Each event
   * carries its own `src`; this covers the stretches between, including a
   * player retaking a seat from a bot (which emits no event). Absent for older
   * games.
   */
  seat_control?: unknown[];
}

export function fetchReplay(gameId: string): Promise<Replay> {
  return apiGet<Replay>(`/api/games/${gameId}/replay`);
}

/**
 * What a downloaded replay is called: the game id, which is what identifies it
 * to the server, a bug report or `costan-sim`.
 */
export function replayFilename(gameId: string): string {
  // Ids are server-generated and already safe, but sanitise anyway.
  return `costan-replay-${gameId.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
}
