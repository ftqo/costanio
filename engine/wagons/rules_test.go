package wagons

import (
	"bytes"
	"encoding/gob"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// --- the cargo cycle -------------------------------------------------------

// Conformance: "Castle accepts marble and glass, ships tools and sand; quarry
// accepts tools, ships marble and sand; glassworks accepts sand, ships glass and
// tools. Assert the invariant that no hex ships a cargo it accepts, so a draw
// always points elsewhere."
func TestCargoCycleNeverShipsWhatItAccepts(t *testing.T) {
	for role := range uint8(tradeHexCount) {
		for _, out := range shipsOf(role) {
			for _, in := range acceptsOf(role) {
				if out == in {
					t.Fatalf("role %d both ships and accepts cargo %d", role, out)
				}
			}
		}
	}
	// The cycle is closed: every cargo any hex ships is accepted somewhere.
	accepted := map[uint8]bool{}
	for role := range uint8(tradeHexCount) {
		for _, in := range acceptsOf(role) {
			accepted[in] = true
		}
	}
	for role := range uint8(tradeHexCount) {
		for _, out := range shipsOf(role) {
			if !accepted[out] {
				t.Fatalf("role %d ships cargo %d, which no hex accepts", role, out)
			}
		}
	}
}

// Conformance: "Cargo stacks. 6 + 6 per hex, drawn without replacement, refilled
// with a fresh shuffled 6-and-6 on exhaustion. Seeded from the game seed on a
// reserved stream; the carried token is public, the stack order is not."
func TestCargoStackDrawsWithoutReplacement(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	for i := range tradeHexCount {
		order := stackOrder(s, x, i)
		if len(order) != stackDepth {
			t.Fatalf("hex %d's stack holds %d tokens, want %d", i, len(order), stackDepth)
		}
		counts := map[uint8]int{}
		for _, c := range order {
			counts[c]++
		}
		sh := shipsOf(x.Roles[i])
		if counts[sh[0]] != perCargo || counts[sh[1]] != perCargo {
			t.Fatalf("hex %d's stack is %v, want %d of each of %v", i, counts, perCargo, sh)
		}
		if len(counts) != 2 {
			t.Fatalf("hex %d's stack carries %d kinds of cargo, want its two", i, len(counts))
		}
	}
}

// An empty stack is refilled with a fresh shuffled 6-and-6. Large games
// exhaust stacks routinely.
func TestCargoStackRefillsWhenItEmpties(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	first := stackOrder(s, x, 0)
	// Draw the whole stack, one fold at a time.
	for n := range stackDepth {
		want := first[n]
		fire(t, s, []engine.Event{engine.NewEvent(EvLoaded, loadedData{Player: p, Hex: 0, Cargo: want})})
		if x.Cargo[p] != want {
			t.Fatalf("draw %d dealt %d, want the stack's %d", n, x.Cargo[p], want)
		}
		x.Cargo[p] = CargoNone
	}
	if x.Drawn[0] != 0 || x.Refill[0] != 1 {
		t.Fatalf("after 12 draws the stack is at draw %d of filling %d, want 0 of 1", x.Drawn[0], x.Refill[0])
	}
	second := stackOrder(s, x, 0)
	if len(second) != stackDepth {
		t.Fatalf("the refilled stack holds %d, want %d", len(second), stackDepth)
	}
	// The refill reads its own reserved slot, so it is a fresh shuffle.
	same := true
	for i := range first {
		if first[i] != second[i] {
			same = false
		}
	}
	if same {
		t.Fatal("refilled stack has the same order")
	}
}

// The stack order is never written into an event or the view, only derived
// from the private seed. Only the remaining count travels.
func TestStackOrderHiddenFromView(t *testing.T) {
	_, x := opened(t, 4, "base+wagons")
	v, ok := x.ViewExt(0).(map[string]any)
	if !ok {
		t.Fatal("the view is not an object")
	}
	// The order is not a field of the ext at all.
	for _, key := range []string{"stack", "stacks", "order", "deck"} {
		if _, present := v[key]; present {
			t.Fatalf("view publishes %q", key)
		}
	}
	if _, present := v["trade"]; !present {
		t.Fatal("the view does not publish the trade hexes at all")
	}
}

// --- the wagon track -------------------------------------------------------

// Conformance: "Upgrades cost 1/1/2/2 lumber with 1 wool and 1 ore each, bought
// during trading and building, one level at a time, level 5 worth 1 VP."
func TestUpgradeCostsAndOneLevelAtATime(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	want := []engine.Hand{
		{board.Wood: 1, board.Sheep: 1, board.Ore: 1},
		{board.Wood: 1, board.Sheep: 1, board.Ore: 1},
		{board.Wood: 2, board.Sheep: 1, board.Ore: 1},
		{board.Wood: 2, board.Sheep: 1, board.Ore: 1},
	}
	park(x, p, centre, 1, 0, CargoNone)
	for level := 1; level <= maxLevel-1; level++ {
		if got := upgradeCost(level); got != want[level-1] {
			t.Fatalf("level %d to %d costs %v, want %v", level, level+1, got, want[level-1])
		}
		// One level at a time, and only what the hand actually pays for.
		s.Players[p].Hand = engine.Hand{}
		refuse(t, s, cmd(p, CmdUpgrade, nil), engine.ErrNoResources)
		s.Players[p].Hand = want[level-1]
		bank := s.Bank
		do(t, s, cmd(p, CmdUpgrade, nil))
		if x.Level[p] != level+1 {
			t.Fatalf("the wagon is at level %d, want %d", x.Level[p], level+1)
		}
		if s.Players[p].Hand.Count() != 0 {
			t.Fatalf("the upgrade left %v in hand", s.Players[p].Hand)
		}
		for r := range bank {
			if s.Bank[r] != bank[r]+want[level-1][r] {
				t.Fatalf("resource %d: bank went %d to %d, want +%d", r, bank[r], s.Bank[r], want[level-1][r])
			}
		}
	}
	// There is no way past 5 and no way back down.
	s.Players[p].Hand = engine.Hand{board.Wood: 9, board.Sheep: 9, board.Ore: 9}
	refuse(t, s, cmd(p, CmdUpgrade, nil), ErrMaxLevel)
}

// Reaching level 5 is worth 1 VP. Levels 1 to 4 are worth none.
func TestLevelFiveIsWorthOneVictoryPoint(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	for level := 1; level <= maxLevel; level++ {
		x.Level[p] = level
		want := 0
		if level == maxLevel {
			want = levelVP
		}
		if got := (Wagons{}).victory(s, p) - x.Landed[p]; got != want {
			t.Fatalf("level %d contributes %d VP, want %d", level, got, want)
		}
	}
}

// The track is bought during trading and building, not once a movement action
// is open.
func TestUpgradeIsRefusedOnceTheWagonIsMoving(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, centre, 1, 0, CargoNone)
	s.Players[p].Hand = upgradeCost(1)
	x.MoveOpen, x.MP = true, 2
	refuse(t, s, cmd(p, CmdUpgrade, nil), ErrMovementOver)
	x.MoveOpen, x.MP = false, 0
	do(t, s, cmd(p, CmdUpgrade, nil))
}

// --- driving a barbarian off ------------------------------------------------

// Conformance: "Drive-off requires level 2+, one die against the level's range,
// one attempt per barbarian per turn, from any intersection the wagon occupies
// during its movement, costs no MP, never steals, and does not end the
// movement."
func TestDriveOffRanges(t *testing.T) {
	// 6 at level 2, 5 or 6 at 3, 4-6 at 4, 3-6 at 5, never at 1.
	for _, tc := range []struct{ level, floor int }{
		{1, 7}, {2, 6}, {3, 5}, {4, 4}, {5, 3},
	} {
		if got := driveOffFloor(tc.level); got != tc.floor {
			t.Fatalf("level %d drives off on %d or better, want %d", tc.level, got, tc.floor)
		}
	}
}

func TestDriveOffNeedsLevelTwo(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	// Stand the wagon on one end of barbarian 0's path.
	park(x, p, x.Barb[0].A, 1, 0, CargoNone)
	refuse(t, s, cmd(p, CmdCharge, map[string]any{"barb": 0}), ErrWagonLevel)
	x.Level[p] = 2
	do(t, s, cmd(p, CmdCharge, map[string]any{"barb": 0}))
}

func TestDriveOffOncePerBarbarianPerTurn(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, x.Barb[0].A, maxLevel, 0, CargoNone)
	evs := do(t, s, cmd(p, CmdCharge, map[string]any{"barb": 0}))
	d := engine.DecodeEvent[chargedData](evs[0])
	if d.Die < 1 || d.Die > 6 {
		t.Fatalf("the drive-off die came up %d", d.Die)
	}
	// The attempt costs no MP and does not end the movement.
	if x.MP != allowance(s, maxLevel) {
		t.Fatalf("the attempt left %d MP, want the untouched allowance %d", x.MP, allowance(s, maxLevel))
	}
	if x.MoveDone {
		t.Fatal("a drive-off ended the movement")
	}
	// Never steals, whichever way the die fell.
	for _, e := range evs {
		if e.Type == engine.EvCardStolen {
			t.Fatal("a drive-off stole a card")
		}
	}
	// One attempt per barbarian per turn.
	if x.BarbSeat != engine.NoPlayer {
		// It carried: place the barbarian so the turn can go on, then re-try.
		homes := barbarianHomes(s, x)
		do(t, s, cmd(p, CmdBarbarian, map[string]any{"barb": 0, "e": homes[0]}))
	}
	refuse(t, s, cmd(p, CmdCharge, map[string]any{"barb": 0}), ErrAlreadyCharged)
	// A fresh turn gives the attempt back.
	fire(t, s, []engine.Event{engine.NewEvent(EvTurn, turnData{Player: p})})
	if x.Tried != ([tradeHexCount]bool{}) {
		t.Fatal("a new turn did not give the drive-off attempts back")
	}
}

// The die is drawn from the public stream, so it is reproducible from the
// public seed alone.
func TestDriveOffDieOnPublicStream(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, x.Barb[0].A, maxLevel, 0, CargoNone)
	want := engine.PublicRngForSeed(s.PublicSeed, engine.WagonsDieSeq(s.NextSeq)).IntN(6) + 1
	evs := do(t, s, cmd(p, CmdCharge, map[string]any{"barb": 0}))
	got := engine.DecodeEvent[chargedData](evs[0]).Die
	if got != want {
		t.Fatalf("die = %d, want %d from the public seed", got, want)
	}
}

// --- a 7 --------------------------------------------------------------------

// Conformance: "A 7 produces nothing, discards normally with gold excluded,
// moves one barbarian to a different unoccupied path, and steals a resource
// (never gold) if that path holds a road."
func TestSevenMovesABarbarianAndNeverTheRobber(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	fire(t, s, (Wagons{}).onSeven(s))
	if x.BarbSeat != p || x.BarbIdx != -1 || !x.BarbSteal {
		t.Fatalf("after a 7 the module owes seat %d barbarian %d (steal %v), want %d, any, true",
			x.BarbSeat, x.BarbIdx, x.BarbSteal, p)
	}
	if s.RobberPending {
		t.Fatal("a 7 armed the robber in a game the robber is out of")
	}
	// The player picks which of the three; it must end on a different path that
	// no barbarian holds.
	refuse(t, s, cmd(p, CmdBarbarian, map[string]any{"barb": 0, "e": x.Barb[0]}), ErrBarbarianSpot)
	refuse(t, s, cmd(p, CmdBarbarian, map[string]any{"barb": 0, "e": x.Barb[1]}), ErrBarbarianSpot)
	homes := barbarianHomes(s, x)
	if len(homes) == 0 {
		t.Fatal("nowhere for a barbarian to go")
	}
	do(t, s, cmd(p, CmdBarbarian, map[string]any{"barb": 1, "e": homes[0]}))
	if x.Barb[1] != homes[0] {
		t.Fatalf("barbarian 1 is on %v, want %v", x.Barb[1], homes[0])
	}
	if x.BarbSeat != engine.NoPlayer {
		t.Fatal("the interrupt stayed open after the barbarian was placed")
	}
}

// A barbarian landing on a road steals one random resource from that road's
// owner. Gold is not in the hand, so it is never stolen.
func TestBarbarianOnRoadStealsNoGold(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p, them := s.Cur, engine.PlayerID(1)
	fire(t, s, (Wagons{}).onSeven(s))
	homes := barbarianHomes(s, x)
	target := homes[0]
	s.Roads[target] = them
	s.Players[them].Hand = engine.Hand{board.Ore: 1}
	s.Players[p].Hand = engine.Hand{}
	x.Gold[them] = 9
	evs := do(t, s, cmd(p, CmdBarbarian, map[string]any{"barb": 0, "e": target}))
	stole := false
	for _, e := range evs {
		if e.Type == engine.EvCardStolen {
			stole = true
		}
	}
	if !stole {
		t.Fatal("barbarian on a road stole nothing")
	}
	if s.Players[them].Hand.Count() != 0 || s.Players[p].Hand[board.Ore] != 1 {
		t.Fatalf("steal moved no card: victim %v thief %v", s.Players[them].Hand, s.Players[p].Hand)
	}
	if x.Gold[them] != 9 {
		t.Fatalf("victim gold = %d, want 9", x.Gold[them])
	}
	// A seat with only gold has nothing to lose.
	fire(t, s, (Wagons{}).onSeven(s))
	homes = barbarianHomes(s, x)
	s.Roads[homes[0]] = them
	evs = do(t, s, cmd(p, CmdBarbarian, map[string]any{"barb": 1, "e": homes[0]}))
	for _, e := range evs {
		if e.Type == engine.EvCardStolen {
			t.Fatal("barbarian stole from a seat holding only gold")
		}
	}
}

// Gold is not counted toward the hand limit and is never discarded.
func TestGoldIsOutsideTheHandLimitAndTheDiscard(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	s.Players[p].Hand = engine.Hand{board.Ore: 3}
	x.Gold[p] = 40
	if got := s.DiscardableCount(p); got != 3 {
		t.Fatalf("a seat with 3 cards and 40 gold counts %d for the discard, want 3", got)
	}
	if got := s.DiscardThreshold(p); got != s.Config.DiscardLimit {
		t.Fatalf("gold moved the discard threshold to %d", got)
	}
}

// --- gold -------------------------------------------------------------------

// Conformance: "2-for-a-resource twice per turn bank-limited."
func TestGoldBuysTwoPerTurnBankLimited(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, centre, 1, 6, CargoNone)
	s.Players[p].Hand = engine.Hand{}
	for n := range buysPerTurn {
		before := s.Bank[board.Ore]
		do(t, s, cmd(p, CmdBuy, map[string]any{"res": board.Ore}))
		if s.Players[p].Hand[board.Ore] != n+1 {
			t.Fatalf("buy %d left %d ore in hand", n, s.Players[p].Hand[board.Ore])
		}
		if s.Bank[board.Ore] != before-1 {
			t.Fatalf("the bank went %d to %d", before, s.Bank[board.Ore])
		}
	}
	if x.Gold[p] != 6-buysPerTurn*goldPerResource {
		t.Fatalf("two purchases cost %d gold, want %d", 6-x.Gold[p], buysPerTurn*goldPerResource)
	}
	refuse(t, s, cmd(p, CmdBuy, map[string]any{"res": board.Ore}), ErrGoldLimit)
	// A fresh turn gives the two back.
	fire(t, s, []engine.Event{engine.NewEvent(EvTurn, turnData{Player: p})})
	if x.Bought != 0 {
		t.Fatal("a new turn did not reset the gold purchases")
	}
	// Bank-limited like any other payout.
	x.Gold[p] = 4
	s.Bank[board.Ore] = 0
	refuse(t, s, cmd(p, CmdBuy, map[string]any{"res": board.Ore}), engine.ErrNoResources)
	// Two gold is the price.
	x.Gold[p] = 1
	s.Bank[board.Ore] = 5
	refuse(t, s, cmd(p, CmdBuy, map[string]any{"res": board.Ore}), ErrNoGold)
}

// Conformance: "bought from the bank at 4:1 / 3:1 / 2:1 by port".
//
// Ruling: the 2:1 port also buys gold, so this uses the seat's best rate
// without clamping.
func TestGoldIsBoughtAtTheSeatsPortRate(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, centre, 1, 0, CargoNone)
	rate := s.BankRatio(p, board.Ore)
	s.Players[p].Hand = engine.Hand{}
	s.Players[p].Hand[board.Ore] = rate - 1
	refuse(t, s, cmd(p, CmdSell, map[string]any{"res": board.Ore}), engine.ErrNoResources)
	s.Players[p].Hand[board.Ore] = rate
	do(t, s, cmd(p, CmdSell, map[string]any{"res": board.Ore}))
	if x.Gold[p] != 1 {
		t.Fatalf("the sale paid %d gold, want 1", x.Gold[p])
	}
	if s.Players[p].Hand[board.Ore] != 0 {
		t.Fatalf("the sale took %d ore, want the port rate %d", rate-s.Players[p].Hand[board.Ore], rate)
	}
}

// Gold may be included on either side of a player trade, the only way it moves
// between seats.
func TestGoldTravelsInAPlayerTrade(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	from, to := engine.PlayerID(0), engine.PlayerID(1)
	x.Gold[from], x.Gold[to] = 3, 0
	// The holding check is the module's.
	if n, held := (Wagons{}).tradeExtraHeld(s, from, raw(goldPayload{Gold: 3})); n != 3 || !held {
		t.Fatalf("a seat with 3 gold reported %d held=%v for a 3-gold payload", n, held)
	}
	if _, held := (Wagons{}).tradeExtraHeld(s, to, raw(goldPayload{Gold: 3})); held {
		t.Fatal("a seat with no gold was reported as holding 3")
	}
	fire(t, s, (Wagons{}).tradeExtraEvents(s, from, to, raw(goldPayload{Gold: 3})))
	if x.Gold[from] != 0 || x.Gold[to] != 3 {
		t.Fatalf("after the trade: %d and %d, want 0 and 3", x.Gold[from], x.Gold[to])
	}
}

// Gold is never a victory point. No amount of it scores and there is no
// end-of-game conversion.
func TestGoldIsNeverAVictoryPoint(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	before := victoryOfSeat(s, p)
	x.Gold[p] = 100
	if got := victoryOfSeat(s, p); got != before {
		t.Fatalf("100 gold moved the score from %d to %d", before, got)
	}
}

// --- the development deck ---------------------------------------------------

// Conformance: "Development deck replaced: 16 Knight (move a barbarian, steal
// from a road owner), 3 Road Building, 3 Swift Journey (a second movement action
// with a fresh allowance), 3 Victory Point. No Year of Plenty, no Monopoly."
func TestDevelopmentDeckIsReplaced(t *testing.T) {
	for _, tc := range []struct {
		players                    int
		knights, vp, roads, swifts int
	}{
		{4, 16, 3, 3, 3},
		{6, 22, 6, 3, 3},
		{8, 28, 9, 3, 3},
		{10, 34, 12, 3, 3},
	} {
		s := newGame(t, tc.players, "base+wagons")
		x, _ := StateExt(s)
		if got := s.DevDeck[engine.DevKnight]; got != tc.knights {
			t.Fatalf("%dp: %d knights, want %d", tc.players, got, tc.knights)
		}
		if got := s.DevDeck[engine.DevVictoryPoint]; got != tc.vp {
			t.Fatalf("%dp: %d victory-point cards, want %d", tc.players, got, tc.vp)
		}
		if got := s.DevDeck[engine.DevRoadBuilding]; got != tc.roads {
			t.Fatalf("%dp: %d road-building cards, want %d", tc.players, got, tc.roads)
		}
		if s.DevDeck[engine.DevYearOfPlenty] != 0 || s.DevDeck[engine.DevMonopoly] != 0 {
			t.Fatalf("%dp: deck holds %d Year of Plenty and %d Monopoly, want 0",
				tc.players, s.DevDeck[engine.DevYearOfPlenty], s.DevDeck[engine.DevMonopoly])
		}
		if x.SwiftLeft != tc.swifts {
			t.Fatalf("%dp: %d Swift Journeys, want %d", tc.players, x.SwiftLeft, tc.swifts)
		}
	}
}

// Alongside Knights there is no deck at all, so there is no Swift Journey
// either: "Knights already deletes the development deck, so this scenario's
// deck is not used either." A supply left at 3 would show unreachable cards in
// the view.
func TestKnightsLeavesNoSwiftJourney(t *testing.T) {
	s := newGame(t, 4, engine.CanonicalRuleset("base+cak+wagons"))
	x, ok := StateExt(s)
	if !ok {
		t.Fatal("no wagons ext")
	}
	if x.SwiftLeft != 0 {
		t.Fatalf("%d Swift Journeys in a Knights game, want none", x.SwiftLeft)
	}
	if got := (Wagons{}).extraDevCards(s); got != 0 {
		t.Fatalf("the deck reports %d module cards alongside Knights, want none", got)
	}
	// The base deck is gone too.
	for _, m := range s.Modules() {
		if m.Hooks().NoDevCards {
			return
		}
	}
	t.Fatal("no module in the ruleset removes the development deck")
}

// A Swift Journey is shuffled into the same deck at the same price.
func TestSwiftJourneyIsShuffledIntoTheDeck(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	if got := (Wagons{}).extraDevCards(s); got != x.SwiftLeft {
		t.Fatalf("the deck reports %d module cards, want the %d in supply", got, x.SwiftLeft)
	}
	// Buying draws over the whole deck. Repeat until a Swift Journey turns up,
	// which it must: three of a hundred-odd cards, over a hundred purchases.
	found := false
	for range 400 {
		if s.DevDeck.Count()+(Wagons{}).extraDevCards(s) == 0 {
			break
		}
		s.Players[p].Hand = engine.CostDevCard
		evs := do(t, s, cmd(p, engine.CmdBuyDevCard, nil))
		for _, e := range evs {
			if e.Type == EvSwiftBought {
				found = true
			}
		}
		if found {
			break
		}
		fire(t, s, []engine.Event{engine.NewEvent(EvTurn, turnData{Player: p})})
		s.PlayedDevThisTurn = false
	}
	if !found {
		t.Fatal("400 purchases from a deck holding three Swift Journeys drew none")
	}
	if x.SwiftLeft != 2 {
		t.Fatalf("the supply is at %d after one was drawn, want 2", x.SwiftLeft)
	}
	// The buyer holds it locked until next turn.
	if x.SwiftNew[p] != 1 {
		t.Fatalf("the buyer holds %d locked Swift Journeys, want 1", x.SwiftNew[p])
	}
}

// A Swift Journey is a second movement action with a fresh full allowance. As
// a development card it is one per turn, and not the turn it was bought.
func TestSwiftJourneyGrantsSecondAction(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, centre, 2, 0, CargoNone)
	// Not before a first action has finished.
	x.Swift[p] = 1
	refuse(t, s, cmd(p, CmdSwift, nil), ErrNoJourney)
	// Take a first action and end it.
	first := reachable(s, x, p)
	do(t, s, cmd(p, CmdMove, map[string]any{"to": first[0].To}))
	do(t, s, cmd(p, CmdHalt, nil))
	spent := x.MP
	do(t, s, cmd(p, CmdSwift, nil))
	if x.MoveDone || x.MoveOpen {
		t.Fatalf("after the card: done=%v open=%v, want a fresh phase", x.MoveDone, x.MoveOpen)
	}
	if got := openMP(s, x, p); got != allowance(s, 2) {
		t.Fatalf("the second action opens at %d MP, want the level's full %d (the first ended at %d)",
			got, allowance(s, 2), spent)
	}
	if !s.PlayedDevThisTurn {
		t.Fatal("a Swift Journey did not count as this turn's development card")
	}
	// One card a turn, both ways round.
	x.Swift[p] = 1
	refuse(t, s, cmd(p, CmdSwift, nil), engine.ErrDevAlreadyPlayed)
	// A card bought this turn is locked.
	x.Swift[p], x.SwiftNew[p] = 0, 1
	s.PlayedDevThisTurn = false
	x.MoveDone, x.Moved = true, true
	refuse(t, s, cmd(p, CmdSwift, nil), ErrNoSwift)
}

// A played Knight moves a barbarian rather than the robber, and the robber is
// never armed by it.
func TestAKnightMovesABarbarian(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	s.Players[p].DevCards[engine.DevKnight] = 1
	do(t, s, cmd(p, engine.CmdPlayDevCard, map[string]any{"card": engine.DevKnight}))
	if s.RobberPending {
		t.Fatal("a played Knight armed the robber")
	}
	if x.BarbSeat != p || !x.BarbSteal {
		t.Fatalf("a played Knight owes seat %d a barbarian (steal %v), want %d and true", x.BarbSeat, x.BarbSteal, p)
	}
	// Largest Army is the one base special card left, and it still works.
	if s.Players[p].KnightsPlayed != 1 {
		t.Fatalf("the knight did not count toward Largest Army: %d played", s.Players[p].KnightsPlayed)
	}
}

// --- the phase and the turn -------------------------------------------------

// Conformance: "The wagon phase sits after trading and building, blocks EndTurn,
// and its Auto declines to move."
func TestMovementPhaseBlocksEndTurn(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, centre, 1, 5, CargoNone)
	refuse(t, s, cmd(p, engine.CmdEndTurn, nil), engine.ErrModulePending)
	// Building and trading are not blocked; only the pass is.
	if err := engine.RequireActionableTurn(s, p); err != nil {
		t.Fatalf("the movement phase blocked an ordinary turn action: %v", err)
	}
	// Auto declines rather than stalling the table.
	auto, ok := (Wagons{}).auto(s, engine.NoPlayer)
	if !ok || auto.Type != CmdHalt || auto.Player != p {
		t.Fatalf("Auto returned %v/%v (ok=%v), want a halt from seat %d", auto.Player, auto.Type, ok, p)
	}
	do(t, s, auto)
	do(t, s, cmd(p, engine.CmdEndTurn, nil))
}

// The movement phase is armed again for the seat whose turn starts.
func TestEachTurnGetsItsOwnMovement(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, centre, 1, 5, CargoNone)
	do(t, s, cmd(p, CmdHalt, nil))
	if !x.MoveDone {
		t.Fatal("halting did not end the phase")
	}
	do(t, s, cmd(p, engine.CmdEndTurn, nil))
	if x.TurnSeat == p || x.MoveDone {
		t.Fatalf("the next turn opened as seat %d with MoveDone=%v", x.TurnSeat, x.MoveDone)
	}
	if x.TurnSeat != s.Cur {
		t.Fatalf("the phase is armed for seat %d and the turn is seat %d", x.TurnSeat, s.Cur)
	}
}

// --- setup ------------------------------------------------------------------

// Conformance: "Round-2 placement is a city paying 1 card per adjacent hex;
// wagon starts on that city's intersection; 5 gold each (3 under Rivers); no
// robber ever placed; Longest Road award absent; Largest Army present."
func TestSetupPlacesAWagonOnEachRoundTwoCity(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	for p := range engine.PlayerID(4) {
		if !x.OnBoard[p] {
			t.Fatalf("seat %d has no wagon", p)
		}
		b, ok := s.Buildings[x.Wagon[p]]
		if !ok || b.Owner != p || !b.City {
			t.Fatalf("seat %d wagon at %v, want its round-2 city (%v, %v)",
				p, x.Wagon[p], b, ok)
		}
		if x.Gold[p] != startGold {
			t.Fatalf("seat %d starts with %d gold, want %d", p, x.Gold[p], startGold)
		}
		if x.Level[p] != 1 {
			t.Fatalf("seat %d starts at level %d, want 1", p, x.Level[p])
		}
	}
	// SetupRound2City makes the round-2 placement a city, the wagon's home.
	if !(Wagons{}).Hooks().SetupRound2City {
		t.Fatal("the round-2 placement is not a city")
	}
}

// The robber is never placed at setup and never armed by a 7 or a Knight.
func TestTheRobberIsNeverInTheGame(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	if s.Board.RobberOnBoard() {
		t.Fatalf("the robber is on %v", s.Board.Robber)
	}
	fire(t, s, (Wagons{}).onSeven(s))
	if s.RobberPending {
		t.Fatal("a 7 armed the robber")
	}
	homes := barbarianHomes(s, x)
	do(t, s, cmd(s.Cur, CmdBarbarian, map[string]any{"barb": 0, "e": homes[0]}))
	if s.Board.RobberOnBoard() {
		t.Fatal("the robber came back")
	}
}

// The Longest Road award is not in play at all. Largest Army is.
func TestLongestRoadIsAbsentAndLargestArmyIsNot(t *testing.T) {
	s, _ := opened(t, 4, "base+wagons")
	if s.LongestRoadAward() {
		t.Fatal("Longest Road award in play")
	}
	if !(Wagons{}).Hooks().NoLongestRoad {
		t.Fatal("the module does not remove the Longest Road award")
	}
	// Play three knights and take Largest Army: the one base special card left.
	p := s.Cur
	s.Players[p].DevCards[engine.DevKnight] = 3
	for range 3 {
		do(t, s, cmd(p, engine.CmdPlayDevCard, map[string]any{"card": engine.DevKnight}))
		if x, _ := StateExt(s); x.BarbSeat != engine.NoPlayer {
			homes := barbarianHomes(s, x)
			// A Knight lets the player choose which of the three (BarbIdx -1),
			// so any index will do; a drive-off would name one.
			idx := max(x.BarbIdx, 0)
			do(t, s, cmd(p, CmdBarbarian, map[string]any{"barb": idx, "e": homes[0]}))
		}
		s.PlayedDevThisTurn = false
	}
	if s.LargestArmyHolder != p {
		t.Fatalf("Largest Army is held by %d after three knights, want %d", s.LargestArmyHolder, p)
	}
	if s.LongestRoadHolder != engine.NoPlayer {
		t.Fatalf("somebody holds Longest Road (%d) in a game that has no such award", s.LongestRoadHolder)
	}
}

// Starting gold is 3 alongside Rivers. The ruleset string decides it, so this
// checks the rule directly.
func TestStartingGoldIsThreeUnderRivers(t *testing.T) {
	if got := startingGold("base+wagons"); got != startGold {
		t.Fatalf("Wagons alone starts with %d gold, want %d", got, startGold)
	}
	if got := startingGold("base+rivers+wagons"); got != startGoldRivers {
		t.Fatalf("Wagons with Rivers starts with %d gold, want %d", got, startGoldRivers)
	}
}

// --- victory and compatibility ----------------------------------------------

// Conformance: "Victory at 13, checked only on the active player's turn; 15 with
// Knights, 15 with Caravans, 14 with Raiders, 14 with Harbormaster, 13 with
// Fishermen or Rivers, and Fishermen's boot still adds 1 to whichever of those
// applies."
func TestVictoryTargetPerCombination(t *testing.T) {
	// The two pairings this module owns, through the adjuster: it is a delta on
	// the peers' defaulters, which both sort before "wagons".
	for _, tc := range []struct {
		ruleset string
		want    int
	}{
		{"base+cak+wagons", 15},
		{"base+raiders+wagons", 14},
		// Both peers in: the Knights row is higher and wins.
		{"base+cak+raiders+wagons", 15},
	} {
		if got, ok := pairingTarget(engine.CanonicalRuleset(tc.ruleset)); !ok || got != tc.want {
			t.Fatalf("%s plays to %d (owned=%v), want %d", tc.ruleset, got, ok, tc.want)
		}
	}
	// Caravans and Harbormaster add +2 and +1 through their own adjusters, giving
	// 15 and 14. This module must not claim those rows, or they count twice.
	for _, rs := range []string{"base+caravans+wagons", "base+harbormaster+wagons",
		"base+fishermen+wagons", "base+rivers+wagons", "base+wagons"} {
		if _, ok := pairingTarget(engine.CanonicalRuleset(rs)); ok {
			t.Fatalf("%s: wagons claims the pairing target", rs)
		}
	}
	// The target the game is actually played to, from engine.ResolveTargetVP.
	for _, tc := range []struct {
		ruleset string
		want    int
	}{
		{"base+wagons", 13},
		{engine.CanonicalRuleset("base+caravans+wagons"), 15},
		{engine.CanonicalRuleset("base+cak+wagons"), 15},
		{engine.CanonicalRuleset("base+raiders+wagons"), 14},
		{engine.CanonicalRuleset("base+harbormaster+wagons"), 14},
		{engine.CanonicalRuleset("base+fishermen+wagons"), 13},
		{engine.CanonicalRuleset("base+rivers+wagons"), 13},
	} {
		if got := engine.ResolveTargetVP(engine.GameConfig{Players: 4, Ruleset: tc.ruleset}); got != tc.want {
			t.Fatalf("%s: ResolveTargetVP is %d, want %d", tc.ruleset, got, tc.want)
		}
		s := newGame(t, 4, tc.ruleset)
		if s.Config.TargetVP != tc.want {
			t.Fatalf("%s: the game plays to %d, want %d", tc.ruleset, s.Config.TargetVP, tc.want)
		}
	}
	// A host who chose a target still gets it: the final pass runs only when the
	// field arrived empty.
	evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base+wagons", TargetVP: 10}, engine.SeedsFrom(1))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	if s.Config.TargetVP != 10 {
		t.Fatalf("a host-chosen target of 10 became %d", s.Config.TargetVP)
	}
}

// Conformance: "engine.ValidRuleset refuses islands and explorers alongside
// wagons."
func TestIslandsAndExplorersAreRefused(t *testing.T) {
	for _, rs := range []string{"base+islands+wagons", "base+wagons+islands", "base+explorers+wagons"} {
		if engine.ValidRuleset(rs) {
			t.Fatalf("%s was accepted", rs)
		}
		if err := engine.CheckRuleset(rs); err == nil {
			t.Fatalf("%s: no error", rs)
		}
	}
	// Every allowed partner still resolves.
	for _, rs := range []string{"base+wagons", "base+cak+wagons", "base+caravans+wagons", "base+fishermen+wagons"} {
		if !engine.ValidRuleset(engine.CanonicalRuleset(rs)) {
			t.Fatalf("%s was refused", rs)
		}
	}
	// The degraded pairing is a warning, not a refusal: Wagons removes the
	// Longest Road award, so the camels' road-doubling does nothing.
	if _, ok := engine.WarningBetween("wagons", "caravans"); !ok {
		t.Fatal("the Caravans pairing carries no warning about the dead road bonus")
	}
}

// --- the snapshot ------------------------------------------------------------

// gob decodes an empty slice as nil, and this ext is all per-seat slices, so a
// zero-length one would panic on the next fold after a reload. ensureSeats
// sizes them from the seat count; this pins that they survive a snapshot.
// game.TestEveryExtMapSurvivesRestore covers only map fields.
func TestExtSnapshotRoundTrip(t *testing.T) {
	_, x := opened(t, 4, "base+wagons")
	x.Gold[0], x.Level[1], x.Landed[2], x.Swift[3] = 9, 4, 5, 1
	x.Cargo[0] = CargoMarble
	x.Drawn[1], x.Refill[2] = 7, 2

	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(x); err != nil {
		t.Fatalf("encoding: %v", err)
	}
	var back WagonsExt
	if err := gob.NewDecoder(&buf).Decode(&back); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	back.RestoreExt()

	if !reflect.DeepEqual(&back, x) {
		t.Fatalf("the ext does not survive a snapshot:\n got %+v\nwant %+v", &back, x)
	}
	// The per-seat slices are non-nil.
	for _, f := range []struct {
		name string
		n    int
	}{
		{"Gold", len(back.Gold)}, {"Level", len(back.Level)}, {"Wagon", len(back.Wagon)},
		{"OnBoard", len(back.OnBoard)}, {"Cargo", len(back.Cargo)}, {"Landed", len(back.Landed)},
		{"Swift", len(back.Swift)}, {"SwiftNew", len(back.SwiftNew)},
	} {
		if f.n != 4 {
			t.Errorf("%s came back with %d entries for a four-seat game", f.name, f.n)
		}
	}
}

// The Swift Journey count is public because the purchase event's type already
// reveals it. The viewer's split between playable and locked stays private, as
// does the order of the cargo stacks.
func TestViewPublishesCountNotHand(t *testing.T) {
	_, x := opened(t, 4, "base+wagons")
	x.Swift[1], x.SwiftNew[1] = 2, 1

	spectator, ok := x.ViewExt(engine.NoPlayer).(map[string]any)
	if !ok {
		t.Fatal("the spectator view is not an object")
	}
	held, ok := spectator["swift_held"].([]int)
	if !ok || len(held) != 4 || held[1] != 3 {
		t.Fatalf("a spectator sees swift_held %v, want seat 1 holding 3", spectator["swift_held"])
	}
	// Nothing about which of those a seat may play this turn.
	if _, present := spectator["swift"]; present {
		t.Fatal("a spectator is told the playable half of somebody's hand")
	}
	if _, present := spectator["swift_new"]; present {
		t.Fatal("spectator sees swift_new")
	}

	own, _ := x.ViewExt(1).(map[string]any)
	if own["swift"] != 2 || own["swift_new"] != 1 {
		t.Fatalf("seat 1 sees swift=%v new=%v, want 2 and 1", own["swift"], own["swift_new"])
	}
	// A seat sees only its own split; the field is keyed to the viewer, not a
	// seat index.
	other, _ := x.ViewExt(0).(map[string]any)
	if other["swift"] != 0 {
		t.Fatalf("seat 0 sees swift=%v, want its own count", other["swift"])
	}

	// Once the game is over, the revealed view fills in every seat's split, as
	// a finished replay reveals every hand.
	revealed, ok := x.ViewExtRevealed().(map[string]any)
	if !ok {
		t.Fatal("the revealed view is not an object")
	}
	bySeat, ok := revealed["swift_by_seat"].([]int)
	if !ok || len(bySeat) != 4 || bySeat[1] != 2 {
		t.Fatalf("the revealed view says %v, want seat 1's playable 2", revealed["swift_by_seat"])
	}
}
