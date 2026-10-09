package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/store"
)

func TestLiveGamesEndpoint(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "live-host", "Host")

	// One active public game (should appear) and one private active game (hidden).
	if err := e.st.CreateGame(&store.Game{ID: "live-pub", Ruleset: "base", Config: []byte("{}"), Public: true, CreatedBy: host.ID}); err != nil {
		t.Fatal(err)
	}
	e.st.SetGameStatus("live-pub", "active")
	if err := e.st.CreateGame(&store.Game{ID: "live-priv", Ruleset: "base", Config: []byte("{}"), CreatedBy: host.ID, InviteCode: "x"}); err != nil {
		t.Fatal(err)
	}
	e.st.SetGameStatus("live-priv", "active")

	resp, err := http.Get(e.ts.URL + "/api/games/live")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d; want 200", resp.StatusCode)
	}
	var out struct {
		Games []struct {
			Game struct {
				ID string `json:"id"`
			} `json:"game"`
		} `json:"games"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, g := range out.Games {
		ids[g.Game.ID] = true
	}
	if !ids["live-pub"] {
		t.Errorf("live games should include the active public game; got %v", ids)
	}
	if ids["live-priv"] {
		t.Errorf("live games must not include the private game; got %v", ids)
	}
}
