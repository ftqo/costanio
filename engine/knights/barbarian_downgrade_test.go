package knights

import (
	"errors"
	"maps"
	"reflect"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// makeCities plants n cities for player p on vacant vertices and returns them
// in downgradableCities' board order, so "the first city" means what the
// engine means. It plants rather than upgrades because Knights setup leaves
// each player only two buildings.
func makeCities(t *testing.T, s *engine.State, p engine.PlayerID, n int) []board.Vertex {
	t.Helper()
	x := ext(s)
	spots := nFreeVertices(s, x, board.Vertex{}, n)
	if len(spots) < n {
		fixtureGone(t, "board has no room for %d more cities", n)
	}
	for _, v := range spots {
		s.Buildings[v] = engine.Building{Owner: p, City: true}
		s.Players[p].CitiesLeft--
	}
	return (Module{}).downgradableCities(s, x, p)
}

// loseDefense fires a barbarian landfall against a board with no active knights,
// so the defense fails and the weakest (i.e. every) city-holder pays. It returns
// the attack event batch.
func loseDefense(t *testing.T, s *engine.State) []engine.Event {
	t.Helper()
	atk, _ := (Module{}).attackEvents(s, ext(s))
	applyAll(t, s, atk)
	return atk
}

// pendingSnapshot captures the parts of the state an illegal pick must not
// touch. A whole-State comparison fails because reading the rules fills a lazy
// module cache.
func pendingSnapshot(s *engine.State) any {
	x := ext(s)
	return []any{
		maps.Clone(s.Buildings),
		append([]engine.PlayerID(nil), x.PendingDowngrade...),
		maps.Clone(x.Walled),
		append([]PlayerExt(nil), x.Players...),
		append([]engine.PlayerState(nil), s.Players...),
	}
}

// TestBarbarianDowngradeArming: what a lost defense asks of each losing player.
// Nothing with no sacrificable city, an immediate razing with exactly one, and
// a pending pick with more.
func TestBarbarianDowngradeArming(t *testing.T) {
	cases := []struct {
		name        string
		cities      int
		wantRazed   bool // resolved by the attack event itself
		wantPending bool // player owes a choice
	}{
		{"no city is immune", 0, false, false},
		{"one city is not a choice", 1, true, false},
		{"two cities is a choice", 2, false, true},
		{"three cities is a choice", 3, false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, _ := newGame(t, 7, nil)
			clearStartingCities(s)
			s.Cur = 0
			const p engine.PlayerID = 0
			// Someone must hold a city or the barbarians face nothing and win.
			makeCities(t, s, 2, 1)
			if c.cities > 0 {
				makeCities(t, s, p, c.cities)
			}

			atk, _ := (Module{}).attackEvents(s, ext(s))
			d := engine.DecodeEvent[barbarianAttackData](atk[0])
			if d.Win {
				t.Fatalf("expected a lost defense with no knights, got %+v", d)
			}
			razed := slices.ContainsFunc(d.Downgraded, func(dg downgrade) bool { return dg.Player == p })
			if razed != c.wantRazed {
				t.Errorf("immediately razed = %v, want %v (downgraded %+v)", razed, c.wantRazed, d.Downgraded)
			}
			if pending := slices.Contains(d.Pending, p); pending != c.wantPending {
				t.Errorf("pending = %v, want %v (pending %+v)", pending, c.wantPending, d.Pending)
			}

			applyAll(t, s, atk)
			x := ext(s)
			if got := slices.Contains(x.PendingDowngrade, p); got != c.wantPending {
				t.Errorf("Ext.PendingDowngrade contains p = %v, want %v", got, c.wantPending)
			}
			// A pending pick blocks the turn and is the seat's only legal action.
			if c.wantPending {
				if !(Module{}).blocks(s) {
					t.Error("a pending city sacrifice must block the turn")
				}
				lt := s.LegalTargetsFor(p)
				if len(lt.BarbarianDowngrades) != c.cities {
					t.Errorf("legal targets = %d cities, want %d", len(lt.BarbarianDowngrades), c.cities)
				}
				if len(lt.Settlements) > 0 || len(lt.Roads) > 0 {
					t.Error("nothing but the sacrifice is legal while it is owed")
				}
			}
		})
	}
}

// TestBarbarianDowngradeSoleCityRazedAtOnce: the single city falls inside the
// attack event and nothing is left pending.
func TestBarbarianDowngradeSoleCityRazedAtOnce(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	s.Cur = 0
	const p engine.PlayerID = 0
	cities := makeCities(t, s, p, 1)

	loseDefense(t, s)

	if b := s.Buildings[cities[0]]; b.City {
		t.Errorf("the sole sacrificable city at %v should have been razed", cities[0])
	}
	if x := ext(s); len(x.PendingDowngrade) != 0 {
		t.Errorf("nothing should be pending, got %v", x.PendingDowngrade)
	}
	if (Module{}).blocks(s) {
		t.Error("a resolved sacrifice must not block the turn")
	}
}

// TestBarbarianDowngradeChoice: with two cities the player picks, and the city
// they name (not the heuristic's) is the one that goes.
func TestBarbarianDowngradeChoice(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	s.Cur = 0
	const p engine.PlayerID = 0
	cities := makeCities(t, s, p, 2)
	loseDefense(t, s)

	// Choose the city the auto/timeout heuristic would not take.
	auto, ok := (Module{}).downgradableCity(s, ext(s), p)
	if !ok {
		t.Fatal("expected a heuristic default")
	}
	pick := cities[0]
	if pick == auto {
		pick = cities[1]
	}

	step(t, s, engine.Command{Player: p, Type: CmdBarbarianDowngrade,
		Data: mustJSON(t, map[string]any{"v": pick})})

	if b := s.Buildings[pick]; b.City {
		t.Errorf("the chosen city %v should have been razed", pick)
	}
	if b := s.Buildings[auto]; !b.City {
		t.Errorf("the unchosen city %v must survive", auto)
	}
	if x := ext(s); len(x.PendingDowngrade) != 0 {
		t.Errorf("the debt should be settled, got %v", x.PendingDowngrade)
	}
	if (Module{}).blocks(s) {
		t.Error("the turn must resume once the sacrifice is made")
	}
}

// TestBarbarianDowngradeTimeoutAutoPicks: on timeout the module's Auto command
// takes the first non-metropolis city in board order, preferring an unwalled
// one.
func TestBarbarianDowngradeTimeoutAutoPicks(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	s.Cur = 0
	const p engine.PlayerID = 0
	cities := makeCities(t, s, p, 3)
	x := ext(s)
	// Wall every city but the last: the heuristic must take the one unwalled city,
	// which is not first in board order.
	for _, v := range cities[:len(cities)-1] {
		x.Walled[v] = true
	}
	x.Players[p].Walls = len(cities) - 1
	loseDefense(t, s)

	cmd, ok := (Module{}).auto(s, engine.NoPlayer)
	if !ok || cmd.Type != CmdBarbarianDowngrade || cmd.Player != p {
		t.Fatalf("auto gave %+v, want a %s for player %d", cmd, CmdBarbarianDowngrade, p)
	}
	step(t, s, cmd)

	want := cities[len(cities)-1]
	if b := s.Buildings[want]; b.City {
		t.Errorf("auto should have razed the unwalled city %v", want)
	}
	for _, v := range cities[:len(cities)-1] {
		if b := s.Buildings[v]; !b.City {
			t.Errorf("auto razed the walled city %v; walls should be spared", v)
		}
	}
}

// TestBarbarianDowngradeIllegalPicks is the rejection table. Every case must
// leave the state untouched.
func TestBarbarianDowngradeIllegalPicks(t *testing.T) {
	type setup struct {
		name   string
		vertex func(t *testing.T, s *engine.State, own []board.Vertex) board.Vertex
		player func(own engine.PlayerID) engine.PlayerID
		want   error
	}
	cases := []setup{
		{
			name:   "another player's city",
			player: func(p engine.PlayerID) engine.PlayerID { return p },
			vertex: func(t *testing.T, s *engine.State, own []board.Vertex) board.Vertex {
				t.Helper()
				return makeCities(t, s, 1, 1)[0]
			},
			want: ErrNotSacrificable,
		},
		{
			name:   "a metropolis of their own",
			player: func(p engine.PlayerID) engine.PlayerID { return p },
			vertex: func(t *testing.T, s *engine.State, own []board.Vertex) board.Vertex {
				t.Helper()
				x := ext(s)
				x.Players[0].Metropolis[Trade] = true
				x.Players[0].MetropolisAt[Trade] = own[0]
				return own[0]
			},
			want: ErrNotSacrificable,
		},
		{
			name:   "a vertex holding no city",
			player: func(p engine.PlayerID) engine.PlayerID { return p },
			vertex: func(t *testing.T, s *engine.State, own []board.Vertex) board.Vertex {
				t.Helper()
				var empty board.Vertex
				forEachVertex(s, func(v board.Vertex) {
					if _, built := s.Buildings[v]; !built && (empty == board.Vertex{}) {
						empty = v
					}
				})
				return empty
			},
			want: ErrNotSacrificable,
		},
		{
			name:   "a seat that owes nothing",
			player: func(p engine.PlayerID) engine.PlayerID { return p + 1 },
			vertex: func(t *testing.T, s *engine.State, own []board.Vertex) board.Vertex {
				t.Helper()
				return own[0]
			},
			want: ErrNotOwed,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, _ := newGame(t, 7, nil)
			clearStartingCities(s)
			s.Cur = 0
			const p engine.PlayerID = 0
			own := makeCities(t, s, p, 2)
			loseDefense(t, s)

			// Arm the metropolis case before the snapshot so the comparison sees only what
			// the rejected command did.
			v := c.vertex(t, s, own)
			before := pendingSnapshot(s)

			_, err := engine.Decide(s, engine.Command{Player: c.player(p), Type: CmdBarbarianDowngrade,
				Data: mustJSON(t, map[string]any{"v": v})})
			if err == nil {
				t.Fatalf("pick of %v was accepted; want %v", v, c.want)
			}
			if !errors.Is(err, c.want) {
				t.Errorf("err = %v, want %v", err, c.want)
			}
			if !reflect.DeepEqual(pendingSnapshot(s), before) {
				t.Error("a rejected pick must leave the state untouched")
			}
			if x := ext(s); !slices.Contains(x.PendingDowngrade, p) {
				t.Error("the debt must still be owed after a rejected pick")
			}
		})
	}
}

// TestBarbarianDowngradeConcurrent: two players owing a sacrifice resolve
// independently and in any order.
func TestBarbarianDowngradeConcurrent(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	s.Cur = 0
	a := makeCities(t, s, 0, 2)
	b := makeCities(t, s, 1, 2)
	loseDefense(t, s)

	x := ext(s)
	if want := []engine.PlayerID{0, 1}; !reflect.DeepEqual(x.PendingDowngrade, want) {
		t.Fatalf("PendingDowngrade = %v, want %v", x.PendingDowngrade, want)
	}
	// Each owed seat can resolve its own obligation without the other having moved.
	for _, seat := range []engine.PlayerID{0, 1} {
		if cmd, ok := engine.AutoCommandFor(s, seat); !ok || cmd.Player != seat || cmd.Type != CmdBarbarianDowngrade {
			t.Fatalf("seat %d cannot act independently: %+v (ok=%v)", seat, cmd, ok)
		}
	}

	// Higher seat first, out of order.
	step(t, s, engine.Command{Player: 1, Type: CmdBarbarianDowngrade, Data: mustJSON(t, map[string]any{"v": b[1]})})
	if got := x.PendingDowngrade; !reflect.DeepEqual(got, []engine.PlayerID{0}) {
		t.Fatalf("after seat 1 paid, PendingDowngrade = %v, want [0]", got)
	}
	if s.Buildings[b[1]].City {
		t.Error("seat 1's chosen city should be razed")
	}
	if !(Module{}).blocks(s) {
		t.Error("turn not blocked while seat 0 owes a sacrifice")
	}
	step(t, s, engine.Command{Player: 0, Type: CmdBarbarianDowngrade, Data: mustJSON(t, map[string]any{"v": a[0]})})
	if len(x.PendingDowngrade) != 0 || (Module{}).blocks(s) {
		t.Errorf("both debts settled should unblock the turn (pending %v)", x.PendingDowngrade)
	}
}

// A debt that cannot be paid must still clear, and the event must say it was
// a forfeit so the feed does not announce a city that was never taken.
func TestBarbarianDowngradeForfeitSaysSo(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	s.Cur = 0
	const p engine.PlayerID = 0
	cities := makeCities(t, s, p, 2)
	loseDefense(t, s)

	// Take the cities away behind the debt's back. Unreachable in a live game
	// (the pick blocks the turn), so only a test can reach this branch.
	for _, v := range cities {
		delete(s.Buildings, v)
	}
	before := maps.Clone(s.Buildings)

	evs, err := (Module{}).decideBarbarianDowngrade(s, engine.Command{
		Player: p, Type: CmdBarbarianDowngrade,
		Data: mustJSON(t, map[string]any{"v": board.Vertex{}}),
	})
	if err != nil {
		t.Fatalf("a debt with nothing to pay it must still resolve: %v", err)
	}
	if len(evs) != 1 {
		t.Fatalf("events = %d, want 1", len(evs))
	}
	if d := engine.DecodeEvent[downgrade](evs[0]); !d.Forfeit {
		t.Errorf("a forfeit must be marked as one, got %+v", d)
	}

	applyAll(t, s, evs)
	if pend := ext(s).PendingDowngrade; len(pend) != 0 {
		t.Errorf("the debt must clear anyway, got %v", pend)
	}
	if (Module{}).blocks(s) {
		t.Error("turn did not resume after an unpayable debt")
	}
	if !reflect.DeepEqual(s.Buildings, before) {
		t.Error("a forfeit must raze nothing")
	}
}

// TestBarbarianDowngradeOldLogReplays: an attack event in the old shape (a
// pre-chosen Downgraded list, no Pending) must fold as before.
func TestBarbarianDowngradeOldLogReplays(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	s.Cur = 0
	const p engine.PlayerID = 0
	cities := makeCities(t, s, p, 3)
	x := ext(s)
	x.Walled[cities[0]] = true
	x.Players[p].Walls = 1
	citiesLeft := s.Players[p].CitiesLeft
	settlementsLeft := s.Players[p].SettlementsLeft

	// Hand-built in the old shape: every listed city is razed at once, even though
	// a live game would now offer a choice.
	applyAll(t, s, []engine.Event{engine.NewEvent(EvBarbarianAttack, barbarianAttackData{
		Strength: 0, Cities: 3, Win: false, Defender: engine.NoPlayer,
		Downgraded: []downgrade{{Player: p, V: cities[0]}},
	})})

	if s.Buildings[cities[0]].City {
		t.Error("old-shape Downgraded entry did not raze its city")
	}
	if x.Walled[cities[0]] || x.Players[p].Walls != 0 {
		t.Error("a razed walled city must still lose its wall")
	}
	if s.Players[p].CitiesLeft != citiesLeft+1 || s.Players[p].SettlementsLeft != settlementsLeft-1 {
		t.Error("old-shape razing did not return the city and spend a settlement")
	}
	if len(x.PendingDowngrade) != 0 {
		t.Errorf("old-shape log: pending downgrade = %v, want none", x.PendingDowngrade)
	}
	if (Module{}).blocks(s) {
		t.Error("old-shape log left the turn blocked")
	}
}

// TestBarbarianDowngradeReplayDeterminism plays a game in which a player owns
// the choice, with every step (the sacrifice included) recorded as events, then
// folds the log from scratch: replay(log) must equal the live state.
func TestBarbarianDowngradeReplayDeterminism(t *testing.T) {
	for seed := uint64(1); seed <= 6; seed++ {
		s, log := newGame(t, seed, nil)
		const p engine.PlayerID = 0

		// Play on until player p holds an actionable turn.
		advance := func() {
			for range 400 {
				if s.Cur == p && s.Rolled && engine.RequireActionableTurn(s, p) == nil {
					return
				}
				cmd, ok := engine.AutoCommand(s)
				if !ok {
					t.Fatalf("seed %d: game stalled before reaching player %d", seed, p)
				}
				log = append(log, step(t, s, cmd)...)
			}
			t.Fatalf("seed %d: never reached an actionable turn for player %d", seed, p)
		}
		advance()

		// Knights setup leaves p one settlement and one city, so one upgrade gives two
		// cities and a real choice. Fund it with a recorded grant so the log alone
		// reproduces the game. applyAll stamps Seq in place, so pass the slice that is
		// logged.
		grant := []engine.Event{engine.NewEvent(engine.EvResDistributed, engine.ResDistributedData{
			Gains: []engine.PlayerGain{{Player: p, Gain: engine.CostCity}},
		})}
		applyAll(t, s, grant)
		log = append(log, grant...)

		spots := s.LegalCities(p)
		if len(spots) == 0 {
			t.Fatalf("seed %d: player %d has no settlement to upgrade", seed, p)
		}
		log = append(log, step(t, s, engine.Command{Player: p, Type: engine.CmdBuildCity,
			Data: mustJSON(t, map[string]any{"v": spots[0]})})...)

		// Land the barbarians. Nobody has an active knight, so the defense fails and
		// p, with two sacrificable cities, gets the choice.
		atk, _ := (Module{}).attackEvents(s, ext(s))
		applyAll(t, s, atk)
		log = append(log, atk...)
		if !slices.Contains(ext(s).PendingDowngrade, p) {
			t.Fatalf("seed %d: expected player %d to owe a city sacrifice, got %v",
				seed, p, ext(s).PendingDowngrade)
		}

		seen := false
		for i := 0; i < 4000 && s.Phase != engine.PhaseFinished; i++ {
			cmd, ok := engine.AutoCommand(s)
			if !ok {
				break
			}
			evs := step(t, s, cmd)
			for _, e := range evs {
				if e.Type == EvBarbarianDowngraded {
					seen = true
				}
			}
			log = append(log, evs...)
		}
		if !seen {
			t.Fatalf("seed %d: the pending sacrifice never resolved through %s",
				seed, EvBarbarianDowngraded)
		}

		replayed, err := engine.Replay(log)
		if err != nil {
			t.Fatalf("seed %d: replay: %v", seed, err)
		}
		if !reflect.DeepEqual(s, replayed) {
			t.Fatalf("seed %d: replay diverged from the live state", seed)
		}
	}
}
