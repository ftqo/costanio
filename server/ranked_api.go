package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/ranked"
)

// rankedNotifier pushes match-found frames over the hub.
type rankedNotifier struct{ hub *Hub }

func (n rankedNotifier) MatchFound(userID int64, gameID string) {
	n.hub.SendToUser(userID, map[string]any{"t": "ranked_match_found", "game": gameID})
}

// lobbyMatcher adapts the lobby to ranked.Matcher. It also announces the match
// to the Discord feed: ranked matches start in the matchmaker, not the start
// handler, so postGameFeed isn't otherwise called for them.
type lobbyMatcher struct {
	lobby *lobby.Lobby
	srv   *Server
}

func (m lobbyMatcher) CreateRankedMatch(queueKey string, ids []int64) (string, error) {
	id, err := m.lobby.CreateRankedMatch(queueKey, ids)
	if err != nil {
		return "", err
	}
	m.srv.bg.Go(func() { m.srv.postGameFeed(id) }) // best-effort; never blocks or fails the match
	return id, nil
}

func (s *Server) handleRankedJoin(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if u.IsGuest {
		writeErr(w, http.StatusForbidden, "RANKED_REQUIRES_ACCOUNT", "Ranked requires an account")
		return
	}
	var body struct {
		Queue string `json:"queue"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	switch err := s.ranked.Join(u.ID, body.Queue); {
	case err == nil:
		s.detachFromOthers(u, "")
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, ranked.ErrUnknownQueue):
		writeErr(w, http.StatusBadRequest, "UNKNOWN_QUEUE", "Unknown queue")
	case errors.Is(err, ranked.ErrOnCooldown):
		writeErr(w, http.StatusTooManyRequests, "ON_COOLDOWN", "Ranked cooldown active")
	case errors.Is(err, ranked.ErrAlreadyQueued):
		writeErr(w, http.StatusConflict, "ALREADY_QUEUED", "Already queued")
	default:
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Queue failed")
	}
}

func (s *Server) handleRankedLeave(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	s.ranked.Leave(u.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRankedStatus(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	qk, queued, pool := s.ranked.Status(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"queued": queued, "queue": qk, "pool": pool})
}
