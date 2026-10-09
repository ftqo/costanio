package rivers

import (
	"bytes"
	"encoding/gob"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// The rules bullets of docs/rules/rivers.md's Engine conformance list. State is
// constructed, never found by seed hunting.

// rig is a dealt Rivers game moved into the play phase, with a chosen bridge
// site and one seat planted beside it.
type rig struct {
	s    *engine.State
	x    *Ext
	site board.Edge
	seat engine.PlayerID
}

// newRig deals a real board (so the chains are real), clears the draft and stands
// seat 0 at one end of the first river's first bridge site, holding hand.
func newRig(t *testing.T, ruleset string, hand engine.Hand) *rig {
	t.Helper()
	s, _ := newGame(t, ruleset, 3, 4)
	x, ok := StateExt(s)
	if !ok || len(x.Rivers) == 0 {
		t.Fatal("no rivers on a rivers board")
	}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	s.Players[0].Hand = hand
	site := x.Rivers[0].Sites[0]
	// A building of our own at one end of the site, so the bridge connects.
	s.Buildings[site.A] = engine.Building{Owner: 0}
	r := &rig{s: s, x: x, site: site, seat: 0}
	// The planted building bypassed the event fold, so settle the ledger
	// once here; each test then sees only the coins it measures.
	settle(t, s)
	return r
}

// build issues a command and returns the error, applying the events when there
// is none.
func (r *rig) build(t *testing.T, cmd engine.Command) error {
	t.Helper()
	evs, err := engine.Decide(r.s, cmd)
	if err != nil {
		return err
	}
	for _, e := range evs {
		if err := engine.Apply(r.s, e); err != nil {
			t.Fatalf("apply %v: %v", e.Type, err)
		}
	}
	return nil
}

func bridgeCmd(seat engine.PlayerID, e board.Edge) engine.Command {
	return engine.Command{Player: seat, Type: CmdBuildBridge, Data: raw(map[string]any{"e": e})}
}

func roadCmd(seat engine.PlayerID, e board.Edge) engine.Command {
	return engine.Command{Player: seat, Type: engine.CmdBuildRoad, Data: raw(map[string]any{"e": e})}
}

// --- setup -----------------------------------------------------------------

// TestEveryPlayerStartsWithPoorestTile: "Every player begins holding
// a Poorest Settler tile, because every player begins with 0 coins and is
// therefore tied for the fewest."
func TestEveryPlayerStartsWithPoorestTile(t *testing.T) {
	for _, players := range []int{2, 4, 6} {
		s, _ := newGame(t, "base+rivers", players, 3)
		x, _ := StateExt(s)
		if len(x.Poorest) != players {
			t.Fatalf("%d seats, %d poorest flags", players, len(x.Poorest))
		}
		for p, poor := range x.Poorest {
			if !poor {
				t.Fatalf("%d players: seat %d does not start with a Poorest Settler tile", players, p)
			}
			if x.Coins[p] != 0 {
				t.Fatalf("seat %d starts with %d coins", p, x.Coins[p])
			}
		}
		if x.Wealthiest != engine.NoPlayer {
			t.Fatalf("somebody starts as the wealthiest settler: %d", x.Wealthiest)
		}
	}
}

// TestSetupPaysOneCoinPerPiece is the setup coin rule and the "per piece, not
// per adjacent river hex" ruling together, checked over whole drafts: after
// setup, every seat's coins are exactly its pieces standing on the river, one
// each, however many river hexes any of them happens to touch.
func TestSetupPaysOneCoinPerPiece(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+cak+rivers"} {
		for _, players := range []int{2, 3, 4} {
			for seed := range uint64(6) {
				s := playState(t, rs, players, seed)
				x, _ := StateExt(s)
				want := make([]int, players)
				for v, b := range s.Buildings {
					if x.IsRiverVertex(v) {
						want[b.Owner]++ // one per piece, whatever it touches
					}
				}
				for e, owner := range s.Roads {
					if x.IsRiverEdge(e) {
						want[owner]++
					}
				}
				for p := range want {
					if x.Coins[p] != want[p] {
						t.Fatalf("%s %dp seed %d: seat %d holds %d coins after setup, want %d",
							rs, players, seed, p, x.Coins[p], want[p])
					}
				}
			}
		}
	}
}

// TestKnightsSetupCityPaysACoin: under Knights the second setup building is a
// city, and it pays 1 coin on a river vertex as a settlement does (the only time
// a city pays). Pins that a city really was placed, so the sweep above is not
// passing vacuously.
func TestKnightsSetupCityPaysACoin(t *testing.T) {
	cities := 0
	for seed := range uint64(6) {
		s := playState(t, "base+cak+rivers", 3, seed)
		x, _ := StateExt(s)
		for v, b := range s.Buildings {
			if b.City && x.IsRiverVertex(v) {
				cities++
				if x.Coins[b.Owner] < 1 {
					t.Fatalf("seed %d: seat %d has a setup city on a river vertex and no coin", seed, b.Owner)
				}
			}
		}
	}
	if cities == 0 {
		t.Fatal("no Knights setup city landed on a river vertex in six drafts")
	}
}

// TestSetupRoadsNeverLandOnBridgeSites: "Roads may not be placed on bridge
// sites, and a bridge may not be built during setup."
func TestSetupRoadsNeverLandOnBridgeSites(t *testing.T) {
	for _, players := range []int{2, 4, 6} {
		for seed := range uint64(6) {
			s := playState(t, "base+rivers", players, seed)
			x, _ := StateExt(s)
			for e := range s.Roads {
				if x.IsBridgeSite(e) {
					t.Fatalf("%dp seed %d: a setup road stands on bridge site %v", players, seed, e)
				}
			}
		}
	}
}

// TestNoBridgeDuringSetup.
func TestNoBridgeDuringSetup(t *testing.T) {
	s, _ := newGame(t, "base+rivers", 3, 4)
	x, _ := StateExt(s)
	// The draft's first settlement is placed; stand its owner beside a site.
	site := x.Rivers[0].Sites[0]
	s.Buildings[site.A] = engine.Building{Owner: s.Cur}
	s.Players[s.Cur].Hand = CostBridge
	_, err := engine.Decide(s, bridgeCmd(s.Cur, site))
	if err == nil {
		t.Fatal("a bridge was built during setup")
	}
	if !errors.Is(err, ErrNoSetupBridge) {
		t.Fatalf("setup bridge refused with %v, want a phase refusal", err)
	}
}

// --- bridges ---------------------------------------------------------------

// TestBridgeCost: 2 brick + 1 lumber.
func TestBridgeCost(t *testing.T) {
	if CostBridge != (engine.Hand{board.Brick: 2, board.Wood: 1}) {
		t.Fatalf("CostBridge = %v, want 2 brick + 1 lumber", CostBridge)
	}
	for _, short := range []engine.Hand{
		{board.Brick: 1, board.Wood: 1},
		{board.Brick: 2},
		{},
	} {
		r := newRig(t, "base+rivers", short)
		if err := r.build(t, bridgeCmd(0, r.site)); !errors.Is(err, engine.ErrNoResources) {
			t.Fatalf("hand %v bought a bridge (err %v)", short, err)
		}
	}
	r := newRig(t, "base+rivers", CostBridge)
	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatalf("the exact cost did not buy a bridge: %v", err)
	}
	if got := r.s.Players[0].Hand; got != (engine.Hand{}) {
		t.Fatalf("hand after paying is %v, want empty", got)
	}
	if r.s.Bank[board.Brick] != engine.BankPerResource(3)+2 {
		t.Fatal("the bridge's bricks did not go back to the supply")
	}
}

// TestBridgeSupplyIsThreePerPlayer.
func TestBridgeSupplyIsThreePerPlayer(t *testing.T) {
	if BridgeSupply != 3 {
		t.Fatalf("BridgeSupply = %d, want 3", BridgeSupply)
	}
	r := newRig(t, "base+rivers", engine.Hand{})
	// Spend the supply directly; this tests the cap, not geometry.
	r.x.BridgesLeft[0] = 0
	r.s.Players[0].Hand = CostBridge
	if err := r.build(t, bridgeCmd(0, r.site)); !errors.Is(err, ErrNoBridges) {
		t.Fatalf("a fourth bridge was refused with %v, want ErrNoBridges", err)
	}
	// And building one takes exactly one out of the supply.
	r2 := newRig(t, "base+rivers", CostBridge)
	before := r2.x.BridgesLeft[0]
	if err := r2.build(t, bridgeCmd(0, r2.site)); err != nil {
		t.Fatal(err)
	}
	if got := r2.x.BridgesLeft[0]; got != before-1 {
		t.Fatalf("supply went %d -> %d", before, got)
	}
	// Roads are a separate supply: spending a bridge consumes none.
	if r2.s.Players[0].RoadsLeft != engine.MaxRoads {
		t.Fatalf("a bridge consumed a road: %d left", r2.s.Players[0].RoadsLeft)
	}
}

// TestBridgeOnlyOnAnEmptyBridgeSite: both refusals, each with its own error.
func TestBridgeOnlyOnAnEmptyBridgeSite(t *testing.T) {
	r := newRig(t, "base+rivers", CostBridge)
	// A perfectly ordinary edge next to the seat's building is not a site.
	var plain board.Edge
	found := false
	for _, e := range r.site.A.Edges() {
		if e != r.site && !r.x.IsBridgeSite(e) && r.s.Board.LandEdge(e) {
			plain, found = e, true
			break
		}
	}
	if !found {
		t.Fatal("could not find an ordinary edge beside the site")
	}
	if err := r.build(t, bridgeCmd(0, plain)); !errors.Is(err, ErrNotBridgeSite) {
		t.Fatalf("a bridge on a plain edge was refused with %v, want ErrNotBridgeSite", err)
	}
	// The site itself works, and a second bridge on it does not.
	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatal(err)
	}
	r.s.Players[0].Hand = CostBridge
	if err := r.build(t, bridgeCmd(0, r.site)); !errors.Is(err, engine.ErrOccupied) {
		t.Fatalf("a bridge stacked on a bridge, refused with %v", err)
	}
}

// TestBridgeNeedsTheOwnersOwnNetwork: "A new bridge must connect to one of your
// own roads, bridges, settlements or cities at one of its two vertices."
func TestBridgeNeedsTheOwnersOwnNetwork(t *testing.T) {
	r := newRig(t, "base+rivers", CostBridge)
	delete(r.s.Buildings, r.site.A) // strand the seat
	if err := r.build(t, bridgeCmd(0, r.site)); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("an unconnected bridge was accepted (err %v)", err)
	}
	// A road of our own at either vertex is enough.
	for _, e := range r.site.B.Edges() {
		if e != r.site && r.s.Board.LandEdge(e) && !r.x.IsBridgeSite(e) {
			r.s.Roads[e] = 0
			break
		}
	}
	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatalf("a bridge off our own road was refused: %v", err)
	}
}

// TestBridgeBlockedByAnOpponentBuilding: "it may not connect through an
// opponent's settlement or city. This is the road connection rule, unchanged."
func TestBridgeBlockedByAnOpponentBuilding(t *testing.T) {
	r := newRig(t, "base+rivers", CostBridge)
	delete(r.s.Buildings, r.site.A)
	// Our road reaches vertex A, but an opponent stands on it.
	for _, e := range r.site.A.Edges() {
		if e != r.site && r.s.Board.LandEdge(e) && !r.x.IsBridgeSite(e) {
			r.s.Roads[e] = 0
			break
		}
	}
	r.s.Buildings[r.site.A] = engine.Building{Owner: 1}
	if err := r.build(t, bridgeCmd(0, r.site)); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("a bridge connected through an opponent's building (err %v)", err)
	}
}

// A bridge is worth no VP but adds a segment to the longest route.
func TestBridgeNoVPButCountsForRoute(t *testing.T) {
	r := newRig(t, "base+rivers", CostBridge)
	vpBefore := r.s.VP(0)
	before := engine.LongestRouteLength(r.s, 0)
	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatal(err)
	}
	after := engine.LongestRouteLength(r.s, 0)
	if after != before+1 {
		t.Fatalf("route went %d -> %d, want +1", before, after)
	}
	// The bridge is worth 0 VP. The change is the wealth tiles: its 3 coins
	// took this seat from tied-for-fewest to sole leader (-2 shed, +1 taken).
	if got := r.s.VP(0); got != vpBefore {
		t.Fatalf("a bridge moved base VP from %d to %d", vpBefore, got)
	}
	if got := (Module{}).victory(r.s, 0); got != WealthiestVP {
		t.Fatalf("the tiles contribute %d after the bridge, want %d", got, WealthiestVP)
	}
}

// TestNoFreeRoadEffectBuysABridge: Road Building builds roads only, and the
// same applies to the Knights progress card of that name.
func TestNoFreeRoadEffectBuysABridge(t *testing.T) {
	r := newRig(t, "base+rivers", engine.Hand{})
	r.s.FreeRoads = 2
	if err := r.build(t, bridgeCmd(0, r.site)); !errors.Is(err, engine.ErrNoResources) {
		t.Fatalf("a free-road credit paid for a bridge (err %v)", err)
	}
	if r.s.FreeRoads != 2 {
		t.Fatalf("the refusal spent a free-road credit: %d left", r.s.FreeRoads)
	}
}

// --- edges -----------------------------------------------------------------

// TestBridgeSiteRejectsRoads, and the refusal leaves the state untouched.
func TestBridgeSiteRejectsRoads(t *testing.T) {
	r := newRig(t, "base+rivers", engine.CostRoad)
	before := r.s.Clone()
	err := r.build(t, roadCmd(0, r.site))
	if !errors.Is(err, ErrBridgeSiteOnly) {
		t.Fatalf("a road crossed the channel (err %v)", err)
	}
	if len(r.s.Roads) != len(before.Roads) || r.s.Players[0].Hand != before.Players[0].Hand {
		t.Fatal("the refusal changed the state")
	}
	if code := engine.ErrorCode(err); code != "BRIDGE_SITE_ONLY" {
		t.Fatalf("the refusal carries code %q, want BRIDGE_SITE_ONLY", code)
	}
}

// TestBridgeSiteIsNeverOfferedAsALegalRoad: the offer and the validator must
// agree, or bots propose roads they cannot build.
func TestBridgeSiteIsNeverOfferedAsALegalRoad(t *testing.T) {
	for _, players := range []int{2, 4} {
		for seed := range uint64(4) {
			s := playState(t, "base+rivers", players, seed)
			x, _ := StateExt(s)
			for p := range s.Players {
				for _, e := range s.LegalRoads(engine.PlayerID(p)) {
					if x.IsBridgeSite(e) {
						t.Fatalf("%dp seed %d: seat %d was offered bridge site %v as a road",
							players, seed, p, e)
					}
				}
			}
		}
	}
}

// TestBridgeSiteRejectsShips is the Islands half: a bridge site is closed to
// every piece but a bridge, including the coastal outlets a ship would use.
func TestBridgeSiteRejectsShips(t *testing.T) {
	refused := 0
	for _, players := range []int{3, 4, 6} {
		for seed := range uint64(6) {
			s, _ := newGame(t, "base+islands+rivers", players, seed)
			x, _ := StateExt(s)
			s.Phase = engine.PhasePlay
			s.Cur = 0
			s.Rolled = true
			for _, r := range x.Rivers {
				for _, e := range r.Sites {
					if !s.Board.SeaEdge(e) {
						continue // a ship could never go here anyway
					}
					s.Buildings[e.A] = engine.Building{Owner: 0}
					s.Players[0].Hand = engine.Hand{board.Wood: 1, board.Sheep: 1}
					_, err := engine.Decide(s, engine.Command{Player: 0, Type: "build_ship",
						Data: raw(map[string]any{"e": e})})
					if err == nil {
						t.Fatalf("%dp seed %d: a ship was built on bridge site %v", players, seed, e)
					}
					if errors.Is(err, ErrBridgeSiteOnly) {
						refused++
					}
					delete(s.Buildings, e.A)
				}
			}
		}
	}
	if refused == 0 {
		t.Fatal("no coastal bridge site was a candidate ship edge on eighteen boards")
	}
}

// --- coins -----------------------------------------------------------------

// TestCoinPayouts is the earning table: 1 per road, 1 per settlement, 3 per
// bridge, 0 for a city upgrade.
func TestCoinPayouts(t *testing.T) {
	r := newRig(t, "base+rivers", engine.Hand{})
	base := r.x.Coins[0]

	// A road on a river edge.
	var riverRoad board.Edge
	for _, e := range r.site.A.Edges() {
		if e != r.site && r.s.Board.LandEdge(e) && !r.x.IsBridgeSite(e) && r.x.IsRiverEdge(e) {
			riverRoad = e
		}
	}
	if riverRoad == (board.Edge{}) {
		t.Fatal("no plain river edge beside the site")
	}
	r.s.Players[0].Hand = engine.CostRoad
	if err := r.build(t, roadCmd(0, riverRoad)); err != nil {
		t.Fatal(err)
	}
	if got := r.x.Coins[0] - base; got != CoinsPerRoad {
		t.Fatalf("a river road paid %d coins, want %d", got, CoinsPerRoad)
	}

	// A bridge pays 3, without the road's 1.
	base = r.x.Coins[0]
	r.s.Players[0].Hand = CostBridge
	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatal(err)
	}
	if got := r.x.Coins[0] - base; got != CoinsPerBridge {
		t.Fatalf("a bridge paid %d coins, want exactly %d", got, CoinsPerBridge)
	}

	// A settlement on a river vertex, then its upgrade to a city, which pays 0.
	// The seat is planted by hand so only the payout moves the coins.
	v, ok := freeRiverVertex(r.s, r.x, 0)
	if !ok {
		t.Fatal("no free river vertex within reach of a road on this board")
	}
	settle(t, r.s) // the hand-planted road pays its own coin first
	base = r.x.Coins[0]
	r.s.Players[0].Hand = engine.CostSettlement
	if err := r.build(t, engine.Command{Player: 0, Type: engine.CmdBuildSettlement,
		Data: raw(map[string]any{"v": v})}); err != nil {
		t.Fatal(err)
	}
	if got := r.x.Coins[0] - base; got != CoinsPerBuilding {
		t.Fatalf("a river settlement paid %d coins, want %d", got, CoinsPerBuilding)
	}
	base = r.x.Coins[0]
	r.s.Players[0].Hand = engine.CostCity
	if err := r.build(t, engine.Command{Player: 0, Type: engine.CmdBuildCity,
		Data: raw(map[string]any{"v": v})}); err != nil {
		t.Fatal(err)
	}
	if got := r.x.Coins[0] - base; got != 0 {
		t.Fatalf("a city upgrade paid %d coins, want 0", got)
	}
}

// settle runs one no-op command so the module's OnEvents pass reconciles the
// ledger against a hand-planted board.
func settle(t *testing.T, s *engine.State) {
	t.Helper()
	settleWith(t, s, nil)
}

// settleWith is settle for a batch the module should react to (a turn start).
func settleWith(t *testing.T, s *engine.State, events []engine.Event) {
	t.Helper()
	for _, e := range (Module{}).afterEvents(s, events) {
		e.Seq = s.NextSeq
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
}

// freeRiverVertex finds a legal settlement spot on a river vertex and plants a
// road of seat's beside it. Planted rather than played out, since several turns of
// dice would move the coin counts under test.
func freeRiverVertex(s *engine.State, x *Ext, seat engine.PlayerID) (board.Vertex, bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !x.IsRiverVertex(v) || engine.CheckSettlementSpot(s, v) != nil {
				continue
			}
			for _, e := range v.Edges() {
				if _, taken := s.Roads[e]; taken || !s.Board.LandEdge(e) || x.IsBridgeSite(e) {
					continue
				}
				s.Roads[e] = seat
				return v, true
			}
		}
	}
	return board.Vertex{}, false
}

// TestCoinsAreNotResources: coins do not count toward the discard threshold,
// are never discarded on a 7, cannot be stolen, and Monopoly cannot take them.
// Checked structurally: all four hold because coins live in the module's ext and
// never touch PlayerState.Hand.
func TestCoinsAreNotResources(t *testing.T) {
	r := newRig(t, "base+rivers", engine.Hand{board.Wood: 3})
	r.x.Coins[0] = 40
	if got := r.s.Players[0].Hand.Count(); got != 3 {
		t.Fatalf("40 coins made the hand %d cards", got)
	}
	if got := r.s.DiscardableCount(0); got != 3 {
		t.Fatalf("a 3-card hand with 40 coins counts %d cards toward the 7 discard, want 3", got)
	}
	// No module contributes coins to the discard count (Rivers does not use
	// ExtraDiscardCount).
	for _, m := range r.s.Modules() {
		if m.Name() != Name {
			continue
		}
		if m.Hooks().ExtraDiscardCount != nil {
			t.Fatal("Rivers adds coins to the discard count")
		}
		if m.Hooks().StealCard != nil {
			t.Fatal("Rivers offers coins to the robber")
		}
		if m.Hooks().HandleDiscard != nil {
			t.Fatal("Rivers takes over the discard")
		}
	}
}

// TestBuyCoinUsesTheBankRatio, 2:1 harbor included: a coin costs the seat's own
// maritime rate for that resource (4:1, or 3:1/2:1 at a port). The rate is
// engine.State.CurrencyRatio, shared with the Raiders and Wagons gold purchases,
// so `ratio` and `paid` agree in every row. The cross-module half is
// engine/ruletest's TestCurrencyRatioAgreesAcrossModules.
func TestBuyCoinUsesTheBankRatio(t *testing.T) {
	for _, c := range []struct {
		name  string
		ratio int
		paid  int
		res   board.Resource
	}{
		{"no harbor", 4, 4, board.Ore},
		{"generic harbor", 3, 3, board.Ore},
		{"the resource's own harbor", 2, 2, board.Ore},
	} {
		t.Run(c.name, func(t *testing.T) {
			r := newRig(t, "base+rivers", engine.Hand{board.Ore: 6})
			if c.ratio < 4 {
				// Give the seat a harbor at the vertex it already stands on.
				h := board.Harbor{Verts: [2]board.Vertex{r.site.A, r.site.B}, Ratio: c.ratio}
				if c.ratio == 2 {
					h.Res = c.res
				}
				// Prepended: the generated board already has a 2:1 brick
				// harbour on this vertex and Board.HarborAt returns the first
				// match, so appending would test the board's harbour instead.
				r.s.Board.Harbors = append([]board.Harbor{h}, r.s.Board.Harbors...)
			}
			if got := r.s.BankRatio(0, c.res); got != c.ratio {
				t.Fatalf("the seat's rate is %d, want %d", got, c.ratio)
			}
			before := r.s.Players[0].Hand[c.res]
			coinsBefore := r.x.Coins[0]
			if err := r.build(t, engine.Command{Player: 0, Type: CmdBuyCoin,
				Data: raw(map[string]any{"res": c.res})}); err != nil {
				t.Fatal(err)
			}
			if got := before - r.s.Players[0].Hand[c.res]; got != c.paid {
				t.Fatalf("the coin cost %d cards, want %d", got, c.paid)
			}
			if got := r.x.Coins[0] - coinsBefore; got != 1 {
				t.Fatalf("the purchase paid %d coins, want 1", got)
			}
			if r.s.Bank[c.res] != engine.BankPerResource(3)+c.paid {
				t.Fatal("the cards did not go back to the supply")
			}
		})
	}
	// And a hand short of the rate buys nothing.
	r := newRig(t, "base+rivers", engine.Hand{board.Ore: 3})
	if err := r.build(t, engine.Command{Player: 0, Type: CmdBuyCoin,
		Data: raw(map[string]any{"res": board.Ore})}); !errors.Is(err, engine.ErrNoResources) {
		t.Fatalf("three ore bought a coin at 4:1 (err %v)", err)
	}
	// A 2:1 harbor on another resource does not cheapen this one: the seat
	// trades ore at 4 while holding a 2:1 in wood, so three ore buys nothing.
	r2 := newRig(t, "base+rivers", engine.Hand{board.Ore: 3})
	r2.s.Board.Harbors = append([]board.Harbor{
		{Verts: [2]board.Vertex{r2.site.A, r2.site.B}, Ratio: 2, Res: board.Wood},
	}, r2.s.Board.Harbors...)
	if got := r2.s.CurrencyRatio(0, board.Ore); got != 4 {
		t.Fatalf("a 2:1 WOOD harbor priced an ore coin at %d, want 4", got)
	}
	if err := r2.build(t, engine.Command{Player: 0, Type: CmdBuyCoin,
		Data: raw(map[string]any{"res": board.Ore})}); !errors.Is(err, engine.ErrNoResources) {
		t.Fatalf("a 2:1 wood harbor bought an ore coin for three cards (err %v)", err)
	}
}

// TestSpendCoins: two coins for one chosen resource, at most twice a turn, and
// refused (spending nothing) when the bank cannot pay.
func TestSpendCoins(t *testing.T) {
	r := newRig(t, "base+rivers", engine.Hand{})
	r.x.Coins[0] = 9
	spend := func() error {
		return r.build(t, engine.Command{Player: 0, Type: CmdSpendCoins,
			Data: raw(map[string]any{"res": board.Wheat})})
	}
	if err := spend(); err != nil {
		t.Fatal(err)
	}
	if r.x.Coins[0] != 7 || r.s.Players[0].Hand[board.Wheat] != 1 {
		t.Fatalf("after one spend: %d coins, %d wheat", r.x.Coins[0], r.s.Players[0].Hand[board.Wheat])
	}
	if err := spend(); err != nil {
		t.Fatal(err)
	}
	if err := spend(); !errors.Is(err, ErrSpendCap) {
		t.Fatalf("a third spend this turn was allowed (err %v)", err)
	}
	if r.x.Coins[0] != 5 {
		t.Fatalf("the refused spend took coins: %d left", r.x.Coins[0])
	}

	// A fresh turn resets the counter.
	settleTurn(t, r.s)
	if err := spend(); err != nil {
		t.Fatalf("the cap did not reset at the turn: %v", err)
	}

	// One coin buys nothing.
	r2 := newRig(t, "base+rivers", engine.Hand{})
	r2.x.Coins[0] = 1
	if err := r2.build(t, engine.Command{Player: 0, Type: CmdSpendCoins,
		Data: raw(map[string]any{"res": board.Wheat})}); !errors.Is(err, ErrNoCoins) {
		t.Fatalf("one coin bought a resource (err %v)", err)
	}

	// An empty supply refuses, and spends nothing.
	r3 := newRig(t, "base+rivers", engine.Hand{})
	r3.x.Coins[0] = 4
	r3.s.Bank[board.Wheat] = 0
	if err := r3.build(t, engine.Command{Player: 0, Type: CmdSpendCoins,
		Data: raw(map[string]any{"res": board.Wheat})}); !errors.Is(err, ErrBankEmpty) {
		t.Fatalf("an empty supply paid out (err %v)", err)
	}
	if r3.x.Coins[0] != 4 {
		t.Fatalf("the refused purchase spent coins: %d left", r3.x.Coins[0])
	}
}

// settleTurn folds the module's own turn-reset event, standing in for the turn
// change without playing one out.
func settleTurn(t *testing.T, s *engine.State) {
	t.Helper()
	settleWith(t, s, []engine.Event{{Type: engine.EvTurnStarted}})
}

// --- wealth ----------------------------------------------------------------

// TestWealthTiles is the tile rule over constructed coin counts: the strict
// leader takes the Wealthiest Settler, a tie gives it to nobody, and every seat
// tied for the fewest holds a Poorest Settler.
func TestWealthTiles(t *testing.T) {
	for _, c := range []struct {
		name       string
		coins      []int
		wealthiest engine.PlayerID
		poorest    []bool
	}{
		{"everyone at zero, as setup begins", []int{0, 0, 0, 0}, engine.NoPlayer, []bool{true, true, true, true}},
		{"a single leader and a single trailer", []int{5, 3, 1, 3}, 0, []bool{false, false, true, false}},
		{"a tie at the top gives it to nobody", []int{5, 5, 1, 0}, engine.NoPlayer, []bool{false, false, false, true}},
		{"a tie at the bottom gives them all one", []int{9, 2, 2, 2}, 0, []bool{false, true, true, true}},
		{"two seats, one ahead", []int{3, 1}, 0, []bool{false, true}},
		{"two seats, level", []int{4, 4}, engine.NoPlayer, []bool{true, true}},
	} {
		t.Run(c.name, func(t *testing.T) {
			w, p := deriveWealth(c.coins, true)
			if w != c.wealthiest {
				t.Fatalf("wealthiest = %d, want %d", w, c.wealthiest)
			}
			if !sameBools(p, c.poorest) {
				t.Fatalf("poorest = %v, want %v", p, c.poorest)
			}
		})
	}
}

// TestNoPlayerEverHoldsBothTiles asserts the spec's Decision over every coin
// vector up to 4 coins on up to 4 seats.
func TestNoPlayerEverHoldsBothTiles(t *testing.T) {
	var walk func(coins []int, i int)
	walk = func(coins []int, i int) {
		if i == len(coins) {
			w, poor := deriveWealth(coins, true)
			if w != engine.NoPlayer && poor[w] {
				t.Fatalf("coins %v: seat %d holds both tiles", coins, w)
			}
			return
		}
		for v := range 5 {
			coins[i] = v
			walk(coins, i+1)
		}
	}
	for n := 2; n <= 4; n++ {
		walk(make([]int, n), 0)
	}
}

// TestPoorestTileOffUnderWagonsAndRaiders: both pairings drop the
// -2 tile because coins stop measuring good play. The Wealthiest Settler stays.
func TestPoorestTileOffUnderWagonsAndRaiders(t *testing.T) {
	for _, c := range []struct {
		ruleset string
		want    bool
	}{
		{"base+rivers", true},
		{"base+cak+rivers", true},
		{"base+islands+rivers", true},
		{"base+rivers+wagons", false},
		{"base+raiders+rivers", false},
		{"base+raiders+rivers+wagons", false},
	} {
		if got := usesPoorestTile(c.ruleset); got != c.want {
			t.Errorf("usesPoorestTile(%q) = %v, want %v", c.ruleset, got, c.want)
		}
	}
	// And with it suppressed, nobody ever holds one while the leader still
	// takes the +1.
	w, poor := deriveWealth([]int{4, 1, 1}, false)
	if w != 0 {
		t.Fatalf("wealthiest = %d, want 0", w)
	}
	for p, f := range poor {
		if f {
			t.Fatalf("seat %d holds a Poorest Settler tile in a ruleset that drops it", p)
		}
	}
}

// TestBridgePayoutBendsUnderWagons: "A bridge pays 2 coins, not 3."
func TestBridgePayoutBendsUnderWagons(t *testing.T) {
	if got := bridgePayout("base+rivers"); got != CoinsPerBridge {
		t.Fatalf("a bridge pays %d, want %d", got, CoinsPerBridge)
	}
	if got := bridgePayout("base+rivers+wagons"); got != CoinsPerBridgeWagons {
		t.Fatalf("alongside Wagons a bridge pays %d, want %d", got, CoinsPerBridgeWagons)
	}
}

// TestWealthTilesAreReDerivedOnAnyPlayersTurn: a coin change on another
// player's turn moves the tiles immediately.
func TestWealthTilesAreReDerivedOnAnyPlayersTurn(t *testing.T) {
	r := newRig(t, "base+rivers", engine.Hand{})
	// Seat 1 gains coins while seat 0 is the current player.
	r.x.Coins[1] = 6
	settle(t, r.s)
	if r.x.Wealthiest != 1 {
		t.Fatalf("wealthiest = %d after seat 1 pulled ahead on seat 0's turn, want 1", r.x.Wealthiest)
	}
	if r.s.Cur != 0 {
		t.Fatalf("cur = %d, want seat 0", r.s.Cur)
	}
}

// --- victory ---------------------------------------------------------------

// TestVictoryContribution: +1 for the Wealthiest Settler tile, -2 for a Poorest
// Settler tile, and the total may go negative.
func TestVictoryContribution(t *testing.T) {
	r := newRig(t, "base+rivers", engine.Hand{})
	m := Module{}
	r.x.Wealthiest = 0
	for i := range r.x.Poorest {
		r.x.Poorest[i] = false
	}
	if got := m.victory(r.s, 0); got != WealthiestVP {
		t.Fatalf("the wealthiest settler is worth %d, want %d", got, WealthiestVP)
	}
	r.x.Wealthiest = engine.NoPlayer
	r.x.Poorest[0] = true
	if got := m.victory(r.s, 0); got != PoorestVP {
		t.Fatalf("the poorest settler is worth %d, want %d", got, PoorestVP)
	}
	if PoorestVP != -2 || WealthiestVP != 1 {
		t.Fatalf("the tiles are %d and %d, want +1 and -2", WealthiestVP, PoorestVP)
	}
	// A seat at 1 public VP holding a Poorest Settler tile is at -1. The rig
	// already planted one settlement, which is that one point.
	if got := r.s.VP(0); got != 1 {
		t.Fatalf("the rig's seat holds %d VP, want the 1 its settlement is worth", got)
	}
	total := r.s.VP(0) + m.victory(r.s, 0)
	if total >= 0 {
		t.Fatalf("total VP is %d, want negative", total)
	}
}

// TestRiversDoesNotMoveTheThreshold: "Rivers does not change the victory
// threshold. The base game's 10 stands, as do Knights' 13 and Caravans' 12."
func TestRiversDoesNotMoveTheThreshold(t *testing.T) {
	for _, c := range []struct {
		ruleset string
		want    int
	}{
		{"base+rivers", 10},
		{"base+cak+rivers", 13},
		{"base+caravans+rivers", 12},
	} {
		s := playState(t, c.ruleset, 3, 2)
		if got := engine.WinThreshold(s, 0); got != c.want {
			t.Errorf("%s plays to %d, want %d", c.ruleset, got, c.want)
		}
		for _, m := range s.Modules() {
			if m.Name() == Name && m.Hooks().WinThresholdDelta != nil {
				t.Fatal("Rivers moves the win threshold")
			}
		}
	}
}

// --- composition -----------------------------------------------------------

// TestExplorersIsRefused: Explorers replaces board generation wholesale, so
// there is no board for Rivers to derive a chain on.
func TestExplorersIsRefused(t *testing.T) {
	if engine.ValidRuleset("base+explorers+rivers") {
		t.Fatal("base+explorers+rivers resolved, want refused")
	}
	if _, ok := engine.ConflictBetween("explorers", "rivers"); !ok {
		t.Fatal("the compatibility table has no entry for explorers and rivers")
	}
}

// TestEveryAllowedPartnerComposes: the spec's Compatibility table pairs Rivers
// with Islands, Knights, Fishermen and Caravans; each ruleset must resolve.
func TestEveryAllowedPartnerComposes(t *testing.T) {
	for _, rs := range []string{
		"base+islands+rivers", "base+cak+rivers", "base+fishermen+rivers",
		"base+caravans+rivers", "base+caravans+fishermen+islands+rivers",
	} {
		canon := engine.CanonicalRuleset(rs)
		if !engine.ValidRuleset(canon) {
			t.Fatalf("%s does not resolve", canon)
		}
		s := playState(t, canon, 3, 5)
		if x, ok := StateExt(s); !ok || len(x.Rivers) == 0 {
			t.Fatalf("%s dealt no river", canon)
		}
	}
}

// TestFishermenKeepsItsLake: our board still generates a desert, the river
// derivation may not touch it, and Fishermen turns it into the lake.
func TestFishermenKeepsItsLake(t *testing.T) {
	for seed := range uint64(6) {
		s, _ := newGame(t, "base+fishermen+rivers", 4, seed)
		lakes := 0
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if s.Board.Tiles[h].Res == board.Lake {
				lakes++
			}
		}
		if lakes == 0 {
			t.Fatalf("seed %d: base+fishermen+rivers dealt no lake", seed)
		}
	}
}

// TestKnightsCrossBridges: knights move across bridges as though they were
// roads, via the RouteEdge hook.
func TestKnightsCrossBridges(t *testing.T) {
	r := newRig(t, "base+cak+rivers", CostBridge)
	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatal(err)
	}
	owner, ok := r.s.ModuleRouteEdge(r.site)
	if !ok || owner != 0 {
		t.Fatalf("a bridge is invisible to a route walk: owner %d, ok %v", owner, ok)
	}
}

// TestCoinsRideAPlayerTrade: "Coins may be given and taken in player trades, on
// the active player's turn, like resources."
func TestCoinsRideAPlayerTrade(t *testing.T) {
	r := newRig(t, "base+rivers", engine.Hand{})
	r.x.Coins[0] = 5
	extra := raw(map[string]any{"coins": 3})
	if n, held := tradeExtraHeld(r.s, 0, extra); n != 3 || !held {
		t.Fatalf("a 3-coin payload read as %d held=%v", n, held)
	}
	if _, held := tradeExtraHeld(r.s, 1, extra); held {
		t.Fatal("a seat with no coins was said to hold three")
	}
	evs := tradeExtraEvents(r.s, 0, 1, extra)
	if len(evs) != 1 {
		t.Fatalf("the trade produced %d events", len(evs))
	}
	for _, e := range evs {
		e.Seq = r.s.NextSeq
		if err := engine.Apply(r.s, e); err != nil {
			t.Fatal(err)
		}
	}
	if r.x.Coins[0] != 2 || r.x.Coins[1] != 3 {
		t.Fatalf("after trading 3 coins: %d and %d", r.x.Coins[0], r.x.Coins[1])
	}
	// A payload this module does not recognise belongs to another module and
	// reads as "nothing of mine", not a refusal.
	if n, held := tradeExtraHeld(r.s, 0, raw([]int{1, 2, 3})); n != 0 || !held {
		t.Fatalf("a foreign trade payload read as %d held=%v, want 0 true", n, held)
	}
}

// --- replay ----------------------------------------------------------------

// TestReplayEqualsLive: replaying the log reproduces the live state. The coin
// ledger is written only by Apply folding the events afterEvents produced; an
// in-place ledger would be empty after replay and pay every piece twice.
func TestReplayEqualsLive(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+cak+rivers", "base+caravans+fishermen+islands+rivers"} {
		canon := engine.CanonicalRuleset(rs)
		for seed := range uint64(4) {
			log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: canon}, engine.SeedsFrom(seed))
			if err != nil {
				t.Fatal(err)
			}
			live := engine.Empty()
			for _, e := range log {
				if err := engine.Apply(live, e); err != nil {
					t.Fatal(err)
				}
			}
			for range 400 {
				if live.Phase == engine.PhaseFinished {
					break
				}
				cmd, ok := engine.AutoCommand(live)
				if !ok {
					break
				}
				evs, err := engine.Decide(live, cmd)
				if err != nil {
					t.Fatalf("%s seed %d: %v", canon, seed, err)
				}
				for _, e := range evs {
					if err := engine.Apply(live, e); err != nil {
						t.Fatal(err)
					}
				}
				log = append(log, evs...)
			}
			replayed, err := engine.Replay(log)
			if err != nil {
				t.Fatalf("%s seed %d: replay: %v", canon, seed, err)
			}
			lx, _ := StateExt(live)
			rx, _ := StateExt(replayed)
			if rx == nil {
				t.Fatalf("%s seed %d: the replay has no rivers ext", canon, seed)
			}
			for p := range lx.Coins {
				if lx.Coins[p] != rx.Coins[p] {
					t.Fatalf("%s seed %d: seat %d has %d coins live and %d replayed",
						canon, seed, p, lx.Coins[p], rx.Coins[p])
				}
				if lx.Poorest[p] != rx.Poorest[p] {
					t.Fatalf("%s seed %d: seat %d's poorest tile differs after replay", canon, seed, p)
				}
			}
			if lx.Wealthiest != rx.Wealthiest {
				t.Fatalf("%s seed %d: wealthiest %d live, %d replayed", canon, seed, lx.Wealthiest, rx.Wealthiest)
			}
			if len(lx.Bridges) != len(rx.Bridges) {
				t.Fatalf("%s seed %d: %d bridges live, %d replayed", canon, seed, len(lx.Bridges), len(rx.Bridges))
			}
			if len(lx.PaidEdge) != len(rx.PaidEdge) || len(lx.PaidVertex) != len(rx.PaidVertex) {
				t.Fatalf("%s seed %d: the coin ledger differs after replay (%d/%d edges, %d/%d vertices)",
					canon, seed, len(lx.PaidEdge), len(rx.PaidEdge), len(lx.PaidVertex), len(rx.PaidVertex))
			}
		}
	}
}

// TestCoinsNeverGoNegative over whole played games: the clamp is the spec's
// Decision for a piece taken off the river.
func TestCoinsNeverGoNegative(t *testing.T) {
	for seed := range uint64(6) {
		s := playState(t, "base+rivers", 4, seed)
		for range 600 {
			if s.Phase == engine.PhaseFinished {
				break
			}
			cmd, ok := engine.AutoCommand(s)
			if !ok {
				break
			}
			evs, err := engine.Decide(s, cmd)
			if err != nil {
				t.Fatalf("seed %d: %v", seed, err)
			}
			for _, e := range evs {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			x, _ := StateExt(s)
			for p, c := range x.Coins {
				if c < 0 {
					t.Fatalf("seed %d: seat %d holds %d coins", seed, p, c)
				}
			}
		}
	}
}

// TestCamelsAndBridgesDoNotExcludeEachOther is the Caravans pairing: a camel may
// stand on a bridge site with or without a bridge, affects a bridge as it affects
// a road, does not stop a bridge being built under it, and a bridge does not stop
// a caravan extending over it. Only a second camel is refused.
//
// Each module tests only its own condition ("free land edge, no camel yet",
// "empty bridge site"), so neither would notice the other tightening; hence this
// test.
func TestCamelsAndBridgesDoNotExcludeEachOther(t *testing.T) {
	r := newRig(t, engine.CanonicalRuleset("base+caravans+rivers"), CostBridge)
	cx, ok := scenarios.CaravansStateExt(r.s)
	if !ok {
		t.Fatal("no caravans ext on a caravans board")
	}
	// A camel standing on the very site we are about to bridge.
	cx.Occupied[r.site] = true
	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatalf("a camel stopped a bridge being built under it: %v", err)
	}
	// The caravan may still extend over a bridged site: Caravans only bars
	// an edge with a camel already on it or a non-land edge.
	if !r.s.Board.LandEdge(r.site) {
		t.Fatal("bridge site is not a land edge")
	}
	// A camel doubles a bridge for the longest route as it does a road:
	// RouteWeights runs after every module's RouteEdges.
	if got := engine.LongestRouteLength(r.s, 0); got != 2 {
		t.Fatalf("a camel-shared bridge counts %d for the route, want 2", got)
	}
}

// TestAqueductIsUnaffectedByCoins: the Aqueduct still fires when coins were the
// only income for the roll. True by construction: no coin is paid by a dice
// roll, only by placements, purchases and trades.
func TestAqueductIsUnaffectedByCoins(t *testing.T) {
	for _, m := range playState(t, engine.CanonicalRuleset("base+cak+rivers"), 3, 2).Modules() {
		if m.Name() != Name {
			continue
		}
		h := m.Hooks()
		if h.OnDiceRolled != nil {
			t.Fatal("OnDiceRolled is set, want nil")
		}
		if h.OnSeven != nil {
			t.Fatal("Rivers reacts to a 7")
		}
	}
}

// TestExtSurvivesASnapshot: a game restores from a gob snapshot plus later
// events. gob drops maps that were nil at encode time, and the next fold writing
// to one panics. This module has three (bridges and the two ledger halves), and
// RestoreExt fills them in. See engine.ExtRestorer.
func TestExtSurvivesASnapshot(t *testing.T) {
	r := newRig(t, "base+rivers", CostBridge)
	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatal(err)
	}
	before, _ := StateExt(r.s)

	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(before); err != nil {
		t.Fatalf("encode: %v", err)
	}
	var after Ext
	if err := gob.NewDecoder(&buf).Decode(&after); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(after.Rivers) != len(before.Rivers) || after.Wealthiest != before.Wealthiest {
		t.Fatalf("the layout or the tiles did not survive: %d rivers, wealthiest %d",
			len(after.Rivers), after.Wealthiest)
	}
	for p := range before.Coins {
		if after.Coins[p] != before.Coins[p] || after.BridgesLeft[p] != before.BridgesLeft[p] {
			t.Fatalf("seat %d came back with %d coins and %d bridges, want %d and %d",
				p, after.Coins[p], after.BridgesLeft[p], before.Coins[p], before.BridgesLeft[p])
		}
	}
	if len(after.Bridges) != len(before.Bridges) {
		t.Fatalf("%d bridges came back, want %d", len(after.Bridges), len(before.Bridges))
	}

	// An ext whose maps were nil at encode time (nothing built) must be
	// writable after the round trip.
	empty := emptyExt(3)
	empty.Bridges, empty.PaidEdge, empty.PaidVertex = nil, nil, nil
	buf.Reset()
	if err := gob.NewEncoder(&buf).Encode(empty); err != nil {
		t.Fatalf("encode empty: %v", err)
	}
	var restored Ext
	if err := gob.NewDecoder(&buf).Decode(&restored); err != nil {
		t.Fatalf("decode empty: %v", err)
	}
	restored.RestoreExt()
	restored.Bridges[r.site] = 0
	restored.PaidEdge[r.site] = paid{P: 0, N: 1}
	restored.PaidVertex[r.site.A] = paid{P: 0, N: 1}

	// A clone of a restored ext must be writable too: maps.Clone returns nil
	// for a nil map, and Decide clones before it folds.
	c, _ := restored.CloneExt().(*Ext)
	c.Bridges[r.site] = 1
	c.PaidEdge[r.site] = paid{P: 1, N: 1}
	c.PaidVertex[r.site.A] = paid{P: 1, N: 1}
	if restored.Bridges[r.site] != 0 {
		t.Fatal("the clone shares its bridge map with the original")
	}
}

// TestDiplomatCannotPutARoadOnABridgeSite: a road may never cross the channel,
// and the Diplomat relocates a road onto any free land edge its owner's network
// reaches, which includes bridge sites unless engine/knights asks the same
// closed-edge predicate the base build does.
//
// The Diplomat also cannot move a bridge, since its sources come from s.Roads;
// asserted in case that scan is ever widened.
func TestDiplomatCannotPutARoadOnABridgeSite(t *testing.T) {
	r := newRig(t, engine.CanonicalRuleset("base+cak+rivers"), engine.Hand{})
	// A road of ours somewhere the card could free, and a bridge on the site.
	var src board.Edge
	for _, e := range r.site.A.Edges() {
		if e != r.site && r.s.Board.LandEdge(e) && !r.x.IsBridgeSite(e) {
			src = e
			break
		}
	}
	if src == (board.Edge{}) {
		t.Fatal("no ordinary edge beside the site to put a road on")
	}
	r.s.Roads[src] = 0
	// Play the card: the command is the rule, the offer below is a client
	// convenience.
	cx := knights.Read(r.s)
	cx.Players[0].Progress = append(cx.Players[0].Progress, knights.CardDiplomat)
	err := r.build(t, engine.Command{Player: 0, Type: knights.CmdPlayProgress,
		Data: raw(map[string]any{"card": knights.CardDiplomat, "e": src, "to": r.site})})
	if !errors.Is(err, ErrBridgeSiteOnly) {
		t.Fatalf("the Diplomat relocated a road onto a bridge site (err %v)", err)
	}
	if _, moved := r.s.Roads[r.site]; moved {
		t.Fatal("the refusal left a road on the bridge site")
	}
	if _, gone := r.s.Roads[src]; !gone {
		t.Fatal("the refusal freed the source road anyway")
	}
	// And the offer agrees with the refusal: no module may list a bridge site
	// as a road destination for any card.
	for _, pt := range r.s.LegalTargetsFor(0).ProgressTargets {
		for _, m := range pt.Moves {
			for _, to := range m.To {
				if r.x.IsBridgeSite(to) {
					t.Fatalf("a progress card offers bridge site %v as a road destination", to)
				}
			}
		}
		for _, e := range pt.Edges {
			if _, isBridge := r.x.Bridges[e]; isBridge {
				t.Fatalf("a progress card offers bridge %v as a source", e)
			}
		}
	}
}

// TestABridgeClosesARoadForTheDiplomat: a bridge of yours attached to a road
// makes that road not open for the Diplomat. A bridge is a road segment, so an end
// it touches is attached. A ship at the same end is not (road and ship join only
// through a building), which is why the seam carries the piece's kind.
func TestABridgeClosesARoadForTheDiplomat(t *testing.T) {
	r := newRig(t, engine.CanonicalRuleset("base+cak+rivers"), CostBridge)
	// A road of ours off the site's far vertex, with our building at its
	// other end. Both ends are then attached, one only by the bridge.
	var src board.Edge
	for _, e := range r.site.B.Edges() {
		if e != r.site && r.s.Board.LandEdge(e) && !r.x.IsBridgeSite(e) {
			src = e
			break
		}
	}
	if src == (board.Edge{}) {
		t.Fatal("no ordinary edge off the site's far vertex")
	}
	far := src.Other(r.site.B)
	r.s.Roads[src] = 0
	r.s.Buildings[far] = engine.Building{Owner: 0}

	cx := knights.Read(r.s)
	cx.Players[0].Progress = append(cx.Players[0].Progress, knights.CardDiplomat)
	play := func() error {
		return r.build(t, engine.Command{Player: 0, Type: knights.CmdPlayProgress,
			Data: raw(map[string]any{"card": knights.CardDiplomat, "e": src})})
	}
	// Control: without the bridge the far end is bare, so the road is open
	// and the card takes it.
	probe := r.s.Clone()
	if _, err := engine.Decide(probe, engine.Command{Player: 0, Type: knights.CmdPlayProgress,
		Data: raw(map[string]any{"card": knights.CardDiplomat, "e": src})}); err != nil {
		t.Fatalf("the road was not open even with no bridge on it: %v", err)
	}

	if err := r.build(t, bridgeCmd(0, r.site)); err != nil {
		t.Fatal(err)
	}
	if err := play(); !errors.Is(err, knights.ErrNoOpenRoad) {
		t.Fatalf("the Diplomat freed a road a bridge of ours is attached to (err %v)", err)
	}
}

// openRiverRoad plants a road of owner's on a river edge that is not a bridge
// site and whose two ends are bare, so the Diplomat sees it as open, and settles
// the ledger so the road has earned its coin.
func openRiverRoad(t *testing.T, r *rig, owner engine.PlayerID) board.Edge {
	t.Helper()
	for _, e := range r.x.edgeList {
		if r.x.IsBridgeSite(e) || !r.s.Board.LandEdge(e) {
			continue
		}
		if _, ok := r.s.Roads[e]; ok {
			continue
		}
		bare := true
		for _, v := range []board.Vertex{e.A, e.B} {
			if _, ok := r.s.Buildings[v]; ok {
				bare = false
			}
			for _, n := range v.Edges() {
				if _, ok := r.s.Roads[n]; ok {
					bare = false
				}
				if _, ok := r.x.Bridges[n]; ok {
					bare = false
				}
			}
		}
		if !bare {
			continue
		}
		r.s.Roads[e] = owner
		settle(t, r.s)
		return e
	}
	t.Fatal("no bare river edge to plant a road on")
	return board.Edge{}
}

func diplomatCmd(seat engine.PlayerID, e board.Edge) engine.Command {
	return engine.Command{Player: seat, Type: knights.CmdPlayProgress,
		Data: raw(map[string]any{"card": knights.CardDiplomat, "e": e})}
}

// TestDiplomatRemovalIsPaidByTheCardPlayer: whoever removes a road from a river
// edge pays 1 gold, and that is the card's player; the road's owner keeps its
// coin. A player who cannot pay is refused up front and the road is not offered.
func TestDiplomatRemovalIsPaidByTheCardPlayer(t *testing.T) {
	r := newRig(t, engine.CanonicalRuleset("base+cak+rivers"), engine.Hand{})
	road := openRiverRoad(t, r, 1)
	if r.x.Coins[1] != 1 {
		t.Fatalf("seat 1's river road earned %d coins, want 1", r.x.Coins[1])
	}
	cx := knights.Read(r.s)
	cx.Players[0].Progress = append(cx.Players[0].Progress, knights.CardDiplomat)

	// No coin in hand: refused, nothing moves, and the road is not offered.
	r.x.Coins[0] = 0
	settle(t, r.s)
	if err := r.build(t, diplomatCmd(0, road)); !errors.Is(err, ErrNoCoins) {
		t.Fatalf("a Diplomat with no coin removed a river road (err %v)", err)
	}
	if owner, ok := r.s.Roads[road]; !ok || owner != 1 {
		t.Fatal("the refusal took the road anyway")
	}
	for _, e := range r.s.LegalTargetsFor(0).ProgressTargets[string(knights.CardDiplomat)].Edges {
		if e == road {
			t.Fatal("a river road the seat cannot pay to remove is offered to the Diplomat")
		}
	}

	// One coin: the card player pays it, the owner keeps theirs.
	r.x.Coins[0] = 1
	settle(t, r.s)
	if err := r.build(t, diplomatCmd(0, road)); err != nil {
		t.Fatal(err)
	}
	if _, ok := r.s.Roads[road]; ok {
		t.Fatal("the Diplomat did not remove the road")
	}
	if r.x.Coins[0] != 0 {
		t.Fatalf("card player has %d coins after removing a river road, want 0 (paid 1)", r.x.Coins[0])
	}
	if r.x.Coins[1] != 1 {
		t.Fatalf("road owner has %d coins, want 1", r.x.Coins[1])
	}
	if _, still := r.x.PaidEdge[road]; still {
		t.Fatal("the ledger still thinks the removed road is paid for")
	}
}
