package server

import (
	"log/slog"
	"time"

	"github.com/ftqo/costan.io/store"
)

// Orphaned-lobby reaping.
//
// A disconnected player's lobby seat is normally vacated 30s later by the
// in-memory grace timer (scheduleLobbyLeave / fireLobbyLeave), which does not
// survive a restart. A seat left behind that way stays as a 'lobby' row, and
// SeatedGameForUser keeps reporting it, so the client's rejoin dock points at a
// dead lobby. This periodic sweep reclaims lobbies that have lost every human
// tether.

const (
	// orphanLobbyReapEvery is how often the orphaned-lobby sweep runs.
	orphanLobbyReapEvery = time.Minute
	// orphanLobbyMinAge spares a freshly-created lobby, covering the gap between
	// the row being written and its creator subscribing. Well above
	// lobbyLeaveGrace, so the in-memory path handles the common case.
	orphanLobbyMinAge = 2 * time.Minute
	// orphanLobbyStartDelay holds the first sweep off until reconnections after a
	// boot/deploy have settled (the client reconnect backoff caps at 8s), so a
	// live lobby whose players are momentarily disconnected is not reaped.
	orphanLobbyStartDelay = time.Minute
)

// orphanedLobbies returns the ids of lobby games with no remaining human tether:
// the creator is offline, none of the seated users is connected, nobody is
// following the game, and it is older than minAge. These are the seats
// fireLobbyLeave would have vacated. Pure, so it is unit-testable; the caller
// supplies the online/follower lookups.
func orphanedLobbies(
	lobbies []*store.Game,
	seats map[string][]*store.Seat,
	online func(int64) bool,
	hasFollowers func(string) bool,
	now time.Time,
	minAge time.Duration,
) []string {
	var orphaned []string
	for _, g := range lobbies {
		if g.Status != "lobby" {
			continue
		}
		if now.Sub(time.Unix(g.CreatedAt, 0)) < minAge {
			continue // too new to judge
		}
		if hasFollowers(g.ID) {
			continue // someone is actively connected to it
		}
		// The host owns the table even while spectating it with no seat, so an
		// online creator counts as a tether, like a seated player. Otherwise a
		// bots-only lobby would be reaped when the host steps away to the map
		// builder.
		anyOnline := online(g.CreatedBy)
		for _, s := range seats[g.ID] {
			if anyOnline {
				break
			}
			if online(s.UserID) {
				anyOnline = true
			}
		}
		if anyOnline {
			continue // the host or a seated player still has the site open; keep it
		}
		orphaned = append(orphaned, g.ID)
	}
	return orphaned
}

// StartLobbyReaper launches the self-rescheduling orphaned-lobby sweep. Call
// once after construction. The first sweep is delayed (orphanLobbyStartDelay) so
// post-boot reconnections settle before any lobby is judged deserted.
func (s *Server) StartLobbyReaper() {
	s.clock.AfterFunc(orphanLobbyStartDelay, func() {
		s.sweepOrphanLobbiesOnce(time.Now())
		s.startLobbyReaperTick()
	})
}

func (s *Server) startLobbyReaperTick() {
	s.clock.AfterFunc(orphanLobbyReapEvery, func() {
		s.sweepOrphanLobbiesOnce(time.Now())
		s.startLobbyReaperTick()
	})
}

// sweepOrphanLobbiesOnce reclaims every currently-orphaned lobby by closing it
// (drops its seats and marks the row abandoned), mirroring a host-leave teardown.
func (s *Server) sweepOrphanLobbiesOnce(now time.Time) {
	lobbies, err := s.store.ListGames("lobby", true) // include private/invite lobbies
	if err != nil {
		slog.Error("orphan-lobby sweep: list lobbies", "err", err)
		return
	}
	if len(lobbies) == 0 {
		return
	}
	ids := make([]string, 0, len(lobbies))
	for _, g := range lobbies {
		ids = append(ids, g.ID)
	}
	seats, err := s.store.SeatsForGames(ids)
	if err != nil {
		slog.Error("orphan-lobby sweep: load seats", "err", err)
		return
	}
	online := func(uid int64) bool { return s.hub.Online(uid) }
	hasFollowers := func(id string) bool { return len(s.hub.GameFollowers(id)) > 0 }
	for _, id := range orphanedLobbies(lobbies, seats, online, hasFollowers, now, orphanLobbyMinAge) {
		if err := s.lobby.Close(id); err != nil {
			slog.Warn("orphan-lobby sweep: close", "game", id, "err", err)
			continue
		}
		slog.Info("orphan-lobby sweep: reclaimed deserted lobby", "game", id)
	}
}
