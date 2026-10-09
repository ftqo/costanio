CREATE TABLE users (
    id         INTEGER PRIMARY KEY,
    discord_id TEXT UNIQUE,
    is_guest   INTEGER NOT NULL DEFAULT 0,
    name       TEXT NOT NULL,
    avatar     TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE games (
    id             TEXT PRIMARY KEY,
    status         TEXT NOT NULL DEFAULT 'lobby', -- lobby|active|finished|paused-error
    ruleset        TEXT NOT NULL,
    config         TEXT NOT NULL,                 -- JSON GameConfig
    invite_code    TEXT UNIQUE,                   -- NULL = public
    created_by     INTEGER NOT NULL REFERENCES users(id),
    winner_user_id INTEGER REFERENCES users(id),
    created_at     INTEGER NOT NULL,
    finished_at    INTEGER
);
CREATE INDEX games_status ON games(status);

CREATE TABLE seats (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seat_no INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status  TEXT NOT NULL DEFAULT 'active', -- active|auto|bot
    PRIMARY KEY (game_id, seat_no)
);
CREATE INDEX seats_user ON seats(user_id);

CREATE TABLE events (
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    type       TEXT NOT NULL,
    data       TEXT NOT NULL, -- JSON
    visible_to TEXT,          -- JSON array of seat numbers; NULL = public
    ts         INTEGER NOT NULL,
    PRIMARY KEY (game_id, seq)
);

CREATE TABLE snapshots (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seq     INTEGER NOT NULL,
    state   BLOB NOT NULL,
    PRIMARY KEY (game_id, seq)
);

CREATE TABLE chat (
    id      INTEGER PRIMARY KEY,
    scope   TEXT NOT NULL, -- 'lobby' | 'game:<id>'
    user_id INTEGER NOT NULL REFERENCES users(id),
    msg     TEXT NOT NULL,
    ts      INTEGER NOT NULL
);
CREATE INDEX chat_scope ON chat(scope, id);

CREATE TABLE stats (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ruleset TEXT NOT NULL,
    games   INTEGER NOT NULL DEFAULT 0,
    wins    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, ruleset)
);

CREATE TABLE ratings (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ruleset    TEXT NOT NULL,
    elo        REAL NOT NULL DEFAULT 1000,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, ruleset)
);
