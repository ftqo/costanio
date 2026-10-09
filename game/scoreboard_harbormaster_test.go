package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/harbormaster"
)

// TestScoreboardHarbormasterCard: the breakdown is a complete
// ledger, so a VP source with no row shows up as "other".
// TestVPBreakdownSumsToVP_Modules cannot catch this one, because seeded bot
// games rarely give a seat the Harbormaster.
//
// So the log is built rather than searched for: real setup, the standings
// event from a real Decide through the module's AfterEvents hook, and
// buildings placed by folding the base game's own build events, paid for by a
// granted distribution so no hand or bank goes negative.
func TestScoreboardHarbormasterCard(t *testing.T) {
	const players = 4
	cfg := engine.GameConfig{Players: players, Ruleset: "base+" + harbormaster.Name, TargetVP: 30}
	log, err := engine.New(cfg, engine.SeedsFrom(42))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	// Real setup, so the log is a real game's log up to this point.
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		evs, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("Decide(%s): %v", cmd.Type, err)
		}
		for _, e := range evs {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		log = append(log, evs...)
	}

	// Three free harbour vertices, upgraded to cities: 6 harbour points on top
	// of whatever setup gave seat 0, a clear lead. The lead is asserted, since
	// setup may already have put seat 0 on a harbour.
	const want = 3
	var free []board.Vertex
	for _, h := range s.Board.Harbors {
		for _, v := range h.Verts {
			if _, taken := s.Buildings[v]; !taken {
				free = append(free, v)
				break
			}
		}
		if len(free) == want {
			break
		}
	}
	if len(free) < want {
		t.Fatalf("the dealt board leaves %d free harbour vertices, this test needs %d", len(free), want)
	}

	fold := func(typ engine.EventType, data any) {
		t.Helper()
		e := engine.NewEvent(typ, data)
		e.Seq = s.NextSeq
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("Apply(%s): %v", typ, err)
		}
		log = append(log, e)
	}

	// Pay for what follows, so no hand and no bank goes negative.
	fold(engine.EvResDistributed, engine.ResDistributedData{Gains: []engine.PlayerGain{{
		Player: 0,
		Gain: engine.Hand{
			board.Wood: want, board.Brick: want, board.Sheep: want,
			board.Wheat: 3 * want, board.Ore: 3 * want,
		},
	}}})
	for i := range free {
		fold(engine.EvSettlementBuilt, engine.BuiltData{Player: 0, V: &free[i]})
		fold(engine.EvCityBuilt, engine.BuiltData{Player: 0, V: &free[i]})
	}

	mine := harbormaster.HarborPoints(s, 0)
	if mine < harbormaster.Threshold {
		t.Fatalf("seat 0 has %d harbour points after the builds, want at least %d",
			mine, harbormaster.Threshold)
	}
	for seat := 1; seat < players; seat++ {
		if got := harbormaster.HarborPoints(s, engine.PlayerID(seat)); got >= mine {
			t.Fatalf("seat %d has %d harbour points, seat 0 has %d, want seat 0 ahead",
				seat, got, mine)
		}
	}
	if harbormaster.Holder(s) != engine.NoPlayer {
		t.Fatal("the card was awarded without a batch deriving it")
	}

	// A real command, so the standings come out of the module's own hook and
	// land in the log as in a played game.
	evs, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	if err != nil {
		t.Fatalf("Decide(roll): %v", err)
	}
	for _, e := range evs {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	log = append(log, evs...)
	if got := harbormaster.Holder(s); got != 0 {
		t.Fatalf("holder is P%d after the roll, want P0", got)
	}

	fin, err := engine.ForceFinish(s)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range fin {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	log = append(log, fin...)

	sb, err := scoreboardFromEvents(log)
	if err != nil {
		t.Fatalf("scoreboardFromEvents: %v", err)
	}
	if got := sb.Players[0].VPBreakdown.Harbormaster; got != 2 {
		t.Errorf("the holder's Harbormaster row is %d, want 2 (%+v)", got, sb.Players[0].VPBreakdown)
	}
	for _, p := range sb.Players[1:] {
		if p.VPBreakdown.Harbormaster != 0 {
			t.Errorf("seat %d scores %d for a card it does not hold", p.Seat, p.VPBreakdown.Harbormaster)
		}
	}
	for _, p := range sb.Players {
		if got := vpBreakdownSum(p.VPBreakdown); got != p.VP {
			t.Errorf("seat %d breakdown %d != VP %d (%+v)", p.Seat, got, p.VP, p.VPBreakdown)
		}
	}
}
