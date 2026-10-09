package bot

import (
	"encoding/json"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// The camel auction is open: bids are placed face up in seat order, so a bot
// reading `scenarios.CaravansExt.Bids` from the authoritative state reads nothing the
// table cannot (EvCamelBid has no redactor and the view publishes every bid).
// Open bids also make the coalition step possible (players agreeing on the
// camel's placement). TestRivalBidsArePublic checks that premise: if bids are
// ever sealed, the bot must stop reading them.
//
// The only other per-seat secret in these modules is `scenarios.FishExt.Held`, which
// bot/fishermen.go reads only for its own seat; its sealing is tested on the
// delivered bytes in game/fish_redaction_test.go.

// TestRivalBidsArePublic checks that every bid is published to every viewer,
// so a bot reading CaravansExt.Bids reads nothing the table cannot. It asserts
// on the module's view, which is what a player receives.
func TestRivalBidsArePublic(t *testing.T) {
	s, x := caravansGame(t, 4)
	x.Voting, x.Placer, x.Finisher = true, engine.NoPlayer, 1

	// A distinct bid per seat, so publishing the wrong seat's cards is caught.
	// Seat 3 has yet to answer.
	want := map[engine.PlayerID][2]int{1: {3, 1}, 2: {0, 2}, 0: {1, 0}}
	x.Bids = map[engine.PlayerID]scenarios.CamelBid{}
	x.Bidded = map[engine.PlayerID]bool{}
	for p, cards := range want {
		x.Bids[p] = scenarios.CamelBid{Cards: cards}
		x.Bidded[p] = true
	}

	for viewer := range engine.PlayerID(len(s.Players)) {
		raw, err := json.Marshal(x.ViewExt(viewer))
		if err != nil {
			t.Fatal(err)
		}
		var v struct {
			Bids []struct {
				Player engine.PlayerID `json:"player"`
				Cards  [2]int          `json:"cards"`
			} `json:"bids"`
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatal(err)
		}
		if len(v.Bids) != len(want) {
			t.Fatalf("viewer %d sees %d of %d bids: %s",
				viewer, len(v.Bids), len(want), raw)
		}
		for _, got := range v.Bids {
			if got.Cards != want[got.Player] {
				t.Errorf("viewer %d reads seat %d's bid as %v, want %v",
					viewer, got.Player, got.Cards, want[got.Player])
			}
		}
	}

	// No `your_bid` key: no bid is visible to its owner alone.
	raw, err := json.Marshal(x.ViewExt(0))
	if err != nil {
		t.Fatal(err)
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil {
		t.Fatal(err)
	}
	if _, ok := keys["your_bid"]; ok {
		t.Errorf("view has your_bid: %s", raw)
	}
}

// TestCamelBidLegalForAnyTableBid: for every shape of round (a table that
// passed, one that bid the cap, random tables in between) the engine accepts
// the bot's bid and it stays inside the cap. A refused bid drops the seat to
// auto.
func TestCamelBidLegalForAnyTableBid(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	checked := 0
	for _, seed := range []uint64{4, 7, 9, 21, 33} {
		s, x := caravansGame(t, seed)
		var first engine.CamelPath
		for _, p := range scenarios.CamelPaths(s) {
			if p.Caravan == 1 {
				first = p
				break
			}
		}
		if first.E == (board.Edge{}) {
			continue
		}
		place(t, s, 0, first)
		// Own the vertex the chain runs through so the round is worth something.
		s.Buildings[first.E.Other(x.ArrowCorner[1])] = engine.Building{Owner: 0}

		for _, finisher := range []engine.PlayerID{0, 1} {
			for seat := range engine.PlayerID(len(s.Players)) {
				for p := range s.Players {
					s.Players[p].Hand = engine.Hand{}
					s.Players[p].Hand[board.Sheep] = 2
					s.Players[p].Hand[board.Wheat] = 2
				}
				// Put the clock on this seat so it may answer.
				openRoundOn(t, s, x, finisher, seat)
				for _, scramble := range standingBidScrambles(rng, answeredSeats(x)) {
					x.Bids = scramble
					cmd, ok := NewStrong().camelAction(s, seat)
					if !ok {
						continue
					}
					if _, err := engine.Decide(s.Clone(), cmd); err != nil {
						t.Fatalf("seed %d finisher %d seat %d: bid %s refused: %v; "+
							"standing bids: %v", seed, finisher, seat, cmd.Data, err, scramble)
					}
					bid, err := engine.DecodeCommand[scenarios.CamelBid](cmd.Data)
					if err != nil {
						t.Fatal(err)
					}
					if bid.Total() > camelBidCapDefault {
						t.Errorf("seed %d finisher %d seat %d: named %d cards, cap %d",
							seed, finisher, seat, bid.Total(), camelBidCapDefault)
					}
					checked++
				}
			}
		}
	}
	if checked == 0 {
		t.Fatal("no bid offered on any fixture")
	}
	t.Logf("checked %d bids", checked)
}

// answeredSeats is who has already committed, in seat order (sorted so the
// rng-driven scrambles below are reproducible).
func answeredSeats(x *scenarios.CaravansExt) []engine.PlayerID {
	var out []engine.PlayerID
	for p, done := range x.Bidded {
		if done {
			out = append(out, p)
		}
	}
	slices.Sort(out)
	return out
}

// standingBidScrambles enumerates what the seats ahead of us on the clock could
// have committed. Seats behind the clock have not answered yet, so they never
// carry a bid.
func standingBidScrambles(rng *rand.Rand, answered []engine.PlayerID) []map[engine.PlayerID]scenarios.CamelBid {
	fill := func(f func(engine.PlayerID) scenarios.CamelBid) map[engine.PlayerID]scenarios.CamelBid {
		m := map[engine.PlayerID]scenarios.CamelBid{}
		for _, p := range answered {
			m[p] = f(p)
		}
		return m
	}
	out := []map[engine.PlayerID]scenarios.CamelBid{
		// the table passed: one card takes it
		fill(func(engine.PlayerID) scenarios.CamelBid { return scenarios.CamelBid{} }),
		// the table bid the cap: nothing wins
		fill(func(engine.PlayerID) scenarios.CamelBid { return scenarios.CamelBid{Cards: [2]int{2, 2}} }),
		// lopsided
		fill(func(p engine.PlayerID) scenarios.CamelBid { return scenarios.CamelBid{Cards: [2]int{int(p), 1}} }),
	}
	for range 4 {
		out = append(out, fill(func(engine.PlayerID) scenarios.CamelBid {
			return scenarios.CamelBid{Cards: [2]int{rng.IntN(3), rng.IntN(3)}}
		}))
	}
	return out
}
