-- 0014_openskill.sql: upgrade per-ruleset ratings to OpenSkill (mu/sigma).
-- The existing `elo` column is retained as the cached display value.
ALTER TABLE ratings ADD COLUMN mu REAL NOT NULL DEFAULT 25.0;
ALTER TABLE ratings ADD COLUMN sigma REAL NOT NULL DEFAULT 8.3333333;
-- Backfill mu so Display(mu,sigma=6) == existing elo: mu = (elo-1000)/24 + 18.
UPDATE ratings SET sigma = 6.0, mu = (elo - 1000.0) / 24.0 + 18.0;
