-- 0010 created forfeits(game_id, user_id) with no REFERENCES clauses, so deleting
-- a user or game (or merging a guest away) leaves orphaned forfeit rows. SQLite
-- can't ALTER a table to add foreign keys, so rebuild it with ON DELETE CASCADE
-- constraints: create the constrained table, copy the rows that still reference a
-- live game AND a live user (silently dropping any pre-existing orphans), then
-- swap. foreign_keys is enabled during migration, so the copy filters orphans to
-- avoid tripping the new constraints mid-rebuild.
CREATE TABLE forfeits_new (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts      INTEGER NOT NULL,
    PRIMARY KEY (game_id, user_id)
);
INSERT INTO forfeits_new (game_id, user_id, ts)
    SELECT f.game_id, f.user_id, f.ts FROM forfeits f
    WHERE EXISTS (SELECT 1 FROM games g WHERE g.id = f.game_id)
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = f.user_id);
DROP TABLE forfeits;
ALTER TABLE forfeits_new RENAME TO forfeits;
