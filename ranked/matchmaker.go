package ranked

import "sort"

const (
	groupSize            = 4
	baseBand             = 150.0
	growthPerTick        = 40.0
	maxBand              = 900.0
	provisionalBandBonus = 200.0
)

type entry struct {
	userID      int64
	rating      float64
	provisional bool
	joinedTick  int64
}

// tolerance is the max acceptable rating spread for a candidate window: a base
// band that grows with how long the longest-waiting member has waited, plus a
// bonus if any member is provisional (their rating is uncertain anyway).
func tolerance(window []entry, nowTick int64) float64 {
	maxWait := int64(0)
	prov := false
	for _, e := range window {
		if w := nowTick - e.joinedTick; w > maxWait {
			maxWait = w
		}
		prov = prov || e.provisional
	}
	band := baseBand + growthPerTick*float64(maxWait)
	if band > maxBand {
		band = maxBand
	}
	if prov {
		band += provisionalBandBonus
	}
	return band
}

// formGroups greedily forms groups of 4 from the pool. It sorts by rating, then
// repeatedly takes the tightest acceptable window of 4 consecutive players
// (spread <= tolerance) and removes them. Returns formed groups (user IDs) and
// the entries left waiting.
func formGroups(pool []entry, nowTick int64) (formed [][]entry, leftover []entry) {
	remaining := make([]entry, len(pool))
	copy(remaining, pool)
	var groups [][]entry
	for {
		sort.SliceStable(remaining, func(a, b int) bool { return remaining[a].rating < remaining[b].rating })
		bestStart, bestSpread := -1, 0.0
		for i := 0; i+groupSize <= len(remaining); i++ {
			window := remaining[i : i+groupSize]
			spread := window[groupSize-1].rating - window[0].rating
			if spread <= tolerance(window, nowTick) {
				if bestStart == -1 || spread < bestSpread {
					bestStart, bestSpread = i, spread
				}
			}
		}
		if bestStart == -1 {
			break
		}
		window := remaining[bestStart : bestStart+groupSize]
		group := make([]entry, groupSize)
		copy(group, window)
		groups = append(groups, group)
		remaining = append(remaining[:bestStart], remaining[bestStart+groupSize:]...)
	}
	return groups, remaining
}
