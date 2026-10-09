package store

import (
	"database/sql"
	"errors"
	"time"
)

// Moderation tunables: the report/ban policy lives here.
//
// Both counts decay. Warnings older than warnWindow stop counting towards
// escalation; the window is much longer than denialWindow because a warning is
// a heavier finding than a dismissed report.
const (
	warnEscalateThreshold = 3               // >= this many warns in warnWindow -> next warn bans
	warnWindow            = 180 * 24 * 3600 // seconds
	denialThreshold       = 5               // denials within the window that revoke reporting
	denialWindow          = 7 * 24 * 3600   // seconds
)

// WarnEscalateThreshold returns the number of prior warnings at or above which
// the next warn action escalates to a chat ban. Exported so server/ can read it
// without importing the unexported const directly.
func WarnEscalateThreshold() int { return warnEscalateThreshold }

// WarnWindow returns how far back WarnCount looks, so mod-facing strings need
// not hard-code it.
func WarnWindow() time.Duration { return warnWindow * time.Second }

// BanChat records a permanent chat ban (until UnbanChat). by/reportID are the
// acting mod's user id and the originating report, both optional.
func (s *Store) BanChat(userID int64, reason string, by, reportID *int64) error {
	_, err := s.db.Exec(`INSERT INTO chat_bans (user_id, reason, banned_at, banned_by, report_id)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			reason = excluded.reason, banned_at = excluded.banned_at,
			banned_by = excluded.banned_by, report_id = excluded.report_id`,
		userID, reason, time.Now().Unix(), by, reportID)
	return err
}

// UnbanChat lifts a chat ban. A no-op if the user was not banned.
func (s *Store) UnbanChat(userID int64) error {
	_, err := s.db.Exec(`DELETE FROM chat_bans WHERE user_id = ?`, userID)
	return err
}

// IsChatBanned reports whether the user currently cannot chat.
func (s *Store) IsChatBanned(userID int64) (bool, error) {
	var x int
	err := s.rdb.QueryRow(`SELECT 1 FROM chat_bans WHERE user_id = ?`, userID).Scan(&x)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// LockName freezes a user's display name until UnlockName. by is the acting mod's
// user id (nil for an automatic lock from the name filter). Idempotent: re-locking
// refreshes the reason/actor. Mirrors BanChat.
func (s *Store) LockName(userID int64, reason string, by *int64) error {
	_, err := s.db.Exec(`INSERT INTO name_locks (user_id, reason, locked_at, locked_by)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			reason = excluded.reason, locked_at = excluded.locked_at,
			locked_by = excluded.locked_by`,
		userID, reason, time.Now().Unix(), by)
	return err
}

// UnlockName lifts a name lock. A no-op if the user was not locked.
func (s *Store) UnlockName(userID int64) error {
	_, err := s.db.Exec(`DELETE FROM name_locks WHERE user_id = ?`, userID)
	return err
}

// IsNameLocked reports whether the user currently may not change their name.
func (s *Store) IsNameLocked(userID int64) (bool, error) {
	var x int
	err := s.rdb.QueryRow(`SELECT 1 FROM name_locks WHERE user_id = ?`, userID).Scan(&x)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// RecordStrike appends a moderation strike (kind "warn" on an accused, or
// "denial" on a reporter whose report was dismissed).
func (s *Store) RecordStrike(userID int64, kind string, reportID *int64) error {
	return s.recordStrikeAt(userID, kind, reportID, time.Now().Unix())
}

// recordStrikeAt is RecordStrike with an explicit timestamp (for tests).
func (s *Store) recordStrikeAt(userID int64, kind string, reportID *int64, at int64) error {
	_, err := s.db.Exec(`INSERT INTO mod_strikes (user_id, kind, report_id, created_at)
		VALUES (?, ?, ?, ?)`, userID, kind, reportID, at)
	return err
}

// WarnCount is the number of warnings issued to a user inside warnWindow, which
// is the count escalation is decided on. Warnings outside the window remain in
// mod_strikes as history (see LifetimeWarnCount) but no longer push anyone
// towards a ban.
func (s *Store) WarnCount(userID int64) (int, error) {
	return s.WarnCountSince(userID, time.Now().Unix()-warnWindow)
}

// WarnCountSince counts warn strikes recorded at or after sinceUnix. Mirrors
// DenialCountSince.
func (s *Store) WarnCountSince(userID, sinceUnix int64) (int, error) {
	var n int
	err := s.rdb.QueryRow(`SELECT COUNT(*) FROM mod_strikes
		WHERE user_id = ? AND kind = 'warn' AND created_at >= ?`, userID, sinceUnix).Scan(&n)
	return n, err
}

// LifetimeWarnCount is every warning ever issued to a user. It carries no policy
// weight; it is for a moderator who wants the whole history rather than the
// window escalation runs on.
func (s *Store) LifetimeWarnCount(userID int64) (int, error) {
	var n int
	err := s.rdb.QueryRow(`SELECT COUNT(*) FROM mod_strikes WHERE user_id = ? AND kind = 'warn'`, userID).Scan(&n)
	return n, err
}

// DenialCountSince counts denial strikes recorded at or after sinceUnix.
func (s *Store) DenialCountSince(userID, sinceUnix int64) (int, error) {
	var n int
	err := s.rdb.QueryRow(`SELECT COUNT(*) FROM mod_strikes
		WHERE user_id = ? AND kind = 'denial' AND created_at >= ?`, userID, sinceUnix).Scan(&n)
	return n, err
}

// CanReport reports whether a user may file reports (false once they reach
// denialThreshold dismissals inside denialWindow).
func (s *Store) CanReport(userID int64) (bool, error) {
	n, err := s.DenialCountSince(userID, time.Now().Unix()-denialWindow)
	if err != nil {
		return false, err
	}
	return n < denialThreshold, nil
}

// Report is a single moderation report joined to the offending message text.
type Report struct {
	ID          int64
	ReporterID  int64
	AccusedID   int64
	ChatID      int64
	Scope       string
	Status      string
	Resolution  string
	Msg         string
	ReportCount int
	CreatedAt   int64
}

// Automated reports whether the language filter raised this report rather than
// a player. handleReport refuses self-reports, so reporter == accused marks a
// filter row. Dismissing one must not give the accused a denial strike.
func (r *Report) Automated() bool { return r.ReporterID == r.AccusedID }

// CreateOrBumpReport opens a report for a chat message, or, if one is already
// open for that message, increments its count and returns the existing id
// (isNew=false). The partial unique index on (chat_id) WHERE status='open' makes
// the dedupe atomic: the loser of a concurrent INSERT re-SELECTs and bumps.
//
// The SELECTs stay on the write handle: each decides the next write, and the
// loser's re-SELECT must see the winner's row.
func (s *Store) CreateOrBumpReport(reporterID, accusedID, chatID int64, scope string) (int64, bool, error) {
	var id int64
	err := s.db.QueryRow(`SELECT id FROM chat_reports WHERE chat_id = ? AND status = 'open'`, chatID).Scan(&id)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		res, insErr := s.db.Exec(`INSERT INTO chat_reports
			(reporter_id, accused_id, chat_id, scope, created_at) VALUES (?, ?, ?, ?, ?)`,
			reporterID, accusedID, chatID, scope, time.Now().Unix())
		if insErr != nil {
			// Concurrent INSERT won the partial-unique-index race; re-SELECT and bump.
			var racedID int64
			if rerr := s.db.QueryRow(`SELECT id FROM chat_reports WHERE chat_id = ? AND status = 'open'`, chatID).Scan(&racedID); rerr != nil {
				return 0, false, insErr
			}
			// status='open': a concurrent ResolveReport may have closed it. A
			// 0-row update is a lost race, still isNew=false.
			if _, uerr := s.db.Exec(`UPDATE chat_reports SET report_count = report_count + 1 WHERE id = ? AND status = 'open'`, racedID); uerr != nil {
				return 0, false, uerr
			}
			return racedID, false, nil
		}
		newID, err := res.LastInsertId()
		return newID, true, err
	case err != nil:
		return 0, false, err
	}
	// status='open' guard: don't bump a report a concurrent ResolveReport closed
	// between the SELECT above and this UPDATE.
	if _, err := s.db.Exec(`UPDATE chat_reports SET report_count = report_count + 1 WHERE id = ? AND status = 'open'`, id); err != nil {
		return 0, false, err
	}
	return id, false, nil
}

// CreateFilterReport opens (or bumps) a report raised by the language filter.
// The filter reports instead of banning: the message is persisted but not
// broadcast, and a moderator decides. The accused is recorded as its own
// reporter, which Report.Automated reads back.
func (s *Store) CreateFilterReport(accusedID, chatID int64, scope string) (int64, bool, error) {
	return s.CreateOrBumpReport(accusedID, accusedID, chatID, scope)
}

// ReportByID loads a report with the reported message text.
func (s *Store) ReportByID(id int64) (*Report, error) {
	r := &Report{}
	var resolution sql.NullString
	err := s.rdb.QueryRow(`SELECT r.id, r.reporter_id, r.accused_id, r.chat_id, r.scope,
			r.status, r.resolution, r.report_count, r.created_at, COALESCE(c.msg, '')
		FROM chat_reports r LEFT JOIN chat c ON c.id = r.chat_id WHERE r.id = ?`, id).
		Scan(&r.ID, &r.ReporterID, &r.AccusedID, &r.ChatID, &r.Scope, &r.Status, &resolution, &r.ReportCount, &r.CreatedAt, &r.Msg)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.Resolution = resolution.String
	return r, nil
}

// ResolveReport atomically marks an open report resolved. resolvedNow is false
// if it was already resolved (lost race, double click); callers must then skip
// side effects.
func (s *Store) ResolveReport(id int64, resolution string, by *int64) (bool, error) {
	res, err := s.db.Exec(`UPDATE chat_reports
		SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ?
		WHERE id = ? AND status = 'open'`, resolution, time.Now().Unix(), by, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ReportOutcome is the result of ResolveReportAction.
type ReportOutcome struct {
	Resolved   bool   // false => already resolved (lost a double-click race)
	Effective  string // "none" | "warn" | "ban": the resolution actually applied
	Escalated  bool   // a "warn" that crossed the threshold and became a "ban"
	AccusedID  int64  // for caller-side DMs (read inside the tx)
	ReporterID int64
}

// ResolveReportAction resolves an open report and applies its side effect in
// one transaction: the warn-escalation decision (warn -> ban once the accused
// has >= WarnEscalateThreshold recent warns), the status flip and the
// strike/ban. Two concurrent warns therefore cannot both slip under the
// threshold, and a failed ban rolls back the resolution.
//
// action is "none" | "warn" | "ban"; banReason labels the chat_bans row. Returns
// Resolved=false (no error) if the report was already resolved.
func (s *Store) ResolveReportAction(reportID int64, action string, modID *int64, banReason string) (ReportOutcome, error) {
	var out ReportOutcome
	tx, err := s.db.Begin()
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRow(`SELECT accused_id, reporter_id, status FROM chat_reports WHERE id = ?`, reportID).
		Scan(&out.AccusedID, &out.ReporterID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if status != "open" {
		return out, nil // already actioned; Resolved stays false
	}

	resolution := action
	if action == "warn" {
		var warns int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM mod_strikes
			WHERE user_id = ? AND kind = 'warn' AND created_at >= ?`,
			out.AccusedID, time.Now().Unix()-warnWindow).Scan(&warns); err != nil {
			return out, err
		}
		if warns >= warnEscalateThreshold {
			resolution = "ban"
			out.Escalated = true
		}
	}

	now := time.Now().Unix()
	res, err := tx.Exec(`UPDATE chat_reports
		SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ?
		WHERE id = ? AND status = 'open'`, resolution, now, modID, reportID)
	if err != nil {
		return out, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return out, err
	} else if n == 0 {
		return out, nil // lost the race; Resolved stays false
	}

	switch resolution {
	case "none":
		// A filter-raised report has no human reporter (Report.Automated), so
		// there is nobody to penalise for filing it.
		if out.ReporterID != out.AccusedID {
			if _, err := tx.Exec(`INSERT INTO mod_strikes (user_id, kind, report_id, created_at)
				VALUES (?, 'denial', ?, ?)`, out.ReporterID, reportID, now); err != nil {
				return out, err
			}
		}
	case "warn":
		if _, err := tx.Exec(`INSERT INTO mod_strikes (user_id, kind, report_id, created_at)
			VALUES (?, 'warn', ?, ?)`, out.AccusedID, reportID, now); err != nil {
			return out, err
		}
	case "ban":
		if _, err := tx.Exec(`INSERT INTO chat_bans (user_id, reason, banned_at, banned_by, report_id)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET
				reason = excluded.reason, banned_at = excluded.banned_at,
				banned_by = excluded.banned_by, report_id = excluded.report_id`,
			out.AccusedID, banReason, now, modID, reportID); err != nil {
			return out, err
		}
	}

	if err := tx.Commit(); err != nil {
		return out, err
	}
	out.Resolved = true
	out.Effective = resolution
	return out, nil
}

// ErrReportSuperseded is returned by ReopenReport when a newer open report
// already covers the same message, so reopening this one would violate the
// one-open-report-per-message index.
var ErrReportSuperseded = errors.New("store: another open report already covers that message")

// ReopenOutcome is the result of ReopenReport.
type ReopenOutcome struct {
	Reopened   bool   // false => the report was not resolved, so there was nothing to undo
	Was        string // the resolution that was undone: "none" | "warn" | "ban"
	StrikeGone bool   // the warn/denial strike that resolution created was removed
	BanLifted  bool   // the chat ban that resolution applied was lifted
	AccusedID  int64
	ReporterID int64
}

// ReopenReport undoes a report resolution and puts the report back in the
// queue, in one transaction: the strike the resolution wrote is deleted, a ban
// it applied is lifted (only if the ban row still points at this report), and
// the status returns to 'open'. Reopened=false with no error means the report
// was not resolved. DMs already sent are not undone (see docs/moderation.md).
func (s *Store) ReopenReport(reportID int64) (ReopenOutcome, error) {
	var out ReopenOutcome
	tx, err := s.db.Begin()
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	var status string
	var chatID int64
	var resolution sql.NullString
	err = tx.QueryRow(`SELECT accused_id, reporter_id, chat_id, status, resolution FROM chat_reports WHERE id = ?`, reportID).
		Scan(&out.AccusedID, &out.ReporterID, &chatID, &status, &resolution)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if status != "resolved" {
		return out, nil // nothing to undo; Reopened stays false
	}
	out.Was = resolution.String

	// One open report per message (partial unique index): a newer open report
	// on the same message blocks the reopen, since it is already queued.
	var other int64
	switch err := tx.QueryRow(`SELECT id FROM chat_reports
		WHERE chat_id = ? AND status = 'open' AND id != ?`, chatID, reportID).Scan(&other); {
	case err == nil:
		return out, ErrReportSuperseded
	case errors.Is(err, sql.ErrNoRows):
	default:
		return out, err
	}

	// Delete only the strike this resolution wrote (subject, kind, report_id).
	// A filter report wrote no denial.
	switch out.Was {
	case "none":
		out.StrikeGone, err = deleteStrike(tx, out.ReporterID, "denial", reportID)
	case "warn":
		out.StrikeGone, err = deleteStrike(tx, out.AccusedID, "warn", reportID)
	case "ban":
		res, derr := tx.Exec(`DELETE FROM chat_bans WHERE user_id = ? AND report_id = ?`, out.AccusedID, reportID)
		if derr != nil {
			return out, derr
		}
		n, derr := res.RowsAffected()
		out.BanLifted, err = n > 0, derr
	}
	if err != nil {
		return out, err
	}

	if _, err := tx.Exec(`UPDATE chat_reports
		SET status = 'open', resolution = NULL, resolved_at = NULL, resolved_by = NULL
		WHERE id = ? AND status = 'resolved'`, reportID); err != nil {
		return out, err
	}
	if err := tx.Commit(); err != nil {
		return out, err
	}
	out.Reopened = true
	return out, nil
}

func deleteStrike(tx *sql.Tx, userID int64, kind string, reportID int64) (bool, error) {
	res, err := tx.Exec(`DELETE FROM mod_strikes WHERE user_id = ? AND kind = ? AND report_id = ?`,
		userID, kind, reportID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ForgiveLatestStrike removes a user's most recent strike of a kind ("warn" or
// "denial"), reporting whether there was one. It undoes a strike without
// reopening its report.
func (s *Store) ForgiveLatestStrike(userID int64, kind string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM mod_strikes WHERE id = (
		SELECT id FROM mod_strikes WHERE user_id = ? AND kind = ?
		ORDER BY created_at DESC, id DESC LIMIT 1)`, userID, kind)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// OpenReports returns the open report queue, oldest first, with the reported
// message text, so reports are reachable without Discord.
func (s *Store) OpenReports(limit int) ([]Report, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := s.rdb.Query(`SELECT r.id, r.reporter_id, r.accused_id, r.chat_id, r.scope,
			r.status, r.report_count, r.created_at, COALESCE(c.msg, '')
		FROM chat_reports r LEFT JOIN chat c ON c.id = r.chat_id
		WHERE r.status = 'open' ORDER BY r.created_at, r.id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Report
	for rows.Next() {
		var r Report
		if err := rows.Scan(&r.ID, &r.ReporterID, &r.AccusedID, &r.ChatID, &r.Scope,
			&r.Status, &r.ReportCount, &r.CreatedAt, &r.Msg); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// OpenReportBacklog returns how many reports are open and when the oldest was
// created (0 when there are none). Logged on a timer so a broken Discord bot is
// distinguishable from a quiet week.
func (s *Store) OpenReportBacklog() (count int, oldestUnix int64, err error) {
	var oldest sql.NullInt64
	err = s.rdb.QueryRow(`SELECT COUNT(*), MIN(created_at) FROM chat_reports WHERE status = 'open'`).
		Scan(&count, &oldest)
	return count, oldest.Int64, err
}

// ReportContext returns the chat around a reported message: up to n messages
// before it, the message itself, and up to n after, in order. The surrounding
// lines are delivered chat only, what the scope actually saw; the reported
// message itself is returned even when the filter dropped it, since that is
// what the moderator is judging.
func (s *Store) ReportContext(chatID int64, n int) ([]ChatLine, error) {
	if n < 0 {
		n = 0
	}
	var scope string
	err := s.rdb.QueryRow(`SELECT scope FROM chat WHERE id = ?`, chatID).Scan(&scope)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// Two windows plus the message itself, unioned so it is one round trip. The
	// chat_scope index (scope, id) makes each side a range scan.
	rows, err := s.rdb.Query(`
		SELECT id, scope, from_name, user_id, msg FROM (
			SELECT c.id AS id, c.scope AS scope,
				COALESCE(NULLIF(u.name, ''), 'Guest') AS from_name, c.user_id AS user_id, c.msg AS msg
			FROM chat c JOIN users u ON u.id = c.user_id
			WHERE c.scope = ? AND c.id <= ? AND (c.filtered = 0 OR c.id = ?) ORDER BY c.id DESC LIMIT ?
		) UNION ALL
		SELECT id, scope, from_name, user_id, msg FROM (
			SELECT c.id AS id, c.scope AS scope,
				COALESCE(NULLIF(u.name, ''), 'Guest') AS from_name, c.user_id AS user_id, c.msg AS msg
			FROM chat c JOIN users u ON u.id = c.user_id
			WHERE c.scope = ? AND c.id > ? AND c.filtered = 0 ORDER BY c.id LIMIT ?
		) ORDER BY id`, scope, chatID, chatID, n+1, scope, chatID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChatLine
	for rows.Next() {
		var l ChatLine
		if err := rows.Scan(&l.ID, &l.Scope, &l.From, &l.UserID, &l.Msg); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

const modChannelKey = "report_channel"

// SetModChannel stores the Discord channel id where report embeds are posted.
func (s *Store) SetModChannel(channelID string) error {
	_, err := s.db.Exec(`INSERT INTO mod_config (k, v) VALUES (?, ?)
		ON CONFLICT(k) DO UPDATE SET v = excluded.v`, modChannelKey, channelID)
	return err
}

// ModChannel returns the configured report channel id, or "" if unset.
func (s *Store) ModChannel() (string, error) {
	var v string
	err := s.rdb.QueryRow(`SELECT v FROM mod_config WHERE k = ?`, modChannelKey).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

const feedChannelKey = "feed_channel"

// SetFeedChannel stores the Discord channel id where game-start feed messages are
// posted. An empty id clears the setting (feed disabled).
func (s *Store) SetFeedChannel(channelID string) error {
	_, err := s.db.Exec(`INSERT INTO mod_config (k, v) VALUES (?, ?)
		ON CONFLICT(k) DO UPDATE SET v = excluded.v`, feedChannelKey, channelID)
	return err
}

// FeedChannel returns the configured game-feed channel id, or "" if unset.
func (s *Store) FeedChannel() (string, error) {
	var v string
	err := s.rdb.QueryRow(`SELECT v FROM mod_config WHERE k = ?`, feedChannelKey).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

const feedTitleKey = "feed_title"

// SetFeedTitle stores an override for the game-feed heading. An empty string
// clears it (the feed falls back to its default title).
func (s *Store) SetFeedTitle(title string) error {
	_, err := s.db.Exec(`INSERT INTO mod_config (k, v) VALUES (?, ?)
		ON CONFLICT(k) DO UPDATE SET v = excluded.v`, feedTitleKey, title)
	return err
}

// FeedTitle returns the configured game-feed title override, or "" if unset.
func (s *Store) FeedTitle() (string, error) {
	var v string
	err := s.rdb.QueryRow(`SELECT v FROM mod_config WHERE k = ?`, feedTitleKey).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// SetReportMessageID records the mod-channel message id for a report (audit).
func (s *Store) SetReportMessageID(id int64, messageID string) error {
	_, err := s.db.Exec(`UPDATE chat_reports SET discord_message_id = ? WHERE id = ?`, messageID, id)
	return err
}

// OpenReportForChat returns the open report for a chat message, or ErrNotFound.
func (s *Store) OpenReportForChat(chatID int64) (*Report, error) {
	var id int64
	err := s.rdb.QueryRow(`SELECT id FROM chat_reports WHERE chat_id = ? AND status = 'open'`, chatID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.ReportByID(id)
}
