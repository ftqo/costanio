-- User-created custom maps (a reusable library). A game embeds the full board
-- JSON into its config at creation, so these rows are for browsing/reuse only:
-- deleting one never affects an in-flight or replayed game.
CREATE TABLE maps (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    board      TEXT NOT NULL, -- board JSON (radius/tiles/robber/harbors)
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL
);
CREATE INDEX maps_creator ON maps(created_by);
