package chatfilter

import "testing"

// TestMatchSeesThroughEvasion is the bypass table: each disguise must still be
// caught after normalization.
func TestMatchSeesThroughEvasion(t *testing.T) {
	tests := []struct {
		name string
		msg  string
		want string
	}{
		// Invisible characters splitting the token.
		{"zero-width space", "n\u200bigger", "nigger"},
		{"zero-width joiner", "n\u200digger", "nigger"},
		{"zero-width non-joiner", "nig\u200cger", "nigger"},
		{"soft hyphen", "n\u00adigger", "nigger"},
		{"byte order mark", "nig\ufeffger", "nigger"},
		{"combining acute", "ni\u0301gger", "nigger"},
		{"several at once", "n\u200big\u0301\u00adger", "nigger"},

		// Digits standing in for letters.
		{"digit one", "n1gger", "nigger"},
		{"digit six", "ni66er", "nigger"},
		{"digit zero", "fagg0t", "faggot"},
		{"mixed leet", "n1gg3r", "nigger"},
		{"leet uppercase", "N1GG3R", "nigger"},
		{"at sign", "f@ggot", "faggot"},

		// Compatibility and lookalike letters.
		{"fullwidth", "ｎｉｇｇｅｒ", "nigger"},
		{"fullwidth mixed case", "Ｃｈｉｎｋ", "chink"},
		{"cyrillic e", "niggеr", "nigger"},
		{"cyrillic o and c", "gооk", "gook"},
		{"greek omicron", "gοοk", "gook"},
		{"dotless i", "chınk", "chink"},

		// Doubling and plurals.
		{"stretched", "niiiigger", "nigger"},
		{"tripled consonant", "niggger", "nigger"},
		{"plural", "faggots", "faggot"},
		{"plural with z", "faggotz", "faggot"},
		{"plural leet", "k1kes", "kike"},

		// In a sentence, and combined with the boundary rules the filter already had.
		{"in a sentence", "wow you are a n\u200bigger", "nigger"},
		{"beside han", "你好n1gger你好", "nigger"},

		// The ambiguous tier still fires when it is aimed at someone, disguised or not.
		{"epithet", "you are a fag", "fag"},
		{"epithet leet", "u r a sp1c", "spic"},
		{"epithet contracted", "ur a retard", "retard"},
		{"epithet zero-width", "you're a d\u200byke", "dyke"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			word, hit := Match(tt.msg)
			if !hit {
				t.Fatalf("Match(%q) missed; want %q", tt.msg, tt.want)
			}
			if word != tt.want {
				t.Fatalf("Match(%q) = %q, want %q", tt.msg, word, tt.want)
			}
		})
	}
}

// TestMatchLeavesOrdinaryEnglishAlone is the false-positive table: ordinary
// English and surnames (which reach the filter through namefilter) must be
// clean.
func TestMatchLeavesOrdinaryEnglishAlone(t *testing.T) {
	clean := []string{
		// Terms that are also ordinary English, used ordinarily.
		"nip it in the bud",
		"nippy out today",
		"my cat is a maine coon",
		"your maine coon is lovely",
		"spic and span after that trade",
		"can i bum a fag",
		"the dyke held the flood back",
		"a wop bop a loo bop a lop bam boom",
		"he bowls chinaman",
		"that play was retard",
		"i nipped out for a fag break",
		"coon cheese used to be a brand",

		// Surnames, which reach the filter through namefilter.
		"Coon", "Nip", "Van Dyke", "Dyke", "Wop",

		// Scunthorpe: an innocent word containing a listed term.
		"he let out a snigger",
		"a chinkapin tree",

		// Ordinary chat.
		"good game everyone, well played",
		"trade 2 wood for 1 brick?",
		"",
	}
	for _, msg := range clean {
		t.Run(msg, func(t *testing.T) {
			if word, hit := Match(msg); hit {
				t.Fatalf("Match(%q) flagged %q, want no match", msg, word)
			}
		})
	}
}

// TestMatchKnownGaps pins evasions the filter does not chase, because they would
// cost more in false positives than they catch: spaced-out letters ("chin k"
// appears in ordinary text) and whole-word transliteration into another script.
// Both are left to human reports.
func TestMatchKnownGaps(t *testing.T) {
	for _, msg := range []string{"n i g g e r", "никкер", "ниггер"} {
		if _, hit := Match(msg); hit {
			t.Fatalf("Match(%q) hit; known gap closed, update this test", msg)
		}
	}
}

// TestAddressed covers the epithet gate directly: the ambiguous tier fires on
// direct address and nothing else.
func TestAddressed(t *testing.T) {
	tests := []struct {
		msg  string
		want bool
	}{
		{"you are a coon", true},
		{"you're a coon", true},
		{"u r a coon", true},
		{"ur a coon", true},
		{"you fucking coon", true},
		{"you coon", true},
		{"my cat is a maine coon", false},
		{"the coon ate the bins", false},
		{"coon", false},
		{"is a coon", false},       // no pronoun behind the copula
		{"they are a coon", false}, // not second person
	}
	for _, tt := range tests {
		t.Run(tt.msg, func(t *testing.T) {
			_, hit := Match(tt.msg)
			if hit != tt.want {
				t.Fatalf("Match(%q) hit = %v, want %v", tt.msg, hit, tt.want)
			}
		})
	}
}

// TestFoldLeavesNonLatinAlone: only a run that contains an ASCII letter folds,
// so genuine Cyrillic and Greek are left alone.
func TestFoldLeavesNonLatinAlone(t *testing.T) {
	for _, s := range []string{"привет всем хорошая игра", "καλημέρα", "спасибо", "你好"} {
		if got := Fold(s); got != s {
			t.Fatalf("Fold(%q) = %q, want it untouched", s, got)
		}
	}
	// A run with an ASCII letter in it is a disguise, and folds.
	if got := Fold("niggеr"); got != "nigger" {
		t.Fatalf("Fold(cyrillic e) = %q, want %q", got, "nigger")
	}
	// A leet character at the edge of a run keeps its boundary, so a trailing
	// "chink!" stays a whole word instead of folding into "chinki".
	if got := Fold("chink!"); got != "chink!" {
		t.Fatalf("Fold(%q) = %q, want it untouched", "chink!", got)
	}
	if got := Fold("2020"); got != "2020" {
		t.Fatalf("Fold(%q) = %q, want it untouched", "2020", got)
	}
}
