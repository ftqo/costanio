package knights

import (
	"maps"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func (Module) Apply(s *engine.State, e engine.Event) (bool, error) {
	x := ext(s)
	switch e.Type {
	case EvEventDie:
		d := engine.DecodeEvent[eventDieData](e)
		// The fleet does not advance in a Raiders game (the Raiders coast replaces
		// it). The die is still rolled and recorded for the audit, and its gate faces
		// still deal progress cards. See barbariansSail.
		if d.Face == "ship" && barbariansSail(s) {
			x.Barbarians++
		}

	case EvCommodityAdjust:
		d := engine.DecodeEvent[commodityAdjustData](e)
		// A Minted event never took the resource (the core paid the city one, not
		// two), so nothing goes back.
		if !d.Minted {
			var take engine.Hand
			take[d.Res] = d.Count
			s.Players[d.Player].Hand.Sub(take)
			s.Bank.Add(take)
		}
		// Count resources go back to the bank; Count-Short of them come back as
		// commodities. Short is what the commodity stack could not pay and is not
		// refunded as a resource: a pasture city yields one wool and one cloth, so an
		// empty cloth stack leaves one wool, not two. Older events decode Short as 0,
		// the old unconditional grant.
		got := d.Count - d.Short
		x.Players[d.Player].Commodities[d.Commodity] += got
		x.CommoditySupply[d.Commodity] -= got

	case EvProgressDrawn:
		d := engine.DecodeEvent[progressCardData](e)
		if d.Under {
			x.Under[d.Track] = withoutCard(x.Under[d.Track], d.Card)
		} else {
			x.Decks[d.Track][d.Card]--
		}
		px := &x.Players[d.Player]
		if vpCard(d.Card) {
			px.ExtraVP++ // Constitution / Printer score immediately
		} else {
			px.Progress = append(px.Progress, d.Card)
		}

	case EvProgressDiscard:
		d := engine.DecodeEvent[progressCardData](e)
		px := &x.Players[d.Player]
		px.Progress = removeCard(px.Progress, d.Card)
		returnCard(x, d)

	case EvSpyLooking:
		d := engine.DecodeEvent[spyLookData](e)
		x.SpyThief, x.SpyVictim = d.Thief, d.Victim

	case EvMasterMerchantLook:
		d := engine.DecodeEvent[spyLookData](e)
		x.MMThief, x.MMVictim = d.Thief, d.Victim

	case EvProgressStolen:
		d := engine.DecodeEvent[progressStolenData](e)
		x.Players[d.Victim].Progress = removeCard(x.Players[d.Victim].Progress, d.Card)
		x.Players[d.Thief].Progress = append(x.Players[d.Thief].Progress, d.Card)
		x.SpyThief, x.SpyVictim = engine.NoPlayer, engine.NoPlayer // the look is resolved

	case EvProgressPlayed:
		d := engine.DecodeEvent[progressCardData](e)
		px := &x.Players[d.Player]
		px.Progress = removeCard(px.Progress, d.Card)
		returnCard(x, d)

	case EvImproved:
		d := engine.DecodeEvent[improvedData](e)
		var cost CommodityHand
		cost[commodityForTrack(d.Track)] = d.Cost
		x.Players[d.Player].Commodities.Sub(cost)
		x.CommoditySupply.Add(cost) // spent cards go back on the stack
		x.Players[d.Player].Improve[d.Track]++

	case EvMetropolisPending:
		d := engine.DecodeEvent[metropolisData](e)
		x.MetropolisPending = &MetropolisPick{Player: d.Holder, Track: d.Track, Prev: d.Prev}

	case EvMetropolis:
		d := engine.DecodeEvent[metropolisData](e)
		// Placing it resolves any pending pick (a no-op for older logs).
		x.MetropolisPending = nil
		if d.Holder == engine.NoPlayer {
			return true, nil // abandoned: no eligible city left (see metropolisData)
		}
		if d.Prev != engine.NoPlayer {
			x.Players[d.Prev].Metropolis[d.Track] = false
			x.Players[d.Prev].MetropolisAt[d.Track] = board.Vertex{}
		}
		x.Players[d.Holder].Metropolis[d.Track] = true
		x.Players[d.Holder].MetropolisAt[d.Track] = d.V

	case EvKnightBuilt:
		d := engine.DecodeEvent[knightData](e)
		level := max(d.Level,
			// default build is a basic knight
			1)
		x.Knights[d.V] = Knight{Owner: d.Player, Level: level, Active: d.Active, FreshlyActivated: d.Active && d.Fresh}
		if !d.Free {
			s.Players[d.Player].Hand.Sub(costKnight)
			s.Bank.Add(costKnight)
		}

	case EvKnightActivated:
		d := engine.DecodeEvent[knightData](e)
		k := x.Knights[d.V]
		k.Active = true
		k.FreshlyActivated = true
		x.Knights[d.V] = k
		if !d.Free {
			s.Players[d.Player].Hand.Sub(costActivate)
			s.Bank.Add(costActivate)
		}

	case EvKnightPromoted:
		d := engine.DecodeEvent[knightData](e)
		k := x.Knights[d.V]
		k.Level++
		// Set for a free promotion too: the cap is on the knight, so a knight the
		// Smith just raised cannot be paid up again this turn.
		k.PromotedThisTurn = true
		x.Knights[d.V] = k
		if !d.Free {
			s.Players[d.Player].Hand.Sub(costKnight)
			s.Bank.Add(costKnight)
		}

	case EvKnightMoved:
		d := engine.DecodeEvent[knightMoveData](e)
		k := x.Knights[d.From]
		delete(x.Knights, d.From)
		k.Active = false // moving deactivates
		k.FreshlyActivated = false
		x.Knights[d.To] = k

	case EvKnightRemoved:
		d := engine.DecodeEvent[knightRemovedData](e)
		delete(x.Knights, d.V)

	case EvDeserterOpened:
		d := engine.DecodeEvent[deserterData](e)
		x.DeserterTaker, x.DeserterVictim, x.DeserterLevel = d.Taker, d.Victim, 0
		x.DeserterActive = false

	case EvDeserterArmed:
		d := engine.DecodeEvent[deserterData](e)
		x.DeserterVictim = engine.NoPlayer
		x.DeserterLevel = d.Level
		x.DeserterActive = d.Active
		if d.Level == 0 { // nothing to place: the replacement is forfeited
			x.DeserterTaker = engine.NoPlayer
		}

	case EvDeserterCleared:
		x.DeserterTaker, x.DeserterVictim, x.DeserterLevel = engine.NoPlayer, engine.NoPlayer, 0
		x.DeserterActive = false

	case EvKnightDisplaced:
		d := engine.DecodeEvent[knightDisplacedData](e)
		disp := x.Knights[d.At] // the displaced knight; level/active preserved
		delete(x.Knights, d.At)
		if d.From != nil { // the displacing knight advances into the vacated spot
			mover := x.Knights[*d.From]
			delete(x.Knights, *d.From)
			mover.Active = false
			mover.FreshlyActivated = false
			x.Knights[d.At] = mover
		}
		// The displaced knight's owner must relocate it along their routes; if no
		// reachable empty spot exists it leaves the board.
		if _, ok := (Module{}).firstReachableSpot(s, x, disp.Owner, d.At); ok {
			x.RelocPlayer = disp.Owner
			x.RelocFrom = d.At
			x.RelocLevel = disp.Level
			x.RelocActive = disp.Active
			x.RelocPromoted = disp.PromotedThisTurn
		}

	case EvKnightRelocated:
		d := engine.DecodeEvent[knightData](e)
		// The knight is rebuilt rather than moved, so every flag that must survive
		// is carried explicitly, PromotedThisTurn included.
		x.Knights[d.V] = Knight{Owner: d.Player, Level: x.RelocLevel, Active: x.RelocActive,
			PromotedThisTurn: x.RelocPromoted}
		x.RelocPlayer = engine.NoPlayer
		x.RelocFrom = board.Vertex{}
		x.RelocLevel, x.RelocActive = 0, false
		x.RelocPromoted = false

	case EvDefenderAdvance:
		if len(x.DefenderDraws) > 0 {
			x.DefenderDraws = x.DefenderDraws[1:]
		}

	case EvKnightsAllActive:
		d := engine.DecodeEvent[knightData](e)
		for v, k := range x.Knights {
			if k.Owner == d.Player && !k.Active {
				k.Active = true
				k.FreshlyActivated = true
				x.Knights[v] = k
			}
		}

	case EvWallBuilt:
		d := engine.DecodeEvent[wallData](e)
		x.Players[d.Player].Walls++
		// Honour the city the player chose; fall back to the first unwalled city
		// (board order) for the Engineer card and older logs with no V.
		if (d.V != board.Vertex{}) && isUnwalledCity(s, x, d.Player, d.V) {
			x.Walled[d.V] = true
		} else if v, ok := firstUnwalledCity(s, x, d.Player); ok {
			x.Walled[v] = true
		}
		if !d.Free {
			s.Players[d.Player].Hand.Sub(costWall)
			s.Bank.Add(costWall)
		}

	// Announcement only: robber suppression is derived from Attacks == 0. Handled
	// here so replay does not fail on an unknown type.
	case EvRobberIdle:

	case EvBarbarianAttack:
		d := engine.DecodeEvent[barbarianAttackData](e)
		// Both lines run for a skipped landfall too. The fleet reached the island, so
		// the track resets, and Attacks is what "first" means in
		// SkipFirstBarbarianAttack (without it the skip would repeat). Attacks > 0
		// also unlocks the robber.
		x.Barbarians = 0
		x.Attacks++
		if d.Skipped {
			// No battle happened: no defender is crowned, no city falls, and ready
			// knights stay active.
			return true, nil
		}
		// Tied strongest defenders each owe a progress-card draw of their choice.
		x.DefenderDraws = append([]engine.PlayerID(nil), d.TiedDefenders...)
		// Losers with a real choice owe a pick; the rest fall now (which is how older
		// logs' Downgraded lists replay).
		x.PendingDowngrade = append([]engine.PlayerID(nil), d.Pending...)
		for _, dg := range d.Downgraded {
			razeCity(s, x, dg)
		}
		if d.Win && d.Defender != engine.NoPlayer {
			x.Players[d.Defender].DefenderVP++
		}
		for v, k := range x.Knights {
			if k.Active {
				k.Active = false
				k.FreshlyActivated = false
				x.Knights[v] = k
			}
		}

	case EvPillageBoughtOut:
		// The seat paid to keep its city: the debt clears and nothing is razed.
		// The payment itself is folded by the module that took it.
		d := engine.DecodeEvent[downgrade](e)
		x.PendingDowngrade = slices.DeleteFunc(
			append([]engine.PlayerID(nil), x.PendingDowngrade...),
			func(p engine.PlayerID) bool { return p == d.Player },
		)

	case EvBarbarianDowngraded:
		d := engine.DecodeEvent[downgrade](e)
		x.PendingDowngrade = slices.DeleteFunc(
			append([]engine.PlayerID(nil), x.PendingDowngrade...),
			func(p engine.PlayerID) bool { return p == d.Player },
		)
		// A forfeit (no city left to give) only clears the debt. The board, not
		// d.Forfeit, decides, because older logs carry only the zero vertex. The flag
		// is for readers, not the fold.
		if b, ok := s.Buildings[d.V]; ok && b.Owner == d.Player && b.City {
			razeCity(s, x, d)
		}

	case EvMerchantPlaced:
		d := engine.DecodeEvent[merchantData](e)
		if x.MerchantOwner != engine.NoPlayer {
			x.Players[x.MerchantOwner].MerchantVP = 0
		}
		h := d.Hex
		x.Merchant = &h
		x.MerchantOwner = d.Player
		x.Players[d.Player].MerchantVP = 1

	case EvCardsTaken, EvCardsGiven:
		d := engine.DecodeEvent[cardsMovedData](e)
		s.Players[d.From].Hand.Sub(d.Cards)
		s.Players[d.To].Hand.Add(d.Cards)
		if e.Type == EvCardsGiven {
			// One give settles the debt, even an empty-handed one.
			delete(x.PendingGive, d.From)
			if len(x.PendingGive) == 0 {
				x.WeddingTo = engine.NoPlayer
			}
		}
		// A Master Merchant take (To is the looking thief) resolves the look.
		// Guarded on MMThief so a Wedding give never clears it.
		if e.Type == EvCardsTaken && x.MMThief != engine.NoPlayer && d.To == x.MMThief {
			x.MMThief, x.MMVictim = engine.NoPlayer, engine.NoPlayer
		}

	case EvResourceLevy:
		d := engine.DecodeEvent[resourceLevyData](e)
		for _, take := range d.Takes {
			var h engine.Hand
			h[d.Res] = take.Count
			s.Players[take.Player].Hand.Sub(h)
			s.Players[d.Player].Hand.Add(h)
		}

	case EvCommodityLevy:
		d := engine.DecodeEvent[commodityLevyData](e)
		for _, take := range d.Takes {
			x.Players[take.Player].Commodities[d.Commodity] -= take.Count
			x.Players[d.Player].Commodities[d.Commodity] += take.Count
		}

	case EvCommodityStolen:
		d := engine.DecodeEvent[commodityStolenData](e)
		x.Players[d.Victim].Commodities[d.Com]--
		x.Players[d.Thief].Commodities[d.Com]++

	case EvCommodityTaken:
		d := engine.DecodeEvent[commodityMovedData](e)
		x.Players[d.From].Commodities.Sub(d.Cards)
		x.Players[d.To].Commodities.Add(d.Cards)
		// A commodity-only Wedding give still settles the debt (as EvCardsGiven does).
		// Guarded on the wedding claimant so a Master Merchant take, which also uses
		// this event, never clears an unrelated give.
		if d.To == x.WeddingTo && x.WeddingTo != engine.NoPlayer {
			delete(x.PendingGive, d.From)
			if len(x.PendingGive) == 0 {
				x.WeddingTo = engine.NoPlayer
			}
		}
		// A Master Merchant commodity-only take resolves the look (mirrors the
		// EvCardsTaken clear above; idempotent when both events fire).
		if x.MMThief != engine.NoPlayer && d.To == x.MMThief {
			x.MMThief, x.MMVictim = engine.NoPlayer, engine.NoPlayer
		}

	case EvCommodityDiscarded:
		d := engine.DecodeEvent[commodityDiscardData](e)
		x.Players[d.Player].Commodities.Sub(d.Cards)
		x.CommoditySupply.Add(d.Cards) // over-the-limit cards go back on the stack
		// A commodity-only 7-discard satisfies the requirement like a resource
		// discard. (A mixed discard also emits EvCardsDiscarded; delete is
		// idempotent.)
		delete(s.PendingDiscards, d.Player)

	case EvCommoditySold:
		d := engine.DecodeEvent[commoditySoldData](e)
		x.Players[d.Player].Commodities[d.Commodity]--
		x.CommoditySupply[d.Commodity]++ // back on the stack, like every other spend

	case EvDiceFixed:
		d := engine.DecodeEvent[diceFixedData](e)
		x.AlchemistD1, x.AlchemistD2 = d.D1, d.D2

	case EvTokensSwapped:
		d := engine.DecodeEvent[tokensSwappedData](e)
		// Copy-on-write: State.Clone shares the Tiles map, so allocate a fresh map
		// before mutating. This is the only in-game Tiles mutation, which lets clones
		// stay shallow.
		tiles := make(map[board.Hex]board.Tile, len(s.Board.Tiles))
		maps.Copy(tiles, s.Board.Tiles)
		ta, tb := tiles[d.A], tiles[d.B]
		ta.Number, tb.Number = tb.Number, ta.Number
		tiles[d.A], tiles[d.B] = ta, tb
		s.Board.Tiles = tiles

	case EvHarvest:
		d := engine.DecodeEvent[harvestData](e)
		var h engine.Hand
		h[d.Res] = d.Count
		s.Players[d.Player].Hand.Add(h)
		s.Bank.Sub(h)

	case EvLaidCityRestored:
		d := engine.DecodeEvent[laidCityRestoredData](e)
		// The base EvCityBuilt fold (and EvCheapCity) credits a settlement piece back
		// on every upgrade. A laid-on-side city is the exception: the piece there is
		// the city standing in for a settlement, so nothing left supply and nothing
		// may return. Otherwise a sixth settlement would appear on a five-piece
		// supply.
		if s.Players[d.Player].SettlementsLeft > 0 {
			s.Players[d.Player].SettlementsLeft--
		}
		x.Players[d.Player].LaidCities = withoutVertex(laidRecord(x, d.Player), d.V)
		syncLaidPin(s, x, d.Player)

	case EvCheapCity:
		d := engine.DecodeEvent[cheapCityData](e)
		s.Buildings[d.V] = engine.Building{Owner: d.Player, City: true}
		s.Players[d.Player].SettlementsLeft++
		s.Players[d.Player].CitiesLeft--
		s.Players[d.Player].Hand.Sub(costMedicineCity)
		s.Bank.Add(costMedicineCity)

	case EvCheapHarbour:
		// The payment only; Explorers' EvHarbourBuilt in the same batch does the
		// piece work.
		d := engine.DecodeEvent[cheapHarbourData](e)
		s.Players[d.Player].Hand.Sub(costMedicineHarbour)
		s.Bank.Add(costMedicineHarbour)

	case EvFreeRoads:
		d := engine.DecodeEvent[freeRoadsData](e)
		// Added, not assigned: a Fishermen five-fish road credit bought earlier this
		// turn must survive the card.
		s.FreeRoads += d.Count

	case EvRoadRelocated:
		d := engine.DecodeEvent[roadRelocatedData](e)
		delete(s.Roads, d.From)
		s.Players[d.Owner].RoadsLeft++
		if d.To != nil {
			s.Roads[*d.To] = d.Owner
			s.Players[d.Owner].RoadsLeft--
		}

	case EvHarborSetup:
		d := engine.DecodeEvent[harborSetupData](e)
		x.HarborTaker = d.Taker
		for _, g := range d.Gives {
			x.HarborGive[g.Player] = g.Res
		}

	case EvHarborGiven:
		d := engine.DecodeEvent[harborGivenData](e)
		var res engine.Hand
		res[d.Res] = 1
		s.Players[d.Taker].Hand.Sub(res)
		s.Players[d.Giver].Hand.Add(res)
		x.Players[d.Giver].Commodities[d.Com]--
		x.Players[d.Taker].Commodities[d.Com]++
		delete(x.HarborGive, d.Giver)
		if len(x.HarborGive) == 0 {
			x.HarborTaker = engine.NoPlayer
		}

	case evDiceUnfixed:
		x.AlchemistD1, x.AlchemistD2 = 0, 0

	case EvMerchantFleet:
		d := engine.DecodeEvent[merchantFleetData](e)
		if d.Player != engine.NoPlayer && int(d.Player) < len(x.Fleet) {
			if d.IsCom {
				x.ComFleet[d.Player] = int(d.Com) + 1 // commodity+1; 0 stays "inactive"
			} else {
				x.Fleet[d.Player] = d.Res + 1 // resource+1; 0 stays "inactive"
			}
		}

	case EvAqueductOwed:
		d := engine.DecodeEvent[aqueductOwedData](e)
		x.Aqueduct = append(x.Aqueduct, d.Players...)

	case EvAqueductTaken:
		d := engine.DecodeEvent[aqueductTakenData](e)
		if validRes(d.Res) && s.Bank[d.Res] > 0 {
			s.Bank[d.Res]--
			s.Players[d.Player].Hand[d.Res]++
		}
		for i, q := range x.Aqueduct {
			if q == d.Player {
				x.Aqueduct = append(x.Aqueduct[:i], x.Aqueduct[i+1:]...)
				break
			}
		}

	case EvTradingHouse:
		d := engine.DecodeEvent[tradingHouseData](e)
		x.Players[d.Player].Commodities[d.Give] -= 2
		x.CommoditySupply[d.Give] += 2 // the pair spent goes back on the stack
		if d.ComOut {
			x.Players[d.Player].Commodities[d.GetCom]++
			x.CommoditySupply[d.GetCom]--
		} else {
			s.Bank[d.GetRes]--
			s.Players[d.Player].Hand[d.GetRes]++
		}

	case EvCommodityTraded:
		d := engine.DecodeEvent[commodityTradeData](e)
		if d.GiveIsCom {
			x.Players[d.Player].Commodities[d.GiveCom] -= d.GiveN
			x.CommoditySupply[d.GiveCom] += d.GiveN // spent commodities return to the stack
		} else {
			s.Players[d.Player].Hand[d.GiveRes] -= d.GiveN
			s.Bank[d.GiveRes] += d.GiveN
		}
		if d.GetIsCom {
			x.Players[d.Player].Commodities[d.GetCom] += d.Count
			x.CommoditySupply[d.GetCom] -= d.Count
		} else {
			s.Bank[d.GetRes] -= d.Count
			s.Players[d.Player].Hand[d.GetRes] += d.Count
		}

	case EvCommodityBasket:
		d := engine.DecodeEvent[commodityBasketData](e)
		for _, r := range board.Resources {
			if n := d.SpendRes[r]; n > 0 {
				s.Players[d.Player].Hand[r] -= n
				s.Bank[r] += n
			}
			if n := d.GetRes[r]; n > 0 {
				s.Bank[r] -= n
				s.Players[d.Player].Hand[r] += n
			}
		}
		for c := range commodityKinds {
			if n := d.SpendCom[c]; n > 0 {
				x.Players[d.Player].Commodities[c] -= n
				x.CommoditySupply[c] += n // spent commodities return to the stack
			}
			if n := d.GetCom[c]; n > 0 {
				x.Players[d.Player].Commodities[c] += n
				x.CommoditySupply[c] -= n
			}
		}

	case evKnightsRefresh:
		// A new turn: knights activated previously may act again, and any
		// Merchant Fleet from the prior turn expires.
		for v, k := range x.Knights {
			if k.FreshlyActivated {
				k.FreshlyActivated = false
				x.Knights[v] = k
			}
		}
		for i := range x.Fleet {
			x.Fleet[i] = 0
		}
		for i := range x.ComFleet {
			x.ComFleet[i] = 0
		}
		for kv, k := range x.Knights {
			if k.PromotedThisTurn {
				k.PromotedThisTurn = false
				x.Knights[kv] = k
			}
		}

	case evWeddingOwed:
		d := engine.DecodeEvent[weddingOwedData](e)
		x.WeddingTo = d.To
		for _, pd := range d.Owed {
			x.PendingGive[pd.Player] += pd.Count
		}

	default:
		return false, nil
	}
	return true, nil
}

// razeCity folds one barbarian sacrifice: the city at dg.V drops back to a
// settlement, losing any wall (and its +2 discard bonus). With no settlement
// piece in supply the city is laid on its side instead and must be upgraded
// back before any other settlement. It is the one fold for both the attack
// event's Downgraded list and a chosen EvBarbarianDowngraded.
func razeCity(s *engine.State, x *Ext, dg downgrade) {
	s.Players[dg.Player].CitiesLeft++
	if x.Walled[dg.V] {
		delete(x.Walled, dg.V)
		if x.Players[dg.Player].Walls > 0 {
			x.Players[dg.Player].Walls--
		}
	}
	s.Buildings[dg.V] = engine.Building{Owner: dg.Player, City: false}
	rec := laidRecord(x, dg.Player)
	if s.Players[dg.Player].SettlementsLeft > 0 {
		s.Players[dg.Player].SettlementsLeft--
		// A vertex razed the ordinary way holds a real settlement piece, so drop any
		// stale laid record for it. Reachable: a laid city can be stood up and
		// pillaged again once the player has a settlement piece.
		rec = withoutVertex(rec, dg.V)
	} else if !slices.Contains(rec, dg.V) {
		// Append to a copy: rec may alias the stored slice, which a rejected command's
		// scoring state may share.
		rec = append(append([]board.Vertex(nil), rec...), dg.V)
	}
	x.Players[dg.Player].LaidCities = rec
	syncLaidPin(s, x, dg.Player)
}

// withoutVertex returns vs with the first occurrence of v removed, leaving the
// caller's slice untouched (an in-place delete could edit a state a rejected
// command was scored against).
func withoutVertex(vs []board.Vertex, v board.Vertex) []board.Vertex {
	i := slices.Index(vs, v)
	if i < 0 {
		return vs
	}
	out := make([]board.Vertex, 0, len(vs)-1)
	out = append(out, vs[:i]...)
	return append(out, vs[i+1:]...)
}

// laidRecord is p's recorded laid-on-side cities, oldest first. It falls back
// to the scalar pin when LaidCities is empty, for games restored from
// snapshots taken before the slice existed.
func laidRecord(x *Ext, p engine.PlayerID) []board.Vertex {
	if int(p) >= len(x.Players) {
		return nil
	}
	px := x.Players[p]
	if len(px.LaidCities) == 0 && px.LaidCityActive {
		return []board.Vertex{px.LaidCity}
	}
	return px.LaidCities
}

// stillLaid reports whether a recorded vertex is still a city of p's lying on
// its side. A record whose building is gone or stood back up is spent, so logs
// from before EvLaidCityRestored replay without blocking city builds.
func stillLaid(s *engine.State, p engine.PlayerID, v board.Vertex) bool {
	b, ok := s.Buildings[v]
	return ok && b.Owner == p && !b.City
}

// firstLaid is the player's oldest city still lying on its side: the vertex
// their next city upgrade is pinned to.
func firstLaid(s *engine.State, x *Ext, p engine.PlayerID) (board.Vertex, bool) {
	for _, v := range laidRecord(x, p) {
		if stillLaid(s, p, v) {
			return v, true
		}
	}
	return board.Vertex{}, false
}

// laidCount is how many of p's cities are lying on their side right now, the
// correction term in both piece ledgers (see PlayerExt.LaidCities).
func laidCount(s *engine.State, x *Ext, p engine.PlayerID) int {
	n := 0
	for _, v := range laidRecord(x, p) {
		if stillLaid(s, p, v) {
			n++
		}
	}
	return n
}

// laidCityRestores reacts to a batch that stood a laid-on-side city back up:
// one EvLaidCityRestored per upgrade, cancelling the settlement piece
// EvCityBuilt (or EvCheapCity) credited. It runs on the after-state, where the
// vertex is already a city, so the laid list identifies it.
func laidCityRestores(after *engine.State, events []engine.Event) []engine.Event {
	x := extRO(after)
	var out []engine.Event
	for _, e := range events {
		var p engine.PlayerID
		var v board.Vertex
		switch e.Type {
		case engine.EvCityBuilt:
			d := engine.DecodeEvent[engine.BuiltData](e)
			if d.V == nil {
				continue
			}
			p, v = d.Player, *d.V
		case EvCheapCity:
			d := engine.DecodeEvent[cheapCityData](e)
			p, v = d.Player, d.V
		default:
			continue
		}
		if slices.Contains(laidRecord(x, p), v) {
			out = append(out, engine.NewEvent(EvLaidCityRestored, laidCityRestoredData{Player: p, V: v}))
		}
	}
	return out
}

// syncLaidPin refreshes the published pin from LaidCities. Call it after every
// change to that slice. mustUpgradeFirst does not read these fields, so a
// stale pin is only a display bug.
func syncLaidPin(s *engine.State, x *Ext, p engine.PlayerID) {
	if int(p) >= len(x.Players) {
		return
	}
	v, ok := firstLaid(s, x, p)
	x.Players[p].LaidCity, x.Players[p].LaidCityActive = v, ok
}

func removeCard(hand []ProgressCard, card ProgressCard) []ProgressCard {
	for i, c := range hand {
		if c == card {
			return append(hand[:i], hand[i+1:]...)
		}
	}
	return hand
}

// returnCard puts a played or discarded progress card back with its deck: at
// the bottom (Ext.Under) for current events, or into the shuffled stack for
// older logs.
func returnCard(x *Ext, d progressCardData) {
	t := trackOf(d.Card)
	if d.Under {
		// A fresh slice, so a rejected command's scratch state cannot write through.
		x.Under[t] = append(append([]ProgressCard(nil), x.Under[t]...), d.Card)
		return
	}
	x.Decks[t][d.Card]++
}

// withoutCard removes the first copy of card from a deck's bottom queue. Draws
// take the front, but it searches so a card not at the front is still removed.
func withoutCard(q []ProgressCard, card ProgressCard) []ProgressCard {
	i := slices.Index(q, card)
	if i < 0 {
		return q
	}
	out := make([]ProgressCard, 0, len(q)-1)
	out = append(out, q[:i]...)
	return append(out, q[i+1:]...)
}
