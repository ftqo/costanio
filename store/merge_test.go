package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
)

// helper: seed a registered user with one identity, return id.
func seedUser(t *testing.T, s *Store, provider, pid, name string) int64 {
	t.Helper()
	u, err := s.UpsertUser(provider, pid, name, "", "")
	if err != nil {
		t.Fatalf("UpsertUser: %v", err)
	}
	return u.ID
}

func TestMergeAccountsFoldsContentAndDeletesVictim(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "discord", "D1", "Survivor")
	vic := seedUser(t, s, "google", "G2", "Victim")

	// give the victim some content
	if _, err := s.db.Exec(`INSERT INTO stats (user_id,ruleset,games,wins) VALUES (?,?,?,?)`, vic, "base", 10, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO stats (user_id,ruleset,games,wins) VALUES (?,?,?,?)`, surv, "base", 2, 1); err != nil {
		t.Fatal(err)
	}
	// Credit through the ledger rather than poking wallet_balance directly: the
	// cache is derived from the journal, and the merge recomputes it from there.
	if _, err := s.LedgerCredit(vic, 50, "match", "match:g-vic:0"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LedgerCredit(surv, 20, "match", "match:g-surv:0"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO entitlements (user_id,item_id,source,granted_at) VALUES (?,?,?,?)`, vic, "robber.x", "grant", 0); err != nil {
		t.Fatal(err)
	}

	if err := s.MergeAccounts(surv, vic); err != nil {
		t.Fatalf("MergeAccounts: %v", err)
	}

	// victim is gone
	if _, err := s.UserByID(vic); !errors.Is(err, ErrNotFound) {
		t.Fatalf("victim still present: %v", err)
	}
	// stats summed
	var games, wins int
	if err := s.db.QueryRow(`SELECT games,wins FROM stats WHERE user_id=? AND ruleset='base'`, surv).Scan(&games, &wins); err != nil {
		t.Fatal(err)
	}
	if games != 12 || wins != 5 {
		t.Fatalf("stats not summed: games=%d wins=%d", games, wins)
	}
	// wallet summed
	var bal int
	if err := s.db.QueryRow(`SELECT balance FROM wallet_balance WHERE user_id=?`, surv).Scan(&bal); err != nil {
		t.Fatal(err)
	}
	if bal != 70 {
		t.Fatalf("wallet not summed: %d", bal)
	}
	// entitlement moved
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM entitlements WHERE user_id=? AND item_id='robber.x'`, surv).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("entitlement not moved: %d", n)
	}
	// victim's google identity now belongs to survivor
	owner, err := s.UserByProvider("google", "G2")
	if err != nil || owner.ID != surv {
		t.Fatalf("identity not moved: owner=%v err=%v", owner, err)
	}
	// no orphans anywhere
	for _, tbl := range []string{"stats", "ratings", "wallet_balance", "entitlements", "loadout", "supporter_status", "ranked_penalties", "identities", "sessions", "seats", "chat"} {
		var c int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM `+tbl+` WHERE user_id=?`, vic).Scan(&c); err != nil {
			t.Fatalf("count %s: %v", tbl, err)
		}
		if c != 0 {
			t.Fatalf("orphan rows in %s for victim: %d", tbl, c)
		}
	}
}

func TestMergeKeepsSurvivorProviderIdentity(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "google", "GS", "Survivor")
	vic := seedUser(t, s, "google", "GV", "Victim") // same provider as survivor
	if err := s.MergeAccounts(surv, vic); err != nil {
		t.Fatalf("MergeAccounts: %v", err)
	}
	// survivor keeps GS; GV was dropped (cascade on victim delete)
	owner, err := s.UserByProvider("google", "GS")
	if err != nil || owner.ID != surv {
		t.Fatalf("survivor lost its identity: %v %v", owner, err)
	}
	if _, err := s.UserByProvider("google", "GV"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("victim duplicate identity survived: %v", err)
	}
}

func TestMergeAccountsRefusesSharedGame(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "discord", "D1", "S")
	vic := seedUser(t, s, "google", "G2", "V")
	// seed a game both sit in. config is NOT NULL, so supply '{}'.
	if _, err := s.db.Exec(`INSERT INTO games (id,ruleset,status,config,created_by,created_at) VALUES ('g1','base','lobby','{}',?,0)`, surv); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO seats (game_id,seat_no,user_id) VALUES ('g1',0,?)`, surv); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO seats (game_id,seat_no,user_id) VALUES ('g1',1,?)`, vic); err != nil {
		t.Fatal(err)
	}
	if err := s.MergeAccounts(surv, vic); !errors.Is(err, ErrMergeSharedGame) {
		t.Fatalf("want ErrMergeSharedGame, got %v", err)
	}
}

// signupPayout mirrors econ.SignupPayout. store cannot import econ (econ imports
// store), so the amount is spelled out here the way the merge spells out the
// reason.
const signupPayout = 5_000

// grantSignup credits the one-time welcome grant exactly the way
// auth.Service.grantSignup does at guest creation, via econ.Ledger.Signup: the
// idem key is "signup:{userID}", per account rather than per human.
func grantSignup(t *testing.T, s *Store, userID int64) {
	t.Helper()
	if _, err := s.LedgerCredit(userID, signupPayout, signupLedgerReason, fmt.Sprintf("signup:%d", userID)); err != nil {
		t.Fatalf("signup grant for %d: %v", userID, err)
	}
}

// TestMergeGuestIntoProviderWithProductionRows merges a guest holding the rows
// production writes (signup grant, a finished game, purchases) into the account
// being logged into. Any unhandled users(id) reference fails the delete.
func TestMergeGuestIntoProviderWithProductionRows(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "discord", "D_prod", "Survivor")
	grantSignup(t, s, surv)

	g, err := s.CreateGuest("guest")
	if err != nil {
		t.Fatal(err)
	}
	grantSignup(t, s, g.ID)

	// A game the guest hosted, played, won and recorded, which puts a row in
	// match_history.winner_user_id (a users(id) reference with no cascade).
	gm := &Game{ID: "prod_g1", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: g.ID}
	if err := s.CreateGame(gm); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat(gm.ID, 0, g.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishGame(gm.ID, g.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveMatchHistory(MatchHistoryRow{
		GameID: gm.ID, Ruleset: "base", WinnerUserID: &g.ID, FinishedAt: 100, Record: "{}",
	}); err != nil {
		t.Fatal(err)
	}

	// The rest of what a guest accumulates: a purchase, an equipped item, a
	// supporter row, a saved map, a chat line.
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO entitlements (user_id,item_id,source,granted_at) VALUES (?,'robber.gold','purchase',0)`, []any{g.ID}},
		{`INSERT INTO loadout (user_id,slot,item_id) VALUES (?,'robber','robber.gold')`, []any{g.ID}},
		{`INSERT INTO supporter_status (user_id,active,since,until,updated_at) VALUES (?,1,1,2,3)`, []any{g.ID}},
		{`INSERT INTO maps (id,name,board,created_by,created_at) VALUES ('m1','M','{}',?,0)`, []any{g.ID}},
		{`INSERT INTO chat (scope,user_id,msg,ts) VALUES ('lobby',?,'hi',0)`, []any{g.ID}},
	} {
		if _, err := s.db.Exec(q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}

	merged, err := s.MergeGuestIntoProvider(g.ID, Identity{Provider: "discord", ProviderID: "D_prod", Name: "Survivor"})
	if err != nil {
		t.Fatalf("MergeGuestIntoProvider: %v", err)
	}
	if merged.ID != surv {
		t.Fatalf("merged into %d, want survivor %d", merged.ID, surv)
	}
	if _, err := s.UserByID(g.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("guest row should be gone, err = %v", err)
	}
	assertNoRowsReferenceUser(t, s, g.ID)

	// The guest's win followed them.
	row, err := s.MatchHistoryByGame(gm.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.WinnerUserID == nil || *row.WinnerUserID != surv {
		t.Errorf("match_history winner = %v, want survivor %d", row.WinnerUserID, surv)
	}
	var winner int64
	if err := s.db.QueryRow(`SELECT winner_user_id FROM games WHERE id = ?`, gm.ID).Scan(&winner); err != nil {
		t.Fatal(err)
	}
	if winner != surv {
		t.Errorf("games.winner_user_id = %d, want survivor %d", winner, surv)
	}

	// One human, one welcome grant.
	if bal := assertBalanceMatchesLedger(t, s, surv); bal != signupPayout {
		t.Errorf("balance after merge = %d, want a single signup grant of %d", bal, signupPayout)
	}
}

// TestMergeDoesNotFarmTheSignupFaucet: the signup idem key is per account, so
// merging throwaway guests must not accumulate welcome grants.
func TestMergeDoesNotFarmTheSignupFaucet(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "discord", "D_farm", "Farmer")
	grantSignup(t, s, surv)

	// Mint all four throwaways before merging any. users.id has no
	// AUTOINCREMENT, so a merged-away id would be reused and its signup key
	// would collide.
	guests := make([]int64, 4)
	for i := range guests {
		g, err := s.CreateGuest("throwaway")
		if err != nil {
			t.Fatal(err)
		}
		guests[i] = g.ID
		grantSignup(t, s, g.ID)
		// One genuinely earned credit, which must survive the merge.
		if _, err := s.LedgerCredit(g.ID, 10, "match", fmt.Sprintf("match:farm%d:%d", i, g.ID)); err != nil {
			t.Fatal(err)
		}
	}
	for i, id := range guests {
		if _, err := s.MergeGuestIntoProvider(id, Identity{Provider: "discord", ProviderID: "D_farm", Name: "Farmer"}); err != nil {
			t.Fatalf("merge %d: %v", i, err)
		}
	}

	bal := assertBalanceMatchesLedger(t, s, surv)
	if want := signupPayout + 4*10; bal != want {
		t.Errorf("balance after 4 merges = %d, want %d", bal, want)
	}
	// The net welcome grant, not the row count: duplicates are clawed back by
	// a compensating debit, not deleted.
	var netGrant int
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM wallet_ledger
		WHERE user_id = ? AND reason IN (?, 'merge_duplicate_signup')`,
		surv, signupLedgerReason).Scan(&netGrant); err != nil {
		t.Fatal(err)
	}
	if netGrant != signupPayout {
		t.Errorf("net welcome grant after 4 merges = %d, want %d", netGrant, signupPayout)
	}
}

// TestMergeAdoptsSignupGrant covers the other side of the
// collapse: an account predating the faucet keeps the one grant it absorbs.
func TestMergeAdoptsSignupGrant(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "discord", "D_old", "Old")
	g, err := s.CreateGuest("guest")
	if err != nil {
		t.Fatal(err)
	}
	grantSignup(t, s, g.ID)

	if _, err := s.MergeGuestIntoProvider(g.ID, Identity{Provider: "discord", ProviderID: "D_old", Name: "Old"}); err != nil {
		t.Fatal(err)
	}
	if bal := assertBalanceMatchesLedger(t, s, surv); bal != signupPayout {
		t.Errorf("balance = %d, want the absorbed grant of %d", bal, signupPayout)
	}
}

// TestMergeAccountsCarriesModerationForward: chat_bans, name_locks, mod_strikes
// and chat_reports cascade on delete, so a merge must carry them or it would
// launder a chat ban.
func TestMergeAccountsCarriesModerationForward(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "discord", "D_clean", "Clean")
	vic := seedUser(t, s, "google", "G_dirty", "Dirty")

	var chatID int64
	res, err := s.db.Exec(`INSERT INTO chat (scope,user_id,msg,ts) VALUES ('lobby',?,'slur',0)`, vic)
	if err != nil {
		t.Fatal(err)
	}
	if chatID, err = res.LastInsertId(); err != nil {
		t.Fatal(err)
	}
	reportID, _, err := s.CreateOrBumpReport(surv, vic, chatID, "lobby")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.BanChat(vic, "abuse", nil, &reportID); err != nil {
		t.Fatal(err)
	}
	if err := s.LockName(vic, "slur", nil); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordStrike(vic, "warn", &reportID); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordStrike(vic, "warn", nil); err != nil {
		t.Fatal(err)
	}

	if err := s.MergeAccounts(surv, vic); err != nil {
		t.Fatalf("MergeAccounts: %v", err)
	}
	assertNoRowsReferenceUser(t, s, vic)

	banned, err := s.IsChatBanned(surv)
	if err != nil {
		t.Fatal(err)
	}
	if !banned {
		t.Error("merge laundered the chat ban: survivor is not banned")
	}
	locked, err := s.IsNameLocked(surv)
	if err != nil {
		t.Fatal(err)
	}
	if !locked {
		t.Error("survivor name not locked after merge")
	}
	warns, err := s.WarnCount(surv)
	if err != nil {
		t.Fatal(err)
	}
	if warns != 2 {
		t.Errorf("survivor has %d warn strikes, want the victim's 2 carried forward", warns)
	}
	var reports int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM chat_reports WHERE accused_id = ?`, surv).Scan(&reports); err != nil {
		t.Fatal(err)
	}
	if reports != 1 {
		t.Errorf("survivor is accused in %d reports, want the victim's 1 carried forward", reports)
	}
}

// TestMergeAccountsAbsorbsMatchWinner: match_history.winner_user_id (migration
// 0022) has no ON DELETE clause, so it must be repointed or the merge fails.
func TestMergeAccountsAbsorbsMatchWinner(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "discord", "D_mh", "S")
	vic := seedUser(t, s, "google", "G_mh", "V")

	gm := &Game{ID: "mh_merge1", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: vic}
	if err := s.CreateGame(gm); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveMatchHistory(MatchHistoryRow{
		GameID: gm.ID, Ruleset: "base", WinnerUserID: &vic, FinishedAt: 100, Record: "{}",
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.MergeAccounts(surv, vic); err != nil {
		t.Fatalf("MergeAccounts: %v", err)
	}
	row, err := s.MatchHistoryByGame(gm.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.WinnerUserID == nil || *row.WinnerUserID != surv {
		t.Errorf("match_history winner = %v, want survivor %d", row.WinnerUserID, surv)
	}
}

// TestMergeFoldsEveryAdditiveStatColumn reads the live `stats` schema and
// checks foldUserAggregates names every counter column.
func TestMergeFoldsEveryAdditiveStatColumn(t *testing.T) {
	s := openTest(t)
	cols, err := additiveStatColumns(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(cols) < 6 {
		t.Fatalf("only %d additive stats columns found (%v); want more", len(cols), cols)
	}

	src, err := os.ReadFile("merge.go")
	if err != nil {
		t.Fatal(err)
	}
	fold := string(src)
	for _, c := range cols {
		// Twice: once in the SELECT list, once in the DO UPDATE sum.
		if strings.Count(fold, c) < 2 {
			t.Errorf("stats column %q not folded by foldUserAggregates; merge drops victim's %s", c, c)
		}
	}
}

// additiveStatColumns reads the live `stats` schema and returns every column
// a merge has to sum. Split out so the rows can be closed with defer.
func additiveStatColumns(s *Store) ([]string, error) {
	rows, err := s.db.Query(`PRAGMA table_info(stats)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		// The key is not additive; everything else in this table is a counter.
		if name == "user_id" || name == "ruleset" {
			continue
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}

// TestMergeVictimPurchasesNotCharged: the victim's debits
// come across with the credit that funded them, so the survivor's balance is
// never reduced by the victim's spending and never goes negative.
func TestMergeVictimPurchasesNotCharged(t *testing.T) {
	for _, tc := range []struct {
		name             string
		survivorSpend    int
		victimSpend      int
		wantSurvivorEnds int
	}{
		// The victim spent 4000 of its 5000 grant. The 1000 it still holds is
		// a duplicate grant and is clawed back; the 4000 it spent is not,
		// because the entitlement it bought comes across too.
		{"victim spent most of its grant", 0, 4000, 5000},
		// Nothing spent anywhere: the whole duplicate grant goes.
		{"victim spent nothing", 0, 0, 5000},
		// The survivor has already spent its own grant. It must not go
		// negative.
		{"survivor already spent its grant", 5000, 4000, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := openTest(t)
			survivor := seedUser(t, s, "discord", "d-surv", "Survivor")
			victim := seedUser(t, s, "google", "g-vic", "Victim")
			for _, u := range []int64{survivor, victim} {
				if _, err := s.LedgerCredit(u, 5000, "signup", fmt.Sprintf("signup:%d", u)); err != nil {
					t.Fatal(err)
				}
			}
			if tc.survivorSpend > 0 {
				if _, err := s.LedgerSpend(survivor, tc.survivorSpend, "purchase", fmt.Sprintf("buy:%d", survivor)); err != nil {
					t.Fatal(err)
				}
			}
			if tc.victimSpend > 0 {
				if _, err := s.LedgerSpend(victim, tc.victimSpend, "purchase", fmt.Sprintf("buy:%d", victim)); err != nil {
					t.Fatal(err)
				}
			}
			if err := s.MergeAccounts(survivor, victim); err != nil {
				t.Fatal(err)
			}
			got, err := s.Balance(survivor)
			if err != nil {
				t.Fatal(err)
			}
			if got < 0 {
				t.Errorf("survivor balance = %d, want >= 0", got)
			}
			if got != tc.wantSurvivorEnds {
				t.Errorf("survivor balance = %d, want %d", got, tc.wantSurvivorEnds)
			}
		})
	}
}

// TestMergeGuestSharedGameWithSurvivor: a human who played one game from
// two devices has a seat under each account, and seats_game_user is UNIQUE on
// (game_id, user_id), so a plain repoint would fail the merge.
func TestMergeGuestSharedGameWithSurvivor(t *testing.T) {
	s := openTest(t)
	surv := seedUser(t, s, "discord", "D_shared", "Shared")
	guest, err := s.CreateGuest("phone")
	if err != nil {
		t.Fatal(err)
	}
	gid := "g-shared"
	game := &Game{ID: gid, Ruleset: "base", Config: []byte("{}"), CreatedBy: surv}
	if err := s.CreateGame(game); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat(gid, 0, surv); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat(gid, 1, guest.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := s.MergeGuestIntoProvider(guest.ID, Identity{
		Provider: "discord", ProviderID: "D_shared", Name: "Shared",
	}); err != nil {
		t.Fatalf("guest merge after a shared game: %v", err)
	}

	// The survivor keeps exactly one seat in that game, and the guest is gone.
	var seats int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM seats WHERE game_id = ? AND user_id = ?`,
		gid, surv).Scan(&seats); err != nil {
		t.Fatal(err)
	}
	if seats != 1 {
		t.Errorf("survivor holds %d seats in the shared game, want 1", seats)
	}
	var orphan int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM seats WHERE user_id = ?`, guest.ID).Scan(&orphan); err != nil {
		t.Fatal(err)
	}
	if orphan != 0 {
		t.Errorf("%d seat rows still point at the absorbed guest", orphan)
	}
}

// TestMergeCarriesEverySupporterColumn checks that a merge carries every
// supporter_status column (cosmetics.owns() reads the perk flags). It reads the
// live schema and asserts the values that survive a real merge.
func TestMergeCarriesEverySupporterColumn(t *testing.T) {
	s := openTest(t)
	cols, err := tableColumns(s, "supporter_status")
	if err != nil {
		t.Fatal(err)
	}
	// user_id is the join key, not carried data.
	var carried []string
	for _, c := range cols {
		if c != "user_id" {
			carried = append(carried, c)
		}
	}
	if len(carried) < 8 {
		t.Fatalf("only %d carried supporter columns found (%v); want more", len(carried), carried)
	}

	// The survivor must already exist, or MergeGuestIntoProvider promotes the
	// guest in place and no fold runs.
	survID := seedUser(t, s, "discord", "D_supporter", "Supporter")
	guest, err := s.CreateGuest("phone")
	if err != nil {
		t.Fatal(err)
	}
	// Every column set to a distinguishable non-zero, so a dropped one reads as
	// 0 and names itself. All of them are INTEGER (flags and unix seconds).
	placeholders := strings.Repeat(", ?", len(carried))
	args := []any{guest.ID}
	for range carried {
		args = append(args, 1)
	}
	// Column names come from PRAGMA table_info, not from input; every value is bound.
	ins := "INSERT INTO supporter_status (user_id, " + strings.Join(carried, ", ") + ") VALUES (?" + placeholders + ")"
	if _, err := s.db.Exec(ins, args...); err != nil {
		t.Fatal(err)
	}

	surv, err := s.MergeGuestIntoProvider(guest.ID, Identity{
		Provider: "discord", ProviderID: "D_supporter", Name: "Supporter",
	})
	if err != nil {
		t.Fatal(err)
	}
	if surv.ID != survID {
		t.Fatalf("merge produced user %d, want survivor %d", surv.ID, survID)
	}

	dest := make([]int64, len(carried))
	scan := make([]any, len(carried))
	for i := range dest {
		scan[i] = &dest[i]
	}
	// As above: the column list is schema-derived.
	sel := "SELECT " + strings.Join(carried, ", ") + " FROM supporter_status WHERE user_id = ?"
	if err := s.db.QueryRow(sel, surv.ID).Scan(scan...); err != nil {
		t.Fatalf("survivor has no supporter row after the merge: %v", err)
	}
	for i, c := range carried {
		if dest[i] != 1 {
			t.Errorf("supporter column %q = %d after merge, want 1", c, dest[i])
		}
	}
}

// tableColumns reads a live table's column names. Rows closed with defer, as
// sqlclosecheck requires.
func tableColumns(s *Store, table string) ([]string, error) {
	// table is a compile-time constant at every call site.
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull int
		var dflt any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

// rosterOf reads a game's stored pre-shuffle roster.
func rosterOf(t *testing.T, s *Store, gameID string) (string, []int64) {
	t.Helper()
	var blob string
	if err := s.db.QueryRow(`SELECT pre_shuffle_seats FROM games WHERE id = ?`, gameID).Scan(&blob); err != nil {
		t.Fatal(err)
	}
	if blob == "" {
		return "", nil
	}
	var ids []int64
	if err := json.Unmarshal([]byte(blob), &ids); err != nil {
		t.Fatalf("roster %q: %v", blob, err)
	}
	return blob, ids
}

// TestMergeAuditRosterMatchesSeats: the audit compares the
// stored pre-shuffle roster with final_seats derived from the `seats` rows, so
// after a merge they must name the same people, or there must be no roster.
func TestMergeAuditRosterMatchesSeats(t *testing.T) {
	t.Run("repointed seat", func(t *testing.T) {
		s := openTest(t)
		surv := seedUser(t, s, "discord", "D_r1", "Survivor")
		guest, err := s.CreateGuest("phone")
		if err != nil {
			t.Fatal(err)
		}
		other := seedUser(t, s, "google", "G_r1", "Other")
		gid := "g-repoint"
		if err := s.CreateGame(&Game{ID: gid, Ruleset: "base", Config: []byte("{}"), CreatedBy: other}); err != nil {
			t.Fatal(err)
		}
		// The guest played; the survivor account did not sit at this table.
		if err := s.AddSeat(gid, 0, other); err != nil {
			t.Fatal(err)
		}
		if err := s.AddSeat(gid, 1, guest.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec(`UPDATE games SET pre_shuffle_seats = ? WHERE id = ?`,
			fmt.Sprintf("[%d,%d]", guest.ID, other), gid); err != nil {
			t.Fatal(err)
		}

		if _, err := s.MergeGuestIntoProvider(guest.ID, Identity{
			Provider: "discord", ProviderID: "D_r1", Name: "Survivor",
		}); err != nil {
			t.Fatal(err)
		}

		blob, roster := rosterOf(t, s, gid)
		if blob == "" {
			t.Fatal("roster cleared for a repointable seat")
		}
		seats, err := s.Seats(gid)
		if err != nil {
			t.Fatal(err)
		}
		if len(roster) != len(seats) {
			t.Fatalf("roster has %d entries, %d seats", len(roster), len(seats))
		}
		want := map[int64]bool{surv: true, other: true}
		for _, id := range roster {
			if !want[id] {
				t.Errorf("roster names %d, which holds no seat", id)
			}
		}
		for _, st := range seats {
			if !want[st.UserID] {
				t.Errorf("seat held by %d, who is not in the roster", st.UserID)
			}
		}
	})

	t.Run("shared table clears roster", func(t *testing.T) {
		s := openTest(t)
		surv := seedUser(t, s, "discord", "D_r2", "Survivor")
		guest, err := s.CreateGuest("phone")
		if err != nil {
			t.Fatal(err)
		}
		gid := "g-shared-roster"
		if err := s.CreateGame(&Game{ID: gid, Ruleset: "base", Config: []byte("{}"), CreatedBy: surv}); err != nil {
			t.Fatal(err)
		}
		// Both accounts sat at this table, so one seat row must go.
		if err := s.AddSeat(gid, 0, surv); err != nil {
			t.Fatal(err)
		}
		if err := s.AddSeat(gid, 1, guest.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec(`UPDATE games SET pre_shuffle_seats = ? WHERE id = ?`,
			fmt.Sprintf("[%d,%d]", guest.ID, surv), gid); err != nil {
			t.Fatal(err)
		}

		if _, err := s.MergeGuestIntoProvider(guest.ID, Identity{
			Provider: "discord", ProviderID: "D_r2", Name: "Survivor",
		}); err != nil {
			t.Fatal(err)
		}

		blob, _ := rosterOf(t, s, gid)
		if blob != "" {
			// The game had two seats and can now have one, so no roster is
			// correct.
			seats, _ := s.Seats(gid)
			t.Errorf("roster left as %q against %d seat(s), want cleared", blob, len(seats))
		}
	})
}
