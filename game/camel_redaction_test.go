package game

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// caravansLog plays seeded Caravans games until one runs a camel vote with a
// bid cast, and returns its full (unredacted) log.
func caravansLog(t *testing.T) []engine.Event {
	t.Helper()
	for seed := uint64(1); seed <= 6; seed++ {
		events := finishedEventsSeed(t, "base+caravans", seed)
		for _, e := range events {
			if e.Type == scenarios.EvCamelBid {
				return events
			}
		}
	}
	t.Fatal("no seeded Caravans game cast a camel bid")
	return nil
}

// TestCamelBidsArePublicAndClockwise pins the auction as the rules describe
// it: bidding starts with the player who just finished their turn and goes
// clockwise, and bids are placed face up. Open bids are what make the
// coalition step possible and give a later seat the advantage of knowing
// earlier bids, so EvCamelBid has no redactor.
//
// It checks that:
//
//   - EvCamelBid is public: Visible is nil and every viewer, spectators
//     included, receives the bytes the log holds, `cards` and all.
//   - Bids arrive clockwise from the finisher, so no seat answers before the
//     seats ahead of it.
//   - Who has answered is public, so a client can show "waiting on 2 seats".
func TestCamelBidsArePublicAndClockwise(t *testing.T) {
	events := caravansLog(t)

	seats := 0
	for _, e := range events {
		if e.Type == engine.EvGameCreated {
			var d engine.GameCreatedData
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatal(err)
			}
			seats = d.Config.Players
		}
	}
	if seats < 2 {
		t.Fatalf("seats = %d", seats)
	}

	// The seat expected to answer next: EvCamelVote opens a round on its
	// finisher, each bid advances one seat clockwise, EvCamelResolved closes
	// it. -1 means no round is open.
	next := -1
	checkedBids, checkedResolves, checkedRounds := 0, 0, 0
	for _, e := range events {
		switch e.Type {
		case scenarios.EvCamelVote:
			var d struct {
				Finisher engine.PlayerID `json:"finisher"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatal(err)
			}
			next = int(d.Finisher)
			checkedRounds++

		case scenarios.EvCamelBid:
			var d struct {
				Player engine.PlayerID `json:"player"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatal(err)
			}
			// Public: nil Visible, like every other public event.
			if e.Visible != nil {
				t.Fatalf("seq %d: EvCamelBid is not public: Visible = %v", e.Seq, e.Visible)
			}
			// Every viewer gets the same bytes, amounts included. Byte equality
			// rather than a key check, since a redactor could zero `cards` in
			// place.
			for _, viewer := range append([]engine.PlayerID{Spectator}, seatIDs(seats)...) {
				red := RedactEvent(e, viewer)
				if string(red.Data) != string(e.Data) {
					t.Fatalf("seq %d: viewer %d got a different bid: %s vs %s",
						e.Seq, viewer, red.Data, e.Data)
				}
				if !hasKey(t, red.Data, "cards") {
					t.Fatalf("seq %d: viewer %d cannot read seat %d's open bid: %s",
						e.Seq, viewer, d.Player, red.Data)
				}
				// That the seat has answered is public.
				if !hasKey(t, red.Data, "player") {
					t.Fatalf("seq %d: viewer %d cannot tell that seat %d has answered: %s",
						e.Seq, viewer, d.Player, red.Data)
				}
			}
			// And it is this seat's turn to bid: the finisher, then clockwise.
			if next < 0 {
				t.Fatalf("seq %d: a bid outside any open round", e.Seq)
			}
			if int(d.Player) != next {
				t.Fatalf("seq %d: seat %d bid out of turn, want seat %d",
					e.Seq, d.Player, next)
			}
			next = (next + 1) % seats
			checkedBids++

		case scenarios.EvCamelResolved:
			next = -1
			// A closed round is public in full; it is where the cards move.
			if e.Visible != nil {
				t.Fatalf("seq %d: EvCamelResolved is not public: Visible = %v", e.Seq, e.Visible)
			}
			for _, viewer := range append([]engine.PlayerID{Spectator}, seatIDs(seats)...) {
				if string(RedactEvent(e, viewer).Data) != string(e.Data) {
					t.Fatalf("seq %d: viewer %d got a different resolve: %s vs %s",
						e.Seq, viewer, RedactEvent(e, viewer).Data, e.Data)
				}
			}
			checkedResolves++
		default:
			// Only the two vote events matter here.
		}
	}
	if checkedBids == 0 {
		t.Fatal("no EvCamelBid in the log")
	}
	t.Logf("checked %d bids over %d rounds, and %d resolves", checkedBids, checkedRounds, checkedResolves)
}

// TestCamelRedactedStreamFoldsPublicState: every viewer folds the same
// bank and hands, because the cards move once, on the public EvCamelResolved,
// not as each bid lands. Paying at bid time would charge seats before the
// later seats had answered.
//
// The round is hand-built: Caravans' Auto bids {0,0}, so a bot log moves no
// cards and could not tell where the payment happens. Each seat bids a
// different amount so a viewer folding the wrong number lands visibly wrong.
func TestCamelRedactedStreamFoldsPublicState(t *testing.T) {
	const seats = 4
	setup, err := engine.New(engine.GameConfig{Players: seats, Ruleset: "base+caravans"}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}

	// One camel round, a different bid from every seat. The piles are the
	// ruleset's bid resources (wool and grain here, brick and lumber with
	// Knights), named positionally as `cards`; see scenarios.BidResources.
	bids := []scenarios.CamelBid{{Cards: [2]int{3, 1}}, {Cards: [2]int{0, 2}}, {Cards: [2]int{1, 0}}, {}}
	tail := []engine.Event{engine.NewEvent(scenarios.EvCamelVote, map[string]any{"finisher": 0})}
	var paid []map[string]any
	for p, b := range bids {
		// No Visible argument: the bid is public. Built as the module builds
		// it, so this folds the real bytes.
		tail = append(tail, engine.NewEvent(scenarios.EvCamelBid,
			map[string]any{"player": p, "cards": b.Cards}))
		if b.Total() > 0 {
			paid = append(paid, map[string]any{"player": p, "cards": b.Cards})
		}
	}
	tail = append(tail, engine.NewEvent(scenarios.EvCamelResolved,
		map[string]any{"placer": 0, "paid": paid}))

	// A base state with enough wool and grain that no bid is clamped: what is
	// tested is where the payment lands.
	base := func() *engine.State {
		s, err := engine.Replay(setup)
		if err != nil {
			t.Fatal(err)
		}
		s.Phase = engine.PhasePlay
		for p := range seats {
			s.Players[p].Hand = engine.Hand{}
			s.Players[p].Hand[board.Sheep] = 5
			s.Players[p].Hand[board.Wheat] = 5
		}
		return s
	}
	fold := func(s *engine.State, evs []engine.Event) {
		t.Helper()
		for _, e := range evs {
			e.Seq = s.NextSeq
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("apply %s: %v", e.Type, err)
			}
		}
	}

	truth := base()
	fold(truth, tail)
	// Sanity: the round moved cards, or everything below is vacuous.
	if truth.Bank[board.Sheep] == base().Bank[board.Sheep] {
		t.Fatal("the hand-built round paid nothing")
	}

	for _, viewer := range append([]engine.PlayerID{Spectator}, seatIDs(seats)...) {
		red := make([]engine.Event, len(tail))
		for i, e := range tail {
			red[i] = RedactEvent(e, viewer)
		}
		s := base()
		fold(s, red)

		// The bank is the discriminating assertion: a bid paid as it landed
		// would show a mid-round bank the rules have not settled.
		if s.Bank != truth.Bank {
			t.Errorf("viewer %d: bank = %v, want %v", viewer, s.Bank, truth.Bank)
		}
		// Every seat's hand, which a redacted fold can reproduce because this
		// round is the only thing that moved cards. The bidder is charged
		// exactly once, on the resolve.
		for p := range seats {
			if s.Players[p].Hand != truth.Players[p].Hand {
				t.Errorf("viewer %d: seat %d hand = %v, want %v",
					viewer, p, s.Players[p].Hand, truth.Players[p].Hand)
			}
		}
		// The public camel bookkeeping matches for everyone. Bidded matters
		// because a seat that answered with no cards differs from one that has
		// not answered.
		x, ok := scenarios.CaravansStateExt(s)
		if !ok {
			t.Fatalf("viewer %d: caravans module not active in the redacted fold", viewer)
		}
		tx, _ := scenarios.CaravansStateExt(truth)
		for p := range seats {
			if x.Bidded[engine.PlayerID(p)] != tx.Bidded[engine.PlayerID(p)] {
				t.Errorf("viewer %d: seat %d answered = %v, want %v",
					viewer, p, x.Bidded[engine.PlayerID(p)], tx.Bidded[engine.PlayerID(p)])
			}
		}
		if x.CamelsLeft != tx.CamelsLeft {
			t.Errorf("viewer %d: camels left = %d, want %d", viewer, x.CamelsLeft, tx.CamelsLeft)
		}
	}
}

// TestFullViewCarriesCamelPaths: LegalView must carry the camel placements,
// or the client's picker (armed from the module's pending list) comes up empty
// and the timer places the camel. It also pins what an engine/scenarios unit test
// cannot: that the field survives both the emptiness test and the copy in
// NewFullView.
func TestFullViewCarriesCamelPaths(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+caravans"}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	s.Phase = engine.PhasePlay
	s.Rolled = true
	s.Cur = 0

	// Open a vote as a qualifying turn does, then close it on a placer who is
	// not the current seat, the ordinary case since a vote opens as the
	// finisher's turn ends.
	const placer engine.PlayerID = 2
	vote := engine.NewEvent(scenarios.EvCamelVote, map[string]any{"finisher": placer})
	vote.Seq = s.NextSeq
	if err := engine.Apply(s, vote); err != nil {
		t.Fatalf("open vote: %v", err)
	}
	resolved := engine.NewEvent(scenarios.EvCamelResolved, map[string]any{"placer": placer})
	resolved.Seq = s.NextSeq
	if err := engine.Apply(s, resolved); err != nil {
		t.Fatalf("resolve vote: %v", err)
	}
	if n := len(s.LegalTargetsFor(placer).CamelPaths); n == 0 {
		t.Fatal("the engine offers no camel paths")
	}

	v := NewFullView(s, placer)
	if v.Legal == nil {
		t.Fatal("no Legal block for the seat holding the camel")
	}
	if len(v.Legal.CamelPaths) == 0 {
		t.Fatal("the view offers no camel paths")
	}
	for _, cp := range v.Legal.CamelPaths {
		if cp.Caravan < 0 || cp.Caravan > 2 {
			t.Errorf("camel path names caravan %d", cp.Caravan)
		}
	}

	// Nobody else is placing, so nobody else is offered the targets.
	for _, other := range []engine.PlayerID{0, 1, Spectator} {
		ov := NewFullView(s, other)
		if ov.Legal != nil && len(ov.Legal.CamelPaths) > 0 {
			t.Errorf("viewer %d sees seat %d's camel placements", other, placer)
		}
	}
}
