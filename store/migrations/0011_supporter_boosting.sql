-- Track whether a supporter is *currently boosting* the server, independent of
-- the binary `active` flag. Drives the booster-only name decoration: a subscriber
-- who does not boost is active-but-not-boosting; a booster is both.
ALTER TABLE supporter_status ADD COLUMN boosting INTEGER NOT NULL DEFAULT 0;
