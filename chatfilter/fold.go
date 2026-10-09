package chatfilter

import (
	"strings"
	"unicode"
)

// Fold rewrites s into the form the wordlist is matched against, undoing
// disguises that do not change what a reader sees: zero-width characters,
// combining accents, fullwidth letters, lookalike letters, digit substitution.
//
// Four passes, in this order:
//
//  1. Drop format runes (zero-width space/joiner, soft hyphen, bidi overrides:
//     Unicode class Cf) and combining marks (Mn/Me). Both are invisible or nearly
//     so, and both split a token in two under Tokens.
//  2. Fold compatibility forms to ASCII: fullwidth Latin and fullwidth digits
//     ("ｎｉｇｇｅｒ"). The slice of NFKC that matters here, without a
//     golang.org/x/text dependency.
//  3. Lowercase.
//  4. Fold lookalikes to ASCII inside mixed runs (see below).
//
// Pass 4 must not turn genuine Cyrillic text into Latin. It works on maximal runs
// of ASCII letters, lookalikes and leet characters, and folds a run only when it
// contains an ASCII letter: "привет" is left alone, "nigg<Cyrillic е>r" folds.
// Leet characters ("0", "@") fold only between two run members, so "chink!"
// keeps its boundary.
func Fold(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Cf, r), unicode.Is(unicode.Mn, r), unicode.Is(unicode.Me, r):
			// drop: invisible, and a token boundary under Tokens.
		case r >= 0xFF01 && r <= 0xFF5E:
			b.WriteRune(r - 0xFEE0) // fullwidth ASCII block -> ASCII
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return foldRuns([]rune(b.String()))
}

// foldRuns applies the lookalike/leet fold described on Fold, run by run.
func foldRuns(rs []rune) string {
	var b strings.Builder
	b.Grow(len(rs))
	for i := 0; i < len(rs); {
		if !runMember(rs[i]) {
			b.WriteRune(rs[i])
			i++
			continue
		}
		j := i
		ascii := false
		for j < len(rs) && runMember(rs[j]) {
			if isASCIILetter(rs[j]) {
				ascii = true
			}
			j++
		}
		for k := i; k < j; k++ {
			b.WriteRune(foldRune(rs, k, i, j, ascii))
		}
		i = j
	}
	return b.String()
}

// foldRune decides the fate of one rune inside the run rs[start:end]. ascii says
// whether that run holds an ASCII letter; a pure Cyrillic run is not folded.
func foldRune(rs []rune, k, start, end int, ascii bool) rune {
	if !ascii {
		return rs[k]
	}
	if to, ok := lookalikes[rs[k]]; ok {
		return to
	}
	to, ok := leet[rs[k]]
	if !ok {
		return rs[k]
	}
	// Interior only: a leet character is not a letter, so folding one at the edge
	// of a run would swallow the word boundary ("chink!" -> "chinki").
	if k == start || k == end-1 {
		return rs[k]
	}
	return to
}

func isASCIILetter(r rune) bool { return r >= 'a' && r <= 'z' }

func runMember(r rune) bool {
	if isASCIILetter(r) {
		return true
	}
	_, ok := lookalikes[r]
	if ok {
		return true
	}
	_, ok = leet[r]
	return ok
}

// lookalikes maps letters that render as an ASCII letter in a chat font. Only
// strong lookalikes are listed, to avoid false positives. Keys are lowercase
// (Fold lowercases first).
var lookalikes = map[rune]rune{
	// Cyrillic
	'а': 'a', 'в': 'b', 'е': 'e', 'ѕ': 's', 'і': 'i', 'ј': 'j', 'к': 'k',
	'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y',
	'х': 'x', 'ԁ': 'd', 'ԛ': 'q', 'ѡ': 'w',
	// Greek
	'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v',
	'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'γ': 'y',
	// Latin variants
	'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ɡ': 'g',
}

// leet maps the digit and symbol substitutions people actually type. Folded only
// between two run members (see foldRune), so ordinary text keeps its boundaries.
var leet = map[rune]rune{
	'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
	'6': 'g', '7': 't', '8': 'b', '9': 'g',
	'@': 'a', '$': 's', '!': 'i', '|': 'l',
}
