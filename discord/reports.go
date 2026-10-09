package discord

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

// ReportSummary is one open moderation report, in the shape a mod channel needs
// to show it. The fields are plain strings so this package stays free of any
// dependency on store/: the caller resolves names and ages, this renders them.
//
// Accused and Reporter should come from NameMention. Msg is the reported text
// exactly as the player wrote it; it is quoted and escaped here, so do not
// pre-escape it.
type ReportSummary struct {
	ID        int64
	Accused   string
	Reporter  string
	Scope     string
	Msg       string
	Count     int  // reporters who filed on this message
	Automated bool // raised by the language filter, not a player
	Age       time.Duration
}

// ReportQueueEmbed renders the open report queue, so moderators can pull
// reports rather than relying only on channel pushes.
//
// total is the full backlog, which may exceed the summaries passed in; the
// embed states the difference.
func ReportQueueEmbed(open []ReportSummary, total int) Embed {
	if len(open) == 0 {
		return Embed{
			Title:       "Open chat reports",
			Description: "Nothing open. Reports land here as they are filed.",
			Color:       reportEmbedColor,
		}
	}
	e := Embed{
		Title: "Open chat reports",
		Color: reportEmbedColor,
	}
	if total > len(open) {
		e.Description = fmt.Sprintf("%d open, showing the %d oldest.", total, len(open))
	} else {
		e.Description = fmt.Sprintf("%d open, oldest first.", total)
	}
	for _, r := range open {
		if len(e.Fields) == maxEmbedFields {
			break
		}
		name := fmt.Sprintf("#%d · %s · %s", r.ID, r.Scope, humanAge(r.Age))
		if r.Automated {
			name += " · language filter"
		} else if r.Count > 1 {
			name += fmt.Sprintf(" · %d reporters", r.Count)
		}
		var b strings.Builder
		b.WriteString("Accused: " + r.Accused)
		if !r.Automated && r.Reporter != "" {
			b.WriteString("\nReporter: " + r.Reporter)
		}
		b.WriteString("\n" + Quote(firstLine(r.Msg)))
		e.Fields = append(e.Fields, EmbedField{Name: name, Value: b.String()})
	}
	return e
}

// ContextLine is one chat message around a reported one, for QuoteContext.
type ContextLine struct {
	From     string
	Msg      string
	Reported bool // the message the report is about
}

// QuoteContext renders the chat around a reported message, so a moderator can
// see what it answered. The reported line is marked.
//
// Names and messages are both escaped: every word here was typed by a player.
func QuoteContext(lines []ContextLine) string {
	return Clip(renderContext(lines), limitFieldValue)
}

// FitContext is QuoteContext held to budget bytes (and never more than a field
// value may hold) by dropping whole lines rather than clipping text: the line
// farthest from the reported one goes first, and on a tie the line after it,
// since what the message answered matters more than what answered it. The
// reported line is the last to go; only when it alone is over budget is it
// clipped.
func FitContext(lines []ContextLine, budget int) string {
	budget = min(budget, limitFieldValue)
	if budget <= 0 {
		return ""
	}
	at := slices.IndexFunc(lines, func(l ContextLine) bool { return l.Reported })
	lo, hi := 0, len(lines) // the window kept, [lo, hi)
	for hi-lo > 1 {
		out := renderContext(lines[lo:hi])
		if len(out) <= budget {
			return out
		}
		if at < 0 || hi-1-at >= at-lo {
			hi-- // the far end after the reported line, or a tie
		} else {
			lo++
		}
	}
	return Clip(renderContext(lines[lo:hi]), budget)
}

// renderContext writes one line per message. The name is bold rather than a
// code span: Discord does not honour backslash escapes inside a code span, so
// an escaped name there shows its backslashes ("cool\_guy") and a backtick in
// it closes the span early.
func renderContext(lines []ContextLine) string {
	var b strings.Builder
	for _, l := range lines {
		marker := "  "
		if l.Reported {
			marker = "**>**"
		}
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "%s **%s:** %s", marker, EscapeMarkdown(SanitizeText(l.From)), EscapeMarkdown(SanitizeText(firstLine(l.Msg))))
	}
	return b.String()
}

// reportEmbedColor tints moderation embeds (amber). server/ has its own copy for
// the embeds it builds; this is the one this package's builders use.
const reportEmbedColor = 0xE8A33D

// maxEmbedFields is Discord's hard limit on fields in one embed.
const maxEmbedFields = 25

func firstLine(s string) string {
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return s[:i] + " …"
	}
	return s
}

// humanAge renders a report's age at the resolution a moderator cares about:
// whether it has been sitting there for minutes, hours, or days.
func humanAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}
