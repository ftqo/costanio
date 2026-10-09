package discord

import (
	"strings"
	"unicode/utf8"
)

// Discord's own limits on embed strings. Exceeding one is a 400 and the message
// is lost, so the builder clips.
const (
	limitTitle       = 256
	limitDescription = 4096
	limitFieldName   = 256
	limitFieldValue  = 1024
	limitFooter      = 2048
	limitAuthorName  = 256
)

// Quote renders attacker-authored text (a reported chat message) as a
// blockquote that cannot escape itself.
//
// A moderation embed shows text its subject wrote, so three things are handled:
//
//   - Markdown is escaped; otherwise a masked link like "[costan.io/moderation]
//     (https://evil.example)" could point anywhere.
//   - Every line gets its own "> " marker; otherwise text after the first
//     newline renders as ordinary embed body and can impersonate the bot.
//   - Control characters (bidi overrides) are stripped.
//
// Blank-line runs collapse and the result is clipped to Discord's description
// limit, so a message made mostly of newlines cannot push the real fields out of
// the moderator's view.
func Quote(s string) string {
	s = SanitizeText(s)
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	var lines []string
	blank := false
	for ln := range strings.SplitSeq(s, "\n") {
		ln = strings.TrimRight(ln, " \t")
		if ln == "" {
			if blank {
				continue // collapse runs of blank lines
			}
			blank = true
		} else {
			blank = false
		}
		lines = append(lines, "> "+EscapeMarkdown(ln))
		if len(lines) == 20 {
			lines = append(lines, "> …")
			break
		}
	}
	return Clip(strings.Join(lines, "\n"), limitDescription)
}

// NameMention renders a player's display name beside their Discord mention, with
// the name escaped, so a name like "**mod**" or "[click](https://evil.example)"
// cannot restyle the field. discordID may be empty, in which case only the name
// is rendered.
func NameMention(name, discordID string) string {
	name = EscapeMarkdown(SanitizeText(name))
	if discordID == "" {
		return name
	}
	return name + " (<@" + discordID + ">)"
}

// SanitizeText drops the characters that have no legitimate place in a Discord
// message and can misrepresent what is displayed: C0/C1 controls (tab and
// newline excepted) and the bidi overrides and marks, which reorder a line
// without changing its bytes.
//
// It does not drop the whole Cf class: U+200D joins emoji sequences.
func SanitizeText(s string) string {
	if !strings.ContainsFunc(s, unsafeRune) {
		return s
	}
	return strings.Map(func(r rune) rune {
		if unsafeRune(r) {
			return -1
		}
		return r
	}, s)
}

func unsafeRune(r rune) bool {
	switch {
	case r == '\n', r == '\t':
		return false
	case r < 0x20, r == 0x7F, r >= 0x80 && r <= 0x9F:
		return true // C0 and C1 controls
	case r >= 0x202A && r <= 0x202E, r >= 0x2066 && r <= 0x2069, r == 0x200E, r == 0x200F:
		return true // bidi overrides, isolates, and marks
	}
	return false
}

// Clip truncates s to at most n bytes on a rune boundary, marking the cut, so an
// oversized field cannot get the whole message rejected.
func Clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := n - len("…")
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}
