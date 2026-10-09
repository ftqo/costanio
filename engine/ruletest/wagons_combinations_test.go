package ruletest

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/engine/wagons"
)

func applyWagonCommand(t *testing.T, s *engine.State, cmd engine.Command) {
	t.Helper()
	evs, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatal(err)
	}
	for _, ev := range evs {
		if err := engine.Apply(s, ev); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTwoFishBoostSharesGrainLimit(t *testing.T) {
	for _, first := range []string{"fish", "grain"} {
		t.Run(first, func(t *testing.T) {
			s := wagonPlayState(t, "base+fishermen+wagons")
			s.Rolled = true
			p := s.Cur
			x := s.Ext[wagons.WagonsName].(*wagons.WagonsExt)
			giveFish(t, s, p, 4)
			s.Players[p].Hand = engine.Hand{board.Wheat: 1}
			fish := engine.Command{Player: p, Type: scenarios.CmdSpendFish, Data: rawCmd(map[string]any{"use": scenarios.FishWagonBoost})}
			grain := engine.Command{Player: p, Type: wagons.CmdBoost}
			if first == "fish" {
				applyWagonCommand(t, s, fish)
				if fishHeld(t, s, p) != 2 || s.Players[p].Hand[board.Wheat] != 1 {
					t.Fatal("fish boost charged the wrong currency")
				}
			} else {
				applyWagonCommand(t, s, grain)
			}
			if !x.Boosted || !x.MoveOpen || x.MP != 6 {
				t.Fatalf("boost did not open six MP: %+v", x)
			}
			for _, cmd := range []engine.Command{fish, grain} {
				beforeHand, beforeFish := s.Players[p].Hand, fishHeld(t, s, p)
				if _, err := engine.Decide(s, cmd); err == nil {
					t.Fatal("second boost accepted")
				}
				if beforeHand != s.Players[p].Hand || beforeFish != fishHeld(t, s, p) {
					t.Fatal("refusal charged currency")
				}
			}
		})
	}
}

func TestFishBoostRefusesUnavailableMovement(t *testing.T) {
	for _, ruleset := range []string{"base+fishermen", "base+fishermen+wagons"} {
		s := wagonPlayState(t, ruleset)
		s.Rolled = true
		p := s.Cur
		giveFish(t, s, p, 2)
		if x, ok := s.Ext[wagons.WagonsName].(*wagons.WagonsExt); ok {
			x.MoveDone = true
		}
		if _, err := engine.Decide(s, engine.Command{Player: p, Type: scenarios.CmdSpendFish, Data: rawCmd(map[string]any{"use": scenarios.FishWagonBoost})}); err == nil {
			t.Fatal("unavailable movement sold")
		}
		if fishHeld(t, s, p) != 2 {
			t.Fatal("refusal spent fish")
		}
	}
}

func TestKnightChasesPathBarbarianEarly(t *testing.T) {
	s := wagonPlayState(t, "base+cak+wagons")
	s.Rolled = true
	p := s.Cur
	wx := s.Ext[wagons.WagonsName].(*wagons.WagonsExt)
	cx := s.Ext[knights.Name].(*knights.Ext)
	v := wx.Barb[0].A
	delete(s.Buildings, v)
	cx.Knights[v] = knights.Knight{Owner: p, Level: 1, Active: true}
	cx.Attacks = 0
	cmd := engine.Command{Player: p, Type: knights.CmdChaseRobber, Data: rawCmd(map[string]any{"v": v, "barb": 0})}
	for _, k := range []knights.Knight{{Owner: p, Level: 1}, {Owner: p, Level: 1, Active: true, FreshlyActivated: true}, {Owner: (p + 1) % 4, Level: 1, Active: true}} {
		cx.Knights[v] = k
		if _, err := engine.Decide(s, cmd); err == nil {
			t.Fatal("ineligible knight chased barbarian")
		}
	}
	cx.Knights[v] = knights.Knight{Owner: p, Level: 1, Active: true}
	offered := false
	for _, c := range s.LegalTargetsFor(p).KnightEdgeChases {
		if c.V == v && c.Barb == 0 {
			offered = true
		}
	}
	if !offered {
		t.Fatal("legal knight chase not offered")
	}
	applyWagonCommand(t, s, cmd)
	if cx.Knights[v].Active || wx.BarbSeat != p || wx.BarbIdx != 0 || !wx.BarbSteal {
		t.Fatal("chase did not deactivate knight and open relocation")
	}
	homes := s.LegalTargetsFor(p).BarbarianEdges
	if len(homes) == 0 {
		t.Fatal("relocation has no destinations")
	}
	e := homes[0]
	victim := (p + 1) % 4
	s.Roads[e] = victim
	s.Players[victim].Hand = engine.Hand{}
	cx.Players[victim].Commodities = knights.CommodityHand{knights.Cloth: 1}
	before := cx.Players[p].Commodities[knights.Cloth]
	applyWagonCommand(t, s, engine.Command{Player: p, Type: wagons.CmdBarbarian, Data: rawCmd(map[string]any{"barb": 0, "e": e})})
	if wx.Barb[0] != e || wx.BarbSeat != engine.NoPlayer {
		t.Fatal("barbarian relocation did not finish")
	}
	if cx.Players[victim].Commodities.Count() != 0 || cx.Players[p].Commodities[knights.Cloth] != before+1 {
		t.Fatal("chase did not steal the commodity-only hand")
	}
}

func wagonPlayState(t *testing.T, ruleset string) *engine.State {
	t.Helper()
	s := playState(t, ruleset, 4)
	if _, ok := s.Ext[wagons.WagonsName]; ok {
		for _, ev := range (wagons.Wagons{}).Hooks().OnEvents(s, nil) {
			ev.Seq = s.NextSeq
			if err := engine.Apply(s, ev); err != nil {
				t.Fatal(err)
			}
		}
	}
	return s
}

func TestRaidersWagonsShareConquestAndPathBlockers(t *testing.T) {
	s := wagonPlayState(t, "base+raiders+wagons")
	s.Rolled = true
	p := s.Cur
	rx := s.Ext[raiders.Name].(*raiders.Ext)
	wx := s.Ext[wagons.WagonsName].(*wagons.WagonsExt)
	if !rx.Shared || len(rx.PathFigures) != 2 || rx.RaidersOnBoard() != 2 || len(wagons.PathBarbarians(s)) != 0 {
		t.Fatalf("wrong combined setup: %+v", rx.PathFigures)
	}
	for _, r := range rx.PathFigures {
		if r.Hex == rx.Castle || r.OnPath {
			t.Fatal("initial raider occupies castle or path")
		}
	}
	// A new arrival on a trade hex must choose among its seven paths. Its
	// interior spokes cost the same extra two MP as an outer path.
	h := rx.PathFigures[0].Hex
	paths := engine.RaiderGeometry(s).RaiderPaths(s, h)
	if len(paths) != 7 {
		t.Fatalf("trade hex has %d paths, want seven", len(paths))
	}
	fold := func(kind engine.EventType, data any) {
		t.Helper()
		ev := engine.NewEvent(kind, data)
		ev.Seq = s.NextSeq
		if err := engine.Apply(s, ev); err != nil {
			t.Fatal(err)
		}
	}
	fold(raiders.EvTreason, map[string]any{"player": p, "moves": []any{map[string]any{"to": h}}})
	if len(rx.PathQueue) != 1 {
		t.Fatal("arrival did not offer path assignment")
	}
	var spoke board.Edge
	for _, e := range rx.PathEdges {
		if e.A.Side == 2 || e.B.Side == 2 {
			spoke = e
			break
		}
	}
	if spoke == (board.Edge{}) {
		t.Fatal("no interior path offered")
	}
	id := rx.PathQueue[0]
	applyWagonCommand(t, s, engine.Command{Player: p, Type: raiders.CmdPickPath, Data: rawCmd(map[string]any{"e": spoke})})
	if got := wagons.PathBarbarians(s)[id]; got != spoke {
		t.Fatal("assigned raider did not block wagon graph")
	}
	from, to := spoke.A, spoke.B
	if from.Side == 2 {
		from, to = to, from
	}
	wx.Wagon[p], wx.OnBoard[p], wx.MoveDone, wx.MoveOpen, wx.MP = from, true, false, false, 0
	wx.Level[p] = 1
	for _, st := range wagons.StepsFrom(s, p, from) {
		if st.To == to && st.MP != 4 {
			t.Fatalf("blocked spoke costs %d, want four", st.MP)
		}
	}
	// Capturing all figures on this hex clears the blocker and conquest together.
	fold(raiders.EvBattle, map[string]any{"hex": h})
	if rx.RaidersOn(h) != 0 || len(wagons.PathBarbarians(s)) != 0 {
		t.Fatal("capture left a phantom path blocker")
	}
	for _, st := range wagons.StepsFrom(s, p, from) {
		if st.To == to && st.MP != 2 {
			t.Fatalf("cleared spoke costs %d, want two", st.MP)
		}
	}
	if got := (wagons.Wagons{}).Hooks().OnSeven(s); len(got) != 0 {
		t.Fatal("combined seven opened an independent barbarian move")
	}
}

func TestRaidersWagonsRelocationMovesOwnership(t *testing.T) {
	s := wagonPlayState(t, "base+raiders+wagons")
	s.Rolled = true
	p := s.Cur
	rx := s.Ext[raiders.Name].(*raiders.Ext)
	wx := s.Ext[wagons.WagonsName].(*wagons.WagonsExt)
	from := rx.Coast[0]
	path := engine.RaiderGeometry(s).RaiderPaths(s, from)[0]
	rx.PathFigures = []engine.PathRaider{{Hex: from, Edge: path, Alive: true, OnPath: true}}
	for i := range rx.RaiderCount {
		rx.RaiderCount[i] = 0
	}
	rx.RaiderCount[0] = 1
	var to board.Hex
	var edge board.Edge
	for _, h := range rx.Land {
		if h != rx.Castle && h != from && !slices.Contains(rx.Coast, h) {
			to = h
			edge = engine.RaiderGeometry(s).RaiderPaths(s, h)[0]
			break
		}
	}
	if edge == (board.Edge{}) {
		t.Fatal("no interior destination")
	}
	wx.BarbSeat, wx.BarbIdx = p, 0
	applyWagonCommand(t, s, engine.Command{Player: p, Type: wagons.CmdBarbarian, Data: rawCmd(map[string]any{"barb": 0, "e": edge, "hex": to})})
	if rx.RaidersOn(from) != 0 || rx.RaidersOn(to) != 1 || wx.BarbSeat != engine.NoPlayer {
		t.Fatal("relocation did not transfer the shared figure")
	}
}

func TestRaidersWagonsRareRollLandsOneFigure(t *testing.T) {
	for _, n := range []int{2, 12} {
		s := wagonPlayState(t, "base+raiders+wagons")
		rx := s.Ext[raiders.Name].(*raiders.Ext)
		for _, h := range rx.Coast {
			tile := s.Board.Tiles[h]
			tile.Number = 5
			s.Board.Tiles[h] = tile
		}
		h := rx.Coast[0]
		tile := s.Board.Tiles[h]
		tile.Number = n
		s.Board.Tiles[h] = tile
		before := rx.RaidersOnBoard()
		dice := engine.NewEvent(engine.EvDiceRolled, engine.DiceRolledData{D1: n / 2, D2: n / 2})
		events := (raiders.Module{}).Hooks().OnEvents(s, []engine.Event{dice})
		for _, ev := range events {
			ev.Seq = s.NextSeq
			if err := engine.Apply(s, ev); err != nil {
				t.Fatal(err)
			}
		}
		if rx.RaidersOnBoard() != before+1 || len(rx.PathQueue) != 1 {
			t.Fatalf("roll %d did not land exactly one assigned-path figure", n)
		}
	}
}

func TestConqueredTradeHexStillExchangesCargo(t *testing.T) {
	s := wagonPlayState(t, "base+raiders+wagons")
	s.Rolled = true
	p := s.Cur
	rx := s.Ext[raiders.Name].(*raiders.Ext)
	wx := s.Ext[wagons.WagonsName].(*wagons.WagonsExt)
	h := wx.Trade[0]
	rx.PathFigures = []engine.PathRaider{{Hex: h, Alive: true}, {Hex: h, Alive: true}, {Hex: h, Alive: true}}
	if !rx.Conquered(h) {
		t.Fatal("fixture is not conquered")
	}
	var spoke board.Edge
	for _, e := range engine.RaiderGeometry(s).RaiderPaths(s, h) {
		if e.A.Side == 2 || e.B.Side == 2 {
			spoke = e
			break
		}
	}
	from, to := spoke.A, spoke.B
	if from.Side == 2 {
		from, to = to, from
	}
	wx.Wagon[p], wx.OnBoard[p], wx.MoveOpen, wx.MoveDone, wx.MP = from, true, true, false, 10
	wx.Cargo[p] = map[uint8]uint8{wagons.RoleCastle: wagons.CargoMarble, wagons.RoleQuarry: wagons.CargoTools, wagons.RoleGlassworks: wagons.CargoSand}[wx.Roles[0]]
	before := wx.Landed[p]
	applyWagonCommand(t, s, engine.Command{Player: p, Type: wagons.CmdMove, Data: rawCmd(map[string]any{"to": to})})
	if wx.Landed[p] != before+1 || wx.Cargo[p] == wagons.CargoNone || !wx.MoveDone || !rx.Conquered(h) {
		t.Fatal("conquest prevented delivery or the next cargo pickup")
	}
}

func TestRaidersWagonsShipFaceStacksWithRareRoll(t *testing.T) {
	s := wagonPlayState(t, "base+cak+raiders+wagons")
	rx := s.Ext[raiders.Name].(*raiders.Ext)
	for _, h := range rx.Coast {
		tile := s.Board.Tiles[h]
		tile.Number = 5
		s.Board.Tiles[h] = tile
	}
	h := rx.Coast[0]
	tile := s.Board.Tiles[h]
	tile.Number = 2
	s.Board.Tiles[h] = tile
	before := rx.RaidersOnBoard()
	events := (raiders.Module{}).Hooks().OnEvents(s, []engine.Event{
		engine.NewEvent(engine.EvDiceRolled, engine.DiceRolledData{D1: 1, D2: 1}),
		engine.NewEvent("cak_event_die", map[string]any{"face": "ship"}),
	})
	for _, ev := range events {
		ev.Seq = s.NextSeq
		if err := engine.Apply(s, ev); err != nil {
			t.Fatal(err)
		}
	}
	if rx.RaidersOnBoard() != before+2 {
		t.Fatal("one independent landing trigger erased the other")
	}
}

func TestRaidersWagonsHasNoSwiftJourneyDeck(t *testing.T) {
	s := wagonPlayState(t, "base+raiders+wagons")
	x := s.Ext[wagons.WagonsName].(*wagons.WagonsExt)
	if x.SwiftLeft != 0 {
		t.Fatalf("unused Swift Journey supply = %d, want 0", x.SwiftLeft)
	}
}
