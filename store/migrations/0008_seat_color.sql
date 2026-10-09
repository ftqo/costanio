-- Per-seat color pick. Empty string = no pick yet; the seat renders the
-- seat-order default (cosmetics.DefaultSeatColor). A non-empty value is a
-- cosmetics palette color id ("color.ff0000"). Purely presentational: the
-- engine never reads it (see docs/cosmetics.md §6.3).
ALTER TABLE seats ADD COLUMN color TEXT NOT NULL DEFAULT '';
