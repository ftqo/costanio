package game

import (
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// rolledPlayState returns a base-game state for seed past setup and a clean roll,
// so the current player has real legal build targets.
func rolledPlayState(t *testing.T) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(cmd engine.Command) {
		evs, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("decide %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			engine.Apply(s, e)
		}
	}
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		apply(cmd)
	}
	apply(engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	for s.RobberPending || len(s.PendingDiscards) > 0 {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			break
		}
		apply(cmd)
	}
	return s
}

// canon renders a LegalTargets order-insensitively. LegalTargetsFor's order is
// not stable between calls on one state (it ranges over s.Buildings and
// s.Board.Tiles maps), so DeepEqual would be flaky; compare membership.
func canon(lt engine.LegalTargets) string {
	v := reflect.ValueOf(lt)
	t := v.Type()
	var b strings.Builder
	for i := range v.NumField() {
		f := v.Field(i)
		fmt.Fprintf(&b, "%s:", t.Field(i).Name)
		if f.Kind() == reflect.Slice {
			parts := make([]string, f.Len())
			for j := range parts {
				parts[j] = fmt.Sprintf("%+v", f.Index(j).Interface())
			}
			sort.Strings(parts)
			b.WriteString(strings.Join(parts, ","))
		} else {
			// ProgressTargets is a map; fmt prints a map in key order.
			fmt.Fprintf(&b, "%+v", f.Interface())
		}
		b.WriteString(";")
	}
	return b.String()
}

func TestLegalCacheMatchesFreshCompute(t *testing.T) {
	// The contract is the answer, not the memoization: For(s, version, seat)
	// must equal s.LegalTargetsFor(seat) for every seat, and again once the
	// state advances. Whether it recomputed is not observable to callers.
	s := rolledPlayState(t)

	var c legalCache
	v0 := s.NextSeq

	for seat := engine.PlayerID(0); seat < engine.PlayerID(len(s.Players)); seat++ {
		fresh := s.LegalTargetsFor(seat)
		cached := c.For(s, v0, seat)
		if canon(cached) != canon(fresh) {
			t.Errorf("seat %d: cached targets differ from a fresh compute\n cached=%s\n  fresh=%s", seat, canon(cached), canon(fresh))
		}
		// Asked twice at one version, the answer does not change.
		if again := c.For(s, v0, seat); canon(again) != canon(cached) {
			t.Errorf("seat %d: two reads at one version disagree\n first=%s\n second=%s", seat, canon(cached), canon(again))
		}
	}

	// The fixture must be able to discriminate: with nothing legal the checks
	// above prove nothing. The seed is fixed, so this is t.Fatal, not Skip.
	seat := s.Cur
	if len(c.For(s, v0, seat).Roads) == 0 {
		t.Fatalf("seat %d has no legal roads after setup", seat)
	}

	// A new version re-derives: mutate the state so a fresh compute would
	// differ, advance the version, and require the new fresh answer.
	s.Players[seat].RoadsLeft = 0
	fresh := s.LegalTargetsFor(seat)
	if len(fresh.Roads) != 0 {
		t.Fatalf("with no road pieces left a fresh compute still offers %d roads", len(fresh.Roads))
	}
	if got := c.For(s, v0+1, seat); canon(got) != canon(fresh) {
		t.Errorf("new version not re-derived\n got=%s\nwant=%s", canon(got), canon(fresh))
	}
}
