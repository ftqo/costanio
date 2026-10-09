package explorers

import (
	"encoding/json"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// RevealedView is one pool hex somebody has looked at. Everything on it is
// public from the moment it was revealed.
type RevealedView struct {
	H       board.Hex `json:"h"`
	Region  int       `json:"region"`
	Kind    Special   `json:"kind"`
	Shoal   int       `json:"shoal,omitempty"`
	Village Village   `json:"village,omitempty"`
	// Captured, Crews, Sacks and Farmers describe what stands on the hex now: the
	// crews on an uncaptured lair, and which seats have befriended a farm.
	Captured bool   `json:"captured,omitempty"`
	Crews    []int  `json:"crews,omitempty"`
	Farmers  []bool `json:"farmers,omitempty"`
}

// HarbourView is one harbour settlement and what its basin holds.
type HarbourView struct {
	V     board.Vertex    `json:"v"`
	Owner engine.PlayerID `json:"owner"`
	Basin Cargo           `json:"basin"`
}

// ShipView is one ship: where it is, what it is carrying, and how far it can
// still go this turn.
type ShipView struct {
	Sped  bool            `json:"sped"`
	ID    int             `json:"id"`
	Owner engine.PlayerID `json:"owner"`
	E     board.Edge      `json:"e"`
	Hold  Cargo           `json:"hold"`
	// Bow is the end of E the ship is pointing at, or the zero vertex for a hull
	// that has never moved. See Ship.Bow.
	Bow   board.Vertex `json:"bow,omitzero"`
	Left  int          `json:"left"`
	Moved bool         `json:"moved,omitempty"`
	Done  bool         `json:"done,omitempty"`
	// Fought marks a ship that has already rolled at the pirate this turn,
	// which battleReady excludes, so the client does not offer a second chase.
	Fought bool `json:"fought,omitempty"`
}

// SeatView is one player's Explorers side of the scoreboard. All of it is
// public: gold is a currency on the table, the mission markers are on a track
// everyone reads, and the supplies are the pieces in front of the player.
type SeatView struct {
	Gold         int                             `json:"gold"`
	ShipsLeft    int                             `json:"ships_left"`
	SettlersLeft int                             `json:"settlers_left"`
	CrewsLeft    int                             `json:"crews_left"`
	HarboursLeft int                             `json:"harbours_left"`
	Track        [TrackCount]int                 `json:"track"`
	Villages     [VillageCount][RegionCount]bool `json:"villages"`
	GoldBuys     int                             `json:"gold_buys"`
	FastGold     int                             `json:"fast_gold"`
	MissionVP    int                             `json:"mission_vp"`
}

// ExtView is the module's slice of a full state view.
//
// Nothing here is per-seat secret. The unexplored pool is nobody's knowledge:
// clients are told fog, and the true terrain reaches no view (MaskBoard has
// rewritten the board, and the layout blob in board_generated is redacted; see
// the EvBoardGenerated redactor below).
type ExtView struct {
	Home    []board.Hex    `json:"home"`
	Waters  []board.Hex    `json:"waters"`
	Council board.Hex      `json:"council"`
	Anchors []board.Vertex `json:"anchors"`
	// Fog is every hex nobody has revealed. Derivable from the masked board
	// too, but served so a client need not infer it from a resource name.
	Fog       []board.Hex    `json:"fog"`
	Revealed  []RevealedView `json:"revealed"`
	Harbours  []HarbourView  `json:"harbours"`
	Ships     []ShipView     `json:"ships"`
	Seats     []SeatView     `json:"seats"`
	Hauls     []board.Hex    `json:"hauls"`
	HaulsLeft int            `json:"hauls_left"`
	Pirate    *board.Hex     `json:"pirate,omitempty"`
	// PirateOwner is whose pirate ship is on the board, which is public:
	// tribute is owed only to an opponent's, and the piece is drawn in its
	// owner's colour.
	PirateOwner engine.PlayerID `json:"pirate_owner"`
	// PirateBy is who owes an activation right now, usually a different seat.
	PirateBy engine.PlayerID `json:"pirate_by"`
	// Leaders is who holds each mission track's bonus tile, or NoPlayer.
	Leaders [TrackCount]engine.PlayerID `json:"leaders"`
	// ChitsLeft is how many number chits each region's stack still holds.
	// Public: the stacks are face down but anyone can count them, and it tells
	// a player how much new land is left.
	ChitsLeft [RegionCount]int `json:"chits_left"`
	// Movement is whether the active seat has entered the Movement phase,
	// FishRolled whether it has used its fishing die, and Round which of the
	// three setup rounds is running.
	Movement   bool `json:"movement"`
	FishRolled bool `json:"fish_rolled"`
	Round      int  `json:"round"`
}

// ViewExt implements engine.Viewable.
//
// Every map and slice is built fresh or copied, never aliased: the view is
// serialized later on another goroutine while the actor may fold into this ext.
// ruletest.TestViewExtSharesNothingWithLiveExt checks this by reflection.
func (x *Ext) ViewExt(engine.PlayerID) any {
	v := &ExtView{
		Home:        slices.Clone(x.Home),
		Waters:      slices.Clone(x.Waters),
		Council:     x.Council,
		Anchors:     slices.Clone(x.Anchors),
		Fog:         []board.Hex{},
		Revealed:    []RevealedView{},
		Harbours:    []HarbourView{},
		Ships:       []ShipView{},
		Seats:       make([]SeatView, len(x.Seats)),
		Hauls:       []board.Hex{},
		HaulsLeft:   x.HaulsLeft,
		PirateOwner: x.PirateOwner,
		PirateBy:    x.PirateBy,
		Movement:    x.Movement,
		FishRolled:  x.FishRolled,
		Round:       x.Round,
	}
	for _, p := range x.Pool {
		if !x.Revealed[p.H] {
			v.Fog = append(v.Fog, p.H)
			continue
		}
		r := RevealedView{H: p.H, Region: p.Region, Kind: p.Kind, Shoal: p.Shoal, Captured: x.Captured[p.H]}
		if p.Kind == SpecialSpice {
			r.Village = p.Village
			r.Farmers = slices.Clone(x.FarmCrew[p.H])
		}
		if p.Kind == SpecialGold {
			r.Crews = slices.Clone(x.LairCrew[p.H])
		}
		v.Revealed = append(v.Revealed, r)
	}
	for vert, owner := range x.Harbours {
		v.Harbours = append(v.Harbours, HarbourView{V: vert, Owner: owner, Basin: x.Basins[vert]})
	}
	slices.SortFunc(v.Harbours, func(a, b HarbourView) int {
		if vertexLess(a.V, b.V) {
			return -1
		}
		return 1
	})
	for _, sh := range x.Ships {
		v.Ships = append(v.Ships, ShipView{
			Sped: sh.Bonus > 0,
			ID:   sh.ID, Owner: sh.Owner, E: sh.E, Hold: sh.Hold, Bow: sh.Bow,
			Left: mpLeft(x, sh), Moved: sh.Moved, Done: sh.Done, Fought: sh.Fought,
		})
	}
	slices.SortFunc(v.Ships, func(a, b ShipView) int { return a.ID - b.ID })
	for h := range x.Hauls {
		v.Hauls = append(v.Hauls, h)
	}
	sortHexes(v.Hauls)
	for i := range x.Seats {
		st := x.Seats[i]
		v.Seats[i] = SeatView{
			Gold: st.Gold, ShipsLeft: st.ShipsLeft, SettlersLeft: st.SettlersLeft,
			CrewsLeft: st.CrewsLeft, HarboursLeft: st.HarboursLeft,
			Track: st.Track, Villages: st.Villages,
			GoldBuys: st.GoldBuys, FastGold: st.FastGold,
			MissionVP: MissionVP(x, engine.PlayerID(i)),
		}
	}
	if x.HasPirate {
		h := x.Pirate
		v.Pirate = &h
	}
	for t := range TrackCount {
		v.Leaders[t] = missionLeader(x, t)
	}
	for r := range RegionCount {
		if r < len(x.Chits) && r < len(x.ChitsUsed) {
			v.ChitsLeft[r] = len(x.Chits[r]) - x.ChitsUsed[r]
		}
	}
	return v
}

// The EvBoardGenerated redactor: fog of war on the wire.
//
// State.New sets `Visible = []PlayerID{}` on board_generated for any ruleset
// whose module masks the board, so everyone gets this version: every unrevealed
// pool hex rewritten to `fog`, and the module's recorded layout blob (the whole
// unexplored map) dropped.
//
// It must be inert for every other ruleset. A registered redactor also runs on
// public events (Visible == nil) for every viewer, which a base-game
// board_generated is, so trimming unconditionally would blank every game's
// board. The guard is the ext blob: no `explorers` key, return the payload
// unchanged.
func redactBoardGenerated(e engine.Event) json.RawMessage {
	var d engine.BoardGeneratedData
	if err := json.Unmarshal(e.Data, &d); err != nil {
		return e.Data
	}
	blob, ours := d.Ext[Name]
	if !ours || d.Board == nil {
		// Not an Explorers board: nothing to mask. Re-marshalled rather than
		// echoed, because a redactor must not pass through unknown fields
		// (game.TestRedactionLeavesNoTypedPayload checks every
		// registered class with a sentinel field). Round-tripping through the
		// typed struct keeps the board and every module's recorded layout and
		// drops anything else.
		out, err := json.Marshal(d)
		if err != nil {
			return e.Data
		}
		return out
	}
	var layout Ext
	if err := json.Unmarshal(blob, &layout); err != nil {
		// The layout is unreadable, so the pool hexes are unknown and nothing
		// can be masked safely. Reveal nothing.
		return json.RawMessage(`{}`)
	}
	masked := d.Board.Clone()
	for _, p := range layout.Pool {
		masked.Tiles[p.H] = board.Tile{Res: board.Fog}
	}
	out, err := json.Marshal(engine.BoardGeneratedData{Board: masked})
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return out
}

func init() {
	engine.RegisterRedactor(engine.EvBoardGenerated, redactBoardGenerated)
	// The pirate's steal names the card only to the two seats involved; everyone
	// else is told who robbed whom.
	engine.RegisterRedactor(EvPirateMoved, func(e engine.Event) json.RawMessage {
		var d pirateData
		if err := json.Unmarshal(e.Data, &d); err != nil {
			return json.RawMessage(`{}`)
		}
		d.Res = board.ResNone
		return raw(d)
	})
}
