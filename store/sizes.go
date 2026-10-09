package store

// Sizes is a cheap snapshot of how big the database has become, so growth is
// observable. A finished game costs about 66.7 KiB, mostly event log (~104
// bytes per event, ~920 events for base, ~3,225 for base+cak). Event logs are
// kept indefinitely for replays and the fairness audit, so nothing prunes them.
type Sizes struct {
	// Bytes is the main database file's size, page_count * page_size. It does
	// not include the WAL, which is transient and checkpointed away.
	Bytes int64
	// FreeBytes is the portion of Bytes sitting on the freelist: space already
	// reclaimed inside the file that only a VACUUM returns to the filesystem.
	// A large value right after a prune is the prune having worked.
	FreeBytes int64
	// Games and FinishedGames count rows in games. Every other table grows in
	// proportion to one of these.
	Games         int64
	FinishedGames int64
	// Snapshots counts snapshot rows and SnapshotBytes their total blob size.
	// One snapshot per live game is expected; a count far above the number of
	// unfinished games means PruneFinishedSnapshots has a backlog to work
	// through.
	Snapshots     int64
	SnapshotBytes int64
}

// Sizes reads the metric. Cheap enough for an endpoint or a timer: the file
// size is a pragma, and the counts walk games and snapshots (one row per game).
// It does not count events, which would be expensive.
func (s *Store) Sizes() (Sizes, error) {
	var z Sizes
	var pageCount, pageSize, freelist int64
	for _, p := range []struct {
		pragma string
		dst    *int64
	}{
		{`PRAGMA page_count`, &pageCount},
		{`PRAGMA page_size`, &pageSize},
		{`PRAGMA freelist_count`, &freelist},
	} {
		if err := s.rdb.QueryRow(p.pragma).Scan(p.dst); err != nil {
			return z, err
		}
	}
	z.Bytes = pageCount * pageSize
	z.FreeBytes = freelist * pageSize
	if err := s.rdb.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(status = 'finished'), 0) FROM games`).
		Scan(&z.Games, &z.FinishedGames); err != nil {
		return z, err
	}
	if err := s.rdb.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(LENGTH(state)), 0) FROM snapshots`).
		Scan(&z.Snapshots, &z.SnapshotBytes); err != nil {
		return z, err
	}
	return z, nil
}
