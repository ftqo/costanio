package chatfilter

import "testing"

func TestMatch(t *testing.T) {
	// Pick two entries that are actually in the wordlist so the test exercises
	// real data, not a fixture.
	const slur1 = "chink" // anti-Chinese slur
	const slur2 = "nigger"

	tests := []struct {
		name    string
		msg     string
		wantHit bool
		wantErr string // expected matched word when wantHit; ignored otherwise
	}{
		{"clean sentence", "good game everyone, well played", false, ""},
		{"empty", "", false, ""},
		{"exact slur", slur1, true, slur1},
		{"uppercase", "CHINK", true, slur1},
		{"mixed case", "ChInK", true, slur1},
		{"leading punctuation", "!chink", true, slur1},
		{"trailing punctuation", "chink!", true, slur1},
		{"embedded in sentence", "you are a chink lol", true, slur1},
		{"comma bounded", "wood,chink,ore", true, slur1},
		{"second slur", "what a nigger move", true, slur2},
		// Scunthorpe problem: innocent words that merely contain a slur substring
		// must not trigger. "snigger" contains "nigger"; whole-word matching skips it.
		{"substring not a word (snigger)", "he let out a snigger", false, ""},
		{"substring not a word (chinkapin)", "a chinkapin tree", false, ""},

		// Script-boundary bypass: CJK has no spaces and every CJK character is a
		// letter, so a slur glued to one must still be its own token.
		{"han adjacent both sides", "你好" + slur1 + "你好", true, slur1},
		{"han adjacent leading", "你好" + slur1, true, slur1},
		{"han adjacent trailing", slur1 + "你好", true, slur1},
		{"hiragana adjacent", "こんにちは" + slur1 + "こんにちは", true, slur1},
		{"katakana adjacent", "カタカナ" + slur2 + "カタカナ", true, slur2},
		{"mixed japanese adjacent", "日本語です" + slur1 + "ね", true, slur1},
		{"hangul adjacent", "안녕하세요" + slur1 + "안녕", true, slur1},
		{"cyrillic adjacent", "привет" + slur1 + "пока", true, slur1},
		{"greek adjacent", "καλημέρα" + slur1, true, slur1},
		{"uppercase across script boundary", "你好CHINK你好", true, slur1},

		// Pure non-Latin text carries no listed term and must stay clean. CJK
		// profanity is out of scope (see Tokens): there are no word boundaries.
		{"pure han clean", "你好，今天天气很好，我们一起玩吧", false, ""},
		{"pure japanese clean", "こんにちは、ゲームを始めましょう", false, ""},
		{"pure hangul clean", "안녕하세요 좋은 게임이었습니다", false, ""},
		{"pure cyrillic clean", "привет всем хорошая игра", false, ""},
		{"long katakana word clean", "ハンバーガーとコーヒー", false, ""},

		// Innocuous mixed-script chat.
		{"mixed script innocuous", "gg 你好 well played", false, ""},
		{"latin glued to han innocuous", "日本語good game", false, ""},
		{"emoji and han", "你好👋 nice trade", false, ""},

		// Scunthorpe still holds across a script boundary: splitting at the
		// transition must not turn into substring matching inside a Latin run.
		{"scunthorpe across boundary", "你好chinkapin你好", false, ""},
		{"scunthorpe across boundary 2", "他说snigger了", false, ""},
		{"scunthorpe hangul boundary", "안녕chinkapin", false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			word, hit := Match(tt.msg)
			if hit != tt.wantHit {
				t.Fatalf("Match(%q) hit = %v, want %v (word=%q)", tt.msg, hit, tt.wantHit, word)
			}
			if hit && word != tt.wantErr {
				t.Fatalf("Match(%q) word = %q, want %q", tt.msg, word, tt.wantErr)
			}
		})
	}
}
