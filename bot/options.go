package bot

// Option configures optional bot behaviors. Pass options to NewSimple/NewStrong.
type Option func(*config)

// config holds resolved bot options.
type config struct {
	noExplorersCityChoice bool
	noPlayerTrades        bool
	playerTrades          bool
	handPlacement         bool
	learnedBuild          bool
	ungatedRoads          bool
	roadOpens             bool
	learnedSetupRoad      bool
	acceptThreshold       float64
	acceptProbe           func()
	ungatedOffers         bool
	naive                 string   // sub-policy replaced with a naive version (measurement)
	noSimpleDefend        bool     // measurement: drop the hard-rule knight backstop
	lookahead             int      // extra plies of within-turn lookahead; 0 = off
	lookaheadSet          bool     // an explicit WithLookahead call, so 0 means off rather than default
	lookaheadWidth        int      // candidates deepened per ply
	weights               *Weights // nil = DefaultWeights
	hiddenInfo            bool
	flatRes               bool
	landOnly              bool
	noFish                bool
	noCamels              bool
	noWagons              bool
	noSwift               bool
	keepBoot              bool
	noFishChance          bool
	noFreeProg            bool
	noProgBatch2          bool
	noProgBatch3          bool
	noPendingMetro        bool
	noAqueduct            bool
	lrChase               bool
	camelBidCap           int     // 0 = camelBidCapDefault (see WithCamelBidCap)
	unpricedCamelBids     bool    // measurement: the original unpriced bid
	camelNoBid            bool    // measurement: choose placements, never name a bid (the default)
	camelBids             bool    // opt in to the paid half of the lane (see WithCamelBids)
	camelUniformRivals    bool    // measurement: the bare uniform rival model (see WithUniformCamelRivals)
	fishHold              float64 // scale on the held-fish term (see WithFishHoldWeight)
	noFishGate            bool    // measurement: drop the top-rung gate (see WithoutFishRungGate)
	fishHoldSet           bool
}

func resolve(opts []Option) config {
	var c config
	for _, o := range opts {
		o(&c)
	}
	return c
}

// WithoutPlayerTrades disables player-to-player trading: no offers, no
// responses, no settling. Bank trades are unaffected. Trading is on by default.
func WithoutPlayerTrades() Option {
	return func(c *config) { c.noPlayerTrades = true }
}

// WithPlayerTrades enables player-to-player trade responses for Simple, where
// they are off by default. Strong trades by default; this also clears
// WithoutPlayerTrades. Bank trades are unaffected.
func WithPlayerTrades() Option {
	// Set both flags: NewSimple reads playerTrades (default off), NewStrong
	// reads !noPlayerTrades (default on). Setting only one would make
	// NewStrong(WithoutPlayerTrades(), WithPlayerTrades()) still not trade.
	return func(c *config) { c.playerTrades = true; c.noPlayerTrades = false }
}

// WithWeights overrides Strong's evaluation weight vector, so ladders and
// training runs can compare vectors without a rebuild. Ignored by Simple.
func WithWeights(w Weights) Option {
	return func(c *config) { c.weights = &w }
}

// WithLongestRoad lets Strong build toward the Longest Road title, scoring roads
// like any other build rather than only when the frontier is exhausted.
//
// Off by default: it measured 48.1% [46.6, 49.6] over 4000 games against the
// bot that does not chase. The title's value is counted either way (see
// selfScore).
func WithLongestRoad() Option {
	return func(c *config) { c.lrChase = true }
}

// WithHiddenInfo lets Strong read hidden state (opponents' exact hands and
// commodities, the card a robber steal will turn up) instead of public
// estimates. Never shipped: the bot is held to what a human at the table knows
// (docs/bots.md). It exists to measure the cost of that rule.
func WithHiddenInfo() Option {
	return func(c *config) { c.hiddenInfo = true }
}

// WithFlatResourceWeights prices every resource equally, switching off the
// earlyResW/lateResW schedule, to test whether those constants matter.
func WithFlatResourceWeights() Option {
	return func(c *config) { c.flatRes = true }
}

// WithLandOnly disables Islands play: no ship candidates, and no sea traversal
// in the reachability walk. Measures the value of sailing.
func WithLandOnly() Option {
	return func(c *config) { c.landOnly = true }
}

// WithoutFishSpending stops Strong spending fish. Measures the value of the
// fish economy.
func WithoutFishSpending() Option {
	return func(c *config) { c.noFish = true }
}

// WithFishHoldWeight scales the held-fish term in the evaluator, which lets the
// bot save for a higher rung instead of spending at the first affordable one.
// Zero switches the term off. See fishHoldWeightDefault.
func WithFishHoldWeight(w float64) Option {
	return func(c *config) { c.fishHold, c.fishHoldSet = w, true }
}

// WithoutFishHolding switches the held-fish term off, so a spend is scored
// purely on what it buys.
func WithoutFishHolding() Option {
	return func(c *config) { c.fishHold, c.fishHoldSet = 0, true }
}

// WithoutFishRungGate drops the rule that stops a seat holding five or six fish
// from spending at the cheap rungs. Measurement knob; see fishRungFloor.
func WithoutFishRungGate() Option {
	return func(c *config) { c.noFishGate = true }
}

// WithKeepBoot stops Strong passing the old boot, so it keeps the VP penalty.
// Measurement knob.
func WithKeepBoot() Option {
	return func(c *config) { c.keepBoot = true }
}

// WithoutFishChanceSpends drops the two fish spends that resolve a random draw
// (steal, free dev card), leaving only the deterministic ones. Measurement knob.
func WithoutFishChanceSpends() Option {
	return func(c *config) { c.noFishChance = true }
}

// WithoutFreeProgressPlays stops Strong playing the progress cards whose effect
// resolves through a pending (Wedding, Road Building). Measurement knob; a
// one-step evaluator sees a pending as no change, so these need special play.
func WithoutFreeProgressPlays() Option {
	return func(c *config) { c.noFreeProg = true }
}

// WithoutProgressBatch2 drops the second batch of Knights progress cards
// (Saboteur, Deserter, Intrigue, Diplomat, Inventor). Measurement knob.
func WithoutProgressBatch2() Option {
	return func(c *config) { c.noProgBatch2 = true }
}

// WithoutProgressBatch3 drops the final batch of Knights progress cards
// (Alchemist, Bishop, Spy, Master Merchant, Commercial Harbor, Merchant Fleet).
// Measurement knob.
func WithoutProgressBatch3() Option {
	return func(c *config) { c.noProgBatch3 = true }
}

// WithoutPendingMetropolis stops crediting a metropolis that has been earned but
// not yet placed. Measurement knob.
func WithoutPendingMetropolis() Option {
	return func(c *config) { c.noPendingMetro = true }
}

// WithoutAqueductPolicy leaves the Aqueduct's free resource to the engine's
// auto-pass, which takes whatever the bank holds most of. Measurement knob.
func WithoutAqueductPolicy() Option {
	return func(c *config) { c.noAqueduct = true }
}

// WithLookahead overrides the within-turn lookahead. Defaults are depth 1,
// width 10 (see defaultLookahead); WithLookahead(0, 0) turns it off.
func WithLookahead(depth, width int) Option {
	return func(c *config) { c.lookahead, c.lookaheadWidth, c.lookaheadSet = depth, width, true }
}

// defaultLookahead re-scores the ten strongest candidates by the best position
// reachable one action later in the same turn. Worth about +3.3 points for +19%
// decision cost; wider than 10 or deeper than 1 adds nothing measurable.
const (
	defaultLookaheadDepth = 1
	defaultLookaheadWidth = 10
)

// WithoutSimpleDefend removes the hard-rule knight backstop Strong inherits from
// the baseline bot, so knight investment comes only from the evaluator. The
// backstop recruits whenever bestPlay returns nothing, which masks the knight
// weights in ablations.
func WithoutSimpleDefend() Option {
	return func(c *config) { c.noSimpleDefend = true }
}

// WithNaivePolicy replaces one sub-policy with a poor version, to measure what
// that policy is worth. Accepted: "placement", "setup-road", "robber",
// "discard", "trade".
func WithNaivePolicy(name string) Option {
	if !naivePolicies[name] {
		// An unknown name would leave every policy intact and report that the
		// policy is worth nothing.
		panic("bot: unknown naive policy " + name + " (accepted: placement, setup-road, robber, discard, trade)")
	}
	return func(c *config) { c.naive = name }
}

// naivePolicies is the set WithNaivePolicy accepts. Each name must have a branch
// that reads it; TestNaivePoliciesChangeGame checks that.
var naivePolicies = map[string]bool{
	"placement":  true,
	"setup-road": true,
	"robber":     true,
	"discard":    true,
	"trade":      true,
}

// WithUngatedOffers restores the unconditional two-for-one overpay in
// offerTrade, for ablation. The gated version keeps the largest quantity that
// still improves the bot's own position.
func WithUngatedOffers() Option {
	return func(c *config) { c.ungatedOffers = true }
}

// WithLearnedPlacement is the default and this option is a no-op, kept so
// callers that named it explicitly keep compiling. See WithHandPlacement.
func WithLearnedPlacement() Option {
	return func(c *config) { c.handPlacement = false }
}

// WithHandPlacement restores setupVertexScore for opening settlements, for
// ablation. The cloned network is the default because it wins: 32.6% vs 27.6%
// on base and 33.0% vs 26.6% on Knights against diversePool.
func WithHandPlacement() Option {
	return func(c *config) { c.handPlacement = true }
}

// WithLearnedBuild picks in-turn builds with the network cloned from human play
// (bot/build_net.go) instead of scoring them through the evaluator. It matches
// a strong player's choice 67.2% of the time (greedy production: 48.6%). Off
// until a ladder rules on it.
func WithLearnedBuild() Option {
	return func(c *config) { c.learnedBuild = true }
}

// WithUngatedRoads considers every frontier road, dropping the rule that only
// looks at roads when no spot is already reachable and the network is still
// proportional to settlements. The gate was tuned against clone ladders, which
// cannot price racing a rival to a spot.
func WithUngatedRoads() Option {
	return func(c *config) { c.ungatedRoads = true }
}

// WithRoadOpens scores an opening road by the spots it opens rather than by the
// vertex it runs into (which, being adjacent to the new settlement, can never be
// built on). See setupRoad.
func WithRoadOpens() Option {
	return func(c *config) { c.roadOpens = true }
}

// WithLearnedSetupRoad picks the opening road with the network cloned from human
// play (bot/setuproad_net.go) instead of setupRoad's scorer. It matches a strong
// player's road 67.0% of the time (best heuristic: 46.8%). Off until a ladder
// rules on it.
func WithLearnedSetupRoad() Option {
	return func(c *config) { c.learnedSetupRoad = true }
}

// WithLearnedAccept decides offer responses with the network cloned from human
// play (bot/accept_net.go), accepting when it scores at least threshold. The
// model targets AUC, so the cutoff is tuned here. Zero (the default) disables it.
func WithLearnedAccept(threshold float64) Option {
	return func(c *config) { c.acceptThreshold = threshold }
}

// WithAcceptProbe reports each time the cloned acceptance policy is consulted.
// Test-only: lets a ladder confirm the code actually ran.
func WithAcceptProbe(f func()) Option {
	return func(c *config) { c.acceptProbe = f }
}

// WithoutCamelPlay drops the whole Caravans lane: no bid is priced and no
// placement is chosen, so both fall back to the module's `auto` (a {0, 0} bid
// from every seat and the first legal path).
func WithoutCamelPlay() Option {
	return func(c *config) { c.noCamels = true }
}

// WithCamelBidCap bounds how many cards the camel bid may name in one round.
// Zero (the default) means camelBidCapDefault.
func WithCamelBidCap(k int) Option {
	return func(c *config) { c.camelBidCap = k }
}

// WithUnpricedCamelBids restores the original unpriced bid: the gain read off
// the full evaluator, opponent discount and all, against a cost read off
// handValue. See bot/caravans.go.
func WithUnpricedCamelBids() Option {
	return func(c *config) { c.unpricedCamelBids = true }
}

// WithUniformCamelRivals restores the bare uniform rival model: every rival is
// assumed to bid uniformly over the wool and grain it could back, with no mass
// on abstaining. The before-arm for camelZeroBidMass.
func WithUniformCamelRivals() Option {
	return func(c *config) { c.camelUniformRivals = true }
}

// WithoutCamelBids keeps the placement half of the lane and drops the paid half:
// the bot chooses where a camel goes when it wins the right to, and never names
// a bid. This is the default; see WithCamelBids.
func WithoutCamelBids() Option {
	return func(c *config) { c.camelNoBid = true; c.camelBids = false }
}

// WithCamelBids turns the paid half of the Caravans lane on: the bot prices a
// sealed bid and names it. Off by default because it loses. Seat-rotated, 4000
// games, 4-player base+caravans:
//
//	bidding    23.9%  [22.7, 25.3]  avgVP 8.71
//	no-bid     29.1%  [27.7, 30.6]  avgVP 9.12
//	off        28.4%  [27.0, 29.8]  avgVP 9.03
//	legacy     18.5%  [17.3, 19.7]  avgVP 8.17
//
// No-bid and off are indistinguishable, so the cost is in bidding. camelGain
// likely overprices a placement against a wool or grain card; a corrected gain
// could make this worth enabling.
func WithCamelBids() Option {
	return func(c *config) { c.camelBids = true; c.camelNoBid = false }
}

// WithoutWagonPlay drops the whole Wagons lane: the wagon is never driven, no
// barbarian is placed by choice, and no level is bought. The movement phase
// still blocks the pass, so the bot falls through to the module's Auto and
// declines every turn.
func WithoutWagonPlay() Option {
	return func(c *config) { c.noWagons = true }
}

// WithoutSwiftJourney stops the bot playing Swift Journey or buying the grain
// boost. Measurement only (docs/bots.md, Wagons). Applies to Strong and Simple.
func WithoutSwiftJourney() Option {
	return func(c *config) { c.noSwift = true }
}

// WithoutExplorersCityChoice restores the harbour-first upgrade policy for
// A/B measurement. Other Explorers purchases and movement are unchanged.
func WithoutExplorersCityChoice() Option {
	return func(c *config) { c.noExplorersCityChoice = true }
}
