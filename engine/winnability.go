package engine

// tiebreakKey is the ordered tuple used to rank players when the game is
// force-ended. Higher values are better at every index; on a complete tie the
// caller keeps the lowest seat index (earliest best during iteration).
type tiebreakKey [5]int

// beats reports whether k strictly beats other in lexicographic order (index
// 0 is most significant). Equal keys return false, so the earliest seat keeps
// the lead.
func (k tiebreakKey) beats(other tiebreakKey) bool {
	for i := range k {
		if k[i] != other[i] {
			return k[i] > other[i]
		}
	}
	return false // equal → do not displace the current best (lower seat wins)
}

// keyFor returns the tiebreak key for player p. All five criteria are
// "higher-is-better"; the seat index itself is the implicit final fallback
// (kept outside the key so iteration naturally preserves the lowest seat).
func keyFor(s *State, p PlayerID) tiebreakKey {
	ps := &s.Players[p]
	return tiebreakKey{
		s.VPWithModules(p),
		MaxCities - ps.CitiesLeft,
		MaxSettlements - ps.SettlementsLeft,
		ps.KnightsPlayed,
		LongestRoadLength(s, p),
	}
}

// leaderByTiebreak returns the winner when a game is force-ended: most VP, then
// most cities, settlements, knights played, longest-road length, and finally the
// lowest seat index (always unique). Deterministic, so replay reproduces it.
func leaderByTiebreak(s *State) PlayerID {
	best := PlayerID(0)
	bestKey := keyFor(s, best)
	for p := PlayerID(1); int(p) < len(s.Players); p++ {
		k := keyFor(s, p)
		if k.beats(bestKey) {
			best, bestKey = p, k
		}
	}
	return best
}

// ForceFinish ends an in-progress game immediately, declaring the tiebreak
// leader the winner. It returns the single EvGameFinished event (Seq-stamped
// for the append log) so the caller (game layer) can persist then broadcast it.
// Returns nil, nil if the game is already finished so the caller can call it
// unconditionally. The resulting event is logged, so replay stays deterministic
// without the engine knowing the event-count cap that triggered this call.
func ForceFinish(s *State) ([]Event, error) {
	if s.Phase == PhaseFinished {
		return nil, nil
	}
	w := leaderByTiebreak(s)
	e := mustEvent(EvGameFinished, GameFinishedData{Winner: w, VP: s.VPWithModules(w)})
	e.Seq = s.NextSeq
	return []Event{e}, nil
}

// VPCeiler lets a module report the maximum victory points a single player can
// reach from its non-VP-card sources under the given config. The lobby adds these
// to the base ceiling so a player who never draws a VP development card (the only
// permanently deniable VP source) can still reach the win target.
type VPCeiler interface {
	MaxVPWithoutCards(cfg GameConfig) int
}

// baseMaxVPWithoutCards is the most VP a single player can reach in the base game
// without any VP development card: every building piece plus both transferable
// titles. Piece supply is fixed and does not scale with player count. Each city
// replaces a settlement, so buildings give 8 + 1 = 9, plus 4 for the titles.
const baseMaxVPWithoutCards = MaxCities*2 + (MaxSettlements-MaxCities)*1 + 2 /*longest road*/ + 2 /*largest army*/ // 13

// MaxVPWithoutCards returns the highest winnable target for a ruleset: the base
// ceiling plus each active module's board-independent, non-VP-card contribution.
// Used by the lobby to clamp TargetVP so no player can be permanently locked out.
func MaxVPWithoutCards(cfg GameConfig) int {
	total := baseMaxVPWithoutCards
	mods, err := modulesFor(cfg.Ruleset)
	if err != nil {
		return total // unknown ruleset: lobby rejects it separately
	}
	for _, m := range mods {
		if c, ok := m.(VPCeiler); ok {
			total += c.MaxVPWithoutCards(cfg)
		}
	}
	return total
}
