package discord

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnsureEntryPointCommand(t *testing.T) {
	var gotPath, gotMethod, gotAuth string
	var gotBody map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod, gotAuth = r.URL.Path, r.Method, r.Header.Get("Authorization")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"id":"cmd1","name":"launch"}`))
	}))
	defer ts.Close()

	c := Client{Token: "tok", BaseURL: ts.URL}
	if err := c.EnsureEntryPointCommand(context.Background(), "app1"); err != nil {
		t.Fatalf("EnsureEntryPointCommand: %v", err)
	}

	// Global commands endpoint (no guild), created with POST so other global
	// commands are left intact.
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q; want POST", gotMethod)
	}
	if gotPath != "/applications/app1/commands" {
		t.Errorf("path = %q; want /applications/app1/commands", gotPath)
	}
	if gotAuth != "Bot tok" {
		t.Errorf("auth = %q; want %q", gotAuth, "Bot tok")
	}
	// PRIMARY_ENTRY_POINT (type 4) with DISCORD_LAUNCH_ACTIVITY (handler 2) is what
	// makes the Activity's Launch button appear.
	if gotBody["type"] != float64(4) {
		t.Errorf("type = %v; want 4 (PRIMARY_ENTRY_POINT)", gotBody["type"])
	}
	if gotBody["handler"] != float64(2) {
		t.Errorf("handler = %v; want 2 (DISCORD_LAUNCH_ACTIVITY)", gotBody["handler"])
	}
	if gotBody["name"] == "" || gotBody["description"] == "" {
		t.Errorf("name/description required; got name=%v desc=%v", gotBody["name"], gotBody["description"])
	}
	// integration_types [0,1] (guild + user install) and contexts [0,1,2] (guild,
	// bot DM, group DM) are what let any user launch the Activity from anywhere in
	// Discord, not just servers where the bot is installed.
	if want := []any{float64(0), float64(1)}; !equalJSONList(gotBody["integration_types"], want) {
		t.Errorf("integration_types = %v; want [0,1] (guild + user install)", gotBody["integration_types"])
	}
	if want := []any{float64(0), float64(1), float64(2)}; !equalJSONList(gotBody["contexts"], want) {
		t.Errorf("contexts = %v; want [0,1,2] (guild, bot DM, group DM)", gotBody["contexts"])
	}
}

func equalJSONList(got any, want []any) bool {
	gs, ok := got.([]any)
	if !ok || len(gs) != len(want) {
		return false
	}
	for i := range want {
		if gs[i] != want[i] {
			return false
		}
	}
	return true
}

func TestEnsureEntryPointCommandError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message":"Missing Access","code":50001}`))
	}))
	defer ts.Close()

	c := Client{Token: "tok", BaseURL: ts.URL}
	if err := c.EnsureEntryPointCommand(context.Background(), "app1"); err == nil {
		t.Fatal("want an error on non-2xx response")
	}
}
