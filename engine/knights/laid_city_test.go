package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// pieces asserts the full piece ledger for one player: every road, settlement
// and city is on the board or in supply, never both and never neither. A
// laid-on-side city is a city piece doing a settlement's job, so it reads as a
// settlement on the board while its city slot is in supply, hence the
// correction term. See PlayerExt.LaidCities.
func pieces(t *testing.T, s *engine.State, p engine.PlayerID, label string) {
	t.Helper()
	roads, setts, cities := 0, 0, 0
	for _, owner := range s.Roads {
		if owner == p {
			roads++
		}
	}
	for _, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		if b.City {
			cities++
		} else {
			setts++
		}
	}
	laid := LaidCityCount(s, p)
	ps := s.Players[p]
	if got := roads + ps.RoadsLeft; got != engine.MaxRoads {
		t.Errorf("%s: roads %d on board + %d left = %d, want %d", label, roads, ps.RoadsLeft, got, engine.MaxRoads)
	}
	if got := setts - laid + ps.SettlementsLeft; got != engine.MaxSettlements {
		t.Errorf("%s: settlements %d on board - %d laid + %d left = %d, want %d",
			label, setts, laid, ps.SettlementsLeft, got, engine.MaxSettlements)
	}
	if got := cities + ps.CitiesLeft; got != engine.MaxCities {
		t.Errorf("%s: cities %d on board + %d left = %d, want %d", label, cities, ps.CitiesLeft, got, engine.MaxCities)
	}
}

// raze folds one barbarian sacrifice of p's city at v, the way the attack event
// resolves a loser with nothing to choose.
func raze(t *testing.T, s *engine.State, p engine.PlayerID, v board.Vertex) {
	t.Helper()
	ev := engine.NewEvent(EvBarbarianAttack, barbarianAttackData{
		Win: false, Defender: engine.NoPlayer,
		Downgraded: []downgrade{{Player: p, V: v}},
	})
	ev.Seq = s.NextSeq
	if err := engine.Apply(s, ev); err != nil {
		t.Fatal(err)
	}
}

// exhaustSettlements puts p's whole settlement supply on the board so the next
// raze lays the city on its side. It places them rather than zeroing the
// counter, so the ledger still adds up.
func exhaustSettlements(t *testing.T, s *engine.State, p engine.PlayerID) {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Players[p].SettlementsLeft == 0 {
			return
		}
		for _, v := range h.Vertices() {
			if s.Players[p].SettlementsLeft == 0 {
				return
			}
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			near := false
			for _, n := range v.Neighbors() {
				if _, built := s.Buildings[n]; built {
					near = true
				}
			}
			if near || !s.Board.LandVertex(v) {
				continue
			}
			s.Buildings[v] = engine.Building{Owner: p}
			s.Players[p].SettlementsLeft--
		}
	}
	if s.Players[p].SettlementsLeft != 0 {
		fixtureGone(t, "board has no room to spend the settlement supply")
	}
}

// settlementsOf lists p's settlements in a stable order.
func settlementsOf(s *engine.State, p engine.PlayerID) []board.Vertex {
	var out []board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p && !b.City && !containsVertex(out, v) {
				out = append(out, v)
			}
		}
	}
	return out
}

// Standing a laid-on-side city back up must not credit a settlement piece:
// none left supply when it was laid, since the piece there is the city. The
// ordinary EvCityBuilt fold increments SettlementsLeft unconditionally, so
// without the correction a sixth settlement appears on a five-piece supply.
func TestLaidCityUpgradeMintsNoSettlement(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur
	exhaustSettlements(t, s, p) // the raze then has no piece to draw

	var city board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p && b.City {
				city = v
			}
		}
	}
	if (city == board.Vertex{}) {
		fixtureGone(t, "no city for p")
	}
	pieces(t, s, p, "before raze")

	raze(t, s, p, city)
	if s.Players[p].SettlementsLeft != 0 {
		t.Fatalf("after raze: settlements left = %d, want 0", s.Players[p].SettlementsLeft)
	}
	pieces(t, s, p, "after raze")

	s.Players[p].Hand = engine.CostCity
	step(t, s, engine.Command{Player: p, Type: engine.CmdBuildCity, Data: mustJSON(t, map[string]any{"v": city})})
	if !s.Buildings[city].City {
		t.Fatal("laid city was not upgraded")
	}
	if got := s.Players[p].SettlementsLeft; got != 0 {
		t.Errorf("after upgrade: settlements left = %d, want 0 (no piece left supply when the city was laid)", got)
	}
	pieces(t, s, p, "after upgrade")
	if v, must := (Module{}).mustUpgradeFirst(s, p); must {
		t.Errorf("pin should be lifted after the upgrade, still pins %v", v)
	}
}

// Medicine is the other upgrade path and credits the same settlement piece,
// so it needs the same correction.
func TestLaidCityMedicineUpgradeMintsNoSettlement(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur
	exhaustSettlements(t, s, p)
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMedicine}

	var city board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p && b.City {
				city = v
			}
		}
	}
	if (city == board.Vertex{}) {
		fixtureGone(t, "no city for p")
	}
	raze(t, s, p, city)

	s.Players[p].Hand = costMedicineCity
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMedicine, "v": city})})
	if !s.Buildings[city].City {
		t.Fatal("Medicine did not upgrade the laid city")
	}
	if got := s.Players[p].SettlementsLeft; got != 0 {
		t.Errorf("after Medicine upgrade: settlements left = %d, want 0", got)
	}
	pieces(t, s, p, "after medicine upgrade")
}

// Two cities can be laid on their side at once (two attacks with the
// settlement supply empty). Both must stay tracked and pinned in order.
func TestTwoLaidCitiesAreBothTracked(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur

	// Promote both of p's setup buildings to cities so there are two to lose.
	var cities []board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p && !containsVertex(cities, v) {
				if !b.City {
					s.Buildings[v] = engine.Building{Owner: p, City: true}
					s.Players[p].CitiesLeft--
					s.Players[p].SettlementsLeft++
				}
				cities = append(cities, v)
			}
		}
	}
	if len(cities) < 2 {
		fixtureGone(t, "need two cities for p")
	}
	exhaustSettlements(t, s, p) // and no settlement piece to fall back on
	pieces(t, s, p, "two cities")

	raze(t, s, p, cities[0])
	raze(t, s, p, cities[1])
	if got := LaidCityCount(s, p); got != 2 {
		t.Fatalf("laid cities = %d, want 2 (the second raze must not overwrite the first)", got)
	}
	pieces(t, s, p, "both laid")

	// The pin walks them oldest first, and only lifts when both are back up.
	if v, must := (Module{}).mustUpgradeFirst(s, p); !must || v != cities[0] {
		t.Fatalf("pin = (%v,%v), want (%v,true)", v, must, cities[0])
	}
	s.Players[p].Hand = engine.CostCity
	reject(t, s, engine.Command{Player: p, Type: engine.CmdBuildCity,
		Data: mustJSON(t, map[string]any{"v": cities[1]})}, engine.ErrBadPlacement)
	step(t, s, engine.Command{Player: p, Type: engine.CmdBuildCity,
		Data: mustJSON(t, map[string]any{"v": cities[0]})})
	pieces(t, s, p, "first restored")

	if v, must := (Module{}).mustUpgradeFirst(s, p); !must || v != cities[1] {
		t.Fatalf("pin = (%v,%v), want (%v,true) once the first is back up", v, must, cities[1])
	}
	s.Players[p].Hand = engine.CostCity
	step(t, s, engine.Command{Player: p, Type: engine.CmdBuildCity,
		Data: mustJSON(t, map[string]any{"v": cities[1]})})
	pieces(t, s, p, "both restored")
	if got := s.Players[p].SettlementsLeft; got != 0 {
		t.Errorf("settlements left = %d, want 0 (neither upgrade returned a piece)", got)
	}
	if v, must := (Module{}).mustUpgradeFirst(s, p); must {
		t.Errorf("pin should be lifted, still pins %v", v)
	}
}

// A game restored from a snapshot taken before LaidCities existed has only the
// old scalar pin. It must still pin, and standing that city up must still cost
// no settlement piece.
func TestLaidCityScalarPinFallback(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	setts := settlementsOf(s, p)
	if len(setts) < 2 {
		fixtureGone(t, "need two settlements for p")
	}
	x := ext(s)
	x.Players[p].LaidCity = setts[0]
	x.Players[p].LaidCityActive = true
	x.Players[p].LaidCities = nil // the pre-slice shape
	left := s.Players[p].SettlementsLeft

	if v, must := (Module{}).mustUpgradeFirst(s, p); !must || v != setts[0] {
		t.Fatalf("pin = (%v,%v), want (%v,true) from the scalar alone", v, must, setts[0])
	}
	if got := LaidCityCount(s, p); got != 1 {
		t.Fatalf("laid count = %d, want 1 from the scalar alone", got)
	}
	s.Players[p].Hand = engine.CostCity
	step(t, s, engine.Command{Player: p, Type: engine.CmdBuildCity,
		Data: mustJSON(t, map[string]any{"v": setts[0]})})
	if got := s.Players[p].SettlementsLeft; got != left {
		t.Errorf("settlements left = %d, want %d (no piece left supply when the city was laid)", got, left)
	}
	if v, must := (Module{}).mustUpgradeFirst(s, p); must {
		t.Errorf("pin should be lifted, still pins %v", v)
	}
}

// Bishop moves the robber, so the friendly-robber shield applies to it as to
// the robber and the knight chase. In Knights every seat starts at 3 public VP
// and only drops into the shield after a pillage.
func TestBishopHonorsFriendlyRobber(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	clearStartingCities(s) // two settlements each: 2 public VP, inside the shield
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Attacks = 1 // the robber is only in play after the first barbarian attack

	// A hex touching one of q's settlements, so q is a neighbour of the robber.
	var dest board.Hex
	found := false
	for _, v := range settlementsOf(s, q) {
		for _, h := range v.Hexes() {
			if s.Board.Land(h) && h != s.Board.Robber {
				dest, found = h, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		fixtureGone(t, "no hex touching a q settlement")
	}
	s.Players[q].Hand = engine.Hand{board.Brick: 3}
	if vp := s.PublicVPWithModules(q); vp > 2 {
		fixtureGone(t, "q is at %d public VP, outside the shield", vp)
	}

	// Shield on: the robber may move there, but nobody is robbed.
	s.Config.FriendlyRobber = true
	x.Players[p].Progress = []ProgressCard{CardBishop}
	events, err := engine.Decide(s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardBishop, "hex": dest})})
	if err != nil {
		t.Fatalf("Bishop rejected: %v", err)
	}
	for _, e := range events {
		if e.Type == engine.EvCardStolen || e.Type == EvCommodityStolen {
			t.Fatalf("Bishop stole from a player the friendly robber protects: %+v", e)
		}
	}

	// Shield off: the same play robs q, so the test above is not passing by
	// accident.
	s.Config.FriendlyRobber = false
	events, err = engine.Decide(s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardBishop, "hex": dest})})
	if err != nil {
		t.Fatalf("Bishop rejected: %v", err)
	}
	stole := false
	for _, e := range events {
		if e.Type == engine.EvCardStolen || e.Type == EvCommodityStolen {
			stole = true
		}
	}
	if !stole {
		t.Fatalf("without the shield Bishop should rob q: %+v", events)
	}
}
