package knights

import (
	"bytes"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestProgressDrawnRedaction: a drawn pure-VP card (Constitution/Printer) is
// revealed face-up to opponents, while ordinary progress cards stay hidden.
func TestProgressDrawnRedaction(t *testing.T) {
	redact, ok := engine.RedactorFor(EvProgressDrawn)
	if !ok {
		t.Fatal("no redactor registered for EvProgressDrawn")
	}

	vp := redact(engine.NewEvent(EvProgressDrawn, progressCardData{Player: 1, Card: CardConstitution, Track: Politics}))
	if !bytes.Contains(vp, []byte(CardConstitution)) {
		t.Errorf("VP card should be revealed to opponents, got %s", vp)
	}

	hidden := redact(engine.NewEvent(EvProgressDrawn, progressCardData{Player: 1, Card: CardDeserter, Track: Politics}))
	if bytes.Contains(hidden, []byte(CardDeserter)) {
		t.Errorf("ordinary progress card should stay hidden, got %s", hidden)
	}
}
