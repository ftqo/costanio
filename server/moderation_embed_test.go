package server

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

// liveLinkClose matches the "](" that closes a masked link's text, unless its
// bracket is backslash-escaped.
var liveLinkClose = regexp.MustCompile(`(^|[^\\])\]\(`)

// hostileMsg is a reported chat message written to impersonate the bot: a
// second line outside the quote, bold text, a masked link and two mentions.
const hostileMsg = "hi\n**ban** [x](https://evil.example) @everyone <@123>"

// hostileName is a display name that would restyle any field it lands in.
const hostileName = "**mod** [x](https://evil.example) <@123>"

// assertInert fails if s carries any live piece of the hostile inputs: markdown
// that would render, a masked link, or a mention that is not backslash-escaped.
// ownMentions are mentions the server itself adds, which must stay live.
func assertInert(t *testing.T, where, s string, ownMentions ...string) {
	t.Helper()
	for _, bad := range []string{"**ban**", "**mod**", "[x]("} {
		if strings.Contains(s, bad) {
			t.Errorf("%s: %q survived unescaped in %q", where, bad, s)
		}
	}
	if liveLinkClose.MatchString(s) {
		t.Errorf("%s: live masked-link bracket in %q", where, s)
	}
	rest := s
	for _, m := range ownMentions {
		rest = strings.ReplaceAll(rest, m, "")
	}
	if strings.Count(rest, "<@") != strings.Count(rest, `\<@`) {
		t.Errorf("%s: live mention in %q", where, s)
	}
	if strings.Count(rest, "@everyone") != strings.Count(rest, `\@everyone`) {
		t.Errorf("%s: live @everyone in %q", where, s)
	}
}

// assertQuoted fails unless every line of s is inside the blockquote, so text
// after a newline cannot pass as the bot's own embed body.
func assertQuoted(t *testing.T, where, s string) {
	t.Helper()
	for ln := range strings.SplitSeq(s, "\n") {
		if !strings.HasPrefix(ln, "> ") {
			t.Errorf("%s: line %q is outside the blockquote in %q", where, ln, s)
		}
	}
}

type capturedEmbed struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Fields      []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"fields"`
}

func lastEmbed(t *testing.T, body string) capturedEmbed {
	t.Helper()
	var msg struct {
		Embeds []capturedEmbed `json:"embeds"`
	}
	if err := json.Unmarshal([]byte(body), &msg); err != nil || len(msg.Embeds) != 1 {
		t.Fatalf("no embed in posted body %q (err %v)", body, err)
	}
	return msg.Embeds[0]
}

func TestReportEmbedEscapesPlayerText(t *testing.T) {
	e := newEnv(t)
	bot, _, gotBody := fakeChannelPost(t)
	e.srv.discordBot = bot
	if err := e.st.SetModChannel("modchan"); err != nil {
		t.Fatal(err)
	}
	accused, _ := e.discordUser(t, "111", hostileName)
	reporter, _ := e.discordUser(t, "222", hostileName)
	cid, err := e.st.SaveChat("lobby", accused.ID, hostileMsg)
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := e.st.CreateOrBumpReport(reporter.ID, accused.ID, cid, "lobby")
	if err != nil {
		t.Fatal(err)
	}

	e.srv.postReportEmbed(id)
	emb := lastEmbed(t, *gotBody)

	assertQuoted(t, "report description", emb.Description)
	assertInert(t, "report description", emb.Description)
	for _, f := range emb.Fields {
		assertInert(t, "report field "+f.Name, f.Value, "(<@111>)", "(<@222>)")
	}
	var values strings.Builder
	for _, f := range emb.Fields {
		values.WriteString(f.Value + "\n")
	}
	if v := values.String(); !strings.Contains(v, "(<@111>)") || !strings.Contains(v, "(<@222>)") {
		t.Errorf("the server's own mentions of accused and reporter went missing: %q", values.String())
	}
}

func TestNameLockEmbedEscapesPlayerText(t *testing.T) {
	e := newEnv(t)
	bot, _, gotBody := fakeChannelPost(t)
	e.srv.discordBot = bot
	if err := e.st.SetModChannel("modchan"); err != nil {
		t.Fatal(err)
	}
	u, _ := e.discordUser(t, "333", hostileName)

	e.srv.postNameLockEmbed(u.ID, hostileMsg, "*ban*")
	emb := lastEmbed(t, *gotBody)

	assertQuoted(t, "name-lock description", emb.Description)
	assertInert(t, "name-lock description", emb.Description)
	for _, f := range emb.Fields {
		assertInert(t, "name-lock field "+f.Name, f.Value, "(<@333>)")
	}
	for _, f := range emb.Fields {
		if f.Name == "Matched term" && f.Value == "*ban*" {
			t.Errorf("matched term rendered as markdown: %q", f.Value)
		}
	}
}

func TestReportQueueEscapesNames(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	accused, _ := e.discordUser(t, "444", hostileName)
	reporter, _ := e.discordUser(t, "555", hostileName)
	cid, _ := e.st.SaveChat("lobby", accused.ID, hostileMsg)
	if _, _, err := e.st.CreateOrBumpReport(reporter.ID, accused.ID, cid, "lobby"); err != nil {
		t.Fatal(err)
	}

	out := post(`{"type":2,"data":{"name":"reports"},"member":{"permissions":"32","user":{"id":"mod1"}}}`)
	raw, _ := json.Marshal(out["data"])
	emb := lastEmbed(t, string(raw))
	if len(emb.Fields) != 1 {
		t.Fatalf("want one queued report, got %+v", emb)
	}
	assertInert(t, "/reports field", emb.Fields[0].Value, "(<@444>)", "(<@555>)")
}

// Every other bot reply that prints a player's display name, so a name cannot
// restyle the moderator's view or masquerade as a link there either.
func TestCommandRepliesEscapeNames(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	e.discordUser(t, "666", hostileName)
	admin := func(name string) string {
		return `{"type":2,"data":{"name":"` + name + `","options":[{"name":"user","value":"666"}]},"member":{"permissions":"32","user":{"id":"666"}}}`
	}
	for _, cmd := range []string{"whois", "stats", "reset-user", "report-strikes", "unban-chat", "unlock-name", "link"} {
		out := post(admin(cmd))
		raw, _ := json.Marshal(out["data"])
		var data struct {
			Content string          `json:"content"`
			Embeds  []capturedEmbed `json:"embeds"`
		}
		_ = json.Unmarshal(raw, &data)
		var shown strings.Builder
		shown.WriteString(data.Content)
		assertInert(t, cmd+" content", data.Content)
		for _, emb := range data.Embeds {
			shown.WriteString(emb.Title + emb.Description)
			assertInert(t, cmd+" title", emb.Title)
			assertInert(t, cmd+" description", emb.Description)
		}
		if !strings.Contains(shown.String(), "mod") {
			t.Errorf("%s: reply never showed the name, so the check above proved nothing: %s", cmd, raw)
		}
	}
}
