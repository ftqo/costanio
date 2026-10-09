package game

import (
	"bytes"
	"encoding/gob"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// TestRebuildSnapshotPreservesPlayerZero: gob omits zero values, so a snapshot
// taken on player 0's turn writes no Cur. Decoding into engine.Empty() (which
// pre-sets Cur and the title holders to NoPlayer) would reload it as "no
// current player"; rebuild decodes into a zero State and calls InitMaps.
func TestRebuildSnapshotPreservesPlayerZero(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	// A game row must exist for the snapshot FK.
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(engine.GameConfig{Players: 3, Ruleset: "base"})
	if err := st.CreateGame(&store.Game{ID: "g", Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		t.Fatal(err)
	}

	// A mid-game state on player 0's turn, with player 0 holding both titles,
	// so every player-id field is 0 and omitted by gob.
	s := engine.Empty()
	s.Config = engine.GameConfig{Players: 3, Ruleset: "base"}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.LongestRoadHolder = 0
	s.LargestArmyHolder = 0
	s.Players = make([]engine.PlayerState, 3)
	s.NextSeq = 60 // non-zero so rebuild doesn't treat it as an empty game

	var buf bytes.Buffer
	buf.WriteByte(snapshotVersion)
	if err := gob.NewEncoder(&buf).Encode(s); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveSnapshot("g", s.NextSeq, buf.Bytes()); err != nil {
		t.Fatal(err)
	}

	got, err := rebuild("g", st)
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	if got.Cur != 0 {
		t.Errorf("Cur = %d, want 0 (player 0's turn must survive a reload)", got.Cur)
	}
	if got.LongestRoadHolder != 0 {
		t.Errorf("LongestRoadHolder = %d, want 0", got.LongestRoadHolder)
	}
	if got.LargestArmyHolder != 0 {
		t.Errorf("LargestArmyHolder = %d, want 0", got.LargestArmyHolder)
	}
	if got.PendingDiscards == nil || got.Buildings == nil || got.Roads == nil || got.Ext == nil {
		t.Error("rebuild left a nil map (InitMaps should restore maps gob drops when empty)")
	}
}
