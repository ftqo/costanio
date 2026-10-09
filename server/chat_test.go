package server

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestChatRateLimitPerUser(t *testing.T) {
	e := newEnv(t)
	bob, _ := e.discordUser(t, "d1", "bob")

	// A connection already following a game scope, with a buffered send channel
	// so the handler's frames don't block.
	c := &Conn{
		srv:    e.srv,
		user:   bob,
		userID: bob.ID,
		send:   make(chan []byte, 8),
		gameID: "g1",
	}

	f := clientFrame{T: "chat", Scope: "game:g1", Msg: "hi"}
	c.handleChat(f) // first: allowed
	c.handleChat(f) // second within the same instant: rate-limited

	// Exactly one chat line persisted.
	lines, err := e.st.RecentChat("game:g1", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 1 {
		t.Fatalf("persisted %d chat lines, want 1 (second should be dropped)", len(lines))
	}

	// The drop produced a RATE_LIMITED error frame.
	if !drainHasCode(c.send, "CHAT_RATE_LIMITED") {
		t.Error("expected a CHAT_RATE_LIMITED error frame for the throttled message")
	}
}

// A language-filter hit opens a report for a moderator and does not ban.
//
// Four separate claims: the sender is not banned, the message is persisted (so
// a moderator can read it), it is not broadcast, and an automated report is
// open against it.
func TestChatLanguageFilterOpensReportNotBan(t *testing.T) {
	e := newEnv(t)
	bob, _ := e.discordUser(t, "df1", "bob")
	eve, _ := e.discordUser(t, "df1b", "eve")

	// A bystander on the same lobby scope. If the filtered line were broadcast,
	// it would land in this channel.
	bystander := &Conn{srv: e.srv, user: eve, userID: eve.ID, send: make(chan []byte, 8)}
	e.srv.hub.add(bystander)
	t.Cleanup(func() { e.srv.hub.remove(bystander) })

	c := &Conn{
		srv:    e.srv,
		user:   bob,
		userID: bob.ID,
		send:   make(chan []byte, 8),
	}

	c.handleChat(clientFrame{T: "chat", ID: "1", Scope: "lobby", Msg: "you are a chink"})

	if !drainHasCode(c.send, "CHAT_FILTERED") {
		t.Fatal("filtered message: expected a CHAT_FILTERED error frame")
	}
	if banned, err := e.st.IsChatBanned(bob.ID); err != nil {
		t.Fatal(err)
	} else if banned {
		t.Fatal("filter hit banned the sender, want a report instead")
	}

	// Persisted, so the report has something to point at, but kept out of the
	// chat history every player can load.
	open, err := e.st.OpenReports(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(open) != 1 || open[0].Msg != "you are a chink" {
		t.Fatalf("open reports = %+v, want one carrying the filtered text", open)
	}
	if hist, _ := e.st.RecentChat("lobby", 50); len(hist) != 0 {
		t.Fatalf("filtered message in chat history: %+v", hist)
	}

	// Not broadcast: nobody else saw it.
	if drainHasChatMsg(bystander.send, "chink") {
		t.Fatal("the filtered message was broadcast to another connection")
	}

	// And an automated report is open against exactly that message.
	r, err := e.st.OpenReportForChat(open[0].ChatID)
	if err != nil {
		t.Fatalf("no open report for the filtered message: %v", err)
	}
	if !r.Automated() {
		t.Errorf("report %d is not marked automated (reporter %d, accused %d)", r.ID, r.ReporterID, r.AccusedID)
	}
	if r.AccusedID != bob.ID {
		t.Errorf("report accuses %d, want %d", r.AccusedID, bob.ID)
	}
}

// A burst of filter hits opens one report, not one per send. The rate limiter
// runs before the filter, so a user can't flood the mod channel with embeds.
func TestChatLanguageFilterBurstOpensOneReport(t *testing.T) {
	e := newEnv(t)
	bob, _ := e.discordUser(t, "df1c", "bob")
	c := &Conn{srv: e.srv, user: bob, userID: bob.ID, send: make(chan []byte, 32)}

	for i := range 5 {
		c.handleChat(clientFrame{T: "chat", ID: strconv.Itoa(i), Scope: "lobby", Msg: "you are a chink"})
	}

	if banned, _ := e.st.IsChatBanned(bob.ID); banned {
		t.Fatal("repeat filter hits banned the sender")
	}
	reports, err := e.st.OpenReports(50)
	if err != nil {
		t.Fatal(err)
	}
	if len(reports) != 1 {
		t.Fatalf("5-message burst opened %d reports, want 1", len(reports))
	}
	if !reports[0].Automated() {
		t.Errorf("report %d is not marked automated", reports[0].ID)
	}
	// And the one message that reached the filter is not in anyone's history.
	lines, err := e.st.RecentChat("lobby", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 0 {
		t.Errorf("burst left %d chat rows in history, want 0", len(lines))
	}
}

func TestChatLanguageFilterAllowsCleanMessage(t *testing.T) {
	e := newEnv(t)
	bob, _ := e.discordUser(t, "df2", "bob")

	c := &Conn{
		srv:    e.srv,
		user:   bob,
		userID: bob.ID,
		send:   make(chan []byte, 8),
	}

	c.handleChat(clientFrame{T: "chat", ID: "1", Scope: "lobby", Msg: "good game, well played"})

	if banned, _ := e.st.IsChatBanned(bob.ID); banned {
		t.Fatal("clean message triggered an auto-ban")
	}
	lines, err := e.st.RecentChat("lobby", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 1 {
		t.Fatalf("clean message persisted %d lines, want 1", len(lines))
	}
}

// drainHasChatMsg reports whether any queued frame is a chat frame whose text
// contains want. Used to prove a message was not broadcast.
func drainHasChatMsg(send chan []byte, want string) bool {
	for {
		select {
		case raw := <-send:
			var m map[string]any
			json.Unmarshal(raw, &m)
			if s, ok := m["msg"].(string); ok && m["t"] == "chat" && strings.Contains(s, want) {
				return true
			}
		default:
			return false
		}
	}
}

// drainHasCode reports whether any queued frame is an err frame with the code.
func drainHasCode(send chan []byte, code string) bool {
	for {
		select {
		case raw := <-send:
			var m map[string]any
			json.Unmarshal(raw, &m)
			if m["t"] == "err" && m["code"] == code {
				return true
			}
		default:
			return false
		}
	}
}
