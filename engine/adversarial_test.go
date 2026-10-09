package engine

import (
	"bytes"
	"encoding/gob"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// deepClone returns an independent deep copy of the state via a gob round
// trip, so later mutations to the original can't reach the copy.
func deepClone(t *testing.T, s *State) *State {
	t.Helper()
	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(s); err != nil {
		t.Fatalf("clone encode: %v", err)
	}
	var c State
	if err := gob.NewDecoder(&buf).Decode(&c); err != nil {
		t.Fatalf("clone decode: %v", err)
	}
	return &c
}

// unchanged reports whether Decide left the state untouched. Both sides go
// through the same gob round trip so nil/empty-map normalization is identical,
// and reflect.DeepEqual compares maps order-independently.
func unchanged(t *testing.T, before, s *State) bool {
	t.Helper()
	return reflect.DeepEqual(before, deepClone(t, s))
}

// reject asserts a command is cleanly rejected: an error, no events, and the
// state unchanged (Decide must be pure).
func reject(t *testing.T, s *State, cmd Command, wantErrs ...error) {
	t.Helper()
	before := deepClone(t, s)
	var events []Event
	var err error
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("Decide panicked on %s: %v", cmd.Type, r)
			}
		}()
		events, err = Decide(s, cmd)
	}()
	if err == nil {
		t.Errorf("%s: expected rejection, got %d events", cmd.Type, len(events))
	}
	if len(events) != 0 {
		t.Errorf("%s: rejected command returned %d events", cmd.Type, len(events))
	}
	if !unchanged(t, before, s) {
		t.Errorf("%s: Decide MUTATED state on rejection", cmd.Type)
	}
	if len(wantErrs) > 0 {
		ok := false
		for _, w := range wantErrs {
			if errors.Is(err, w) {
				ok = true
			}
		}
		if !ok {
			t.Errorf("%s: error %v not among expected %v", cmd.Type, err, wantErrs)
		}
	}
}

// TestInvalidSetupCommands fires illegal commands during the setup phase.
func TestInvalidSetupCommands(t *testing.T) {
	s, _ := newGame(t, 3, 100)
	spot := findSettlementSpot(s)

	// Out-of-range / wrong player.
	reject(t, s, Command{Player: 9, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": spot})}, ErrNotYourTurn)
	reject(t, s, Command{Player: -1, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": spot})}, ErrNotYourTurn)
	reject(t, s, Command{Player: 1, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": spot})}, ErrNotYourTurn)

	// Wrong-phase commands during setup.
	reject(t, s, Command{Player: 0, Type: CmdRollDice}, ErrWrongPhase)
	reject(t, s, Command{Player: 0, Type: CmdEndTurn}, ErrWrongPhase)
	reject(t, s, Command{Player: 0, Type: CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": roadFor(s, spot)})}, ErrWrongPhase, ErrBadPlacement)
	reject(t, s, Command{Player: 0, Type: CmdBuyDevCard}, ErrWrongPhase, ErrMustRoll)

	// Road before settlement.
	reject(t, s, Command{Player: 0, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": roadFor(s, spot)})}, ErrWrongPhase)

	// Settlement on the sea / nonsense vertex.
	reject(t, s, Command{Player: 0, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": board.Vertex{Q: 99, R: 99}})}, ErrBadPlacement)

	// Place a valid settlement, then test road rules.
	step(t, s, Command{Player: 0, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": spot})})
	reject(t, s, Command{Player: 0, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": spot})}, ErrWrongPhase, ErrOccupied)
	// Road that doesn't touch the settlement.
	var far board.Edge
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if !e.Touches(spot) && s.Board.LandEdge(e) {
				far = e
			}
		}
	}
	reject(t, s, Command{Player: 0, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": far})}, ErrBadPlacement)
	// Occupied-spot settlement by the next player (distance rule).
	adj := spot.Neighbors()[0]
	reject(t, s, Command{Player: 0, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": adj})}, ErrWrongPhase, ErrTooClose)
}

// playReady returns a 3p game in the play phase, current player rolled, no
// pending interrupts.
func playReady(t *testing.T, seed uint64) *State {
	t.Helper()
	s, _ := newGame(t, 3, seed)
	runSetup(t, s)
	step(t, s, Command{Player: 0, Type: CmdRollDice})
	settleRoll(t, s, nil)
	return s
}

// TestInvalidPlayCommands fires illegal commands during normal play.
func TestInvalidPlayCommands(t *testing.T) {
	s := playReady(t, 101)

	// Setup commands no longer valid.
	reject(t, s, Command{Player: 0, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": findSettlementSpot(s)})}, ErrWrongPhase)
	reject(t, s, Command{Player: 0, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": anyLandEdge(s)})}, ErrWrongPhase)

	// Wrong player acting.
	reject(t, s, Command{Player: 1, Type: CmdEndTurn}, ErrNotYourTurn, ErrWrongPhase)
	reject(t, s, Command{Player: 9, Type: CmdRollDice}, ErrNotYourTurn)

	// Re-roll.
	reject(t, s, Command{Player: 0, Type: CmdRollDice}, ErrAlreadyRolled)

	// Robber when none pending.
	reject(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": anyOtherHex(s)})}, ErrWrongPhase)
	// Discard when none required.
	reject(t, s, Command{Player: 0, Type: CmdDiscardCards, Data: mustJSON(t, map[string]any{"cards": Hand{}})}, ErrNoDiscardNeeded)

	// Build with no resources.
	s.Players[0].Hand = Hand{}
	reject(t, s, Command{Player: 0, Type: CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": ownExtendEdge(t, s, 0)})}, ErrNoResources)
	reject(t, s, Command{Player: 0, Type: CmdBuyDevCard}, ErrNoResources)

	// Bank trade without the resources to back it.
	s.Players[0].Hand = Hand{board.Wood: 1}
	reject(t, s, Command{Player: 0, Type: CmdBankTrade, Data: mustJSON(t, map[string]any{"give": board.Wood, "get": board.Ore})}, ErrNoResources)

	// City on a non-own or non-settlement vertex.
	reject(t, s, Command{Player: 0, Type: CmdBuildCity, Data: mustJSON(t, map[string]any{"v": findSettlementSpot(s)})}, ErrBadPlacement)

	// Play / unknown.
	reject(t, s, Command{Player: 0, Type: CmdPlayDevCard, Data: mustJSON(t, map[string]any{"card": DevKnight})}, ErrNoSuchCard)
	reject(t, s, Command{Player: 0, Type: "totally_made_up"}, ErrUnknownCommand)
}

// TestInvalidRobberCommands forces a 7 and probes robber rules.
func TestInvalidRobberCommands(t *testing.T) {
	s, _ := newGame(t, 3, 102)
	runSetup(t, s)
	// Force a 7 directly.
	roll := mustEvent(EvDiceRolled, DiceRolledData{Player: 0, D1: 3, D2: 4})
	roll.Seq = s.NextSeq
	if err := Apply(s, roll); err != nil {
		t.Fatal(err)
	}
	if !s.RobberPending {
		t.Fatal("robber not pending")
	}

	// Roll / build / end blocked while robber pending.
	reject(t, s, Command{Player: 0, Type: CmdRollDice}, ErrRobberPending, ErrAlreadyRolled)
	reject(t, s, Command{Player: 0, Type: CmdEndTurn}, ErrRobberPending)

	// Robber to sea / off-board / same hex.
	reject(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": board.Hex{Q: 99, R: 99}})}, ErrBadPlacement)
	reject(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": s.Board.Robber})}, ErrBadPlacement)

	// Robber to a valid hex but naming a victim with no building there.
	target := anyOtherHex(s)
	notThere := PlayerID(-1)
	for p := PlayerID(1); int(p) < len(s.Players); p++ {
		if !robberVictims(s, target, 0)[p] {
			notThere = p
			break
		}
	}
	if notThere >= 0 {
		reject(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": target, "victim": notThere})}, ErrBadVictim)
	}
}

// TestInvalidDiscardCommands forces discards and probes the rules.
func TestInvalidDiscardCommands(t *testing.T) {
	s, _ := newGame(t, 3, 103)
	runSetup(t, s)
	s.Players[1].Hand = Hand{board.Wood: 5, board.Brick: 3} // 8 cards -> discard 4
	roll := mustEvent(EvDiceRolled, DiceRolledData{Player: 0, D1: 3, D2: 4})
	roll.Seq = s.NextSeq
	Apply(s, roll)
	req := mustEvent(EvDiscardsReq, DiscardsReqData{Required: []PlayerDiscard{{Player: 1, Count: 4}}})
	req.Seq = s.NextSeq
	Apply(s, req)

	// Robber blocked until discards resolve.
	reject(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": anyOtherHex(s)})}, ErrDiscardPending)
	// Wrong count.
	reject(t, s, Command{Player: 1, Type: CmdDiscardCards, Data: mustJSON(t, map[string]any{"cards": Hand{board.Wood: 1}})}, ErrBadDiscard)
	reject(t, s, Command{Player: 1, Type: CmdDiscardCards, Data: mustJSON(t, map[string]any{"cards": Hand{board.Wood: 5}})}, ErrBadDiscard)
	// Cards not held.
	reject(t, s, Command{Player: 1, Type: CmdDiscardCards, Data: mustJSON(t, map[string]any{"cards": Hand{board.Ore: 4}})}, ErrBadDiscard)
	// A player who owes nothing can't discard.
	reject(t, s, Command{Player: 2, Type: CmdDiscardCards, Data: mustJSON(t, map[string]any{"cards": Hand{}})}, ErrNoDiscardNeeded)
}

// TestDecideNeverMutates plays random base games and, at every step, runs
// Decide for a battery of legal and garbage commands, asserting the live state
// is never mutated.
func TestDecideNeverMutates(t *testing.T) {
	for seed := range uint64(12) {
		s, log := newGame(t, 3+int(seed%2), seed)
		_ = log
		rng := rand.New(rand.NewPCG(seed, 7))
		for step := 0; s.Phase != PhaseFinished && step < 500; step++ {
			before := deepClone(t, s)
			// Probe a handful of arbitrary commands; none may mutate s.
			for _, cmd := range probeCommands(s, rng) {
				func() {
					defer func() {
						if r := recover(); r != nil {
							t.Fatalf("seed %d: Decide panicked on %s: %v", seed, cmd.Type, r)
						}
					}()
					Decide(s, cmd)
				}()
			}
			if !unchanged(t, before, s) {
				t.Fatalf("seed %d: a probe command mutated the state", seed)
			}
			// Advance the game with a real auto move.
			cmd, ok := AutoCommand(s)
			if !ok {
				break
			}
			evs, err := Decide(s, cmd)
			if err != nil {
				t.Fatalf("seed %d: auto %s: %v", seed, cmd.Type, err)
			}
			for _, e := range evs {
				if err := Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
}

// TestGarbageNeverPanics throws random command types and random JSON at Decide
// over many random states; it must never panic and never mutate.
func TestGarbageNeverPanics(t *testing.T) {
	types := []CommandType{
		CmdPlaceSettlement, CmdPlaceRoad, CmdRollDice, CmdDiscardCards, CmdMoveRobber,
		CmdBuildRoad, CmdBuildSettlement, CmdBuildCity, CmdEndTurn, CmdBankTrade,
		CmdOfferTrade, CmdRespondTrade, CmdExecuteTrade, CmdCancelTrade, CmdBuyDevCard,
		CmdPlayDevCard, "junk", "", "💣",
	}
	for seed := range uint64(8) {
		s, _ := newGame(t, 3, seed+200)
		runSetup(t, s)
		rng := rand.New(rand.NewPCG(seed, 99))
		for range 400 {
			cmd := Command{
				Player: PlayerID(rng.IntN(6) - 1),
				Type:   types[rng.IntN(len(types))],
				Data:   garbageJSON(rng),
			}
			before := deepClone(t, s)
			func() {
				defer func() {
					if r := recover(); r != nil {
						t.Fatalf("seed %d: panic on %q / %s: %v", seed, cmd.Type, cmd.Data, r)
					}
				}()
				Decide(s, cmd)
			}()
			if !unchanged(t, before, s) {
				t.Fatalf("seed %d: garbage command %q mutated state", seed, cmd.Type)
			}
		}
	}
}

// ---- probe helpers ----

func probeCommands(s *State, rng *rand.Rand) []Command {
	hexes := board.HexesInRadius(s.Board.Radius)
	h := hexes[rng.IntN(len(hexes))]
	v := h.Vertices()[rng.IntN(6)]
	e := h.Edges()[rng.IntN(6)]
	p := PlayerID(rng.IntN(4) - 1)
	return []Command{
		{Player: p, Type: CmdBuildSettlement, Data: mustRaw(map[string]any{"v": v})},
		{Player: p, Type: CmdBuildRoad, Data: mustRaw(map[string]any{"e": e})},
		{Player: p, Type: CmdBuildCity, Data: mustRaw(map[string]any{"v": v})},
		{Player: p, Type: CmdMoveRobber, Data: mustRaw(map[string]any{"hex": h, "victim": PlayerID(rng.IntN(3))})},
		{Player: p, Type: CmdRollDice},
		{Player: p, Type: CmdEndTurn},
		{Player: p, Type: CmdBuyDevCard},
		{Player: p, Type: CmdBankTrade, Data: mustRaw(map[string]any{"give": board.Resource(rng.IntN(6)), "get": board.Resource(rng.IntN(6))})},
		{Player: p, Type: CmdPlayDevCard, Data: mustRaw(map[string]any{"card": DevCard(rng.IntN(6))})},
		{Player: p, Type: CmdDiscardCards, Data: mustRaw(map[string]any{"cards": Hand{board.Wood: rng.IntN(4)}})},
	}
}

func garbageJSON(rng *rand.Rand) []byte {
	switch rng.IntN(6) {
	case 0:
		return nil
	case 1:
		return []byte("null")
	case 2:
		return []byte("{")
	case 3:
		return []byte(`{"v":{"q":"notanumber"}}`)
	case 4:
		b := make([]byte, rng.IntN(16))
		for i := range b {
			b[i] = byte(rng.IntN(256))
		}
		return b
	default:
		return []byte(`{"v":{"q":1,"r":2,"side":9},"e":{},"hex":{"q":99,"r":99},"cards":[1,2,3,4,5,6],"give":7,"get":-1}`)
	}
}

func anyLandEdge(s *State) board.Edge {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if s.Board.LandEdge(e) {
				return e
			}
		}
	}
	panic("no land edge")
}

func ownExtendEdge(t *testing.T, s *State, p PlayerID) board.Edge {
	t.Helper()
	for e, owner := range s.Roads {
		if owner != p {
			continue
		}
		for _, v := range []board.Vertex{e.A, e.B} {
			for _, ne := range v.Edges() {
				if _, taken := s.Roads[ne]; !taken && s.Board.LandEdge(ne) {
					return ne
				}
			}
		}
	}
	return anyLandEdge(s)
}

func mustRaw(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
