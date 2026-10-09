package raiders

import (
	"math/rand/v2"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// landingCandidates is the eligibility rule for one rolled number: the
// landing-eligible hexes carrying that number, minus conquered ones, keeping
// those with the fewest raiders.
//
// Ruling: fill evenly, roller chooses. The scenario assumes every coastal hex
// has a different number, which our generator cannot honour (ten usable
// numbers, outer rings of 12, 18 or 24 hexes), so duplicates are normal. The
// raider goes to a hex holding the fewest, and among ties the roller picks, as
// the island-board combinations do.
//
// Returns indexes into Coast, ascending. Empty means the number names nothing:
// nothing is placed and it is not re-rolled.
func (e *Ext) landingCandidates(b *board.Board, n int) []int {
	best := -1
	var out []int
	for i, h := range e.Coast {
		if b.Tiles[h].Number != n || e.RaiderCount[i] >= conquered {
			continue
		}
		c := e.RaiderCount[i]
		switch {
		case best < 0 || c < best:
			best, out = c, []int{i}
		case c == best:
			out = append(out, i)
		}
	}
	return out
}

// occupiedCoast is every landing-eligible hex holding at least one raider,
// ascending (Q, R). Intrigue picks from it, and the battle sweep walks it.
func (e *Ext) occupiedCoast() []board.Hex {
	var out []board.Hex
	for _, h := range e.populationHexes() {
		if e.RaidersOn(h) > 0 {
			out = append(out, h)
		}
	}
	return out
}

// unconqueredCoast is every landing-eligible hex short of saturation, which is
// where Treason may put a raider down.
func (e *Ext) unconqueredCoast() []board.Hex {
	var out []board.Hex
	for _, h := range e.populationHexes() {
		if h != e.Castle && e.RaidersOn(h) < conquered {
			out = append(out, h)
		}
	}
	return out
}

// RaidersOnBoard totals the raiders standing on the coast. Exported for the
// bots, which have to know whether there is a fight to raise an army for.
func (e *Ext) RaidersOnBoard() int {
	n := 0
	for _, h := range e.populationHexes() {
		n += e.RaidersOn(h)
	}
	return n
}

// rollLandingNumbers rolls until it has three distinct results that are not 7.
//
// Decision: three distinct numbers, not "roll until three raiders have landed",
// which would not terminate once fewer than three unsaturated coastal hexes
// remain (reachable on our boards).
//
// The loop is bounded because it runs inside a pure fold; the unreachable
// fallback fills the numbers deterministically so a replay reproduces them.
func rollLandingNumbers(rng *rand.Rand) []int {
	out := make([]int, 0, landingNumbers)
	for range 1000 {
		if len(out) == landingNumbers {
			return out
		}
		n := rng.IntN(6) + 1 + rng.IntN(6) + 1
		if n == 7 || slices.Contains(out, n) {
			continue
		}
		out = append(out, n)
	}
	for n := 2; n <= 12 && len(out) < landingNumbers; n++ {
		if n != 7 && !slices.Contains(out, n) {
			out = append(out, n)
		}
	}
	return out
}

// landingFor produces the whole landing a batch of builds triggers: the roll,
// then as much placement as resolves without a decision.
//
// offset is the index of the first returned event in the batch and seeds the
// roll, so no two landings share a stream (see engine.RaidersSeq).
//
// If the supply was already empty when the build happened, no dice are rolled:
// landings stop for the rest of the game.
func (m Module) landingFor(s *engine.State, x *Ext, roller engine.PlayerID, builds, singles, offset int) []engine.Event {
	knights := hasKnights(s)
	if (builds <= 0 && singles <= 0) || len(x.Coast) == 0 || x.supplyEmpty(knights) {
		return nil
	}
	rng := engine.PublicRngForSeed(s.PublicSeed, engine.RaidersSeq(s.NextSeq+offset))
	var nums []int
	for range builds {
		nums = append(nums, rollLandingNumbers(rng)...)
	}
	// The Knights combination's extra triggers, each one raider rather than a
	// full attack: the event die's ship face and each city improvement built.
	// Both use the two production dice; the ship face uses the turn's own roll
	// (see onEvents), an improvement rolls here.
	//
	// Decision: a 7 places none for either trigger. The rule says so for the
	// ship face and is silent for the improvement, and any other reading would
	// need a re-roll rule.
	for range singles {
		if n := rng.IntN(6) + 1 + rng.IntN(6) + 1; n != 7 {
			nums = append(nums, n)
		}
	}
	if len(nums) == 0 {
		return nil
	}
	out := []engine.Event{engine.NewEvent(EvLanding, landingData{Player: roller, Numbers: nums})}
	return append(out, m.resolveLanding(s, x, nums)...)
}

// singleLandingFor is the ship face's landing: one raider on the hex the turn's
// own production dice named, not a fresh roll. Returns no events for a 7.
func (m Module) singleLandingFor(s *engine.State, x *Ext, roller engine.PlayerID, roll, offset int) []engine.Event {
	if roll == 7 || len(x.Coast) == 0 || x.supplyEmpty(hasKnights(s)) {
		return nil
	}
	out := []engine.Event{engine.NewEvent(EvLanding, landingData{Player: roller, Numbers: []int{roll}})}
	return append(out, m.resolveLanding(s, x, []int{roll})...)
}

// resolveLanding places what it can without asking anybody and stops at the
// first genuine tie.
//
// Decision: the choice is offered only when it is real; a single surviving
// candidate is placed automatically, and only a tie interrupts the roller.
//
// It walks local copies of the counts and supply, because the returned events
// are not folded yet and each changes what the next may do.
func (m Module) resolveLanding(s *engine.State, x *Ext, nums []int) []engine.Event {
	knights := hasKnights(s)
	counts := slices.Clone(x.RaiderCount)
	supply := x.Supply
	work := &Ext{Coast: x.Coast, RaiderCount: counts}
	var out []engine.Event
	for len(nums) > 0 {
		if !knights && supply <= 0 {
			// The supply emptied mid-landing: stop early. One event with nothing
			// placed and nothing left to resolve closes the whole landing.
			out = append(out, engine.NewEvent(EvLanded, landedData{}))
			break
		}
		cands := work.landingCandidates(s.Board, nums[0])
		if len(cands) > 1 {
			break // a genuine tie: the roller picks, and play pauses here
		}
		rest := slices.Clone(nums[1:])
		var hp *board.Hex
		if len(cands) == 1 {
			h := x.Coast[cands[0]]
			hp = &h
			counts[cands[0]]++
			supply--
		}
		out = append(out, engine.NewEvent(EvLanded, landedData{Hex: hp, Rest: rest}))
		nums = rest
	}
	return out
}

// decidePickHex answers the two pendings that name a hex: a landing tie, and
// Intrigue.
func (m Module) decidePickHex(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.Pend.Seat != cmd.Player {
		return nil, engine.ErrNotYourTurn
	}
	d, err := engine.DecodeCommand[struct {
		Hex board.Hex `json:"hex"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !slices.Contains(x.Pend.Hexes, d.Hex) {
		return nil, engine.ErrBadPlacement
	}
	switch x.Pend.Kind {
	case PendLanding:
		if len(s.PendingDiscards) > 0 {
			return nil, engine.ErrDiscardPending
		}
		if len(x.Pend.Numbers) == 0 {
			// Unreachable through the fold (EvLanded clears the pending when
			// the queue empties), but cheap to guard.
			return nil, engine.ErrWrongPhase
		}
		h := d.Hex
		rest := slices.Clone(x.Pend.Numbers[1:])
		out := []engine.Event{engine.NewEvent(EvLanded, landedData{Hex: &h, Rest: rest})}
		if len(rest) > 0 {
			// Carry the rest of the landing as far as it goes on its own, as
			// the opening run did; a second tie stops it again. Comma-ok so a
			// failed assertion is a rules error rather than an engine panic
			// (see "loud and frozen" in docs/architecture.md).
			after, _ := x.CloneExt().(*Ext)
			if i := after.coastIndex(h); after != nil && i >= 0 {
				after.RaiderCount[i]++
				after.takeFromSupply(hasKnights(s))
			}
			out = append(out, m.resolveLanding(s, after, rest)...)
		}
		return out, nil
	case PendIntrigue:
		return []engine.Event{engine.NewEvent(EvIntrigue,
			intrigueData{Player: cmd.Player, Hex: d.Hex})}, nil
	default:
		return nil, engine.ErrWrongPhase
	}
}
