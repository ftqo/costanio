package discord

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegisterOpsCommands(t *testing.T) {
	var gotMethod, gotPath string
	var cmds []map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &cmds)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`[]`))
	}))
	defer ts.Close()

	c := Client{Token: "tok", GuildID: "g1", BaseURL: ts.URL}
	if err := c.RegisterOpsCommands(context.Background(), "app1", []string{"base", "base+islands"}); err != nil {
		t.Fatalf("RegisterOpsCommands: %v", err)
	}

	// Guild commands endpoint, PUT to overwrite the set idempotently.
	if gotMethod != http.MethodPut {
		t.Errorf("method = %q; want PUT", gotMethod)
	}
	if gotPath != "/applications/app1/guilds/g1/commands" {
		t.Errorf("path = %q", gotPath)
	}

	byName := map[string]map[string]any{}
	for _, cmd := range cmds {
		byName[cmd["name"].(string)] = cmd
	}
	for _, want := range []string{"stats", "spectate", "leaderboard", "link", "whois", "reset-user"} {
		if _, ok := byName[want]; !ok {
			t.Errorf("missing command %q (got %v)", want, keysOf(byName))
		}
	}

	// Admin commands are hidden by default_member_permissions; community ones are not.
	for _, n := range []string{"whois", "reset-user"} {
		if _, ok := byName[n]["default_member_permissions"]; !ok {
			t.Errorf("%q must set default_member_permissions", n)
		}
	}
	for _, n := range []string{"stats", "spectate", "leaderboard", "link"} {
		if _, ok := byName[n]["default_member_permissions"]; ok {
			t.Errorf("%q sets default_member_permissions", n)
		}
	}

	// /stats and /whois take a USER option (type 6).
	opts := byName["whois"]["options"].([]any)
	first := opts[0].(map[string]any)
	if first["type"] != float64(OptUser) {
		t.Errorf("whois user option type = %v; want %d", first["type"], OptUser)
	}

	// The report channel is set through /config, not its own command.
	if _, ok := byName["config"]; !ok {
		t.Errorf("missing /config command (got %v)", keysOf(byName))
	}
	if _, ok := byName["config"]["default_member_permissions"]; !ok {
		t.Errorf("/config has no default_member_permissions")
	}
	if _, ok := byName["set-report-channel"]; ok {
		t.Errorf("unexpected set-report-channel command")
	}
}

func keysOf(m map[string]map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
