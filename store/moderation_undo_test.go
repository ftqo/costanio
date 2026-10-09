package store

import (
	"errors"
	"testing"
	"time"
)

// TestWarnCountDecays: warnings age out of the escalation window; the history
// stays.
func TestWarnCountDecays(t *testing.T) {
	s := modTestStore(t)
	uid := mkUser(t, s, "bob")
	stale := time.Now().Add(-400 * 24 * time.Hour).Unix()
	for range 3 {
		if err := s.recordStrikeAt(uid, "warn", nil, stale); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RecordStrike(uid, "warn", nil); err != nil {
		t.Fatal(err)
	}
	if n, err := s.WarnCount(uid); err != nil || n != 1 {
		t.Fatalf("WarnCount=%d err=%v, want 1", n, err)
	}
	if n, err := s.LifetimeWarnCount(uid); err != nil || n != 4 {
		t.Fatalf("LifetimeWarnCount=%d err=%v, want 4", n, err)
	}
}

// TestWarnEscalationUsesWindow checks the window in ResolveReportAction's
// escalate-to-ban decision.
func TestWarnEscalationUsesWindow(t *testing.T) {
	for _, tt := range []struct {
		name      string
		age       time.Duration
		wantEffct string
	}{
		{"recent warns escalate", 24 * time.Hour, "ban"},
		{"stale warns do not", 400 * 24 * time.Hour, "warn"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := modTestStore(t)
			reporter := mkUser(t, s, "rep")
			accused := mkUser(t, s, "acc")
			at := time.Now().Add(-tt.age).Unix()
			for range warnEscalateThreshold {
				if err := s.recordStrikeAt(accused, "warn", nil, at); err != nil {
					t.Fatal(err)
				}
			}
			cid := mkChat(t, s, "lobby", accused, "bad words")
			id, _, err := s.CreateOrBumpReport(reporter, accused, cid, "lobby")
			if err != nil {
				t.Fatal(err)
			}
			out, err := s.ResolveReportAction(id, "warn", nil, "report resolution")
			if err != nil || !out.Resolved {
				t.Fatalf("resolve out=%+v err=%v", out, err)
			}
			if out.Effective != tt.wantEffct {
				t.Fatalf("Effective=%q, want %q", out.Effective, tt.wantEffct)
			}
		})
	}
}

// TestReopenUndoesEveryResolution covers reopening after each of the three
// resolutions, including "none", which strikes the reporter.
func TestReopenUndoesEveryResolution(t *testing.T) {
	tests := []struct {
		action     string
		strikeUser string // "reporter" | "accused" | ""
		strikeKind string
		wantBan    bool
	}{
		{"none", "reporter", "denial", false},
		{"warn", "accused", "warn", false},
		{"ban", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.action, func(t *testing.T) {
			s := modTestStore(t)
			reporter := mkUser(t, s, "rep")
			accused := mkUser(t, s, "acc")
			cid := mkChat(t, s, "lobby", accused, "bad words")
			id, _, err := s.CreateOrBumpReport(reporter, accused, cid, "lobby")
			if err != nil {
				t.Fatal(err)
			}
			if out, err := s.ResolveReportAction(id, tt.action, nil, "report resolution"); err != nil || !out.Resolved {
				t.Fatalf("resolve out=%+v err=%v", out, err)
			}
			if banned, _ := s.IsChatBanned(accused); banned != tt.wantBan {
				t.Fatalf("after %q banned=%v, want %v", tt.action, banned, tt.wantBan)
			}

			out, err := s.ReopenReport(id)
			if err != nil || !out.Reopened {
				t.Fatalf("reopen out=%+v err=%v", out, err)
			}
			if out.Was != tt.action {
				t.Fatalf("Was=%q, want %q", out.Was, tt.action)
			}
			if banned, _ := s.IsChatBanned(accused); banned {
				t.Fatal("reopen left the ban standing")
			}
			switch tt.strikeUser {
			case "reporter":
				if n, _ := s.DenialCountSince(reporter, 0); n != 0 {
					t.Fatalf("reporter kept %d denial strikes after the undo", n)
				}
			case "accused":
				if n, _ := s.LifetimeWarnCount(accused); n != 0 {
					t.Fatalf("accused kept %d warn strikes after the undo", n)
				}
			}
			// The report is back in the queue and can be actioned again.
			r, err := s.ReportByID(id)
			if err != nil || r.Status != "open" || r.Resolution != "" {
				t.Fatalf("report after reopen = %+v err=%v", r, err)
			}
			if out2, err := s.ResolveReportAction(id, "ban", nil, "second look"); err != nil || !out2.Resolved {
				t.Fatalf("re-resolve out=%+v err=%v", out2, err)
			}
		})
	}
}

func TestReopenReportEdges(t *testing.T) {
	s := modTestStore(t)
	reporter := mkUser(t, s, "rep")
	accused := mkUser(t, s, "acc")
	cid := mkChat(t, s, "lobby", accused, "bad words")
	id, _, err := s.CreateOrBumpReport(reporter, accused, cid, "lobby")
	if err != nil {
		t.Fatal(err)
	}
	// An open report has nothing to undo, and that is not an error.
	if out, err := s.ReopenReport(id); err != nil || out.Reopened {
		t.Fatalf("reopen of an open report out=%+v err=%v", out, err)
	}
	if _, err := s.ReopenReport(id + 999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reopen of a missing report err=%v, want ErrNotFound", err)
	}
	// Resolve it, then let a new report cover the same message: the reopen would
	// break the one-open-report-per-message index, so it is refused by name.
	if out, err := s.ResolveReportAction(id, "none", nil, ""); err != nil || !out.Resolved {
		t.Fatalf("resolve out=%+v err=%v", out, err)
	}
	if _, _, err := s.CreateOrBumpReport(mkUser(t, s, "rep2"), accused, cid, "lobby"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReopenReport(id); !errors.Is(err, ErrReportSuperseded) {
		t.Fatalf("reopen err=%v, want ErrReportSuperseded", err)
	}
}

// TestFilterReportNoPenalty: a report the language filter
// raised has no human reporter, so dismissing it must not strike the accused.
func TestFilterReportNoPenalty(t *testing.T) {
	s := modTestStore(t)
	accused := mkUser(t, s, "acc")
	cid := mkChat(t, s, "lobby", accused, "bad words")
	id, isNew, err := s.CreateFilterReport(accused, cid, "lobby")
	if err != nil || !isNew {
		t.Fatalf("CreateFilterReport isNew=%v err=%v", isNew, err)
	}
	r, err := s.ReportByID(id)
	if err != nil || !r.Automated() {
		t.Fatalf("report %+v err=%v, want Automated", r, err)
	}
	if out, err := s.ResolveReportAction(id, "none", nil, ""); err != nil || !out.Resolved {
		t.Fatalf("resolve out=%+v err=%v", out, err)
	}
	if n, _ := s.DenialCountSince(accused, 0); n != 0 {
		t.Fatalf("dismissing a filter report wrote %d denial strikes", n)
	}
	if ok, _ := s.CanReport(accused); !ok {
		t.Fatal("dismissing a filter report blocked the accused from reporting")
	}
}

// TestOpenReportsBacklog covers the open-report queue and backlog reads.
func TestOpenReportsBacklog(t *testing.T) {
	s := modTestStore(t)
	reporter := mkUser(t, s, "rep")
	accused := mkUser(t, s, "acc")
	if n, oldest, err := s.OpenReportBacklog(); err != nil || n != 0 || oldest != 0 {
		t.Fatalf("empty backlog n=%d oldest=%d err=%v", n, oldest, err)
	}
	var ids []int64
	for _, msg := range []string{"one", "two", "three"} {
		cid := mkChat(t, s, "lobby", accused, msg)
		id, _, err := s.CreateOrBumpReport(reporter, accused, cid, "lobby")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if out, err := s.ResolveReportAction(ids[1], "warn", nil, ""); err != nil || !out.Resolved {
		t.Fatalf("resolve out=%+v err=%v", out, err)
	}
	open, err := s.OpenReports(10)
	if err != nil || len(open) != 2 {
		t.Fatalf("OpenReports len=%d err=%v, want 2", len(open), err)
	}
	if open[0].ID != ids[0] || open[1].ID != ids[2] {
		t.Fatalf("OpenReports ids=%d,%d want %d,%d", open[0].ID, open[1].ID, ids[0], ids[2])
	}
	if open[0].Msg != "one" || open[0].CreatedAt == 0 {
		t.Fatalf("OpenReports first = %+v, want the message text and a timestamp", open[0])
	}
	n, oldest, err := s.OpenReportBacklog()
	if err != nil || n != 2 || oldest == 0 {
		t.Fatalf("backlog n=%d oldest=%d err=%v", n, oldest, err)
	}
	if got, _ := s.OpenReports(0); got != nil {
		t.Fatalf("OpenReports(0) = %v, want nil", got)
	}
}

// TestReportContext covers the chat window around a reported message.
func TestReportContext(t *testing.T) {
	s := modTestStore(t)
	a := mkUser(t, s, "a")
	b := mkUser(t, s, "b")
	var ids []int64
	for i, msg := range []string{"hello", "you are bad at this", "no you", "reported", "gg"} {
		author := a
		if i%2 == 1 {
			author = b
		}
		ids = append(ids, mkChat(t, s, "lobby", author, msg))
	}
	mkChat(t, s, "game:g1", a, "different scope")

	lines, err := s.ReportContext(ids[2], 2)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, l := range lines {
		got = append(got, l.Msg)
	}
	want := []string{"hello", "you are bad at this", "no you", "reported", "gg"}
	if len(got) != len(want) {
		t.Fatalf("ReportContext = %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("ReportContext = %q, want %q", got, want)
		}
	}
	// The first message has nothing before it, and the window never leaves the scope.
	lines, err = s.ReportContext(ids[0], 2)
	if err != nil || len(lines) != 3 || lines[0].Msg != "hello" {
		t.Fatalf("ReportContext at the head = %+v err=%v", lines, err)
	}
	if _, err := s.ReportContext(9999, 2); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ReportContext of a missing message err=%v, want ErrNotFound", err)
	}
}

// TestForgiveLatestStrike: forgive a warning without reopening its report.
func TestForgiveLatestStrike(t *testing.T) {
	s := modTestStore(t)
	uid := mkUser(t, s, "bob")
	if removed, err := s.ForgiveLatestStrike(uid, "warn"); err != nil || removed {
		t.Fatalf("nothing to forgive: removed=%v err=%v", removed, err)
	}
	for range 2 {
		if err := s.RecordStrike(uid, "warn", nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RecordStrike(uid, "denial", nil); err != nil {
		t.Fatal(err)
	}
	if removed, err := s.ForgiveLatestStrike(uid, "warn"); err != nil || !removed {
		t.Fatalf("forgive removed=%v err=%v", removed, err)
	}
	if n, _ := s.LifetimeWarnCount(uid); n != 1 {
		t.Fatalf("warns after forgiving one = %d, want 1", n)
	}
	if n, _ := s.DenialCountSince(uid, 0); n != 1 {
		t.Fatalf("forgiving a warn touched the denial strikes: %d", n)
	}
}
