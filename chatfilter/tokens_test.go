package chatfilter

import (
	"slices"
	"testing"
)

func TestTokens(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"empty", "", nil},
		{"no letters", "123 !!! 4.5", nil},
		{"plain sentence", "good game everyone", []string{"good", "game", "everyone"}},
		{"punctuation splits", "wood,ore,brick", []string{"wood", "ore", "brick"}},
		{"digits split", "player1two", []string{"player", "two"}},
		{"apostrophe splits", "don't", []string{"don", "t"}},

		// Script transitions are boundaries, just like a space.
		{"latin to han", "你好chink你好", []string{"你好", "chink", "你好"}},
		{"latin to hiragana", "はいok", []string{"はい", "ok"}},
		{"latin to katakana", "okカタカナ", []string{"ok", "カタカナ"}},
		{"latin to hangul", "안녕gg", []string{"안녕", "gg"}},
		{"latin to cyrillic", "приветgg", []string{"привет", "gg"}},
		{"latin to greek", "ggκαλά", []string{"gg", "καλά"}},
		{"han to kana", "日本語です", []string{"日本語", "です"}},
		{"kana to kana", "テストです", []string{"テスト", "です"}},

		// Script-neutral letters (the CJK prolonged sound mark) join the run in
		// progress rather than shredding it.
		{"prolonged sound mark", "コーヒー", []string{"コーヒー"}},

		// A whole Latin run stays one token, which is what keeps matching
		// whole-word: "chinkapin" never yields "chink".
		{"latin run intact across boundary", "你好chinkapin", []string{"你好", "chinkapin"}},

		// Combining marks continue the run (unicode.IsLetter(U+0301) is false).
		{"combining acute joins run", "ni\u0301gger", []string{"ni\u0301gger"}},
		{"devanagari intact", "नमस्ते दुनिया", []string{"नमस्ते", "दुनिया"}},
		{"hebrew with points intact", "שָׁלוֹם", []string{"שָׁלוֹם"}},
		{"vietnamese decomposed intact", "vie\u0323\u0302t", []string{"vie\u0323\u0302t"}},
		{"leading mark opens no token", "\u0301abc", []string{"abc"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Tokens(tt.in); !slices.Equal(got, tt.want) {
				t.Fatalf("Tokens(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
