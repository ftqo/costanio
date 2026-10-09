package knights

import (
	"errors"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// plantCities turns n of the player's board vertices into cities, on top of
// what they own, and returns every city vertex they hold.
func plantCities(t *testing.T, s *engine.State, p engine.PlayerID, n int) []board.Vertex {
	t.Helper()
	x := ext(s)
	for _, v := range nFreeVertices(s, x, board.Vertex{}, n) {
		s.Buildings[v] = engine.Building{Owner: p, City: true}
		s.Players[p].CitiesLeft--
	}
	return (Module{}).freeCities(s, x, p)
}

// improveTo drives p's track up to level through the real command path,
// funding each step. It stops once an improvement leaves a metropolis pick
// pending and returns that step's events.
func improveTo(t *testing.T, s *engine.State, p engine.PlayerID, tr Track, level int) []engine.Event {
	t.Helper()
	x := ext(s)
	var last []engine.Event
	for x.Players[p].Improve[tr] < level {
		x.Players[p].Commodities[commodityForTrack(tr)] = x.Players[p].Improve[tr] + 1
		last = step(t, s, engine.Command{Player: p, Type: CmdImproveCity,
			Data: mustJSON(t, map[string]any{"track": int(tr)})})
		if x.MetropolisPending != nil {
			break
		}
	}
	return last
}

// TestMetropolisPickArming: how many eligible cities a player has when the
// metropolis is earned decides the outcome. None blocks the improvement, one
// resolves it outright, two or more asks.
func TestMetropolisPickArming(t *testing.T) {
	cases := []struct {
		name string
		// extraCities is how many cities to plant beyond the setup city; occupied
		// says whether the setup city already holds a metropolis.
		extraCities int
		occupied    bool
		wantErr     error
		wantPending bool
		wantPlaced  bool
	}{{
		name:     "no eligible city blocks the improvement",
		occupied: true,
		wantErr:  ErrNoFreeCity,
	}, {
		name:       "one eligible city resolves without asking",
		wantPlaced: true,
	}, {
		name:        "two eligible cities are a real choice",
		extraCities: 1,
		wantPending: true,
	}, {
		name:        "three eligible cities are a real choice",
		extraCities: 2,
		wantPending: true,
	}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newGame(t, 7, nil)
			clearStartingCities(s)
			rolled(t, s)
			p := s.Cur
			makeCity(s, p)
			x := ext(s)
			if tc.occupied {
				// Park an unrelated metropolis on the player's only city.
				var city board.Vertex
				for v, b := range s.Buildings {
					if b.Owner == p && b.City {
						city = v
					}
				}
				x.Players[p].Metropolis[Science] = true
				x.Players[p].MetropolisAt[Science] = city
			}
			if tc.extraCities > 0 {
				plantCities(t, s, p, tc.extraCities)
			}

			// Sit at level 3 and buy the metropolis level in one command.
			x.Players[p].Improve[Trade] = metropolisLevel - 1
			x.Players[p].Commodities[Cloth] = metropolisLevel
			events, err := engine.Decide(s, engine.Command{Player: p, Type: CmdImproveCity,
				Data: mustJSON(t, map[string]any{"track": int(Trade)})})
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("improve err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("improve: %v", err)
			}
			applyAll(t, s, events)

			pended := slices.ContainsFunc(events, func(e engine.Event) bool { return e.Type == EvMetropolisPending })
			placed := slices.ContainsFunc(events, func(e engine.Event) bool { return e.Type == EvMetropolis })
			if pended != tc.wantPending {
				t.Errorf("EvMetropolisPending emitted = %v, want %v (%v)", pended, tc.wantPending, events)
			}
			if placed != tc.wantPlaced {
				t.Errorf("EvMetropolis emitted = %v, want %v (%v)", placed, tc.wantPlaced, events)
			}
			if got := x.MetropolisPending != nil; got != tc.wantPending {
				t.Errorf("state pending = %v, want %v", got, tc.wantPending)
			}
			// A pending metropolis is not scored yet: the VP arrives with the city.
			if x.Players[p].Metropolis[Trade] != tc.wantPlaced {
				t.Errorf("metropolis held = %v, want %v", x.Players[p].Metropolis[Trade], tc.wantPlaced)
			}
			if tc.wantPending {
				if got := x.MetropolisPending.Player; got != p {
					t.Errorf("pending player = %d, want %d", got, p)
				}
				if got := x.MetropolisPending.Track; got != Trade {
					t.Errorf("pending track = %v, want %v", got, Trade)
				}
				if got := x.MetropolisPending.Prev; got != engine.NoPlayer {
					t.Errorf("pending prev = %d, want NoPlayer", got)
				}
			}
		})
	}
}

// TestMetropolisPickPlacesChosenCity: the player's answer decides the city and
// is not overwritten by the board-order default.
func TestMetropolisPickPlacesChosenCity(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	makeCity(s, p)
	plantCities(t, s, p, 2)
	x := ext(s)

	improveTo(t, s, p, Trade, metropolisLevel)
	if x.MetropolisPending == nil {
		t.Fatal("expected a pending metropolis pick")
	}
	cities := (Module{}).freeCities(s, x, p)
	if len(cities) < 3 {
		t.Fatalf("need at least 3 eligible cities, got %d", len(cities))
	}
	// Not the board-order default, so ignoring the payload fails here.
	want := cities[len(cities)-1]

	step(t, s, engine.Command{Player: p, Type: CmdMetropolisPick, Data: mustJSON(t, map[string]any{"v": want})})

	if x.MetropolisPending != nil {
		t.Error("pick did not clear the pending state")
	}
	if !x.Players[p].Metropolis[Trade] {
		t.Fatal("metropolis not held after the pick")
	}
	if got := x.Players[p].MetropolisAt[Trade]; got != want {
		t.Errorf("metropolis at %v, want the chosen city %v", got, want)
	}
}

// TestMetropolisPickRejections: only the owed player may answer, and only with
// one of their own metropolis-free cities. Every rejection leaves state untouched.
func TestMetropolisPickRejections(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	makeCity(s, p)
	makeCity(s, q)
	plantCities(t, s, p, 1)
	x := ext(s)

	improveTo(t, s, p, Trade, metropolisLevel)
	if x.MetropolisPending == nil {
		t.Fatal("expected a pending metropolis pick")
	}
	mine := (Module{}).freeCities(s, x, p)
	theirs := (Module{}).freeCities(s, x, q)
	if len(mine) < 2 || len(theirs) < 1 {
		t.Fatalf("setup: mine=%d theirs=%d", len(mine), len(theirs))
	}
	// A settlement of the player's (not a city) is never eligible.
	var settlement board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == p && !b.City {
			settlement = v
		}
	}

	cases := []struct {
		name string
		by   engine.PlayerID
		v    board.Vertex
		want error
	}{
		{"another player answers", q, mine[0], ErrNotOwed},
		{"an opponent's city", p, theirs[0], ErrNoFreeCity},
		{"own settlement, not a city", p, settlement, ErrNoFreeCity},
		{"an empty vertex", p, board.Vertex{Q: 99, R: 99}, ErrNoFreeCity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := engine.Decide(s, engine.Command{Player: tc.by, Type: CmdMetropolisPick,
				Data: mustJSON(t, map[string]any{"v": tc.v})})
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if x.MetropolisPending == nil {
				t.Error("a rejected pick cleared the pending state")
			}
			if x.Players[p].Metropolis[Trade] {
				t.Error("a rejected pick placed the metropolis anyway")
			}
		})
	}
}

// TestMetropolisPendingBlocksAndAutoResolves: while the pick stands nothing
// else is legal, the seat is on the clock, and the timeout default is the
// first metropolis-free city in board order.
func TestMetropolisPendingBlocksAndAutoResolves(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	makeCity(s, p)
	plantCities(t, s, p, 2)
	x := ext(s)

	improveTo(t, s, p, Trade, metropolisLevel)
	if x.MetropolisPending == nil {
		t.Fatal("expected a pending metropolis pick")
	}
	want, _ := (Module{}).firstFreeCity(s, x, p)

	// Ending the turn is refused while the pick stands.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdEndTurn}); err == nil {
		t.Error("end turn accepted with a metropolis pick pending")
	}
	// So is a fresh improvement on another track.
	x.Players[p].Commodities[Coin] = maxImprovement
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdImproveCity,
		Data: mustJSON(t, map[string]any{"track": int(Politics)})}); err == nil {
		t.Error("a second improvement accepted with a metropolis pick pending")
	}

	// The timer layer sees exactly this seat, owing exactly this decision.
	ds := engine.PendingDeciders(s)
	if len(ds) != 1 || ds[0].Seat != p || !slices.Contains(ds[0].Decisions, DecisionMetropolisPick) {
		t.Fatalf("pending deciders = %+v, want seat %d owing %q", ds, p, DecisionMetropolisPick)
	}

	// The board offers only the eligible cities, to that seat only.
	lt := s.LegalTargetsFor(p)
	got := (Module{}).freeCities(s, x, p)
	if !slices.Equal(lt.MetropolisCities, got) {
		t.Errorf("legal metropolis cities = %v, want %v", lt.MetropolisCities, got)
	}
	if len(lt.Settlements)+len(lt.Cities)+len(lt.Roads) != 0 {
		t.Error("ordinary build targets offered while the pick is owed")
	}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	if len(s.LegalTargetsFor(q).MetropolisCities) != 0 {
		t.Error("another seat was offered the metropolis cities")
	}

	// Auto-resolution takes the board-order default and clears the pending.
	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != CmdMetropolisPick || cmd.Player != p {
		t.Fatalf("AutoCommand = %+v (ok=%v), want a %s by %d", cmd, ok, CmdMetropolisPick, p)
	}
	step(t, s, cmd)
	if x.MetropolisPending != nil {
		t.Error("auto-resolution left the pick pending")
	}
	if got := x.Players[p].MetropolisAt[Trade]; got != want {
		t.Errorf("auto-resolved metropolis at %v, want the board-order default %v", got, want)
	}
}

// TestMetropolisPickSteal: a level-5 steal is a pending pick for the thief too,
// and resolving it moves the metropolis off the previous holder.
func TestMetropolisPickSteal(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	makeCity(s, p)
	makeCity(s, q)
	plantCities(t, s, q, 1)
	x := ext(s)

	// p holds the Trade metropolis at level 4 (their only city carries it).
	improveTo(t, s, p, Trade, metropolisLevel)
	if x.MetropolisPending != nil {
		t.Fatal("p has one eligible city; the metropolis should have resolved outright")
	}
	if !x.Players[p].Metropolis[Trade] {
		t.Fatal("p did not take the metropolis")
	}

	// q, at level 4, buys level 5 and steals it, with two free cities.
	x.Players[q].Improve[Trade] = metropolisLevel
	x.Players[q].Commodities[Cloth] = maxImprovement
	step(t, s, engine.Command{Player: p, Type: engine.CmdEndTurn})
	for s.Cur != q {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("stuck advancing to q's turn")
		}
		step(t, s, cmd)
	}
	if !s.Rolled {
		rolled(t, s)
	}
	step(t, s, engine.Command{Player: q, Type: CmdImproveCity,
		Data: mustJSON(t, map[string]any{"track": int(Trade)})})
	if x.MetropolisPending == nil {
		t.Fatal("the steal should arm a pick: q holds two metropolis-free cities")
	}
	if x.MetropolisPending.Prev != p {
		t.Errorf("pending prev = %d, want %d", x.MetropolisPending.Prev, p)
	}
	// The metropolis has not moved yet.
	if !x.Players[p].Metropolis[Trade] || x.Players[q].Metropolis[Trade] {
		t.Error("the metropolis moved before the thief named a city")
	}

	cities := (Module{}).freeCities(s, x, q)
	want := cities[len(cities)-1]
	step(t, s, engine.Command{Player: q, Type: CmdMetropolisPick, Data: mustJSON(t, map[string]any{"v": want})})
	if x.Players[p].Metropolis[Trade] || !x.Players[q].Metropolis[Trade] {
		t.Error("metropolis flags wrong after the steal resolved")
	}
	if got := x.Players[q].MetropolisAt[Trade]; got != want {
		t.Errorf("stolen metropolis at %v, want the chosen city %v", got, want)
	}
	if got := x.Players[p].MetropolisAt[Trade]; got != (board.Vertex{}) {
		t.Errorf("previous holder still pinned to %v", got)
	}
}

// TestMetropolisPickReplay: the events of an armed and answered pick fold on
// their own to the same module state the live path reached.
func TestMetropolisPickReplay(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	makeCity(s, p)
	plantCities(t, s, p, 2)

	// Snapshot the pre-improvement state; the events below replay onto this.
	before := s.Clone()

	x := ext(s)
	x.Players[p].Improve[Trade] = metropolisLevel - 1
	ext(before).Players[p].Improve[Trade] = metropolisLevel - 1
	x.Players[p].Commodities[Cloth] = metropolisLevel
	ext(before).Players[p].Commodities[Cloth] = metropolisLevel

	var log []engine.Event
	log = append(log, step(t, s, engine.Command{Player: p, Type: CmdImproveCity,
		Data: mustJSON(t, map[string]any{"track": int(Trade)})})...)
	if x.MetropolisPending == nil {
		t.Fatal("expected a pending metropolis pick")
	}
	cities := (Module{}).freeCities(s, x, p)
	chosen := cities[len(cities)-1]
	log = append(log, step(t, s, engine.Command{Player: p, Type: CmdMetropolisPick,
		Data: mustJSON(t, map[string]any{"v": chosen})})...)

	for _, e := range log {
		if err := engine.Apply(before, e); err != nil {
			t.Fatalf("replay Apply(%s): %v", e.Type, err)
		}
	}
	live, rep := ext(s).Players[p], ext(before).Players[p]
	if live.Metropolis != rep.Metropolis || live.MetropolisAt != rep.MetropolisAt {
		t.Errorf("replay diverged: live %v@%v, replay %v@%v",
			live.Metropolis, live.MetropolisAt, rep.Metropolis, rep.MetropolisAt)
	}
	if ext(before).MetropolisPending != nil {
		t.Error("replay left the pick pending")
	}
	if live.MetropolisAt[Trade] != chosen {
		t.Errorf("metropolis at %v, want the chosen %v", live.MetropolisAt[Trade], chosen)
	}
}
