package game

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestGameCreatedSeedsRedactedEvenWhenPublic: game_created's seeds never reach
// a viewer, even if the event arrives with Visible nil (public) rather than the
// engine's Visible=[]. It is trimmed to config and commitments.
func TestGameCreatedSeedsRedactedEvenWhenPublic(t *testing.T) {
	data, _ := json.Marshal(engine.GameCreatedData{
		Config: engine.GameConfig{Players: 3}, Seed: 1234567, SeedCommit: "c1",
		PublicSeed: 7654321, PublicSeedCommit: "c2",
	})
	for _, vis := range [][]engine.PlayerID{nil, {}} {
		e := engine.Event{Type: engine.EvGameCreated, Visible: vis, Data: data}
		for _, viewer := range []engine.PlayerID{Spectator, 0} {
			out := RedactEvent(e, viewer)
			s := string(out.Data)
			if strings.Contains(s, "1234567") || strings.Contains(s, "7654321") || strings.Contains(s, `"seed"`) || strings.Contains(s, `"public_seed"`) {
				t.Errorf("visible=%v viewer=%d: seed published: %s", vis, viewer, s)
			}
			if !strings.Contains(s, `"seed_commit":"c1"`) || !strings.Contains(s, `"public_seed_commit":"c2"`) {
				t.Errorf("visible=%v viewer=%d: commitments dropped: %s", vis, viewer, s)
			}
			if out.Payload != nil {
				t.Errorf("visible=%v viewer=%d: typed payload cache survived redaction", vis, viewer)
			}
		}
	}
	// The broadcast encoder must agree: a public game_created's wire bytes
	// carry no seed either.
	e := engine.Event{Type: engine.EvGameCreated, Data: data}
	if f := encodeFrame("g", e); strings.Contains(string(f.full), "1234567") || strings.Contains(string(f.full), "7654321") {
		t.Errorf("broadcast frame carries a seed: %s", f.full)
	}
}
