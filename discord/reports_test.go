package discord

import (
	"strings"
	"testing"
	"time"
)

func TestReportQueueEmbed(t *testing.T) {
	if e := ReportQueueEmbed(nil, 0); !strings.Contains(e.Description, "Nothing open") {
		t.Fatalf("empty queue = %q", e.Description)
	}

	e := ReportQueueEmbed([]ReportSummary{
		{ID: 7, Accused: NameMention("Bob", "1"), Reporter: NameMention("Ann", "2"),
			Scope: "lobby", Msg: "you are terrible", Count: 3, Age: 90 * time.Minute},
		{ID: 9, Accused: NameMention("Eve", "3"), Scope: "game:g1",
			Msg: "slur", Automated: true, Age: 50 * time.Hour},
	}, 12)
	if !strings.Contains(e.Description, "12 open, showing the 2 oldest") {
		t.Fatalf("description = %q", e.Description)
	}
	if got := e.Fields[0].Name; !strings.Contains(got, "#7") || !strings.Contains(got, "1h ago") || !strings.Contains(got, "3 reporters") {
		t.Fatalf("field name = %q", got)
	}
	if got := e.Fields[1].Name; !strings.Contains(got, "language filter") || !strings.Contains(got, "2d ago") {
		t.Fatalf("automated field name = %q", got)
	}
	// A filter report has no human reporter, so it must not claim one.
	if strings.Contains(e.Fields[1].Value, "Reporter:") {
		t.Fatalf("automated report named a reporter: %q", e.Fields[1].Value)
	}
	// The queue shows the same total when it is showing all of it.
	if e := ReportQueueEmbed([]ReportSummary{{ID: 1, Msg: "x"}}, 1); !strings.Contains(e.Description, "1 open, oldest first") {
		t.Fatalf("description = %q", e.Description)
	}
}

// TestReportQueueEmbedQuotesAttackerText: the queue shows the same player-written
// text the report embed does, so it needs the same escaping.
func TestReportQueueEmbedQuotesAttackerText(t *testing.T) {
	e := ReportQueueEmbed([]ReportSummary{{
		ID:  1,
		Msg: "**Accused**\nsomeone else",
	}}, 1)
	v := e.Fields[0].Value
	if strings.Contains(v, "**Accused**") {
		t.Fatalf("field value renders attacker markdown: %q", v)
	}
	if strings.Contains(v, "someone else") {
		t.Fatalf("field value kept the line after the newline: %q", v)
	}
}

func TestQuoteContext(t *testing.T) {
	got := QuoteContext([]ContextLine{
		{From: "Ann", Msg: "you are terrible at this"},
		{From: "**Bob**", Msg: "no *you* are", Reported: true},
		{From: "Cid", Msg: "settle down\nboth of you"},
	})
	lines := strings.Split(got, "\n")
	if len(lines) != 3 {
		t.Fatalf("QuoteContext = %q, want three lines", got)
	}
	if !strings.HasPrefix(lines[1], "**>**") {
		t.Fatalf("reported line unmarked: %q", lines[1])
	}
	if strings.Contains(got, "**Bob**") || strings.Contains(got, "*you*") {
		t.Fatalf("QuoteContext left player markdown live: %q", got)
	}
	if strings.Contains(got, "both of you") {
		t.Fatalf("QuoteContext kept a second line: %q", got)
	}
}

func TestHumanAge(t *testing.T) {
	for _, tt := range []struct {
		d    time.Duration
		want string
	}{
		{20 * time.Second, "just now"},
		{5 * time.Minute, "5m ago"},
		{3 * time.Hour, "3h ago"},
		{72 * time.Hour, "3d ago"},
	} {
		if got := humanAge(tt.d); got != tt.want {
			t.Fatalf("humanAge(%v) = %q, want %q", tt.d, got, tt.want)
		}
	}
}

// FitContext keeps the reported line and the lines nearest it, dropping whole
// lines from the far ends until the rendering fits; it never clips mid-line
// while there is a line left to drop.
func TestFitContext(t *testing.T) {
	long := strings.Repeat("x", 300)
	lines := []ContextLine{
		{From: "A", Msg: "far before " + long},
		{From: "B", Msg: "near before"},
		{From: "C", Msg: "the reported one", Reported: true},
		{From: "D", Msg: "near after"},
		{From: "E", Msg: "far after " + long},
	}
	if got := FitContext(lines, limitFieldValue); got != QuoteContext(lines) {
		t.Fatalf("a window that fits was changed:\n%q\nwant\n%q", got, QuoteContext(lines))
	}
	got := FitContext(lines, 200)
	if len(got) > 200 {
		t.Fatalf("FitContext(200) is %d bytes: %q", len(got), got)
	}
	if strings.Contains(got, "far before") || strings.Contains(got, "far after") {
		t.Fatalf("far lines kept over the budget: %q", got)
	}
	for _, want := range []string{"near before", "the reported one", "near after"} {
		if !strings.Contains(got, want) {
			t.Fatalf("FitContext(200) dropped %q: %q", want, got)
		}
	}
	// Tighter still: the line before (what the message answered) outlasts the
	// line after, and the reported line outlasts both.
	got = FitContext(lines, 60)
	if !strings.Contains(got, "the reported one") || strings.Contains(got, "near after") {
		t.Fatalf("FitContext(60) = %q", got)
	}
	got = FitContext(lines, 30)
	if !strings.Contains(got, "the reported") || strings.Count(got, "\n") != 0 {
		t.Fatalf("FitContext(30) = %q, want the reported line alone", got)
	}
	if got := FitContext(nil, 100); got != "" {
		t.Fatalf("FitContext(nil) = %q", got)
	}
}

// Names are escaped outside any code span: Discord does not honour a backslash
// escape inside one, so "cool\_guy" would show its backslash and a backtick in
// a name would close the span.
func TestQuoteContextNamesOutsideCodeSpans(t *testing.T) {
	got := QuoteContext([]ContextLine{{From: "cool_guy`x", Msg: "hi", Reported: true}})
	if strings.Contains(got, "`cool") || strings.Count(got, "`") != strings.Count(got, "\\`") {
		t.Fatalf("name rendered in a code span: %q", got)
	}
	if !strings.Contains(got, `cool\_guy\`+"`"+`x`) {
		t.Fatalf("name not escaped: %q", got)
	}
}
