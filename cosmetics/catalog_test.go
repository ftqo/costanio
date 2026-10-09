package cosmetics

import "testing"

func TestDecorationCatalog(t *testing.T) {
	sup, ok := ItemByID("decoration.supporter")
	if !ok || sup.Slot != SlotDecoration || !sup.Supporter || sup.Booster || sup.Price != 0 {
		t.Fatalf("decoration.supporter = %+v, ok=%v; want decoration slot, Supporter, not Booster, price 0", sup, ok)
	}
	boost, ok := ItemByID("decoration.booster")
	if !ok || boost.Slot != SlotDecoration || boost.Supporter || !boost.Booster || boost.Price != 0 {
		t.Fatalf("decoration.booster = %+v, ok=%v; want decoration slot, Booster, not Supporter, price 0", boost, ok)
	}
}
