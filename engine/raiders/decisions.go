package raiders

// The timer-layer ids for this scenario's decisions. See
// engine.ModuleDecider.Decision: ids never reach the event log, and each needs
// a cap in timings.ModuleCaps (timings.TestEveryModuleDecisionHasACap).
//
// The pending kinds double as their ids (see the Pend constants), so every
// pending the module can open is an id it can emit.

// DecisionRiderLeave is the one id that is not a pending: a castle rider that
// must move is not an interrupt; the player keeps playing and only the pass is
// refused.
const DecisionRiderLeave = "raiders_rider_leave"

// Decisions is every id this module can emit, for the cap drift test.
var Decisions = []string{
	PendPath,
	PendLanding,
	PendMuster,
	PendSwift,
	PendTreason,
	PendIntrigue,
	PendSteal,
	DecisionRiderLeave,
}
