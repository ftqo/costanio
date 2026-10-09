package scenarios

// The timer-layer ids for the caravan vote: naming your bid, and placing the
// caravan once you have won it. See engine.ModuleDecider.Decision.
const (
	DecisionCaravanBid   = "caravan_bid"
	DecisionCaravanPlace = "caravan_place"
)

// Decisions is every id this module can emit, for the cap drift test.
var Decisions = []string{DecisionCaravanBid, DecisionCaravanPlace}
