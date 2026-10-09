package game

import (
	"strings"
	"testing"

	"github.com/ftqo/costan.io/store"
)

// isCSSHex reports whether s is a non-empty CSS hex color (e.g. "#ff0000").
func isCSSHex(s string) bool {
	return strings.HasPrefix(s, "#") && len(s) == 7
}

func TestBuildMatchRecordAndHumanSeat(t *testing.T) {
	g := &store.Game{ID: "g1", Ruleset: "base", Ranked: true}
	seats := []*store.Seat{
		// seat 0 has a known palette color ID, which should resolve to its hex
		{No: 0, UserID: 7, UserName: "Ana", Status: "active", Color: "color.ff0000"},
		// seat 1 has no color set, so it should resolve to the default seat-order hex
		{No: 1, UserID: 9, UserName: "Bot McBot", Status: "bot"},
	}
	sb := &Scoreboard{Winner: 0, Players: []PlayerStat{{Seat: 0, VP: 10}, {Seat: 1, VP: 4}}}
	rec := BuildMatchRecord(g, seats, sb, 1234)
	if rec.Version != MatchRecordVersion || rec.GameID != "g1" || !rec.Ranked || rec.FinishedAt != 1234 {
		t.Fatalf("meta wrong: %+v", rec)
	}
	if len(rec.Seats) != 2 || rec.Seats[0].Name != "Ana" || rec.Seats[0].IsBot || !rec.Seats[1].IsBot {
		t.Errorf("seats wrong: %+v", rec.Seats)
	}
	// Custom-color seat: must resolve to the palette hex, not the raw ID.
	if !isCSSHex(rec.Seats[0].Color) {
		t.Errorf("seat 0 color = %q, want a CSS hex (starts with #, 7 chars)", rec.Seats[0].Color)
	}
	if rec.Seats[0].Color != "#ff0000" {
		t.Errorf("seat 0 color = %q, want %q", rec.Seats[0].Color, "#ff0000")
	}
	// Default-color seat: must resolve to a non-empty CSS hex.
	if !isCSSHex(rec.Seats[1].Color) {
		t.Errorf("seat 1 (default) color = %q, want a non-empty CSS hex", rec.Seats[1].Color)
	}
	if rec.Scoreboard.Players[0].VP != 10 {
		t.Errorf("scoreboard not embedded")
	}
	if !hasHumanSeat(seats) {
		t.Errorf("hasHumanSeat should be true")
	}
	if hasHumanSeat([]*store.Seat{{Status: "bot"}}) {
		t.Errorf("bot-only should be false")
	}
}
