package wagons

// DecisionBarbarian is the timer-layer id for this module's one interrupt:
// choosing where a barbarian goes after a 7, a Knight, or a successful
// drive-off. See engine.ModuleDecider.Decision.
//
// The movement phase has no id: it is part of the turn, so it uses the turn's
// budget rather than a module cap. See Wagons.pendingDeciders.
const DecisionBarbarian = "wagon_barbarian"

// Decisions is every id this module can emit, for the cap drift test.
var Decisions = []string{DecisionBarbarian}
