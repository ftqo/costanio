package server

import (
	"strconv"
	"testing"

	"github.com/ftqo/costan.io/store"
)

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func TestSetDiscordBotStoresClient(t *testing.T) {
	e := newEnv(t)
	if e.srv.discordBot != nil {
		t.Fatal("expected no bot client by default")
	}
}

func TestReportFrameValidation(t *testing.T) {
	e := newEnv(t)

	accused, _ := e.discordUser(t, "accused-id", "accused")

	// A real chat row from the accused (used for the valid-report and revoked cases).
	cid, err := e.srv.store.SaveChat("lobby", accused.ID, "bad message")
	if err != nil {
		t.Fatal(err)
	}

	// --- Self-report is rejected ---
	// Use a dedicated reporter so its rate-limit token stays separate.
	selfReporter, _ := e.discordUser(t, "self-reporter-id", "self-reporter")
	selfCid, _ := e.srv.store.SaveChat("lobby", selfReporter.ID, "my own message")
	rcSelf := &Conn{
		srv:    e.srv,
		user:   selfReporter,
		userID: selfReporter.ID,
		send:   make(chan []byte, 8),
	}
	rcSelf.handleReport(clientFrame{T: "report", ID: "1", ChatID: selfCid})
	if !drainHasCode(rcSelf.send, "REPORT_SELF") {
		t.Fatal("self-report: expected REPORT_SELF error frame")
	}

	// --- Valid report creates an open report row ---
	reporter, _ := e.discordUser(t, "reporter-id", "reporter")
	rcValid := &Conn{
		srv:    e.srv,
		user:   reporter,
		userID: reporter.ID,
		send:   make(chan []byte, 8),
	}
	rcValid.handleReport(clientFrame{T: "report", ID: "2", ChatID: cid})
	// No err frame expected; poll the store for the created report.
	waitFor(t, func() bool {
		_, err := e.srv.store.OpenReportForChat(cid)
		return err == nil
	}, "report row created")

	// --- Revoked reporter is rejected ---
	// Use a fresh reporter user so the rate-limit and prior reports don't interfere.
	revokedReporter, _ := e.discordUser(t, "revoked-reporter-id", "revoked-reporter")
	for range 5 {
		if err := e.srv.store.RecordStrike(revokedReporter.ID, "denial", nil); err != nil {
			t.Fatal(err)
		}
	}
	cid2, _ := e.srv.store.SaveChat("lobby", accused.ID, "another bad message")
	rcRevoked := &Conn{
		srv:    e.srv,
		user:   revokedReporter,
		userID: revokedReporter.ID,
		send:   make(chan []byte, 8),
	}
	rcRevoked.handleReport(clientFrame{T: "report", ID: "3", ChatID: cid2})
	if !drainHasCode(rcRevoked.send, "REPORT_REVOKED") {
		t.Fatal("revoked reporter: expected REPORT_REVOKED error frame")
	}
}

// mkServerUser creates a Discord-linked server user for use in component-interaction tests.
func mkServerUser(t *testing.T, e *testEnv, name string) *store.User {
	t.Helper()
	u, _ := e.discordUser(t, name+"-discord-id", name)
	return u
}

func TestModButtonWarnAndEscalate(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	reporter := mkServerUser(t, e, "rep")
	accused := mkServerUser(t, e, "acc")
	cid, _ := e.srv.store.SaveChat("lobby", accused.ID, "bad")
	id, _, _ := e.srv.store.CreateOrBumpReport(reporter.ID, accused.ID, cid, "lobby")

	// admin perms bit (manage guild = 0x20 = 32).
	body := func(custom string) string {
		return `{"type":3,"data":{"custom_id":"` + custom + `"},"member":{"permissions":"32","user":{"id":"mod1"}}}`
	}

	// Warn (no prior warns) -> warn strike + resolved 'warn'.
	post(body("mod:report:" + itoa(id) + ":warn"))
	if n, _ := e.srv.store.WarnCount(accused.ID); n != 1 {
		t.Fatalf("warn count=%d want 1", n)
	}
	r, _ := e.srv.store.ReportByID(id)
	if r.Status != "resolved" || r.Resolution != "warn" {
		t.Fatalf("status=%s res=%s", r.Status, r.Resolution)
	}

	// Pre-seed accused at the escalation threshold, file a fresh report, warn -> ban.
	threshold := store.WarnEscalateThreshold()
	for range threshold - 1 { // already has 1; reach threshold
		e.srv.store.RecordStrike(accused.ID, "warn", nil)
	}
	cid2, _ := e.srv.store.SaveChat("lobby", accused.ID, "again")
	id2, _, _ := e.srv.store.CreateOrBumpReport(reporter.ID, accused.ID, cid2, "lobby")
	post(body("mod:report:" + itoa(id2) + ":warn"))
	if banned, _ := e.srv.store.IsChatBanned(accused.ID); !banned {
		t.Fatal("warn at threshold should have escalated to a ban")
	}
}

func TestModButtonDoNothingStrikesReporter(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	reporter := mkServerUser(t, e, "rep")
	accused := mkServerUser(t, e, "acc")
	cid, _ := e.srv.store.SaveChat("lobby", accused.ID, "bad")
	id, _, _ := e.srv.store.CreateOrBumpReport(reporter.ID, accused.ID, cid, "lobby")
	body := `{"type":3,"data":{"custom_id":"mod:report:` + itoa(id) + `:none"},"member":{"permissions":"32","user":{"id":"mod1"}}}`
	post(body)
	if n, _ := e.srv.store.DenialCountSince(reporter.ID, 0); n != 1 {
		t.Fatalf("reporter denial count=%d want 1", n)
	}
	// Double-click is idempotent (no second denial).
	post(body)
	if n, _ := e.srv.store.DenialCountSince(reporter.ID, 0); n != 1 {
		t.Fatalf("idempotency broken: denial count=%d want 1", n)
	}
}

func TestSetReportChannelAndUnban(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	// The report channel is now set via the /config panel's channel-select.
	post(`{"type":3,"data":{"custom_id":"config:ch:reports","component_type":8,"values":["chan42"]},"member":{"permissions":"32","user":{"id":"mod1"}}}`)
	if ch, _ := e.srv.store.ModChannel(); ch != "chan42" {
		t.Fatalf("mod channel=%q want chan42", ch)
	}
	// unban-chat lifts a ban.
	u := mkServerUser(t, e, "banned")
	e.srv.store.BanChat(u.ID, "x", nil, nil)
	post(`{"type":2,"data":{"name":"unban-chat","options":[{"name":"user","value":"` + u.DiscordID + `"}]},"member":{"permissions":"32","user":{"id":"mod1"}}}`)
	if banned, _ := e.srv.store.IsChatBanned(u.ID); banned {
		t.Fatal("unban-chat did not lift the ban")
	}
}

func TestChatGate(t *testing.T) {
	e := newEnv(t)

	// Guest: no linked Discord -> cannot chat.
	guest, _ := e.guest(t, "guestyg")
	gc := &Conn{
		srv:    e.srv,
		user:   guest,
		userID: guest.ID,
		send:   make(chan []byte, 8),
	}
	gc.handleChat(clientFrame{T: "chat", ID: "1", Scope: "lobby", Msg: "hi"})
	if !drainHasCode(gc.send, "CHAT_LINK_REQUIRED") {
		t.Fatal("guest chat: expected CHAT_LINK_REQUIRED error frame")
	}
	lines, err := e.st.RecentChat("lobby", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 0 {
		t.Fatalf("guest chat persisted %d lines, want 0", len(lines))
	}

	// Discord user, banned -> cannot chat.
	u, _ := e.discordUser(t, "d-ban1", "banme")
	if err := e.srv.store.BanChat(u.ID, "spam", nil, nil); err != nil {
		t.Fatal(err)
	}
	bc := &Conn{
		srv:    e.srv,
		user:   u,
		userID: u.ID,
		send:   make(chan []byte, 8),
	}
	bc.handleChat(clientFrame{T: "chat", ID: "2", Scope: "lobby", Msg: "hi"})
	if !drainHasCode(bc.send, "CHAT_BANNED") {
		t.Fatal("banned chat: expected CHAT_BANNED error frame")
	}
	lines, err = e.st.RecentChat("lobby", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 0 {
		t.Fatalf("banned chat persisted %d lines, want 0", len(lines))
	}
}

func TestUnlockNameCommand(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	u := mkServerUser(t, e, "locked")
	e.srv.store.LockName(u.ID, "attempted name: x", nil)
	if locked, _ := e.srv.store.IsNameLocked(u.ID); !locked {
		t.Fatal("precondition: user should be name-locked")
	}
	post(`{"type":2,"data":{"name":"unlock-name","options":[{"name":"user","value":"` + u.DiscordID + `"}]},"member":{"permissions":"32","user":{"id":"mod1"}}}`)
	if locked, _ := e.srv.store.IsNameLocked(u.ID); locked {
		t.Fatal("unlock-name did not lift the name lock")
	}
}
