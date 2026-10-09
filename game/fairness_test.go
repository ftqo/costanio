package game

import (
	"bytes"
	"encoding/gob"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// TestRebuildCarriesPublicSeed: rebuild resumes from a snapshot and never
// re-applies game_created, the only event carrying the seeds. A rebuilt state
// must still hold them, or every roll after a restart comes off the wrong
// stream and the audit fails.
func TestRebuildCarriesPublicSeed(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	seeds := engine.Seeds{Public: 0xfeedface, Private: 0x1234}
	events, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base"}, seeds)
	if err != nil {
		t.Fatal(err)
	}
	host, err := st.CreateGuest("host")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CreateGame(&store.Game{
		ID: "snap", Ruleset: "base", Config: []byte(`{}`), CreatedBy: host.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.AppendEvents("snap", events); err != nil {
		t.Fatal(err)
	}

	// No snapshot yet: a plain replay must carry both seeds.
	s, err := rebuild("snap", st)
	if err != nil {
		t.Fatal(err)
	}
	if s.PublicSeed != seeds.Public || s.Seed != seeds.Private {
		t.Fatalf("replay gave Public=%#x Private=%#x, want %#x/%#x",
			s.PublicSeed, s.Seed, seeds.Public, seeds.Private)
	}

	// And again through a snapshot, which is where the seeds can go missing.
	var buf bytes.Buffer
	buf.WriteByte(snapshotVersion)
	if err := gob.NewEncoder(&buf).Encode(s); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveSnapshot("snap", s.NextSeq, buf.Bytes()); err != nil {
		t.Fatal(err)
	}
	s2, err := rebuild("snap", st)
	if err != nil {
		t.Fatal(err)
	}
	if s2.PublicSeed != seeds.Public || s2.Seed != seeds.Private {
		t.Fatalf("snapshot rebuild gave Public=%#x Private=%#x, want %#x/%#x",
			s2.PublicSeed, s2.Seed, seeds.Public, seeds.Private)
	}

	// A snapshot written before the seeds were split, whose State had no
	// PublicSeed field. gob encodes by name and omits zero values, so the
	// current State with PublicSeed zeroed produces the same bytes; decoding it
	// raises no error and resumes on seed 0.
	//
	// The version is a literal 4, not snapshotVersion - 1, so it cannot follow
	// future bumps. Reverting snapshotVersion to 4 must break this test.
	old := *s
	old.PublicSeed = 0
	var v4 bytes.Buffer
	v4.WriteByte(4)
	if err := gob.NewEncoder(&v4).Encode(&old); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveSnapshot("snap", s.NextSeq, v4.Bytes()); err != nil {
		t.Fatal(err)
	}
	s3, err := rebuild("snap", st)
	if err != nil {
		t.Fatal(err)
	}
	if s3.PublicSeed != seeds.Public {
		t.Fatalf("pre-split snapshot accepted: PublicSeed=%#x, want %#x",
			s3.PublicSeed, seeds.Public)
	}
}
