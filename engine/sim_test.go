package engine

import (
	"encoding/json"
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

func assertStatesEqual(t *testing.T, live, replayed *State) {
	t.Helper()
	if !reflect.DeepEqual(live, replayed) {
		t.Errorf("replay diverged from live state:\nlive:     %+v\nreplayed: %+v", live, replayed)
	}
}

// TestRandomPlayouts drives many random legal games and asserts global
// invariants plus replay determinism.
func TestRandomPlayouts(t *testing.T) {
	const games = 30
	for seed := range uint64(games) {
		simulateGame(t, seed)
	}
}

func simulateGame(t *testing.T, seed uint64) {
	players := 3 + int(seed%2)
	log, err := New(GameConfig{Players: players}, SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := Empty()
	for _, e := range log {
		if err := Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	rng := rand.New(rand.NewPCG(seed, 777))

	apply := func(cmd Command) bool {
		events, err := Decide(s, cmd)
		if err != nil {
			return false
		}
		for _, e := range events {
			if err := Apply(s, e); err != nil {
				t.Fatalf("seed %d: apply %s: %v", seed, e.Type, err)
			}
		}
		log = append(log, events...)
		return true
	}

	for step := 0; s.Phase != PhaseFinished && step < 4000; step++ {
		if !advanceRandomly(t, s, rng, apply) {
			t.Fatalf("seed %d: stuck at step %d (phase %s cur %d rolled %v robber %v discards %v)",
				seed, step, s.Phase, s.Cur, s.Rolled, s.RobberPending, s.PendingDiscards)
		}
		checkInvariants(t, s, seed)
	}

	replayed, err := Replay(log)
	if err != nil {
		t.Fatalf("seed %d: replay: %v", seed, err)
	}
	assertStatesEqual(t, s, replayed)

	if s.Phase == PhaseFinished && s.VP(s.Winner) < s.Config.TargetVP {
		t.Errorf("seed %d: winner has %d VP < target %d", seed, s.VP(s.Winner), s.Config.TargetVP)
	}
}

func checkInvariants(t *testing.T, s *State, seed uint64) {
	t.Helper()
	total := s.Bank.Count()
	for p := range s.Players {
		if !s.Players[p].Hand.NonNegative() {
			t.Fatalf("seed %d: player %d negative hand %v", seed, p, s.Players[p].Hand)
		}
		total += s.Players[p].Hand.Count()
	}
	if total != 19*5 {
		t.Fatalf("seed %d: cards not conserved: %d", seed, total)
	}
	// Dev cards: the sim only ever plays knights, so deck + held + knights
	// played must stay 25.
	dev := s.DevDeck.Count()
	for p := range s.Players {
		dev += s.Players[p].DevCards.Count() + s.Players[p].NewDevCards.Count() + s.Players[p].KnightsPlayed
	}
	if dev != 25 {
		t.Fatalf("seed %d: dev cards not conserved: %d", seed, dev)
	}
	if !s.Bank.NonNegative() {
		t.Fatalf("seed %d: negative bank %v", seed, s.Bank)
	}
	for p := range s.Players {
		ps := s.Players[p]
		if ps.RoadsLeft < 0 || ps.SettlementsLeft < 0 || ps.CitiesLeft < 0 {
			t.Fatalf("seed %d: player %d negative pieces %+v", seed, p, ps)
		}
	}
}

func advanceRandomly(t *testing.T, s *State, rng *rand.Rand, apply func(Command) bool) bool {
	raw := func(v any) json.RawMessage {
		b, _ := json.Marshal(v)
		return b
	}

	switch {
	case s.Phase == PhaseSetup:
		if s.NeedRoad {
			edges := freeEdgesTouching(s, s.LastSettlement)
			e := edges[rng.IntN(len(edges))]
			return apply(Command{Player: s.Cur, Type: CmdPlaceRoad, Data: raw(map[string]any{"e": e})})
		}
		spots := legalSettlementSpots(s)
		v := spots[rng.IntN(len(spots))]
		return apply(Command{Player: s.Cur, Type: CmdPlaceSettlement, Data: raw(map[string]any{"v": v})})

	case len(s.PendingDiscards) > 0:
		for p, n := range s.PendingDiscards {
			cards := pickDiscard(s.Players[p].Hand, n)
			return apply(Command{Player: p, Type: CmdDiscardCards, Data: raw(map[string]any{"cards": cards})})
		}

	case s.RobberPending:
		hexes := board.HexesInRadius(s.Board.Radius)
		for _, i := range rng.Perm(len(hexes)) {
			h := hexes[i]
			if h == s.Board.Robber {
				continue
			}
			victims := robberVictims(s, h, s.Cur)
			payload := map[string]any{"hex": h}
			for v := range victims {
				payload["victim"] = v
				break
			}
			return apply(Command{Player: s.Cur, Type: CmdMoveRobber, Data: raw(payload)})
		}
		return false

	case !s.Rolled:
		return apply(Command{Player: s.Cur, Type: CmdRollDice})

	default:
		// Mix in dev cards, bank trades, and builds; otherwise end the turn.
		roll := rng.IntN(100)
		switch {
		case roll < 10 && s.Players[s.Cur].DevCards[DevKnight] > 0 && !s.PlayedDevThisTurn:
			return apply(Command{Player: s.Cur, Type: CmdPlayDevCard, Data: raw(map[string]any{"card": DevKnight})})
		case roll < 25 && s.Players[s.Cur].Hand.Has(CostDevCard) && s.DevDeck.Count() > 0:
			return apply(Command{Player: s.Cur, Type: CmdBuyDevCard})
		case roll < 35:
			// Bank-trade a surplus resource toward ore.
			for r := range s.Players[s.Cur].Hand {
				res := board.Resource(r)
				if res != board.Ore && validResource(res) && s.Players[s.Cur].Hand[r] >= 4 && s.Bank[board.Ore] > 0 {
					return apply(Command{Player: s.Cur, Type: CmdBankTrade,
						Data: raw(map[string]any{"give": res, "get": board.Ore})})
				}
			}
			fallthrough
		case roll < 85:
			if tryRandomBuild(s, rng, apply, raw) {
				return true
			}
		}
		return apply(Command{Player: s.Cur, Type: CmdEndTurn})
	}
	return false
}

func tryRandomBuild(s *State, rng *rand.Rand, apply func(Command) bool, raw func(any) json.RawMessage) bool {
	p := s.Cur
	choices := rng.Perm(3)
	for _, c := range choices {
		switch c {
		case 0: // city
			if !s.Players[p].Hand.Has(CostCity) {
				continue
			}
			for v, b := range s.Buildings {
				if b.Owner == p && !b.City {
					return apply(Command{Player: p, Type: CmdBuildCity, Data: raw(map[string]any{"v": v})})
				}
			}
		case 1: // settlement
			if !s.Players[p].Hand.Has(CostSettlement) {
				continue
			}
			for _, v := range legalSettlementSpots(s) {
				if s.hasAdjacentRoad(v, p) {
					return apply(Command{Player: p, Type: CmdBuildSettlement, Data: raw(map[string]any{"v": v})})
				}
			}
		case 2: // road
			if !s.Players[p].Hand.Has(CostRoad) {
				continue
			}
			for e, owner := range s.Roads {
				if owner != p {
					continue
				}
				for _, v := range []board.Vertex{e.A, e.B} {
					for _, ne := range v.Edges() {
						if _, taken := s.Roads[ne]; taken || !s.Board.LandEdge(ne) || !s.roadConnects(ne, p) {
							continue
						}
						return apply(Command{Player: p, Type: CmdBuildRoad, Data: raw(map[string]any{"e": ne})})
					}
				}
			}
		}
	}
	return false
}

func legalSettlementSpots(s *State) []board.Vertex {
	var out []board.Vertex
	seen := map[board.Vertex]bool{}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !seen[v] && checkSettlementSpot(s, v) == nil {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	return out
}

func freeEdgesTouching(s *State, v board.Vertex) []board.Edge {
	var out []board.Edge
	for _, e := range v.Edges() {
		if _, taken := s.Roads[e]; !taken && s.Board.LandEdge(e) {
			out = append(out, e)
		}
	}
	return out
}

// pickDiscard takes n cards from the hand, spread across resources.
func pickDiscard(h Hand, n int) Hand {
	var out Hand
	for n > 0 {
		took := false
		for r := range h {
			if h[r] > out[r] && n > 0 {
				out[r]++
				n--
				took = true
			}
		}
		if !took {
			break
		}
	}
	return out
}
