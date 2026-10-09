package knights

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// giveCard puts a single progress card in seat's hand.
func giveCard(s *engine.State, seat engine.PlayerID, card ProgressCard) {
	ext(s).Players[seat].Progress = []ProgressCard{card}
}

// TestProgressMerchantTargetsMatchValidator: every offered Merchant hex must be
// accepted by the play validator, and no other hex.
func TestProgressMerchantTargetsMatchValidator(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur
	giveCard(s, p, CardMerchant)

	lt := s.LegalTargetsFor(p)
	offered := map[board.Hex]bool{}
	for _, h := range lt.ProgressTargets[string(CardMerchant)].Hexes {
		offered[h] = true
	}
	if len(offered) == 0 {
		t.Fatal("no Merchant hexes offered (player should own buildings after setup)")
	}
	rich := s.Clone()
	for r := range rich.Players[p].Hand {
		rich.Players[p].Hand[r] = 20
	}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		_, err := engine.Decide(rich, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: rawJSON(map[string]any{"card": CardMerchant, "hex": h})})
		if offered[h] != (err == nil) {
			t.Errorf("merchant hex %v offered=%v validator=%v (err=%v)", h, offered[h], err == nil, err)
		}
	}
}

// TestMerchantRefusesBarrenTerrain: the merchant needs a hex representing one
// of the five bankable resources, so gold, the desert and the lake all refuse
// it. Otherwise the card would bank a VP on a hex that can never give the
// merchant's 2:1. Both the offer and the validator are checked. The lake case
// matters because Fishermen and Caravans turn deserts into lakes.
func TestMerchantRefusesBarrenTerrain(t *testing.T) {
	for _, tc := range []struct {
		name string
		res  board.Resource
	}{
		{"gold field", board.Gold},
		{"desert", board.ResNone},
		{"lake", board.Lake},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newGame(t, 3, nil)
			rolled(t, s)
			p := s.Cur
			giveCard(s, p, CardMerchant)

			offered := func() map[board.Hex]bool {
				out := map[board.Hex]bool{}
				for _, h := range s.LegalTargetsFor(p).ProgressTargets[string(CardMerchant)].Hexes {
					out[h] = true
				}
				return out
			}
			before := offered()
			if len(before) == 0 {
				t.Fatal("no Merchant hexes offered (the player owns buildings after setup)")
			}

			// Retype a hex the player already borders, taken from the offer, so terrain is
			// the only thing that changed.
			var barren board.Hex
			for _, h := range board.HexesInRadius(s.Board.Radius) {
				if before[h] {
					barren = h
					break
				}
			}
			tile := s.Board.Tiles[barren]
			tile.Res = tc.res
			s.Board.Tiles[barren] = tile

			if offered()[barren] {
				t.Errorf("%s %v is still offered as a Merchant hex", tc.name, barren)
			}
			_, err := engine.Decide(s.Clone(), engine.Command{Player: p, Type: CmdPlayProgress,
				Data: rawJSON(map[string]any{"card": CardMerchant, "hex": barren})})
			if !errors.Is(err, ErrMerchantTerrain) {
				t.Errorf("playing the Merchant onto %s %v: got %v, want ErrMerchantTerrain", tc.name, barren, err)
			}
		})
	}
}

// TestProgressMedicineTargetsMatchValidator: offered Medicine vertices (own
// settlements) must equal what the validator accepts.
func TestProgressMedicineTargetsMatchValidator(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur
	giveCard(s, p, CardMedicine)
	// Fund exactly the discounted upgrade: affordability is part of the offer, so a
	// broke seat would be offered nothing and the comparison would prove nothing.
	// Deciding against this same state exposes any cost mismatch.
	s.Players[p].Hand.Add(costMedicineCity)

	lt := s.LegalTargetsFor(p)
	offered := map[board.Vertex]bool{}
	for _, v := range lt.ProgressTargets[string(CardMedicine)].Vertices {
		offered[v] = true
	}
	if len(offered) == 0 {
		t.Fatal("no Medicine vertices offered (player should own settlements after setup)")
	}
	for _, v := range allVerts(s) {
		_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: rawJSON(map[string]any{"card": CardMedicine, "v": v})})
		if offered[v] != (err == nil) {
			t.Errorf("medicine vertex %v offered=%v validator=%v (err=%v)", v, offered[v], err == nil, err)
		}
	}
}

// TestProgressMedicineTargetsRespectCost: Medicine offers a target only when
// the seat can pay its discounted upgrade (2 ore + 1 wheat); otherwise the
// client arms a picker the engine then refuses.
func TestProgressMedicineTargetsRespectCost(t *testing.T) {
	cases := []struct {
		name      string
		ore       int
		wheat     int
		wantAffor bool
	}{
		{"no ore", 0, 1, false},
		{"no wheat", 2, 0, false},
		{"exact cost", 2, 1, true},
		{"full city cost", 3, 2, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newGame(t, 3, nil)
			rolled(t, s)
			p := s.Cur
			giveCard(s, p, CardMedicine)
			s.Players[p].Hand = engine.Hand{board.Ore: tc.ore, board.Wheat: tc.wheat}

			verts := s.LegalTargetsFor(p).ProgressTargets[string(CardMedicine)].Vertices
			if got := len(verts) > 0; got != tc.wantAffor {
				t.Errorf("offered %d vertices with %d ore / %d wheat, want any=%v",
					len(verts), tc.ore, tc.wheat, tc.wantAffor)
			}
			// Whatever is offered must actually play.
			for _, v := range verts {
				if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdPlayProgress,
					Data: rawJSON(map[string]any{"card": CardMedicine, "v": v})}); err != nil {
					t.Errorf("offered vertex %v rejected: %v", v, err)
				}
			}
		})
	}
}

// richCard clones s and funds seat so cost never masks a positional rejection.
func richCard(s *engine.State, seat engine.PlayerID) *engine.State {
	rich := s.Clone()
	for r := range rich.Players[seat].Hand {
		rich.Players[seat].Hand[r] = 20
	}
	return rich
}

// allEdgesCardInt enumerates every unique board edge (internal-package helper).
func allEdgesCardInt(s *engine.State) []board.Edge {
	seen := map[board.Edge]bool{}
	var out []board.Edge
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			ne := board.NewEdge(e.A, e.B)
			if !seen[ne] {
				seen[ne] = true
				out = append(out, ne)
			}
		}
	}
	return out
}

// TestProgressBishopTargetsMatchValidator: with the robber unlocked, the
// offered Bishop hexes (land, not the robber's) must equal exactly what the
// play validator accepts.
func TestProgressBishopTargetsMatchValidator(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur
	ext(s).Attacks = 1 // unlock the robber so Bishop is playable
	giveCard(s, p, CardBishop)

	offered := map[board.Hex]bool{}
	for _, h := range s.LegalTargetsFor(p).ProgressTargets[string(CardBishop)].Hexes {
		offered[h] = true
	}
	if len(offered) == 0 {
		t.Fatal("no Bishop hexes offered with the robber unlocked")
	}
	rich := richCard(s, p)
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		_, err := engine.Decide(rich, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: rawJSON(map[string]any{"card": CardBishop, "hex": h})})
		if offered[h] != (err == nil) {
			t.Errorf("bishop hex %v offered=%v validator=%v (err=%v)", h, offered[h], err == nil, err)
		}
	}
}

// TestProgressIntrigueTargetsMatchValidator: plant an enemy knight on the
// player's road network, then assert the offered Intrigue vertices equal exactly
// the vertices the validator accepts.
func TestProgressIntrigueTargetsMatchValidator(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur
	enemy := (p + 1) % engine.PlayerID(len(s.Players))
	giveCard(s, p, CardIntrigue)

	// Find an empty endpoint of one of p's roads and plant an enemy knight there.
	var planted board.Vertex
	found := false
	for e, owner := range s.Roads {
		if owner != p {
			continue
		}
		for _, v := range []board.Vertex{e.A, e.B} {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			if _, hasK := ext(s).Knights[v]; hasK {
				continue
			}
			planted, found = v, true
			break
		}
		if found {
			break
		}
	}
	if !found {
		fixtureGone(t, "no empty endpoint on p's roads this seed")
	}
	ext(s).Knights[planted] = Knight{Owner: enemy, Level: 1}

	offered := map[board.Vertex]bool{}
	for _, v := range s.LegalTargetsFor(p).ProgressTargets[string(CardIntrigue)].Vertices {
		offered[v] = true
	}
	if !offered[planted] {
		t.Fatalf("planted enemy knight at %v on p's road not offered for Intrigue", planted)
	}
	rich := richCard(s, p)
	for _, v := range allVerts(s) {
		_, err := engine.Decide(rich, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: rawJSON(map[string]any{"card": CardIntrigue, "v": v})})
		if offered[v] != (err == nil) {
			t.Errorf("intrigue vertex %v offered=%v validator=%v (err=%v)", v, offered[v], err == nil, err)
		}
	}
}

// TestProgressDiplomatTargetsMatchValidator: the offered Diplomat source edges
// (any open-ended road) must equal exactly what the validator accepts as a
// source, and every offered relocation destination for the player's own roads
// must be accepted.
func TestProgressDiplomatTargetsMatchValidator(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur
	giveCard(s, p, CardDiplomat)

	pt := s.LegalTargetsFor(p).ProgressTargets[string(CardDiplomat)]
	offered := map[board.Edge]bool{}
	for _, e := range pt.Edges {
		offered[e] = true
	}
	if len(offered) == 0 {
		t.Fatal("no Diplomat source roads offered (roads exist after setup)")
	}
	rich := richCard(s, p)
	// Sources: offered ⟺ validator accepts a source-only Diplomat play.
	for _, e := range allEdgesCardInt(s) {
		_, err := engine.Decide(rich, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: rawJSON(map[string]any{"card": CardDiplomat, "e": e})})
		if offered[e] != (err == nil) {
			t.Errorf("diplomat source %v offered=%v validator=%v (err=%v)", e, offered[e], err == nil, err)
		}
	}
	// Destinations: every offered relocation target for an own road is accepted.
	for _, grp := range pt.Moves {
		for _, to := range grp.To {
			_, err := engine.Decide(rich, engine.Command{Player: p, Type: CmdPlayProgress,
				Data: rawJSON(map[string]any{"card": CardDiplomat, "e": grp.From, "to": to})})
			if err != nil {
				t.Errorf("diplomat relocation %v->%v offered but rejected: %v", grp.From, to, err)
			}
		}
	}
}

// TestProgressInventorTargets: every offered Inventor hex is numbered and not a
// fixed (2/6/8/12) token, and every such hex is offered.
func TestProgressInventorTargets(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur
	giveCard(s, p, CardInventor)

	offered := map[board.Hex]bool{}
	for _, h := range s.LegalTargetsFor(p).ProgressTargets[string(CardInventor)].Hexes {
		offered[h] = true
	}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		t2, ok := s.Board.Tiles[h]
		eligible := ok && t2.Number != 0 && t2.Number != 2 && t2.Number != 6 && t2.Number != 8 && t2.Number != 12
		if offered[h] != eligible {
			t.Errorf("inventor hex %v num=%d offered=%v eligible=%v", h, t2.Number, offered[h], eligible)
		}
	}
}
