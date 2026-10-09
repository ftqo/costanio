package game

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/store"

	"github.com/ftqo/costan.io/engine/islands"

	"github.com/ftqo/costan.io/engine/knights"

	// Register expansion modules so non-base rulesets resolve.
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// ev marshals event data into an engine.Event with the given seq/type.
func ev(seq int, typ engine.EventType, data any) engine.Event {
	raw, err := json.Marshal(data)
	if err != nil {
		panic(err)
	}
	return engine.Event{Seq: seq, Type: typ, Data: raw}
}

// hand builds an engine.Hand from a resource->count (index = Resource).
func hand(res board.Resource, n int) engine.Hand {
	var h engine.Hand
	h[res] = n
	return h
}

// twoPlayerLog builds a minimal but seq-valid event log: a 2-player base game
// with one settlement for seat 0 on a known producing hex, a couple of rolls,
// a production payout, a steal, a discard, a bank trade, a player trade, and a
// finish. It exercises every accumulator in scoreboardFromEvents.
func twoPlayerLog() []engine.Event {
	// Vertex (0,0,N) touches hexes (0,0),(0,-1),(1,-1). Put a wheat-8 at (0,0)
	// and the robber far away so it produces.
	vert := board.Vertex{Q: 0, R: 0, Side: board.N}
	b := &board.Board{
		Radius: 2,
		Tiles: map[board.Hex]board.Tile{
			{Q: 0, R: 0}:  {Res: board.Wheat, Number: 8},
			{Q: 0, R: -1}: {Res: board.ResNone, Number: 0},
			{Q: 1, R: -1}: {Res: board.ResNone, Number: 0},
		},
		Robber: board.Hex{Q: 0, R: -1}, // not adjacent-producing to vert
	}
	return []engine.Event{
		ev(0, engine.EvGameCreated, engine.GameCreatedData{Config: engine.GameConfig{Players: 2, TargetVP: 10, Ruleset: "base"}}),
		ev(1, engine.EvBoardGenerated, engine.BoardGeneratedData{Board: b}),
		ev(2, engine.EvSettlementPlace, engine.SettlementPlacedData{Player: 0, V: vert}),
		ev(3, engine.EvTurnStarted, engine.TurnStartedData{Player: 0}),
		ev(4, engine.EvDiceRolled, engine.DiceRolledData{Player: 0, D1: 4, D2: 4}), // 8
		ev(5, engine.EvResDistributed, engine.ResDistributedData{Gains: []engine.PlayerGain{{Player: 0, Gain: hand(board.Wheat, 1)}}}),
		ev(6, engine.EvDiceRolled, engine.DiceRolledData{Player: 0, D1: 3, D2: 4}), // 7
		ev(7, engine.EvCardsDiscarded, engine.CardsDiscardedData{Player: 1, Cards: hand(board.Wheat, 2)}),
		ev(8, engine.EvCardStolen, engine.CardStolenData{Thief: 0, Victim: 1, Res: board.Wheat}),
		ev(9, engine.EvBankTraded, engine.BankTradedData{Player: 0, Give: hand(board.Wheat, 4), Get: hand(board.Ore, 1)}),
		ev(10, engine.EvTradeExecuted, engine.TradeExecutedData{By: 0, With: 1, Give: hand(board.Ore, 1), Want: hand(board.Sheep, 1)}),
		ev(11, engine.EvTurnStarted, engine.TurnStartedData{Player: 1}),
		ev(12, engine.EvGameFinished, engine.GameFinishedData{Winner: 0, VP: 10}),
	}
}

func TestScoreboardFromEvents(t *testing.T) {
	sb, err := scoreboardFromEvents(twoPlayerLog())
	if err != nil {
		t.Fatalf("scoreboardFromEvents: %v", err)
	}
	if got := sb.Rolls[8]; got != 1 {
		t.Errorf("Rolls[8] = %d, want 1", got)
	}
	if got := sb.Rolls[7]; got != 1 {
		t.Errorf("Rolls[7] = %d, want 1", got)
	}
	if sb.Turns != 2 {
		t.Errorf("Turns = %d, want 2", sb.Turns)
	}
	p0, p1 := sb.Players[0], sb.Players[1]
	if p0.Produced != 1 {
		t.Errorf("p0.Produced = %d, want 1", p0.Produced)
	}
	// Two rolls happen while seat 0 has a settlement on wheat-8 (pip 5/36),
	// robber elsewhere: expected = 2 * 5/36.
	if want := 2 * pipWeight(8); p0.Expected != want {
		t.Errorf("p0.Expected = %v, want %v", p0.Expected, want)
	}
	if p1.RobberLoss != 2 {
		t.Errorf("p1.RobberLoss = %d, want 2", p1.RobberLoss)
	}
	if p0.Steals != 1 || p1.Stolen != 1 {
		t.Errorf("steals: p0.Steals=%d p1.Stolen=%d, want 1/1", p0.Steals, p1.Stolen)
	}
	if p0.BankTrades != 1 {
		t.Errorf("p0.BankTrades = %d, want 1", p0.BankTrades)
	}
	if p0.PlayerTrades != 1 || p1.PlayerTrades != 1 {
		t.Errorf("player trades: p0=%d p1=%d, want 1/1", p0.PlayerTrades, p1.PlayerTrades)
	}
	if sb.Winner != 0 {
		t.Errorf("Winner = %d, want 0", sb.Winner)
	}
}

func TestLuckRelCentersOnTable(t *testing.T) {
	sb := &Scoreboard{Players: []PlayerStat{
		{Produced: 100, Expected: 80}, // dev +20
		{Produced: 92, Expected: 80},  // dev +12
		{Produced: 70, Expected: 82},  // dev -12
		{Produced: 60, Expected: 80},  // dev -20
	}}
	applyLuckRel(sb) // mean dev = 0
	want := []float64{20, 12, -12, -20}
	for i, w := range want {
		if math.Abs(sb.Players[i].LuckRel-w) > 1e-9 {
			t.Errorf("player %d LuckRel = %v, want %v", i, sb.Players[i].LuckRel, w)
		}
	}
	// Uniform hot dice must cancel: add +30 to everyone's production.
	for i := range sb.Players {
		sb.Players[i].Produced += 30
	}
	applyLuckRel(sb) // mean dev = 30, so LuckRel unchanged
	for i, w := range want {
		if math.Abs(sb.Players[i].LuckRel-w) > 1e-9 {
			t.Errorf("after uniform shift player %d LuckRel = %v, want %v", i, sb.Players[i].LuckRel, w)
		}
	}
}

func TestBoardViewFromEvents(t *testing.T) {
	v, err := boardViewFromEvents(twoPlayerLog())
	if err != nil {
		t.Fatalf("boardViewFromEvents: %v", err)
	}
	if v.Phase != engine.PhaseFinished {
		t.Errorf("Phase = %v, want finished", v.Phase)
	}
	if v.Viewer != Spectator {
		t.Errorf("Viewer = %d, want Spectator", v.Viewer)
	}
	if len(v.Buildings) != 1 {
		t.Errorf("Buildings = %d, want 1", len(v.Buildings))
	}
}

// finishedScoreboard plays a seeded 4-player bot game for the given ruleset to
// completion and returns the resulting scoreboard.
func finishedScoreboard(t *testing.T, ruleset string) *Scoreboard {
	t.Helper()
	sb, err := scoreboardFromEvents(finishedEvents(t, ruleset))
	if err != nil {
		t.Fatalf("scoreboardFromEvents: %v", err)
	}
	return sb
}

// finishedEvents plays a seeded 4-player bot game for the given ruleset to
// completion using the real game manager and returns its full event log. It
// mirrors sim.RunGame without importing sim (sim imports game).
func finishedEvents(t *testing.T, ruleset string) []engine.Event {
	t.Helper()
	return finishedEventsSeed(t, ruleset, 42)
}

// finishedEventsSeed is finishedEvents on an explicit seed, for tests that
// need a game where something specific happened. They sweep a few seeds
// rather than pin one, so a change in bot play does not break them.
func finishedEventsSeed(t *testing.T, ruleset string, seed uint64) []engine.Event {
	t.Helper()
	st := openStore(t)

	const (
		players  = 4
		targetVP = 8 // modest target keeps the test quick
		timeout  = 60 * time.Second
	)

	cfg := engine.GameConfig{
		Players:  players,
		Ruleset:  ruleset,
		TargetVP: targetVP,
	}
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	host, err := st.CreateGuest("bot-0")
	if err != nil {
		t.Fatalf("create guest: %v", err)
	}
	gameID := fmt.Sprintf("scoreboard-test-%s-%d", ruleset, seed)
	if err := st.CreateGame(&store.Game{ID: gameID, Ruleset: ruleset, Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		t.Fatalf("create game: %v", err)
	}
	for seat := range players {
		uid := host.ID
		if seat > 0 {
			u, err := st.CreateGuest(fmt.Sprintf("bot-%d", seat))
			if err != nil {
				t.Fatalf("create guest seat %d: %v", seat, err)
			}
			uid = u.ID
		}
		if err := st.AddSeat(gameID, seat, uid); err != nil {
			t.Fatalf("add seat %d: %v", seat, err)
		}
		if err := st.SetSeatStatus(gameID, seat, "bot"); err != nil {
			t.Fatalf("set seat status %d: %v", seat, err)
		}
	}

	mgr := NewManager(st, nil)
	mgr.SetBotFactory(func(engine.PlayerID) CommandSource { return bot.NewSimple() })
	t.Cleanup(mgr.StopAll)

	if err := mgr.Start(gameID, cfg, engine.SeedsFrom(seed)); err != nil {
		t.Fatalf("start game: %v", err)
	}

	deadline := time.Now().Add(timeout)
	for {
		if time.Now().After(deadline) {
			t.Fatalf("finishedEvents: game %q did not finish within %s", gameID, timeout)
		}
		g, err := st.GameByID(gameID)
		if err != nil {
			t.Fatalf("game by id: %v", err)
		}
		switch g.Status {
		case "finished":
			events, err := st.LoadEvents(gameID, 0)
			if err != nil {
				t.Fatalf("load events: %v", err)
			}
			return events
		case "paused-error":
			t.Fatalf("finishedEvents: game %q hit an engine error", gameID)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestIslandsStatPopulated(t *testing.T) {
	events := finishedEvents(t, "base+islands")
	sb, err := scoreboardFromEvents(events)
	if err != nil {
		t.Fatalf("scoreboardFromEvents: %v", err)
	}
	// Replay independently to cross-check ship and gold wiring against the final
	// state, so the assertions can't pass vacuously when those counts are zero.
	final, err := engine.Replay(events)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	ext, ok := islands.StateExt(final)
	if !ok {
		t.Fatalf("islands ext missing from finished islands game")
	}
	wantShips := make([]int, len(final.Players))
	for _, owner := range ext.Ships {
		wantShips[owner]++
	}
	// Count GoldGained independently from the event log (EvGoldChosen events).
	wantGold := make([]int, len(final.Players))
	for _, e := range events {
		if e.Type == islands.EvGoldChosen {
			var d struct {
				Player engine.PlayerID `json:"player"`
				Gain   engine.Hand     `json:"gain"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatalf("unmarshal EvGoldChosen: %v", err)
			}
			if int(d.Player) < len(wantGold) {
				wantGold[d.Player] += d.Gain.Count()
			}
		}
	}

	for _, p := range sb.Players {
		if p.Islands == nil {
			t.Fatalf("seat %d missing Islands block in islands game", p.Seat)
		}
		// Island VP matches the breakdown row.
		if p.Islands.IslandVP != p.VPBreakdown.IslandVP {
			t.Errorf("seat %d island VP mismatch: stat %d vs breakdown %d", p.Seat, p.Islands.IslandVP, p.VPBreakdown.IslandVP)
		}
		// Ships match the count on the final board.
		if p.Islands.Ships != wantShips[p.Seat] {
			t.Errorf("seat %d ships: stat %d vs final board %d", p.Seat, p.Islands.Ships, wantShips[p.Seat])
		}
		// GoldGained must match the independent count, which catches a drop or
		// double-count even when the value is zero.
		if p.Islands.GoldGained != wantGold[p.Seat] {
			t.Errorf("seat %d gold gained: stat %d vs event replay %d", p.Seat, p.Islands.GoldGained, wantGold[p.Seat])
		}
	}
	// A base game must not populate the islands block.
	base := finishedScoreboard(t, "base")
	for _, p := range base.Players {
		if p.Islands != nil {
			t.Errorf("seat %d has Islands block in base game", p.Seat)
		}
	}
}

func TestVPBreakdownSumsToVP_Base(t *testing.T) {
	// Play a base bot game to a finish and assert each player's breakdown sums
	// to their reported VP.
	sb := finishedScoreboard(t, "base") // see helper note below
	for _, p := range sb.Players {
		b := p.VPBreakdown
		got := b.Settlements + 2*b.Cities + b.LongestRoad + b.LargestArmy + b.DevVP
		if got != p.VP {
			t.Errorf("seat %d breakdown %d != VP %d (%+v)", p.Seat, got, p.VP, b)
		}
	}
}

// vpBreakdownSum totals a breakdown the same way the post-game standings table
// does: every field is already a VP figure except Cities, which is a count of
// cities worth 2 apiece.
func vpBreakdownSum(b VPBreakdown) int {
	return b.Settlements + 2*b.Cities + b.LongestRoad + b.LargestArmy + b.DevVP +
		b.IslandVP + b.Metropolis + b.Defender + b.Merchant + b.ExtraKnights + b.Caravan +
		b.Harbormaster + b.Wealth +
		b.Delivered + b.WagonLevel +
		b.Prisoners + b.Conquered +
		b.ExplorerHarbours + b.Missions
}

// The standings screen presents the breakdown as a complete ledger, so every
// VP source needs a row. Assert the sum for every ruleset that scores outside
// the base sources.
func TestVPBreakdownSumsToVP_Modules(t *testing.T) {
	for _, ruleset := range []string{"base+islands", "base+cak", "base+fishermen", "base+caravans",
		"base+harbormaster", "base+cak+harbormaster", "base+wagons", "base+raiders", "explorers",
		"cak+explorers", "base+rivers", "base+fishermen+rivers"} {
		t.Run(ruleset, func(t *testing.T) {
			sb := finishedScoreboard(t, ruleset)
			for _, p := range sb.Players {
				if got := vpBreakdownSum(p.VPBreakdown); got != p.VP {
					t.Errorf("seat %d breakdown %d != VP %d (%+v)", p.Seat, got, p.VP, p.VPBreakdown)
				}
			}
		})
	}
}

// Knights replaces the base dev deck with progress cards, so nobody holds a
// hidden VP card. DevVP is the leftover between total and public VP, so a
// nonzero value means module points no row claimed.
func TestVPBreakdownNoStrayDevVPUnderKnights(t *testing.T) {
	sb := finishedScoreboard(t, "base+cak")
	for _, p := range sb.Players {
		if p.VPBreakdown.DevVP != 0 {
			t.Errorf("seat %d has %d unattributed VP under cak (%+v)", p.Seat, p.VPBreakdown.DevVP, p.VPBreakdown)
		}
	}
}

func TestFishStatPopulated(t *testing.T) {
	events := finishedEvents(t, "base+fishermen")
	sb, err := scoreboardFromEvents(events)
	if err != nil {
		t.Fatalf("scoreboardFromEvents: %v", err)
	}

	// Count Spent independently from the event log (EvFishSpent events). The
	// seeded game spends zero fish, but a wrongly accumulated value would still
	// diverge.
	type fishSpentData struct {
		Player  engine.PlayerID `json:"player"`
		Discard [3]int          `json:"discard"`
	}
	wantSpent := make([]int, len(sb.Players))
	for _, e := range events {
		if e.Type == "tab_fish_spent" {
			var d fishSpentData
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatalf("unmarshal tab_fish_spent: %v", err)
			}
			if int(d.Player) < len(wantSpent) {
				wantSpent[d.Player] += d.Discard[0] + 2*d.Discard[1] + 3*d.Discard[2]
			}
		}
	}

	bootHolders := 0
	for _, p := range sb.Players {
		if p.Fish == nil {
			t.Fatalf("seat %d missing Fish block", p.Seat)
		}
		if p.Fish.Value != p.Fish.Caught[0]+2*p.Fish.Caught[1]+3*p.Fish.Caught[2] {
			t.Errorf("seat %d fish value %d != weighted caught %v", p.Seat, p.Fish.Value, p.Fish.Caught)
		}
		// Spent must match the independent count; a dropped or double-counted
		// EvFishSpent would fail even at zero.
		if p.Fish.Spent != wantSpent[p.Seat] {
			t.Errorf("seat %d fish spent: stat %d vs event replay %d", p.Seat, p.Fish.Spent, wantSpent[p.Seat])
		}
		if p.Fish.HasBoot {
			bootHolders++
		}
	}
	if bootHolders > 1 {
		t.Errorf("more than one boot holder: %d", bootHolders)
	}
}

func TestCaravanStatPopulated(t *testing.T) {
	// Sweep seeds until a game placed a camel, since whether bots reach one
	// depends on the board. The assertion still demands a real placement.
	totalCamels := 0
	for _, seed := range []uint64{42, 43, 44, 45} {
		sb, err := scoreboardFromEvents(finishedEventsSeed(t, "base+caravans", seed))
		if err != nil {
			t.Fatalf("scoreboardFromEvents: %v", err)
		}
		for _, p := range sb.Players {
			if p.Caravans == nil {
				t.Fatalf("seed %d seat %d missing Caravans block", seed, p.Seat)
			}
			if p.VPBreakdown.Caravan != p.Caravans.CaravanVP {
				t.Errorf("seed %d seat %d caravan VP row %d != stat %d", seed, p.Seat, p.VPBreakdown.Caravan, p.Caravans.CaravanVP)
			}
			b := p.VPBreakdown
			got := b.Settlements + 2*b.Cities + b.LongestRoad + b.LargestArmy + b.DevVP + b.Caravan
			if got != p.VP {
				t.Errorf("seed %d seat %d caravans breakdown %d != VP %d (%+v)", seed, p.Seat, got, p.VP, b)
			}
			totalCamels = p.Caravans.CamelsPlaced // game-wide total, same for every seat
		}
		if totalCamels > 0 {
			break
		}
	}
	// At least one camel must have been placed. CamelsPlaced is game-wide and
	// stored identically on every seat.
	if totalCamels == 0 {
		t.Errorf("caravans module placed no camels in any seeded game (CamelsPlaced=0)")
	}
	// A base game must not populate the Caravans block.
	base := finishedScoreboard(t, "base")
	for _, p := range base.Players {
		if p.Caravans != nil {
			t.Errorf("seat %d has Caravans block in base game", p.Seat)
		}
	}
}

func TestKnightsStatPopulatedAndBaseStatsZero(t *testing.T) {
	sb := finishedScoreboard(t, "base+cak")
	for _, p := range sb.Players {
		if p.KnightsStats == nil {
			t.Fatalf("seat %d missing Cak block in knights game", p.Seat)
		}
		// Base dev/army concepts must be zero/false in a knights game.
		if p.Knights != 0 || p.DevCards != 0 || p.HasLargestArmy {
			t.Errorf("seat %d leaked base dev/army stats: knights=%d dev=%d army=%v", p.Seat, p.Knights, p.DevCards, p.HasLargestArmy)
		}
		// Metropolis VP row = 2 per metropolis.
		if p.VPBreakdown.Metropolis != 2*p.KnightsStats.Metropolis {
			t.Errorf("seat %d metropolis VP %d != 2*%d", p.Seat, p.VPBreakdown.Metropolis, p.KnightsStats.Metropolis)
		}
		// VP breakdown still sums to VP for cak.
		b := p.VPBreakdown
		got := b.Settlements + 2*b.Cities + b.LongestRoad + b.Metropolis + b.Defender + b.Merchant + b.ExtraKnights
		if got != p.VP {
			t.Errorf("seat %d cak breakdown %d != VP %d (%+v)", p.Seat, got, p.VP, b)
		}
	}
}

// TestCommoditiesProducedExcludesShortfall: the adjust event's Count is not
// how many commodities arrived; Short is how many the finite supply could not
// pay, so the scoreboard counts Count - Short. Events logged before the
// supply was finite omit Short (decodes as 0) and score as before.
func TestCommoditiesProducedExcludesShortfall(t *testing.T) {
	events := []engine.Event{
		ev(0, engine.EvGameCreated, engine.GameCreatedData{
			Config: engine.GameConfig{Players: 2, Ruleset: "base+cak"}, Seed: 1,
		}),
		// Seat 0: two conversions paid in full. Seat 1: two owed, one paid.
		ev(1, knights.EvCommodityAdjust, map[string]any{
			"player": 0, "res": "sheep", "commodity": 0, "count": 2,
		}),
		ev(2, knights.EvCommodityAdjust, map[string]any{
			"player": 1, "res": "ore", "commodity": 2, "count": 2, "short": 1,
		}),
		// And one wholly withheld, which must add nothing at all.
		ev(3, knights.EvCommodityAdjust, map[string]any{
			"player": 1, "res": "wood", "commodity": 1, "count": 1, "short": 1,
		}),
		ev(4, engine.EvGameFinished, engine.GameFinishedData{Winner: 0, VP: 13}),
	}
	sb, err := scoreboardFromEvents(events)
	if err != nil {
		t.Fatalf("scoreboardFromEvents: %v", err)
	}
	if sb.Players[0].KnightsStats == nil || sb.Players[1].KnightsStats == nil {
		t.Fatal("no Knights stat block on a base+cak scoreboard")
	}
	if got := sb.Players[0].KnightsStats.CommoditiesProduced; got != 2 {
		t.Errorf("seat 0 produced %d commodities, want 2 (nothing was short)", got)
	}
	if got := sb.Players[1].KnightsStats.CommoditiesProduced; got != 1 {
		t.Errorf("seat 1 produced %d commodities, want 1 (2 owed with 1 short, then 1 wholly withheld)", got)
	}
}

// The VP track has one row per turn plus a closing row, one column per seat in
// every row, and its last row equals the final standings, so the winning point
// is included.
func TestScoreboardVPTrack(t *testing.T) {
	sb, err := scoreboardFromEvents(twoPlayerLog())
	if err != nil {
		t.Fatalf("scoreboardFromEvents: %v", err)
	}
	if got, want := len(sb.VPTrack), sb.Turns+1; got != want {
		t.Fatalf("len(VPTrack) = %d, want %d (one per turn plus the close)", got, want)
	}
	for i, row := range sb.VPTrack {
		if len(row) != len(sb.Players) {
			t.Errorf("VPTrack[%d] has %d seats, want %d", i, len(row), len(sb.Players))
		}
	}
	last := sb.VPTrack[len(sb.VPTrack)-1]
	for i, p := range sb.Players {
		if last[i] != p.VP {
			t.Errorf("VPTrack ends seat %d on %d, but the scoreboard says %d", i, last[i], p.VP)
		}
	}
}

// A log with no turns in it produces no track at all rather than an empty row,
// so the client can test for absence and draw nothing.
func TestScoreboardVPTrackAbsentWithoutPlayers(t *testing.T) {
	sb, err := scoreboardFromEvents(nil)
	if err != nil {
		t.Fatalf("scoreboardFromEvents: %v", err)
	}
	if len(sb.VPTrack) != 0 {
		t.Errorf("VPTrack = %v, want none", sb.VPTrack)
	}
}
