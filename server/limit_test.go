package server

import (
	"net/http"
	"testing"
	"time"
)

func TestClientIP(t *testing.T) {
	req := func(remote, header, val string) *http.Request {
		r := &http.Request{RemoteAddr: remote, Header: http.Header{}}
		if header != "" {
			r.Header.Set(header, val)
		}
		return r
	}
	cases := []struct {
		name         string
		realIPHeader string
		remote       string
		header, val  string
		want         string
	}{
		{"no header config strips port", "", "203.0.113.9:5555", "", "", "203.0.113.9"},
		{"trusted header used", "CF-Connecting-IP", "10.0.0.2:1", "CF-Connecting-IP", "198.51.100.7", "198.51.100.7"},
		{"xff list takes first", "X-Forwarded-For", "10.0.0.2:1", "X-Forwarded-For", "198.51.100.7, 10.0.0.2", "198.51.100.7"},
		{"missing trusted header falls back", "CF-Connecting-IP", "10.0.0.2:1", "", "", "10.0.0.2"},
		{"garbage header value falls back", "CF-Connecting-IP", "10.0.0.2:1", "CF-Connecting-IP", "not-an-ip", "10.0.0.2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &Server{realIPHeader: tc.realIPHeader}
			if got := s.clientIP(req(tc.remote, tc.header, tc.val)); got != tc.want {
				t.Fatalf("clientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestKeyedLimiterDisabledAllowsBeyondBurst(t *testing.T) {
	l := newKeyedLimiter(0.05, 2) // burst 2: only 2 allowed normally
	l.setDisabled(true)
	for i := range 100 {
		if !l.allow("k") {
			t.Fatalf("disabled limiter denied request %d; want always allow", i)
		}
	}
}

func TestSetLoadTestRelaxesLimitersAndSpectatorCap(t *testing.T) {
	s := &Server{
		createLimit:   newKeyedLimiter(0.05, 1),
		guestLimit:    newKeyedLimiter(0.05, 1),
		browseLimit:   newKeyedLimiter(0.05, 1),
		refreshLimit:  newKeyedLimiter(0.05, 1),
		maxSpectators: defaultMaxSpectators,
	}
	s.SetLoadTest(true)
	for i := range 50 {
		if !s.createLimit.allow("u") || !s.guestLimit.allow("ip") ||
			!s.browseLimit.allow("ip") || !s.refreshLimit.allow("u") {
			t.Fatalf("limiter denied request %d under load-test mode", i)
		}
	}
	if s.maxSpectators <= defaultMaxSpectators {
		t.Fatalf("maxSpectators = %d; want raised above default %d", s.maxSpectators, defaultMaxSpectators)
	}
}

// A pay-after-serving limit has to let the first oversized request through
// (the cost isn't knowable up front) and then make the caller wait out what
// they took.
func TestTokenBucketChargeGoesIntoDebt(t *testing.T) {
	b := newTokenBucket(0, 10) // no refill, burst 10
	if !b.allow() {
		t.Fatal("first request denied on a full bucket")
	}
	b.charge(50) // a response far larger than the whole burst
	if b.allow() {
		t.Fatal("second request allowed while overdrawn")
	}
	// The debt is floored at -burst, so the wait is bounded at burst/rate rather
	// than scaling with however huge that one response was.
	b.mu.Lock()
	tokens := b.tokens
	b.mu.Unlock()
	if tokens < -b.burst {
		t.Fatalf("tokens = %v, want no lower than -burst (%v)", tokens, -b.burst)
	}
}

func TestTokenBucketChargeRecoversWithTime(t *testing.T) {
	b := newTokenBucket(100, 10) // 100 tokens/sec
	b.allow()
	b.charge(200)
	if b.allow() {
		t.Fatal("allowed while overdrawn")
	}
	b.mu.Lock()
	b.last = b.last.Add(-time.Second) // a second's worth of refill
	b.mu.Unlock()
	if !b.allow() {
		t.Fatal("still denied after the bucket refilled")
	}
}

func TestKeyedLimiterChargeIsPerKey(t *testing.T) {
	l := newKeyedLimiter(0, 5)
	l.charge("a", 100)
	if l.allow("a") {
		t.Fatal("key a allowed after being charged past its burst")
	}
	if !l.allow("b") {
		t.Fatal("key b denied after key a spent")
	}
}

func TestKeyedLimiterDisabledIgnoresCharges(t *testing.T) {
	l := newKeyedLimiter(0, 5)
	l.setDisabled(true)
	l.charge("k", 1e9)
	if !l.allow("k") {
		t.Fatal("disabled limiter denied after a charge")
	}
}

func TestKeyedLimiterEnabledStillLimits(t *testing.T) {
	l := newKeyedLimiter(0.0, 2) // no refill, burst 2
	// Two separate requests, each consuming a token from the burst-2 bucket.
	if !l.allow("k") {
		t.Fatal("first request should pass (burst 2)")
	}
	if !l.allow("k") {
		t.Fatal("second request should pass (burst 2)")
	}
	if l.allow("k") {
		t.Fatal("third request should be denied when not disabled")
	}
}
