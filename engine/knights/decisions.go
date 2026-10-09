package knights

// The module obligations this expansion can put a seat on the clock for, as the
// stable ids `pendingDeciders` reports to the timer layer. Constants because
// they key timings.ModuleCaps, where a typo would silently fall back to the
// default budget; a test asserts every id has an explicit cap. They never reach
// the event log, so they can be renamed freely.
const (
	DecisionWeddingGive        = "wedding_give"
	DecisionHarborReturn       = "harbor_return"
	DecisionAqueduct           = "aqueduct"
	DecisionBarbarianDowngrade = "barbarian_downgrade"
	DecisionSpy                = "spy"
	DecisionMasterMerchant     = "master_merchant"
	DecisionDeserterSurrender  = "deserter_surrender"
	DecisionDeserterPlace      = "deserter_place"
	DecisionRelocateKnight     = "relocate_knight"
	DecisionDefenderDraw       = "defender_draw"
	DecisionProgressDiscard    = "progress_discard"
	DecisionMetropolisPick     = "metropolis_pick"
)

// Decisions is every id above, for the drift test that pins each one to a cap.
var Decisions = []string{
	DecisionWeddingGive,
	DecisionHarborReturn,
	DecisionAqueduct,
	DecisionBarbarianDowngrade,
	DecisionSpy,
	DecisionMasterMerchant,
	DecisionDeserterSurrender,
	DecisionDeserterPlace,
	DecisionRelocateKnight,
	DecisionDefenderDraw,
	DecisionProgressDiscard,
	DecisionMetropolisPick,
}
