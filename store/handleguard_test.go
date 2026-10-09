package store

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
	"time"
)

// writerHandleReaders lists the methods allowed to SELECT on the writer handle:
// a read goes on db only when it decides a write in the same method (see
// docs/storage.md).
//
//	migrate                        reads schema_version before rdb exists at all
//	                               (mode=ro cannot create the file and must
//	                               not observe a half-migrated schema).
//	AddSeat                        reads the row its INSERT just collided with,
//	                               to tell a seat_no PK collision from the
//	                               (game_id, user_id) unique index.
//	CreateOrBumpReport             reads the open report it is about to bump,
//	                               twice: once to find it, once to re-find it
//	                               after losing the insert race.
//	RefreshLeaderboardSnapshotIfDue reads the last capture time to decide whether
//	                               to write a new one.
var writerHandleReaders = map[string]bool{
	"migrate":                         true,
	"AddSeat":                         true,
	"CreateOrBumpReport":              true,
	"RefreshLeaderboardSnapshotIfDue": true,
}

// TestWriterHandleReadsAreAllowlisted parses every non-test file in the package
// and fails on any `.db.Query`/`.db.QueryRow` outside the list above. Tests are
// exempt.
func TestWriterHandleReadsAreAllowlisted(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.SelectorExpr) // ....db.Query / ....db.QueryRow
				if !ok || (call.Sel.Name != "Query" && call.Sel.Name != "QueryRow") {
					return true
				}
				inner, ok := call.X.(*ast.SelectorExpr)
				if !ok || inner.Sel.Name != "db" {
					return true
				}
				if writerHandleReaders[fn.Name.Name] {
					return true
				}
				t.Errorf("%s: %s reads on the writer handle (db.%s); use s.rdb or list it in writerHandleReaders",
					fset.Position(call.Pos()), fn.Name.Name, call.Sel.Name)
				return true
			})
		}
	}
}

// TestSeatControlLogNotBlockedByWrite is the behavioural half: with the
// single writer connection held mid-transaction, the replay endpoint's
// seat-control read still has to complete. On the writer handle it waits for the
// transaction; on rdb it does not.
func TestSeatControlLogNotBlockedByWrite(t *testing.T) {
	s := openTest(t)
	if err := s.RecordSeatControl("g1", 4, 0, "bot_takeover"); err != nil {
		t.Fatal(err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO seat_control (game_id, at_seq, seat, control, ts) VALUES (?, ?, ?, ?, ?)`,
		"g2", 0, 0, "auto", 0); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		log, err := s.SeatControlLog("g1")
		if err == nil && len(log) != 1 {
			t.Errorf("SeatControlLog = %d rows, want 1", len(log))
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SeatControlLog while a write tx is open: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("SeatControlLog blocked behind an open write transaction")
	}
}
