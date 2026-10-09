package server

import (
	"time"
)

// suspendAbandonGrace is how long a game with no connected humans stays frozen
// (resumable) before it is abandoned.
const suspendAbandonGrace = 3 * time.Minute

// anyHumanPresent reports whether any human-owned seat (store status != "bot")
// is currently following this game. Presence is per game: the socket stays open
// across navigation, so a player who left for the lobby or another table is
// still hub.Online but must not keep this game alive.
func (s *Server) anyHumanPresent(gameID string) bool {
	seats, err := s.store.Seats(gameID)
	if err != nil {
		return false
	}
	followers := s.hub.GameFollowers(gameID)
	for _, seat := range seats {
		if seat.Status != "bot" && followers[seat.UserID] {
			return true
		}
	}
	// The host keeps their own table alive even as an unseated spectator (e.g.
	// watching an all-bot game). Other spectators don't; a game whose seated
	// players all left still suspends.
	if g, err := s.store.GameByID(gameID); err == nil && followers[g.CreatedBy] {
		return true
	}
	return false
}

// reconcileGamePresence freezes or resumes a game based on whether any human is
// connected, and manages the abandon grace timer. Only acts on active games.
func (s *Server) reconcileGamePresence(gameID string) {
	g, err := s.store.GameByID(gameID)
	if err != nil || g.Status != "active" {
		s.cancelSuspendAbandon(gameID)
		return
	}
	if s.anyHumanPresent(gameID) {
		s.mgr.ResumeGame(gameID)
		s.cancelSuspendAbandon(gameID)
		return
	}
	s.mgr.SuspendGame(gameID)
	s.scheduleSuspendAbandon(gameID)
}

func (s *Server) scheduleSuspendAbandon(gameID string) {
	s.suspendMu.Lock()
	defer s.suspendMu.Unlock()
	if t, ok := s.suspending[gameID]; ok {
		t.Stop()
	}
	s.suspending[gameID] = s.clock.AfterFunc(suspendAbandonGrace, func() {
		s.fireSuspendAbandon(gameID)
	})
}

func (s *Server) cancelSuspendAbandon(gameID string) {
	s.suspendMu.Lock()
	defer s.suspendMu.Unlock()
	if t, ok := s.suspending[gameID]; ok {
		t.Stop()
		delete(s.suspending, gameID)
	}
}

// fireSuspendAbandon abandons a still-frozen game once the grace elapses, unless
// a human came back in the meantime.
func (s *Server) fireSuspendAbandon(gameID string) {
	s.suspendMu.Lock()
	delete(s.suspending, gameID)
	s.suspendMu.Unlock()
	if s.anyHumanPresent(gameID) {
		return
	}
	g, err := s.store.GameByID(gameID)
	if err != nil || g.Status != "active" {
		return
	}
	if err := s.lobby.AbandonActive(gameID); err != nil {
		return
	}
	s.hub.BroadcastGame(gameID, map[string]any{"t": "lobby", "game": gameID, "closed": true})
}
