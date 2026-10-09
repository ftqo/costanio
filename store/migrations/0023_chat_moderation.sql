-- Chat moderation: bans, reports, strikes, and runtime config.

CREATE TABLE chat_bans (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    reason     TEXT NOT NULL,
    banned_at  INTEGER NOT NULL,
    banned_by  INTEGER REFERENCES users(id), -- mod's user id; NULL if unresolved
    report_id  INTEGER,                       -- the report that triggered it; NULL for manual
    expires_at INTEGER                        -- reserved for future timed bans; unused (always NULL)
);

CREATE TABLE chat_reports (
    id                 INTEGER PRIMARY KEY,
    reporter_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accused_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id            INTEGER NOT NULL REFERENCES chat(id),
    scope              TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'resolved'
    resolution         TEXT,                          -- NULL | 'none' | 'warn' | 'ban'
    report_count       INTEGER NOT NULL DEFAULT 1,    -- bumped when re-reported
    discord_message_id TEXT NOT NULL DEFAULT '',      -- mod-channel message (audit only)
    created_at         INTEGER NOT NULL,
    resolved_at        INTEGER,
    resolved_by        INTEGER REFERENCES users(id)
);
CREATE INDEX reports_accused ON chat_reports(accused_id);
CREATE UNIQUE INDEX reports_one_open ON chat_reports(chat_id) WHERE status = 'open';

CREATE TABLE mod_strikes (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,                 -- 'warn' (on accused) | 'denial' (on reporter)
    report_id  INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX strikes_user_kind ON mod_strikes(user_id, kind, created_at);

CREATE TABLE mod_config (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
