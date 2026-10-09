package scenarios

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// bidOrder is the order the round takes answers in: the finisher first, then
// clockwise. Tests bid in this order because a seat answering out of turn is
// refused.
func bidOrder(s *engine.State, x *CaravansExt) []engine.PlayerID {
	n := len(s.Players)
	out := make([]engine.PlayerID, 0, n)
	for i := range n {
		out = append(out, engine.PlayerID((int(x.Finisher)+i)%n))
	}
	return out
}

func bidCmd(p engine.PlayerID, a, b int) engine.Command {
	return bidCmdPath(p, a, b, nil)
}

func bidCmdPath(p engine.PlayerID, a, b int, path *engine.CamelPath) engine.Command {
	data := map[string]any{"cards": [2]int{a, b}}
	if path != nil {
		data["path"] = path
	}
	return engine.Command{Player: p, Type: CmdBidCamel, Data: raw(data)}
}

// viewBids reads the bids a viewer is shown. Every viewer sees every bid: the
// cards are face up.
func viewBids(t *testing.T, x *CaravansExt, viewer engine.PlayerID) []struct {
	Player engine.PlayerID   `json:"player"`
	Cards  [2]int            `json:"cards"`
	Path   *engine.CamelPath `json:"path,omitempty"`
} {
	t.Helper()
	raw, err := json.Marshal(x.ViewExt(viewer))
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Bids []struct {
			Player engine.PlayerID   `json:"player"`
			Cards  [2]int            `json:"cards"`
			Path   *engine.CamelPath `json:"path,omitempty"`
		} `json:"bids"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded.Bids
}

// TestCamelVoteIsOpenAndSequential pins both halves of the bidding rule.
//
// Open: bids are placed face up, so every bid is visible to every seat and to
// spectators as soon as it lands; without that no coalition could form.
//
// Sequential: bidding starts with the player who just finished their turn and
// goes clockwise, once each, so a seat out of order is refused.
func TestCamelVoteIsOpenAndSequential(t *testing.T) {
	s, x := openCamelVote(t, 5)
	seats := len(s.Players)
	for p := range seats {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 3
		s.Players[p].Hand[board.Wheat] = 3
	}
	order := bidOrder(s, x)
	if order[0] != x.Finisher {
		t.Fatalf("bidding starts with %d, want the finisher %d", order[0], x.Finisher)
	}

	// A seat further down the order may not answer early: it is entitled to see
	// the bids in front of it first.
	early := order[len(order)-1]
	if _, err := engine.Decide(s, bidCmd(early, 1, 0)); !errors.Is(err, engine.ErrNotYourTurn) {
		t.Errorf("out-of-order bid by seat %d: err = %v, want ErrNotYourTurn", early, err)
	}

	// The first bidder answers, and the whole table can read it at once.
	step(t, s, bidCmd(order[0], 2, 1))
	for _, viewer := range []engine.PlayerID{0, 1, 2, engine.NoPlayer} {
		bids := viewBids(t, x, viewer)
		if len(bids) != 1 {
			t.Fatalf("viewer %d sees %d bids after one answer: %+v", viewer, len(bids), bids)
		}
		if bids[0].Player != order[0] || bids[0].Cards != [2]int{2, 1} {
			t.Errorf("viewer %d sees %+v, want seat %d at 2/1", viewer, bids[0], order[0])
		}
	}
	// And nothing has been charged: the round pays at resolution.
	if got := s.Players[order[0]].Hand[board.Sheep]; got != 3 {
		t.Errorf("seat %d was charged %d wool while the round was open", order[0], 3-got)
	}

	// Answering twice is still refused, and with the answer that says why.
	if _, err := engine.Decide(s, bidCmd(order[0], 1, 0)); !errors.Is(err, ErrAlreadyBid) {
		t.Errorf("second bid by seat %d: err = %v, want ErrAlreadyBid", order[0], err)
	}
}

// TestCamelCoalitionBeatsThePluralityHolder pins the voting rule's second step:
// two or more players who together hold a majority and agree on the placement
// place the camel there. It outranks the single largest bidder, so at 4/3/3 two
// agreeing threes beat the four.
func TestCamelCoalitionBeatsThePluralityHolder(t *testing.T) {
	s, x := openCamelVote(t, 5)
	if len(s.Players) != 3 {
		t.Fatalf("seats = %d, want 3", len(s.Players))
	}
	for p := range len(s.Players) {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 4
	}
	paths := CamelPaths(s)
	if len(paths) < 2 {
		t.Fatalf("need two distinct placements to disagree about, got %d", len(paths))
	}
	order := bidOrder(s, x)

	// 4 / 3 / 3, and the two threes name the same placement.
	step(t, s, bidCmdPath(order[0], 4, 0, &paths[0]))
	step(t, s, bidCmdPath(order[1], 3, 0, &paths[1]))
	evs := step(t, s, bidCmdPath(order[2], 3, 0, &paths[1]))

	var resolved, placed *engine.Event
	for i := range evs {
		switch evs[i].Type {
		case EvCamelResolved:
			resolved = &evs[i]
		case EvCamelPlaced:
			placed = &evs[i]
		default:
			// a scan for two events, not a dispatch over the batch
		}
	}
	if resolved == nil {
		t.Fatal("the last bid did not close the round")
	}
	d := engine.DecodeEvent[camelResolvedData](*resolved)
	if d.Reason != camelReasonCoalition {
		t.Fatalf("reason = %q, want %q", d.Reason, camelReasonCoalition)
	}
	// A coalition has already agreed where the camel goes, so it goes there in
	// the same batch and nobody is left holding a placement pick.
	if placed == nil {
		t.Fatal("a coalition agreed on a placement and no camel was placed")
	}
	got := engine.DecodeEvent[camelPlacedData](*placed)
	if got.Caravan != paths[1].Caravan || got.E != paths[1].E {
		t.Errorf("camel went to %+v, want the agreed %+v", got, paths[1])
	}
	if x.Voting {
		t.Error("the round is still open after the camel was placed")
	}
}

// TestCamelAbsoluteMajorityStillChoosesAlone: the coalition step is step two. A
// seat with more votes than all others combined chooses alone and gets a real
// placement pick rather than being bound to what it named.
func TestCamelAbsoluteMajorityStillChoosesAlone(t *testing.T) {
	s, x := openCamelVote(t, 5)
	for p := range len(s.Players) {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 5
	}
	paths := CamelPaths(s)
	if len(paths) < 2 {
		t.Fatalf("need two placements, got %d", len(paths))
	}
	order := bidOrder(s, x)
	step(t, s, bidCmd(order[0], 5, 0))
	step(t, s, bidCmdPath(order[1], 1, 0, &paths[1]))
	evs := step(t, s, bidCmdPath(order[2], 1, 0, &paths[1]))

	var resolved, placed *engine.Event
	for i := range evs {
		switch evs[i].Type {
		case EvCamelResolved:
			resolved = &evs[i]
		case EvCamelPlaced:
			placed = &evs[i]
		default:
			// a scan for two events, not a dispatch over the batch
		}
	}
	if resolved == nil {
		t.Fatal("the round did not close")
	}
	d := engine.DecodeEvent[camelResolvedData](*resolved)
	if d.Reason != camelReasonMajority || d.Placer != order[0] {
		t.Errorf("reason %q placer %d, want %q for seat %d: 5 beats 1+1 combined",
			d.Reason, d.Placer, camelReasonMajority, order[0])
	}
	if placed != nil {
		t.Error("an absolute majority was placed for rather than being asked where it wants the camel")
	}
}

// TestCamelViewCarriesTheSpokes: an unstarted caravan has no camels, so the
// spokes are all a client has to draw it from.
func TestCamelViewCarriesTheSpokes(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	x := caravansExt(s)
	if !x.HasOasis {
		t.Fatal("no oasis")
	}
	v := x.ViewExt(0).(map[string]any)

	if v["camel_supply"] != CamelSupply {
		t.Errorf("camel_supply = %v, want %d", v["camel_supply"], CamelSupply)
	}
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Camels   []json.RawMessage `json:"camels"`
		Caravans []struct {
			Caravan int          `json:"caravan"`
			Arrow   board.Edge   `json:"arrow"`
			Corner  board.Vertex `json:"corner"`
		} `json:"caravans"`
		Occupied []board.Edge `json:"occupied"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	// Nothing is placed yet, so this is exactly the state the spokes exist for:
	// with no camels, `camels` describes none of the three caravans.
	if len(decoded.Camels) != 0 {
		t.Fatalf("camels = %d on a fresh board, want 0", len(decoded.Camels))
	}
	if len(decoded.Caravans) != caravansPerOasis {
		t.Fatalf("caravans on the wire = %d, want %d: %s", len(decoded.Caravans), caravansPerOasis, raw)
	}
	for i, c := range decoded.Caravans {
		if c.Caravan != i {
			t.Errorf("caravans[%d].caravan = %d", i, c.Caravan)
		}
		if c.Arrow != x.Arrows[i] || c.Corner != x.ArrowCorner[i] {
			t.Errorf("caravan %d spoke = %v from %v, want %v from %v",
				i, c.Arrow, c.Corner, x.Arrows[i], x.ArrowCorner[i])
		}
		// A spoke serialised as the zero edge would be drawn at the grid origin.
		if c.Arrow == (board.Edge{}) {
			t.Errorf("caravan %d published the zero edge as its spoke", i)
		}
	}
	if len(decoded.Occupied) != 0 {
		t.Errorf("occupied = %v on a fresh board, want empty", decoded.Occupied)
	}

	// After a camel lands, `occupied` names its edge.
	x.Chains[0] = []board.Edge{x.Arrows[0]}
	x.Occupied[x.Arrows[0]] = true
	raw, _ = json.Marshal(x.ViewExt(0))
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Occupied) != 1 || decoded.Occupied[0] != x.Arrows[0] {
		t.Errorf("occupied = %v, want [%v]", decoded.Occupied, x.Arrows[0])
	}
}

// TestCamelPathsReachOnlyThePlacer pins that the placement picker's list comes
// through PendingTargets, not LegalExtras. LegalTargets returns early for any
// seat that is not s.Cur, and the placer usually is not; even when it is,
// blocksTurnActions closes the LegalExtras gate. A LegalExtras implementation
// would pass a test with the placer as current seat and ship an empty picker.
func TestCamelPathsReachOnlyThePlacer(t *testing.T) {
	s, x := openCamelVote(t, 5)

	// While the round is open the list goes to exactly one seat, the one on
	// the clock, since a bid may name a placement to join a coalition. No
	// other seat is being waited on or placing.
	onClock := nextBidder(s, x)
	for p := range len(s.Players) {
		seat := engine.PlayerID(p)
		got := len(s.LegalTargetsFor(seat).CamelPaths)
		if seat == onClock && got == 0 {
			t.Errorf("seat on the clock offered no camel paths")
		}
		if seat != onClock && got != 0 {
			t.Errorf("seat %d offered %d camel paths while it is seat %d's go", p, got, onClock)
		}
	}

	// Close the round with a placer who is not the current seat.
	placer := engine.PlayerID((int(s.Cur) + 1) % len(s.Players))
	x.Placer = placer
	if placer == s.Cur {
		t.Fatal("need a placer who is not the current seat for this test to mean anything")
	}

	lt := s.LegalTargetsFor(placer)
	if len(lt.CamelPaths) == 0 {
		t.Fatal("placer offered no camel paths")
	}
	// And they are the paths the engine would actually accept.
	for _, cp := range lt.CamelPaths {
		if !(Caravans{}).isLegalPath(x, s, cp.Caravan, cp.E) {
			t.Errorf("offered path %+v is not legal", cp)
		}
	}
	// Only the placer. Nobody else has a camel to put anywhere.
	for p := range len(s.Players) {
		if engine.PlayerID(p) == placer {
			continue
		}
		if n := len(s.LegalTargetsFor(engine.PlayerID(p)).CamelPaths); n != 0 {
			t.Errorf("seat %d offered %d camel paths while seat %d holds the camel", p, n, placer)
		}
	}
}

// TestCamelBidPaidAtResolutionClamped: payment happens on the
// public resolve, not when the bid lands. Meanwhile a seat that has bid may keep
// playing and the vote spans the turn boundary, so a 7 can take the wool it
// named. The bid is clamped to what the seat can still back, and it keeps only
// the votes it pays for.
func TestCamelBidPaidAtResolutionClamped(t *testing.T) {
	s, x := openCamelVote(t, 5)
	seats := len(s.Players)
	if seats < 2 {
		t.Fatalf("seats = %d", seats)
	}
	for p := range seats {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 3
		s.Players[p].Hand[board.Wheat] = 3
	}
	bankBefore := s.Bank
	order := bidOrder(s, x)

	// Everyone but the last seat bids. Nothing has been charged yet.
	for _, p := range order[:seats-1] {
		step(t, s, bidCmd(p, 2, 0))
	}
	for _, p := range order[:seats-1] {
		if got := s.Players[p].Hand[board.Sheep]; got != 3 {
			t.Fatalf("seat %d was charged %d wool while the round was still open", p, 3-got)
		}
	}
	if s.Bank != bankBefore {
		t.Fatalf("the bank moved during an open round: %v -> %v", bankBefore, s.Bank)
	}

	// The first bidder loses the wool it bid before the round closes (any
	// cause: a discard, a trade, a steal).
	first, second := order[0], order[1]
	s.Players[first].Hand[board.Sheep] = 1

	last := order[seats-1]
	evs := step(t, s, bidCmd(last, 0, 0))

	var resolved engine.Event
	for _, e := range evs {
		if e.Type == EvCamelResolved {
			resolved = e
		}
	}
	if resolved.Type == "" {
		t.Fatalf("the last bid did not close the round: %+v", evs)
	}
	var d camelResolvedData
	if err := json.Unmarshal(resolved.Data, &d); err != nil {
		t.Fatal(err)
	}
	paidBy := map[engine.PlayerID]camelPayment{}
	for _, p := range d.Paid {
		paidBy[p.Player] = p
	}
	// It named 2 wool and could only back 1, so it paid 1 and earned 1 vote.
	if got := paidBy[first]; got.cards()[0] != 1 {
		t.Errorf("seat %d paid %+v, want 1 wool (clamped from the 2 it named)", first, got)
	}
	if s.Players[first].Hand[board.Sheep] != 0 {
		t.Errorf("seat %d wool after the resolve = %d, want 0", first, s.Players[first].Hand[board.Sheep])
	}
	// A seat that could still back its bid paid it in full.
	if seats > 2 {
		if got := paidBy[second]; got.cards()[0] != 2 {
			t.Errorf("seat %d paid %+v, want the full 2 wool", second, got)
		}
		if s.Players[second].Hand[board.Sheep] != 1 {
			t.Errorf("seat %d wool after the resolve = %d, want 1", second, s.Players[second].Hand[board.Sheep])
		}
	}
	// A seat that bid nothing does not appear at all.
	if _, ok := paidBy[last]; ok {
		t.Errorf("a zero bid was recorded as a payment: %+v", paidBy[last])
	}
	// And what left the hands reached the bank, to the card.
	want := bankBefore
	for _, p := range d.Paid {
		want[board.Sheep] += p.cards()[0]
		want[board.Wheat] += p.cards()[1]
	}
	if s.Bank != want {
		t.Errorf("bank = %v, want %v", s.Bank, want)
	}
}

// TestCamelResolvedCarriesTheReason drives all three of pickPlacer's outcomes
// through real bids and pins the `reason` the public event carries, which the
// client uses to choose between "wins the vote", "the vote is tied" and "nobody
// bid".
//
// Bids are hand-crafted and differ per seat: bot rounds bid {0,0} and always
// resolve "nobody", which would hide a constant reason.
func TestCamelResolvedCarriesTheReason(t *testing.T) {
	// wool per seat in bid order (the finisher first, then clockwise); the last
	// bid closes the round.
	cases := []struct {
		name   string
		bids   []int
		reason string
		// placer is the finisher for tie/nobody, or the bid-order index of the
		// seat that carried it.
		majorityAt int
	}{
		// 3 against 1: 3*2 > 4, a strict majority for the first bidder.
		{"majority", []int{3, 1, 0}, camelReasonMajority, 0},
		// 2 and 2: nobody carries it, the finisher places.
		{"tie", []int{2, 2, 0}, camelReasonTie, -1},
		// Nobody names anything at all.
		{"nobody", []int{0, 0, 0}, camelReasonNobody, -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, x := openCamelVote(t, 5)
			finisher := x.Finisher
			seats := len(s.Players)
			if seats != len(c.bids) {
				t.Fatalf("seats = %d, the case names %d bids", seats, len(c.bids))
			}
			for p := range seats {
				s.Players[p].Hand = engine.Hand{}
				s.Players[p].Hand[board.Sheep] = 5
			}
			order := bidOrder(s, x)
			var resolved engine.Event
			for i, p := range order {
				evs := step(t, s, bidCmd(p, c.bids[i], 0))
				for _, e := range evs {
					if e.Type == EvCamelResolved {
						resolved = e
					}
				}
			}
			if resolved.Type == "" {
				t.Fatalf("the round never closed")
			}
			var d camelResolvedData
			if err := json.Unmarshal(resolved.Data, &d); err != nil {
				t.Fatal(err)
			}
			if d.Reason != c.reason {
				t.Errorf("reason = %q, want %q (paid %+v, placer %d)", d.Reason, c.reason, d.Paid, d.Placer)
			}
			want := finisher
			if c.majorityAt >= 0 {
				want = order[c.majorityAt]
			}
			if d.Placer != want {
				t.Errorf("placer = %d, want %d", d.Placer, want)
			}
		})
	}
}

// TestCamelZeroBidNotPublished: a seat that named a bid and then lost
// every card backing it pays nothing and is absent from Paid, so its named bid
// must be gone from the state and the closed-round view too (the scoreboard
// counts from Paid). Asserted on the published view, which is what players see.
func TestCamelZeroBidNotPublished(t *testing.T) {
	s, x := openCamelVote(t, 5)
	seats := len(s.Players)
	if seats < 3 {
		t.Fatalf("seats = %d, want at least 3", seats)
	}
	for p := range seats {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 3
		s.Players[p].Hand[board.Wheat] = 3
	}
	order := bidOrder(s, x)
	first, second, last := order[0], order[1], order[seats-1]

	const named = 3
	for _, p := range order[:seats-1] {
		step(t, s, bidCmd(p, named, 0))
	}
	// The first bidder discards the lot on a 7 before the round closes.
	s.Players[first].Hand[board.Sheep] = 0
	if got := x.Bids[first]; got.Cards[0] != named {
		t.Fatalf("fixture: seat %d's bid = %+v, want %d wool", first, got, named)
	}

	step(t, s, bidCmd(last, 0, 0))

	if b, ok := x.Bids[first]; ok {
		t.Errorf("a bid clamped to zero survived the resolve in state: %+v", b)
	}
	// Every seat that did pay is still there, at the amount it paid.
	if b, ok := x.Bids[second]; !ok || b.Cards[0] != named {
		t.Errorf("seat %d's paid bid = %+v (present %v), want %d wool", second, b, ok, named)
	}

	// And the view, which is what a player sees. Non-payers must not appear;
	// payers must, at what they paid.
	for _, viewer := range []engine.PlayerID{0, 1, engine.NoPlayer} {
		revealed := viewBids(t, x, viewer)
		for _, b := range revealed {
			if b.Player == first {
				t.Errorf("viewer %d sees seat %d's unpaid bid %+v", viewer, first, b)
			}
			if b.Player == last {
				t.Errorf("viewer %d sees a zero bid %+v", viewer, b)
			}
		}
		if len(revealed) != seats-2 {
			t.Errorf("viewer %d: %d bids published, want %d (every seat that paid)",
				viewer, len(revealed), seats-2)
		}
	}
}

// TestCamelViewNamesWhyThisSeatPlaces: `placer` alone cannot tell a win from a
// tie or an empty round, since pickPlacer sets it in all three cases, so the
// panel would congratulate players on votes they lost. The view publishes the
// outcome EvCamelResolved stamped.
func TestCamelViewNamesWhyThisSeatPlaces(t *testing.T) {
	for _, tc := range []struct {
		name   string
		reason string
	}{
		{"clear winner", camelReasonMajority},
		{"tie", camelReasonTie},
		{"nobody", camelReasonNobody},
		{"coalition", camelReasonCoalition},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, x := openCamelVote(t, 5)
			x.Placer = 1
			x.Reason = tc.reason

			got, ok := x.ViewExt(0).(map[string]any)["reason"].(string)
			if !ok || got != tc.reason {
				t.Errorf("reason = %q (ok=%v), want %q", got, ok, tc.reason)
			}
		})
	}

	// Never published while the round is open: there is no outcome yet.
	_, x := openCamelVote(t, 5)
	x.Placer = engine.NoPlayer
	if _, leaked := x.ViewExt(0).(map[string]any)["reason"]; leaked {
		t.Errorf("an open round publishes an outcome it does not have yet")
	}
}

// TestCamelViewReasonMatchesTheStampedOne: the outcome shown is the one the event
// log recorded, through a round where the clamp changes it. The first bidder
// names the biggest bid and then loses every card backing it:
//
//	settled  (Paid):  two seats at 2 each  -> a TIE, and the finisher places
//	as named (Bids):  one seat at 3, alone -> a MAJORITY, and that seat "won"
//
// Reading the named round would tell the finisher they won a tied vote.
func TestCamelViewReasonMatchesTheStampedOne(t *testing.T) {
	s, x := openCamelVote(t, 5)
	seats := len(s.Players)
	if seats != 3 {
		t.Fatalf("seats = %d, want 3", seats)
	}
	for p := range seats {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 3
		s.Players[p].Hand[board.Wheat] = 3
	}
	order := bidOrder(s, x)

	step(t, s, bidCmd(order[0], 3, 0))
	step(t, s, bidCmd(order[1], 2, 0))
	// A 7 takes the first bidder's wool before the round closes, so its bid
	// clamps to zero.
	s.Players[order[0]].Hand[board.Sheep] = 0
	if got := x.Bids[order[0]]; got.Cards[0] != 3 {
		t.Fatalf("fixture: seat %d's bid = %+v, want 3 wool", order[0], got)
	}
	// The last seat closes the round, matching the second and so tying it.
	evs := step(t, s, bidCmd(order[2], 2, 0))

	var resolved *engine.Event
	for i := range evs {
		if evs[i].Type == EvCamelResolved {
			resolved = &evs[i]
		}
	}
	if resolved == nil {
		t.Fatal("the round did not resolve on the last bid")
	}
	d := engine.DecodeEvent[camelResolvedData](*resolved)

	// The fixture is only worth anything if it really is the divergent case.
	if d.Reason != camelReasonTie {
		t.Fatalf("fixture: stamped reason = %q, want %q",
			d.Reason, camelReasonTie)
	}
	if d.Placer != x.Finisher {
		t.Fatalf("fixture: placer = %d, want finisher %d", d.Placer, x.Finisher)
	}

	// After the fold, Bids matches Paid: same seats, same amounts. The
	// clamped seat is absent, not zeroed.
	if len(x.Bids) != len(d.Paid) {
		t.Errorf("Bids has %d entries, Paid has %d: %+v vs %+v", len(x.Bids), len(d.Paid), x.Bids, d.Paid)
	}
	for _, pay := range d.Paid {
		got, ok := x.Bids[pay.Player]
		if !ok || got.Cards != pay.cards() {
			t.Errorf("Bids[%d] = %+v (present %v), Paid says %+v", pay.Player, got, ok, pay)
		}
	}
	if b, ok := x.Bids[order[0]]; ok {
		t.Errorf("the clamped-to-zero bid survived the fold as %+v", b)
	}

	// Every viewer, spectators included, is told the outcome the log was
	// stamped with.
	for _, viewer := range []engine.PlayerID{0, 1, 2, engine.NoPlayer} {
		got, ok := x.ViewExt(viewer).(map[string]any)["reason"].(string)
		if !ok || got != d.Reason {
			t.Errorf("viewer %d is shown reason %q (ok=%v), the event log is stamped %q",
				viewer, got, ok, d.Reason)
		}
	}
}
