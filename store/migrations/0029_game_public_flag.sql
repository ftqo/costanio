-- A separate public flag, so privacy no longer depends on the invite code.
--
-- Every lobby game keeps its code for its whole life, and `public` alone
-- decides listing and code-free joining. The code is UNIQUE, so a link still
-- admits its holder to a private table.
ALTER TABLE games ADD COLUMN public INTEGER NOT NULL DEFAULT 0;

-- Backfill the old encoding: a game with no code was public.
UPDATE games SET public = 1 WHERE invite_code IS NULL;

-- Existing public games keep a NULL code (SQL cannot mint unique random ids
-- per row); the lobby shows no code for them.

-- Index for the public game browser.
CREATE INDEX IF NOT EXISTS idx_games_public_status ON games(public, status);
