package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestAvatarProxy verifies the same-origin Discord avatar proxy: it streams a
// valid avatar from (a stand-in for) the CDN, rejects anything that isn't a
// plain <id>/<hash>.<ext> path (so it can't be turned into an open proxy), and
// maps an upstream miss to a 404 so the UI falls back to its color disc.
func TestAvatarProxy(t *testing.T) {
	const wantBody = "\x89PNG\r\n\x1a\nfake-image-bytes"
	var gotPath string
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if strings.HasSuffix(r.URL.Path, "/missing.png") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		io.WriteString(w, wantBody)
	}))
	defer cdn.Close()

	prev := avatarCDNBase
	avatarCDNBase = cdn.URL + "/avatars/"
	defer func() { avatarCDNBase = prev }()

	e := newEnv(t)

	t.Run("valid avatar streams from our origin", func(t *testing.T) {
		resp, err := http.Get(e.ts.URL + "/api/avatar/123456789/abcdef0123456789.png")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		body, _ := io.ReadAll(resp.Body)
		if string(body) != wantBody {
			t.Fatalf("body = %q, want %q", body, wantBody)
		}
		if ct := resp.Header.Get("Content-Type"); ct != "image/png" {
			t.Fatalf("content-type = %q, want image/png", ct)
		}
		if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "max-age") {
			t.Fatalf("cache-control = %q, want a max-age", cc)
		}
		// The size hint must be appended so we serve the small render Discord does.
		if !strings.Contains(gotPath, "/avatars/123456789/abcdef0123456789.png") {
			t.Fatalf("upstream path = %q", gotPath)
		}
	})

	t.Run("upstream miss becomes 404", func(t *testing.T) {
		resp, err := http.Get(e.ts.URL + "/api/avatar/123456789/missing.png")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", resp.StatusCode)
		}
	})

	t.Run("malformed paths never reach upstream", func(t *testing.T) {
		gotPath = ""
		for _, bad := range []string{
			"/api/avatar/abc/abcdef0123456789.png",       // non-numeric id
			"/api/avatar/123/..%2f..%2fetc%2fpasswd.png", // traversal attempt
			"/api/avatar/123/short.png",                  // hash too short
			"/api/avatar/123/abcdef0123456789.svg",       // disallowed extension
		} {
			resp, err := http.Get(e.ts.URL + bad)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("%s: status = %d, want 404", bad, resp.StatusCode)
			}
		}
		if gotPath != "" {
			t.Fatalf("a malformed request reached upstream: %q", gotPath)
		}
	})
}
