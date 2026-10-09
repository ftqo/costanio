package game

import (
	"encoding/json"
	"slices"
	"strings"

	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/harbormaster"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/engine/wagons"
	"github.com/ftqo/costan.io/store"
	"github.com/ftqo/costan.io/timings"
)

// VPBreakdown holds per-source victory-point counts for one seat. Base sources
// (settlements, cities, longest road, largest army, hidden VP dev cards) are
// filled by scoreboardFromEvents; module rows (island VP, metropolis,
// defender, merchant, caravan and the rest) by the module blocks after the
// fold.
type VPBreakdown struct {
	Settlements  int `json:"settlements"`  // 1 each
	Cities       int `json:"cities"`       // 2 each (multiplied at read time)
	LongestRoad  int `json:"longest_road"` // 2 if held, else 0
	LargestArmy  int `json:"largest_army"` // 2 if held, else 0 (base/islands)
	DevVP        int `json:"dev_vp"`       // hidden VP dev cards (base/islands)
	IslandVP     int `json:"island_vp"`    // islands
	Metropolis   int `json:"metropolis"`   // cak: 2 per metropolis
	Defender     int `json:"defender"`     // cak
	Merchant     int `json:"merchant"`     // cak
	ExtraKnights int `json:"extra_cak"`    // cak: Constitution/Printer
	Caravan      int `json:"caravan"`      // caravans interior-vertex VP
	// Harbormaster is 2 for the seat holding the Harbormaster card, else 0,
	// so the card's points are not shown as "other".
	Harbormaster int `json:"harbormaster"`
	// Wealth is the Rivers wealth tiles' net: +1 for the Wealthiest Settler,
	// -2 for a Poorest Settler, so it can be negative.
	Wealth int `json:"wealth"`
	// Raiders. Prisoners is the scoring half, floor(prisoners/2) (or /3 under
	// Knights); Conquered is the negative half, the points of buildings lying
	// on their sides. Separate lines because neither is visible on the board.
	Prisoners  int `json:"prisoners"`
	Conquered  int `json:"conquered"`
	Delivered  int `json:"delivered"`   // wagons: 1 per delivered cargo token
	WagonLevel int `json:"wagon_level"` // wagons: 1 for reaching level 5, else 0
	// Explorers. ExplorerHarbours is the second point of each harbour
	// settlement (the first is in Settlements, since a harbour settlement is a
	// base settlement); Missions is the three mission markers and the bonus
	// tiles they hold.
	ExplorerHarbours int `json:"explorer_harbours"`
	Missions         int `json:"missions"`
}

// IslandsStat holds Islands-expansion stats for one seat. It is nil when the
// islands module was not active for this game.
type IslandsStat struct {
	IslandVP   int `json:"island_vp"`
	Ships      int `json:"ships"`
	GoldGained int `json:"gold_gained"`
}

// FishStat holds Fishermen-expansion stats for one seat. It is nil when the
// fishermen module was not active for this game.
type FishStat struct {
	Caught  [3]int `json:"caught"`   // 1-/2-/3-fish tiles held at game end
	Value   int    `json:"value"`    // total fish value at game end
	Spent   int    `json:"spent"`    // fish value spent over the game
	HasBoot bool   `json:"has_boot"` // holds the old boot at game end
}

// KnightsStat holds Knights-expansion stats for one seat. It is nil when the
// cak module was not active for this game.
type KnightsStat struct {
	KnightsTotal           int    `json:"knights_total"`
	KnightsActive          int    `json:"knights_active"`
	KnightLevels           [3]int `json:"knight_levels"` // basic/strong/mighty counts
	Metropolis             int    `json:"metropolis"`    // 0..3
	Improve                [3]int `json:"improve"`       // Trade/Politics/Science levels
	Walls                  int    `json:"walls"`
	CommoditiesProduced    int    `json:"commodities_produced"`
	ProgressPlayed         int    `json:"progress_played"`
	BarbarianDefensesWon   int    `json:"barbarian_defenses_won"`
	CitiesLostToBarbarians int    `json:"cities_lost_to_barbarians"`
	DefenderVP             int    `json:"defender_vp"`
	MerchantVP             int    `json:"merchant_vp"`
	ExtraVP                int    `json:"extra_vp"`
}

// CaravanStat holds Caravans-expansion stats for one seat. It is nil when the
// caravans module was not active for this game.
type CaravanStat struct {
	CamelsPlaced int `json:"camels_placed"`
	CaravanVP    int `json:"caravan_vp"`
	RouteBonus   int `json:"route_bonus"`
	VotesCast    int `json:"votes_cast"`
}

// RaidersStat holds Raiders-scenario stats for one seat. It is nil when the
// raiders module was not active for this game.
type RaidersStat struct {
	// Prisoners is the raw count, not the points. Two make a point (three
	// under Knights) and a lone prisoner scores nothing, so both are shown.
	Prisoners int `json:"prisoners"`
	// PrisonerVP is what those prisoners scored.
	PrisonerVP int `json:"prisoner_vp"`
	Gold       int `json:"gold"`
	// RidersOnBoard is what survived, out of six.
	RidersOnBoard int `json:"riders_on_board"`
	// BuildingsConquered is how many of this seat's settlements and cities ended
	// the game lying on their sides, scoring nothing.
	BuildingsConquered int `json:"buildings_conquered"`
}

// WagonStat holds Wagons-scenario stats for one seat. It is nil when the
// wagons module was not active for this game.
//
// Gold is here and not in the VP breakdown: gold buys things and scores
// nothing. (The Rivers combination's wealthiest-settler award belongs to that
// module.)
type WagonStat struct {
	Delivered int `json:"delivered"` // cargo tokens delivered, 1 VP each
	Level     int `json:"level"`     // 1..5 on the upgrade track
	Gold      int `json:"gold"`      // gold held at game end; worth no points
	Tolls     int `json:"tolls"`     // gold taken from other players' wagons
	Paid      int `json:"paid"`      // gold paid to other players in tolls
}

// PlayerStat is one seat's end-of-game line on the post-game scoreboard. It is
// computed from the final replayed state, so hidden victory-point dev cards
// are counted.
type PlayerStat struct {
	Seat           int          `json:"seat"`
	VP             int          `json:"vp"`
	VPBreakdown    VPBreakdown  `json:"vp_breakdown"`
	Settlements    int          `json:"settlements"`
	Cities         int          `json:"cities"`
	Roads          int          `json:"roads"`
	Knights        int          `json:"knights"`
	DevCards       int          `json:"dev_cards"`
	LongestRoad    int          `json:"longest_road"`
	HasLongestRoad bool         `json:"has_longest_road"`
	HasLargestArmy bool         `json:"has_largest_army"`
	Produced       int          `json:"produced"`      // cards gained from dice production
	Expected       float64      `json:"expected"`      // expected production (luck baseline)
	RobberLoss     int          `json:"robber_loss"`   // cards discarded on 7s
	Stolen         int          `json:"stolen"`        // cards stolen from this player
	Steals         int          `json:"steals"`        // cards this player stole
	BankTrades     int          `json:"bank_trades"`   // bank/harbor trades made
	PlayerTrades   int          `json:"player_trades"` // player-to-player trades taken part in
	LuckRel        float64      `json:"luck_rel"`      // (produced-expected) minus table mean deviation
	Islands        *IslandsStat `json:"islands,omitempty"`
	KnightsStats   *KnightsStat `json:"cak,omitempty"`
	Fish           *FishStat    `json:"fish,omitempty"`
	Caravans       *CaravanStat `json:"caravans,omitempty"`
	Raiders        *RaidersStat `json:"raiders,omitempty"`
	Wagons         *WagonStat   `json:"wagons,omitempty"`
}

// Scoreboard is the post-game summary for a finished game.
type Scoreboard struct {
	Winner  int          `json:"winner"`
	Players []PlayerStat `json:"players"`
	Rolls   map[int]int  `json:"rolls"` // dice total (2..12) -> times rolled
	Turns   int          `json:"turns"` // total turns taken in the game
	// VPTrack is the standings at every turn boundary: one row per turn, one
	// column per seat, in seat order. The last row is the final score.
	//
	// Computed here in the same fold rather than on the client, because VP is
	// the engine's answer (VPWithModules includes island VP, metropolises,
	// caravan routes and hidden dev cards).
	//
	// Omitted for a game that never started a turn, and absent from match
	// records frozen before the field existed; readers must treat it as
	// optional.
	VPTrack [][]int `json:"vp_track,omitempty"`
}

// BuildScoreboard replays a game's full event log to compute its final
// per-player stats and game-wide dice/economy stats. It works for any finished
// (or in-progress) game without a live actor, so it survives the post-finish
// actor reap.
func BuildScoreboard(st *store.Store, gameID string) (*Scoreboard, error) {
	events, err := st.LoadEvents(gameID, 0)
	if err != nil {
		return nil, err
	}
	return scoreboardFromEvents(events)
}

// BuildBoardView replays a game's full event log and renders the final board as
// a fully-revealed spectator view, for the post-game screen.
func BuildBoardView(st *store.Store, gameID string) (*FullView, error) {
	events, err := st.LoadEvents(gameID, 0)
	if err != nil {
		return nil, err
	}
	return boardViewFromEvents(events)
}

// BuildViewerView replays a game's full event log and renders the final state
// from one viewer's perspective (Spectator for an unseated watcher). Unlike
// BuildBoardView it keeps the viewer's own hand and viewer-specific fields, so
// it can stand in for the live actor's state frame once the actor is gone.
func BuildViewerView(st *store.Store, gameID string, viewer engine.PlayerID) (*FullView, error) {
	events, err := st.LoadEvents(gameID, 0)
	if err != nil {
		return nil, err
	}
	s, err := engine.Replay(events)
	if err != nil {
		return nil, err
	}
	v := NewFullView(s, viewer)
	stampSeatMeta(st, gameID, events, s, v)
	return v, nil
}

// stampSeatMeta fills in the fields the actor normally stamps on a view but
// that newFullView cannot derive from engine state: the clock policy and the
// lobby/cosmetic metadata (names, piece sets, robber skin). Without it a
// replayed view would show "Seat N" and stock art. Best-effort: a store miss
// leaves the stock presentation, as in the actor.
func stampSeatMeta(st *store.Store, gameID string, events []engine.Event, s *engine.State, v *FullView) {
	tw := timings.For(s.Config.TurnTimerSec)
	v.Timings = &tw

	seats, err := st.Seats(gameID)
	if err != nil {
		return
	}
	names := make(map[engine.PlayerID]string, len(seats))
	pieces := make(map[engine.PlayerID]string, len(seats))
	robbers := make(map[engine.PlayerID]string, len(seats))
	for _, seat := range seats {
		if seat.UserName != "" {
			names[engine.PlayerID(seat.No)] = seat.UserName
		}
		if seat.Pieces != "" {
			pieces[engine.PlayerID(seat.No)] = seat.Pieces
		}
		// The same resolution the live actor uses (see game/manager.go), so a
		// bot's robber skin persists on the post-game board.
		if r := cosmetics.RobberForSeat(seat.Robber, seat.Status == "bot"); r != "" {
			robbers[engine.PlayerID(seat.No)] = r
		}
	}
	if len(names) > 0 {
		v.SeatNames = names
	}
	if len(pieces) > 0 {
		v.SeatPieces = pieces
	}
	// The robber wears the skin of whoever moved it last, so scan back for
	// the most recent move.
	for _, v0 := range slices.Backward(events) {
		if v0.Type != engine.EvRobberMoved {
			continue
		}
		var d engine.RobberMovedData
		if err := json.Unmarshal(v0.Data, &d); err == nil {
			v.RobberSkin = robbers[d.Player]
		}
		break
	}
}

func boardViewFromEvents(events []engine.Event) (*FullView, error) {
	s, err := engine.Replay(events)
	if err != nil {
		return nil, err
	}
	return NewFullView(s, Spectator), nil
}

// pipWeight is the probability of rolling dice total n with two fair dice,
// i.e. the number of pips on a standard number token over 36. Never
// called for 7 (no producing tile carries a 7).
func pipWeight(n int) float64 {
	d := 7 - n
	if d < 0 {
		d = -d
	}
	return float64(6-d) / 36.0
}

// standings is one row of the VP track: every seat's victory points as the
// engine scores them now, in seat order. Uses VPWithModules, not the public
// total: a hidden VP card counts from when it was bought, and the replay is
// read after the game, with nothing left to hide.
func standings(s *engine.State) []int {
	row := make([]int, len(s.Players))
	for i := range s.Players {
		row[i] = s.VPWithModules(engine.PlayerID(i))
	}
	return row
}

// scoreboardFromEvents folds the event log once: it steps engine state with
// engine.Apply while accumulating dice/economy stats. Expected production is
// read from the buildings + robber position present at each roll.
func scoreboardFromEvents(events []engine.Event) (*Scoreboard, error) {
	s := engine.Empty()
	sb := &Scoreboard{Rolls: map[int]int{}}

	type acc struct {
		produced, robberLoss, stolen, steals, bankTrades, playerTrades int
		expected                                                       float64
		gold                                                           int
		// cak accumulators
		commoditiesProduced    int
		progressPlayed         int
		citiesLostToBarbarians int
		// fishermen accumulator
		fishSpent int
		// caravans accumulator
		votesCast int
		// wagons accumulators: gold taken from, and paid to, other seats' wagons
		tollsTaken int
		tollsPaid  int
	}
	accs := map[engine.PlayerID]*acc{}
	get := func(p engine.PlayerID) *acc {
		a := accs[p]
		if a == nil {
			a = &acc{}
			accs[p] = a
		}
		return a
	}
	// cak game-wide defense count; applied to all seats after the fold.
	var barbarianDefensesWon int

	for _, e := range events {
		switch e.Type {
		case engine.EvDiceRolled:
			var d engine.DiceRolledData
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			sb.Rolls[d.D1+d.D2]++
			// Expected production this roll, from buildings + robber as they
			// stand now (robber moves only on the later EvRobberMoved).
			for v, b := range s.Buildings {
				mult := 1.0
				if b.City {
					mult = 2.0
				}
				for _, hex := range v.Hexes() {
					t, ok := s.Board.Tiles[hex]
					if !ok || !t.Res.Producing() || hex == s.Board.Robber {
						continue
					}
					get(b.Owner).expected += pipWeight(t.Number) * mult
				}
			}
		case engine.EvResDistributed:
			var d engine.ResDistributedData
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			for _, g := range d.Gains {
				get(g.Player).produced += g.Gain.Count()
			}
		case engine.EvCardsDiscarded:
			var d engine.CardsDiscardedData
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			get(d.Player).robberLoss += d.Cards.Count()
		case engine.EvCardStolen:
			var d engine.CardStolenData
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			get(d.Thief).steals++
			get(d.Victim).stolen++
		case engine.EvBankTraded:
			var d engine.BankTradedData
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			get(d.Player).bankTrades++
		case engine.EvTradeExecuted:
			var d engine.TradeExecutedData
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			get(d.By).playerTrades++
			get(d.With).playerTrades++
		case engine.EvTurnStarted:
			sb.Turns++
			// Read before the Apply below, so the row is the standing the
			// finished turn left. Sampled per turn, not per event, so
			// intra-turn swings do not show. Guarded so every row has one
			// entry per seat.
			if len(s.Players) > 0 {
				sb.VPTrack = append(sb.VPTrack, standings(s))
			}
		case scenarios.EvFishSpent:
			var d struct {
				Player  engine.PlayerID `json:"player"`
				Discard [3]int          `json:"discard"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			get(d.Player).fishSpent += d.Discard[0] + 2*d.Discard[1] + 3*d.Discard[2]
		case scenarios.EvCamelResolved:
			// Read from the resolved event, not the bids: a bid is clamped at
			// resolution to what the seat could still back, so `paid` holds the
			// votes that counted. Scoreboards use the unredacted log.
			var d struct {
				Paid []struct {
					Player engine.PlayerID `json:"player"`
					Cards  [2]int          `json:"cards"`
					// Wire names from before the bid resources became
					// ruleset-dependent, so older logs still count their votes.
					Wool  int `json:"wool"`
					Grain int `json:"grain"`
				} `json:"paid"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			for _, pay := range d.Paid {
				// One vote per card, whichever pile it came from.
				get(pay.Player).votesCast += pay.Cards[0] + pay.Cards[1] + pay.Wool + pay.Grain
			}
		case wagons.EvMoved:
			// The toll a wagon pays crossing someone else's road. Read from the
			// move rather than diffed from gold counts, because gold changes
			// several other ways.
			var d struct {
				Player engine.PlayerID `json:"player"`
				Toll   int             `json:"toll"`
				Paid   engine.PlayerID `json:"paid"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			if d.Toll > 0 && d.Paid >= 0 {
				get(d.Player).tollsPaid += d.Toll
				get(d.Paid).tollsTaken += d.Toll
			}
		case islands.EvGoldChosen:
			var d struct {
				Player engine.PlayerID `json:"player"`
				Gain   engine.Hand     `json:"gain"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			get(d.Player).gold += d.Gain.Count()
		case knights.EvCommodityAdjust:
			// Fired for the commodity a city collects on production (current
			// events carry `minted`; older ones converted one of two resources).
			//
			// Count is how many cities were owed one and Short how many the
			// commodity stack could not pay, so received = Count - Short. Short
			// is absent from logs written before the supply was finite and
			// decodes as 0.
			var d struct {
				Player engine.PlayerID `json:"player"`
				Count  int             `json:"count"`
				Short  int             `json:"short,omitempty"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			get(d.Player).commoditiesProduced += d.Count - d.Short
		case knights.EvProgressPlayed:
			var d struct {
				Player engine.PlayerID `json:"player"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			get(d.Player).progressPlayed++
		case knights.EvBarbarianAttack:
			var d struct {
				Skipped    bool `json:"skipped,omitempty"`
				Win        bool `json:"win"`
				Downgraded []struct {
					Player engine.PlayerID `json:"player"`
				} `json:"downgraded,omitempty"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			if !d.Skipped {
				if d.Win {
					barbarianDefensesWon++
				}
				// Only sacrifices with nothing to decide are listed here (plus
				// every pre-choice log's entries). A player who chose is counted
				// on their own choice event, so nothing is counted twice.
				for _, dg := range d.Downgraded {
					get(dg.Player).citiesLostToBarbarians++
				}
			}
		case knights.EvBarbarianDowngraded:
			var d struct {
				Player engine.PlayerID `json:"player"`
				V      board.Vertex    `json:"v"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				return nil, err
			}
			// A forfeit (no city left to give) names a vertex without one of
			// their cities and costs nothing; read it before the fold razes it.
			if b, ok := s.Buildings[d.V]; ok && b.Owner == d.Player && b.City {
				get(d.Player).citiesLostToBarbarians++
			}
		default:
			// Other event types contribute no scoreboard stats here; the
			// engine.Apply fold below still advances state for every event.
		}
		if err := engine.Apply(s, e); err != nil {
			return nil, err
		}
	}

	sb.Winner = int(s.Winner)
	// The closing row. Every other row was taken at the start of a turn, so
	// without this the track would miss the winning point.
	if len(s.Players) > 0 {
		sb.VPTrack = append(sb.VPTrack, standings(s))
	}
	sb.Players = make([]PlayerStat, len(s.Players))
	for i := range s.Players {
		p := engine.PlayerID(i)
		a := get(p)
		breakdown := VPBreakdown{}
		if s.LongestRoadHolder == p {
			breakdown.LongestRoad = 2
		}
		if s.LargestArmyHolder == p {
			breakdown.LargestArmy = 2
		}
		// Hidden VP dev cards: total VP minus the public VP.
		breakdown.DevVP = s.VPWithModules(p) - s.PublicVPWithModules(p)
		sb.Players[i] = PlayerStat{
			Seat:           i,
			VP:             s.VPWithModules(p),
			VPBreakdown:    breakdown,
			Knights:        s.Players[i].KnightsPlayed,
			DevCards:       s.Players[i].DevCards.Count() + s.Players[i].NewDevCards.Count(),
			LongestRoad:    engine.LongestRouteLength(s, p),
			HasLongestRoad: s.LongestRoadHolder == p,
			HasLargestArmy: s.LargestArmyHolder == p,
			Produced:       a.produced,
			Expected:       a.expected,
			RobberLoss:     a.robberLoss,
			Stolen:         a.stolen,
			Steals:         a.steals,
			BankTrades:     a.bankTrades,
			PlayerTrades:   a.playerTrades,
		}
	}
	for _, b := range s.Buildings {
		if int(b.Owner) < 0 || int(b.Owner) >= len(sb.Players) {
			continue
		}
		if b.City {
			sb.Players[b.Owner].Cities++
			sb.Players[b.Owner].VPBreakdown.Cities++ // 2 VP each, multiplied at read time
		} else {
			sb.Players[b.Owner].Settlements++
			sb.Players[b.Owner].VPBreakdown.Settlements++
		}
	}
	for _, owner := range s.Roads {
		if int(owner) >= 0 && int(owner) < len(sb.Players) {
			sb.Players[owner].Roads++
		}
	}
	applyLuckRel(sb)

	// Islands expansion block: populated only when the islands module is active.
	if islandsExt, ok := islands.StateExt(s); ok {
		// Count ships per owner on the final board.
		shipCounts := make([]int, len(s.Players))
		for _, owner := range islandsExt.Ships {
			if int(owner) >= 0 && int(owner) < len(shipCounts) {
				shipCounts[owner]++
			}
		}
		for i := range sb.Players {
			p := engine.PlayerID(i)
			ivp := islandsExt.IslandVP[p]
			sb.Players[i].VPBreakdown.IslandVP = ivp
			sb.Players[i].Islands = &IslandsStat{
				IslandVP:   ivp,
				Ships:      shipCounts[i],
				GoldGained: get(p).gold,
			}
		}
	}

	// Knights (cak) expansion block: populated only when the cak module is active.
	if knightsExt, ok := knights.StateExt(s); ok {
		// Aggregate per-player knight counts from the final board.
		type knightCounts struct {
			total, active int
			levels        [3]int
		}
		kc := make([]knightCounts, len(s.Players))
		for _, k := range knightsExt.Knights {
			if int(k.Owner) < 0 || int(k.Owner) >= len(kc) {
				continue
			}
			kc[k.Owner].total++
			if k.Active {
				kc[k.Owner].active++
			}
			if k.Level >= 1 && k.Level <= 3 {
				kc[k.Owner].levels[k.Level-1]++
			}
		}
		for i := range sb.Players {
			p := engine.PlayerID(i)
			px := knightsExt.Players[i]
			a := get(p)
			// Count metropolises (Metropolis[t] is true per track held).
			metropolisCount := 0
			for _, has := range px.Metropolis {
				if has {
					metropolisCount++
				}
			}
			// Populate VP breakdown rows for cak.
			sb.Players[i].VPBreakdown.Metropolis = 2 * metropolisCount
			sb.Players[i].VPBreakdown.Defender = px.DefenderVP
			sb.Players[i].VPBreakdown.Merchant = px.MerchantVP
			sb.Players[i].VPBreakdown.ExtraKnights = px.ExtraVP
			// Build the KnightsStat block.
			sb.Players[i].KnightsStats = &KnightsStat{
				KnightsTotal:           kc[i].total,
				KnightsActive:          kc[i].active,
				KnightLevels:           kc[i].levels,
				Metropolis:             metropolisCount,
				Improve:                px.Improve,
				Walls:                  px.Walls,
				CommoditiesProduced:    a.commoditiesProduced,
				ProgressPlayed:         a.progressPlayed,
				BarbarianDefensesWon:   barbarianDefensesWon,
				CitiesLostToBarbarians: a.citiesLostToBarbarians,
				DefenderVP:             px.DefenderVP,
				MerchantVP:             px.MerchantVP,
				ExtraVP:                px.ExtraVP,
			}
		}
	}

	// Fishermen expansion block: populated only when the fishermen module is active.
	if fishExt, ok := scenarios.FishStateExt(s); ok {
		for i := range sb.Players {
			p := engine.PlayerID(i)
			held := fishExt.Held[i]
			caught := [3]int{held[0], held[1], held[2]}
			value := caught[0] + 2*caught[1] + 3*caught[2]
			sb.Players[i].Fish = &FishStat{
				Caught:  caught,
				Value:   value,
				Spent:   get(p).fishSpent,
				HasBoot: fishExt.BootHolder == p,
			}
		}
	}

	// Caravans expansion block: populated only when the caravans module is active.
	if caravansExt, ok := scenarios.CaravansStateExt(s); ok {
		// CamelsPlaced is game-wide: this game's camel supply (22, or 33 and
		// 44 at larger tables) minus what remains.
		camelsPlaced := caravansExt.Supply() - caravansExt.CamelsLeft
		// Build per-player camel VP and route bonus.
		for i := range sb.Players {
			p := engine.PlayerID(i)
			// CaravanVP comes from the module's own VictoryVP, which its
			// victory() hook uses too.
			caravanVP := scenarios.VictoryVP(s, p)
			// RouteBonus: this player's roads that coincide with a camel edge
			// (each counts double in routeLength).
			routeBonus := 0
			for e, owner := range s.Roads {
				if owner == p && caravansExt.Occupied[e] {
					routeBonus++
				}
			}
			sb.Players[i].VPBreakdown.Caravan = caravanVP
			sb.Players[i].Caravans = &CaravanStat{
				CamelsPlaced: camelsPlaced,
				CaravanVP:    caravanVP,
				RouteBonus:   routeBonus,
				VotesCast:    get(p).votesCast,
			}
		}
	}

	// Harbormaster: the card is 2 public VP for at most one seat and gets its
	// own row, like Longest Road. The module keeps no per-seat history, so
	// there is no stat struct.
	if _, ok := harbormaster.StateExt(s); ok {
		holder := harbormaster.Holder(s)
		for i := range sb.Players {
			if engine.PlayerID(i) == holder {
				sb.Players[i].VPBreakdown.Harbormaster = harbormaster.CardVP
			}
		}
	}

	// Rivers: the two wealth tiles are public points that move without a
	// player action, so they get a row like the titles above. Read from the
	// module state its VictoryCheck uses.
	if rx, ok := rivers.StateExt(s); ok {
		for i := range sb.Players {
			v := 0
			if rx.Wealthiest == engine.PlayerID(i) {
				v += rivers.WealthiestVP
			}
			if i < len(rx.Poorest) && rx.Poorest[i] {
				v += rivers.PoorestVP
			}
			sb.Players[i].VPBreakdown.Wealth = v
		}
	}

	// Raiders scenario block: populated only when the raiders module is active.
	if raidersExt, ok := raiders.StateExt(s); ok {
		for i := range sb.Players {
			p := engine.PlayerID(i)
			onBoard, conq := 0, 0
			for _, owner := range raidersExt.RiderAt {
				if owner == p {
					onBoard++
				}
			}
			lost := 0
			for v, b := range s.Buildings {
				if b.Owner != p || !engine.BuildingIsInert(s, v) {
					continue
				}
				conq++
				if b.City {
					lost += 2
				} else {
					lost++
				}
			}
			// The scoring half, from the module's own rule; the divisor changes
			// under Knights.
			prisoners := raiders.Prisoners(s, p)
			per := 2
			if strings.Contains(s.Config.Ruleset, "cak") {
				per = 3
			}
			sb.Players[i].VPBreakdown.Prisoners = prisoners / per
			sb.Players[i].VPBreakdown.Conquered = -lost
			sb.Players[i].Raiders = &RaidersStat{
				Prisoners:          prisoners,
				PrisonerVP:         prisoners / per,
				Gold:               raiders.GoldOf(s, p),
				RidersOnBoard:      onBoard,
				BuildingsConquered: conq,
			}
		}
	}

	// Wagons block: populated only when the wagons module is active. VP comes
	// from the module's own VictoryCheck, as the Caravans block uses
	// scenarios.VictoryVP.
	if _, ok := wagons.StateExt(s); ok {
		for i := range sb.Players {
			p := engine.PlayerID(i)
			delivered := wagons.Delivered(s, p)
			level := wagons.Level(s, p)
			levelVP := 0
			if level >= 5 {
				levelVP = 1
			}
			sb.Players[i].VPBreakdown.Delivered = delivered
			sb.Players[i].VPBreakdown.WagonLevel = levelVP
			sb.Players[i].Wagons = &WagonStat{
				Delivered: delivered,
				Level:     level,
				Gold:      wagons.Gold(s, p),
				Tolls:     get(p).tollsTaken,
				Paid:      get(p).tollsPaid,
			}
		}
	}

	// Explorers block, read from the module's own scoring
	// (explorers.HarbourVP, explorers.MissionVP).
	if x, ok := explorers.StateExt(s); ok {
		for i := range sb.Players {
			p := engine.PlayerID(i)
			harbours := 0
			for _, owner := range x.Harbours {
				if owner == p {
					harbours += explorers.HarbourVP
				}
			}
			sb.Players[i].VPBreakdown.ExplorerHarbours = harbours
			sb.Players[i].VPBreakdown.Missions = explorers.MissionVP(x, p)
		}
	}

	return sb, nil
}

// applyLuckRel sets each player's LuckRel to their dice deviation
// (produced - expected) minus the lobby's mean deviation, isolating luck
// relative to the table so a game-wide hot/cold dice run cancels out.
func applyLuckRel(sb *Scoreboard) {
	if len(sb.Players) == 0 {
		return
	}
	var sum float64
	for _, p := range sb.Players {
		sum += float64(p.Produced) - p.Expected
	}
	mean := sum / float64(len(sb.Players))
	for i := range sb.Players {
		sb.Players[i].LuckRel = (float64(sb.Players[i].Produced) - sb.Players[i].Expected) - mean
	}
}
