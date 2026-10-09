package store

import (
	"regexp"
	"strings"
	"testing"
)

// queryPlan returns EXPLAIN QUERY PLAN's detail lines joined into one string.
func queryPlan(t *testing.T, s *Store, q string, args ...any) string {
	t.Helper()
	rows, err := s.rdb.Query("EXPLAIN QUERY PLAN "+q, args...)
	if err != nil {
		t.Fatalf("EXPLAIN QUERY PLAN: %v", err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var id, parent, notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(lines, "\n")
}

// seeksInto reports whether the plan reaches `alias` by an index seek rather
// than a full scan, without naming which index does it. The tests pin the plan
// shape (a seek on the driving table, a covering probe for the correlated
// subquery, no temp b-tree before a LIMIT), not the planner's index choice.
func seeksInto(plan, alias string) bool {
	seek := regexp.MustCompile(`SEARCH ` + regexp.QuoteMeta(alias) + `\b`)
	scan := regexp.MustCompile(`SCAN ` + regexp.QuoteMeta(alias) + `\b`)
	return seek.MatchString(plan) && !scan.MatchString(plan)
}

// TestSeatedGamesPlanIsBoundedByOpenGames: the query's cost must not grow with
// a player's history, so the plan must not drive from seats_user.
func TestSeatedGamesPlanIsBoundedByOpenGames(t *testing.T) {
	s := openTest(t)
	plan := queryPlan(t, s, seatedGamesFrom+" LIMIT 1", int64(1))
	if strings.Contains(plan, "seats_user") {
		t.Errorf("seated-games query drives from seats:\n%s", plan)
	}
	if !seeksInto(plan, "g") {
		t.Errorf("want an index seek into games, got:\n%s", plan)
	}
	// The seat probe must be COVERING, answered from the index alone. Newer
	// SQLite labels a correlated EXISTS probe "SEARCH st EXISTS USING ...",
	// older builds "SEARCH st USING ...": same plan.
	if !regexp.MustCompile(`SEARCH st (EXISTS )?USING COVERING INDEX`).MatchString(plan) {
		t.Errorf("want a covering index for the seat probe, got:\n%s", plan)
	}
}

// TestDroppedIndexesStayDropped guards migration 0031: both indexes were unused
// by any plan and cost a write on every games update. Re-adding either needs a
// query that chooses it.
func TestDroppedIndexesStayDropped(t *testing.T) {
	s := openTest(t)
	for _, idx := range []string{"games_status", "idx_games_public_status"} {
		var name string
		err := s.rdb.QueryRow(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`, idx).Scan(&name)
		if err == nil {
			t.Errorf("index %s is back; 0031 dropped it as unreachable", idx)
		}
	}
	// And the listing the second one claimed to serve still plans on the index
	// that also satisfies its ORDER BY, so the LIMIT short-circuits.
	plan := queryPlan(t, s, `SELECT id FROM games WHERE status = ? AND public = 1 ORDER BY created_at DESC LIMIT 100`, "lobby")
	if !seeksInto(plan, "games") {
		t.Errorf("ListGames scans games:\n%s", plan)
	}
	if strings.Contains(plan, "TEMP B-TREE") {
		t.Errorf("ListGames now sorts in a temp b-tree:\n%s", plan)
	}
}
