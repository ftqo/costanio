package auth

import (
	"fmt"
	"strings"
)

// discordAvatarURL builds a CDN URL for a Discord user's custom avatar, or ""
// when they have none (an empty hash), so the UI can fall back to its colour
// disc. Discord's identify endpoint returns only the hash; normalising here
// means the store holds a real URL.
//
// Animated avatars (hash prefixed "a_") are served as .gif; ?size=128 suits the
// UI's 32 to 72px renders.
func discordAvatarURL(discordID, hash string) string {
	if discordID == "" || hash == "" {
		return ""
	}
	ext := "png"
	if strings.HasPrefix(hash, "a_") {
		ext = "gif"
	}
	return fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.%s?size=128", discordID, hash, ext)
}
