package store

import "database/sql"

// execQuerier is satisfied by both *sql.DB and *sql.Tx, so each write helper can
// run stand-alone (auto-commit via *sql.DB) or inside a shared transaction
// (*sql.Tx). It is the seam that lets FinalizeGame apply several writes
// atomically while the individual public methods keep working on their own.
type execQuerier interface {
	Exec(query string, args ...any) (sql.Result, error)
	QueryRow(query string, args ...any) *sql.Row
}

// StatBump is one user's per-ruleset game/win/draw increment. Won and Drew are
// mutually exclusive.
type StatBump struct {
	UserID  int64
	Ruleset string
	Won     bool
	Drew    bool
	// Ranked splits the counters: `stats` carries a career total (every
	// finished game, bots included) for the profile, and a ranked total for
	// the leaderboard's ranked-only ELO.
	Ranked bool
	// Casual4 splits a third counter: non-ranked games at exactly
	// CasualPlayers seats. Not the complement of Ranked: a casual game at any
	// other player count sets neither and lands only in the career total. See
	// migration 0033 for why the count is four.
	Casual4 bool
}

// BotStatBump is one bot personality's casual four-player increment, keyed by
// the seat's display name ("Bot Winston"). A bot is a fresh guest account per
// game, so this is where per-strategy results accumulate. Empty for every game
// that is ranked or not four-handed.
type BotStatBump struct {
	Name    string
	Ruleset string
	Won     bool
	Drew    bool
}

// FinalizeInput is the complete, pre-computed set of writes for finalizing one
// finished game. The game/ layer performs every read up front (scoreboard,
// seats, forfeits, placement ranks, match blob) and FinalizeGame applies all
// the writes in one transaction. Either everything commits (match row present,
// recovery skips) or nothing does (recovery re-applies once).
type FinalizeInput struct {
	// Stats is bumped for each played (non-forfeited) seat.
	Stats []StatBump
	// BotStats is bumped for each played bot seat, keyed by personality. Empty
	// unless the game was casual and four-handed.
	BotStats []BotStatBump
	// Strikes lists user IDs that get an escalating ranked-queue strike
	// (ranked-game forfeiters). Empty for casual games.
	Strikes []int64
	// Now is the finalize timestamp (stats updated_at, match created_at, etc).
	Now int64
	// Ratings are applied only when len(RatingUserIDs) >= 2 (ranked games).
	// RatingRanks is parallel to RatingUserIDs (1 = first place).
	Ruleset       string
	RatingUserIDs []int64
	RatingRanks   []int
	// Match is the match-history blob to persist, or nil for bot-only games
	// (which are never recorded and are excluded from the recovery sweep).
	Match *MatchHistoryRow
	// Credits are wallet credits (the match faucet) applied in this same
	// transaction, so a player's Pips commit or fail with their stats.
	// Idempotent per IdemKey, so the recovery sweep cannot pay twice.
	Credits []LedgerCreditInput
}

// LedgerCreditInput is one wallet credit applied inside the finalize
// transaction.
//
// Carried as data rather than granted through econ.Ledger, which would open
// its own connection and deadlock against the open finalize transaction
// (SetMaxOpenConns(1)). The caller owns the payout rules; this owns the write.
type LedgerCreditInput struct {
	UserID  int64
	Amount  int
	Reason  string
	IdemKey string
}

// FinalizeGame applies every post-game write for one finished game in a single
// transaction, so the recovery sweep never double-applies a partly finalized
// game. The single writer connection keeps concurrent finishes from
// interleaving. The match-history insert is last: its absence is the "not
// finalized" marker.
func (s *Store) FinalizeGame(in FinalizeInput) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, b := range in.Stats {
		if err := bumpStats(tx, b.UserID, b.Ruleset, b.Won, b.Drew, b.Ranked, b.Casual4); err != nil {
			return err
		}
	}
	// Before the match row: these +1 upserts have no idempotency of their own,
	// so they rely on committing with the row that tells the sweep to skip.
	for _, b := range in.BotStats {
		if err := bumpBotStats(tx, b.Name, b.Ruleset, b.Won, b.Drew); err != nil {
			return err
		}
	}
	for _, uid := range in.Strikes {
		if _, err := bumpRankedStrike(tx, uid, in.Now); err != nil {
			return err
		}
	}
	if len(in.RatingUserIDs) >= 2 {
		if err := applyGameRatings(tx, in.Ruleset, in.RatingUserIDs, in.RatingRanks, in.Now); err != nil {
			return err
		}
	}
	for _, c := range in.Credits {
		if err := creditLedger(tx, c.UserID, c.Amount, c.Reason, c.IdemKey, in.Now); err != nil {
			return err
		}
	}
	if in.Match != nil {
		if err := saveMatchHistory(tx, *in.Match, in.Now); err != nil {
			return err
		}
	}
	return tx.Commit()
}
