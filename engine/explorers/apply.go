package explorers

import (
	"maps"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// setTile writes one tile onto the board copy-on-write. State.Clone shares the
// Tiles map, so a speculative apply on a clone would otherwise change the live
// board. Explorers needs it because a reveal deals a number chit onto a hex
// after generation (the Knights Inventor swap does the same).
func setTile(s *engine.State, h board.Hex, t board.Tile) {
	tiles := make(map[board.Hex]board.Tile, len(s.Board.Tiles))
	maps.Copy(tiles, s.Board.Tiles)
	tiles[h] = t
	b := *s.Board
	b.Tiles = tiles
	s.Board = &b
}

func (Module) Apply(s *engine.State, e engine.Event) (bool, error) {
	x := ext(s)
	switch e.Type {
	case EvHarbourPlaced:
		// A setup harbour settlement. It occupies a base Building so every base rule
		// that reads the board (production, distance, road connection) sees it; this
		// set marks it as a harbour. It costs a harbour piece, not a settlement piece,
		// so SettlementsLeft is untouched (see piece conservation in hooks.go).
		d := engine.DecodeEvent[placeData](e)
		s.Buildings[d.V] = engine.Building{Owner: d.Player}
		x.Harbours[d.V] = d.Player
		x.Seats[d.Player].HarboursLeft--
		x.advanceSetup(s)

	case EvSettlementPlace:
		d := engine.DecodeEvent[placeData](e)
		s.Buildings[d.V] = engine.Building{Owner: d.Player, City: d.City}
		// cak+explorers rule C: in the Knights pairing this placement is a city (the
		// first placement; the second in logs from before the rounds were swapped),
		// taken from the city supply. d.City is false outside the pairing.
		if d.City {
			s.Players[d.Player].CitiesLeft--
		} else {
			s.Players[d.Player].SettlementsLeft--
		}
		if d.Gain.Count() > 0 {
			s.Players[d.Player].Hand.Add(d.Gain)
			s.Bank.Sub(d.Gain)
		}
		x.advanceSetup(s)

	case EvStartPlaced:
		d := engine.DecodeEvent[startData](e)
		s.Roads[d.Road] = d.Player
		s.Players[d.Player].RoadsLeft--
		x.addShip(Ship{ID: d.ShipID, Owner: d.Player, E: d.Ship, Hold: Cargo{Settler: 1}})
		x.Seats[d.Player].ShipsLeft--
		x.Seats[d.Player].SettlersLeft--
		x.advanceSetup(s)

	case EvHarbourBuilt:
		// The upgrade: the settlement piece goes back to the supply and a harbour
		// settlement stands on the same intersection.
		d := engine.DecodeEvent[placeData](e)
		x.Harbours[d.V] = d.Player
		s.Players[d.Player].SettlementsLeft++
		x.Seats[d.Player].HarboursLeft--
		// Free when another module charged for it: the Knights Medicine card under
		// cak+explorers rule H pays its 1 ore + 1 grain in its own event. Older logs
		// decode false and charge as before.
		if !d.Free {
			s.Players[d.Player].Hand.Sub(CostHarbour)
			s.Bank.Add(CostHarbour)
		}
		if _, ok := x.Basins[d.V]; !ok {
			x.Basins[d.V] = Cargo{}
		}

	case EvShipBuilt:
		d := engine.DecodeEvent[shipData](e)
		if d.Recycled != 0 {
			// "You may return any one of your ships to your supply first. Anything it was
			// carrying goes back to its own supply." Only the cargo's progress is lost.
			x.returnCargo(d.Player, x.Ships[d.Recycled].Hold)
			x.removeShip(d.Recycled)
			x.Seats[d.Player].ShipsLeft++
		}
		x.addShip(Ship{ID: d.ShipID, Owner: d.Player, E: d.E})
		x.Seats[d.Player].ShipsLeft--
		s.Players[d.Player].Hand.Sub(CostShip)
		s.Bank.Add(CostShip)

	case EvShipMoved:
		d := engine.DecodeEvent[shipMoveData](e)
		sh := x.Ships[d.ShipID]
		// Which way it now points: the end of the new edge not shared with the old
		// one. Doubling back (the same edge) leaves the bow where it was.
		sh.Bow = bowAfter(sh.E, d.To, sh.Bow)
		sh.E = d.To
		sh.Used += d.Steps
		sh.Moved = true
		sh.Done = sh.Done || d.Stopped
		x.Ships[d.ShipID] = sh
		x.finishOtherShips(d.Player, d.ShipID)
		if d.Tribute > 0 {
			x.Seats[d.Player].Gold -= d.Tribute
			x.Tribute[d.ShipID] = true
		}

	case EvShipSped:
		d := engine.DecodeEvent[shipRefData](e)
		sh := x.Ships[d.ShipID]
		sh.Bonus += WoolMP
		x.Ships[d.ShipID] = sh
		var wool engine.Hand
		wool[board.Sheep] = 1
		s.Players[d.Player].Hand.Sub(wool)
		s.Bank.Add(wool)

	case EvHexRevealed:
		d := engine.DecodeEvent[revealData](e)
		x.Revealed[d.H] = true
		if d.Number > 0 {
			x.ChitsUsed[d.Region]++
			setTile(s, d.H, board.Tile{Res: d.Res, Number: d.Number})
		}
		switch d.Kind {
		case SpecialSpice:
			// One sack per player, dealt onto the farm as it is revealed.
			x.FarmCrew[d.H] = make([]bool, len(s.Players))
			x.FarmSack[d.H] = make([]bool, len(s.Players))
		case SpecialGold:
			x.LairCrew[d.H] = make([]int, len(s.Players))
		case SpecialNone, SpecialShoal:
		}
		if d.Gain.Count() > 0 {
			s.Players[d.Player].Hand.Add(d.Gain)
			s.Bank.Sub(d.Gain)
		}

	case EvCargoBought:
		d := engine.DecodeEvent[cargoData](e)
		if d.AtShip {
			sh := x.Ships[d.ShipID]
			sh.Hold = add(sh.Hold, d.Cargo)
			x.Ships[d.ShipID] = sh
		} else {
			x.Basins[d.V] = add(x.Basins[d.V], d.Cargo)
		}
		x.Seats[d.Player].SettlersLeft -= d.Cargo.Settler
		x.Seats[d.Player].CrewsLeft -= d.Cargo.Crew
		s.Players[d.Player].Hand.Sub(d.Cost)
		s.Bank.Add(d.Cost)

	case EvJettisoned:
		d := engine.DecodeEvent[cargoData](e)
		if d.AtShip {
			sh := x.Ships[d.ShipID]
			sh.Hold = sub(sh.Hold, d.Cargo)
			x.Ships[d.ShipID] = sh
		} else {
			x.Basins[d.V] = sub(x.Basins[d.V], d.Cargo)
		}
		x.returnCargo(d.Player, d.Cargo)

	case EvCargoMoved:
		d := engine.DecodeEvent[cargoMoveData](e)
		sh := x.Ships[d.ShipID]
		if d.ToShip {
			sh.Hold = sub(add(sh.Hold, d.Cargo), d.Back)
			x.Basins[d.V] = add(sub(x.Basins[d.V], d.Cargo), d.Back)
		} else {
			sh.Hold = add(sub(sh.Hold, d.Cargo), d.Back)
			x.Basins[d.V] = sub(add(x.Basins[d.V], d.Cargo), d.Back)
		}
		x.Ships[d.ShipID] = sh

	case EvCrewLanded:
		d := engine.DecodeEvent[crewData](e)
		sh := x.Ships[d.ShipID]
		sh.Hold.Crew--
		if d.Sack {
			sh.Hold.Spice++
		}
		x.Ships[d.ShipID] = sh
		if d.Sack {
			// A spice farm: the crew stays there permanently and the sack goes
			// aboard. The advantage lands immediately.
			x.FarmCrew[d.H][d.Player] = true
			x.FarmSack[d.H][d.Player] = true
			x.Seats[d.Player].Villages[d.Village][d.Region] = true
		} else {
			x.LairCrew[d.H][d.Player]++
		}

	case EvCrewTaken:
		d := engine.DecodeEvent[crewData](e)
		sh := x.Ships[d.ShipID]
		sh.Hold.Crew++
		x.Ships[d.ShipID] = sh
		x.LairCrew[d.H][d.Player]--

	case EvHaulPlaced:
		d := engine.DecodeEvent[haulData](e)
		x.Hauls[d.H] = true
		x.HaulsLeft--
		x.FishRolled = true
		x.finishOtherShips(d.Player, 0)

	case EvHaulMissed:
		d := engine.DecodeEvent[haulData](e)
		x.FishRolled = true
		x.finishOtherShips(d.Player, 0)

	case EvHaulLoaded:
		d := engine.DecodeEvent[haulData](e)
		delete(x.Hauls, d.H)
		sh := x.Ships[d.ShipID]
		sh.Hold.Haul++
		x.Ships[d.ShipID] = sh

	case EvDelivered:
		d := engine.DecodeEvent[deliverData](e)
		sh := x.Ships[d.ShipID]
		sh.Hold.Haul -= d.Hauls
		sh.Hold.Spice -= d.Sacks
		x.Ships[d.ShipID] = sh
		x.HaulsLeft += d.Hauls
		for range d.Hauls {
			x.advance(d.Player, TrackFish)
		}
		for range d.Sacks {
			x.advance(d.Player, TrackSpice)
		}

	case EvFounded:
		d := engine.DecodeEvent[foundData](e)
		s.Buildings[d.V] = engine.Building{Owner: d.Player}
		s.Players[d.Player].SettlementsLeft--
		// "Return both the settler and the ship to your supply." Both pieces come
		// back; the settlement and the settler's cost are what was spent. The settler
		// is a transport marker, and a supply of two that never returned would cap a
		// player at two overseas settlements.
		x.removeShip(d.ShipID)
		x.Seats[d.Player].ShipsLeft++
		x.Seats[d.Player].SettlersLeft++

	case EvLairResolved:
		d := engine.DecodeEvent[lairData](e)
		x.Captured[d.H] = true
		for _, p := range d.Involved {
			x.Seats[p].Gold += LairGold
			x.advance(p, TrackLairs)
		}
		if d.Hero != engine.NoPlayer {
			x.advance(d.Hero, TrackLairs)
			x.LairCrew[d.H][d.Hero]--
			x.Seats[d.Hero].CrewsLeft++
		}
		// The token flips: the gold field takes the chit it was covering and
		// starts producing 2 gold per adjacent building.
		if d.Number > 0 {
			x.ChitsUsed[regionOf(x, d.H)]++
			setTile(s, d.H, board.Tile{Res: board.Gold, Number: d.Number})
		}

	case EvPirateOwed:
		d := engine.DecodeEvent[pirateOwedData](e)
		x.PiratePending = true
		x.PirateBy = d.Player

	case EvPirateMoved:
		d := engine.DecodeEvent[pirateData](e)
		if d.Displaced != nil {
			x.Seats[*d.Displaced].PirateOnBoard = false
		}
		x.Pirate = d.H
		x.PirateOwner = d.Player
		x.HasPirate = true
		x.Seats[d.Player].PirateOnBoard = true
		x.PiratePending = false
		x.PirateBy = engine.NoPlayer
		x.Chased, x.Vacated = false, board.Hex{}
		if d.Haul {
			delete(x.Hauls, d.H)
			x.HaulsLeft++
		}
		if d.Victim != nil {
			if d.Gold > 0 {
				x.Seats[*d.Victim].Gold -= d.Gold
				x.Seats[d.Player].Gold += d.Gold
			} else {
				var h engine.Hand
				h[d.Res] = 1
				s.Players[*d.Victim].Hand.Sub(h)
				s.Players[d.Player].Hand.Add(h)
			}
		}

	case EvPirateChased:
		d := engine.DecodeEvent[chaseData](e)
		for _, id := range d.Ships {
			sh, ok := x.Ships[id]
			if !ok {
				continue
			}
			// A ship that rolled may still move afterwards. Its battle readiness is spent,
			// and that is already expressed by Moved: only an unmoved ship rolls, once per
			// pirate.
			sh.Fought = true
			x.Ships[id] = sh
		}
		if d.Won {
			if x.HasPirate && x.PirateOwner != engine.NoPlayer {
				x.Seats[x.PirateOwner].PirateOnBoard = false
			}
			if x.HasPirate {
				x.Chased, x.Vacated = true, x.Pirate
			}
			x.HasPirate = false
			x.PirateOwner = engine.NoPlayer
			x.PiratePending = true
			x.PirateBy = d.Player
		}

	case EvGoldChanged:
		d := engine.DecodeEvent[goldData](e)
		for _, g := range d.Gains {
			x.Seats[g.Player].Gold += g.Amount
		}

	case EvGoldTraded:
		d := engine.DecodeEvent[goldTradeData](e)
		x.Seats[d.Player].Gold += d.Gold
		if d.Give.Count() > 0 {
			s.Players[d.Player].Hand.Sub(d.Give)
			s.Bank.Add(d.Give)
		}
		if d.Get.Count() > 0 {
			s.Players[d.Player].Hand.Add(d.Get)
			s.Bank.Sub(d.Get)
		}
		switch d.Reason {
		case GoldBuy:
			x.Seats[d.Player].GoldBuys++
		case GoldSell:
			x.Seats[d.Player].FastGold++
		}

	case EvMovementBegan:
		x.Movement = true

	case EvTurnReset:
		x.Movement = false
		x.FishRolled = false
		clear(x.Tribute)
		for id, sh := range x.Ships {
			sh.Used, sh.Bonus, sh.Done, sh.Moved, sh.Fought = 0, 0, false, false, false
			x.Ships[id] = sh
		}
		for i := range x.Seats {
			x.Seats[i].GoldBuys = 0
			x.Seats[i].FastGold = 0
		}

	default:
		return false, nil
	}
	return true, nil
}

// advanceSetup moves the three-round draft on. Round 0 runs in turn order,
// round 1 in reverse and round 2 (a road and a settler-loaded ship) in turn
// order. What rounds 0 and 1 place is the deciders' business (harbourRound): a
// harbour settlement then a settlement, or with Knights a city then a harbour
// settlement. The draft snakes 0..n-1, n-1..0, 0..n-1.
func (x *Ext) advanceSetup(s *engine.State) {
	n := engine.PlayerID(s.Config.Players)
	switch x.Round {
	case 0:
		if s.Cur+1 < n {
			s.Cur++
			return
		}
		x.Round = 1 // the same player goes again, reversed
	case 1:
		if s.Cur > 0 {
			s.Cur--
			return
		}
		x.Round = 2 // and again, forward
	default:
		if s.Cur+1 < n {
			s.Cur++
			return
		}
		s.Phase = engine.PhasePlay
		s.Cur = 0
		s.Rolled = false
	}
}

func (x *Ext) addShip(sh Ship) {
	x.Ships[sh.ID] = sh
	if sh.ID >= x.NextShip {
		x.NextShip = sh.ID + 1
	}
}

func (x *Ext) removeShip(id int) { delete(x.Ships, id) }

// finishOtherShips closes every other ship of p that has already moved this
// turn. Movement is not interleaved ("finish one ship before starting
// another"), so a second ship moving ends the first one's move. The fishing die
// calls it with no ship excepted (id 0 is never issued), since the roll comes
// before or after a ship's move, never during. Unmoved ships are untouched, and
// loading a haul costs no movement.
func (x *Ext) finishOtherShips(p engine.PlayerID, moving int) {
	for id, sh := range x.Ships {
		if id == moving || sh.Owner != p || !sh.Moved {
			continue
		}
		sh.Done = true
		x.Ships[id] = sh
	}
}

// returnCargo puts jettisoned pieces back in their owner's supply. A fish haul
// goes to the shared supply and a spice sack leaves the game (each sack is dealt
// onto its farm once per player).
func (x *Ext) returnCargo(p engine.PlayerID, c Cargo) {
	x.Seats[p].SettlersLeft += c.Settler
	x.Seats[p].CrewsLeft += c.Crew
	x.HaulsLeft += c.Haul
}

// advance moves p's marker one space along track t, stamping when it arrived so
// the bonus tile goes to whoever reached the leading space first. Progress past
// space 7 is discarded; a marker on 7 holds the tile against a challenger.
func (x *Ext) advance(p engine.PlayerID, t int) {
	if x.Seats[p].Track[t] >= TrackSpaces {
		return
	}
	x.Seats[p].Track[t]++
	x.Clock++
	x.Seats[p].Arrived[t] = x.Clock
}

// bowAfter is the end of `to` the ship arrived at, the one `from` does not
// share. Edges sharing both ends are the same edge and edges sharing neither
// are not a legal step, so the fallback is the previous bow.
func bowAfter(from, to board.Edge, prev board.Vertex) board.Vertex {
	for _, v := range []board.Vertex{to.A, to.B} {
		if v != from.A && v != from.B {
			return v
		}
	}
	return prev
}

func add(a, b Cargo) Cargo {
	return Cargo{a.Settler + b.Settler, a.Haul + b.Haul, a.Crew + b.Crew, a.Spice + b.Spice}
}

func sub(a, b Cargo) Cargo {
	return Cargo{a.Settler - b.Settler, a.Haul - b.Haul, a.Crew - b.Crew, a.Spice - b.Spice}
}
