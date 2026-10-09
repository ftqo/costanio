package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestNoFreeCityErrorCode(t *testing.T) {
	if got := engine.ErrorCode(ErrNoFreeCity); got != "NO_FREE_CITY" {
		t.Errorf("ErrNoFreeCity: got %q, want %q", got, "NO_FREE_CITY")
	}
}
