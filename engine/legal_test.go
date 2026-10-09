package engine

import "testing"

func TestLegalTargetsSetup(t *testing.T) {
	s, _ := newGame(t, 3, 7)

	// Setup, settlement step: only settlements are offered.
	lt := s.LegalTargetsFor(s.Cur)
	if len(lt.Settlements) == 0 {
		t.Fatal("setup should offer settlement spots")
	}
	if len(lt.Roads) != 0 || len(lt.Cities) != 0 {
		t.Fatalf("settlement step should offer only settlements; roads=%d cities=%d", len(lt.Roads), len(lt.Cities))
	}
	for _, v := range lt.Settlements {
		if checkSettlementSpot(s, v) != nil {
			t.Fatalf("offered an illegal settlement spot %v", v)
		}
	}
	// A player whose turn it isn't gets nothing.
	other := PlayerID((int(s.Cur) + 1) % 3)
	if got := s.LegalTargetsFor(other); len(got.Settlements)+len(got.Roads)+len(got.Cities) != 0 {
		t.Fatal("non-current player must get no targets")
	}

	// Place a settlement → now only roads touching it are offered.
	v := lt.Settlements[0]
	step(t, s, Command{Player: s.Cur, Type: CmdPlaceSettlement, Data: mustJSON(t, SettlementPlacedData{Player: s.Cur, V: v})})
	lt2 := s.LegalTargetsFor(s.Cur)
	if len(lt2.Settlements) != 0 {
		t.Fatal("road step should offer no settlements")
	}
	if len(lt2.Roads) == 0 {
		t.Fatal("road step should offer roads")
	}
	for _, e := range lt2.Roads {
		if !e.Touches(v) {
			t.Fatalf("offered setup road %v not touching the new settlement %v", e, v)
		}
	}
}

func TestLegalTargetsPlay(t *testing.T) {
	s := playState(t, 20)

	lt := s.LegalTargetsFor(0)

	// Occupied vertices are never offered as settlements.
	for v := range s.Buildings {
		for _, off := range lt.Settlements {
			if off == v {
				t.Fatalf("offered occupied vertex %v as a settlement", v)
			}
		}
	}
	// Every offered settlement is positionally legal and road-adjacent (play rule).
	for _, v := range lt.Settlements {
		if checkSettlementSpot(s, v) != nil || !s.hasAdjacentRoad(v, 0) {
			t.Fatalf("offered non-buildable settlement %v", v)
		}
	}
	// Cities offered are exactly seat 0's own (non-city) settlements.
	for _, v := range lt.Cities {
		if b, ok := s.Buildings[v]; !ok || b.Owner != 0 || b.City {
			t.Fatalf("offered non-upgradeable city %v", v)
		}
	}
	if len(lt.Cities) == 0 {
		t.Fatal("play turn should offer the player's settlements as city upgrades")
	}
	// Roads offered connect to seat 0 and aren't already taken.
	for _, e := range lt.Roads {
		if _, occ := s.Roads[e]; occ {
			t.Fatalf("offered an occupied road %v", e)
		}
		if !s.roadConnects(e, 0) {
			t.Fatalf("offered a disconnected road %v", e)
		}
	}
	if len(lt.Roads) == 0 {
		t.Fatal("play turn should offer at least one road")
	}

	// Before rolling, no build targets.
	s.Rolled = false
	if got := s.LegalTargetsFor(0); len(got.Settlements)+len(got.Cities) != 0 {
		t.Fatal("no settlement/city targets before rolling")
	}
}
