package namefilter

import "testing"

func TestScreen(t *testing.T) {
	// A real chatfilter wordlist entry, mirroring chatfilter's own test.
	const slur = "chink"

	tests := []struct {
		name        string
		in          string
		wantClean   string
		wantVerdict Verdict
		wantWord    string
	}{
		{"ordinary name", "Steve", "Steve", NameOK, ""},
		{"trims and collapses whitespace", "  Big   Steve \t", "Big Steve", NameOK, ""},
		{"digits and punctuation ok", "xX_Steve_99", "xX_Steve_99", NameOK, ""},
		{"empty", "", "", NameEmpty, ""},
		{"whitespace only", "   \t  ", "", NameEmpty, ""},
		// Zero-width + bidi override runes are stripped; if nothing graphic remains,
		// it's empty.
		{"zero-width only", "\u200b\u200c\u200d", "", NameEmpty, ""},
		{"strips zero-width inside name", "St\u200beve", "Steve", NameOK, ""},
		{"strips RTL override", "\u202eSteve", "Steve", NameOK, ""},
		// Reserved impersonation names (reject, no lock).
		{"reserved admin", "Admin", "Admin", NameReserved, ""},
		{"reserved moderator", "moderator", "moderator", NameReserved, ""},
		{"reserved with digits", "admin123", "admin123", NameReserved, ""},
		{"reserved costan.io tokenized", "costan.io", "costan.io", NameReserved, ""},
		{"reserved costanio", "costanio", "costanio", NameReserved, ""},
		// Scunthorpe-safe: reserved word as a substring of a longer word is fine.
		{"adminia not reserved", "Adminia", "Adminia", NameOK, ""},
		{"modest not reserved", "Modest", "Modest", NameOK, ""},
		// Slurs (reject AND lock).
		{"exact slur", slur, slur, NameSlur, slur},
		{"slur uppercase", "CHINK", "CHINK", NameSlur, slur},
		{"slur in name", "the " + slur + " lord", "the " + slur + " lord", NameSlur, slur},
		// Scunthorpe-safe for slurs too.
		{"slur substring not a word", "chinkapin", "chinkapin", NameOK, ""},

		// namefilter inherits chatfilter's tokenizer, so a script transition ends a
		// token here too: a slur glued to CJK/Cyrillic no longer hides in one token.
		{"slur behind han", "你好" + slur, "你好" + slur, NameSlur, slur},
		{"slur behind hiragana", "こんにちは" + slur, "こんにちは" + slur, NameSlur, slur},
		{"slur behind hangul", "안녕" + slur, "안녕" + slur, NameSlur, slur},
		{"slur behind cyrillic", "привет" + slur, "привет" + slur, NameSlur, slur},
		// Reserved words hide the same way, and are caught the same way.
		{"reserved behind han", "你好admin", "你好admin", NameReserved, ""},
		{"reserved behind hangul", "안녕staff", "안녕staff", NameReserved, ""},

		// Clean non-Latin and mixed-script names stay acceptable.
		{"pure han name", "小明", "小明", NameOK, ""},
		{"pure japanese name", "たろう", "たろう", NameOK, ""},
		{"pure hangul name", "민준", "민준", NameOK, ""},
		{"mixed script name", "Steve 你好", "Steve 你好", NameOK, ""},
		// Scunthorpe holds across the boundary: the Latin run must match in full.
		{"slur substring behind han", "你好chinkapin", "你好chinkapin", NameOK, ""},
		{"reserved substring behind han", "你好adminia", "你好adminia", NameOK, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clean, v, word := Screen(tt.in)
			if clean != tt.wantClean {
				t.Errorf("Screen(%q) clean = %q, want %q", tt.in, clean, tt.wantClean)
			}
			if v != tt.wantVerdict {
				t.Errorf("Screen(%q) verdict = %d, want %d", tt.in, v, tt.wantVerdict)
			}
			if word != tt.wantWord {
				t.Errorf("Screen(%q) word = %q, want %q", tt.in, word, tt.wantWord)
			}
		})
	}
}
