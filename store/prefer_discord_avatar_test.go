package store

import "testing"

// avatarOf reads the displayed users.avatar (the field seats/profiles render).
func avatarOf(t *testing.T, s *Store, userID int64) string {
	t.Helper()
	u, err := s.UserByID(userID)
	if err != nil {
		t.Fatalf("UserByID(%d): %v", userID, err)
	}
	return u.Avatar
}

// The displayed avatar must track the current Discord avatar across logins,
// rather than staying frozen at the value captured when the account was created.
func TestDiscordLoginRefreshesDisplayAvatar(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("disc-1", "Alice", "dav1")
	if got := avatarOf(t, s, u.ID); got != "dav1" {
		t.Fatalf("after create avatar = %q, want dav1", got)
	}
	// Logging in again with a new Discord avatar refreshes the displayed one.
	if _, err := s.UpsertDiscordUser("disc-1", "Alice", "dav2"); err != nil {
		t.Fatalf("re-login: %v", err)
	}
	if got := avatarOf(t, s, u.ID); got != "dav2" {
		t.Fatalf("after re-login avatar = %q, want dav2", got)
	}
}

// A Google-only account (no Discord identity) still gets its displayed avatar
// refreshed from the provider it logs in with.
func TestGoogleOnlyLoginRefreshesDisplayAvatar(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertUser("google", "g-1", "Gwen", "gav1", "")
	if _, err := s.UpsertUser("google", "g-1", "Gwen", "gav2", ""); err != nil {
		t.Fatalf("re-login: %v", err)
	}
	if got := avatarOf(t, s, u.ID); got != "gav2" {
		t.Fatalf("google-only avatar = %q, want gav2", got)
	}
}

// The core preference: an account with both Discord and Google identities shows
// the Discord avatar even when the user logs in via Google.
func TestPrefersDiscordAvatarOnGoogleLogin(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("disc-2", "Bob", "dav1")
	if err := s.LinkIdentity(u.ID, Identity{Provider: "google", ProviderID: "g-2", Avatar: "gav1"}); err != nil {
		t.Fatalf("LinkIdentity: %v", err)
	}
	// Log in via Google with a fresh Google avatar.
	if _, err := s.UpsertUser("google", "g-2", "Bob", "gav2", ""); err != nil {
		t.Fatalf("google login: %v", err)
	}
	if got := avatarOf(t, s, u.ID); got != "dav1" {
		t.Fatalf("avatar = %q, want dav1", got)
	}
}

// Linking a Discord identity to an existing Google account immediately switches
// the displayed avatar to the Discord one.
func TestLinkingDiscordSwitchesDisplayAvatar(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertUser("google", "g-3", "Eve", "gav", "")
	if got := avatarOf(t, s, u.ID); got != "gav" {
		t.Fatalf("pre-link avatar = %q, want gav", got)
	}
	if err := s.LinkIdentity(u.ID, Identity{Provider: "discord", ProviderID: "disc-3", Avatar: "dav"}); err != nil {
		t.Fatalf("LinkIdentity discord: %v", err)
	}
	if got := avatarOf(t, s, u.ID); got != "dav" {
		t.Fatalf("post-link avatar = %q, want dav", got)
	}
}

// An empty incoming Discord avatar must not blank a good displayed avatar.
func TestEmptyDiscordAvatarDoesNotBlankDisplay(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("disc-4", "Cara", "dav")
	if _, err := s.UpsertDiscordUser("disc-4", "Cara", ""); err != nil {
		t.Fatalf("re-login empty: %v", err)
	}
	if got := avatarOf(t, s, u.ID); got != "dav" {
		t.Fatalf("avatar = %q, want dav", got)
	}
}

// Unlinking Discord falls the displayed avatar back to a remaining identity
// rather than leaving the removed Discord avatar on display.
func TestUnlinkDiscordAvatarFallback(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("disc-5", "Finn", "dav")
	if err := s.LinkIdentity(u.ID, Identity{Provider: "google", ProviderID: "g-5", Avatar: "gav"}); err != nil {
		t.Fatalf("LinkIdentity: %v", err)
	}
	if got := avatarOf(t, s, u.ID); got != "dav" {
		t.Fatalf("pre-unlink avatar = %q, want dav", got)
	}
	if err := s.UnlinkIdentity(u.ID, "discord"); err != nil {
		t.Fatalf("UnlinkIdentity: %v", err)
	}
	if got := avatarOf(t, s, u.ID); got != "gav" {
		t.Fatalf("post-unlink avatar = %q, want fallback gav", got)
	}
}

// Merging a Discord account into a Google-only survivor adopts the Discord
// avatar immediately (before any subsequent login).
func TestMergeAdoptsDiscordAvatar(t *testing.T) {
	s := openTest(t)
	surv, _ := s.UpsertUser("google", "g-6", "Survivor", "gav", "")
	vic, _ := s.UpsertDiscordUser("disc-6", "Victim", "dav")
	if err := s.MergeAccounts(surv.ID, vic.ID); err != nil {
		t.Fatalf("MergeAccounts: %v", err)
	}
	if got := avatarOf(t, s, surv.ID); got != "dav" {
		t.Fatalf("merged survivor avatar = %q, want adopted Discord dav", got)
	}
}
