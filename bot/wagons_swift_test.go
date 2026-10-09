package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/wagons"
)

// TestBotsPlaySwiftJourneyForDelivery pins the second trip: the lane plays
// Swift Journey by rule when the second trip arrives (the evaluator cannot value
// it).
//
// The state is constructed: a seat whose first trip is over, holding a Swift
// Journey, with a cargo one plaza accepts and the wagon parked a fixed number of
// movement points away. Each case checks that the delivery actually landed,
// not only that the card was played.
func TestBotsPlaySwiftJourneyForDelivery(t *testing.T) {
	bots := []struct {
		name string
		act  func() func(*engine.State, engine.PlayerID) (engine.Command, bool)
	}{
		{"simple", func() func(*engine.State, engine.PlayerID) (engine.Command, bool) { return NewSimple().Act }},
		{"strong", func() func(*engine.State, engine.PlayerID) (engine.Command, bool) { return NewStrong().Act }},
	}
	cases := []struct {
		name string
		// extra is how far beyond a fresh allowance the delivery sits.
		extra int
		// grain is whether the seat holds a grain for the boost.
		grain bool
		// boughtFirst is whether the first trip already bought the boost.
		boughtFirst bool
		want        bool
	}{
		{name: "in reach of a fresh allowance", extra: 0, want: true},
		// The second trip is its own movement action, so it may buy the grain
		// boost again even though the first trip spent one.
		{name: "in reach with the boost bought again", extra: wagons.BoostMP, grain: true, boughtFirst: true, want: true},
		{name: "beyond the boost", extra: wagons.BoostMP + 1, grain: true, want: false},
		{name: "beyond the allowance with no grain", extra: 1, want: false},
	}
	for _, bt := range bots {
		for _, tc := range cases {
			t.Run(bt.name+"/"+tc.name, func(t *testing.T) {
				s, p := swiftPosition(t, tc.extra, tc.want, tc.grain, tc.boughtFirst)
				act := bt.act()
				cmd, ok := act(s, p)
				played := ok && cmd.Type == wagons.CmdSwift
				if played != tc.want {
					t.Fatalf("Swift Journey played = %v (bot proposed %v %s), want %v", played, ok, cmd.Type, tc.want)
				}
				if !tc.want {
					return
				}
				before := wagons.Delivered(s, p)
				boosts := 0
				for range 50 {
					if !wagons.MovePhase(s, p) && cmd.Type != wagons.CmdSwift {
						break
					}
					if cmd.Type == wagons.CmdBoost {
						boosts++
					}
					applyCmd(t, s, cmd)
					if cmd, ok = act(s, p); !ok {
						break
					}
				}
				if got := wagons.Delivered(s, p); got != before+1 {
					t.Fatalf("the second trip delivered %d, want 1", got-before)
				}
				if tc.grain && boosts != 1 {
					t.Fatalf("bought the boost %d times on the second trip, want 1", boosts)
				}
			})
		}
	}
}

func applyCmd(t *testing.T, s *engine.State, cmd engine.Command) {
	t.Helper()
	out, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("%s refused: %v", cmd.Type, err)
	}
	for _, e := range out {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("applying %s: %v", e.Type, err)
		}
	}
}

// swiftPosition plays a four-seat Wagons game to the first quiet post-roll
// point of a turn once the wagons are out, then rewrites the seat on turn into
// the position the test needs. Returns the state and that seat.
func swiftPosition(t *testing.T, extra int, exact, grain, boughtFirst bool) (*engine.State, engine.PlayerID) {
	t.Helper()
	evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base+wagons"}, engine.SeedsFrom(3))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	var x *wagons.WagonsExt
	for step := 0; ; step++ {
		if step > 5000 {
			t.Fatal("no quiet movement phase in 5000 steps")
		}
		x, _ = wagons.StateExt(s)
		if x != nil && x.Started && s.Phase == engine.PhasePlay && s.Rolled && !s.RobberPending &&
			len(s.PendingDiscards) == 0 && x.BarbSeat == engine.NoPlayer && wagons.MovePhase(s, s.Cur) {
			break
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatalf("stuck at step %d", step)
		}
		applyCmd(t, s, cmd)
	}
	p := s.Cur

	// The delivery: the first cargo some plaza (but not every plaza) accepts.
	var dest []board.Vertex
	for c := wagons.CargoMarble; c <= wagons.CargoSand+1; c++ {
		x.Cargo[p] = c
		if d := wagons.Destination(s, p); len(d) > 0 && len(d) < len(wagons.Plazas(s)) {
			dest = d
			break
		}
	}
	if dest == nil {
		t.Fatal("no cargo that exactly one plaza set accepts")
	}
	// Nothing to spend, so the turn's builds and gold lanes stay out of it.
	s.Players[p].Hand = engine.Hand{}
	if grain {
		s.Players[p].Hand[board.Wheat] = 1
	}
	x.Gold[p] = 0

	// Park the wagon exactly allowance+extra from the nearest delivery.
	want := wagons.Allowance(s, p) + extra
	near := map[board.Vertex]int{}
	for _, d := range dest {
		for v, c := range wagons.Distances(s, p, d) {
			if o, ok := near[v]; !ok || c < o {
				near[v] = c
			}
		}
	}
	plaza := map[board.Vertex]bool{}
	for _, v := range wagons.Plazas(s) {
		plaza[v] = true
	}
	// Paths cost 1 or 2, so not every distance exists: take the nearest at or
	// beyond want, and require it exact where the case needs it exact. Ties go
	// to board order, so the pick is deterministic.
	best, bestC := board.Vertex{}, -1
	for v, c := range near {
		if c < want || plaza[v] {
			continue
		}
		if bestC < 0 || c < bestC || (c == bestC && vertexLess(v, best)) {
			best, bestC = v, c
		}
	}
	if bestC < 0 || (exact && bestC != want) {
		t.Fatalf("no intersection %d MP from a delivery (nearest beyond: %d)", want, bestC)
	}
	x.Wagon[p], x.OnBoard[p] = best, true

	// The first trip is over, and a Swift Journey is held and playable.
	x.MoveOpen, x.MoveDone, x.Moved, x.MP = false, true, true, 0
	x.Boosted = boughtFirst
	x.Swift[p] = 1
	s.PlayedDevThisTurn = false
	return s, p
}
