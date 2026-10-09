-- Ranked-only game, win and draw counts for the leaderboard.
--
-- `stats` counts every finished game (casual, against bots, any player count)
-- for the profile's career total. `ratings` covers ranked games only, so the
-- leaderboard needs ranked counts to sit beside a ranked rating.
-- `ranked_draws` mirrors `stats.draws` (0027); no column shows it yet.
ALTER TABLE stats ADD COLUMN ranked_games INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN ranked_wins  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN ranked_draws INTEGER NOT NULL DEFAULT 0;

-- Backfill from games, seats and forfeits. Participation comes from seats
-- (human seat = status != 'bot', see 0022). `forfeits` is sticky (0010), so
-- finalize's exclusion of a forfeited seat can be reproduced.
--
-- Ranked games seat only account holders, so the bot filter is a no-op; it is
-- kept so the query states its intent.
UPDATE stats SET
  ranked_games = COALESCE((
    SELECT COUNT(*) FROM games g JOIN seats s ON s.game_id = g.id
     WHERE g.status = 'finished' AND g.ranked = 1 AND g.ruleset = stats.ruleset
       AND s.user_id = stats.user_id AND s.status != 'bot'
       AND NOT EXISTS (SELECT 1 FROM forfeits f WHERE f.game_id = g.id AND f.user_id = s.user_id)), 0),
  ranked_wins = COALESCE((
    SELECT COUNT(*) FROM games g JOIN seats s ON s.game_id = g.id
     WHERE g.status = 'finished' AND g.ranked = 1 AND g.ruleset = stats.ruleset
       AND s.user_id = stats.user_id AND s.status != 'bot'
       AND g.winner_user_id = s.user_id
       AND NOT EXISTS (SELECT 1 FROM forfeits f WHERE f.game_id = g.id AND f.user_id = s.user_id)), 0),
  ranked_draws = COALESCE((
    SELECT COUNT(*) FROM games g JOIN seats s ON s.game_id = g.id
     WHERE g.status = 'finished' AND g.ranked = 1 AND g.ruleset = stats.ruleset
       AND s.user_id = stats.user_id AND s.status != 'bot'
       AND g.winner_user_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM forfeits f WHERE f.game_id = g.id AND f.user_id = s.user_id)), 0);
