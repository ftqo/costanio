package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestDiplomatOpenRoadTwoClauses pins the card's definition: "A road is 'open'
// if one of its ends is not next to one of your roads or buildings and if it is
// not part of a continuous route connecting two of your buildings and/or
// knights." Knights count only in the second clause: a road attached at one end
// only by the owner's knight passes the first clause and is closed only if the
// far side reaches another of the owner's buildings or knights along the
// owner's roads without passing an opponent's piece.
//
// Every case is built on one hex's six corners, v0..v5 clockwise, on an
// otherwise empty board; the road under test is always v0-v1.
func TestDiplomatOpenRoadTwoClauses(t *testing.T) {
	type piece struct {
		at    int
		owner int // 0 = the road's owner, 1 = an opponent
	}
	cases := []struct {
		name      string
		roads     []int // ring edges owned by the owner: edge i joins v_i and v_(i+1)
		buildings []piece
		knights   []piece
		open      bool
	}{
		{name: "dangling end with nothing there", roads: []int{0}, buildings: []piece{{1, 0}}, open: true},
		{name: "own roads at both ends", roads: []int{5, 0, 1}, buildings: []piece{{5, 0}, {2, 0}}, open: false},
		{name: "a road circle rooted at one settlement", roads: []int{0, 1, 2, 3, 4, 5}, buildings: []piece{{0, 0}}, open: false},
		{name: "knight at one end, settlement at the other", roads: []int{0}, buildings: []piece{{1, 0}}, knights: []piece{{0, 0}}, open: false},
		{name: "knight at one end, route beyond reaches a settlement", roads: []int{0, 1}, buildings: []piece{{2, 0}}, knights: []piece{{0, 0}}, open: false},
		{name: "knight at one end, route beyond reaches another knight", roads: []int{0, 1}, knights: []piece{{0, 0}, {2, 0}}, open: false},
		{name: "knight at both ends", roads: []int{0}, knights: []piece{{0, 0}, {1, 0}}, open: false},
		{name: "knight at one end, route beyond reaches nothing", roads: []int{0, 1}, knights: []piece{{0, 0}}, open: true},
		{name: "knight at one end, route beyond cut by an opponent settlement", roads: []int{0, 1, 2}, buildings: []piece{{2, 1}, {3, 0}}, knights: []piece{{0, 0}}, open: true},
		{name: "knight at one end, route beyond cut by an opponent knight", roads: []int{0, 1, 2}, buildings: []piece{{3, 0}}, knights: []piece{{0, 0}, {2, 1}}, open: true},
		{name: "an opponent's knight at the dangling end does not close it", roads: []int{0}, buildings: []piece{{1, 0}}, knights: []piece{{0, 1}}, open: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newGame(t, 5, nil)
			x := ext(s)
			const owner, rival = engine.PlayerID(0), engine.PlayerID(1)
			seat := func(o int) engine.PlayerID {
				if o == 0 {
					return owner
				}
				return rival
			}
			s.Roads = map[board.Edge]engine.PlayerID{}
			s.Buildings = map[board.Vertex]engine.Building{}
			x.Knights = map[board.Vertex]Knight{}
			ring := board.Hex{}.Vertices()
			edge := func(i int) board.Edge { return board.NewEdge(ring[i], ring[(i+1)%6]) }
			for _, i := range tc.roads {
				s.Roads[edge(i)] = owner
			}
			for _, b := range tc.buildings {
				s.Buildings[ring[b.at]] = engine.Building{Owner: seat(b.owner)}
			}
			for _, k := range tc.knights {
				x.Knights[ring[k.at]] = Knight{Owner: seat(k.owner), Level: 1}
			}
			if got := openRoad(s, edge(0), owner); got != tc.open {
				t.Fatalf("openRoad = %v, want %v", got, tc.open)
			}
		})
	}
}
