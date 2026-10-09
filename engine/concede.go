package engine

// Ending a game the players cannot finish.
//
// Some positions are unwinnable for everyone (a sole leader holding the
// Fishermen old boot who can no longer gain a point). This is not detected
// automatically: in simulation, "turns since anyone's VP changed" has no
// stable maximum, so no threshold is safe. The players end it themselves:
//
//   - surrender: at exactly two seats, in play and after SurrenderMinTurns, one
//     player concedes and the other wins.
//   - draw: after DrawMinTurns, any seat may offer (once per turn each); the
//     game is drawn when every other seat accepts. There is no unilateral draw
//     claim, since it would need that missing non-progress condition and could
//     rob a leader about to score.
//   - claim: after DrawMinTurns, a player whose opponents are all bots ends the
//     game without consent. They win only if strictly ahead on true VP;
//     otherwise it is a draw, so the claim cannot be farmed for wins.
//
// The engine knows nothing about bots. It enforces the threshold and the
// ahead-of-everyone test for CmdClaimGame; the game layer refuses the command
// unless every other seat is bot-controlled.

import "slices"

// DrawMinTurns is how many completed turns a game must have before a draw may
// be offered or a claim made. Median games run 70 to 107 turns and the longest
// seen ran 601, so 200 is past a normal game but reachable by a long one.
// Passing it only unlocks an offer; nothing ends without consent (or, for a
// claim, being ahead of bots).
const DrawMinTurns = 200

// SurrenderMinTurns is how many completed turns a duel must have before a
// player may concede. Conceding a decided game early is fine, but conceding
// before anyone has moved is an abort, which is the host's reset. Six turns is
// three each at two seats, enough for both to roll, collect and build. The
// floor also stops two accounts minting match payouts by conceding at turn
// zero (Manager.matchCredits enforces it too).
const SurrenderMinTurns = 6

// DrawOffer is the single open offer to end the game in a draw. It is cleared
// when anyone declines, when the turn ends, and when the game finishes.
type DrawOffer struct {
	By PlayerID `json:"by"`
	// Accepted lists the seats that have agreed so far (never includes By).
	Accepted []PlayerID `json:"accepted,omitempty"`
}

// HasAccepted reports whether seat p has already agreed to this offer. A
// decline clears the whole offer, so "responded" and "accepted" are the same
// question. Exported because the game layer drives bot seats' acceptances.
func (o *DrawOffer) HasAccepted(p PlayerID) bool {
	return slices.Contains(o.Accepted, p)
}

// decideSurrender concedes a duel. Only at exactly two seats: with more,
// leaving hands the seat to a bot instead. Legal on either player's turn. Not
// legal in setup or before SurrenderMinTurns; aborting an unplayed game is the
// host's reset.
func decideSurrender(s *State, cmd Command) ([]Event, error) {
	if s.Config.Players != 2 {
		return nil, ErrNotDuel
	}
	if s.Phase != PhasePlay {
		return nil, ErrWrongPhase
	}
	if s.TurnsCompleted < SurrenderMinTurns {
		return nil, ErrSurrenderTooEarly
	}
	opp := PlayerID(1 - int(cmd.Player))
	if int(opp) >= len(s.Players) {
		return nil, ErrNotDuel
	}
	return []Event{
		mustEvent(EvSurrendered, SurrenderedData{Player: cmd.Player}),
		mustEvent(EvGameFinished, GameFinishedData{Winner: opp, VP: s.VPWithModules(opp), Scores: finalScores(s)}),
	}, nil
}

// decideOfferDraw opens a draw offer. Any seated player may offer, on anyone's
// turn, once the game is long enough to be plausibly stuck, but only once per
// turn each. A decline clears the offer, so without the cap offer and decline
// could loop. The cap lives in the engine (DrawOffersUsed folds from the log)
// so replay agrees with it.
func decideOfferDraw(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay {
		return nil, ErrWrongPhase
	}
	if s.TurnsCompleted < DrawMinTurns {
		return nil, ErrDrawTooEarly
	}
	if s.DrawOffer != nil {
		return nil, ErrDrawPending
	}
	// Not while somebody owes a forced decision (a discard, a robber move, a module
	// pick): the offer is a modal prompt and would interrupt a timed decision.
	if forcedDecisionPending(s) {
		return nil, ErrModulePending
	}
	if drawOfferUsed(s, cmd.Player) {
		return nil, ErrDrawOfferUsed
	}
	return []Event{mustEvent(EvDrawOffered, DrawOfferedData{Player: cmd.Player})}, nil
}

// forcedDecisionPending reports whether any seat currently owes a decision it
// did not choose: over-7 discards, a robber move, or a module block. A standing
// trade offer is voluntary and does not count.
func forcedDecisionPending(s *State) bool {
	if len(s.PendingDiscards) > 0 || s.RobberPending {
		return true
	}
	for _, m := range s.Modules() {
		if h := m.Hooks().Blocks; h != nil && h(s) {
			return true
		}
	}
	return false
}

// drawOfferUsed reports whether p has already offered a draw this turn.
func drawOfferUsed(s *State, p PlayerID) bool {
	return slices.Contains(s.DrawOffersUsed, p)
}

// decideCancelDraw withdraws an open offer; only its owner may. The actor also
// sends this for the offerer when the offer expires, as it does for stale trade
// offers, so an offer cannot stay open on a table with no turn timer.
func decideCancelDraw(s *State, cmd Command) ([]Event, error) {
	if s.DrawOffer == nil {
		return nil, ErrNoDrawOffer
	}
	if s.DrawOffer.By != cmd.Player {
		return nil, ErrNoDrawOffer
	}
	return []Event{mustEvent(EvDrawCancelled, DrawCancelledData{Player: cmd.Player})}, nil
}

// respondDrawCmd is the answer to an open offer. Accept is a pointer so a
// missing or null field is rejected instead of reading as a decline.
type respondDrawCmd struct {
	Accept *bool `json:"accept"`
}

// decideRespondDraw accepts or declines the open draw offer. A decline ends the
// offer outright (one refusal is enough); the final acceptance ends the game
// with no winner.
func decideRespondDraw(s *State, cmd Command) ([]Event, error) {
	o := s.DrawOffer
	if o == nil {
		return nil, ErrNoDrawOffer
	}
	if cmd.Player == o.By {
		return nil, ErrNoDrawOffer // your own offer is not yours to answer
	}
	if o.HasAccepted(cmd.Player) {
		return nil, ErrAlreadyResponded
	}
	d, err := decodeCmd[respondDrawCmd](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.Accept == nil {
		return nil, ErrBadCommand
	}
	events := []Event{mustEvent(EvDrawResponded, DrawRespondedData{Player: cmd.Player, Accept: *d.Accept})}
	if !*d.Accept {
		return events, nil
	}
	if !drawUnanimous(s, o, cmd.Player) {
		return events, nil
	}
	return append(events, mustEvent(EvGameFinished, GameFinishedData{Winner: NoPlayer, VP: 0, Scores: finalScores(s)})), nil
}

// finalScores is every seat's total, hidden victory-point cards included, for
// GameFinishedData.Scores.
func finalScores(s *State) []int {
	out := make([]int, len(s.Players))
	for i := range s.Players {
		out[i] = s.VPWithModules(PlayerID(i))
	}
	return out
}

// drawUnanimous reports whether accepting for seat responder completes the
// offer: every seat other than the offerer has now accepted.
func drawUnanimous(s *State, o *DrawOffer, responder PlayerID) bool {
	for q := range s.Players {
		seat := PlayerID(q)
		if seat == o.By || seat == responder {
			continue
		}
		if !o.HasAccepted(seat) {
			return false
		}
	}
	return true
}

// decideClaimGame ends a game against bot opponents. The caller (game layer)
// has already established that every other seat is bot-controlled; the engine
// checks the threshold and whether the claimer has actually earned the win.
func decideClaimGame(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay {
		return nil, ErrWrongPhase
	}
	if s.TurnsCompleted < DrawMinTurns {
		return nil, ErrDrawTooEarly
	}
	winner, vp := NoPlayer, 0
	if aheadOfAll(s, cmd.Player) {
		winner = cmd.Player
		vp = s.VPWithModules(winner)
	}
	return []Event{
		mustEvent(EvGameClaimed, GameClaimedData{Player: cmd.Player, Winner: winner}),
		mustEvent(EvGameFinished, GameFinishedData{Winner: winner, VP: vp, Scores: finalScores(s)}),
	}, nil
}

// aheadOfAll reports whether p is strictly ahead of every other seat on true
// victory points, hidden VP cards included. Public VP is not enough: a player
// could claim while behind on hidden VP cards, which an opponent can count from
// the public log. The engine holds the hidden cards, so nothing is
// client-supplied. Ties do not count as ahead, so a level game claims as a
// draw.
func aheadOfAll(s *State, p PlayerID) bool {
	mine := s.VPWithModules(p)
	for q := range s.Players {
		if PlayerID(q) == p {
			continue
		}
		if s.VPWithModules(PlayerID(q)) >= mine {
			return false
		}
	}
	return true
}
