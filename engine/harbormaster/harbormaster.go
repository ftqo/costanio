// Package harbormaster implements the Harbormaster variant: one special card
// worth 2 victory points, awarded to whoever has the most victory points in
// buildings standing on harbours, and one extra point on the victory target
// while the module is in the ruleset.
//
// It adds no hex, piece, cost, command or randomness, so it implements no
// SetupBoard, BoardFinisher, BoardRadiuser or TerrainRequirer. It is a derived
// counter, a title event, a VictoryCheck and an additive target.
//
// See docs/rules/harbormaster.md.
package harbormaster

import (
	"encoding/gob"
	"math/rand/v2"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Name is the ruleset part this module answers to.
const Name = "harbormaster"

// EvStandings is the module's only event: the harbour-point standings and who
// holds the card, restated whenever either changes.
//
// It carries the counts as well as the holder. The counts are a pure function
// of the board and buildings and the engine never trusts a stored copy, but
// ViewExt gets no State, so the ext must store them for the client to see them.
// deriveStandings recomputes from scratch on every batch and emits when the
// stored copy differs; TestStoredStandingsMatchDerivation checks the
// two agree.
const EvStandings engine.EventType = "harbormaster_standings"

const (
	// Threshold is the harbour-point total a player needs before the card
	// enters play. It stays 3 at every player count and board size: above it
	// the card goes to whoever leads, so raising it would only delay the card's
	// first appearance.
	Threshold = 3
	// CardVP is what the card is worth to its holder, public like Longest
	// Road's.
	CardVP = 2
	// TargetVPBonus is what the module adds to the victory target, for the
	// whole game, regardless of whether anyone holds the card.
	TargetVPBonus = 1
	// MinHarbours is the fewest harbours an authored map may carry under this
	// module. One harbour holds one building (its two vertices are adjacent),
	// worth at most 2 points as a city, so Threshold is out of reach below two
	// and the card could never enter play while the +1 target still applied.
	MinHarbours = 2
)

// MapIssueNeedsHarbours is the eligibility Issue code for a map with too few
// harbours; see engine.MapIssueNeedsHarbours.
const MapIssueNeedsHarbours = engine.MapIssueNeedsHarbours

func init() {
	engine.RegisterModule(Name, func() engine.Module { return Module{} })
	gob.Register(&Ext{})
}

// Ext is the module's state: who holds the card, and the harbour-point total
// each seat had when that was last restated.
type Ext struct {
	// Holder is the seat holding the card, or engine.NoPlayer when nobody does.
	Holder engine.PlayerID `json:"holder"`
	// Points is every seat's harbour points, indexed by seat. Derived, stored
	// only so a view can publish it (see EvStandings).
	Points []int `json:"points"`
}

// CloneExt deep-copies the ext. Points is a slice, so a shallow copy would hand
// a speculative Decide a window onto the live game's numbers.
func (x *Ext) CloneExt() engine.Extension {
	c := *x
	c.Points = slices.Clone(x.Points)
	return &c
}

// RestoreExt repairs a snapshot-decoded ext. gob drops an empty slice, so
// Points may come back nil; every reader tolerates a short slice, so it stays
// nil rather than guessing a seat count. Holder needs no repair: NoPlayer (-1)
// is not the zero value so gob encodes it, and a stored 0 is a real seat.
func (x *Ext) RestoreExt() {}

// ViewExt is the per-viewer view. Everything is public (the holder and every
// seat's harbour points, like Longest Road), so it ignores the viewer.
//
// Points is still cloned because the view is serialized later on another
// goroutine while the actor folds the next command. See engine.Viewable.
func (x *Ext) ViewExt(engine.PlayerID) any {
	return &ExtView{Holder: x.Holder, Points: slices.Clone(x.Points), Threshold: Threshold}
}

// ExtView is the wire shape of the ext.
type ExtView struct {
	Holder engine.PlayerID `json:"holder"`
	Points []int           `json:"points"`
	// Threshold is published so the client can render "2 of 3" without
	// hard-coding a rules constant on the far side of the wire.
	Threshold int `json:"threshold"`
}

// Module is the Harbormaster plug-in.
type Module struct{}

// MapIssues refuses an authored map carrying exactly one harbour (0 < n <
// MinHarbours), where the card could never be won. Zero is fine: engine.New
// deals a harbourless authored map a coastline-scaled set (board.EnsureHarbors)
// before any module reads it, and the lobby validates the map as authored,
// before that. See engine.MapChecker.
func (Module) MapIssues(b *board.Board) []board.Issue {
	n := len(b.Harbors)
	if n == 0 || n >= MinHarbours {
		return nil
	}
	return []board.Issue{{
		Severity: "error",
		Code:     MapIssueNeedsHarbours,
		Params:   map[string]any{"module": Name, "min": MinHarbours},
		Debug:    "Harbormaster needs a map with at least 2 harbours.",
		Hexes:    []board.Hex{},
	}}
}

func (Module) Name() string { return Name }

// SetupBoard does nothing: the base generator places harbours on every board,
// and a curated map with none gets a coastline-scaled set from
// board.EnsureHarbors before play.
func (Module) SetupBoard(*board.Board, engine.GameConfig, *rand.Rand) {}

// Decide handles no commands: the card is awarded by a comparison the engine
// re-derives, and is never bought, played or traded.
func (Module) Decide(*engine.State, engine.Command) ([]engine.Event, bool, error) {
	return nil, false, nil
}

// InitExt seeds the ext at game creation so every seat's harbour-point readout
// is in the view from event zero. Zero is the true starting value (no buildings
// yet).
//
// Not InitExtBoard: nothing here is derived from the board.
func (Module) InitExt(cfg engine.GameConfig) engine.Extension {
	return &Ext{Holder: engine.NoPlayer, Points: make([]int, cfg.Players)}
}

// Apply folds the module's own event.
func (Module) Apply(s *engine.State, e engine.Event) (bool, error) {
	if e.Type != EvStandings {
		return false, nil
	}
	d := engine.DecodeEvent[StandingsData](e)
	x := ext(s)
	x.Holder = d.Holder
	x.Points = slices.Clone(d.Points)
	setExt(s, x)
	return true, nil
}

// StandingsData is EvStandings' payload: the whole standing, restated. Public,
// so no redactor is registered for it.
type StandingsData struct {
	Holder engine.PlayerID `json:"holder"`
	Points []int           `json:"points"`
	// Prev is who held the card before this event, so an event-log row can say
	// "took the Harbormaster from X" without folding the whole log to find out.
	// NoPlayer when nobody did.
	Prev engine.PlayerID `json:"prev"`
}

func (Module) Hooks() engine.Hooks {
	return engine.Hooks{
		// AfterEvents rather than OnEvents: the standings depend on what every
		// module did in the batch, and "harbormaster" sorts before "raiders",
		// whose conquests remove a building's value. See
		// engine.Hooks.AfterEvents.
		AfterEvents:  afterEvents,
		VictoryCheck: victory,
	}
}

// victory is the card's 2 points. Public VP, like Longest Road's: it is visible
// to every seat and belongs in the public total the lobby and the
// claim-against-bots comparison use.
func victory(s *engine.State, p engine.PlayerID) int {
	if Holder(s) == p {
		return CardVP
	}
	return 0
}

// MaxVPWithoutCards is the module's contribution to the highest winnable
// target: the card, which is transferable and reachable without ever drawing a
// development card. See engine.VPCeiler.
func (Module) MaxVPWithoutCards(engine.GameConfig) int { return CardVP }

// AdjustTargetVP adds the module's point to the victory target. Unconditional
// and relative: base becomes 11, Knights 14, Caravans 13, Fishermen 11 (12 for
// whoever holds the old boot, whose own +1 stacks on top through
// WinThresholdDelta), Islands 11. See engine.TargetVPAdjuster.
func (Module) AdjustTargetVP(engine.GameConfig) int { return TargetVPBonus }

// HarborPoints is player p's harbour points: 1 for each of their settlements
// and 2 for each city on a harbour vertex, 0 for everything else.
//
// A building's value is its own victory-point value. Roads, ships, knights, the
// Knights Merchant token, an Islands ship on a harbour's sea edge and a
// building one vertex away are worth nothing.
//
// Counted per building, not per harbour: a building is worth 1 or 2 however
// many harbours its vertex belongs to. Our generator never lets harbours share
// a vertex (placeHarbors reserves both vertices), so this only matters on a
// curated map with overlapping harbours.
//
// A building whose harbour is unusable contributes 0: a Raiders-enclosed
// building scores no VP and cannot use its harbour. Asked through
// engine.State.BuildingVPSuppressed so this package imports no other module.
func HarborPoints(s *engine.State, p engine.PlayerID) int {
	if s == nil || int(p) < 0 || int(p) >= len(s.Players) {
		return 0
	}
	return allPoints(s)[p]
}

// allPoints is the derivation: every seat's harbour points in one walk over the
// buildings.
//
// One walk rather than one per seat, because this runs on every command batch,
// including the many the bot's DecideForEval folds. A vertex-to-harbour set was
// slower in practice: the harbour list is 9 to 15 entries and building the map
// allocates.
func allPoints(s *engine.State) []int {
	out := make([]int, len(s.Players))
	if s.Board == nil {
		return out
	}
	for v, b := range s.Buildings {
		if int(b.Owner) < 0 || int(b.Owner) >= len(out) {
			continue
		}
		// A building on a harbour vertex is worth 1 or 2 however many harbours
		// claim the vertex.
		if _, ok := s.Board.HarborAt(v); !ok {
			continue
		}
		if s.BuildingVPSuppressed(v) {
			continue
		}
		// A city is 2, a settlement 1, including a Knights city laid on its
		// side (recorded as City:false, so worth 1 until upgraded again). A
		// metropolis is a separate 2-VP award on a city; the building is still
		// a city and worth 2 here.
		if b.City {
			out[b.Owner] += 2
		} else {
			out[b.Owner]++
		}
	}
	return out
}

// Holder is the seat holding the card right now, or engine.NoPlayer.
func Holder(s *engine.State) engine.PlayerID {
	x, ok := extRO(s)
	if !ok {
		return engine.NoPlayer
	}
	return x.Holder
}

// Points is every seat's harbour points as last recorded, sized to the table.
// Derived state, published for views; HarborPoints is the derivation itself.
func Points(s *engine.State) []int {
	out := make([]int, len(s.Players))
	x, ok := extRO(s)
	if !ok {
		return out
	}
	copy(out, x.Points)
	return out
}

// deriveHolder is the card's whole rule, stated declaratively.
//
// Let top be the greatest harbour-point total at the table:
//
//  1. top < Threshold: nobody holds the card.
//  2. exactly one player has top, and top >= Threshold: that player holds it.
//  3. two or more tie at top >= Threshold: the current holder keeps it if they
//     are one of the tied players, and otherwise nobody holds it.
//
// This is the base Longest Road rule with 3 harbour points in place of 5 road
// segments: the first to reach 3 takes it, and it moves only to a player with
// strictly more.
//
// Rule 1 also removes the card from a holder who drops below the threshold even
// with no opponent ahead; the threshold is a qualification for holding the
// title, as Longest Road treats it. Only Knights or Raiders can take a
// building's value away.
//
// Rule 3 leaves the card unheld when a tie at top arises from a loss (e.g. a
// barbarian attack hits the holder); no tie-break is invented, as with Longest
// Road after a break.
func deriveHolder(points []int, current engine.PlayerID) engine.PlayerID {
	top, leader, tied := 0, engine.NoPlayer, false
	for seat, n := range points {
		switch {
		case n > top:
			top, leader, tied = n, engine.PlayerID(seat), false
		case n == top && leader != engine.NoPlayer:
			tied = true
		}
	}
	if top < Threshold || leader == engine.NoPlayer {
		return engine.NoPlayer
	}
	if !tied {
		return leader
	}
	// Tied at the top. The current holder keeps it if they are one of them.
	if current != engine.NoPlayer && int(current) < len(points) && points[current] == top {
		return current
	}
	return engine.NoPlayer
}

// afterEvents re-derives the standings on the finished batch and restates them
// when they have moved.
//
// It runs on every batch rather than on a list of event types: settlement
// builds, city upgrades, setup placements, Knights downgrades, Knights cities
// laid on their side, Raiders conquests and liberations all matter, and some
// come from modules this package does not import. Re-deriving is one walk of
// the buildings.
//
// The transfer takes effect in the same batch, so a player who takes the card
// by upgrading has its 2 VP for the same turn's win check, and a barbarian
// attack can move the card on another player's turn.
func afterEvents(after *engine.State, _ []engine.Event) []engine.Event {
	if after.Board == nil {
		return nil
	}
	points := allPoints(after)
	prev := Holder(after)
	holder := deriveHolder(points, prev)
	if x, ok := extRO(after); ok && x.Holder == holder && slices.Equal(x.Points, points) {
		return nil
	}
	return []engine.Event{engine.NewEvent(EvStandings, StandingsData{Holder: holder, Points: points, Prev: prev})}
}

// ext returns a writable copy of the module's ext for the fold, creating one if
// the state has none.
func ext(s *engine.State) *Ext {
	if x, ok := extRO(s); ok {
		if c, ok := x.CloneExt().(*Ext); ok {
			return c
		}
	}
	return &Ext{Holder: engine.NoPlayer, Points: make([]int, len(s.Players))}
}

func setExt(s *engine.State, x *Ext) {
	if s.Ext == nil {
		s.Ext = map[string]engine.Extension{}
	}
	s.Ext[Name] = x
}

// extRO returns the live ext without copying it. Read-only: callers must not
// write through it.
func extRO(s *engine.State) (*Ext, bool) {
	if s == nil {
		return nil, false
	}
	x, ok := s.Ext[Name].(*Ext)
	return x, ok
}

// StateExt exposes the live ext to the layers outside the engine that render it
// (views, bots, the replay folder). Read-only.
func StateExt(s *engine.State) (*Ext, bool) { return extRO(s) }
