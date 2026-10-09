-- Maps a Discord Activity launch (instanceId, shared by everyone who opens the
-- Activity in a voice call) to exactly one game. The PRIMARY KEY is the
-- find-or-create concurrency guard: the first opener creates the game, later
-- openers read the same row.
CREATE TABLE activity_instances (
    instance_id TEXT PRIMARY KEY,
    game_id     TEXT NOT NULL REFERENCES games(id),
    created_at  INTEGER NOT NULL
);
