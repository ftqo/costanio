package discord

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestQuoteContainsAttackerText is the spoofing table: player-written text in a
// moderation embed must not be able to pass as the bot's own text.
func TestQuoteContainsAttackerText(t *testing.T) {
	tests := []struct {
		name string
		msg  string
		// substrings that must not survive verbatim at the start of a line
		gone []string
	}{
		{
			name: "fake bot line after a newline",
			msg:  "hi\nAlready actioned.",
			gone: []string{"\nAlready actioned."},
		},
		{
			name: "fabricated accused block",
			msg:  "hi\n**Accused**\nsomeone else (<@999>)",
			gone: []string{"\n**Accused**", "**Accused**"},
		},
		{
			// Embed descriptions render masked links, so an unescaped one shows a
			// moderator a costan.io-looking link pointing anywhere.
			name: "masked link",
			msg:  "[costan.io/moderation](https://evil.example)",
			gone: []string{"> [costan"},
		},
		{
			name: "nested blockquote escape",
			msg:  "> not the bot",
			gone: []string{"\n> > "},
		},
		{
			name: "markdown restyling",
			msg:  "# BIG ~~strike~~ *em* `code`",
			gone: []string{" # ", " ~~", " *em"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Quote(tt.msg)
			for ln := range strings.SplitSeq(got, "\n") {
				if !strings.HasPrefix(ln, "> ") {
					t.Fatalf("Quote(%q) produced a line outside the blockquote: %q", tt.msg, ln)
				}
			}
			for _, bad := range tt.gone {
				if strings.Contains(got, bad) {
					t.Fatalf("Quote(%q) = %q still contains %q", tt.msg, got, bad)
				}
			}
		})
	}
}

// TestQuoteEscapesMarkdownExactly pins the escaped form, since "gone" above can
// only prove the raw sequence is broken up, not that it is broken up correctly.
func TestQuoteEscapesMarkdownExactly(t *testing.T) {
	got := Quote("# BIG ~~strike~~ *em* `code` [a](b)")
	want := "> \\# BIG \\~\\~strike\\~\\~ \\*em\\* \\`code\\` \\[a\\](b)"
	if got != want {
		t.Fatalf("Quote markdown = %q, want %q", got, want)
	}
}

func TestQuoteBounds(t *testing.T) {
	// A message of newlines cannot push the real fields out of view.
	got := Quote(strings.Repeat("a\n", 200))
	if n := strings.Count(got, "\n") + 1; n > 21 {
		t.Fatalf("Quote kept %d lines, want at most 21", n)
	}
	// Runs of blank lines collapse.
	if got := Quote("a\n\n\n\n\nb"); got != "> a\n> \n> b" {
		t.Fatalf("Quote blank-run = %q", got)
	}
	// Ordinary text is left readable.
	if got := Quote("gg wp everyone"); got != "> gg wp everyone" {
		t.Fatalf("Quote(plain) = %q", got)
	}
}

func TestNameMention(t *testing.T) {
	if got := NameMention("**mod**", "123"); got != `\*\*mod\*\* (<@123>)` {
		t.Fatalf("NameMention = %q", got)
	}
	if got := NameMention("[click](https://evil.example)", ""); !strings.HasPrefix(got, `\[click\]`) {
		t.Fatalf("NameMention left a masked link unescaped: %q", got)
	}
	if got := NameMention("Brian", "123"); got != "Brian (<@123>)" {
		t.Fatalf("NameMention(plain) = %q", got)
	}
}

func TestSanitizeText(t *testing.T) {
	if got := SanitizeText("a\u202eb\x00c"); got != "abc" {
		t.Fatalf("SanitizeText = %q, want %q", got, "abc")
	}
	// Newlines and tabs survive; Quote is what handles them.
	if got := SanitizeText("a\nb\tc"); got != "a\nb\tc" {
		t.Fatalf("SanitizeText dropped whitespace: %q", got)
	}
	// The zero-width joiner survives, because it builds emoji sequences that
	// appear in ordinary player names.
	const family = "\U0001F468\u200d\U0001F469\u200d\U0001F467"
	if got := SanitizeText(family); got != family {
		t.Fatalf("SanitizeText mangled an emoji sequence: %q", got)
	}
}

// TestEmbedMarshalIsSafeByDefault pins the builder-level guarantees: a call site
// that forgets to sanitize still cannot emit control characters, and an
// over-long field is clipped rather than rejected by Discord (which would drop
// the whole report).
func TestEmbedMarshalIsSafeByDefault(t *testing.T) {
	e := Embed{
		Title:       "t\x07itle",
		Description: strings.Repeat("d", limitDescription+50),
		Fields: []EmbedField{
			{Name: "n\u202dame", Value: strings.Repeat("v", limitFieldValue+50)},
		},
		Author: EmbedAuthor{Name: "a\x00uthor"},
		Footer: "f\x1boot",
	}
	b, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Fields      []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"fields"`
		Author struct {
			Name string `json:"name"`
		} `json:"author"`
		Footer struct {
			Text string `json:"text"`
		} `json:"footer"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.Title != "title" {
		t.Fatalf("title = %q", got.Title)
	}
	if got.Author.Name != "author" {
		t.Fatalf("author = %q", got.Author.Name)
	}
	if got.Footer.Text != "foot" {
		t.Fatalf("footer = %q", got.Footer.Text)
	}
	if got.Fields[0].Name != "name" {
		t.Fatalf("field name = %q", got.Fields[0].Name)
	}
	if len(got.Description) > limitDescription {
		t.Fatalf("description %d bytes, over the %d limit", len(got.Description), limitDescription)
	}
	if len(got.Fields[0].Value) > limitFieldValue {
		t.Fatalf("field value %d bytes, over the %d limit", len(got.Fields[0].Value), limitFieldValue)
	}
}

// A mention or custom emoji in player text must render as literal text, not as
// a pill that names (or impersonates) a member, a role or @everyone.
func TestEscapeMarkdownNeutralizesMentions(t *testing.T) {
	got := Quote("hi <@123> <@&9> <#7> <:e:1> @everyone @here")
	for _, live := range []string{" <@123>", " <@&9>", " <#7>", " <:e:1>", " @everyone", " @here"} {
		if strings.Contains(got, live) {
			t.Errorf("Quote left %q live in %q", live, got)
		}
	}
	if got := NameMention("<@123>", "1"); got != `\<\@123\> (<@1>)` {
		t.Errorf("NameMention = %q", got)
	}
}
