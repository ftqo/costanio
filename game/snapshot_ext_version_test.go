package game

import (
	"bytes"
	"encoding/gob"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/store"
)

// TestRebuildDiscardsPreExtBoardSnapshot: before ExtBoardInitializer, the tab
// modules stored nothing in State.Ext, so an older snapshot holds an empty Ext
// that gob decodes without complaint. rebuild only applies later events, so
// such a blob would restore a Caravans game with no camels or wayposts. The
// version-7 bump forces a replay.
//
// The version is a literal 6 so it cannot follow future bumps; reverting
// snapshotVersion to 6 must break this test.
func TestRebuildDiscardsPreExtBoardSnapshot(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	const rs = "base+caravans"
	events, err := engine.New(engine.GameConfig{Players: 3, Ruleset: rs}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	host, err := st.CreateGuest("host")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CreateGame(&store.Game{
		ID: "snap", Ruleset: rs, Config: []byte(`{}`), CreatedBy: host.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.AppendEvents("snap", events); err != nil {
		t.Fatal(err)
	}

	// A plain replay is the reference ext.
	s, err := rebuild("snap", st)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Ext) == 0 {
		t.Fatal("replayed base+caravans state has an empty Ext")
	}

	// The blob the old binary would have written: the same state with the ext
	// stripped, stamped version 6.
	old := *s
	old.Ext = nil
	var v6 bytes.Buffer
	v6.WriteByte(6)
	if err := gob.NewEncoder(&v6).Encode(&old); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveSnapshot("snap", s.NextSeq, v6.Bytes()); err != nil {
		t.Fatal(err)
	}
	got, err := rebuild("snap", st)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Ext) == 0 {
		t.Fatalf("pre-ExtBoardInitializer snapshot accepted with empty Ext (replay gives %d keys)", len(s.Ext))
	}

	// The same blob at the current version is accepted, so the test is
	// measuring the version gate. This one is relative and tracks bumps.
	var cur bytes.Buffer
	cur.WriteByte(snapshotVersion)
	if err := gob.NewEncoder(&cur).Encode(&old); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveSnapshot("snap", s.NextSeq, cur.Bytes()); err != nil {
		t.Fatal(err)
	}
	kept, err := rebuild("snap", st)
	if err != nil {
		t.Fatal(err)
	}
	if len(kept.Ext) != 0 {
		t.Fatal("current-version snapshot was discarded")
	}
}

// TestRebuildDiscardsPreBidResourceSnapshot: the same guard for version 8. The
// camel vote's piles are now the ruleset's bid resources, resolved at board
// time into CaravansExt.BidRes, and board.Resource's zero value is a real
// resource, so a version-7 blob would bid in the wrong resource and settle()
// would clamp against the wrong pile.
//
// The version is a literal 7; reverting snapshotVersion to 7 must break this
// test.
func TestRebuildDiscardsPreBidResourceSnapshot(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	const rs = "base+caravans"
	events, err := engine.New(engine.GameConfig{Players: 3, Ruleset: rs}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	host, err := st.CreateGuest("host")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CreateGame(&store.Game{
		ID: "snap", Ruleset: rs, Config: []byte(`{}`), CreatedBy: host.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.AppendEvents("snap", events); err != nil {
		t.Fatal(err)
	}

	s, err := rebuild("snap", st)
	if err != nil {
		t.Fatal(err)
	}
	want := scenarios.BidResources(s)
	x, ok := scenarios.CaravansStateExt(s)
	if !ok {
		t.Fatal("no caravans ext in a base+caravans game")
	}
	if x.BidRes != want {
		t.Fatalf("a replayed state bids in %v, want %v", x.BidRes, want)
	}

	// The blob a version-7 binary would have written: BidRes missing, which
	// decodes as the zero pair. Ore twice stands in for it, since this ruleset
	// never bids in ore.
	stale := s.Clone()
	sx, _ := scenarios.CaravansStateExt(stale)
	sx.BidRes = [2]board.Resource{board.Ore, board.Ore}
	var v7 bytes.Buffer
	v7.WriteByte(7)
	if err := gob.NewEncoder(&v7).Encode(stale); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveSnapshot("snap", s.NextSeq, v7.Bytes()); err != nil {
		t.Fatal(err)
	}
	got, err := rebuild("snap", st)
	if err != nil {
		t.Fatal(err)
	}
	gx, ok := scenarios.CaravansStateExt(got)
	if !ok {
		t.Fatal("no caravans ext after rebuild")
	}
	if gx.BidRes != want {
		t.Fatalf("version-7 snapshot accepted: bids in %v, want %v", gx.BidRes, want)
	}
}
