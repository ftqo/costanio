package bot_test

import (
	"testing"

	_ "github.com/ftqo/costan.io/engine/explorers"
)

// A bot must never propose an illegal command. Explorers owns the whole setup
// draft (Hooks.OwnsSetup: three rounds, a different piece kind in each,
// starting resources from only the second), so base `place_settlement` and
// `place_road` are unknown commands there. The actor's fallback to AutoSetup
// would hide a rejected move, so this uses playChecked, which fails on any
// refused bot move. Explorers is a Standalone, so its name is its whole
// ruleset.
func TestExplorersBotsStayLegal(t *testing.T) {
	for _, kind := range []string{"strong", "simple"} {
		t.Run(kind, func(t *testing.T) {
			for seed := uint64(1); seed <= 3; seed++ {
				playChecked(t, "explorers", kind, seed)
			}
		})
	}
}
