package rivers

import (
	"errors"

	"github.com/ftqo/costan.io/engine"
)

// This module's rules errors. Each replaces a core sentinel whose message would
// mislead the player:
//   - a road on a bridge site would get ErrOccupied, but nothing is there; only
//     a bridge may cross the channel.
//   - a misplaced bridge would get ErrBadPlacement, which does not say where
//     bridges go.
//   - too few coins would get ErrNoResources, but coins are not resources (no
//     hand limit, robber, pirate, Monopoly or progress card touches them).
//   - the two-a-turn spend cap would get ErrUnknownCommand.
//   - an empty bank would get ErrNoResources about the player's hand, when it is
//     the supply that is empty.
var (
	// ErrBridgeSiteOnly: the channel crosses this edge, so only a bridge may.
	ErrBridgeSiteOnly = errors.New("a river crosses that edge")
	// ErrNotBridgeSite: a bridge goes only where the river is.
	ErrNotBridgeSite = errors.New("no river crosses that edge")
	// ErrNoBridges: three per player, and no more.
	ErrNoBridges = errors.New("no bridges left")
	// ErrNoSetupBridge: no bridge may be built during setup.
	ErrNoSetupBridge = errors.New("bridges cannot be built during setup")
	// ErrNoCoins: coins are not resources, and this is not a resource shortage.
	ErrNoCoins = errors.New("not enough coins")
	// ErrSpendCap: two coin purchases a turn, so at most 4 coins become at most
	// 2 resources.
	ErrSpendCap = errors.New("you have already spent coins twice this turn")
	// ErrBankEmpty: the supply must actually hold the resource; if it does not
	// the purchase is refused and no coins are spent.
	ErrBankEmpty = errors.New("the supply has none of that resource left")
)

// Codes and English reference wording for this module's rules errors; clients
// render their own copy from the code (engine/errcode.go,
// docs/user-facing-text.md). Every sentinel must appear in both lists or
// engine/ruletest fails.
func init() {
	engine.RegisterErrorMessage(ErrBridgeSiteOnly, "A river crosses there, so only a bridge can")
	engine.RegisterErrorMessage(ErrNotBridgeSite, "A bridge only goes where the river crosses a path")
	engine.RegisterErrorMessage(ErrNoBridges, "You have built all three of your bridges")
	engine.RegisterErrorMessage(ErrNoSetupBridge, "Bridges can't be built during setup")
	engine.RegisterErrorMessage(ErrNoCoins, "You don't hold enough coins for that")
	engine.RegisterErrorMessage(ErrSpendCap, "You have already spent coins twice this turn")
	engine.RegisterErrorMessage(ErrBankEmpty, "The supply has none of that resource left")

	engine.RegisterErrorCode(ErrBridgeSiteOnly, "BRIDGE_SITE_ONLY")
	engine.RegisterErrorCode(ErrNotBridgeSite, "NOT_BRIDGE_SITE")
	engine.RegisterErrorCode(ErrNoBridges, "NO_BRIDGES")
	engine.RegisterErrorCode(ErrNoSetupBridge, "NO_SETUP_BRIDGE")
	engine.RegisterErrorCode(ErrNoCoins, "NO_COINS")
	engine.RegisterErrorCode(ErrSpendCap, "COIN_SPEND_CAP")
	engine.RegisterErrorCode(ErrBankEmpty, "SUPPLY_EMPTY")
}
