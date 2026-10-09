package scenarios

import (
	"errors"
	"maps"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// --- pickPlacer: the deterministic voting outcomes ------------------------

func TestPickPlacer(t *testing.T) {
	const finisher = engine.PlayerID(2)
	pid := func(i int) engine.PlayerID { return engine.PlayerID(i) }

	cases := []struct {
		name   string
		votes  map[engine.PlayerID]int
		want   engine.PlayerID
		reason string
	}{
		{"no votes falls to finisher", map[engine.PlayerID]int{}, finisher, camelReasonNobody},
		{"all zero falls to finisher", map[engine.PlayerID]int{pid(0): 0, pid(1): 0}, finisher, camelReasonNobody},
		// p0 has 5, others have 4 combined -> strict majority (5*2 > 9).
		{"strict majority wins", map[engine.PlayerID]int{pid(0): 5, pid(1): 4}, pid(0), camelReasonMajority},
		// Exact tie between two leaders -> finisher breaks it.
		{"tie falls to finisher", map[engine.PlayerID]int{pid(0): 3, pid(1): 3}, finisher, camelReasonTie},
		// Plurality without strict majority and without a tie -> the leader.
		// p0=4, p1=3, p2=2: best=4, total=9, 8 !> 9 (no strict majority), no tie.
		{"plurality no majority wins", map[engine.PlayerID]int{pid(0): 4, pid(1): 3, pid(2): 2}, pid(0), camelReasonMajority},
		// A tie below the top is no tie: p0 still has the most votes alone.
		{"tie below the leader still leaves a leader", map[engine.PlayerID]int{pid(0): 3, pid(1): 2, pid(2): 2}, pid(0), camelReasonMajority},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, agreed, reason := pickPlacer(c.votes, nil, finisher, 3)
			if got != c.want {
				t.Errorf("pickPlacer(%v) = %d, want %d", c.votes, got, c.want)
			}
			// Nobody named a placement, so no coalition can form and the
			// winner still gets to choose.
			if agreed != nil {
				t.Errorf("pickPlacer(%v) agreed on %+v with no placements named", c.votes, agreed)
			}
			// The client renders three different sentences off the reason, and
			// "the finisher places" covers two outcomes that must read differently.
			if reason != c.reason {
				t.Errorf("pickPlacer(%v) reason = %q, want %q", c.votes, reason, c.reason)
			}
		})
	}
}

// --- sharedVertex: both A-match and B-match branches ----------------------

func TestSharedVertex(t *testing.T) {
	// Build two adjacent edges sharing a known vertex via a hex's edges.
	var a, b board.Edge
	for _, h := range board.HexesInRadius(2) {
		edges := h.Edges()
		// Consecutive perimeter edges of a hex share a vertex.
		a, b = edges[0], edges[1]
		break
	}
	v := sharedVertex(a, b)
	// The shared vertex must be an endpoint of both edges.
	onA := v == a.A || v == a.B
	onB := v == b.A || v == b.B
	if !onA || !onB {
		t.Fatalf("sharedVertex(%v,%v)=%v not shared", a, b, v)
	}
	// Reverse the argument order to exercise the other matching branch.
	v2 := sharedVertex(b, a)
	if v2 != v {
		t.Errorf("sharedVertex not symmetric: %v vs %v", v, v2)
	}
}

// --- Name(): both modules ------------------------------------------------

func TestModuleNames(t *testing.T) {
	if (Caravans{}).Name() != CaravansName {
		t.Errorf("Caravans.Name = %q", (Caravans{}).Name())
	}
	if (Fishermen{}).Name() != FishermenName {
		t.Errorf("Fishermen.Name = %q", (Fishermen{}).Name())
	}
}

// --- ViewExt: both modules, including the voting branch -------------------

func TestCaravansViewExt(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	x := caravansExt(s)
	// Seed a placed camel and an open vote so both branches render.
	arrow := x.Arrows[0]
	if arrow == (board.Edge{}) {
		t.Fatal("no arrow")
	}
	x.Chains[0] = []board.Edge{arrow}
	x.Occupied[arrow] = true
	x.Voting = true
	x.Finisher = 1
	x.Placer = engine.NoPlayer
	x.Bids = map[engine.PlayerID]CamelBid{0: {Cards: [2]int{2, 0}}}

	v, ok := x.ViewExt(0).(map[string]any)
	if !ok {
		t.Fatalf("ViewExt type = %T", x.ViewExt(0))
	}
	if v["camels_left"] != x.CamelsLeft {
		t.Errorf("camels_left = %v", v["camels_left"])
	}
	if n := reflect.ValueOf(v["camels"]).Len(); n != 1 {
		t.Errorf("camels view len = %d, want 1", n)
	}
	if v["voting"] != true || v["finisher"] != engine.PlayerID(1) {
		t.Errorf("voting view missing: %#v", v)
	}

	// Non-voting state must omit the voting keys.
	x.Voting = false
	v2 := x.ViewExt(0).(map[string]any)
	if _, present := v2["voting"]; present {
		t.Error("voting key present when not voting")
	}
}

func TestFishViewExt(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 4)
	x := fishExt(s)
	setHeld(x, 0, [3]int{1, 1, 1}) // three tiles, worth 1 + 2 + 3 = 6
	x.BootHolder = 2

	v, ok := x.ViewExt(0).(map[string]any)
	if !ok {
		t.Fatalf("ViewExt type = %T", x.ViewExt(0))
	}
	// The public number is the tile count, not the value: see FishExt.Tiles.
	counts, ok := v["tiles"].([]int)
	if !ok || counts[0] != 3 {
		t.Errorf("fish tile counts = %#v", v["tiles"])
	}
	if _, leaked := v["fish"]; leaked {
		t.Errorf("view publishes a per-seat fish value: %#v", v["fish"])
	}
	if v["boot_holder"] != engine.PlayerID(2) {
		t.Errorf("boot_holder = %v", v["boot_holder"])
	}
	if _, ok := v["grounds"]; !ok {
		t.Error("grounds missing from view")
	}
}

// The tile mix is the viewer's own. Counts are public; which tiles make
// them up is not. The spend panel needs the mix (fish give no change), but
// another seat's mix would expose holdings the redactor hides.
func TestFishViewExtMixIsPrivate(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 4)
	x := fishExt(s)
	setHeld(x, 0, [3]int{1, 1, 1})
	setHeld(x, 1, [3]int{0, 0, 2})

	mine, ok := x.ViewExt(0).(map[string]any)["mix"].([3]int)
	if !ok || mine != ([3]int{1, 1, 1}) {
		t.Errorf("own mix = %#v, want {1 1 1}", x.ViewExt(0).(map[string]any)["mix"])
	}
	theirs := x.ViewExt(1).(map[string]any)["mix"]
	if theirs != any([3]int{0, 0, 2}) {
		t.Errorf("seat 1 sees %#v as its own mix", theirs)
	}
	// A spectator gets no mix at all rather than seat 0's.
	if m, present := x.ViewExt(engine.NoPlayer).(map[string]any)["mix"]; present {
		t.Errorf("spectator was handed a mix: %#v", m)
	}
}

// The 2-fish spend's availability, which is all the client needs: the
// spend removes the robber, so the only questions are whether the seat
// can pay and whether the robber is on the board.
func TestFishRemoveRobberAvailability(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 4)

	// Setup leaves the robber beside the board (it enters on the first 7),
	// so the spend has nothing to remove and is refused before payment.
	if s.Board.RobberOnBoard() {
		t.Fatalf("robber starts on %v, want beside the board", s.Board.Robber)
	}
	// Refused before the turn is even actionable, so the command order
	// cannot be used to pay for it.
	if _, _, err := (Fishermen{}).Decide(s, removeRobberCmd(t, s.Cur)); !errors.Is(err, ErrSpendUnavailable) {
		t.Errorf("spend with no robber on the board: err = %v, want ErrSpendUnavailable", err)
	}

	rolled(t, s)
	seat := s.Cur
	setHeld(fishExt(s), seat, [3]int{2, 0, 0}) // exactly the 2-fish price

	// Once the robber is on the board the spend is available, and it takes
	// the robber off rather than moving it.
	robberOntoProducing(t, s)
	evs, _, err := (Fishermen{}).Decide(s, removeRobberCmd(t, seat))
	if err != nil {
		t.Fatalf("spend refused with the robber in play: %v", err)
	}
	for _, e := range evs {
		if e.Type != engine.EvRobberMoved {
			continue
		}
		if got := engine.DecodeEvent[engine.RobberMovedData](e).Hex; got != board.OffBoard {
			t.Errorf("robber sent to %v, want board.OffBoard", got)
		}
	}

	// Under Knights the robber is locked away until the barbarians first
	// land, and the spend is refused while it is. This follows the state,
	// not the ruleset.
	k, _ := newGame(t, "base+cak+fishermen", 4)
	rolled(t, k)
	setHeld(fishExt(k), k.Cur, [3]int{4, 0, 0})
	if !engine.RobberSuppressed(k) {
		t.Fatal("expected the robber to start suppressed under Knights")
	}
	if _, _, err := (Fishermen{}).Decide(k, removeRobberCmd(t, k.Cur)); !errors.Is(err, ErrSpendUnavailable) {
		t.Errorf("spend while the robber is locked away: err = %v, want ErrSpendUnavailable", err)
	}
}

func removeRobberCmd(t *testing.T, seat engine.PlayerID) engine.Command {
	t.Helper()
	return engine.Command{Player: seat, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishRemoveRobber})}
}

// --- caravanFront: the multi-segment (len >= 2) branch --------------------

func TestCaravanFrontMultiSegment(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	x := caravansExt(s)
	arrow := x.Arrows[0]
	if arrow == (board.Edge{}) {
		t.Fatal("no arrow")
	}
	x.Chains[0] = []board.Edge{arrow}
	x.Occupied[arrow] = true
	exts := (Caravans{}).caravanFrontEdges(x, s, 0)
	if len(exts) == 0 {
		t.Fatal("no extension from arrow")
	}
	ext := exts[0]
	x.Chains[0] = append(x.Chains[0], ext)
	x.Occupied[ext] = true

	// With a two-edge chain caravanFront uses the prev/shared/Other path.
	front := caravanFront(x, 0)
	// The front vertex must be an endpoint of the last edge and not the one it
	// shares with the previous edge.
	shared := sharedVertex(ext, arrow)
	if front == shared {
		t.Errorf("front returned the shared vertex %v, want the open end", front)
	}
	if front != ext.A && front != ext.B {
		t.Errorf("front %v is not an endpoint of last edge %v", front, ext)
	}
}

// --- isLegalPath: out-of-range caravan index -----------------------------

func TestIsLegalPathOutOfRange(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	x := caravansExt(s)
	some := x.Arrows[0]
	if (Caravans{}).isLegalPath(x, s, -1, some) {
		t.Error("negative caravan accepted")
	}
	if (Caravans{}).isLegalPath(x, s, caravansPerOasis, some) {
		t.Error("out-of-range caravan accepted")
	}
}

// --- auto: not-voting and no-legal-path early returns ---------------------

func TestCaravansAutoNotVoting(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	if _, ok := (Caravans{}).auto(s, engine.NoPlayer); ok {
		t.Error("auto produced a command while not voting")
	}
}

// auto in the placement phase with no legal paths (all camels exhausted) must
// produce no command rather than spin.
func TestCaravansAutoPlacementNoPaths(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	x := caravansExt(s)
	x.Voting = true
	x.Placer = 0
	x.CamelsLeft = 0 // legalPaths returns nothing
	if _, ok := (Caravans{}).auto(s, engine.NoPlayer); ok {
		t.Error("auto produced a placement command with no legal paths")
	}
}

// Caravans.FinishBoard only ever repairs a board that lost its oasis; a board
// that already has a desert must come back untouched.
func TestCaravansFinishBoardNoOp(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	before := make(map[board.Hex]board.Tile, len(s.Board.Tiles))
	maps.Copy(before, s.Board.Tiles)
	(Caravans{}).FinishBoard(s.Board, engine.GameConfig{}, testRNG())
	if !reflect.DeepEqual(before, s.Board.Tiles) {
		t.Error("Caravans.FinishBoard mutated the board")
	}
}

// --- decideBid: error branches -------------------------------------------

func TestDecideBidErrors(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	m := Caravans{}

	// Not voting yet -> wrong phase.
	if _, err := m.decideBid(s, engine.Command{Player: 0, Type: CmdBidCamel,
		Data: mustJSON(t, map[string]any{"cards": [2]int{0, 0}})}); !errors.Is(err, engine.ErrWrongPhase) {
		t.Errorf("not-voting bid err = %v, want ErrWrongPhase", err)
	}

	// Open a vote.
	x := caravansExt(s)
	x.Voting = true
	x.Placer = engine.NoPlayer
	x.Finisher = 0

	// Out-of-range player.
	if _, err := m.decideBid(s, engine.Command{Player: engine.PlayerID(len(s.Players)),
		Type: CmdBidCamel, Data: mustJSON(t, map[string]any{"cards": [2]int{0, 0}})}); !errors.Is(err, engine.ErrNotYourTurn) {
		t.Errorf("oob bidder err = %v, want ErrNotYourTurn", err)
	}

	// Already bid.
	x.Bidded[1] = true
	if _, err := m.decideBid(s, engine.Command{Player: 1, Type: CmdBidCamel,
		Data: mustJSON(t, map[string]any{"cards": [2]int{0, 0}})}); !errors.Is(err, ErrAlreadyBid) {
		t.Errorf("double bid err = %v, want ErrAlreadyBid", err)
	}

	// Negative bid.
	if _, err := m.decideBid(s, engine.Command{Player: 0, Type: CmdBidCamel,
		Data: mustJSON(t, map[string]any{"cards": [2]int{-1, 0}})}); !errors.Is(err, engine.ErrBadCommand) {
		t.Errorf("negative bid err = %v, want ErrBadCommand", err)
	}

	// Bid more than the hand holds.
	s.Players[0].Hand = engine.Hand{}
	if _, err := m.decideBid(s, engine.Command{Player: 0, Type: CmdBidCamel,
		Data: mustJSON(t, map[string]any{"cards": [2]int{5, 0}})}); !errors.Is(err, engine.ErrNoResources) {
		t.Errorf("overbid err = %v, want ErrNoResources", err)
	}
}

// --- decidePlace: error branches -----------------------------------------

func TestDecidePlaceErrors(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	m := Caravans{}
	x := caravansExt(s)

	good := mustJSON(t, camelPlacedData{Caravan: 0, E: x.Arrows[0]})

	// Not in placement phase (Placer == NoPlayer) -> wrong phase.
	x.Voting = true
	x.Placer = engine.NoPlayer
	if _, err := m.decidePlace(s, engine.Command{Player: 0, Type: CmdPlaceCamel, Data: good}); !errors.Is(err, engine.ErrWrongPhase) {
		t.Errorf("pre-placement err = %v, want ErrWrongPhase", err)
	}

	// Placement open but wrong player.
	x.Placer = 0
	if _, err := m.decidePlace(s, engine.Command{Player: 1, Type: CmdPlaceCamel, Data: good}); !errors.Is(err, engine.ErrNotYourTurn) {
		t.Errorf("wrong placer err = %v, want ErrNotYourTurn", err)
	}

	// Illegal target edge for caravan 0 (an edge with no relation to the front).
	bad := mustJSON(t, camelPlacedData{Caravan: 0, E: board.Edge{}})
	if _, err := m.decidePlace(s, engine.Command{Player: 0, Type: CmdPlaceCamel, Data: bad}); !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("illegal placement err = %v, want ErrBadPlacement", err)
	}

	// A legal placement on the arrow succeeds.
	evs, err := m.decidePlace(s, engine.Command{Player: 0, Type: CmdPlaceCamel, Data: good})
	if err != nil || len(evs) != 1 || evs[0].Type != EvCamelPlaced {
		t.Fatalf("legal placement: evs=%+v err=%v", evs, err)
	}
}

// --- Caravans.Decide: unknown command not handled ------------------------

func TestCaravansDecideUnhandled(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	evs, handled, err := (Caravans{}).Decide(s, engine.Command{Player: 0, Type: "totally_unknown"})
	if handled || err != nil || evs != nil {
		t.Errorf("unknown cmd: handled=%v err=%v evs=%v", handled, err, evs)
	}
}

func TestFishermenDecideUnhandled(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 4)
	evs, handled, err := (Fishermen{}).Decide(s, engine.Command{Player: 0, Type: "totally_unknown"})
	if handled || err != nil || evs != nil {
		t.Errorf("unknown cmd: handled=%v err=%v evs=%v", handled, err, evs)
	}
}

// --- decideSpend: every validation/error branch --------------------------

func TestDecideSpendErrors(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 1)
	m := Fishermen{}
	rolled(t, s)
	p := s.Cur

	// Unknown use.
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": "nonsense"})}); !errors.Is(err, engine.ErrBadCommand) {
		t.Errorf("bad use err = %v, want ErrBadCommand", err)
	}

	// Known use but not enough fish. The 4-fish bank spend, because the
	// 2-fish one is refused earlier (no robber on the board until the
	// first 7), before the price is checked.
	setHeld(fishExt(s), p, [3]int{})
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishTakeResource, "res": board.Wood})}); !errors.Is(err, ErrNoFish) {
		t.Errorf("broke fisherman err = %v, want ErrNoFish", err)
	}

	// Give plenty of fish for the rest.
	setHeld(fishExt(s), p, [3]int{30, 0, 0})

	// steal: nil victim.
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal})}); !errors.Is(err, engine.ErrBadVictim) {
		t.Errorf("nil steal victim err = %v, want ErrBadVictim", err)
	}
	// steal: self.
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": p})}); !errors.Is(err, engine.ErrBadVictim) {
		t.Errorf("self steal err = %v, want ErrBadVictim", err)
	}
	// steal: victim with an empty hand.
	victim := (p + 1) % engine.PlayerID(len(s.Players))
	s.Players[victim].Hand = engine.Hand{}
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": victim})}); !errors.Is(err, engine.ErrBadVictim) {
		t.Errorf("empty-hand steal err = %v, want ErrBadVictim", err)
	}
	// steal: a victim holding a card succeeds.
	s.Players[victim].Hand = engine.Hand{}
	s.Players[victim].Hand[board.Wood] = 1
	if evs, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": victim})}); err != nil || len(evs) != 2 {
		t.Errorf("steal success: evs=%+v err=%v", evs, err)
	}

	// take_resource: out-of-range res.
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishTakeResource, "res": board.ResNone})}); !errors.Is(err, engine.ErrNoResources) {
		t.Errorf("bad take res err = %v, want ErrNoResources", err)
	}
	// take_resource: bank empty for the chosen resource.
	s.Bank[board.Ore] = 0
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishTakeResource, "res": board.Ore})}); !errors.Is(err, engine.ErrNoResources) {
		t.Errorf("empty-bank take err = %v, want ErrNoResources", err)
	}

	// free_road: nil edge.
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad})}); !errors.Is(err, engine.ErrBadCommand) {
		t.Errorf("nil free-road edge err = %v, want ErrBadCommand", err)
	}
	// free_road: an edge that is not a legal road placement for this seat
	// buys nothing, so it is refused rather than charged.
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad, "e": illegalRoadEdge(t, s, p)})}); !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("illegal free-road edge err = %v, want ErrBadPlacement", err)
	}
	// free_road: no roads left in the player's supply. LegalRoads is empty then,
	// so an otherwise-legal edge is refused too.
	legal := s.LegalRoads(p)
	if len(legal) == 0 {
		t.Fatal("no legal road edge to test with")
	}
	s.Players[p].RoadsLeft = 0
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad, "e": legal[0]})}); !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("no-road-supply free-road err = %v, want ErrBadPlacement", err)
	}

	// dev_card: empty deck.
	s.DevDeck = engine.DevHand{}
	if _, err := m.decideSpend(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishDevCard})}); !errors.Is(err, engine.ErrDeckEmpty) {
		t.Errorf("empty deck dev err = %v, want ErrDeckEmpty", err)
	}
}

// decideSpend off-turn must be rejected by the actionable-turn guard.
func TestDecideSpendOffTurn(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 1)
	rolled(t, s)
	other := (s.Cur + 1) % engine.PlayerID(len(s.Players))
	setHeld(fishExt(s), other, [3]int{30, 0, 0})
	if _, err := (Fishermen{}).decideSpend(s, engine.Command{Player: other, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishTakeResource, "res": board.Wood})}); err == nil {
		t.Error("off-turn spend accepted")
	}
}

// --- decideGiveBoot: error branches --------------------------------------

func TestDecideGiveBootErrors(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 4)
	m := Fishermen{}
	rolled(t, s)
	p := s.Cur
	x := fishExt(s)

	// Not the holder.
	x.BootHolder = engine.NoPlayer
	if _, err := m.decideGiveBoot(s, engine.Command{Player: p, Type: CmdGiveBoot,
		Data: mustJSON(t, map[string]any{"to": 1})}); !errors.Is(err, engine.ErrBadCommand) {
		t.Errorf("non-holder boot err = %v, want ErrBadCommand", err)
	}

	x.BootHolder = p
	// Give to self.
	if _, err := m.decideGiveBoot(s, engine.Command{Player: p, Type: CmdGiveBoot,
		Data: mustJSON(t, map[string]any{"to": p})}); !errors.Is(err, ErrBootRecipient) {
		t.Errorf("self boot err = %v, want ErrBootRecipient", err)
	}
	// Out-of-range target.
	if _, err := m.decideGiveBoot(s, engine.Command{Player: p, Type: CmdGiveBoot,
		Data: mustJSON(t, map[string]any{"to": len(s.Players)})}); !errors.Is(err, ErrBootRecipient) {
		t.Errorf("oob boot target err = %v, want ErrBootRecipient", err)
	}

	// Off-turn handing is rejected by the actionable-turn guard.
	other := (p + 1) % engine.PlayerID(len(s.Players))
	x.BootHolder = other
	if _, err := m.decideGiveBoot(s, engine.Command{Player: other, Type: CmdGiveBoot,
		Data: mustJSON(t, map[string]any{"to": p})}); err == nil {
		t.Error("off-turn boot hand accepted")
	}
}

// --- drawTile: the 3-fish slot (last index) branch -----------------------

func TestDrawTileLastSlot(t *testing.T) {
	rng := engine.RngFor(&engine.State{Seed: 7}, 0)
	// Only 3-fish tiles remain: every draw must land on index 2.
	supply := [3]int{0, 0, 4}
	for i := range 4 {
		if v := drawTile(&supply, rng); v != 2 {
			t.Fatalf("draw %d returned slot %d, want 2", i, v)
		}
	}
	if supply != ([3]int{0, 0, 0}) {
		t.Errorf("supply after draws = %v, want empty", supply)
	}
}

// --- weightedDrawer: distributes across all non-zero buckets -------------

func TestWeightedDrawer(t *testing.T) {
	rng := engine.RngFor(&engine.State{Seed: 9}, 0)
	// Only player 1 drew tiles -> the boot can only land on player 1.
	draws := []int{0, 3, 0}
	for range 10 {
		if got := weightedDrawer(draws, rng); got != engine.PlayerID(1) {
			t.Fatalf("weightedDrawer = %d, want 1", got)
		}
	}
}

// setHeld gives a seat a fish mix in a test fixture, keeping the public tile
// count in step. Setting FishExt.Held alone leaves Tiles stale, a state the
// engine cannot reach (on the truth state Tiles is always the tile count of
// Held).
func setHeld(x *FishExt, p engine.PlayerID, mix [3]int) {
	x.ensureTiles()
	x.Held[p] = mix
	x.Tiles[p] = tileCount(mix)
}
