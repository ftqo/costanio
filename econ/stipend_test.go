package econ

import "testing"

// TestStipendFlow: the monthly supporter stipend is granted once per calendar
// month per user, and ActiveSupporters surfaces exactly who should receive it.
func TestStipendFlow(t *testing.T) {
	led, st := openLedger(t)

	sub, _ := st.CreateGuest("sub")
	lapsed, _ := st.CreateGuest("lapsed")
	plain, _ := st.CreateGuest("plain")

	if err := st.SetSupporter(sub.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	// lapsed was a supporter but isn't active now.
	st.SetSupporter(lapsed.ID, true, false, false, false, false, 0)
	st.SetSupporter(lapsed.ID, false, false, false, false, false, 0)

	ids, err := st.ActiveSupporters()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != sub.ID {
		t.Fatalf("ActiveSupporters = %v; want only %d", ids, sub.ID)
	}
	_ = plain // never a supporter, so must not appear (asserted by the count above)

	// First grant credits the stipend; repeats in the same month are no-ops.
	bal, err := led.Stipend(sub.ID)
	if err != nil || bal != StipendPayout {
		t.Fatalf("first stipend = %d, %v; want %d", bal, err, StipendPayout)
	}
	bal2, _ := led.Stipend(sub.ID)
	if bal2 != StipendPayout {
		t.Fatalf("second stipend (same month) = %d; want no double-credit (%d)", bal2, StipendPayout)
	}
}
