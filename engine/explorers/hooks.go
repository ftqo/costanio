package explorers

import (
	"maps"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func (m Module) Hooks() engine.Hooks {
	return engine.Hooks{
		OnSeven:  onSeven,
		OnEvents: onEvents,
		// A 7 moves a pirate ship on the water. There is no robber in this
		// game, so the base robber is suppressed outright; leaving it on the
		// board would give a 7 two answers.
		NoRobber:          func(*engine.State) bool { return true },
		RobberNeverInPlay: true,
		// No development deck, and therefore no knights and no Largest Army.
		NoDevCards: true,
		// No cities: a settlement upgrades to a harbour settlement instead,
		// worth 2 VP and still producing one resource.
		//
		// cak+explorers: the Knights pairing restores the city. A coastal
		// settlement then chooses city or harbour settlement, and the choice is
		// final both ways. See docs/rules/explorers.md, "Knights in an
		// Explorers game".
		NoCities: func(s *engine.State) bool { return !WithKnights(s) },
		// No Longest Route either. Roads and ships never form a shared network
		// here and no route length is computed at all.
		NoLongestRoad: true,

		Blocks:            func(s *engine.State) bool { return extRO(s).PiratePending },
		BlocksTurnActions: blocksTurnActions,
		Auto:              autoPirate,
		PendingDeciders:   pendingDeciders,

		OwnsSetup: func(s *engine.State) bool { return s.Phase == engine.PhaseSetup },
		AutoSetup: autoSetup,

		BlocksCityUpgrade: blocksCityUpgrade,
		FreeHarbour:       freeHarbour,
		ArmSeaBlocker:     armPirate,
		UnrevealedVertex: func(s *engine.State, v board.Vertex) bool {
			return unrevealedVertex(extRO(s), v)
		},
		BlocksBuildTrade:   func(s *engine.State) bool { return extRO(s).Movement },
		BuildBlockedVertex: func(s *engine.State, v board.Vertex, p engine.PlayerID) bool { return !buildableVertex(extRO(s), v, p) },
		BuildBlockedEdge:   func(s *engine.State, e board.Edge, p engine.PlayerID) bool { return !buildableEdge(extRO(s), e, p) },

		BankRatio:      bankRatio,
		VictoryCheck:   victoryCheck,
		MaskBoard:      maskBoard,
		LegalExtras:    legalExtras,
		PendingTargets: pendingTargets,
	}
}

// blocksTurnActions narrows the module's gate while discards are owed.
//
// The strict Blocks stays true for the whole activation so the turn cannot be
// passed with the pirate owed. This must go false while a 7's discards are
// outstanding, or the seats owing cards are frozen: AutoCommandFor asks the
// module first, gets nothing (the activation waits on discards), and then
// treats the seat as gated.
func blocksTurnActions(s *engine.State) bool {
	x := extRO(s)
	return x.PiratePending && len(s.PendingDiscards) == 0
}

// blocksCityUpgrade is the other half of cak+explorers rule A: a harbour
// settlement has taken its branch of the one-way choice and cannot become a
// city. decideBuildHarbour refuses the other direction.
//
// Not gated on WithKnights: outside the pairing cities are disabled and nothing
// reaches here.
func blocksCityUpgrade(s *engine.State, v board.Vertex, _ engine.PlayerID) error {
	if _, harbour := extRO(s).Harbours[v]; harbour {
		return ErrUpgradeIsFinal
	}
	return nil
}

// bankRatio is a flat 3:1 for everyone, everywhere, replacing the base 4:1 and
// every port (Explorers generates no harbours).
func bankRatio(*engine.State, engine.PlayerID, board.Resource) (int, bool) {
	return BankRatio, true
}

// victoryCheck is everything Explorers scores beyond the base settlement count:
// the second point of each harbour settlement, the three mission markers, and
// the three bonus tiles. A settler in a hold is worth nothing.
//
// The base game already counts a harbour settlement as a settlement (it is a
// base Building), so this adds one point, not two.
func victoryCheck(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	vp := 0
	for _, owner := range x.Harbours {
		if owner == p {
			vp += HarbourVP
		}
	}
	return vp + MissionVP(x, p)
}

// maskBoard is the fog of war. Every unrevealed pool hex is sent to every
// client as the wire-only `fog` resource with no terrain and no chit; the live
// board keeps the truth.
//
// It masks the same way for every viewer (the hook takes no viewer): the fog is
// nobody's knowledge.
func maskBoard(s *engine.State, b *board.Board) *board.Board {
	x := extRO(s)
	if len(x.Pool) == 0 || b == nil {
		return b
	}
	tiles := make(map[board.Hex]board.Tile, len(b.Tiles))
	maps.Copy(tiles, b.Tiles)
	masked := false
	for _, p := range x.Pool {
		if x.Revealed[p.H] {
			continue
		}
		tiles[p.H] = board.Tile{Res: board.Fog}
		masked = true
	}
	if !masked {
		return b
	}
	out := *b
	out.Tiles = tiles
	return &out
}

// onSeven owes the roller a pirate activation. Discards resolve first; the
// module's Auto and BlocksTurnActions are what sequence the two.
func onSeven(s *engine.State) []engine.Event {
	return []engine.Event{engine.NewEvent(EvPirateOwed, pirateOwedData{Player: s.Cur})}
}

// armPirate is engine.Hooks.ArmSeaBlocker: the same activation a 7 owes, for a
// player who obtained it another way.
//
// The only caller is the Knights Bishop under cak+explorers rule H. It refuses
// while an activation is already outstanding, as everywhere else in the module,
// since two owed placements would lose one.
func armPirate(s *engine.State, p engine.PlayerID) (engine.Event, bool) {
	if extRO(s).PiratePending {
		return engine.Event{}, false
	}
	return engine.NewEvent(EvPirateOwed, pirateOwedData{Player: p, Bishop: true}), true
}

// onEvents is where the three things that follow from a batch rather than from a
// command happen: the turn reset, the production-phase gold, and the pirate lair
// battles the active player's finished Movement phase resolves.
func onEvents(after *engine.State, events []engine.Event) []engine.Event {
	x := extRO(after)
	var out []engine.Event
	base := after.NextSeq
	for _, e := range events {
		switch e.Type {
		case engine.EvTurnEnded:
			d := engine.DecodeEvent[engine.TurnEndedData](e)
			out = append(out, resolveLairs(after, x, d.Player, base+len(out))...)
		case engine.EvTurnStarted:
			out = append(out, engine.NewEvent(EvTurnReset, struct{}{}))
		case engine.EvDiceRolled:
			d := engine.DecodeEvent[engine.DiceRolledData](e)
			out = append(out, productionGold(after, x, d.D1+d.D2, events)...)
		default:
		}
	}
	return out
}

// productionGold pays a production roll's two gold sources.
//
// A captured gold field pays 2 gold per adjacent building of its owner; an
// uncaptured one has no visible number and pays nothing. A player who received
// no resource cards from the roll takes 1 gold; gold is not a resource, so this
// applies even if their only income was gold from a gold field.
//
// A 7 pays neither: it produces nothing, and a gold for everyone on a 7 would
// defeat its purpose. Recorded as a Decision in docs/rules/explorers.md.
func productionGold(after *engine.State, x *Ext, roll int, events []engine.Event) []engine.Event {
	if roll == 7 {
		return nil
	}
	gained := map[engine.PlayerID]bool{}
	for _, e := range events {
		if e.Type != engine.EvResDistributed {
			continue
		}
		d := engine.DecodeEvent[engine.ResDistributedData](e)
		for _, g := range d.Gains {
			if g.Gain.Count() > 0 {
				gained[g.Player] = true
			}
		}
	}
	gold := make([]int, len(after.Players))
	for h, t := range after.Board.Tiles {
		if t.Res != board.Gold || t.Number != roll || !x.Captured[h] {
			continue
		}
		for _, v := range h.Vertices() {
			if b, ok := after.Buildings[v]; ok {
				gold[b.Owner] += GoldFieldYield
			}
		}
	}
	var gains []goldGain
	for p := range after.Players {
		seat := engine.PlayerID(p)
		if gold[p] > 0 {
			gains = append(gains, goldGain{Player: seat, Amount: gold[p], Reason: GoldField})
		}
		if !gained[seat] {
			gains = append(gains, goldGain{Player: seat, Amount: 1, Reason: GoldConsolation})
		}
	}
	if len(gains) == 0 {
		return nil
	}
	return []engine.Event{engine.NewEvent(EvGoldChanged, goldData{Gains: gains})}
}

// resolveLairs settles every uncaptured pirate lair with three or more crews
// once the active player has finished their Movement phase.
//
// Crews arriving after the third and before resolution count: resolution waits
// for the end of the Movement phase so the player can finish moving, and only
// the active player can add them.
func resolveLairs(after *engine.State, x *Ext, active engine.PlayerID, base int) []engine.Event {
	var hexes []board.Hex
	for h, crews := range x.LairCrew {
		if x.Captured[h] {
			continue
		}
		total := 0
		for _, n := range crews {
			total += n
		}
		if total >= LairCrews {
			hexes = append(hexes, h)
		}
	}
	sortHexes(hexes)
	var out []engine.Event
	used := slices.Clone(x.ChitsUsed)
	for _, h := range hexes {
		out = append(out, lairEvent(after, x, h, active, base+len(out), used))
	}
	return out
}

// lairEvent is one battle, resolved into a single event so a replay reproduces
// it without re-rolling anything.
func lairEvent(after *engine.State, x *Ext, h board.Hex, active engine.PlayerID, seq int, used []int) engine.Event {
	crews := x.LairCrew[h]
	n := len(after.Players)
	var involved []engine.PlayerID
	var counts []int
	// Starting with the active player and going clockwise: the order every
	// involved player takes their 2 gold and their space in.
	for i := range n {
		p := engine.PlayerID((int(active) + i) % n)
		if crews[p] > 0 {
			involved = append(involved, p)
			counts = append(counts, crews[p])
		}
	}
	rng := engine.PublicRngForSeed(after.PublicSeed, engine.ExplorersDieSeq(seq))
	rolls := make([]int, len(involved))
	for i := range involved {
		rolls[i] = rng.IntN(6) + 1
	}
	hero := pickHero(involved, counts, rolls, rng)
	d := lairData{H: h, Involved: involved, Rolls: rolls, Crews: counts, Hero: hero}
	d.Number = drawChit(x, regionOf(x, h), used)
	return engine.NewEvent(EvLairResolved, d)
}

// pickHero settles who led the battle: highest die plus own crews on the hex,
// ties to the player with more crews, and if still tied a reroll among the tied
// until one is strictly highest.
//
// The reroll loop is bounded and falls back to the lowest tied seat, so a
// pathological stream cannot hang a fold. Only the first round's dice reach the
// event; a replay needs only the winner.
func pickHero(involved []engine.PlayerID, crews, rolls []int, rng interface{ IntN(int) int }) engine.PlayerID {
	if len(involved) == 0 {
		return engine.NoPlayer
	}
	tied := make([]int, len(involved))
	for i := range involved {
		tied[i] = i
	}
	sums := slices.Clone(rolls)
	for range 64 {
		best, bestSum := []int{}, -1
		for _, i := range tied {
			sum := sums[i] + crews[i]
			switch {
			case sum > bestSum:
				best, bestSum = []int{i}, sum
			case sum == bestSum:
				best = append(best, i)
			}
		}
		if len(best) == 1 {
			return involved[best[0]]
		}
		// Tie on the sum: more crews on the hex wins.
		byCrews, most := []int{}, -1
		for _, i := range best {
			switch {
			case crews[i] > most:
				byCrews, most = []int{i}, crews[i]
			case crews[i] == most:
				byCrews = append(byCrews, i)
			}
		}
		if len(byCrews) == 1 {
			return involved[byCrews[0]]
		}
		tied = byCrews
		for _, i := range tied {
			sums[i] = rng.IntN(6) + 1
		}
	}
	return involved[tied[0]]
}

// ---- interrupts -------------------------------------------------------------

func pendingDeciders(s *engine.State) []engine.ModuleDecider {
	x := extRO(s)
	if !x.PiratePending || len(s.PendingDiscards) > 0 || x.PirateBy == engine.NoPlayer {
		return nil
	}
	return []engine.ModuleDecider{{Seat: x.PirateBy, Decision: DecisionPirate}}
}

// autoPirate resolves an owed pirate activation for auto-pass, the turn timer
// and the bots' fallback: the first legal hex that robs somebody, else the
// first legal hex, mirroring the base robber's auto-move.
func autoPirate(s *engine.State, target engine.PlayerID) (engine.Command, bool) {
	x := extRO(s)
	if !x.PiratePending || len(s.PendingDiscards) > 0 {
		return engine.Command{}, false
	}
	if target != engine.NoPlayer && target != x.PirateBy {
		return engine.Command{}, false
	}
	mover := x.PirateBy
	if mover == engine.NoPlayer {
		return engine.Command{}, false
	}
	hexes := legalPirateHexes(s, x, mover)
	if len(hexes) == 0 {
		return engine.Command{}, false
	}
	pick, victim := hexes[0], engine.NoPlayer
	for _, h := range hexes {
		victims := pirateVictims(x, h, mover)
		for p := range s.Players {
			if victims[engine.PlayerID(p)] {
				pick, victim = h, engine.PlayerID(p)
				break
			}
		}
		if victim != engine.NoPlayer {
			break
		}
	}
	payload := map[string]any{"h": pick}
	if victim != engine.NoPlayer {
		payload["victim"] = victim
	}
	return engine.Command{Player: mover, Type: CmdMovePirate, Data: raw(payload)}, true
}

// autoSetup answers the three-round draft for auto-pass and the turn timer. The
// base setup commands are refused while this module owns the draft, so a
// timed-out seat needs a command from here.
func autoSetup(s *engine.State) (engine.Command, bool) {
	x := extRO(s)
	if s.Phase != engine.PhaseSetup {
		return engine.Command{}, false
	}
	p := s.Cur
	switch x.Round {
	case harbourRound(s):
		spots := setupHarbourSpots(s, x)
		if len(spots) == 0 {
			return engine.Command{}, false
		}
		v := spots[engine.RngFor(s, 0).IntN(len(spots))]
		return engine.Command{Player: p, Type: CmdPlaceHarbour, Data: raw(map[string]any{"v": v})}, true
	case buildingRound(s):
		spots := setupSettlementSpots(s, x)
		if len(spots) == 0 {
			return engine.Command{}, false
		}
		v := spots[engine.RngFor(s, 0).IntN(len(spots))]
		return engine.Command{Player: p, Type: CmdPlaceSettlement, Data: raw(map[string]any{"v": v})}, true
	default:
		roads, ships := startRoads(s, x, p), startShips(s, x, p)
		if len(roads) == 0 || len(ships) == 0 {
			return engine.Command{}, false
		}
		rng := engine.RngFor(s, 0)
		road := roads[rng.IntN(len(roads))]
		ship := ships[rng.IntN(len(ships))]
		return engine.Command{Player: p, Type: CmdPlaceStart, Data: raw(map[string]any{"road": road, "ship": ship})}, true
	}
}

// ---- legal targets ----------------------------------------------------------

// setupHarbourSpots is every coastal intersection of the home island a starting
// harbour settlement may take.
func setupHarbourSpots(s *engine.State, x *Ext) []board.Vertex {
	return startSpots(s, x, true)
}

func setupSettlementSpots(s *engine.State, x *Ext) []board.Vertex {
	return startSpots(s, x, false)
}

func startSpots(s *engine.State, x *Ext, harbour bool) []board.Vertex {
	seen := map[board.Vertex]bool{}
	var out []board.Vertex
	for _, h := range x.Home {
		for _, v := range h.Vertices() {
			if seen[v] {
				continue
			}
			seen[v] = true
			if checkStartSpot(s, x, v, harbour) == nil {
				out = append(out, v)
			}
		}
	}
	slices.SortFunc(out, func(a, b board.Vertex) int {
		if vertexLess(a, b) {
			return -1
		}
		return 1
	})
	return out
}

// pendingTargets surfaces the pirate activation this seat owes, which can be due
// while it is nobody's actionable turn.
func pendingTargets(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := extRO(s)
	if !x.PiratePending || x.PirateBy != seat || len(s.PendingDiscards) > 0 {
		return engine.LegalExtra{}
	}
	return engine.LegalExtra{PirateHexes: legalPirateHexes(s, x, seat)}
}

// legalExtras is the module's positional offer for the seat that is up: the
// setup draft's spots, the settlements that may become harbour settlements, the
// sea edges a ship may be built on, and per-ship movement and action targets.
func legalExtras(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := extRO(s)
	var out engine.LegalExtra
	if s.Phase == engine.PhaseSetup {
		switch x.Round {
		case harbourRound(s):
			out.Harbours = setupHarbourSpots(s, x)
		case buildingRound(s):
			out.Settlements = setupSettlementSpots(s, x)
		default:
			out.Roads = startRoads(s, x, seat)
			out.Ships = startShips(s, x, seat)
		}
		return out
	}
	if x.Movement {
		out.ExplorerShips = shipTargets(s, x, seat)
		return out
	}
	// Action phase: what may be built.
	if x.Seats[seat].HarboursLeft > 0 {
		for v := range s.Buildings {
			// checkHarbourSpot rather than a copy of its rules: ownership, not
			// already a harbour, coastal, and cak+explorers rule A, under which
			// a city can never be offered here. Otherwise bots would keep
			// sending upgrades the engine refuses.
			if checkHarbourSpot(s, x, v, seat) == nil {
				out.Harbours = append(out.Harbours, v)
			}
		}
		slices.SortFunc(out.Harbours, func(a, b board.Vertex) int {
			if vertexLess(a, b) {
				return -1
			}
			return 1
		})
	}
	out.Ships = shipBuildSpots(s, x, seat)
	return out
}

// shipBuildSpots is every sea edge beside one of seat's harbour settlements a
// ship may be built on.
func shipBuildSpots(s *engine.State, x *Ext, seat engine.PlayerID) []board.Edge {
	if x.Seats[seat].ShipsLeft == 0 && !anyShipOf(x, seat) {
		return nil
	}
	seen := map[board.Edge]bool{}
	var out []board.Edge
	for v, owner := range x.Harbours {
		if owner != seat {
			continue
		}
		for _, e := range v.Edges() {
			if seen[e] {
				continue
			}
			seen[e] = true
			legal := shipSpotOK(s, x, e, seat, 0) == nil
			if !legal && x.Seats[seat].ShipsLeft == 0 {
				for id, ship := range x.Ships {
					if ship.Owner == seat && shipSpotOK(s, x, e, seat, id) == nil {
						legal = true
						break
					}
				}
			}
			if legal {
				out = append(out, e)
			}
		}
	}
	slices.SortFunc(out, func(a, b board.Edge) int {
		if edgeLess(a, b) {
			return -1
		}
		return 1
	})
	return out
}

func anyShipOf(x *Ext, p engine.PlayerID) bool {
	for _, sh := range x.Ships {
		if sh.Owner == p {
			return true
		}
	}
	return false
}

// shipTargets is, per movable ship, the edges one movement point reaches and
// the corners it may work this turn.
//
// One step rather than every reachable edge, because a reveal ends a ship's
// movement and a multi-step offer could be broken by the first step touching
// fog. A client walks the offer a step at a time.
func shipTargets(s *engine.State, x *Ext, seat engine.PlayerID) []engine.ExplorerShipTargets {
	var ids []int
	for id, sh := range x.Ships {
		if sh.Owner == seat {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	var out []engine.ExplorerShipTargets
	for _, id := range ids {
		sh := x.Ships[id]
		t := engine.ExplorerShipTargets{Ship: id, From: sh.E, Left: mpLeft(x, sh)}
		if t.Left > 0 {
			for _, v := range []board.Vertex{sh.E.A, sh.E.B} {
				for _, e := range v.Edges() {
					if e == sh.E || !e.Valid() || !sailable(s, x, e) {
						continue
					}
					if !roomOn(x, e, id) {
						continue
					}
					if !slices.Contains(t.Moves, e) {
						t.Moves = append(t.Moves, e)
					}
				}
			}
			slices.SortFunc(t.Moves, func(a, b board.Edge) int {
				if edgeLess(a, b) {
					return -1
				}
				return 1
			})
		}
		t.Acts = shipActs(s, seat, id)
		out = append(out, t)
	}
	return out
}

// shipActs is every job this ship may do from where it stands, named.
//
// It is Jobs() expressed as board targets using the same predicates, so the
// offer and the validator agree.
func shipActs(s *engine.State, seat engine.PlayerID, ship int) []engine.ShipAct {
	var out []engine.ShipAct
	for _, j := range Jobs(s, seat) {
		if j.Ship != ship {
			continue
		}
		act := engine.ShipAct{}
		switch j.Kind {
		case JobFound:
			act.Job, act.V = engine.ShipActFound, j.V
		case JobLandCrew, JobTakeCrew, JobLoadHaul:
			h := j.H
			act.H = &h
			switch j.Kind {
			case JobLandCrew:
				act.Job = engine.ShipActLandCrew
			case JobTakeCrew:
				act.Job = engine.ShipActTakeCrew
			default:
				act.Job = engine.ShipActLoadHaul
			}
			// The corner is where the ship that reaches the hex stands; either
			// end works, so the lower one is named for a stable offer.
			sh := extRO(s).Ships[ship]
			act.V = sh.E.A
			if vertexLess(sh.E.B, act.V) {
				act.V = sh.E.B
			}
		case JobDeliver:
			continue // delivering is a ship-wide action, not a corner
		}
		out = append(out, act)
	}
	return out
}
