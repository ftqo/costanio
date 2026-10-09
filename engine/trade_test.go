package engine

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// playState returns a 3p game in the play phase with the dice rolled and any 7
// already settled (discards taken, robber moved) via the engine's auto commands.
// Settling rather than skipping keeps its callers running whatever the board
// deals.
func playState(t *testing.T, seed uint64) *State {
	t.Helper()
	s, _ := newGame(t, 3, seed)
	runSetup(t, s)
	step(t, s, Command{Player: 0, Type: CmdRollDice})
	settleRoll(t, s, nil)
	if s.Cur != 0 || !s.Rolled || s.Phase != PhasePlay {
		t.Fatalf("playState: cur=%d phase=%v rolled=%v, want player 0 on a rolled play turn",
			s.Cur, s.Phase, s.Rolled)
	}
	return s
}

// settleRoll clears whatever the roll owed (post-7 discards, the robber move,
// an Islands gold pick) using the engine's auto commands, so the caller lands on
// a clean rolled turn whatever the dice said. record, when non-nil, receives
// every settling event, for callers building a log to replay.
func settleRoll(t *testing.T, s *State, record func([]Event)) {
	t.Helper()
	for i := 0; s.RobberPending || len(s.PendingDiscards) > 0; i++ {
		if i >= 64 {
			t.Fatalf("7 unresolved after 64 auto commands (robber=%v discards=%d)",
				s.RobberPending, len(s.PendingDiscards))
		}
		cmd, ok := AutoCommand(s)
		if !ok {
			t.Fatalf("no auto command settles the 7 (robber=%v discards=%d)",
				s.RobberPending, len(s.PendingDiscards))
		}
		evs := step(t, s, cmd)
		if record != nil {
			record(evs)
		}
	}
}

func totalCards(s *State) int {
	n := s.Bank.Count()
	for p := range s.Players {
		n += s.Players[p].Hand.Count()
	}
	return n
}

func TestBankTradeDefaultRatio(t *testing.T) {
	s := playState(t, 20)
	// Drop buildings so no harbor improves the ratio; the 4:1 default applies
	// regardless of where setup placed player 0 on this seed's board.
	s.Buildings = map[board.Vertex]Building{}
	s.Players[0].Hand = Hand{board.Wood: 4}
	before := totalCards(s)

	step(t, s, Command{Player: 0, Type: CmdBankTrade,
		Data: mustJSON(t, map[string]any{"give": board.Wood, "get": board.Ore, "count": 1})})

	if s.Players[0].Hand[board.Wood] != 0 || s.Players[0].Hand[board.Ore] != 1 {
		t.Errorf("hand after trade = %v", s.Players[0].Hand)
	}
	if totalCards(s) != before {
		t.Error("cards not conserved")
	}
}

func TestBankTradeInsufficient(t *testing.T) {
	s := playState(t, 21)
	// Drop buildings so no harbor improves the ratio; 4:1 applies.
	s.Buildings = map[board.Vertex]Building{}
	s.Players[0].Hand = Hand{board.Wood: 3} // 3 < 4
	_, err := Decide(s, Command{Player: 0, Type: CmdBankTrade,
		Data: mustJSON(t, map[string]any{"give": board.Wood, "get": board.Ore})})
	if !errors.Is(err, ErrNoResources) {
		t.Errorf("err = %v", err)
	}
}

// TestSameResourceBankTradeRejected: a 4-wood-for-1-wood maritime trade is
// illegal.
func TestSameResourceBankTradeRejected(t *testing.T) {
	s := playState(t, 25)
	s.Buildings = map[board.Vertex]Building{} // 4:1, no harbor
	s.Players[0].Hand = Hand{board.Wood: 4}
	s.Bank[board.Wood] = 10
	if _, err := Decide(s, Command{Player: 0, Type: CmdBankTrade,
		Data: mustJSON(t, map[string]any{"give": board.Wood, "get": board.Wood, "count": 1})}); !errors.Is(err, ErrSameResource) {
		t.Errorf("same-resource 4:1 bank trade: want ErrSameResource, got %v", err)
	}
}

func TestBankTradeHarborRatios(t *testing.T) {
	s := playState(t, 22)
	if len(s.Board.Harbors) == 0 {
		t.Fatal("no harbors")
	}
	// Plant player 0 on a generic harbor and a wood harbor; player 1 on
	// another harbor (must not help player 0).
	var generic, wood *board.Harbor
	for i := range s.Board.Harbors {
		h := &s.Board.Harbors[i]
		if h.Ratio == 3 && generic == nil {
			generic = h
		}
		if h.Ratio == 2 && h.Res == board.Wood {
			wood = h
		}
	}
	if generic == nil || wood == nil {
		t.Fatal("expected both harbor kinds on the board")
	}
	// Clear the board so only the harbors planted below affect the ratios.
	s.Buildings = map[board.Vertex]Building{}
	s.Buildings[generic.Verts[0]] = Building{Owner: 0}
	s.Buildings[wood.Verts[0]] = Building{Owner: 1}

	if r := s.bankRatio(0, board.Brick); r != 3 {
		t.Errorf("generic harbor ratio = %d, want 3", r)
	}
	if r := s.bankRatio(0, board.Wood); r != 3 {
		t.Errorf("player 0 wood ratio = %d, want 3 (wood harbor is player 1's)", r)
	}
	if r := s.bankRatio(1, board.Wood); r != 2 {
		t.Errorf("player 1 wood ratio = %d, want 2", r)
	}
	if r := s.bankRatio(2, board.Wood); r != 4 {
		t.Errorf("player 2 ratio = %d, want 4", r)
	}
}

// bankLaneModule proves bankRatio consults module BankRatio hooks even when a
// specific 2:1 harbor already matched. It offers 1:1 on ore so a module rate that
// beats every harbor is distinguishable from one that ties 2:1.
type bankLaneModule struct{}

func (bankLaneModule) Name() string                                              { return "banklane" }
func (bankLaneModule) SetupBoard(b *board.Board, cfg GameConfig, rng *rand.Rand) {}
func (bankLaneModule) Decide(s *State, cmd Command) ([]Event, bool, error)       { return nil, false, nil }
func (bankLaneModule) Apply(s *State, e Event) (bool, error)                     { return false, nil }
func (bankLaneModule) Hooks() Hooks {
	return Hooks{
		BankRatio: func(s *State, p PlayerID, res board.Resource) (int, bool) {
			if res == board.Ore {
				return 1, true
			}
			return 0, false
		},
	}
}

func init() { RegisterModule("banklane", func() Module { return bankLaneModule{} }) }

// TestBankRatioModulesUnderSpecificHarbor: the rate is the minimum over
// harbors and modules, with no short-circuit on the player's own 2:1 harbor.
func TestBankRatioModulesUnderSpecificHarbor(t *testing.T) {
	s := playState(t, 22)
	var ore *board.Harbor
	for i := range s.Board.Harbors {
		if h := &s.Board.Harbors[i]; h.Ratio == 2 && h.Res == board.Ore {
			ore = h
			break
		}
	}
	if ore == nil {
		t.Fatal("expected an ore harbor on the board")
	}
	s.Buildings = map[board.Vertex]Building{ore.Verts[0]: {Owner: 0}}
	s.Config.Ruleset = "base+banklane"

	if r := s.bankRatio(0, board.Ore); r != 1 {
		t.Errorf("ore ratio with a 2:1 harbor and a 1:1 module lane = %d, want 1", r)
	}
	// The harbor still wins where the module declines to bid.
	if r := s.bankRatio(0, board.Wood); r != 4 {
		t.Errorf("wood ratio = %d, want 4", r)
	}
}

func TestPlayerTradeFlow(t *testing.T) {
	s := playState(t, 23)
	s.Players[0].Hand = Hand{board.Wood: 2}
	s.Players[1].Hand = Hand{board.Ore: 1}
	s.Players[2].Hand = Hand{}
	before := totalCards(s)

	give := Hand{board.Wood: 2}
	want := Hand{board.Ore: 1}
	step(t, s, Command{Player: 0, Type: CmdOfferTrade, Data: mustJSON(t, map[string]any{"give": give, "want": want})})
	if s.ActiveOffer == nil || s.ActiveOffer.By != 0 {
		t.Fatalf("offer = %+v", s.ActiveOffer)
	}

	// Player 2 can't accept (no ore).
	_, err := Decide(s, Command{Player: 2, Type: CmdRespondTrade, Data: mustJSON(t, map[string]any{"accept": true})})
	if !errors.Is(err, ErrNoResources) {
		t.Errorf("poor accept err = %v", err)
	}
	step(t, s, Command{Player: 2, Type: CmdRespondTrade, Data: mustJSON(t, map[string]any{"accept": false})})
	step(t, s, Command{Player: 1, Type: CmdRespondTrade, Data: mustJSON(t, map[string]any{"accept": true})})

	// Offerer can't execute with the decliner.
	_, err = Decide(s, Command{Player: 0, Type: CmdExecuteTrade, Data: mustJSON(t, map[string]any{"with": PlayerID(2)})})
	if !errors.Is(err, ErrBadVictim) {
		t.Errorf("execute with decliner err = %v", err)
	}
	// Non-offerer can't execute.
	_, err = Decide(s, Command{Player: 1, Type: CmdExecuteTrade, Data: mustJSON(t, map[string]any{"with": PlayerID(1)})})
	if !errors.Is(err, ErrNotYourTurn) {
		t.Errorf("non-offerer execute err = %v", err)
	}

	step(t, s, Command{Player: 0, Type: CmdExecuteTrade, Data: mustJSON(t, map[string]any{"with": PlayerID(1)})})
	if s.Players[0].Hand[board.Ore] != 1 || s.Players[1].Hand[board.Wood] != 2 {
		t.Errorf("hands after trade: %v / %v", s.Players[0].Hand, s.Players[1].Hand)
	}
	if s.ActiveOffer != nil {
		t.Error("offer should clear after execution")
	}
	if totalCards(s) != before {
		t.Error("cards not conserved")
	}
}

// respondCmd builds a respond_trade for seat p. accept is ignored when retract
// is set, which mirrors the command's own semantics.
func respondCmd(t *testing.T, p PlayerID, accept, retract bool) Command {
	t.Helper()
	data := map[string]any{"accept": accept}
	if retract {
		data = map[string]any{"retract": true}
	}
	return Command{Player: p, Type: CmdRespondTrade, Data: mustJSON(t, data)}
}

// TestTradeResponseRevision walks sequences real players produce (revisions in
// both directions) and asserts the offer holds exactly one answer per seat, the
// last: never two buckets, never twice in one.
func TestTradeResponseRevision(t *testing.T) {
	type answer struct {
		accept, retract, counter bool
	}
	const (
		none = iota
		acceptedBucket
		declinedBucket
		counteredBucket
	)
	for _, tc := range []struct {
		name  string
		seq   []answer
		final int
	}{
		{"accept then retract", []answer{{accept: true}, {retract: true}}, none},
		{"decline then accept", []answer{{accept: false}, {accept: true}}, acceptedBucket},
		{"decline, accept, retract", []answer{{accept: false}, {accept: true}, {retract: true}}, none},
		{"accept then decline", []answer{{accept: true}, {accept: false}}, declinedBucket},
		{"counter then accept", []answer{{counter: true}, {accept: true}}, acceptedBucket},
		{"accept then counter", []answer{{accept: true}, {counter: true}}, counteredBucket},
		{"counter then retract", []answer{{counter: true}, {retract: true}}, none},
		{"counter twice", []answer{{counter: true}, {counter: true}}, counteredBucket},
		{"retract then accept again", []answer{{accept: true}, {retract: true}, {accept: true}}, acceptedBucket},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Empty()
			s.Phase = PhasePlay
			s.Cur = 0
			s.Config.TargetVP = 10
			s.Players = []PlayerState{{}, {}, {}}
			s.Players[0].Hand = Hand{board.Wood: 2}
			s.Players[1].Hand = Hand{board.Ore: 1, board.Brick: 1}
			s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 2}, Want: Hand{board.Ore: 1}}

			for i, a := range tc.seq {
				var cmd Command
				if a.counter {
					cmd = Command{Player: 1, Type: CmdCounterTrade, Data: mustJSON(t,
						TradeCounteredData{Give: Hand{board.Brick: 1}, Want: Hand{board.Wood: 1}})}
				} else {
					cmd = respondCmd(t, 1, a.accept, a.retract)
				}
				evs, err := Decide(s, cmd)
				if err != nil {
					t.Fatalf("answer %d (%+v): %v", i, a, err)
				}
				for _, e := range evs {
					if err := Apply(s, e); err != nil {
						t.Fatalf("apply: %v", err)
					}
				}
			}

			o := s.ActiveOffer
			if o == nil {
				t.Fatal("offer withdrawn, want standing")
			}
			got := none
			switch {
			case slices.Contains(o.Accepted, 1):
				got = acceptedBucket
			case slices.Contains(o.Declined, 1):
				got = declinedBucket
			case o.isCounterer(1):
				got = counteredBucket
			}
			if got != tc.final {
				t.Errorf("final answer bucket = %d, want %d (offer %+v)", got, tc.final, o)
			}
			// One answer, in one place, once.
			n := len(o.Accepted) + len(o.Declined) + len(o.Counters)
			if want := map[bool]int{true: 0, false: 1}[tc.final == none]; n != want {
				t.Errorf("offer records %d answers, want %d: %+v", n, want, o)
			}
		})
	}
}

// TestTradeResponseNoOps: repeating the same answer, or withdrawing one never
// given, is refused.
func TestTradeResponseNoOps(t *testing.T) {
	s := Empty()
	s.Phase = PhasePlay
	s.Cur = 0
	s.Config.TargetVP = 10
	s.Players = []PlayerState{{}, {}}
	s.Players[0].Hand = Hand{board.Wood: 1}
	s.Players[1].Hand = Hand{board.Ore: 1}
	s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 1}, Want: Hand{board.Ore: 1}}

	if _, err := Decide(s, respondCmd(t, 1, false, true)); !errors.Is(err, ErrNoResponse) {
		t.Errorf("retracting nothing: err = %v, want ErrNoResponse", err)
	}
	for _, e := range step(t, s, respondCmd(t, 1, true, false)) {
		_ = e
	}
	if _, err := Decide(s, respondCmd(t, 1, true, false)); !errors.Is(err, ErrAlreadyResponded) {
		t.Errorf("repeating an acceptance: err = %v, want ErrAlreadyResponded", err)
	}
	step(t, s, respondCmd(t, 1, false, false)) // changing to a decline is fine
	if _, err := Decide(s, respondCmd(t, 1, false, false)); !errors.Is(err, ErrAlreadyResponded) {
		t.Errorf("repeating a decline: err = %v, want ErrAlreadyResponded", err)
	}
	// The offerer still answers their own offer with cancel/execute, not this.
	if _, err := Decide(s, respondCmd(t, 0, true, false)); !errors.Is(err, ErrBadCommand) {
		t.Errorf("offerer responding to own offer: err = %v, want ErrBadCommand", err)
	}
}

// TestRetractedAcceptCannotBeExecuted: if the retraction is decided first, the
// execute that follows finds nobody to trade with.
func TestRetractedAcceptCannotBeExecuted(t *testing.T) {
	s := Empty()
	s.Phase = PhasePlay
	s.Cur = 0
	s.Config.TargetVP = 10
	s.Players = []PlayerState{{}, {}}
	s.Players[0].Hand = Hand{board.Wood: 1}
	s.Players[1].Hand = Hand{board.Ore: 1}
	s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 1}, Want: Hand{board.Ore: 1}}

	step(t, s, respondCmd(t, 1, true, false))
	step(t, s, respondCmd(t, 1, false, true))
	if _, err := Decide(s, Command{Player: 0, Type: CmdExecuteTrade,
		Data: mustJSON(t, map[string]any{"with": PlayerID(1)})}); !errors.Is(err, ErrBadVictim) {
		t.Errorf("execute against a retracted acceptance: err = %v, want ErrBadVictim", err)
	}
	if s.Players[0].Hand[board.Wood] != 1 || s.Players[1].Hand[board.Ore] != 1 {
		t.Errorf("hands moved on a refused execute: %v / %v", s.Players[0].Hand, s.Players[1].Hand)
	}
}

// TestReCounterReplacesTerms: the offerer settles on the counter-er's latest
// terms, not the first ones posted.
func TestReCounterReplacesTerms(t *testing.T) {
	s := Empty()
	s.Phase = PhasePlay
	s.Cur = 0
	s.Config.TargetVP = 10
	s.Players = []PlayerState{{}, {}}
	s.Players[0].Hand = Hand{board.Wood: 2}
	s.Players[1].Hand = Hand{board.Brick: 2}
	s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 2}, Want: Hand{board.Ore: 1}}

	counter := func(give, want Hand) Command {
		return Command{Player: 1, Type: CmdCounterTrade,
			Data: mustJSON(t, TradeCounteredData{Give: give, Want: want})}
	}
	step(t, s, counter(Hand{board.Brick: 2}, Hand{board.Wood: 1}))
	step(t, s, counter(Hand{board.Brick: 1}, Hand{board.Wood: 2}))
	if n := len(s.ActiveOffer.Counters); n != 1 {
		t.Fatalf("counters on record = %d, want 1: %+v", n, s.ActiveOffer.Counters)
	}
	step(t, s, Command{Player: 0, Type: CmdExecuteTrade, Data: mustJSON(t, map[string]any{"with": PlayerID(1)})})
	if s.Players[0].Hand[board.Brick] != 1 || s.Players[1].Hand[board.Wood] != 2 {
		t.Errorf("settled on the superseded counter: %v / %v", s.Players[0].Hand, s.Players[1].Hand)
	}
}

// TestOfferDiesWhenOffererSpendsItsCards: an offer the offerer can no longer
// honour is closed rather than left soliciting acceptances that cannot settle.
func TestOfferDiesWhenOffererSpendsItsCards(t *testing.T) {
	s := playState(t, 27)
	s.Buildings = map[board.Vertex]Building{} // 4:1, no harbor
	s.Players[0].Hand = Hand{board.Wheat: 4, board.Sheep: 1}

	// Offering the wheat, then spending it at the bank, closes the offer.
	step(t, s, Command{Player: 0, Type: CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": Hand{board.Wheat: 4}, "want": Hand{board.Ore: 1}})})
	evs := step(t, s, Command{Player: 0, Type: CmdBankTrade,
		Data: mustJSON(t, map[string]any{"give": board.Wheat, "get": board.Brick, "count": 1})})
	if s.ActiveOffer != nil {
		t.Error("offer should close once its cards are gone")
	}
	if evs[len(evs)-1].Type != EvTradeCancelled {
		t.Errorf("closure missing from the log: %+v", evs)
	}

	// An offer whose stake is untouched by the spend stands.
	s.Players[0].Hand = Hand{board.Wheat: 4, board.Sheep: 1}
	step(t, s, Command{Player: 0, Type: CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": Hand{board.Sheep: 1}, "want": Hand{board.Ore: 1}})})
	step(t, s, Command{Player: 0, Type: CmdBankTrade,
		Data: mustJSON(t, map[string]any{"give": board.Wheat, "get": board.Brick, "count": 1})})
	if s.ActiveOffer == nil {
		t.Error("offer closed by a spend that left the offered cards")
	}
}

// TestTradeNegotiationReplays: a log full of revisions, re-counters and an
// auto-closed offer must replay to exactly the live state.
func TestTradeNegotiationReplays(t *testing.T) {
	s, log := newGame(t, 3, 28)
	record := func(evs []Event) { log = append(log, evs...) }
	runSetupLogged := func() {
		for s.Phase == PhaseSetup {
			p := s.Cur
			v := findSettlementSpot(s)
			record(step(t, s, Command{Player: p, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": v})}))
			record(step(t, s, Command{Player: p, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": roadFor(s, v)})}))
		}
	}
	runSetupLogged()
	record(step(t, s, Command{Player: 0, Type: CmdRollDice}))
	// A 7 is settled and its events recorded, so the log still accounts for
	// the whole state.
	settleRoll(t, s, record)
	// Deal the cards through the log rather than by assigning hands, or the
	// replay comparison means nothing.
	grant := func(p PlayerID, h Hand) {
		e := mustEvent(EvStartingRes, StartingResData{Player: p, Gain: h})
		e.Seq = s.NextSeq
		if err := Apply(s, e); err != nil {
			t.Fatalf("grant: %v", err)
		}
		record([]Event{e})
	}
	grant(0, Hand{board.Wood: 2})
	grant(1, Hand{board.Ore: 1, board.Brick: 1})
	grant(2, Hand{board.Ore: 1})

	record(step(t, s, Command{Player: 0, Type: CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": Hand{board.Wood: 2}, "want": Hand{board.Ore: 1}})}))
	record(step(t, s, respondCmd(t, 1, true, false)))
	record(step(t, s, respondCmd(t, 1, false, false)))
	record(step(t, s, Command{Player: 1, Type: CmdCounterTrade,
		Data: mustJSON(t, TradeCounteredData{Give: Hand{board.Brick: 1}, Want: Hand{board.Wood: 1}})}))
	record(step(t, s, respondCmd(t, 1, false, true)))
	record(step(t, s, respondCmd(t, 2, true, false)))
	record(step(t, s, Command{Player: 0, Type: CmdExecuteTrade,
		Data: mustJSON(t, map[string]any{"with": PlayerID(2)})}))

	replayed, err := Replay(log)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	for p := range s.Players {
		if replayed.Players[p].Hand != s.Players[p].Hand {
			t.Errorf("seat %d hand: replay %v, live %v", p, replayed.Players[p].Hand, s.Players[p].Hand)
		}
	}
	if replayed.ActiveOffer != nil || s.ActiveOffer != nil {
		t.Errorf("offer after execution: replay %+v, live %+v", replayed.ActiveOffer, s.ActiveOffer)
	}
}

// TestFoldLegacyResponsesUnchanged: responses logged before revision existed
// carry no "retract" key and were emitted at most once per seat, so the
// revision-aware fold must land them exactly where the old fold did.
func TestFoldLegacyResponsesUnchanged(t *testing.T) {
	s := Empty()
	s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 1}, Want: Hand{board.Ore: 1}}
	for seq, raw := range []string{`{"player":1,"accept":true}`, `{"player":2,"accept":false}`} {
		if err := Apply(s, Event{Seq: seq, Type: EvTradeResponded, Data: json.RawMessage(raw)}); err != nil {
			t.Fatalf("apply %s: %v", raw, err)
		}
	}
	if !slices.Equal(s.ActiveOffer.Accepted, []PlayerID{1}) || !slices.Equal(s.ActiveOffer.Declined, []PlayerID{2}) {
		t.Errorf("legacy responses folded to %+v", s.ActiveOffer)
	}
}

func TestTradeOfferValidation(t *testing.T) {
	s := playState(t, 24)
	s.Players[0].Hand = Hand{board.Wood: 1}

	for _, payload := range []map[string]any{
		{"give": Hand{}, "want": Hand{board.Ore: 1}},               // empty give
		{"give": Hand{board.Wood: 1}, "want": Hand{}},              // empty want
		{"give": Hand{board.Brick: 1}, "want": Hand{board.Ore: 1}}, // doesn't hold give
	} {
		if _, err := Decide(s, Command{Player: 0, Type: CmdOfferTrade, Data: mustJSON(t, payload)}); err == nil {
			t.Errorf("payload %v should fail", payload)
		}
	}
}

// TestSameResourceOfferRejected: a domestic trade may not have the same resource
// on both sides (1 wood for 2 wood), even when other resources are involved.
func TestSameResourceOfferRejected(t *testing.T) {
	s := playState(t, 26)
	s.Players[0].Hand = Hand{board.Wood: 1}
	give := Hand{board.Wood: 1}
	want := Hand{board.Wood: 2}
	if _, err := Decide(s, Command{Player: 0, Type: CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": give, "want": want})}); !errors.Is(err, ErrSameResource) {
		t.Errorf("same-resource player offer: want ErrSameResource, got %v", err)
	}

	// Partial overlap (give brick+wood, want wood) is equally forbidden: wood
	// appears on both sides.
	s.Players[0].Hand = Hand{board.Brick: 1, board.Wood: 1}
	give = Hand{board.Brick: 1, board.Wood: 1}
	want = Hand{board.Wood: 1}
	if _, err := Decide(s, Command{Player: 0, Type: CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": give, "want": want})}); !errors.Is(err, ErrSameResource) {
		t.Errorf("partial-overlap player offer: want ErrSameResource, got %v", err)
	}
}

// TestSameResourceCounterRejected: a counter-offer is held to the same no-like-
// for-like rule as the original offer.
func TestSameResourceCounterRejected(t *testing.T) {
	s := Empty()
	s.Phase = PhasePlay
	s.Players = []PlayerState{{}, {}, {}}
	s.Players[0].Hand = Hand{board.Wood: 1}
	s.Players[1].Hand = Hand{board.Sheep: 2}
	s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 1}, Want: Hand{board.Sheep: 1}}

	if _, err := decideCounterTrade(s, Command{Player: 1, Type: CmdCounterTrade,
		Data: mustJSON(t, TradeCounteredData{Give: Hand{board.Sheep: 1}, Want: Hand{board.Sheep: 1}})}); !errors.Is(err, ErrSameResource) {
		t.Errorf("same-resource counter: want ErrSameResource, got %v", err)
	}
}

func TestCounterOfferStateHelpers(t *testing.T) {
	o := &TradeOffer{By: 0}
	o.Counters = append(o.Counters, CounterOffer{By: 2, Give: Hand{1: 1}, Want: Hand{2: 1}})
	if !o.responded(2) {
		t.Error("countering player not counted as responded")
	}
	if o.responded(1) {
		t.Error("player 1 never responded")
	}
	c, ok := o.counterBy(2)
	if !ok || c.Want[2] != 1 {
		t.Errorf("counterBy(2) = %+v, %v; want the stored counter", c, ok)
	}
	if _, ok := o.counterBy(1); ok {
		t.Error("counterBy(1) should be absent")
	}
}

func TestCloneDeepCopiesCounters(t *testing.T) {
	s := Empty()
	s.ActiveOffer = &TradeOffer{By: 0, Counters: []CounterOffer{{By: 1, Give: Hand{1: 1}}}}
	c := s.Clone()
	c.ActiveOffer.Counters[0].By = 9 // mutate the clone
	if s.ActiveOffer.Counters[0].By != 1 {
		t.Error("Clone shares Counters with the original")
	}
}

func TestDecideCounterTrade(t *testing.T) {
	s := Empty()
	s.Phase = PhasePlay
	s.Players = []PlayerState{{}, {}, {}}
	s.Players[0].Hand = Hand{board.Wood: 1}  // offerer holds wood
	s.Players[1].Hand = Hand{board.Brick: 2} // counter-er holds brick
	s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 1}, Want: Hand{board.Sheep: 1}}

	// Player 1 counters: gives 1 brick, wants 1 wood from the offerer.
	evs, err := decideCounterTrade(s, Command{Player: 1, Type: CmdCounterTrade,
		Data: mustJSON(t, TradeCounteredData{Give: Hand{board.Brick: 1}, Want: Hand{board.Wood: 1}})})
	if err != nil {
		t.Fatalf("decideCounterTrade: %v", err)
	}
	if len(evs) != 1 || evs[0].Type != EvTradeCountered {
		t.Fatalf("want one EvTradeCountered, got %+v", evs)
	}

	// The offerer cannot counter their own offer.
	if _, err := decideCounterTrade(s, Command{Player: 0, Type: CmdCounterTrade,
		Data: mustJSON(t, TradeCounteredData{Give: Hand{board.Wood: 1}, Want: Hand{board.Brick: 1}})}); !errors.Is(err, ErrBadCommand) {
		t.Errorf("offerer countering own offer: err = %v, want ErrBadCommand", err)
	}
	// Cannot counter with cards you don't hold.
	if _, err := decideCounterTrade(s, Command{Player: 1, Type: CmdCounterTrade,
		Data: mustJSON(t, TradeCounteredData{Give: Hand{board.Wheat: 9}, Want: Hand{board.Wood: 1}})}); !errors.Is(err, ErrNoResources) {
		t.Errorf("countering with cards not held: err = %v, want ErrNoResources", err)
	}
	// Each side must put up at least one card.
	if _, err := decideCounterTrade(s, Command{Player: 1, Type: CmdCounterTrade,
		Data: mustJSON(t, TradeCounteredData{Give: Hand{board.Brick: 1}, Want: Hand{}})}); !errors.Is(err, ErrBadCommand) {
		t.Errorf("empty want: err = %v, want ErrBadCommand", err)
	}
}

func TestFoldCounterAppends(t *testing.T) {
	s := Empty()
	s.ActiveOffer = &TradeOffer{By: 0}
	e := mustEvent(EvTradeCountered, TradeCounteredData{Player: 1, Give: Hand{board.Brick: 1}, Want: Hand{board.Wood: 1}})
	e.Seq = s.NextSeq
	if err := Apply(s, e); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(s.ActiveOffer.Counters) != 1 || s.ActiveOffer.Counters[0].By != 1 {
		t.Fatalf("counter not folded onto the offer: %+v", s.ActiveOffer)
	}
}

func TestExecuteAgainstCounter(t *testing.T) {
	s := Empty()
	s.Phase = PhasePlay
	s.Players = []PlayerState{{}, {}, {}}
	s.Players[0].Hand = Hand{board.Wood: 1}  // offerer holds 1 wood
	s.Players[1].Hand = Hand{board.Brick: 1} // counter-er holds 1 brick
	s.ActiveOffer = &TradeOffer{
		By:   0,
		Give: Hand{board.Wood: 1}, Want: Hand{board.Sheep: 1}, // original terms (now irrelevant)
		Counters: []CounterOffer{{By: 1, Give: Hand{board.Brick: 1}, Want: Hand{board.Wood: 1}}},
	}

	evs, err := decideExecuteTrade(s, Command{Player: 0, Type: CmdExecuteTrade,
		Data: mustJSON(t, map[string]any{"with": 1})})
	if err != nil {
		t.Fatalf("execute against counter: %v", err)
	}
	for i := range evs {
		evs[i].Seq = s.NextSeq
		if err := Apply(s, evs[i]); err != nil {
			t.Fatalf("apply: %v", err)
		}
	}
	// Offerer gave 1 wood, received 1 brick; counter-er the reverse.
	if s.Players[0].Hand[board.Wood] != 0 || s.Players[0].Hand[board.Brick] != 1 {
		t.Errorf("offerer hand = %v, want 1 brick / 0 wood", s.Players[0].Hand)
	}
	if s.Players[1].Hand[board.Wood] != 1 || s.Players[1].Hand[board.Brick] != 0 {
		t.Errorf("counter-er hand = %v, want 1 wood / 0 brick", s.Players[1].Hand)
	}
	if s.ActiveOffer != nil {
		t.Error("offer should clear after execution")
	}
}

func TestExecuteAgainstNonResponderFails(t *testing.T) {
	s := Empty()
	s.Phase = PhasePlay
	s.Players = []PlayerState{{}, {}}
	s.Players[0].Hand = Hand{board.Wood: 1}
	s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 1}, Want: Hand{board.Brick: 1}}
	if _, err := decideExecuteTrade(s, Command{Player: 0, Type: CmdExecuteTrade,
		Data: mustJSON(t, map[string]any{"with": 1})}); !errors.Is(err, ErrBadVictim) {
		t.Errorf("execute against a non-responder: want ErrBadVictim, got %v", err)
	}
}

func TestTradeCancelAndTurnEnd(t *testing.T) {
	s := playState(t, 25)
	s.Players[0].Hand = Hand{board.Wood: 1}

	step(t, s, Command{Player: 0, Type: CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": Hand{board.Wood: 1}, "want": Hand{board.Ore: 1}})})
	step(t, s, Command{Player: 0, Type: CmdCancelTrade})
	if s.ActiveOffer != nil {
		t.Error("offer should be canceled")
	}
	if _, err := Decide(s, Command{Player: 1, Type: CmdRespondTrade, Data: mustJSON(t, map[string]any{"accept": true})}); !errors.Is(err, ErrNoOffer) {
		t.Errorf("respond after cancel err = %v", err)
	}

	// Open offers die with the turn.
	step(t, s, Command{Player: 0, Type: CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": Hand{board.Wood: 1}, "want": Hand{board.Ore: 1}})})
	step(t, s, Command{Player: 0, Type: CmdEndTurn})
	if s.ActiveOffer != nil {
		t.Error("offer should die with the turn")
	}
}

// TestApplyTradeCancelledSpellings: both persisted spellings of the trade-cancel
// event ("trade_cancelled", and "trade_canceled" from a reverted linter autofix)
// must keep decoding, or scoreboard rebuild and finalize fail with "unknown event
// type".
func TestApplyTradeCancelledSpellings(t *testing.T) {
	for _, spelling := range []string{"trade_cancelled", "trade_canceled"} {
		s := playState(t, 25)
		s.ActiveOffer = &TradeOffer{By: 0, Give: Hand{board.Wood: 1}, Want: Hand{board.Sheep: 1}}

		e := Event{Seq: s.NextSeq, Type: EventType(spelling), Data: []byte("{}")}
		if err := Apply(s, e); err != nil {
			t.Fatalf("Apply(%q) = %v; want nil", spelling, err)
		}
		if s.ActiveOffer != nil {
			t.Errorf("%q should clear the active offer", spelling)
		}
	}
}
