package server

import (
	"fmt"
	"net/http"
	"testing"
)

// TestGuestLimitKeysIPv6OnSlash64: one IPv6 subscriber is routinely handed a
// whole /64, so keying the per-IP buckets on the full address gave a single
// client 2^64 fresh buckets. Rotating the low bits must not escape the meter.
func TestGuestLimitKeysIPv6OnSlash64(t *testing.T) {
	e := newEnv(t)
	e.srv.SetRealIPHeader("CF-Connecting-IP")
	limited := false
	for i := range 40 {
		req, _ := http.NewRequest(http.MethodPost, e.ts.URL+"/auth/guest", http.NoBody)
		req.Header.Set("CF-Connecting-IP", fmt.Sprintf("2001:db8:1:2::%x", i+1))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("40 guest mints from one /64 were never rate limited")
	}
}

func TestRateKey(t *testing.T) {
	s := &Server{}
	for _, c := range []struct{ remote, want string }{
		{"203.0.113.9:5555", "203.0.113.9"},
		{"[2001:db8:1:2:aaaa:bbbb:cccc:dddd]:443", "2001:db8:1:2::/64"},
		{"[2001:db8:1:2::1]:443", "2001:db8:1:2::/64"},
		{"[2001:db8:1:3::1]:443", "2001:db8:1:3::/64"},
		{"[::ffff:203.0.113.9]:1", "203.0.113.9"}, // v4-mapped stays a v4 key
		{"garbage", "garbage"},
	} {
		if got := s.rateKey(&http.Request{RemoteAddr: c.remote, Header: http.Header{}}); got != c.want {
			t.Errorf("rateKey(%q) = %q, want %q", c.remote, got, c.want)
		}
	}
}
