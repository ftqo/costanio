package bot

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/raiders"
)

// A seat that conquest has shut out of every build must still work toward the
// scenario card, its only way back (riders, then battles). Covers both
// raidersSaveForCard (Strong) and the Raiders branch of simpleBankDig.
//
// The position is constructed: a real game past setup, every coastal hex
// saturated, and the seat on turn given gold and a surplus the card does not
// need.
func lockedRaidersState(t *testing.T) (*engine.State, engine.PlayerID) {
	t.Helper()
	rs := engine.CanonicalRuleset("base+cak+islands+raiders")
	evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: rs}, engine.SeedsFrom(6))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	b := NewStrong()
	for range 4000 {
		if s.Phase == engine.PhasePlay && s.Rolled && !s.RobberPending && len(s.PendingDiscards) == 0 &&
			engine.RequireActionableTurn(s, s.Cur) == nil {
			if x, _ := raiders.StateExt(s); x.Pend.Kind == raiders.PendNone && len(x.PathQueue) == 0 {
				break
			}
		}
		seat := s.Cur
		cmd, ok := b.Act(s, seat)
		if !ok {
			if cmd, ok = engine.AutoCommand(s); !ok {
				t.Fatal("no command")
			}
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("%s: %v", cmd.Type, err)
		}
		for _, e := range out {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	if s.Phase != engine.PhasePlay || !s.Rolled {
		t.Fatal("never reached a rolled turn")
	}
	x, _ := raiders.StateExt(s)
	for i := range x.RaiderCount {
		x.RaiderCount[i] = 3 // the whole coast conquered
	}
	seat := s.Cur
	if len(s.LegalSettlements(seat)) > 0 || len(s.LegalCities(seat)) > 0 {
		t.Fatalf("seat %d is not locked out: %d settlements, %d cities", seat,
			len(s.LegalSettlements(seat)), len(s.LegalCities(seat)))
	}
	s.Players[seat].Hand = engine.Hand{board.Brick: 5}
	x.Gold[seat] = 0
	x.Buys = 0
	return s, seat
}

func resOf(t *testing.T, cmd engine.Command) board.Resource {
	t.Helper()
	var d struct {
		Res board.Resource `json:"res"`
	}
	if err := json.Unmarshal(cmd.Data, &d); err != nil {
		t.Fatal(err)
	}
	return d.Res
}

func TestStrongLockedSeatSpendsGold(t *testing.T) {
	s, seat := lockedRaidersState(t)
	x, _ := raiders.StateExt(s)
	x.Gold[seat] = 10
	cmd, ok := NewStrong().raidersBuild(s, seat)
	if !ok || cmd.Type != raiders.CmdBuyResource {
		t.Fatalf("locked seat with 10 gold: got %v %s, want a gold purchase", ok, cmd.Type)
	}
	if r := resOf(t, cmd); engine.CostDevCard[r] == 0 {
		t.Fatalf("bought %v, which the card does not need", r)
	}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		t.Fatalf("proposed an illegal purchase: %v", err)
	}
}

func TestStrongLockedSeatTradesTowardARider(t *testing.T) {
	s, seat := lockedRaidersState(t)
	cmd, ok := NewStrong().raidersBuild(s, seat)
	if !ok || cmd.Type != engine.CmdBankTrade {
		t.Fatalf("locked seat holding five brick: got %v %s, want a bank trade", ok, cmd.Type)
	}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		t.Fatalf("proposed an illegal trade: %v", err)
	}
}

func TestSimpleLockedSeatTradesTowardARider(t *testing.T) {
	s, seat := lockedRaidersState(t)
	cmd, ok := simpleBankDig(s, seat)
	if !ok || cmd.Type != engine.CmdBankTrade {
		t.Fatalf("locked seat holding five brick: got %v %s, want a bank trade", ok, cmd.Type)
	}
	var d struct {
		Get board.Resource `json:"get"`
	}
	_ = json.Unmarshal(cmd.Data, &d)
	if engine.CostDevCard[d.Get] == 0 {
		t.Fatalf("traded for %v, which the card does not need", d.Get)
	}
}

func TestSimpleSpendsGoldOnWhatTheCardLacks(t *testing.T) {
	s, seat := lockedRaidersState(t)
	x, _ := raiders.StateExt(s)
	x.Gold[seat] = 10
	cmd, ok := simpleRaidersPlay(s, seat)
	if !ok || cmd.Type != raiders.CmdBuyResource {
		t.Fatalf("got %v %s, want a gold purchase", ok, cmd.Type)
	}
	if r := resOf(t, cmd); engine.CostDevCard[r] == 0 {
		t.Fatalf("bought %v, which the card does not need", r)
	}
}
