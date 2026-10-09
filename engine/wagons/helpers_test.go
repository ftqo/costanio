package wagons

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Tests here construct the position they need instead of searching for a seed
// that deals it, so none of them can skip (see make skip-budget).

// fixtureSeed is the board every test starts from: at four players it deals a
// radius-2 full hexagon whose six outer corners are capes. Tests rely only on
// the derivation picking some alternating triple of them.
const fixtureSeed = 1

// newGame creates a game and folds its opening events.
func newGame(t *testing.T, players int, ruleset string) *engine.State {
	t.Helper()
	evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(fixtureSeed))
	if err != nil {
		t.Fatalf("new %s %dp: %v", ruleset, players, err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatalf("replay %s: %v", ruleset, err)
	}
	return s
}

// setUp drives the snake draft to its end with the engine's own auto
// placements, leaving the state in the play phase with nothing rolled.
func setUp(t *testing.T, s *engine.State) {
	t.Helper()
	for range 200 {
		if s.Phase != engine.PhaseSetup {
			return
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup never finished")
		}
		do(t, s, cmd)
	}
	t.Fatal("setup did not finish in 200 commands")
}

// opened is a game in the play phase with the scenario started (wagons out,
// gold dealt) and the current seat's dice treated as rolled. The roll is set
// rather than played so it is never a 7; tests about the 7 call OnSeven.
func opened(t *testing.T, players int, ruleset string) (*engine.State, *WagonsExt) {
	t.Helper()
	s := newGame(t, players, ruleset)
	setUp(t, s)
	fire(t, s, (Wagons{}).onEvents(s, nil))
	s.Rolled = true
	x, ok := StateExt(s)
	if !ok {
		t.Fatal("the wagons ext is not in State.Ext after the scenario opened")
	}
	if !x.Started {
		t.Fatal("the scenario did not start on the first play batch")
	}
	return s, x
}

// fire folds events a hook produced, stamping the sequence numbers the engine
// would have.
func fire(t *testing.T, s *engine.State, evs []engine.Event) {
	t.Helper()
	for _, e := range evs {
		e.Seq = s.NextSeq
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("applying %s: %v", e.Type, err)
		}
	}
}

// do runs a command through the whole engine and folds what it produces.
func do(t *testing.T, s *engine.State, cmd engine.Command) []engine.Event {
	t.Helper()
	evs, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("%s by %d was refused: %v", cmd.Type, cmd.Player, err)
	}
	for _, e := range evs {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("applying %s: %v", e.Type, err)
		}
	}
	return evs
}

// refuse requires a command to be refused with a specific rule.
func refuse(t *testing.T, s *engine.State, cmd engine.Command, want error) {
	t.Helper()
	_, err := engine.Decide(s, cmd)
	if err == nil {
		t.Fatalf("%s by %d accepted, want %v", cmd.Type, cmd.Player, want)
	}
	if !errors.Is(err, want) {
		t.Fatalf("%s by %d refused with %v, want %v", cmd.Type, cmd.Player, err, want)
	}
}

func cmd(p engine.PlayerID, t engine.CommandType, payload any) engine.Command {
	var data json.RawMessage
	if payload != nil {
		data, _ = json.Marshal(payload)
	}
	return engine.Command{Player: p, Type: t, Data: data}
}

// centre is the fixture's reference intersection: the bottom corner of the
// centre hex. The top corner is board.Vertex{}, the zero value, which would
// make a parked wagon indistinguishable from "no wagon" without OnBoard.
var centre = board.Vertex{Q: 0, R: 0, Side: board.S}

// park puts p's wagon on v with a given level, gold and cargo, and opens a
// fresh movement action.
func park(x *WagonsExt, p engine.PlayerID, v board.Vertex, level, gold int, cargo uint8) {
	x.Wagon[p] = v
	x.OnBoard[p] = true
	x.Level[p] = level
	x.Gold[p] = gold
	x.Cargo[p] = cargo
	x.TurnSeat = p
	x.MoveOpen, x.MoveDone, x.Moved = false, false, false
	x.MP = 0
	x.Boosted = false
	x.Tried = [tradeHexCount]bool{}
}

// aLandCornerOf is one of a trade hex's four buildable corners, chosen by index
// so a test can name the same one twice.
func aLandCornerOf(t *testing.T, s *engine.State, x *WagonsExt, hex, corner int) board.Vertex {
	t.Helper()
	cs := landCorners(s.Board, x.Trade[hex])
	if len(cs) <= corner {
		t.Fatalf("trade hex %d has %d land corners, wanted at least %d", hex, len(cs), corner+1)
	}
	return cs[corner]
}
