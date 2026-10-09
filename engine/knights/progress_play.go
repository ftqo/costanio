package knights

import (
	"encoding/json"
	"errors"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

var (
	ErrAlchemistDice = errors.New("cak: alchemist dice must each be 1-6")
	ErrNotBeforeRoll = errors.New("cak: that card plays before the roll")

	ErrMerchantTerrain = errors.New("cak: the merchant needs a hex that produces a resource")
	ErrNoOpenRoad      = errors.New("cak: that road is not an open end")

	// ErrCardNoEffect refuses a progress card that public information already shows
	// would do nothing, so the card is not wasted. See docs/rules/knights.md, "Two
	// things you may not do with a card".
	ErrCardNoEffect = errors.New("cak: that card would do nothing right now")
)

// playArgs is the union of per-card arguments.
type playArgs struct {
	Card ProgressCard `json:"card"`

	Hex    *board.Hex       `json:"hex,omitempty"`    // merchant, bishop
	Victim *engine.PlayerID `json:"victim,omitempty"` // master merchant, spy, deserter
	Res    board.Resource   `json:"res,omitempty"`    // resource monopoly, irrigation/mining implicit
	Com    *Commodity       `json:"com,omitempty"`    // trade monopoly
	Cards  *engine.Hand     `json:"cards,omitempty"`  // master merchant / wedding: chosen resources
	Coms   *CommodityHand   `json:"coms,omitempty"`   // master merchant / wedding: chosen commodities
	Gives  []harborGive     `json:"gives,omitempty"`  // commercial harbor: per-opponent commodity
	D1     int              `json:"d1,omitempty"`     // alchemist
	D2     int              `json:"d2,omitempty"`
	Track  *Track           `json:"track,omitempty"` // crane
	V      *board.Vertex    `json:"v,omitempty"`     // engineer-adjacent? medicine city, deserter placement
	A      *board.Hex       `json:"a,omitempty"`     // inventor
	B      *board.Hex       `json:"b,omitempty"`
	E      *board.Edge      `json:"e,omitempty"`  // diplomat target
	To     *board.Edge      `json:"to,omitempty"` // diplomat relocation
	// Knights names which of the player's knights the Smith raises, at most two.
	// Omitted or empty means the first two eligible in board order, which is how
	// older logs replay and what a client without a picker sends.
	Knights []board.Vertex `json:"knights,omitempty"` // smith
	// Harbour asks Medicine for the other upgrade under cak+explorers rule H:
	// 1 ore + 1 grain for a harbour settlement instead of 2 ore + 1 grain for a
	// city. Absent means the city.
	Harbour bool `json:"harbour,omitempty"` // medicine, cak+explorers only
}

// decidePlayProgress validates and resolves a progress card. Cards play on
// the holder's own turn; Alchemist must come before the roll, the rest after.
func (m Module) decidePlayProgress(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if s.Phase != engine.PhasePlay {
		return nil, engine.ErrWrongPhase
	}
	if cmd.Player != s.Cur {
		return nil, engine.ErrNotYourTurn
	}
	if len(s.PendingDiscards) > 0 {
		return nil, engine.ErrDiscardPending
	}
	if s.RobberPending {
		return nil, engine.ErrRobberPending
	}
	// A forced give/pick (Harbor/Wedding/Aqueduct) must resolve before any card is
	// played. An over-limit progress hand does not block play: a player may play
	// down to the 4-card limit instead of discarding.
	if m.hardPending(s) {
		return nil, engine.ErrModulePending
	}
	// Another module's pending interaction blocks too (e.g. the Explorers pirate
	// activation the Bishop arms under cak+explorers). Otherwise a Spy and then a
	// Wedding could be played meanwhile, and the pirate could steal the card a
	// giver owes. Same strict Blocks check requireUninterruptedTurn uses.
	for _, mod := range s.Modules() {
		if mod.Name() == Name {
			continue
		}
		if h := mod.Hooks().Blocks; h != nil && h(s) {
			return nil, engine.ErrModulePending
		}
	}
	d, err := engine.DecodeCommand[playArgs](cmd.Data)
	if err != nil {
		return nil, err
	}
	x := extRO(s)
	if !holdsCard(x.Players[cmd.Player].Progress, d.Card) {
		return nil, ErrNoProgressCard
	}
	if d.Card == CardAlchemist {
		if s.Rolled {
			return nil, ErrNotBeforeRoll
		}
	} else if !s.Rolled {
		return nil, engine.ErrMustRoll
	}

	played := engine.NewEvent(EvProgressPlayed, progressCardData{Player: cmd.Player, Card: d.Card, Track: trackOf(d.Card), Under: true})
	effects, err := m.cardEffects(s, x, cmd.Player, d)
	if err != nil {
		return nil, err
	}
	return append([]engine.Event{played}, effects...), nil
}

// merchantHex reports whether a hex may take the merchant: it must represent
// one of the five bankable resources, since the merchant's 2:1 applies to that
// resource. The rules only bar the gold field by name; the general form is our
// divergence (docs/rules/knights.md). A predicate rather than a terrain list
// so a desert turned into a lake (Fishermen, Caravans) stays excluded. Shared
// with progressTargetsFor.
func merchantHex(b *board.Board, h board.Hex) bool {
	t, ok := b.Tiles[h]
	return ok && t.Res.Producing()
}

func (m Module) cardEffects(s *engine.State, x *Ext, p engine.PlayerID, d playArgs) ([]engine.Event, error) {
	switch d.Card {
	case CardMerchant:
		if d.Hex == nil || !s.Board.Land(*d.Hex) {
			return nil, engine.ErrBadPlacement
		}
		if !merchantHex(s.Board, *d.Hex) {
			return nil, ErrMerchantTerrain
		}
		owns := false
		for _, v := range d.Hex.Vertices() {
			if b, ok := s.Buildings[v]; ok && b.Owner == p {
				owns = true
			}
		}
		if !owns {
			return nil, engine.ErrBadPlacement
		}
		return []engine.Event{engine.NewEvent(EvMerchantPlaced, merchantData{Player: p, Hex: *d.Hex})}, nil

	case CardMasterMerchant:
		// Look at the hand of a player who out-scores you, then take 2 of their cards.
		// Like Spy this is look-then-pick: the victim's combined hand reaches only the
		// thief via the view layer (RevealHands for resources, ExtView for
		// commodities) and the thief picks with CmdMasterMerchantPick. Validating a
		// blind pick here would leak the hand through accept/reject.
		if d.Victim == nil || *d.Victim == p || int(*d.Victim) >= len(s.Players) {
			return nil, engine.ErrBadVictim
		}
		if s.PublicVPWithModules(*d.Victim) <= s.PublicVPWithModules(p) {
			return nil, engine.ErrBadVictim
		}
		// Hand counts are public, so an empty hand is refused rather than wasting the
		// card.
		if s.Players[*d.Victim].Hand.Count()+x.Players[*d.Victim].Commodities.Count() == 0 {
			return nil, ErrCardNoEffect
		}
		return []engine.Event{engine.NewEvent(EvMasterMerchantLook, spyLookData{Thief: p, Victim: *d.Victim})}, nil

	case CardMerchantFleet:
		// 2:1 on a named resource OR commodity for the rest of the turn.
		if d.Com != nil {
			if *d.Com < 0 || *d.Com >= commodityKinds {
				return nil, engine.ErrBadCommand
			}
			return []engine.Event{engine.NewEvent(EvMerchantFleet, merchantFleetData{Player: p, Com: *d.Com, IsCom: true})}, nil
		}
		if !validRes(d.Res) {
			return nil, engine.ErrBadCommand
		}
		return []engine.Event{engine.NewEvent(EvMerchantFleet, merchantFleetData{Player: p, Res: d.Res})}, nil

	case CardResourceMonopoly:
		if !validRes(d.Res) {
			return nil, engine.ErrBadCommand
		}
		// Refused only when no opponent holds any resource (public). Holding none of
		// the named resource is hidden, so that play goes through and takes nothing.
		if !opponentsHold(s, p, func(q engine.PlayerID) int { return s.Players[q].Hand.Count() }) {
			return nil, ErrCardNoEffect
		}
		var takes []engine.MonopolyTake
		for q := range s.Players {
			if engine.PlayerID(q) == p {
				continue
			}
			n := min(s.Players[q].Hand[d.Res], 2)
			if n > 0 {
				takes = append(takes, engine.MonopolyTake{Player: engine.PlayerID(q), Count: n})
			}
		}
		return []engine.Event{engine.NewEvent(EvResourceLevy, resourceLevyData{Player: p, Res: d.Res, Takes: takes})}, nil

	case CardTradeMonopoly:
		if d.Com == nil || *d.Com < 0 || *d.Com >= commodityKinds {
			return nil, engine.ErrBadCommand
		}
		// Same public-count test as Resource Monopoly, for commodities.
		if !opponentsHold(s, p, func(q engine.PlayerID) int { return x.Players[q].Commodities.Count() }) {
			return nil, ErrCardNoEffect
		}
		var takes []engine.MonopolyTake
		for q := range s.Players {
			if engine.PlayerID(q) == p {
				continue
			}
			if x.Players[q].Commodities[*d.Com] > 0 {
				takes = append(takes, engine.MonopolyTake{Player: engine.PlayerID(q), Count: 1})
			}
		}
		return []engine.Event{engine.NewEvent(EvCommodityLevy, commodityLevyData{Player: p, Commodity: *d.Com, Takes: takes})}, nil

	case CardCommercialHarbor:
		// Offer each opponent holding a commodity one of your resources; each then
		// gives back a commodity of their choice. The allocation may be explicit
		// (d.Gives); otherwise one resource per targetable opponent, lowest-index
		// first.
		gives, err := m.harborAllocation(s, x, p, d)
		if err != nil {
			return nil, err
		}
		if len(gives) == 0 {
			// Nobody to force: no opponent holds a commodity, or the taker has no
			// resource to offer. Both are public.
			return nil, ErrCardNoEffect
		}
		return []engine.Event{engine.NewEvent(EvHarborSetup, harborSetupData{Taker: p, Gives: gives})}, nil

	case CardBishop:
		// cak+explorers rule H: the Bishop activates the pirate ship instead of moving
		// the robber. It only arms the other module's activation; placement, legal
		// hexes, victim and timeout belong to that module, so the named hex is ignored.
		if noRobber(s) {
			ev, ok := engine.ArmSeaBlockerFromModules(s, p)
			if !ok {
				return nil, engine.ErrBadCommand
			}
			return []engine.Event{ev}, nil
		}
		if robberLocked(s) {
			return nil, engine.ErrBadCommand // robber out of play until the first attack
		}
		if d.Hex == nil || !engine.RobberMayEnter(s, *d.Hex) || *d.Hex == s.Board.Robber {
			return nil, engine.ErrBadPlacement
		}
		events := []engine.Event{engine.NewEvent(engine.EvRobberMoved, engine.RobberMovedData{Player: p, Hex: *d.Hex})}
		// engine.RobberVictims applies DiscardableCount (module-aware, so commodities
		// count) and the friendly-robber shield. The shield matters in Knights, where
		// a seat falls to the protected <= 2 VP after a pillage. The placement
		// constraint is not applied, as in decideChaseRobber, since the card names the
		// hex. Seats are walked in order so `offset` and every draw are stable.
		victims := engine.RobberVictims(s, *d.Hex, p)
		offset := 3
		for q := range s.Players {
			if !victims[engine.PlayerID(q)] {
				continue
			}
			// Bishop draws one random card from each neighbour's combined
			// resource+commodity pool.
			res, com, isCom := randomCombinedCard(s, offset, s.Players[q].Hand, x.Players[q].Commodities)
			offset++
			if isCom {
				events = append(events, engine.NewEvent(EvCommodityStolen,
					commodityStolenData{Thief: p, Victim: engine.PlayerID(q), Com: com}, p, engine.PlayerID(q)))
			} else {
				events = append(events, engine.NewEvent(engine.EvCardStolen,
					engine.CardStolenData{Thief: p, Victim: engine.PlayerID(q), Res: res}, p, engine.PlayerID(q)))
			}
		}
		return events, nil

	case CardDeserter:
		if d.Victim == nil || *d.Victim == p || int(*d.Victim) >= len(s.Players) {
			return nil, engine.ErrBadVictim
		}
		// The victim must own a knight to surrender.
		if !hasKnight(x, *d.Victim) {
			return nil, engine.ErrBadVictim
		}
		// Open the interaction: the victim chooses which knight to give up
		// (CmdDeserterSurrender), then the taker places the replacement
		// (CmdDeserterPlace). Both steps are forced.
		return []engine.Event{engine.NewEvent(EvDeserterOpened, deserterData{Taker: p, Victim: *d.Victim})}, nil

	case CardDiplomat:
		if d.E == nil {
			return nil, engine.ErrBadCommand
		}
		e := board.NewEdge(d.E.A, d.E.B)
		owner, ok := s.Roads[e]
		if !ok || !openRoad(s, e, owner) {
			return nil, ErrNoOpenRoad
		}
		data := roadRelocatedData{Player: p, Owner: owner, From: e}
		if owner == p && d.To != nil {
			to := board.NewEdge(d.To.A, d.To.B)
			if _, taken := s.Roads[to]; taken || !to.Valid() || !s.Board.LandEdge(to) {
				return nil, engine.ErrBadPlacement
			}
			// A relocation is still a road placement, so an edge a module closes to roads
			// (a Rivers bridge site) is closed here too. engine.LegalRoads and the base
			// build use the same predicate.
			if err := s.EdgeRefusal(to, engine.RouteRoad); err != nil {
				return nil, err
			}
			// The rebuilt road must connect to the player's network without the road
			// being freed.
			if !s.RoadConnectsExcluding(to, p, e) {
				return nil, engine.ErrBadPlacement
			}
			data.To = &to
		}
		// Removing a road may have a price set by another module (Rivers: a road off a
		// river edge costs the player one coin, refunded when rebuilt elsewhere). It is
		// checked before any event, like an Islands ship move, so an unaffordable
		// removal is refused. A plain removal has no destination.
		var to board.Edge
		if data.To != nil {
			to = *data.To
		}
		if err := s.RouteMoveRefusal(p, e, to, engine.RouteRoad); err != nil {
			return nil, err
		}
		return []engine.Event{engine.NewEvent(EvRoadRelocated, data)}, nil

	case CardIntrigue:
		// Displace an enemy knight of any level on your own route network; you need no
		// knight of your own. It relocates along its owner's routes, or is removed if
		// it has nowhere to go.
		if d.V == nil {
			return nil, engine.ErrBadCommand
		}
		k, ok := x.Knights[*d.V]
		if !ok || k.Owner == p {
			return nil, ErrNoKnight
		}
		if !touchesOwnRoute(s, *d.V, p) {
			return nil, engine.ErrBadPlacement
		}
		return []engine.Event{engine.NewEvent(EvKnightDisplaced,
			knightDisplacedData{Mover: p, At: *d.V})}, nil

	case CardSaboteur:
		var required []engine.PlayerDiscard
		for q := range s.Players {
			// Saboteur hits every player with as many or more VP than you. The discard
			// counts the combined resource+commodity hand; the victim chooses.
			if engine.PlayerID(q) == p || s.PublicVPWithModules(engine.PlayerID(q)) < s.PublicVPWithModules(p) {
				continue
			}
			if n := s.Players[q].Hand.Count() + x.Players[q].Commodities.Count(); n > 1 {
				required = append(required, engine.PlayerDiscard{Player: engine.PlayerID(q), Count: n / 2})
			}
		}
		if len(required) == 0 {
			return nil, ErrCardNoEffect // nobody level or ahead holds 2+ cards
		}
		return []engine.Event{engine.NewEvent(engine.EvDiscardsReq, engine.DiscardsReqData{Required: required})}, nil

	case CardSpy:
		if d.Victim == nil || *d.Victim == p || int(*d.Victim) >= len(s.Players) {
			return nil, engine.ErrBadVictim
		}
		if len(x.Players[*d.Victim].Progress) == 0 {
			return nil, engine.ErrBadVictim
		}
		// Open the look. Who spies on whom is public; the victim's hand reaches only
		// the thief via ExtView.Spy. The thief then picks with CmdSpyPick.
		return []engine.Event{engine.NewEvent(EvSpyLooking, spyLookData{Thief: p, Victim: *d.Victim})}, nil

	case CardWarlord:
		// Count the knights this wakes, for the log only. Apply recomputes the set
		// from state, so older logs without the field replay the same.
		woken := 0
		for _, k := range x.Knights {
			if k.Owner == p && !k.Active {
				woken++
			}
		}
		if woken == 0 {
			return nil, ErrCardNoEffect // every knight already awake, or none at all
		}
		return []engine.Event{
			engine.NewEvent(EvKnightsAllActive, knightData{Player: p, Free: true, Count: woken}),
		}, nil

	case CardWedding:
		var owed []engine.PlayerDiscard
		for q := range s.Players {
			if engine.PlayerID(q) == p || s.PublicVPWithModules(engine.PlayerID(q)) <= s.PublicVPWithModules(p) {
				continue
			}
			n := 2
			if have := s.Players[q].Hand.Count() + x.Players[q].Commodities.Count(); have < n {
				n = have
			}
			if n > 0 {
				owed = append(owed, engine.PlayerDiscard{Player: engine.PlayerID(q), Count: n})
			}
		}
		if len(owed) == 0 {
			return nil, ErrCardNoEffect // nobody ahead holds a card to give
		}
		return []engine.Event{engine.NewEvent(evWeddingOwed, weddingOwedData{To: p, Owed: owed})}, nil

	case CardAlchemist:
		if d.D1 < 1 || d.D1 > 6 || d.D2 < 1 || d.D2 > 6 {
			return nil, ErrAlchemistDice
		}
		return []engine.Event{engine.NewEvent(EvDiceFixed, diceFixedData{Player: p, D1: d.D1, D2: d.D2})}, nil

	case CardCrane:
		if d.Track == nil {
			return nil, engine.ErrBadCommand
		}
		raw, _ := json.Marshal(map[string]any{"track": *d.Track})
		return m.decideImprove(s, engine.Command{Player: p, Type: CmdImproveCity, Data: raw}, true)

	case CardEngineer:
		if !playerHasCity(s, p) {
			return nil, ErrNeedCity
		}
		if x.Players[p].Walls >= 3 {
			return nil, ErrMaxWalls
		}
		target, ok := firstWallableCity(s, x, p)
		if !ok {
			if _, unwalled := firstUnwalledCity(s, x, p); unwalled {
				return nil, engine.ErrBadPlacement // a module refuses a build at each
			}
			return nil, ErrMaxWalls // every city already walled
		}
		// The target is named in the event so the fold walls the city this decider
		// judged buildable, rather than re-deriving one a module may refuse (a Raiders
		// conquered hex). Older logs carry no V and fold as before.
		return []engine.Event{engine.NewEvent(EvWallBuilt, wallData{Player: p, Free: true, V: target})}, nil

	case CardInventor:
		if d.A == nil || d.B == nil {
			return nil, engine.ErrBadCommand
		}
		ta, okA := s.Board.Tiles[*d.A]
		tb, okB := s.Board.Tiles[*d.B]
		if !okA || !okB || ta.Number == 0 || tb.Number == 0 {
			return nil, engine.ErrBadPlacement
		}
		// By rule 6/8/2/12 stay put.
		for _, n := range []int{ta.Number, tb.Number} {
			if n == 2 || n == 6 || n == 8 || n == 12 {
				return nil, engine.ErrBadPlacement
			}
		}
		// AN/BN are for the log only: the pre-swap numbers, which can only be captured
		// here (Apply sees the hexes, not the prior board).
		return []engine.Event{engine.NewEvent(EvTokensSwapped, tokensSwappedData{
			A: *d.A, B: *d.B, AN: ta.Number, BN: tb.Number,
		})}, nil

	case CardIrrigation, CardMining:
		res, terrain := board.Wheat, board.Wheat
		if d.Card == CardMining {
			res, terrain = board.Ore, board.Ore
		}
		count := 0
		seen := map[board.Hex]bool{}
		for v, b := range s.Buildings {
			if b.Owner != p {
				continue
			}
			for _, h := range v.Hexes() {
				if t, ok := s.Board.Tiles[h]; ok && t.Res == terrain && !seen[h] {
					seen[h] = true
					count += 2
				}
			}
		}
		if count > s.Bank[res] {
			count = s.Bank[res]
		}
		if count == 0 {
			return nil, ErrCardNoEffect // no such hex, or the supply has none left
		}
		return []engine.Event{engine.NewEvent(EvHarvest, harvestData{Player: p, Res: res, Count: count})}, nil

	case CardMedicine:
		if d.V == nil {
			return nil, engine.ErrBadCommand
		}
		// cak+explorers rule H: the card offers both upgrades at two prices. The
		// harbour settlement belongs to Explorers, so its placement rules and refusal
		// come from that module; this one only sets the price.
		if d.Harbour {
			if !engine.HasFreeHarbour(s) {
				return nil, engine.ErrBadCommand // no module in this ruleset has one
			}
			if !s.Players[p].Hand.Has(costMedicineHarbour) {
				return nil, engine.ErrNoResources
			}
			ev, ok, err := engine.FreeHarbourFromModules(s, p, *d.V)
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, engine.ErrBadCommand
			}
			return []engine.Event{
				engine.NewEvent(EvCheapHarbour, cheapHarbourData{Player: p, V: *d.V}),
				ev,
			}, nil
		}
		b, ok := s.Buildings[*d.V]
		if !ok || b.Owner != p || b.City {
			return nil, engine.ErrBadPlacement
		}
		// Medicine is a city upgrade, so a module that bars this settlement from
		// becoming a city (rule A's harbour settlement) bars it here too.
		if err := s.BlocksCityUpgrade(*d.V, p); err != nil {
			return nil, err
		}
		// A laid-on-side city pins the next upgrade to its vertex; Medicine honours
		// it like the normal city build.
		if must, okMust := m.mustUpgradeFirst(s, p); okMust && must != *d.V {
			return nil, engine.ErrBadPlacement
		}
		if s.Players[p].CitiesLeft == 0 {
			return nil, engine.ErrNoPieces
		}
		if !s.Players[p].Hand.Has(costMedicineCity) {
			return nil, engine.ErrNoResources
		}
		return []engine.Event{engine.NewEvent(EvCheapCity, cheapCityData{Player: p, V: *d.V})}, nil

	case CardRoadBuilding:
		// Two free builds. In an Islands game either may be a ship, so a seat out of
		// road pieces with a ship to place still has a live card.
		shipOK := len(s.ModuleShipTargets(p)) > 0
		if s.Players[p].RoadsLeft == 0 && !shipOK {
			return nil, engine.ErrNoPieces
		}
		// Pieces, but every reachable edge is taken. Public, so refused
		// (ErrCardNoEffect).
		if len(s.LegalRoads(p)) == 0 && !shipOK {
			return nil, ErrCardNoEffect
		}
		n := min(s.Players[p].RoadsLeft, 2)
		if shipOK {
			n = 2
		}
		return []engine.Event{engine.NewEvent(EvFreeRoads, freeRoadsData{Player: p, Count: n})}, nil

	case CardSmith:
		return smithPromotions(s, x, p, d.Knights)
	default:
		// CardConstitution and CardPrinter are VP cards scored on draw and never enter
		// a Progress hand, so reaching this branch is a caller bug.
	}
	return nil, engine.ErrBadCommand
}

// opponentsHold reports whether any seat other than p has a positive count.
func opponentsHold(s *engine.State, p engine.PlayerID, count func(engine.PlayerID) int) bool {
	for q := range s.Players {
		if engine.PlayerID(q) != p && count(engine.PlayerID(q)) > 0 {
			return true
		}
	}
	return false
}

// harborAllocation builds the validated per-opponent resource allocation for
// Commercial Harbor. An explicit d.Gives is honored (the active player's choice
// of which resource to spend on whom); otherwise it auto-assigns one resource
// per opponent that holds a commodity, lowest-index first.
func (Module) harborAllocation(s *engine.State, x *Ext, p engine.PlayerID, d playArgs) ([]harborGive, error) {
	myRes := s.Players[p].Hand
	if d.Gives != nil {
		seen := map[engine.PlayerID]bool{}
		var spent engine.Hand
		for _, g := range d.Gives {
			if g.Player == p || int(g.Player) >= len(s.Players) || seen[g.Player] {
				return nil, engine.ErrBadCommand
			}
			if !validRes(g.Res) {
				return nil, engine.ErrBadCommand
			}
			if x.Players[g.Player].Commodities.Count() == 0 {
				return nil, engine.ErrBadVictim // can't force an opponent with no commodity
			}
			seen[g.Player] = true
			spent[g.Res]++
		}
		if !myRes.Has(spent) {
			return nil, engine.ErrNoResources
		}
		// Offers are optional: one per opponent at most (enforced by `seen`), and the
		// taker may skip anyone. See docs/rules/knights.md and
		// TestCommercialHarborMayOfferASubset. An allocation forcing nobody while an
		// affordable target exists is still refused; with no target at all the card
		// is refused earlier as ErrCardNoEffect.
		if len(d.Gives) == 0 && harborTargetCount(s, x, p) > 0 {
			return nil, engine.ErrBadCommand
		}
		return d.Gives, nil
	}

	var gives []harborGive
	avail := myRes
	for q := range s.Players {
		if engine.PlayerID(q) == p || x.Players[q].Commodities.Count() == 0 {
			continue
		}
		res, ok := lowestResource(avail)
		if !ok {
			break // no resources left to spend
		}
		avail[res]--
		gives = append(gives, harborGive{Player: engine.PlayerID(q), Res: res})
	}
	return gives, nil
}

// harborTargetCount is how many opponents a Commercial Harbor taker could
// force: every other player holding a commodity, capped by the taker's
// resources. It is the size of the auto allocation and of the client's dialog,
// not a floor; an explicit allocation may name fewer, but not zero while this
// is positive.
func harborTargetCount(s *engine.State, x *Ext, p engine.PlayerID) int {
	targets := 0
	for q := range s.Players {
		if engine.PlayerID(q) != p && x.Players[q].Commodities.Count() > 0 {
			targets++
		}
	}
	if r := s.Players[p].Hand.Count(); r < targets {
		targets = r
	}
	return targets
}

// lowestResource returns the lowest-index resource the hand still holds.
func lowestResource(h engine.Hand) (board.Resource, bool) {
	for r := board.Wood; r <= board.Ore; r++ {
		if h[r] > 0 {
			return r, true
		}
	}
	return board.ResNone, false
}

func lowestCommodity(h CommodityHand) (Commodity, bool) {
	for c := range commodityKinds {
		if h[c] > 0 {
			return c, true
		}
	}
	return 0, false
}

func validRes(r board.Resource) bool { return r >= board.Wood && r <= board.Ore }

// randomCombinedCard picks a uniformly random card from a player's combined
// resource+commodity hand. isCom selects which of res/com is meaningful.
func randomCombinedCard(s *engine.State, offset int, hand engine.Hand, coms CommodityHand) (res board.Resource, com Commodity, isCom bool) {
	idx := engine.RngFor(s, offset).IntN(hand.Count() + coms.Count())
	for r, n := range hand {
		if idx < n {
			return board.Resource(r), 0, false
		}
		idx -= n
	}
	for c := range commodityKinds {
		if idx < coms[c] {
			return board.ResNone, c, true
		}
		idx -= coms[c]
	}
	panic("cak: empty combined hand")
}

// openRoad is the Diplomat's test: a road is open if one of its ends is not
// next to one of your roads or buildings and it is not part of a continuous
// route connecting two of your buildings and/or knights. Knights count only in
// the second clause. See docs/rules/knights.md and
// TestDiplomatOpenRoadTwoClauses.
func openRoad(s *engine.State, e board.Edge, owner engine.PlayerID) bool {
	x := extRO(s)
	// Clause 1: an end with none of the owner's roads or buildings at it.
	dangling := false
	for _, v := range []board.Vertex{e.A, e.B} {
		if b, ok := s.Buildings[v]; ok && b.Owner == owner {
			continue
		}
		if !ownRoadAt(s, v, e, owner) {
			dangling = true
		}
	}
	if !dangling {
		return false
	}
	// Clause 2: open unless both sides of the road reach one of the owner's
	// buildings or knights.
	return !routeAnchored(s, x, e.A, e, owner) || !routeAnchored(s, x, e.B, e, owner)
}

// ownRoadAt reports whether the owner has a road at v other than e. Road-kind
// module pieces count (a Rivers bridge); ships do not, since a road and a ship
// join only at the owner's building. See engine.Hooks.RouteEdgeKind.
func ownRoadAt(s *engine.State, v board.Vertex, e board.Edge, owner engine.PlayerID) bool {
	for _, ve := range v.Edges() {
		if ve == e {
			continue
		}
		if o, ok := s.Roads[ve]; ok && o == owner {
			return true
		}
		if o, kind, ok := s.ModuleRouteEdgeKind(ve); ok && o == owner && kind == engine.RouteRoad {
			return true
		}
	}
	return false
}

// routeAnchored reports whether, leaving road e through its end `from`, the
// owner's continuous route reaches one of their buildings or knights. The walk
// follows the owner's roads (and road-kind module pieces) and stops at any
// intersection holding an opponent's building or knight, which breaks a route.
func routeAnchored(s *engine.State, x *Ext, from board.Vertex, e board.Edge, owner engine.PlayerID) bool {
	anchor := func(v board.Vertex) (own, blocked bool) {
		if b, ok := s.Buildings[v]; ok {
			return b.Owner == owner, b.Owner != owner
		}
		if k, ok := x.Knights[v]; ok {
			return k.Owner == owner, k.Owner != owner
		}
		return false, false
	}
	seen := map[board.Vertex]bool{from: true}
	queue := []board.Vertex{from}
	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		own, blocked := anchor(v)
		if own {
			return true
		}
		if blocked {
			continue
		}
		for _, ve := range v.Edges() {
			if ve == e {
				continue
			}
			o, ok := s.Roads[ve]
			if !ok {
				var kind engine.RouteKind
				o, kind, ok = s.ModuleRouteEdgeKind(ve)
				ok = ok && kind == engine.RouteRoad
			}
			if !ok || o != owner {
				continue
			}
			if w := ve.Other(v); !seen[w] {
				seen[w] = true
				queue = append(queue, w)
			}
		}
	}
	return false
}

// smithPromotions resolves the Smith card: up to two of p's knights go up one
// level for free. `chosen` is the player's pick; nil/empty falls back to the
// board-order scan. An explicit pick is validated, not filtered, so an
// ineligible knight gets an error naming why.
func smithPromotions(s *engine.State, x *Ext, p engine.PlayerID, chosen []board.Vertex) ([]engine.Event, error) {
	// added counts promotions into each tier during this play so the 2-piece
	// supply holds.
	added := map[int]int{}
	eligible := func(v board.Vertex) error {
		k, ok := x.Knights[v]
		if !ok || k.Owner != p {
			return ErrNoKnight
		}
		if k.Level >= maxKnightLevel {
			return ErrKnightState
		}
		if k.PromotedThisTurn {
			return ErrAlreadyPromoted // once per knight per turn, whoever paid
		}
		if k.Level == 2 && x.Players[p].Improve[Politics] < 3 {
			return ErrMightyNeedsFort
		}
		if knightCount(x, p, k.Level+1)+added[k.Level+1] >= knightsPerLevel {
			return engine.ErrNoPieces // no free piece at the destination tier
		}
		return nil
	}
	promote := func(v board.Vertex) engine.Event {
		added[x.Knights[v].Level+1]++
		return engine.NewEvent(EvKnightPromoted, knightData{Player: p, V: v, Free: true})
	}

	if len(chosen) > 0 {
		if len(chosen) > 2 {
			return nil, engine.ErrBadCommand
		}
		if len(chosen) == 2 && chosen[0] == chosen[1] {
			return nil, engine.ErrBadCommand // one knight, not one knight twice
		}
		promoted := make([]engine.Event, 0, len(chosen))
		for _, v := range chosen {
			if err := eligible(v); err != nil {
				return nil, err
			}
			promoted = append(promoted, promote(v))
		}
		return promoted, nil
	}

	var promoted []engine.Event
	for _, v := range knightVerticesOf(s, x, p) {
		if eligible(v) != nil {
			continue
		}
		promoted = append(promoted, promote(v))
		if len(promoted) == 2 {
			break
		}
	}
	if len(promoted) == 0 {
		// No knight of yours can go up (none, all mighty, a strong one without
		// politics level 3, or the next tier full). All public, so a dead play.
		return nil, ErrCardNoEffect
	}
	return promoted, nil
}

func knightVerticesOf(s *engine.State, x *Ext, p engine.PlayerID) []board.Vertex {
	var out []board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if k, ok := x.Knights[v]; ok && k.Owner == p && !containsVertex(out, v) {
				out = append(out, v)
			}
		}
	}
	return out
}

func containsVertex(vs []board.Vertex, v board.Vertex) bool {
	return slices.Contains(vs, v)
}

func vertexLess(a, b board.Vertex) bool {
	if a.Q != b.Q {
		return a.Q < b.Q
	}
	if a.R != b.R {
		return a.R < b.R
	}
	return a.Side < b.Side
}
