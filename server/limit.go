package server

import (
	"sync"
	"time"
)

// tokenBucket is a tiny rate limiter: refill tokens/sec up to burst.
type tokenBucket struct {
	mu     sync.Mutex
	tokens float64
	rate   float64
	burst  float64
	last   time.Time
}

func newTokenBucket(rate, burst float64) *tokenBucket {
	return &tokenBucket{tokens: burst, rate: rate, burst: burst, last: time.Now()}
}

// refill accrues tokens for the time elapsed since the last touch. Caller holds
// b.mu.
func (b *tokenBucket) refill() {
	now := time.Now()
	b.tokens += now.Sub(b.last).Seconds() * b.rate
	b.last = now
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
}

func (b *tokenBucket) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.refill()
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// charge deducts cost tokens without gating, letting the balance go negative
// down to -burst. It is the second half of a pay-after-serving limit: allow()
// checks there is budget before the work, and charge() bills the real cost
// once known (see Server.allowLog).
//
// A full log's cost can't be known in advance and can exceed the whole burst,
// so going into debt lets the first oversized pull succeed (the honest cold
// load) and makes the caller wait it out before the next. The floor caps that
// wait at burst/rate.
func (b *tokenBucket) charge(cost float64) {
	if cost <= 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.refill()
	b.tokens -= cost
	if b.tokens < -b.burst {
		b.tokens = -b.burst
	}
}

// idle reports how long since the bucket was last touched, under its lock.
func (b *tokenBucket) idle(now time.Time) time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	return now.Sub(b.last)
}

const (
	// maxLimiterKeys caps the bucket map; past it we evict stale buckets
	// instead of wiping the whole map (which would briefly disable limiting).
	maxLimiterKeys = 10000
	// limiterIdleTTL: buckets untouched for longer than this are evictable.
	limiterIdleTTL = 10 * time.Minute
)

// keyedLimiter rate-limits by key (IP, user id) with bounded memory.
type keyedLimiter struct {
	mu       sync.Mutex
	rate     float64
	burst    float64
	buckets  map[string]*tokenBucket
	disabled bool // load-test mode: allow everything (see Server.SetLoadTest)
}

func newKeyedLimiter(rate, burst float64) *keyedLimiter {
	return &keyedLimiter{rate: rate, burst: burst, buckets: map[string]*tokenBucket{}}
}

// evictStale drops idle buckets when the map grows too large. A fully refilled
// (idle past TTL) bucket is indistinguishable from a fresh one, so dropping it
// never weakens an active limit. Called with l.mu held.
func (l *keyedLimiter) evictStale() {
	now := time.Now()
	for k, b := range l.buckets {
		if b.idle(now) >= limiterIdleTTL {
			delete(l.buckets, k)
		}
	}
	// If everything is still hot, evict the oldest-touched buckets so memory
	// stays bounded without a full wipe.
	if len(l.buckets) > maxLimiterKeys {
		var oldestKey string
		var oldest time.Duration
		// Drop a slice of the oldest entries to amortize the scan.
		for trimmed := 0; len(l.buckets) > maxLimiterKeys && trimmed < maxLimiterKeys/2; trimmed++ {
			oldestKey, oldest = "", -1
			for k, b := range l.buckets {
				if idle := b.idle(now); idle > oldest {
					oldest, oldestKey = idle, k
				}
			}
			if oldestKey == "" {
				break
			}
			delete(l.buckets, oldestKey)
		}
	}
}

// bucketFor returns the key's bucket, minting one on first sight, or nil when
// limiting is disabled (load-test mode).
func (l *keyedLimiter) bucketFor(key string) *tokenBucket {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.disabled {
		return nil
	}
	if len(l.buckets) > maxLimiterKeys {
		l.evictStale()
	}
	b, ok := l.buckets[key]
	if !ok {
		b = newTokenBucket(l.rate, l.burst)
		l.buckets[key] = b
	}
	return b
}

func (l *keyedLimiter) allow(key string) bool {
	b := l.bucketFor(key)
	if b == nil {
		return true
	}
	return b.allow()
}

// charge bills a key for work already done. See tokenBucket.charge.
func (l *keyedLimiter) charge(key string, cost float64) {
	if b := l.bucketFor(key); b != nil {
		b.charge(cost)
	}
}

// setDisabled toggles the load-test bypass: when true, allow() always permits.
func (l *keyedLimiter) setDisabled(v bool) {
	l.mu.Lock()
	l.disabled = v
	l.mu.Unlock()
}
