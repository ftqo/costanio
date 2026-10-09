package sim

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// Supply conservation for the Caravans and Fishermen scenarios: a finite pile
// plus everything held out of it equals the starting count at every step of a
// real game, and nothing goes negative. Both modules keep their supply in
// State.Ext, where the resource ledger in checkRuleInvariants doesn't look.
//
// The engine fallback is degenerate (Caravans.auto bids {0,0} and takes the
// first legal path), so these tests run a bot that prices the auction
// (bot.WithCamelBids, off in the shipped bot) and fail if no card was paid or
// no fish spent: a conservation check over a mechanic that never ran passes
// trivially.

// foldChecked replays a finished game's transcript one event at a time, calling
// check after each (O(n), so every step fits in the default gate).
//
// check gets the event just folded and the type of the next one (empty at the
// end), because a ledger can be out of balance mid-transaction: Fishermen
// debits the supply on tab_fish_caught and credits hands on the following
// tab_fish_gained events in the same batch. A caller can wait for the batch to
// close.
func foldChecked(t *testing.T, events []engine.Event, check func(s *engine.State, e engine.Event, next engine.EventType)) *engine.State {
	t.Helper()
	s := engine.Empty()
	for i, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s at seq %d: %v", e.Type, e.Seq, err)
		}
		var next engine.EventType
		if i+1 < len(events) {
			next = events[i+1].Type
		}
		check(s, e, next)
	}
	return s
}

// supplySeeds is the seed block these two tests play, in the default gate
// (nine games each, a few seconds). The check is a single-goroutine fold, so
// under -race the block narrows like the rest of the package.
func supplySeeds() []uint64 {
	if raceEnabled {
		return []uint64{2}
	}
	return []uint64{2, 5, 8}
}

// botGame plays one seeded game with Strong in every seat and returns its log.
func botGame(t *testing.T, ruleset string, seed uint64, st *store.Store) []engine.Event {
	t.Helper()
	res, err := RunGame(st, Options{
		Players: 4, Ruleset: engine.CanonicalRuleset(ruleset), Seed: seed, IDTag: "tabsupply",
		// Not the 30s default: base+cak+caravans+fishermen+islands seed 2 is a
		// ~2,000-event game that takes over 30s under -race. The ceiling only
		// needs to catch a game that never ends.
		Timeout: 5 * time.Minute,
		Bots:    func(engine.PlayerID) game.CommandSource { return bot.NewStrong(bot.WithCamelBids()) },
	})
	if err != nil {
		t.Fatalf("%s seed %d: %v", ruleset, seed, err)
	}
	events, err := Transcript(st, res.GameID)
	if err != nil {
		t.Fatal(err)
	}
	return events
}

// TestCamelSupplyConserved: CamelsLeft plus every camel on the board equals the
// 22-tile set, at every step. applyPlaced writes the two halves on different
// lines, so a placement path that skips the supply shows up as drift.
func TestCamelSupplyConserved(t *testing.T) {
	st := openStore(t)
	placed, paid := 0, 0
	for _, rs := range canonical([]string{"base+caravans", "base+islands+caravans", "base+cak+caravans"}) {
		for _, seed := range supplySeeds() {
			events := botGame(t, rs, seed, st)
			foldChecked(t, events, func(s *engine.State, e engine.Event, _ engine.EventType) {
				x, ok := scenarios.CaravansStateExt(s)
				if !ok {
					return
				}
				if x.CamelsLeft < 0 {
					t.Fatalf("%s seed %d seq %d: camels left is %d", rs, seed, e.Seq, x.CamelsLeft)
				}
				onBoard := 0
				for i := range x.Chains {
					onBoard += len(x.Chains[i])
				}
				if onBoard+x.CamelsLeft != x.Supply() {
					t.Fatalf("%s seed %d seq %d (%s): %d camels on the board + %d left = %d, want the %d-tile set",
						rs, seed, e.Seq, e.Type, onBoard, x.CamelsLeft, onBoard+x.CamelsLeft, x.Supply())
				}
			})
			for _, e := range events {
				switch e.Type {
				case scenarios.EvCamelPlaced:
					placed++
				case scenarios.EvCamelResolved:
					// `cards`, a pair against the round's two bid resources (wool
					// and grain normally, brick and lumber with Knights).
					var d struct {
						Paid []struct {
							Cards [2]int `json:"cards"`
						} `json:"paid"`
					}
					if json.Unmarshal(e.Data, &d) == nil {
						for _, p := range d.Paid {
							paid += p.Cards[0] + p.Cards[1]
						}
					}
				default:
					// a tally, not a dispatch
				}
			}
		}
	}
	t.Logf("%d camels placed, %d cards paid into the auction", placed, paid)
	if placed == 0 {
		t.Fatal("no camel left the supply")
	}
	// Caravans.auto bids {0,0}, so a log with no cards paid never resolved
	// a round on a bid and the check above covers only auto's path.
	if paid == 0 {
		t.Fatal("no wool or grain paid into the auction")
	}
}

// TestFishSupplyConserved: per denomination, the face-down supply plus the spent
// pile plus every tile in hand equals the starting count, at every step.
//
// Per denomination because fish (11 ones, 10 twos, 8 threes) are spent by
// value, so handing back the wrong tile or reshuffling into the wrong slot
// keeps the tile count while changing the supply. Every step because the
// reshuffle (`supply, used = used, [3]int{}`) happens mid-game.
func TestFishSupplyConserved(t *testing.T) {
	st := openStore(t)
	drawn, spent := 0, 0
	for _, rs := range canonical([]string{"base+fishermen", "base+islands+fishermen", "base+fishermen+caravans"}) {
		for _, seed := range supplySeeds() {
			events := botGame(t, rs, seed, st)
			// Read the starting count off the game's setup: fishSupply is
			// unexported, and a restated constant would drift.
			var want [3]int
			got := false
			foldChecked(t, events, func(s *engine.State, e engine.Event, next engine.EventType) {
				x, ok := scenarios.FishStateExt(s)
				if !ok {
					return
				}
				// Mid-transaction: the catch has taken the tiles off the
				// supply and the gains that put them into hands are still
				// queued behind this event. Wait for the batch to close.
				if next == scenarios.EvFishGained {
					return
				}
				if !got {
					want, got = x.Supply, true
				}
				var total [3]int
				for v := range 3 {
					if x.Supply[v] < 0 || x.Used[v] < 0 {
						t.Fatalf("%s seed %d seq %d: negative fish pile supply=%v used=%v", rs, seed, e.Seq, x.Supply, x.Used)
					}
					total[v] = x.Supply[v] + x.Used[v]
				}
				for p := range x.Held {
					for v := range 3 {
						if x.Held[p][v] < 0 {
							t.Fatalf("%s seed %d seq %d: player %d holds %d tiles of denomination %d", rs, seed, e.Seq, p, x.Held[p][v], v+1)
						}
						total[v] += x.Held[p][v]
					}
				}
				if total != want {
					t.Fatalf("%s seed %d seq %d (%s): fish not conserved by denomination: %v, want %v (supply %v, used %v)",
						rs, seed, e.Seq, e.Type, total, want, x.Supply, x.Used)
				}
			})
			for _, e := range events {
				switch e.Type {
				case scenarios.EvFishGained:
					var d struct {
						Gain [3]int `json:"gain"`
					}
					if json.Unmarshal(e.Data, &d) == nil {
						drawn += d.Gain[0] + d.Gain[1] + d.Gain[2]
					}
				case scenarios.EvFishSpent:
					var d struct {
						Discard [3]int `json:"discard"`
					}
					if json.Unmarshal(e.Data, &d) == nil {
						spent += d.Discard[0] + d.Discard[1] + d.Discard[2]
					}
				default:
					// a tally, not a dispatch
				}
			}
		}
	}
	t.Logf("%d fish drawn, %d spent", drawn, spent)
	if drawn == 0 {
		t.Fatal("no fish ever drawn")
	}
	// Spending is what moves tiles into Used. Without a spend the reshuffle
	// and the whole Used column are untested.
	if spent == 0 {
		t.Fatal("no fish ever spent")
	}
}
