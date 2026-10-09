package store

import (
	"encoding/json"
	"errors"
	"testing"
)

// seatedGame builds a lobby game with n guest seats and returns its id plus the
// seated user ids.
func seatedGame(t *testing.T, s *Store, id string, n int) (string, []int64) {
	t.Helper()
	host, err := s.CreateGuest("host-" + id)
	if err != nil {
		t.Fatal(err)
	}
	g := &Game{ID: id, Ruleset: "base", Config: []byte(`{"players":4,"ruleset":"base"}`), CreatedBy: host.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	ids := []int64{host.ID}
	if err := s.AddSeat(id, 0, host.ID); err != nil {
		t.Fatal(err)
	}
	for i := 1; i < n; i++ {
		u, err := s.CreateGuest("p" + id + string(rune('a'+i)))
		if err != nil {
			t.Fatal(err)
		}
		if err := s.AddSeat(id, i, u.ID); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, u.ID)
	}
	return id, ids
}

// A failing ReplaceSeats must roll everything back, game-row fields included.
func TestReplaceSeatsRollsBackEverything(t *testing.T) {
	s := openTest(t)
	gid, ids := seatedGame(t, s, "rollback", 3)

	// Two placements for the same user: the (game_id, user_id) unique index
	// fires on the second insert, after the delete and after the game-row
	// updates in the same transaction.
	err := s.ReplaceSeats(ReplaceSeatsInput{
		GameID:          gid,
		Config:          json.RawMessage(`{"players":9,"ruleset":"base"}`),
		Ruleset:         "base+cak",
		PreShuffleSeats: []int64{ids[0]},
		Status:          "active",
		Seats: []SeatPlacement{
			{No: 0, UserID: ids[0]},
			{No: 1, UserID: ids[0]},
		},
	})
	if err == nil {
		t.Fatal("ReplaceSeats with a duplicate user should fail")
	}

	seats, err := s.Seats(gid)
	if err != nil {
		t.Fatal(err)
	}
	if len(seats) != 3 {
		t.Errorf("seats after a failed rebuild = %d, want the original 3", len(seats))
	}
	g, err := s.GameByID(gid)
	if err != nil {
		t.Fatal(err)
	}
	if g.Ruleset != "base" {
		t.Errorf("ruleset after a failed rebuild = %q, want the original %q", g.Ruleset, "base")
	}
	if g.Status != "lobby" {
		t.Errorf("status after a failed rebuild = %q, want the original %q", g.Status, "lobby")
	}
	var cfg struct {
		Players int `json:"players"`
	}
	if err := json.Unmarshal(g.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Players != 4 {
		t.Errorf("config players after a failed rebuild = %d, want the original 4", cfg.Players)
	}
}

// The success path: every optional field lands, and the old seat set is gone
// rather than merged with the new one.
func TestReplaceSeatsSwapsWholeSet(t *testing.T) {
	s := openTest(t)
	gid, ids := seatedGame(t, s, "swap", 3)

	if err := s.ReplaceSeats(ReplaceSeatsInput{
		GameID:          gid,
		Config:          json.RawMessage(`{"players":2,"ruleset":"base"}`),
		Ruleset:         "base",
		PreShuffleSeats: ids,
		Status:          "active",
		Seats: []SeatPlacement{
			{No: 0, UserID: ids[2], Color: "c-two", DisplayName: "Two"},
			{No: 1, UserID: ids[0], Status: "bot"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	seats, err := s.Seats(gid)
	if err != nil {
		t.Fatal(err)
	}
	if len(seats) != 2 {
		t.Fatalf("seats = %d, want 2", len(seats))
	}
	if seats[0].UserID != ids[2] || seats[0].Color != "c-two" || seats[0].DisplayName != "Two" {
		t.Errorf("seat 0 = %+v, want user %d wearing c-two named Two", seats[0], ids[2])
	}
	if seats[1].Status != "bot" {
		t.Errorf("seat 1 status = %q, want bot", seats[1].Status)
	}
	if g, _ := s.GameByID(gid); g.Status != "active" {
		t.Errorf("status = %q, want active", g.Status)
	}
}

// Teardown: no seats at all is a valid rebuild, and it commits with the status
// change.
func TestReplaceSeatsClearsTable(t *testing.T) {
	s := openTest(t)
	gid, _ := seatedGame(t, s, "clear", 3)

	if err := s.ReplaceSeats(ReplaceSeatsInput{GameID: gid, Status: "abandoned"}); err != nil {
		t.Fatal(err)
	}
	seats, _ := s.Seats(gid)
	if len(seats) != 0 {
		t.Errorf("seats after close = %d, want 0", len(seats))
	}
	if g, _ := s.GameByID(gid); g.Status != "abandoned" {
		t.Errorf("status = %q, want abandoned", g.Status)
	}
}

// AddSeatFull writes seat, status and color together, and keeps AddSeat's
// "this user already holds a seat here" answer.
func TestAddSeatFull(t *testing.T) {
	s := openTest(t)
	gid, ids := seatedGame(t, s, "addfull", 1)

	bot, err := s.CreateGuest("Bot William")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeatFull(gid, SeatPlacement{No: 1, UserID: bot.ID, Status: "bot", Color: "c-bot"}); err != nil {
		t.Fatal(err)
	}
	seats, _ := s.Seats(gid)
	if len(seats) != 2 {
		t.Fatalf("seats = %d, want 2", len(seats))
	}
	if seats[1].Status != "bot" || seats[1].Color != "c-bot" {
		t.Errorf("seat 1 = status %q color %q, want bot/c-bot", seats[1].Status, seats[1].Color)
	}
	if err := s.AddSeatFull(gid, SeatPlacement{No: 2, UserID: ids[0]}); !errors.Is(err, ErrSeatTaken) {
		t.Errorf("reseating an already-seated user err = %v, want ErrSeatTaken", err)
	}
}
