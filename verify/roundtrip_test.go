package verify

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/sim"
	"github.com/ftqo/costan.io/store"
)

// TestJSONRoundTripKeepsVerdict checks that decoding and re-encoding a
// replay leaves the verdict unchanged, which every tamper test relies on.
// Plain json.Unmarshal into map[string]any rounds the uint64 seeds and breaks
// the seed commitment; decodeReplay uses UseNumber to avoid that.
func TestJSONRoundTripKeepsVerdict(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	res, err := sim.RunGame(st, sim.Options{Players: 4, Ruleset: "base", DiceMode: "random", Seed: 21})
	if err != nil {
		t.Fatal(err)
	}
	seeds := engine.SeedsFrom(21)
	raw := replayJSON(t, st, res.GameID, seeds.Public)

	out, code := node(t, "verify/cli.mjs", writeTemp(t, raw))
	t.Logf("RAW: exit=%d verdict=%s", code, firstVerdict(out))

	blob, _ := json.Marshal(decodeReplay(t, raw))
	out2, code2 := node(t, "verify/cli.mjs", writeTemp(t, blob))
	t.Logf("ROUNDTRIPPED: exit=%d verdict=%s", code2, firstVerdict(out2))
	if code2 != code {
		t.Errorf("round-trip changed the exit code: %d -> %d\n%s", code, code2, out2)
	}
}

func firstVerdict(out string) string {
	for l := range strings.SplitSeq(out, "\n") {
		if strings.Contains(l, "VERIFIED") || strings.Contains(l, "FAILED") || strings.Contains(l, "UNAUDITABLE") {
			return strings.TrimSpace(l)
		}
	}
	return "(none)"
}
