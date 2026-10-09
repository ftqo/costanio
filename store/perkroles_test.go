package store

import "testing"

func TestPerkRoles(t *testing.T) {
	s := openTest(t)

	// Empty to start.
	m, err := s.PerkRoles()
	if err != nil || len(m) != 0 {
		t.Fatalf("empty PerkRoles = %v, %v; want empty", m, err)
	}

	// Many roles per kind + upsert.
	if err := s.SetPerkRole("roleA", "kofi"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPerkRole("roleB", "kofi"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPerkRole("roleC", "staff"); err != nil {
		t.Fatal(err)
	}
	m, _ = s.PerkRoles()
	if m["roleA"] != "kofi" || m["roleB"] != "kofi" || m["roleC"] != "staff" {
		t.Fatalf("PerkRoles = %v; want roleA/B=kofi, roleC=staff", m)
	}

	// Re-map overwrites.
	if err := s.SetPerkRole("roleC", "boost"); err != nil {
		t.Fatal(err)
	}
	if m, _ = s.PerkRoles(); m["roleC"] != "boost" {
		t.Fatalf("roleC = %q after re-map; want boost", m["roleC"])
	}

	// Delete reports found/not-found.
	if ok, _ := s.DeletePerkRole("roleA"); !ok {
		t.Fatal("delete roleA should report deleted")
	}
	if ok, _ := s.DeletePerkRole("nope"); ok {
		t.Fatal("delete missing role should report not-deleted")
	}
	if m, _ = s.PerkRoles(); len(m) != 2 {
		t.Fatalf("after delete = %v; want 2 entries", m)
	}
}
