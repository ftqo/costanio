package game

import (
	"encoding/json"
	"time"

	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/store"
)

// effectiveSeatColorHex returns the CSS hex the seat renders with: its chosen
// palette color, or the seat-order default when unpicked or unknown. Mirrors
// lobby.effectiveColor so the match-history blob is self-contained.
func effectiveSeatColorHex(s *store.Seat) string {
	if s.Color != "" {
		if c, ok := cosmetics.ColorByID(s.Color); ok {
			return c.Hex
		}
	}
	return cosmetics.DefaultSeatColor(s.No).Hex
}

const MatchRecordVersion = 1

// MatchSeat captures per-seat identity at the moment a game finishes. The
// values are frozen here so the history renders without joining live users.
type MatchSeat struct {
	Seat   int    `json:"seat"`
	UserID int64  `json:"user_id"`
	Name   string `json:"name"`
	IsBot  bool   `json:"is_bot"`
	Color  string `json:"color,omitempty"`
}

// MatchRecord is the JSON blob stored in match_history.record. It embeds the
// full Scoreboard so history renders without replaying the event log.
type MatchRecord struct {
	Version    int         `json:"version"`
	GameID     string      `json:"game_id"`
	Ruleset    string      `json:"ruleset"`
	Ranked     bool        `json:"ranked"`
	FinishedAt int64       `json:"finished_at"`
	Seats      []MatchSeat `json:"seats"`
	Scoreboard Scoreboard  `json:"scoreboard"`
}

// hasHumanSeat reports whether at least one seat is not a bot.
func hasHumanSeat(seats []*store.Seat) bool {
	for _, s := range seats {
		if s.Status != "bot" {
			return true
		}
	}
	return false
}

// RecordMatch loads the game and seats for gameID, skips bot-only games, then
// builds and persists a MatchRecord. Safe to call again for a recorded game
// (SaveMatchHistory uses ON CONFLICT DO NOTHING). Returns (false, nil) for
// bot-only games. Used by the backfill tool; the live finish path builds the
// row via buildMatchRow and persists it inside the finalize transaction.
func RecordMatch(st *store.Store, gameID string) (saved bool, err error) {
	g, err := st.GameByID(gameID)
	if err != nil {
		return false, err
	}
	seats, err := st.Seats(gameID)
	if err != nil {
		return false, err
	}
	row, err := buildMatchRow(st, g, seats, time.Now().Unix())
	if err != nil {
		return false, err
	}
	if row == nil { // bot-only game
		return false, nil
	}
	if err := st.SaveMatchHistory(*row); err != nil {
		return false, err
	}
	return true, nil
}

// buildMatchRow assembles the match_history row for a finished game, or
// returns (nil, nil) for a bot-only game. nowFallback is the finished-at time
// when the game has none persisted. It only reads, so the caller can persist
// the row atomically with stats and ratings in store.FinalizeGame.
func buildMatchRow(st *store.Store, g *store.Game, seats []*store.Seat, nowFallback int64) (*store.MatchHistoryRow, error) {
	if !hasHumanSeat(seats) {
		return nil, nil
	}
	sb, err := BuildScoreboard(st, g.ID)
	if err != nil {
		return nil, err
	}
	finishedAt := nowFallback
	if g.FinishedAt != nil {
		finishedAt = *g.FinishedAt
	}
	rec := BuildMatchRecord(g, seats, sb, finishedAt)
	blob, err := json.Marshal(rec)
	if err != nil {
		return nil, err
	}
	return &store.MatchHistoryRow{
		GameID:       g.ID,
		Ruleset:      g.Ruleset,
		Ranked:       g.Ranked,
		WinnerUserID: g.Winner,
		FinishedAt:   finishedAt,
		Record:       string(blob),
	}, nil
}

// BuildMatchRecord assembles the persisted blob from the finished game, its
// seats and the computed scoreboard. Seat.UserName is already the effective
// display name (COALESCE in the store query).
func BuildMatchRecord(g *store.Game, seats []*store.Seat, sb *Scoreboard, finishedAt int64) MatchRecord {
	ms := make([]MatchSeat, 0, len(seats))
	for _, s := range seats {
		ms = append(ms, MatchSeat{
			Seat:   s.No,
			UserID: s.UserID,
			Name:   s.UserName,
			IsBot:  s.Status == "bot",
			Color:  effectiveSeatColorHex(s),
		})
	}
	rec := MatchRecord{
		Version:    MatchRecordVersion,
		GameID:     g.ID,
		Ruleset:    g.Ruleset,
		Ranked:     g.Ranked,
		FinishedAt: finishedAt,
		Seats:      ms,
	}
	if sb != nil {
		rec.Scoreboard = *sb
	} else {
		// A zero Scoreboard has Winner == 0, which would read as "seat 0 won".
		// A finished game can have no winner, and -1 says so.
		rec.Scoreboard.Winner = -1
	}
	return rec
}
