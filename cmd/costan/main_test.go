package main

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/ftqo/costan.io/lifecycle"
)

func TestLoadTestEnabled(t *testing.T) {
	cases := []struct {
		envSet, prod, want bool
	}{
		{false, false, false}, // not requested
		{true, false, true},   // requested, dev
		{true, true, false},   // requested but production -> refused
		{false, true, false},  // neither
	}
	for _, c := range cases {
		if got := loadTestEnabled(c.envSet, c.prod); got != c.want {
			t.Errorf("loadTestEnabled(envSet=%v, prod=%v)=%v; want %v",
				c.envSet, c.prod, got, c.want)
		}
	}
}

// TestProdLikeMatchesDevAuth: production is inferred from the flag or an https
// base URL, like auth.secureCookie. The key row is an https deploy without the
// flag, which must still refuse load-test mode.
func TestProdLikeMatchesDevAuth(t *testing.T) {
	cases := []struct {
		secure  bool
		baseURL string
		want    bool
	}{
		{false, "http://localhost:4757", false}, // local dev
		{true, "http://localhost:4757", true},   // explicit flag wins
		{false, "https://costan.io", true},      // inferred from the base URL
		{false, "HTTPS://COSTAN.IO", true},      // scheme compared case-insensitively
		{true, "https://costan.io", true},       // production, both signals
		{false, "", false},                      // unset base URL is not production
	}
	for _, c := range cases {
		if got := prodLike(c.secure, c.baseURL); got != c.want {
			t.Errorf("prodLike(secure=%v, %q)=%v; want %v", c.secure, c.baseURL, got, c.want)
		}
		// Load-test mode must be refused wherever dev-auth would be.
		if got := loadTestEnabled(true, prodLike(c.secure, c.baseURL)); got == c.want {
			t.Errorf("load-test enabled=%v for prodLike=%v (secure=%v, %q)", got, c.want, c.secure, c.baseURL)
		}
	}
}

// TestPprofBindDefaultsToLoopback: net/http reads a bare ":port" as all
// interfaces, which would publish a heap full of session tokens.
func TestPprofBindDefaultsToLoopback(t *testing.T) {
	cases := map[string]string{
		":6771":          "127.0.0.1:6771",
		":0":             "127.0.0.1:0",
		"127.0.0.1:6771": "127.0.0.1:6771", // already explicit
		"0.0.0.0:6771":   "0.0.0.0:6771",   // deliberate; the caller warns
		"[::1]:6771":     "[::1]:6771",     // v6 loopback, host written
		"localhost:6771": "localhost:6771", // host written
	}
	for in, want := range cases {
		if got := pprofBind(in); got != want {
			t.Errorf("pprofBind(%q)=%q; want %q", in, got, want)
		}
	}
}

// TestRequireExistingDB guards the empty-database path: store.Open's DSN has no
// mode=, so a missing file is created, migrated from zero and served, and every
// health check passes over an empty site.
func TestRequireExistingDB(t *testing.T) {
	cases := []struct{ prod, allowNew, want bool }{
		{false, false, false}, // dev: a fresh temp DB per run is expected
		{false, true, false},  // dev, opt-in set: still no guard to defeat
		{true, false, true},   // production: refuse to create
		{true, true, false},   // production first boot, explicit opt-in
	}
	for _, c := range cases {
		if got := requireExistingDB(c.prod, c.allowNew); got != c.want {
			t.Errorf("requireExistingDB(prod=%v, allowNew=%v)=%v; want %v",
				c.prod, c.allowNew, got, c.want)
		}
	}
}

// TestStartSweepIsJoined: a tick already in progress must hold
// shutdown until it finishes, not merely be asked to stop.
func TestStartSweepIsJoined(t *testing.T) {
	var g lifecycle.Group
	inTick := make(chan struct{})
	release := make(chan struct{})
	var finished atomic.Bool
	startSweep(&g, time.Hour, true, func() {
		close(inTick)
		<-release
		finished.Store(true)
	})
	select {
	case <-inTick:
	case <-time.After(5 * time.Second):
		t.Fatal("atStart sweep never ran")
	}

	g.Stop()
	joined := make(chan bool, 1)
	go func() { joined <- g.Wait(10 * time.Second) }()
	select {
	case <-joined:
		t.Fatal("shutdown returned while a sweep was mid-transaction")
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	if ok := <-joined; !ok {
		t.Fatal("Wait timed out after the sweep was released")
	}
	if !finished.Load() {
		t.Fatal("Wait returned before the in-flight sweep finished")
	}
}

// TestStartSweepStopsTicking: the loop must also actually exit, and must not
// run f again once shutdown has begun.
func TestStartSweepStopsTicking(t *testing.T) {
	var g lifecycle.Group
	var runs atomic.Int64
	startSweep(&g, time.Millisecond, false, func() { runs.Add(1) })
	time.Sleep(30 * time.Millisecond)
	if !g.StopAndWait(5 * time.Second) {
		t.Fatal("sweep loop did not exit on Stop")
	}
	settled := runs.Load()
	if settled == 0 {
		t.Fatal("sweep never ticked")
	}
	time.Sleep(30 * time.Millisecond)
	if got := runs.Load(); got != settled {
		t.Fatalf("sweep ran %d more times after shutdown joined it", got-settled)
	}
}
