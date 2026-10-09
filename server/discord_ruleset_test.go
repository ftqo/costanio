package server

import "testing"

func TestRulesetLabel(t *testing.T) {
	cases := []struct{ rs, want string }{
		{"", "Base"},
		{"base", "Base"},
		{"base+islands", "Islands"},
		{"base+cak", "Knights"},
		{"base+fishermen", "Fishermen"},
		{"base+caravans", "Caravans"},
		{"base+islands+cak", "Islands and Knights"},
		{"base+cak+islands", "Knights and Islands"},
		{"base+islands+cak+fishermen", "Islands, Knights and Fishermen"},
		{"base+mystery", "Mystery"},
	}
	for _, c := range cases {
		if got := rulesetLabel(c.rs); got != c.want {
			t.Errorf("rulesetLabel(%q) = %q; want %q", c.rs, got, c.want)
		}
	}
}

func TestModuleAccentCombined(t *testing.T) {
	cases := []struct {
		rs   string
		want int
	}{
		{"", colorBase},
		{"base", colorBase},
		{"base+islands", colorIsles},
		{"base+cak", colorKnight},
		{"base+islands+cak", colorIsles},
		{"base+cak+islands", colorKnight},
		{"base+fishermen", colorTab},
		{"base+mystery", embedColor},
	}
	for _, c := range cases {
		if got := moduleAccent(c.rs); got != c.want {
			t.Errorf("moduleAccent(%q) = %#x; want %#x", c.rs, got, c.want)
		}
	}
}
