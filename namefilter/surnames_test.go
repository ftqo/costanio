package namefilter

import "testing"

// TestRealSurnamesAreNotSlurs: ordinary surnames that must not return NameSlur,
// which rejects the name and locks the account until a moderator lifts it.
func TestRealSurnamesAreNotSlurs(t *testing.T) {
	for _, name := range []string{
		"Coon", "Nip", "Van Dyke", "Dyke", "Wop", "Chinaman",
		"Maine Coon", "Anthony Van Dyke", "Nippy", "Coonan",
	} {
		t.Run(name, func(t *testing.T) {
			cleaned, v, word := Screen(name)
			if v != NameOK {
				t.Fatalf("Screen(%q) = %v (word %q, cleaned %q), want NameOK", name, v, word, cleaned)
			}
		})
	}
}

// TestDisguisedNamesStillScreen is the other direction: lookalike letters and
// digits must be folded, not just the literal ASCII spelling caught.
func TestDisguisedNamesStillScreen(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want Verdict
	}{
		{"zero width", "n\u200bigger", NameSlur},
		{"leet", "n1gger", NameSlur},
		{"fullwidth", "ｎｉｇｇｅｒ", NameSlur},
		{"cyrillic lookalike", "niggеr", NameSlur},
		{"combining mark", "ni\u0301gger", NameSlur},
		{"plural", "faggots", NameSlur},

		// The reserved list gets the same fold, so impersonation cannot be spelled
		// around either.
		{"cyrillic admin", "аdmin", NameReserved},
		{"leet admin", "adm1n", NameReserved},
		{"fullwidth staff", "ｓｔａｆｆ", NameReserved},

		// And ordinary names are still ordinary.
		{"plain", "Brian", NameOK},
		{"accented", "Renée", NameOK},
		{"devanagari", "नमस्ते", NameOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleaned, v, word := Screen(tt.in)
			if v != tt.want {
				t.Fatalf("Screen(%q) = %v (word %q, cleaned %q), want %v", tt.in, v, word, cleaned, tt.want)
			}
		})
	}
}
