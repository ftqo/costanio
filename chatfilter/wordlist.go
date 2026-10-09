package chatfilter

// The enforcement list, in two tiers. A hit on either one drops the message and
// opens a report for a human (see Match); neither tier bans anybody by itself.
//
// Rules for both lists:
//   - lowercase ASCII, single tokens only (matching is case-folded and
//     normalization-folded, so spelling variants do not belong here).
//   - identity-based slurs (racial, ethnic, homophobic, etc.). Not exhaustive:
//     this is a safety net in front of the human report flow.
//
// Editing either list requires a rebuild (see chatfilter/filter.go).

// bannedWords are terms with no ordinary English reading, so a whole-word hit is
// enough on its own.
var bannedWords = []string{
	// Racial / ethnic slurs.
	"nigger",
	"nigga",
	"chink",
	"gook",
	"wetback",
	"kike",
	"raghead",
	"sandnigger",
	"beaner",
	// Homophobic / transphobic slurs.
	"faggot",
	"tranny",
}

// "chink" stays in this tier although "a chink of light" flags: in game chat it
// is overwhelmingly the slur. The tokenizer tests use it ("chinkapin",
// "你好chink你好"); move those fixtures if it is ever demoted.

// ambiguousWords are slurs that are also ordinary English words, surnames, or
// terms of art, so a bare occurrence proves nothing. They match only when used as
// a direct epithet ("you are a ...", see addressed).
//
// Each has innocent uses: "my cat is a maine coon", "spic and span", "can I bum
// a fag", "the dyke held the flood back" (and the surname Van Dyke), "he bowls
// chinaman" (cricket), the surname Coon.
var ambiguousWords = []string{
	"coon",
	"spic",
	"fag",
	"dyke",
	"chinaman",
	"retard",
}

// Not listed: "nip" ("nip it in the bud", the surname Nip) and "wop" ("a wop
// bop a loo bop"). Too common in ordinary English even with the epithet gate;
// left to human reports.
