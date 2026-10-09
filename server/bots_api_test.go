package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/bot"
)

// TestBotsEndpointListsEveryPersonality covers the roster half of GET /api/bots.
// The endpoint is public (strategies and aggregate win counts, nothing about
// players), so this fetches it with no cookie.
func TestBotsEndpointListsEveryPersonality(t *testing.T) {
	e := newEnv(t)

	resp, err := http.Get(e.ts.URL + "/api/bots")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/bots = %d, want 200", resp.StatusCode)
	}
	var body struct {
		Personalities []botPersonalityRow `json:"personalities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	want := bot.Personalities()
	if len(body.Personalities) != len(want) {
		t.Fatalf("got %d personalities, want %d", len(body.Personalities), len(want))
	}
	// Registry order, not just membership: it is the display order a client
	// renders, and a map iteration here would shuffle the roster on every fetch.
	for i, got := range body.Personalities {
		if got.Name != want[i].Name {
			t.Errorf("row %d = %q, want %q (registry order)", i, got.Name, want[i].Name)
		}
		if got.Character != want[i].Character {
			t.Errorf("%s: character = %q, want %q", got.Name, got.Character, want[i].Character)
		}
		// No games played, so no record. Absent rather than an empty array is
		// what `omitempty` gives, and it is what "has not played yet" means.
		if len(got.Record) != 0 {
			t.Errorf("%s carries a record on a fresh store: %+v", got.Name, got.Record)
		}
	}
}

// TestBotsEndpointReportsRecords checks the stats half, including the filter:
// rows are keyed by the seat's display name, and anything that isn't a
// registered personality (an old name, a renamed bot seat) must not create a
// roster entry.
func TestBotsEndpointReportsRecords(t *testing.T) {
	e := newEnv(t)

	if err := e.st.BumpBotStats("Bot Winston", "base", true, false); err != nil {
		t.Fatal(err)
	}
	if err := e.st.BumpBotStats("Bot Winston", "base", false, false); err != nil {
		t.Fatal(err)
	}
	if err := e.st.BumpBotStats("Bot Nobody", "base", true, false); err != nil {
		t.Fatal(err)
	}

	resp, err := http.Get(e.ts.URL + "/api/bots")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body struct {
		Personalities []botPersonalityRow `json:"personalities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	seen := false
	for _, p := range body.Personalities {
		if p.Name == "Nobody" {
			t.Error("an unregistered bot name produced a roster entry")
		}
		if p.Name != "Winston" {
			if len(p.Record) != 0 {
				t.Errorf("%s carries a record it never earned: %+v", p.Name, p.Record)
			}
			continue
		}
		seen = true
		if len(p.Record) != 1 {
			t.Fatalf("Winston has %d record rows, want 1: %+v", len(p.Record), p.Record)
		}
		if r := p.Record[0]; r.Games != 2 || r.Wins != 1 || r.Ruleset != "base" {
			t.Errorf("Winston record = %+v, want 2 games / 1 win on base", r)
		}
	}
	if !seen {
		t.Error("Winston is missing from the roster")
	}
}
