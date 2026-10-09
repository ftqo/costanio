package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
)

// signupLedgerReason is the wallet_ledger reason econ writes for the one-time
// welcome grant. Duplicated here because econ imports store.
const signupLedgerReason = "signup"

// mergeDisposal says how a merge clears one reference to the absorbed account.
type mergeDisposal int

const (
	// repointRef: UPDATE table SET col = survivor WHERE col = victim. Safe when
	// nothing stops the survivor from holding the victim's row too.
	repointRef mergeDisposal = iota
	// repointOrIgnoreRef: the same, but a UNIQUE constraint may already hold the
	// survivor's own row for that key; the collisions are dropped afterwards.
	repointOrIgnoreRef
	// foldedRef: the column carries a per-user aggregate that cannot be blindly
	// repointed (a balance to add, an entitlement set to union, a penalty to keep
	// the stricter of, a session to invalidate). foldUserAggregates handles each
	// one by name.
	foldedRef
)

// userRef is one column that references users(id).
type userRef struct {
	table  string
	column string
	how    mergeDisposal
}

// userRefs is every column that references users(id), and what a merge does
// with it. Missing one makes the victim's delete fail its foreign key check
// (the writer runs with foreign_keys on). TestUserForeignKeysAreHandledByMerge
// checks this list against PRAGMA foreign_key_list.
var userRefs = []userRef{
	{"chat", "user_id", repointRef},
	{"chat_bans", "user_id", foldedRef},    // adopt the victim's ban if the survivor has none
	{"chat_bans", "banned_by", repointRef}, // the acting mod, not the banned player
	{"chat_reports", "reporter_id", repointRef},
	{"chat_reports", "accused_id", repointRef},
	{"chat_reports", "resolved_by", repointRef},
	{"discord_friends", "user_id", foldedRef},
	{"entitlements", "user_id", foldedRef},
	{"feedback", "user_id", repointRef}, // what they sent stays with the person
	{"forfeits", "user_id", repointOrIgnoreRef},
	{"games", "created_by", repointRef},
	{"games", "winner_user_id", repointRef},
	{"identities", "user_id", repointOrIgnoreRef},
	{"loadout", "user_id", foldedRef},
	{"maps", "created_by", repointRef},
	{"match_history", "winner_user_id", repointRef},
	{"mod_strikes", "user_id", repointRef},
	{"name_locks", "user_id", foldedRef},    // adopt the victim's lock if the survivor has none
	{"name_locks", "locked_by", repointRef}, // the acting mod, not the locked player
	{"ratings", "user_id", foldedRef},
	// seats_game_user is UNIQUE on (game_id, user_id): one human who played a
	// game from both accounts has two rows. The survivor's seat wins and the
	// duplicate is dropped. MergeGuestIntoProvider has no ErrMergeSharedGame
	// guard, so this case is reachable.
	{"seats", "user_id", repointOrIgnoreRef},
	{"sessions", "user_id", foldedRef},
	{"stats", "user_id", foldedRef},
	{"supporter_status", "user_id", foldedRef},
	{"wallet_balance", "user_id", foldedRef},
	{"wallet_ledger", "user_id", foldedRef},
}

// mergeUserRows folds every row the victim owns onto the survivor, inside the
// caller's transaction and before the caller deletes the victim. It is the whole
// of what the two merge entry points share; each adds only its own identity work
// afterwards.
//
// Rows referenced by userRefs are either repointed generically or folded by an
// explicit policy in foldUserAggregates. ON DELETE CASCADE is never relied on
// to carry state.

// storedRoster is one game's stored pre-shuffle roster, as read.
type storedRoster struct {
	gameID string
	blob   string
}

// rostersHeldBy returns the stored roster of every game the user holds a seat
// in. Split out so the cursor is closed before the caller writes through the
// same transaction.
func rostersHeldBy(tx *sql.Tx, userID int64) ([]storedRoster, error) {
	rows, err := tx.Query(`SELECT g.id, g.pre_shuffle_seats
		FROM games g JOIN seats s ON s.game_id = g.id
		WHERE s.user_id = ? AND g.pre_shuffle_seats IS NOT NULL AND g.pre_shuffle_seats != ''`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []storedRoster
	for rows.Next() {
		var r storedRoster
		if err := rows.Scan(&r.gameID, &r.blob); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// foldPreShuffleRosters keeps games.pre_shuffle_seats agreeing with the seat
// rows a merge is about to move. The fairness audit applies the seed to the
// stored pre-shuffle roster and compares against final_seats, which is derived
// from the `seats` rows, so the two must change together.
//
// The blob is not a commitment (nothing hashes it, it is not in the event log;
// the seed commit is), so rewriting it is safe:
//
//	victim in roster, survivor absent  -> replace victim with survivor (repoint)
//	victim in roster, survivor present -> clear the roster            (delete)
//
// The second case cannot be repaired: the game was played by n seats but only
// n-1 rows can exist, and perm(n-1) is a different permutation from perm(n).
// Dropping the victim's entry would make the audit pass a seating that never
// happened at a two-seat table (perm(1) is the identity), so the roster is
// cleared and verify.mjs skips the seating check. Other checks still verify.
// Games with no stored roster are left alone.
func foldPreShuffleRosters(tx *sql.Tx, survivorID, victimID int64) error {
	todo, err := rostersHeldBy(tx, victimID)
	if err != nil {
		return err
	}
	for _, r := range todo {
		var pre []int64
		if err := json.Unmarshal([]byte(r.blob), &pre); err != nil {
			// Leave an unparseable roster alone; the audit reports it as such.
			continue
		}
		if slices.Contains(pre, survivorID) {
			// Shared table: clear it so the audit skips the seating check.
			if _, err := tx.Exec(`UPDATE games SET pre_shuffle_seats = '' WHERE id = ?`, r.gameID); err != nil {
				return err
			}
			continue
		}
		out := make([]int64, len(pre))
		for i, id := range pre {
			out[i] = id
			if id == victimID {
				out[i] = survivorID
			}
		}
		b, err := json.Marshal(out)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE games SET pre_shuffle_seats = ? WHERE id = ?`, string(b), r.gameID); err != nil {
			return err
		}
	}
	return nil
}

func mergeUserRows(tx *sql.Tx, survivorID, victimID, now int64) error {
	// Before the seats move, because this reads the roster as it was.
	if err := foldPreShuffleRosters(tx, survivorID, victimID); err != nil {
		return err
	}
	for _, ref := range userRefs {
		var stmt string
		switch ref.how {
		case repointRef:
			stmt = "UPDATE " + ref.table + " SET " + ref.column + " = ? WHERE " + ref.column + " = ?"
		case repointOrIgnoreRef:
			stmt = "UPDATE OR IGNORE " + ref.table + " SET " + ref.column + " = ? WHERE " + ref.column + " = ?"
		default:
			continue
		}
		if _, err := tx.Exec(stmt, survivorID, victimID); err != nil {
			return err
		}
	}
	// Drop what OR IGNORE could not repoint because the survivor already holds
	// that key; a leftover row would block the victim's delete.
	for _, ref := range userRefs {
		if ref.how != repointOrIgnoreRef {
			continue
		}
		stmt := "DELETE FROM " + ref.table + " WHERE " + ref.column + " = ?" //nolint:gosec // G202: table and column come from userRefs, a compile-time constant table; the only value is bound
		if _, err := tx.Exec(stmt, victimID); err != nil {
			return err
		}
	}
	return foldUserAggregates(tx, survivorID, victimID, now)
}

// foldUserAggregates carries the per-user aggregates across with an explicit
// policy each. Otherwise the victim's delete would destroy them (or fail, for
// tables with no ON DELETE clause).
func foldUserAggregates(tx *sql.Tx, survivorID, victimID, now int64) error {
	// Stats: sum per ruleset. Every additive column must be listed;
	// TestMergeFoldsEveryAdditiveStatColumn fails when one is missing.
	if _, err := tx.Exec(`INSERT INTO stats
			(user_id, ruleset, games, wins, draws, ranked_games, ranked_wins, ranked_draws,
			 casual_games, casual_wins, casual_draws)
		SELECT ?, ruleset, games, wins, draws, ranked_games, ranked_wins, ranked_draws,
			 casual_games, casual_wins, casual_draws
		  FROM stats WHERE user_id = ?
		ON CONFLICT(user_id, ruleset) DO UPDATE SET
			games        = stats.games + excluded.games,
			wins         = stats.wins + excluded.wins,
			draws        = stats.draws + excluded.draws,
			ranked_games = stats.ranked_games + excluded.ranked_games,
			ranked_wins  = stats.ranked_wins + excluded.ranked_wins,
			ranked_draws = stats.ranked_draws + excluded.ranked_draws,
			casual_games = stats.casual_games + excluded.casual_games,
			casual_wins  = stats.casual_wins + excluded.casual_wins,
			casual_draws = stats.casual_draws + excluded.casual_draws`,
		survivorID, victimID); err != nil {
		return err
	}

	// Ratings: keep the survivor's on any ruleset both played (it is the
	// established account); include mu/sigma so OpenSkill state is carried
	// through rather than reset to defaults.
	if _, err := tx.Exec(`INSERT INTO ratings (user_id, ruleset, elo, mu, sigma, updated_at)
		SELECT ?, ruleset, elo, mu, sigma, updated_at FROM ratings WHERE user_id = ?
		ON CONFLICT(user_id, ruleset) DO NOTHING`, survivorID, victimID); err != nil {
		return err
	}

	if err := foldWallet(tx, survivorID, victimID, now); err != nil {
		return err
	}

	// Cosmetics owned: union.
	if _, err := tx.Exec(`INSERT OR IGNORE INTO entitlements (user_id, item_id, source, granted_at)
		SELECT ?, item_id, source, granted_at FROM entitlements WHERE user_id = ?`, survivorID, victimID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM entitlements WHERE user_id = ?`, victimID); err != nil {
		return err
	}

	// Equipped cosmetics: keep the survivor's.
	if _, err := tx.Exec(`DELETE FROM loadout WHERE user_id = ?`, victimID); err != nil {
		return err
	}

	// Supporter status: keep the survivor's; adopt the victim's only if it has
	// none. Copy every perk column: cosmetics.owns() reads them, and the copied
	// updated_at stops a refresh from repairing a missing one.
	if _, err := tx.Exec(`INSERT OR IGNORE INTO supporter_status
			(user_id, active, since, until, updated_at, boosting, kofi, staff, gift)
		SELECT ?, active, since, until, updated_at, boosting, kofi, staff, gift
		  FROM supporter_status WHERE user_id = ?`, survivorID, victimID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM supporter_status WHERE user_id = ?`, victimID); err != nil {
		return err
	}

	// Ranked penalties: keep the stricter (more strikes / later cooldown), so a
	// merge cannot launder a competitive penalty. ranked_penalties has no FK to
	// users, so it is not in userRefs.
	if _, err := tx.Exec(`INSERT INTO ranked_penalties (user_id, strikes, cooldown_until, updated_at)
		SELECT ?, strikes, cooldown_until, updated_at FROM ranked_penalties WHERE user_id = ?
		ON CONFLICT(user_id) DO UPDATE SET
			strikes = MAX(ranked_penalties.strikes, excluded.strikes),
			cooldown_until = MAX(ranked_penalties.cooldown_until, excluded.cooldown_until),
			updated_at = MAX(ranked_penalties.updated_at, excluded.updated_at)`, survivorID, victimID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM ranked_penalties WHERE user_id = ?`, victimID); err != nil {
		return err
	}

	if err := foldModeration(tx, survivorID, victimID); err != nil {
		return err
	}

	// Friends: union (the victim's own rows are deleted here rather than left to
	// the cascade, so the fold is complete before the delete either way).
	if _, err := tx.Exec(`INSERT OR IGNORE INTO discord_friends (user_id, friend_discord_id)
		SELECT ?, friend_discord_id FROM discord_friends WHERE user_id = ?`, survivorID, victimID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM discord_friends WHERE user_id = ?`, victimID); err != nil {
		return err
	}

	// Sessions: delete the victim's rather than repoint them, which would turn
	// a possibly leaked guest token into an account credential. The caller
	// mints a fresh session after the merge.
	_, err := tx.Exec(`DELETE FROM sessions WHERE user_id = ?`, victimID)
	return err
}

// foldWallet carries the victim's currency across without paying the welcome
// grant twice. The signup idem key is per account, so a plain repoint would
// give the survivor a second grant.
//
// Everything is repointed (so the victim's debits keep the credit that funded
// them), then one compensating debit removes the unspent part of the duplicate
// grant, capped at the victim's balance so the result is never negative. The
// ledger is append-only, so this is a debit row, not a DELETE.
func foldWallet(tx *sql.Tx, survivorID, victimID, now int64) error {
	// What the victim still holds, and how much of their grant is unspent.
	var victimBalance, victimGrant int64
	if err := tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM wallet_ledger WHERE user_id = ?`,
		victimID).Scan(&victimBalance); err != nil {
		return err
	}
	if err := tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM wallet_ledger
		WHERE user_id = ? AND reason = ?`, victimID, signupLedgerReason).Scan(&victimGrant); err != nil {
		return err
	}
	var survivorGrant int64
	if err := tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM wallet_ledger
		WHERE user_id = ? AND reason = ?`, survivorID, signupLedgerReason).Scan(&survivorGrant); err != nil {
		return err
	}

	if _, err := tx.Exec(`UPDATE wallet_ledger SET user_id = ? WHERE user_id = ?`,
		survivorID, victimID); err != nil {
		return err
	}

	// Only a duplicate grant is clawed back. A survivor older than the faucet
	// has none, so the victim's grant is the first and stays.
	if survivorGrant > 0 && victimGrant > 0 {
		claw := min(victimGrant, victimBalance)
		if claw > 0 {
			if _, err := tx.Exec(`INSERT INTO wallet_ledger (user_id, amount, reason, idem_key, created_at)
				VALUES (?, ?, 'merge_duplicate_signup', ?, ?)`,
				survivorID, -claw, fmt.Sprintf("merge:%d:%d:signup", survivorID, victimID), now); err != nil {
				return err
			}
		}
	}

	if _, err := tx.Exec(`INSERT INTO wallet_balance (user_id, balance, updated_at)
		VALUES (?, (SELECT COALESCE(SUM(amount), 0) FROM wallet_ledger WHERE user_id = ?), ?)
		ON CONFLICT(user_id) DO UPDATE SET
			balance = (SELECT COALESCE(SUM(amount), 0) FROM wallet_ledger WHERE user_id = ?),
			updated_at = excluded.updated_at`,
		survivorID, survivorID, now, survivorID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM wallet_balance WHERE user_id = ?`, victimID); err != nil {
		return err
	}
	return nil
}

// foldModeration carries the victim's chat ban and name lock onto the
// survivor; these tables cascade on delete, so a merge would otherwise launder
// a ban. mod_strikes and chat_reports are histories and are repointed
// generically from userRefs.
func foldModeration(tx *sql.Tx, survivorID, victimID int64) error {
	// Chat ban and name lock are one row per user. The survivor's own row wins a
	// collision; either row means banned/locked.
	if _, err := tx.Exec(`INSERT OR IGNORE INTO chat_bans (user_id, reason, banned_at, banned_by, report_id, expires_at)
		SELECT ?, reason, banned_at, banned_by, report_id, expires_at FROM chat_bans WHERE user_id = ?`,
		survivorID, victimID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM chat_bans WHERE user_id = ?`, victimID); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO name_locks (user_id, reason, locked_at, locked_by)
		SELECT ?, reason, locked_at, locked_by FROM name_locks WHERE user_id = ?`,
		survivorID, victimID); err != nil {
		return err
	}
	_, err := tx.Exec(`DELETE FROM name_locks WHERE user_id = ?`, victimID)
	return err
}
