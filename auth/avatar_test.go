package auth

import "testing"

func TestDiscordAvatarURL(t *testing.T) {
	tests := []struct {
		name      string
		discordID string
		hash      string
		want      string
	}{
		{"empty hash yields no url", "123", "", ""},
		{"empty id yields no url", "", "abc", ""},
		{"static avatar is png", "123", "abc123", "https://cdn.discordapp.com/avatars/123/abc123.png?size=128"},
		{"animated avatar is gif", "123", "a_def456", "https://cdn.discordapp.com/avatars/123/a_def456.gif?size=128"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := discordAvatarURL(tt.discordID, tt.hash); got != tt.want {
				t.Errorf("discordAvatarURL(%q, %q) = %q, want %q", tt.discordID, tt.hash, got, tt.want)
			}
		})
	}
}
