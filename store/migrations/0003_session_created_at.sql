-- Track when each session was minted so an absolute lifetime cap can be
-- enforced independently of the sliding expiry (a leaked token must eventually
-- die even if it keeps being used). Existing rows default to 0 (epoch), which
-- makes them immediately past any positive max-age and forces re-login.
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
