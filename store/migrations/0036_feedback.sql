-- feedback holds what players send from the profile menu's feedback form.
-- The row is the record; the post to the feedback channel in Discord is a
-- best-effort notification on top of it, so feedback sent while no channel is
-- configured (or Discord is down) is kept rather than lost.
--
-- page is the in-app path the player was on, so a report about "this screen"
-- can be read. It never carries a query string or fragment.
CREATE TABLE feedback (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    msg                TEXT NOT NULL,
    page               TEXT NOT NULL DEFAULT '',
    discord_message_id TEXT NOT NULL DEFAULT '',
    created_at         INTEGER NOT NULL
);
CREATE INDEX feedback_created ON feedback(created_at);
