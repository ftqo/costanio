// Package game runs live games: one actor goroutine per game, the command
// pipeline (validate, persist, apply, broadcast), timers, and redaction.
package game

import (
	"encoding/json"
	"maps"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/store"
	"github.com/ftqo/costan.io/timings"
)

// Spectator is the viewer id for clients without a seat.
const Spectator engine.PlayerID = -1

// EvFrame is the wire envelope for one streamed redacted event. Field order
// and json tags match the earlier map[string]any{"t","game","seq","ev"}
// encoding byte for byte.
type EvFrame struct {
	T    string       `json:"t"`
	Game string       `json:"game"`
	Seq  int          `json:"seq"`
	Ev   engine.Event `json:"ev"`
}

// encodeEvFrame marshals one event into its wire frame. Returns nil on a
// marshal error; the event is not streamed and the client resyncs.
func encodeEvFrame(gameID string, e engine.Event) []byte {
	raw, err := json.Marshal(EvFrame{T: "ev", Game: gameID, Seq: e.Seq, Ev: e})
	if err != nil {
		return nil
	}
	return raw
}

// encodeFrame builds the shared ring frame for a broadcast event, encoding the
// wire bytes at most twice: the full payload (public viewers and the event's
// Visible seats) and, only for a hidden event, the redacted variant for
// everyone else. Redaction goes through RedactEvent so the split follows the
// engine's redaction classes.
func encodeFrame(gameID string, e engine.Event) frame {
	f := frame{seq: e.Seq, visible: e.Visible}
	if e.Visible == nil {
		// Public: one encoding for everyone. A public event can still carry a
		// field no viewer may have (the fish supply snapshot), and RedactEvent
		// trims it, so encode the redacted form.
		f.full = encodeEvFrame(gameID, RedactEvent(e, Spectator))
		return f
	}
	// Full payload: the event's own Visible seats see the unredacted event, so
	// its bytes are identical for them.
	f.full = encodeEvFrame(gameID, e)
	// Hidden: everyone not in Visible sees the redacted variant, which does
	// not depend on which non-owner asks, so one encoding covers all.
	nonOwner := Spectator
	for slices.Contains(e.Visible, nonOwner) {
		nonOwner-- // pick any id not in Visible (Spectator is never a real seat)
	}
	f.redacted = encodeEvFrame(gameID, RedactEvent(e, nonOwner))
	return f
}

// StoredEvFrames returns the `ev` frames for seqs [from, upto) of a game's
// persisted log as the viewer would receive them live, built by the same
// encodeFrame/bytesFor pair as the ring, so they are byte-identical.
//
// It serves the one re-subscribe the ring cannot: the game finished while the
// old subscription still had frames queued, and the finished-game path starts
// no new subscription. The events are already durable.
func StoredEvFrames(st *store.Store, gameID string, viewer engine.PlayerID, from, upto int) ([][]byte, error) {
	if from < 0 || from >= upto {
		return nil, nil
	}
	events, err := st.LoadEvents(gameID, from)
	if err != nil {
		return nil, err
	}
	out := make([][]byte, 0, upto-from)
	for _, e := range events {
		if e.Seq >= upto {
			break
		}
		f := encodeFrame(gameID, e)
		out = append(out, f.bytesFor(viewer))
	}
	return out, nil
}

// RedactEvent returns the event as the viewer may see it. Events with a
// Visible list keep their payload only for listed seats; everyone else gets a
// type-specific redacted payload.
//
// A public event (no Visible list) is still passed through its type's
// registered redactor, if any, for every viewer. Only engine/scenarios'
// tab_fish_caught uses this today: its supply snapshot is needed by replay but
// would reveal the table's tile mix. A public event with no redactor passes
// through untouched.
func RedactEvent(e engine.Event, viewer engine.PlayerID) engine.Event {
	// game_created carries both seeds, so it is trimmed whenever the viewer
	// is not explicitly listed, public or not, rather than relying on the
	// engine stamping Visible=[]. Callers that may see the seeds (a
	// participant's post-game replay) never call this.
	if e.Type == engine.EvGameCreated && !slices.Contains(e.Visible, viewer) {
		out := e
		out.Payload = nil
		out.Data = redactGameCreated(e.Data)
		return out
	}
	if e.Visible == nil {
		trim, ok := engine.RedactorFor(e.Type)
		if !ok {
			return e
		}
		out := e
		out.Payload = nil // see below: the typed cache must never outlive Data
		out.Data = trim(e)
		return out
	}
	if slices.Contains(e.Visible, viewer) {
		return e
	}
	out := e
	// Payload is a typed cache of Data that survives the struct copy, and
	// engine.decode prefers it over Data, so a redacted event that kept it
	// would fold as the unredacted struct.
	out.Payload = nil
	switch e.Type {
	case engine.EvCardStolen:
		var d engine.CardStolenData
		if err := json.Unmarshal(e.Data, &d); err != nil {
			out.Data = json.RawMessage(`{}`) // malformed blob: reveal nothing
			return out
		}
		// The fact of the steal is public; the card is not.
		redacted, _ := json.Marshal(map[string]any{"thief": d.Thief, "victim": d.Victim})
		out.Data = redacted
	case engine.EvDevCardBought:
		var d engine.DevCardBoughtData
		if err := json.Unmarshal(e.Data, &d); err != nil {
			out.Data = json.RawMessage(`{}`) // malformed blob: reveal nothing
			return out
		}
		// The purchase is public; the card is not.
		redacted, _ := json.Marshal(map[string]any{"player": d.Player})
		out.Data = redacted
	default:
		if redactor, ok := engine.RedactorFor(e.Type); ok {
			out.Data = redactor(e)
		} else {
			// Unknown hidden event: reveal only its type.
			out.Data = json.RawMessage(`{}`)
		}
	}
	return out
}

// PlayerView is a player's public face in a full view.
type PlayerView struct {
	Seat            engine.PlayerID `json:"seat"`
	HandCount       int             `json:"hand_count"`
	Hand            *engine.Hand    `json:"hand,omitempty"` // own seat only
	RoadsLeft       int             `json:"roads_left"`
	SettlementsLeft int             `json:"settlements_left"`
	CitiesLeft      int             `json:"cities_left"`
	DevCount        int             `json:"dev_count"`
	DevCards        *engine.DevHand `json:"dev_cards,omitempty"`     // own seat only
	NewDevCards     *engine.DevHand `json:"new_dev_cards,omitempty"` // own seat only
	KnightsPlayed   int             `json:"knights_played"`
	// RouteLength is this seat's longest continuous route, the number Longest
	// Road compares. Public, since the roads and ships are on the board.
	// Served rather than computed client-side because the traversal is an
	// engine rule (island ship routes, knights breaking routes; see
	// engine.LongestRouteLength's RouteLength hooks).
	RouteLength int `json:"route_length"`
	VP          int `json:"vp"` // public VP; own seat sees full VP; everyone sees full VP once the game is finished
	// PublicVP is what every other seat can see of this one
	// (PublicVPWithModules, without hidden dev-card points). It differs from
	// VP only on the viewer's own row, where VP is the full score.
	//
	// Several rules compare public standings, and the client needs this to
	// evaluate them for its own seat: Master Merchant's victims are seats with
	// strictly more PublicVPWithModules (engine/knights/progress_play.go), Wedding
	// uses strictly greater and Saboteur greater or equal.
	PublicVP int `json:"public_vp"`
	// DiscardAt is the hand size this seat may hold without discarding on a 7,
	// after every module delta (Knights city walls each add 2). Public, as both
	// inputs are, and served so the client does not reimplement
	// engine.DiscardThreshold.
	DiscardAt int `json:"discard_at"`
}

type BuildingView struct {
	V     board.Vertex    `json:"v"`
	Owner engine.PlayerID `json:"owner"`
	City  bool            `json:"city"`
}

type RoadView struct {
	E     board.Edge      `json:"e"`
	Owner engine.PlayerID `json:"owner"`
}

// LegalView is the set of positions the viewing player may place a piece at
// right now. The client renders only these as build targets so illegal spots are
// never offered. Present only on the current player's own view.
type LegalView struct {
	Settlements []board.Vertex `json:"settlements,omitempty"`
	Cities      []board.Vertex `json:"cities,omitempty"`
	Roads       []board.Edge   `json:"roads,omitempty"`
	Knights     []board.Vertex `json:"knights,omitempty"`
	Walls       []board.Vertex `json:"walls,omitempty"`
	// Islands ship placement (sea edges) and per-ship move destinations.
	Ships     []board.Edge             `json:"ships,omitempty"`
	ShipMoves []engine.ShipMoveTargets `json:"ship_moves,omitempty"`
	// Knights expansion: per-knight move/displacement destinations.
	KnightMoves []engine.KnightMoveTargets `json:"knight_moves,omitempty"`
	// Legal destinations for a pending robber (land) / pirate (sea) move.
	RobberHexes []board.Hex `json:"robber_hexes,omitempty"`
	PirateHexes []board.Hex `json:"pirate_hexes,omitempty"`
	// Knights expansion interactions: chase-robber hexes, chase-pirate hexes
	// (Islands only; a separate list because a knight is rarely next to both),
	// Deserter replacement vertices, displaced-knight relocation vertices, the
	// cities a seat that lost the barbarian defense may choose between, and
	// the cities an earned metropolis may be placed on.
	KnightEdgeChases    []engine.KnightEdgeChase `json:"knight_edge_chases,omitempty"`
	ChaseRobberHexes    []board.Hex              `json:"chase_robber_hexes,omitempty"`
	ChasePirateHexes    []board.Hex              `json:"chase_pirate_hexes,omitempty"`
	DeserterPlacements  []board.Vertex           `json:"deserter_placements,omitempty"`
	KnightRelocations   []board.Vertex           `json:"knight_relocations,omitempty"`
	BarbarianDowngrades []board.Vertex           `json:"barbarian_downgrades,omitempty"`
	MetropolisCities    []board.Vertex           `json:"metropolis_cities,omitempty"`
	// Per-progress-card target positions (keyed by card wire id), so the board
	// offers only valid picks once the player selects a card to play.
	ProgressTargets map[string]engine.ProgressTarget `json:"progress_targets,omitempty"`
	// Knights expansion: improvement track indices (0/1/2) the player may improve.
	Improvements []int `json:"improvements,omitempty"`
	// Caravans: the placements open to the seat that won a camel vote. Present
	// only on the placer's own view, and only while that vote is open.
	CamelPaths []engine.CamelPath `json:"camel_paths,omitempty"`
	// Rivers: the empty bridge sites this seat's network reaches. Separate
	// from Roads because the sets are disjoint: a bridge site is the only edge
	// a bridge may occupy and the only edge a road may not.
	Bridges []board.Edge `json:"bridges,omitempty"`
	// Wagons: the intersections the active wagon may step to, already priced
	// in movement points and tolls, and the paths a barbarian this seat owes a
	// move for may be put on.
	WagonSteps     []board.Vertex `json:"wagon_steps,omitempty"`
	BarbarianEdges []board.Edge   `json:"barbarian_edges,omitempty"`
	// Explorers: where a harbour settlement may go (a starting one in the
	// module's setup round, an upgrade in play), and per movable ship its one
	// step moves and the jobs it may work where it stands.
	Harbours      []board.Vertex               `json:"harbours,omitempty"`
	ExplorerShips []engine.ExplorerShipTargets `json:"explorer_ships,omitempty"`
}

// FullView is the complete redacted state for one viewer, sent on (re)connect.
type FullView struct {
	Seq             int                     `json:"seq"`
	Viewer          engine.PlayerID         `json:"viewer"`
	Config          engine.GameConfig       `json:"config"`
	Phase           engine.Phase            `json:"phase"`
	Cur             engine.PlayerID         `json:"cur"`
	SetupRound      int                     `json:"setup_round"`
	NeedRoad        bool                    `json:"need_road"`
	Rolled          bool                    `json:"rolled"`
	RobberPending   bool                    `json:"robber_pending"`
	PendingDiscards map[engine.PlayerID]int `json:"pending_discards,omitempty"`
	Board           *board.Board            `json:"board"`
	Bank            engine.Hand             `json:"bank"`
	Players         []PlayerView            `json:"players"`
	Buildings       []BuildingView          `json:"buildings"`
	Roads           []RoadView              `json:"roads"`
	Ext             map[string]any          `json:"ext,omitempty"` // per-module redacted views
	DevDeckCount    int                     `json:"dev_deck_count"`
	PlayedDev       bool                    `json:"played_dev"`
	FreeRoads       int                     `json:"free_roads"`
	ActiveOffer     *engine.TradeOffer      `json:"active_offer,omitempty"`
	LongestRoad     engine.PlayerID         `json:"longest_road"`
	LargestArmy     engine.PlayerID         `json:"largest_army"`
	// Winner is engine.NoPlayer (-1) for a game still in progress and for a
	// finished game that was drawn. Clients must not assume a finished game has
	// a winner.
	Winner engine.PlayerID `json:"winner"`
	Legal  *LegalView      `json:"legal,omitempty"`
	// DrawOffer is the open offer to end the game in a draw, or absent. Public:
	// every seat needs to see it to answer it.
	DrawOffer *engine.DrawOffer `json:"draw_offer,omitempty"`
	// TurnsCompleted is the game's length in turns, and DrawMinTurns the
	// length a draw offer or claim needs. Served so the threshold lives only in
	// engine.DrawMinTurns.
	TurnsCompleted int `json:"turns_completed"`
	DrawMinTurns   int `json:"draw_min_turns"`
	// FriendlyRobberMaxVP is the highest public score the friendly-robber
	// shield covers (the ruleset's starting score), or absent when the option
	// is off or there is no robber. Served so the client's victim pickers agree
	// with engine.State.FriendlyRobberProtected.
	FriendlyRobberMaxVP *int `json:"friendly_robber_max_vp,omitempty"`
	// BotsOnly reports that every seat except this viewer's is played by a bot,
	// which is what unlocks the claim control. Stamped by the actor (seat status
	// is game-layer knowledge), so it is false on views built without one.
	BotsOnly bool `json:"bots_only,omitempty"`
	// BankRatios is the viewer's maritime exchange rate per resource (index
	// 1..5 = wood/brick/sheep/wheat/ore), after harbors and module overrides.
	// Lets the client tell a bank-eligible basket from a table offer. Nil for
	// spectators.
	BankRatios *[6]int `json:"bank_ratios,omitempty"`
	// GoodRatios is the viewer's maritime rate for each non-resource good a
	// module adds, keyed by wire name ("cloth", "paper", "coin"). Separate from
	// BankRatios because a generic 3:1 harbor lowers a commodity's rate and a
	// specific 2:1 resource harbor does not. Empty in the base game and for
	// spectators.
	GoodRatios map[string]int `json:"good_ratios,omitempty"`
	// GoodMaritimeRatios is what the maritime trade command charges for each
	// of those goods, which can differ from GoodRatios: under Knights a
	// Trade-3 player's cloth is worth 2 (Trading House) but the maritime lane
	// takes four. Display uses GoodRatios; pricing a basket uses this.
	GoodMaritimeRatios map[string]int `json:"good_maritime_ratios,omitempty"`
	// OfferDeadlineMs is the open table offer's remaining lifetime in
	// milliseconds at emission, or nil when no offer stands. The server
	// auto-cancels the offer when it elapses; clients count down to it.
	OfferDeadlineMs *int64 `json:"offer_deadline_ms,omitempty"`
	// DrawDeadlineMs is the open draw offer's remaining lifetime, so an
	// unanswered offer expires even on a table with no turn timer.
	DrawDeadlineMs *int64 `json:"draw_deadline_ms,omitempty"`
	// SeatDeadlines maps each seat currently on the clock to its remaining
	// budget in milliseconds at emission. Several entries during simultaneous
	// phases, one during a normal turn, empty when untimed or over. Includes
	// bot/auto seats. Stamped by the actor.
	SeatDeadlines map[engine.PlayerID]int64 `json:"seat_deadlines,omitempty"`
	// Timings is this game's clock policy: the caps, the trade window, the
	// lobby's turn-timer presets and bounds. Served so the client hardcodes no
	// timing. Derived from the config and constant for the game, so clients
	// may read it once.
	Timings *timings.Wire `json:"timings,omitempty"`
	// SeatBudgets maps each seat on the clock to the full budget (ms) of its
	// current decision, keyed like SeatDeadlines. The client scales its timer
	// bar to this so the bar's full mark stays fixed even when the remaining
	// value goes up (a new decision, the inactivity floor). Stamped by the
	// actor.
	SeatBudgets map[engine.PlayerID]int64 `json:"seat_budgets,omitempty"`
	// SeatNames maps each seat to its player's display name. Lobby metadata,
	// stamped by the actor. Sent to every viewer because spectators of a
	// private game are refused the gated /api/games seat list.
	SeatNames map[engine.PlayerID]string `json:"seat_names,omitempty"`
	// RobberSkin is the equipped robber cosmetic of the seat that last moved
	// the robber, or "" for the stock art. Lobby metadata like SeatNames,
	// stamped by the actor. Public: the robber belongs to the table, and who
	// moved it is already in the log.
	RobberSkin string `json:"robber_skin,omitempty"`
	// SeatPieces maps each seat to its player's equipped piece set, absent
	// for the stock buildings. Lobby metadata like SeatNames, stamped by the
	// actor. Per seat because every seat's buildings are on everyone's board.
	// Public; it carries no hidden information.
	SeatPieces map[engine.PlayerID]string `json:"seat_pieces,omitempty"`
}

// NewFullView builds the redacted view for viewer (Spectator for no seat),
// computing legal targets directly. The actor uses newFullViewLegal with a
// per-state-version cache instead.
func NewFullView(s *engine.State, viewer engine.PlayerID) *FullView {
	return newFullViewLegal(s, viewer, true, s.LegalTargetsFor)
}

// NewReplayView builds one frame of a finished game: the live view minus the
// legal-target lists. Nobody can act in a replay, LegalTargetsFor is the
// expensive half of a view (and a replay builds one per event), and a seat
// view of a state with no board panics (boardVertices dereferences s.Board,
// nil until the deal). The replay package is the only caller.
func NewReplayView(s *engine.State, viewer engine.PlayerID) *FullView {
	// acting is true: nothing holds a seat in a replay, and false would strip
	// the viewer-keyed module looks (such as the Spy look) from a
	// participant's own replay.
	return newFullViewLegal(s, viewer, true, func(engine.PlayerID) engine.LegalTargets {
		return engine.LegalTargets{}
	})
}

// NewRevealedReplayView is NewReplayView with nothing hidden: every seat's
// resource hand, dev cards and true victory-point total, drawn from the
// spectator's board. A finished game has no play left to protect, as with the
// post-game board (BuildBoardView) and scoreboard. Who may watch is unchanged.
//
// Only for finished games; there is no live caller and must not be one, since
// it would hand every hand to every seat.
func NewRevealedReplayView(s *engine.State) *FullView {
	v := NewReplayView(s, Spectator)
	// Module views are built for the spectator, whom per-seat gates exclude
	// (FishExt.ViewExt publishes a mix only for viewer >= 0). A module that
	// hides something per seat implements engine.RevealedViewable, and that
	// view is published here; other modules' views are already whole.
	for name, ext := range s.Ext {
		if revealed, ok := ext.(engine.RevealedViewable); ok {
			if v.Ext == nil {
				v.Ext = map[string]any{}
			}
			v.Ext[name] = revealed.ViewExtRevealed()
			if c, ok := ext.(engine.ComposedViewable); ok {
				v.Ext[name] = c.ComposeView(s, v.Ext[name])
			}
		}
	}
	// v.Players is appended in seat order over s.Players, so the indices agree.
	for i := range v.Players {
		h := s.Players[i].Hand
		v.Players[i].Hand = &h
		d := s.Players[i].DevCards
		v.Players[i].DevCards = &d
		nd := s.Players[i].NewDevCards
		v.Players[i].NewDevCards = &nd
		// The real total, including dev-card points the public score omits.
		v.Players[i].VP = s.VPWithModules(engine.PlayerID(i))
	}
	return v
}

// newFullViewLegal is NewFullView with a swappable legal-targets provider, so
// the actor can supply a cached one. legalFor must return what
// s.LegalTargetsFor(seat) would for the current state.
//
// acting is false for a viewer who owns the seat but has left it to a bot
// while spectating. They keep the table and their own hand, but lose what
// exists only for deciding: the legal placement sets, viewer-keyed module
// looks, and any hand a module reveals mid-look. Otherwise the bot's decision
// would be laid out for them, with their click refused
// (ErrSeatBotControlled) after the hidden cards were shown.
func newFullViewLegal(s *engine.State, viewer engine.PlayerID, acting bool, legalFor func(engine.PlayerID) engine.LegalTargets) *FullView {
	v := &FullView{
		Seq:           s.NextSeq,
		Viewer:        viewer,
		Config:        s.Config,
		Phase:         s.Phase,
		Cur:           s.Cur,
		SetupRound:    s.SetupRound,
		NeedRoad:      s.NeedRoad,
		Rolled:        s.Rolled,
		RobberPending: s.RobberPending,
		Bank:          s.Bank,
		DevDeckCount:  s.DevDeck.Count(),
		PlayedDev:     s.PlayedDevThisTurn,
		FreeRoads:     s.FreeRoads,
		LongestRoad:   s.LongestRoadHolder,
		LargestArmy:   s.LargestArmyHolder,
		Winner:        s.Winner,

		TurnsCompleted: s.TurnsCompleted,
		DrawMinTurns:   engine.DrawMinTurns,
	}
	if s.FriendlyRobberActive() {
		n := s.FriendlyRobberMaxVP()
		v.FriendlyRobberMaxVP = &n
	}
	// Copy every mutable reference out of the live State: the view is built on
	// the actor loop but serialized later by the WS/HTTP handlers while the
	// actor keeps applying events. Aliasing Board, ActiveOffer or
	// PendingDiscards would race (a fatal concurrent map access for
	// PendingDiscards). Mirrors State.Clone()'s copy semantics.
	if s.Board != nil {
		// Shallow board copy: Tiles/Harbors are read-only after setup (the one
		// in-game Tiles mutator copies on write) and only the scalar Robber
		// changes.
		b := *s.Board
		v.Board = &b
	}
	if s.ActiveOffer != nil {
		o := *s.ActiveOffer
		o.Accepted = append([]engine.PlayerID(nil), s.ActiveOffer.Accepted...)
		o.Declined = append([]engine.PlayerID(nil), s.ActiveOffer.Declined...)
		o.Counters = append([]engine.CounterOffer(nil), s.ActiveOffer.Counters...)
		v.ActiveOffer = &o
	}
	if s.DrawOffer != nil {
		o := *s.DrawOffer
		o.Accepted = append([]engine.PlayerID(nil), s.DrawOffer.Accepted...)
		v.DrawOffer = &o
	}
	if len(s.PendingDiscards) > 0 {
		pd := make(map[engine.PlayerID]int, len(s.PendingDiscards))
		maps.Copy(pd, s.PendingDiscards)
		v.PendingDiscards = pd
	}
	for name, ext := range s.Ext {
		if viewable, ok := ext.(engine.Viewable); ok {
			if v.Ext == nil {
				v.Ext = map[string]any{}
			}
			if idle, ok := ext.(engine.IdleViewable); ok && !acting {
				v.Ext[name] = idle.ViewExtIdle(viewer)
			} else {
				v.Ext[name] = viewable.ViewExt(viewer)
				if c, ok := ext.(engine.ComposedViewable); ok {
					v.Ext[name] = c.ComposeView(s, v.Ext[name])
				}
			}
		}
	}
	// Seats whose full resource hand this viewer may see beyond their own: a
	// module reveal (Knights Master Merchant, where the thief sees the
	// victim's hand). Gated with the look itself (see acting above).
	revealed := map[engine.PlayerID]bool{}
	if viewer >= 0 && acting {
		for _, m := range s.Modules() {
			if rh := m.Hooks().RevealHands; rh != nil {
				for _, seat := range rh(s, viewer) {
					revealed[seat] = true
				}
			}
		}
	}
	for i := range s.Players {
		p := PlayerView{
			Seat:            engine.PlayerID(i),
			HandCount:       s.Players[i].Hand.Count(),
			RoadsLeft:       s.Players[i].RoadsLeft,
			SettlementsLeft: s.Players[i].SettlementsLeft,
			CitiesLeft:      s.Players[i].CitiesLeft,
			DevCount:        s.Players[i].DevCards.Count() + s.Players[i].NewDevCards.Count(),
			KnightsPlayed:   s.Players[i].KnightsPlayed,
			RouteLength:     engine.LongestRouteLength(s, engine.PlayerID(i)),
			DiscardAt:       s.DiscardThreshold(engine.PlayerID(i)),
			// Public VP includes module VictoryCheck contributions (island
			// chips, metropolis, defender/merchant VP), as the win check does.
			VP:       s.PublicVPWithModules(engine.PlayerID(i)),
			PublicVP: s.PublicVPWithModules(engine.PlayerID(i)),
		}
		if engine.PlayerID(i) == viewer {
			h := s.Players[i].Hand
			p.Hand = &h
			d := s.Players[i].DevCards
			p.DevCards = &d
			nd := s.Players[i].NewDevCards
			p.NewDevCards = &nd
			// The seat's own view adds hidden dev-card VP, plus module VP: the
			// exact total the win check compares.
			p.VP = s.VPWithModules(viewer)
		} else if revealed[engine.PlayerID(i)] {
			// A module reveal exposes this seat's resource breakdown (Master
			// Merchant look). Dev cards and hidden VP stay private.
			h := s.Players[i].Hand
			p.Hand = &h
		}
		if s.Phase == engine.PhaseFinished {
			// Once the game is over, hidden VP cards are revealed: every
			// viewer's seat card shows the true total, matching the end screen.
			// Done here in the redaction; PublicVP is unchanged. Taken from the
			// finish event when it carries totals, so a redacted log (which
			// cannot see the VP cards) folds to the same seat cards.
			if i < len(s.FinalVP) {
				p.VP = s.FinalVP[i]
			} else {
				p.VP = s.VPWithModules(engine.PlayerID(i))
			}
		}
		v.Players = append(v.Players, p)
	}
	// s.Buildings and s.Roads are already deduped, so iterate them directly
	// and sort once for a stable wire order.
	v.Buildings = make([]BuildingView, 0, len(s.Buildings))
	for vert, b := range s.Buildings {
		v.Buildings = append(v.Buildings, BuildingView{V: vert, Owner: b.Owner, City: b.City})
	}
	slices.SortFunc(v.Buildings, func(a, b BuildingView) int { return vertexCompare(a.V, b.V) })
	v.Roads = make([]RoadView, 0, len(s.Roads))
	for e, owner := range s.Roads {
		v.Roads = append(v.Roads, RoadView{E: e, Owner: owner})
	}
	slices.SortFunc(v.Roads, func(a, b RoadView) int {
		if c := vertexCompare(a.E.A, b.E.A); c != 0 {
			return c
		}
		return vertexCompare(a.E.B, b.E.B)
	})
	// Legal build targets, so the client offers only placeable spots.
	// Computed for the current player and for any viewer owed a pending
	// module placement (displaced-knight relocation, barbarian city
	// sacrifice); LegalTargetsFor returns empty for everyone else.
	//
	// Every list the engine can return must appear in both the emptiness test
	// and the copy below, or the client arms the mode (from the module's
	// pending list) and finds nothing to click.
	//
	// Withheld from a seat a bot is playing (acting), which keeps the board's
	// location menu shut for the spectating owner.
	if viewer >= 0 && acting {
		lt := legalFor(viewer)
		if len(lt.Settlements)+len(lt.Cities)+len(lt.Roads)+len(lt.Knights)+len(lt.Walls)+
			len(lt.Ships)+len(lt.ShipMoves)+len(lt.KnightMoves)+len(lt.RobberHexes)+len(lt.PirateHexes)+
			len(lt.ChaseRobberHexes)+len(lt.ChasePirateHexes)+len(lt.KnightEdgeChases)+
			len(lt.DeserterPlacements)+len(lt.KnightRelocations)+
			len(lt.BarbarianDowngrades)+len(lt.MetropolisCities)+
			len(lt.ProgressTargets)+len(lt.Improvements)+len(lt.CamelPaths)+
			len(lt.Bridges)+len(lt.WagonSteps)+len(lt.BarbarianEdges)+
			len(lt.Harbours)+len(lt.ExplorerShips) > 0 {
			legal := &LegalView{
				Settlements: lt.Settlements, Cities: lt.Cities, Roads: lt.Roads,
				Knights: lt.Knights, Walls: lt.Walls,
				Ships: lt.Ships, ShipMoves: lt.ShipMoves, KnightMoves: lt.KnightMoves,
				RobberHexes: lt.RobberHexes, PirateHexes: lt.PirateHexes,
				KnightEdgeChases: lt.KnightEdgeChases, ChaseRobberHexes: lt.ChaseRobberHexes, ChasePirateHexes: lt.ChasePirateHexes,
				DeserterPlacements: lt.DeserterPlacements,
				KnightRelocations:  lt.KnightRelocations, BarbarianDowngrades: lt.BarbarianDowngrades,
				MetropolisCities: lt.MetropolisCities,
				ProgressTargets:  lt.ProgressTargets,
				Improvements:     lt.Improvements,
				// Not sorted below: legalPaths emits these grouped by caravan,
				// in the order each chain grows, and that order matters.
				CamelPaths: lt.CamelPaths,
				Bridges:    lt.Bridges,
				// Sorted below like the other position lists, except
				// ExplorerShips, which the engine orders by ship id and the
				// client lists in that order.
				WagonSteps:     lt.WagonSteps,
				BarbarianEdges: lt.BarbarianEdges,
				Harbours:       lt.Harbours,
				ExplorerShips:  lt.ExplorerShips,
			}
			slices.SortFunc(legal.Settlements, vertexCompare)
			slices.SortFunc(legal.Cities, vertexCompare)
			slices.SortFunc(legal.Knights, vertexCompare)
			slices.SortFunc(legal.Walls, vertexCompare)
			edgeCompare := func(a, b board.Edge) int {
				if c := vertexCompare(a.A, b.A); c != 0 {
					return c
				}
				return vertexCompare(a.B, b.B)
			}
			slices.SortFunc(legal.Roads, edgeCompare)
			// Top-level Ships is ordered like Roads; per-group To/From order
			// is already deterministic from the engine.
			slices.SortFunc(legal.Ships, edgeCompare)
			slices.SortFunc(legal.Bridges, edgeCompare)
			slices.SortFunc(legal.WagonSteps, vertexCompare)
			slices.SortFunc(legal.BarbarianEdges, edgeCompare)
			slices.SortFunc(legal.Harbours, vertexCompare)
			v.Legal = legal
		}
	}

	if viewer >= 0 {
		// One pass over the board for all five rates, as the engine prices a
		// basket trade.
		ratios := s.BankRatios(viewer)
		v.BankRatios = &ratios
		for _, m := range s.Modules() {
			if gr := m.Hooks().GoodRatios; gr != nil {
				for name, ratio := range gr(s, viewer) {
					if v.GoodRatios == nil {
						v.GoodRatios = map[string]int{}
					}
					v.GoodRatios[name] = ratio
				}
			}
			// A module with one lane per good leaves this nil, and there the
			// published worth is the price.
			gmr := m.Hooks().GoodMaritimeRatios
			if gmr == nil {
				gmr = m.Hooks().GoodRatios
			}
			if gmr == nil {
				continue
			}
			for name, ratio := range gmr(s, viewer) {
				if v.GoodMaritimeRatios == nil {
					v.GoodMaritimeRatios = map[string]int{}
				}
				v.GoodMaritimeRatios[name] = ratio
			}
		}
	}

	for _, m := range s.Modules() {
		if mask := m.Hooks().MaskBoard; mask != nil {
			v.Board = mask(s, v.Board)
		}
	}
	return v
}

// vertexCompare orders vertices by (Q, R, Side) for a stable view wire order.
func vertexCompare(a, b board.Vertex) int {
	if a.Q != b.Q {
		return a.Q - b.Q
	}
	if a.R != b.R {
		return a.R - b.R
	}
	return int(a.Side) - int(b.Side)
}

// redactGameCreated trims a game_created payload to what any viewer may see.
//
// Config and both commitments are public; neither seed is. The private seed
// would reveal every draw and steal, the public one every future roll
// including the fair-dice deck. Both are revealed by the post-game replay
// (docs/dice.md). Built as an allowlist, so a field added to GameCreatedData
// later stays hidden until listed here.
func redactGameCreated(data json.RawMessage) json.RawMessage {
	var d engine.GameCreatedData
	if err := json.Unmarshal(data, &d); err != nil {
		return json.RawMessage(`{}`) // malformed blob: reveal nothing
	}
	redacted, _ := json.Marshal(map[string]any{
		"config":             d.Config,
		"seed_commit":        d.SeedCommit,
		"public_seed_commit": d.PublicSeedCommit,
	})
	return redacted
}
