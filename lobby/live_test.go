package lobby

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestLiveGamesListsActivePublicOnly(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "lh", "Host")

	// A public game that's been started should appear.
	pub, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err := st.SetGameStatus(pub.Game.ID, "active"); err != nil {
		t.Fatal(err)
	}
	// A public game still in the lobby should not appear.
	l.Create(host, engine.GameConfig{Players: 4}, false)
	// A private started game should not appear.
	priv, _ := l.Create(host, engine.GameConfig{Players: 4}, true)
	if err := st.SetGameStatus(priv.Game.ID, "active"); err != nil {
		t.Fatal(err)
	}

	live, err := l.LiveGames()
	if err != nil {
		t.Fatalf("LiveGames: %v", err)
	}
	if len(live) != 1 {
		t.Fatalf("LiveGames returned %d; want exactly the one active public game", len(live))
	}
	if live[0].Game.ID != pub.Game.ID {
		t.Fatalf("LiveGames returned %q; want %q", live[0].Game.ID, pub.Game.ID)
	}
	if live[0].HostName != "Host" {
		t.Errorf("HostName = %q; want Host", live[0].HostName)
	}
}
