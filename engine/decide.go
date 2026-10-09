package engine

import (
	"encoding/json"
	"errors"

	"github.com/ftqo/costan.io/engine/board"
)

var (
	ErrNotYourTurn      = errors.New("not your turn")
	ErrWrongPhase       = errors.New("not allowed in this phase")
	ErrBadPlacement     = errors.New("illegal placement")
	ErrTooClose         = errors.New("too close to another settlement")
	ErrOccupied         = errors.New("position occupied")
	ErrNoResources      = errors.New("insufficient resources")
	ErrNoPieces         = errors.New("no pieces left")
	ErrMustRoll         = errors.New("must roll the dice first")
	ErrAlreadyRolled    = errors.New("dice already rolled this turn")
	ErrRobberPending    = errors.New("robber must be moved first")
	ErrDiscardPending   = errors.New("discards are pending")
	ErrNoDiscardNeeded  = errors.New("no discard required")
	ErrBadDiscard       = errors.New("discard does not match requirement")
	ErrBadVictim        = errors.New("invalid robber victim")
	ErrGameFinished     = errors.New("game is finished")
	ErrUnknownCommand   = errors.New("unknown command")
	ErrBadCommand       = errors.New("malformed command data")
	ErrNoOffer          = errors.New("no open trade offer")
	ErrSameResource     = errors.New("cannot trade a resource for the same resource")
	ErrBadTrade         = errors.New("those cards do not pay for what you asked for")
	ErrAlreadyResponded = errors.New("already responded to this offer")
	ErrDeckEmpty        = errors.New("development deck is empty")
	ErrDevAlreadyPlayed = errors.New("already played a development card this turn")
	ErrNoSuchCard       = errors.New("you do not hold that card")
	ErrModulePending    = errors.New("a pending choice must be resolved first")
	ErrNotDuel          = errors.New("surrender is only for two-player games")
	ErrDrawTooEarly     = errors.New("the game is not long enough yet")
	ErrDrawPending      = errors.New("a draw offer is already open")
	ErrNoDrawOffer      = errors.New("no open draw offer")
	// ErrSurrenderTooEarly refuses a concession in a game nobody has played yet
	// (see engine.SurrenderMinTurns); the host's reset is the route for that.
	ErrSurrenderTooEarly = errors.New("the game is too new to concede")
	// ErrDrawOfferUsed caps draw offers at one per player per turn, so offer and
	// decline cannot loop.
	ErrDrawOfferUsed = errors.New("you have already offered a draw this turn")
	// ErrNoResponse refuses withdrawing an answer from a seat that never gave one,
	// so a client cannot log unbounded retractions.
	ErrNoResponse = errors.New("no response to withdraw")
	// ErrBuildingOver refuses a build or a trade in a turn stage a module has
	// closed to both (Explorers' Movement phase). See Hooks.BlocksBuildTrade.
	ErrBuildingOver = errors.New("building and trading are over for this turn")
)

// decodeCmd parses untrusted client payloads; unlike event decoding, failures
// are errors, not panics.
func decodeCmd[T any](data json.RawMessage) (T, error) {
	var v T
	if len(data) == 0 {
		return v, nil
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return v, ErrBadCommand
	}
	return v, nil
}

// Decide validates a command against the state and returns the resulting
// events (with Seq assigned). It never mutates the state.
func Decide(s *State, cmd Command) ([]Event, error) {
	events, err := decideInto(s, cmd)
	if err != nil {
		return nil, err
	}
	before := newFinalizeCtx(s)
	after := s.Clone()
	for _, e := range events {
		if err := Apply(after, e); err != nil {
			return nil, err
		}
	}
	return finalizeWith(before, after, events)
}

// decideInto is the shared validation+dispatch core of Decide and
// DecideForEval. It returns the raw (pre-finalize) events with Seq assigned, or
// an error. It never mutates s.
func decideInto(s *State, cmd Command) ([]Event, error) {
	if s.Phase == PhaseFinished {
		return nil, ErrGameFinished
	}
	if cmd.Player < 0 || int(cmd.Player) >= len(s.Players) {
		return nil, ErrNotYourTurn
	}

	var events []Event
	var err error
	switch cmd.Type {
	case CmdPlaceSettlement:
		events, err = decidePlaceSettlement(s, cmd)
	case CmdPlaceRoad:
		events, err = decidePlaceRoad(s, cmd)
	case CmdRollDice:
		events, err = decideRoll(s, cmd)
	case CmdDiscardCards:
		events, err = decideDiscard(s, cmd)
	case CmdMoveRobber:
		events, err = decideMoveRobber(s, cmd)
	case CmdBuildRoad, CmdBuildSettlement, CmdBuildCity:
		events, err = decideBuild(s, cmd)
	case CmdEndTurn:
		events, err = decideEndTurn(s, cmd)
	case CmdBankTrade:
		events, err = decideBankTrade(s, cmd)
	case CmdOfferTrade:
		events, err = decideOfferTrade(s, cmd)
	case CmdRespondTrade:
		events, err = decideRespondTrade(s, cmd)
	case CmdExecuteTrade:
		events, err = decideExecuteTrade(s, cmd)
	case CmdCancelTrade:
		events, err = decideCancelTrade(s, cmd)
	case CmdCounterTrade:
		events, err = decideCounterTrade(s, cmd)
	case CmdBuyDevCard:
		events, err = decideBuyDevCard(s, cmd)
	case CmdPlayDevCard:
		events, err = decidePlayDevCard(s, cmd)
	case CmdSurrender:
		events, err = decideSurrender(s, cmd)
	case CmdOfferDraw:
		events, err = decideOfferDraw(s, cmd)
	case CmdRespondDraw:
		events, err = decideRespondDraw(s, cmd)
	case CmdCancelDraw:
		events, err = decideCancelDraw(s, cmd)
	case CmdClaimGame:
		events, err = decideClaimGame(s, cmd)
	default:
		handled := false
		for _, m := range s.Modules() {
			var mErr error
			events, handled, mErr = m.Decide(s, cmd)
			if mErr != nil {
				return nil, mErr
			}
			if handled {
				break
			}
		}
		if !handled {
			return nil, ErrUnknownCommand
		}
	}
	if err != nil {
		return nil, err
	}
	for i := range events {
		events[i].Seq = s.NextSeq + i
	}
	return events, nil
}

// DecideForEval validates cmd against s and applies the resulting events
// (module OnEvents reactions, the longest-route recompute and the victory
// check included) in place to s. The after-state is identical to applying
// Decide's events to a clone, without Decide's internal clone: bots already
// clone before scoring, so this saves one State.Clone per candidate.
// s is mutated, so the caller must own it.
func DecideForEval(s *State, cmd Command) error {
	events, err := decideInto(s, cmd)
	if err != nil {
		return err
	}
	// Snapshot the win-check inputs first: applying events may move s.Cur
	// (EndTurn) or s.Phase, but the win must be credited to the player who acted.
	before := newFinalizeCtx(s)
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			return err
		}
	}
	_, err = finalizeWith(before, s, events)
	return err
}

// finalizeCtx snapshots the pre-command inputs the victory check needs: the
// phase gate, the acting turn-holder and the base VP target. It lets
// finalizeWith run against an after-state that may be the same object the
// events were applied to (DecideForEval).
type finalizeCtx struct {
	phase  Phase
	cur    PlayerID
	target int
}

// newFinalizeCtx takes that snapshot before folding: cur is the seat that
// acted, which an end-turn moves past.
func newFinalizeCtx(s *State) finalizeCtx {
	return finalizeCtx{phase: s.Phase, cur: s.Cur, target: s.Config.TargetVP}
}

// victoryVP is a seat's whole victory total: base points plus every module's
// VictoryCheck contribution (a Knights metropolis, a caravan settlement between
// two camels).
func victoryVP(s *State, p PlayerID) int {
	vp := s.VP(p)
	for _, m := range s.Modules() {
		if h := m.Hooks().VictoryCheck; h != nil {
			vp += h(s, p)
		}
	}
	return vp
}

// winThreshold is how many points seat p needs, the configured target plus
// every module's delta (Fishermen's old boot costs its holder one extra).
func winThreshold(s *State, base int, p PlayerID) int {
	for _, m := range s.Modules() {
		if h := m.Hooks().WinThresholdDelta; h != nil {
			base += h(s, p)
		}
	}
	return base
}

// WinThreshold is how many points seat p needs to win this game: the
// configured target plus every module's WinThresholdDelta (Fishermen's old
// boot costs its holder one point). Code outside the engine must use this
// rather than s.Config.TargetVP. A non-positive target reads as the default
// 10; GameConfig.normalize ensures that in real games, but hand-built test
// states can hit it.
func WinThreshold(s *State, p PlayerID) int {
	base := s.Config.TargetVP
	if base <= 0 {
		base = 10
	}
	return winThreshold(s, base, p)
}

// finalizeWith runs module OnEvents reactions, the longest-route recompute and
// the victory check on after (the state with events already applied),
// appending any title/finish events. Centralised so no decide function can
// miss a VP source.
func finalizeWith(before finalizeCtx, after *State, events []Event) ([]Event, error) {
	if len(events) == 0 {
		return events, nil
	}
	cur := before.cur
	target := before.target
	appendEvent := func(e Event) error {
		e.Seq = after.NextSeq
		if err := Apply(after, e); err != nil {
			return err
		}
		events = append(events, e)
		return nil
	}
	runAfterEvents := func() error {
		for _, m := range after.Modules() {
			h := m.Hooks().AfterEvents
			if h == nil {
				continue
			}
			for _, e := range h(after, events) {
				if err := appendEvent(e); err != nil {
					return err
				}
			}
		}
		return nil
	}

	// Outside PhasePlay nothing below applies, except the re-derivation phase: a
	// standing derived from buildings is already true during setup (a Knights
	// round-2 city on a harbour vertex can finish setup holding the Harbormaster).
	// See Hooks.AfterEvents.
	if before.phase != PhasePlay {
		if err := runAfterEvents(); err != nil {
			return nil, err
		}
		return events, nil
	}

	// Modules react to the batch (island chips, metropolis steals, ...).
	for _, m := range after.Modules() {
		if h := m.Hooks().OnEvents; h != nil {
			for _, e := range h(after, events) {
				if err := appendEvent(e); err != nil {
					return nil, err
				}
			}
		}
	}

	// Close an offer the offerer can no longer honour (e.g. they spent the offered
	// wheat on a development card). Execute would fail anyway, but the offer should
	// not stay open. Only the offerer's own stake is tested. Emitted as a real
	// EvTradeCancelled so replay learns of the close from the log.
	if o := after.ActiveOffer; o != nil {
		_, comHeld := after.tradeExtraHeld(o.By, o.GiveCom)
		if !after.Players[o.By].Hand.Has(o.Give) || !comHeld {
			if err := appendEvent(mustEvent(EvTradeCancelled, struct{}{})); err != nil {
				return nil, err
			}
		}
	}

	// Longest route is one walk over base roads and every module's RouteEdges
	// (ships, camel-doubled roads). LongestRouteLength is shared with the
	// scoreboard so they agree.
	routeLen := LongestRouteLength
	routesChanged := false
	for _, e := range events {
		switch e.Type {
		case EvRoadBuilt, EvSettlementBuilt:
			routesChanged = true
		default:
			if routeEventTypes[e.Type] {
				routesChanged = true
			}
		}
	}
	// A module may remove the award entirely (Wagons, Explorers). Suppressing the
	// event keeps LongestRoadHolder at NoPlayer all game, so the badge, scoreboard
	// and PublicVP agree. See Hooks.NoLongestRoad.
	if routesChanged && !longestRoadDisabled(after) {
		for _, e := range longestRoadEvents(after, routeLen) {
			if err := appendEvent(e); err != nil {
				return nil, err
			}
		}
	}

	// Second reaction phase, after every module's OnEvents and before the victory
	// check: a re-derived standing (Harbormaster) must see the finished batch and
	// count toward the acting player's win this turn. See Hooks.AfterEvents.
	if err := runAfterEvents(); err != nil {
		return nil, err
	}

	// The victory check. A player wins only on their own turn; reaching the target
	// off-turn means waiting until their next turn. No expansion overrides this
	// (docs/rules/scenarios.md records the Caravans case). Two seats are checked:
	//
	//   - `cur`, the seat whose turn it was when the command arrived (snapshotted
	//     before the fold, so an end-turn still credits the player who acted).
	//   - `after.Cur`, the seat whose turn it is now. On an end-turn batch that is
	//     the next player, so a banked win lands at the start of their turn.
	//
	// The check runs on every batch, so a seat that crossed the target off-turn
	// wins at the next turn change.
	if after.Phase != PhaseFinished {
		winner, winVP := NoPlayer, 0
		check := func(seat PlayerID) {
			if winner != NoPlayer || seat < 0 || int(seat) >= len(after.Players) {
				return
			}
			if vp := victoryVP(after, seat); vp >= winThreshold(after, target, seat) {
				winner, winVP = seat, vp
			}
		}
		check(cur)
		check(after.Cur)
		if winner != NoPlayer {
			if err := appendEvent(mustEvent(EvGameFinished, GameFinishedData{Winner: winner, VP: winVP, Scores: finalScores(after)})); err != nil {
				return nil, err
			}
		}
	}
	return events, nil
}

// requireActionableTurn checks the command comes from the current player
// during play, after rolling, with no robber/discard/module interruptions
// outstanding.
func requireActionableTurn(s *State, p PlayerID) error {
	if s.Phase != PhasePlay {
		return ErrWrongPhase
	}
	if p != s.Cur {
		return ErrNotYourTurn
	}
	if !s.Rolled {
		return ErrMustRoll
	}
	return requireUninterruptedTurn(s, p)
}

// requireBuildTurn is requireActionableTurn plus every module's BlocksBuildTrade
// gate: an actionable turn on which the seat may still build or trade. Separate
// because end_turn uses requireActionableTurn and must still be allowed when
// building is over (Explorers' Movement phase).
func requireBuildTurn(s *State, p PlayerID) error {
	if err := requireActionableTurn(s, p); err != nil {
		return err
	}
	return buildTradeBlocked(s)
}

// buildTradeBlocked reports the module refusal, if any, for a build or a trade.
func buildTradeBlocked(s *State) error {
	for _, m := range s.Modules() {
		if h := m.Hooks().BlocksBuildTrade; h != nil && h(s) {
			return ErrBuildingOver
		}
	}
	return nil
}

// SellGoodToModule offers the named good to each module in turn and returns the
// first one's events for taking it off p and putting it back on its own supply.
// ok is false when no module owns a good by that name. See Hooks.SellGood.
func (s *State) SellGoodToModule(p PlayerID, good string) ([]Event, bool, error) {
	for _, m := range s.Modules() {
		h := m.Hooks().SellGood
		if h == nil {
			continue
		}
		events, ok, err := h(s, p, good)
		if err != nil || ok {
			return events, ok, err
		}
	}
	return nil, false, nil
}

// UnrevealedVertex reports whether any module has yet to reveal something the
// vertex touches, so no piece may stand there. See Hooks.UnrevealedVertex.
// Exported for Knights under the Explorers pairing.
func (s *State) UnrevealedVertex(v board.Vertex) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().UnrevealedVertex; h != nil && h(s, v) {
			return true
		}
	}
	return false
}

// BlocksCityUpgrade reports the first module's reason for barring p from
// upgrading the settlement at v to a city, or nil. See Hooks.BlocksCityUpgrade.
// A module refusing every new build at v (Hooks.BlocksNewConstruction, a
// Raiders conquered hex) refuses this too with ErrBadPlacement, checked first.
// Exported for the Knights Medicine card.
func (s *State) BlocksCityUpgrade(v board.Vertex, p PlayerID) error {
	if s.NewConstructionBlocked(v) {
		return ErrBadPlacement
	}
	for _, m := range s.Modules() {
		if h := m.Hooks().BlocksCityUpgrade; h != nil {
			if err := h(s, v, p); err != nil {
				return err
			}
		}
	}
	return nil
}

// buildBlockedVertex reports whether any module bars p from building at v.
func (s *State) buildBlockedVertex(v board.Vertex, p PlayerID) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().BuildBlockedVertex; h != nil && h(s, v, p) {
			return true
		}
	}
	return false
}

// buildBlockedEdge reports whether any module bars p from laying a road on e.
func (s *State) buildBlockedEdge(e board.Edge, p PlayerID) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().BuildBlockedEdge; h != nil && h(s, e, p) {
			return true
		}
	}
	return false
}

// SetupOwnedByModule reports whether a module has taken over the setup draft,
// so the base place_settlement / place_road commands are refused. Exported so
// bots do not propose base setup commands under such a module.
func (s *State) SetupOwnedByModule() bool { return setupOwnedByModule(s) }

// setupOwnedByModule reports whether a module has taken over the setup draft.
// See Hooks.OwnsSetup.
func setupOwnedByModule(s *State) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().OwnsSetup; h != nil && h(s) {
			return true
		}
	}
	return false
}

// requireUninterruptedTurn is requireActionableTurn without the roll
// requirement: p's own play turn with no robber, discard or module interrupt
// outstanding. Used by Road Building's free roads, which may be placed before
// rolling but must wait behind every interrupt (e.g. a Knights metropolis
// pick).
func requireUninterruptedTurn(s *State, p PlayerID) error {
	if s.Phase != PhasePlay {
		return ErrWrongPhase
	}
	if p != s.Cur {
		return ErrNotYourTurn
	}
	if len(s.PendingDiscards) > 0 {
		return ErrDiscardPending
	}
	if s.RobberPending {
		return ErrRobberPending
	}
	for _, m := range s.Modules() {
		h := m.Hooks()
		// A module may gate voluntary actions more loosely than its hard Blocks
		// (Knights defers the active player's progress-hand reconcile to end of turn).
		block := h.Blocks
		if h.BlocksTurnActions != nil {
			block = h.BlocksTurnActions
		}
		if block != nil && block(s) {
			return ErrModulePending
		}
	}
	return nil
}

// SellGoodAtMaritimeRate pays the owning module's maritime price for one unit
// of another module's currency. The whole payment is validated on a clone
// first, so a short hand is never partly spent.
func (s *State) SellGoodAtMaritimeRate(p PlayerID, good string) ([]Event, bool, error) {
	ratio := 0
	for _, m := range s.Modules() {
		if h := m.Hooks().GoodMaritimeRatios; h != nil {
			if n := h(s, p)[good]; n > 0 {
				ratio = n
				break
			}
		}
	}
	if ratio == 0 {
		return nil, false, nil
	}
	shadow := s.Clone()
	var out []Event
	for range ratio {
		events, ok, err := shadow.SellGoodToModule(p, good)
		if err != nil || !ok {
			return nil, ok, err
		}
		for _, event := range events {
			event.Seq = shadow.NextSeq
			if err := Apply(shadow, event); err != nil {
				return nil, true, err
			}
		}
		out = append(out, events...)
	}
	return out, true, nil
}
