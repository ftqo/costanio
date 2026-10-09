package server

import (
	"strings"
	"testing"
)

// TestAdminInteractionsRequireHomeGuild: the app is user-installable, so its
// interactions arrive from any guild a user manages and from DMs. Manage
// Server in somebody else's guild must not unlock moderation over ours.
func TestAdminInteractionsRequireHomeGuild(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	e.srv.SetDiscordGuild("g-home")
	e.discordUser(t, "target-1", "Target")

	denied := "Manage Server permission"
	cases := []struct {
		name, guild string
		admin       bool
	}{
		{"foreign guild", `"guild_id":"g-evil",`, false},
		{"no guild (DM)", `"guild_id":"",`, false},
		{"home guild", `"guild_id":"g-home",`, true},
	}
	for _, c := range cases {
		body := `{"type":2,` + c.guild + `"member":{"permissions":"32","user":{"id":"mgr"}},"data":{"name":"whois","options":[{"name":"user","value":"target-1"}]}}`
		txt := firstEmbedText(t, post(body))
		if got := !strings.Contains(txt, denied); got != c.admin {
			t.Errorf("%s: admin=%v, want %v (reply %s)", c.name, got, c.admin, txt)
		}
	}
}
