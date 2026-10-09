package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type Game struct {
	ID      string          `json:"id"`
	Status  string          `json:"status"`
	Ruleset string          `json:"ruleset"`
	Config  json.RawMessage `json:"config"`
	// InviteCode is the table's link, minted at creation and kept for the
	// game's life. It is not the privacy flag: public tables have one too.
	InviteCode string `json:"invite_code,omitempty"`
	// Public decides whether the table appears in the browser and whether it
	// can be joined without the code. A private table is unlisted and code-only.
	Public     bool   `json:"public"`
	CreatedBy  int64  `json:"created_by"`
	Winner     *int64 `json:"winner,omitempty"`
	CreatedAt  int64  `json:"created_at"`
	FinishedAt *int64 `json:"finished_at,omitempty"`
	Ranked     bool   `json:"ranked"`
	// PublicSeed is the verifiable seed, drawn and committed when the lobby
	// opened and used to start the game later. Stored as a decimal string: it
	// is a uint64 and SQLite's INTEGER is signed. Empty on games created
	// before migration 0030, which run on a single undivided seed.
	PublicSeed string `json:"-"`
	// PublicSeedCommit is SHA-256 of PublicSeed, published to the lobby as
	// soon as the table exists. Safe to show anyone; see docs/dice.md.
	PublicSeedCommit string `json:"public_seed_commit,omitempty"`
	// PreShuffleSeats is the roster the turn-order shuffle was applied to, as a
	// JSON array of user ids in pre-shuffle seat order. Without it the derived
	// permutation is unfalsifiable: every final seating matches some input.
	// Empty when nothing was shuffled (turn_order "lobby") or the game predates
	// migration 0030.
	PreShuffleSeats string `json:"-"`
}

type Seat struct {
	GameID   string `json:"game_id"`
	No       int    `json:"no"`
	UserID   int64  `json:"user_id"`
	Status   string `json:"status"` // active | auto | bot
	UserName string `json:"user_name"`
	IsGuest  bool   `json:"is_guest"`
	// Avatar is the player's profile-picture URL, or "" (the UI falls back to a
	// generated color disc; bots and guests have none). Joined from the account.
	Avatar string `json:"avatar,omitempty"`
	// Color is the seat's chosen cosmetics palette color id, or "" for none.
	// It is storage-only and never sent to clients; the lobby derives the
	// effective ColorHex (chosen or seat-order default) for the wire.
	Color string `json:"-"`
	// DisplayName is the raw per-seat name override ("" = none). Storage-only
	// and never sent to clients (UserName already carries the effective name);
	// exposed so the start path can carry it when reordering seats.
	DisplayName string `json:"-"`
	// ColorHex is the effective render color (always a hex like "#ff0000"),
	// filled by the lobby when building a Summary. Empty off the wire path.
	ColorHex string `json:"color,omitempty"`
	// Decoration is the player's equipped name decoration (item id, or "" for
	// none), joined from the loadout so other players see it.
	Decoration string `json:"decoration,omitempty"`
	// Robber is the player's equipped robber skin (item id, or "" for the stock
	// art). The game layer uses it to dress the robber for the whole table when
	// this seat last moved it.
	Robber string `json:"robber,omitempty"`
	// Pieces is the player's equipped piece set (item id, or "" for the stock
	// buildings). Every viewer needs every seat's.
	Pieces string `json:"pieces,omitempty"`
	// Rating is the player's effective display rating for the game's ruleset,
	// filled by the lobby when building a Summary, only for non-guest seats, so
	// bots and guests carry none. Provisional flags a still-calibrating rating.
	// Both are off the storage path; set only on the wire via Summary.
	Rating      int  `json:"rating,omitempty"`
	Provisional bool `json:"provisional,omitempty"`
}

func (s *Store) CreateGame(g *Game) error {
	_, err := s.db.Exec(`
		INSERT INTO games (id, status, ruleset, config, invite_code, public, created_by, created_at, ranked, public_seed, public_seed_commit)
		VALUES (?, 'lobby', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		g.ID, g.Ruleset, string(g.Config), nullable(g.InviteCode), g.Public, g.CreatedBy, time.Now().Unix(), g.Ranked,
		nullable(g.PublicSeed), nullable(g.PublicSeedCommit))
	return err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *Store) GameByID(id string) (*Game, error) {
	return s.gameBy(`id = ?`, id)
}

func (s *Store) GameByInvite(code string) (*Game, error) {
	return s.gameBy(`invite_code = ?`, code)
}

func (s *Store) gameBy(where string, arg any) (*Game, error) {
	g := &Game{}
	var invite sql.NullString
	var seed, commit, preSeats sql.NullString
	var cfg string
	err := s.rdb.QueryRow(`
		SELECT id, status, ruleset, config, invite_code, public, created_by, winner_user_id, created_at, finished_at, ranked, public_seed, public_seed_commit, pre_shuffle_seats
		FROM games WHERE `+where, arg).
		Scan(&g.ID, &g.Status, &g.Ruleset, &cfg, &invite, &g.Public, &g.CreatedBy, &g.Winner, &g.CreatedAt, &g.FinishedAt, &g.Ranked, &seed, &commit, &preSeats)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	g.Config = json.RawMessage(cfg)
	g.InviteCode = invite.String
	g.PublicSeed, g.PublicSeedCommit = seed.String, commit.String
	g.PreShuffleSeats = preSeats.String
	return g, nil
}

// ListGames returns games by status; public only unless includePrivate. It
// filters on the `public` column, since public tables have invite codes too.
func (s *Store) ListGames(status string, includePrivate bool) ([]*Game, error) {
	q := `SELECT id, status, ruleset, config, invite_code, public, created_by, winner_user_id, created_at, finished_at, ranked
	      FROM games WHERE status = ?`
	if !includePrivate {
		q += ` AND public = 1`
	}
	q += ` ORDER BY created_at DESC LIMIT 100`
	rows, err := s.rdb.Query(q, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Game
	for rows.Next() {
		g := &Game{}
		var invite sql.NullString
		var cfg string
		if err := rows.Scan(&g.ID, &g.Status, &g.Ruleset, &cfg, &invite, &g.Public, &g.CreatedBy, &g.Winner, &g.CreatedAt, &g.FinishedAt, &g.Ranked); err != nil {
			return nil, err
		}
		g.Config = json.RawMessage(cfg)
		g.InviteCode = invite.String
		out = append(out, g)
	}
	return out, rows.Err()
}

func (s *Store) UpdateGameConfig(id string, config json.RawMessage) error {
	_, err := s.db.Exec(`UPDATE games SET config = ? WHERE id = ?`, string(config), id)
	return err
}

func (s *Store) UpdateGameRuleset(id, ruleset string) error {
	_, err := s.db.Exec(`UPDATE games SET ruleset = ? WHERE id = ?`, ruleset, id)
	return err
}

// SetGameInvite sets a game's invite code, for a game that predates 0029 and
// has none. Privacy is SetGamePublic.
func (s *Store) SetGameInvite(id, code string) error {
	_, err := s.db.Exec(`UPDATE games SET invite_code = ? WHERE id = ?`, nullable(code), id)
	return err
}

// SetGamePublic lists or unlists a table. The invite code is untouched, so a
// link already handed out keeps working across any number of flips.
func (s *Store) SetGamePublic(id string, public bool) error {
	_, err := s.db.Exec(`UPDATE games SET public = ? WHERE id = ?`, public, id)
	return err
}

func (s *Store) SetGameStatus(id, status string) error {
	_, err := s.db.Exec(`UPDATE games SET status = ? WHERE id = ?`, status, id)
	return err
}

// SetGameHost reassigns a game's host (the CreatedBy owner) to another user.
func (s *Store) SetGameHost(id string, userID int64) error {
	_, err := s.db.Exec(`UPDATE games SET created_by = ? WHERE id = ?`, userID, id)
	return err
}

// nullableID maps the "no such user" zero to SQL NULL. games.winner_user_id is
// nullable and REFERENCES users(id); a literal 0 would violate the foreign key.
// Callers pass 0 for "nobody won".
func nullableID(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}

// FinishGame marks a game finished. A winnerUserID of 0 means nobody won (the
// game was drawn) and is stored as NULL.
func (s *Store) FinishGame(id string, winnerUserID int64) error {
	if _, err := s.db.Exec(`UPDATE games SET status = 'finished', winner_user_id = ?, finished_at = ? WHERE id = ?`,
		nullableID(winnerUserID), time.Now().Unix(), id); err != nil {
		return err
	}
	return s.dropSnapshot(id)
}

// FinishGameOnce transitions a game to 'finished' exactly once and reports
// whether this call performed the transition (RowsAffected == 1). It is the
// idempotency guard for finalization: callers bump stats/ratings only when won
// is true, so a duplicate OnFinish counts once.
func (s *Store) FinishGameOnce(id string, winnerUserID int64) (won bool, err error) {
	res, err := s.db.Exec(
		`UPDATE games SET status = 'finished', winner_user_id = ?, finished_at = ? WHERE id = ? AND status != 'finished'`,
		nullableID(winnerUserID), time.Now().Unix(), id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if n == 1 {
		if err := s.dropSnapshot(id); err != nil {
			return true, err
		}
	}
	return n == 1, nil
}

// dropSnapshot deletes a game's snapshot when it finishes: snapshots only speed
// up reloading a live game, and replays fold the event log. Event logs are
// never pruned (replay and the fairness audit need them).
//
// Not transactional with the finish: a surviving snapshot is wasted bytes, not
// a wrong answer. The async snapshot worker can write one back just after a
// finish; PruneFinishedSnapshots catches those.
func (s *Store) dropSnapshot(gameID string) error {
	_, err := s.db.Exec(`DELETE FROM snapshots WHERE game_id = ?`, gameID)
	return err
}

// PruneFinishedSnapshots deletes snapshots belonging to games that are already
// finished, up to limit rows, and reports how many it removed. Idempotent and
// re-runnable: call it until it returns 0 to work through a backlog without
// holding the single writer connection for one large DELETE.
func (s *Store) PruneFinishedSnapshots(limit int) (int64, error) {
	res, err := s.db.Exec(`
		DELETE FROM snapshots WHERE rowid IN (
			SELECT sn.rowid FROM snapshots sn JOIN games g ON g.id = sn.game_id
			WHERE g.status = 'finished' LIMIT ?)`, limit)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ErrSeatTaken means the user already holds a seat in this game: a concurrent
// Join won the race against the (game_id, user_id) unique index. Distinct from a
// seat_no PK collision, which the caller should retry against the next free seat.
var ErrSeatTaken = errors.New("store: user already seated in this game")

func (s *Store) AddSeat(gameID string, no int, userID int64) error {
	_, err := s.db.Exec(`INSERT INTO seats (game_id, seat_no, user_id) VALUES (?, ?, ?)`, gameID, no, userID)
	if err != nil && isUniqueViolation(err) {
		// Two constraints can fire: the (game_id, seat_no) PK (someone else grabbed
		// this seat; caller should retry) or the (game_id, user_id) unique index
		// (this user is already seated). Disambiguate by checking whether the
		// user already has a seat here, on the write handle since it reads what
		// the INSERT just collided with.
		var x int
		if qerr := s.db.QueryRow(`SELECT 1 FROM seats WHERE game_id = ? AND user_id = ?`,
			gameID, userID).Scan(&x); qerr == nil {
			return ErrSeatTaken
		}
	}
	return err
}

func (s *Store) RemoveSeat(gameID string, no int) error {
	_, err := s.db.Exec(`DELETE FROM seats WHERE game_id = ? AND seat_no = ?`, gameID, no)
	return err
}

func (s *Store) SetSeatStatus(gameID string, no int, status string) error {
	_, err := s.db.Exec(`UPDATE seats SET status = ? WHERE game_id = ? AND seat_no = ?`, status, gameID, no)
	return err
}

// SetSeatColor persists a seat's chosen color id ("" clears it back to default).
func (s *Store) SetSeatColor(gameID string, no int, color string) error {
	_, err := s.db.Exec(`UPDATE seats SET color = ? WHERE game_id = ? AND seat_no = ?`, color, gameID, no)
	return err
}

// SetSeatDisplayName persists a seat's per-game name override ("" clears it back
// to the user's account name).
func (s *Store) SetSeatDisplayName(gameID string, no int, name string) error {
	_, err := s.db.Exec(`UPDATE seats SET display_name = ? WHERE game_id = ? AND seat_no = ?`, name, gameID, no)
	return err
}

// seatSelect resolves the effective seat name (per-seat override, then account
// name, then "Guest") in SQL so every reader is consistent.
const seatSelect = `
	SELECT s.game_id, s.seat_no, s.user_id, s.status,
	       COALESCE(NULLIF(s.display_name, ''), NULLIF(u.name, ''), 'Guest'),
	       u.is_guest, s.color, s.display_name,
	       COALESCE(ld_dec.item_id, ''), u.avatar,
	       COALESCE(ld_rb.item_id, ''), COALESCE(ld_pc.item_id, '')
	FROM seats s JOIN users u ON u.id = s.user_id
	LEFT JOIN loadout ld_dec ON ld_dec.user_id = s.user_id AND ld_dec.slot = 'decoration'
	LEFT JOIN loadout ld_rb  ON ld_rb.user_id  = s.user_id AND ld_rb.slot  = 'robber'
	LEFT JOIN loadout ld_pc  ON ld_pc.user_id  = s.user_id AND ld_pc.slot  = 'pieces'`

func (s *Store) Seats(gameID string) ([]*Seat, error) {
	rows, err := s.rdb.Query(seatSelect+`
		WHERE s.game_id = ? ORDER BY s.seat_no`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Seat
	for rows.Next() {
		st := &Seat{}
		if err := rows.Scan(&st.GameID, &st.No, &st.UserID, &st.Status, &st.UserName, &st.IsGuest, &st.Color, &st.DisplayName, &st.Decoration, &st.Avatar, &st.Robber, &st.Pieces); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// SeatsForGames fetches seats for many games in a single query, grouped by game
// id. It's the batched form of Seats, used by lobby browse to avoid an N+1 (one
// Seats query per listed game). Games with no seats are simply absent from the map.
func (s *Store) SeatsForGames(gameIDs []string) (map[string][]*Seat, error) {
	out := make(map[string][]*Seat, len(gameIDs))
	if len(gameIDs) == 0 {
		return out, nil
	}
	ph := make([]string, len(gameIDs))
	args := make([]any, len(gameIDs))
	for i, id := range gameIDs {
		ph[i] = "?"
		args[i] = id
	}
	rows, err := s.rdb.Query(seatSelect+`
		WHERE s.game_id IN (`+strings.Join(ph, ",")+`) ORDER BY s.game_id, s.seat_no`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		st := &Seat{}
		if err := rows.Scan(&st.GameID, &st.No, &st.UserID, &st.Status, &st.UserName, &st.IsGuest, &st.Color, &st.DisplayName, &st.Decoration, &st.Avatar, &st.Robber, &st.Pieces); err != nil {
			return nil, err
		}
		out[st.GameID] = append(out[st.GameID], st)
	}
	return out, rows.Err()
}

// SaveChat persists a chat line ("lobby" or "game:<id>" scope) and returns its id.
func (s *Store) SaveChat(scope string, userID int64, msg string) (int64, error) {
	return s.saveChat(scope, userID, msg, false)
}

// SaveFilteredChat persists a message the language filter dropped. It is kept
// for the moderator (its report points at it) and marked, so no read a player
// can reach (RecentChat, ChatByID, another report's context) returns it.
func (s *Store) SaveFilteredChat(scope string, userID int64, msg string) (int64, error) {
	return s.saveChat(scope, userID, msg, true)
}

func (s *Store) saveChat(scope string, userID int64, msg string, filtered bool) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO chat (scope, user_id, msg, ts, filtered) VALUES (?, ?, ?, ?, ?)`,
		scope, userID, msg, time.Now().Unix(), filtered)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ChatLine is one stored chat message with the sender's effective display name,
// matching the live "chat" ws frame shape ({id, scope, from, user_id, msg}).
type ChatLine struct {
	ID     int64  `json:"id"`
	Scope  string `json:"scope"`
	From   string `json:"from"`
	UserID int64  `json:"user_id"`
	Msg    string `json:"msg"`
}

// RecentChat returns the last `limit` messages for a scope, joined to users for
// the display name, oldest->newest. Used to seed the in-game chat from the HTTP
// response. The chat_scope index (scope, id) makes the per-scope tail cheap.
func (s *Store) RecentChat(scope string, limit int) ([]ChatLine, error) {
	if limit <= 0 {
		return nil, nil
	}
	// Newest `limit` by id desc, then reversed to oldest->newest below.
	rows, err := s.rdb.Query(`
		SELECT c.id, c.scope, COALESCE(NULLIF(u.name, ''), 'Guest'), c.user_id, c.msg
		FROM chat c JOIN users u ON u.id = c.user_id
		WHERE c.scope = ? AND c.filtered = 0
		ORDER BY c.id DESC LIMIT ?`, scope, limit)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Reverse in place to oldest->newest.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// ChatByID returns one delivered chat line by row id (scope + author + text)
// for reporting. A filtered message is ErrNotFound: no player saw it, so a
// report on it could only come from guessing ids.
func (s *Store) ChatByID(id int64) (*ChatLine, error) {
	l := &ChatLine{}
	err := s.rdb.QueryRow(`SELECT c.id, c.scope, COALESCE(NULLIF(u.name,''),'Guest'), c.user_id, c.msg
		FROM chat c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.filtered = 0`, id).
		Scan(&l.ID, &l.Scope, &l.From, &l.UserID, &l.Msg)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return l, err
}

// SeatForUser returns the user's seat in a game, or ErrNotFound.
func (s *Store) SeatForUser(gameID string, userID int64) (*Seat, error) {
	st := &Seat{}
	err := s.rdb.QueryRow(seatSelect+`
		WHERE s.game_id = ? AND s.user_id = ?`, gameID, userID).
		Scan(&st.GameID, &st.No, &st.UserID, &st.Status, &st.UserName, &st.IsGuest, &st.Color, &st.DisplayName, &st.Decoration, &st.Avatar, &st.Robber, &st.Pieces)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return st, nil
}

// seatedGamesFrom is the shape every "which open table is this user at?" query
// takes, with the caller supplying the tail (LIMIT, or nothing).
//
// It drives from games, not seats, so the cost scales with the number of open
// tables rather than with every seat the user has ever held
// (games_status_created per status, then a covering EXISTS probe on
// seats_game_user). It runs on /api/users/me, every websocket connect and once
// per friend in the friends panel.
const seatedGamesFrom = `
		SELECT g.id, g.status FROM games g
		WHERE g.status IN ('lobby','active')
		  AND EXISTS (SELECT 1 FROM seats st WHERE st.game_id = g.id AND st.user_id = ?)
		ORDER BY g.created_at DESC`

// ActiveGameForUser returns the id of an active/lobby game the user holds a
// seat in, or "". Used for presence and rejoin.
func (s *Store) ActiveGameForUser(userID int64) (string, error) {
	var id, status string
	err := s.rdb.QueryRow(seatedGamesFrom+` LIMIT 1`, userID).Scan(&id, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// SeatedGame is a game id paired with its status, for the seated-games lookup.
type SeatedGame struct {
	ID     string
	Status string
}

// SeatedGameForUser returns the newest lobby/active game the user holds a seat
// in, paired with its status, or a zero SeatedGame (empty id, nil error) if they
// hold none. Like ActiveGameForUser but also reports the status, so callers can
// distinguish a game in progress from one still waiting in the lobby.
func (s *Store) SeatedGameForUser(userID int64) (SeatedGame, error) {
	var sg SeatedGame
	err := s.rdb.QueryRow(seatedGamesFrom+` LIMIT 1`, userID).Scan(&sg.ID, &sg.Status)
	if errors.Is(err, sql.ErrNoRows) {
		return SeatedGame{}, nil
	}
	return sg, err
}

// SeatedActiveGames returns every lobby/active game the user holds a seat in,
// newest first. Unlike ActiveGameForUser this returns all of them; the entry
// path uses it to detach a user from any prior table when they join a new one.
func (s *Store) SeatedActiveGames(userID int64) ([]SeatedGame, error) {
	rows, err := s.rdb.Query(seatedGamesFrom, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SeatedGame
	for rows.Next() {
		var sg SeatedGame
		if err := rows.Scan(&sg.ID, &sg.Status); err != nil {
			return nil, err
		}
		out = append(out, sg)
	}
	return out, rows.Err()
}

// SetPreShuffleSeats records the roster a game's turn-order shuffle was applied
// to, in pre-shuffle seat order, so the seating can be verified against the
// committed public seed after the game (see migration 0030 and verify/).
// Written once, by the lobby, in the same call that permutes the seats.
func (s *Store) SetPreShuffleSeats(gameID string, userIDs []int64) error {
	b, err := json.Marshal(userIDs)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE games SET pre_shuffle_seats = ? WHERE id = ?`, string(b), gameID)
	return err
}
