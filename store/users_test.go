package store

import (
	"errors"
	"testing"
	"time"

	"github.com/ftqo/costan.io/rating"
)

func TestGuestAndDiscordUsers(t *testing.T) {
	s := openTest(t)

	g, err := s.CreateGuest("ann")
	if err != nil {
		t.Fatal(err)
	}
	if !g.IsGuest || g.Name != "ann" {
		t.Errorf("guest = %+v", g)
	}

	d1, err := s.UpsertDiscordUser("disc123", "Bob", "av1")
	if err != nil {
		t.Fatal(err)
	}
	d2, err := s.UpsertDiscordUser("disc123", "Bobby", "av2")
	if err != nil {
		t.Fatal(err)
	}
	if d1.ID != d2.ID {
		t.Errorf("upsert created new row: %d vs %d", d1.ID, d2.ID)
	}
	// Re-login returns the same user. users.name is not overwritten (seeded once
	// at creation), but the displayed avatar tracks the current Discord picture.
	if d2.Name != "Bob" {
		t.Errorf("upsert overwrote users.name: %+v", d2)
	}
	if d2.Avatar != "av2" {
		t.Errorf("upsert did not refresh displayed avatar from Discord: %+v", d2)
	}
}

func TestSessions(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")

	tok, err := s.CreateSession(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.UserBySession(tok)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != u.ID {
		t.Errorf("session resolved to %d, want %d", got.ID, u.ID)
	}

	if _, err := s.UserBySession("nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("bad token err = %v, want ErrNotFound", err)
	}

	// Expired session.
	s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`, time.Now().Add(-time.Hour).Unix(), hashSessionToken(tok))
	if _, err := s.UserBySession(tok); !errors.Is(err, ErrNotFound) {
		t.Errorf("expired token err = %v, want ErrNotFound", err)
	}

	tok2, _ := s.CreateSession(u.ID)
	if err := s.DeleteSession(tok2); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(tok2); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted token err = %v, want ErrNotFound", err)
	}
}

func TestSweepExpiredSessions(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")
	live, _ := s.CreateSession(u.ID)
	dead, _ := s.CreateSession(u.ID)

	s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`, time.Now().Add(-time.Hour).Unix(), hashSessionToken(dead))

	n, err := s.SweepExpiredSessions()
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("swept %d sessions, want 1", n)
	}
	var count int
	s.db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE token_hash = ?`, hashSessionToken(dead)).Scan(&count)
	if count != 0 {
		t.Error("expired session row not swept")
	}
	// Live session survives and still resolves.
	if _, err := s.UserBySession(live); err != nil {
		t.Errorf("live session err = %v", err)
	}
}

// TestSessionSlideClampedToMaxAge covers the branch where the new sliding expiry
// would exceed the absolute cap and is clamped to it. The session is created far
// enough in the past that now+sessionTTL > created_at+sessionMaxAge, yet still
// inside the cap so it remains valid.
//
// The stored expiry starts 1 hour from now so the clamped slide advances it
// past the slide threshold.
func TestSessionSlideClampedToMaxAge(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")
	tok, _ := s.CreateSession(u.ID)

	// created_at = now - (maxAge - 1 day): cap is ~1 day away, but a fresh slide
	// would push expiry sessionTTL (30d) out, so it must clamp to the cap.
	now := time.Now()
	createdAt := now.Add(-(sessionMaxAge - 24*time.Hour)).Unix()
	maxExpiry := createdAt + int64(sessionMaxAge.Seconds())
	// Stored expiry sits 1h out, below the cap, so the slide advances it past
	// the slide threshold and clamps to maxExpiry (~1 day away).
	s.db.Exec(`UPDATE sessions SET created_at = ?, expires_at = ? WHERE token_hash = ?`,
		createdAt, now.Add(time.Hour).Unix(), hashSessionToken(tok))

	got, err := s.UserBySession(tok)
	if err != nil || got.ID != u.ID {
		t.Fatalf("UserBySession = %v %v, want valid", got, err)
	}
	var expiresAt int64
	s.db.QueryRow(`SELECT expires_at FROM sessions WHERE token_hash = ?`, hashSessionToken(tok)).Scan(&expiresAt)
	if expiresAt != maxExpiry {
		t.Errorf("slid expiry = %d, want clamped to cap %d", expiresAt, maxExpiry)
	}
}

// TestSessionSlideThreshold: a session whose stored expiry is already near
// now+sessionTTL is not rewritten on use, while a stale one is slid forward.
func TestSessionSlideThreshold(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")

	// Case 1: fresh session, stored expiry ≈ now+sessionTTL. A use recomputes the
	// same expiry, so the slide threshold is not met and the row is left alone.
	tok, _ := s.CreateSession(u.ID)
	var before int64
	s.db.QueryRow(`SELECT expires_at FROM sessions WHERE token_hash = ?`, hashSessionToken(tok)).Scan(&before)
	if _, err := s.UserBySession(tok); err != nil {
		t.Fatalf("UserBySession = %v", err)
	}
	var after int64
	s.db.QueryRow(`SELECT expires_at FROM sessions WHERE token_hash = ?`, hashSessionToken(tok)).Scan(&after)
	if after != before {
		t.Errorf("fresh session expiry rewritten: %d -> %d (want unchanged)", before, after)
	}

	// Case 2: stale stored expiry (only 1h out, still valid). A use must slide it
	// forward to ≈ now+sessionTTL since the advance exceeds the threshold.
	stale := time.Now().Add(time.Hour).Unix()
	s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`, stale, hashSessionToken(tok))
	if _, err := s.UserBySession(tok); err != nil {
		t.Fatalf("UserBySession (stale) = %v", err)
	}
	s.db.QueryRow(`SELECT expires_at FROM sessions WHERE token_hash = ?`, hashSessionToken(tok)).Scan(&after)
	if after <= stale+int64(sessionSlideThreshold.Seconds()) {
		t.Errorf("stale session expiry not slid: stayed at %d", after)
	}
}

func TestSessionAbsoluteMaxAge(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")
	tok, _ := s.CreateSession(u.ID)

	// Force the session past its absolute lifetime cap (created long ago).
	old := time.Now().Add(-sessionMaxAge - time.Hour).Unix()
	s.db.Exec(`UPDATE sessions SET created_at = ?, expires_at = ? WHERE token_hash = ?`,
		old, time.Now().Add(sessionTTL).Unix(), hashSessionToken(tok))

	if _, err := s.UserBySession(tok); !errors.Is(err, ErrNotFound) {
		t.Errorf("over-max-age session err = %v, want ErrNotFound", err)
	}
}

func TestMergeGuestNewDiscord(t *testing.T) {
	s := openTest(t)
	g, _ := s.CreateGuest("ann")

	merged, err := s.MergeGuestIntoDiscord(g.ID, "disc9", "Ann", "av")
	if err != nil {
		t.Fatal(err)
	}
	if merged.ID != g.ID {
		t.Errorf("merge changed id: %d → %d", g.ID, merged.ID)
	}
	if merged.IsGuest || merged.DiscordID != "disc9" {
		t.Errorf("merged = %+v", merged)
	}
}

func TestMergeGuestExistingDiscord(t *testing.T) {
	s := openTest(t)
	g, _ := s.CreateGuest("ann")
	d, _ := s.UpsertDiscordUser("disc9", "Ann", "av")

	// Guest has stats, a rating, and a session.
	s.db.Exec(`INSERT INTO stats (user_id, ruleset, games, wins) VALUES (?, 'base', 3, 1)`, g.ID)
	s.db.Exec(`INSERT INTO stats (user_id, ruleset, games, wins) VALUES (?, 'base', 5, 2)`, d.ID)
	// Guest has a rating on a ruleset the survivor has not played.
	if err := s.SetRatingRow(g.ID, "base+islands", rating.MuForDisplay(1234, rating.ProvisionalSigma), rating.ProvisionalSigma, 1000); err != nil {
		t.Fatal(err)
	}
	tok, _ := s.CreateSession(g.ID)

	merged, err := s.MergeGuestIntoDiscord(g.ID, "disc9", "Ann2", "av2")
	if err != nil {
		t.Fatal(err)
	}
	if merged.ID != d.ID {
		t.Errorf("merged into %d, want existing %d", merged.ID, d.ID)
	}
	if _, err := s.UserByID(g.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("guest row should be gone, err = %v", err)
	}

	var games, wins int
	s.db.QueryRow(`SELECT games, wins FROM stats WHERE user_id = ? AND ruleset = 'base'`, d.ID).Scan(&games, &wins)
	if games != 8 || wins != 3 {
		t.Errorf("stats merged = %d/%d, want 8/3", games, wins)
	}

	// The guest's rating must be preserved on the survivor (CASCADE would
	// otherwise destroy it when the guest row is deleted).
	r, err := s.RatingRow(d.ID, "base+islands")
	if err != nil || r.Display != 1234 {
		t.Errorf("rating after merge = display=%d %v, want 1234 preserved", r.Display, err)
	}

	// The guest's session token must be invalidated by the merge, not become
	// a credential for the full Discord account.
	if _, err := s.UserBySession(tok); !errors.Is(err, ErrNotFound) {
		t.Errorf("guest session after merge = %v, want ErrNotFound (invalidated)", err)
	}

	// Survivor's display name must not be overwritten by the OAuth provider's value.
	if merged.IsGuest || merged.Name != "Ann" {
		t.Errorf("survivor name clobbered: %+v, want non-guest named Ann", merged)
	}
}

func TestMergeRatingConflictKeepsSurvivor(t *testing.T) {
	s := openTest(t)
	g, _ := s.CreateGuest("ann")
	d, _ := s.UpsertDiscordUser("disc9", "Ann", "av")

	// Both have a rating on the same ruleset; survivor's must be kept.
	if err := s.SetRatingRow(g.ID, "base", rating.MuForDisplay(1500, rating.ProvisionalSigma), rating.ProvisionalSigma, 1000); err != nil {
		t.Fatal(err)
	}
	if err := s.SetRatingRow(d.ID, "base", rating.MuForDisplay(1100, rating.ProvisionalSigma), rating.ProvisionalSigma, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MergeGuestIntoDiscord(g.ID, "disc9", "Ann", "av"); err != nil {
		t.Fatal(err)
	}
	r, err := s.RatingRow(d.ID, "base")
	if err != nil || r.Display != 1100 {
		t.Errorf("rating on conflict = display=%d %v, want survivor's 1100 kept", r.Display, err)
	}
}

// TestMergeCarriesMuSigma verifies that when a guest's rating row is folded into a
// fresh Discord account (no existing rating on that ruleset), the guest's mu/sigma
// are carried through, not reset to the column defaults (25.0/8.3333).
func TestMergeCarriesMuSigma(t *testing.T) {
	s := openTest(t)
	g, _ := s.CreateGuest("guest")
	d, _ := s.UpsertDiscordUser("disc_fresh", "Fresh", "av")

	// Give the guest a settled, non-default rating.
	const wantMu, wantSigma = 32.0, 3.0
	if err := s.SetRatingRow(g.ID, "base", wantMu, wantSigma, 1000); err != nil {
		t.Fatal(err)
	}

	// d has no "base" rating yet; the guest's row must be folded in intact.
	if _, err := s.MergeGuestIntoDiscord(g.ID, "disc_fresh", "Fresh", "av"); err != nil {
		t.Fatal(err)
	}

	r, err := s.RatingRow(d.ID, "base")
	if err != nil {
		t.Fatal(err)
	}
	if r.Mu != wantMu || r.Sigma != wantSigma {
		t.Errorf("after merge: mu=%.4f sigma=%.4f, want mu=%.4f sigma=%.4f",
			r.Mu, r.Sigma, wantMu, wantSigma)
	}
}

// TestMergePromoteWithExistingDiscord models the promote race: a Discord row
// created concurrently (after a stale "doesn't exist" read) must not fail the
// login. The lookup is inside the tx, so the promote path cannot hit the UNIQUE
// collision, and merging into an existing discord id resolves cleanly.
func TestMergePromoteWithExistingDiscord(t *testing.T) {
	s := openTest(t)
	g, _ := s.CreateGuest("ann")
	d, _ := s.UpsertDiscordUser("disc9", "Ann", "av")

	merged, err := s.MergeGuestIntoDiscord(g.ID, "disc9", "Ann", "av")
	if err != nil {
		t.Fatalf("merge with existing discord row failed: %v", err)
	}
	if merged.ID != d.ID {
		t.Errorf("merged into %d, want existing %d", merged.ID, d.ID)
	}
	if _, err := s.UserByID(g.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("guest row should be gone, err = %v", err)
	}
}

func TestMergeNonGuestFails(t *testing.T) {
	s := openTest(t)
	d, _ := s.UpsertDiscordUser("disc1", "Bob", "")
	if _, err := s.MergeGuestIntoDiscord(d.ID, "disc2", "x", ""); err == nil {
		t.Error("merging a non-guest should fail")
	}
}

func TestMergeMissingGuest(t *testing.T) {
	s := openTest(t)
	if _, err := s.MergeGuestIntoDiscord(99999, "disc2", "x", ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("merging a missing guest err = %v, want ErrNotFound", err)
	}
}

// TestMergeRepointsContent verifies the merge folds a guest's seats, games
// (created_by + winner_user_id), and chat onto the survivor account.
func TestMergeRepointsContent(t *testing.T) {
	s := openTest(t)
	g, _ := s.CreateGuest("ann")
	d, _ := s.UpsertDiscordUser("disc9", "Ann", "av")

	// Guest hosts a game, holds a seat, won it, and chatted.
	game := &Game{ID: "gm", Ruleset: "base", Config: nil, CreatedBy: g.ID}
	game.Config = []byte("{}")
	if err := s.CreateGame(game); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("gm", 0, g.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishGame("gm", g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveChat("game:gm", g.ID, "gg"); err != nil {
		t.Fatal(err)
	}

	if _, err := s.MergeGuestIntoDiscord(g.ID, "disc9", "Ann", "av"); err != nil {
		t.Fatal(err)
	}

	// Seat now belongs to the survivor.
	seat, err := s.SeatForUser("gm", d.ID)
	if err != nil || seat.UserID != d.ID {
		t.Errorf("seat after merge = %+v %v, want survivor %d", seat, err, d.ID)
	}
	// Game created_by + winner repointed.
	got, _ := s.GameByID("gm")
	if got.CreatedBy != d.ID {
		t.Errorf("created_by after merge = %d, want %d", got.CreatedBy, d.ID)
	}
	if got.Winner == nil || *got.Winner != d.ID {
		t.Errorf("winner after merge = %v, want %d", got.Winner, d.ID)
	}
	// Chat repointed (RecentChat resolves the survivor's name).
	lines, _ := s.RecentChat("game:gm", 10)
	if len(lines) != 1 || lines[0].UserID != d.ID {
		t.Errorf("chat after merge = %+v, want survivor %d", lines, d.ID)
	}
}
