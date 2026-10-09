-- Drawn games are counted separately from losses.
--
-- A game can finish with no winner: an agreed draw, or a claim against bots
-- with nobody ahead. Counting those as games+1, wins+0 would show a draw as a
-- defeat on profiles and leaderboards. "games" stays the total.
--
-- No backfill: no earlier game could draw, so the default 0 is correct.
ALTER TABLE stats ADD COLUMN draws INTEGER NOT NULL DEFAULT 0;
