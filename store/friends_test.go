package store

import "testing"

func TestFriends(t *testing.T) {
	s := openTest(t)
	me, _ := s.UpsertDiscordUser("me", "Me", "")
	// Two of my Discord friends have accounts; one does not.
	bob, _ := s.UpsertDiscordUser("bob", "Bob", "")
	ann, _ := s.UpsertDiscordUser("ann", "Ann", "")

	// No friends cached yet.
	got, err := s.FriendsWithAccounts(me.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("friends before replace = %+v, want none", got)
	}

	// Cache three friend discord ids; only two have accounts.
	if err := s.ReplaceFriends(me.ID, []string{"bob", "ann", "ghost"}); err != nil {
		t.Fatal(err)
	}
	got, err = s.FriendsWithAccounts(me.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("friends with accounts = %d, want 2 (%+v)", len(got), got)
	}
	// Ordered by name: Ann then Bob.
	if got[0].ID != ann.ID || got[1].ID != bob.ID {
		t.Errorf("friend order = %+v, want [Ann, Bob]", got)
	}

	// ReplaceFriends fully replaces the prior set (idempotent re-insert of dups).
	if err := s.ReplaceFriends(me.ID, []string{"bob", "bob"}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.FriendsWithAccounts(me.ID)
	if len(got) != 1 || got[0].ID != bob.ID {
		t.Errorf("after replace = %+v, want [Bob] only", got)
	}

	// Replacing with an empty list clears the cache.
	if err := s.ReplaceFriends(me.ID, nil); err != nil {
		t.Fatal(err)
	}
	got, _ = s.FriendsWithAccounts(me.ID)
	if len(got) != 0 {
		t.Errorf("after clear = %+v, want none", got)
	}
}
