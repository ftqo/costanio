package cosmetics

import "testing"

// The three cases RobberForSeat separates, including a bot with an empty
// loadout getting the Brigand.
func TestRobberForSeat(t *testing.T) {
	cases := []struct {
		name     string
		equipped string
		bot      bool
		want     string
	}{
		{"a human who owns nothing stays stock", "", false, ""},
		{"a human's purchase is worn", "robber.sentinel", false, "robber.sentinel"},
		{"a bare bot wears the Brigand", "", true, BotRobber},
		{"an explicit choice outranks the bot default", "robber.sentinel", true, "robber.sentinel"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := RobberForSeat(c.equipped, c.bot); got != c.want {
				t.Errorf("RobberForSeat(%q, %v) = %q, want %q", c.equipped, c.bot, got, c.want)
			}
		})
	}
}

// The Brigand the bots wear must be a real catalogue item, or every bot seat
// asks the client for a model file that does not exist.
func TestBotRobberIsInTheCatalogue(t *testing.T) {
	for _, it := range Catalog {
		if it.ID == BotRobber {
			if it.Slot != SlotRobber {
				t.Errorf("%s is in slot %q, want %q", BotRobber, it.Slot, SlotRobber)
			}
			return
		}
	}
	t.Fatalf("bot robber %q is not in the catalogue", BotRobber)
}
