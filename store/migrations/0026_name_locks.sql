-- Name locks: a user who tries to set a slur as a display name has their name
-- frozen (like a chat ban) until a moderator lifts it with /unlock-name. Mirrors
-- the chat_bans shape.

CREATE TABLE name_locks (
    user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    reason    TEXT NOT NULL DEFAULT '',
    locked_at INTEGER NOT NULL,
    locked_by INTEGER REFERENCES users(id)  -- acting mod's user id; NULL for auto-lock
);
