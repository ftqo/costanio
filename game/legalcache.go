package game

import "github.com/ftqo/costan.io/engine"

// legalCache memoizes engine.LegalTargetsFor for one state version
// (s.NextSeq). Legal targets are a pure function of state, so they are
// computed once per version and reused for every viewer and check. Owned by
// the Actor loop, so no locking.
type legalCache struct {
	version int
	byseat  map[engine.PlayerID]engine.LegalTargets
}

// For returns seat's legal targets at the given state version, computing and
// caching on a miss. A version change (a new event applied) clears the cache.
func (c *legalCache) For(s *engine.State, version int, seat engine.PlayerID) engine.LegalTargets {
	if c.byseat == nil || c.version != version {
		c.version = version
		c.byseat = map[engine.PlayerID]engine.LegalTargets{}
	}
	if lt, ok := c.byseat[seat]; ok {
		return lt
	}
	lt := s.LegalTargetsFor(seat)
	c.byseat[seat] = lt
	return lt
}
