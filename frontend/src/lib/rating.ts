import type { UserStats } from "./types";

// Below this many rated games a rating is "provisional", shown muted with a `?`
// (we store ELO and a games count, not a rating deviation).
export const PROVISIONAL_GAMES = 10;

export function isProvisional(games: number): boolean {
  return games < PROVISIONAL_GAMES;
}

// highestRating returns the per-ruleset stat with the best ELO, used on compact
// surfaces where only one number fits. Returns null when there are no stats.
export function highestRating(stats: UserStats[] | null | undefined): UserStats | null {
  if (!stats || stats.length === 0) return null;
  return stats.reduce((best, s) => (s.elo > best.elo ? s : best));
}

// Rulesets whose games move rating. Mirrors the backend's ranked queues
// (ranked/rulesets.go): only 4p Base and 4p Knights. Other rulesets accrue
// stats with a placeholder 1000 ELO, so anything showing a rating must filter
// to these (see highestRankedRating).
export const RANKED_RULESETS = new Set(["base", "base+cak"]);

export function isRanked(ruleset: string): boolean {
  return RANKED_RULESETS.has(ruleset);
}

// highestRankedRating is highestRating restricted to ranked rulesets, for
// anywhere a single ELO is shown as the player's rating. Null when the player
// has no ranked games (callers show "Unrated").
export function highestRankedRating(stats: UserStats[] | null | undefined): UserStats | null {
  if (!stats) return null;
  return highestRating(stats.filter((s) => isRanked(s.ruleset)));
}
