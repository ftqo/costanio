package knights

import (
	"errors"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

const (
	CmdImproveCity     engine.CommandType = "improve_city"
	CmdBuildKnight     engine.CommandType = "build_knight"
	CmdActivateKnight  engine.CommandType = "activate_knight"
	CmdPromoteKnight   engine.CommandType = "promote_knight"
	CmdMoveKnight      engine.CommandType = "move_knight"
	CmdChaseRobber     engine.CommandType = "chase_robber"
	CmdBuildWall       engine.CommandType = "build_wall"
	CmdPlayProgress    engine.CommandType = "play_progress"
	CmdDiscardProgress engine.CommandType = "discard_progress"
	CmdGiveCards       engine.CommandType = "give_cards"
	CmdHarborGive      engine.CommandType = "harbor_give"
	// Players know this as the "Merchant Guild" (Trade level 3). The wire string
	// keeps the old name because it is a persisted command type, and its event
	// cak_trading_house is replay schema.
	CmdTradingHouse       engine.CommandType = "trading_house"
	CmdCommodityTrade     engine.CommandType = "commodity_trade"
	CmdRelocateKnight     engine.CommandType = "relocate_knight"
	CmdDefenderDraw       engine.CommandType = "defender_draw"
	CmdBarbarianDowngrade engine.CommandType = "barbarian_downgrade"
	// CmdPillageBuyout is the other way to settle the same debt where a module
	// offers one: Rivers lets a player spend 5 coins to keep a city.
	CmdPillageBuyout      engine.CommandType = "pillage_buyout"
	CmdAqueductPick       engine.CommandType = "aqueduct_pick"
	CmdSpyPick            engine.CommandType = "spy_pick"
	CmdMasterMerchantPick engine.CommandType = "master_merchant_pick"
	CmdDeserterSurrender  engine.CommandType = "deserter_surrender"
	CmdDeserterPlace      engine.CommandType = "deserter_place"
	CmdMetropolisPick     engine.CommandType = "metropolis_pick"
)

var (
	costKnight       = engine.Hand{board.Sheep: 1, board.Ore: 1}
	costActivate     = engine.Hand{board.Wheat: 1}
	costWall         = engine.Hand{board.Brick: 2}
	costMedicineCity = engine.Hand{board.Ore: 2, board.Wheat: 1}
	// costMedicineHarbour is Medicine's other price under cak+explorers rule H:
	// 1 ore + 1 grain for a harbour settlement instead of a city.
	costMedicineHarbour = engine.Hand{board.Ore: 1, board.Wheat: 1}
)

// knightsPerLevel is the per-player piece supply at each tier: 2 basic, 2
// strong, 2 mighty. Building adds a basic and promoting swaps in a higher tier,
// so each is gated by the count already at that level.
const knightsPerLevel = 2

// knightCount is how many knights of exactly the given level player p fields.
func knightCount(x *Ext, p engine.PlayerID, level int) int {
	n := 0
	for _, k := range x.Knights {
		if k.Owner == p && k.Level == level {
			n++
		}
	}
	return n
}

// hasKnight reports whether player p has any knight on the board.
func hasKnight(x *Ext, p engine.PlayerID) bool {
	for _, k := range x.Knights {
		if k.Owner == p {
			return true
		}
	}
	return false
}

// hasKnightSpot reports whether player p has any legal vertex to build a knight.
func hasKnightSpot(s *engine.State, p engine.PlayerID) bool {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if (Module{}).checkKnightSpot(s, v, p) == nil {
				return true
			}
		}
	}
	return false
}

var (
	ErrNeedCity        = errors.New("cak: requires a city")
	ErrNoFreeCity      = errors.New("cak: requires a city without a metropolis")
	ErrAlreadyPromoted = errors.New("cak: that knight was already promoted this turn")
	ErrMaxImprovement  = errors.New("cak: improvement already at maximum")
	ErrNoCommodities   = errors.New("cak: insufficient commodities")
	ErrComSupplyEmpty  = errors.New("cak: commodity supply exhausted")
	ErrVertexTaken     = errors.New("cak: vertex occupied")
	ErrNoKnight        = errors.New("cak: no such knight of yours")
	ErrKnightState     = errors.New("cak: knight cannot do that right now")
	ErrMaxWalls        = errors.New("cak: wall limit reached")
	ErrNoProgressCard  = errors.New("cak: you do not hold that progress card")
	ErrNotOwed         = errors.New("cak: nothing owed")
	ErrBadGive         = errors.New("cak: give does not match what is owed")
	ErrHandNotOver     = errors.New("cak: progress hand is not over the limit")
	ErrMightyNeedsFort = errors.New("cak: level-3 knights need politics level 3")
	ErrNotSacrificable = errors.New("cak: not a city of yours the barbarians may raze")
	// ErrKnightInTheFog: cak+explorers rule D. Knights may not be built on or moved
	// onto intersections next to an undiscovered hex.
	ErrKnightInTheFog = errors.New("cak: knight next to an undiscovered hex")
)

func (m Module) Decide(s *engine.State, cmd engine.Command) ([]engine.Event, bool, error) {
	switch cmd.Type {
	case CmdImproveCity:
		ev, err := m.decideImprove(s, cmd, false)
		return ev, true, err
	case CmdBuildKnight:
		ev, err := m.decideBuildKnight(s, cmd)
		return ev, true, err
	case CmdActivateKnight:
		ev, err := m.decideActivateKnight(s, cmd)
		return ev, true, err
	case CmdPromoteKnight:
		ev, err := m.decidePromoteKnight(s, cmd, false)
		return ev, true, err
	case CmdMoveKnight:
		ev, err := m.decideMoveKnight(s, cmd)
		return ev, true, err
	case CmdChaseRobber:
		ev, err := m.decideChaseRobber(s, cmd)
		return ev, true, err
	case CmdBuildWall:
		ev, err := m.decideBuildWall(s, cmd)
		return ev, true, err
	case CmdPlayProgress:
		ev, err := m.decidePlayProgress(s, cmd)
		return ev, true, err
	case CmdDiscardProgress:
		ev, err := m.decideDiscardProgress(s, cmd)
		return ev, true, err
	case CmdGiveCards:
		ev, err := m.decideGiveCards(s, cmd)
		return ev, true, err
	case CmdHarborGive:
		ev, err := m.decideHarborGive(s, cmd)
		return ev, true, err
	case CmdTradingHouse:
		ev, err := m.decideTradingHouse(s, cmd)
		return ev, true, err
	case CmdCommodityTrade:
		ev, err := m.decideCommodityTrade(s, cmd)
		return ev, true, err
	case CmdRelocateKnight:
		ev, err := m.decideRelocateKnight(s, cmd)
		return ev, true, err
	case CmdDefenderDraw:
		ev, err := m.decideDefenderDraw(s, cmd)
		return ev, true, err
	case CmdBarbarianDowngrade:
		ev, err := m.decideBarbarianDowngrade(s, cmd)
		return ev, true, err
	case CmdPillageBuyout:
		ev, err := m.decidePillageBuyout(s, cmd)
		return ev, true, err
	case CmdAqueductPick:
		ev, err := m.decideAqueductPick(s, cmd)
		return ev, true, err
	case CmdSpyPick:
		ev, err := m.decideSpyPick(s, cmd)
		return ev, true, err
	case CmdMasterMerchantPick:
		ev, err := m.decideMasterMerchantPick(s, cmd)
		return ev, true, err
	case CmdDeserterSurrender:
		ev, err := m.decideDeserterSurrender(s, cmd)
		return ev, true, err
	case CmdDeserterPlace:
		ev, err := m.decideDeserterPlace(s, cmd)
		return ev, true, err
	case CmdMetropolisPick:
		ev, err := m.decideMetropolisPick(s, cmd)
		return ev, true, err
	default:
	}
	return nil, false, nil
}

// decideDeserterSurrender resolves the first Deserter step: the victim chooses
// which of their knights to give up. The knight is removed and the taker owes a
// placement of the same strength or lower, so the recorded level is a ceiling:
// the highest tier at or below the removed knight where the taker still has a
// free piece. With no legal spot or no free piece the replacement is forfeited
// and the victim still loses the knight. The active/inactive status carries
// over to the replacement.
func (m Module) decideDeserterSurrender(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.DeserterVictim != cmd.Player {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		V board.Vertex `json:"v"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	k, ok := x.Knights[d.V]
	if !ok || k.Owner != cmd.Player {
		return nil, ErrNoKnight
	}
	level := 0
	if hasKnightSpot(s, x.DeserterTaker) {
		for l := k.Level; l >= 1; l-- {
			if knightCount(x, x.DeserterTaker, l) < knightsPerLevel {
				level = l // the highest tier the taker can still field
				break
			}
		}
	}
	return []engine.Event{
		engine.NewEvent(EvKnightRemoved, knightRemovedData{Owner: cmd.Player, V: d.V}),
		engine.NewEvent(EvDeserterArmed, deserterData{Taker: x.DeserterTaker, Level: level, Active: k.Active}),
	}, nil
}

// decideDeserterPlace resolves the second Deserter step: the taker places the
// replacement on a vacant intersection of their roads, at any tier up to the
// owed ceiling (DeserterLevel). An omitted level means the ceiling, which is
// how older logs replay and what the timeout sends. The knight inherits
// DeserterActive. No Politics check: a removed mighty knight may be replaced
// by a mighty one without the Fortress, which only gates promotion.
func (m Module) decideDeserterPlace(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.DeserterTaker != cmd.Player || x.DeserterLevel == 0 {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		V     board.Vertex `json:"v"`
		Level int          `json:"level,omitempty"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	level := x.DeserterLevel
	if d.Level != 0 {
		if d.Level < 1 || d.Level > x.DeserterLevel {
			return nil, engine.ErrBadCommand // "the same strength or lower"
		}
		level = d.Level
	}
	if err := m.checkKnightSpot(s, d.V, cmd.Player); err != nil {
		return nil, err
	}
	if knightCount(x, cmd.Player, level) >= knightsPerLevel {
		return nil, engine.ErrNoPieces
	}
	return []engine.Event{
		// Fresh: the replacement was not on the board when this Action phase began, so
		// an active one may not act until the taker's next turn.
		engine.NewEvent(EvKnightBuilt, knightData{Player: cmd.Player, V: d.V, Free: true, Level: level,
			Active: x.DeserterActive, Fresh: x.DeserterActive}),
		engine.NewEvent(EvDeserterCleared, struct{}{}),
	}, nil
}

// decideSpyPick resolves the Spy look: the thief takes one card of their choice
// from the victim's (already-revealed-to-them) progress hand.
func (m Module) decideSpyPick(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.SpyThief != cmd.Player || x.SpyVictim == engine.NoPlayer {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		Card ProgressCard `json:"card"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !holdsCard(x.Players[x.SpyVictim].Progress, d.Card) {
		return nil, ErrNoProgressCard
	}
	return []engine.Event{engine.NewEvent(EvProgressStolen,
		progressStolenData{Thief: cmd.Player, Victim: x.SpyVictim, Card: d.Card}, cmd.Player, x.SpyVictim)}, nil
}

// decideMasterMerchantPick resolves the Master Merchant look: the thief takes up
// to 2 cards of their choice from the victim's (already-revealed-to-them)
// combined resource+commodity hand.
func (m Module) decideMasterMerchantPick(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.MMThief != cmd.Player || x.MMVictim == engine.NoPlayer {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		Cards *engine.Hand   `json:"cards,omitempty"`
		Coms  *CommodityHand `json:"coms,omitempty"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	victim := x.MMVictim
	var takeRes engine.Hand
	if d.Cards != nil {
		takeRes = *d.Cards
	}
	var takeCom CommodityHand
	if d.Coms != nil {
		takeCom = *d.Coms
	}
	if !takeRes.NonNegative() || !takeCom.nonNegative() {
		return nil, engine.ErrBadCommand
	}
	total := takeRes.Count() + takeCom.Count()
	// Take exactly 2 cards, or all of them if the victim holds fewer.
	limit := 2
	if have := s.Players[victim].Hand.Count() + x.Players[victim].Commodities.Count(); have < limit {
		limit = have
	}
	if total != limit {
		return nil, engine.ErrBadCommand
	}
	if !s.Players[victim].Hand.Has(takeRes) || !x.Players[victim].Commodities.Has(takeCom) {
		return nil, engine.ErrNoResources
	}
	thief := cmd.Player
	var events []engine.Event
	if takeRes.Count() > 0 {
		events = append(events, engine.NewEvent(EvCardsTaken,
			cardsMovedData{From: victim, To: thief, Cards: takeRes}, thief, victim))
	}
	if takeCom.Count() > 0 {
		events = append(events, engine.NewEvent(EvCommodityTaken,
			commodityMovedData{From: victim, To: thief, Cards: takeCom}, thief, victim))
	}
	return events, nil
}

// decideAqueductPick resolves a pending Aqueduct grant: the owed player takes
// one resource of their choice from the bank (or clears it with ResNone when the
// bank cannot cover the choice).
func (m Module) decideAqueductPick(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	owed := slices.Contains(x.Aqueduct, cmd.Player)
	if !owed {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		Res board.Resource `json:"res"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	// A concrete pick must be a real resource the bank can cover; ResNone is only
	// legal when no resource is available at all (empty bank).
	if d.Res == board.ResNone {
		if s.Bank.Count() > 0 {
			return nil, engine.ErrBadCommand
		}
	} else if !validRes(d.Res) || s.Bank[d.Res] < 1 {
		return nil, engine.ErrBadCommand
	}
	return []engine.Event{engine.NewEvent(EvAqueductTaken, aqueductTakenData{Player: cmd.Player, Res: d.Res})}, nil
}

// tradingHouseCost is how many of one commodity the guild takes for one good.
// It has the shape of a maritime ratio, so bestGoodRatio can publish it as one.
const tradingHouseCost = 2

// decideTradingHouse is the Trade-track level-3 ability (Merchant Guild): on
// your own turn, give 2 of one commodity and take any single resource or
// commodity. Only commodities are valid inputs. The output comes from the bank
// or the commodity's supply stack and is refused when that pile is empty.
func (m Module) decideTradingHouse(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	x := extRO(s)
	if x.Players[cmd.Player].Improve[Trade] < 3 {
		return nil, ErrMaxImprovement
	}
	d, err := engine.DecodeCommand[struct {
		Give   Commodity       `json:"give"` // the commodity spent (×2)
		GetRes *board.Resource `json:"get_res,omitempty"`
		GetCom *Commodity      `json:"get_com,omitempty"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.Give < 0 || d.Give >= commodityKinds {
		return nil, engine.ErrBadCommand
	}
	if (d.GetRes == nil) == (d.GetCom == nil) {
		return nil, engine.ErrBadCommand // exactly one output kind
	}
	if x.Players[cmd.Player].Commodities[d.Give] < tradingHouseCost {
		return nil, ErrNoCommodities
	}
	data := tradingHouseData{Player: cmd.Player, Give: d.Give}
	if d.GetRes != nil {
		if !validRes(*d.GetRes) || s.Bank[*d.GetRes] < 1 {
			return nil, engine.ErrBadCommand
		}
		data.GetRes = *d.GetRes
	} else {
		if *d.GetCom < 0 || *d.GetCom >= commodityKinds || *d.GetCom == d.Give {
			return nil, engine.ErrBadCommand // must be any other commodity
		}
		// The requested commodity must be on its stack. The pair spent is always a
		// different commodity (checked above), so it cannot refill this stack.
		if x.CommoditySupply[*d.GetCom] < 1 {
			return nil, ErrComSupplyEmpty
		}
		data.GetRes = board.ResNone
		data.GetCom = *d.GetCom
		data.ComOut = true
	}
	return []engine.Event{engine.NewEvent(EvTradingHouse, data)}, nil
}

// commodityBankRatio is the maritime ratio for spending a commodity with the
// supply: 4:1 by default, 3:1 with a generic port. Specific 2:1 harbors do not
// apply; the Trading House is the 2:1 commodity lane.
func (m Module) commodityBankRatio(s *engine.State, p engine.PlayerID, com Commodity) int {
	ratio := 4
	for v, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		if h, ok := s.Board.HarborAt(v); ok && h.Ratio == 3 {
			ratio = 3
		}
	}
	// A Merchant Fleet naming this commodity lowers it to 2:1 for the turn.
	x := extRO(s)
	if int(p) < len(x.ComFleet) && x.ComFleet[p] == int(com)+1 && ratio > 2 {
		ratio = 2
	}
	return ratio
}

// decideCommodityTrade is the maritime lane for commodities, in either
// direction with the supply. At least one side must be a commodity
// (resource-for-resource stays on the base bank trade). The give side pays the
// player's ratio for that good; received cards come off the bank or the supply
// stack, and the trade is refused if that pile cannot cover it.
func (m Module) decideCommodityTrade(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		GiveRes *board.Resource `json:"give_res,omitempty"`
		GiveCom *Commodity      `json:"give_com,omitempty"`
		GetRes  *board.Resource `json:"get_res,omitempty"`
		GetCom  *Commodity      `json:"get_com,omitempty"`
		Count   int             `json:"count"`

		// The basket form, selected by the presence of either want array, which
		// the scalar form never carries. See decideCommodityBasket.
		SpendRes *engine.Hand   `json:"spend_res,omitempty"`
		SpendCom *CommodityHand `json:"spend_com,omitempty"`
		WantRes  *engine.Hand   `json:"want_res,omitempty"`
		WantCom  *CommodityHand `json:"want_com,omitempty"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.WantRes != nil || d.WantCom != nil {
		return m.decideCommodityBasket(s, cmd.Player, d.SpendRes, d.SpendCom, d.WantRes, d.WantCom)
	}
	if (d.GiveRes == nil) == (d.GiveCom == nil) || (d.GetRes == nil) == (d.GetCom == nil) {
		return nil, engine.ErrBadCommand // exactly one give kind and one get kind
	}
	if d.GiveCom == nil && d.GetCom == nil {
		return nil, engine.ErrBadCommand // a pure resource↔resource trade is the base lane
	}
	count := d.Count
	if count <= 0 {
		count = 1
	}

	data := commodityTradeData{Player: cmd.Player, GiveRes: board.ResNone, GetRes: board.ResNone, Count: count}

	// Give side: validate and price.
	var ratio int
	if d.GiveCom != nil {
		if *d.GiveCom < 0 || *d.GiveCom >= commodityKinds {
			return nil, engine.ErrBadCommand
		}
		ratio = m.commodityBankRatio(s, cmd.Player, *d.GiveCom)
		data.GiveIsCom = true
		data.GiveCom = *d.GiveCom
	} else {
		if !validRes(*d.GiveRes) {
			return nil, engine.ErrBadCommand
		}
		ratio = s.BankRatio(cmd.Player, *d.GiveRes)
		data.GiveRes = *d.GiveRes
	}
	data.GiveN = ratio * count

	// Get side: validate and check the bank for resources.
	if d.GetCom != nil {
		if *d.GetCom < 0 || *d.GetCom >= commodityKinds {
			return nil, engine.ErrBadCommand
		}
		// No like-for-like trade, as in the base bank lane and the Trading House. Only
		// two matching commodities can collide here.
		if d.GiveCom != nil && *d.GetCom == *d.GiveCom {
			return nil, engine.ErrSameResource
		}
		data.GetIsCom = true
		data.GetCom = *d.GetCom
	} else {
		if !validRes(*d.GetRes) || s.Bank[*d.GetRes] < count {
			return nil, engine.ErrBadCommand
		}
		data.GetRes = *d.GetRes
	}

	// Affordability.
	x := extRO(s)
	if data.GiveIsCom {
		if x.Players[cmd.Player].Commodities[data.GiveCom] < data.GiveN {
			return nil, ErrNoCommodities
		}
	} else {
		var give engine.Hand
		give[data.GiveRes] = data.GiveN
		if !s.Players[cmd.Player].Hand.Has(give) {
			return nil, engine.ErrNoResources
		}
	}

	// A requested commodity must be on its stack, as a resource must be in the
	// bank. Spent cards land on their stack first, so a same-commodity trade can
	// draw on what it just returned.
	if data.GetIsCom {
		avail := x.CommoditySupply[data.GetCom]
		if data.GiveIsCom && data.GiveCom == data.GetCom {
			avail += data.GiveN
		}
		if avail < count {
			return nil, ErrComSupplyEmpty
		}
	}
	return []engine.Event{engine.NewEvent(EvCommodityTraded, data)}, nil
}

// decideCommodityBasket settles a whole maritime trade involving a commodity:
// any mix of give kinds funding any mix of taken kinds, each give kind priced
// at its own rate. It is the commodity-lane twin of decideBankBasket.
//
// With r(g) the player's rate for good g (harbor rate for a resource,
// commodityBankRatio for a commodity):
//
//	L1 the ask is non-empty
//	L2 no good appears on both sides
//	L3 r(g) divides spend(g), for every g
//	L4 sum(spend(g)/r(g)) equals the total asked for
//	L5 the player holds spend
//	L6 the bank holds the resources asked for, and each commodity stack the
//	   commodities asked for
//	L7 at least one side names a commodity
//
// L3 and L4 make payment exact: no partial trade, no change. L7 leaves pure
// resource baskets to the base lane. Every good has one price per player, so
// there is no routing choice and kind order does not matter. The Trading House
// is not folded in because its price is per use, which per-kind division
// cannot express.
func (m Module) decideCommodityBasket(s *engine.State, p engine.PlayerID, spendRes *engine.Hand, spendCom *CommodityHand, wantRes *engine.Hand, wantCom *CommodityHand) ([]engine.Event, error) {
	var sr, wr engine.Hand
	var sc, wc CommodityHand
	if spendRes != nil {
		sr = *spendRes
	}
	if spendCom != nil {
		sc = *spendCom
	}
	if wantRes != nil {
		wr = *wantRes
	}
	if wantCom != nil {
		wc = *wantCom
	}
	if !sr.NonNegative() || !wr.NonNegative() || sr[board.ResNone] != 0 || wr[board.ResNone] != 0 {
		return nil, engine.ErrBadCommand
	}
	for c := range commodityKinds {
		if sc[c] < 0 || wc[c] < 0 {
			return nil, engine.ErrBadCommand
		}
	}
	// L7 first: a basket with no commodity belongs to the base bank lane.
	comTouched := false
	for c := range commodityKinds {
		if sc[c] > 0 || wc[c] > 0 {
			comTouched = true
		}
	}
	if !comTouched {
		return nil, engine.ErrBadCommand
	}
	x := extRO(s)
	// L6 first, before any arithmetic: pile stock bounds every entry of the ask, so
	// no client-supplied number can overflow a later sum.
	if !s.Bank.Has(wr) {
		return nil, engine.ErrNoResources
	}
	get := wr.Count()
	for c := range commodityKinds {
		if wc[c] > x.CommoditySupply[c] {
			return nil, ErrComSupplyEmpty
		}
		get += wc[c]
	}
	if get < 1 {
		return nil, engine.ErrBadCommand // L1: a trade has to do something
	}
	// L5, also before the arithmetic, so every entry of the stake is bounded too.
	if !s.Players[p].Hand.Has(sr) {
		return nil, engine.ErrNoResources
	}
	for c := range commodityKinds {
		if sc[c] > x.Players[p].Commodities[c] {
			return nil, ErrNoCommodities
		}
	}
	// L2: a good on both sides would let a kind fund the card it buys back, which
	// breaks exact payment.
	for _, r := range board.Resources {
		if sr[r] > 0 && wr[r] > 0 {
			return nil, engine.ErrSameResource
		}
	}
	for c := range commodityKinds {
		if sc[c] > 0 && wc[c] > 0 {
			return nil, engine.ErrSameResource
		}
	}
	units := 0
	for _, r := range board.Resources {
		n := sr[r]
		if n == 0 {
			continue
		}
		ratio := s.BankRatio(p, r)
		if ratio < 1 || n%ratio != 0 {
			return nil, engine.ErrBadTrade // L3
		}
		units += n / ratio
	}
	for c := range commodityKinds {
		n := sc[c]
		if n == 0 {
			continue
		}
		ratio := m.commodityBankRatio(s, p, c)
		if ratio < 1 || n%ratio != 0 {
			return nil, engine.ErrBadTrade // L3
		}
		units += n / ratio
	}
	if units != get {
		return nil, engine.ErrBadTrade // L4
	}
	return []engine.Event{engine.NewEvent(EvCommodityBasket, commodityBasketData{
		Player: p, SpendRes: sr, SpendCom: sc, GetRes: wr, GetCom: wc,
	})}, nil
}

func (m Module) decideHarborGive(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	res, ok := x.HarborGive[cmd.Player]
	if !ok {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		Com Commodity `json:"com"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.Com < 0 || d.Com >= commodityKinds || x.Players[cmd.Player].Commodities[d.Com] < 1 {
		return nil, ErrBadGive
	}
	return []engine.Event{engine.NewEvent(EvHarborGiven,
		harborGivenData{Taker: x.HarborTaker, Giver: cmd.Player, Res: res, Com: d.Com},
		x.HarborTaker, cmd.Player)}, nil
}

func (m Module) decideImprove(s *engine.State, cmd engine.Command, crane bool) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		Track Track `json:"track"`
	}](cmd.Data)
	if err != nil || d.Track < 0 || d.Track >= trackKinds {
		return nil, engine.ErrBadCommand
	}
	if !playerHasCity(s, cmd.Player) {
		return nil, ErrNeedCity
	}
	x := extRO(s)
	level := x.Players[cmd.Player].Improve[d.Track]
	if level >= maxImprovement {
		return nil, ErrMaxImprovement
	}
	cost := level + 1
	if crane {
		cost--
		if cost < 0 {
			cost = 0
		}
	}
	var pay CommodityHand
	pay[commodityForTrack(d.Track)] = cost
	if !x.Players[cmd.Player].Commodities.Has(pay) {
		return nil, ErrNoCommodities
	}

	metro, err := (Module{}).metropolisEvents(s, x, d.Track, cmd.Player, level+1)
	if err != nil {
		return nil, err
	}
	events := []engine.Event{engine.NewEvent(EvImproved, improvedData{Player: cmd.Player, Track: d.Track, Cost: cost})}
	events = append(events, metro...)
	return events, nil
}

// metropolisClaim decides whether raising track t to newLevel puts that
// track's metropolis on p's board, and so whether a free city is required.
// metropolisEvents and Module.legalExtras both call it so the two cannot
// disagree. prev is the current holder (engine.NoPlayer if unclaimed) and is
// meaningful only when claims is true. claims is false below level 4, when p
// already holds it, and when p only matches another player's level.
func metropolisClaim(x *Ext, t Track, p engine.PlayerID, newLevel int) (prev engine.PlayerID, claims bool) {
	if newLevel < metropolisLevel {
		return engine.NoPlayer, false
	}
	holder := engine.NoPlayer
	holderLevel := 0
	for q := range x.Players {
		if x.Players[q].Metropolis[t] {
			holder = engine.PlayerID(q)
			holderLevel = x.Players[q].Improve[t]
		}
	}
	if holder == p {
		return holder, false
	}
	return holder, holder == engine.NoPlayer || newLevel > holderLevel
}

// metropolisEvents claims a metropolis at level 4 if unheld, or takes it at 5
// over a level-4 holder. It goes on a city that does not already hold one, and
// the player chooses which:
//
//   - no free city: ErrNoFreeCity, and the improvement is illegal.
//   - exactly one: placed now with no prompt (as in attackEvents).
//   - two or more: EvMetropolisPending arms the choice, answered with
//     CmdMetropolisPick, which emits EvMetropolis.
func (m Module) metropolisEvents(s *engine.State, x *Ext, t Track, p engine.PlayerID, newLevel int) ([]engine.Event, error) {
	prev, claims := metropolisClaim(x, t, p, newLevel)
	if !claims {
		return nil, nil
	}
	cities := m.freeCities(s, x, p)
	switch len(cities) {
	case 0:
		return nil, ErrNoFreeCity
	case 1:
		return []engine.Event{engine.NewEvent(EvMetropolis,
			metropolisData{Track: t, Holder: p, Prev: prev, V: cities[0]})}, nil
	default:
		return []engine.Event{engine.NewEvent(EvMetropolisPending,
			metropolisData{Track: t, Holder: p, Prev: prev})}, nil
	}
}

// decideMetropolisPick resolves a pending metropolis placement: the owed player
// names one of their metropolis-free cities. Anything else is rejected with
// state untouched.
func (m Module) decideMetropolisPick(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	pick := x.MetropolisPending
	if pick == nil || pick.Player != cmd.Player {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		V board.Vertex `json:"v"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	cities := m.freeCities(s, x, cmd.Player)
	if len(cities) == 0 {
		// Defensive: nothing eligible is left. Unreachable while the pick blocks the
		// turn, but the debt must still clear or the table hangs. A NoPlayer holder
		// means abandoned; see metropolisData.
		return []engine.Event{engine.NewEvent(EvMetropolis,
			metropolisData{Track: pick.Track, Holder: engine.NoPlayer, Prev: pick.Prev})}, nil
	}
	if !slices.Contains(cities, d.V) {
		return nil, ErrNoFreeCity
	}
	return []engine.Event{engine.NewEvent(EvMetropolis,
		metropolisData{Track: pick.Track, Holder: cmd.Player, Prev: pick.Prev, V: d.V})}, nil
}

// freeCities lists every city of p without a metropolis, in board order. It is
// the choice set for CmdMetropolisPick: zero blocks the improvement, one
// resolves without a prompt, more is a real choice. firstFreeCity is the
// auto-resolve default.
func (Module) freeCities(s *engine.State, x *Ext, p engine.PlayerID) []board.Vertex {
	var out []board.Vertex
	forEachVertex(s, func(v board.Vertex) {
		if b, ok := s.Buildings[v]; ok && b.Owner == p && b.City && !isMetropolisVertex(x, p, v) {
			out = append(out, v)
		}
	})
	return out
}

// firstFreeCity returns the player's first city (in deterministic board order)
// that does not already hold a metropolis. ok is false when every city of the
// player already holds one.
func (m Module) firstFreeCity(s *engine.State, x *Ext, p engine.PlayerID) (board.Vertex, bool) {
	cities := m.freeCities(s, x, p)
	if len(cities) == 0 {
		return board.Vertex{}, false
	}
	return cities[0], true
}

// drawDeckCard draws the top card of a track's deck: a uniformly weighted
// random card from the shuffled part, using the replay-deterministic RNG, or
// once that is exhausted the front of the bottom queue (under reports which).
// Returns false when the deck is empty.
func drawDeckCard(s *engine.State, x *Ext, track Track, offset int) (card ProgressCard, under, ok bool) {
	total := 0
	for _, n := range x.Decks[track] {
		total += n
	}
	if total == 0 {
		if q := x.Under[track]; len(q) > 0 {
			return q[0], true, true
		}
		return "", false, false
	}
	idx := engine.RngFor(s, offset).IntN(total)
	for _, c := range deckOrder[track] {
		if idx < x.Decks[track][c] {
			return c, false, true
		}
		idx -= x.Decks[track][c]
	}
	return "", false, false
}

// decideDefenderDraw resolves the front tied defender's progress-card draw from
// a deck of their choice. The queue drains in order so the current player
// draws first.
func (m Module) decideDefenderDraw(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if len(x.DefenderDraws) == 0 || cmd.Player != x.DefenderDraws[0] {
		return nil, ErrKnightState
	}
	d, err := engine.DecodeCommand[struct {
		Track Track `json:"track"`
	}](cmd.Data)
	if err != nil || d.Track < 0 || d.Track >= trackKinds {
		return nil, engine.ErrBadCommand
	}
	events := []engine.Event{}
	if card, under, ok := drawDeckCard(s, x, d.Track, 1); ok {
		events = append(events, engine.NewEvent(EvProgressDrawn,
			progressCardData{Player: cmd.Player, Card: card, Track: d.Track, Under: under}, cmd.Player))
	}
	events = append(events, engine.NewEvent(EvDefenderAdvance, struct{}{}))
	return events, nil
}

// decideBarbarianDowngrade resolves one losing player's choice of which of
// their own non-metropolis cities the barbarians raze. Only a seat listed as
// pending may send it; anything else is rejected with state untouched. Seats
// resolve independently and in any order.
func (m Module) decideBarbarianDowngrade(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if !slices.Contains(x.PendingDowngrade, cmd.Player) {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		V board.Vertex `json:"v"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	cities := m.downgradableCities(s, x, cmd.Player)
	if len(cities) == 0 {
		// Defensive: nothing left to raze. Unreachable while the pick blocks the turn,
		// but the debt must clear or the table hangs. Flagged as a forfeit so the feed
		// does not announce a city that was never taken.
		return []engine.Event{engine.NewEvent(EvBarbarianDowngraded, downgrade{Player: cmd.Player, Forfeit: true})}, nil
	}
	if !slices.Contains(cities, d.V) {
		return nil, ErrNotSacrificable
	}
	return []engine.Event{engine.NewEvent(EvBarbarianDowngraded, downgrade{Player: cmd.Player, V: d.V})}, nil
}

// decidePillageBuyout pays off a pending sacrifice instead of losing a city
// (Rivers: spend 5 coins to keep it). This module knows nothing about coins, so
// engine.PillageBuyoutFor returns the payment events and the paying module's
// refusal. With no buyout in the ruleset the command is refused. Offered once
// per pillage: the event clears the seat from PendingDowngrade.
func (Module) decidePillageBuyout(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if !slices.Contains(x.PendingDowngrade, cmd.Player) {
		return nil, ErrNotOwed
	}
	pay, ok, err := engine.PillageBuyoutFor(s, cmd.Player)
	if !ok {
		return nil, engine.ErrBadCommand
	}
	if err != nil {
		return nil, err
	}
	return append(pay, engine.NewEvent(EvPillageBoughtOut, downgrade{Player: cmd.Player})), nil
}

func playerHasCity(s *engine.State, p engine.PlayerID) bool {
	for _, b := range s.Buildings {
		if b.Owner == p && b.City {
			return true
		}
	}
	return false
}

func (m Module) decideBuildKnight(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[knightData](cmd.Data)
	if err != nil {
		return nil, err
	}
	if err := m.checkKnightSpot(s, d.V, cmd.Player); err != nil {
		return nil, err
	}
	// A new knight is a basic; you have only two basic pieces.
	if knightCount(extRO(s), cmd.Player, 1) >= knightsPerLevel {
		return nil, engine.ErrNoPieces
	}
	if !s.Players[cmd.Player].Hand.Has(costKnight) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvKnightBuilt, knightData{Player: cmd.Player, V: d.V})}, nil
}

// checkKnightSpot: empty vertex (no building, no knight) on land, touching the
// player's own route network. A new knight goes on land even in a sea game
// (only moves may end on a sea intersection), but ships count as routes, so the
// end of the player's own ship is a legal spot.
func (Module) checkKnightSpot(s *engine.State, v board.Vertex, p engine.PlayerID) error {
	if v.Side > board.S || !s.Board.LandVertex(v) {
		return engine.ErrBadPlacement
	}
	if _, taken := s.Buildings[v]; taken {
		return ErrVertexTaken
	}
	if _, taken := extRO(s).Knights[v]; taken {
		return ErrVertexTaken
	}
	// cak+explorers rule D: not on the fog's edge. See engine.Hooks.UnrevealedVertex.
	if s.UnrevealedVertex(v) {
		return ErrKnightInTheFog
	}
	// Building a knight is construction, so a module may refuse it (a Raiders
	// conquered hex). Moving onto the same corner is not building and stays legal.
	if s.NewConstructionBlocked(v) {
		return engine.ErrBadPlacement
	}
	for _, e := range v.Edges() {
		if owner, ok := s.Roads[e]; ok && owner == p {
			return nil
		}
		if owner, ok := s.ModuleRouteEdge(e); ok && owner == p {
			return nil
		}
	}
	return engine.ErrBadPlacement
}

// checkKnightMoveSpot validates a knight's destination, a weaker test than
// checkKnightSpot: on the board and empty, but not necessarily land or touching
// a route, since reachability connects a moved knight and it may end on a sea
// intersection.
func (Module) checkKnightMoveSpot(s *engine.State, v board.Vertex) error {
	if v.Side > board.S || !onBoardVertex(s, v) {
		return engine.ErrBadPlacement
	}
	if _, taken := s.Buildings[v]; taken {
		return ErrVertexTaken
	}
	if _, taken := extRO(s).Knights[v]; taken {
		return ErrVertexTaken
	}
	// cak+explorers rule D applies to moves as well as builds.
	if s.UnrevealedVertex(v) {
		return ErrKnightInTheFog
	}
	return nil
}

// onBoardVertex reports whether v is a corner of any tile on this board, land
// or sea. LandVertex is wrong for a sea destination.
func onBoardVertex(s *engine.State, v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if s.Board.Contains(h) {
			return true
		}
	}
	return false
}

// touchesOwnRoute reports whether any of p's roads or module route pieces (an
// Islands ship) touch v. The legal-set enumerators use it as a cheap necessary
// condition for knightReachable, to skip a BFS per vertex. For Intrigue it is
// the rule itself ("connected to at least one of your roads or shipping
// routes").
func touchesOwnRoute(s *engine.State, v board.Vertex, p engine.PlayerID) bool {
	for _, e := range v.Edges() {
		if owner, ok := s.Roads[e]; ok && owner == p {
			return true
		}
		if owner, ok := s.ModuleRouteEdge(e); ok && owner == p {
			return true
		}
	}
	return false
}

// routeMode names one of the two networks a knight may walk: its owner's roads,
// or (with a sea module loaded) its owner's ships.
type routeMode uint8

const (
	byRoad routeMode = iota
	byShip
)

// knightReachable reports whether a knight owned by `owner` at `from` can reach
// `to` along that player's continuous routes, passing only through
// intersections holding nothing but the owner's pieces. Ships count as routes
// (Knights-at-sea combination rules), and a knight may end on an empty sea
// intersection.
//
// Roads and ships form one route only where they meet at one of the owner's
// buildings, so the walk carries a mode that only an own building switches. A
// knight closes a route (anchorsRoute) but does not join two, so passing an own
// knight keeps the mode. At `from` both modes are open, since a standing knight
// may set out along any of its owner's pieces. With no sea module
// ModuleRouteEdge never answers and this is the plain road walk.
func knightReachable(s *engine.State, x *Ext, from, to board.Vertex, owner engine.PlayerID) bool {
	if from == to {
		return false
	}
	type step struct {
		v    board.Vertex
		mode routeMode
	}
	visited := make(map[step]bool, 32)
	queue := make([]step, 0, 16)
	push := func(st step) {
		if !visited[st] {
			visited[st] = true
			queue = append(queue, st)
		}
	}
	push(step{from, byRoad})
	push(step{from, byShip})
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, e := range cur.v.Edges() {
			if cur.mode == byRoad {
				if road, ok := s.Roads[e]; !ok || road != owner {
					continue // only travel your own roads
				}
			} else {
				if ship, ok := s.ModuleRouteEdge(e); !ok || ship != owner {
					continue // only travel your own ships
				}
			}
			w := e.Other(cur.v)
			if w == to {
				return true
			}
			// Own buildings and knights may be passed; an opponent's piece blocks.
			if b, taken := s.Buildings[w]; taken {
				if b.Owner != owner {
					continue
				}
				// An own building is where a road route and a ship route join.
				push(step{w, byRoad})
				push(step{w, byShip})
				continue
			}
			if k, taken := x.Knights[w]; taken && k.Owner != owner {
				continue
			}
			push(step{w, cur.mode})
		}
	}
	return false
}

func (m Module) decideActivateKnight(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[knightData](cmd.Data)
	if err != nil {
		return nil, err
	}
	k, ok := extRO(s).Knights[d.V]
	if !ok || k.Owner != cmd.Player {
		return nil, ErrNoKnight
	}
	if k.Active {
		return nil, ErrKnightState
	}
	if !s.Players[cmd.Player].Hand.Has(costActivate) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvKnightActivated, knightData{Player: cmd.Player, V: d.V})}, nil
}

func (m Module) decidePromoteKnight(s *engine.State, cmd engine.Command, free bool) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[knightData](cmd.Data)
	if err != nil {
		return nil, err
	}
	x := extRO(s)
	k, ok := x.Knights[d.V]
	if !ok || k.Owner != cmd.Player {
		return nil, ErrNoKnight
	}
	if k.Level >= maxKnightLevel {
		return nil, ErrKnightState
	}
	if k.Level == 2 && x.Players[cmd.Player].Improve[Politics] < 3 {
		return nil, ErrMightyNeedsFort
	}
	// Once per turn per knight (Knight.PromotedThisTurn).
	if k.PromotedThisTurn {
		return nil, ErrAlreadyPromoted
	}
	// Promotion swaps in a higher-tier piece; only two exist per tier.
	if knightCount(x, cmd.Player, k.Level+1) >= knightsPerLevel {
		return nil, engine.ErrNoPieces
	}
	if !free && !s.Players[cmd.Player].Hand.Has(costKnight) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvKnightPromoted, knightData{Player: cmd.Player, V: d.V, Free: free})}, nil
}

func (m Module) decideMoveKnight(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[knightMoveData](cmd.Data)
	if err != nil {
		return nil, err
	}
	x := extRO(s)
	k, ok := x.Knights[d.From]
	if !ok || k.Owner != cmd.Player {
		return nil, ErrNoKnight
	}
	if !k.Active || k.FreshlyActivated {
		return nil, ErrKnightState
	}
	// Displacement: a knight may move onto a strictly weaker enemy knight, which
	// relocates along its own roads or is removed.
	if target, occupied := x.Knights[d.To]; occupied {
		if target.Owner == cmd.Player {
			return nil, ErrVertexTaken
		}
		if target.Level >= k.Level {
			return nil, ErrKnightState // only a stronger knight can displace
		}
		if d.To.Side > board.S || !onBoardVertex(s, d.To) {
			return nil, engine.ErrBadPlacement
		}
		if _, built := s.Buildings[d.To]; built {
			return nil, ErrVertexTaken
		}
		if !knightReachable(s, x, d.From, d.To, cmd.Player) {
			return nil, engine.ErrBadPlacement
		}
		// The displaced knight's owner chooses the relocation (auto on timeout); apply
		// arms the pending relocation.
		return []engine.Event{engine.NewEvent(EvKnightDisplaced,
			knightDisplacedData{Mover: cmd.Player, From: &d.From, At: d.To})}, nil
	}
	if err := m.checkKnightMoveSpot(s, d.To); err != nil {
		return nil, err
	}
	if !knightReachable(s, x, d.From, d.To, cmd.Player) {
		return nil, engine.ErrBadPlacement // no connected route from→to
	}
	return []engine.Event{engine.NewEvent(EvKnightMoved, knightMoveData{Player: cmd.Player, From: d.From, To: d.To})}, nil
}

// firstReachableSpot returns the first empty intersection (board order) a
// displaced knight owned by `owner` could relocate to along its routes from
// `from`. False means the knight leaves the board.
func (Module) firstReachableSpot(s *engine.State, x *Ext, owner engine.PlayerID, from board.Vertex) (board.Vertex, bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if v.Side > board.S || !onBoardVertex(s, v) || !touchesOwnRoute(s, v, owner) {
				continue
			}
			if _, built := s.Buildings[v]; built {
				continue
			}
			if _, knight := x.Knights[v]; knight {
				continue
			}
			// Rule D: the timeout pick must not go where the player's own command would be
			// refused.
			if s.UnrevealedVertex(v) {
				continue
			}
			if knightReachable(s, x, from, v, owner) {
				return v, true
			}
		}
	}
	return board.Vertex{}, false
}

// decideRelocateKnight resolves a displaced knight's relocation: its owner moves
// it to an empty intersection reachable along their own routes from the vertex
// it was pushed off.
func (m Module) decideRelocateKnight(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.RelocPlayer == engine.NoPlayer || cmd.Player != x.RelocPlayer {
		return nil, ErrKnightState
	}
	d, err := engine.DecodeCommand[struct {
		To board.Vertex `json:"to"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.To.Side > board.S || !onBoardVertex(s, d.To) {
		return nil, engine.ErrBadPlacement
	}
	if _, built := s.Buildings[d.To]; built {
		return nil, ErrVertexTaken
	}
	if _, knight := x.Knights[d.To]; knight {
		return nil, ErrVertexTaken
	}
	// A relocation is a move, so rule D applies. The displacing knight needs no
	// check: it lands where the displaced knight stood, already outside the fog.
	if s.UnrevealedVertex(d.To) {
		return nil, ErrKnightInTheFog
	}
	if !knightReachable(s, x, x.RelocFrom, d.To, cmd.Player) {
		return nil, engine.ErrBadPlacement
	}
	return []engine.Event{engine.NewEvent(EvKnightRelocated, knightData{Player: cmd.Player, V: d.To})}, nil
}

// decideChaseRobber: an active, settled knight adjacent to the robber's hex
// drives it away, then deactivates. With a sea module the same command chases
// the pirate from a sea-hex intersection; the named hex picks the blocker and
// the sea case is delegated (engine.ChaseSeaBlockerFromModules).
func (m Module) decideChaseRobber(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		Barb   *int             `json:"barb,omitempty"`
		V      board.Vertex     `json:"v"`
		Hex    board.Hex        `json:"hex"`
		Victim *engine.PlayerID `json:"victim"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	x := extRO(s)
	k, ok := x.Knights[d.V]
	if !ok || k.Owner != cmd.Player || !k.Active || k.FreshlyActivated {
		return nil, ErrKnightState
	}
	if d.Barb != nil {
		evs, err := engine.ChaseEdgeBlockerFromModules(s, cmd.Player, d.V, *d.Barb)
		if err != nil {
			return nil, err
		}
		stand := engine.NewEvent(EvKnightMoved, knightMoveData{Player: cmd.Player, From: d.V, To: d.V})
		return append([]engine.Event{stand}, evs...), nil
	}
	if robberLocked(s) {
		return nil, ErrKnightState
	}
	// A sea hex means the pirate. The knight stands down as on land; the owning
	// module handles the move and the steal. Offset 1 puts the steal after the
	// stand-down and move, as on land.
	if !s.Board.Land(d.Hex) {
		stand := engine.NewEvent(EvKnightMoved, knightMoveData{Player: cmd.Player, From: d.V, To: d.V})
		evs, handled, err := engine.ChaseSeaBlockerFromModules(s, cmd.Player, d.V, d.Hex, d.Victim, 1)
		if err != nil {
			return nil, err
		}
		if !handled {
			return nil, engine.ErrBadPlacement // no sea blocker in this game
		}
		return append([]engine.Event{stand}, evs...), nil
	}

	adjacent := false
	for _, h := range d.V.Hexes() {
		if h == s.Board.Robber {
			adjacent = true
		}
	}
	if !adjacent {
		return nil, ErrKnightState
	}
	if d.Hex == s.Board.Robber || !engine.RobberMayEnter(s, d.Hex) {
		return nil, engine.ErrBadPlacement
	}

	// The knight stands down, the robber moves, an optional steal follows, all
	// with the base robber events.
	events := []engine.Event{
		engine.NewEvent(EvKnightMoved, knightMoveData{Player: cmd.Player, From: d.V, To: d.V}), // in-place deactivation
		engine.NewEvent(engine.EvRobberMoved, engine.RobberMovedData{Player: cmd.Player, Hex: d.Hex}),
	}
	// engine.RobberVictims applies DiscardableCount (module-aware, so commodities
	// count) and the friendly-robber shield, matching what the client shows.
	victims := engine.RobberVictims(s, d.Hex, cmd.Player)
	if len(victims) == 0 {
		if d.Victim != nil {
			return nil, engine.ErrBadVictim
		}
		return events, nil
	}
	if d.Victim == nil || !victims[*d.Victim] {
		return nil, engine.ErrBadVictim
	}
	victim := *d.Victim
	// Steal through the module hook chain like the base robber and pirate, so the
	// pool is whatever the active modules define. The offset (after deactivation
	// and move) is unchanged, so existing logs replay the same draw.
	if ev, ok := engine.StealCardFromModules(s, cmd.Player, victim, len(events)); ok {
		events = append(events, ev)
		return events, nil
	}
	res, _ := engine.RandomCard(engine.RngFor(s, len(events)), s.Players[victim].Hand)
	events = append(events, engine.NewEvent(engine.EvCardStolen,
		engine.CardStolenData{Thief: cmd.Player, Victim: victim, Res: res}, cmd.Player, victim))
	return events, nil
}

func (m Module) decideBuildWall(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	if !playerHasCity(s, cmd.Player) {
		return nil, ErrNeedCity
	}
	x := extRO(s)
	if x.Players[cmd.Player].Walls >= 3 {
		return nil, ErrMaxWalls
	}
	d, err := engine.DecodeCommand[struct {
		V *board.Vertex `json:"v"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	// The player picks which unwalled city to fortify (barbarians downgrade
	// unwalled cities first). An empty payload walls the first unwalled city in
	// board order, as older clients expect.
	if d.V != nil {
		if !wallableCity(s, x, cmd.Player, *d.V) {
			return nil, engine.ErrBadPlacement
		}
	}
	target, ok := firstWallableCity(s, x, cmd.Player)
	if !ok {
		if _, unwalled := firstUnwalledCity(s, x, cmd.Player); unwalled {
			// Unwalled cities exist, but a module refuses a build at every one
			// (a Raiders conquered hex beside each).
			return nil, engine.ErrBadPlacement
		}
		return nil, ErrMaxWalls // every city already walled
	}
	if d.V != nil {
		target = *d.V
	}
	if !s.Players[cmd.Player].Hand.Has(costWall) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvWallBuilt, wallData{Player: cmd.Player, V: target})}, nil
}

func (m Module) decideDiscardProgress(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	d, err := engine.DecodeCommand[struct {
		Card ProgressCard `json:"card"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	x := extRO(s)
	px := x.Players[cmd.Player]
	if len(px.Progress) <= progressHandSize {
		return nil, ErrHandNotOver
	}
	if !holdsCard(px.Progress, d.Card) {
		return nil, ErrNoProgressCard
	}
	// Visible to the discarder only; others see {player, track} (the card is
	// discarded face-down).
	return []engine.Event{engine.NewEvent(EvProgressDiscard,
		progressCardData{Player: cmd.Player, Card: d.Card, Track: trackOf(d.Card), Under: true}, cmd.Player)}, nil
}

func (m Module) decideGiveCards(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	owed, ok := x.PendingGive[cmd.Player]
	if !ok {
		return nil, ErrNotOwed
	}
	d, err := engine.DecodeCommand[struct {
		Cards engine.Hand   `json:"cards"`
		Coms  CommodityHand `json:"coms"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	// The giver chooses how to pay from their combined resource+commodity hand,
	// clamped to what they hold.
	give := owed
	if have := s.Players[cmd.Player].Hand.Count() + x.Players[cmd.Player].Commodities.Count(); have < give {
		give = have
	}
	if !d.Cards.NonNegative() || !d.Coms.nonNegative() ||
		d.Cards.Count()+d.Coms.Count() != give ||
		!s.Players[cmd.Player].Hand.Has(d.Cards) || !x.Players[cmd.Player].Commodities.Has(d.Coms) {
		return nil, ErrBadGive
	}
	var events []engine.Event
	// A giver whose hand is empty still settles with an empty give. It must be an
	// event because the fold clears PendingGive. (The hand can empty after the
	// Wedding counted it, e.g. the cak+explorers pirate steals the last card.)
	if give == 0 {
		return []engine.Event{engine.NewEvent(EvCardsGiven,
			cardsMovedData{From: cmd.Player, To: x.WeddingTo}, cmd.Player, x.WeddingTo)}, nil
	}
	if d.Cards.Count() > 0 {
		events = append(events, engine.NewEvent(EvCardsGiven,
			cardsMovedData{From: cmd.Player, To: x.WeddingTo, Cards: d.Cards}, cmd.Player, x.WeddingTo))
	}
	if d.Coms.Count() > 0 {
		events = append(events, engine.NewEvent(EvCommodityTaken,
			commodityMovedData{From: cmd.Player, To: x.WeddingTo, Cards: d.Coms}, cmd.Player, x.WeddingTo))
	}
	return events, nil
}

func holdsCard(hand []ProgressCard, card ProgressCard) bool {
	return slices.Contains(hand, card)
}
