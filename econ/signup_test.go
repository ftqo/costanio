package econ

import "testing"

// The welcome grant pays every new account once. Repeat calls (every login
// path calls it) are no-ops, and one player's grant is not another's.
func TestSignupGrantOncePerUser(t *testing.T) {
	led, st := openLedger(t)

	a, _ := st.CreateGuest("a")
	b, _ := st.CreateGuest("b")

	bal, err := led.Signup(a.ID)
	if err != nil || bal != SignupPayout {
		t.Fatalf("first signup grant = %d, %v; want %d", bal, err, SignupPayout)
	}
	bal2, err := led.Signup(a.ID)
	if err != nil || bal2 != SignupPayout {
		t.Fatalf("second signup grant = %d, %v; want no double-credit (%d)", bal2, err, SignupPayout)
	}
	if bal, err := led.Balance(b.ID); err != nil || bal != 0 {
		t.Fatalf("untouched user balance = %d, %v; want 0", bal, err)
	}
	if bal, err := led.Signup(b.ID); err != nil || bal != SignupPayout {
		t.Fatalf("second user's grant = %d, %v; want %d", bal, err, SignupPayout)
	}
}
