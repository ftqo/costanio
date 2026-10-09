package store

import (
	"testing"
	"time"
)

func TestEntitlementsIdempotent(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("dee")

	if err := s.GrantEntitlement(u.ID, "frame.laurel", "purchase"); err != nil {
		t.Fatal(err)
	}
	// Re-grant from a different source: still one row, no error.
	if err := s.GrantEntitlement(u.ID, "frame.laurel", "grant"); err != nil {
		t.Fatal(err)
	}
	has, err := s.HasEntitlement(u.ID, "frame.laurel")
	if err != nil || !has {
		t.Fatalf("HasEntitlement = %v, %v; want true", has, err)
	}
	if has, _ := s.HasEntitlement(u.ID, "frame.unknown"); has {
		t.Fatal("HasEntitlement for unowned = true; want false")
	}
	set, _ := s.Entitlements(u.ID)
	if len(set) != 1 || !set["frame.laurel"] {
		t.Fatalf("Entitlements = %v; want {frame.laurel}", set)
	}
}

func TestLoadout(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("eli")

	if err := s.SetLoadoutSlot(u.ID, "frame", "frame.laurel"); err != nil {
		t.Fatal(err)
	}
	// Re-equip the same slot replaces, not duplicates.
	if err := s.SetLoadoutSlot(u.ID, "frame", "frame.neon"); err != nil {
		t.Fatal(err)
	}
	lo, _ := s.Loadout(u.ID)
	if lo["frame"] != "frame.neon" {
		t.Fatalf("frame slot = %q; want frame.neon", lo["frame"])
	}
	if err := s.ClearLoadoutSlot(u.ID, "frame"); err != nil {
		t.Fatal(err)
	}
	lo, _ = s.Loadout(u.ID)
	if _, ok := lo["frame"]; ok {
		t.Fatal("frame slot still set after clear")
	}
}

func TestSupporterSincePreserved(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("fae")

	if err := s.SetSupporter(u.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	sup, _ := s.Supporter(u.ID)
	if !sup.Active || sup.Since == 0 {
		t.Fatalf("after activate: %+v; want active with since set", sup)
	}
	firstSince := sup.Since

	// Lapse: active flips off but since is preserved (tenure badge survives).
	if err := s.SetSupporter(u.ID, false, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	sup, _ = s.Supporter(u.ID)
	if sup.Active {
		t.Fatal("still active after lapse")
	}
	if sup.Since != firstSince {
		t.Fatalf("since changed on lapse: %d != %d", sup.Since, firstSince)
	}

	// Re-activate: since stays the original activation.
	if err := s.SetSupporter(u.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	sup, _ = s.Supporter(u.ID)
	if sup.Since != firstSince {
		t.Fatalf("since reset on re-activate: %d != %d", sup.Since, firstSince)
	}
}

func TestSupporterBoosting(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("boostr")

	if err := s.SetSupporter(u.ID, true, true, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	sup, _ := s.Supporter(u.ID)
	if !sup.Active || !sup.Boosting {
		t.Fatalf("after boost activate: %+v; want active+boosting", sup)
	}
	// Subscriber who stops boosting but keeps the sub: active, not boosting.
	if err := s.SetSupporter(u.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	sup, _ = s.Supporter(u.ID)
	if !sup.Active || sup.Boosting {
		t.Fatalf("after un-boost: %+v; want active, not boosting", sup)
	}
}

// TestSupporterGiftRoundTrip: the gift flag persists and reads back, independently
// of the other perk flags, so the gift-only decorations can gate on it.
func TestSupporterGiftRoundTrip(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("giftee")

	// Gift role: active (bot-game perk) AND gift (decoration gate), no boost/kofi/staff.
	if err := s.SetSupporter(u.ID, true, false, false, false, true, 0); err != nil {
		t.Fatal(err)
	}
	sup, _ := s.Supporter(u.ID)
	if !sup.Active || !sup.Gift || sup.Boosting || sup.Kofi || sup.Staff {
		t.Fatalf("gift holder: %+v; want active+gift only", sup)
	}
	// A plain subscriber is active but not gift.
	if err := s.SetSupporter(u.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	if sup, _ := s.Supporter(u.ID); sup.Gift {
		t.Fatalf("after losing gift role: %+v; want Gift=false", sup)
	}
}

func TestSupporterZeroValue(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("gus")
	sup, err := s.Supporter(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sup.Active || sup.Since != 0 {
		t.Fatalf("non-supporter = %+v; want zero value", sup)
	}
}

func TestSetSupporterPeriodEnd(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("hal")
	end := time.Now().Add(24 * time.Hour).Unix()
	if err := s.SetSupporter(u.ID, true, false, false, false, false, end); err != nil {
		t.Fatal(err)
	}
	sup, err := s.Supporter(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !sup.Active || sup.Until != end {
		t.Errorf("supporter = %+v, want active until %d", sup, end)
	}
	// A later write with periodEnd 0 must not clobber the stored until (COALESCE).
	if err := s.SetSupporter(u.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	sup, _ = s.Supporter(u.ID)
	if sup.Until != end {
		t.Errorf("until clobbered by zero periodEnd: %d, want %d", sup.Until, end)
	}
}

func TestStaleSupporters(t *testing.T) {
	s := openTest(t)
	stale, _ := s.CreateGuest("stale")
	fresh, _ := s.CreateGuest("fresh")
	lapsed, _ := s.CreateGuest("lapsed")

	// All three are activated (which stamps updated_at = now).
	for _, u := range []*User{stale, fresh, lapsed} {
		if err := s.SetSupporter(u.ID, true, false, false, false, false, 0); err != nil {
			t.Fatal(err)
		}
	}
	// Make the lapsed user inactive (must be excluded regardless of staleness).
	if err := s.SetSupporter(lapsed.ID, false, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	// Backdate the stale user's snapshot well into the past.
	old := time.Now().Add(-48 * time.Hour).Unix()
	if _, err := s.db.Exec(`UPDATE supporter_status SET updated_at = ? WHERE user_id = ?`, old, stale.ID); err != nil {
		t.Fatal(err)
	}

	before := time.Now().Add(-time.Hour).Unix()
	got, err := s.StaleSupporters(before, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != stale.ID {
		t.Errorf("StaleSupporters = %v, want [%d] (only the active+stale one)", got, stale.ID)
	}

	// limit <= 0 normalizes to a default; still returns the stale row.
	def, err := s.StaleSupporters(before, 0)
	if err != nil || len(def) != 1 {
		t.Errorf("StaleSupporters default limit = %v %v, want 1", def, err)
	}
}

// A perk-only holder (staff/kofi, never an active supporter) must still be swept
// so a role lapse is caught in the background.
func TestStaleSupportersIncludesPerks(t *testing.T) {
	s := openTest(t)
	staff, _ := s.CreateGuest("staff")
	kofi, _ := s.CreateGuest("kofi")
	nada, _ := s.CreateGuest("nada")

	// staff-only and kofi-only holders: not active, one perk flag each.
	if err := s.SetSupporter(staff.ID, false, false, false, true, false, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSupporter(kofi.ID, false, false, true, false, false, 0); err != nil {
		t.Fatal(err)
	}
	// A row with no flags set must not be swept (would mean a Discord pull per
	// user per cycle); these gain via login / point-of-use, not the sweep.
	if err := s.SetSupporter(nada.ID, false, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	// Backdate everyone so staleness isn't the differentiator.
	old := time.Now().Add(-48 * time.Hour).Unix()
	if _, err := s.db.Exec(`UPDATE supporter_status SET updated_at = ?`, old); err != nil {
		t.Fatal(err)
	}

	before := time.Now().Add(-time.Hour).Unix()
	got, err := s.StaleSupporters(before, 50)
	if err != nil {
		t.Fatal(err)
	}
	want := map[int64]bool{staff.ID: true, kofi.ID: true}
	if len(got) != len(want) {
		t.Fatalf("StaleSupporters = %v, want the staff(%d) and kofi(%d) holders only", got, staff.ID, kofi.ID)
	}
	for _, id := range got {
		if !want[id] {
			t.Errorf("StaleSupporters returned all-false row %d", id)
		}
	}
}
