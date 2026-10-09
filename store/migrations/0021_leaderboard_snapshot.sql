-- Daily leaderboard snapshot. Ratings still update per game in `ratings`; the
-- public leaderboard (web + Discord) reads this snapshot instead, and a
-- background job rebuilds it every 24h, so standings stay stable for the day.
CREATE TABLE leaderboard_snapshot (
    ruleset     TEXT NOT NULL,
    user_id     INTEGER NOT NULL,
    elo         REAL NOT NULL,
    sigma       REAL NOT NULL,
    games       INTEGER NOT NULL DEFAULT 0,
    wins        INTEGER NOT NULL DEFAULT 0,
    captured_at INTEGER NOT NULL,
    PRIMARY KEY (ruleset, user_id)
);
CREATE INDEX leaderboard_snapshot_rank ON leaderboard_snapshot(ruleset, elo DESC);
