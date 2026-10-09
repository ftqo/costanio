package cosmetics

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/ftqo/costan.io/econ"
	"github.com/ftqo/costan.io/store"
)

// TestCatalogAnnotation exercises Service.Catalog: every catalog item is
// annotated with the right ownership/equip/lock flags for the user, and the
// supporter-exclusive items flip lock/own with supporter status.
func TestCatalogAnnotation(t *testing.T) {
	svc, led, st, uid := newSvc(t)

	// Buy and equip a Pip item so we can assert Owned + Equipped.
	led.Grant(uid, 500, "grant", "seed")
	if err := svc.Purchase(uid, "robber.sentinel"); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	if err := svc.Equip(uid, "robber", "robber.sentinel"); err != nil {
		t.Fatalf("equip: %v", err)
	}

	views, err := svc.Catalog(uid)
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if len(views) != len(Catalog) {
		t.Fatalf("catalog len = %d; want %d", len(views), len(Catalog))
	}
	byID := map[string]ItemView{}
	for _, v := range views {
		byID[v.ID] = v
	}

	laurel := byID["robber.sentinel"]
	if !laurel.Owned || !laurel.Equipped || laurel.Locked {
		t.Fatalf("robber.sentinel view = %+v; want owned+equipped, unlocked", laurel)
	}

	// A different Pip item is neither owned nor equipped nor locked.
	timber := byID["robber.crow"]
	if timber.Owned || timber.Equipped || timber.Locked {
		t.Fatalf("robber.crow view = %+v; want unowned/unequipped/unlocked", timber)
	}

	// The keg is not sold at all: it is locked behind the support roles, and
	// any one of the three opens it. Ko-fi alone is enough, though the holder
	// is not a supporter and not boosting.
	keg := byID["robber.keg"]
	if keg.Owned || !keg.Locked {
		t.Fatalf("robber.keg (no roles) view = %+v; want unowned + locked", keg)
	}

	// Supporter-exclusive item: locked + unowned while not a supporter.
	aurora := byID["decoration.supporter"]
	if aurora.Owned || !aurora.Locked {
		t.Fatalf("decoration.supporter (non-supporter) view = %+v; want unowned + locked", aurora)
	}

	// Become a supporter: the exclusive item is now owned and unlocked.
	st.SetSupporter(uid, true, false, false, false, false, 0)
	views, err = svc.Catalog(uid)
	if err != nil {
		t.Fatalf("catalog (supporter): %v", err)
	}
	for _, v := range views {
		if v.ID == "decoration.supporter" {
			if !v.Owned || v.Locked {
				t.Fatalf("decoration.supporter (supporter) view = %+v; want owned + unlocked", v)
			}
		}
	}
}

// TestLoadoutColor returns the globally-equipped color id, or "" when none.
func TestLoadoutColor(t *testing.T) {
	svc, _, _, uid := newSvc(t)

	if c, err := svc.LoadoutColor(uid); err != nil || c != "" {
		t.Fatalf("LoadoutColor empty = (%q, %v); want (\"\", nil)", c, err)
	}

	if err := svc.Equip(uid, "color", "color.ff0000"); err != nil {
		t.Fatalf("equip free color: %v", err)
	}
	if c, err := svc.LoadoutColor(uid); err != nil || c != "color.ff0000" {
		t.Fatalf("LoadoutColor = (%q, %v); want (color.ff0000, nil)", c, err)
	}
}

// TestUnequip clears a previously-set slot.
func TestUnequip(t *testing.T) {
	svc, led, _, uid := newSvc(t)
	led.Grant(uid, 500, "grant", "seed")
	if err := svc.Purchase(uid, "robber.sentinel"); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	if err := svc.Equip(uid, "robber", "robber.sentinel"); err != nil {
		t.Fatalf("equip: %v", err)
	}
	if lo, _ := svc.Loadout(uid); lo["robber"] != "robber.sentinel" {
		t.Fatalf("pre-unequip frame = %q", lo["robber"])
	}
	if err := svc.Unequip(uid, "robber"); err != nil {
		t.Fatalf("unequip: %v", err)
	}
	if lo, _ := svc.Loadout(uid); lo["robber"] != "" {
		t.Fatalf("post-unequip frame = %q; want empty", lo["robber"])
	}
	// Unequipping an already-empty slot is a no-op success.
	if err := svc.Unequip(uid, "robber"); err != nil {
		t.Fatalf("unequip empty slot: %v", err)
	}
}

// TestEquipUnknownItem covers the non-color unknown-item branch of Equip.
func TestEquipUnknownItem(t *testing.T) {
	svc, _, _, uid := newSvc(t)
	if err := svc.Equip(uid, "robber", "robber.nope"); !errors.Is(err, ErrUnknownItem) {
		t.Fatalf("equip unknown item err = %v; want ErrUnknownItem", err)
	}
}

// TestEquipSupporterItemRefresh: equipping a supporter-exclusive (non-color)
// item triggers the point-of-use refresh; it succeeds for an active supporter
// and is denied once the live re-check finds the boost gone.
func TestEquipSupporterItemRefresh(t *testing.T) {
	svc, _, st, uid := newSvc(t)

	// Live re-check confirms supporter: the exclusive frame equips.
	ref := &fakeRefresh{st: st, active: true}
	svc.SetRefresher(ref)
	if err := svc.Equip(uid, "decoration", "decoration.supporter"); err != nil {
		t.Fatalf("equip supporter frame (active): %v", err)
	}
	if ref.calls != 1 {
		t.Fatalf("refresh calls = %d; want 1", ref.calls)
	}
	if lo, _ := svc.Loadout(uid); lo["decoration"] != "decoration.supporter" {
		t.Fatalf("decoration = %q; want decoration.supporter", lo["decoration"])
	}

	// Now the live re-check finds the boost gone: equip is denied. Supporter
	// frames are not "kept" (no color-use entitlement path), so it reverts.
	ref.active = false
	if err := svc.Equip(uid, "decoration", "decoration.supporter"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("equip supporter frame after un-boost err = %v; want ErrNotOwned", err)
	}
}

// TestEquipColorUnknown covers the unknown-color branch of equipColor.
func TestEquipColorUnknown(t *testing.T) {
	svc, _, _, uid := newSvc(t)
	if err := svc.Equip(uid, "color", "color.zzzzzz"); !errors.Is(err, ErrUnknownColor) {
		t.Fatalf("equip unknown color err = %v; want ErrUnknownColor", err)
	}
}

// TestColorsAvailabilityNonSupporter: a non-supporter sees only free colors (and
// any previously-used/entitled ones) as available.
func TestColorsAvailabilityNonSupporter(t *testing.T) {
	svc, _, st, uid := newSvc(t)

	colors, err := svc.Colors(uid)
	if err != nil {
		t.Fatalf("colors: %v", err)
	}
	if len(colors) != 64 {
		t.Fatalf("colors = %d; want 64", len(colors))
	}
	freeAvail, supLocked := 0, 0
	for _, c := range colors {
		switch {
		case c.Free && c.Available:
			freeAvail++
		case !c.Free && !c.Available:
			supLocked++
		default:
			t.Fatalf("color %s: free=%v available=%v unexpected for non-supporter", c.ID, c.Free, c.Available)
		}
	}
	if freeAvail != FreeCount {
		t.Fatalf("free available = %d; want %d", freeAvail, FreeCount)
	}
	if supLocked != 64-FreeCount {
		t.Fatalf("supporter locked = %d; want %d", supLocked, 64-FreeCount)
	}

	// Use a supporter color as an active supporter to mint a keep-forever
	// entitlement, then lapse: that one color stays available.
	svc.SetRefresher(&fakeRefresh{st: st, active: true})
	if _, err := svc.UseColor(uid, "color.aa00aa"); err != nil {
		t.Fatalf("use supporter color: %v", err)
	}
	st.SetSupporter(uid, false, false, false, false, false, 0)
	svc.SetRefresher(nil)
	colors, err = svc.Colors(uid)
	if err != nil {
		t.Fatalf("colors after lapse: %v", err)
	}
	var kept ColorView
	for _, c := range colors {
		if c.ID == "color.aa00aa" {
			kept = c
		}
	}
	if !kept.Available {
		t.Fatalf("used supporter color should remain available after lapse: %+v", kept)
	}
}

// TestUseColorKeptAfterLapse: a color minted via UseColor is usable later even
// without supporter status and without re-minting (the already-entitled branch).
func TestUseColorKeptAfterLapse(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	svc.SetRefresher(&fakeRefresh{st: st, active: true})
	if _, err := svc.UseColor(uid, "color.aa00aa"); err != nil {
		t.Fatalf("first use: %v", err)
	}
	// Lapse; with the entitlement present, UseColor still succeeds (the
	// !ent[col.ID] grant branch is skipped).
	st.SetSupporter(uid, false, false, false, false, false, 0)
	svc.SetRefresher(&fakeRefresh{st: st, active: false})
	if _, err := svc.UseColor(uid, "color.aa00aa"); err != nil {
		t.Fatalf("re-use kept color after lapse: %v", err)
	}
}

// TestSupporterView covers the three tiers and the no-history case.
func TestSupporterView(t *testing.T) {
	svc, _, st, uid := newSvc(t)

	// No history: inactive, empty tier and badge.
	v, err := svc.SupporterView(uid)
	if err != nil {
		t.Fatalf("supporter view: %v", err)
	}
	if v.Active || v.Tier != "" || v.Badge != "" || v.Since != 0 {
		t.Fatalf("no-history view = %+v; want zero", v)
	}

	// Active supporter -> tier "supporter", since stamped now (badge "" since
	// tenure is under a month).
	st.SetSupporter(uid, true, false, false, false, false, 0)
	v, err = svc.SupporterView(uid)
	if err != nil {
		t.Fatalf("supporter view (active): %v", err)
	}
	if !v.Active || v.Tier != "supporter" {
		t.Fatalf("active view = %+v; want active supporter", v)
	}
	if v.Since == 0 {
		t.Fatal("active view should have a nonzero Since")
	}
	if v.Badge != "" {
		t.Fatalf("fresh supporter badge = %q; want empty", v.Badge)
	}

	// Lapse -> tier "former" (since survives).
	st.SetSupporter(uid, false, false, false, false, false, 0)
	v, err = svc.SupporterView(uid)
	if err != nil {
		t.Fatalf("supporter view (lapsed): %v", err)
	}
	if v.Active || v.Tier != "former" {
		t.Fatalf("lapsed view = %+v; want former", v)
	}
}

// TestTenureBadge covers every tenure bucket boundary directly (the store always
// stamps `since` at now, so the bronze/silver/gold buckets are only reachable by
// driving tenureBadge with explicit timestamps).
func TestTenureBadge(t *testing.T) {
	day := 24 * time.Hour
	now := time.Now()
	cases := []struct {
		name  string
		since time.Time
		want  string
	}{
		{"no-history", time.Time{}, ""}, // since <= 0 handled via 0 below
		{"under-a-month", now.Add(-10 * day), ""},
		{"bronze-1mo", now.Add(-40 * day), "bronze"},
		{"silver-6mo", now.Add(-200 * day), "silver"},
		{"gold-12mo", now.Add(-400 * day), "gold"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var ts int64
			if !c.since.IsZero() {
				ts = c.since.Unix()
			}
			if got := tenureBadge(ts); got != c.want {
				t.Fatalf("tenureBadge(%s) = %q; want %q", c.name, got, c.want)
			}
		})
	}
	// Explicit zero / negative inputs map to "".
	if got := tenureBadge(0); got != "" {
		t.Fatalf("tenureBadge(0) = %q; want empty", got)
	}
	if got := tenureBadge(-5); got != "" {
		t.Fatalf("tenureBadge(-5) = %q; want empty", got)
	}
}

// TestStoreErrorsPropagate closes the underlying DB and asserts every
// store-backed Service method surfaces the persistence error rather than
// swallowing it. This exercises the `if err != nil { return ..., err }` guards
// after each store call.
func TestStoreErrorsPropagate(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "err.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	led := econ.New(st)
	u, err := st.CreateGuest("tester")
	if err != nil {
		t.Fatalf("guest: %v", err)
	}
	uid := u.ID
	svc := New(st, led)

	// Close the DB out from under the service: subsequent queries fail.
	if err := st.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	if _, err := svc.Catalog(uid); err == nil {
		t.Error("Catalog should surface a closed-DB error")
	}
	// Purchase: HasEntitlement read fails before any spend.
	if err := svc.Purchase(uid, "robber.sentinel"); err == nil {
		t.Error("Purchase should surface a closed-DB error")
	}
	if _, err := svc.Loadout(uid); err == nil {
		t.Error("Loadout should surface a closed-DB error")
	}
	if _, err := svc.LoadoutColor(uid); err == nil {
		t.Error("LoadoutColor should surface a closed-DB error")
	}
	if _, err := svc.Colors(uid); err == nil {
		t.Error("Colors should surface a closed-DB error")
	}
	if _, err := svc.SupporterView(uid); err == nil {
		t.Error("SupporterView should surface a closed-DB error")
	}
	// equipColor: the first store call (Entitlements) fails for a free color.
	if err := svc.Equip(uid, "color", "color.ff0000"); err == nil {
		t.Error("Equip(color) should surface a closed-DB error")
	}
	// Equip (non-color): the Entitlements/Supporter reads fail.
	if err := svc.Equip(uid, "robber", "robber.sentinel"); err == nil {
		t.Error("Equip(frame) should surface a closed-DB error")
	}
	// UseColor: ensureFresh is a no-op (no refresher), then Entitlements fails.
	if _, err := svc.UseColor(uid, "color.aa00aa"); err == nil {
		t.Error("UseColor should surface a closed-DB error")
	}
}

// TestHexToRGBPanics covers the malformed-input panic branches of hexToRGB (the
// palette is compile-time, so these are only reachable via direct calls).
func TestHexToRGBPanics(t *testing.T) {
	mustPanic := func(name, hex string) {
		t.Helper()
		defer func() {
			if recover() == nil {
				t.Fatalf("%s: expected panic for %q", name, hex)
			}
		}()
		hexToRGB(hex)
	}
	mustPanic("wrong-length", "#fff")
	mustPanic("bad-digit", "#gggggg")

	// Uppercase hex digits resolve identically to lowercase (covers the A-F
	// branch of the digit decoder).
	ru, gu, bu := hexToRGB("#FF00AA")
	rl, gl, bl := hexToRGB("#ff00aa")
	if ru != rl || gu != gl || bu != bl {
		t.Fatalf("uppercase mismatch: (%v,%v,%v) vs (%v,%v,%v)", ru, gu, bu, rl, gl, bl)
	}

	// Valid forms (with and without leading '#') return matching RGB.
	r1, g1, b1 := hexToRGB("#ffffff")
	r2, g2, b2 := hexToRGB("ffffff")
	if r1 != r2 || g1 != g2 || b1 != b2 {
		t.Fatalf("leading-# mismatch: (%v,%v,%v) vs (%v,%v,%v)", r1, g1, b1, r2, g2, b2)
	}
	if r1 != 1 || g1 != 1 || b1 != 1 {
		t.Fatalf("white = (%v,%v,%v); want (1,1,1)", r1, g1, b1)
	}
}
