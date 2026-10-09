-- Indexes for queries that EXPLAIN QUERY PLAN showed full-scanning or
-- temp-sorting tables that grow without bound. Each one turns a SCAN (+ TEMP
-- B-TREE sort) into an index SEARCH so the query stays O(result) as the DB grows
-- rather than O(table). See the SQL scalability audit.

-- Leaderboard: SELECT ... WHERE ruleset = ? ORDER BY elo DESC LIMIT N.
-- Without this it SCANs all ratings + sorts in a temp b-tree on every load
-- (and the endpoint is public). The DESC on elo lets the LIMIT short-circuit.
CREATE INDEX ratings_leaderboard ON ratings(ruleset, elo DESC);

-- Faucet/daily-reward cap check: COUNT(*) WHERE user_id = ? AND reason = ?
-- AND amount > 0 AND created_at >= ?. wallet_ledger is append-only; the
-- user_id-only index left reason/created_at as residual filters over a user's
-- entire lifetime ledger. This bounds it to the (reason, time-window) slice.
CREATE INDEX wallet_ledger_faucet ON wallet_ledger(user_id, reason, created_at);

-- Hourly session sweep: DELETE WHERE expires_at < ? (the max-age arm is
-- redundant: expires_at is clamped to created_at + maxAge). Without this the
-- sweep scans the whole sessions table under the write lock.
CREATE INDEX sessions_expires_at ON sessions(expires_at);

-- Guest->Discord account merge rewrites these columns; without indexes each
-- merge full-scanned every game / chat message ever recorded.
CREATE INDEX games_created_by ON games(created_by);
CREATE INDEX games_winner_user_id ON games(winner_user_id);
CREATE INDEX chat_user ON chat(user_id);

-- Supporter background jobs: WHERE active = 1 [AND updated_at < ? ORDER BY
-- updated_at LIMIT N]. Covers both ActiveSupporters (active prefix) and
-- StaleSupporters (active + updated_at range, no temp sort).
CREATE INDEX supporter_status_stale ON supporter_status(active, updated_at);

-- Maps gallery: ORDER BY created_at DESC LIMIT 200 over the whole maps table.
CREATE INDEX maps_created_at ON maps(created_at DESC);

-- Game browse/listing: WHERE status = ? ORDER BY created_at DESC LIMIT 100.
-- Safe today (only status='lobby', cached) but future finished/active listings
-- would sort the unbounded games table; this lets the LIMIT short-circuit.
CREATE INDEX games_status_created ON games(status, created_at DESC);
