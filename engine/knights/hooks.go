package knights

import (
	"encoding/json"
	"slices"
	"sort"
	"strings"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// internal bookkeeping events.
const (
	evWeddingOwed    engine.EventType = "cak_wedding_owed"
	evDiceUnfixed    engine.EventType = "cak_dice_unfixed"
	evKnightsRefresh engine.EventType = "cak_knights_refresh"
)

type weddingOwedData struct {
	To   engine.PlayerID        `json:"to"`
	Owed []engine.PlayerDiscard `json:"owed"`
}

func (m Module) Hooks() engine.Hooks {
	return engine.Hooks{
		OnDiceRolled:       m.onDiceRolled,
		OnEvents:           m.onEvents,
		Blocks:             m.blocks,
		Auto:               m.auto,
		PendingDeciders:    m.pendingDeciders,
		VictoryCheck:       m.victory,
		DiscardLimitDelta:  m.discardLimitDelta,
		ExtraDiscardCount:  m.extraDiscardCount,
		HandleDiscard:      m.handleDiscard,
		AutoDiscard:        m.autoDiscard,
		BlocksVertex:       m.blocksVertex,
		AnchorsRoute:       m.anchorsRoute,
		LegalExtras:        m.legalExtras,
		PendingTargets:     m.pendingTargets,
		FixedDice:          m.fixedDice,
		BankRatio:          m.bankRatio,
		GoodRatios:         m.goodRatios,
		GoodMaritimeRatios: m.goodMaritimeRatios,
		TradeExtraHeld:     tradeExtraHeld,
		TradeExtraEvents:   tradeExtraEvents,
		SellGood:           sellGood,
		CityResourceYield:  cityResourceYield,
		NoDevCards:         true,
		NoRobber:           robberLocked,
		SetupRound2City:    true,
		StealCard:          m.stealCard,
		ProgressDecks:      func(*engine.State) int { return int(trackKinds) },
		DrawProgressCard:   drawProgressForModule,
		MustUpgradeFirst:   m.mustUpgradeFirst,
		BlocksTurnActions:  m.blocksTurnActions,
		RevealHands:        m.revealHands,
	}
}

// drawProgressForModule is the Hooks.DrawProgressCard entry point: it deals p
// one card from the named discipline for an effect owned by another module
// (Fishermen's seven-fish spend). It uses drawDeckCard, so it draws from the
// live deck on the replay-deterministic RNG and returns false on an empty deck.
func drawProgressForModule(s *engine.State, p engine.PlayerID, deck, offset int) (engine.Event, bool) {
	if deck < 0 || deck >= int(trackKinds) {
		return engine.Event{}, false
	}
	track := Track(deck)
	card, under, ok := drawDeckCard(s, extRO(s), track, offset)
	if !ok {
		return engine.Event{}, false
	}
	return engine.NewEvent(EvProgressDrawn, progressCardData{Player: p, Card: card, Track: track, Under: under}, p), true
}

// revealHands lets the Master Merchant thief see the victim's resource hand
// (the commodity half is revealed via ExtView) while the look is open.
func (Module) revealHands(s *engine.State, viewer engine.PlayerID) []engine.PlayerID {
	x := extRO(s)
	if x.MMThief != engine.NoPlayer && x.MMThief == viewer && x.MMVictim != engine.NoPlayer {
		return []engine.PlayerID{x.MMVictim}
	}
	return nil
}

// mmAutoTake picks up to n cards from a combined resource+commodity hand,
// lowest-index resources first, then commodities. Used when a Master Merchant
// look times out.
func mmAutoTake(res engine.Hand, com CommodityHand, n int) (engine.Hand, CommodityHand) {
	var takeRes engine.Hand
	var takeCom CommodityHand
	for r := board.Wood; r <= board.Ore && n > 0; r++ {
		for res[r]-takeRes[r] > 0 && n > 0 {
			takeRes[r]++
			n--
		}
	}
	for c := Commodity(0); c < commodityKinds && n > 0; c++ {
		for com[c]-takeCom[c] > 0 && n > 0 {
			takeCom[c]++
			n--
		}
	}
	return takeRes, takeCom
}

// blocksTurnActions gates the active player's voluntary actions. Unlike
// blocks(), the active player's own over-limit progress hand does not block
// them: they may build and trade and get down to 4 by end of turn. Off-turn
// over-limit hands and hard pendings still block.
func (m Module) blocksTurnActions(s *engine.State) bool {
	if m.hardPending(s) {
		return true
	}
	x := extRO(s)
	for p := range x.Players {
		if engine.PlayerID(p) != s.Cur && len(x.Players[p].Progress) > progressHandSize {
			return true
		}
	}
	return false
}

// mustUpgradeFirst pins the next city upgrade to a laid-on-side city (one
// pillaged with no settlement piece in supply), oldest first. The pin clears
// itself once the vertex is a city again, so no event is needed and logs from
// before EvLaidCityRestored replay unchanged.
func (Module) mustUpgradeFirst(s *engine.State, p engine.PlayerID) (board.Vertex, bool) {
	return firstLaid(s, extRO(s), p)
}

// stealCard draws one uniformly random card from the victim's combined
// resource+commodity hand for the 7-roll robber (the base engine's resource-only
// steal cannot see commodities). Returns false when the victim holds nothing.
func (m Module) stealCard(s *engine.State, thief, victim engine.PlayerID, offset int) (engine.Event, bool) {
	x := extRO(s)
	hand := s.Players[victim].Hand
	coms := x.Players[victim].Commodities
	if hand.Count()+coms.Count() == 0 {
		return engine.Event{}, false
	}
	res, com, isCom := randomCombinedCard(s, offset, hand, coms)
	if isCom {
		return engine.NewEvent(EvCommodityStolen,
			commodityStolenData{Thief: thief, Victim: victim, Com: com}, thief, victim), true
	}
	return engine.NewEvent(engine.EvCardStolen,
		engine.CardStolenData{Thief: thief, Victim: victim, Res: res}, thief, victim), true
}

// raidersName is the Raiders ruleset token. Modules do not import each other.
const raidersName = "raiders"

// barbariansSail reports whether the Knights barbarian fleet is in play. In a
// Raiders game it is not: the combination rules replace the fleet, its track
// and the Defender VP with the Raiders coast, so the ship face advances nothing.
// The event die is still rolled and its gate faces still deal progress cards,
// because verify/ re-derives the die from the seed and skipping it would shift
// every later draw.
func barbariansSail(s *engine.State) bool {
	return !slices.Contains(strings.Split(s.Config.Ruleset, "+"), raidersName)
}

// robberLocked reports whether the robber is still out of play: in Knights the
// robber does not move (and cannot be chased or relocated by progress cards)
// until the barbarians land for the first time.
func robberLocked(s *engine.State) bool { return extRO(s).Attacks == 0 }

// tradeExtraKind classifies a shared player-trade payload for this module.
type tradeExtraKind int

const (
	// tradeExtraMine: a commodity payload, in one of the two shapes below.
	tradeExtraMine tradeExtraKind = iota
	// tradeExtraOther: well-formed JSON naming no commodities (another module's
	// part of the payload).
	tradeExtraOther
	// tradeExtraBad: not JSON. Refused.
	tradeExtraBad
)

// decodeTradeExtra reads this module's part of a player-trade payload. Two
// shapes are accepted: the bare array (what every logged offer holds) and an
// object with a key per module, needed because the engine passes one shared
// blob to every module's TradeExtraHeld and Rivers moves coins through it as
// {"coins": n}. An unrecognised payload must report (0, true) so it does not
// veto another module's trade; only unreadable input is refused.
func decodeTradeExtra(extra json.RawMessage) (CommodityHand, tradeExtraKind) {
	if len(extra) == 0 {
		return CommodityHand{}, tradeExtraOther
	}
	var coms CommodityHand
	if err := json.Unmarshal(extra, &coms); err == nil {
		return coms, tradeExtraMine
	}
	var obj struct {
		Commodities *CommodityHand `json:"commodities"`
	}
	if err := json.Unmarshal(extra, &obj); err == nil {
		if obj.Commodities == nil {
			return CommodityHand{}, tradeExtraOther
		}
		return *obj.Commodities, tradeExtraMine
	}
	if json.Valid(extra) {
		// Readable, but neither shape: another module's.
		return CommodityHand{}, tradeExtraOther
	}
	return CommodityHand{}, tradeExtraBad
}

// tradeExtraHeld interprets a player-trade commodity payload: how many commodity
// cards it represents and whether p holds them all. Empty or another module's
// gives (0, true); unreadable gives (0, false).
func tradeExtraHeld(s *engine.State, p engine.PlayerID, extra json.RawMessage) (int, bool) {
	coms, kind := decodeTradeExtra(extra)
	switch kind {
	case tradeExtraOther:
		return 0, true
	case tradeExtraBad:
		return 0, false
	case tradeExtraMine:
		// Fall through to the holding check below.
	}
	if !coms.nonNegative() {
		return 0, false
	}
	n := coms.Count()
	if n == 0 {
		return 0, true
	}
	return n, extRO(s).Players[p].Commodities.Has(coms)
}

// tradeExtraEvents moves a commodity payload from→to as part of a player trade.
func tradeExtraEvents(s *engine.State, from, to engine.PlayerID, extra json.RawMessage) []engine.Event {
	coms, kind := decodeTradeExtra(extra)
	if kind != tradeExtraMine || coms.Count() == 0 {
		return nil
	}
	// Scoped to the two traders like the other commodity moves; the offer is
	// public anyway.
	return []engine.Event{engine.NewEvent(EvCommodityTaken, commodityMovedData{From: from, To: to, Cards: coms}, from, to)}
}

// extraDiscardCount: a player's commodities count toward the 7-roll discard.
func (Module) extraDiscardCount(s *engine.State, p engine.PlayerID) int {
	return extRO(s).Players[p].Commodities.Count()
}

// handleDiscard validates a Knights 7-roll discard, which may spend resources and
// commodities; their combined count must equal the required number.
func (m Module) handleDiscard(s *engine.State, cmd engine.Command, need int) ([]engine.Event, bool, error) {
	d, err := engine.DecodeCommand[struct {
		Cards       engine.Hand   `json:"cards"`
		Commodities CommodityHand `json:"commodities"`
	}](cmd.Data)
	if err != nil {
		return nil, true, err
	}
	if !d.Cards.NonNegative() {
		return nil, true, engine.ErrBadDiscard
	}
	for i := range d.Commodities {
		if d.Commodities[i] < 0 {
			return nil, true, engine.ErrBadDiscard
		}
	}
	if d.Cards.Count()+d.Commodities.Count() != need {
		return nil, true, engine.ErrBadDiscard
	}
	if !s.Players[cmd.Player].Hand.Has(d.Cards) || !extRO(s).Players[cmd.Player].Commodities.Has(d.Commodities) {
		return nil, true, engine.ErrBadDiscard
	}
	events := []engine.Event{}
	if d.Cards.Count() > 0 {
		events = append(events, engine.NewEvent(engine.EvCardsDiscarded, engine.CardsDiscardedData{Player: cmd.Player, Cards: d.Cards}))
	}
	if d.Commodities.Count() > 0 {
		events = append(events, engine.NewEvent(EvCommodityDiscarded, commodityDiscardData{Player: cmd.Player, Cards: d.Commodities}))
	}
	return events, true, nil
}

// autoDiscard spends resources first, then commodities for the remainder.
func (Module) autoDiscard(s *engine.State, p engine.PlayerID, need int) (engine.Command, bool) {
	cards := spreadResources(s.Players[p].Hand, need)
	rest := need - cards.Count()
	coms := spreadCommodities(extRO(s).Players[p].Commodities, rest)
	data, _ := json.Marshal(map[string]any{"cards": cards, "commodities": coms})
	return engine.Command{Player: p, Type: engine.CmdDiscardCards, Data: data}, true
}

// spreadResources / spreadCommodities take n cards round-robin across a hand.
func spreadResources(h engine.Hand, n int) engine.Hand {
	var out engine.Hand
	for n > 0 {
		took := false
		for r := range h {
			if h[r] > out[r] && n > 0 {
				out[r]++
				n--
				took = true
			}
		}
		if !took {
			break
		}
	}
	return out
}

func spreadCommodities(h CommodityHand, n int) CommodityHand {
	var out CommodityHand
	for n > 0 {
		took := false
		for i := range h {
			if h[i] > out[i] && n > 0 {
				out[i]++
				n--
				took = true
			}
		}
		if !took {
			break
		}
	}
	return out
}

// bankRatio grants 2:1 on the player's active Merchant Fleet good this turn, and
// on the resource of the merchant token's hex while the player controls it.
func (m Module) bankRatio(s *engine.State, p engine.PlayerID, res board.Resource) (int, bool) {
	x := extRO(s)
	if int(p) < len(x.Fleet) && x.Fleet[p] == res+1 {
		return 2, true
	}
	if x.Merchant != nil && x.MerchantOwner == p {
		if tile, ok := s.Board.Tiles[*x.Merchant]; ok && tile.Res == res {
			return 2, true
		}
	}
	return 0, false
}

// goodRatios publishes what each commodity costs this player at the bank so
// the client does not have to infer it. "Worst of my five resource rates" is
// wrong for a player with all five specific harbors and no generic port.
func (m Module) goodRatios(s *engine.State, p engine.PlayerID) map[string]int {
	return map[string]int{
		"cloth": m.bestGoodRatio(s, p, Cloth),
		"paper": m.bestGoodRatio(s, p, Paper),
		"coin":  m.bestGoodRatio(s, p, Coin),
	}
}

// sellGood hands one commodity back to its stack for a price another module is
// paying (engine.Hooks.SellGood; the only caller is Explorers' Fast Gold under
// cak+explorers rule G). Good names are goodRatios' keys.
func sellGood(s *engine.State, p engine.PlayerID, good string) ([]engine.Event, bool, error) {
	var c Commodity
	switch good {
	case "cloth":
		c = Cloth
	case "paper":
		c = Paper
	case "coin":
		c = Coin
	default:
		return nil, false, nil // not a good this module owns
	}
	if extRO(s).Players[p].Commodities[c] < 1 {
		return nil, true, ErrNoCommodities
	}
	return []engine.Event{engine.NewEvent(EvCommoditySold,
		commoditySoldData{Player: p, Commodity: c})}, true, nil
}

// goodMaritimeRatios publishes what commodity_trade charges per commodity.
// This differs from goodRatios, which folds in the Trading House; a basket can
// only be priced on the maritime lane because the Trading House converts one
// good per use.
func (m Module) goodMaritimeRatios(s *engine.State, p engine.PlayerID) map[string]int {
	return map[string]int{
		"cloth": m.commodityBankRatio(s, p, Cloth),
		"paper": m.commodityBankRatio(s, p, Paper),
		"coin":  m.commodityBankRatio(s, p, Coin),
	}
}

// bestGoodRatio is the cheapest lane this player can reach for a commodity.
// commodity_trade always charges commodityBankRatio, but a Trade-track Trading
// House converts 2 of a commodity into any other good via a separate command,
// so it folds in as a 2:1 rate.
func (m Module) bestGoodRatio(s *engine.State, p engine.PlayerID, com Commodity) int {
	ratio := m.commodityBankRatio(s, p, com)
	x := extRO(s)
	if int(p) < len(x.Players) && x.Players[p].Improve[Trade] >= 3 && ratio > tradingHouseCost {
		ratio = tradingHouseCost
	}
	return ratio
}

// DefaultConfig: Knights plays to 13 VP unless configured otherwise.
func (Module) DefaultConfig(cfg engine.GameConfig) engine.GameConfig {
	// cak+explorers: the scenario owns the target and this module adds to it
	// (AdjustTargetVP). DefaultConfig is first-writer-wins and "cak" sorts before
	// "explorers", so setting 13 here would win.
	if cfg.TargetVP == 0 && !rulesetHas(cfg.Ruleset, explorersName) {
		cfg.TargetVP = defaultTargetVP
	}
	return cfg
}

// AdjustTargetVP adds 5 to the Explorers target (17) in a cak+explorers game,
// for cities, metropolises and the Defender title. Every other Knights ruleset
// returns 0 and keeps 13.
func (Module) AdjustTargetVP(cfg engine.GameConfig) int {
	if rulesetHas(cfg.Ruleset, explorersName) {
		return explorersPairingBonus
	}
	return 0
}

func (Module) fixedDice(s *engine.State) (d1, d2 int, ok bool) {
	x := extRO(s)
	if x.AlchemistD1 > 0 {
		return x.AlchemistD1, x.AlchemistD2, true
	}
	return 0, 0, false
}

// onDiceRolled rolls the event die and resolves its consequences: barbarian
// advance (and attack on landfall) or progress-card gates.
func (m Module) onDiceRolled(s *engine.State, d1, d2 int) []engine.Event {
	x := extRO(s)
	var events []engine.Event
	if x.AlchemistD1 > 0 {
		events = append(events, engine.NewEvent(evDiceUnfixed, struct{}{}))
	}

	// Before the first landfall a 7 only triggers discards: robberLocked
	// suppresses the move, silently in the base engine, so announce it here.
	// Uses the pre-roll Attacks, as engine.Apply does when setting RobberPending,
	// so a 7 on the roll of the first landfall is still idle. Skipped when the
	// barbarians never sail.
	if d1+d2 == 7 && x.Attacks == 0 && barbariansSail(s) {
		events = append(events, engine.NewEvent(EvRobberIdle, struct{}{}))
	}

	red := d2
	// The event die comes from the public stream so verify/ can re-derive it with
	// the 2d6. Its slot is EventDieSeq(s.NextSeq), a reserved descending run: an
	// offset from NextSeq would share a seq, and so a first draw, with the dice.
	die := engine.PublicRngForSeed(s.PublicSeed, engine.EventDieSeq(s.NextSeq)).IntN(6)
	face := "ship"
	var gate Track
	hasGate := false
	switch die {
	case 3:
		face, gate, hasGate = "trade", Trade, true
	case 4:
		face, gate, hasGate = "politics", Politics, true
	case 5:
		face, gate, hasGate = "science", Science, true
	}
	events = append(events, engine.NewEvent(EvEventDie, eventDieData{Face: face, Red: red}))

	// All progress draws this roll share local deck copies and unique rng
	// offsets so they stay replay-deterministic.
	var local [trackKinds]map[ProgressCard]int
	var remaining [trackKinds]int
	var under [trackKinds][]ProgressCard
	for t := range x.Decks {
		local[t] = map[ProgressCard]int{}
		for card, n := range x.Decks[t] {
			local[t][card] = n
			remaining[t] += n
		}
		under[t] = x.Under[t]
	}
	offset := 20
	draw := func(p engine.PlayerID, track Track) (engine.Event, bool) {
		if remaining[track] == 0 {
			// The shuffled part is used up: draw from what was put underneath, oldest
			// first.
			if len(under[track]) == 0 {
				return engine.Event{}, false
			}
			card := under[track][0]
			under[track] = under[track][1:]
			return engine.NewEvent(EvProgressDrawn, progressCardData{Player: p, Card: card, Track: track, Under: true}, p), true
		}
		idx := engine.RngFor(s, offset).IntN(remaining[track])
		offset++
		var card ProgressCard
		for _, c := range deckOrder[track] {
			if idx < local[track][c] {
				card = c
				break
			}
			idx -= local[track][c]
		}
		local[track][card]--
		remaining[track]--
		return engine.NewEvent(EvProgressDrawn, progressCardData{Player: p, Card: card, Track: track}, p), true
	}

	if face == "ship" && barbariansSail(s) && x.Barbarians+1 >= configFrom(s.Config).barbarianDistance() {
		// On a defended win with tied strongest defenders, the attack event arms a
		// per-player deck choice (CmdDefenderDraw), resolved after the roll.
		atk, _ := m.attackEvents(s, x)
		events = append(events, atk...)
	}

	if hasGate {
		// A player draws when the red die is at most their improvement level plus one
		// in that discipline (level 1 draws on red 1-2, level 5 on any value). Needs
		// level 1 or more.
		for _, p := range playersFromCurrent(s) {
			level := x.Players[p].Improve[gate]
			if level < 1 || red > level+1 {
				continue
			}
			if e, ok := draw(p, gate); ok {
				events = append(events, e)
			}
		}
	}
	return events
}

// playersFromCurrent lists all players in turn order starting with the current
// player. Progress draws this roll are dealt in this order, so the current
// player has priority when a deck runs out.
func playersFromCurrent(s *engine.State) []engine.PlayerID {
	n := engine.PlayerID(len(s.Players))
	out := make([]engine.PlayerID, 0, n)
	for i := range n {
		out = append(out, (s.Cur+i)%n)
	}
	return out
}

// deckTotal is the number of cards remaining in a discipline's progress deck,
// the shuffled part and the bottom together.
func deckTotal(x *Ext, t Track) int {
	n := len(x.Under[t])
	for _, c := range x.Decks[t] {
		n += c
	}
	return n
}

// bestTrack is the discipline a player has improved most (≥1), for the
// tied-defender progress draw. Ties break by track order.
func bestTrack(x *Ext, p engine.PlayerID) (Track, bool) {
	best, bestTr := 0, Track(0)
	for t := range trackKinds {
		if lvl := x.Players[p].Improve[t]; lvl > best {
			best, bestTr = lvl, t
		}
	}
	return bestTr, best >= 1
}

// attackEvents computes the barbarian landfall from the pre-roll state. It
// returns the attack event plus, on a tied defended win, the list of tied
// strongest defenders (each of whom draws a progress card).
func (m Module) attackEvents(s *engine.State, x *Ext) ([]engine.Event, []engine.PlayerID) {
	cfg := configFrom(s.Config)
	if cfg.SkipFirstBarbarianAttack && x.Attacks == 0 {
		return []engine.Event{engine.NewEvent(EvBarbarianAttack, barbarianAttackData{Skipped: true})}, nil
	}

	strength := 0
	perPlayer := make([]int, len(s.Players))
	for _, k := range x.Knights {
		if k.Active {
			strength += k.Level
			perPlayer[k.Owner] += k.Level
		}
	}
	cities := attackStrength(s)
	cityOwners := make([]int, len(s.Players))
	for _, b := range s.Buildings {
		if b.City {
			cityOwners[b.Owner]++
		}
	}

	var tiedDefenders []engine.PlayerID
	data := barbarianAttackData{Strength: strength, Cities: cities, Win: strength >= cities, Defender: engine.NoPlayer}
	if data.Win {
		best := 0
		for _, n := range perPlayer {
			if n > best {
				best = n
			}
		}
		if best > 0 {
			var top []engine.PlayerID
			for p, n := range perPlayer {
				if n == best {
					top = append(top, engine.PlayerID(p))
				}
			}
			if len(top) == 1 {
				data.Defender = top[0] // sole defender takes the VP
			} else {
				// Each tied defender draws a card of their choice instead, in turn
				// order starting with the current player.
				tset := map[engine.PlayerID]bool{}
				for _, p := range top {
					tset[p] = true
				}
				for _, p := range playersFromCurrent(s) {
					if tset[p] {
						tiedDefenders = append(tiedDefenders, p)
					}
				}
				data.TiedDefenders = tiedDefenders
			}
		}
	} else {
		// The weakest contributors who have a downgradable (non-metropolis) city lose
		// one. Players with only settlements or only metropolises are immune and are
		// left out of the "least defense" comparison, so a metropolis-only player
		// cannot absorb the loss.
		weakest := 1 << 30
		for p := range s.Players {
			if _, ok := m.downgradableCity(s, x, engine.PlayerID(p)); ok && perPlayer[p] < weakest {
				weakest = perPlayer[p]
			}
		}
		for p := range s.Players {
			cities := m.downgradableCities(s, x, engine.PlayerID(p))
			if len(cities) == 0 || perPlayer[p] != weakest {
				continue
			}
			if len(cities) == 1 && !engine.HasPillageBuyout(s) {
				// Exactly one sacrificable city falls now with no prompt, unless the ruleset
				// offers a buyout (Rivers: pay 5 coins to keep the city), in which case the
				// seat is asked. Old logs replay unchanged since the fold reads the attack
				// event's own lists.
				data.Downgraded = append(data.Downgraded, downgrade{Player: engine.PlayerID(p), V: cities[0]})
				continue
			}
			// Otherwise the owner picks which city burns (CmdBarbarianDowngrade). That
			// defers the razing past this roll's production, unlike the immediate path
			// (see Ext.PendingDowngrade).
			data.Pending = append(data.Pending, engine.PlayerID(p))
		}
		sort.Slice(data.Downgraded, func(i, j int) bool { return data.Downgraded[i].Player < data.Downgraded[j].Player })
		slices.Sort(data.Pending)
	}
	return []engine.Event{engine.NewEvent(EvBarbarianAttack, data)}, tiedDefenders
}

// downgradableCity picks the player's first non-metropolis city in board order,
// preferring an unwalled one so walls are kept where possible. Metropolis
// cities are never downgraded; if every city is one, nothing is.
func (Module) downgradableCity(s *engine.State, x *Ext, p engine.PlayerID) (board.Vertex, bool) {
	var walledFallback board.Vertex
	haveWalled := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p && b.City && !isMetropolisVertex(x, p, v) {
				if !x.Walled[v] {
					return v, true
				}
				if !haveWalled {
					walledFallback, haveWalled = v, true
				}
			}
		}
	}
	return walledFallback, haveWalled
}

// downgradableCities lists every non-metropolis city of p in board order: the
// choice set for CmdBarbarianDowngrade. Zero means immune, one means no
// decision, two or more means a pending pick.
func (Module) downgradableCities(s *engine.State, x *Ext, p engine.PlayerID) []board.Vertex {
	var out []board.Vertex
	forEachVertex(s, func(v board.Vertex) {
		if b, ok := s.Buildings[v]; ok && b.Owner == p && b.City && !isMetropolisVertex(x, p, v) {
			out = append(out, v)
		}
	})
	return out
}

// legalExtras enumerates the player's knight placement vertices and the cities
// that may still take a wall. Positional only: costs are enforced by the build
// commands, but the wall list respects the 3-wall cap.
func (m Module) legalExtras(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := extRO(s)
	var ex engine.LegalExtra
	// Offer placement only while a basic knight is free, or when the seat owes a
	// Deserter replacement (which uses a piece at DeserterLevel).
	canBuildKnight := knightCount(x, seat, 1) < knightsPerLevel
	if x.DeserterTaker == seat && x.DeserterLevel > 0 {
		canBuildKnight = true
	}
	seen := make(map[board.Vertex]bool)
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if seen[v] {
				continue
			}
			seen[v] = true
			if canBuildKnight && m.checkKnightSpot(s, v, seat) == nil {
				ex.Knights = append(ex.Knights, v)
			}
			if x.Players[seat].Walls < 3 {
				if wallableCity(s, x, seat, v) {
					ex.Walls = append(ex.Walls, v)
				}
			}
		}
	}
	seenChase := map[board.Vertex]bool{}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if seenChase[v] {
				continue
			}
			seenChase[v] = true
			k, ok := x.Knights[v]
			if !ok || k.Owner != seat || !k.Active || k.FreshlyActivated {
				continue
			}
			for _, barb := range engine.EdgeBlockerTargetsFromModules(s, v) {
				ex.KnightEdgeChases = append(ex.KnightEdgeChases, engine.KnightEdgeChase{V: v, Barb: barb})
			}
		}
	}
	ex.KnightMoves = m.legalKnightMoves(s, x, seat)
	ex.ProgressTargets = m.progressTargetsFor(s, x, seat)
	// Chase-robber: an activated, non-fresh knight next to the robber may push it
	// to any other land hex. Unlike the base robber, the hex need not be robbable
	// (same rule as decideChaseRobber); who may be robbed there is still gated by
	// robberVictims.
	if canChaseRobber(s, x, seat) {
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if engine.RobberMayEnter(s, h) && h != s.Board.Robber {
				ex.ChaseRobberHexes = append(ex.ChaseRobberHexes, h)
			}
		}
	}
	// The same command chases the pirate from a knight on a sea-hex intersection.
	// Its destinations get a separate list so a knight beside the robber does not
	// light up every sea hex.
	if pirate, ok := s.SeaBlocker(); ok && canChaseSeaBlocker(s, x, seat, pirate) {
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if s.Board.IsSea(h) && h != pirate {
				ex.ChasePirateHexes = append(ex.ChasePirateHexes, h)
			}
		}
	}
	// Improvable tracks: own a city, below the cap, and a metropolis-free city when
	// the next level would place or move a metropolis. The metropolis check reuses
	// metropolisClaim so it matches decideImprove. Commodity cost is checked by the
	// command.
	if playerHasCity(s, seat) {
		for t := range trackKinds {
			level := x.Players[seat].Improve[t]
			if level >= maxImprovement {
				continue
			}
			if _, claims := metropolisClaim(x, t, seat, level+1); claims {
				if _, ok := m.firstFreeCity(s, x, seat); !ok {
					continue
				}
			}
			ex.Improvements = append(ex.Improvements, int(t))
		}
	}
	return ex
}

// canChaseRobber reports whether seat has an activated, non-freshly-activated
// knight adjacent to the robber, with the robber in play.
func canChaseRobber(s *engine.State, x *Ext, seat engine.PlayerID) bool {
	return chaserAdjacentTo(s, x, seat, s.Board.Robber)
}

// canChaseSeaBlocker is the same test against a module's sea blocker (the
// Islands pirate), which a knight on a sea-hex intersection may drive away.
func canChaseSeaBlocker(s *engine.State, x *Ext, seat engine.PlayerID, pirate board.Hex) bool {
	return chaserAdjacentTo(s, x, seat, pirate)
}

// chaserAdjacentTo reports whether seat has a knight that could chase a blocker
// on hex h right now. The robber lock applies to both blockers: the pirate also
// stays out of play until the first barbarian landfall.
func chaserAdjacentTo(s *engine.State, x *Ext, seat engine.PlayerID, h board.Hex) bool {
	if robberLocked(s) {
		return false
	}
	for v, k := range x.Knights {
		if k.Owner != seat || !k.Active || k.FreshlyActivated {
			continue
		}
		for _, vh := range v.Hexes() {
			if vh == h {
				return true
			}
		}
	}
	return false
}

// pendingTargets surfaces placements seat owes right now (a Deserter
// replacement, a displaced-knight relocation, the city lost to the barbarians),
// each mirroring its validator. These can be owed off-turn, so they live here
// rather than in legalExtras, which is gated to the active seat.
func (m Module) pendingTargets(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := extRO(s)
	var ex engine.LegalExtra

	if x.DeserterTaker == seat && x.DeserterLevel > 0 && knightCount(x, seat, x.DeserterLevel) < knightsPerLevel {
		forEachVertex(s, func(v board.Vertex) {
			if m.checkKnightSpot(s, v, seat) == nil {
				ex.DeserterPlacements = append(ex.DeserterPlacements, v)
			}
		})
	}

	// A lost barbarian defense: the seat picks which of its own cities is razed.
	if slices.Contains(x.PendingDowngrade, seat) {
		ex.BarbarianDowngrades = m.downgradableCities(s, x, seat)
	}

	// An earned metropolis: the seat picks which metropolis-free city receives it.
	// It blocks every other action, so it sits with the forced placements.
	if pick := x.MetropolisPending; pick != nil && pick.Player == seat {
		ex.MetropolisCities = m.freeCities(s, x, seat)
	}

	if x.RelocPlayer == seat {
		forEachVertex(s, func(v board.Vertex) {
			if v.Side > board.S || !s.Board.LandVertex(v) {
				return
			}
			if _, built := s.Buildings[v]; built {
				return
			}
			if _, knight := x.Knights[v]; knight {
				return
			}
			// Rule D: the offered relocations are exactly what decideRelocateKnight
			// accepts, fog included.
			if s.UnrevealedVertex(v) {
				return
			}
			if knightReachable(s, x, x.RelocFrom, v, seat) {
				ex.KnightRelocations = append(ex.KnightRelocations, v)
			}
		})
	}
	return ex
}

// progressTargetsFor computes, for each board-targeting progress card the seat
// holds, the positions that card may target, mirroring its validator in
// cardEffects.
func (m Module) progressTargetsFor(s *engine.State, x *Ext, seat engine.PlayerID) map[string]engine.ProgressTarget {
	hand := x.Players[seat].Progress
	out := map[string]engine.ProgressTarget{}

	// Merchant: a resource-producing hex with a building of the player's on it
	// (see merchantHex for why barren terrain is excluded).
	if holdsCard(hand, CardMerchant) {
		var hexes []board.Hex
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if !merchantHex(s.Board, h) {
				continue
			}
			for _, v := range h.Vertices() {
				if b, ok := s.Buildings[v]; ok && b.Owner == seat {
					hexes = append(hexes, h)
					break
				}
			}
		}
		if len(hexes) > 0 {
			out[string(CardMerchant)] = engine.ProgressTarget{Hexes: hexes}
		}
	}

	// Bishop: any land hex other than the robber's, while the robber is in play.
	// Under cak+explorers rule H the Bishop moves the pirate instead, with its own
	// picker, so no hexes are published. The card is still playable; an empty
	// list here does not mean unplayable.
	if holdsCard(hand, CardBishop) && !robberLocked(s) && !noRobber(s) {
		var hexes []board.Hex
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if engine.RobberMayEnter(s, h) && h != s.Board.Robber {
				hexes = append(hexes, h)
			}
		}
		if len(hexes) > 0 {
			out[string(CardBishop)] = engine.ProgressTarget{Hexes: hexes}
		}
	}

	// Inventor: any numbered hex except the fixed 2/6/8/12 (both A and B come from
	// this same set).
	if holdsCard(hand, CardInventor) {
		var hexes []board.Hex
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			t, ok := s.Board.Tiles[h]
			if ok && t.Number != 0 && t.Number != 2 && t.Number != 6 && t.Number != 8 && t.Number != 12 {
				hexes = append(hexes, h)
			}
		}
		if len(hexes) > 0 {
			out[string(CardInventor)] = engine.ProgressTarget{Hexes: hexes}
		}
	}

	// Medicine: one of the player's settlements to upgrade, honouring the
	// laid-city pin, the city supply and the discounted cost. Under cak+explorers
	// rule H there is a second branch at a different price, so the offer is the
	// union of both; the client picks vertex then branch.
	if holdsCard(hand, CardMedicine) {
		canCity := s.Players[seat].CitiesLeft > 0 && s.Players[seat].Hand.Has(costMedicineCity)
		canHarbour := engine.HasFreeHarbour(s) && s.Players[seat].Hand.Has(costMedicineHarbour)
		pin, hasPin := m.mustUpgradeFirst(s, seat)
		var verts []board.Vertex
		forEachVertex(s, func(v board.Vertex) {
			b, ok := s.Buildings[v]
			if !ok || b.Owner != seat || b.City {
				return
			}
			if hasPin && pin != v {
				return
			}
			// Each branch is closed at a vertex a module bars (a harbour settlement, rule
			// A). Offer the vertex if either is open.
			if canCity && s.BlocksCityUpgrade(v, seat) == nil {
				verts = append(verts, v)
				return
			}
			if canHarbour {
				if _, _, err := engine.FreeHarbourFromModules(s, seat, v); err == nil {
					verts = append(verts, v)
				}
			}
		})
		if len(verts) > 0 {
			out[string(CardMedicine)] = engine.ProgressTarget{Vertices: verts}
		}
	}

	// Intrigue: an enemy knight connected to at least one of the player's roads or
	// shipping routes (combination rule: what applies to roads applies to ships).
	if holdsCard(hand, CardIntrigue) {
		var verts []board.Vertex
		forEachVertex(s, func(v board.Vertex) {
			k, ok := x.Knights[v]
			if !ok || k.Owner == seat {
				return
			}
			if touchesOwnRoute(s, v, seat) {
				verts = append(verts, v)
			}
		})
		if len(verts) > 0 {
			out[string(CardIntrigue)] = engine.ProgressTarget{Vertices: verts}
		}
	}

	// Diplomat: any open-ended road (source); for the player's own open roads,
	// the legal relocation destinations (connected to their network as if the
	// source road were freed).
	if holdsCard(hand, CardDiplomat) {
		var sources []board.Edge
		var moves []engine.ShipMoveTargets
		forEachEdge(s, func(e board.Edge) {
			owner, ok := s.Roads[e]
			if !ok || !openRoad(s, e, owner) {
				return
			}
			// A removal the seat cannot pay for (a Rivers river edge with no coin) is
			// refused by the play, so it is not offered.
			removable := s.RouteMoveRefusal(seat, e, board.Edge{}, engine.RouteRoad) == nil
			if owner != seat {
				if removable {
					sources = append(sources, e)
				}
				return
			}
			var dests []board.Edge
			forEachEdge(s, func(to board.Edge) {
				if _, taken := s.Roads[to]; taken {
					return
				}
				if !to.Valid() || !s.Board.LandEdge(to) {
					return
				}
				// Same closed-edge rule the play validates, so the client never offers an
				// edge no road may occupy.
				if s.EdgeRefusal(to, engine.RouteRoad) != nil {
					return
				}
				if s.RouteMoveRefusal(seat, e, to, engine.RouteRoad) != nil {
					return
				}
				if s.RoadConnectsExcluding(to, seat, e) {
					dests = append(dests, to)
				}
			})
			if !removable && len(dests) == 0 {
				return
			}
			sources = append(sources, e)
			moves = append(moves, engine.ShipMoveTargets{From: e, To: dests})
		})
		if len(sources) > 0 {
			out[string(CardDiplomat)] = engine.ProgressTarget{Edges: sources, Moves: moves}
		}
	}

	if len(out) == 0 {
		return nil
	}
	return out
}

// forEachEdge visits each unique board edge once (canonicalized).
func forEachEdge(s *engine.State, fn func(board.Edge)) {
	seen := make(map[board.Edge]bool)
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			ne := board.NewEdge(e.A, e.B)
			if !seen[ne] {
				seen[ne] = true
				fn(ne)
			}
		}
	}
}

// forEachVertex visits each unique board vertex once, in deterministic order.
func forEachVertex(s *engine.State, fn func(board.Vertex)) {
	seen := make(map[board.Vertex]bool)
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !seen[v] {
				seen[v] = true
				fn(v)
			}
		}
	}
}

// legalKnightMoves enumerates, for each of seat's active (not freshly
// activated) knights, the vertices it may move to: empty eligible vertices and
// strictly weaker enemy knights. It reuses checkKnightSpot/knightReachable, so
// the result is a subset of what decideMoveKnight accepts.
func (m Module) legalKnightMoves(s *engine.State, x *Ext, seat engine.PlayerID) []engine.KnightMoveTargets {
	// Collect movable sources in deterministic board order.
	var froms []board.Vertex
	for v, k := range x.Knights {
		if k.Owner == seat && k.Active && !k.FreshlyActivated {
			froms = append(froms, v)
		}
	}
	sort.Slice(froms, func(i, j int) bool { return vertexLess(froms[i], froms[j]) })

	var out []engine.KnightMoveTargets
	for _, from := range froms {
		k := x.Knights[from]
		var to, displace []board.Vertex
		seen := make(map[board.Vertex]bool)
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			for _, v := range h.Vertices() {
				if seen[v] || v == from {
					continue
				}
				seen[v] = true
				// A knight can only reach v along one of seat's own route pieces touching it,
				// so skip the BFS otherwise.
				if !touchesOwnRoute(s, v, seat) {
					continue
				}
				if target, occupied := x.Knights[v]; occupied {
					// Displacement: strictly-weaker enemy knight on an eligible
					// empty vertex, reachable along seat's own routes.
					if target.Owner == seat || target.Level >= k.Level {
						continue
					}
					if v.Side > board.S || !onBoardVertex(s, v) {
						continue
					}
					if _, built := s.Buildings[v]; built {
						continue
					}
					if !knightReachable(s, x, from, v, seat) {
						continue
					}
					to = append(to, v)
					displace = append(displace, v)
					continue
				}
				// A move destination, not a placement: it may be a sea intersection.
				if m.checkKnightMoveSpot(s, v) != nil {
					continue
				}
				if !knightReachable(s, x, from, v, seat) {
					continue
				}
				to = append(to, v)
			}
		}
		sort.Slice(to, func(i, j int) bool { return vertexLess(to[i], to[j]) })
		sort.Slice(displace, func(i, j int) bool { return vertexLess(displace[i], displace[j]) })
		if len(to) > 0 {
			out = append(out, engine.KnightMoveTargets{From: from, To: to, Displace: displace})
		}
	}
	return out
}

// firstUnwalledCity returns the player's first city (board order) without a
// wall, used to bind a freshly built wall to a concrete city.
func firstUnwalledCity(s *engine.State, x *Ext, p engine.PlayerID) (board.Vertex, bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p && b.City && !x.Walled[v] {
				return v, true
			}
		}
	}
	return board.Vertex{}, false
}

// isUnwalledCity reports whether vertex v holds a city owned by p without a
// wall. Used to validate a chosen wall target.
func isUnwalledCity(s *engine.State, x *Ext, p engine.PlayerID, v board.Vertex) bool {
	b, ok := s.Buildings[v]
	return ok && b.Owner == p && b.City && !x.Walled[v]
}

// wallableCity is isUnwalledCity plus the ground rule: a module that refuses
// every build at the vertex (a Raiders conquered hex,
// engine.Hooks.BlocksNewConstruction) refuses the wall too. Deciders and
// targets use this; the fold keeps isUnwalledCity so old events are judged by
// the rule they were written under.
func wallableCity(s *engine.State, x *Ext, p engine.PlayerID, v board.Vertex) bool {
	return isUnwalledCity(s, x, p, v) && !s.NewConstructionBlocked(v)
}

// firstWallableCity is firstUnwalledCity restricted to wallableCity.
func firstWallableCity(s *engine.State, x *Ext, p engine.PlayerID) (board.Vertex, bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if wallableCity(s, x, p, v) {
				return v, true
			}
		}
	}
	return board.Vertex{}, false
}

// isMetropolisVertex reports whether vertex v is one of player p's metropolis
// cities (across all tracks).
func isMetropolisVertex(x *Ext, p engine.PlayerID, v board.Vertex) bool {
	for t := range trackKinds {
		if x.Players[p].Metropolis[t] && x.Players[p].MetropolisAt[t] == v {
			return true
		}
	}
	return false
}

// onEvents converts city production into commodities and clears per-turn
// progress state.
func (m Module) onEvents(after *engine.State, events []engine.Event) []engine.Event {
	var out []engine.Event

	out = append(out, laidCityRestores(after, events)...)

	var rolled *engine.DiceRolledData
	var gains []engine.PlayerGain
	for _, e := range events {
		switch e.Type {
		case engine.EvTurnStarted:
			// Knights activated last turn are no longer "freshly activated"
			// and may act again.
			out = append(out, engine.NewEvent(evKnightsRefresh, struct{}{}))
		case engine.EvDiceRolled:
			d := engine.DecodeEvent[engine.DiceRolledData](e)
			rolled = &d
		case engine.EvResDistributed:
			d := engine.DecodeEvent[engine.ResDistributedData](e)
			gains = d.Gains
		default:
		}
	}
	if rolled == nil || rolled.D1+rolled.D2 == 7 {
		return out
	}

	// Cities on commodity terrain are owed one commodity each on top of the single
	// resource the core paid (cityResourceYield). The claim comes from the board,
	// not from what the core granted, because a resource the bank could not pay
	// does not cost the city its commodity. The hexes and buildings counted are
	// the ones distribute() pays from.
	roll := rolled.D1 + rolled.D2
	granted := map[engine.PlayerID]engine.Hand{}
	for _, g := range gains {
		granted[g.Player] = g.Gain
	}
	type adj struct {
		player engine.PlayerID
		res    board.Resource
		com    Commodity
		count  int
	}
	adjMap := map[engine.PlayerID]map[board.Resource]*adj{}
	for h, t := range after.Board.Tiles {
		com, ok := commodityFor(t.Res)
		if !ok || t.Number != roll || h == after.Board.Robber || engine.HexIsInert(after, h) {
			continue
		}
		for _, v := range h.Vertices() {
			b, okB := after.Buildings[v]
			if !okB || !b.City || engine.BuildingIsInert(after, v) {
				continue
			}
			if adjMap[b.Owner] == nil {
				adjMap[b.Owner] = map[board.Resource]*adj{}
			}
			cur := adjMap[b.Owner][t.Res]
			if cur == nil {
				cur = &adj{player: b.Owner, res: t.Res, com: com}
				adjMap[b.Owner][t.Res] = cur
			}
			cur.count++
		}
	}
	var adjs []*adj
	for _, byRes := range adjMap {
		for _, a := range byRes {
			adjs = append(adjs, a)
		}
	}
	sort.Slice(adjs, func(i, j int) bool {
		if adjs[i].player != adjs[j].player {
			return adjs[i].player < adjs[j].player
		}
		return adjs[i].res < adjs[j].res
	})

	// Commodity stacks are finite, so the bank shortage rule applies: if a stack
	// cannot cover everyone claiming it and there is more than one claimant,
	// nobody gets it; a lone claimant takes what is left. Mirrors distribute().
	// The withheld part is recorded as Short rather than dropping the event,
	// because the resource still has to be handed back.
	supply := extRO(after).CommoditySupply
	shortOf := map[Commodity]int{}
	{
		type stack struct{ total, claimers int }
		claims := map[Commodity]*stack{}
		for _, a := range adjs {
			c := claims[a.com]
			if c == nil {
				c = &stack{}
				claims[a.com] = c
			}
			c.total += a.count
			c.claimers++ // adjs holds at most one entry per (player, terrain)
		}
		for com, c := range claims {
			avail := max(supply[com],
				// a pre-supply log can leave the stack overdrawn
				0)
			switch {
			case c.total <= avail:
				// The stack covers everyone; nothing is withheld.
			case c.claimers > 1:
				shortOf[com] = c.total // contested shortage: nobody produces
			default:
				shortOf[com] = c.total - avail // lone claimant takes the remainder
			}
		}
	}

	gotCommodity := map[engine.PlayerID]bool{}
	for _, a := range adjs {
		short := a.count
		if rem := shortOf[a.com]; rem < short {
			short = rem
		}
		shortOf[a.com] -= short
		if a.count > short {
			gotCommodity[a.player] = true
		}
		out = append(out, engine.NewEvent(EvCommodityAdjust,
			commodityAdjustData{Player: a.player, Res: a.res, Commodity: a.com, Count: a.count, Short: short, Minted: true}))
	}

	// Aqueduct (Science L3): a player who receives no production takes 1 resource
	// of their choice. Production includes core resources, the commodities above,
	// and Islands gold-field picks (owed by an Islands event). A robber-blocked
	// number or an empty stack produces nothing.
	gold := goldOwedOnRoll(events)
	x := extRO(after)
	var owed []engine.PlayerID
	for p := range after.Players {
		seat := engine.PlayerID(p)
		if x.Players[p].Improve[Science] >= 3 && granted[seat].Count() == 0 && !gotCommodity[seat] && gold[seat] == 0 {
			owed = append(owed, seat)
		}
	}
	if len(owed) > 0 {
		out = append(out, engine.NewEvent(EvAqueductOwed, aqueductOwedData{Players: owed}))
	}
	return out
}

// cityResourceYield is Hooks.CityResourceYield: a city collects one card of a
// commodity terrain's resource (the commodity comes separately via onEvents)
// and two of anything else.
func cityResourceYield(_ *engine.State, res board.Resource) (int, bool) {
	if _, ok := commodityFor(res); ok {
		return 1, true
	}
	return 0, false
}

// islandsGoldOwed is the Islands gold-field event type, as a literal since
// modules do not import each other (pinned by TestIslandsGoldEventNameMatches).
// Its payload is the owed picks.
const islandsGoldOwed engine.EventType = "gold_owed"

// goldOwedOnRoll totals the Islands gold-field picks this roll owes each seat.
func goldOwedOnRoll(events []engine.Event) map[engine.PlayerID]int {
	out := map[engine.PlayerID]int{}
	for _, e := range events {
		if e.Type != islandsGoldOwed {
			continue
		}
		d := engine.DecodeEvent[struct {
			Owed []engine.PlayerDiscard `json:"owed"`
		}](e)
		for _, o := range d.Owed {
			out[o.Player] += o.Count
		}
	}
	return out
}

// hardPending reports forced interactions that must resolve before any other
// action (Wedding/Harbor gives, Aqueduct picks). Unlike an over-limit progress
// hand, these block even the active player's own progress-card play.
func (Module) hardPending(s *engine.State) bool {
	x := extRO(s)
	return len(x.PendingGive) > 0 || len(x.HarborGive) > 0 || len(x.Aqueduct) > 0 ||
		x.SpyThief != engine.NoPlayer || x.MMThief != engine.NoPlayer ||
		x.DeserterVictim != engine.NoPlayer || x.DeserterLevel > 0 ||
		x.RelocPlayer != engine.NoPlayer || len(x.DefenderDraws) > 0 ||
		len(x.PendingDowngrade) > 0 || x.MetropolisPending != nil
}

// pendingDeciders lists every seat awaiting a module action, mirroring the
// seats blocks/auto would drive: wedding gives, harbor returns, aqueduct picks,
// the barbarian city sacrifice, the active spy, and any player over the
// progress-hand limit. Each entry carries an id that the timer layer maps to a
// budget (timings.ModuleCaps); a seat owing several keeps the longest.
func (Module) pendingDeciders(s *engine.State) []engine.ModuleDecider {
	x := extRO(s)
	var out []engine.ModuleDecider
	owe := func(p engine.PlayerID, decision string) {
		out = append(out, engine.ModuleDecider{Seat: p, Decision: decision})
	}
	for p := range x.PendingGive {
		owe(p, DecisionWeddingGive)
	}
	for p := range x.HarborGive {
		owe(p, DecisionHarborReturn)
	}
	for _, p := range x.Aqueduct {
		owe(p, DecisionAqueduct)
	}
	for _, p := range x.PendingDowngrade {
		owe(p, DecisionBarbarianDowngrade)
	}
	if x.MetropolisPending != nil {
		owe(x.MetropolisPending.Player, DecisionMetropolisPick)
	}
	if x.SpyThief != engine.NoPlayer && x.SpyVictim != engine.NoPlayer {
		owe(x.SpyThief, DecisionSpy)
	}
	if x.MMThief != engine.NoPlayer && x.MMVictim != engine.NoPlayer {
		owe(x.MMThief, DecisionMasterMerchant)
	}
	if x.DeserterVictim != engine.NoPlayer {
		owe(x.DeserterVictim, DecisionDeserterSurrender)
	}
	if x.DeserterLevel > 0 && x.DeserterTaker != engine.NoPlayer {
		owe(x.DeserterTaker, DecisionDeserterPlace)
	}
	if x.RelocPlayer != engine.NoPlayer {
		owe(x.RelocPlayer, DecisionRelocateKnight)
	}
	if len(x.DefenderDraws) > 0 {
		owe(x.DefenderDraws[0], DecisionDefenderDraw) // strictly in order: the front draws next
	}
	for p := range x.Players {
		if len(x.Players[p].Progress) > progressHandSize {
			owe(engine.PlayerID(p), DecisionProgressDiscard)
		}
	}
	return out
}

func (m Module) blocks(s *engine.State) bool {
	if m.hardPending(s) {
		return true
	}
	x := extRO(s)
	for p := range x.Players {
		if len(x.Players[p].Progress) > progressHandSize {
			return true
		}
	}
	return false
}

// owesSingle reports whether a single-owner pending (held by exactly one seat)
// should be resolved for target: true when owner is a real seat and target is
// either that owner or NoPlayer (the "any owed seat" default).
func owesSingle(owner, target engine.PlayerID) bool {
	return owner != engine.NoPlayer && (target == engine.NoPlayer || target == owner)
}

// pickOwedHead is pickOwedSlice for an ordered pending: only the front seat can
// be served, so a target behind it owes nothing yet.
func pickOwedHead(owed []engine.PlayerID, target engine.PlayerID) (engine.PlayerID, bool) {
	if len(owed) == 0 {
		return engine.NoPlayer, false
	}
	if target == engine.NoPlayer || target == owed[0] {
		return owed[0], true
	}
	return engine.NoPlayer, false
}

// pickOwedSlice chooses which seat of a simultaneous pending to act for: target
// when it is a seat that owes it, or the first owed seat when target is
// NoPlayer. ok is false when target owes nothing here, so resolution moves on
// to the seat's next obligation.
func pickOwedSlice(owed []engine.PlayerID, target engine.PlayerID) (engine.PlayerID, bool) {
	if len(owed) == 0 {
		return engine.NoPlayer, false
	}
	if target == engine.NoPlayer {
		return owed[0], true
	}
	if slices.Contains(owed, target) {
		return target, true
	}
	return engine.NoPlayer, false
}

// auto resolves a module obligation. A real target resolves only that seat's
// obligation, so a bot can act on its own simultaneous pick without waiting on
// a lower seat; NoPlayer resolves the lowest owed seat (the timer default).
// Blocks are tried in priority order.
func (m Module) auto(s *engine.State, target engine.PlayerID) (engine.Command, bool) {
	x := extRO(s)
	if pick := x.MetropolisPending; pick != nil && owesSingle(pick.Player, target) {
		// Timeout default: the first metropolis-free city in board order. If none is
		// left the zero vertex is rejected by decideMetropolisPick, which abandons the
		// claim.
		v, _ := m.firstFreeCity(s, x, pick.Player)
		raw, _ := json.Marshal(map[string]any{"v": v})
		return engine.Command{Player: pick.Player, Type: CmdMetropolisPick, Data: raw}, true
	}
	if p, ok := pickOwedSlice(x.PendingDowngrade, target); ok {
		// Timeout default: the city downgradableCity names. A player with nothing left
		// sends the zero vertex, which decideBarbarianDowngrade treats as a forfeit.
		v, _ := m.downgradableCity(s, x, p)
		raw, _ := json.Marshal(map[string]any{"v": v})
		return engine.Command{Player: p, Type: CmdBarbarianDowngrade, Data: raw}, true
	}
	for _, p := range sortedPlayers(x.PendingGive) {
		if target != engine.NoPlayer && p != target {
			continue
		}
		owed := x.PendingGive[p]
		give := owed
		if have := s.Players[p].Hand.Count() + x.Players[p].Commodities.Count(); have < give {
			give = have
		}
		// Pay resources first, then spill into commodities (the combined hand).
		cards := spreadResources(s.Players[p].Hand, give)
		coms := spreadCommodities(x.Players[p].Commodities, give-cards.Count())
		raw, _ := json.Marshal(map[string]any{"cards": cards, "coms": coms})
		return engine.Command{Player: p, Type: CmdGiveCards, Data: raw}, true
	}
	for _, p := range sortedHarbor(x.HarborGive) {
		if target != engine.NoPlayer && p != target {
			continue
		}
		// Return the lowest-index commodity the player holds.
		if c, ok := lowestCommodity(x.Players[p].Commodities); ok {
			raw, _ := json.Marshal(map[string]any{"com": c})
			return engine.Command{Player: p, Type: CmdHarborGive, Data: raw}, true
		}
	}
	if owesSingle(x.SpyThief, target) && x.SpyVictim != engine.NoPlayer {
		// Auto-pick the victim's first progress card (deterministic).
		if hand := x.Players[x.SpyVictim].Progress; len(hand) > 0 {
			raw, _ := json.Marshal(map[string]any{"card": hand[0]})
			return engine.Command{Player: x.SpyThief, Type: CmdSpyPick, Data: raw}, true
		}
	}
	if owesSingle(x.MMThief, target) && x.MMVictim != engine.NoPlayer {
		// Auto-take up to 2 cards from the victim's combined hand: lowest-index
		// resources first, then commodities (deterministic).
		cards, coms := mmAutoTake(s.Players[x.MMVictim].Hand, x.Players[x.MMVictim].Commodities, 2)
		raw, _ := json.Marshal(map[string]any{"cards": cards, "coms": coms})
		return engine.Command{Player: x.MMThief, Type: CmdMasterMerchantPick, Data: raw}, true
	}
	if owesSingle(x.DeserterVictim, target) {
		// Surrender the victim's strongest knight (highest level, then board order).
		var spot *board.Vertex
		lvl := 0
		for v, k := range x.Knights {
			if k.Owner != x.DeserterVictim {
				continue
			}
			vv := v
			if spot == nil || k.Level > lvl || (k.Level == lvl && vertexLess(vv, *spot)) {
				spot, lvl = &vv, k.Level
			}
		}
		if spot != nil {
			raw, _ := json.Marshal(map[string]any{"v": *spot})
			return engine.Command{Player: x.DeserterVictim, Type: CmdDeserterSurrender, Data: raw}, true
		}
	}
	if x.DeserterLevel > 0 && owesSingle(x.DeserterTaker, target) {
		// Place the replacement at the first legal spot in board order. One exists:
		// placement was armed only if it did, and nothing else can act meanwhile.
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			for _, v := range h.Vertices() {
				if (Module{}).checkKnightSpot(s, v, x.DeserterTaker) == nil {
					raw, _ := json.Marshal(map[string]any{"v": v})
					return engine.Command{Player: x.DeserterTaker, Type: CmdDeserterPlace, Data: raw}, true
				}
			}
		}
	}
	if p, ok := pickOwedSlice(x.Aqueduct, target); ok {
		// Take the bank's most-abundant resource (ResNone clears the debt when the
		// bank is empty).
		res := board.ResNone
		best := 0
		for r := board.Wood; r <= board.Ore; r++ {
			if s.Bank[r] > best {
				best, res = s.Bank[r], r
			}
		}
		raw, _ := json.Marshal(map[string]any{"res": res})
		return engine.Command{Player: p, Type: CmdAqueductPick, Data: raw}, true
	}
	if owesSingle(x.RelocPlayer, target) {
		// Relocate the displaced knight to the first reachable empty spot (a spot
		// is guaranteed: the pending was only armed when one existed).
		if to, ok := (Module{}).firstReachableSpot(s, x, x.RelocPlayer, x.RelocFrom); ok {
			raw, _ := json.Marshal(map[string]any{"to": to})
			return engine.Command{Player: x.RelocPlayer, Type: CmdRelocateKnight, Data: raw}, true
		}
	}
	// Head only: defender draws are a queue (decideDefenderDraw accepts only
	// DefenderDraws[0]), so serving a later seat would build an illegal command.
	if p, ok := pickOwedHead(x.DefenderDraws, target); ok {
		// Auto-pick the most-improved discipline (then first non-empty deck) for the
		// front tied defender.
		track, okTrack := bestTrack(x, p)
		if !okTrack || deckTotal(x, track) == 0 {
			for t := range trackKinds {
				if deckTotal(x, t) > 0 {
					track = t
					break
				}
			}
		}
		raw, _ := json.Marshal(map[string]any{"track": track})
		return engine.Command{Player: p, Type: CmdDefenderDraw, Data: raw}, true
	}
	for p := range x.Players {
		if target != engine.NoPlayer && engine.PlayerID(p) != target {
			continue
		}
		if len(x.Players[p].Progress) > progressHandSize {
			raw, _ := json.Marshal(map[string]any{"card": x.Players[p].Progress[0]})
			return engine.Command{Player: engine.PlayerID(p), Type: CmdDiscardProgress, Data: raw}, true
		}
	}
	return engine.Command{}, false
}

func sortedHarbor(m map[engine.PlayerID]board.Resource) []engine.PlayerID {
	out := make([]engine.PlayerID, 0, len(m))
	for p := range m {
		out = append(out, p)
	}
	slices.Sort(out)
	return out
}

func (Module) victory(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	px := x.Players[p]
	vp := px.DefenderVP + px.MerchantVP + px.ExtraVP
	for t := range trackKinds {
		if px.Metropolis[t] {
			vp += metropolisVP
		}
	}
	return vp
}

// discardLimitDelta: each city wall lets the player keep 2 more cards on a 7.
func (Module) discardLimitDelta(s *engine.State, p engine.PlayerID) int {
	return 2 * extRO(s).Players[p].Walls
}

// blocksVertex: an enemy knight bars roads through its vertex.
func (Module) blocksVertex(s *engine.State, v board.Vertex, p engine.PlayerID) bool {
	k, ok := extRO(s).Knights[v]
	return ok && k.Owner != p
}

// anchorsRoute: p's own knight at v closes a route end there, as p's own
// settlement or city does, for roads and (under Islands) ships. So a ship with
// a knight at its end is not open and cannot be moved out from under the
// knight, which must stay connected to a route. Enemy knights block
// (blocksVertex) rather than anchor. Anchoring is not joining: a knight does
// not link road and ship networks (see knightReachable).
func (Module) anchorsRoute(s *engine.State, v board.Vertex, p engine.PlayerID) bool {
	k, ok := extRO(s).Knights[v]
	return ok && k.Owner == p
}
