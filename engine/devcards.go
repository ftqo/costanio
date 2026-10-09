package engine

import "github.com/ftqo/costan.io/engine/board"

func devCardsDisabled(s *State) bool {
	for _, m := range s.Modules() {
		if m.Hooks().NoDevCards {
			return true
		}
	}
	return false
}

func decideBuyDevCard(s *State, cmd Command) ([]Event, error) {
	if devCardsDisabled(s) {
		return nil, ErrUnknownCommand
	}
	if err := requireBuildTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	base := s.DevDeck.Count()
	if base+moduleDevCards(s) == 0 {
		return nil, ErrDeckEmpty
	}
	if !s.Players[cmd.Player].Hand.Has(CostDevCard) {
		return nil, noResources(CostDevCard, s.Players[cmd.Player].Hand)
	}
	// One draw over the whole deck, base kinds plus every module's cards (Wagons'
	// Swift Journey), so a module card is as likely as its share of the deck and
	// runs out with its supply. With no module cards the draw is the same as
	// before (same stream slot, same branch), so existing logs replay unchanged.
	idx := rngFor(s.Seed, s.NextSeq).IntN(base + moduleDevCards(s))
	if idx >= base {
		if ev, ok := drawModuleDevCard(s, cmd.Player, idx-base, 0); ok {
			return []Event{ev}, nil
		}
		// A module that declines its slot falls back to the base deck, which is empty
		// only if it declined every slot and the deck is out. Guard rather than draw
		// over zero.
		if base == 0 {
			return nil, ErrDeckEmpty
		}
		idx = base - 1
	}
	card := devCardAt(s.DevDeck, idx)
	return []Event{mustEvent(EvDevCardBought, DevCardBoughtData{Player: cmd.Player, Card: card}, cmd.Player)}, nil
}

// moduleDevCards is how many module-owned cards are currently shuffled into the
// development deck. See Hooks.ExtraDevCards.
func moduleDevCards(s *State) int {
	n := 0
	for _, m := range s.Modules() {
		if h := m.Hooks().ExtraDevCards; h != nil {
			if c := h(s); c > 0 {
				n += c
			}
		}
	}
	return n
}

// drawModuleDevCard hands the idx'th module-owned card (counted across every
// module's block, in ruleset order) to p. See Hooks.DrawExtraDevCard.
func drawModuleDevCard(s *State, p PlayerID, idx, offset int) (Event, bool) {
	for _, m := range s.Modules() {
		h := m.Hooks()
		if h.ExtraDevCards == nil || h.DrawExtraDevCard == nil {
			continue
		}
		n := h.ExtraDevCards(s)
		if n <= 0 {
			continue
		}
		if idx < n {
			return h.DrawExtraDevCard(s, p, idx, offset)
		}
		idx -= n
	}
	return Event{}, false
}

// DrawDevCard is the module-facing draw (offset positions the rng at the event
// seq the draw will occupy). It draws from the base deck only, for free cards
// granted by another effect (Fishermen's seven-fish spend).
func DrawDevCard(s *State, offset int) DevCard {
	return devCardAt(s.DevDeck, rngFor(s.Seed, s.NextSeq+offset).IntN(s.DevDeck.Count()))
}

// devCardAt maps an index into a deck's flattened card list to its kind.
func devCardAt(deck DevHand, idx int) DevCard {
	for c, n := range deck {
		if idx < n {
			return DevCard(c)
		}
		idx -= n
	}
	panic("engine: dev deck accounting broken")
}

func decidePlayDevCard(s *State, cmd Command) ([]Event, error) {
	if devCardsDisabled(s) {
		return nil, ErrUnknownCommand
	}
	if s.Phase != PhasePlay {
		return nil, ErrWrongPhase
	}
	if cmd.Player != s.Cur {
		return nil, ErrNotYourTurn
	}
	if len(s.PendingDiscards) > 0 {
		return nil, ErrDiscardPending
	}
	if s.RobberPending {
		return nil, ErrRobberPending
	}
	if s.PlayedDevThisTurn {
		return nil, ErrDevAlreadyPlayed
	}
	d, err := decodeCmd[struct {
		Card DevCard        `json:"card"`
		Gain *Hand          `json:"gain,omitempty"` // year of plenty
		Res  board.Resource `json:"res,omitempty"`  // monopoly
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.Card < 0 || d.Card >= devCardKinds || d.Card == DevVictoryPoint {
		return nil, ErrBadCommand // VP cards are never played
	}
	if s.Players[cmd.Player].DevCards[d.Card] == 0 {
		return nil, ErrNoSuchCard // cards bought this turn are locked
	}
	// A development card may be played at any point in your turn, including before
	// the roll; the limits (one per turn, not the turn it was bought) are enforced
	// elsewhere.

	switch d.Card {
	case DevKnight:
		events := []Event{mustEvent(EvKnightPlayed, DevPlayedData{Player: cmd.Player})}
		// Largest army: 3+ knights, strictly more than the current holder.
		knights := s.Players[cmd.Player].KnightsPlayed + 1
		if knights >= 3 && s.LargestArmyHolder != cmd.Player {
			holderKnights := 0
			if s.LargestArmyHolder != NoPlayer {
				holderKnights = s.Players[s.LargestArmyHolder].KnightsPlayed
			}
			if knights > holderKnights {
				events = append(events, mustEvent(EvLargestArmy, TitleData{Holder: cmd.Player}))
			}
		}
		return events, nil

	case DevRoadBuilding:
		if s.Players[cmd.Player].RoadsLeft == 0 {
			return nil, noPieces(PieceRoad)
		}
		return []Event{mustEvent(EvRoadBuilding, DevPlayedData{Player: cmd.Player})}, nil

	case DevYearOfPlenty:
		if d.Gain == nil || !d.Gain.NonNegative() || d.Gain.Count() != 2 {
			return nil, ErrBadCommand
		}
		if !s.Bank.Has(*d.Gain) {
			return nil, ErrNoResources
		}
		return []Event{mustEvent(EvYearOfPlenty, YearOfPlentyData{Player: cmd.Player, Gain: *d.Gain})}, nil

	case DevMonopoly:
		if !validResource(d.Res) {
			return nil, ErrBadCommand
		}
		var takes []MonopolyTake
		for p := range s.Players {
			if PlayerID(p) == cmd.Player {
				continue
			}
			if n := s.Players[p].Hand[d.Res]; n > 0 {
				takes = append(takes, MonopolyTake{Player: PlayerID(p), Count: n})
			}
		}
		return []Event{mustEvent(EvMonopoly, MonopolyData{Player: cmd.Player, Res: d.Res, Takes: takes})}, nil
	default: // other dev card types are handled by modules or elsewhere
	}
	return nil, ErrBadCommand
}
