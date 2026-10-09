package cosmetics

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/ftqo/costan.io/econ"
	"github.com/ftqo/costan.io/store"
)

// fakeRefresh simulates a point-of-use Discord re-check by writing a fixed
// supporter status whenever EnsureFresh is called.
type fakeRefresh struct {
	st           *store.Store
	active       bool
	boosting     bool
	kofi         bool
	staff        bool
	gift         bool
	calls        int // EnsureFresh calls
	refreshCalls int // unconditional Refresh calls
}

func (f *fakeRefresh) EnsureFresh(_ context.Context, userID int64) error {
	f.calls++
	return f.st.SetSupporter(userID, f.active, f.boosting, f.kofi, f.staff, f.gift, 0)
}

func (f *fakeRefresh) Refresh(_ context.Context, userID int64) error {
	f.refreshCalls++
	return f.st.SetSupporter(userID, f.active, f.boosting, f.kofi, f.staff, f.gift, 0)
}

func newSvc(t *testing.T) (*Service, *econ.Ledger, *store.Store, int64) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	led := econ.New(st)
	u, err := st.CreateGuest("tester")
	if err != nil {
		t.Fatal(err)
	}
	return New(st, led), led, st, u.ID
}

// RefreshAndView re-pulls then returns the view. force=true must use the
// unconditional Refresh (the manual sync path); force=false the TTL-gated
// EnsureFresh (the cheap automatic path).
func TestRefreshAndView(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	_ = st
	ref := &fakeRefresh{st: st, active: true, staff: true}
	svc.SetRefresher(ref)

	// Automatic path: TTL-gated EnsureFresh, view reflects the pulled status.
	v, err := svc.RefreshAndView(context.Background(), uid, false)
	if err != nil {
		t.Fatalf("RefreshAndView(force=false): %v", err)
	}
	if !v.Staff || !v.Active {
		t.Fatalf("view = %+v; want active staff after refresh", v)
	}
	if ref.calls != 1 || ref.refreshCalls != 0 {
		t.Fatalf("force=false used EnsureFresh=%d Refresh=%d; want 1,0", ref.calls, ref.refreshCalls)
	}

	// Manual path: unconditional Refresh.
	if _, err := svc.RefreshAndView(context.Background(), uid, true); err != nil {
		t.Fatalf("RefreshAndView(force=true): %v", err)
	}
	if ref.refreshCalls != 1 || ref.calls != 1 {
		t.Fatalf("force=true used Refresh=%d EnsureFresh=%d; want 1,1", ref.refreshCalls, ref.calls)
	}
}

func TestPurchaseFlow(t *testing.T) {
	svc, led, st, uid := newSvc(t)

	// No funds: purchase rejected.
	if err := svc.Purchase(uid, "robber.sentinel"); !errors.Is(err, econ.ErrInsufficientFunds) {
		t.Fatalf("broke purchase err = %v; want ErrInsufficientFunds", err)
	}

	led.Grant(uid, 500, "grant", "seed")
	if err := svc.Purchase(uid, "robber.sentinel"); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	if has, _ := st.HasEntitlement(uid, "robber.sentinel"); !has {
		t.Fatal("not entitled after purchase")
	}
	if bal, _ := led.Balance(uid); bal != 100 { // 500 - 400
		t.Fatalf("balance = %d; want 100", bal)
	}
	// Idempotent: re-purchase doesn't charge again.
	if err := svc.Purchase(uid, "robber.sentinel"); err != nil {
		t.Fatalf("re-purchase: %v", err)
	}
	if bal, _ := led.Balance(uid); bal != 100 {
		t.Fatalf("balance after re-purchase = %d; want 100 (no double charge)", bal)
	}
}

func TestPurchaseGating(t *testing.T) {
	svc, led, _, uid := newSvc(t)
	led.Grant(uid, 5000, "grant", "seed")

	if err := svc.Purchase(uid, "nope.nope"); !errors.Is(err, ErrUnknownItem) {
		t.Errorf("unknown item err = %v", err)
	}
	if err := svc.Purchase(uid, "decoration.supporter"); !errors.Is(err, ErrSupporterExclusive) {
		t.Errorf("supporter-exclusive err = %v; want ErrSupporterExclusive", err)
	}
	if err := svc.Purchase(uid, "decoration.staff"); !errors.Is(err, ErrNotPurchasable) {
		t.Errorf("price-0 item err = %v; want ErrNotPurchasable", err)
	}
}

func TestEquipOwnership(t *testing.T) {
	svc, led, _, uid := newSvc(t)

	if err := svc.Equip(uid, "robber", "robber.sentinel"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("equip unowned err = %v; want ErrNotOwned", err)
	}
	led.Grant(uid, 500, "grant", "seed")
	svc.Purchase(uid, "robber.sentinel")
	if err := svc.Equip(uid, "robber", "robber.sentinel"); err != nil {
		t.Fatalf("equip owned: %v", err)
	}
	// Wrong slot for the item (a robber in the decoration slot).
	if err := svc.Equip(uid, "decoration", "robber.sentinel"); !errors.Is(err, ErrWrongSlot) {
		t.Fatalf("wrong-slot err = %v; want ErrWrongSlot", err)
	}
	lo, _ := svc.Loadout(uid)
	if lo["robber"] != "robber.sentinel" {
		t.Fatalf("loadout robber = %q", lo["robber"])
	}
}

func TestColorGatingAndKeep(t *testing.T) {
	svc, _, st, uid := newSvc(t)

	// Free color: always equippable.
	if err := svc.Equip(uid, "color", "color.ff0000"); err != nil {
		t.Fatalf("equip free color: %v", err)
	}
	// Supporter color (a non-free cube color) while not a supporter: rejected.
	if err := svc.Equip(uid, "color", "color.aa00aa"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("locked supporter color err = %v; want ErrNotOwned", err)
	}

	// Become a supporter: now equippable, and equipping locks it in forever.
	st.SetSupporter(uid, true, false, false, false, false, 0)
	if err := svc.Equip(uid, "color", "color.aa00aa"); err != nil {
		t.Fatalf("equip supporter color: %v", err)
	}
	if has, _ := st.HasEntitlement(uid, "color.aa00aa"); !has {
		t.Fatal("supporter color not entitled after use (keep-what-you-used broken)")
	}

	// Lapse: the used color is kept (entitled), still equippable.
	st.SetSupporter(uid, false, false, false, false, false, 0)
	if err := svc.Equip(uid, "color", "color.aa00aa"); err != nil {
		t.Fatalf("re-equip kept color after lapse: %v", err)
	}
	// But an unused supporter color is gone again.
	if err := svc.Equip(uid, "color", "color.0000aa"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("unused supporter color after lapse err = %v; want ErrNotOwned", err)
	}
}

// TestPointOfUseRefreshClosesExploit is the boost, login, un-boost case: the
// cached snapshot still says "supporter", but a point-of-use re-check pulls the
// (now removed) roles and denies the perk.
func TestPointOfUseRefreshClosesExploit(t *testing.T) {
	svc, _, st, uid := newSvc(t)

	// Cache says supporter (they boosted earlier and logged in)...
	st.SetSupporter(uid, true, false, false, false, false, 0)
	// ...but the live re-check finds the boost gone.
	ref := &fakeRefresh{st: st, active: false}
	svc.SetRefresher(ref)

	if err := svc.Equip(uid, "color", "color.aa00aa"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("equip after un-boost = %v; want ErrNotOwned", err)
	}
	if ref.calls != 1 {
		t.Fatalf("point-of-use refresh calls = %d; want 1", ref.calls)
	}
}

// TestPointOfUseRefreshGrantsWhenValid is the inverse: a stale "not supporter"
// cache is corrected by the live re-check, so a current booster isn't blocked.
func TestPointOfUseRefreshGrantsWhenValid(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	ref := &fakeRefresh{st: st, active: true} // live check confirms supporter
	svc.SetRefresher(ref)

	if err := svc.Equip(uid, "color", "color.aa00aa"); err != nil {
		t.Fatalf("equip with live-confirmed supporter: %v", err)
	}
	if has, _ := st.HasEntitlement(uid, "color.aa00aa"); !has {
		t.Fatal("used supporter color should be kept")
	}
}

func TestBoosterDecorationGating(t *testing.T) {
	svc, _, st, uid := newSvc(t)

	// Active supporter but not boosting: can equip fire, not sparkle.
	st.SetSupporter(uid, true, false, false, false, false, 0)
	if err := svc.Equip(uid, "decoration", "decoration.supporter"); err != nil {
		t.Fatalf("equip fire as supporter: %v", err)
	}
	if err := svc.Equip(uid, "decoration", "decoration.booster"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("equip sparkle as non-booster = %v; want ErrNotOwned", err)
	}

	// Now boosting: sparkle becomes equippable.
	st.SetSupporter(uid, true, true, false, false, false, 0)
	if err := svc.Equip(uid, "decoration", "decoration.booster"); err != nil {
		t.Fatalf("equip sparkle as booster: %v", err)
	}
}

func TestBoosterPointOfUseRefresh(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	st.SetSupporter(uid, true, true, false, false, false, 0)              // cache says boosting...
	svc.SetRefresher(&fakeRefresh{st: st, active: true, boosting: false}) // ...but live re-check finds boost gone.

	if err := svc.Equip(uid, "decoration", "decoration.booster"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("equip sparkle after un-boost = %v; want ErrNotOwned", err)
	}
}

func TestBoosterDecorationLocked(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	st.SetSupporter(uid, true, false, false, false, false, 0) // active supporter, not boosting

	cat, err := svc.Catalog(uid)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]ItemView{}
	for _, v := range cat {
		byID[v.ID] = v
	}
	if fire := byID["decoration.supporter"]; fire.Locked || !fire.Owned {
		t.Fatalf("fire for supporter = %+v; want owned, unlocked", fire)
	}
	if sparkle := byID["decoration.booster"]; !sparkle.Locked || sparkle.Owned {
		t.Fatalf("sparkle for non-booster = %+v; want locked, not owned", sparkle)
	}
}

func TestUseColor(t *testing.T) {
	svc, _, st, uid := newSvc(t)

	// Free colors are always usable and don't create an entitlement.
	col, err := svc.UseColor(uid, "color.ff0000")
	if err != nil {
		t.Fatalf("use free color: %v", err)
	}
	if col.Hex != "#ff0000" {
		t.Fatalf("free color hex = %q; want #ff0000", col.Hex)
	}
	if has, _ := st.HasEntitlement(uid, "color.ff0000"); has {
		t.Fatal("free color should not be entitled")
	}

	// Unknown color id rejected.
	if _, err := svc.UseColor(uid, "color.zzzzzz"); !errors.Is(err, ErrUnknownColor) {
		t.Errorf("unknown color err = %v; want ErrUnknownColor", err)
	}

	// Supporter color without status is rejected.
	if _, err := svc.UseColor(uid, "color.aa00aa"); !errors.Is(err, ErrNotOwned) {
		t.Errorf("locked supporter color err = %v; want ErrNotOwned", err)
	}

	// As an active supporter, using a supporter color grants the keep-forever
	// entitlement (point-of-use re-check via the refresher).
	svc.SetRefresher(&fakeRefresh{st: st, active: true})
	if _, err := svc.UseColor(uid, "color.aa00aa"); err != nil {
		t.Fatalf("use supporter color: %v", err)
	}
	if has, _ := st.HasEntitlement(uid, "color.aa00aa"); !has {
		t.Fatal("used supporter color should be kept")
	}
}

func TestDefaultSeatColorDistinct(t *testing.T) {
	// Verify the seat-order mapping wraps and stays in the (mutually distinct)
	// free set.
	for n := range FreeCount {
		c := DefaultSeatColor(n)
		if !c.Free {
			t.Errorf("DefaultSeatColor(%d) = %s, not free", n, c.ID)
		}
	}
	if DefaultSeatColor(FreeCount).ID != DefaultSeatColor(0).ID {
		t.Error("seat-order default should wrap at FreeCount")
	}
	if _, ok := ColorByHex("#FF0000"); !ok {
		t.Error("ColorByHex should resolve a known hex case-insensitively")
	}
}

func TestColorsAvailability(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	st.SetSupporter(uid, true, false, false, false, false, 0)
	colors, err := svc.Colors(uid)
	if err != nil {
		t.Fatal(err)
	}
	if len(colors) != 64 {
		t.Fatalf("colors = %d; want 64", len(colors))
	}
	// Supporter status covers the free set and the supporter half, but not the
	// shelf: a priced color must be bought.
	for _, c := range colors {
		switch {
		case c.Price > 0 && c.Available:
			t.Errorf("supporter sees shelf color %s as available without buying it", c.ID)
		case c.Price == 0 && !c.Available:
			t.Errorf("supporter should see %s available", c.ID)
		}
	}
}

// withFixtureItem appends a catalog row for the duration of one test.
//
// The catalog is compiled in, so tests that need a specific item add one here.
func withFixtureItem(t *testing.T, it Item) {
	t.Helper()
	Catalog = append(Catalog, it)
	catalogByID[it.ID] = it
	t.Cleanup(func() {
		Catalog = Catalog[:len(Catalog)-1]
		delete(catalogByID, it.ID)
	})
}

// A robber is an ordinary Pip purchase: it debits once, re-buying is a no-op,
// and it equips into its own slot and no other.
func TestRobberSlotPurchaseAndEquip(t *testing.T) {
	svc, led, st, uid := newSvc(t)
	withFixtureItem(t, Item{ID: "robber.test", Slot: SlotRobber, Name: "Test Robber", Price: 400})
	if _, err := led.Grant(uid, 500, "grant", "test:seed"); err != nil {
		t.Fatal(err)
	}

	if err := svc.Purchase(uid, "robber.test"); err != nil {
		t.Fatalf("Purchase: %v", err)
	}
	if bal, _ := led.Balance(uid); bal != 100 {
		t.Fatalf("balance after purchase = %d, want 100", bal)
	}
	// Re-buying something you own is a no-op, not a second charge.
	if err := svc.Purchase(uid, "robber.test"); err != nil {
		t.Fatalf("re-Purchase: %v", err)
	}
	if bal, _ := led.Balance(uid); bal != 100 {
		t.Fatalf("balance after re-purchase = %d, want 100 (idempotent)", bal)
	}

	if err := svc.Equip(uid, string(SlotRobber), "robber.test"); err != nil {
		t.Fatalf("Equip: %v", err)
	}
	lo, _ := st.Loadout(uid)
	if lo[string(SlotRobber)] != "robber.test" {
		t.Fatalf("loadout robber = %q, want robber.test", lo[string(SlotRobber)])
	}
	if err := svc.Equip(uid, string(SlotDecoration), "robber.test"); !errors.Is(err, ErrWrongSlot) {
		t.Fatalf("Equip into decoration = %v, want ErrWrongSlot", err)
	}
}

// A robber you have not bought cannot be equipped, however you ask.
func TestRobberCannotBeEquippedUnowned(t *testing.T) {
	svc, _, _, uid := newSvc(t)
	withFixtureItem(t, Item{ID: "robber.test", Slot: SlotRobber, Name: "Test Robber", Price: 400})

	if err := svc.Equip(uid, string(SlotRobber), "robber.test"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("Equip unowned = %v, want ErrNotOwned", err)
	}
}

// Buying without the Pips fails, and fails without taking anything.
func TestRobberPurchaseNeedsTheBalance(t *testing.T) {
	svc, led, _, uid := newSvc(t)
	withFixtureItem(t, Item{ID: "robber.test", Slot: SlotRobber, Name: "Test Robber", Price: 400})
	if _, err := led.Grant(uid, 399, "grant", "test:seed"); err != nil {
		t.Fatal(err)
	}

	if err := svc.Purchase(uid, "robber.test"); !errors.Is(err, econ.ErrInsufficientFunds) {
		t.Fatalf("Purchase without funds = %v, want ErrInsufficientFunds", err)
	}
	if bal, _ := led.Balance(uid); bal != 399 {
		t.Fatalf("balance after failed purchase = %d, want 399", bal)
	}
}

// An item can carry a role gate and a price: the Brigand robber is free for
// staff and 350 for everyone else.
func TestPricedRoleItemIsBuyableAndFree(t *testing.T) {
	svc, led, st, uid := newSvc(t)
	if _, err := led.Grant(uid, 1000, "grant", "test:seed"); err != nil {
		t.Fatal(err)
	}

	// No role: it is on sale, not locked, and buying it works.
	items, err := svc.Catalog(uid)
	if err != nil {
		t.Fatal(err)
	}
	brigand := findItem(t, items, "robber.brigand")
	if brigand.Owned {
		t.Error("brigand owned without a role or a purchase")
	}
	if brigand.Locked {
		t.Error("brigand is locked, want unlocked")
	}
	if err := svc.Purchase(uid, "robber.brigand"); err != nil {
		t.Fatalf("Purchase: %v", err)
	}
	if bal, _ := led.Balance(uid); bal != 650 {
		t.Fatalf("balance = %d, want 650", bal)
	}

	// Staff owns it outright, without buying it.
	other, err := st.CreateGuest("staffer")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetSupporter(other.ID, false, false, false, true, false, 0); err != nil {
		t.Fatal(err)
	}
	items, err = svc.Catalog(other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !findItem(t, items, "robber.brigand").Owned {
		t.Error("staff does not own the brigand")
	}

	// A supporter does not: this one is staff's alone to be given.
	sup, err := st.CreateGuest("supporter")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetSupporter(sup.ID, true, true, true, false, false, 0); err != nil {
		t.Fatal(err)
	}
	items, err = svc.Catalog(sup.ID)
	if err != nil {
		t.Fatal(err)
	}
	if findItem(t, items, "robber.brigand").Owned {
		t.Error("a supporter owns the brigand; only staff should")
	}
}

// The effects are ordinary stock, except the gift role's three (see
// TestGiftDecorationsCatalog).
func TestEffectsAreOnSale(t *testing.T) {
	svc, led, st, uid := newSvc(t)
	if _, err := led.Grant(uid, 10_000, "grant", "test:seed"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Purchase(uid, "decoration.fire_blue"); err != nil {
		t.Fatalf("Purchase fire: %v", err)
	}
	if bal, _ := led.Balance(uid); bal != 5000 {
		t.Fatalf("balance after a fire = %d, want 5000", bal)
	}
	if err := svc.Purchase(uid, "decoration.sparkle_teal"); err != nil {
		t.Fatalf("Purchase sparkle: %v", err)
	}
	if bal, _ := led.Balance(uid); bal != 2500 {
		t.Fatalf("balance after a sparkle = %d, want 2500", bal)
	}

	// The gift role owns its three monochrome fires without buying them, and
	// nobody can buy those at all.
	gifted, err := st.CreateGuest("gifted")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetSupporter(gifted.ID, false, false, false, false, true, 0); err != nil {
		t.Fatal(err)
	}
	items, err := svc.Catalog(gifted.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !findItem(t, items, "decoration.fire_black").Owned {
		t.Error("the gift role does not own the black fire")
	}
	if err := svc.Purchase(uid, "decoration.fire_black"); !errors.Is(err, ErrNotPurchasable) {
		t.Errorf("buying a handout = %v, want ErrNotPurchasable", err)
	}
	// And it reads as locked for everyone else, which is what the store shows
	// as "unavailable".
	plain, _ := svc.Catalog(uid)
	if !findItem(t, plain, "decoration.fire_black").Locked {
		t.Error("the black fire should read as locked without the gift role")
	}
}

// The role-exclusive set is unchanged: no price, so no way in but the role.
func TestRoleExclusivesStayUnbuyable(t *testing.T) {
	svc, led, _, uid := newSvc(t)
	if _, err := led.Grant(uid, 10_000, "grant", "test:seed"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Purchase(uid, "decoration.supporter"); !errors.Is(err, ErrSupporterExclusive) {
		t.Errorf("buying the supporter decoration = %v, want ErrSupporterExclusive", err)
	}
	if err := svc.Purchase(uid, "decoration.staff"); !errors.Is(err, ErrNotPurchasable) {
		t.Errorf("buying the staff decoration = %v, want ErrNotPurchasable", err)
	}
	items, _ := svc.Catalog(uid)
	if !findItem(t, items, "decoration.staff").Locked {
		t.Error("an unpriced role item should read as locked")
	}
}

func findItem(t *testing.T, items []ItemView, id string) ItemView {
	t.Helper()
	for _, it := range items {
		if it.ID == id {
			return it
		}
	}
	t.Fatalf("no %s in the catalog", id)
	return ItemView{}
}
