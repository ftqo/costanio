package cosmetics

import (
	"errors"
	"testing"
)

// The six art-heavy ids reserved for v2. They have a name and a price but no
// art. The store UI hides them, but `POST /api/cosmetics/{id}/purchase` must
// refuse them too.
var reservedIDs = []string{
	"dice.bone", "dice.gem",
	"pieces.driftwood", "pieces.obsidian",
	"board.parchment", "board.aurora",
}

// Reserved items have a price, so the Price <= 0 gate alone would sell them.
func TestReservedItemsAreNotPurchasable(t *testing.T) {
	svc, led, st, uid := newSvc(t)
	if _, err := led.Grant(uid, 100_000, "grant", "test:seed"); err != nil {
		t.Fatal(err)
	}
	before, _ := led.Balance(uid)

	for _, id := range reservedIDs {
		it, ok := ItemByID(id)
		if !ok {
			t.Fatalf("%s is not in the catalog", id)
		}
		if !it.Reserved {
			t.Errorf("%s is not marked Reserved", id)
		}
		// The price stays real: zeroing it would make these look like gated
		// items, which they are not.
		if it.Price <= 0 {
			t.Errorf("%s has no price", id)
		}
		if err := svc.Purchase(uid, id); !errors.Is(err, ErrNotPurchasable) {
			t.Errorf("Purchase(%s) = %v, want ErrNotPurchasable", id, err)
		}
		if has, err := st.HasEntitlement(uid, id); err != nil {
			t.Fatal(err)
		} else if has {
			t.Errorf("Purchase(%s) refused but entitlement granted", id)
		}
	}

	if after, _ := led.Balance(uid); after != before {
		t.Errorf("refused purchases charged %d Pips (%d -> %d)", before-after, before, after)
	}
}

// A reserved item must read as Locked in the catalog view, or the client sees
// price>0 && !locked and draws a Buy button.
func TestReservedItemsShowAsLocked(t *testing.T) {
	svc, _, _, uid := newSvc(t)
	view, err := svc.Catalog(uid)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]ItemView{}
	for _, v := range view {
		byID[v.ID] = v
	}
	for _, id := range reservedIDs {
		v, ok := byID[id]
		if !ok {
			t.Fatalf("%s missing from the catalog view", id)
		}
		if !v.Locked {
			t.Errorf("%s is not Locked", id)
		}
		if v.Owned {
			t.Errorf("%s is owned by a fresh account", id)
		}
	}
}

// Price alone decides whether Pips can buy an item, even when it is also
// role-gated (robber.brigand: Price 350 and Staff). The frontend's store uses
// the same rule; its half of this test is in Store.test.tsx.
func TestPriceAloneDecidesPurchasability(t *testing.T) {
	svc, led, _, uid := newSvc(t)
	if _, err := led.Grant(uid, 1_000_000, "grant", "test:seed"); err != nil {
		t.Fatal(err)
	}
	for _, it := range Catalog {
		err := svc.Purchase(uid, it.ID)
		buyable := it.Price > 0 && !it.Reserved
		switch {
		case buyable && err != nil:
			t.Errorf("%s (price %d) is on the Pips shelf but Purchase said %v", it.ID, it.Price, err)
		case !buyable && err == nil:
			t.Errorf("%s (price %d, reserved=%v) is not on the Pips shelf but Purchase succeeded",
				it.ID, it.Price, it.Reserved)
		}
	}
}
