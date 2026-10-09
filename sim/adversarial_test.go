package sim

import (
	"bytes"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"

	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/engine/wagons"
)

// deepClone is an independent deep copy via a gob round trip.
func deepClone(t *testing.T, s *engine.State) *engine.State {
	t.Helper()
	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(s); err != nil {
		t.Fatalf("clone encode: %v", err)
	}
	var c engine.State
	if err := gob.NewDecoder(&buf).Decode(&c); err != nil {
		t.Fatalf("clone decode: %v", err)
	}
	return &c
}

func mutated(t *testing.T, before, s *engine.State) bool {
	t.Helper()
	return !reflect.DeepEqual(before, deepClone(t, s))
}

// allCommandTypes spans base and every expansion's commands, so the garbage
// fuzzer probes module Decide paths too.
var allCommandTypes = []engine.CommandType{
	engine.CmdPlaceSettlement, engine.CmdPlaceRoad, engine.CmdRollDice, engine.CmdDiscardCards,
	engine.CmdMoveRobber, engine.CmdBuildRoad, engine.CmdBuildSettlement, engine.CmdBuildCity,
	engine.CmdEndTurn, engine.CmdBankTrade, engine.CmdOfferTrade, engine.CmdRespondTrade,
	engine.CmdExecuteTrade, engine.CmdCancelTrade, engine.CmdBuyDevCard, engine.CmdPlayDevCard,
	islands.CmdBuildShip, islands.CmdMoveShip, islands.CmdMovePirate, islands.CmdChooseGold,
	knights.CmdImproveCity, knights.CmdBuildKnight, knights.CmdActivateKnight, knights.CmdPromoteKnight,
	knights.CmdMoveKnight, knights.CmdChaseRobber, knights.CmdBuildWall, knights.CmdPlayProgress,
	knights.CmdDiscardProgress, knights.CmdGiveCards, knights.CmdHarborGive,
	scenarios.CmdSpendFish, scenarios.CmdPlaceCamel,
	wagons.CmdMove, wagons.CmdHalt, wagons.CmdBoost, wagons.CmdCharge,
	wagons.CmdBarbarian, wagons.CmdUpgrade, wagons.CmdBuy, wagons.CmdSell, wagons.CmdSwift,
	explorers.CmdPlaceHarbour, explorers.CmdPlaceSettlement, explorers.CmdPlaceStart,
	explorers.CmdBuildHarbour, explorers.CmdBuildShip, explorers.CmdBuyCargo, explorers.CmdJettison,
	explorers.CmdGoldBuy, explorers.CmdGoldSell, explorers.CmdBankGold,
	explorers.CmdEnterMovement, explorers.CmdMoveShip, explorers.CmdSpeedShip,
	explorers.CmdLoad, explorers.CmdUnload, explorers.CmdLandCrew, explorers.CmdTakeCrew,
	explorers.CmdLoadHaul, explorers.CmdDeliver, explorers.CmdFound, explorers.CmdFishRoll,
	explorers.CmdChasePirate, explorers.CmdMovePirate,
	"junk", "", "🎲",
}

func garbageData(rng *rand.Rand) json.RawMessage {
	switch rng.IntN(7) {
	case 0:
		return nil
	case 1:
		return json.RawMessage("null")
	case 2:
		return json.RawMessage("{")
	case 3:
		return json.RawMessage(`{"v":{"q":"x"}}`)
	case 4:
		b := make([]byte, rng.IntN(24))
		for i := range b {
			b[i] = byte(rng.IntN(256))
		}
		return b
	case 5:
		return json.RawMessage(`{"player":99,"v":{"q":99,"r":-99,"side":7},"e":{"a":{"q":1,"r":1,"side":0},"b":{"q":2,"r":2,"side":1}},"hex":{"q":99,"r":99},"card":42,"give":9,"get":-3,"cards":[9,9,9,9,9,9],"track":99,"use":"nope","res":99}`)
	default:
		var v board.Vertex
		v.Q, v.R = rng.IntN(9)-4, rng.IntN(9)-4
		raw, _ := json.Marshal(map[string]any{"v": v, "hex": board.Hex{Q: v.Q, R: v.R}, "e": board.NewEdge(v, board.Vertex{Q: v.Q + 1, R: v.R})})
		return raw
	}
}

// adversarialActor is what adversarialGame drives the game with. The choice of
// bot decides which rules the battery reaches (see TestAdversarialAcrossRulesets).
type adversarialActor interface {
	Act(*engine.State, engine.PlayerID) (engine.Command, bool)
}

// simpleActor and strongActor are the two constructors the battery is run with.
//
// strongActor opts into the camel bid, which the shipped bot leaves off (see
// bot.WithCamelBids). This battery tests the rules, not the shipped bot, and
// the auction payment is one of the two paths in engine/scenarios that move a base
// resource.
func simpleActor() adversarialActor { return bot.NewSimple() }
func strongActor() adversarialActor { return bot.NewStrong(bot.WithCamelBids()) }

// TestAdversarialAcrossRulesets plays a full bot game for every ruleset and,
// at every step: (1) fires a battery of garbage/illegal commands that must
// never panic and never mutate the live state, (2) confirms the bot's own
// move leaves the state unchanged until it is Applied (Decide is pure), and
// (3) checks global rule invariants. The final log must replay to the live
// state.
//
// This is the only place checkRuleInvariants runs. The bot decides which rules
// get played: Simple alone never reaches the 4-fish bank withdrawal or a paid
// camel bid, the two engine/scenarios paths that move a base resource. So the tab
// rulesets (and other scenarios with their own resource paths) are also played
// by Strong. Simple stays because it is the baseline whose livelocks this
// battery catches.
func TestAdversarialAcrossRulesets(t *testing.T) {
	skipUnlessSlow(t, "plays a full game per ruleset")
	// Multi-module names go through engine.CanonicalRuleset, as every creation
	// path does. See canonical_test.go.
	rulesets := []struct {
		name    string
		players int
		// strong also plays this ruleset. Set for the tab scenarios, where the
		// baseline cannot reach the module's resource-moving rules.
		strong bool
	}{
		{"base", 4, false},
		{"base+islands", 4, false},
		{"base+cak", 4, false},
		{engine.CanonicalRuleset("base+islands+cak"), 4, false}, // expansions compose
		{"base+fishermen", 4, true},
		{"base+caravans", 4, true},
		{engine.CanonicalRuleset("base+fishermen+caravans"), 4, true}, // both procedural scenarios at once
		{"base+harbormaster", 4, false},
		// Harbormaster beside the module that can take a building's value away.
		// It adds no bot command, so simple alone is enough.
		{engine.CanonicalRuleset("base+cak+harbormaster"), 4, false},
		// Rivers with both bots: buying a coin moves 2 to 4 cards into the
		// bank, spending one takes a card out, and a bridge costs brick and
		// lumber. Only a bot that plays them reaches these paths (bot/rivers.go).
		{engine.CanonicalRuleset("base+rivers"), 4, true},
		{engine.CanonicalRuleset("base+rivers+islands"), 4, true},
		// Raiders with both bots: they hire, march and spend gold on
		// different schedules, and the invariant here (a raider leaves the
		// supply exactly once and never returns) needs real battles.
		{"base+raiders", 4, true},
		// Wagons moves base resources four ways (upgrade, grain boost, gold
		// purchase, gold sale) and its own count a fifth.
		{"base+wagons", 4, true},
		{engine.CanonicalRuleset("base+caravans+wagons"), 4, true},
		// Explorers is standalone, so its name is its ruleset. Ships, crews,
		// settlers and the Movement phase are only reached by Strong's own lane
		// (bot.StrongExplorersPlay).
		{explorers.Name, 4, true},
	}
	var covered scenarioResourceMoves
	for _, rc := range rulesets {
		t.Run(rc.name+"/simple", func(t *testing.T) {
			m := adversarialGame(t, rc.name, rc.players, 1, simpleActor)
			t.Logf("tab resource moves: %+v", m)
		})
		if !rc.strong {
			continue
		}
		t.Run(rc.name+"/strong", func(t *testing.T) {
			// Several seeds, with coverage asserted over the sum across every tab
			// ruleset. Both moves are rare per game (a contested camel round worth
			// cards; four fish spent at the bank), so one seed may not reach them.
			// A fixed budget that fails loudly when exhausted can't silently skip.
			var m scenarioResourceMoves
			for seed := uint64(1); seed <= adversarialScenarioSeeds; seed++ {
				g := adversarialGame(t, rc.name, rc.players, seed, strongActor)
				m.fishBankTake += g.fishBankTake
				m.camelPaid += g.camelPaid
				m.wagonUpgrade += g.wagonUpgrade
				m.wagonBought += g.wagonBought
				m.wagonSold += g.wagonSold
				m.revealPaid += g.revealPaid
				m.goldBought += g.goldBought
				m.goldSold += g.goldSold
			}
			t.Logf("tab resource moves over %d seeds: %+v", adversarialScenarioSeeds, m)
			covered.fishBankTake += m.fishBankTake
			covered.camelPaid += m.camelPaid
			covered.wagonUpgrade += m.wagonUpgrade
			covered.wagonBought += m.wagonBought
			covered.wagonSold += m.wagonSold
			covered.revealPaid += m.revealPaid
			covered.goldBought += m.goldBought
			covered.goldSold += m.goldSold
		})
	}
	// A run that moved no resource proved nothing about the conservation
	// ledger, so this is asserted, not logged.
	t.Logf("tab resource moves, all strong arms: %+v", covered)
	if covered.fishBankTake == 0 {
		t.Errorf("4-fish bank resource never taken in any tab ruleset or seed")
	}
	if covered.camelPaid == 0 {
		t.Errorf("camel bid never paid in any tab ruleset or seed")
	}
	if covered.wagonUpgrade == 0 {
		t.Errorf("wagon never upgraded in any ruleset or seed")
	}
	if covered.wagonBought+covered.wagonSold == 0 {
		t.Errorf("gold never bought or sold in any ruleset or seed")
	}
	if covered.revealPaid == 0 {
		t.Errorf("Explorers reveal never paid a resource in any seed")
	}
	if covered.goldBought == 0 {
		t.Errorf("Explorers gold never bought in any seed")
	}
	if covered.goldSold == 0 {
		t.Errorf("Explorers resource never sold for gold in any seed")
	}
}

// adversarialScenarioSeeds is how many games each tab/strong arm plays. Small: the
// arms only need to reach two rules, and the battery deep-clones the state twice
// per step.
const adversarialScenarioSeeds = 8

func adversarialGame(t *testing.T, ruleset string, players int, seed uint64, newBot func() adversarialActor) scenarioResourceMoves {
	var moves scenarioResourceMoves
	cfg := engine.GameConfig{Players: players, Ruleset: ruleset, TargetVP: 8}
	log, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	baseBank := engine.BankPerResource(players)
	b := newBot()
	rng := rand.New(rand.NewPCG(seed, 0x5eed))

	for step := 0; s.Phase != engine.PhaseFinished && step < 6000; step++ {
		// (1) Garbage battery: never panic, never mutate.
		before := deepClone(t, s)
		for range 12 {
			cmd := engine.Command{
				Player: engine.PlayerID(rng.IntN(players+2) - 1),
				Type:   allCommandTypes[rng.IntN(len(allCommandTypes))],
				Data:   garbageData(rng),
			}
			func() {
				defer func() {
					if r := recover(); r != nil {
						t.Fatalf("%s: panic on %q / %s: %v", ruleset, cmd.Type, cmd.Data, r)
					}
				}()
				engine.Decide(s, cmd)
			}()
		}
		if mutated(t, before, s) {
			t.Fatalf("%s: a garbage command mutated the live state", ruleset)
		}

		// Advance with a bot move (falling back to the minimal legal move).
		seat := actingSeat(s)
		cmd, ok := b.Act(s, seat)
		if !ok {
			cmd, ok = engine.AutoCommand(s)
			if !ok {
				break
			}
		}
		pre := deepClone(t, s)
		events, err := engine.Decide(s, cmd)
		if err != nil {
			cmd, ok = engine.AutoCommand(s)
			if !ok {
				break
			}
			events, err = engine.Decide(s, cmd)
			if err != nil {
				t.Fatalf("%s: auto %s: %v", ruleset, cmd.Type, err)
			}
		}
		// (2) Decide is pure: state unchanged until Apply.
		if mutated(t, pre, s) {
			t.Fatalf("%s: Decide(%s) mutated the live state", ruleset, cmd.Type)
		}
		for _, e := range events {
			countScenarioResourceMoves(&moves, e)
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("%s: apply %s: %v", ruleset, e.Type, err)
			}
		}
		log = append(log, events...)

		// (3) Invariants.
		checkRuleInvariants(t, s, ruleset, baseBank)
	}

	// Replay determinism: the log must fold back to the identical state.
	replayed, err := engine.Replay(log)
	if err != nil {
		t.Fatalf("%s: replay: %v", ruleset, err)
	}
	if !reflect.DeepEqual(s, replayed) {
		t.Fatalf("%s: replay diverged from live state", ruleset)
	}
	return moves
}

// scenarioResourceMoves counts the two rules in engine/scenarios that move a base resource,
// which the conservation ledger in checkRuleInvariants must see.
type scenarioResourceMoves struct {
	fishBankTake int // 4-fish FishTakeResource: a withdrawal from the bank
	camelPaid    int // a camel auction payment: cards from a hand back to the bank
	// The Wagons rules that move a base resource, all bank transactions: an
	// upgrade pays cards in, a gold purchase takes one out, a gold sale pays
	// several in for a count that is not a card.
	wagonUpgrade int
	wagonBought  int
	wagonSold    int
	// Explorers moves base resources across the bank three ways: a reveal pays
	// one out, a gold purchase takes one out, a Fast Gold sale puts one back.
	revealPaid int
	goldBought int
	goldSold   int
}

func countScenarioResourceMoves(m *scenarioResourceMoves, e engine.Event) {
	switch e.Type {
	case scenarios.EvFishSpent:
		var d struct {
			Use string `json:"use"`
		}
		if json.Unmarshal(e.Data, &d) == nil && d.Use == scenarios.FishTakeResource {
			m.fishBankTake++
		}
	case scenarios.EvCamelResolved:
		// `cards` is the pair, in the ruleset's own bid resources; `wool` and
		// `grain` are the names older logs carry (see engine/scenarios.camelPayment).
		// Reading only those would count zero for current games.
		var d struct {
			Paid []struct {
				Cards [2]int `json:"cards"`
				Wool  int    `json:"wool"`
				Grain int    `json:"grain"`
			} `json:"paid"`
		}
		if json.Unmarshal(e.Data, &d) != nil {
			return
		}
		for _, p := range d.Paid {
			if p.Cards[0]+p.Cards[1]+p.Wool+p.Grain > 0 {
				m.camelPaid++
			}
		}
	case wagons.EvUpgraded:
		m.wagonUpgrade++
	case wagons.EvBought:
		m.wagonBought++
	case wagons.EvSold:
		m.wagonSold++
	case explorers.EvHexRevealed:
		var d struct {
			Gain engine.Hand `json:"gain"`
		}
		if json.Unmarshal(e.Data, &d) == nil && d.Gain.Count() > 0 {
			m.revealPaid++
		}
	case explorers.EvGoldTraded:
		var d struct {
			Give   engine.Hand `json:"give"`
			Get    engine.Hand `json:"get"`
			Reason string      `json:"reason"`
		}
		if json.Unmarshal(e.Data, &d) != nil {
			return
		}
		switch d.Reason {
		case explorers.GoldBuy:
			if d.Get.Count() > 0 {
				m.goldBought++
			}
		case explorers.GoldSell, explorers.GoldBank:
			if d.Give.Count() > 0 {
				m.goldSold++
			}
		}
	default:
		// Every other event; this counts a few specific rules, not all of them.
	}
}

// TestCommoditySupplyAcrossSeeds is the breadth half of the commodity-supply
// guarantee: many seeded games at several player counts, so the ledger sees
// boards where commodity terrain clusters, one player owns every pasture, and a
// stack runs dry.
//
// It also asserts the supply moved: a supply that is never drawn from (e.g.
// dropped in CloneExt, so production withholds everything) passes every
// conservation check trivially.
func TestCommoditySupplyAcrossSeeds(t *testing.T) {
	skipUnlessSlow(t, "plays many full games")
	cases := []struct {
		ruleset string
		players int
	}{
		{"base+cak", 3},
		{"base+cak", 4},
		{"base+cak", 6}, // the 5-6 bracket: 18 per stack, not 12
		{engine.CanonicalRuleset("base+islands+cak"), 4},
	}
	const seeds = 40
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%s/%dp", tc.ruleset, tc.players), func(t *testing.T) {
			want := knights.CommodityPerType(tc.players)
			drawn, emptied := 0, 0
			for seed := uint64(1); seed <= seeds; seed++ {
				low := playCommodityGame(t, tc.ruleset, tc.players, seed, want)
				for _, l := range low {
					if l < want {
						drawn++
					}
					if l == 0 {
						emptied++
					}
				}
			}
			if drawn == 0 {
				t.Fatalf("%d games never drew a commodity off a stack", seeds)
			}
			t.Logf("%d games: %d stack-lows below full, %d fully emptied", seeds, drawn, emptied)
		})
	}
}

// playCommodityGame plays one seeded bot game, checking the commodity ledger
// after every step, and returns the lowest each stack ever fell to.
func playCommodityGame(t *testing.T, ruleset string, players int, seed uint64, want int) [3]int {
	t.Helper()
	cfg := engine.GameConfig{Players: players, Ruleset: ruleset, TargetVP: 8}
	log, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	low := [3]int{want, want, want}
	b := bot.NewSimple()
	for step := 0; s.Phase != engine.PhaseFinished && step < 6000; step++ {
		cmd, ok := b.Act(s, actingSeat(s))
		if !ok {
			if cmd, ok = engine.AutoCommand(s); !ok {
				break
			}
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			if cmd, ok = engine.AutoCommand(s); !ok {
				break
			}
			if events, err = engine.Decide(s, cmd); err != nil {
				t.Fatalf("seed %d: auto %s: %v", seed, cmd.Type, err)
			}
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("seed %d: apply %s: %v", seed, e.Type, err)
			}
		}
		checkCommoditySupply(t, s, fmt.Sprintf("%s seed %d", ruleset, seed))
		if x, ok := knights.StateExt(s); ok {
			for c, n := range x.CommoditySupply {
				if n < low[c] {
					low[c] = n
				}
			}
		}
	}
	return low
}

// checkCommoditySupply is the commodity half of the conservation invariant.
// For every stack at every step: stack plus all hands equals the starting
// stack, and the stack never goes negative.
//
// Every path that moves a commodity must touch both sides: city production and
// the two supply trades draw down; a city improvement, the give side of each
// supply trade and an over-limit discard put back; and the player-to-player
// paths (levy, steal, trade, harbor give) must not touch the stack. A missed
// side shows up as drift from the starting count.
func checkCommoditySupply(t *testing.T, s *engine.State, ruleset string) {
	t.Helper()
	x, ok := knights.StateExt(s)
	if !ok {
		return // not a Knights game
	}
	want := knights.CommodityPerType(len(s.Players))
	for c, left := range x.CommoditySupply {
		if left < 0 {
			t.Fatalf("%s: commodity %d supply negative: %d", ruleset, c, left)
		}
		total := left
		for p := range x.Players {
			n := x.Players[p].Commodities[c]
			if n < 0 {
				t.Fatalf("%s: player %d has negative commodity %d", ruleset, p, c)
			}
			total += n
		}
		if total != want {
			t.Fatalf("%s: commodity %d not conserved: %d (want %d)", ruleset, c, total, want)
		}
	}
}

func checkRuleInvariants(t *testing.T, s *engine.State, ruleset string, baseBank int) {
	t.Helper()
	// Base resources are conserved: every resource's cards-in-hands + bank
	// equals the starting bank, always. Catches any duplication or leak.
	for _, r := range board.Resources {
		total := s.Bank[r]
		for p := range s.Players {
			n := s.Players[p].Hand[r]
			if n < 0 {
				t.Fatalf("%s: player %d has negative %v", ruleset, p, r)
			}
			total += n
		}
		if total != baseBank {
			t.Fatalf("%s: resource %v not conserved: %d (want %d)", ruleset, r, total, baseBank)
		}
	}
	if !s.Bank.NonNegative() {
		t.Fatalf("%s: negative bank %v", ruleset, s.Bank)
	}
	checkCommoditySupply(t, s, ruleset)
	// Piece limits never go negative.
	for p := range s.Players {
		ps := s.Players[p]
		if ps.RoadsLeft < 0 || ps.SettlementsLeft < 0 || ps.CitiesLeft < 0 {
			t.Fatalf("%s: player %d negative pieces %+v", ruleset, p, ps)
		}
	}
	// ...and never go UP either: pieces are conserved, not just non-negative.
	checkPieceConservation(t, s, ruleset)
	// The scenario invariants: the credited longest route agrees with an
	// independent walk, the boot has a seated holder, and the public fish
	// totals match the tiles held (scenarioinvariants_test.go).
	checkScenarioInvariants(t, s, ruleset)
	// One dock per water hex: a harbor is an edge on the wire, but its dock
	// stands on the water hex beside it, so two harbors on one hex would put
	// two docks in one place. This tests generation, including modules that
	// recompute harbors on a reshaped coast (Islands).
	docks := map[board.Hex]board.Harbor{}
	for _, hb := range s.Board.Harbors {
		sea, ok := s.Board.HarborSeaHex(hb)
		if !ok {
			t.Fatalf("%s: harbor %v has no single water side", ruleset, hb.Verts)
		}
		if prev, dup := docks[sea]; dup {
			t.Fatalf("%s: harbors %v and %v both dock on water hex %v", ruleset, prev.Verts, hb.Verts, sea)
		}
		docks[sea] = hb
	}
	// Distance rule: no two buildings on adjacent vertices.
	for v, b := range s.Buildings {
		for _, n := range v.Neighbors() {
			if _, ok := s.Buildings[n]; ok {
				t.Fatalf("%s: adjacent buildings at %v and %v (owner %d)", ruleset, v, n, b.Owner)
			}
		}
	}
}

// actingSeat mirrors the game actor's nextToAct.
func actingSeat(s *engine.State) engine.PlayerID {
	if len(s.PendingDiscards) > 0 {
		for q := range s.Players {
			if _, ok := s.PendingDiscards[engine.PlayerID(q)]; ok {
				return engine.PlayerID(q)
			}
		}
	}
	return s.Cur
}
