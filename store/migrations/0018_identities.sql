CREATE TABLE identities (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    avatar      TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    linked_at   INTEGER NOT NULL,
    PRIMARY KEY (provider, provider_id),
    UNIQUE (user_id, provider)
);
CREATE INDEX identities_user ON identities(user_id);

-- Backfill existing Discord users. discord_id stays on users as a mirror.
INSERT OR IGNORE INTO identities (user_id, provider, provider_id, name, avatar, email, linked_at)
SELECT id, 'discord', discord_id, name, avatar, '', created_at
FROM users
WHERE discord_id IS NOT NULL AND discord_id != '';
