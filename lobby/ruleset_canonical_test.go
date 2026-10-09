package lobby

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// A host can spell a multi-module ruleset in any order, and the order would
// change the game: modules resolve in written order and the first DefaultConfig
// to claim TargetVP wins ("base+cak+caravans" is 13 VP, "base+caravans+cak"
// 12). Creation canonicalises the spelling; resolution and replay must not,
// because the string is in the event log.
func TestCreateCanonicalisesRuleset(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "rc", "Host")

	sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base+caravans+cak"}, false)
	if err != nil {
		t.Fatal(err)
	}
	const want = "base+cak+caravans"
	if sum.Game.Ruleset != want {
		t.Errorf("stored ruleset column = %q, want %q", sum.Game.Ruleset, want)
	}
	var cfg engine.GameConfig
	if err := json.Unmarshal(sum.Game.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Ruleset != want {
		t.Errorf("stored config ruleset = %q, want %q", cfg.Ruleset, want)
	}

	// Reconfiguring is the same creation-time surface and must normalise too.
	cfg.Ruleset = "base+fishermen+caravans"
	if _, err := l.UpdateConfig(host, sum.Game.ID, cfg); err != nil {
		t.Fatal(err)
	}
	g, err := st.GameByID(sum.Game.ID)
	if err != nil {
		t.Fatal(err)
	}
	if g.Ruleset != "base+caravans+fishermen" {
		t.Errorf("reconfigured ruleset = %q, want %q", g.Ruleset, "base+caravans+fishermen")
	}
}
