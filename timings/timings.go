// Package timings holds the game loop's clocks. The server serves them to the
// client (see Wire), so the client renders what it is told. Stdlib only, so
// every layer can depend on it.
//
// These are policy, not rules: the engine must not import this package. A
// timing change alters what happens when a player runs out of time, never what
// a command means, so it cannot affect a replay.
package timings

import "time"

// DefaultTurnTimerSec is applied when a config omits the turn timer. It matches
// the "Normal" preset below, and the lobby rejects any config that still has a
// non-positive timer after it is applied (see TurnTimerSecMin).
const DefaultTurnTimerSec = 60

// The bounds a configured turn timer must fall within. Zero is not "untimed":
// a non-positive timer makes BudgetFor arm no clock at all, which disables every
// per-decision cap below at once rather than just the main turn.
const (
	TurnTimerSecMin = 1
	TurnTimerSecMax = 3600
)

// Preset is one choice in the lobby's turn-timer control.
type Preset struct {
	Label string `json:"label"`
	Sec   int    `json:"sec"`
}

// TurnTimerPresets is the lobby's turn-timer control, in display order. Served
// to the client.
var TurnTimerPresets = []Preset{
	{Label: "Relaxed", Sec: 120},
	{Label: "Normal", Sec: DefaultTurnTimerSec},
	{Label: "Blitz", Sec: 30},
}

// Ranked turn budgets. Fixed per queue and shorter than the lobby default.
const (
	RankedBaseTurnSec    = 60
	RankedKnightsTurnSec = 75
)

// TurnTimerBuffer is grace added to the visible budget before the server
// auto-acts: it absorbs network latency and last-instant clicks so a player
// submitting right as the bar hits zero is not overridden.
const TurnTimerBuffer = 1500 * time.Millisecond

// InactivityFloor is the minimum window the active player keeps for their next
// action during the main build/trade turn. Each turn-advancing action floors the
// remaining budget to min(InactivityFloor, turn timer), so the main turn is an
// inactivity timeout rather than a hard cap.
const InactivityFloor = 15 * time.Second

// Per-decision budget caps. The configured turn timer is the budget for a full
// build/trade turn; reactive and trivial decisions are capped well below it so
// a slow or idle player cannot stall the table on a non-choice like rolling.
//
// Every cap is a base for a Normal table, scaled by Scaled for a longer one,
// and then applied as min(scaled cap, turn timer), so a Blitz game compresses
// all of them and none can exceed its own game's budget.
const (
	RollCap    = 15 * time.Second
	DiscardCap = 30 * time.Second
	RobberCap  = 20 * time.Second
	SetupCap   = 45 * time.Second
	// The road that follows a setup settlement. Its own budget, well under
	// SetupCap: the settlement is the real decision, the road a choice among a
	// handful of edges.
	SetupRoadCap = 15 * time.Second
)

// AlchemistBonus is a floor game/armTimer applies to the running RollCap
// countdown once the Alchemist has fixed the dice. The fixed dice are applied
// by a separate roll command, so a player who spent most of RollCap choosing
// still has time to click roll. It floors rather than resets, so it only adds
// time.
const AlchemistBonus = 10 * time.Second

// ModuleDefaultCap is what an expansion decision gets when ModuleCaps does not
// name it, so a missing entry cannot hang a table. timings_test.go fails if any
// module can emit an id missing from ModuleCaps.
const ModuleDefaultCap = 25 * time.Second

// ModuleCaps is the budget for each expansion decision, by the id the module
// reports (engine.ModuleDecider.Decision).
//
// The split is by how much there is to think about, not by how important the
// decision is. Caps are sized for a player meeting the prompt for the first
// time, in the band the base game's decisions sit in (a robber move is 20s, a
// discard 30s):
//
//   - 20s: one tap on a set already on screen,
//   - 25s: pick a spot or a target, a board read,
//   - 30s: weigh a hand, a purse or a bid,
//   - 45s: Treason, the one decision here that is a plan rather than a pick.
//
// A timeout's auto-answer is an ordinary logged event, so changing caps never
// affects replays.
var ModuleCaps = map[string]time.Duration{
	// One tap on an already-visible set.
	"aqueduct":           20 * time.Second,
	"gold_pick":          20 * time.Second,
	"defender_draw":      20 * time.Second,
	"deserter_surrender": 20 * time.Second,
	"raiders_landing":    20 * time.Second,
	"raiders_path":       20 * time.Second,
	"raiders_muster":     20 * time.Second,

	// Pick a target or a spot: a board read, but a short one.
	"spy":                 25 * time.Second,
	"master_merchant":     25 * time.Second,
	"deserter_place":      25 * time.Second,
	"relocate_knight":     25 * time.Second,
	"caravan_place":       25 * time.Second,
	"metropolis_pick":     25 * time.Second,
	"raiders_rider_leave": 25 * time.Second,
	"raiders_swift":       25 * time.Second,
	"raiders_intrigue":    25 * time.Second,
	"raiders_steal":       25 * time.Second,
	// A barbarian may go anywhere a road could stand, the widest target set
	// any module offers.
	"wagon_barbarian": 25 * time.Second,
	// The pirate ship after a 7, and who it robs. It blocks the Explorers turn
	// from passing, so it stays with the board reads.
	"explorers_pirate": 25 * time.Second,

	// Weigh your whole hand, or your purse.
	"wedding_give":     30 * time.Second,
	"harbor_return":    30 * time.Second,
	"progress_discard": 30 * time.Second,
	// Which city the barbarians burn, and under Rivers whether to pay 5 coins
	// to keep it (the pillage buyout rides this same prompt). At most one per
	// barbarian attack.
	"barbarian_downgrade": 30 * time.Second,

	// Treason names four hexes at once (two raiders to lift, two places to
	// put them): a plan rather than a pick.
	"raiders_treason": 45 * time.Second,

	// Bid against the table. Below the other deliberations because the round
	// is sequential (the finisher, then clockwise), so budgets add up and the
	// turn cannot end until the camel is placed. At 20s a six-seat round runs
	// two minutes at worst. An expired bid is a pass.
	"caravan_bid": 20 * time.Second,
}

// MaxDecisionScale caps how far per-decision budgets scale with the table's
// timer. Every cap above, AlchemistBonus and InactivityFloor is a base sized for
// a Normal table (DefaultTurnTimerSec). The factor is turn timer /
// DefaultTurnTimerSec, bounded both ways:
//
//   - never below 1. A Blitz table is compressed by BudgetFor clamping every
//     budget to its turn timer instead.
//   - never above MaxDecisionScale. The API accepts a turn timer up to an
//     hour, and an idle seat should not hold the table that long on a
//     non-choice.
//
// Scaled values are truncated to whole seconds so the countdown a player sees
// starts on a round number. docs/timers.md has the table of values.
const MaxDecisionScale = 4

// Scaled returns base scaled for a table with this turn timer. A non-positive
// timer (untimed) leaves the base as it is: the only budget an untimed table
// arms is a blocking module decision's, and that one keeps its base.
func Scaled(base time.Duration, turnTimerSec int) time.Duration {
	if turnTimerSec <= DefaultTurnTimerSec {
		return base
	}
	d := base * time.Duration(turnTimerSec) / DefaultTurnTimerSec
	d = min(d, base*MaxDecisionScale)
	if t := d.Truncate(time.Second); t >= base {
		return t
	}
	return d
}

// ModuleCap is the budget for a seat owing these decisions at once: the longest
// of them, so a player handed a one-tap pick alongside a real deliberation is
// never rushed through the harder one. Unknown ids contribute the default.
func ModuleCap(decisions []string) time.Duration {
	longest := time.Duration(0)
	for _, d := range decisions {
		c, ok := ModuleCaps[d]
		if !ok {
			c = ModuleDefaultCap
		}
		longest = max(longest, c)
	}
	if longest == 0 {
		return ModuleDefaultCap
	}
	return longest
}

// An open table trade offer auto-cancels after this long, measured from when it
// is posted; responses do not extend it. Timed games scale the window to half
// their turn budget so trade pace tracks game pace; the bounds keep it
// actionable without letting a long turn timer dominate the table.
const (
	OfferDefaultLifetime = 20 * time.Second
	OfferMinLifetime     = 15 * time.Second
	OfferMaxLifetime     = 30 * time.Second
)

// OfferLifetimeFor returns the window an offer posted now should get.
func OfferLifetimeFor(turnTimerSec int) time.Duration {
	if turnTimerSec <= 0 {
		return OfferDefaultLifetime
	}
	d := time.Duration(turnTimerSec) * time.Second / 2
	return min(max(d, OfferMinLifetime), OfferMaxLifetime)
}

// Wire is the timings block served to clients, in milliseconds because that is
// what a browser counts in. Everything a client needs to render a countdown or
// offer a choice, and nothing it should be deciding for itself: the server still
// stamps every actual deadline (see FullView.SeatDeadlines).
type Wire struct {
	TurnTimerPresets []Preset `json:"turn_timer_presets"`
	DefaultTurnSec   int      `json:"default_turn_sec"`
	MinTurnSec       int      `json:"min_turn_sec"`
	MaxTurnSec       int      `json:"max_turn_sec"`
	// BufferMs is the grace past zero before the server acts. Clients that want
	// a bar to reach empty exactly when the server gives up add this rather than
	// guessing at it.
	BufferMs int64 `json:"buffer_ms"`
	// Caps is decision kind -> full budget in ms, keyed by the same wire names
	// the seat countdown uses. Advisory: SeatBudgets carries the actual budget
	// for the decision on the clock, already clamped to this game's turn timer.
	Caps map[string]int64 `json:"caps"`
	// OfferMs is the trade window this game will give a newly posted offer.
	OfferMs int64 `json:"offer_ms"`
}

// For renders the timings block for a game with this configured turn timer,
// with every cap already clamped the way BudgetFor will clamp it, so a client
// showing "you get 20s for this" and the server's own deadline cannot disagree.
func For(turnTimerSec int) Wire {
	clamp := func(d time.Duration) int64 {
		if turnTimerSec <= 0 {
			return 0
		}
		return min(Scaled(d, turnTimerSec), time.Duration(turnTimerSec)*time.Second).Milliseconds()
	}
	return Wire{
		TurnTimerPresets: TurnTimerPresets,
		DefaultTurnSec:   DefaultTurnTimerSec,
		MinTurnSec:       TurnTimerSecMin,
		MaxTurnSec:       TurnTimerSecMax,
		BufferMs:         TurnTimerBuffer.Milliseconds(),
		Caps: map[string]int64{
			"roll":       clamp(RollCap),
			"discard":    clamp(DiscardCap),
			"robber":     clamp(RobberCap),
			"setup":      clamp(SetupCap),
			"setup_road": clamp(SetupRoadCap),
			"main":       mainMs(turnTimerSec),
		},
		OfferMs: OfferLifetimeFor(turnTimerSec).Milliseconds(),
	}
}

// mainMs is the full main-turn budget in ms. Not a cap, so not scaled.
func mainMs(turnTimerSec int) int64 {
	if turnTimerSec <= 0 {
		return 0
	}
	return (time.Duration(turnTimerSec) * time.Second).Milliseconds()
}
