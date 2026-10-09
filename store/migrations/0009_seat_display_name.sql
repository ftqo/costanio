-- Per-seat display name override. Empty string = no override; the seat shows
-- the user's account name (or "Guest" when that is empty too). Lets a player
-- name themselves in the waiting room for a single game without changing their
-- account identity. Purely presentational.
ALTER TABLE seats ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
