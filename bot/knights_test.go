package bot

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// freeVertex returns a board vertex not present in skip (and adds it).
func freeVertex(s *engine.State, skip map[board.Vertex]bool) board.Vertex {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !skip[v] {
				skip[v] = true
				return v
			}
		}
	}
	panic("no free vertex")
}

// commodityVertex returns a vertex of a hex whose terrain yields a commodity.
func commodityVertex(s *engine.State) board.Vertex {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if tl, ok := s.Board.Tiles[h]; ok && tl.Res.Producing() {
			if _, isCom := knights.CommodityFor(tl.Res); isCom {
				return h.Vertices()[0]
			}
		}
	}
	panic("no commodity hex on board")
}

// newKnightsGame builds a base+cak game and folds the New() log into a live state,
// mirroring newBaseGame but with the Knights module active.
func newKnightsGame(t *testing.T, seed uint64) *engine.State {
	t.Helper()
	events, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base+cak"}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

// knightsExtOf returns the live Knights extension, creating an empty one if the setup
// log never touched module state yet (no city built → no commodity event).
func knightsExtOf(t *testing.T, s *engine.State) *knights.Ext {
	t.Helper()
	if x, ok := s.Ext[knights.Name].(*knights.Ext); ok {
		return x
	}
	x := &knights.Ext{
		Players: make([]knights.PlayerExt, len(s.Players)),
		Knights: map[board.Vertex]knights.Knight{},
		Walled:  map[board.Vertex]bool{},
		// Mirror freshExt's NoPlayer sentinels: a zero-value PlayerID would read
		// as "player 0 has a pending Spy/Wedding/Harbor", blocking every action.
		MerchantOwner:  engine.NoPlayer,
		WeddingTo:      engine.NoPlayer,
		HarborTaker:    engine.NoPlayer,
		SpyThief:       engine.NoPlayer,
		SpyVictim:      engine.NoPlayer,
		MMThief:        engine.NoPlayer,
		MMVictim:       engine.NoPlayer,
		DeserterVictim: engine.NoPlayer,
		DeserterTaker:  engine.NoPlayer,
		RelocPlayer:    engine.NoPlayer,
	}
	s.Ext[knights.Name] = x
	return x
}

// TestEvalCountsKnightsVP: the bot must value Knights victory points (metropolis,
// defender, merchant, Constitution/Printer), which flow through the module
// VictoryCheck hook rather than the base PublicVP.
func TestEvalCountsKnightsVP(t *testing.T) {
	s := newKnightsGame(t, 5)
	s.Phase = engine.PhasePlay
	b := NewStrong()

	before := b.selfScore(s, 0, 0)
	x := knightsExtOf(t, s)
	x.Players[0].Metropolis[knights.Trade] = true // +2 public VP via VictoryCheck
	after := b.selfScore(s, 0, 0)

	if !(after > before) {
		t.Errorf("selfScore ignored a metropolis (+2 VP): before=%.2f after=%.2f", before, after)
	}
}

func TestKnightsEvalValuesImprovements(t *testing.T) {
	s := newKnightsGame(t, 7)
	s.Phase = engine.PhasePlay
	b := NewStrong()
	x := knightsExtOf(t, s)

	before := b.knightsEval(s, 0, 0)
	x.Players[0].Improve[knights.Trade] = 2
	after := b.knightsEval(s, 0, 0)
	if !(after > before) {
		t.Errorf("a city improvement did not raise knightsEval: %.2f -> %.2f", before, after)
	}
}

func TestKnightsEvalValuesCommodityCities(t *testing.T) {
	s := newKnightsGame(t, 7)
	s.Phase = engine.PhasePlay
	b := NewStrong()
	_ = knightsExtOf(t, s)

	before := b.knightsEval(s, 0, 0)
	s.Buildings[commodityVertex(s)] = engine.Building{Owner: 0, City: true}
	after := b.knightsEval(s, 0, 0)
	if !(after > before) {
		t.Errorf("a commodity-producing city did not raise knightsEval: %.2f -> %.2f", before, after)
	}
}

// TestKnightsEvalPenalizesWeakDefender pins the main barbarian signal: with an
// undefended downgradable city, the eval must fall as the fleet nears landfall
// (the player is the one who will lose a city), and recover once a strong active
// knight makes the defense hold.
func TestKnightsEvalPenalizesWeakDefender(t *testing.T) {
	s := newKnightsGame(t, 9)
	s.Phase = engine.PhasePlay
	b := NewStrong()
	x := knightsExtOf(t, s)

	used := map[board.Vertex]bool{}
	city := freeVertex(s, used)
	s.Buildings[city] = engine.Building{Owner: 0, City: true} // downgradable, undefended

	x.Barbarians = 0
	far := b.knightsEval(s, 0, 0)
	x.Barbarians = knights.BarbarianTrack - 1 // landfall imminent
	near := b.knightsEval(s, 0, 0)
	if !(near < far) {
		t.Errorf("imminent attack on an undefended city did not lower eval: far=%.2f near=%.2f", far, near)
	}

	// An active mighty knight (level 3 >= 1 city) makes the defense hold.
	knight := freeVertex(s, used)
	x.Knights[knight] = knights.Knight{Owner: 0, Level: 3, Active: true}
	defended := b.knightsEval(s, 0, 0)
	if !(defended > near) {
		t.Errorf("activating a defending knight did not raise eval: under-attack=%.2f defended=%.2f", near, defended)
	}
}

func TestKnightsBotImprovesCity(t *testing.T) {
	s := newKnightsGame(t, 11)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	b := NewStrong()
	x := knightsExtOf(t, s)

	// Seat 0 holds a city and exactly enough cloth to advance Trade to level 1,
	// and no resources, so a city improvement is the only profitable action.
	s.Buildings[commodityVertex(s)] = engine.Building{Owner: 0, City: true}
	x.Players[0].Commodities[knights.Cloth] = knights.ImproveCost(0)

	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != knights.CmdImproveCity {
		t.Fatalf("expected a city improvement, got %+v ok=%v", cmd, ok)
	}
}

// TestKnightsBotActivatesKnightUnderAttack proves the defense signal drives a real
// command: with an undefended downgradable city and the fleet about to land,
// activating an idle knight (which makes the defense hold) is the chosen move.
func TestKnightsBotActivatesKnightUnderAttack(t *testing.T) {
	s := newKnightsGame(t, 13)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	b := NewStrong()
	x := knightsExtOf(t, s)

	used := map[board.Vertex]bool{}
	s.Buildings[freeVertex(s, used)] = engine.Building{Owner: 0, City: true}
	kv := freeVertex(s, used)
	x.Knights[kv] = knights.Knight{Owner: 0, Level: 2, Active: false}
	x.Barbarians = knights.BarbarianTrack - 1 // landfall imminent; defense currently failing
	s.Players[0].Hand[board.Wheat] = 1        // activation cost

	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != knights.CmdActivateKnight {
		t.Fatalf("expected knight activation under imminent attack, got %+v ok=%v", cmd, ok)
	}
}

func TestKnightsChooseDiscardMatchesRequirement(t *testing.T) {
	s := newKnightsGame(t, 17)
	b := NewStrong()
	x := knightsExtOf(t, s)
	// 5 resources + 4 commodities = 9 cards → a 7 forces shedding 4.
	s.Players[0].Hand = engine.Hand{}
	s.Players[0].Hand[board.Wood] = 2
	s.Players[0].Hand[board.Brick] = 2
	s.Players[0].Hand[board.Ore] = 1
	x.Players[0].Commodities[knights.Cloth] = 2
	x.Players[0].Commodities[knights.Coin] = 2

	cards, coms := b.knightsChooseDiscard(s, 0, 4)
	if got := cards.Count() + coms.Count(); got != 4 {
		t.Fatalf("discard total = %d, want 4", got)
	}
	if !s.Players[0].Hand.Has(cards) {
		t.Errorf("chose resources not held: %v", cards)
	}
	if !x.Players[0].Commodities.Has(coms) {
		t.Errorf("chose commodities not held: %v", coms)
	}
}

func TestKnightsBotPlaysMerchantForVP(t *testing.T) {
	s := newKnightsGame(t, 23)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	b := NewStrong()
	x := knightsExtOf(t, s)

	// Own a building (so the merchant has a legal hex) and hold the Merchant card.
	s.Buildings[commodityVertex(s)] = engine.Building{Owner: 0}
	x.Players[0].Progress = []knights.ProgressCard{knights.CardMerchant}

	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != knights.CmdPlayProgress {
		t.Fatalf("expected the bot to play Merchant for its VP, got %+v ok=%v", cmd, ok)
	}
}

// TestKnightsBotPlaysWarlordToDefend proves a free defensive card is played when it
// turns a losing barbarian defense into a winning one.
func TestKnightsBotPlaysWarlordToDefend(t *testing.T) {
	s := newKnightsGame(t, 27)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	b := NewStrong()
	x := knightsExtOf(t, s)

	used := map[board.Vertex]bool{}
	s.Buildings[freeVertex(s, used)] = engine.Building{Owner: 0, City: true}
	x.Knights[freeVertex(s, used)] = knights.Knight{Owner: 0, Level: 2, Active: false}
	x.Barbarians = knights.BarbarianTrack - 1 // imminent; undefended
	x.Players[0].Progress = []knights.ProgressCard{knights.CardWarlord}

	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != knights.CmdPlayProgress {
		t.Fatalf("expected the bot to play Warlord to defend, got %+v ok=%v", cmd, ok)
	}
}

// TestKnightsBotChasesRobber proves the bot uses an adjacent active knight to drive
// the robber off and steal, rather than leaving the verb unused.
func TestKnightsBotChasesRobber(t *testing.T) {
	s := newKnightsGame(t, 31)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	b := NewStrong()
	x := knightsExtOf(t, s)
	x.Attacks = 1 // robber is only in play (chaseable) after the first barbarian attack

	// Two distinct producing land hexes: one hosts the robber + our knight, the
	// other an opponent with cards to steal.
	var hexes []board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if t2, ok := s.Board.Tiles[h]; ok && t2.Res.Producing() {
			hexes = append(hexes, h)
		}
		if len(hexes) >= 2 {
			break
		}
	}
	robberHex, oppHex := hexes[0], hexes[1]
	s.Board.Robber = robberHex
	x.Knights[robberHex.Vertices()[0]] = knights.Knight{Owner: 0, Level: 1, Active: true}
	s.Buildings[oppHex.Vertices()[0]] = engine.Building{Owner: 1}
	s.Players[1].Hand[board.Ore] = 3

	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != knights.CmdChaseRobber {
		t.Fatalf("expected the bot to chase the robber with its knight, got %+v ok=%v", cmd, ok)
	}
}

// TestKnightsBotAnswersMetropolisPick: an earned-but-unplaced metropolis blocks the
// seat's whole turn, so both bots must answer it. Strong answers with its own
// policy (the most valuable city, which the metropolis then makes
// pillage-immune); Simple falls through to the engine's auto command. Either
// way the pick must be one the engine accepts.
func TestKnightsBotAnswersMetropolisPick(t *testing.T) {
	build := func(t *testing.T) (*engine.State, board.Vertex) {
		t.Helper()
		s := newKnightsGame(t, 29)
		s.Phase = engine.PhasePlay
		s.Cur = 0
		s.Rolled = true
		x := knightsExtOf(t, s)

		// Two cities: one on commodity terrain (the richer, so the one worth making
		// pillage-immune) and one whose tiles are stripped of their number tokens,
		// which produces nothing and is therefore strictly the worse city to protect.
		rich := commodityVertex(s)
		richHexes := map[board.Hex]bool{}
		for _, h := range rich.Hexes() {
			richHexes[h] = true
		}
		used := map[board.Vertex]bool{rich: true}
		var poor board.Vertex
		for {
			poor = freeVertex(s, used)
			shares := false
			for _, h := range poor.Hexes() {
				if richHexes[h] {
					shares = true
				}
			}
			if !shares {
				break
			}
		}
		for _, h := range poor.Hexes() {
			if tl, ok := s.Board.Tiles[h]; ok {
				tl.Number = 0
				s.Board.Tiles[h] = tl
			}
		}
		for _, v := range []board.Vertex{poor, rich} {
			s.Buildings[v] = engine.Building{Owner: 0, City: true}
		}
		x.Players[0].Improve[knights.Trade] = knights.MetropolisLevel
		x.MetropolisPending = &knights.MetropolisPick{Player: 0, Track: knights.Trade, Prev: engine.NoPlayer}

		_, cities, ok := knights.MetropolisChoice(s, 0)
		if !ok || len(cities) < 2 {
			t.Fatalf("setup: MetropolisChoice ok=%v cities=%v", ok, cities)
		}
		return s, rich
	}

	accept := func(t *testing.T, s *engine.State, cmd engine.Command) {
		t.Helper()
		if cmd.Type != knights.CmdMetropolisPick {
			t.Fatalf("command = %s, want %s", cmd.Type, knights.CmdMetropolisPick)
		}
		if _, err := engine.Decide(s.Clone(), cmd); err != nil {
			t.Fatalf("engine rejected the bot's pick: %v", err)
		}
	}

	t.Run("strong", func(t *testing.T) {
		s, rich := build(t)
		cmd, ok := NewStrong().Act(s, 0)
		if !ok {
			t.Fatal("Strong owed a metropolis pick and did nothing")
		}
		accept(t, s, cmd)
		var got struct {
			V board.Vertex `json:"v"`
		}
		if err := json.Unmarshal(cmd.Data, &got); err != nil {
			t.Fatal(err)
		}
		if got.V != rich {
			t.Errorf("Strong put the metropolis on %v, want the productive city %v", got.V, rich)
		}
	})

	t.Run("simple", func(t *testing.T) {
		s, _ := build(t)
		cmd, ok := NewSimple().Act(s, 0)
		if !ok {
			t.Fatal("Simple owed a metropolis pick and did nothing")
		}
		accept(t, s, cmd)
	})
}

// TestKnightsBotRobsCommodityOnlyVictim: in Knights the robber steals from the
// combined resource+commodity pool, so a player holding three cloth and no
// resources is a legal victim (engine.RobberVictims says so via
// DiscardableCount). The bot must not re-filter on Hand.Count() alone.
func TestKnightsBotRobsCommodityOnlyVictim(t *testing.T) {
	s := newKnightsGame(t, 11)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	x := knightsExtOf(t, s)

	// Seat 1 borders the hex with a settlement, holds only commodities.
	h := board.Hex{}
	for _, cand := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Land(cand) && cand != s.Board.Robber {
			h = cand
			break
		}
	}
	for _, v := range h.Vertices() {
		delete(s.Buildings, v) // clear whatever setup left, so seat 1 is the only claim
	}
	s.Buildings[h.Vertices()[0]] = engine.Building{Owner: 1}
	s.Players[1].Hand = engine.Hand{}
	x.Players[1].Commodities = knights.CommodityHand{knights.Cloth: 3}

	victim, ok := NewStrong().robberVictim(s, 0, h)
	if !ok || victim != 1 {
		t.Fatalf("robberVictim = (%d, %v), want (1, true): a commodity-only hand is robbable", victim, ok)
	}
}

// TestKnightsChaseDoesNotPeekAtHiddenHands: CmdChaseRobber resolves its steal inside
// Decide exactly as CmdMoveRobber does, so scoring a chase by simulation is the
// same hidden read (see expectedStealScore in bot/robber.go). Hold the victim's
// card count fixed, vary the contents, and require every chase candidate to keep
// the same score.
func TestKnightsChaseDoesNotPeekAtHiddenHands(t *testing.T) {
	build := func(t *testing.T, res board.Resource) (*engine.State, *Strong) {
		t.Helper()
		s := newKnightsGame(t, 31)
		s.Phase = engine.PhasePlay
		s.Cur = 0
		s.Rolled = true
		x := knightsExtOf(t, s)
		x.Attacks = 1 // the robber is only chaseable after the first landfall

		var hexes []board.Hex
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if tl, ok := s.Board.Tiles[h]; ok && tl.Res.Producing() {
				hexes = append(hexes, h)
			}
			if len(hexes) >= 2 {
				break
			}
		}
		s.Board.Robber = hexes[0]
		x.Knights[hexes[0].Vertices()[0]] = knights.Knight{Owner: 0, Level: 1, Active: true}
		s.Buildings[hexes[1].Vertices()[0]] = engine.Building{Owner: 1}
		s.Players[1].Hand = engine.Hand{}
		s.Players[1].Hand[res] = 3
		return s, NewStrong()
	}

	want := map[string]float64{}
	for i, res := range board.Resources {
		s, b := build(t, res)
		got := map[string]float64{}
		b.knightsCandidates(s, 0, func(engine.Command) {}, func(cmd engine.Command, sc float64) {
			if cmd.Type == knights.CmdChaseRobber {
				got[string(cmd.Data)] = sc
			}
		})
		if i == 0 {
			if len(got) == 0 {
				t.Fatal("no chase candidates proposed")
			}
			want = got
			continue
		}
		if len(got) != len(want) {
			t.Fatalf("%v: %d chase candidates, want %d", res, len(got), len(want))
		}
		for k, sc := range got {
			if diff := sc - want[k]; diff > 1e-9 || diff < -1e-9 {
				t.Errorf("chase %s scores %.6f with victim holding %v, %.6f holding %v, want equal", k, sc, res, want[k], board.Resources[0])
			}
		}
	}
}

// TestKnightsImprovementLadderIsAWeight: knightsImproveValue is scaled by
// Weights.KnightsImprove, so ablation and sweeps reach it. 1.0 is the default.
func TestKnightsImprovementLadderIsAWeight(t *testing.T) {
	build := func(t *testing.T, w Weights) float64 {
		t.Helper()
		s := newKnightsGame(t, 7)
		s.Phase = engine.PhasePlay
		b := NewStrong(WithWeights(w))
		x := knightsExtOf(t, s)
		x.Players[0].Improve[knights.Trade] = 3
		return b.knightsEval(s, 0, 0)
	}
	// Linear in the weight, rather than equal at one setting, so the test holds
	// whatever default a sweep ships.
	at := func(w float64) float64 {
		ww := DefaultWeights()
		ww.KnightsImprove = w
		return build(t, ww)
	}
	e0, e1, e2 := at(0), at(1), at(2)
	const tol = 1e-9
	step := e1 - e0
	if step < tol && step > -tol {
		t.Errorf("KnightsImprove does not move knightsEval (%.6f at w=0 and w=1)", e0)
	}
	if d := (e2 - e1) - step; d > tol || d < -tol {
		t.Errorf("knightsEval not linear in KnightsImprove: w=0->1 moves %.6f, w=1->2 moves %.6f", step, e2-e1)
	}
	// And the unit the weight scales is the ladder's own entry, which is what
	// makes 1.0 mean "the table read raw".
	if d := step - knightsImproveValue[3]; d > tol || d < -tol {
		t.Errorf("one unit of KnightsImprove is worth %.6f, want %.6f", step, knightsImproveValue[3])
	}
	if BaselineWeights().KnightsImprove != 1 {
		t.Errorf("BaselineWeights().KnightsImprove = %v, want 1", BaselineWeights().KnightsImprove)
	}
}
