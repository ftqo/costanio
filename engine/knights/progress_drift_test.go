package knights

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The client mirrors the progress-deck composition so the rules page can show
// how common each card is (Merchant six times, Engineer once). Nothing in play
// reads that table, so this test catches drift, like
// cosmetics/freecolors_drift_test.go.
const progressCardsTS = "../../frontend/src/lib/progressCards.ts"

var countInTS = regexp.MustCompile(`(?m)^\s*([a-z_]+):\s*(\d+),`)

func TestFrontendProgressCountsMatchDecks(t *testing.T) {
	raw, err := os.ReadFile(progressCardsTS)
	if err != nil {
		t.Fatalf("reading %s: %v", progressCardsTS, err)
	}

	// Only the PROGRESS_COUNTS literal: other records in the file use the same ids.
	src := string(raw)
	start := strings.Index(src, "PROGRESS_COUNTS: Record<ProgressCardId, number> = {")
	if start < 0 {
		t.Fatalf("%s no longer declares PROGRESS_COUNTS as an object literal", progressCardsTS)
	}
	end := strings.Index(src[start:], "\n};")
	if end < 0 {
		t.Fatalf("%s: PROGRESS_COUNTS literal is not closed", progressCardsTS)
	}

	got := map[string]int{}
	for _, m := range countInTS.FindAllStringSubmatch(src[start:start+end], -1) {
		n := 0
		for _, c := range m[2] {
			n = n*10 + int(c-'0')
		}
		got[m[1]] = n
	}

	want := map[string]int{}
	for _, deck := range deckComposition {
		for card, n := range deck {
			want[string(card)] = n
		}
	}

	for card, n := range want {
		if got[card] != n {
			t.Errorf("%s: card %q is %d on the client, %d in deckComposition", progressCardsTS, card, got[card], n)
		}
	}
	for card := range got {
		if _, ok := want[card]; !ok {
			t.Errorf("%s: card %q is not in any deck", progressCardsTS, card)
		}
	}
}
