package discord

import (
	"crypto/ed25519"
	"encoding/hex"
	"strconv"
	"testing"
	"time"
)

// TestVerifyInteractionRejectsStaleTimestamp: a signed request is replayable
// forever unless its timestamp is bounded. Five minutes either side of now.
func TestVerifyInteractionRejectsStaleTimestamp(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	pubHex := hex.EncodeToString(pub)
	body := []byte(`{"type":2}`)
	sign := func(at time.Time) (string, string) {
		ts := strconv.FormatInt(at.Unix(), 10)
		return ts, hex.EncodeToString(ed25519.Sign(priv, append([]byte(ts), body...)))
	}
	now := time.Now()
	for _, c := range []struct {
		name string
		at   time.Time
		ok   bool
	}{
		{"now", now, true},
		{"4m old", now.Add(-4 * time.Minute), true},
		{"10m old", now.Add(-10 * time.Minute), false},
		{"10m ahead", now.Add(10 * time.Minute), false},
		{"2023", time.Unix(1700000000, 0), false},
	} {
		ts, sig := sign(c.at)
		if got := VerifyInteraction(pubHex, sig, ts, body); got != c.ok {
			t.Errorf("%s: verified=%v, want %v", c.name, got, c.ok)
		}
	}
	// A non-numeric timestamp, even correctly signed, is refused.
	sig := hex.EncodeToString(ed25519.Sign(priv, append([]byte("soon"), body...)))
	if VerifyInteraction(pubHex, sig, "soon", body) {
		t.Error("non-numeric timestamp verified")
	}
}
