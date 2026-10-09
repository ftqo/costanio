package store

import (
	"encoding/json"
	"testing"
)

func seatTestGame(t *testing.T, s *Store, createdBy int64) string {
	t.Helper()
	g := &Game{ID: "g1", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: createdBy}
	if err := s.CreateGame(g); err != nil {
		t.Fatalf("CreateGame: %v", err)
	}
	return g.ID
}

func TestSeatEffectiveName(t *testing.T) {
	s := openTest(t)

	// A nameless anonymous guest and a named Discord user.
	anon, err := s.CreateGuest("")
	if err != nil {
		t.Fatalf("CreateGuest(\"\"): %v", err)
	}
	bob, _ := s.UpsertDiscordUser("disc1", "Bob", "")

	gid := seatTestGame(t, s, bob.ID)
	if err := s.AddSeat(gid, 0, anon.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat(gid, 1, bob.ID); err != nil {
		t.Fatal(err)
	}

	seats, err := s.Seats(gid)
	if err != nil {
		t.Fatal(err)
	}
	if seats[0].UserName != "Guest" {
		t.Errorf("nameless guest seat name = %q, want fallback %q", seats[0].UserName, "Guest")
	}
	if seats[1].UserName != "Bob" {
		t.Errorf("discord seat name = %q, want %q", seats[1].UserName, "Bob")
	}

	// A per-seat display name overrides both the user name and the fallback.
	if err := s.SetSeatDisplayName(gid, 0, "Alice"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSeatDisplayName(gid, 1, "Bobby"); err != nil {
		t.Fatal(err)
	}
	seats, _ = s.Seats(gid)
	if seats[0].UserName != "Alice" {
		t.Errorf("override seat name = %q, want %q", seats[0].UserName, "Alice")
	}
	if seats[1].UserName != "Bobby" {
		t.Errorf("override seat name = %q, want %q", seats[1].UserName, "Bobby")
	}

	// Clearing the override reverts to the effective fallback chain.
	if err := s.SetSeatDisplayName(gid, 0, ""); err != nil {
		t.Fatal(err)
	}
	mine, err := s.SeatForUser(gid, anon.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mine.UserName != "Guest" {
		t.Errorf("cleared seat name = %q, want %q", mine.UserName, "Guest")
	}
}

func TestSetUserName(t *testing.T) {
	s := openTest(t)
	bob, _ := s.UpsertDiscordUser("disc1", "Bob", "")
	if err := s.SetUserName(bob.ID, "Robert"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.UserByID(bob.ID)
	if got.Name != "Robert" {
		t.Errorf("name after SetUserName = %q, want %q", got.Name, "Robert")
	}
}

func TestSeatsForGames(t *testing.T) {
	s := openTest(t)
	bob, _ := s.UpsertDiscordUser("disc1", "Bob", "")
	ann, _ := s.UpsertDiscordUser("disc2", "Ann", "")

	mk := func(id string) {
		g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: bob.ID}
		if err := s.CreateGame(g); err != nil {
			t.Fatalf("CreateGame(%s): %v", id, err)
		}
	}
	mk("ga")
	mk("gb")
	mk("gc") // left seatless
	if err := s.AddSeat("ga", 0, bob.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("ga", 1, ann.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("gb", 0, ann.ID); err != nil {
		t.Fatal(err)
	}

	got, err := s.SeatsForGames([]string{"ga", "gb", "gc"})
	if err != nil {
		t.Fatalf("SeatsForGames: %v", err)
	}
	if len(got["ga"]) != 2 || got["ga"][0].No != 0 || got["ga"][1].No != 1 {
		t.Errorf("ga seats = %+v, want 2 ordered seats", got["ga"])
	}
	if len(got["gb"]) != 1 || got["gb"][0].UserName != "Ann" {
		t.Errorf("gb seats = %+v, want [Ann]", got["gb"])
	}
	if _, ok := got["gc"]; ok {
		t.Errorf("seatless game gc present in map: %+v", got["gc"])
	}

	// The batched result must match the per-game Seats query.
	single, _ := s.Seats("ga")
	if len(single) != len(got["ga"]) {
		t.Errorf("batched ga len %d != Seats len %d", len(got["ga"]), len(single))
	}

	// Empty input is a no-op, not an error.
	empty, err := s.SeatsForGames(nil)
	if err != nil || len(empty) != 0 {
		t.Errorf("SeatsForGames(nil) = %v, %v; want empty map, nil", empty, err)
	}
}

func TestSeatedActiveGames(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("d1", "U", "")
	mk := func(id, status string) {
		g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}
		if err := s.CreateGame(g); err != nil {
			t.Fatal(err)
		}
		if status != "lobby" {
			s.SetGameStatus(id, status)
		}
		if err := s.AddSeat(id, 0, u.ID); err != nil {
			t.Fatal(err)
		}
	}
	mk("g_lobby", "lobby")
	mk("g_active", "active")
	mk("g_done", "finished")

	got, err := s.SeatedActiveGames(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("seated active = %d, want 2 (%+v)", len(got), got)
	}
	ids := map[string]string{}
	for _, sg := range got {
		ids[sg.ID] = sg.Status
	}
	if ids["g_lobby"] != "lobby" || ids["g_active"] != "active" {
		t.Errorf("statuses = %+v", ids)
	}
	if _, ok := ids["g_done"]; ok {
		t.Errorf("finished game should not appear in seated-active set")
	}
}

func TestSeatedGameForUser(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("d1", "U", "")
	mk := func(id, status string) {
		g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}
		if err := s.CreateGame(g); err != nil {
			t.Fatal(err)
		}
		if status != "lobby" {
			s.SetGameStatus(id, status)
		}
		if err := s.AddSeat(id, 0, u.ID); err != nil {
			t.Fatal(err)
		}
	}

	// No seat anywhere: empty id, no error.
	sg, err := s.SeatedGameForUser(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sg.ID != "" {
		t.Fatalf("no seat: got %+v, want empty", sg)
	}

	// Newest lobby/active seat wins, carrying its status.
	mk("g_active", "active")
	sg, err = s.SeatedGameForUser(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sg.ID != "g_active" || sg.Status != "active" {
		t.Fatalf("seated game = %+v, want {g_active active}", sg)
	}

	// Finished games never count.
	s.SetGameStatus("g_active", "finished")
	sg, err = s.SeatedGameForUser(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sg.ID != "" {
		t.Fatalf("finished seat should not count: got %+v", sg)
	}
}

func TestRecentChat(t *testing.T) {
	s := openTest(t)
	bob, _ := s.UpsertDiscordUser("disc1", "Bob", "")
	alice, _ := s.UpsertDiscordUser("disc2", "Alice", "")

	// 3 lines in game scope, 1 in another scope (must not leak across scopes).
	if _, err := s.SaveChat("game:g1", bob.ID, "first"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveChat("game:g1", alice.ID, "second"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveChat("game:g1", bob.ID, "third"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveChat("lobby", bob.ID, "elsewhere"); err != nil {
		t.Fatal(err)
	}

	lines, err := s.RecentChat("game:g1", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 3 {
		t.Fatalf("got %d lines, want 3", len(lines))
	}
	// Oldest -> newest.
	if lines[0].Msg != "first" || lines[2].Msg != "third" {
		t.Errorf("order wrong: %+v", lines)
	}
	// Joined display name.
	if lines[1].From != "Alice" || lines[1].UserID != alice.ID {
		t.Errorf("line[1] = %+v, want Alice/%d", lines[1], alice.ID)
	}

	// Limit returns only the newest N, still oldest->newest.
	lim, err := s.RecentChat("game:g1", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(lim) != 2 || lim[0].Msg != "second" || lim[1].Msg != "third" {
		t.Errorf("limited = %+v, want [second third]", lim)
	}

	// Empty scope -> empty (not nil-deref).
	empty, err := s.RecentChat("game:nope", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Errorf("empty scope = %+v, want none", empty)
	}
}

func TestSaveChatReturnsIDAndRecentChatCarriesIt(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("d1", "alice", "")
	id1, err := s.SaveChat("lobby", u.ID, "hi")
	if err != nil || id1 == 0 {
		t.Fatalf("id1=%d err=%v", id1, err)
	}
	id2, _ := s.SaveChat("lobby", u.ID, "again")
	if id2 <= id1 {
		t.Fatalf("ids not increasing: %d %d", id1, id2)
	}
	lines, err := s.RecentChat("lobby", 10)
	if err != nil || len(lines) != 2 {
		t.Fatalf("lines=%d err=%v", len(lines), err)
	}
	if lines[0].ID != id1 || lines[1].ID != id2 {
		t.Fatalf("RecentChat ids=%d,%d want %d,%d", lines[0].ID, lines[1].ID, id1, id2)
	}
}

// The equipped robber joins onto the seat like the name decoration. Both
// readers scan the same SELECT, and a Scan mismatch is only a runtime error, so
// both are asserted.
func TestSeatCarriesTheEquippedRobber(t *testing.T) {
	s := openTest(t)
	bob, _ := s.UpsertDiscordUser("disc1", "Bob", "")
	ann, _ := s.UpsertDiscordUser("disc2", "Ann", "")
	g := &Game{ID: "gr", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: bob.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("gr", 0, bob.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("gr", 1, ann.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SetLoadoutSlot(bob.ID, "robber", "robber.test"); err != nil {
		t.Fatal(err)
	}

	seats, err := s.Seats("gr")
	if err != nil {
		t.Fatalf("Seats: %v", err)
	}
	if seats[0].Robber != "robber.test" {
		t.Errorf("Seats: seat 0 robber = %q, want robber.test", seats[0].Robber)
	}
	// Nothing equipped is an empty string, never an error.
	if seats[1].Robber != "" {
		t.Errorf("Seats: seat 1 robber = %q, want empty", seats[1].Robber)
	}

	batched, err := s.SeatsForGames([]string{"gr"})
	if err != nil {
		t.Fatalf("SeatsForGames: %v", err)
	}
	if batched["gr"][0].Robber != "robber.test" {
		t.Errorf("SeatsForGames: seat 0 robber = %q, want robber.test", batched["gr"][0].Robber)
	}
	if batched["gr"][1].Robber != "" {
		t.Errorf("SeatsForGames: seat 1 robber = %q, want empty", batched["gr"][1].Robber)
	}
}

// SeatForUser is the third reader of seatSelect and scans it by hand too.
func TestSeatForUserEquippedRobber(t *testing.T) {
	s := openTest(t)
	bob, _ := s.UpsertDiscordUser("disc1", "Bob", "")
	g := &Game{ID: "gr2", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: bob.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("gr2", 0, bob.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SetLoadoutSlot(bob.ID, "robber", "robber.test"); err != nil {
		t.Fatal(err)
	}
	seat, err := s.SeatForUser("gr2", bob.ID)
	if err != nil {
		t.Fatalf("SeatForUser: %v", err)
	}
	if seat.Robber != "robber.test" {
		t.Errorf("SeatForUser robber = %q, want robber.test", seat.Robber)
	}
}
