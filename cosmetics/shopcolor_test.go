package cosmetics

import (
	"errors"
	"strings"
	"testing"
)

// Every cube color has a real name, since the store, purchase confirmation and
// ledger quote it.
func TestEveryColorIsNamed(t *testing.T) {
	for _, c := range Palette {
		if c.Name == "" {
			t.Errorf("%s has no name", c.ID)
			continue
		}
		if strings.EqualFold(c.Name, strings.TrimPrefix(c.Hex, "#")) {
			t.Errorf("%s is named after its own hex (%q)", c.ID, c.Name)
		}
	}
	seen := map[string]string{}
	for _, c := range Palette {
		if prev, dup := seen[c.Name]; dup {
			t.Errorf("name %q is used by both %s and %s", c.Name, prev, c.ID)
		}
		seen[c.Name] = c.ID
	}
}

// A color you can buy must always be wearable: every shop color clears every
// free preset (what unpicked seats default to) by ColorThreshold.
func TestShopColorsClearTheFreeSet(t *testing.T) {
	for _, hex := range shopColors {
		c, ok := ColorByHex(hex)
		if !ok {
			t.Fatalf("shop color %s is not in the palette", hex)
		}
		if c.Free {
			t.Errorf("%s is a free preset but on the shelf", c.ID)
		}
		for _, f := range Palette[:FreeCount] {
			if d := c.DeltaE(f); d < ColorThreshold {
				t.Errorf("shop color %s (%s) is ΔE %.1f from free %s, below threshold",
					c.Name, c.ID, d, f.Name)
			}
		}
	}
}

// And they must clear each other, so two players who both bought from the shelf
// can sit at the same table.
func TestShopColorsClearEachOther(t *testing.T) {
	cs := make([]Color, 0, len(shopColors))
	for _, hex := range shopColors {
		c, _ := ColorByHex(hex)
		cs = append(cs, c)
	}
	for i := range cs {
		for j := i + 1; j < len(cs); j++ {
			if d := cs[i].DeltaE(cs[j]); d < ColorThreshold {
				t.Errorf("shop colors %s and %s are ΔE %.1f apart, below threshold",
					cs[i].Name, cs[j].Name, d)
			}
		}
	}
}

// A priced color is a catalog row (what Purchase charges against), with the
// same price as the palette.
func TestShopColorsAreCatalogItems(t *testing.T) {
	for _, hex := range shopColors {
		id := colorID(hex)
		it, ok := ItemByID(id)
		if !ok {
			t.Errorf("%s has no catalog item", id)
			continue
		}
		if it.Slot != SlotColor {
			t.Errorf("%s is in slot %q; want %q", id, it.Slot, SlotColor)
		}
		if it.Price != ColorPrice {
			t.Errorf("%s costs %d in the catalog; want %d", id, it.Price, ColorPrice)
		}
		if it.Supporter || it.Booster || it.Kofi || it.Staff || it.Gift {
			t.Errorf("%s is role-gated as well as priced", id)
		}
		c, _ := ColorByHex(hex)
		if c.Price != it.Price {
			t.Errorf("%s: palette price %d, catalog price %d", id, c.Price, it.Price)
		}
	}
	// Nothing else in the palette claims a price.
	priced := map[string]bool{}
	for _, hex := range shopColors {
		priced[colorID(hex)] = true
	}
	for _, c := range Palette {
		if c.Price != 0 && !priced[c.ID] {
			t.Errorf("%s carries a price but is not on the shelf", c.ID)
		}
	}
}

// Buying a color grants the same entitlement equipping one does, so a purchase
// survives a lapse in supporter status and is honored by both the loadout path
// and the per-seat path.
func TestPurchaseColorMakesItAvailable(t *testing.T) {
	svc, led, _, uid := newSvc(t)
	id := colorID(shopColors[0])

	if err := svc.Equip(uid, "color", id); err == nil {
		t.Fatal("equipping an unbought shop color should fail")
	}

	if _, err := led.Grant(uid, ColorPrice, "grant", "test:seed"); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if err := svc.Purchase(uid, id); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	if err := svc.Equip(uid, "color", id); err != nil {
		t.Fatalf("equip after purchase: %v", err)
	}
	if _, err := svc.UseColor(uid, id); err != nil {
		t.Fatalf("use after purchase: %v", err)
	}

	colors, err := svc.Colors(uid)
	if err != nil {
		t.Fatalf("colors: %v", err)
	}
	for _, c := range colors {
		if c.ID != id {
			continue
		}
		if !c.Available {
			t.Errorf("%s is not available after purchase", id)
		}
		if c.Price != ColorPrice {
			t.Errorf("%s price = %d; want %d", id, c.Price, ColorPrice)
		}
	}

	// Idempotent, and it does not charge twice: the second buy is a no-op.
	bal, err := led.Balance(uid)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if err := svc.Purchase(uid, id); err != nil {
		t.Fatalf("re-purchase: %v", err)
	}
	if got, _ := led.Balance(uid); got != bal {
		t.Errorf("re-purchase charged again: balance %d, want %d", got, bal)
	}
}

// A supporter-only color is still not for sale: the store must not offer a Buy
// button for one, and the API must refuse if it somehow does.
func TestSupporterOnlyColorIsNotPurchasable(t *testing.T) {
	svc, led, _, uid := newSvc(t)
	if _, err := led.Grant(uid, 10*ColorPrice, "grant", "test:seed"); err != nil {
		t.Fatalf("grant: %v", err)
	}
	// #ff55ff (Pink) is supporter-only: it sits 5.5 from free Magenta. It is a
	// real color, so the refusal says "not purchasable", not "no such item".
	if err := svc.Purchase(uid, "color.ff55ff"); !errors.Is(err, ErrNotPurchasable) {
		t.Fatalf("purchase of a supporter-only color = %v; want ErrNotPurchasable", err)
	}
	if err := svc.Purchase(uid, "color.zzzzzz"); !errors.Is(err, ErrUnknownItem) {
		t.Fatalf("purchase of a non-color = %v; want ErrUnknownItem", err)
	}
}

// Supporter status must not grant a shelf color.
func TestSupporterDoesNotGetShelfColorsFree(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	st.SetSupporter(uid, true, true, true, true, true, 0)
	id := colorID(shopColors[0])

	if err := svc.Equip(uid, "color", id); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("supporter equipping an unbought shelf color = %v; want ErrNotOwned", err)
	}
	if _, err := svc.UseColor(uid, id); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("supporter using an unbought shelf color = %v; want ErrNotOwned", err)
	}

	// And the supporter half still comes with the status, unbought.
	if _, err := svc.UseColor(uid, "color.ff55ff"); err != nil {
		t.Fatalf("supporter using a supporter color: %v", err)
	}
}

// The keg is the support robber: any one of the three routes carries it, and it
// reverts when the last of them lapses.
func TestKegFollowsAnySupportRole(t *testing.T) {
	svc, _, st, uid := newSvc(t)

	owned := func() bool {
		t.Helper()
		views, err := svc.Catalog(uid)
		if err != nil {
			t.Fatal(err)
		}
		for _, v := range views {
			if v.ID == "robber.keg" {
				return v.Owned && !v.Locked
			}
		}
		t.Fatal("robber.keg missing from the catalog")
		return false
	}

	for _, role := range []struct {
		name                                    string
		active, boosting, kofi, staff, giftRole bool
	}{
		{name: "supporter", active: true},
		{name: "booster", boosting: true},
		{name: "kofi", kofi: true},
	} {
		st.SetSupporter(uid, role.active, role.boosting, role.kofi, role.staff, role.giftRole, 0)
		if !owned() {
			t.Errorf("%s should have the keg", role.name)
		}
	}

	// Every role gone: the robber is no longer owned (nothing is deleted).
	st.SetSupporter(uid, false, false, false, false, false, 0)
	if owned() {
		t.Error("the keg should revert once every support role is gone")
	}

	// Not for sale at any balance.
	if err := svc.Purchase(uid, "robber.keg"); !errors.Is(err, ErrSupporterExclusive) {
		t.Fatalf("buying the keg = %v; want ErrSupporterExclusive", err)
	}
}
