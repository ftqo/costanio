-- The public (verifiable) seed is drawn and committed when the lobby opens,
-- before the table's composition, ruleset or player count are settled, so the
-- server cannot redraw it until it gets a board or seating it likes. The
-- commitment is published to the lobby; the seed is revealed with the finished
-- game's replay, and these stored bytes start the game.
--
-- The private seed (steals, dev cards) is not stored here. It is drawn at
-- start; its outcomes are unknowable at draw time, so committing it early adds
-- nothing.
ALTER TABLE games ADD COLUMN public_seed TEXT;
ALTER TABLE games ADD COLUMN public_seed_commit TEXT;

-- Older games have neither column set. They start from a seed drawn at start
-- driving one stream, and verify/ reports them as legacy.

-- `public_seed` is TEXT because SQLite's INTEGER is signed 64-bit and the seed
-- is unsigned; a decimal string round-trips without the top bit flipping sign.

-- The pre-shuffle roster, so the seating can be checked. The log records who
-- ended up at each seat; without the input order the permutation cannot be
-- verified. JSON array of user ids, in pre-shuffle order. NULL for older games
-- and for games whose turn order was `lobby` (seat order is join order).
ALTER TABLE games ADD COLUMN pre_shuffle_seats TEXT;
