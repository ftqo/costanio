// Package namefilter screens user-chosen display names: it strips control and
// formatting characters (zero-width joiners, bidi overrides used for spoofing),
// rejects reserved impersonation names, and uses chatfilter to catch slurs. The
// seat-name and account-name endpoints and the OAuth import path all use it.
//
// Matching is against compile-time lists on whole words, which avoids the
// Scunthorpe problem; leetspeak and homoglyph folding come from chatfilter.Fold.
package namefilter

import (
	"strings"
	"unicode"

	"github.com/ftqo/costan.io/chatfilter"
)

// Verdict classifies a screened name.
type Verdict int

const (
	// NameOK: the sanitized name is safe to store.
	NameOK Verdict = iota
	// NameEmpty: nothing left after sanitizing (all-whitespace or all-formatting).
	NameEmpty
	// NameReserved: matches a reserved impersonation word. Reject but do not lock
	// (an innocent user could pick "Staff").
	NameReserved
	// NameSlur: contains a listed slur. Reject and lock.
	//
	// The only automatic lock in moderation: a name is chosen, not typed in
	// passing, and is rejected before it exists. Terms that collide with real
	// surnames (Coon, Nip, Van Dyke) don't reach here, because chatfilter only
	// matches them in direct address.
	NameSlur
)

// reserved is the set of whole words a display name may not be, to blunt
// staff/system impersonation. Matched case-insensitively as whole alphabetic
// tokens (see Screen), so "Modest" or "Adminia" pass but "admin", "Admin_" and
// "admin123" don't. "mod" is left out: too many innocent collisions.
var reserved = map[string]struct{}{
	"admin":         {},
	"administrator": {},
	"moderator":     {},
	"staff":         {},
	"system":        {},
	"costan":        {},
	"costanio":      {},
}

// Screen sanitizes name and classifies it. cleaned is the sanitized string; when
// the verdict is NameOK it is the value to store. For NameSlur, word is the matched
// slur (for the audit log); it is empty otherwise. Callers apply a length cap to
// cleaned themselves.
func Screen(name string) (cleaned string, v Verdict, word string) {
	cleaned = sanitize(name)
	if cleaned == "" {
		return "", NameEmpty, ""
	}
	// Whole-word match on alphabetic tokens, using chatfilter's tokenizer so both
	// filters agree on what a word is: digits/punctuation and script transitions
	// delimit words, and a reserved word embedded in a longer word does not match.
	// The tokens come from chatfilter.Fold, so "Аdmin" spelled with a Cyrillic А
	// (or "adm1n") is the impersonation it looks like.
	for _, tok := range chatfilter.Tokens(chatfilter.Fold(cleaned)) {
		if _, ok := reserved[strings.ToLower(tok)]; ok {
			return cleaned, NameReserved, ""
		}
	}
	if w, hit := chatfilter.Match(cleaned); hit {
		return cleaned, NameSlur, w
	}
	return cleaned, NameOK, ""
}

// sanitize drops control and Unicode-format runes (zero-width, bidi overrides) and
// any non-graphic rune, collapses internal whitespace runs to a single space, and
// trims. This neutralizes RTL-override / zero-width display spoofing while leaving
// ordinary names untouched.
func sanitize(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range s {
		switch {
		case unicode.IsSpace(r):
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		case unicode.IsControl(r), unicode.Is(unicode.Cf, r), !unicode.IsGraphic(r):
			// drop: control chars, format chars (ZWJ/ZWNJ/bidi), non-graphics
		default:
			b.WriteRune(r)
			prevSpace = false
		}
	}
	return strings.TrimSpace(b.String())
}
