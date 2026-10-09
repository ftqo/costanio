package store

import (
	"testing"
	"time"
)

func modTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func mkUser(t *testing.T, s *Store, name string) int64 {
	t.Helper()
	u, err := s.UpsertDiscordUser("disc-"+name, name, "")
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func TestWarnCount(t *testing.T) {
	s := modTestStore(t)
	uid := mkUser(t, s, "bob")
	for range 2 {
		if err := s.RecordStrike(uid, "warn", nil); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := s.WarnCount(uid); err != nil || n != 2 {
		t.Fatalf("WarnCount=%d err=%v", n, err)
	}
}

func TestCanReportDenialWindow(t *testing.T) {
	s := modTestStore(t)
	uid := mkUser(t, s, "carol")
	old := time.Now().Add(-8 * 24 * time.Hour).Unix()
	recent := time.Now().Unix()
	// 5 stale denials (outside the 7d window) + 4 recent ones.
	for range 5 {
		if err := s.recordStrikeAt(uid, "denial", nil, old); err != nil {
			t.Fatal(err)
		}
	}
	for range 4 {
		if err := s.recordStrikeAt(uid, "denial", nil, recent); err != nil {
			t.Fatal(err)
		}
	}
	if ok, err := s.CanReport(uid); err != nil || !ok {
		t.Fatalf("4 recent denials should still allow: ok=%v err=%v", ok, err)
	}
	if err := s.recordStrikeAt(uid, "denial", nil, recent); err != nil { // 5th recent
		t.Fatal(err)
	}
	if ok, err := s.CanReport(uid); err != nil || ok {
		t.Fatalf("5 recent denials should revoke: ok=%v err=%v", ok, err)
	}
}

func TestChatBanRoundTrip(t *testing.T) {
	s := modTestStore(t)
	uid := mkUser(t, s, "alice")

	if banned, err := s.IsChatBanned(uid); err != nil || banned {
		t.Fatalf("fresh user banned=%v err=%v", banned, err)
	}
	if err := s.BanChat(uid, "spam", nil, nil); err != nil {
		t.Fatal(err)
	}
	if banned, err := s.IsChatBanned(uid); err != nil || !banned {
		t.Fatalf("after ban banned=%v err=%v", banned, err)
	}
	if err := s.UnbanChat(uid); err != nil {
		t.Fatal(err)
	}
	if banned, err := s.IsChatBanned(uid); err != nil || banned {
		t.Fatalf("after unban banned=%v err=%v", banned, err)
	}
}

func mkChat(t *testing.T, s *Store, scope string, uid int64, msg string) int64 {
	t.Helper()
	res, err := s.db.Exec(`INSERT INTO chat (scope, user_id, msg, ts) VALUES (?,?,?,0)`, scope, uid, msg)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func TestModChannelConfig(t *testing.T) {
	s := modTestStore(t)
	if ch, err := s.ModChannel(); err != nil || ch != "" {
		t.Fatalf("default ch=%q err=%v", ch, err)
	}
	if err := s.SetModChannel("123"); err != nil {
		t.Fatal(err)
	}
	if ch, err := s.ModChannel(); err != nil || ch != "123" {
		t.Fatalf("after set ch=%q err=%v", ch, err)
	}
	if err := s.SetModChannel("456"); err != nil { // overwrite
		t.Fatal(err)
	}
	if ch, _ := s.ModChannel(); ch != "456" {
		t.Fatalf("after overwrite ch=%q", ch)
	}
}

func TestFeedChannelConfig(t *testing.T) {
	s := modTestStore(t)
	if ch, err := s.FeedChannel(); err != nil || ch != "" {
		t.Fatalf("default ch=%q err=%v", ch, err)
	}
	if err := s.SetFeedChannel("789"); err != nil {
		t.Fatal(err)
	}
	if ch, err := s.FeedChannel(); err != nil || ch != "789" {
		t.Fatalf("after set ch=%q err=%v", ch, err)
	}
	if err := s.SetFeedChannel(""); err != nil { // clear
		t.Fatal(err)
	}
	if ch, _ := s.FeedChannel(); ch != "" {
		t.Fatalf("after clear ch=%q", ch)
	}
	// Feed and mod channels are independent keys.
	if err := s.SetFeedChannel("f1"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetModChannel("m1"); err != nil {
		t.Fatal(err)
	}
	if f, _ := s.FeedChannel(); f != "f1" {
		t.Fatalf("feed clobbered: %q", f)
	}
	if m, _ := s.ModChannel(); m != "m1" {
		t.Fatalf("mod clobbered: %q", m)
	}
}

func TestFeedTitleConfig(t *testing.T) {
	s := modTestStore(t)
	if v, err := s.FeedTitle(); err != nil || v != "" {
		t.Fatalf("default title=%q err=%v", v, err)
	}
	if err := s.SetFeedTitle("Match starting!"); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.FeedTitle(); v != "Match starting!" {
		t.Fatalf("after set title=%q", v)
	}
	if err := s.SetFeedTitle(""); err != nil { // clear, back to unset
		t.Fatal(err)
	}
	if v, _ := s.FeedTitle(); v != "" {
		t.Fatalf("after clear title=%q", v)
	}
}

func TestReportDedupeAndResolve(t *testing.T) {
	s := modTestStore(t)
	reporter := mkUser(t, s, "rep")
	accused := mkUser(t, s, "acc")
	cid := mkChat(t, s, "lobby", accused, "bad words")

	id1, isNew, err := s.CreateOrBumpReport(reporter, accused, cid, "lobby")
	if err != nil || !isNew {
		t.Fatalf("first report isNew=%v err=%v", isNew, err)
	}
	id2, isNew2, err := s.CreateOrBumpReport(mkUser(t, s, "rep2"), accused, cid, "lobby")
	if err != nil || isNew2 || id2 != id1 {
		t.Fatalf("re-report should bump existing: id2=%d isNew2=%v err=%v", id2, isNew2, err)
	}
	r, err := s.ReportByID(id1)
	if err != nil || r.ReportCount != 2 {
		t.Fatalf("report_count=%d err=%v", r.ReportCount, err)
	}

	resolved, err := s.ResolveReport(id1, "warn", nil)
	if err != nil || !resolved {
		t.Fatalf("first resolve resolvedNow=%v err=%v", resolved, err)
	}
	resolved2, err := s.ResolveReport(id1, "ban", nil)
	if err != nil || resolved2 {
		t.Fatalf("second resolve must be a no-op: resolvedNow=%v err=%v", resolved2, err)
	}
}

func TestNameLockRoundTrip(t *testing.T) {
	s := modTestStore(t)
	uid := mkUser(t, s, "dave")

	if locked, err := s.IsNameLocked(uid); err != nil || locked {
		t.Fatalf("fresh user IsNameLocked=%v err=%v; want false", locked, err)
	}

	mod := mkUser(t, s, "mod")
	if err := s.LockName(uid, "attempted name: slur", &mod); err != nil {
		t.Fatal(err)
	}
	if locked, err := s.IsNameLocked(uid); err != nil || !locked {
		t.Fatalf("after lock IsNameLocked=%v err=%v; want true", locked, err)
	}

	// Re-lock (auto, nil actor) overwrites rather than erroring on the PK conflict.
	if err := s.LockName(uid, "automated name filter", nil); err != nil {
		t.Fatalf("re-lock: %v", err)
	}

	if err := s.UnlockName(uid); err != nil {
		t.Fatal(err)
	}
	if locked, err := s.IsNameLocked(uid); err != nil || locked {
		t.Fatalf("after unlock IsNameLocked=%v err=%v; want false", locked, err)
	}
	// Unlocking again is a no-op, not an error.
	if err := s.UnlockName(uid); err != nil {
		t.Fatalf("second unlock: %v", err)
	}
}

func TestImportNameScreening(t *testing.T) {
	s := modTestStore(t)

	// A slur imported from a provider is replaced with a neutral placeholder and
	// does not lock the account (imports are not the user's own attempts).
	bad, err := s.UpsertDiscordUser("disc-slur", "chink", "")
	if err != nil {
		t.Fatal(err)
	}
	if bad.Name == "chink" {
		t.Fatalf("slur name stored raw: %q", bad.Name)
	}
	if len(bad.Name) < 6 || bad.Name[:6] != "Player" {
		t.Fatalf("want Player###### placeholder, got %q", bad.Name)
	}
	if locked, err := s.IsNameLocked(bad.ID); err != nil || locked {
		t.Fatalf("import must not lock: locked=%v err=%v", locked, err)
	}

	// A reserved impersonation name is also placeholdered.
	imp, err := s.UpsertDiscordUser("disc-imp", "Admin", "")
	if err != nil {
		t.Fatal(err)
	}
	if imp.Name == "Admin" {
		t.Fatalf("reserved name stored raw: %q", imp.Name)
	}

	// A clean name imports unchanged.
	ok, err := s.UpsertDiscordUser("disc-ok", "Steve", "")
	if err != nil {
		t.Fatal(err)
	}
	if ok.Name != "Steve" {
		t.Fatalf("clean name changed: %q", ok.Name)
	}
}
