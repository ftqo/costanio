package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// "After you play a progress card, discard it, placing it face down at the
// bottom of its matching deck." A played card cannot be drawn again until
// every card above it has been, and the bottom comes back in the order it was
// built.
func TestPlayedCardGoesUnderTheDeck(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	// Empty the shuffled part of the Politics deck but for one Spy, so the
	// order of the next draws is known.
	for c := range x.Decks[Politics] {
		x.Decks[Politics][c] = 0
	}
	x.Decks[Politics][CardSpy] = 1

	// Two cards go under, Warlord first.
	spot := knightSpotFor(t, s, p)
	x.Knights[spot] = Knight{Owner: p, Level: 1}
	x.Players[p].Progress = []ProgressCard{CardWarlord, CardSpy, CardSpy, CardSpy, CardWedding, CardDiplomat}
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, map[string]any{"card": CardWarlord})})
	step(t, s, engine.Command{Player: p, Type: CmdDiscardProgress, Data: mustJSON(t, map[string]any{"card": CardDiplomat})})
	if got := x.Under[Politics]; len(got) != 2 || got[0] != CardWarlord || got[1] != CardDiplomat {
		t.Fatalf("bottom of the politics deck = %v, want [warlord diplomat]", got)
	}
	if got := deckTotal(x, Politics); got != 3 {
		t.Fatalf("deck total = %d, want the 1 shuffled card plus the 2 underneath", got)
	}

	// Three draws: the shuffled Spy first, then the bottom oldest first.
	var drawn []ProgressCard
	for range 3 {
		card, under, ok := drawDeckCard(s, x, Politics, 1)
		if !ok {
			t.Fatal("deck ran dry early")
		}
		applyAll(t, s, []engine.Event{engine.NewEvent(EvProgressDrawn,
			progressCardData{Player: p, Card: card, Track: Politics, Under: under}, p)})
		drawn = append(drawn, card)
	}
	want := []ProgressCard{CardSpy, CardWarlord, CardDiplomat}
	for i := range want {
		if drawn[i] != want[i] {
			t.Fatalf("draw order = %v, want %v", drawn, want)
		}
	}
	if _, _, ok := drawDeckCard(s, x, Politics, 1); ok || deckTotal(x, Politics) != 0 {
		t.Errorf("the deck should be empty now (total %d)", deckTotal(x, Politics))
	}
}

// A log written before the bottom existed carries no `under` flag and folds as
// before: the card goes back into the shuffled part.
func TestOldReturnFoldsIntoShuffledDeck(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	x := ext(s)
	p := s.Cur
	x.Players[p].Progress = []ProgressCard{CardWarlord}
	before := x.Decks[Politics][CardWarlord]
	applyAll(t, s, []engine.Event{engine.NewEvent(EvProgressPlayed,
		progressCardData{Player: p, Card: CardWarlord, Track: Politics})})
	if x.Decks[Politics][CardWarlord] != before+1 || len(x.Under[Politics]) != 0 {
		t.Errorf("old return: shuffled %d (want %d), bottom %v (want empty)",
			x.Decks[Politics][CardWarlord], before+1, x.Under[Politics])
	}
}

// The event die's gate draws take the bottom queue too, in turn order from the
// current player, once the shuffled part has run out.
func TestGateDrawsReachTheBottomOfTheDeck(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	x := ext(s)
	for c := range x.Decks[Science] {
		x.Decks[Science][c] = 0
	}
	x.Under[Science] = []ProgressCard{CardAlchemist, CardCrane}
	for p := range x.Players {
		x.Players[p].Improve[Science] = 5 // draws on every red value
	}
	// The event die comes from the public stream at this roll's seq; walk the seq
	// until it shows the science gate (bounded, failing loudly).
	base := s.NextSeq
	for i := range 200 {
		s.NextSeq = base + i
		evs := (Module{}).onDiceRolled(s, 1, 2)
		face := ""
		var drawn []progressCardData
		for _, e := range evs {
			switch e.Type {
			case EvEventDie:
				face = engine.DecodeEvent[eventDieData](e).Face
			case EvProgressDrawn:
				drawn = append(drawn, engine.DecodeEvent[progressCardData](e))
			default:
			}
		}
		if face != "science" {
			continue
		}
		order := playersFromCurrent(s)
		if len(drawn) != 2 ||
			drawn[0].Player != order[0] || drawn[0].Card != CardAlchemist || !drawn[0].Under ||
			drawn[1].Player != order[1] || drawn[1].Card != CardCrane || !drawn[1].Under {
			t.Fatalf("gate draws = %+v, want alchemist then crane from under the deck to %v", drawn, order[:2])
		}
		return
	}
	fixtureGone(t, "a science gate in 200 roll positions")
}
