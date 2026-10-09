package server

import (
	"net/http"
	"strings"
	"testing"
)

// A message the language filter dropped was never broadcast, so it must not
// come back through chat history either. The game screen seeds its chat from
// GET /api/games/{id} (RecentChat), which every viewer of the table can call.
func TestFilteredChatNotInGameHistory(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "fh1", "host")
	_, specC := e.discordUser(t, "fh2", "spectator")
	id := startActiveSolo(t, e, host)

	c := &Conn{srv: e.srv, user: host, userID: host.ID, gameID: id, send: make(chan []byte, 8)}
	c.handleChat(clientFrame{T: "chat", ID: "1", Scope: "game:" + id, Msg: "you are a chink"})
	if !drainHasCode(c.send, "CHAT_FILTERED") {
		t.Fatal("expected the message to be filtered")
	}
	e.srv.chatLimit = newKeyedLimiter(1000, 1000)
	c.handleChat(clientFrame{T: "chat", ID: "2", Scope: "game:" + id, Msg: "good luck all"})

	resp, out := e.req(t, "GET", "/api/games/"+id, specC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get = %d", resp.StatusCode)
	}
	chat, _ := out["chat"].([]any)
	var msgs []string
	for _, raw := range chat {
		msgs = append(msgs, raw.(map[string]any)["msg"].(string))
	}
	if strings.Contains(strings.Join(msgs, "\n"), "chink") {
		t.Fatalf("filtered message served as chat history: %q", msgs)
	}
	if len(msgs) != 1 || msgs[0] != "good luck all" {
		t.Fatalf("chat history = %q, want the delivered message only", msgs)
	}
}

// A filtered message cannot be reported by id either: a player never saw it,
// so a report on it can only come from guessing ids.
func TestFilteredChatNotReportable(t *testing.T) {
	e := newEnv(t)
	bob, _ := e.discordUser(t, "fr1", "bob")
	c := &Conn{srv: e.srv, user: bob, userID: bob.ID, send: make(chan []byte, 8)}
	c.handleChat(clientFrame{T: "chat", ID: "1", Scope: "lobby", Msg: "you are a chink"})
	open, err := e.st.OpenReports(10)
	if err != nil || len(open) != 1 {
		t.Fatalf("open reports = %v, %v", open, err)
	}
	if _, err := e.st.ChatByID(open[0].ChatID); err == nil {
		t.Fatalf("ChatByID served the filtered message %d to a reporter", open[0].ChatID)
	}
}
