package game

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// An "auto" seat (a human who left to spectate) must be re-botified when the
// actor is (re)loaded, or the game would stall waiting on a spectating human.
func TestLoadReinstallsBotForAutoSeat(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	if err := st.SetSeatStatus("g1", 1, "auto"); err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, &fakeClock{})
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	defer m.StopAll()

	a, err := m.Get("g1") // triggers load()
	if err != nil {
		t.Fatal(err)
	}
	if !seatIsBot(a, 1) {
		t.Error("auto seat 1 was not re-botified on load")
	}
	if seatIsBot(a, 0) {
		t.Error("active seat 0 must not be bot-controlled")
	}
}

func TestBotControlledSeatRejectsHumanCommand(t *testing.T) {
	a, _, _ := loadForfeitActor(t) // 3-player active game; seats 0,1,2 human
	a.SetSeatBot(0, autoBot{})     // seat 0 handed to a bot (left to spectate)

	// A human-submitted command for the bot-controlled seat must be rejected
	// outright, leaving state untouched.
	if err := a.Do(engine.Command{Player: 0, Type: engine.CmdEndTurn}); !errors.Is(err, ErrSeatBotControlled) {
		t.Fatalf("Do on bot-controlled seat = %v, want ErrSeatBotControlled", err)
	}
	// A command for a seat not under bot control must not be blocked by this
	// guard (it may fail engine validation, but never with
	// ErrSeatBotControlled).
	if err := a.Do(engine.Command{Player: 1, Type: engine.CmdEndTurn}); errors.Is(err, ErrSeatBotControlled) {
		t.Error("non-bot seat 1 wrongly rejected as bot-controlled")
	}
}

// idleExt is a stand-in module extension that reports which of the two Viewable
// methods the view builder asked for.
type idleExt struct{}

func (idleExt) CloneExt() engine.Extension      { return idleExt{} }
func (idleExt) ViewExt(engine.PlayerID) any     { return "acting" }
func (idleExt) ViewExtIdle(engine.PlayerID) any { return "idle" }

// A seat handed to a bot keeps its view (it is still the owner's seat and they
// can take it back) but loses what the view carries for deciding. Do's
// refusal is the backstop; this keeps the controls, and any cards a module
// look revealed to the bot, off the spectating owner's screen.
func TestBotHeldSeatViewWithholdsDecisionData(t *testing.T) {
	a, _, _ := loadForfeitActor(t) // 3-player game, seat 0 to place first
	before := a.View(0)
	if before.Cur != 0 {
		t.Fatalf("fixture moved: seat 0 should open the game, cur=%d", before.Cur)
	}
	if before.Legal == nil || len(before.Legal.Settlements) == 0 {
		t.Fatal("a seat playing its own turn was sent no legal targets")
	}
	a.call(func() { a.state.Ext = map[string]engine.Extension{"x": idleExt{}} })
	if got := a.View(0).Ext["x"]; got != "acting" {
		t.Errorf("module view for a seat's own player = %v, want the acting one", got)
	}

	// Hand the seat to a bot without letting it move (SetSeatBot would run
	// it), so only who is playing differs between the two views.
	a.call(func() { a.botSeats[0] = autoBot{} })

	after := a.View(0)
	if after.Legal != nil {
		t.Error("bot-held seat was sent legal targets")
	}
	if got := after.Ext["x"]; got != "idle" {
		t.Errorf("module view for a bot-held seat = %v, want the idle one", got)
	}
	// Still their seat, and still the same table.
	if after.Viewer != 0 {
		t.Errorf("viewer = %d, want the seat they still hold", after.Viewer)
	}
	if len(after.Players) != len(before.Players) {
		t.Errorf("players = %d, want %d: only decision data is withheld", len(after.Players), len(before.Players))
	}

	// An untouched seat is unaffected.
	if v := a.View(1); v.Ext["x"] != "acting" {
		t.Errorf("seat 1's module view = %v, want the acting one", v.Ext["x"])
	}
}
