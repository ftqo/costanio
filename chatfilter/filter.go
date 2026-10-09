// Package chatfilter is a slur filter for in-game chat. It matches a fixed
// wordlist as whole words, case-insensitively, after a normalization pass that
// sees through the usual disguises (zero-width characters, combining marks,
// fullwidth and lookalike letters, digit substitution, doubled letters, plurals).
//
// A hit is not a ban: it drops the message and opens a report for a moderator.
// Determined evaders get past any filter, so automatic penalties would fall
// mostly on false positives.
//
// The wordlist is compiled in (see wordlist.go): it changes rarely, matching
// stays allocation-light, and changes are reviewed in git.
package chatfilter

import (
	"slices"
	"strings"
)

// banned and ambiguous are the two wordlist tiers as sets for O(1) lookup, built
// once at init.
var (
	banned    = set(bannedWords)
	ambiguous = set(ambiguousWords)
)

func set(words []string) map[string]struct{} {
	m := make(map[string]struct{}, len(words))
	for _, w := range words {
		m[strings.ToLower(w)] = struct{}{}
	}
	return m
}

// Match reports the first listed slur a message uses, or hit=false for a clean
// message. word is the canonical wordlist entry, not the spelling that matched,
// so a report says "nigger" whether the sender typed "n1gger" or "ｎｉｇｇｅｒ".
//
// Matching is whole-word (boundaries are non-letter characters and script
// transitions, see Tokens), so a word containing a listed term as a substring
// does not match. In addition:
//
//   - The message is scanned twice, raw and folded (see Fold). The raw pass keeps
//     boundaries a fold can blur ("chink1"); the folded pass catches the
//     disguises ("n<zero-width space>igger", "ni66er", "ｎｉｇｇｅｒ", "nigg<Cyrillic е>r").
//   - Each token is also tried with tripled letters collapsed and with a plural
//     suffix removed, so "niiiigger" and "faggots" are the words they obviously are.
//   - Terms that are also ordinary English (ambiguousWords) match only when used
//     as a direct epithet, so "spic and span" and "he bowls chinaman" are clean.
//
// A hit drops the message and opens a report.
func Match(msg string) (word string, hit bool) {
	if w, ok := scan(Tokens(msg)); ok {
		return w, true
	}
	folded := Fold(msg)
	if folded == msg {
		return "", false
	}
	return scan(Tokens(folded))
}

// scan walks tokens in order and returns the first listed term.
func scan(tokens []string) (string, bool) {
	for i, tok := range tokens {
		lower := strings.ToLower(tok)
		if len(lower) < 3 {
			continue // no listed term is shorter, and short tokens are the noisy ones.
		}
		for _, form := range forms(lower) {
			if _, ok := banned[form]; ok {
				return form, true
			}
			if _, ok := ambiguous[form]; ok && addressed(tokens, i) {
				return form, true
			}
		}
	}
	return "", false
}

// forms yields the spellings of tok to look up: the token itself, the token with
// runs of three or more identical letters collapsed (to two, then to one), and
// each of those with a plural suffix trimmed. Only runs of three or more are
// collapsed, so "Niger" and "nigger" stay distinct.
func forms(tok string) []string {
	out := make([]string, 0, 9)
	add := func(s string) {
		if !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	for _, base := range []string{tok, collapse(tok, 2), collapse(tok, 1)} {
		add(base)
		for _, stem := range depluralize(base) {
			add(stem)
		}
	}
	return out
}

// collapse rewrites every run of three or more identical runes to n of them.
func collapse(s string, n int) string {
	rs := []rune(s)
	if !hasRun(rs) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(rs); {
		j := i
		for j < len(rs) && rs[j] == rs[i] {
			j++
		}
		reps := j - i
		if reps >= 3 {
			reps = n
		}
		for range reps {
			b.WriteRune(rs[i])
		}
		i = j
	}
	return b.String()
}

// hasRun reports whether rs contains a run of three or more identical runes,
// which is the only thing collapse would rewrite.
func hasRun(rs []rune) bool {
	for i := 2; i < len(rs); i++ {
		if rs[i] == rs[i-1] && rs[i-1] == rs[i-2] {
			return true
		}
	}
	return false
}

// depluralize yields the stems of s with a trailing plural marker trimmed,
// leaving at least three runes so a short listed term is still reachable ("fags"
// -> "fag"). Every suffix is tried rather than the first that fits, because they
// overlap: "kikes" stems to "kike" by "s" and to "kik" by "es", and only one of
// those is a word.
func depluralize(s string) []string {
	var out []string
	for _, suf := range []string{"s", "es", "z"} {
		if len(s) >= len(suf)+3 && strings.HasSuffix(s, suf) {
			out = append(out, s[:len(s)-len(suf)])
		}
	}
	return out
}

// addressed reports whether tokens[i] is used as a direct epithet: reading
// backwards past articles and intensifiers, the message says "you are a ...".
// This is the only gate on ambiguousWords: it separates "you're a coon" from
// "my cat is a maine coon".
//
// It misses the bare vocative ("fucking dyke"), which the preceding tokens
// cannot distinguish from an innocent use; that is left to human reports.
func addressed(tokens []string, i int) bool {
	j := i - 1
	for j >= 0 && skippable[strings.ToLower(tokens[j])] {
		j--
	}
	if j < 0 {
		return false
	}
	prev := strings.ToLower(tokens[j])
	if secondPerson[prev] {
		return true
	}
	if copula[prev] && j > 0 {
		return secondPerson[strings.ToLower(tokens[j-1])]
	}
	return false
}

var (
	// skippable words sit between the pronoun and the epithet without changing
	// who is being addressed.
	// The contraction tails ("re", "s", "m", "ve", "ll") are here because Tokens
	// splits on the apostrophe, so "you're a ..." arrives as you / re / a / ... .
	skippable = words("a", "an", "the", "such", "some", "fucking", "fuckin", "damn",
		"stupid", "dumb", "little", "absolute", "total", "complete", "bloody",
		"re", "s", "m", "ve", "ll")
	secondPerson = words("you", "u", "ya", "yall", "youre", "ur", "yer", "thou")
	copula       = words("are", "is", "am", "was", "were", "r", "be", "being")
)

func words(ws ...string) map[string]bool {
	m := make(map[string]bool, len(ws))
	for _, w := range ws {
		m[w] = true
	}
	return m
}
