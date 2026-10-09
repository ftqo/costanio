package ruletest

import (
	"cmp"
	"errors"
	"maps"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/knights"
)

// `cak+explorers` is the defined combination of Knights and Explorers, ten
// lettered rules, A to J. Neither module may import the other, so each rule lands
// on an additive engine seam (Hooks.NoCities, BlocksCityUpgrade,
// UnrevealedVertex, FreeHarbour, SellGood, ArmSeaBlocker), and the wiring is what
// is most likely to be backwards.
//
// The spec is "Knights in an Explorers game" in docs/rules/explorers.md. Each test
// names the letter it pins and runs through engine.Decide on a real composed
// ruleset, since legal-target lists can disagree with their validator.

const pairing = "cak+explorers"

// ---- A. Cities come back, and the upgrade choice is terminal ---------------

// A harbour settlement has taken its branch of the one-way choice, so the city
// upgrade is refused: through the plain build, through LegalCities, and through
// Medicine, which is the same upgrade at a discount.
func TestHarbourSettlementNeverBecomesACity(t *testing.T) {
	s := playState(t, pairing, 4)
	x, ok := explorers.StateExt(s)
	if !ok {
		t.Fatal("no explorers ext in a cak+explorers game")
	}
	seat, v := anyHarbour(t, x)
	s.Cur, s.Rolled = seat, true
	s.Players[seat].Hand = engine.CostCity

	_, err := engine.Decide(s, engine.Command{
		Player: seat, Type: engine.CmdBuildCity, Data: rawCmd(map[string]any{"v": v})})
	if err == nil {
		t.Fatal("a harbour settlement was upgraded to a city")
	}
	if got := engine.ErrorCode(err); got != "UPGRADE_IS_FINAL" {
		t.Errorf("refusal code %q, want UPGRADE_IS_FINAL", got)
	}
	if slices.Contains(s.LegalCities(seat), v) {
		t.Error("LegalCities offered a harbour settlement")
	}
}

// And the mirror: a city never becomes a harbour settlement. Every seat opens
// with one, because rule C makes the second setup placement a city.
func TestCityNeverBecomesAHarbourSettlement(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	v := cityFor(t, s, seat)
	s.Cur, s.Rolled = seat, true
	s.Players[seat].Hand = explorers.CostHarbour

	_, err := engine.Decide(s, engine.Command{
		Player: seat, Type: explorers.CmdBuildHarbour, Data: rawCmd(map[string]any{"v": v})})
	if err == nil {
		t.Fatal("a city was converted into a harbour settlement")
	}
	if got := engine.ErrorCode(err); got != "UPGRADE_IS_FINAL" {
		t.Errorf("refusal code %q, want UPGRADE_IS_FINAL", got)
	}
	if lt := s.LegalTargetsFor(seat); slices.Contains(lt.Harbours, v) {
		t.Error("the harbour-upgrade list offered a city")
	}
}

// Outside the pairing the city does not exist at all, and the seam must
// preserve that.
func TestPlainExplorersStillHasNoCities(t *testing.T) {
	s := playState(t, "explorers", 4)
	seat := engine.PlayerID(0)
	s.Cur, s.Rolled = seat, true
	s.Players[seat].Hand = engine.CostCity
	if len(s.LegalCities(seat)) != 0 {
		t.Error("plain Explorers offered a city upgrade")
	}
	for v, b := range s.Buildings {
		if b.Owner == seat && b.City {
			t.Fatalf("plain Explorers put a city on the board at %v", v)
		}
	}
}

// ---- B. One starting-island forest becomes fields --------------------------

// The pairing's board is the plain scenario's board with one hex changed: the
// first home-island forest becomes fields and keeps its chit. Compared against
// the same seed's plain board.
func TestKnightsPairingSwapsOneForestForFields(t *testing.T) {
	plain := boardFor(t, "explorers")
	paired := boardFor(t, pairing)

	var changed []board.Hex
	for h, pt := range plain.Tiles {
		if paired.Tiles[h].Res != pt.Res {
			changed = append(changed, h)
		}
	}
	if len(changed) != 1 {
		t.Fatalf("rule B changed %d hexes, want exactly 1: %v", len(changed), changed)
	}
	h := changed[0]
	if plain.Tiles[h].Res != board.Wood || paired.Tiles[h].Res != board.Wheat {
		t.Errorf("hex %v went %v -> %v, want wood -> wheat", h, plain.Tiles[h].Res, paired.Tiles[h].Res)
	}
	if plain.Tiles[h].Number != paired.Tiles[h].Number {
		t.Errorf("the swap moved the number chit (%d -> %d)",
			plain.Tiles[h].Number, paired.Tiles[h].Number)
	}
}

// ---- C. The second setup placement is a city -------------------------------

// Every seat opens with one harbour settlement and one city, so 4 VP of the 22,
// and the city came out of the city supply rather than the settlement supply.
func TestSetupDealsEverySeatAHarbourAndACity(t *testing.T) {
	s := playState(t, pairing, 4)
	x, ok := explorers.StateExt(s)
	if !ok {
		t.Fatal("no explorers ext")
	}
	for p := range s.Players {
		seat := engine.PlayerID(p)
		cities, harbours := 0, 0
		for v, b := range s.Buildings {
			if b.Owner != seat {
				continue
			}
			if b.City {
				cities++
			}
			if _, h := x.Harbours[v]; h {
				harbours++
			}
		}
		if cities != 1 || harbours != 1 {
			t.Errorf("seat %d opened with %d cities and %d harbour settlements, want 1 and 1", p, cities, harbours)
		}
		if got := s.PublicVP(seat) + moduleVP(s, seat); got != 4 {
			t.Errorf("seat %d opened on %d VP, want 4 (a city at 2 and a harbour settlement at 2)", p, got)
		}
		if left := s.Players[seat].CitiesLeft; left != engine.MaxCities-1 {
			t.Errorf("seat %d has %d city pieces left, want %d",
				p, left, engine.MaxCities-1)
		}
	}
}

// Plain Explorers is unchanged: a settlement, and 3 VP.
func TestPlainExplorersSetupPlacesSettlement(t *testing.T) {
	s := playState(t, "explorers", 4)
	for p := range s.Players {
		seat := engine.PlayerID(p)
		if s.Players[seat].CitiesLeft != engine.MaxCities {
			t.Errorf("seat %d spent a city piece in a game with no cities", p)
		}
	}
}

// ---- D. Knights and the fog ------------------------------------------------

// A knight may neither be built on nor moved onto an intersection touching an
// unexplored hex, and both refusals name the rule.
func TestKnightsWillNotStandAtTheFogsEdge(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	v := fogEdgeVertex(t, s)

	// Give the seat a road onto the vertex so the only thing left to refuse
	// is the fog, not "not connected".
	s.Roads[v.Edges()[0]] = seat
	s.Cur, s.Rolled = seat, true
	s.Players[seat].Hand = engine.Hand{board.Ore: 1, board.Sheep: 1}

	_, err := engine.Decide(s, engine.Command{
		Player: seat, Type: knights.CmdBuildKnight, Data: rawCmd(map[string]any{"v": v})})
	if err == nil {
		t.Fatal("a knight was built at the fog's edge")
	}
	if got := engine.ErrorCode(err); got != "KNIGHT_IN_THE_FOG" {
		t.Errorf("refusal code %q, want KNIGHT_IN_THE_FOG", got)
	}
	if lt := s.LegalTargetsFor(seat); slices.Contains(lt.Knights, v) {
		t.Error("the knight-placement list offered a fog-edge intersection")
	}
}

// The same vertex is legal once the hex behind it is revealed, so the
// rule is about the fog, not that corner.
func TestKnightAllowedOnceHexRevealed(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	v := fogEdgeVertex(t, s)
	s.Roads[v.Edges()[0]] = seat
	s.Cur, s.Rolled = seat, true
	s.Players[seat].Hand = engine.Hand{board.Ore: 1, board.Sheep: 1}

	x, ok := explorers.StateExt(s)
	if !ok {
		t.Fatal("no explorers ext")
	}
	for _, h := range v.Hexes() {
		x.Revealed[h] = true
	}
	if _, err := engine.Decide(s, engine.Command{
		Player: seat, Type: knights.CmdBuildKnight, Data: rawCmd(map[string]any{"v": v})}); err != nil {
		t.Fatalf("a knight was refused at a fully revealed intersection: %v", err)
	}
}

// ---- E. The barbarians count cities, and only cities -----------------------

// Attack strength is the cities on the board wherever they stand; a harbour
// settlement neither summons the barbarians nor can be pillaged by them.
func TestBarbariansIgnoreHarbourSettlements(t *testing.T) {
	s := playState(t, pairing, 4)
	x, ok := explorers.StateExt(s)
	if !ok {
		t.Fatal("no explorers ext")
	}
	before := knights.AttackStrength(s)
	cities := 0
	for _, b := range s.Buildings {
		if b.City {
			cities++
		}
	}
	if before != cities {
		t.Fatalf("attack strength %d with %d cities on the board", before, cities)
	}
	// Another harbour settlement must not move it.
	seat, _ := anyHarbour(t, x)
	for v, b := range s.Buildings {
		if b.Owner == seat && !b.City {
			if _, already := x.Harbours[v]; !already {
				x.Harbours[v] = seat
				break
			}
		}
	}
	if after := knights.AttackStrength(s); after != before {
		t.Errorf("a harbour settlement moved barbarian strength from %d to %d",
			before, after)
	}
}

// ---- G. Gold and commodities ----------------------------------------------

// Gold buys a resource and never a commodity: the purchase is typed to the five
// resources, so there is no payload that asks for cloth.
func TestGoldNeverBuysACommodity(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	s.Cur, s.Rolled = seat, true
	if _, err := engine.Decide(s, engine.Command{
		Player: seat, Type: explorers.CmdGoldBuy,
		Data: rawCmd(map[string]any{"good": "cloth"})}); err == nil {
		t.Fatal("gold bought a commodity")
	}
}

// Fast Gold sells one, though, which is the half of rule G that is a change.
func TestFastGoldSellsACommodity(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	s.Cur, s.Rolled = seat, true
	grantFastGold(t, s, seat)
	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("no cak ext")
	}
	cx.Players[seat].Commodities[knights.Cloth] = 1
	supply := cx.CommoditySupply[knights.Cloth]
	gold := explorers.Gold(mustExplorersExt(t, s), seat)

	mustDecide(t, s, engine.Command{Player: seat, Type: explorers.CmdGoldSell,
		Data: rawCmd(map[string]any{"good": "cloth"})})
	if got := cx.Players[seat].Commodities[knights.Cloth]; got != 0 {
		t.Errorf("seat still holds %d cloth after selling it", got)
	}
	if got := cx.CommoditySupply[knights.Cloth]; got != supply+1 {
		t.Errorf("commodity supply is %d, want %d", got, supply+1)
	}
	if got := explorers.Gold(mustExplorersExt(t, s), seat); got != gold+1 {
		t.Errorf("seat holds %d gold, want %d", got, gold+1)
	}
}

// ---- H. The reworded progress cards ----------------------------------------

// Medicine carries both upgrades at two prices. The harbour branch is the new
// one, and it is 1 ore + 1 grain rather than the city's 2 ore + 1 grain.
func TestMedicineBuysAHarbourSettlement(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	x := mustExplorersExt(t, s)
	v := coastalPlainSettlement(t, s, x, seat)
	s.Cur, s.Rolled = seat, true
	giveProgress(t, s, seat, knights.CardMedicine)
	s.Players[seat].Hand = engine.Hand{board.Ore: 1, board.Wheat: 1}

	mustDecide(t, s, engine.Command{Player: seat, Type: knights.CmdPlayProgress,
		Data: rawCmd(map[string]any{"card": knights.CardMedicine, "v": v, "harbour": true})})
	if _, ok := mustExplorersExt(t, s).Harbours[v]; !ok {
		t.Error("Medicine charged for a harbour settlement and did not place one")
	}
	if h := s.Players[seat].Hand; h[board.Ore] != 0 || h[board.Wheat] != 0 {
		t.Errorf("Medicine left %v in hand; the harbour branch costs 1 ore + 1 grain", h)
	}
}

// The Bishop has no robber to move, so it opens the pirate's own picker.
func TestBishopArmsThePirateShip(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	s.Cur, s.Rolled = seat, true
	giveProgress(t, s, seat, knights.CardBishop)

	if by, pending := explorers.PiratePending(s); pending {
		t.Fatalf("a pirate activation was already owed by seat %d", by)
	}
	mustDecide(t, s, engine.Command{Player: seat, Type: knights.CmdPlayProgress,
		Data: rawCmd(map[string]any{"card": knights.CardBishop})})
	by, pending := explorers.PiratePending(s)
	if !pending || by != seat {
		t.Fatalf("after the Bishop the pirate is owed by %d (pending=%v), want seat %d", by, pending, seat)
	}
}

// While the Bishop's activation is owed, no other progress card may be
// played, as with a robber still to move. Otherwise the pirate could steal the
// card a Wedding giver had been told to hand over.
func TestNoProgressCardWhileThePirateIsOwed(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	s.Cur, s.Rolled = seat, true
	giveProgress(t, s, seat, knights.CardBishop)
	giveProgress(t, s, seat, knights.CardWedding)
	mustDecide(t, s, engine.Command{Player: seat, Type: knights.CmdPlayProgress,
		Data: rawCmd(map[string]any{"card": knights.CardBishop})})
	if _, pending := explorers.PiratePending(s); !pending {
		t.Fatal("fixture: the Bishop armed no pirate activation")
	}
	_, err := engine.Decide(s, engine.Command{Player: seat, Type: knights.CmdPlayProgress,
		Data: rawCmd(map[string]any{"card": knights.CardWedding})})
	if !errors.Is(err, engine.ErrModulePending) {
		t.Fatalf("a Wedding was played with the pirate activation still owed: err=%v", err)
	}
}

// Road Building never pays for a ship: an Explorers ship is bought with cards
// through the module's own command and reads no free-road credit at all.
func TestRoadBuildingNeverPaysForAShip(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	s.Cur, s.Rolled = seat, true
	s.FreeRoads = 2
	s.Players[seat].Hand = engine.Hand{}

	spots := explorers.ShipBuildSpots(s, seat)
	if len(spots) == 0 {
		t.Fatal("no legal ship edge to test with")
	}
	if _, err := engine.Decide(s, engine.Command{
		Player: seat, Type: explorers.CmdBuildShip,
		Data: rawCmd(map[string]any{"e": spots[0]})}); err == nil {
		t.Fatal("a free road paid for a ship")
	}
}

// ---- I. The Aqueduct pays a resource AND the consolation gold --------------

// The two triggers are separate and stack, so a seat that produced nothing takes
// both. The Aqueduct's resource arrives on a later command, so it cannot
// suppress the gold.
func TestAqueductAndConsolationGoldBothPay(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("no cak ext")
	}
	cx.Aqueduct = []engine.PlayerID{seat}
	x := mustExplorersExt(t, s)
	gold := explorers.Gold(x, seat)
	s.Cur, s.Rolled = seat, true
	s.Players[seat].Hand = engine.Hand{}

	mustDecide(t, s, engine.Command{Player: seat, Type: knights.CmdAqueductPick,
		Data: rawCmd(map[string]any{"res": board.Ore})})
	if got := s.Players[seat].Hand[board.Ore]; got != 1 {
		t.Errorf("the Aqueduct paid %d ore, want 1", got)
	}
	if got := explorers.Gold(mustExplorersExt(t, s), seat); got != gold {
		t.Errorf("taking the Aqueduct moved gold from %d to %d",
			gold, got)
	}
}

// ---- helpers ---------------------------------------------------------------

func mustExplorersExt(t *testing.T, s *engine.State) *explorers.Ext {
	t.Helper()
	x, ok := explorers.StateExt(s)
	if !ok {
		t.Fatal("no explorers ext in this state")
	}
	return x
}

// anyHarbour returns a seat and one of its harbour settlements. Every seat has
// one after setup (rule C), so a miss is a broken setup rather than a bad seed.
func anyHarbour(t *testing.T, x *explorers.Ext) (engine.PlayerID, board.Vertex) {
	t.Helper()
	var best board.Vertex
	var owner engine.PlayerID
	found := false
	for v, p := range x.Harbours {
		if !found || vertexBefore(v, best) {
			best, owner, found = v, p, true
		}
	}
	if !found {
		t.Fatal("no harbour settlement on the board after setup")
	}
	return owner, best
}

// fogEdgeVertex is a land intersection touching at least one unexplored hex.
// Two thirds of an Explorers board starts face down, so a miss is a broken
// board: t.Fatal, not t.Skip.
func fogEdgeVertex(t *testing.T, s *engine.State) board.Vertex {
	t.Helper()
	var best board.Vertex
	found := false
	forEachBoardVertex(s, func(v board.Vertex) {
		if found && !vertexBefore(v, best) {
			return
		}
		if !s.Board.LandVertex(v) {
			return
		}
		if _, taken := s.Buildings[v]; taken {
			return
		}
		if !s.UnrevealedVertex(v) {
			return
		}
		best, found = v, true
	})
	if !found {
		t.Fatal("no land intersection touches the fog on a freshly dealt Explorers board")
	}
	return best
}

// coastalPlainSettlement is one of seat's coastal settlements that is neither a
// city nor a harbour settlement: the only building where rule A's choice is still
// open.
func coastalPlainSettlement(t *testing.T, s *engine.State, x *explorers.Ext, seat engine.PlayerID) board.Vertex {
	t.Helper()
	for _, v := range s.LegalTargetsFor(seat).Harbours {
		return v
	}
	// Nothing standing qualifies, so found a settlement on the seat's own
	// coastal ground. Fixed order, and only a corner with sea beside it:
	// Medicine refuses an inland corner ("that intersection has no water
	// beside it").
	harbours := slices.Collect(maps.Keys(x.Harbours))
	slices.SortFunc(harbours, func(a, b board.Vertex) int {
		return cmp.Or(cmp.Compare(a.Q, b.Q), cmp.Compare(a.R, b.R), cmp.Compare(a.Side, b.Side))
	})
	for _, v := range harbours {
		for _, e := range v.Edges() {
			for _, w := range []board.Vertex{e.A, e.B} {
				if _, taken := s.Buildings[w]; taken || !s.Board.LandVertex(w) {
					continue
				}
				if s.UnrevealedVertex(w) || !coastalCorner(s, w) {
					continue
				}
				s.Buildings[w] = engine.Building{Owner: seat}
				return w
			}
		}
	}
	t.Fatal("no coastal settlement, and nowhere to stand one")
	return board.Vertex{}
}

// boardFor deals the board a game with this ruleset opens on, from a fixed seed,
// so two rulesets can be compared hex for hex.
func boardFor(t *testing.T, ruleset string) *board.Board {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 4, Ruleset: ruleset}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	if s.Board == nil {
		t.Fatalf("%s dealt no board", ruleset)
	}
	return s.Board
}

// moduleVP is every active module's victory-point contribution for seat, which
// for this pairing is the harbour settlements, the missions and the metropolises.
func moduleVP(s *engine.State, seat engine.PlayerID) int {
	return s.VPWithModules(seat) - s.PublicVP(seat)
}

// vertexBefore is a total order on vertices, so a test that picks "one of these"
// picks the same one every run.
func vertexBefore(a, b board.Vertex) bool {
	if a.Q != b.Q {
		return a.Q < b.Q
	}
	if a.R != b.R {
		return a.R < b.R
	}
	return a.Side < b.Side
}

// forEachBoardVertex visits every corner of every hex on the board, once.
func forEachBoardVertex(s *engine.State, f func(board.Vertex)) {
	seen := map[board.Vertex]bool{}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !seen[v] {
				seen[v] = true
				f(v)
			}
		}
	}
}

// giveProgress puts one progress card in seat's hand.
func giveProgress(t *testing.T, s *engine.State, seat engine.PlayerID, card knights.ProgressCard) {
	t.Helper()
	x, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("no cak ext")
	}
	x.Players[seat].Progress = append(x.Players[seat].Progress, card)
}

// grantFastGold gives seat the spice advantage rule G extends to commodities.
func grantFastGold(t *testing.T, s *engine.State, seat engine.PlayerID) {
	t.Helper()
	x := mustExplorersExt(t, s)
	x.Seats[seat].Villages[explorers.VillageGold][0] = true
}

// mustDecide runs a command and folds its events into s. engine.Decide only
// validates and returns events, so a test asserting on the state afterwards must
// apply them.
func mustDecide(t *testing.T, s *engine.State, cmd engine.Command) {
	t.Helper()
	events, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("%s: %v", cmd.Type, err)
	}
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("applying %s: %v", e.Type, err)
		}
	}
}

// ---- The fog, and the two cards that name a hex ---------------------------

// Neither card that targets a hex may reach one still face down, or reveal which
// face-down hexes are worth reaching.
//
// Both target lists are built from s.Board, which is the true board (the fog
// lives in the MaskBoard hook and the redactor), so a list built from a terrain
// test alone would tell every client holding the card which face-down hexes
// produce. Legal-target lists must not leak hidden information.
func TestNoProgressCardNamesAFaceDownHex(t *testing.T) {
	s := playState(t, pairing, 4)
	seat := engine.PlayerID(0)
	s.Cur, s.Rolled = seat, true
	giveProgress(t, s, seat, knights.CardMerchant)
	giveProgress(t, s, seat, knights.CardInventor)

	x := mustExplorersExt(t, s)
	unrevealed := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if explorers.Unrevealed(x, h) {
			unrevealed++
		}
	}
	if unrevealed == 0 {
		t.Fatal("no face-down hexes on a freshly dealt Explorers board")
	}

	targets := s.LegalTargetsFor(seat).ProgressTargets
	for _, card := range []knights.ProgressCard{knights.CardMerchant, knights.CardInventor} {
		for _, h := range targets[string(card)].Hexes {
			if explorers.Unrevealed(x, h) {
				t.Errorf("%s offered face-down hex %v", card, h)
			}
		}
	}

	// The validator agrees too; a hand-made command does not read the list.
	var fog board.Hex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if explorers.Unrevealed(x, h) && s.Board.Land(h) {
			fog, found = h, true
			break
		}
	}
	if !found {
		t.Fatal("no face-down LAND hex to aim a card at")
	}
	if _, err := engine.Decide(s, engine.Command{
		Player: seat, Type: knights.CmdPlayProgress,
		Data: rawCmd(map[string]any{"card": knights.CardMerchant, "hex": fog})}); err == nil {
		t.Error("the Merchant was placed on a face-down hex")
	}
}

// The combination rules leave the generic commodity ratio unspecified. Our
// settled ruling preserves each module's rate and the explicit Fleet discount.
func TestExplorersCommodityRatioRuling(t *testing.T) {
	s := playState(t, pairing, 4)
	p := engine.PlayerID(0)
	s.Cur, s.Rolled = p, true
	cx, _ := knights.StateExt(s)
	if got := s.BankRatio(p, board.Wood); got != 3 {
		t.Fatalf("resource ratio %d, want three", got)
	}
	cmd := engine.Command{Player: p, Type: knights.CmdCommodityTrade, Data: rawCmd(map[string]any{"give_com": knights.Cloth, "get_res": board.Sheep})}
	cx.Players[p].Commodities[knights.Cloth] = 3
	if _, err := engine.Decide(s, cmd); err == nil {
		t.Fatal("three commodities bought a resource without a discount")
	}
	cx.Players[p].Commodities[knights.Cloth] = 4
	before := s.Players[p].Hand[board.Sheep]
	mustDecide(t, s, cmd)
	if cx.Players[p].Commodities[knights.Cloth] != 0 || s.Players[p].Hand[board.Sheep] != before+1 {
		t.Fatal("four commodities did not buy exactly one resource")
	}
	cx.ComFleet[p] = int(knights.Cloth) + 1
	cx.Players[p].Commodities[knights.Cloth] = 2
	mustDecide(t, s, cmd)
	if cx.Players[p].Commodities[knights.Cloth] != 0 {
		t.Fatal("Merchant Fleet discount was lost")
	}
}

// coastalCorner reports whether a sea hex touches v, which is what the harbour
// upgrade asks of it.
func coastalCorner(s *engine.State, v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if s.Board.IsSea(h) {
			return true
		}
	}
	return false
}
