package islands

import (
	"errors"
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func rng(seed uint64) *rand.Rand {
	return rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
}

// A curated board passed via cfg.Board must come out of SetupBoard unchanged:
// the module must not carve its own sea or gold over an authored shape.
func TestSetupBoardSkipsCuratedBoard(t *testing.T) {
	b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(2) {
		b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
	}
	b.Tiles[board.Hex{Q: 2, R: 0}] = board.Tile{Res: board.Sea}
	b.Robber = board.Hex{Q: 0, R: 0}
	b.Tiles[b.Robber] = board.Tile{Res: board.ResNone}

	before := b.Clone()
	cfg := engine.GameConfig{Players: 3, Ruleset: "base+islands", Board: before.Clone()}

	Module{}.SetupBoard(b, cfg, rng(1))

	if len(b.Tiles) != len(before.Tiles) {
		t.Fatalf("tile count changed: %d -> %d", len(before.Tiles), len(b.Tiles))
	}
	for h, want := range before.Tiles {
		if got := b.Tiles[h]; got != want {
			t.Errorf("tile %v changed: %+v -> %+v (curated board was carved)", h, want, got)
		}
	}
}

// --- Setup-phase gold picks --------------------------------------------------
//
// A round-2 settlement bordering a gold hex owes its owner a free-choice pick
// (SetupGrant, EvGoldOwed), which must be spendable during setup rather than
// refused with ErrWrongPhase.

// setupGoldState puts a gold hex under a round-2 settlement, leaving the state
// in PhaseSetup with `owed` picks pending for player 0.
func setupGoldState(t *testing.T, owed int) *engine.State {
	t.Helper()
	s := builtState(t, 3)
	s.Phase = engine.PhaseSetup
	s.Rolled = false
	s.SetupRound = 1
	gold := board.Hex{Q: 1, R: 0}
	s.Board.Tiles[gold] = board.Tile{Res: board.Gold, Number: 5}
	ext(s).PendingGold[0] = owed
	return s
}

func TestChooseGoldInSetupPhase(t *testing.T) {
	tests := []struct {
		name  string
		owed  int
		bank  map[board.Resource]int // bank overrides
		actor engine.PlayerID
		gain  engine.Hand
		want  error // nil = accepted
	}{
		{name: "single pick accepted", owed: 1, actor: 0, gain: engine.Hand{board.Ore: 1}},
		{name: "two picks split across resources", owed: 2, actor: 0, gain: engine.Hand{board.Ore: 1, board.Wood: 1}},
		{name: "short pick rejected", owed: 2, actor: 0, gain: engine.Hand{board.Ore: 1}, want: ErrBadGoldPick},
		{name: "over-pick rejected", owed: 1, actor: 0, gain: engine.Hand{board.Ore: 2}, want: ErrBadGoldPick},
		{name: "negative pick rejected", owed: 1, actor: 0, gain: engine.Hand{board.Ore: 2, board.Wood: -1}, want: ErrBadGoldPick},
		{name: "seat owing nothing rejected", owed: 1, actor: 1, gain: engine.Hand{board.Ore: 1}, want: ErrNoGoldOwed},
		{
			name: "drained bank clamps the pick",
			owed: 2, bank: map[board.Resource]int{board.Wood: 0, board.Brick: 0, board.Sheep: 0, board.Wheat: 0, board.Ore: 1},
			actor: 0, gain: engine.Hand{board.Ore: 1},
		},
		{
			name: "drained bank still rejects an over-pick",
			owed: 2, bank: map[board.Resource]int{board.Wood: 0, board.Brick: 0, board.Sheep: 0, board.Wheat: 0, board.Ore: 1},
			actor: 0, gain: engine.Hand{board.Ore: 2}, want: ErrBadGoldPick,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := setupGoldState(t, tc.owed)
			for r, n := range tc.bank {
				s.Bank[r] = n
			}
			handBefore := s.Players[tc.actor].Hand
			bankBefore := s.Bank
			events, err := engine.Decide(s, engine.Command{Player: tc.actor, Type: CmdChooseGold,
				Data: mustJSON(t, goldChosenData{Gain: tc.gain})})
			if tc.want != nil {
				if !errors.Is(err, tc.want) {
					t.Fatalf("err = %v, want %v", err, tc.want)
				}
				// An illegal pick leaves the state untouched.
				if s.Players[tc.actor].Hand != handBefore || s.Bank != bankBefore {
					t.Errorf("rejected pick mutated state")
				}
				return
			}
			if err != nil {
				t.Fatalf("Decide: %v", err)
			}
			if len(events) != 1 || events[0].Type != EvGoldChosen {
				t.Fatalf("events = %+v", events)
			}
			for _, e := range events {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			want := handBefore
			want.Add(tc.gain)
			if s.Players[tc.actor].Hand != want {
				t.Errorf("hand = %v, want %v", s.Players[tc.actor].Hand, want)
			}
			wantBank := bankBefore
			wantBank.Sub(tc.gain)
			if s.Bank != wantBank {
				t.Errorf("bank = %v, want %v", s.Bank, wantBank)
			}
			if len(ext(s).PendingGold) != 0 {
				t.Errorf("pending gold remains: %v", ext(s).PendingGold)
			}
			// Setup still runs: the pick must not disturb the placement snake.
			if s.Phase != engine.PhaseSetup {
				t.Errorf("phase = %v, want setup", s.Phase)
			}
		})
	}
}

// TestSetupGoldPickRegression: 4 players, base+islands, seed 8. Player 0's
// round-2 settlement borders a gold hex, so a pick is owed while the game is
// still in PhaseSetup.
//
// The fixture pins a shape (a gold pick owed mid-setup), not a board; if the
// generator changes, pick a seed that still produces it.
//
// It uses start_island "any": procedural boards put gold only on the outer
// islands, and under the default rule starting settlements are on the main
// island, so no setup settlement could touch gold (a vertex touches at most one
// landmass).
func TestSetupGoldPickRegression(t *testing.T) {
	log, err := engine.New(withStart(engine.GameConfig{Players: 4, Ruleset: "base+islands"}, StartAny), engine.SeedsFrom(8))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}

	var owing = engine.NoPlayer
	var owed int
	for i := 0; i < 400 && s.Phase == engine.PhaseSetup; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		log = append(log, step(t, s, cmd)...)
		for p, n := range extRO(s).PendingGold {
			if n > 0 {
				owing, owed = p, n
				break
			}
		}
		if owing != engine.NoPlayer {
			break
		}
	}
	if owing == engine.NoPlayer {
		t.Fatal("seed 8 no longer owes a setup gold pick; fixture needs refreshing")
	}
	if s.Phase != engine.PhaseSetup {
		t.Fatalf("phase = %v, want setup", s.Phase)
	}

	var gain engine.Hand
	gain[board.Ore] = owed
	handBefore := s.Players[owing].Hand
	bankBefore := s.Bank
	log = append(log, step(t, s, engine.Command{Player: owing, Type: CmdChooseGold,
		Data: mustJSON(t, goldChosenData{Gain: gain})})...)

	if got := s.Players[owing].Hand[board.Ore]; got != handBefore[board.Ore]+owed {
		t.Errorf("ore = %d, want %d", got, handBefore[board.Ore]+owed)
	}
	if got := s.Bank[board.Ore]; got != bankBefore[board.Ore]-owed {
		t.Errorf("bank ore = %d, want %d", got, bankBefore[board.Ore]-owed)
	}
	if n := extRO(s).PendingGold[owing]; n != 0 {
		t.Errorf("pending gold remains: %d", n)
	}

	// Setup completes normally afterwards, and the log still replays exactly.
	for i := 0; i < 400 && s.Phase == engine.PhaseSetup; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck after the gold pick")
		}
		log = append(log, step(t, s, cmd)...)
	}
	replayed, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s, replayed) {
		t.Errorf("replay diverged after a setup gold pick")
	}
}
