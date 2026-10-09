package raiders

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"

	// Registered for the shared-path combination below.
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// onlyCoastVertex finds a vertex whose land hexes are all coastal, and those
// hexes: the one kind of building conquest can reach.
func onlyCoastVertex(t *testing.T, s *engine.State, x *Ext) (board.Vertex, []board.Hex) {
	t.Helper()
	for _, h := range x.Coast {
		for _, cand := range h.Vertices() {
			var land []board.Hex
			all := true
			for _, hh := range cand.Hexes() {
				if !s.Board.Land(hh) {
					continue
				}
				land = append(land, hh)
				if x.coastIndex(hh) < 0 {
					all = false
				}
			}
			if all && len(land) > 0 {
				return cand, land
			}
		}
	}
	t.Fatal("no vertex on this board touches only coastal hexes")
	return board.Vertex{}, nil
}

// conquestIn returns the one raiders_conquest event in a batch, or fails.
func conquestIn(t *testing.T, evs []engine.Event) conquestData {
	t.Helper()
	var out []conquestData
	for _, e := range evs {
		if e.Type == EvConquest {
			out = append(out, engine.DecodeEvent[conquestData](e))
		}
	}
	if len(out) != 1 {
		t.Fatalf("batch carries %d raiders_conquest events, want exactly one: %v", len(out), eventTypes(evs))
	}
	return out[0]
}

// runBatch folds a batch and hands it to the module's announcement pass, the
// way finalizeWith does, then folds what that pass returned.
func runBatch(t *testing.T, s *engine.State, evs []engine.Event) []engine.Event {
	t.Helper()
	for k := range evs {
		evs[k].Seq = s.NextSeq + k
	}
	apply(t, s, evs)
	more := (Module{}).announceConquest(s, evs)
	for k := range more {
		more[k].Seq = s.NextSeq + k
	}
	apply(t, s, more)
	return append(evs, more...)
}

// The log must announce a conquest. Conquest is derived, so the announcement is
// its own public event after the batch that changed it: the hex that fell,
// every building it switched off with the points involved, and the reverse when
// a battle frees the hex.
func TestConquestIsAnnounced(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	clear(x.RaiderCount)
	v, hexes := onlyCoastVertex(t, s, x)
	s.Buildings[v] = engine.Building{Owner: 2, City: true}

	// Every hex but the last already saturated, and announced as such.
	for _, h := range hexes[:len(hexes)-1] {
		x.RaiderCount[x.coastIndex(h)] = conquered
	}
	last := hexes[len(hexes)-1]
	x.RaiderCount[x.coastIndex(last)] = conquered - 1
	x.foldAnnounced(s)

	evs := runBatch(t, s, []engine.Event{engine.NewEvent(EvLanded, landedData{Hex: &last})})
	got := conquestIn(t, evs)
	if !slices.Equal(got.Conquered, []board.Hex{last}) {
		t.Errorf("conquered = %v, want only %v (the hex this landing filled)", got.Conquered, last)
	}
	if len(got.Liberated) != 0 {
		t.Errorf("a landing liberated %v", got.Liberated)
	}
	want := []lostBuilding{{Player: 2, V: v, City: true, VP: 2}}
	if !slices.Equal(got.Lost, want) {
		t.Errorf("lost = %+v, want %+v", got.Lost, want)
	}

	// A second batch that changes nothing announces nothing.
	if more := (Module{}).announceConquest(s, []engine.Event{engine.NewEvent(EvLanded, landedData{})}); len(more) != 0 {
		t.Errorf("a batch that moved no conquest announced %v", eventTypes(more))
	}

	// A battle on the fallen hex frees it and stands the city back up.
	evs = runBatch(t, s, []engine.Event{engine.NewEvent(EvBattle, battleData{Hex: last, Raiders: conquered, Strength: conquered + 1})})
	got = conquestIn(t, evs)
	if !slices.Equal(got.Liberated, []board.Hex{last}) {
		t.Errorf("liberated = %v, want %v", got.Liberated, last)
	}
	if !slices.Equal(got.Restored, want) {
		t.Errorf("restored = %+v, want %+v", got.Restored, want)
	}
	if len(got.Conquered) != 0 || len(got.Lost) != 0 {
		t.Errorf("a battle conquered %v and lost %+v", got.Conquered, got.Lost)
	}
}

// The announcement goes through the real pipeline: engine.Decide appends it to
// the command's batch, so the persisted log carries it and a replay folds it.
func TestConquestAnnouncementRidesTheBatch(t *testing.T) {
	s := newState(t, "base+raiders", 4, testBoard(2))
	x := liveExt(t, s)
	clear(x.RaiderCount)
	// A genuine landing tie between the first two coastal hexes, both one short.
	const n = 5
	for i, c := range x.Coast {
		tile := s.Board.Tiles[c]
		if i < 2 {
			tile.Number = n
		} else if tile.Number == n {
			tile.Number = 9
		}
		s.Board.Tiles[c] = tile
	}
	x.RaiderCount[0], x.RaiderCount[1] = conquered-1, conquered-1
	x.Pend = Pending{Kind: PendLanding, Seat: 0, Numbers: []int{n}}
	x.refreshChoices(s)
	x.foldAnnounced(s)
	h := x.Coast[0]
	evs, err := engine.Decide(s, engine.Command{Player: 0, Type: CmdPickHex, Data: raw2(map[string]any{"hex": h})})
	if err != nil {
		t.Fatalf("pick hex: %v", err)
	}
	got := conquestIn(t, evs)
	if !slices.Equal(got.Conquered, []board.Hex{h}) {
		t.Errorf("conquered = %v, want %v", got.Conquered, h)
	}
}

// TestAnnouncedConquestNeverDrifts: after every batch of a whole game, the
// announced conquest equals the derived conquest. A rule moving conquest
// through an event missing from conquestEventTypes would show up here. Driven
// by seeded auto moves across the combinations, including the shared-path one
// (Wagons).
func TestAnnouncedConquestNeverDrifts(t *testing.T) {
	announced := 0
	for _, ruleset := range []string{
		"base+raiders",
		engine.CanonicalRuleset("base+cak+raiders"),
		engine.CanonicalRuleset("base+islands+raiders"),
		engine.CanonicalRuleset("base+raiders+wagons"),
	} {
		for seed := uint64(1); seed <= 3; seed++ {
			evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: ruleset}, engine.SeedsFrom(seed))
			if err != nil {
				t.Fatalf("%s: %v", ruleset, err)
			}
			live, err := engine.Replay(evs)
			if err != nil {
				t.Fatal(err)
			}
			for range 4000 {
				if live.Phase == engine.PhaseFinished {
					break
				}
				cmd, ok := engine.AutoCommand(live)
				if !ok {
					break
				}
				out, err := engine.Decide(live, cmd)
				if err != nil {
					t.Fatalf("%s seed %d: %s: %v", ruleset, seed, cmd.Type, err)
				}
				for _, e := range out {
					if err := engine.Apply(live, e); err != nil {
						t.Fatal(err)
					}
					if e.Type == EvConquest {
						announced++
					}
				}
				x, _ := StateExt(live)
				if !slices.Equal(x.Announced, x.conqueredNow()) {
					t.Fatalf("%s seed %d after %s: announced %v, derived %v", ruleset, seed, cmd.Type, x.Announced, x.conqueredNow())
				}
				if live.Phase == engine.PhasePlay && !slices.Equal(x.AnnouncedLost, lostNow(live)) {
					t.Fatalf("%s seed %d after %s: announced lost %v, derived %v", ruleset, seed, cmd.Type, x.AnnouncedLost, lostNow(live))
				}
				evs = append(evs, out...)
			}
			again, err := engine.Replay(evs)
			if err != nil {
				t.Fatalf("replay: %v", err)
			}
			a, _ := StateExt(live)
			b, _ := StateExt(again)
			if !slices.Equal(a.Announced, b.Announced) || !slices.Equal(a.AnnouncedLost, b.AnnouncedLost) {
				t.Fatalf("%s seed %d: replay announced %v/%v, live %v/%v", ruleset, seed, b.Announced, b.AnnouncedLost, a.Announced, a.AnnouncedLost)
			}
		}
	}
	if announced == 0 {
		t.Fatal("no game conquered a hex")
	}
	t.Logf("%d conquest announcements", announced)
}

// Every event that can take a raider off a conquered hex liberates it, and each
// must be announced. Seeded auto games rarely free a conquered hex, so the
// drift test above does not cover this.
func TestEveryWayOffAConqueredHexIsAnnounced(t *testing.T) {
	for _, tc := range []struct {
		name string
		ev   func(h, to board.Hex) engine.Event
	}{
		{"battle", func(h, _ board.Hex) engine.Event {
			return engine.NewEvent(EvBattle, battleData{Hex: h, Raiders: conquered, Strength: conquered + 1})
		}},
		{"intrigue", func(h, _ board.Hex) engine.Event {
			return engine.NewEvent(EvIntrigue, intrigueData{Player: 1, Hex: h})
		}},
		{"treason", func(h, to board.Hex) engine.Event {
			return engine.NewEvent(EvTreason, treasonData{Player: 1, Moves: []treasonMove{{From: &h, To: to}}})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newState(t, "base+raiders", 4, testBoard(2))
			x := liveExt(t, s)
			clear(x.RaiderCount)
			h, to := x.Coast[0], x.Coast[1]
			x.RaiderCount[0] = conquered
			x.foldAnnounced(s)
			got := conquestIn(t, runBatch(t, s, []engine.Event{tc.ev(h, to)}))
			if !slices.Equal(got.Liberated, []board.Hex{h}) {
				t.Errorf("liberated = %v, want %v", got.Liberated, h)
			}
		})
	}
}
