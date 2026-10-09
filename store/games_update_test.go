package store

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestUpdateGameConfigRulesetInvite(t *testing.T) {
	s := openTest(t)
	host, _ := s.CreateGuest("host")
	g := &Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{"a":1}`), CreatedBy: host.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}

	if err := s.UpdateGameConfig("g1", json.RawMessage(`{"b":2}`)); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateGameRuleset("g1", "base+islands"); err != nil {
		t.Fatal(err)
	}
	got, err := s.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if string(got.Config) != `{"b":2}` {
		t.Errorf("config = %s, want {\"b\":2}", got.Config)
	}
	if got.Ruleset != "base+islands" {
		t.Errorf("ruleset = %q, want base+islands", got.Ruleset)
	}

	// Make private via invite code: it should drop out of the public list and be
	// reachable by invite.
	if err := s.SetGameInvite("g1", "secret77"); err != nil {
		t.Fatal(err)
	}
	pub, _ := s.ListGames("lobby", false)
	for _, lg := range pub {
		if lg.ID == "g1" {
			t.Error("private game still in public list")
		}
	}
	byInvite, err := s.GameByInvite("secret77")
	if err != nil || byInvite.ID != "g1" {
		t.Errorf("GameByInvite = %+v %v", byInvite, err)
	}

	// Listing is SetGamePublic's job; the code and the flag are independent.
	// The code can be dropped without listing the game...
	if err := s.SetGameInvite("g1", ""); err != nil {
		t.Fatal(err)
	}
	if listed, _ := s.ListGames("lobby", false); len(listed) != 0 {
		t.Errorf("clearing the invite listed the game: %+v", listed)
	}
	// ...and listing it is a separate call that does not touch the code.
	if err := s.SetGamePublic("g1", true); err != nil {
		t.Fatal(err)
	}
	pub, _ = s.ListGames("lobby", false)
	found := false
	for _, lg := range pub {
		if lg.ID == "g1" {
			found = true
		}
	}
	if !found {
		t.Error("game not listed after SetGamePublic")
	}
	if _, err := s.GameByInvite("secret77"); !errors.Is(err, ErrNotFound) {
		t.Errorf("stale invite still resolves, err = %v", err)
	}
}

func TestSeatStatusColorAndRemove(t *testing.T) {
	s := openTest(t)
	host, _ := s.UpsertDiscordUser("d1", "Host", "")
	g := &Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: host.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("g1", 0, host.ID); err != nil {
		t.Fatal(err)
	}

	if err := s.SetSeatStatus("g1", 0, "bot"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSeatColor("g1", 0, "crimson"); err != nil {
		t.Fatal(err)
	}
	seat, err := s.SeatForUser("g1", host.ID)
	if err != nil {
		t.Fatal(err)
	}
	if seat.Status != "bot" {
		t.Errorf("seat status = %q, want bot", seat.Status)
	}
	if seat.Color != "crimson" {
		t.Errorf("seat color = %q, want crimson", seat.Color)
	}

	// Clearing the color reverts to "".
	if err := s.SetSeatColor("g1", 0, ""); err != nil {
		t.Fatal(err)
	}
	seat, _ = s.SeatForUser("g1", host.ID)
	if seat.Color != "" {
		t.Errorf("seat color after clear = %q, want empty", seat.Color)
	}

	// Remove the seat: SeatForUser and Seats now empty.
	if err := s.RemoveSeat("g1", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SeatForUser("g1", host.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("SeatForUser after remove err = %v, want ErrNotFound", err)
	}
	seats, _ := s.Seats("g1")
	if len(seats) != 0 {
		t.Errorf("seats after remove = %d, want 0", len(seats))
	}
}

func TestGameByIDNotFound(t *testing.T) {
	s := openTest(t)
	if _, err := s.GameByID("ghost"); !errors.Is(err, ErrNotFound) {
		t.Errorf("GameByID(missing) err = %v, want ErrNotFound", err)
	}
}

func TestListGamesIncludePrivate(t *testing.T) {
	s := openTest(t)
	host, _ := s.CreateGuest("host")
	pub := &Game{ID: "pub", Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: host.ID}
	priv := &Game{ID: "priv", Ruleset: "base", Config: json.RawMessage(`{}`), InviteCode: "inv00000", CreatedBy: host.ID}
	for _, g := range []*Game{pub, priv} {
		if err := s.CreateGame(g); err != nil {
			t.Fatal(err)
		}
	}
	all, err := s.ListGames("lobby", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Errorf("ListGames(includePrivate) = %d, want 2", len(all))
	}
}

// The invite code and the listing flag are independent (migration 0029), so
// all four combinations must be representable.
func TestPublicAndInviteAreIndependent(t *testing.T) {
	s := openTest(t)
	host, _ := s.CreateGuest("host")

	for _, tc := range []struct {
		name   string
		code   string
		public bool
	}{
		{"private with a link", "code0001", false},
		{"public with a link", "code0002", true},
		{"private with no link", "", false},
		{"public with no link (a pre-0029 table)", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := "g-" + tc.name
			g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage(`{"players":2}`),
				InviteCode: tc.code, Public: tc.public, CreatedBy: host.ID}
			if err := s.CreateGame(g); err != nil {
				t.Fatal(err)
			}
			got, err := s.GameByID(id)
			if err != nil {
				t.Fatal(err)
			}
			if got.InviteCode != tc.code {
				t.Errorf("invite code = %q, want %q", got.InviteCode, tc.code)
			}
			if got.Public != tc.public {
				t.Errorf("public = %v, want %v", got.Public, tc.public)
			}
		})
	}
}

// SetGamePublic must not disturb the code, in either direction and any number of
// times, so a shared link keeps working.
func TestSetGamePublicLeavesTheCodeAlone(t *testing.T) {
	s := openTest(t)
	host, _ := s.CreateGuest("host")
	if err := s.CreateGame(&Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{"players":2}`),
		InviteCode: "stable01", Public: false, CreatedBy: host.ID}); err != nil {
		t.Fatal(err)
	}
	for i, public := range []bool{true, false, true} {
		if err := s.SetGamePublic("g1", public); err != nil {
			t.Fatal(err)
		}
		got, err := s.GameByID("g1")
		if err != nil {
			t.Fatal(err)
		}
		if got.Public != public {
			t.Errorf("flip %d: public = %v, want %v", i, got.Public, public)
		}
		if got.InviteCode != "stable01" {
			t.Errorf("flip %d: invite code changed to %q", i, got.InviteCode)
		}
		// And the code still resolves, so the link keeps admitting its holder.
		if byInvite, err := s.GameByInvite("stable01"); err != nil || byInvite.ID != "g1" {
			t.Errorf("flip %d: GameByInvite = %+v %v", i, byInvite, err)
		}
	}
}
