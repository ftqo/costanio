package server

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestDiscordInteractions(t *testing.T) {
	e := newEnv(t)
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	e.srv.SetDiscordInteractions(hex.EncodeToString(pub))
	e.srv.SetDiscordGuild(testHomeGuild)

	post := func(body string, signed bool) (*http.Response, map[string]any) {
		t.Helper()
		body = inHomeGuild(body)
		req, _ := http.NewRequest(http.MethodPost, e.ts.URL+"/discord/interactions", bytes.NewReader([]byte(body)))
		if signed {
			ts := strconv.FormatInt(time.Now().Unix(), 10)
			req.Header.Set("X-Signature-Timestamp", ts)
			req.Header.Set("X-Signature-Ed25519", hex.EncodeToString(ed25519.Sign(priv, append([]byte(ts), body...))))
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { resp.Body.Close() })
		var out map[string]any
		json.NewDecoder(resp.Body).Decode(&out)
		return resp, out
	}

	// Missing/bad signature → 401.
	if resp, _ := post(`{"type":1}`, false); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unsigned = %d; want 401", resp.StatusCode)
	}
	// PING → PONG.
	if _, body := post(`{"type":1}`, true); body["type"] != float64(responsePong) {
		t.Fatalf("ping → %v; want PONG", body)
	}
	// Perk roles are now managed through the /config Supporter-roles tab: a manager
	// selecting a role under a kind writes the mapping.
	setrole := `{"type":3,"member":{"permissions":"8","user":{"id":"m"}},"data":{"custom_id":"config:role:set:kofi","component_type":6,"values":["role123"]}}`
	if _, body := post(setrole, true); body["type"] != float64(responseUpdateMessage) {
		t.Fatalf("config role select → %v; want an in-place panel update", body)
	}
	if m, _ := e.st.PerkRoles(); m["role123"] != "kofi" {
		t.Fatalf("perk_roles = %v; want role123=kofi", m)
	}
	// A non-manager cannot set roles.
	noperm := `{"type":3,"member":{"permissions":"0","user":{"id":"x"}},"data":{"custom_id":"config:role:set:staff","component_type":6,"values":["role999"]}}`
	post(noperm, true)
	if m, _ := e.st.PerkRoles(); m["role999"] != "" {
		t.Fatal("non-manager must not be able to set a role")
	}
	// Deselecting the role (empty selection) removes it.
	clear := `{"type":3,"member":{"permissions":"32","user":{"id":"m"}},"data":{"custom_id":"config:role:set:kofi","component_type":6,"values":[]}}`
	post(clear, true)
	if m, _ := e.st.PerkRoles(); m["role123"] != "" {
		t.Fatalf("perk_roles after clearing selection = %v; want role123 gone", m)
	}
}
