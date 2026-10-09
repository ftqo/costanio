package supporter

import "testing"

func cfg(t *testing.T, s string) Config {
	t.Helper()
	c, err := ParseConfig(s)
	if err != nil {
		t.Fatalf("ParseConfig(%q): %v", s, err)
	}
	return c
}

func TestEvaluate(t *testing.T) {
	c := cfg(t, "sub1:subscription, boost1:boost, gift1:gift")

	cases := []struct {
		name     string
		roles    []string
		active   bool
		via      Kind
		boosting bool
	}{
		{"none", []string{"other", "x"}, false, "", false},
		{"gift only", []string{"gift1"}, true, KindGift, false},
		{"boost only", []string{"boost1", "noise"}, true, KindBoost, true},
		{"sub only", []string{"sub1"}, true, KindSubscription, false},
		{"sub beats boost but still boosting", []string{"boost1", "sub1"}, true, KindSubscription, true},
		{"boost beats gift", []string{"gift1", "boost1"}, true, KindBoost, true},
		{"empty roles", nil, false, "", false},
	}
	for _, tc := range cases {
		got := c.Evaluate(tc.roles)
		if got.Active != tc.active || got.Via != tc.via || got.Boosting != tc.boosting {
			t.Errorf("%s: Evaluate = {%v %q boost=%v}; want {%v %q boost=%v}",
				tc.name, got.Active, got.Via, got.Boosting, tc.active, tc.via, tc.boosting)
		}
	}
}

// TestGiftFlag: the gift role sets Gift (so the gift-only decorations unlock) and
// also Active (so the bot-only-game perk works), while the other supporter kinds
// confer Active without Gift.
func TestGiftFlag(t *testing.T) {
	c := cfg(t, "sub1:subscription, boost1:boost, gift1:gift")

	if st := c.Evaluate([]string{"gift1"}); !st.Gift || !st.Active {
		t.Errorf("gift role = %+v; want Gift && Active (bot games)", st)
	}
	if st := c.Evaluate([]string{"sub1"}); st.Gift || !st.Active {
		t.Errorf("subscription role = %+v; want Active without Gift", st)
	}
	if st := c.Evaluate([]string{"boost1"}); st.Gift {
		t.Errorf("boost role = %+v; want Gift=false", st)
	}
	if st := c.Evaluate([]string{"other"}); st.Gift || st.Active {
		t.Errorf("non-granting role = %+v; want neither", st)
	}
}

// TestMultipleRolesPerKind: several distinct Discord roles can map to the same
// kind (e.g. two Ko-fi roles), and holding any of them grants that perk.
func TestMultipleRolesPerKind(t *testing.T) {
	c := cfg(t, "kofiA:kofi, kofiB:kofi, subA:subscription, subB:subscription, staffA:staff, staffB:staff")

	if !c.Evaluate([]string{"kofiA"}).Kofi || !c.Evaluate([]string{"kofiB"}).Kofi {
		t.Error("either Ko-fi role should grant the kofi perk")
	}
	if !c.Evaluate([]string{"staffB"}).Staff {
		t.Error("either staff role should grant the staff perk")
	}
	// A second supporter role of the same kind is still just "active".
	if st := c.Evaluate([]string{"subA", "subB"}); !st.Active || st.Via != KindSubscription {
		t.Errorf("two subscription roles = %+v; want active subscription", st)
	}
	// Kofi/staff roles never confer supporter status.
	if st := c.Evaluate([]string{"kofiA", "staffA"}); st.Active {
		t.Errorf("perk-only roles should not be active: %+v", st)
	}
}

func TestParseConfig(t *testing.T) {
	c := cfg(t, " 111:subscription , 222:boost ,333, ")
	if len(c.Roles) != 3 {
		t.Fatalf("roles = %d; want 3", len(c.Roles))
	}
	if c.Roles["111"] != KindSubscription || c.Roles["222"] != KindBoost {
		t.Fatalf("kinds wrong: %v", c.Roles)
	}
	if c.Roles["333"] != KindGift { // bare id defaults to gift
		t.Fatalf("bare id kind = %q; want gift", c.Roles["333"])
	}

	if empty, _ := ParseConfig("   "); !empty.Empty() {
		t.Error("blank config should be Empty()")
	}
	if _, err := ParseConfig("123:platinum"); err == nil {
		t.Error("unknown kind should error")
	}
	if _, err := ParseConfig(":boost"); err == nil {
		t.Error("empty role id should error")
	}
}
