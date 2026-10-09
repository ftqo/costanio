package store

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestMapsRoundTrip(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("author")

	// Missing map -> ErrNotFound.
	if _, err := s.MapByID("nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("MapByID(missing) err = %v, want ErrNotFound", err)
	}

	// Create with an explicit id.
	m := &Map{ID: "m1", Name: "Atoll", Board: json.RawMessage(`{"w":3}`), CreatedBy: u.ID}
	if err := s.CreateMap(m); err != nil {
		t.Fatal(err)
	}
	if m.CreatedAt == 0 {
		t.Error("CreateMap did not stamp CreatedAt")
	}

	got, err := s.MapByID("m1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Atoll" || got.CreatedBy != u.ID || string(got.Board) != `{"w":3}` {
		t.Errorf("MapByID = %+v", got)
	}

	// Create without an id: a random one is assigned.
	m2 := &Map{Name: "Reef", Board: json.RawMessage(`{}`), CreatedBy: u.ID}
	if err := s.CreateMap(m2); err != nil {
		t.Fatal(err)
	}
	if m2.ID == "" || m2.ID == "m1" {
		t.Errorf("CreateMap did not assign a fresh random id: %q", m2.ID)
	}

	list, err := s.ListMaps()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("ListMaps = %d entries, want 2", len(list))
	}
	// Both ids present.
	ids := map[string]bool{}
	for _, lm := range list {
		ids[lm.ID] = true
		if lm.Board == nil {
			t.Errorf("listed map %s has nil board", lm.ID)
		}
	}
	if !ids["m1"] || !ids[m2.ID] {
		t.Errorf("ListMaps missing ids: %v", ids)
	}
}

func TestDeleteMap(t *testing.T) {
	s := openTest(t)
	owner, _ := s.CreateGuest("owner")
	other, _ := s.CreateGuest("other")
	m := &Map{Name: "Mine", Board: json.RawMessage(`{"radius":2}`), CreatedBy: owner.ID}
	if err := s.CreateMap(m); err != nil {
		t.Fatalf("create: %v", err)
	}

	// A non-owner cannot delete it.
	if err := s.DeleteMap(m.ID, other.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete by non-owner: want ErrNotFound, got %v", err)
	}
	if _, err := s.MapByID(m.ID); err != nil {
		t.Fatalf("map should still exist after non-owner delete: %v", err)
	}

	// Deleting an unknown id is ErrNotFound.
	if err := s.DeleteMap("deadbeef", owner.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete unknown: want ErrNotFound, got %v", err)
	}

	// The owner can delete it; it is then gone.
	if err := s.DeleteMap(m.ID, owner.ID); err != nil {
		t.Fatalf("owner delete: %v", err)
	}
	if _, err := s.MapByID(m.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("map should be gone: %v", err)
	}
}

func TestListMapsByUser(t *testing.T) {
	s := openTest(t)
	alice, _ := s.CreateGuest("alice")
	bob, _ := s.CreateGuest("bob")

	// Alice creates two maps; Bob creates one.
	a1 := &Map{Name: "AliceA", Board: json.RawMessage(`{"r":2}`), CreatedBy: alice.ID}
	a2 := &Map{Name: "AliceB", Board: json.RawMessage(`{"r":3}`), CreatedBy: alice.ID}
	b1 := &Map{Name: "BobA", Board: json.RawMessage(`{"r":4}`), CreatedBy: bob.ID}
	for _, m := range []*Map{a1, a2, b1} {
		if err := s.CreateMap(m); err != nil {
			t.Fatalf("CreateMap: %v", err)
		}
	}

	// Alice's scoped query returns only her two maps.
	aliceMaps, err := s.ListMapsByUser(alice.ID)
	if err != nil {
		t.Fatalf("ListMapsByUser(alice): %v", err)
	}
	if len(aliceMaps) != 2 {
		t.Fatalf("ListMapsByUser(alice) = %d maps, want 2", len(aliceMaps))
	}
	for _, m := range aliceMaps {
		if m.CreatedBy != alice.ID {
			t.Errorf("ListMapsByUser(alice) returned map owned by %d", m.CreatedBy)
		}
	}

	// Bob's scoped query returns only his map.
	bobMaps, err := s.ListMapsByUser(bob.ID)
	if err != nil {
		t.Fatalf("ListMapsByUser(bob): %v", err)
	}
	if len(bobMaps) != 1 {
		t.Fatalf("ListMapsByUser(bob) = %d maps, want 1", len(bobMaps))
	}
	if bobMaps[0].Name != "BobA" {
		t.Errorf("ListMapsByUser(bob) = %q, want BobA", bobMaps[0].Name)
	}

	// A user with no maps gets an empty slice, not an error.
	nobody, _ := s.CreateGuest("nobody")
	none, err := s.ListMapsByUser(nobody.ID)
	if err != nil {
		t.Fatalf("ListMapsByUser(nobody): %v", err)
	}
	if len(none) != 0 {
		t.Errorf("ListMapsByUser(nobody) = %d maps, want 0", len(none))
	}
}

func TestRandomMapIDUnique(t *testing.T) {
	a, b := randomMapID(), randomMapID()
	if a == "" || a == b {
		t.Errorf("randomMapID not unique/non-empty: %q %q", a, b)
	}
	if len(a) != 16 { // 8 bytes hex-encoded
		t.Errorf("randomMapID length = %d, want 16", len(a))
	}
}
