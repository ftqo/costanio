// Package server is the HTTP/websocket transport: REST API, the connection
// hub, and frame routing to lobby and game actors.
package server

import (
	"encoding/json"
	"sync"

	"github.com/coder/websocket"
)

// Hub tracks live websocket connections for presence, chat fan-out, and
// lobby/game notifications. Two secondary indexes keep the hot lookups
// O(matching conns) instead of O(all conns): byUser (a user's connections) and
// byGame (a game's followers). Both mirror the primary `conns` set and are
// maintained on add/remove and on follow changes (setFollowing).
type Hub struct {
	mu     sync.Mutex
	conns  map[*Conn]struct{}
	byUser map[int64]map[*Conn]struct{}
	// byGame indexes connections by the game they currently follow. The empty
	// string (following nothing) is not indexed. Updated by setFollowing whenever
	// a conn's followed game changes (sub/attach/detach) and cleared on remove.
	byGame   map[string]map[*Conn]struct{}
	followed map[*Conn]string // each conn's current followed game (for index upkeep)
}

func NewHub() *Hub {
	return &Hub{
		conns:    map[*Conn]struct{}{},
		byUser:   map[int64]map[*Conn]struct{}{},
		byGame:   map[string]map[*Conn]struct{}{},
		followed: map[*Conn]string{},
	}
}

func (h *Hub) add(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[c] = struct{}{}
	if h.byUser[c.userID] == nil {
		h.byUser[c.userID] = map[*Conn]struct{}{}
	}
	h.byUser[c.userID][c] = struct{}{}
	// Index whatever game the conn already follows. Normal conns are added with an
	// empty gameID (they sub later, via setFollowing), but a conn constructed
	// already-following must land in byGame here so fan-out/presence see it.
	if gid := c.gameID; gid != "" && h.followed[c] != gid {
		if h.byGame[gid] == nil {
			h.byGame[gid] = map[*Conn]struct{}{}
		}
		h.byGame[gid][c] = struct{}{}
		h.followed[c] = gid
	}
}

func (h *Hub) remove(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.conns, c)
	if set := h.byUser[c.userID]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(h.byUser, c.userID)
		}
	}
	h.unindexGameLocked(c)
}

// setFollowing records the game a connection now follows, maintaining the byGame
// index. Pass "" when the conn stops following (unsub/detach). Idempotent.
func (h *Hub) setFollowing(c *Conn, gameID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.followed[c] == gameID {
		return
	}
	h.unindexGameLocked(c)
	if gameID != "" {
		if h.byGame[gameID] == nil {
			h.byGame[gameID] = map[*Conn]struct{}{}
		}
		h.byGame[gameID][c] = struct{}{}
		h.followed[c] = gameID
	}
}

// unindexGameLocked removes c from its current byGame bucket. Caller holds mu.
func (h *Hub) unindexGameLocked(c *Conn) {
	if prev := h.followed[c]; prev != "" {
		if set := h.byGame[prev]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(h.byGame, prev)
			}
		}
		delete(h.followed, c)
	}
}

// Online reports whether the user has any live connection.
func (h *Hub) Online(userID int64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.byUser[userID]) > 0
}

// FollowingGame reports whether the user has any live connection currently
// following this game. It is the per-game counterpart to Online: the socket stays
// open across navigation, so a user on the homepage in a second tab is Online
// while following nothing. The seat-absent and suspend/abandon paths need
// presence at the table (see anyHumanPresent).
func (h *Hub) FollowingGame(gameID string, userID int64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.byGame[gameID] {
		if c.userID == userID {
			return true
		}
	}
	return false
}

// Broadcast sends a frame to every connection (lobby-wide announcements).
func (h *Hub) Broadcast(frame any) {
	raw, err := json.Marshal(frame)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.conns {
		c.trySend(raw)
	}
}

// GameFollowers returns the distinct user ids currently following a game
// (seated or spectating). O(followers) via the byGame index. Used to size the
// post-game rematch tally; only players still on the post-game screen count.
func (h *Hub) GameFollowers(gameID string) map[int64]bool {
	out := map[int64]bool{}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.byGame[gameID] {
		out[c.userID] = true
	}
	return out
}

// SpectatorCount returns how many distinct following users are not seated
// (i.e. watching only). `seated` is the set of seated user ids for the game.
// O(followers) via the byGame index.
func (h *Hub) SpectatorCount(gameID string, seated map[int64]bool) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	seen := map[int64]bool{}
	for c := range h.byGame[gameID] {
		if !seated[c.userID] {
			seen[c.userID] = true
		}
	}
	return len(seen)
}

// SendToUser delivers a frame to every live connection of one user (ranked
// match-found pushes). Never blocks (trySend drops to stuck clients).
func (h *Hub) SendToUser(userID int64, frame any) {
	raw, err := json.Marshal(frame)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.byUser[userID] {
		c.trySend(raw)
	}
}

// CloseAll sends a websocket Close frame (with the given code/reason) to every
// live connection, then shuts each socket. On graceful shutdown this tells
// clients to reconnect now rather than notice a dead upstream through
// Cloudflare/nginx. coder/websocket serializes writes per connection, so this is
// safe alongside each write pump. Game state is durable, so clients just
// reconnect (code 1012 "Service Restart"; the web client reconnects on any
// close).
func (h *Hub) CloseAll(code websocket.StatusCode, reason string) {
	// Snapshot under the lock, then write outside it: Close can block on the
	// close handshake with a wedged client, and we must not hold the hub mutex
	// (which every fan-out path needs) for that long.
	h.mu.Lock()
	conns := make([]*Conn, 0, len(h.conns))
	for c := range h.conns {
		// A Conn with no socket is a test fixture registered directly with the
		// hub; closing a nil *websocket.Conn would panic. Real Conns always have
		// a socket.
		if c.ws == nil {
			continue
		}
		conns = append(conns, c)
	}
	h.mu.Unlock()
	// Close each conn concurrently so one wedged client can't serialize the whole
	// fleet behind its handshake grace period during shutdown.
	var wg sync.WaitGroup
	for _, c := range conns {
		wg.Add(1)
		go func(c *Conn) {
			defer wg.Done()
			_ = c.ws.Close(code, reason)
			c.closeWS()
		}(c)
	}
	wg.Wait()
}

// BroadcastGame sends a frame to connections following a game (seated or
// spectating, in lobby or play). O(followers) via the byGame index.
func (h *Hub) BroadcastGame(gameID string, frame any) {
	raw, err := json.Marshal(frame)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.byGame[gameID] {
		c.trySend(raw)
	}
}
