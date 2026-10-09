package store

import (
	"errors"
	"testing"
)

func TestMigrationBackfillsDiscordIdentity(t *testing.T) {
	s := openTest(t)
	// A pre-existing Discord user (created via the still-present upsert).
	u, err := s.UpsertDiscordUser("disc-1", "Alice", "av1")
	if err != nil {
		t.Fatalf("UpsertDiscordUser: %v", err)
	}
	var n int
	err = s.db.QueryRow(
		`SELECT COUNT(*) FROM identities WHERE user_id = ? AND provider = 'discord' AND provider_id = 'disc-1'`,
		u.ID).Scan(&n)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if n != 1 {
		t.Fatalf("identities rows for discord = %d, want 1", n)
	}
}

func TestBackfillFromLegacyDiscordIDColumn(t *testing.T) {
	s := openTest(t)
	// Simulate a legacy row written before the identities table existed.
	res, err := s.db.Exec(
		`INSERT INTO users (discord_id, is_guest, name, avatar, created_at) VALUES ('legacy-9', 0, 'Bob', 'av', 100)`)
	if err != nil {
		t.Fatalf("insert legacy: %v", err)
	}
	uid, _ := res.LastInsertId()
	// Re-run the backfill statement (idempotent INSERT OR IGNORE) to mimic migration.
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO identities (user_id, provider, provider_id, name, avatar, email, linked_at)
		SELECT id, 'discord', discord_id, name, avatar, '', created_at FROM users
		WHERE discord_id IS NOT NULL AND discord_id != ''`); err != nil {
		t.Fatalf("backfill: %v", err)
	}
	var got string
	if err := s.db.QueryRow(`SELECT provider_id FROM identities WHERE user_id = ?`, uid).Scan(&got); err != nil {
		t.Fatalf("query: %v", err)
	}
	if got != "legacy-9" {
		t.Fatalf("provider_id = %q, want legacy-9", got)
	}
}

func TestUserByProviderAndList(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("disc-1", "Alice", "av1")

	got, err := s.UserByProvider("discord", "disc-1")
	if err != nil {
		t.Fatalf("UserByProvider: %v", err)
	}
	if got.ID != u.ID {
		t.Fatalf("UserByProvider id = %d, want %d", got.ID, u.ID)
	}
	if _, err := s.UserByProvider("discord", "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing provider err = %v, want ErrNotFound", err)
	}

	ids, err := s.IdentitiesForUser(u.ID)
	if err != nil {
		t.Fatalf("IdentitiesForUser: %v", err)
	}
	if len(ids) != 1 || ids[0].Provider != "discord" || ids[0].ProviderID != "disc-1" {
		t.Fatalf("identities = %+v, want one discord identity", ids)
	}
}

func TestUpsertUserCreatesThenLogsIn(t *testing.T) {
	s := openTest(t)
	u1, err := s.UpsertUser("google", "g-123", "Gwen", "gav", "gwen@example.com")
	if err != nil {
		t.Fatalf("UpsertUser create: %v", err)
	}
	if u1.IsGuest || u1.Name != "Gwen" {
		t.Fatalf("created user = %+v, want non-guest named Gwen", u1)
	}
	// Second call with the same identity logs into the same account.
	u2, err := s.UpsertUser("google", "g-123", "Gwen Renamed", "gav2", "gwen@example.com")
	if err != nil {
		t.Fatalf("UpsertUser login: %v", err)
	}
	if u2.ID != u1.ID {
		t.Fatalf("second upsert id = %d, want %d", u2.ID, u1.ID)
	}
	// users.name is not overwritten on re-login (seeded from the first provider only).
	if u2.Name != "Gwen" {
		t.Fatalf("users.name = %q, want unchanged Gwen", u2.Name)
	}
	// The identity row is refreshed.
	ids, _ := s.IdentitiesForUser(u1.ID)
	if ids[0].Name != "Gwen Renamed" || ids[0].Avatar != "gav2" {
		t.Fatalf("identity not refreshed: %+v", ids[0])
	}
}

func TestUpsertDiscordUserSetsMirror(t *testing.T) {
	s := openTest(t)
	u, err := s.UpsertDiscordUser("disc-7", "Dan", "dav")
	if err != nil {
		t.Fatalf("UpsertDiscordUser: %v", err)
	}
	if u.DiscordID != "disc-7" {
		t.Fatalf("mirror discord_id = %q, want disc-7", u.DiscordID)
	}
	got, _ := s.UserByProvider("discord", "disc-7")
	if got.ID != u.ID {
		t.Fatalf("identity not written for discord upsert")
	}
}

func TestLinkAndUnlink(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("disc-1", "Alice", "av")

	// Link Google to the same account.
	if err := s.LinkIdentity(u.ID, Identity{Provider: "google", ProviderID: "g-1", Name: "Alice G", Email: "a@e.com"}); err != nil {
		t.Fatalf("LinkIdentity: %v", err)
	}
	ids, _ := s.IdentitiesForUser(u.ID)
	if len(ids) != 2 {
		t.Fatalf("identities = %d, want 2", len(ids))
	}

	// Linking an identity owned by another account is rejected.
	other, _ := s.UpsertUser("google", "g-other", "Other", "", "")
	if err := s.LinkIdentity(u.ID, Identity{Provider: "google", ProviderID: "g-other"}); !errors.Is(err, ErrIdentityTaken) {
		t.Fatalf("link taken err = %v, want ErrIdentityTaken", err)
	}
	_ = other

	// Unlink Google: ok, Discord remains; mirror stays set.
	if err := s.UnlinkIdentity(u.ID, "google"); err != nil {
		t.Fatalf("UnlinkIdentity google: %v", err)
	}
	// Unlink Discord: that's the last identity -> rejected.
	if err := s.UnlinkIdentity(u.ID, "discord"); !errors.Is(err, ErrLastIdentity) {
		t.Fatalf("unlink last err = %v, want ErrLastIdentity", err)
	}
}

func TestUnlinkDiscordClearsMirror(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("disc-1", "Alice", "av")
	_ = s.LinkIdentity(u.ID, Identity{Provider: "google", ProviderID: "g-1"})
	if err := s.UnlinkIdentity(u.ID, "discord"); err != nil {
		t.Fatalf("UnlinkIdentity discord: %v", err)
	}
	got, _ := s.UserByID(u.ID)
	if got.DiscordID != "" {
		t.Fatalf("mirror discord_id = %q, want cleared", got.DiscordID)
	}
}

func TestMergeGuestIntoProviderPromote(t *testing.T) {
	s := openTest(t)
	g, _ := s.CreateGuest("")
	u, err := s.MergeGuestIntoProvider(g.ID, Identity{Provider: "google", ProviderID: "g-1", Name: "Gwen"})
	if err != nil {
		t.Fatalf("promote: %v", err)
	}
	if u.ID != g.ID || u.IsGuest {
		t.Fatalf("promoted user = %+v, want same id, non-guest", u)
	}
	if _, err := s.UserByProvider("google", "g-1"); err != nil {
		t.Fatalf("identity not written: %v", err)
	}
}

// If a guest already owns the identity it is merging into (existingID ==
// guestID), MergeGuestIntoProvider must not run the merge, which would delete
// the guest's only account.
func TestMergeGuestSelfMergeKeepsAccount(t *testing.T) {
	s := openTest(t)
	g, _ := s.CreateGuest("")
	id := Identity{Provider: "google", ProviderID: "g-self", Name: "Gwen"}
	// Construct the state directly: a row that is still a guest yet already
	// owns the identity. A self-merge must not delete it.
	if _, err := s.db.Exec(
		`INSERT INTO identities (user_id, provider, provider_id, name, avatar, email, linked_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		g.ID, id.Provider, id.ProviderID, id.Name, "", "", 100); err != nil {
		t.Fatalf("seed identity: %v", err)
	}

	u, err := s.MergeGuestIntoProvider(g.ID, id)
	if err != nil {
		t.Fatalf("self-merge: %v", err)
	}
	if u == nil || u.ID != g.ID {
		t.Fatalf("self-merge returned %+v, want same user %d", u, g.ID)
	}
	// The account must still exist (not destroyed by the merge branch).
	if _, err := s.UserByID(g.ID); err != nil {
		t.Fatalf("UserByID after self-merge: %v", err)
	}
}

func TestMergeGuestIntoProviderMerge(t *testing.T) {
	s := openTest(t)
	existing, _ := s.UpsertUser("google", "g-1", "Gwen", "", "")
	g, _ := s.CreateGuest("")
	// Use a different Name in the merge Identity to prove users.name is not overwritten.
	u, err := s.MergeGuestIntoProvider(g.ID, Identity{Provider: "google", ProviderID: "g-1", Name: "Provider Name"})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if u.ID != existing.ID {
		t.Fatalf("merge survivor = %d, want %d", u.ID, existing.ID)
	}
	if _, err := s.UserByID(g.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("guest not deleted: %v", err)
	}
	// Survivor's display name must not be overwritten by the OAuth provider's value.
	survivor, err := s.UserByID(existing.ID)
	if err != nil {
		t.Fatalf("UserByID survivor: %v", err)
	}
	if survivor.Name != "Gwen" {
		t.Fatalf("survivor name = %q, want unchanged %q", survivor.Name, "Gwen")
	}
}
