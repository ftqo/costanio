package game

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// fishermenLog plays seeded fishermen games until one fits, and returns its
// full (unredacted) log. It does not require a spend: these bots hoard fish
// (see TestFishStatPopulated), and spend sealing is pinned in
// engine/scenarios/fish_hidden_test.go.
func fishermenLog(t *testing.T) []engine.Event {
	t.Helper()
	// The redaction tests need at least two seats ending the game with fish,
	// so each viewer has another seat's mix to be denied. Search for that
	// directly; t.Fatal, never Skip, when the budget runs out.
	for seed := uint64(1); seed <= 60; seed++ {
		events := finishedEventsSeed(t, "base+fishermen", seed)
		final, err := engine.Replay(events)
		if err != nil {
			t.Fatalf("seed %d: replay: %v", seed, err)
		}
		fx, ok := scenarios.FishStateExt(final)
		if !ok {
			continue
		}
		holding := 0
		for p := range final.Players {
			if fx.Held[p] != ([3]int{}) {
				holding++
			}
		}
		if holding >= 2 {
			return events
		}
	}
	t.Fatal("no seeded fishermen game in 60 ended with two seats holding fish")
	return nil
}

// hasKey reports whether a redacted payload still carries a field.
func hasKey(t *testing.T, data json.RawMessage, key string) bool {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal %s: %v", data, err)
	}
	_, ok := m[key]
	return ok
}

// TestFishMixIsPerSeatHiddenInformation pins the rule HowToPlay states: "Your
// fish total is public. Only the mix of tiles making it up is yours alone."
// It asserts on the bytes different viewers receive for the same event and on
// what each stream lets a viewer reconstruct.
func TestFishMixIsPerSeatHiddenInformation(t *testing.T) {
	events := fishermenLog(t)

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

	checkedGain, checkedSpend, checkedCatch, checkedMix := 0, 0, 0, 0
	for i, e := range events {
		switch e.Type {
		case scenarios.EvFishCaught:
			// A public event that is still trimmed: its supply snapshot is
			// needed by replay but would let anyone reconstruct the table's
			// tiles in aggregate, so RedactEvent removes it for every viewer,
			// spectators included.
			if e.Visible != nil {
				t.Fatalf("seq %d: EvFishCaught is no longer public: %v", e.Seq, e.Visible)
			}
			for _, viewer := range append([]engine.PlayerID{Spectator}, seatIDs(seats)...) {
				red := RedactEvent(e, viewer)
				for _, k := range []string{"supply", "used"} {
					if hasKey(t, red.Data, k) {
						t.Fatalf("seq %d: viewer %d receives the fish %s snapshot: %s",
							e.Seq, viewer, k, red.Data)
					}
				}
				if !hasKey(t, red.Data, "draws") {
					t.Fatalf("seq %d: viewer %d lost the public draw counts: %s", e.Seq, viewer, red.Data)
				}
				if hasKey(t, red.Data, "values") {
					t.Fatalf("seq %d: viewer %d receives per-seat fish VALUES: %s", e.Seq, viewer, red.Data)
				}
			}
			// The stored log keeps them, or replay stops reproducing the
			// draw-order reshuffle.
			if !hasKey(t, e.Data, "supply") {
				t.Fatalf("seq %d: truth event lost its supply snapshot: %s", e.Seq, e.Data)
			}
			checkedCatch++
		case scenarios.EvFishGained:
			var d struct {
				Player engine.PlayerID `json:"player"`
				Gain   [3]int          `json:"gain"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatal(err)
			}
			// An empty mix is legal only as a swap at the tile cap (a seat at 7
			// tokens may exchange a 1-fish token for a fresh draw, which can
			// net [0 0 0]). A seat that drew and swapped nothing gets no event.
			if d.Gain == [3]int{} {
				before, err := engine.Replay(events[:i])
				if err != nil {
					t.Fatalf("seq %d: replay to the catch: %v", e.Seq, err)
				}
				fx, ok := scenarios.FishStateExt(before)
				if !ok {
					t.Fatalf("seq %d: no fishermen ext in a fishermen game", e.Seq)
				}
				if n := scenarios.FishTileCount(fx.Held[d.Player]); n < scenarios.FishTileCap {
					t.Fatalf("seq %d: EvFishGained with an empty mix for seat %d, holding %d tiles of a %d cap",
						e.Seq, d.Player, n, scenarios.FishTileCap)
				}
			} else {
				checkedMix++
			}
			// The owner keeps the mix.
			own := RedactEvent(e, d.Player)
			if !hasKey(t, own.Data, "gain") {
				t.Fatalf("seq %d: owner lost their own mix: %s", e.Seq, own.Data)
			}
			// Nobody else, seated or spectating, may have it.
			for _, viewer := range otherViewers(d.Player, seats) {
				red := RedactEvent(e, viewer)
				if hasKey(t, red.Data, "gain") {
					t.Fatalf("seq %d: viewer %d sees seat %d's fish mix: %s",
						e.Seq, viewer, d.Player, red.Data)
				}
				if !hasKey(t, red.Data, "player") {
					t.Fatalf("seq %d: viewer %d cannot even tell who drew: %s", e.Seq, viewer, red.Data)
				}
			}
			checkedGain++

		case scenarios.EvFishSpent:
			var d struct {
				Player  engine.PlayerID `json:"player"`
				Use     string          `json:"use"`
				Discard [3]int          `json:"discard"`
				Value   int             `json:"value"`
				Tiles   int             `json:"tiles"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatal(err)
			}
			if d.Tiles == 0 {
				t.Fatalf("seq %d: EvFishSpent with no public tile count", e.Seq)
			}
			if !hasKey(t, RedactEvent(e, d.Player).Data, "discard") {
				t.Fatalf("seq %d: spender lost their own discard", e.Seq)
			}
			for _, viewer := range otherViewers(d.Player, seats) {
				red := RedactEvent(e, viewer)
				if hasKey(t, red.Data, "discard") {
					t.Fatalf("seq %d: viewer %d sees seat %d's discarded tiles: %s",
						e.Seq, viewer, d.Player, red.Data)
				}
				// The value is hidden too: spendTiles is deterministic and the
				// price ladder is public, so (use, value) names the discard. See
				// engine/scenarios.TestFishSpendValueLeaksTheDiscard.
				if hasKey(t, red.Data, "value") {
					t.Fatalf("seq %d: viewer %d sees what seat %d's tiles were worth: %s",
						e.Seq, viewer, d.Player, red.Data)
				}
				// How many tiles a spend took, and what it bought, stay public:
				// the tile counts every seat may track depend on them.
				if !hasKey(t, red.Data, "tiles") || !hasKey(t, red.Data, "use") {
					t.Fatalf("seq %d: viewer %d lost the public half of a spend: %s",
						e.Seq, viewer, red.Data)
				}
			}
			checkedSpend++
		default:
			// Only the two fish events matter here.
		}
	}
	if checkedGain == 0 {
		t.Fatal("no EvFishGained in the log")
	}
	if checkedCatch == 0 {
		t.Fatal("no EvFishCaught in the log")
	}
	// Empty mixes are legal, so require at least one gain that moved tiles,
	// or the sealing assertions only covered zero-net swaps.
	if checkedMix == 0 {
		t.Fatal("every EvFishGained in the log has an empty mix")
	}
	t.Logf("checked %d gains (%d with a non-empty mix), %d public catch halves and %d spends",
		checkedGain, checkedMix, checkedCatch, checkedSpend)
}

func otherViewers(owner engine.PlayerID, seats int) []engine.PlayerID {
	out := []engine.PlayerID{Spectator}
	for p := range seats {
		if engine.PlayerID(p) != owner {
			out = append(out, engine.PlayerID(p))
		}
	}
	return out
}

// TestFishRedactedStreamFoldsPublicState: hiding the mix must not
// cost a viewer anything public. Every viewer's redacted stream must still
// reproduce the boot and every seat's fish tile count, the numbers ViewExt
// publishes.
//
// Supply and Used are not among them. They are the mix in aggregate (the
// tile set is constant, so sum_p Held[p][v] = fishSupply[v] - Supply[v] -
// Used[v]), nothing public reads them, and they are stripped from every wire.
// A redacted fold's copy is stale, not wrong: applyCaught keeps what it had
// rather than treating absence as empty. The truth fold restores both exactly,
// and that is asserted too.
func TestFishRedactedStreamFoldsPublicState(t *testing.T) {
	events := fishermenLog(t)

	truth, err := engine.Replay(events)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	tx, ok := scenarios.FishStateExt(truth)
	if !ok {
		t.Fatal("fishermen module not active")
	}

	seats := len(truth.Players)

	// The truth fold first: replay determinism is the reason the supply
	// snapshot is still recorded, and the redactions below are only safe while
	// it holds.
	if replayed, err := engine.Replay(events); err != nil {
		t.Fatalf("truth replay: %v", err)
	} else if rx, ok := scenarios.FishStateExt(replayed); !ok {
		t.Fatal("fishermen module not active in the truth replay")
	} else if rx.Supply != tx.Supply || rx.Used != tx.Used {
		t.Errorf("truth replay supply/used = %v/%v, want %v/%v", rx.Supply, rx.Used, tx.Supply, tx.Used)
	}

	for _, viewer := range append([]engine.PlayerID{Spectator}, seatIDs(seats)...) {
		red := make([]engine.Event, len(events))
		for i, e := range events {
			red[i] = RedactEvent(e, viewer)
		}
		s, err := engine.Replay(red)
		if err != nil {
			t.Fatalf("viewer %d: replay of the redacted stream failed: %v", viewer, err)
		}
		x, ok := scenarios.FishStateExt(s)
		if !ok {
			t.Fatalf("viewer %d: fishermen module not active in the redacted fold", viewer)
		}
		// The supply snapshot does not reach this fold. Assert its absence is
		// harmless: no slot goes negative, and no fold claims the supply has
		// run out while the truth still has tiles.
		for i := range 3 {
			if x.Supply[i] < 0 {
				t.Errorf("viewer %d: supply slot %d went negative: %v", viewer, i, x.Supply)
			}
		}
		if x.Supply == ([3]int{}) && tx.Supply != ([3]int{}) {
			t.Errorf("viewer %d: redacted fold read an absent supply as empty (truth %v)", viewer, tx.Supply)
		}
		if x.BootHolder != tx.BootHolder || x.BootInPlay != tx.BootInPlay {
			t.Errorf("viewer %d: boot = (%d,%v), want (%d,%v)",
				viewer, x.BootHolder, x.BootInPlay, tx.BootHolder, tx.BootInPlay)
		}
		if x.TilesLeft != tx.TilesLeft {
			t.Errorf("viewer %d: tiles left = %d, want %d", viewer, x.TilesLeft, tx.TilesLeft)
		}

		// Every seat's fish tile count survives redaction. Assert it by folding
		// the redacted stream through the engine and reading the resulting
		// state and view, not by re-summing raw payloads.
		for p := range seats {
			held := tx.Held[p]
			want := held[0] + held[1] + held[2]
			if x.Tiles[p] != want {
				t.Errorf("viewer %d: folded fish tile count for seat %d = %d, want %d",
					viewer, p, x.Tiles[p], want)
			}
		}
		// The same numbers through the view a client reads: the public "tiles"
		// slice must match between the truth and this viewer's redacted fold.
		truthFish := viewFishTiles(t, tx, viewer)
		foldFish := viewFishTiles(t, x, viewer)
		if !slices.Equal(truthFish, foldFish) {
			t.Errorf("viewer %d: ViewExt tiles from the redacted fold = %v, want %v",
				viewer, foldFish, truthFish)
		}
		if slices.Max(truthFish) == 0 {
			t.Errorf("viewer %d: every seat ended on zero fish", viewer)
		}
		// No per-seat value is published to anybody, from either state: a value
		// beside a public draw count names the tiles.
		for _, x := range []*scenarios.FishExt{tx, x} {
			v, ok := x.ViewExt(viewer).(map[string]any)
			if !ok {
				t.Fatalf("ViewExt type = %T", x.ViewExt(viewer))
			}
			if _, leaked := v["fish"]; leaked {
				t.Errorf("viewer %d: the view publishes a per-seat fish value: %#v", viewer, v["fish"])
			}
		}

		// The mix does not travel: a viewer's fold carries its own seat's tiles
		// exactly and nothing for anyone else (every other Held stays zero).
		//
		// That is weaker than "cannot be inferred". A residual leak remains
		// and is documented in docs/scenarios.md; closing it would hide Supply,
		// Used or a spend's value, which the rules let the table count.
		interesting := 0
		for p := range seats {
			if engine.PlayerID(p) == viewer {
				if x.Held[p] != tx.Held[p] {
					t.Errorf("viewer %d: own held = %v, want %v", viewer, x.Held[p], tx.Held[p])
				}
				continue
			}
			if tx.Held[p] != ([3]int{}) {
				interesting++
			}
			if x.Held[p] != ([3]int{}) {
				t.Errorf("viewer %d folded seat %d's tile mix out of the log: %v (truth %v)",
					viewer, p, x.Held[p], tx.Held[p])
			}
		}
		if interesting == 0 {
			t.Errorf("viewer %d: no other seat ended holding fish", viewer)
		}
	}
}

func seatIDs(n int) []engine.PlayerID {
	out := make([]engine.PlayerID, n)
	for i := range n {
		out[i] = engine.PlayerID(i)
	}
	return out
}

// viewFishTiles pulls the public per-seat fish tile counts out of a FishExt's
// view. There is no per-seat value; see engine/scenarios.FishExt.Tiles.
func viewFishTiles(t *testing.T, x *scenarios.FishExt, viewer engine.PlayerID) []int {
	t.Helper()
	v, ok := x.ViewExt(viewer).(map[string]any)
	if !ok {
		t.Fatalf("ViewExt type = %T", x.ViewExt(viewer))
	}
	tiles, ok := v["tiles"].([]int)
	if !ok {
		t.Fatalf("view tiles = %#v", v["tiles"])
	}
	return tiles
}

// TestRedactionLeavesNoTypedPayload sweeps every hidden event that
// real games of three rulesets produce, plus every registered redactor.
//
// engine.Event.Payload is a typed cache of Data that engine.decode prefers. A
// redacted copy that kept it would look redacted on the wire (Payload is
// json:"-") but decode unredacted in process. The invariant is Payload's own
// contract: the cache must never disagree with Data. Events come from real
// games with the cache set to a sentinel.
func TestRedactionLeavesNoTypedPayload(t *testing.T) {
	seen := map[engine.EventType]int{}
	for _, ruleset := range []string{"base+cak", "base+fishermen", "base+caravans", "base+wagons"} {
		for _, e := range finishedEventsSeed(t, ruleset, 1) {
			if e.Visible == nil {
				continue // public: nothing to redact, and the cache is correct
			}
			e.Payload = "sentinel: a typed cache of the UNREDACTED payload"
			red := RedactEvent(e, Spectator)
			if red.Payload != nil {
				t.Errorf("%s: redacted event kept its payload cache (%v), wire carries %s",
					e.Type, red.Payload, red.Data)
			}
			if string(red.Data) == string(e.Data) {
				t.Errorf("%s: hidden event was not redacted at all: %s", e.Type, red.Data)
			}
			// A listed seat sees the event unredacted. An empty (not nil)
			// Visible list means hidden from everyone, with no owner to check.
			// Assert on Data, which is what a caller observes, not on whether
			// the owner's copy kept its cache.
			seen[e.Type]++
			if len(e.Visible) == 0 {
				continue
			}
			own := RedactEvent(e, e.Visible[0])
			if string(own.Data) != string(e.Data) {
				t.Errorf("%s: listed seat got a redacted event\n got=%s\nwant=%s", e.Type, own.Data, e.Data)
			}
			// Any cache it carries is the event's own: nil is allowed, a
			// mismatch never is.
			if own.Payload != nil && own.Payload != e.Payload {
				t.Errorf("%s: owner copy has a foreign payload cache: %v", e.Type, own.Payload)
			}
		}
	}
	if len(seen) < 3 {
		t.Fatalf("only %d hidden event types occurred across three rulesets (%v)", len(seen), seen)
	}
	t.Logf("hidden event types swept from real games: %v", seen)

	// Every registered class is swept: from a real game where one occurs,
	// otherwise synthetically, since bots rarely play most progress cards. The
	// contract belongs to the redactor, so a class no game produced is checked
	// against a sentinel payload: the cache must go and a non-party must not
	// get the hidden field back.
	swept := map[engine.EventType]bool{}
	for typ := range seen {
		swept[typ] = true
	}
	const sentinelField = "__must_not_survive__"
	for _, typ := range engine.RedactorTypes() {
		if swept[typ] {
			continue
		}
		e := engine.Event{
			Type:    typ,
			Seq:     1,
			Data:    json.RawMessage(`{"` + sentinelField + `":"hidden"}`),
			Visible: []engine.PlayerID{0},
			Payload: "sentinel: a typed cache of the UNREDACTED payload",
		}
		red := RedactEvent(e, Spectator)
		if red.Payload != nil {
			t.Errorf("%s: redacted event kept its payload cache (%v), wire carries %s",
				typ, red.Payload, red.Data)
		}
		if strings.Contains(string(red.Data), sentinelField) {
			t.Errorf("%s: redactor passed the hidden field through to a non-party: %s", typ, red.Data)
		}
		own := RedactEvent(e, 0)
		if string(own.Data) != string(e.Data) {
			t.Errorf("%s: listed seat got a redacted event\n got=%s\nwant=%s", typ, own.Data, e.Data)
		}
		if own.Payload != nil && own.Payload != e.Payload {
			t.Errorf("%s: owner copy has a foreign payload cache: %v", typ, own.Payload)
		}
		swept[typ] = true
	}
	// The floor is the registry, so a newly registered redactor is covered
	// automatically.
	for _, typ := range engine.RedactorTypes() {
		if !swept[typ] {
			t.Errorf("registered redaction class %s was never swept", typ)
		}
	}
}

// A typed payload cache must not survive redaction, or the in-process copy
// and the wire copy of the same event would disagree.
func TestRedactedEventDropsPayloadCache(t *testing.T) {
	e := engine.NewEvent(engine.EvCardStolen,
		engine.CardStolenData{Thief: 0, Victim: 1, Res: 3}, 0, 1)
	if e.Payload == nil {
		t.Fatal("engine.NewEvent did not cache a payload")
	}
	red := RedactEvent(e, Spectator)
	if red.Payload != nil {
		cached, _ := json.Marshal(red.Payload)
		t.Fatalf("in process: %s\non the wire: %s", cached, red.Data)
	}
	if got := engine.DecodeEvent[engine.CardStolenData](red); got.Res != 0 {
		t.Errorf("decoding the redacted event still yields the stolen card: %+v", got)
	}
}
