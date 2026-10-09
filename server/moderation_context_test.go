package server

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/ftqo/costan.io/discord"
)

// contextField returns the embed's "Context" field value, or ok=false.
func contextField(emb capturedEmbed) (string, bool) {
	for _, f := range emb.Fields {
		if f.Name == "Context" {
			return f.Value, true
		}
	}
	return "", false
}

// embedChars is what Discord counts against its 6000-character embed total.
func embedChars(emb capturedEmbed) int {
	n := utf8.RuneCountInString(emb.Title) + utf8.RuneCountInString(emb.Description)
	for _, f := range emb.Fields {
		n += utf8.RuneCountInString(f.Name) + utf8.RuneCountInString(f.Value)
	}
	return n
}

// reportWithContext saves before, the reported message, then after in scope,
// with a message in another scope interleaved, and files a report on it.
func reportWithContext(t *testing.T, e *testEnv, scope string, before []string, reported string, after []string) int64 {
	t.Helper()
	accused, _ := e.discordUser(t, "111", hostileName)
	reporter, _ := e.discordUser(t, "222", "Reporter")
	other, _ := e.discordUser(t, "333", "Elsewhere")
	save := func(scope string, uid int64, msg string) int64 {
		t.Helper()
		id, err := e.st.SaveChat(scope, uid, msg)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	for _, m := range before {
		save(scope, reporter.ID, m)
		save("game:other", other.ID, "other scope "+m)
	}
	cid := save(scope, accused.ID, reported)
	for _, m := range after {
		save("game:other", other.ID, "other scope "+m)
		save(scope, reporter.ID, m)
	}
	id, _, err := e.st.CreateOrBumpReport(reporter.ID, accused.ID, cid, scope)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// modEnv is a server with a fake bot and a mod channel; post renders a report
// and returns the embed it sent.
func modEnv(t *testing.T) (e *testEnv, post func(id int64) capturedEmbed) {
	t.Helper()
	e = newEnv(t)
	bot, _, gotBody := fakeChannelPost(t)
	e.srv.discordBot = bot
	if err := e.st.SetModChannel("modchan"); err != nil {
		t.Fatal(err)
	}
	return e, func(id int64) capturedEmbed {
		t.Helper()
		e.srv.postReportEmbed(id)
		return lastEmbed(t, *gotBody)
	}
}

// The report embed shows the chat around the reported message, from its own
// scope only, with the reported line marked and every player word escaped.
func TestReportEmbedShowsSurroundingChat(t *testing.T) {
	e, post := modEnv(t)
	before := []string{"b1 hello", "b2 **bold** [x](https://evil.example)", "b3 @everyone <@999>", "b4 what did you say"}
	after := []string{"a1 settle\n**ban** down", "a2 <@&42> <#7>", "a3 gg", "a4 rematch?"}
	id := reportWithContext(t, e, "game:g1", before, hostileMsg, after)

	emb := post(id)
	ctx, ok := contextField(emb)
	if !ok {
		t.Fatalf("no Context field in %+v", emb)
	}
	lines := strings.Split(ctx, "\n")
	want := []string{"b2", "b3", "b4", "hi", "a1", "a2", "a3"}
	if len(lines) != len(want) {
		t.Fatalf("context has %d lines, want %d (%d either side): %q", len(lines), len(want), reportContextLines, ctx)
	}
	for i, w := range want {
		if !strings.Contains(lines[i], w) {
			t.Errorf("context line %d = %q, want it to carry %q", i, lines[i], w)
		}
	}
	if !strings.HasPrefix(lines[3], "**>**") {
		t.Errorf("reported line unmarked: %q", lines[3])
	}
	for i, ln := range lines {
		if i != 3 && strings.HasPrefix(ln, "**>**") {
			t.Errorf("context line %d marked as the reported one: %q", i, ln)
		}
	}
	if strings.Contains(ctx, "b1") || strings.Contains(ctx, "a4") {
		t.Errorf("context reaches past %d lines either side: %q", reportContextLines, ctx)
	}
	if strings.Contains(ctx, "other scope") {
		t.Errorf("context leaked chat from another scope: %q", ctx)
	}
	if strings.Contains(ctx, "down") {
		t.Errorf("a context message's second line rendered: %q", ctx)
	}
	assertInert(t, "report context", ctx)
	for _, bad := range []string{"<@&42>", "<#7>"} {
		if strings.Contains(strings.ReplaceAll(ctx, `\<`, ""), bad) {
			t.Errorf("live %s in context %q", bad, ctx)
		}
	}
	// The reported message itself is still the description, untouched.
	if emb.Description != discord.Quote(hostileMsg) {
		t.Errorf("description changed: %q", emb.Description)
	}
}

// Long chat around a long reported message: the context gives way, never the
// report. The description is exactly what it is without context, the context
// is shortened by whole lines from the far ends, and the embed stays inside
// Discord's limits so the post is never refused.
func TestReportContextNeverCrowdsOutTheReport(t *testing.T) {
	e, post := modEnv(t)
	long := func(tag string) string {
		return tag + " " + strings.Repeat("*_<@1>[x](y)`", maxChatLen/13+1)[:maxChatLen-len(tag)-1]
	}
	reported := long("REPORTED")
	var before, after []string
	for _, tag := range []string{"B1", "B2", "B3", "B4"} {
		before = append(before, long(tag))
	}
	for _, tag := range []string{"A1", "A2", "A3", "A4"} {
		after = append(after, long(tag))
	}
	id := reportWithContext(t, e, "lobby", before, reported, after)

	emb := post(id)
	if emb.Description != discord.Quote(reported) {
		t.Fatalf("the reported message was shortened for the context:\n%q", emb.Description)
	}
	ctx, ok := contextField(emb)
	if !ok {
		t.Fatalf("no Context field in %+v", emb)
	}
	if len(ctx) > 1024 {
		t.Fatalf("context is %d bytes, over Discord's field limit", len(ctx))
	}
	if n := embedChars(emb); n > 6000 {
		t.Fatalf("embed is %d characters, over Discord's 6000 total", n)
	}
	lines := strings.Split(ctx, "\n")
	reportedAt := -1
	for i, ln := range lines {
		if strings.HasPrefix(ln, "**>**") {
			reportedAt = i
		}
		if !strings.HasPrefix(ln, "**>**") && !strings.HasPrefix(ln, "  ") {
			t.Errorf("context line %d was cut mid-line: %q", i, ln)
		}
	}
	if reportedAt < 0 || !strings.Contains(lines[reportedAt], "REPORTED") {
		t.Fatalf("the reported line fell out of the context: %q", ctx)
	}
	whole := discord.QuoteContext([]discord.ContextLine{{From: hostileName, Msg: truncate(reported, reportContextMsgBytes), Reported: true}})
	if lines[reportedAt] != whole {
		t.Fatalf("the reported line was clipped:\n got %q\nwant %q", lines[reportedAt], whole)
	}
	if reportedAt == 0 || !strings.Contains(lines[reportedAt-1], "B4") {
		t.Errorf("the line the reported message answered was dropped first: %q", ctx)
	}
	assertInert(t, "report context", ctx)
}

// A message with nothing around it gets no Context field: a field repeating
// the description adds nothing.
func TestReportEmbedWithoutContext(t *testing.T) {
	e, post := modEnv(t)
	id := reportWithContext(t, e, "lobby", nil, hostileMsg, nil)
	emb := post(id)
	if v, ok := contextField(emb); ok {
		t.Fatalf("lone message got a Context field %q", v)
	}
	if emb.Description != discord.Quote(hostileMsg) {
		t.Fatalf("description = %q", emb.Description)
	}
}
