-- The seats primary key is (game_id, seat_no), which does not stop the same user
-- from holding two seats in one game: two concurrent lobby.Join requests could
-- both pass the ErrAlreadySeated pre-check. Enforce one seat per user per game
-- with a unique index (a plain index avoids a full table rebuild).

-- Dedupe first, or the CREATE INDEX fails on any database where the race
-- happened and the server does not start (see
-- TestMigrate0025DedupesDoubleSeatedUsers). Keep the lowest seat_no: the first
-- INSERT is the seat the user was shown. A no-op on a clean database.
DELETE FROM seats WHERE rowid NOT IN (
    SELECT MIN(rowid) FROM seats GROUP BY game_id, user_id
);

CREATE UNIQUE INDEX seats_game_user ON seats(game_id, user_id);
