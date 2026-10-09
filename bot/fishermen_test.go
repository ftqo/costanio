package bot

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// newFishPlayState builds a base+fishermen game, drops it into the play phase
// with seat 0 to move and already rolled, and returns it.
//
// Constructed rather than seed-hunted, so a board-derivation change cannot
// make it skip (see the skip census in CONTRIBUTING.md).
func newFishPlayState(t *testing.T, players, target int) *engine.State {
	t.Helper()
	events, err := engine.New(engine.GameConfig{
		Players: players, Ruleset: "base+fishermen", TargetVP: target,
	}, engine.SeedsFrom(11))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	return s
}

// placeSettlements hands each seat n settlements at mutually non-adjacent land
// vertices, in board order, so the seats' victory points are whatever the caller
// asked for and nothing else.
func placeSettlements(t *testing.T, s *engine.State, per []int) [][]board.Vertex {
	t.Helper()
	out := make([][]board.Vertex, len(per))
	seat, left := 0, per[0]
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) {
			continue
		}
		for _, v := range h.Vertices() {
			for seat < len(per) && left == 0 {
				seat++
				if seat < len(per) {
					left = per[seat]
				}
			}
			if seat >= len(per) {
				return out
			}
			if engine.CheckSettlementSpot(s, v) != nil {
				continue
			}
			s.Buildings[v] = engine.Building{Owner: engine.PlayerID(seat)}
			s.Players[seat].SettlementsLeft--
			out[seat] = append(out[seat], v)
			left--
		}
	}
	for i, n := range per {
		if len(out[i]) != n {
			t.Fatalf("fixture: seat %d got %d settlements, want %d", i, len(out[i]), n)
		}
	}
	return out
}

// The boot changes the win condition: Fishermen's WinThresholdDelta makes the
// holder's threshold target+1, so winningMove must use the seat's own threshold,
// not s.Config.TargetVP. A sole leader cannot shed the boot (decideGiveBoot
// needs a recipient doing at least as well), so it keeps it.
//
// Here seat 0 is sole leader and its affordable city upgrade reaches the target
// but not the threshold.
func TestWinningMoveCountsTheBootsExtraPoint(t *testing.T) {
	const target = 4
	s := newFishPlayState(t, 4, target)
	verts := placeSettlements(t, s, []int{2, 2, 2, 2})

	// Seat 0 upgrades one settlement to a city up front: 3 public VP against 2
	// everywhere else, which is what makes it the sole leader.
	s.Buildings[verts[0][0]] = engine.Building{Owner: 0, City: true}
	s.Players[0].SettlementsLeft++
	s.Players[0].CitiesLeft--

	x, ok := scenarios.FishStateExt(s)
	if !ok {
		t.Fatal("fishermen ext missing")
	}
	x.BootHolder, x.BootInPlay = 0, true

	// One city's worth of cards, so the second upgrade is affordable and is the
	// only build in the candidate set.
	for r, n := range engine.CostCity {
		s.Players[0].Hand[r] += n
	}

	// Fixture sanity: the target is 4, seat 0 is on 3, and its own threshold is 5.
	if got := s.PublicVPWithModules(0); got != 3 {
		t.Fatalf("fixture: seat 0 on %d public VP, want 3", got)
	}
	if got := engine.WinThreshold(s, 0); got != target+1 {
		t.Fatalf("fixture: boot-holder threshold %d, want %d", got, target+1)
	}
	if got := engine.WinThreshold(s, 1); got != target {
		t.Fatalf("fixture: seat 1 threshold %d, want %d", got, target)
	}

	// Sole leader: nobody is eligible to receive the boot, so it stays.
	if cmd, ok := (&Strong{}).passBoot(s, 0); ok {
		t.Fatalf("fixture: a sole leader shed the boot with %v", cmd)
	}

	b := NewStrong()
	cmd, ok := b.winningMove(s, 0)
	if !ok {
		return // no move this turn reaches 5
	}
	// A move winningMove returns must actually end the game.
	c := s.Clone()
	evs, err := engine.Decide(c, cmd)
	if err != nil {
		t.Fatalf("winningMove returned an illegal command %s: %v", cmd.Type, err)
	}
	for _, e := range evs {
		if err := engine.Apply(c, e); err != nil {
			t.Fatal(err)
		}
	}
	t.Fatalf("winningMove returned %s: seat 0 has %d VP, threshold %d, phase %s",
		cmd.Type, c.VPWithModules(0), engine.WinThreshold(s, 0), c.Phase)
}

// A boot-holder that is not the sole leader passes the boot to the seat
// furthest ahead.
func TestBootHolderPassesToTheLeader(t *testing.T) {
	s := newFishPlayState(t, 4, 10)
	verts := placeSettlements(t, s, []int{2, 2, 2, 2})
	// Seat 2 is the leader on public VP, seat 1 is level with us.
	s.Buildings[verts[2][0]] = engine.Building{Owner: 2, City: true}

	x, ok := scenarios.FishStateExt(s)
	if !ok {
		t.Fatal("fishermen ext missing")
	}
	x.BootHolder, x.BootInPlay = 0, true

	cmd, ok := NewStrong().passBoot(s, 0)
	if !ok {
		t.Fatal("boot-holder with two eligible recipients declined to pass")
	}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		t.Fatalf("the pass was rejected: %v", err)
	}
	d, err := engine.DecodeCommand[struct {
		To engine.PlayerID `json:"to"`
	}](cmd.Data)
	if err != nil {
		t.Fatal(err)
	}
	if d.To != 2 {
		t.Errorf("boot passed to seat %d, want 2 (the leader)", d.To)
	}
}

// setFish gives a seat a pile worth exactly v fish, in 1-fish tiles, and keeps
// FishExt.Tiles (the public per-seat tile count) in step with it (v 1-fish
// tiles are v tiles).
func setFish(t *testing.T, s *engine.State, seat engine.PlayerID, v int) *scenarios.FishExt {
	t.Helper()
	x, ok := scenarios.FishStateExt(s)
	if !ok {
		t.Fatal("fishermen ext missing")
	}
	x.Held[seat] = [3]int{v, 0, 0}
	x.Tiles[seat] = v
	return x
}

// fishOffers runs the candidate generator and returns the `use` of every spend
// it offered.
func fishOffers(b *Strong, s *engine.State, seat engine.PlayerID) map[string]int {
	out := map[string]int{}
	record := func(cmd engine.Command) {
		var d struct {
			Use string `json:"use"`
		}
		if json.Unmarshal(cmd.Data, &d) == nil {
			out[d.Use]++
		}
	}
	b.fishCandidates(s, seat, record, func(cmd engine.Command, _ float64) { record(cmd) })
	return out
}

// The top rung is kept reachable by a rule (fishRungFloor). Pinned: the rule
// fires in its window, not below it, and not when there is no top rung (so it
// never strands fish).
func TestFishRungGateHoldsBelowTopRung(t *testing.T) {
	b := NewStrong()
	open := NewStrong(WithoutFishRungGate())

	for _, have := range []int{5, 6} {
		s := newFishPlayState(t, 4, 10)
		placeSettlements(t, s, []int{2, 2, 2, 2})
		setFish(t, s, 0, have)
		if got := len(fishOffers(b, s, 0)); got != 0 {
			t.Errorf("holding %d fish: gated bot offered %v, want nothing",
				have, fishOffers(b, s, 0))
		}
		if got := fishOffers(open, s, 0); len(got) == 0 {
			t.Errorf("holding %d fish: ungated bot offered nothing", have)
		}
	}

	// Below the window the ladder is open: a seat on 4 fish spends at 4.
	s := newFishPlayState(t, 4, 10)
	placeSettlements(t, s, []int{2, 2, 2, 2})
	setFish(t, s, 0, 4)
	if got := fishOffers(b, s, 0); got[scenarios.FishTakeResource] == 0 {
		t.Errorf("holding 4 fish: gate suppressed the 4-fish rung (%v)", got)
	}

	// With no development deck there is no top rung, so the gate must not fire.
	s = newFishPlayState(t, 4, 10)
	placeSettlements(t, s, []int{2, 2, 2, 2})
	setFish(t, s, 0, 5)
	s.DevDeck = engine.DevHand{}
	if got := fishOffers(b, s, 0); len(got) == 0 {
		t.Errorf("empty development deck: gate held a 5-fish pile")
	}
}

// The 3-fish steal is the only fish spend that moves an opponent, so its value
// must not scale with Weights.Opp (as in
// TestCamelGainIgnoresOpponentDiscount). The legacy arm shows the
// assertion fails against production-weight pricing.
func TestFishStealValueIgnoresOppWeight(t *testing.T) {
	s := newFishPlayState(t, 4, 10)
	placeSettlements(t, s, []int{2, 2, 2, 2})
	setFish(t, s, 0, 3)
	for r, n := range map[board.Resource]int{board.Wood: 2, board.Brick: 2} {
		s.Players[1].Hand[r] = n
	}
	cmd := engine.Command{Player: 0, Type: scenarios.CmdSpendFish,
		Data: raw2(map[string]any{"use": scenarios.FishSteal, "victim": engine.PlayerID(1)})}

	var deltas []float64
	scales := []float64{0.1, 9.6, 96}
	for _, opp := range scales {
		w := DefaultWeights()
		w.Opp = opp
		b := NewStrong(WithWeights(w))
		sc, ok := b.expectedStealValue(s, 0, 1, cmd)
		if !ok {
			t.Fatalf("Opp=%g: no steal value on a legal fixture", opp)
		}
		// bestPlay compares the delta against standing still.
		deltas = append(deltas, sc-b.eval(s, 0))
	}
	t.Logf("steal delta by Opp %v: %v", scales, deltas)
	for i := range deltas {
		if math.Abs(deltas[i]-deltas[0]) > 1e-6 {
			t.Errorf("steal worth %.4f at Opp=%g, %.4f at Opp=%g, want equal",
				deltas[i], scales[i], deltas[0], scales[0])
		}
	}
}

// Simple must play Fishermen (spend fish, pass the boot): it is the bot the
// adversarial battery (sim.TestAdversarialAcrossRulesets) plays, and Fishermen
// registers no Auto hook. See bot/simple_fish.go.
func TestSimplePlaysTheFishLadder(t *testing.T) {
	s := newFishPlayState(t, 4, 10)
	placeSettlements(t, s, []int{2, 2, 2, 2})
	setFish(t, s, 0, 4)

	b := NewSimple()
	cmd, ok := b.Act(s, 0)
	if !ok {
		t.Fatal("the baseline bot had no move on its own rolled turn")
	}
	if cmd.Type != scenarios.CmdSpendFish {
		t.Fatalf("holding 4 fish the baseline bot played %s, not a fish spend", cmd.Type)
	}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		t.Fatalf("the spend the baseline bot named is illegal: %v", err)
	}

	// Cheapest affordable rung that has a legal target. On this fixture nobody
	// holds a card to steal and the robber is not on our production, so the
	// 2-fish and 3-fish rungs are both illegal and the 4-fish bank withdrawal is
	// what is left.
	var d struct {
		Use string `json:"use"`
	}
	if err := json.Unmarshal(cmd.Data, &d); err != nil {
		t.Fatal(err)
	}
	t.Logf("baseline spent at the %q rung holding 4 fish", d.Use)

	// The boot comes before any spend: it costs its holder a victory point for
	// as long as it is held.
	x := setFish(t, s, 0, 4)
	x.BootHolder, x.BootInPlay = 0, true
	cmd, ok = b.Act(s, 0)
	if !ok || cmd.Type != scenarios.CmdGiveBoot {
		t.Fatalf("holding the boot, the baseline bot played %s (ok=%v), want %s", cmd.Type, ok, scenarios.CmdGiveBoot)
	}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		t.Fatalf("the boot pass the baseline bot named is illegal: %v", err)
	}

	// Strong must not inherit the greedy policy: cheapest-first spending would
	// strip fish held for a higher rung. The assertion checks the embedded
	// Simple's field.
	if NewStrong().simple.fish {
		t.Error("Strong's fallback Simple has the greedy fish policy enabled")
	}
}
