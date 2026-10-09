package engine

import (
	"encoding/json"
	"fmt"
	"maps"
	"math/rand/v2"
	"slices"

	"github.com/ftqo/costan.io/engine/board"
)

type Phase string

const (
	PhaseSetup    Phase = "setup"
	PhasePlay     Phase = "play"
	PhaseFinished Phase = "finished"
)

type Building struct {
	Owner PlayerID `json:"owner"`
	City  bool     `json:"city"`
}

type PlayerState struct {
	Hand            Hand `json:"hand"`
	RoadsLeft       int  `json:"roads_left"`
	SettlementsLeft int  `json:"settlements_left"`
	CitiesLeft      int  `json:"cities_left"`

	DevCards      DevHand `json:"dev_cards"`     // playable
	NewDevCards   DevHand `json:"new_dev_cards"` // bought this turn, locked
	KnightsPlayed int     `json:"knights_played"`
}

// State is a pure fold over the event log. All fields must be reproducible
// from events alone.
type State struct {
	Config GameConfig
	// Seed drives the private stream: randomness whose outcome is hidden
	// (robber steals, dev/progress draws, server auto-moves).
	Seed uint64
	// PublicSeed drives the verifiable stream: dice, the fair-dice deck, the
	// event die, board generation and seat order. Revealing it at game end lets
	// anyone re-derive those outcomes (verify/, docs/dice.md). It is committed
	// when the lobby opens, before the table is known, so an operator cannot
	// shop for a board or seating.
	PublicSeed uint64
	Board      *board.Board

	Players []PlayerState
	Bank    Hand

	Buildings map[board.Vertex]Building
	Roads     map[board.Edge]PlayerID

	Phase Phase
	Cur   PlayerID
	// Setup sub-state.
	SetupRound     int
	NeedRoad       bool
	LastSettlement board.Vertex
	// Play sub-state.
	Rolled          bool
	PendingDiscards map[PlayerID]int
	RobberPending   bool

	// Base-game extras.
	DevDeck           DevHand
	PlayedDevThisTurn bool
	FreeRoads         int // pending road-building roads
	ActiveOffer       *TradeOffer
	LongestRoadHolder PlayerID
	LargestArmyHolder PlayerID

	// TurnsCompleted counts EvTurnEnded events folded so far: the game's length
	// in turns. It gates draw offers and claims (see DrawMinTurns), and is
	// folded from the log so replay reproduces it.
	TurnsCompleted int
	// DrawOffer is the single open offer to end the game in a draw, or nil.
	DrawOffer *DrawOffer
	// DrawOffersUsed lists the seats that have already offered a draw this
	// turn, capping each seat at one offer per turn (see decideOfferDraw).
	// Cleared at EvTurnEnded with the offer itself.
	DrawOffersUsed []PlayerID `json:",omitempty"`

	// Ext holds module-owned state, keyed by module name.
	Ext map[string]Extension

	// RollCount counts production rolls (drives fair-dice deck position).
	RollCount int

	Winner PlayerID
	// FinalVP is every seat's final total as the game-finished event recorded
	// it (GameFinishedData.Scores). Empty until the game ends, and for logs
	// that predate the field.
	FinalVP []int
	NextSeq int
}

// TradeOffer is the single open offer by the current player.
type TradeOffer struct {
	By       PlayerID   `json:"by"`
	Give     Hand       `json:"give"`
	Want     Hand       `json:"want"`
	Accepted []PlayerID `json:"accepted,omitempty"`
	Declined []PlayerID `json:"declined,omitempty"`
	// GiveCom/WantCom are an opaque module payload (Knights commodities); see
	// TradeOfferedData.
	GiveCom json.RawMessage `json:"give_com,omitempty"`
	WantCom json.RawMessage `json:"want_com,omitempty"`
	// Counters are non-active players' alternative terms; the turn-holder may
	// execute against one instead of a plain acceptance.
	Counters []CounterOffer `json:"counters,omitempty"`
}

// CounterOffer is a non-active player's alternative to the standing offer,
// stated from the counter-er's perspective: they give Give and want Want
// (plus opaque module commodities) from the turn-holder.
type CounterOffer struct {
	By      PlayerID        `json:"by"`
	Give    Hand            `json:"give"`
	Want    Hand            `json:"want"`
	GiveCom json.RawMessage `json:"give_com,omitempty"`
	WantCom json.RawMessage `json:"want_com,omitempty"`
}

func (o *TradeOffer) responded(p PlayerID) bool {
	if slices.Contains(o.Accepted, p) {
		return true
	}
	if slices.Contains(o.Declined, p) {
		return true
	}
	for _, c := range o.Counters {
		if c.By == p {
			return true
		}
	}
	return false
}

// clearResponse removes whatever p has said about this offer so far. Every
// revision starts here, so a seat is never listed twice or as both accepter and
// decliner.
func (o *TradeOffer) clearResponse(p PlayerID) {
	o.Accepted = slices.DeleteFunc(o.Accepted, func(q PlayerID) bool { return q == p })
	o.Declined = slices.DeleteFunc(o.Declined, func(q PlayerID) bool { return q == p })
	o.Counters = slices.DeleteFunc(o.Counters, func(c CounterOffer) bool { return c.By == p })
}

// respondedAccept reports p's current answer: whether they have answered at all,
// and if so whether it was an acceptance. A counter counts as answered but not
// as an acceptance (the offerer settles it on the counter's own terms).
func (o *TradeOffer) respondedAccept(p PlayerID) (answered, accept bool) {
	if slices.Contains(o.Accepted, p) {
		return true, true
	}
	return o.responded(p), false
}

// isCounterer reports whether p's answer is a counter-offer.
func (o *TradeOffer) isCounterer(p PlayerID) bool {
	_, ok := o.counterBy(p)
	return ok
}

func (o *TradeOffer) counterBy(p PlayerID) (CounterOffer, bool) {
	for _, c := range o.Counters {
		if c.By == p {
			return c, true
		}
	}
	return CounterOffer{}, false
}

// Responded reports whether p has already accepted, declined, or countered the
// active offer. Exported for the game and bot packages.
func (o *TradeOffer) Responded(p PlayerID) bool { return o.responded(p) }

func (o *TradeOffer) accepted(p PlayerID) bool {
	return slices.Contains(o.Accepted, p)
}

// Clone deep-copies the mutable parts of the state. The board struct is copied
// by value so scalar mutations (the robber's hex) stay local, while its Tiles map
// and Harbors slice are shared: Harbors never changes after generation, and the
// only in-game Tiles mutator (the Knights Inventor swap) copies on write.
func (s *State) Clone() *State {
	c := *s
	if s.Board != nil {
		b := *s.Board
		c.Board = &b
	}
	c.Players = append([]PlayerState(nil), s.Players...)
	c.Buildings = make(map[board.Vertex]Building, len(s.Buildings))
	maps.Copy(c.Buildings, s.Buildings)
	c.Roads = make(map[board.Edge]PlayerID, len(s.Roads))
	maps.Copy(c.Roads, s.Roads)
	// PendingDiscards and Ext are empty for most clones (base games have no
	// Ext; PendingDiscards is set only between a rolled 7 and the discards).
	// Clone is the largest allocator, so skip the empty maps. Their write
	// sites allocate lazily, so a nil map is safe to fold onto.
	if len(s.PendingDiscards) > 0 {
		c.PendingDiscards = make(map[PlayerID]int, len(s.PendingDiscards))
		maps.Copy(c.PendingDiscards, s.PendingDiscards)
	} else {
		c.PendingDiscards = nil
	}
	if s.ActiveOffer != nil {
		o := *s.ActiveOffer
		o.Accepted = append([]PlayerID(nil), s.ActiveOffer.Accepted...)
		o.Declined = append([]PlayerID(nil), s.ActiveOffer.Declined...)
		o.Counters = append([]CounterOffer(nil), s.ActiveOffer.Counters...)
		c.ActiveOffer = &o
	}
	if s.DrawOffer != nil {
		o := *s.DrawOffer
		o.Accepted = append([]PlayerID(nil), s.DrawOffer.Accepted...)
		c.DrawOffer = &o
	}
	c.DrawOffersUsed = append([]PlayerID(nil), s.DrawOffersUsed...)
	c.FinalVP = append([]int(nil), s.FinalVP...)
	switch {
	case len(s.Ext) > 0:
		c.Ext = make(map[string]Extension, len(s.Ext))
		for k, v := range s.Ext {
			c.Ext[k] = v.CloneExt()
		}
	case s.Config.Ruleset == "" || s.Config.Ruleset == "base":
		// Base game never touches Ext: leave it nil and skip the alloc.
		c.Ext = nil
	default:
		// A module ruleset whose ext isn't created yet (early setup). Module ext
		// setters assume a non-nil map, so keep an empty one.
		c.Ext = map[string]Extension{}
	}
	return &c
}

// New creates a game, returning the initial events. Fold them into an empty
// state (or call Replay) to get the playable state.
func New(cfg GameConfig, seeds Seeds) ([]Event, error) {
	mods, err := modulesFor(cfg.Ruleset)
	if err != nil {
		return nil, err
	}
	// Whether the caller named a target, captured before the defaulters fill
	// in a zero. A TargetVPAdjuster moves only the ruleset's default, never a
	// number the host chose.
	namedTarget := cfg.TargetVP != 0
	for _, m := range mods {
		if d, ok := m.(ConfigDefaulter); ok {
			cfg = d.DefaultConfig(cfg)
		}
	}
	cfg = cfg.withDefaults()
	// The additive pass runs after every defaulter and the base default of
	// 10, since a module here moves the settled target. EvGameCreated carries
	// the result, so the increment is applied once, at creation.
	cfg.TargetVP = resolveTargetVP(cfg, mods, namedTarget)
	if cfg.Players < MinPlayers || cfg.Players > MaxPlayers {
		return nil, fmt.Errorf("engine: players must be %d-%d, got %d", MinPlayers, MaxPlayers, cfg.Players)
	}
	var b *board.Board
	if cfg.Board != nil {
		// Custom map inlined into the config: clone so module SetupBoard can
		// shape it without mutating the logged source. Resolve fills any
		// generic-land/blank-number tiles, then add the standard harbors if the
		// builder specified none.
		b = cfg.Board.Clone()
		// Frame rebuilds the ocean from the land before harbors are placed
		// (harbors hug the computed coast). Safe before Resolve since ResLand
		// counts as ground; standard hexagons are unchanged.
		b.Frame()
		rng := rngFor(seeds.Public, 1)
		b.Resolve(rng, cfg.BoardMode)
		b.EnsureHarbors(rng)
	} else if cfg.Preset != "" {
		b, err = board.PresetBoard(cfg.Preset, cfg.Players, rngFor(seeds.Public, 1))
	} else {
		radius := board.RadiusFor(cfg.Players)
		for _, m := range mods {
			if br, ok := m.(BoardRadiuser); ok {
				radius = br.BoardRadius(cfg.Players)
			}
		}
		b, err = board.GenerateRadius(rngFor(seeds.Public, 1), cfg.Players, radius, cfg.BoardMode)
	}
	if err != nil {
		return nil, err
	}
	for _, m := range mods {
		m.SetupBoard(b, cfg, rngFor(seeds.Public, 2))
	}
	// A module that reserves several public slots of its own cannot take
	// them from SetupBoard's single stream, so it gets the seed (see
	// BoardSeeder). Runs after SetupBoard, in ruleset order.
	for _, m := range mods {
		if bs, ok := m.(BoardSeeder); ok {
			bs.SetupBoardSeeded(b, cfg, seeds.Public)
		}
	}
	// Second pass, after every module has reshaped the board: work that
	// depends on the finished board (Caravans' oasis guarantee) cannot go in
	// SetupBoard, whose order is a name sort. See BoardFinisher.
	for _, m := range mods {
		if f, ok := m.(BoardFinisher); ok {
			// Slot 3 unless the module reserved its own: two finishers that draw
			// on every board cannot share a stream. See BoardFinisherSlot.
			f.FinishBoard(b, cfg, rngFor(seeds.Public, finishBoardSeq(m)))
		}
	}
	for _, m := range mods {
		if v, ok := m.(FinishedBoardValidator); ok {
			if err := v.ValidateFinishedBoard(b, cfg); err != nil {
				return nil, err
			}
		}
	}
	// Curated/custom maps must match the ruleset; procedural boards were shaped
	// by the modules themselves.
	if cfg.Preset != "" || cfg.Board != nil {
		if err := ValidateMap(b, cfg.Ruleset); err != nil {
			return nil, err
		}
	}
	// Both seeds are hidden from live viewers (the public seed predicts
	// every future roll, the private one every draw and steal); their
	// commitments are public. Game end reveals both via the unredacted
	// replay. See docs/dice.md.
	created := mustEvent(EvGameCreated, GameCreatedData{
		Config:           cfg,
		Seed:             seeds.Private,
		SeedCommit:       SeedCommitment(seeds.Private),
		PublicSeed:       seeds.Public,
		PublicSeedCommit: SeedCommitment(seeds.Public),
		// Stamped at creation so it cannot be claimed after the fact, as with
		// the seed commitment. See engine.DerivationVersion.
		DerivationVersion: DerivationVersion,
	})
	created.Visible = []PlayerID{}
	extBlobs, err := deriveBoardExt(cfg, b, mods, seeds)
	if err != nil {
		return nil, err
	}
	boardEv := mustEvent(EvBoardGenerated, BoardGeneratedData{Board: b, Ext: extBlobs})
	for _, m := range mods {
		if m.Hooks().MaskBoard != nil {
			// Fog of war: the full board is hidden; viewers get the module's
			// redacted form (engine.RegisterRedactor on EvBoardGenerated).
			boardEv.Visible = []PlayerID{}
		}
	}
	events := []Event{created, boardEv}
	for i := range events {
		events[i].Seq = i
	}
	return events, nil
}

// rngFor derives deterministic randomness from a seed and the event position
// consuming it, so rebuilt states need no RNG cursor. Callers pass s.Seed
// (private) or s.PublicSeed (verifiable); see State.
//
// Frozen: verify/rand.mjs republishes it and every past game is audited against
// it. Reserve a new stream with an unused seq (see seatOrderSeq), never by
// changing the formula.
func rngFor(seed uint64, seq int) *rand.Rand {
	return rand.New(rand.NewPCG(seed, uint64(seq)*0x9e3779b97f4a7c15+1))
}

func Empty() *State {
	return &State{
		Buildings:         map[board.Vertex]Building{},
		Roads:             map[board.Edge]PlayerID{},
		PendingDiscards:   map[PlayerID]int{},
		Ext:               map[string]Extension{},
		Winner:            NoPlayer,
		Cur:               NoPlayer,
		LongestRoadHolder: NoPlayer,
		LargestArmyHolder: NoPlayer,
	}
}

// InitMaps ensures the map fields are non-nil, so a snapshot decoded into a zero
// State (see game.rebuild) cannot hand the fold a nil map (e.g. PendingDiscards
// on a 7). Call after decoding a snapshot.
//
// gob sends an empty non-nil map, and omits a map only when it is nil (empty
// slices are always dropped). A nil map after decode therefore means it was nil
// when written, or the writing binary lacked the field; game.snapshotVersion
// guards the latter.
//
// Decode into a zero State, not Empty(): Empty() sets Cur/Winner/holders to
// NoPlayer (-1), and gob omits zero scalars, so a snapshot taken on player 0's
// turn would reload with no current player.
func (s *State) InitMaps() {
	if s.Buildings == nil {
		s.Buildings = map[board.Vertex]Building{}
	}
	if s.Roads == nil {
		s.Roads = map[board.Edge]PlayerID{}
	}
	if s.PendingDiscards == nil {
		s.PendingDiscards = map[PlayerID]int{}
	}
	if s.Ext == nil {
		s.Ext = map[string]Extension{}
	}
	// Module maps belong to packages this one cannot import, so each module
	// repairs its own (see ExtRestorer).
	for _, x := range s.Ext {
		if r, ok := x.(ExtRestorer); ok {
			r.RestoreExt()
		}
	}
}

func Replay(events []Event) (*State, error) {
	s := Empty()
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// CheckConfigBounds refuses a config whose numbers would size more work than any
// real game.
//
// It bounds the two fields that multiply: the seat count (seat slice, bank, dev
// deck, per-seat module allocations) and an inlined custom map's radius (every
// board consumer walks it; HexesInRadius is (2r+1)^2 and memoized for the
// process). Nothing else in GameConfig sizes an allocation.
//
// Needed because POST /api/replay/frames folds a caller-supplied file, where
// `players: 1e8` would be a 16 GB make() and `board.radius: 1e6` a hang. New and
// Board.ValidateLayout already refuse both at creation, so no log this engine
// wrote fails here. It is a pure function of the event.
func CheckConfigBounds(c GameConfig) error {
	if c.Players < MinPlayers || c.Players > MaxPlayers {
		return fmt.Errorf("engine: game created with %d players, must be %d-%d", c.Players, MinPlayers, MaxPlayers)
	}
	return checkBoardBounds(c.Board)
}

// checkBoardBounds bounds a board arriving in an event by radius, the one
// dimension not already bounded by request size.
//
// board.MaxRadius+1 because Frame pushes a validated custom map one ring out (its
// coastal margin), so a legitimate board can exceed what ValidateLayout accepts by
// one. A nil board is left to the caller.
func checkBoardBounds(b *board.Board) error {
	if b == nil {
		return nil
	}
	if b.Radius < 0 || b.Radius > board.MaxRadius+1 {
		return fmt.Errorf("engine: board radius %d, must be 0-%d", b.Radius, board.MaxRadius+1)
	}
	return nil
}

// Apply folds one event into the state. Events are trusted (they were emitted
// by Decide); a failure here means a corrupt log or an engine bug.
func Apply(s *State, e Event) error {
	if e.Seq != s.NextSeq {
		return fmt.Errorf("engine: event seq %d, state expects %d", e.Seq, s.NextSeq)
	}
	s.NextSeq++

	switch e.Type {
	case EvGameCreated:
		d := decode[GameCreatedData](e)
		s.Config = d.Config
		s.Seed = d.Seed
		// A log written before the seeds were split carries one seed for every
		// stream. Pointing both at it reproduces those games exactly, since
		// rngFor never changed.
		s.PublicSeed = d.PublicSeed
		if d.PublicSeedCommit == "" {
			s.PublicSeed = d.Seed
		}
		// Bounded before anything is sized by it (see CheckConfigBounds); this
		// is where a log the server did not write meets the engine.
		if err := CheckConfigBounds(d.Config); err != nil {
			return err
		}
		s.Players = make([]PlayerState, d.Config.Players)
		for i := range s.Players {
			s.Players[i] = PlayerState{RoadsLeft: MaxRoads, SettlementsLeft: MaxSettlements, CitiesLeft: MaxCities}
		}
		for _, r := range board.Resources {
			s.Bank[r] = BankPerResource(d.Config.Players)
		}
		s.DevDeck = DevDeckFor(d.Config.Players)
		// A module may deal a different deck from the same machinery (Wagons:
		// 16 Knight, 3 Road Building, 3 Victory Point, no Year of Plenty and no
		// Monopoly). Pure in the seat count, so the fold stays deterministic.
		for _, m := range s.Modules() {
			if h := m.Hooks().DevDeck; h != nil {
				if deck, ok := h(d.Config.Players); ok {
					s.DevDeck = deck
				}
			}
		}
		s.Phase = PhaseSetup
		s.Cur = 0
		// Seed module state with a meaningful starting value (a supply count),
		// so it is in client views from event zero. Modules without one are
		// created lazily.
		for _, m := range s.Modules() {
			if init, ok := m.(ExtInitializer); ok {
				if x := init.InitExt(s.Config); x != nil {
					if s.Ext == nil {
						s.Ext = map[string]Extension{}
					}
					s.Ext[m.Name()] = x
				}
			}
		}

	case EvBoardGenerated:
		d := decode[BoardGeneratedData](e)
		// The dealt board's radius, bounded for the same reason as the
		// config's (see CheckConfigBounds).
		if err := checkBoardBounds(d.Board); err != nil {
			return err
		}
		s.Board = d.Board
		// The board half of the seeding above. InitExt runs on EvGameCreated,
		// when s.Board is still nil, so a module whose starting state comes from
		// the board initialises here, after SetupBoard and FinishBoard. Without
		// this, a module that derives without storing never lands in State.Ext or
		// any client view. See ExtBoardInitializer.
		//
		// This assigns, replacing the value InitExt seeded; InitExtBoard is handed
		// s with that value in Ext and returns the completed value if it wants
		// both.
		for _, m := range s.Modules() {
			init, ok := m.(ExtBoardInitializer)
			if !ok {
				continue
			}
			x := init.InitExtBoard(s)
			if x == nil {
				continue
			}
			// The log wins over the derivation: a recorded blob is unmarshalled
			// over the derived value, so a rules-bearing layer (fishing grounds,
			// the oasis) is the one the game was played with. See
			// BoardGeneratedData.Ext. A log without a blob for this module
			// keeps the derived value.
			if raw, ok := d.Ext[m.Name()]; ok {
				if err := json.Unmarshal(raw, x); err != nil {
					return fmt.Errorf("engine: board ext for module %q: %w", m.Name(), err)
				}
			}
			if s.Ext == nil {
				s.Ext = map[string]Extension{}
			}
			s.Ext[m.Name()] = x
		}

	case EvSettlementPlace:
		d := decode[SettlementPlacedData](e)
		s.Buildings[d.V] = Building{Owner: d.Player}
		s.Players[d.Player].SettlementsLeft--
		s.LastSettlement = d.V
		s.NeedRoad = true

	case EvSetupCityPlace:
		// Round-2 setup city (Knights): placed directly from the city supply,
		// so unlike an upgrade it does not return a settlement to the supply.
		d := decode[SettlementPlacedData](e)
		s.Buildings[d.V] = Building{Owner: d.Player, City: true}
		s.Players[d.Player].CitiesLeft--
		s.LastSettlement = d.V
		s.NeedRoad = true

	case EvRoadPlaced:
		d := decode[RoadPlacedData](e)
		s.Roads[d.E] = d.Player
		s.Players[d.Player].RoadsLeft--
		s.NeedRoad = false
		s.advanceSetup()

	case EvSetupAdvanced:
		// A module placed a setup ship in place of the road; advance the draft.
		s.NeedRoad = false
		s.advanceSetup()

	case EvStartingRes:
		d := decode[StartingResData](e)
		s.Players[d.Player].Hand.Add(d.Gain)
		s.Bank.Sub(d.Gain)

	case EvTurnStarted:
		d := decode[TurnStartedData](e)
		s.Cur = d.Player
		s.Rolled = false
		s.PlayedDevThisTurn = false
		s.FreeRoads = 0
		s.ActiveOffer = nil
		// Cards bought last turn unlock.
		p := &s.Players[d.Player]
		for i := range p.NewDevCards {
			p.DevCards[i] += p.NewDevCards[i]
			p.NewDevCards[i] = 0
		}

	case EvDiceRolled:
		d := decode[DiceRolledData](e)
		s.Rolled = true
		s.RollCount++
		if d.D1+d.D2 == 7 && !robberSuppressed(s) {
			s.RobberPending = true
		}

	case EvResDistributed:
		d := decode[ResDistributedData](e)
		for _, g := range d.Gains {
			s.Players[g.Player].Hand.Add(g.Gain)
			s.Bank.Sub(g.Gain)
		}

	case EvDiscardsReq:
		d := decode[DiscardsReqData](e)
		if s.PendingDiscards == nil && len(d.Required) > 0 {
			s.PendingDiscards = make(map[PlayerID]int, len(d.Required))
		}
		for _, r := range d.Required {
			s.PendingDiscards[r.Player] = r.Count
		}

	case EvCardsDiscarded:
		d := decode[CardsDiscardedData](e)
		s.Players[d.Player].Hand.Sub(d.Cards)
		s.Bank.Add(d.Cards)
		delete(s.PendingDiscards, d.Player)

	case EvRobberMoved:
		d := decode[RobberMovedData](e)
		s.Board.Robber = d.Hex
		s.RobberPending = false

	case EvCardStolen:
		d := decode[CardStolenData](e)
		var h Hand
		h[d.Res] = 1
		s.Players[d.Victim].Hand.Sub(h)
		s.Players[d.Thief].Hand.Add(h)

	case EvRoadBuilt:
		d := decode[BuiltData](e)
		s.Roads[*d.E] = d.Player
		s.Players[d.Player].RoadsLeft--
		if d.Free {
			s.FreeRoads--
		} else {
			s.Players[d.Player].Hand.Sub(CostRoad)
			s.Bank.Add(CostRoad)
		}

	case EvSettlementBuilt:
		d := decode[BuiltData](e)
		s.Buildings[*d.V] = Building{Owner: d.Player}
		s.Players[d.Player].SettlementsLeft--
		s.Players[d.Player].Hand.Sub(CostSettlement)
		s.Bank.Add(CostSettlement)

	case EvCityBuilt:
		d := decode[BuiltData](e)
		s.Buildings[*d.V] = Building{Owner: d.Player, City: true}
		s.Players[d.Player].SettlementsLeft++
		s.Players[d.Player].CitiesLeft--
		s.Players[d.Player].Hand.Sub(CostCity)
		s.Bank.Add(CostCity)

	case EvTurnEnded:
		s.ActiveOffer = nil    // open offers die with the turn
		s.DrawOffer = nil      // and so does an unanswered draw offer
		s.DrawOffersUsed = nil // and each seat gets its one offer back
		s.TurnsCompleted++

	case EvBankTraded:
		d := decode[BankTradedData](e)
		s.Players[d.Player].Hand.Sub(d.Give)
		s.Bank.Add(d.Give)
		s.Players[d.Player].Hand.Add(d.Get)
		s.Bank.Sub(d.Get)

	case EvTradeOffered:
		d := decode[TradeOfferedData](e)
		s.ActiveOffer = &TradeOffer{By: d.Player, Give: d.Give, Want: d.Want, GiveCom: d.GiveCom, WantCom: d.WantCom}

	// A response (or a counter, a response with terms) is the seat's latest
	// word: the fold drops what that seat said before and applies the new
	// answer. Older logs never had a second response from a seat, so
	// clearing first replays them unchanged.
	case EvTradeResponded:
		d := decode[TradeRespondedData](e)
		if s.ActiveOffer != nil {
			s.ActiveOffer.clearResponse(d.Player)
			switch {
			case d.Retract: // withdrawn: the seat is back to having said nothing
			case d.Accept:
				s.ActiveOffer.Accepted = append(s.ActiveOffer.Accepted, d.Player)
			default:
				s.ActiveOffer.Declined = append(s.ActiveOffer.Declined, d.Player)
			}
		}

	case EvTradeCountered:
		d := decode[TradeCounteredData](e)
		if s.ActiveOffer != nil {
			s.ActiveOffer.clearResponse(d.Player)
			s.ActiveOffer.Counters = append(s.ActiveOffer.Counters, CounterOffer{
				By: d.Player, Give: d.Give, Want: d.Want, GiveCom: d.GiveCom, WantCom: d.WantCom,
			})
		}

	case EvTradeExecuted:
		d := decode[TradeExecutedData](e)
		s.Players[d.By].Hand.Sub(d.Give)
		s.Players[d.With].Hand.Add(d.Give)
		s.Players[d.With].Hand.Sub(d.Want)
		s.Players[d.By].Hand.Add(d.Want)
		s.ActiveOffer = nil

	case EvTradeCancelled, evTradeCanceledLegacy:
		// evTradeCanceledLegacy keeps replay working for games logged during the
		// window the event type was misspelled (see its doc comment in types.go).
		s.ActiveOffer = nil

	case EvDevCardBought:
		d := decode[DevCardBoughtData](e)
		s.Players[d.Player].NewDevCards[d.Card]++
		s.DevDeck[d.Card]--
		if !d.Free {
			s.Players[d.Player].Hand.Sub(CostDevCard)
			s.Bank.Add(CostDevCard)
		}

	case EvKnightPlayed:
		d := decode[DevPlayedData](e)
		s.Players[d.Player].DevCards[DevKnight]--
		s.Players[d.Player].KnightsPlayed++
		s.PlayedDevThisTurn = true
		s.RobberPending = true

	case EvRoadBuilding:
		d := decode[DevPlayedData](e)
		s.Players[d.Player].DevCards[DevRoadBuilding]--
		s.PlayedDevThisTurn = true
		// Added to any pending credit, not assigned: the Fishermen five-fish
		// road earlier in the turn is the other source, and both must survive
		// (TestFishRoadCreditSurvivesRoadBuilding, engine/scenarios).
		s.FreeRoads = min(s.Players[d.Player].RoadsLeft, s.FreeRoads+2)

	case EvYearOfPlenty:
		d := decode[YearOfPlentyData](e)
		s.Players[d.Player].DevCards[DevYearOfPlenty]--
		s.PlayedDevThisTurn = true
		s.Players[d.Player].Hand.Add(d.Gain)
		s.Bank.Sub(d.Gain)

	case EvMonopoly:
		d := decode[MonopolyData](e)
		s.Players[d.Player].DevCards[DevMonopoly]--
		s.PlayedDevThisTurn = true
		for _, take := range d.Takes {
			var h Hand
			h[d.Res] = take.Count
			s.Players[take.Player].Hand.Sub(h)
			s.Players[d.Player].Hand.Add(h)
		}

	case EvLongestRoad:
		d := decode[TitleData](e)
		s.LongestRoadHolder = d.Holder

	case EvLargestArmy:
		d := decode[TitleData](e)
		s.LargestArmyHolder = d.Holder

	case EvGameFinished:
		d := decode[GameFinishedData](e)
		s.Winner = d.Winner // NoPlayer for a drawn game
		s.FinalVP = append([]int(nil), d.Scores...)
		s.Phase = PhaseFinished
		s.ActiveOffer = nil
		s.DrawOffer = nil

	case EvSurrendered, EvGameClaimed:
		// Pure log records of how the game ended: the EvGameFinished that
		// follows each one carries the state change.

	case EvDrawOffered:
		d := decode[DrawOfferedData](e)
		s.DrawOffer = &DrawOffer{By: d.Player}
		if !drawOfferUsed(s, d.Player) {
			s.DrawOffersUsed = append(s.DrawOffersUsed, d.Player)
		}

	case EvDrawCancelled:
		s.DrawOffer = nil // withdrawn or expired; the seat's offer stays used

	case EvDrawResponded:
		d := decode[DrawRespondedData](e)
		if s.DrawOffer == nil || s.DrawOffer.HasAccepted(d.Player) {
			break
		}
		if d.Accept {
			s.DrawOffer.Accepted = append(s.DrawOffer.Accepted, d.Player)
		} else {
			s.DrawOffer = nil // one refusal ends the offer
		}

	default:
		for _, m := range s.Modules() {
			handled, err := m.Apply(s, e)
			if err != nil {
				return err
			}
			if handled {
				return nil
			}
		}
		return fmt.Errorf("engine: unknown event type %q at seq %d", e.Type, e.Seq)
	}
	return nil
}

func robberSuppressed(s *State) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().NoRobber; h != nil && h(s) {
			return true
		}
	}
	return false
}

// advanceSetup moves the snake draft forward after each placed road.
func (s *State) advanceSetup() {
	n := PlayerID(s.Config.Players)
	if s.SetupRound == 0 {
		if s.Cur+1 < n {
			s.Cur++
			return
		}
		s.SetupRound = 1 // same player goes again, reversed order
		return
	}
	if s.Cur > 0 {
		s.Cur--
		return
	}
	s.Phase = PhasePlay
	s.Cur = 0
	s.Rolled = false
}

// VP returns a player's full victory points, including hidden VP dev cards.
func (s *State) VP(p PlayerID) int {
	vp := s.PublicVP(p)
	vp += s.Players[p].DevCards[DevVictoryPoint] + s.Players[p].NewDevCards[DevVictoryPoint]
	return vp
}

// PublicVP is what opponents can see: buildings and titles, no VP cards.
func (s *State) PublicVP(p PlayerID) int {
	vp := 0
	for _, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		if b.City {
			vp += 2
		} else {
			vp++
		}
	}
	if s.LongestRoadHolder == p {
		vp += 2
	}
	if s.LargestArmyHolder == p {
		vp += 2
	}
	return vp
}

// deriveBoardExt runs every module's InitExtBoard once, on the Decide side, and
// marshals the result so EvBoardGenerated records the board-derived module state
// rather than each replay recomputing it (see BoardGeneratedData.Ext).
//
// The scratch state must match what Apply has at EvBoardGenerated: config, seated
// players, the finished board, Ext with InitExt's values, and both seeds (folded
// from EvGameCreated). A derivation that draws would otherwise get zeros here and
// record a layout for a different board, since the blob is unmarshalled over the
// derived value. Rivers, Wagons and Explorers all draw from the public seed.
//
// Returns nil when no active module derives anything, so a base-game log's
// payload is unchanged.
func deriveBoardExt(cfg GameConfig, b *board.Board, mods []Module, seeds Seeds) (map[string]json.RawMessage, error) {
	s := Empty()
	s.Config = cfg
	s.Board = b
	// The seeds: see the doc comment.
	s.Seed = seeds.Private
	s.PublicSeed = seeds.Public
	s.Players = make([]PlayerState, cfg.Players)
	for i := range s.Players {
		s.Players[i] = PlayerState{RoadsLeft: MaxRoads, SettlementsLeft: MaxSettlements, CitiesLeft: MaxCities}
	}
	for _, m := range mods {
		if init, ok := m.(ExtInitializer); ok {
			if x := init.InitExt(cfg); x != nil {
				s.Ext[m.Name()] = x
			}
		}
	}
	var out map[string]json.RawMessage
	for _, m := range mods {
		init, ok := m.(ExtBoardInitializer)
		if !ok {
			continue
		}
		x := init.InitExtBoard(s)
		if x == nil {
			continue
		}
		raw, err := json.Marshal(x)
		if err != nil {
			return nil, fmt.Errorf("engine: recording board ext for module %q: %w", m.Name(), err)
		}
		// Stored as it goes, as Apply does, so a module that reads an earlier
		// module's board ext (Wagons asking Raiders where its castle is) sees
		// the same thing here as on the fold.
		s.Ext[m.Name()] = x
		if out == nil {
			out = map[string]json.RawMessage{}
		}
		out[m.Name()] = raw
	}
	return out, nil
}
