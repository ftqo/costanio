-- Match history: one opaque JSON scoreboard blob per finished game, plus index
-- columns for listing. Participation is resolved via the existing seats table
-- (human seat = status != 'bot'); no separate participant table.
CREATE TABLE match_history (
    game_id        TEXT    PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    ruleset        TEXT    NOT NULL,
    ranked         INTEGER NOT NULL DEFAULT 0,
    winner_user_id INTEGER REFERENCES users(id),
    finished_at    INTEGER NOT NULL,
    record         TEXT    NOT NULL,
    created_at     INTEGER NOT NULL
);
CREATE INDEX match_history_finished ON match_history(finished_at DESC);
CREATE INDEX IF NOT EXISTS seats_user ON seats(user_id);
