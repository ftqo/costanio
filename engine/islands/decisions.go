package islands

// DecisionGoldPick is the timer-layer id for choosing what a gold hex pays out.
// See engine.ModuleDecider.Decision and timings.ModuleCaps.
const DecisionGoldPick = "gold_pick"

// Decisions is every id this module can emit, for the cap drift test.
var Decisions = []string{DecisionGoldPick}
