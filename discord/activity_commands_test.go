package discord

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestRegisterActivityCommands(t *testing.T) {
	var mu sync.Mutex
	var posted []map[string]any
	var method, path string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		method, path = r.Method, r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		posted = append(posted, body)
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"id":"c","name":"x"}`))
	}))
	defer ts.Close()

	c := Client{Token: "tok", BaseURL: ts.URL}
	if err := c.RegisterActivityCommands(context.Background(), "app1"); err != nil {
		t.Fatalf("RegisterActivityCommands: %v", err)
	}

	// POST-upsert (not a bulk PUT) to the global commands endpoint, so the
	// entry-point command is left intact.
	if method != http.MethodPost {
		t.Errorf("method = %q; want POST", method)
	}
	if path != "/applications/app1/commands" {
		t.Errorf("path = %q", path)
	}

	byName := map[string]map[string]any{}
	for _, b := range posted {
		byName[b["name"].(string)] = b
	}
	for _, name := range []string{"play", "costanio"} {
		cmd, ok := byName[name]
		if !ok {
			t.Fatalf("missing command %q (posted %v)", name, posted)
		}
		if cmd["description"] == "" || cmd["description"] == nil {
			t.Errorf("%q needs a description", name)
		}
		// CHAT_INPUT (type 1, the default), not the entry-point type 4.
		if ty, present := cmd["type"]; present && ty != float64(1) {
			t.Errorf("%q type = %v; want CHAT_INPUT (1)", name, ty)
		}
		// Reach: guild + user install, everywhere, same as the /launch entry point.
		if want := []any{float64(0), float64(1)}; !equalJSONList(cmd["integration_types"], want) {
			t.Errorf("%q integration_types = %v; want [0,1]", name, cmd["integration_types"])
		}
		if want := []any{float64(0), float64(1), float64(2)}; !equalJSONList(cmd["contexts"], want) {
			t.Errorf("%q contexts = %v; want [0,1,2]", name, cmd["contexts"])
		}
	}
}

func TestRegisterActivityCommandsError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message":"Missing Access"}`))
	}))
	defer ts.Close()
	c := Client{Token: "tok", BaseURL: ts.URL}
	if err := c.RegisterActivityCommands(context.Background(), "app1"); err == nil {
		t.Fatal("want an error on non-2xx response")
	}
}
