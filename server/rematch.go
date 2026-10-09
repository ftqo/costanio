package server

import "github.com/ftqo/costan.io/game"

// Post-game rematch flow. When a game finishes, every connected player sees a
// post-game screen. Anyone can vote for a rematch (a live "N/M" tally); when the
// host clicks, a fresh lobby is created from the same config + still-present
// roster and everyone is pushed into it.

// handleRematch handles a `rematch` client frame from a player on the post-game
// screen. The host triggers the actual rematch; everyone else toggles a vote.
func (c *Conn) handleRematch(f clientFrame) {
	gameID := c.following()
	if gameID == "" || (f.Game != "" && f.Game != gameID) {
		c.sendErr(f.ID, "NOT_SUBSCRIBED", "Sub to the game first")
		return
	}
	g, err := c.srv.store.GameByID(gameID)
	if err != nil {
		c.sendErr(f.ID, "GAME_NOT_FOUND", "No such game")
		return
	}
	if g.Status != "finished" {
		c.sendErr(f.ID, "GAME_NOT_FINISHED", "Game is not finished")
		return
	}

	if g.CreatedBy == c.userID {
		c.srv.startRematch(c, f, gameID)
		return
	}

	// Non-host: toggle this user's rematch vote, then rebroadcast the tally.
	c.srv.rematchMu.Lock()
	set := c.srv.rematchWant[gameID]
	if set == nil {
		set = map[int64]bool{}
		c.srv.rematchWant[gameID] = set
	}
	if set[c.userID] {
		delete(set, c.userID)
	} else {
		set[c.userID] = true
	}
	c.srv.rematchMu.Unlock()
	c.srv.hub.BroadcastGame(gameID, c.srv.postgameFrame(gameID, false, ""))
}

// startRematch (host only) creates the new lobby from the finished game's
// roster and pushes every still-present player into it.
func (s *Server) startRematch(c *Conn, f clientFrame, gameID string) {
	present := s.hub.GameFollowers(gameID)
	sum, err := s.lobby.Rematch(c.user, gameID, present)
	if err != nil {
		// Don't leak the raw lobby error (internal "lobby:" wording) to clients.
		c.sendErr(f.ID, "REMATCH_FAILED", "Couldn't start the rematch")
		return
	}
	s.rematchMu.Lock()
	delete(s.rematchWant, gameID)
	s.rematchMu.Unlock()
	// Tell every post-game client where the rematch is. Seated players are
	// reseated and need no invite, but a spectator of a private game needs the
	// new lobby's invite code to subscribe, so carry it on the frame.
	frame := s.postgameFrame(gameID, false, sum.Game.ID)
	// Only for a private rematch. A public one needs no code, and handing one
	// out would let spectators keep access if the host later goes private.
	if rematch, ok := frame["rematch"].(map[string]any); ok && !sum.Game.Public {
		rematch["next_invite"] = sum.Game.InviteCode
	}
	s.hub.BroadcastGame(gameID, frame)
}

// postgameFrame builds the `postgame` server frame for a finished game: the
// rematch tally and, optionally, the full scoreboard (sent once on subscribe).
// `next` is the new game id once a rematch has been created.
func (s *Server) postgameFrame(gameID string, withScoreboard bool, next string) map[string]any {
	followers := s.hub.GameFollowers(gameID)
	seats, _ := s.store.Seats(gameID)
	humans := map[int64]bool{}
	for _, seat := range seats {
		if seat.Status != "bot" {
			humans[seat.UserID] = true
		}
	}
	eligible := 0
	for uid := range followers {
		if humans[uid] {
			eligible++
		}
	}
	s.rematchMu.Lock()
	want := 0
	for uid := range s.rematchWant[gameID] {
		if followers[uid] && humans[uid] {
			want++
		}
	}
	s.rematchMu.Unlock()

	rematch := map[string]any{"want": want, "eligible": eligible}
	if next != "" {
		rematch["next"] = next
	}
	frame := map[string]any{"t": "postgame", "game": gameID, "rematch": rematch}
	if withScoreboard {
		if sb, err := game.BuildScoreboard(s.store, gameID); err == nil {
			frame["scoreboard"] = sb.Players
			frame["winner"] = sb.Winner
			frame["rolls"] = sb.Rolls
			frame["turns"] = sb.Turns
			// Only when there is one: a game that ended before a turn began has no
			// track, and an empty array would make the client draw an empty axis.
			if len(sb.VPTrack) > 0 {
				frame["vp_track"] = sb.VPTrack
			}
		}
		if bv, err := game.BuildBoardView(s.store, gameID); err == nil {
			frame["board"] = bv
		}
	}
	return frame
}

// rematchActive reports whether any vote is recorded for a game (cheap check to
// skip needless rebroadcasts on disconnect).
func (s *Server) rematchActive(gameID string) bool {
	s.rematchMu.Lock()
	defer s.rematchMu.Unlock()
	return len(s.rematchWant[gameID]) > 0
}
