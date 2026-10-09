package ranked

import (
	"errors"
	"sync"
	"time"

	"github.com/ftqo/costan.io/rating"
	"github.com/ftqo/costan.io/store"
)

var (
	ErrUnknownQueue  = errors.New("unknown ranked queue")
	ErrOnCooldown    = errors.New("ranked cooldown active")
	ErrAlreadyQueued = errors.New("already in a ranked queue")
)

// Matcher is the lobby seam: creates a ranked game, seats the users, and
// starts it. Implemented by lobby.Lobby.CreateRankedMatch.
type Matcher interface {
	CreateRankedMatch(queueKey string, userIDs []int64) (string, error)
}

// Notifier delivers a match-found signal to each matched user (e.g. via
// websocket hub). Implemented by the server hub.
type Notifier interface {
	MatchFound(userID int64, gameID string)
}

// Ratings is the store seam for eligibility checks. store.Store satisfies
// this interface directly.
type Ratings interface {
	RatingRow(userID int64, ruleset string) (store.Rating, error)
	RankedCooldownUntil(userID int64) (int64, error)
}

// Service is a concurrency-safe matchmaker. It holds per-queue entry pools and
// runs a tick loop that forms groups and triggers game creation.
type Service struct {
	matcher Matcher
	notify  Notifier
	ratings Ratings
	now     func() int64

	mu      sync.Mutex
	pools   map[string][]entry // queueKey -> waiting entries
	inQueue map[int64]string   // userID -> queueKey (one queue at a time)
	tick    int64
}

// NewService constructs a Service. now is a clock seam (typically
// func() int64 { return time.Now().Unix() }).
func NewService(m Matcher, n Notifier, r Ratings, now func() int64) *Service {
	pools := make(map[string][]entry, len(Queues))
	for _, q := range Queues {
		pools[q.Key] = nil
	}
	return &Service{
		matcher: m,
		notify:  n,
		ratings: r,
		now:     now,
		pools:   pools,
		inQueue: map[int64]string{},
	}
}

// rulesetFor looks up the ruleset for a queue key.
func rulesetFor(queueKey string) (string, bool) {
	for _, q := range Queues {
		if q.Key == queueKey {
			return q.Ruleset, true
		}
	}
	return "", false
}

// Join adds userID to queueKey. Returns an error if the queue is unknown,
// the user is on cooldown, or they are already in any queue.
func (s *Service) Join(userID int64, queueKey string) error {
	ruleset, ok := rulesetFor(queueKey)
	if !ok {
		return ErrUnknownQueue
	}

	// Rating lookup can happen outside the lock: a stale rating only affects
	// matchmaking quality, not correctness.
	row, err := s.ratings.RatingRow(userID, ruleset)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, queued := s.inQueue[userID]; queued {
		return ErrAlreadyQueued
	}
	// Read the cooldown under the lock, right before enrolling, so a
	// BumpRankedStrike committed in between can't let a freshly penalized player
	// into the queue.
	until, err := s.ratings.RankedCooldownUntil(userID)
	if err != nil {
		return err
	}
	if until > s.now() {
		return ErrOnCooldown
	}
	s.pools[queueKey] = append(s.pools[queueKey], entry{
		userID:      userID,
		rating:      float64(row.Display),
		provisional: row.Sigma > rating.ProvisionalSigma,
		joinedTick:  s.tick,
	})
	s.inQueue[userID] = queueKey
	return nil
}

// Leave removes userID from any queue they are in (no-op if not queued).
func (s *Service) Leave(userID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeLocked(userID)
}

// removeLocked removes userID from their pool and inQueue. Caller must hold mu.
func (s *Service) removeLocked(userID int64) {
	qk, ok := s.inQueue[userID]
	if !ok {
		return
	}
	pool := s.pools[qk]
	for i, e := range pool {
		if e.userID == userID {
			s.pools[qk] = append(pool[:i], pool[i+1:]...)
			break
		}
	}
	delete(s.inQueue, userID)
}

// Status reports whether userID is queued, and the current pool size for their
// queue. Returns ("", false, 0) if not queued.
func (s *Service) Status(userID int64) (queueKey string, queued bool, poolSize int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	qk, ok := s.inQueue[userID]
	if !ok {
		return "", false, 0
	}
	return qk, true, len(s.pools[qk])
}

// Tick advances the internal tick counter, forms groups from each pool, then
// creates and notifies matches. Game creation runs outside the lock so a slow
// CreateRankedMatch doesn't stall Join/Leave/Status.
//
// If CreateRankedMatch fails, the group's entries go back into their pool with
// their original joinedTick, so accrued wait is kept. A user who re-joined in
// the meantime is not inserted twice.
func (s *Service) Tick() {
	s.mu.Lock()
	s.tick++

	type formed struct {
		queueKey string
		entries  []entry
	}
	var toMake []formed

	for qk, pool := range s.pools {
		groups, remaining := formGroups(pool, s.tick)
		s.pools[qk] = remaining
		for _, group := range groups {
			// Dequeue matched players under the lock.
			for _, e := range group {
				delete(s.inQueue, e.userID)
			}
			toMake = append(toMake, formed{qk, group})
		}
	}
	s.mu.Unlock()

	// Game creation is lock-free: slow DB/engine calls won't block queue ops.
	for _, f := range toMake {
		ids := make([]int64, len(f.entries))
		for i, e := range f.entries {
			ids[i] = e.userID
		}
		gameID, err := s.matcher.CreateRankedMatch(f.queueKey, ids)
		if err != nil {
			// Re-enqueue: re-acquire the lock briefly and restore each entry,
			// skipping any user who re-joined the queue in the gap.
			s.mu.Lock()
			for _, e := range f.entries {
				if _, alreadyBack := s.inQueue[e.userID]; !alreadyBack {
					s.pools[f.queueKey] = append(s.pools[f.queueKey], e)
					s.inQueue[e.userID] = f.queueKey
				}
			}
			s.mu.Unlock()
			continue
		}
		for _, id := range ids {
			s.notify.MatchFound(id, gameID)
		}
	}
}

// Run calls Tick on every interval tick until stop is closed.
func (s *Service) Run(stop <-chan struct{}, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			s.Tick()
		}
	}
}
