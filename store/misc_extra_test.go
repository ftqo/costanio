package store

import (
	"os"
	"path/filepath"
	"testing"
)

// TestRecentChatNonPositiveLimit covers the early-return guard.
func TestRecentChatNonPositiveLimit(t *testing.T) {
	s := openTest(t)
	got, err := s.RecentChat("lobby", 0)
	if err != nil || got != nil {
		t.Errorf("RecentChat(limit 0) = %+v %v, want nil, nil", got, err)
	}
	got, err = s.RecentChat("lobby", -5)
	if err != nil || got != nil {
		t.Errorf("RecentChat(limit -5) = %+v %v, want nil, nil", got, err)
	}
}

// TestLoadEventsBadVisibleJSON covers the visible_to unmarshal error branch by
// storing a row whose visible_to column is not valid JSON.
func TestLoadEventsBadVisibleJSON(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)
	if _, err := s.db.Exec(
		`INSERT INTO events (game_id, seq, type, data, visible_to, ts) VALUES (?, 0, 't', '{}', 'not-json', 0)`,
		id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LoadEvents(id, 0); err == nil {
		t.Error("LoadEvents with malformed visible_to returned nil, want unmarshal error")
	}
}

// TestOpenBadPath covers Open's error path when the DB file cannot be created
// (the parent path component is a regular file, not a directory).
func TestOpenBadPath(t *testing.T) {
	dir := t.TempDir()
	notADir := filepath.Join(dir, "afile")
	if err := os.WriteFile(notADir, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Treating the regular file as a directory makes SQLite fail to open.
	bad := filepath.Join(notADir, "nested.db")
	s, err := Open(bad)
	if err == nil {
		s.Close()
		t.Error("Open with unusable path returned nil error")
	}
}
