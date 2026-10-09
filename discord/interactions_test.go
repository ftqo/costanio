package discord

import (
	"crypto/ed25519"
	"encoding/hex"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestVerifyInteraction(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	pubHex := hex.EncodeToString(pub)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	body := []byte(`{"type":1}`)
	sig := hex.EncodeToString(ed25519.Sign(priv, append([]byte(ts), body...)))

	if !VerifyInteraction(pubHex, sig, ts, body) {
		t.Fatal("valid signature should verify")
	}
	// Tampered body fails.
	if VerifyInteraction(pubHex, sig, ts, []byte(`{"type":2}`)) {
		t.Fatal("tampered body must not verify")
	}
	// Wrong timestamp fails.
	if VerifyInteraction(pubHex, sig, strconv.FormatInt(time.Now().Unix()+1, 10), body) {
		t.Fatal("wrong timestamp must not verify")
	}
	// Garbage inputs fail gracefully.
	if VerifyInteraction("zz", sig, ts, body) || VerifyInteraction(pubHex, "zz", ts, body) || VerifyInteraction(pubHex, sig, "", body) {
		t.Fatal("malformed inputs must not verify")
	}
}

func TestCommandNamesAreKebabCase(t *testing.T) {
	defs := opsCommandDefs(nil)
	for _, d := range defs {
		name := d["name"].(string)
		if strings.Contains(name, "_") {
			t.Errorf("command %q uses underscore", name)
		}
		// multi-word commands must hyphenate, not concatenate
		for _, banned := range []string{"setrole", "clearrole", "listroles"} {
			if name == banned {
				t.Errorf("command %q must be kebab-case", name)
			}
		}
	}
	// New moderation commands present.
	want := map[string]bool{"config": false, "unban-chat": false, "report-strikes": false}
	for _, d := range opsCommandDefs(nil) {
		if _, ok := want[d["name"].(string)]; ok {
			want[d["name"].(string)] = true
		}
	}
	for n, found := range want {
		if !found {
			t.Errorf("missing command %q", n)
		}
	}
}

func TestHasManageGuild(t *testing.T) {
	cases := map[string]bool{
		"0":          false,
		"32":         true,  // MANAGE_GUILD
		"8":          true,  // ADMINISTRATOR
		"2147483647": true,  // all perms
		"16":         false, // some other bit
		"notanumber": false,
		"":           false,
	}
	for perms, want := range cases {
		if got := HasManageGuild(perms); got != want {
			t.Errorf("HasManageGuild(%q) = %v; want %v", perms, got, want)
		}
	}
}
