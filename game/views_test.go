package game

import (
	"encoding/json"
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// vpTestModule grants a fixed 3 module VP to seat 0 via VictoryCheck so the
// view's VP fields can be checked against the win-check total. Registered once
// under the "vptest" ruleset name.
type vpTestModule struct{}

func (vpTestModule) Name() string                                           { return "vptest" }
func (vpTestModule) SetupBoard(*board.Board, engine.GameConfig, *rand.Rand) {}
func (vpTestModule) Decide(*engine.State, engine.Command) ([]engine.Event, bool, error) {
	return nil, false, nil
}
func (vpTestModule) Apply(*engine.State, engine.Event) (bool, error) { return false, nil }
func (vpTestModule) Hooks() engine.Hooks {
	return engine.Hooks{
		VictoryCheck: func(_ *engine.State, p engine.PlayerID) int {
			if p == 0 {
				return 3
			}
			return 0
		},
	}
}

func init() { engine.RegisterModule("vptest", func() engine.Module { return vpTestModule{} }) }

// TestFullViewVPIncludesModuleVP: the view's VP includes module VictoryCheck
// contributions, matching the win check, so no one wins at a score the view
// never showed.
func TestFullViewVPIncludesModuleVP(t *testing.T) {
	cfg := engine.GameConfig{Players: 3, Ruleset: "base+vptest"}
	events, err := engine.New(cfg, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	// Give seat 0 a hidden VP dev card so own-VP also exercises VPWithModules.
	s.Players[0].DevCards = engine.DevHand{engine.DevVictoryPoint: 1}

	// Sanity: module and dev VP must make the engine totals differ from plain
	// PublicVP/VP, or the test proves nothing.
	if s.PublicVPWithModules(0) == s.PublicVP(0) {
		t.Fatal("test module grants no public module VP")
	}
	if s.VPWithModules(0) == s.VP(0) {
		t.Fatal("test grants no extra own VP")
	}

	// Spectator view: public VP must equal the win-check public total.
	spec := NewFullView(s, Spectator)
	for i := range s.Players {
		want := s.PublicVPWithModules(engine.PlayerID(i))
		if spec.Players[i].VP != want {
			t.Errorf("spectator player %d VP = %d, want %d (win-check public total)",
				i, spec.Players[i].VP, want)
		}
	}

	// Seat 0's own view: VP must equal the full win-check total (incl. hidden
	// dev VP and module VP).
	own := NewFullView(s, 0)
	if got, want := own.Players[0].VP, s.VPWithModules(0); got != want {
		t.Errorf("own VP = %d, want %d (full win-check total)", got, want)
	}
}

// TestFullViewPublicVP: the client needs public VP for its own seat to
// evaluate public-standing rules (Master Merchant, Wedding, Saboteur). `vp` is
// full for your own seat, so comparing it against opponents' public totals
// would drop legal Master Merchant victims when you hold a VP card.
//
// `public_vp` must be the public total on every row, viewer included, and be
// present in the JSON for every viewer (no omitempty; zero is a real score).
func TestFullViewPublicVP(t *testing.T) {
	cfg := engine.GameConfig{Players: 3, Ruleset: "base+vptest"}
	events, err := engine.New(cfg, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	// Two hidden VP cards on seat 0, one bought this turn and one not, so the
	// own-seat `vp` is inflated relative to the public total.
	s.Players[0].DevCards = engine.DevHand{engine.DevVictoryPoint: 1}
	s.Players[0].NewDevCards = engine.DevHand{engine.DevVictoryPoint: 1}

	for _, tc := range []struct {
		name   string
		viewer engine.PlayerID
	}{
		{"spectator", Spectator},
		{"own seat holding hidden VP", 0},
		{"opponent of the hidden-VP holder", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := NewFullView(s, tc.viewer)
			for i := range s.Players {
				seat := engine.PlayerID(i)
				want := s.PublicVPWithModules(seat)
				if got := v.Players[i].PublicVP; got != want {
					t.Errorf("player %d public_vp = %d, want %d", i, got, want)
				}
			}
			// Comparing `public_vp` must give the same answer as the engine's
			// public-vs-public comparison.
			for i := range s.Players {
				for j := range s.Players {
					wire := v.Players[i].PublicVP > v.Players[j].PublicVP
					eng := s.PublicVPWithModules(engine.PlayerID(i)) > s.PublicVPWithModules(engine.PlayerID(j))
					if wire != eng {
						t.Errorf("public_vp comparison %d>%d = %v, engine says %v", i, j, wire, eng)
					}
				}
			}
		})
	}

	// On the viewer's own row the two fields differ, and only there.
	own := NewFullView(s, 0)
	if own.Players[0].VP == own.Players[0].PublicVP {
		t.Fatalf("own vp %d == public_vp %d, want them to differ",
			own.Players[0].VP, own.Players[0].PublicVP)
	}
	for i := 1; i < len(own.Players); i++ {
		if own.Players[i].VP != own.Players[i].PublicVP {
			t.Errorf("opponent %d: vp %d != public_vp %d",
				i, own.Players[i].VP, own.Players[i].PublicVP)
		}
	}

	// Present on the wire for every viewer, zero or not.
	b, err := json.Marshal(own.Players[1])
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["public_vp"]; !ok {
		t.Errorf("public_vp missing from marshaled PlayerView: %s", b)
	}
}

// TestFullViewDoesNotAliasMutableState: NewFullView must copy the State's
// mutable references (Board, ActiveOffer, PendingDiscards), because the view
// is serialized by the WS/HTTP handlers while the actor keeps mutating state.
// The race is not reproducible deterministically, so assert that mutating the
// source after building the view does not change the view.
func TestFullViewDoesNotAliasMutableState(t *testing.T) {
	cfg := engine.GameConfig{Players: 3}
	events, err := engine.New(cfg, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	// Seed the three mutable fields.
	s.Board.Robber = board.Hex{Q: 1, R: 1}
	s.PendingDiscards = map[engine.PlayerID]int{1: 2, 2: 3}
	s.ActiveOffer = &engine.TradeOffer{
		By:       0,
		Accepted: []engine.PlayerID{1},
		Declined: []engine.PlayerID{2},
		Counters: nil,
	}

	v := NewFullView(s, Spectator)

	// Distinct backing objects.
	if v.Board == s.Board {
		t.Error("view.Board aliases the live state board")
	}
	if v.ActiveOffer == s.ActiveOffer {
		t.Error("view.ActiveOffer aliases the live state offer")
	}

	// Mutate the source as engine.Apply does; the view built before must be
	// unaffected.
	s.Board.Robber = board.Hex{Q: 9, R: 9}
	s.ActiveOffer.Accepted[0] = 99
	s.ActiveOffer.Accepted = append(s.ActiveOffer.Accepted, 2)
	delete(s.PendingDiscards, 1)
	s.PendingDiscards[2] = 100

	if v.Board.Robber != (board.Hex{Q: 1, R: 1}) {
		t.Errorf("view robber changed with the source: %+v", v.Board.Robber)
	}
	if len(v.ActiveOffer.Accepted) != 1 || v.ActiveOffer.Accepted[0] != 1 {
		t.Errorf("view offer Accepted changed with the source: %+v", v.ActiveOffer.Accepted)
	}
	if v.PendingDiscards[1] != 2 || v.PendingDiscards[2] != 3 {
		t.Errorf("view PendingDiscards changed with the source: %+v", v.PendingDiscards)
	}
}

func stealEvent(t *testing.T) engine.Event {
	t.Helper()
	data, _ := json.Marshal(engine.CardStolenData{Thief: 0, Victim: 1, Res: board.Ore})
	return engine.Event{Seq: 9, Type: engine.EvCardStolen, Data: data, Visible: []engine.PlayerID{0, 1}}
}

func TestRedactEventHidesStolenCard(t *testing.T) {
	e := stealEvent(t)

	for _, viewer := range []engine.PlayerID{0, 1} {
		got := RedactEvent(e, viewer)
		var d engine.CardStolenData
		json.Unmarshal(got.Data, &d)
		if d.Res != board.Ore {
			t.Errorf("viewer %d should see the card, got %+v", viewer, d)
		}
	}

	for _, viewer := range []engine.PlayerID{2, Spectator} {
		got := RedactEvent(e, viewer)
		var raw map[string]any
		json.Unmarshal(got.Data, &raw)
		if _, leaked := raw["res"]; leaked {
			t.Errorf("viewer %d sees the stolen card: %s", viewer, got.Data)
		}
		if raw["thief"] != float64(0) || raw["victim"] != float64(1) {
			t.Errorf("steal fact should stay public: %s", got.Data)
		}
	}
}

func TestRedactGameCreatedHidesSeed(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 3}, engine.SeedsFrom(777))
	if err != nil {
		t.Fatal(err)
	}
	for _, viewer := range []engine.PlayerID{0, 1, Spectator} {
		got := RedactEvent(events[0], viewer)
		var raw map[string]any
		json.Unmarshal(got.Data, &raw)
		// Neither seed. The public one would predict every remaining roll and
		// the fair-dice deck; the private one exposes draws and steals.
		for _, key := range []string{"seed", "public_seed"} {
			if _, leaked := raw[key]; leaked {
				t.Fatalf("viewer %d sees %s: %s", viewer, key, got.Data)
			}
		}
		if raw["seed_commit"] == nil || raw["config"] == nil {
			t.Errorf("commitment/config missing for viewer %d: %s", viewer, got.Data)
		}
		if raw["public_seed_commit"] == nil {
			t.Errorf("public commitment missing for viewer %d: %s", viewer, got.Data)
		}
	}
}

func TestRedactPublicEventUntouched(t *testing.T) {
	data, _ := json.Marshal(engine.DiceRolledData{Player: 0, D1: 3, D2: 4})
	e := engine.Event{Seq: 5, Type: engine.EvDiceRolled, Data: data}
	got := RedactEvent(e, Spectator)
	if string(got.Data) != string(data) {
		t.Errorf("public event modified: %s", got.Data)
	}
}

func TestFullViewHidesOtherHands(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 3}, engine.SeedsFrom(5))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	s.Players[0].Hand = engine.Hand{board.Wood: 2}
	s.Players[1].Hand = engine.Hand{board.Ore: 1}

	v := NewFullView(s, 0)
	if v.Players[0].Hand == nil || (*v.Players[0].Hand)[board.Wood] != 2 {
		t.Error("own hand missing from view")
	}
	if v.Players[1].Hand != nil {
		t.Error("opponent hand leaked")
	}
	if v.Players[1].HandCount != 1 {
		t.Errorf("opponent hand count = %d", v.Players[1].HandCount)
	}

	spec := NewFullView(s, Spectator)
	for i, p := range spec.Players {
		if p.Hand != nil {
			t.Errorf("spectator sees hand of player %d", i)
		}
	}

	// Views must serialize (frontend contract).
	if _, err := json.Marshal(v); err != nil {
		t.Errorf("view marshal: %v", err)
	}
}

// revealTestModule exposes seat 1's full resource hand to viewer 0 only, via the
// RevealHands hook (the mechanism Knights Master Merchant rides for its look).
type revealTestModule struct{}

func (revealTestModule) Name() string                                           { return "revealtest" }
func (revealTestModule) SetupBoard(*board.Board, engine.GameConfig, *rand.Rand) {}
func (revealTestModule) Decide(*engine.State, engine.Command) ([]engine.Event, bool, error) {
	return nil, false, nil
}
func (revealTestModule) Apply(*engine.State, engine.Event) (bool, error) { return false, nil }
func (revealTestModule) Hooks() engine.Hooks {
	return engine.Hooks{
		RevealHands: func(_ *engine.State, viewer engine.PlayerID) []engine.PlayerID {
			if viewer == 0 {
				return []engine.PlayerID{1}
			}
			return nil
		},
	}
}

func init() { engine.RegisterModule("revealtest", func() engine.Module { return revealTestModule{} }) }

// TestFullViewRevealHands: a module's RevealHands hook exposes another seat's
// resource hand to a specific viewer (Master Merchant look), and to no one else.
func TestFullViewRevealHands(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+revealtest"}, engine.SeedsFrom(5))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	s.Players[1].Hand = engine.Hand{board.Ore: 2, board.Wheat: 1}

	// Viewer 0 sees seat 1's revealed resource breakdown.
	v0 := NewFullView(s, 0)
	if v0.Players[1].Hand == nil || (*v0.Players[1].Hand)[board.Ore] != 2 || (*v0.Players[1].Hand)[board.Wheat] != 1 {
		t.Errorf("thief should see the revealed hand, got %+v", v0.Players[1].Hand)
	}

	// Seat 2 (not the thief) must not see it, nor a spectator.
	if v2 := NewFullView(s, 2); v2.Players[1].Hand != nil {
		t.Error("non-thief leaked the revealed hand")
	}
	if spec := NewFullView(s, Spectator); spec.Players[1].Hand != nil {
		t.Error("spectator leaked the revealed hand")
	}
}
