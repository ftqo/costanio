package store

import (
	"path/filepath"
	"slices"
	"testing"
)

// chatFilteredMigration is 0035_chat_filtered.sql.
const chatFilteredMigration = 35

func chatMsgs(lines []ChatLine) []string {
	var out []string
	for _, l := range lines {
		out = append(out, l.Msg)
	}
	return out
}

// A filtered message is kept for the moderator and nowhere else: chat history
// and the report-by-id lookup skip it, the surrounding context of another
// report skips it, and its own report's context and the queue still show it.
func TestFilteredChatHiddenFromPlayers(t *testing.T) {
	s := modTestStore(t)
	a := mkUser(t, s, "a")
	b := mkUser(t, s, "b")
	before := mkChat(t, s, "game:g", b, "before")
	bad, err := s.SaveFilteredChat("game:g", a, "filtered")
	if err != nil {
		t.Fatal(err)
	}
	reported := mkChat(t, s, "game:g", b, "reported")
	mkChat(t, s, "game:g", a, "after")
	if _, _, err := s.CreateFilterReport(a, bad, "game:g"); err != nil {
		t.Fatal(err)
	}

	hist, err := s.RecentChat("game:g", 50)
	if err != nil {
		t.Fatal(err)
	}
	if got := chatMsgs(hist); !slices.Equal(got, []string{"before", "reported", "after"}) {
		t.Fatalf("RecentChat = %q, want the filtered line left out", got)
	}
	if _, err := s.ChatByID(bad); err == nil {
		t.Fatal("ChatByID served a filtered message")
	}
	if l, err := s.ChatByID(before); err != nil || l.Msg != "before" {
		t.Fatalf("ChatByID(delivered) = %v, %v", l, err)
	}

	ctx, err := s.ReportContext(reported, 3)
	if err != nil {
		t.Fatal(err)
	}
	if got := chatMsgs(ctx); !slices.Equal(got, []string{"before", "reported", "after"}) {
		t.Fatalf("ReportContext around a delivered line = %q, want the filtered line left out", got)
	}
	ctx, err = s.ReportContext(before, 3)
	if err != nil {
		t.Fatal(err)
	}
	if got := chatMsgs(ctx); !slices.Equal(got, []string{"before", "reported", "after"}) {
		t.Fatalf("ReportContext after a delivered line = %q, want the filtered line left out", got)
	}
	ctx, err = s.ReportContext(bad, 3)
	if err != nil {
		t.Fatal(err)
	}
	if got := chatMsgs(ctx); !slices.Equal(got, []string{"before", "filtered", "reported", "after"}) {
		t.Fatalf("ReportContext of the filtered line = %q, want it shown to the moderator", got)
	}
	open, err := s.OpenReports(10)
	if err != nil || len(open) != 1 || open[0].Msg != "filtered" {
		t.Fatalf("OpenReports = %+v, %v; the moderator lost the filtered text", open, err)
	}
}

// Rows filtered before the column existed are found by their automated report
// (reporter == accused), open or resolved. A human report does not mark its
// message, and unreported chat stays visible.
func TestMigrateMarksFilteredChat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pre.db")
	db := migrateTo(t, path, chatFilteredMigration-1)
	for _, q := range []string{
		`INSERT INTO users (id, is_guest, name, created_at) VALUES (1, 0, 'a', 0), (2, 0, 'b', 0)`,
		`INSERT INTO chat (id, scope, user_id, msg, ts) VALUES
			(1, 'lobby', 1, 'plain', 0),
			(2, 'lobby', 1, 'filtered open', 0),
			(3, 'lobby', 1, 'filtered resolved', 0),
			(4, 'lobby', 1, 'reported by b', 0)`,
		`INSERT INTO chat_reports (reporter_id, accused_id, chat_id, scope, status, resolution, created_at) VALUES
			(1, 1, 2, 'lobby', 'open', NULL, 0),
			(1, 1, 3, 'lobby', 'resolved', 'none', 0),
			(2, 1, 4, 'lobby', 'open', NULL, 0)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()

	s, err := Open(path)
	if err != nil {
		t.Fatalf("open (migrate): %v", err)
	}
	defer s.Close()
	hist, err := s.RecentChat("lobby", 50)
	if err != nil {
		t.Fatal(err)
	}
	if got := chatMsgs(hist); !slices.Equal(got, []string{"plain", "reported by b"}) {
		t.Fatalf("RecentChat after migrate = %q", got)
	}
	ctx, err := s.ReportContext(2, 3)
	if err != nil || !slices.Contains(chatMsgs(ctx), "filtered open") || slices.Contains(chatMsgs(ctx), "filtered resolved") {
		t.Fatalf("ReportContext(2) after migrate = %q, %v", chatMsgs(ctx), err)
	}
}
