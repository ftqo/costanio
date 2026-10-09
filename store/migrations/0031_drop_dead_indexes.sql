-- Drop two indexes the query planner never chooses. Each costs a write on
-- every INSERT and UPDATE to `games`.
--
-- games_status (0001) is `games(status)`, a prefix of games_status_created
-- (0017) `games(status, created_at DESC)`. The longer index seeks the same rows
-- and also supplies the ORDER BY, so ListGames, ActiveGameForUser and
-- SeatedGameForUser all plan on games_status_created.
DROP INDEX IF EXISTS games_status;

-- idx_games_public_status (0029) is `games(public, status)`. The browser query
-- (`WHERE status = ? AND public = 1 ORDER BY created_at DESC LIMIT 100`) plans
-- on games_status_created, which satisfies the ORDER BY and lets the LIMIT stop
-- early. A leading two-value `public` column cannot compete.
DROP INDEX IF EXISTS idx_games_public_status;

-- Kept:
--
--   * 0022's `CREATE INDEX IF NOT EXISTS seats_user` duplicates 0001's and is a
--     no-op. The index itself is used (guest merge, SeatForUser).
--   * chat_bans.expires_at is unused, reserved for timed bans (see 0023).
--   * chat_reports.discord_message_id is written by SetReportDiscordMessageID
--     and read by no Go code; it lets a moderator find the report's message.
