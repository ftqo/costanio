package cosmetics

// What a bot seat wears.
//
// A bot is a guest user with no loadout, so its robber would be stock and a
// table of bots would never look like anybody's. Bots wear the Brigand instead.
// It is not bought or stored in the loadout table; RobberForSeat applies it.
const BotRobber = "robber.brigand"

// RobberForSeat is the robber skin a seat's moves should dress the piece in:
// whatever the player equipped, the Brigand for a bot that equipped nothing,
// and the empty string (stock art) for a human who owns no skin.
//
// An equipped skin always wins over the bot default.
func RobberForSeat(equipped string, bot bool) string {
	if equipped != "" {
		return equipped
	}
	if bot {
		return BotRobber
	}
	return ""
}
