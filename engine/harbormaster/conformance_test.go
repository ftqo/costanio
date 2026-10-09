package harbormaster

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/scenarios"
)

// The composition half of the conformance checklist, played through the real
// Decide/Apply path on generated boards. Positions are constructed: a game is
// dealt for its board and seats, then the buildings under test are placed
// directly, so no test depends on a seed dealing a particular harbour to a
// particular player.

// deal creates a game and folds its opening events. Phase is still setup.
func deal(t *testing.T, ruleset string, players int, seed uint64) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("New(%s): %v", ruleset, err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("Apply(%s): %v", e.Type, err)
		}
	}
	return s
}

// played is deal plus the whole setup draft, driven by the engine's own
// auto-commands, leaving a state in PhasePlay.
func played(t *testing.T, ruleset string, players int, seed uint64) *engine.State {
	t.Helper()
	s := deal(t, ruleset, players, seed)
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		step(t, s, cmd)
	}
	return s
}

func step(t *testing.T, s *engine.State, cmd engine.Command) []engine.Event {
	t.Helper()
	evs, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("Decide(%s by P%d): %v", cmd.Type, cmd.Player, err)
	}
	for _, e := range evs {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("Apply(%s): %v", e.Type, err)
		}
	}
	return evs
}

// harborVerts is every harbour vertex on the board, in stable order. Fails
// rather than skips when there are too few: a board with no harbours is a
// generator bug.
func harborVerts(t *testing.T, s *engine.State, want int) []board.Vertex {
	t.Helper()
	var out []board.Vertex
	for _, h := range s.Board.Harbors {
		out = append(out, h.Verts[0])
	}
	slices.SortFunc(out, func(a, b board.Vertex) int {
		if a.Q != b.Q {
			return a.Q - b.Q
		}
		if a.R != b.R {
			return a.R - b.R
		}
		return int(a.Side) - int(b.Side)
	})
	if len(out) < want {
		t.Fatalf("board has %d harbours, this test needs %d", len(out), want)
	}
	return out
}

// clearBuildings empties the board so a test states the whole position it
// means.
func clearBuildings(s *engine.State) {
	for v := range s.Buildings {
		delete(s.Buildings, v)
	}
}

func standings(t *testing.T, evs []engine.Event) (StandingsData, bool) {
	t.Helper()
	for _, e := range evs {
		if e.Type == EvStandings {
			return engine.DecodeEvent[StandingsData](e), true
		}
	}
	return StandingsData{}, false
}

// TestTargetIsDefaultPlusOne is the victory-target bullet, in both
// spellings of every pairing: the increment is summed after every defaulter, so
// the ruleset string's alphabet cannot change the answer.
func TestTargetIsDefaultPlusOne(t *testing.T) {
	cases := []struct {
		ruleset string
		want    int
	}{
		{"base", 10},
		{"base+" + Name, 11},
		{"base+cak", 13},
		{"base+cak+" + Name, 14},
		{"base+" + Name + "+cak", 14},
		{"base+caravans", 12},
		{"base+caravans+" + Name, 13},
		{"base+" + Name + "+caravans", 13},
		{"base+fishermen", 10},
		{"base+fishermen+" + Name, 11},
		{"base+" + Name + "+fishermen", 11},
		{"base+islands", 10},
		{"base+islands+" + Name, 11},
		{"base+" + Name + "+islands", 11},
	}
	for _, tc := range cases {
		t.Run(tc.ruleset, func(t *testing.T) {
			cfg := engine.GameConfig{Players: 3, Ruleset: tc.ruleset}
			if got := engine.ResolveTargetVP(cfg); got != tc.want {
				t.Errorf("ResolveTargetVP = %d, want %d", got, tc.want)
			}
			s := deal(t, tc.ruleset, 3, 4)
			if got := s.Config.TargetVP; got != tc.want {
				t.Errorf("the created game plays to %d, want %d", got, tc.want)
			}
		})
	}
}

// TestOldBootStacksOnTarget: Fishermen's boot costs its
// holder one extra point through WinThresholdDelta, which is a per-seat handicap
// rather than a config default, so it stacks on the adjusted target. 11 for the
// table, 12 for whoever is holding the boot.
func TestOldBootStacksOnTarget(t *testing.T) {
	s := played(t, engine.CanonicalRuleset("base+fishermen+"+Name), 3, 11)
	if s.Config.TargetVP != 11 {
		t.Fatalf("target %d, want 11", s.Config.TargetVP)
	}
	base := engine.WinThreshold(s, 0)
	if base != 11 {
		t.Fatalf("a seat with no boot needs %d, want 11", base)
	}
	// The boot's own delta is Fishermen's; all this test owns is that it is
	// added to 11 rather than to 10. Any seat holding it needs one more.
	for seat := range s.Players {
		if got := engine.WinThreshold(s, engine.PlayerID(seat)); got != 11 && got != 12 {
			t.Errorf("seat %d needs %d, want 11 (or 12 while holding the boot)", seat, got)
		}
	}
}

// TestNamedTargetNotAdjusted: the increment moves the ruleset's default, and
// a table that named its own target plays to that number. Otherwise the
// browser, which always sends a target, would get the point twice.
func TestNamedTargetNotAdjusted(t *testing.T) {
	for _, ruleset := range []string{"base+" + Name, engine.CanonicalRuleset("base+cak+" + Name)} {
		cfg := engine.GameConfig{Players: 3, Ruleset: ruleset, TargetVP: 12}
		if got := engine.ResolveTargetVP(cfg); got != 12 {
			t.Errorf("%s with an explicit 12 resolves to %d, want 12", ruleset, got)
		}
		log, err := engine.New(cfg, engine.SeedsFrom(3))
		if err != nil {
			t.Fatal(err)
		}
		d := engine.DecodeEvent[engine.GameCreatedData](log[0])
		if d.Config.TargetVP != 12 {
			t.Errorf("%s recorded target %d, want the 12 the host named", ruleset, d.Config.TargetVP)
		}
	}
}

// TestResolvedTargetNotReapplied: the number is in
// the game-created event at log position 0, so a fold reads it back and replays
// never add the point again.
func TestResolvedTargetNotReapplied(t *testing.T) {
	ruleset := engine.CanonicalRuleset("base+cak+" + Name)
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: ruleset}, engine.SeedsFrom(9))
	if err != nil {
		t.Fatal(err)
	}
	created := engine.DecodeEvent[engine.GameCreatedData](log[0])
	if created.Config.TargetVP != 14 {
		t.Fatalf("the game-created event carries target %d, want 14", created.Config.TargetVP)
	}
	for round := range 3 {
		s, err := engine.Replay(log)
		if err != nil {
			t.Fatal(err)
		}
		if s.Config.TargetVP != 14 {
			t.Fatalf("replay %d produced target %d, want 14", round, s.Config.TargetVP)
		}
	}
}

// TestBuildingAndUpgradingMoveTheCard walks the card through its whole life on a
// real board: below the threshold nobody holds it, three takes it, a strictly
// larger total moves it, a tie leaves it where it is, and a fall below three
// gives it up.
func TestBuildingAndUpgradingMoveTheCard(t *testing.T) {
	s := played(t, "base+"+Name, 3, 21)
	hv := harborVerts(t, s, 6)
	clearBuildings(s)

	// A batch that changes nothing about the board, so the only thing the
	// standings can react to is what this test placed.
	poke := func() []engine.Event {
		return step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	}
	endTurn := func() {
		for s.RobberPending || len(s.PendingDiscards) > 0 {
			cmd, ok := engine.AutoCommand(s)
			if !ok {
				t.Fatal("stuck clearing the roll")
			}
			step(t, s, cmd)
		}
		step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdEndTurn})
	}

	// Two harbour settlements: two points, below the threshold.
	put(s, hv[0], 0, false)
	put(s, hv[1], 0, false)
	poke()
	if h := Holder(s); h != engine.NoPlayer {
		t.Fatalf("two harbour points already holds the card (P%d)", h)
	}
	if got := Points(s); got[0] != 2 {
		t.Fatalf("P0 recorded %v harbour points, want 2 in seat 0", got)
	}
	endTurn()

	// Upgrade one to a city: three points, and the card.
	put(s, hv[0], 0, true)
	poke()
	if h := Holder(s); h != 0 {
		t.Fatalf("P0 at three harbour points does not hold the card (holder P%d)", h)
	}
	endTurn()

	// P1 draws level at three: a tie leaves the card with its holder.
	put(s, hv[2], 1, true)
	put(s, hv[3], 1, false)
	poke()
	if h := Holder(s); h != 0 {
		t.Fatalf("tie moved the card to P%d, want P0", h)
	}
	endTurn()

	// P1 goes strictly ahead: the card moves.
	put(s, hv[4], 1, true)
	poke()
	if h := Holder(s); h != 1 {
		t.Fatalf("P1 leads 5-3 and the card is with P%d", h)
	}
	endTurn()

	// Remove P1's buildings (as a conquest or double downgrade would): P1 drops
	// out and P0, the sole leader at 3, takes the card back.
	delete(s.Buildings, hv[2])
	delete(s.Buildings, hv[3])
	delete(s.Buildings, hv[4])
	poke()
	if h := Holder(s); h != 0 {
		t.Fatalf("with P1 wiped out the card should return to P0 at three, got P%d", h)
	}
	endTurn()

	// And now P0 falls below the threshold with nobody else near it.
	put(s, hv[0], 0, false)
	delete(s.Buildings, hv[1])
	poke()
	if h := Holder(s); h != engine.NoPlayer {
		t.Fatalf("a holder at one harbour point still holds the card (P%d)", h)
	}
}

// TestCardIsTwoPublicVP: the card's points are public, exactly like Longest
// Road's, so they are in the public total as well as the true one.
func TestCardIsTwoPublicVP(t *testing.T) {
	s := played(t, "base+"+Name, 3, 31)
	hv := harborVerts(t, s, 3)
	clearBuildings(s)
	put(s, hv[0], 0, true)
	put(s, hv[1], 0, false)

	beforePublic := s.PublicVPWithModules(0)
	beforeTrue := s.VPWithModules(0)
	step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	if Holder(s) != 0 {
		t.Fatalf("P0 did not take the card")
	}
	if got := s.PublicVPWithModules(0) - beforePublic; got != CardVP {
		t.Errorf("taking the card moved P0's PUBLIC total by %d, want %d", got, CardVP)
	}
	if got := s.VPWithModules(0) - beforeTrue; got != CardVP {
		t.Errorf("taking the card moved P0's true total by %d, want %d", got, CardVP)
	}
	for seat := 1; seat < len(s.Players); seat++ {
		if v := victory(s, engine.PlayerID(seat)); v != 0 {
			t.Errorf("seat %d scores %d for a card it does not hold", seat, v)
		}
	}
}

// TestTakingCardWinsSameTurn is the immediacy bullet: the transfer
// happens at the moment the harbour points change, not at the end of the turn,
// so its 2 VP are available to the same turn's win check.
func TestTakingCardWinsSameTurn(t *testing.T) {
	s := played(t, "base+"+Name, 3, 41)
	hv := harborVerts(t, s, 6)
	clearBuildings(s)

	// P0 one point short of the 11 this ruleset plays to, with the card unheld
	// and P0 exactly at the threshold the moment the batch is derived.
	target := s.Config.TargetVP
	if target != 11 {
		t.Fatalf("base+%s plays to %d, want 11", Name, target)
	}
	put(s, hv[0], 0, true)  // 2 VP, 2 harbour points
	put(s, hv[1], 0, false) // 1 VP, 1 harbour point
	put(s, hv[2], 0, true)  // 2 VP
	put(s, hv[3], 0, true)  // 2 VP
	put(s, hv[4], 0, true)  // 2 VP
	// 9 base VP, 9 harbour points, card unheld. 9 + 2 = 11.
	if got := s.PublicVP(0); got != 9 {
		t.Fatalf("P0 has %d base VP, this test needs 9", got)
	}
	if Holder(s) != engine.NoPlayer {
		t.Fatal("the card is already held before the batch under test")
	}

	if s.Cur != 0 {
		t.Fatalf("this test needs P0 on turn, current is P%d", s.Cur)
	}
	evs := step(t, s, engine.Command{Player: 0, Type: engine.CmdRollDice})
	if _, ok := standings(t, evs); !ok {
		t.Fatalf("no %s in the batch: %v", EvStandings, types(evs))
	}
	if Holder(s) != 0 {
		t.Fatal("P0 did not take the card")
	}
	if s.Phase != engine.PhaseFinished || s.Winner != 0 {
		t.Fatalf("phase %q winner P%d: card VP not counted toward the same turn's win (events %v)",
			s.Phase, s.Winner, types(evs))
	}
	if i, j := slices.Index(types(evs), string(EvStandings)), slices.Index(types(evs), string(engine.EvGameFinished)); i > j {
		t.Errorf("standings at %d, finish at %d: want standings first", i, j)
	}
}

func types(evs []engine.Event) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = string(e.Type)
	}
	return out
}

// TestCardClaimedDuringSetup: nothing gates the card on a phase, and
// Knights places a city in setup round 2, so a player taking a harbour vertex
// in both rounds finishes setup holding it.
//
// It is also the only test of the hook that runs outside PhasePlay
// (engine.Hooks.AfterEvents); the phase assertions below pin that the rest of
// finalizeWith is still skipped during the draft.
func TestCardClaimedDuringSetup(t *testing.T) {
	s := deal(t, engine.CanonicalRuleset("base+cak+"+Name), 3, 51)
	if s.Phase != engine.PhaseSetup {
		t.Fatalf("phase %q, want setup", s.Phase)
	}
	hv := harborVerts(t, s, 3)

	// Three harbour points for the seat about to act, placed the way a Knights
	// setup leaves them: a round-1 settlement and a round-2 city.
	seat := s.Cur
	put(s, hv[0], seat, true)
	put(s, hv[1], seat, false)
	if Holder(s) != engine.NoPlayer {
		t.Fatal("the card is held before any batch has derived it")
	}

	cmd, ok := engine.AutoCommand(s)
	if !ok {
		t.Fatal("setup produced no command")
	}
	evs := step(t, s, cmd)
	if _, ok := standings(t, evs); !ok {
		t.Fatalf("a setup batch derived no standings: %v", types(evs))
	}
	if got := Holder(s); got != seat {
		t.Fatalf("holder is P%d after a setup batch, want P%d", got, seat)
	}
	if s.Phase != engine.PhaseSetup {
		t.Fatalf("phase = %q, want setup", s.Phase)
	}
	if s.Winner != engine.NoPlayer {
		t.Fatalf("a game was won during setup (P%d)", s.Winner)
	}
}

// TestStandingsMoveOnAnotherPlayersTurn: a change to a building's value derived
// on someone else's batch moves the card immediately. Barbarians are the real
// cause; this states the property without Knights' dice.
func TestStandingsMoveOnAnotherPlayersTurn(t *testing.T) {
	s := played(t, "base+"+Name, 3, 61)
	hv := harborVerts(t, s, 4)
	clearBuildings(s)
	put(s, hv[0], 1, true)
	put(s, hv[1], 1, false)
	if s.Cur == 1 {
		step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
		for s.RobberPending || len(s.PendingDiscards) > 0 {
			cmd, _ := engine.AutoCommand(s)
			step(t, s, cmd)
		}
		step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdEndTurn})
	}
	if s.Cur == 1 {
		t.Fatalf("this test needs a seat other than P1 on turn")
	}
	step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	if got := Holder(s); got != 1 {
		t.Fatalf("P1 holds %d harbour points, card went to P%d on P%d's turn",
			HarborPoints(s, 1), got, s.Cur)
	}
}

// TestStoredStandingsMatchDerivation: the ext caches a derivation, so
// any state a real game reaches must agree with recomputing from scratch. Plays
// whole games to cover batches nobody thought to enumerate.
func TestStoredStandingsMatchDerivation(t *testing.T) {
	for _, ruleset := range []string{
		"base+" + Name,
		engine.CanonicalRuleset("base+cak+" + Name),
		engine.CanonicalRuleset("base+islands+" + Name),
		engine.CanonicalRuleset("base+fishermen+" + Name),
		engine.CanonicalRuleset("base+caravans+" + Name),
	} {
		t.Run(ruleset, func(t *testing.T) {
			s := played(t, ruleset, 3, 71)
			check := func(where string) {
				t.Helper()
				want := make([]int, len(s.Players))
				for seat := range s.Players {
					want[seat] = HarborPoints(s, engine.PlayerID(seat))
				}
				if got := Points(s); !slices.Equal(got, want) {
					t.Fatalf("%s: stored %v, derived %v", where, got, want)
				}
				if got, w := Holder(s), deriveHolder(want, Holder(s)); got != w {
					t.Fatalf("%s: holder P%d is not stable under re-derivation (P%d)", where, got, w)
				}
			}
			check("at the end of setup")
			for range 400 {
				if s.Phase == engine.PhaseFinished {
					break
				}
				cmd, ok := engine.AutoCommand(s)
				if !ok {
					break
				}
				step(t, s, cmd)
				check("mid-game")
			}
		})
	}
}

// TestFishingGroundsAreNotHarbors: the two systems are independent and share
// the coast, so a fishing ground grants no harbour points and a vertex touching
// both gets both benefits.
func TestFishingGroundsAreNotHarbors(t *testing.T) {
	s := played(t, engine.CanonicalRuleset("base+fishermen+"+Name), 3, 81)
	clearBuildings(s)

	// A coastal vertex that is not a harbour vertex earns nothing here, however
	// much fish it draws.
	var nonHarbor board.Vertex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if _, isHarbor := s.Board.HarborAt(v); !isHarbor {
				nonHarbor, found = v, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("every vertex on this board belongs to a harbour")
	}
	put(s, nonHarbor, 0, true)
	if got := HarborPoints(s, 0); got != 0 {
		t.Errorf("a city off every harbour scored %d harbour points, want 0", got)
	}

	// And a harbour vertex earns its points whatever else the Fishermen module
	// has put on the coast.
	hv := harborVerts(t, s, 1)
	put(s, hv[0], 0, false)
	if got := HarborPoints(s, 0); got != 1 {
		t.Errorf("a settlement on a harbour scored %d, want 1", got)
	}
}

// TestIslandsShipsAndOuterHarbors: every harbour on the
// board counts, including one a sea carve leaves on a new coastline, and a ship
// is worth nothing whether or not it touches a harbour's sea edge.
func TestIslandsShipsAndOuterHarbors(t *testing.T) {
	s := played(t, engine.CanonicalRuleset("base+islands+"+Name), 4, 91)
	hv := harborVerts(t, s, 2)
	clearBuildings(s)

	if got := HarborPoints(s, 0); got != 0 {
		t.Fatalf("an empty board pays P0 %d harbour points", got)
	}
	// Whatever ships the setup left on the board are worth nothing.
	put(s, hv[0], 0, true)
	if got := HarborPoints(s, 0); got != 2 {
		t.Errorf("a city on an Islands board's harbour scored %d, want 2", got)
	}
	put(s, hv[1], 0, false)
	if got := HarborPoints(s, 0); got != 3 {
		t.Errorf("a city and a settlement on two harbours scored %d, want 3", got)
	}
	if Holder(s) != engine.NoPlayer {
		t.Fatal("hand-placed buildings awarded the card without a batch")
	}
	step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	if got := Holder(s); got != 0 {
		t.Errorf("holder P%d, want P0 on three harbour points", got)
	}
}

// TestRulesetCompatibility is the ValidRuleset bullet: Harbormaster is allowed
// with base, Islands, Knights, Fishermen and Caravans, and with Rivers, Raiders
// and Wagons (checked against the compat table only, since this test binary
// does not register them), and refused with Explorers.
func TestRulesetCompatibility(t *testing.T) {
	for _, partner := range []string{"", "islands", "cak", "fishermen", "caravans"} {
		ruleset := "base+" + Name
		if partner != "" {
			ruleset = engine.CanonicalRuleset(ruleset + "+" + partner)
		}
		if err := engine.CheckRuleset(ruleset); err != nil {
			t.Errorf("CheckRuleset(%q) = %v, want it allowed", ruleset, err)
		}
	}
	// Partners not registered in this test binary: the refusal table must not
	// name them.
	for _, partner := range []string{"rivers", "raiders", "wagons"} {
		if reason, refused := engine.ConflictBetween(Name, partner); refused {
			t.Errorf("%s and %s are refused (%q), want allowed", Name, partner, reason)
		}
	}
	if _, refused := engine.ConflictBetween(Name, "explorers"); !refused {
		t.Errorf("%s and explorers are not refused", Name)
	}
	if engine.ValidRuleset(engine.CanonicalRuleset("base+explorers+" + Name)) {
		t.Error("base+explorers+harbormaster resolves, want refused")
	}
}

// TestCeilingIncludesCard: the lobby clamps a table's target against the
// most a player can reach without VP development cards, and the card is
// transferable and reachable, so it belongs in that ceiling.
func TestCeilingIncludesCard(t *testing.T) {
	base := engine.MaxVPWithoutCards(engine.GameConfig{Players: 4, Ruleset: "base"})
	with := engine.MaxVPWithoutCards(engine.GameConfig{Players: 4, Ruleset: "base+" + Name})
	if with-base != CardVP {
		t.Errorf("the ceiling moved by %d, want %d", with-base, CardVP)
	}
}
