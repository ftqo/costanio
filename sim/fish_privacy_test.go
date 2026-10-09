package sim

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/game"
)

// Fishermen privacy, measured by an attacker reading the spectator stream.
//
// game/fish_redaction_test.go checks that no other seat's tiles travel in a
// viewer's stream, but the mix can still be reconstructed from public data:
//
//   - How many tiles a seat drew on a roll follows from the public board
//     (grounds, lake numbers, buildings; a city draws two). That can't be
//     hidden.
//   - So publishing the fish value gained on the same roll gives away the mix:
//     two tiles worth five are a 2 and a 3.
//
// A seat's public fish number is therefore the tile count, as a hand's public
// number is the card count, and the value is private.
//
// This test fails on the version that published values:
//
//	                              before        after
//	draws pinned to exact tiles   138/144       0/144
//	seats holding fish, named     17/17         0/17
//	those left every mix the
//	  public tile count allows    0/17          16/17
//
// The seats still named after the change are ones holding nothing, where
// {0,0,0} follows from the public tile count. See fishPrivacyScore.

// fishMix is a holding: how many 1-, 2- and 3-fish tiles.
type fishMix = [3]int

func fishMixValue(m fishMix) int { return m[0] + 2*m[1] + 3*m[2] }
func fishMixTiles(m fishMix) int { return m[0] + m[1] + m[2] }

// attackerSpendTiles is the attacker's copy of engine/scenarios' spendTiles. The rule
// is published (docs/rules/scenarios.md, and lib/fish.ts ports it for the spend
// preview): minimum waste, then fewest tiles.
func attackerSpendTiles(held fishMix, cost int) (fishMix, bool) {
	best, bestWaste, bestCount, found := fishMix{}, 1<<30, 1<<30, false
	for c := 0; c <= held[2]; c++ {
		for b := 0; b <= held[1]; b++ {
			for a := 0; a <= held[0]; a++ {
				sum := a + 2*b + 3*c
				if sum < cost {
					continue
				}
				waste, count := sum-cost, a+b+c
				if waste < bestWaste || (waste == bestWaste && count < bestCount) {
					bestWaste, bestCount, found = waste, count, true
					best = fishMix{a, b, c}
				}
			}
		}
	}
	return best, found
}

// attackerFishCosts mirrors engine/scenarios' fishCosts: the ladder is printed in the
// rules and in the UI.
var attackerFishCosts = map[string]int{
	scenarios.FishRemoveRobber: 2,
	scenarios.FishSteal:        3,
	scenarios.FishTakeResource: 4,
	scenarios.FishFreeRoad:     5,
	scenarios.FishDevCard:      7,
}

// attackerFishSupply is the composition of the tile set (docs/scenarios.md).
var attackerFishSupply = fishMix{11, 10, 8}

// attackerDraws recomputes, from public state alone, how many tiles each seat
// drew on a roll, using the engine's rule (fishCatch): every building on a
// matching ground's vertices draws, a city two, and the lake pays on all four of
// its numbers.
func attackerDraws(s *engine.State, roll int) []int {
	out := make([]int, len(s.Players))
	add := func(v board.Vertex) {
		if b, ok := s.Buildings[v]; ok {
			if b.City {
				out[b.Owner] += 2
			} else {
				out[b.Owner]++
			}
		}
	}
	x, ok := scenarios.FishStateExt(s)
	if !ok {
		return out
	}
	lake := false
	for _, n := range scenarios.LakeNumbers {
		if n == roll {
			lake = true
		}
	}
	if lake {
		for h, t := range s.Board.Tiles {
			if t.Res != board.Lake {
				continue
			}
			for _, v := range h.Vertices() {
				add(v)
			}
		}
	}
	for _, g := range x.Grounds {
		if g.Number != roll {
			continue
		}
		for _, v := range g.V {
			add(v)
		}
	}
	return out
}

// deltasOfSize enumerates every multiset of n tiles, optionally constrained to a
// known fish value (value < 0 means "unconstrained").
func deltasOfSize(n, value int) []fishMix {
	var out []fishMix
	for c := 0; c <= n; c++ {
		for b := 0; b <= n-c; b++ {
			a := n - c - b
			m := fishMix{a, b, c}
			if value >= 0 && fishMixValue(m) != value {
				continue
			}
			out = append(out, m)
		}
	}
	return out
}

// fishAttacker tracks, for each seat, every holding consistent with everything
// public so far. A nil set means "more holdings than this harness will
// enumerate", which is scored as knowing nothing.
type fishAttacker struct {
	cand []map[fishMix]bool
}

func newFishAttacker(seats int) *fishAttacker {
	a := &fishAttacker{cand: make([]map[fishMix]bool, seats)}
	for p := range a.cand {
		a.cand[p] = map[fishMix]bool{{}: true}
	}
	return a
}

// candCap bounds the enumeration; real games stay in the low hundreds.
//
// Crossing it drops the seat rather than keeping a partial enumeration, which
// might not contain the truth and could fake an exact reconstruction. Dropping
// only makes the attacker weaker.
const candCap = 200000

// catch folds a public catch: seat p drew draws[p] tiles, worth value[p] if the
// stream still says so (value[p] < 0 when it does not).
func (a *fishAttacker) catch(draws, values []int) {
	for p := range a.cand {
		if a.cand[p] == nil || p >= len(draws) || draws[p] == 0 {
			continue
		}
		v := -1
		if p < len(values) {
			v = values[p]
		}
		deltas := deltasOfSize(draws[p], v)
		next := make(map[fishMix]bool, len(a.cand[p])*len(deltas))
		for m := range a.cand[p] {
			for _, d := range deltas {
				next[fishMix{m[0] + d[0], m[1] + d[1], m[2] + d[2]}] = true
			}
		}
		if len(next) > candCap {
			next = nil
		}
		a.cand[p] = next
	}
}

// spend folds a public spend. cost is the ladder price; value and tiles are what
// the public payload says about the payment (-1 for "not published").
func (a *fishAttacker) spend(p int, cost, value, tiles int) {
	if p < 0 || p >= len(a.cand) || a.cand[p] == nil {
		return
	}
	next := make(map[fishMix]bool, len(a.cand[p]))
	for m := range a.cand[p] {
		pay, ok := attackerSpendTiles(m, cost)
		if !ok {
			continue // this holding could not have afforded the spend
		}
		if value >= 0 && fishMixValue(pay) != value {
			continue
		}
		if tiles >= 0 && fishMixTiles(pay) != tiles {
			continue
		}
		next[fishMix{m[0] - pay[0], m[1] - pay[1], m[2] - pay[2]}] = true
	}
	if len(next) > 0 {
		a.cand[p] = next
	}
}

// bound applies the aggregate constraint: with the supply snapshot public, the
// table's whole holding is known, and no seat can hold more of a value than the
// table does.
func (a *fishAttacker) bound(supply, used fishMix) {
	var table fishMix
	for v := range 3 {
		table[v] = attackerFishSupply[v] - supply[v] - used[v]
		if table[v] < 0 {
			return
		}
	}
	for p := range a.cand {
		if a.cand[p] == nil {
			continue
		}
		next := make(map[fishMix]bool, len(a.cand[p]))
		for m := range a.cand[p] {
			if m[0] <= table[0] && m[1] <= table[1] && m[2] <= table[2] {
				next[m] = true
			}
		}
		if len(next) > 0 {
			a.cand[p] = next
		}
	}
}

// fishPrivacyScore is what one game's spectator stream gave away.
//
// The score that matters is `holdingExact`, not `seatsExact`: an empty seat has
// one possible mix, {0,0,0}, which the public tile count already reveals. The
// baseline is `floor`: with n tiles public there are (n+1)(n+2)/2 possible
// mixes, and an attacker left with all of them learned nothing beyond the count.
type fishPrivacyScore struct {
	seats, seatsExact int // final mixes named exactly (empty seats included)
	// Seats that ended holding at least one tile, how many of those the stream
	// named exactly, and how many were left with every mix their public tile
	// count allows.
	holding, holdingExact, holdingFree int
	draws, drawsExact                  int     // individual draws whose tiles are pinned
	drawsCount                         int     // draws whose size the attacker predicted right
	chance                             float64 // summed 1/|candidates|: what a guesser would score
	candidates                         int     // summed candidate-set sizes at the end
}

func (s *fishPrivacyScore) add(o fishPrivacyScore) {
	s.seats += o.seats
	s.seatsExact += o.seatsExact
	s.holding += o.holding
	s.holdingExact += o.holdingExact
	s.holdingFree += o.holdingFree
	s.draws += o.draws
	s.drawsExact += o.drawsExact
	s.drawsCount += o.drawsCount
	s.chance += o.chance
	s.candidates += o.candidates
}

// attackFishGame runs the attacker over one game's spectator stream and scores
// it against the truth log.
func attackFishGame(t *testing.T, events []engine.Event) fishPrivacyScore {
	t.Helper()

	// The truth: what each seat actually drew, and what each ended holding.
	type gain struct {
		seq  int
		seat int
		mix  fishMix
	}
	var gains []gain
	for _, e := range events {
		if e.Type != scenarios.EvFishGained {
			continue
		}
		var d struct {
			Player int     `json:"player"`
			Gain   fishMix `json:"gain"`
		}
		if err := json.Unmarshal(e.Data, &d); err != nil {
			t.Fatal(err)
		}
		gains = append(gains, gain{seq: e.Seq, seat: d.Player, mix: d.Gain})
	}
	truth, err := engine.Replay(events)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	tx, ok := scenarios.FishStateExt(truth)
	if !ok {
		t.Fatal("fishermen not active")
	}
	seats := len(truth.Players)

	// The attacker folds the spectator stream: exactly what a non-participant
	// is served.
	pub := make([]engine.Event, len(events))
	for i, e := range events {
		pub[i] = game.RedactEvent(e, game.Spectator)
	}
	s, err := engine.Replay(pub[:1])
	if err != nil {
		t.Fatalf("replay head: %v", err)
	}
	att := newFishAttacker(seats)
	score := fishPrivacyScore{seats: seats}
	roll := 0
	for _, e := range pub[1:] {
		switch e.Type {
		case engine.EvDiceRolled:
			var d engine.DiceRolledData
			if err := json.Unmarshal(e.Data, &d); err == nil {
				roll = d.D1 + d.D2
			}
		case scenarios.EvFishCaught:
			var d struct {
				Values []int    `json:"values"`
				Draws  []int    `json:"draws"`
				Supply *fishMix `json:"supply"`
				Used   *fishMix `json:"used"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatal(err)
			}
			// The count comes from the public board, not the payload. Where the
			// stream also publishes it, the two are cross-checked below.
			draws := attackerDraws(s, roll)
			for p, n := range draws {
				if n == 0 {
					continue
				}
				score.draws++
				// Truth for this draw: the EvFishGained that follows this catch.
				var want fishMix
				for _, g := range gains {
					if g.seat == p && g.seq > e.Seq && g.seq <= e.Seq+seats+1 {
						want = g.mix
						break
					}
				}
				if fishMixTiles(want) == n {
					score.drawsCount++
				}
				vals := d.Values
				if len(d.Draws) > 0 {
					vals = nil // the stream publishes counts, not values
				}
				v := -1
				if p < len(vals) {
					v = vals[p]
				}
				if opts := deltasOfSize(n, v); len(opts) == 1 && opts[0] == want {
					score.drawsExact++
				}
			}
			att.catch(draws, d.Values)
			if d.Supply != nil && d.Used != nil {
				att.bound(*d.Supply, *d.Used)
			}
		case scenarios.EvFishSpent:
			var d struct {
				Player int    `json:"player"`
				Use    string `json:"use"`
				Value  *int   `json:"value"`
				Tiles  *int   `json:"tiles"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatal(err)
			}
			value, tiles := -1, -1
			if d.Value != nil {
				value = *d.Value
			}
			if d.Tiles != nil {
				tiles = *d.Tiles
			}
			att.spend(d.Player, attackerFishCosts[d.Use], value, tiles)
		default:
			// a scan for the fish surface, not a dispatch over the log
		}
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
	}

	for p := range seats {
		set := att.cand[p]
		n := fishMixTiles(tx.Held[p])
		// A dropped seat (candCap) counts as knowing nothing: scored as the whole
		// space its public tile count allows.
		size := len(set)
		if set == nil {
			size = (n + 1) * (n + 2) / 2
		}
		score.candidates += size
		if size > 0 {
			score.chance += 1 / float64(size)
		}
		// len(nil) is 0, so a dropped seat never counts as exact.
		exact := len(set) == 1 && set[tx.Held[p]]
		if exact {
			score.seatsExact++
		}
		if n == 0 {
			continue // nothing held, nothing hidden: the public count says so
		}
		score.holding++
		if exact {
			score.holdingExact++
		}
		if size >= (n+1)*(n+2)/2 {
			score.holdingFree++ // every mix the public tile count allows
		}
	}
	return score
}

// TestFishMixIsNotPubliclyReconstructible runs the measurement described at the
// top of this file.
func TestFishMixIsNotPubliclyReconstructible(t *testing.T) {
	st := openStore(t)
	var total fishPrivacyScore
	games := 0
	for seed := uint64(1); seed <= 11; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base+fishermen", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		total.add(attackFishGame(t, events))
		games++
	}
	t.Logf("%d games: draw size predicted %d/%d; draw tiles pinned %d/%d (%.1f%%); "+
		"final mixes named exactly %d/%d (%d/%d of the seats still holding tiles, "+
		"%d/%d of those left every mix their public count allows); "+
		"guesser's expected score %.2f of %d seats; mean candidate holdings %.1f",
		games, total.drawsCount, total.draws, total.drawsExact, total.draws,
		100*float64(total.drawsExact)/float64(total.draws),
		total.seatsExact, total.seats, total.holdingExact, total.holding,
		total.holdingFree, total.holding, total.chance, total.seats,
		float64(total.candidates)/float64(total.seats))

	// The thresholds sit far below a full leak (every draw pinned, every
	// final mix named).
	if total.drawsExact > 0 {
		t.Errorf("%d of %d draws pinned to an exact tile mix by public state", total.drawsExact, total.draws)
	}
	if total.holding == 0 {
		t.Fatal("no seat ended holding fish")
	}
	if got := float64(total.holdingExact) / float64(total.holding); got > 0.25 {
		t.Errorf("%.0f%% of seats holding fish had their exact mix named from the public stream (%d/%d)", 100*got, total.holdingExact, total.holding)
	}
}
