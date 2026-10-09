package engine

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGameConfigShowBankRoundTrip(t *testing.T) {
	// Explicit false must serialize and survive a round-trip.
	off := false
	b, err := json.Marshal(GameConfig{ShowBank: &off})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(b), `"show_bank":false`) {
		t.Fatalf("expected show_bank:false in %s", b)
	}
	var got GameConfig
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.ShowBank == nil || *got.ShowBank != false {
		t.Fatalf("round-trip lost show_bank=false: %+v", got.ShowBank)
	}

	// Nil (default ON) must be omitted entirely, so old games stay clean.
	b2, err := json.Marshal(GameConfig{})
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	if strings.Contains(string(b2), "show_bank") {
		t.Fatalf("nil ShowBank should be omitted, got %s", b2)
	}
}

func TestGameConfigShowImprovementsRoundTrip(t *testing.T) {
	// Same contract as ShowBank, asserted separately because the switches are
	// independent.
	off := false
	b, err := json.Marshal(GameConfig{ShowImprovements: &off})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(b), `"show_improvements":false`) {
		t.Fatalf("expected show_improvements:false in %s", b)
	}
	var got GameConfig
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.ShowImprovements == nil || *got.ShowImprovements != false {
		t.Fatalf("round-trip lost show_improvements=false: %+v", got.ShowImprovements)
	}
	if got.ShowBank != nil {
		t.Fatalf("show_improvements must not disturb show_bank: %+v", got.ShowBank)
	}

	// Nil (default on) is omitted, so an older game reads back as shown.
	b2, err := json.Marshal(GameConfig{})
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	if strings.Contains(string(b2), "show_improvements") {
		t.Fatalf("nil ShowImprovements should be omitted, got %s", b2)
	}
}

func TestGameConfigMemoryModeRoundTrip(t *testing.T) {
	// A plain bool, unlike the *bool switches above: those default on and must
	// tell absent from false, while this defaults off, so absent and false mean
	// the same.
	b, err := json.Marshal(GameConfig{MemoryMode: true})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(b), `"memory_mode":true`) {
		t.Fatalf("expected memory_mode:true in %s", b)
	}
	var got GameConfig
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !got.MemoryMode {
		t.Fatalf("round-trip lost memory_mode=true: %+v", got)
	}
	if got.ShowBank != nil || got.ShowImprovements != nil {
		t.Fatalf("memory_mode must not disturb the display switches: %+v", got)
	}

	// Off by default and omitted from the wire, so older games read back as an
	// ordinary table.
	var zero GameConfig
	if zero.MemoryMode {
		t.Fatal("zero GameConfig must have memory mode off")
	}
	b2, err := json.Marshal(zero)
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	if strings.Contains(string(b2), "memory_mode") {
		t.Fatalf("memory_mode off should be omitted, got %s", b2)
	}
	var back GameConfig
	if err := json.Unmarshal([]byte(`{"players":4}`), &back); err != nil {
		t.Fatalf("unmarshal legacy: %v", err)
	}
	if back.MemoryMode {
		t.Fatal("a config with no memory_mode key must read as off")
	}
}
