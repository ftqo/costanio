package knights

import (
	"errors"
	"maps"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestProgressCardWithNoEffectIsRefused pins the no-op ruling
// (docs/rules/knights.md, "Two things you may not do with a card"): a progress
// card that public information shows would do nothing is refused with
// ErrCardNoEffect and stays in hand. Each case pairs the dead state with the
// smallest change that gives the card something to do, and that twin must be
// accepted.
//
// The monopolies are refused only when no opponent holds any card of that kind
// (a public count). An opponent holding cards but none of the named one is
// hidden information, so that play goes through and does nothing.
func TestProgressCardWithNoEffectIsRefused(t *testing.T) {
	// others runs f over every seat but p.
	others := func(s *engine.State, p engine.PlayerID, f func(q engine.PlayerID)) {
		for q := range s.Players {
			if engine.PlayerID(q) != p {
				f(engine.PlayerID(q))
			}
		}
	}
	emptyHands := func(s *engine.State, p engine.PlayerID) {
		x := ext(s)
		others(s, p, func(q engine.PlayerID) {
			s.Players[q].Hand = engine.Hand{}
			x.Players[q].Commodities = CommodityHand{}
		})
	}
	next := func(s *engine.State, p engine.PlayerID) engine.PlayerID {
		return (p + 1) % engine.PlayerID(len(s.Players))
	}

	cases := []struct {
		name string
		card ProgressCard
		args func(s *engine.State, p engine.PlayerID) map[string]any
		dead func(s *engine.State, p engine.PlayerID) // leaves the card nothing to do
		live func(s *engine.State, p engine.PlayerID) // applied on top of dead: now it does something
		// wantErr is the refusal when the card's own requirement names the dead state
		// more precisely (no city, no wall left, no road piece). nil means
		// ErrCardNoEffect.
		wantErr error
		// sea plays the case on a base+islands+cak board.
		sea bool
	}{
		{
			name:    "engineer with no city",
			card:    CardEngineer,
			wantErr: ErrNeedCity,
			dead: func(s *engine.State, p engine.PlayerID) {
				for v, b := range s.Buildings {
					if b.Owner == p && b.City {
						s.Buildings[v] = engine.Building{Owner: p}
					}
				}
			},
			live: func(s *engine.State, p engine.PlayerID) { makeCity(s, p) },
		},
		{
			name:    "engineer with every city walled",
			card:    CardEngineer,
			wantErr: ErrMaxWalls,
			dead: func(s *engine.State, p engine.PlayerID) {
				x := ext(s)
				for v, b := range s.Buildings {
					if b.Owner == p && b.City {
						x.Walled[v] = true
						x.Players[p].Walls++
					}
				}
			},
			live: func(s *engine.State, p engine.PlayerID) { makeCity(s, p) },
		},
		{
			name:    "engineer with the wall supply spent",
			card:    CardEngineer,
			wantErr: ErrMaxWalls,
			dead:    func(s *engine.State, p engine.PlayerID) { ext(s).Players[p].Walls = 3 },
			live:    func(s *engine.State, p engine.PlayerID) { ext(s).Players[p].Walls = 2 },
		},
		{
			name: "smith with no knight",
			card: CardSmith,
			dead: func(s *engine.State, p engine.PlayerID) {},
			live: func(s *engine.State, p engine.PlayerID) {
				ext(s).Knights[knightSpotFor(t, s, p)] = Knight{Owner: p, Level: 1}
			},
		},
		{
			name: "smith with only a mighty knight",
			card: CardSmith,
			dead: func(s *engine.State, p engine.PlayerID) {
				ext(s).Knights[knightSpotFor(t, s, p)] = Knight{Owner: p, Level: 3}
			},
			live: func(s *engine.State, p engine.PlayerID) {
				ext(s).Knights[knightSpotFor(t, s, p)] = Knight{Owner: p, Level: 1}
			},
		},
		{
			name: "smith with a strong knight and no politics level 3",
			card: CardSmith,
			dead: func(s *engine.State, p engine.PlayerID) {
				ext(s).Knights[knightSpotFor(t, s, p)] = Knight{Owner: p, Level: 2}
			},
			live: func(s *engine.State, p engine.PlayerID) { ext(s).Players[p].Improve[Politics] = 3 },
		},
		{
			name: "smith with the next tier full",
			card: CardSmith,
			dead: func(s *engine.State, p engine.PlayerID) {
				x := ext(s)
				x.Knights[knightSpotFor(t, s, p)] = Knight{Owner: p, Level: 1}
				x.Knights[offNetworkVertex(t, s, p)] = Knight{Owner: p, Level: 2}
				x.Knights[offNetworkVertex(t, s, p)] = Knight{Owner: p, Level: 2}
			},
			live: func(s *engine.State, p engine.PlayerID) {
				x := ext(s)
				for v, k := range x.Knights {
					if k.Owner == p && k.Level == 2 {
						delete(x.Knights, v)
						return
					}
				}
			},
		},
		{
			name: "road building with no edge to build on",
			card: CardRoadBuilding,
			dead: func(s *engine.State, p engine.PlayerID) { fenceIn(s, p) },
			live: func(s *engine.State, p engine.PlayerID) { unfenceOne(t, s, p) },
		},
		{
			name:    "road building with no road piece",
			card:    CardRoadBuilding,
			wantErr: engine.ErrNoPieces,
			dead:    func(s *engine.State, p engine.PlayerID) { s.Players[p].RoadsLeft = 0 },
			live:    func(s *engine.State, p engine.PlayerID) { s.Players[p].RoadsLeft = 1 },
		},
		{
			// With Islands a free build may be a ship, so no road piece left is not a dead
			// card while a ship can still be placed.
			name:    "road building at sea with no road piece and no ship piece",
			card:    CardRoadBuilding,
			sea:     true,
			wantErr: engine.ErrNoPieces,
			dead: func(s *engine.State, p engine.PlayerID) {
				s.Players[p].RoadsLeft = 0
				islandsExt(t, s).ShipsLeft[p] = 0
			},
			live: func(s *engine.State, p engine.PlayerID) { islandsExt(t, s).ShipsLeft[p] = 2 },
		},
		{
			name: "master merchant on an empty hand",
			card: CardMasterMerchant,
			args: func(s *engine.State, p engine.PlayerID) map[string]any {
				return map[string]any{"victim": next(s, p)}
			},
			dead: func(s *engine.State, p engine.PlayerID) {
				makeCity(s, next(s, p)) // ahead of p, so a legal victim
				emptyHands(s, p)
			},
			live: func(s *engine.State, p engine.PlayerID) {
				s.Players[next(s, p)].Hand = engine.Hand{board.Wood: 1}
			},
		},
		{
			name: "commercial harbor with no commodity to take",
			card: CardCommercialHarbor,
			dead: func(s *engine.State, p engine.PlayerID) {
				s.Players[p].Hand = engine.Hand{board.Wheat: 2}
				emptyHands(s, p)
			},
			live: func(s *engine.State, p engine.PlayerID) {
				ext(s).Players[next(s, p)].Commodities = CommodityHand{Cloth: 1}
			},
		},
		{
			name: "commercial harbor with no resource to offer",
			card: CardCommercialHarbor,
			dead: func(s *engine.State, p engine.PlayerID) {
				s.Players[p].Hand = engine.Hand{}
				ext(s).Players[next(s, p)].Commodities = CommodityHand{Cloth: 1}
			},
			live: func(s *engine.State, p engine.PlayerID) {
				s.Players[p].Hand = engine.Hand{board.Wheat: 1}
			},
		},
		{
			name: "saboteur with nobody level or ahead",
			card: CardSaboteur,
			dead: func(s *engine.State, p engine.PlayerID) {
				makeCity(s, p) // p now strictly ahead of every seat
				others(s, p, func(q engine.PlayerID) { s.Players[q].Hand = engine.Hand{board.Ore: 6} })
			},
			live: func(s *engine.State, p engine.PlayerID) {
				makeCity(s, next(s, p)) // level with p
			},
		},
		{
			name: "saboteur on hands too small to halve",
			card: CardSaboteur,
			dead: func(s *engine.State, p engine.PlayerID) {
				emptyHands(s, p) // everyone level at the start, but nothing to discard
				others(s, p, func(q engine.PlayerID) { s.Players[q].Hand = engine.Hand{board.Ore: 1} })
			},
			live: func(s *engine.State, p engine.PlayerID) {
				s.Players[next(s, p)].Hand = engine.Hand{board.Ore: 2}
			},
		},
		{
			name: "wedding with nobody ahead",
			card: CardWedding,
			dead: func(s *engine.State, p engine.PlayerID) {
				others(s, p, func(q engine.PlayerID) { s.Players[q].Hand = engine.Hand{board.Ore: 3} })
			},
			live: func(s *engine.State, p engine.PlayerID) {
				makeCity(s, next(s, p))
			},
		},
		{
			name: "wedding on an empty hand",
			card: CardWedding,
			dead: func(s *engine.State, p engine.PlayerID) {
				makeCity(s, next(s, p))
				emptyHands(s, p)
			},
			live: func(s *engine.State, p engine.PlayerID) {
				ext(s).Players[next(s, p)].Commodities = CommodityHand{Coin: 1}
			},
		},
		{
			name: "irrigation with the grain supply empty",
			card: CardIrrigation,
			dead: func(s *engine.State, p engine.PlayerID) {
				plantOn(t, s, p, board.Wheat)
				s.Bank[board.Wheat] = 0
			},
			live: func(s *engine.State, p engine.PlayerID) { s.Bank[board.Wheat] = 5 },
		},
		{
			name: "mining with no mountains",
			card: CardMining,
			dead: func(s *engine.State, p engine.PlayerID) {
				stripTerrain(s, p, board.Ore)
				s.Bank[board.Ore] = 19
			},
			live: func(s *engine.State, p engine.PlayerID) { plantOn(t, s, p, board.Ore) },
		},
		{
			name: "warlord with every knight already awake",
			card: CardWarlord,
			dead: func(s *engine.State, p engine.PlayerID) {
				ext(s).Knights[knightSpotFor(t, s, p)] = Knight{Owner: p, Level: 1, Active: true}
			},
			live: func(s *engine.State, p engine.PlayerID) {
				ext(s).Knights[knightSpotFor(t, s, p)] = Knight{Owner: p, Level: 1}
			},
		},
		{
			name: "resource monopoly with every opponent holding no resource",
			card: CardResourceMonopoly,
			args: func(*engine.State, engine.PlayerID) map[string]any {
				return map[string]any{"res": board.Sheep}
			},
			dead: func(s *engine.State, p engine.PlayerID) { emptyHands(s, p) },
			// Holding cards, just not wool: the hidden-information case. Accepted, and
			// takes nothing.
			live: func(s *engine.State, p engine.PlayerID) {
				s.Players[next(s, p)].Hand = engine.Hand{board.Ore: 1}
			},
		},
		{
			name: "trade monopoly with every opponent holding no commodity",
			card: CardTradeMonopoly,
			args: func(*engine.State, engine.PlayerID) map[string]any {
				return map[string]any{"com": Paper}
			},
			dead: func(s *engine.State, p engine.PlayerID) { emptyHands(s, p) },
			live: func(s *engine.State, p engine.PlayerID) {
				ext(s).Players[next(s, p)].Commodities = CommodityHand{Cloth: 1}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var s *engine.State
			if tc.sea {
				// A board where, after the roll, the current seat can place a ship. Rolling a
				// clone is deterministic, so the real roll lands the same way.
				s = seaGame(t, func(s *engine.State) bool {
					c := s.Clone()
					rolled(t, c)
					return len(islandsLegalShips(c, c.Cur)) > 0
				})
			} else {
				s, _ = newGame(t, 5, nil)
			}
			rolled(t, s)
			p := s.Cur
			x := ext(s)
			x.Players[p].Progress = []ProgressCard{tc.card}
			tc.dead(s, p)
			data := map[string]any{"card": tc.card}
			if tc.args != nil {
				maps.Copy(data, tc.args(s, p))
			}
			cmd := engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, data)}

			want := tc.wantErr
			if want == nil {
				want = ErrCardNoEffect
			}
			_, err := engine.Decide(s.Clone(), cmd)
			if !errors.Is(err, want) {
				t.Fatalf("dead play: err = %v, want %v", err, want)
			}
			if errors.Is(want, ErrCardNoEffect) {
				if code := engine.ErrorCode(err); code != "CARD_NO_EFFECT" {
					t.Errorf("dead play: code = %q, want CARD_NO_EFFECT", code)
				}
			}
			if !holdsCard(extRO(s).Players[p].Progress, tc.card) {
				t.Fatal("a refused play must leave the card in the hand")
			}

			tc.live(s, p)
			if _, err := engine.Decide(s.Clone(), cmd); err != nil {
				t.Fatalf("live play refused: %v", err)
			}
		})
	}
}

// plantOn puts a settlement of p's on an empty vertex of some hex of the given
// terrain, so a harvest card has a hex to count.
func plantOn(t *testing.T, s *engine.State, p engine.PlayerID, terrain board.Resource) {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if tile, ok := s.Board.Tiles[h]; !ok || tile.Res != terrain {
			continue
		}
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; !taken {
				s.Buildings[v] = engine.Building{Owner: p}
				return
			}
		}
	}
	t.Fatalf("no empty vertex on any %v hex", terrain)
}

// stripTerrain removes every building of p's that touches the given terrain.
func stripTerrain(s *engine.State, p engine.PlayerID, terrain board.Resource) {
	for v, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		for _, h := range v.Hexes() {
			if tile, ok := s.Board.Tiles[h]; ok && tile.Res == terrain {
				delete(s.Buildings, v)
				break
			}
		}
	}
}

// TestIrrigationPaysEachHexOnce: Irrigation and Mining pay 2 for each distinct
// fields/mountains hex any of your buildings borders, so a hex two buildings
// share pays once and a city does not double it.
func TestIrrigationPaysEachHexOnce(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	for v, b := range s.Buildings {
		if b.Owner == p {
			delete(s.Buildings, v)
		}
	}
	var field board.Hex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if tile, ok := s.Board.Tiles[h]; ok && tile.Res == board.Wheat {
			vs := h.Vertices()
			_, a := s.Buildings[vs[0]]
			_, b := s.Buildings[vs[3]]
			if !a && !b {
				field, found = h, true
				break
			}
		}
	}
	if !found {
		t.Fatal("no fields hex with two free opposite corners")
	}
	vs := field.Vertices()
	s.Buildings[vs[0]] = engine.Building{Owner: p}
	s.Buildings[vs[3]] = engine.Building{Owner: p, City: true}
	s.Bank[board.Wheat] = 19

	distinct := map[board.Hex]bool{}
	perBuilding := 0
	for _, v := range []board.Vertex{vs[0], vs[3]} {
		for _, h := range v.Hexes() {
			if tile, ok := s.Board.Tiles[h]; ok && tile.Res == board.Wheat {
				distinct[h] = true
				perBuilding++
			}
		}
	}
	if perBuilding <= len(distinct) {
		t.Fatal("the two buildings share no fields hex; fixture is wrong")
	}

	x.Players[p].Progress = []ProgressCard{CardIrrigation}
	before := s.Players[p].Hand[board.Wheat]
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardIrrigation})})
	if got, want := s.Players[p].Hand[board.Wheat]-before, 2*len(distinct); got != want {
		t.Fatalf("harvested %d wheat, want %d (2 per distinct fields hex; per-building would be %d)",
			got, want, 2*perBuilding)
	}
}

// fenceIn gives another seat a road on every empty land edge, so p holds road
// pieces and has nowhere to put one.
func fenceIn(s *engine.State, p engine.PlayerID) {
	q := (p + 1) % engine.PlayerID(len(s.Players))
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if _, taken := s.Roads[e]; !taken && e.Valid() && s.Board.LandEdge(e) {
				s.Roads[e] = q
			}
		}
	}
	if len(s.LegalRoads(p)) != 0 {
		panic("fenceIn left a legal road")
	}
}

// unfenceOne frees one fence edge touching p's network, so a road fits again.
func unfenceOne(t *testing.T, s *engine.State, p engine.PlayerID) {
	t.Helper()
	for v, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		for _, e := range v.Edges() {
			if owner, ok := s.Roads[e]; ok && owner != p {
				delete(s.Roads, e)
				if len(s.LegalRoads(p)) > 0 {
					return
				}
				s.Roads[e] = owner
			}
		}
	}
	t.Fatal("no fence edge next to p's buildings")
}

// islandsLegalShips is the ship-build offer the engine publishes for seat.
func islandsLegalShips(s *engine.State, seat engine.PlayerID) []board.Edge {
	return s.LegalTargetsFor(seat).Ships
}
