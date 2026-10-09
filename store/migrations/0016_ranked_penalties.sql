CREATE TABLE ranked_penalties (
    user_id        INTEGER PRIMARY KEY,
    strikes        INTEGER NOT NULL DEFAULT 0,
    cooldown_until INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER NOT NULL DEFAULT 0
);
