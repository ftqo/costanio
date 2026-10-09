package engine

import (
	"errors"
	"fmt"
	"testing"
)

func TestErrorCode(t *testing.T) {
	if got := ErrorCode(ErrNoResources); got != "NO_RESOURCES" {
		t.Errorf("ErrNoResources: got %q, want %q", got, "NO_RESOURCES")
	}
	// errors.Is matching: a wrapped sentinel still resolves.
	wrapped := fmt.Errorf("context: %w", ErrNotYourTurn)
	if got := ErrorCode(wrapped); got != "NOT_YOUR_TURN" {
		t.Errorf("wrapped ErrNotYourTurn: got %q, want %q", got, "NOT_YOUR_TURN")
	}
	// Unregistered errors return "" so the caller applies its own fallback.
	if got := ErrorCode(errors.New("nope")); got != "" {
		t.Errorf("unregistered: got %q, want \"\"", got)
	}
}
