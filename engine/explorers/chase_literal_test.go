package explorers

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestPirateBonusChaseNumbers: a crew on a Pirate Bonus hex chases
// the pirate away on a 6 or that hex's number, and crews on both such hexes
// chase it on 4, 5 or 6. The number is a face, not a threshold, so the south
// village (4) alone chases on 4 or 6 but not 5.
func TestPirateBonusChaseNumbers(t *testing.T) {
	s, x := playing(t, 2, 44)
	seat := s.Cur
	for _, tc := range []struct {
		north, south bool
		want         []int
	}{
		{false, false, []int{6}},
		{true, false, []int{5, 6}},
		{false, true, []int{4, 6}},
		{true, true, []int{4, 5, 6}},
	} {
		x.Seats[seat].Villages[VillagePirate][RegionNorth] = tc.north
		x.Seats[seat].Villages[VillagePirate][RegionSouth] = tc.south
		if got := chaseHits(x, seat); !slices.Equal(got, tc.want) {
			t.Errorf("north=%v south=%v: chase on %v, want %v", tc.north, tc.south, got, tc.want)
		}
		for roll := 1; roll <= 6; roll++ {
			if got, want := chaseWins(x, seat, roll), slices.Contains(tc.want, roll); got != want {
				t.Errorf("north=%v south=%v: a %d wins=%v, want %v", tc.north, tc.south, roll, got, want)
			}
		}
	}
}

// TestSouthVillageNoChaseOnFive drives the rule through the
// command, since the predicate is only the rule if decideChasePirate uses it.
// The die comes from the seeded stream, so the test walks sequence numbers to
// the first whose die is a 5, and fails if the walk runs out.
func TestSouthVillageNoChaseOnFive(t *testing.T) {
	s, x := playing(t, 3, 43)
	revealAll(x)
	seat := s.Cur
	owner := engine.PlayerID((int(seat) + 1) % len(s.Players))
	pirateHex := legalPirateHexes(s, x, owner)[0]
	x.Pirate, x.PirateOwner, x.HasPirate = pirateHex, owner, true
	x.Seats[seat].Villages[VillagePirate][RegionSouth] = true
	id := placeShip(x, seat, seaEdgeOf(t, s, x, pirateHex), Cargo{})
	enterMovement(t, s)

	found := false
	for range 500 {
		if engine.PublicRngForSeed(s.PublicSeed, engine.ExplorersDieSeq(s.NextSeq)).IntN(6)+1 == 5 {
			found = true
			break
		}
		s.NextSeq++
	}
	if !found {
		t.Fatal("no sequence number in 500 gave a 5 on the chase die")
	}
	evs := apply(t, s, engine.Command{Player: seat, Type: CmdChasePirate,
		Data: raw(map[string]any{"ships": []int{id}})})
	var d chaseData
	for _, ev := range evs {
		if ev.Type == EvPirateChased {
			d = engine.DecodeEvent[chaseData](ev)
		}
	}
	if len(d.Rolls) != 1 || d.Rolls[0] != 5 {
		t.Fatalf("fixture: rolled %v, want a single 5", d.Rolls)
	}
	if d.Won {
		t.Error("a 5 drove the pirate off with only the south (4) Pirate Bonus village")
	}
	if !slices.Equal(d.Hits, []int{4, 6}) {
		t.Errorf("the event says the chase hits on %v, want [4 6]", d.Hits)
	}
	if !ext(s).HasPirate {
		t.Error("the pirate left the board after a failed chase")
	}
}
