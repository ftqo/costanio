-- Runtime-configurable mapping of Discord role IDs to supporter/perk kinds,
-- managed by the `/setrole` slash command. This augments the static env allowlist
-- (DISCORD_SUPPORTER_ROLE_IDS): the pull-sync unions both when evaluating a
-- member's roles. Many role IDs may map to the same kind.
CREATE TABLE perk_roles (
    role_id    TEXT    PRIMARY KEY,
    kind       TEXT    NOT NULL, -- 'subscription' | 'boost' | 'gift' | 'kofi' | 'staff'
    updated_at INTEGER NOT NULL
);
