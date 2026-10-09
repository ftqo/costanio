-- Casual results were counted and could not be read back.
--
-- `stats.games`/`wins`/`draws` is the career total and 0032 split out a
-- `ranked_*` mirror. Neither answers "how do I do at a normal four-player
-- table", so this adds a third mirror on the same pattern.
--
-- Four players only: it is the count the game is balanced around, and the only
-- one where a win rate compares across tables (fair share 25%). Pooling 2-player
-- (50%) and 10-player (10%) games would measure who you sat with. Other counts
-- still land in `games`/`wins` and `match_history`.
ALTER TABLE stats ADD COLUMN casual_games INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_wins  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stats ADD COLUMN casual_draws INTEGER NOT NULL DEFAULT 0;

-- Bot strength, keyed by personality rather than by user.
--
-- Every bot is a fresh guest account per game (lobby.AddBot calls CreateGuest),
-- so its `stats` row covers one game. The seat's display name ("Bot Winston") is
-- the only record of which weight vector sat there, so it is the key, stored
-- exactly as on the seat. This is for spotting a personality that stops winning;
-- it has no effect on ratings, the leaderboard or human stats, and uses the
-- same four-player guard.
CREATE TABLE bot_stats (
    bot_name TEXT    NOT NULL,
    ruleset  TEXT    NOT NULL,
    games    INTEGER NOT NULL DEFAULT 0,
    wins     INTEGER NOT NULL DEFAULT 0,
    draws    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bot_name, ruleset)
);

-- Backfill both from the tables that already hold every fact needed, exactly as
-- 0032 does: `seats` carries participation (human seat = status != 'bot'),
-- `forfeits` is sticky by design (0010) and reproduces finalize's exclusion of a
-- forfeited seat, and the player count is the seat count.
--
-- The four-player predicate is a correlated COUNT over `seats` rather than
-- anything on `games`: there is no player-count column, and `games.config`
-- holds the configured count, which lobby.Start rewrites down to the number of
-- seats that actually started. Seats are what played.
UPDATE stats SET
  casual_games = COALESCE((
    SELECT COUNT(*) FROM games g JOIN seats s ON s.game_id = g.id
     WHERE g.status = 'finished' AND g.ranked = 0 AND g.ruleset = stats.ruleset
       AND s.user_id = stats.user_id AND s.status != 'bot'
       AND (SELECT COUNT(*) FROM seats s2 WHERE s2.game_id = g.id) = 4
       AND NOT EXISTS (SELECT 1 FROM forfeits f WHERE f.game_id = g.id AND f.user_id = s.user_id)), 0),
  casual_wins = COALESCE((
    SELECT COUNT(*) FROM games g JOIN seats s ON s.game_id = g.id
     WHERE g.status = 'finished' AND g.ranked = 0 AND g.ruleset = stats.ruleset
       AND s.user_id = stats.user_id AND s.status != 'bot'
       AND g.winner_user_id = s.user_id
       AND (SELECT COUNT(*) FROM seats s2 WHERE s2.game_id = g.id) = 4
       AND NOT EXISTS (SELECT 1 FROM forfeits f WHERE f.game_id = g.id AND f.user_id = s.user_id)), 0),
  casual_draws = COALESCE((
    SELECT COUNT(*) FROM games g JOIN seats s ON s.game_id = g.id
     WHERE g.status = 'finished' AND g.ranked = 0 AND g.ruleset = stats.ruleset
       AND s.user_id = stats.user_id AND s.status != 'bot'
       AND g.winner_user_id IS NULL
       AND (SELECT COUNT(*) FROM seats s2 WHERE s2.game_id = g.id) = 4
       AND NOT EXISTS (SELECT 1 FROM forfeits f WHERE f.game_id = g.id AND f.user_id = s.user_id)), 0);

-- Bot rows are reconstructed from the same games. `users.name` is where the
-- personality lives (the bot's guest account is created under its display
-- name), so the join is to `users` rather than to anything on the seat.
INSERT INTO bot_stats (bot_name, ruleset, games, wins, draws)
SELECT u.name, g.ruleset,
       COUNT(*),
       SUM(CASE WHEN g.winner_user_id = s.user_id THEN 1 ELSE 0 END),
       SUM(CASE WHEN g.winner_user_id IS NULL THEN 1 ELSE 0 END)
  FROM games g
  JOIN seats s ON s.game_id = g.id
  JOIN users u ON u.id = s.user_id
 WHERE g.status = 'finished' AND g.ranked = 0 AND s.status = 'bot'
   AND u.name != ''
   AND (SELECT COUNT(*) FROM seats s2 WHERE s2.game_id = g.id) = 4
 GROUP BY u.name, g.ruleset;
