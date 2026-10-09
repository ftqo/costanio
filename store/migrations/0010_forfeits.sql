-- Records that a user forfeited a game, by disconnecting and being replaced by
-- a bot for a full round, or by leaving for another table mid-game. Sticky: kept
-- even if the player reconnects and the game finishes. Consumed by ranked (later)
-- to withhold credit; has no behavioral effect yet.
CREATE TABLE forfeits (
    game_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    ts      INTEGER NOT NULL,
    PRIMARY KEY (game_id, user_id)
);
