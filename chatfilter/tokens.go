package chatfilter

import "unicode"

// Tokens splits s into whole-word tokens for wordlist matching. It is the single
// tokenizer shared by chatfilter and namefilter, so both agree on what a "word" is.
//
// Two things end a token:
//
//  1. Any non-letter rune (space, digit, punctuation, emoji). This makes matching
//     whole-word: a word containing a listed term as a substring never yields
//     that term as a token.
//
//  2. A transition between writing systems (Latin to Han, kana, Hangul,
//     Cyrillic, and so on). CJK text has no spaces, so without this "你好chink你好"
//     would be one token and match nothing.
//
// A Latin run still matches only if the whole run is a listed term; no substring
// matching is introduced.
//
// Combining marks (Unicode class M) count as letters so they attach to the run
// rather than splitting it (unicode.IsLetter is false for them). Otherwise
// "ni<combining acute>gger" would be three tokens, and Devanagari, Hebrew and
// Vietnamese text would fragment. Other script-neutral letters attach the same
// way, via scrNeutral.
func Tokens(s string) []string {
	var out []string
	start, cur := -1, scrNeutral // start < 0 means "between tokens"
	for i, r := range s {
		if !unicode.IsLetter(r) && !unicode.Is(unicode.M, r) {
			if start >= 0 {
				out = append(out, s[start:i])
				start, cur = -1, scrNeutral
			}
			continue
		}
		if start < 0 && unicode.Is(unicode.M, r) {
			continue // a mark with nothing to attach to opens no token.
		}
		sc := scriptOf(r)
		switch {
		case start < 0:
			start, cur = i, sc
		case sc == scrNeutral || sc == cur:
			// Same script, or script-neutral: the run continues.
		case cur == scrNeutral:
			cur = sc // run opened on neutral runes; adopt the first real script.
		default:
			out = append(out, s[start:i])
			start, cur = i, sc
		}
	}
	if start >= 0 {
		out = append(out, s[start:])
	}
	return out
}

// script identifies a writing system for boundary purposes. scrNeutral covers every
// letter that belongs to no listed script; such runes never open or close a token.
type script uint8

const scrNeutral script = 0

// scripts lists the writing systems we split on. It need not be exhaustive: an
// unlisted script reads as neutral, and since every wordlist entry is ASCII,
// enforcement only needs Latin runs isolated from non-Latin ones.
var scripts = []*unicode.RangeTable{
	unicode.Latin,
	unicode.Han,
	unicode.Hiragana,
	unicode.Katakana,
	unicode.Hangul,
	unicode.Cyrillic,
	unicode.Greek,
	unicode.Arabic,
	unicode.Hebrew,
	unicode.Devanagari,
	unicode.Thai,
	unicode.Armenian,
	unicode.Georgian,
	unicode.Bengali,
	unicode.Tamil,
	unicode.Ethiopic,
	unicode.Cherokee,
}

// scriptOf classifies a letter rune. ASCII letters take a fast path.
func scriptOf(r rune) script {
	if r < unicode.MaxASCII {
		return 1 // Latin: index 0 in scripts, +1 to clear scrNeutral.
	}
	for i, t := range scripts {
		if unicode.Is(t, r) {
			return script(i + 1)
		}
	}
	return scrNeutral
}
