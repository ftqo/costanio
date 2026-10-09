package scenarios

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func step(t *testing.T, s *engine.State, cmd engine.Command) []engine.Event {
	t.Helper()
	events, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("Decide(%s by %d): %v", cmd.Type, cmd.Player, err)
	}
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("Apply(%s): %v", e.Type, err)
		}
	}
	return events
}

func newGame(t *testing.T, ruleset string, seed uint64) (*engine.State, []engine.Event) {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		log = append(log, step(t, s, cmd)...)
	}
	return s, log
}

func rolled(t *testing.T, s *engine.State) {
	t.Helper()
	step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	for s.RobberPending || len(s.PendingDiscards) > 0 {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("stuck")
		}
		step(t, s, cmd)
	}
	// Module pendings (camel placement, ...) resolve too.
	for {
		cmd, ok := engine.AutoCommand(s)
		if !ok || cmd.Type == engine.CmdEndTurn || cmd.Type == engine.CmdRollDice {
			return
		}
		blocked := false
		for _, m := range s.Modules() {
			if h := m.Hooks().Blocks; h != nil && h(s) {
				blocked = true
			}
		}
		if !blocked {
			return
		}
		step(t, s, cmd)
	}
}

func TestFishermenLakeAndSpends(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 1)

	// The desert became the lake, and the robber stays on it.
	lakes := 0
	for _, tile := range s.Board.Tiles {
		if tile.Res == board.Lake {
			lakes++
		}
		if tile.Res == board.ResNone {
			t.Error("desert survived fishermen setup")
		}
	}
	if lakes == 0 {
		t.Fatal("no lake")
	}
	// The robber starts beside the board and enters on the first 7: the
	// desert it would park on is now the lake, and a robber there would block
	// all four lake numbers from the start.
	if s.Board.RobberOnBoard() {
		t.Errorf("robber on %v at setup, want it beside the board", s.Board.Robber)
	}

	rolled(t, s)
	p := s.Cur
	x := fishExt(s)

	// Spends validate cost.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishDevCard})}); !errors.Is(err, ErrNoFish) {
		t.Errorf("broke fisherman err = %v", err)
	}

	setHeld(x, p, [3]int{20, 0, 0}) // 20 one-fish tiles

	// Take-resource (4 fish) pulls a card from the bank.
	wheatBefore := s.Players[p].Hand[board.Wheat]
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishTakeResource, "res": board.Wheat})})
	if s.Players[p].Hand[board.Wheat] != wheatBefore+1 {
		t.Errorf("take-resource failed: %v", s.Players[p].Hand)
	}
	if fishTotal(x.Held[p]) != 16 { // 20 - 4
		t.Errorf("fish after take = %d, want 16", fishTotal(x.Held[p]))
	}

	// Free road grant feeds the base free-road machinery.
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad, "e": legalRoadEdge(t, s, p)})})
	if s.FreeRoads != 1 {
		t.Errorf("free roads = %d", s.FreeRoads)
	}

	// Free dev card skips the cost.
	handBefore := s.Players[p].Hand.Count()
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish, Data: mustJSON(t, map[string]any{"use": FishDevCard})})
	if s.Players[p].Hand.Count() != handBefore {
		t.Error("free dev card charged resources")
	}
	if s.Players[p].NewDevCards.Count() != 1 {
		t.Error("no dev card drawn")
	}

	// Two fish remove the robber from the board; it returns when a player
	// resolves a 7 or plays a Knight. Put it on a producing hex first (as a
	// 7 would), then take it away.
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Tiles[h].Res.Producing() {
			s.Board.Robber = h
			break
		}
	}
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishRemoveRobber})})
	if s.Board.RobberOnBoard() {
		t.Errorf("robber = %v, want it off the board", s.Board.Robber)
	}
	// With it off the board nothing is blocked: no hex is the robber's.
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if h == s.Board.Robber {
			t.Fatalf("hex %v reads as the robber's while the robber is off the board", h)
		}
	}
}

func TestFishCannotMakeChange(t *testing.T) {
	// Holding only a 3-fish tile, a 2-fish action spends the whole tile and the
	// surplus fish is lost.
	if got := spendTiles([3]int{0, 0, 1}, 2); got != ([3]int{0, 0, 1}) {
		t.Errorf("spend = %v, want one 3-tile", got)
	}
	// With small tiles available, exact change is preferred (no waste).
	if got := spendTiles([3]int{2, 1, 1}, 4); fishValue(got) != 4 {
		t.Errorf("spend value = %d, want exact 4 (got tiles %v)", fishValue(got), got)
	}
}

func fishValue(t [3]int) int { return t[0] + 2*t[1] + 3*t[2] }

func TestFishingGroundsYield(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 8)
	x := fishExt(s)
	if len(x.Grounds) == 0 {
		t.Fatal("no fishing grounds placed on the coast")
	}
	g := x.Grounds[0]
	// A city on one of the ground's intersections draws on the ground's number.
	v := g.V[0]
	delete(s.Buildings, v)
	for _, n := range v.Neighbors() {
		delete(s.Buildings, n) // keep the distance rule satisfiable
	}
	s.Buildings[v] = engine.Building{Owner: 0, City: true}

	d1 := g.Number / 2
	d2 := g.Number - d1
	if d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6 {
		t.Fatalf("ground number %d cannot be rolled on two dice", g.Number)
	}
	events := fishCatch(s, d1, d2)
	if len(events) == 0 || events[0].Type != EvFishCaught {
		t.Fatalf("ground %d did not yield: %+v", g.Number, events)
	}
	// Apply the whole batch: the public EvFishCaught plus the per-seat
	// EvFishGained events that carry the tiles.
	for i := range events {
		events[i].Seq = s.NextSeq
		if err := engine.Apply(s, events[i]); err != nil {
			t.Fatal(err)
		}
	}
	if fishTotal(x.Held[0]) < 2 { // a city draws 2 tiles, each worth >= 1
		t.Errorf("fishing-ground city caught %d fish, want >= 2", fishTotal(x.Held[0]))
	}
}

// legalRoadEdge returns an edge seat may legally build a road on right now,
// which is what the 5-fish free-road spend requires.
func legalRoadEdge(t *testing.T, s *engine.State, seat engine.PlayerID) board.Edge {
	t.Helper()
	roads := s.LegalRoads(seat)
	if len(roads) == 0 {
		t.Fatal("no legal road edge")
	}
	return roads[0]
}

// illegalRoadEdge returns a land edge seat may not legally build a road on.
func illegalRoadEdge(t *testing.T, s *engine.State, seat engine.PlayerID) board.Edge {
	t.Helper()
	legal := map[board.Edge]bool{}
	for _, e := range s.LegalRoads(seat) {
		legal[e] = true
	}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if s.Board.LandEdge(e) && !legal[e] {
				return e
			}
		}
	}
	t.Fatal("every land edge is legal")
	return board.Edge{}
}

func TestFishCaughtOnLakeNumbers(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	// Plant a settlement on the lake shore.
	var lake board.Hex
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Lake {
			lake = h
		}
	}
	v := lake.Vertices()[0]
	delete(s.Buildings, v)
	s.Buildings[v] = engine.Building{Owner: 1, City: true}

	events := (Fishermen{}).Hooks().OnDiceRolled(s, 1, 1) // a 2: lake yields
	if len(events) == 0 || events[0].Type != EvFishCaught {
		t.Fatalf("events = %+v", events)
	}
	for i := range events {
		events[i].Seq = s.NextSeq
		if err := engine.Apply(s, events[i]); err != nil {
			t.Fatal(err)
		}
	}
	if fishTotal(fishExt(s).Held[1]) < 2 { // city draws 2 tiles, each worth >= 1
		t.Errorf("fish = %d", fishTotal(fishExt(s).Held[1]))
	}
}

func TestFishermenOldBoot(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 4)
	x := fishExt(s)
	hooks := (Fishermen{}).Hooks()

	rolled(t, s)
	p := s.Cur
	x.BootHolder = p
	q := (p + 1) % engine.PlayerID(len(s.Players))

	// The boot raises only its holder's win threshold (not a VP).
	if hooks.WinThresholdDelta(s, p) != 1 || hooks.WinThresholdDelta(s, q) != 0 {
		t.Error("boot must add +1 to the holder's threshold only")
	}

	// With at least an equal-VP peer, the holder may pass it.
	if s.PublicVP(q) >= s.PublicVP(p) {
		step(t, s, engine.Command{Player: p, Type: CmdGiveBoot, Data: mustJSON(t, map[string]any{"to": q})})
		if x.BootHolder != q {
			t.Fatalf("boot not passed: holder=%d", x.BootHolder)
		}
		x.BootHolder = p // restore for the rejection check below
	}

	// Make p the sole VP leader; a sole leader cannot offload the boot.
	for v, b := range s.Buildings {
		if b.Owner == p && !b.City {
			s.Buildings[v] = engine.Building{Owner: p, City: true}
			break
		}
	}
	if s.PublicVP(p) <= s.PublicVP(q) {
		t.Fatalf("fixture: p at %d VP, q at %d, want p sole leader",
			s.PublicVP(p), s.PublicVP(q))
	}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdGiveBoot,
		Data: mustJSON(t, map[string]any{"to": q})}); !errors.Is(err, ErrBootRecipient) {
		t.Errorf("sole leader should not be able to pass the boot, err = %v", err)
	}
}

// A FishSteal naming a negative victim seat (victim:-1) must be rejected with
// ErrBadVictim and leave state untouched, not index s.Players[-1] and panic
// (which would pause-error the game).
func TestFishStealNegativeVictimRejected(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 1)
	rolled(t, s)
	p := s.Cur
	x := fishExt(s)
	setHeld(x, p, [3]int{20, 0, 0}) // plenty of fish, so the cost guard passes
	heldBefore := x.Held[p]

	_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": -1})})
	if !errors.Is(err, engine.ErrBadVictim) {
		t.Fatalf("victim=-1 should yield ErrBadVictim, got %v", err)
	}
	if x.Held[p] != heldBefore {
		t.Errorf("rejected steal mutated fish: %v != %v", x.Held[p], heldBefore)
	}
}

// The boot's "pass to someone doing at least as well" check counts module VP
// (Caravans points), not just base public VP. Here the recipient ties the holder
// only because of a Caravans between-two-camels point.
func TestBootPassCountsModuleVP(t *testing.T) {
	s, _ := newGame(t, "base+fishermen+caravans", 3)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))

	fx := fishExt(s)
	fx.BootHolder = p

	// Give q a between-two-camels building → +1 Caravans module VP.
	xc := caravansExt(s)
	idx, found := -1, board.Edge{}
	var ext board.Edge
	for i := range caravansPerOasis {
		a := xc.Arrows[i]
		if a == (board.Edge{}) {
			continue
		}
		xc.Chains[i] = []board.Edge{a}
		xc.Occupied[a] = true
		fronts := (Caravans{}).caravanFrontEdges(xc, s, i)
		if len(fronts) == 0 {
			xc.Chains[i] = nil
			delete(xc.Occupied, a)
			continue
		}
		idx, found, ext = i, a, fronts[0]
		xc.Chains[i] = append(xc.Chains[i], ext)
		xc.Occupied[ext] = true
		break
	}
	if idx < 0 {
		t.Fatal("fixture: no caravan can be extended")
	}
	mid := sharedVertex(ext, found)
	delete(s.Buildings, mid)
	s.Buildings[mid] = engine.Building{Owner: q}
	if (Caravans{}).victory(s, q) < 1 {
		t.Fatalf("setup failed: q has no caravan module VP")
	}

	// Raise p's base VP (city upgrades) until it equals q's total with
	// modules, so base-only VP favours p but total VP ties.
	target := s.PublicVPWithModules(q)
	for s.PublicVP(p) < target {
		bumped := false
		for v, b := range s.Buildings {
			if b.Owner == p && !b.City {
				s.Buildings[v] = engine.Building{Owner: p, City: true}
				bumped = true
				break
			}
		}
		if !bumped {
			break
		}
	}

	// Precondition: base-only VP strictly favours p, yet total VP does not.
	if s.PublicVP(q) >= s.PublicVP(p) {
		t.Fatalf("fixture: no base-VP gap (q=%d p=%d)",
			s.PublicVP(q), s.PublicVP(p))
	}
	if s.PublicVPWithModules(p) > s.PublicVPWithModules(q) {
		t.Fatalf("fixture: total VP not tied (p=%d q=%d)",
			s.PublicVPWithModules(p), s.PublicVPWithModules(q))
	}

	step(t, s, engine.Command{Player: p, Type: CmdGiveBoot, Data: mustJSON(t, map[string]any{"to": q})})
	if fishExt(s).BootHolder != q {
		t.Fatalf("boot not passed though q ties p on total VP (module VP ignored?): holder=%d", fishExt(s).BootHolder)
	}
}

// The two-fish spend takes no target, so the only condition is that a robber is
// on the board to remove. Kept as a test so a future target-taking spend does not
// repeat the old mistake (board.Land is true for Gold, and Res.Producing covers
// only Wood..Ore).
func TestFishRemoveRobberTakesNoTarget(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 1)
	rolled(t, s)
	p := s.Cur
	setHeld(fishExt(s), p, [3]int{20, 0, 0})

	var producing board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Tiles[h].Res.Producing() {
			producing = h
			break
		}
	}
	s.Board.Robber = producing

	// A hex in the payload is ignored: the robber goes off the board
	// whatever the client sends.
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishRemoveRobber, "hex": producing})})
	if s.Board.RobberOnBoard() {
		t.Fatalf("robber = %v, want it off the board", s.Board.Robber)
	}

	// A second spend has nothing to remove and is refused before it costs
	// anything.
	before := fishTotal(fishExt(s).Held[p])
	_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishRemoveRobber})})
	if !errors.Is(err, ErrSpendUnavailable) {
		t.Fatalf("removing an absent robber: err = %v, want ErrSpendUnavailable", err)
	}
	if got := fishTotal(fishExt(s).Held[p]); got != before {
		t.Errorf("the refused spend took %d fish", before-got)
	}
}

// FishSteal (resource-only path) goes through the engine's steal
// machinery and moves a card from victim to thief.
func TestFishStealResourceOnly(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 6)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := fishExt(s)
	setHeld(x, p, [3]int{20, 0, 0})

	s.Players[q].Hand = engine.Hand{}
	s.Players[q].Hand[board.Wheat] = 1
	thiefBefore := s.Players[p].Hand[board.Wheat]

	evs := step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": q})})
	if len(evs) != 2 || evs[1].Type != engine.EvCardStolen {
		t.Fatalf("steal events = %+v", evs)
	}
	if s.Players[q].Hand[board.Wheat] != 0 {
		t.Errorf("victim still holds the stolen card: %v", s.Players[q].Hand)
	}
	if s.Players[p].Hand[board.Wheat] != thiefBefore+1 {
		t.Errorf("thief did not receive the stolen card: %v", s.Players[p].Hand)
	}
	if fishTotal(x.Held[p]) != 17 { // 20 - 3
		t.Errorf("fish after steal = %d, want 17", fishTotal(x.Held[p]))
	}
}

// FishSteal (Knights combined pool): in a cak game a victim holding only
// commodities is still a valid target, and the steal takes a commodity via the
// module's StealCard hook.
func TestFishStealCommodityOnly(t *testing.T) {
	s, _ := newGame(t, "base+fishermen+cak", 2)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := fishExt(s)
	setHeld(x, p, [3]int{20, 0, 0})

	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("cak module not active")
	}
	// Victim holds no resources, only a single Cloth commodity.
	s.Players[q].Hand = engine.Hand{}
	cx.Players[q].Commodities = knights.CommodityHand{}
	cx.Players[q].Commodities[knights.Cloth] = 1
	if s.Players[q].Hand.Count() != 0 {
		t.Fatal("fixture: victim holds resources")
	}
	if s.DiscardableCount(q) != 1 {
		t.Fatalf("commodity-only victim should be discardable/targetable: count=%d", s.DiscardableCount(q))
	}
	thiefBefore := cx.Players[p].Commodities[knights.Cloth]

	evs := step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": q})})
	if len(evs) != 2 || evs[1].Type != knights.EvCommodityStolen {
		t.Fatalf("steal events = %+v (want EvFishSpent + EvCommodityStolen)", evs)
	}
	if cx.Players[q].Commodities[knights.Cloth] != 0 {
		t.Errorf("victim still holds the stolen commodity: %v", cx.Players[q].Commodities)
	}
	if cx.Players[p].Commodities[knights.Cloth] != thiefBefore+1 {
		t.Errorf("thief did not receive the stolen commodity: %v", cx.Players[p].Commodities)
	}
}

func TestCaravansOasisScoringAndDoubleRoad(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	x := caravansExt(s)
	if !x.HasOasis {
		t.Fatal("no oasis derived")
	}
	if s.Board.Tiles[x.Oasis].Res != board.ResNone {
		t.Errorf("oasis is not the desert: %v", s.Board.Tiles[x.Oasis].Res)
	}

	// Build caravan 0: the arrow plus one outward extension.
	arrow := x.Arrows[0]
	if arrow == (board.Edge{}) {
		t.Fatal("no arrow for caravan 0")
	}
	x.Chains[0] = []board.Edge{arrow}
	x.Occupied[arrow] = true
	exts := (Caravans{}).caravanFrontEdges(x, s, 0)
	if len(exts) == 0 {
		t.Fatal("no extension path from the arrow")
	}
	ext := exts[0]
	x.Chains[0] = append(x.Chains[0], ext)
	x.Occupied[ext] = true

	// The vertex shared by the two camels is "between two camels".
	mid := sharedVertex(ext, arrow)
	delete(s.Buildings, mid)
	s.Buildings[mid] = engine.Building{Owner: 0}
	if got := (Caravans{}).victory(s, 0); got != 1 {
		t.Errorf("between-two-camels VP = %d, want 1", got)
	}
	if got := (Caravans{}).victory(s, 1); got != 0 {
		t.Errorf("opponent caravan VP = %d, want 0", got)
	}

	// A road sharing the arrow path counts double for the route length.
	s.Roads = map[board.Edge]engine.PlayerID{arrow: 0}
	if got := engine.LongestRouteLength(s, 0); got != 2 {
		t.Errorf("camel road length = %d, want 2 (double)", got)
	}
}

func TestCaravansVoteAndPlacement(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	p := s.Cur
	x := caravansExt(s)

	// Simulate a build this turn, then end the turn; a vote must open.
	built := (Caravans{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvSettlementBuilt, map[string]any{"player": p})})
	if len(built) != 1 || built[0].Type != EvCamelBuilt {
		t.Fatalf("build did not mark camel built: %+v", built)
	}
	built[0].Seq = s.NextSeq
	if err := engine.Apply(s, built[0]); err != nil {
		t.Fatal(err)
	}
	if !x.BuiltThisTurn {
		t.Fatal("BuiltThisTurn not set")
	}

	endEv := (Caravans{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvTurnEnded, engine.TurnEndedData{Player: p})})
	if len(endEv) != 1 || endEv[0].Type != EvCamelVote {
		t.Fatalf("qualifying turn end did not open a vote: %+v", endEv)
	}
	endEv[0].Seq = s.NextSeq
	if err := engine.Apply(s, endEv[0]); err != nil {
		t.Fatal(err)
	}
	if !x.Voting {
		t.Fatal("voting not open")
	}

	// Drive the vote + placement entirely via the module's auto resolver.
	for i := 0; i < 20 && x.Voting; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("auto stuck during caravan vote")
		}
		step(t, s, cmd)
	}
	if x.Voting {
		t.Fatal("vote never resolved")
	}
	placed := 0
	for i := range caravansPerOasis {
		placed += len(x.Chains[i])
	}
	if placed != 1 {
		t.Errorf("camels placed = %d, want 1", placed)
	}
	if x.CamelsLeft != camelSupply-1 {
		t.Errorf("camels left = %d, want %d", x.CamelsLeft, camelSupply-1)
	}
}

// When Fishermen floods the desert into a lake, Caravans must still find
// its oasis (otherwise every Caravans hook silently no-ops).
func TestCaravansOasisSurvivesFishermen(t *testing.T) {
	s, _ := newGame(t, "base+fishermen+caravans", 7)

	// Fishermen drowned every desert.
	for _, tile := range s.Board.Tiles {
		if tile.Res == board.ResNone {
			t.Fatal("desert survived fishermen setup")
		}
	}

	x := caravansExt(s)
	if !x.HasOasis {
		t.Fatal("caravans lost its oasis under fishermen (drowned desert)")
	}
	// The oasis must be the drowned desert (now a lake).
	if s.Board.Tiles[x.Oasis].Res != board.Lake {
		t.Errorf("oasis tile = %v, want Lake (the drowned desert)", s.Board.Tiles[x.Oasis].Res)
	}
	// Its spokes must be derivable, or no camel can ever be placed.
	arrows := 0
	for _, a := range x.Arrows {
		if a != (board.Edge{}) {
			arrows++
		}
	}
	if arrows == 0 {
		t.Error("no caravan spokes derived from the oasis")
	}
}

// Replaying recorded fish catches must produce the same Supply/Used as the live
// Decide path. Under a depleted supply with multi-tile catches, Apply's reshuffle
// must trigger when the drawn value slot is empty (as in drawTile), never letting
// a slot go negative or breaking Supply+Used+Held == 29.
func TestFishSupplyReshuffleConservation(t *testing.T) {
	s, log := newGame(t, "base+fishermen", 11)
	x := fishExt(s)

	const tiles = 29 // fishSupply totals 11+10+8
	conserved := func(e *FishExt) int {
		sum := 0
		for v := range 3 {
			sum += e.Supply[v] + e.Used[v]
			for p := range e.Held {
				sum += e.Held[p][v]
			}
		}
		return sum
	}

	// Plant a city on a lake-shore vertex (a city draws 2 tiles per lake roll)
	// so each lake roll forces a multi-tile catch.
	var lake board.Hex
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Lake {
			lake = h
		}
	}
	v := lake.Vertices()[0]
	delete(s.Buildings, v)
	for _, n := range v.Neighbors() {
		delete(s.Buildings, n)
	}
	s.Buildings[v] = engine.Building{Owner: 0, City: true}

	// ~22 forced catches against a depleted, lopsided supply: before each,
	// almost everything goes to the spent (Used) pile with only single-tile
	// slots left in Supply, so drawTile empties a slot and reshuffles Used
	// back mid-catch. After every catch the live state is compared to a
	// replay of the log; a draw-order vs value-order mismatch would drive a
	// slot below zero and the states would diverge.
	for i := range 22 {
		// Reset to a lopsided depleted supply that conserves to 29.
		x.Supply = [3]int{1, 0, 1}
		x.Used = [3]int{tiles - 2, 0, 0}
		for p := range x.Held {
			setHeld(x, engine.PlayerID(p), [3]int{})
		}

		evs := fishCatch(s, 1, 1) // a 2: lake yields
		for j := range evs {
			evs[j].Seq = s.NextSeq
			if err := engine.Apply(s, evs[j]); err != nil {
				t.Fatalf("apply catch %d: %v", i, err)
			}
			log = append(log, evs[j])
		}
		for vi := range 3 {
			if x.Supply[vi] < 0 {
				t.Fatalf("catch %d: Supply slot %d went negative: Supply=%v Used=%v", i, vi, x.Supply, x.Used)
			}
		}
		if got := conserved(x); got != tiles {
			t.Fatalf("catch %d: conservation broke: have %d want %d (Supply=%v Used=%v)", i, got, tiles, x.Supply, x.Used)
		}

		// Replaying just this catch from the same pre-state must land on the same
		// Supply/Used.
		want := x.CloneExt().(*FishExt)
		repl := freshFish(s)
		repl.Supply = [3]int{1, 0, 1}
		repl.Used = [3]int{tiles - 2, 0, 0}
		applyCaught(repl, engine.DecodeEvent[fishCaughtData](evs[0]))
		for vi := range 3 {
			if repl.Supply[vi] < 0 {
				t.Fatalf("catch %d: replay Supply slot %d went negative: %v", i, vi, repl.Supply)
			}
		}
		if repl.Supply != want.Supply || repl.Used != want.Used {
			t.Fatalf("catch %d: replay diverged: live Supply=%v Used=%v, replay Supply=%v Used=%v",
				i, want.Supply, want.Used, repl.Supply, repl.Used)
		}
	}
}

func TestScenariosReplayEqualsLive(t *testing.T) {
	s, log := newGame(t, "base+fishermen+caravans", 7)
	for i := 0; i < 50 && s.Phase != engine.PhaseFinished; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			break
		}
		log = append(log, step(t, s, cmd)...)
	}
	replayed, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s, replayed) {
		t.Error("replay diverged from live state")
	}
}

// Setup builds must not arm a camel vote. Setup settlements emit
// EvSettlementBuilt (leading to EvCamelBuilt and BuiltThisTurn) but close with
// EvSetupAdvanced, not EvTurnEnded, so a flag set there would open a vote on the
// first turn of play.
func TestCaravansSetupDoesNotArmVote(t *testing.T) {
	for _, seed := range []uint64{3, 5, 7, 11} {
		t.Run(strconv.FormatUint(seed, 10), func(t *testing.T) {
			s, log := newGame(t, "base+caravans", seed)
			for _, e := range log {
				if e.Type == EvCamelBuilt || e.Type == EvCamelVote {
					t.Fatalf("setup emitted %s", e.Type)
				}
			}
			x := caravansExt(s)
			if x.BuiltThisTurn {
				t.Error("BuiltThisTurn carried out of setup")
			}
			if x.Voting {
				t.Error("a camel vote is open before anyone has played")
			}
			if !x.HasOasis {
				t.Fatal("no oasis derived")
			}

			// Drive onEvents directly with a setup-phase build. finalizeWith skips
			// OnEvents outside PhasePlay, so Decide never does this today, which is
			// why the module states the gate itself; removing the gate must fail
			// this.
			s.Phase = engine.PhaseSetup
			if out := (Caravans{}).onEvents(s, []engine.Event{
				engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: 0}),
			}); len(out) != 0 {
				t.Errorf("setup-phase build produced %d events, want none: %+v", len(out), out)
			}
			s.Phase = engine.PhasePlay
			// The same batch in play does mark a build, so the assertion above is
			// about the phase.
			out := (Caravans{}).onEvents(s, []engine.Event{
				engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: 0}),
			})
			if len(out) != 1 || out[0].Type != EvCamelBuilt {
				t.Errorf("play-phase build produced %+v, want one EvCamelBuilt", out)
			}
		})
	}
}

// The camel view is an ordered path: grouped by caravan, and within a caravan
// walking outward from the oasis. A client draws the chain and reads scoring
// vertices off consecutive pairs, so an unstable sort by caravan would lose
// information.
func TestCaravansViewPreservesChainOrder(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	x := caravansExt(s)
	if !x.HasOasis {
		t.Fatal("no oasis derived")
	}
	// Grow every caravan as far as the board allows, recording the chain order.
	want := map[int][]board.Edge{}
	for i := range caravansPerOasis {
		for range 4 {
			exts := (Caravans{}).caravanFrontEdges(x, s, i)
			if len(exts) == 0 {
				break
			}
			x.Chains[i] = append(x.Chains[i], exts[0])
			x.Occupied[exts[0]] = true
		}
		want[i] = slices.Clone(x.Chains[i])
	}
	if len(want[0]) < 2 {
		t.Fatal("could not grow caravan 0 to two camels")
	}

	view, ok := x.ViewExt(0).(map[string]any)
	if !ok {
		t.Fatalf("ViewExt returned %T", x.ViewExt(0))
	}
	rv := reflect.ValueOf(view["camels"])
	got := map[int][]board.Edge{}
	lastCaravan := -1
	for i := range rv.Len() {
		entry := rv.Index(i)
		caravan := int(entry.FieldByName("Caravan").Int())
		if caravan < lastCaravan {
			t.Fatalf("camels not grouped by caravan at %d: %d after %d", i, caravan, lastCaravan)
		}
		lastCaravan = caravan
		got[caravan] = append(got[caravan], entry.FieldByName("E").Interface().(board.Edge))
	}
	for i := range caravansPerOasis {
		if !slices.Equal(got[i], want[i]) {
			t.Errorf("caravan %d view order = %v, want %v", i, got[i], want[i])
		}
	}

	// A re-inserted sort cannot be caught from output (see
	// TestCaravansViewRejectsSort), so this pins that the loop emits chain
	// order.
}

// A sort in ViewExt cannot be caught by asserting on its output: pdqsort does not
// permute input already ordered by the key, and ViewExt's loop always provides
// such input. sort.Slice is unstable by contract and could reorder ties in a
// future release, so this asserts at the source level instead.
func TestCaravansViewRejectsSort(t *testing.T) {
	src, err := os.ReadFile("caravans.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	start := strings.Index(body, "func (e *CaravansExt) ViewExt(")
	if start < 0 {
		t.Fatal("ViewExt not found in caravans.go")
	}
	end := strings.Index(body[start:], "\n}\n")
	if end < 0 {
		t.Fatal("could not find the end of ViewExt")
	}
	// Strip comment lines: the comment inside ViewExt names these calls to
	// warn about them.
	var code []string
	for ln := range strings.SplitSeq(body[start:start+end], "\n") {
		if !strings.HasPrefix(strings.TrimSpace(ln), "//") {
			code = append(code, ln)
		}
	}
	fn := strings.Join(code, "\n")
	for _, bad := range []string{"sort.Slice", "sort.SliceStable", "sort.Sort", "slices.Sort"} {
		if strings.Contains(fn, bad) {
			t.Errorf("ViewExt calls %s, want chain order kept", bad)
		}
	}
}

// legalPaths feeds the auto hook, which takes the first entry, so its order
// affects replay(events) == live state and must not depend on a map range. It
// walks caravans 0..n and each fixed Vertex.Edges() array.
func TestCaravansLegalPathsStable(t *testing.T) {
	for _, seed := range []uint64{3, 5, 9} {
		t.Run(strconv.FormatUint(seed, 10), func(t *testing.T) {
			s, _ := newGame(t, "base+caravans", seed)
			x := caravansExt(s)
			if !x.HasOasis {
				t.Fatal("fixture: no oasis on this seed")
			}
			// Non-empty chains exercise the front-edge branch as well as arrows.
			for i := range caravansPerOasis {
				if arrow := x.Arrows[i]; arrow != (board.Edge{}) && i%2 == 0 {
					x.Chains[i] = []board.Edge{arrow}
					x.Occupied[arrow] = true
				}
			}
			first := (Caravans{}).legalPaths(x, s)
			// Not t.Skip: a regression that empties legalPaths must fail.
			if len(first) == 0 {
				t.Fatal("fixture: no legal camel path")
			}
			for range 50 {
				if got := (Caravans{}).legalPaths(x, s); !slices.Equal(got, first) {
					t.Fatalf("legalPaths order varies: %v then %v", first, got)
				}
			}
		})
	}
}

// openCamelVote drives a base+caravans game to an open camel vote: a build this
// turn, then a turn end. Returns the state, the module ext and the seat that is
// current while the vote runs.
func openCamelVote(t *testing.T, seed uint64) (*engine.State, *CaravansExt) {
	t.Helper()
	s, _ := newGame(t, "base+caravans", seed)
	x := caravansExt(s)
	apply := func(evs []engine.Event) {
		t.Helper()
		for _, e := range evs {
			e.Seq = s.NextSeq
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	apply((Caravans{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvSettlementBuilt, map[string]any{"player": s.Cur})}))
	apply((Caravans{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvTurnEnded, engine.TurnEndedData{Player: s.Cur})}))
	if !x.Voting {
		t.Fatal("vote did not open")
	}
	return s, x
}

// A camel vote freezes only the seats it is waiting on. Pins both what a seat
// owing the vote nothing can now do, and what it still cannot (pass the turn
// under an unresolved vote).
func TestCaravanVoteFreezesOnlyOwedSeats(t *testing.T) {
	s, x := openCamelVote(t, 5)
	cur := s.Cur
	s.Rolled = true

	// Bidding, this seat has not bid: its voluntary actions are still gated.
	if err := engine.RequireActionableTurn(s, cur); !errors.Is(err, engine.ErrModulePending) {
		t.Fatalf("before bidding, RequireActionableTurn = %v, want ErrModulePending", err)
	}
	step(t, s, engine.Command{Player: cur, Type: CmdBidCamel,
		Data: raw(map[string]any{"cards": [2]int{0, 0}})})
	// Having bid, it owes the vote nothing and plays on while others bid.
	if err := engine.RequireActionableTurn(s, cur); err != nil {
		t.Fatalf("after bidding, RequireActionableTurn = %v, want nil", err)
	}
	// It may not pass the turn, which would open a second vote on top of
	// this one; the strict Blocks still gates end-turn.
	if _, err := engine.Decide(s, engine.Command{Player: cur, Type: engine.CmdEndTurn}); !errors.Is(err, engine.ErrModulePending) {
		t.Fatalf("end turn during a vote = %v, want ErrModulePending", err)
	}
	// Nor may the per-seat driver auto-pass it there.
	if c, ok := engine.AutoCommandFor(s, cur); ok && c.Type == engine.CmdEndTurn {
		t.Fatal("AutoCommandFor offered an end-turn while a vote was open")
	}

	// Finish bidding to reach the placement phase.
	for i := 0; i < 10 && x.Placer == engine.NoPlayer; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("auto stuck during bidding")
		}
		step(t, s, cmd)
	}
	if x.Placer == engine.NoPlayer {
		t.Fatal("bidding never closed")
	}

	// Placement: only the placer owes anything. Put up a seat that is not the
	// placer, the ordinary case (the vote opens on the next player's turn).
	s.Rolled = false
	for p := range s.Players {
		if engine.PlayerID(p) != x.Placer {
			s.Cur = engine.PlayerID(p)
			break
		}
	}
	if s.Cur == x.Placer {
		t.Fatal("could not find a non-placer seat to put up")
	}
	for p := range s.Players {
		seat := engine.PlayerID(p)
		c, ok := engine.AutoCommandFor(s, seat)
		switch seat {
		case x.Placer:
			if !ok || c.Type != CmdPlaceCamel {
				t.Fatalf("placer %d: AutoCommandFor = (%+v, %v), want a camel placement", seat, c, ok)
			}
		case s.Cur:
			// The active player is not the placer: its own turn resumes.
			if !ok || c.Type != engine.CmdRollDice {
				t.Fatalf("current seat %d during placement: AutoCommandFor = (%+v, %v), want a dice roll", seat, c, ok)
			}
			if err := engine.RequireActionableTurn(s, seat); err != nil && !errors.Is(err, engine.ErrMustRoll) {
				t.Fatalf("current seat %d during placement: RequireActionableTurn = %v", seat, err)
			}
			s.Rolled = true
			if err := engine.RequireActionableTurn(s, seat); err != nil {
				t.Fatalf("current seat %d after rolling during placement: RequireActionableTurn = %v", seat, err)
			}
			s.Rolled = false
		default:
			if ok {
				t.Fatalf("idle seat %d during placement got auto command %+v", seat, c)
			}
		}
	}

	// When the placer is the seat up, it must place its camel before doing
	// anything else.
	s.Cur, s.Rolled = x.Placer, true
	if err := engine.RequireActionableTurn(s, x.Placer); !errors.Is(err, engine.ErrModulePending) {
		t.Fatalf("placer up during placement: RequireActionableTurn = %v, want ErrModulePending", err)
	}
}

// A second EvCamelVote on top of an open one would reset Voting, Finisher,
// Bids and Bidded and destroy bids cast. onEvents must not emit one.
func TestCaravanVoteDoesNotRestartWhileOpen(t *testing.T) {
	s, x := openCamelVote(t, 5)
	step(t, s, engine.Command{Player: s.Cur, Type: CmdBidCamel,
		Data: raw(map[string]any{"cards": [2]int{0, 0}})})
	bidder := s.Cur

	// A build and a turn end arriving while the vote is open: the build is
	// recorded, but no new vote opens.
	out := (Caravans{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvSettlementBuilt, map[string]any{"player": s.Cur}),
		engine.NewEvent(engine.EvTurnEnded, engine.TurnEndedData{Player: s.Cur})})
	built := false
	for _, e := range out {
		if e.Type == EvCamelVote {
			t.Fatal("a second camel vote opened on top of an in-flight one")
		}
		if e.Type == EvCamelBuilt {
			built = true
		}
	}
	if !built {
		t.Fatal("the build during the vote was not recorded")
	}
	if !x.Bidded[bidder] {
		t.Fatal("the cast bid did not survive")
	}

	// The build survives the placement, so the next turn end opens the
	// vote it earned.
	for _, e := range out {
		e.Seq = s.NextSeq
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 20 && x.Voting; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("auto stuck")
		}
		step(t, s, cmd)
	}
	if !x.BuiltThisTurn {
		t.Fatal("the build made during the vote was lost when the camel was placed")
	}
	next := (Caravans{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvTurnEnded, engine.TurnEndedData{Player: s.Cur})})
	if len(next) != 1 || next[0].Type != EvCamelVote {
		t.Fatalf("the deferred build did not open a vote at turn end: %+v", next)
	}
}

// TestFishStealHonorsFriendlyRobber: the 3-fish steal is a steal, so the
// friendly-robber shield applies as for the base robber, the pirate, the knight
// chase and the Bishop. A protected seat is refused as a victim (ErrBadVictim),
// and the spender keeps their fish.
func TestFishStealHonorsFriendlyRobber(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 6)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := fishExt(s)
	setHeld(x, p, [3]int{20, 0, 0})

	s.Players[q].Hand = engine.Hand{}
	s.Players[q].Hand[board.Wheat] = 1
	if vp := s.PublicVPWithModules(q); vp > 2 {
		t.Fatalf("fixture: q at %d public VP, outside the shield", vp)
	}

	// Shield on: q is protected, so the steal is refused and nothing moves.
	s.Config.FriendlyRobber = true
	fishBefore := fishTotal(x.Held[p])
	_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": q})})
	if !errors.Is(err, engine.ErrBadVictim) {
		t.Fatalf("FishSteal against a friendly-robber-protected seat: err = %v, want ErrBadVictim", err)
	}
	if s.Players[q].Hand[board.Wheat] != 1 {
		t.Errorf("protected victim lost a card: %v", s.Players[q].Hand)
	}
	if got := fishTotal(x.Held[p]); got != fishBefore {
		t.Errorf("refused steal still charged fish: %d, want %d", got, fishBefore)
	}

	// Shield off: the same command robs q, so the check above is not passing
	// for an unrelated reason.
	s.Config.FriendlyRobber = false
	evs := step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": q})})
	if len(evs) != 2 || evs[1].Type != engine.EvCardStolen {
		t.Fatalf("without the shield the same steal should land: %+v", evs)
	}
	if s.Players[q].Hand[board.Wheat] != 0 {
		t.Errorf("victim still holds the card: %v", s.Players[q].Hand)
	}
}
