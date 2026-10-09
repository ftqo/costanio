package knights

import (
	"errors"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestLegalExtras checks that the module contributes knight and wall placement
// targets to LegalTargetsFor, so the client offers only placeable spots (and
// the build buttons can disable when there are none).
func TestLegalExtras(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur

	// Knights: there are spots on the player's road network, and every reported
	// spot must actually pass the placement check.
	lt := s.LegalTargetsFor(p)
	if len(lt.Knights) == 0 {
		t.Fatal("expected legal knight spots on the player's road network")
	}
	for _, v := range lt.Knights {
		if err := (Module{}).checkKnightSpot(s, v, p); err != nil {
			t.Errorf("reported knight spot %v fails checkKnightSpot: %v", v, err)
		}
	}

	// Building a knight on a spot removes it from the legal set.
	spot := lt.Knights[0]
	s.Players[p].Hand = costKnight
	step(t, s, engine.Command{Player: p, Type: CmdBuildKnight, Data: mustJSON(t, map[string]any{"v": spot})})
	for _, v := range s.LegalTargetsFor(p).Knights {
		if v == spot {
			t.Errorf("occupied vertex %v still reported as a legal knight spot", spot)
		}
	}

	// Walls: none eligible until the player owns a city.
	if got := s.LegalTargetsFor(p).Walls; len(got) != 0 {
		t.Fatalf("walls eligible without owning a city: %v", got)
	}
	makeCity(s, p)
	if len(s.LegalTargetsFor(p).Walls) == 0 {
		t.Fatal("expected the unwalled city to be wall-eligible")
	}

	// Walling that city (the only one) empties the eligible set.
	s.Players[p].Hand = costWall
	step(t, s, engine.Command{Player: p, Type: CmdBuildWall})
	if got := s.LegalTargetsFor(p).Walls; len(got) != 0 {
		t.Errorf("walled city still reported as wall-eligible: %v", got)
	}
}

// TestLegalExtrasNotActivePlayer: a player who is not the current player gets no
// knight/wall targets (mirrors the base-game gating).
func TestLegalExtrasNotActivePlayer(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	other := (s.Cur + 1) % engine.PlayerID(len(s.Players))
	lt := s.LegalTargetsFor(other)
	if len(lt.Knights) != 0 || len(lt.Walls) != 0 || len(lt.KnightMoves) != 0 {
		t.Errorf("non-active player has placement targets: knights=%v walls=%v moves=%v", lt.Knights, lt.Walls, lt.KnightMoves)
	}
}

// TestLegalImprovements checks the module reports which improvement tracks the
// player may improve now, mirroring decideImprove: none without a city, all
// tracks once a city exists, and a track drops out at the cap or when a
// metropolis level has no metropolis-free city.
func TestLegalImprovements(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur

	// No city → nothing improvable (improvements need a city, like walls).
	if got := s.LegalTargetsFor(p).Improvements; len(got) != 0 {
		t.Fatalf("improvements offered without a city: %v", got)
	}
	makeCity(s, p)
	// City + every track at level 0 → all tracks improvable.
	if got := s.LegalTargetsFor(p).Improvements; len(got) != int(trackKinds) {
		t.Fatalf("want %d improvable tracks with a city, got %v", trackKinds, got)
	}

	x := ext(s)
	// A maxed track drops out of the set.
	x.Players[p].Improve[Trade] = maxImprovement
	if got := s.LegalTargetsFor(p).Improvements; slices.Contains(got, int(Trade)) {
		t.Errorf("maxed Trade still reported improvable: %v", got)
	}

	// Politics at level 3: the next level would claim a metropolis, which needs a
	// metropolis-free city. Occupy the only city with a metropolis and Politics is
	// no longer improvable, while Science still is.
	x.Players[p].Improve[Politics] = metropolisLevel - 1
	var city board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == p && b.City {
			city = v
		}
	}
	x.Players[p].Metropolis[Science] = true
	x.Players[p].MetropolisAt[Science] = city
	got := s.LegalTargetsFor(p).Improvements
	if slices.Contains(got, int(Politics)) {
		t.Errorf("Politics reported improvable with no metropolis-free city: %v", got)
	}
	if !slices.Contains(got, int(Science)) {
		t.Errorf("sub-metropolis Science track should still be improvable: %v", got)
	}
}

// TestLegalImprovementsMetropolisCases checks the advisory improvement list
// against decideImprove where a metropolis is in play. Each case runs both
// sides on a commodity-funded seat; they must agree because the client
// disables the tile from the advisory. A free city is needed only when a
// metropolis would actually be placed or moved (so finishing your own
// metropolis track to 5 is allowed).
func TestLegalImprovementsMetropolisCases(t *testing.T) {
	cases := []struct {
		name string
		// setup runs with p owning exactly one city at cityV, and returns the
		// track under test.
		setup func(x *Ext, p, q engine.PlayerID, cityV board.Vertex) Track
		want  bool // improvable: offered by the advisory and accepted by decideImprove
	}{{
		// The metropolis sits on top of a city that is still a city, and finishing
		// your own track claims nothing new.
		name: "own metropolis, same track, 4 to 5",
		setup: func(x *Ext, p, q engine.PlayerID, cityV board.Vertex) Track {
			x.Players[p].Improve[Trade] = metropolisLevel
			x.Players[p].Metropolis[Trade] = true
			x.Players[p].MetropolisAt[Trade] = cityV
			return Trade
		},
		want: true,
	}, {
		// A second metropolis needs a second city to stand on.
		name: "own metropolis, different track, 3 to 4",
		setup: func(x *Ext, p, q engine.PlayerID, cityV board.Vertex) Track {
			x.Players[p].Improve[Science] = metropolisLevel
			x.Players[p].Metropolis[Science] = true
			x.Players[p].MetropolisAt[Science] = cityV
			x.Players[p].Improve[Politics] = metropolisLevel - 1
			return Politics
		},
		want: false,
	}, {
		// Matching the holder's level takes nothing from them, so no city is needed.
		name: "matching another holder's level 4",
		setup: func(x *Ext, p, q engine.PlayerID, cityV board.Vertex) Track {
			x.Players[p].Improve[Science] = metropolisLevel
			x.Players[p].Metropolis[Science] = true
			x.Players[p].MetropolisAt[Science] = cityV
			x.Players[q].Improve[Trade] = metropolisLevel
			x.Players[q].Metropolis[Trade] = true
			x.Players[p].Improve[Trade] = metropolisLevel - 1
			return Trade
		},
		want: true,
	}, {
		// Exceeding it steals the metropolis, which does need a free city.
		name: "exceeding another holder's level 4",
		setup: func(x *Ext, p, q engine.PlayerID, cityV board.Vertex) Track {
			x.Players[p].Improve[Science] = metropolisLevel
			x.Players[p].Metropolis[Science] = true
			x.Players[p].MetropolisAt[Science] = cityV
			x.Players[q].Improve[Trade] = metropolisLevel
			x.Players[q].Metropolis[Trade] = true
			x.Players[p].Improve[Trade] = metropolisLevel
			return Trade
		},
		want: false,
	}, {
		// Below level 4 no metropolis is at stake at all.
		name: "below metropolis level with an occupied city",
		setup: func(x *Ext, p, q engine.PlayerID, cityV board.Vertex) Track {
			x.Players[p].Improve[Science] = metropolisLevel
			x.Players[p].Metropolis[Science] = true
			x.Players[p].MetropolisAt[Science] = cityV
			return Trade
		},
		want: true,
	}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newGame(t, 7, nil)
			clearStartingCities(s)
			rolled(t, s)
			p := s.Cur
			q := (p + 1) % engine.PlayerID(len(s.Players))
			makeCity(s, p) // exactly one city, so a free one exists only if this is it
			x := ext(s)

			var cityV board.Vertex
			for v, b := range s.Buildings {
				if b.Owner == p && b.City {
					cityV = v
				}
			}
			track := tc.setup(x, p, q, cityV)
			x.Players[p].Commodities[commodityForTrack(track)] = maxImprovement + 1

			offered := slices.Contains(s.LegalTargetsFor(p).Improvements, int(track))
			if offered != tc.want {
				t.Errorf("advisory offers track %v = %v, want %v", track, offered, tc.want)
			}
			_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdImproveCity,
				Data: mustJSON(t, map[string]any{"track": int(track)})})
			if accepted := err == nil; accepted != tc.want {
				t.Errorf("decideImprove accepts track %v = %v (err=%v), want %v", track, accepted, err, tc.want)
			}
			if !tc.want && !errors.Is(err, ErrNoFreeCity) {
				t.Errorf("blocked improvement should report ErrNoFreeCity, got %v", err)
			}
		})
	}
}

// TestImproveOwnMetropolisTrackToFive: drive Trade to 4 (claiming the
// metropolis on the only city), finish at 5 through the real command path, and
// check the metropolis stays on the same city.
func TestImproveOwnMetropolisTrackToFive(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	makeCity(s, p) // the player's only city, which the metropolis will occupy
	x := ext(s)

	for level := range maxImprovement {
		x.Players[p].Commodities[Cloth] = level + 1
		events := step(t, s, engine.Command{Player: p, Type: CmdImproveCity,
			Data: mustJSON(t, map[string]any{"track": int(Trade)})})
		if level+1 == maxImprovement {
			for _, e := range events {
				if e.Type == EvMetropolis {
					t.Errorf("level 5 self-upgrade re-placed the metropolis: %+v", e)
				}
			}
		}
	}
	if got := x.Players[p].Improve[Trade]; got != maxImprovement {
		t.Errorf("Trade level = %d, want %d", got, maxImprovement)
	}
	if !x.Players[p].Metropolis[Trade] {
		t.Error("metropolis lost over the level-5 upgrade")
	}
	if b, ok := s.Buildings[x.Players[p].MetropolisAt[Trade]]; !ok || !b.City || b.Owner != p {
		t.Errorf("metropolis vertex %v is not the player's city (%+v)", x.Players[p].MetropolisAt[Trade], b)
	}
}

// findMoveSetup locates from→to (a land edge, both ends empty), plus a road
// from→to owned by p, returning a state where p has an active knight at `from`.
func findMoveSetup(t *testing.T, s *engine.State, p engine.PlayerID) (from, to board.Vertex, ok bool) {
	from, to, _, _, ok = findDisplacementSetup(s)
	return from, to, ok
}

// TestLegalKnightMovesSubset: every destination reported for a movable knight
// is accepted by decideMoveKnight, and `from` is never a destination.
func TestLegalKnightMovesSubset(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	from, to, ok := findMoveSetup(t, s, p)
	if !ok {
		fixtureGone(t, "no clean move geometry on this board")
	}
	s.Roads[board.NewEdge(from, to)] = p
	x.Knights[from] = Knight{Owner: p, Level: 1, Active: true}

	var grp *engine.KnightMoveTargets
	for i := range s.LegalTargetsFor(p).KnightMoves {
		g := s.LegalTargetsFor(p).KnightMoves[i]
		if g.From == from {
			grp = &g
			break
		}
	}
	if grp == nil {
		t.Fatalf("no knight-move group for our active knight at %v", from)
	}
	if len(grp.To) == 0 {
		t.Fatal("expected at least one destination (the adjacent `to`)")
	}
	// `to` must be offered (it's empty, land, road-reachable).
	foundTo := false
	for _, d := range grp.To {
		if d == to {
			foundTo = true
		}
		if d == from {
			t.Errorf("source %v reported as its own destination", from)
		}
		// Every destination is accepted by decideMoveKnight.
		if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveKnight,
			Data: mustJSON(t, map[string]any{"from": from, "to": d})}); err != nil {
			t.Errorf("reported knight move %v->%v rejected by decideMoveKnight: %v", from, d, err)
		}
	}
	if !foundTo {
		t.Errorf("adjacent empty vertex %v not offered", to)
	}
}

// TestLegalKnightMovesFreshlyActivated: a freshly-activated knight contributes
// no move group; an inactive one contributes none.
func TestLegalKnightMovesFreshlyActivated(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	from, to, ok := findMoveSetup(t, s, p)
	if !ok {
		fixtureGone(t, "no geometry")
	}
	s.Roads[board.NewEdge(from, to)] = p

	x.Knights[from] = Knight{Owner: p, Level: 1, Active: true, FreshlyActivated: true}
	for _, g := range s.LegalTargetsFor(p).KnightMoves {
		if g.From == from {
			t.Error("freshly-activated knight wrongly offered moves")
		}
	}

	x.Knights[from] = Knight{Owner: p, Level: 1, Active: false}
	for _, g := range s.LegalTargetsFor(p).KnightMoves {
		if g.From == from {
			t.Error("inactive knight wrongly offered moves")
		}
	}
}

// TestLegalKnightMovesDisplacement: a strictly-weaker enemy knight on a
// reachable land vertex appears in both To and Displace; an equal/stronger enemy
// does not. decideMoveKnight(from, displaceVertex) succeeds (EvKnightDisplaced).
func TestLegalKnightMovesDisplacement(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)

	from, to, toDest, dest, ok := findDisplacementSetup(s)
	if !ok {
		fixtureGone(t, "no clean displacement geometry on this board")
	}
	s.Roads[board.NewEdge(from, to)] = p
	s.Roads[toDest] = q // so the displaced knight has somewhere to relocate
	_ = dest
	x.Knights[from] = Knight{Owner: p, Level: 2, Active: true}
	x.Knights[to] = Knight{Owner: q, Level: 1, Active: true} // weaker enemy

	var grp *engine.KnightMoveTargets
	for i := range s.LegalTargetsFor(p).KnightMoves {
		g := s.LegalTargetsFor(p).KnightMoves[i]
		if g.From == from {
			grp = &g
			break
		}
	}
	if grp == nil {
		t.Fatalf("no move group for knight at %v", from)
	}
	inTo, inDisplace := false, false
	for _, d := range grp.To {
		if d == to {
			inTo = true
		}
	}
	for _, d := range grp.Displace {
		if d == to {
			inDisplace = true
		}
	}
	if !inTo || !inDisplace {
		t.Errorf("weaker enemy at %v should be in both To (%v) and Displace (%v)", to, inTo, inDisplace)
	}
	// The displacement command succeeds and emits EvKnightDisplaced.
	evs, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": to})})
	if err != nil {
		t.Fatalf("displacement rejected: %v", err)
	}
	foundDisp := false
	for _, e := range evs {
		if e.Type == EvKnightDisplaced {
			foundDisp = true
		}
	}
	if !foundDisp {
		t.Errorf("displacement did not emit EvKnightDisplaced: %+v", evs)
	}

	// Now make the enemy equal strength: it must not be displaceable.
	x.Knights[to] = Knight{Owner: q, Level: 2, Active: true}
	for _, g := range s.LegalTargetsFor(p).KnightMoves {
		if g.From != from {
			continue
		}
		for _, d := range g.Displace {
			if d == to {
				t.Error("equal-strength enemy wrongly listed as displaceable")
			}
		}
		for _, d := range g.To {
			if d == to {
				t.Error("equal-strength enemy wrongly listed as a destination")
			}
		}
	}
}

// TestKnightViewFreshlyActivated: ViewExt emits freshly_activated matching engine
// state right after activation and after it clears.
func TestKnightViewFreshlyActivated(t *testing.T) {
	s, _ := newGame(t, 14, nil)
	rolled(t, s)
	p := s.Cur
	spot := knightSpotFor(t, s, p)

	s.Players[p].Hand = costKnight
	step(t, s, engine.Command{Player: p, Type: CmdBuildKnight, Data: mustJSON(t, map[string]any{"v": spot})})
	s.Players[p].Hand = costActivate
	step(t, s, engine.Command{Player: p, Type: CmdActivateKnight, Data: mustJSON(t, map[string]any{"v": spot})})

	view := ext(s).ViewExt(p).(*ExtView)
	found := false
	for _, kv := range view.Knights {
		if kv.V == spot {
			found = true
			if !kv.FreshlyActivated {
				t.Error("view should report freshly_activated right after activation")
			}
		}
	}
	if !found {
		t.Fatal("knight not in view")
	}

	// End the turn; the flag clears and so should the view's.
	step(t, s, engine.Command{Player: p, Type: engine.CmdEndTurn})
	view = ext(s).ViewExt(p).(*ExtView)
	for _, kv := range view.Knights {
		if kv.V == spot && kv.FreshlyActivated {
			t.Error("view still reports freshly_activated after the turn passed")
		}
	}
}
