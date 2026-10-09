// Package cak implements the Knights expansion as an engine module: the event
// die, commodities, city improvements, knights, the barbarian fleet,
// metropolises, city walls, and progress cards.
package knights

import (
	"encoding/gob"
	"encoding/json"
	"maps"
	"math/rand/v2"
	"slices"
	"strings"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

const Name = "cak"

// explorersName is the Explorers module's registered name, and
// explorersPairingBonus is what the combination rules add to that scenario's
// target (cities, metropolises, the Defender title): 17 + 5 = 22 for
// `cak+explorers`. A literal rather than an import so modules stay independent;
// TestModuleNamesMatch pins it.
const (
	explorersName         = "explorers"
	explorersPairingBonus = 5
)

// rulesetHas reports whether the ruleset string names a module.
func rulesetHas(ruleset, name string) bool {
	return slices.Contains(strings.Split(ruleset, "+"), name)
}

// noRobber reports whether this ruleset has no robber at all, which differs
// from robberLocked (a robber out of play until the first landfall). The Bishop
// needs it under cak+explorers rule H. Keyed on the ruleset because this module
// sets the engine's NoRobber hook itself. Raiders removes the Bishop from the
// deck instead (freshDecks).
func noRobber(s *engine.State) bool {
	return rulesetHas(s.Config.Ruleset, explorersName)
}

// Commodity indexes commodity hands.
type Commodity int8

const (
	Cloth Commodity = iota // from pasture (sheep) cities
	Paper                  // from forest (wood) cities
	Coin                   // from mountain (ore) cities
	commodityKinds
)

type CommodityHand [commodityKinds]int

func (h CommodityHand) Count() int { return h[Cloth] + h[Paper] + h[Coin] }

func (h CommodityHand) nonNegative() bool {
	for i := range h {
		if h[i] < 0 {
			return false
		}
	}
	return true
}

func (h CommodityHand) Has(o CommodityHand) bool {
	for i := range h {
		if h[i] < o[i] {
			return false
		}
	}
	return true
}

func (h *CommodityHand) Add(o CommodityHand) {
	for i := range h {
		h[i] += o[i]
	}
}

func (h *CommodityHand) Sub(o CommodityHand) {
	for i := range h {
		h[i] -= o[i]
	}
}

// CommodityPerType is the size of one commodity stack in the shared supply.
// Commodities are finite like resources: 12 cloth, 12 paper and 12 coin, and
// cards discarded over the hand limit go back to their stacks. Each player
// bracket adds 6 per stack (as the bank adds 5); brackets past 6 extrapolate
// the same step, like engine.BankPerResource and engine.DevDeckFor.
func CommodityPerType(players int) int {
	return 12 + 6*engine.ScaleBracket(players)
}

// commodityFor maps producing terrain to its commodity (cities only).
func commodityFor(r board.Resource) (Commodity, bool) {
	switch r {
	case board.Sheep:
		return Cloth, true
	case board.Wood:
		return Paper, true
	case board.Ore:
		return Coin, true
	default:
		return 0, false
	}
}

// Track indexes the three city-improvement disciplines.
type Track int8

const (
	Trade    Track = iota // cloth
	Politics              // coin
	Science               // paper
	trackKinds
)

// commodityForTrack is the improvement currency per discipline.
func commodityForTrack(t Track) Commodity {
	switch t {
	case Trade:
		return Cloth
	case Politics:
		return Coin
	default:
		return Paper
	}
}

const (
	maxImprovement   = 5
	metropolisLevel  = 4
	metropolisVP     = 2
	maxKnightLevel   = 3
	defaultTargetVP  = 13
	barbarianTrack   = 7 // default ship advances from start to attack
	progressHandSize = 4

	// minBarbarianDistance/maxBarbarianDistance bound a configurable fleet track:
	// shorter than 4 is punishingly fast, longer than 12 effectively never lands.
	minBarbarianDistance = 4
	maxBarbarianDistance = 12
)

// Config is the module's slice of GameConfig.Modules["cak"].
type Config struct {
	// SkipFirstBarbarianAttack ignores the fleet's first landfall (a house option).
	SkipFirstBarbarianAttack bool `json:"skip_first_barbarian_attack"`
	// BarbarianDistance overrides the number of ship advances before the fleet
	// attacks. Values outside [minBarbarianDistance, maxBarbarianDistance] fall
	// back to the default barbarianTrack.
	BarbarianDistance int `json:"barbarian_distance"`
}

// barbarianDistance is the configured attack threshold, clamped to a sane band
// and otherwise defaulting to the standard track length.
func (c Config) barbarianDistance() int {
	if c.BarbarianDistance >= minBarbarianDistance && c.BarbarianDistance <= maxBarbarianDistance {
		return c.BarbarianDistance
	}
	return barbarianTrack
}

func configFrom(cfg engine.GameConfig) Config {
	var c Config
	if raw, ok := cfg.Modules[Name]; ok {
		if err := json.Unmarshal(raw, &c); err != nil {
			return Config{}
		}
	}
	return c
}

// Knight is an active/inactive knight piece on a vertex.
type Knight struct {
	Owner  engine.PlayerID `json:"owner"`
	Level  int             `json:"level"` // 1 basic, 2 strong, 3 mighty
	Active bool            `json:"active"`
	// ActedTurn guards "cannot act the turn it was activated".
	FreshlyActivated bool `json:"freshly_activated"`
	// PromotedThisTurn is the promotion cap: once per turn per knight, so two
	// knights may both be promoted in one turn but one knight cannot go
	// 1 -> 2 -> 3. It lives on the knight because moves and displacements copy the
	// struct to the new vertex. Cleared at the knights refresh.
	PromotedThisTurn bool `json:"promoted_this_turn"`
}

// PlayerExt is per-player module state. Progress cards play the turn they
// are drawn (the Knights rules), so no per-turn lock is needed.
type PlayerExt struct {
	Commodities CommodityHand    `json:"commodities"`
	Improve     [trackKinds]int  `json:"improve"`
	Progress    []ProgressCard   `json:"progress"` // hidden hand
	Metropolis  [trackKinds]bool `json:"metropolis"`
	// MetropolisAt records which vertex holds each metropolis. Only meaningful
	// when Metropolis[t] is true; it ties the metropolis VP to a real city so a
	// barbarian pillage cannot downgrade the metropolis city out from under it.
	MetropolisAt [trackKinds]board.Vertex `json:"metropolis_at"`
	Walls        int                      `json:"walls"`
	DefenderVP   int                      `json:"defender_vp"`
	MerchantVP   int                      `json:"merchant_vp"` // 1 while holding the merchant
	ExtraVP      int                      `json:"extra_vp"`    // Constitution / Printer
	// LaidCities lists every city of this player lying on its side: pillaged with
	// no settlement piece in supply, so it stays and counts as a settlement until
	// upgraded again. Ordered by raze, so the pin is the oldest. A slice because
	// two razes at the settlement cap can happen. A laid city is a city piece
	// standing in for a settlement, so settlement conservation reads
	// onBoard - laid + SettlementsLeft == MaxSettlements.
	LaidCities []board.Vertex `json:"laid_cities,omitempty"`
	// LaidCity/LaidCityActive publish the pin (the vertex the next city upgrade
	// must target) as a projection of LaidCities, refreshed by syncLaidPin. The
	// client reads these, and older logs set exactly these two. mustUpgradeFirst
	// recomputes the pin from LaidCities and is the authority.
	LaidCity       board.Vertex `json:"laid_city"`
	LaidCityActive bool         `json:"laid_city_active"`
}

// Ext is the module state, stored in State.Ext[Name].
type Ext struct {
	Players []PlayerExt
	Knights map[board.Vertex]Knight

	// CommoditySupply is the shared stack of each commodity still available, the
	// commodity counterpart of engine.State.Bank (core Hand has no room for
	// commodities). Production and supply trades draw from it; improvements,
	// discards and the spend side of supply trades return to it. Player-to-player
	// trades never touch it. It can be negative in games logged before this field
	// existed (commodities were unlimited then), so the fold does not assert on
	// it; the non-negative checks live on the Decide path.
	CommoditySupply CommodityHand

	Barbarians  int // steps advanced toward the coast
	Attacks     int // completed attacks
	AlchemistD1 int // pending fixed dice (0 = none)
	AlchemistD2 int

	Decks DeckCounts // remaining cards per discipline, shuffled
	// Under is each deck's bottom, in the order cards were put there: every played
	// or discarded card goes under its deck and cannot be drawn until the shuffled
	// part (Decks) is exhausted. Draws take the shuffled part first, at random,
	// then this queue from the front.
	Under         [trackKinds][]ProgressCard
	Merchant      *board.Hex // merchant token hex
	MerchantOwner engine.PlayerID

	// Interactive pending states.
	PendingGive map[engine.PlayerID]int // Wedding: cards owed to claimant
	WeddingTo   engine.PlayerID

	// Commercial Harbor: opponents who must each return a commodity of their
	// choice, mapped to the resource the taker offers them.
	HarborGive  map[engine.PlayerID]board.Resource
	HarborTaker engine.PlayerID

	// Fleet holds each player's turn-scoped Merchant Fleet good as resource+1
	// (0 = inactive); 2:1 bank trades until the turn ends.
	Fleet []board.Resource
	// ComFleet is the commodity counterpart of Fleet: commodity+1 (0 = inactive)
	// when a player's Merchant Fleet named a commodity instead of a resource.
	ComFleet []int

	// Walled is the set of city vertices that carry a wall, per vertex so a pillage
	// removes the right wall (and its +2 discard bonus); the per-player Walls count
	// stays in sync.
	Walled map[board.Vertex]bool

	// Aqueduct lists players (Science L3) owed a free bank resource because a
	// production roll yielded them nothing; each picks one resource of choice.
	Aqueduct []engine.PlayerID

	// Spy: while SpyThief != NoPlayer, that player is looking at SpyVictim's
	// progress hand and must choose one card to steal (the Spy looks, then picks).
	SpyThief  engine.PlayerID
	SpyVictim engine.PlayerID

	// Master Merchant: while MMThief != NoPlayer, that player is looking at
	// MMVictim's combined resource+commodity hand and must choose up to 2 cards to
	// take.
	MMThief  engine.PlayerID
	MMVictim engine.PlayerID

	// Deserter: a two-step interaction. DeserterVictim chooses which knight to
	// surrender, then DeserterTaker owes a replacement of up to DeserterLevel
	// strength on a vacant intersection of their roads. NoPlayer / 0 mean nothing
	// pending. DeserterActive carries the surrendered knight's status to the
	// replacement.
	DeserterVictim engine.PlayerID
	DeserterTaker  engine.PlayerID
	DeserterLevel  int
	DeserterActive bool

	// A displaced knight is relocated by its owner: while RelocPlayer != NoPlayer
	// that player must move the displaced (RelocLevel/RelocActive) knight to an
	// empty intersection reachable along their routes from RelocFrom.
	RelocPlayer engine.PlayerID
	RelocFrom   board.Vertex
	RelocLevel  int
	RelocActive bool
	// RelocPromoted carries the displaced knight's PromotedThisTurn across the
	// displacement so relocating it cannot grant a second promotion this turn.
	RelocPromoted bool

	// DefenderDraws queues the tied strongest defenders (in turn order from the
	// current player) who each owe a progress-card draw from a deck of their
	// choice after a tied defended barbarian win. Drained via CmdDefenderDraw.
	DefenderDraws []engine.PlayerID

	// PendingDowngrade lists the players who lost the barbarian defense and must
	// each choose which city is razed. Only players with two or more
	// non-metropolis cities land here; a single one is resolved by the attack
	// event. Seats resolve independently via CmdBarbarianDowngrade.
	PendingDowngrade []engine.PlayerID

	// MetropolisPending is a metropolis earned but not yet placed: the player names
	// the receiving city with CmdMetropolisPick. Nil when nothing is pending. Only
	// used with two or more eligible cities. A pointer because Ext is gob-encoded
	// into snapshots and gob omits zero values: an old snapshot decodes as nil
	// ("nothing pending"), where a seat field would read as "player 0 owes a pick".
	MetropolisPending *MetropolisPick
}

// MetropolisPick is a metropolis waiting on its owner to name the city that will
// hold it. Prev is the player it is taken from (NoPlayer when unclaimed), so
// the eventual EvMetropolis records the same transfer.
type MetropolisPick struct {
	Player engine.PlayerID `json:"player"`
	Track  Track           `json:"track"`
	Prev   engine.PlayerID `json:"prev"`
}

// CloneExt deep-copies the module state. Decide runs against a clone, so a
// field lost in the copy reads as its zero value to every validator while the
// live state keeps the real one.
//
// The clone starts as a shallow struct copy, which carries every value field
// automatically. Every map, slice and pointer then gets its own storage, so a
// speculative write during a rejected command cannot reach the live game.
// TestCloneExtCarriesEveryField (engine/ruletest) fills every field by
// reflection and fails on a field that is lost or shared.
func (e *Ext) CloneExt() engine.Extension {
	c := *e

	// Players is a slice of structs that hold slices, so copying the outer slice
	// alone would share every progress hand.
	c.Players = append([]PlayerExt(nil), e.Players...)
	for i := range c.Players {
		c.Players[i].Progress = append([]ProgressCard(nil), e.Players[i].Progress...)
		c.Players[i].LaidCities = append([]board.Vertex(nil), e.Players[i].LaidCities...)
	}
	c.Fleet = append([]board.Resource(nil), e.Fleet...)
	c.ComFleet = append([]int(nil), e.ComFleet...)
	c.Aqueduct = append([]engine.PlayerID(nil), e.Aqueduct...)
	c.DefenderDraws = append([]engine.PlayerID(nil), e.DefenderDraws...)
	c.PendingDowngrade = append([]engine.PlayerID(nil), e.PendingDowngrade...)

	c.Knights = maps.Clone(e.Knights)
	c.PendingGive = maps.Clone(e.PendingGive)
	c.HarborGive = maps.Clone(e.HarborGive)
	c.Walled = maps.Clone(e.Walled)

	// Decks is an array of maps: the array is copied, the maps are still shared.
	for t := range e.Decks {
		c.Decks[t] = maps.Clone(e.Decks[t])
	}
	for t := range e.Under {
		c.Under[t] = append([]ProgressCard(nil), e.Under[t]...)
	}

	// Pointers: copy the pointee, so a rejected command cannot edit the live
	// merchant position or pending metropolis.
	if e.Merchant != nil {
		m := *e.Merchant
		c.Merchant = &m
	}
	if e.MetropolisPending != nil {
		mp := *e.MetropolisPending
		c.MetropolisPending = &mp
	}
	return &c
}

func freshExt(players int, ruleset string) *Ext {
	perType := CommodityPerType(players)
	return &Ext{
		Players:         make([]PlayerExt, players),
		Knights:         map[board.Vertex]Knight{},
		Decks:           freshDecks(ruleset),
		CommoditySupply: CommodityHand{perType, perType, perType},
		MerchantOwner:   engine.NoPlayer,
		WeddingTo:       engine.NoPlayer,
		PendingGive:     map[engine.PlayerID]int{},
		HarborGive:      map[engine.PlayerID]board.Resource{},
		HarborTaker:     engine.NoPlayer,
		Fleet:           make([]board.Resource, players),
		ComFleet:        make([]int, players),
		Walled:          map[board.Vertex]bool{},
		RelocPlayer:     engine.NoPlayer,
		SpyThief:        engine.NoPlayer,
		SpyVictim:       engine.NoPlayer,
		MMThief:         engine.NoPlayer,
		MMVictim:        engine.NoPlayer,
		DeserterVictim:  engine.NoPlayer,
		DeserterTaker:   engine.NoPlayer,
	}
}

// RestoreExt reallocates the maps the fold writes to after a snapshot decode
// left them nil (see engine.ExtRestorer). Apply assigns into every one of
// these maps. Decks is only read, so a nil deck reads as empty; the fix for
// that is discarding the snapshot (game.snapshotVersion). This must only fill
// in what is missing, since events are replayed on top straight after.
func (e *Ext) RestoreExt() {
	if e.Knights == nil {
		e.Knights = map[board.Vertex]Knight{}
	}
	if e.PendingGive == nil {
		e.PendingGive = map[engine.PlayerID]int{}
	}
	if e.HarborGive == nil {
		e.HarborGive = map[engine.PlayerID]board.Resource{}
	}
	if e.Walled == nil {
		e.Walled = map[board.Vertex]bool{}
	}
}

// Module is the Knights ruleset module.
type Module struct{}

// InitExt seeds the module state at game creation so full commodity stacks are
// in every client view from the first frame. See engine.ExtInitializer.
func (Module) InitExt(cfg engine.GameConfig) engine.Extension {
	return freshExt(cfg.Players, cfg.Ruleset)
}

// ext is the fold-path accessor (creates and stores); extRO never stores.
func ext(s *engine.State) *Ext {
	if e, ok := s.Ext[Name].(*Ext); ok {
		return e
	}
	e := freshExt(len(s.Players), s.Config.Ruleset)
	s.Ext[Name] = e
	return e
}

func extRO(s *engine.State) *Ext {
	if e, ok := s.Ext[Name].(*Ext); ok {
		return e
	}
	return freshExt(len(s.Players), s.Config.Ruleset)
}

func (Module) Name() string { return Name }

// MaxVPWithoutCards reports Knights' board-independent VP a single player can
// hold without a VP card: one metropolis per track plus the merchant.
func (Module) MaxVPWithoutCards(cfg engine.GameConfig) int {
	return int(trackKinds)*metropolisVP + 1 /*merchant token*/
}

// SetupBoard: Knights plays on standard boards; nothing to reshape.
func (Module) SetupBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {}

func init() {
	engine.RegisterModule(Name, func() engine.Module { return Module{} })
	gob.Register(&Ext{})
	// A knight occupies an intersection, so placing, moving, displacing,
	// relocating or removing one can change longest road, as can a Diplomat road
	// relocation. Mark these events as route-affecting.
	for _, t := range []engine.EventType{
		EvKnightBuilt, EvKnightMoved, EvKnightRemoved, EvKnightDisplaced,
		EvKnightRelocated, EvRoadRelocated,
	} {
		engine.RegisterRouteEvent(t)
	}
}

// sortedPlayers gives deterministic iteration over a player-keyed map.
func sortedPlayers[T any](m map[engine.PlayerID]T) []engine.PlayerID {
	out := make([]engine.PlayerID, 0, len(m))
	for p := range m {
		out = append(out, p)
	}
	slices.Sort(out)
	return out
}
