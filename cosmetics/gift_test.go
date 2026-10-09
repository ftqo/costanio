package cosmetics

import (
	"errors"
	"strings"
	"testing"
)

// giftItems returns the catalog ids of the gift-gated decorations.
func giftItems() []string {
	var ids []string
	for _, it := range Catalog {
		if it.Gift {
			ids = append(ids, it.ID)
		}
	}
	return ids
}

// TestGiftDecorationsCatalog: the gift role's set is exactly the three
// monochrome fires, and they are not for sale (no price, so the store shows
// them as unavailable).
func TestGiftDecorationsCatalog(t *testing.T) {
	ids := giftItems()
	want := []string{"decoration.fire_black", "decoration.fire_grey", "decoration.fire_white"}
	if len(ids) != len(want) {
		t.Fatalf("gift decorations = %v; want %v", ids, want)
	}
	for i, id := range ids {
		if id != want[i] {
			t.Errorf("gift decoration %d = %s; want %s", i, id, want[i])
		}
		it, _ := ItemByID(id)
		if it.Slot != SlotDecoration || !it.Gift || it.Price != 0 {
			t.Errorf("%s = %+v; want decoration slot, Gift, price 0", id, it)
		}
	}
}

// Every other effect is ordinary stock: priced, and gated by nothing.
func TestEffectsOnSale(t *testing.T) {
	for _, it := range Catalog {
		if it.Slot != SlotDecoration || !strings.HasPrefix(it.ID, "decoration.fire_") &&
			!strings.HasPrefix(it.ID, "decoration.sparkle_") {
			continue
		}
		if it.Gift {
			continue // the three handouts, covered above
		}
		want := 2500
		if strings.HasPrefix(it.ID, "decoration.fire_") {
			want = 5000
		}
		if it.Price != want {
			t.Errorf("%s price = %d; want %d", it.ID, it.Price, want)
		}
		if it.Supporter || it.Booster || it.Kofi || it.Staff {
			t.Errorf("%s is role-gated, want no gate", it.ID)
		}
	}
}

// TestGiftDecorationGating: a gift decoration is owned/equippable only while the
// user holds the gift role; a plain active supporter does not own it.
func TestGiftDecorationGating(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	gift := giftItems()[0]

	// Active supporter but not gift: locked.
	st.SetSupporter(uid, true, false, false, false, false, 0)
	if err := svc.Equip(uid, "decoration", gift); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("equip gift decoration as non-gift supporter = %v; want ErrNotOwned", err)
	}

	// Gift role held: now owned and equippable.
	st.SetSupporter(uid, true, false, false, false, true, 0)
	if err := svc.Equip(uid, "decoration", gift); err != nil {
		t.Fatalf("equip gift decoration as gift holder: %v", err)
	}
}

// TestGiftDecorationsHiddenUnlessOwned: in the catalog view, gift decorations are
// only "owned" for gift holders; for everyone else they're not owned (the client
// hides not-owned gift items, like staff).
func TestGiftDecorationsHiddenUnlessOwned(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	gift := giftItems()[0]

	// Plain supporter: the gift item exists in the view but is not owned.
	st.SetSupporter(uid, true, false, false, false, false, 0)
	cat, err := svc.Catalog(uid)
	if err != nil {
		t.Fatal(err)
	}
	view := func() ItemView {
		for _, v := range cat {
			if v.ID == gift {
				return v
			}
		}
		t.Fatalf("gift item %s missing from catalog", gift)
		return ItemView{}
	}
	if v := view(); v.Owned {
		t.Fatalf("gift item owned by non-gift supporter: %+v", v)
	}

	// Gift holder: owned.
	st.SetSupporter(uid, true, false, false, false, true, 0)
	cat, _ = svc.Catalog(uid)
	if v := view(); !v.Owned {
		t.Fatalf("gift item not owned by gift holder: %+v", v)
	}
}

// TestGiftConfersBotGamePerk: the gift role makes IsSupporter true (it sets
// Active), which is the gate lobby.Start uses for bot-only games.
func TestGiftConfersBotGamePerk(t *testing.T) {
	svc, _, st, uid := newSvc(t)
	st.SetSupporter(uid, true, false, false, false, true, 0) // active via gift
	ok, err := svc.IsSupporter(uid)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("gift holder should pass IsSupporter (bot-only game perk)")
	}
}
