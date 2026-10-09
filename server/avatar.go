package server

import (
	"io"
	"net/http"
	"regexp"
	"time"
)

// Discord avatar path segments, validated before any outbound URL is built. The
// host is hardcoded (below), and {id} must be digits and {file} a
// hash+extension, so this can only fetch
// cdn.discordapp.com/avatars/<id>/<hash>.<ext>: it is not an open proxy.
var (
	avatarIDRe   = regexp.MustCompile(`^\d{1,32}$`)
	avatarFileRe = regexp.MustCompile(`^(a_)?[0-9a-f]{8,64}\.(png|gif|webp|jpe?g)$`)
)

// avatarClient fetches Discord CDN avatars server-side. Short timeout: these are
// tiny images and the fetch sits in the user's render path.
var avatarClient = &http.Client{Timeout: 5 * time.Second}

// avatarCDNBase is the Discord avatar CDN root. A var so tests can point it at
// a fake CDN.
var avatarCDNBase = "https://cdn.discordapp.com/avatars/"

// avatarMaxBytes caps the proxied body. Avatars at ?size=128 are a few KB; 1 MiB
// is slack for animated gifs while bounding what a forged hash could stream.
const avatarMaxBytes = 1 << 20

// handleAvatarProxy streams a Discord user's CDN avatar from our own origin.
//
// Inside the Discord Activity webview, a cross-origin image load from
// cdn.discordapp.com doesn't render, so avatars go through this same-origin
// endpoint (allowed like /api/token). Browsers use it too, so there is one
// path.
//
// Public (avatars are public and the games list exposes the URLs),
// rate-limited per IP, and cached hard since an avatar hash is immutable.
func (s *Server) handleAvatarProxy(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	file := r.PathValue("file")
	if !avatarIDRe.MatchString(id) || !avatarFileRe.MatchString(file) {
		http.NotFound(w, r)
		return
	}
	if !s.avatarLimit.allow(s.rateKey(r)) {
		writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}

	url := avatarCDNBase + id + "/" + file + "?size=128"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, http.NoBody) //nolint:gosec // G704: host is the fixed Discord CDN constant; id/file are regex-validated above
	if err != nil {
		http.NotFound(w, r)
		return
	}
	resp, err := avatarClient.Do(req) //nolint:gosec // G704: request targets the fixed Discord CDN with regex-validated path segments
	if err != nil {
		http.Error(w, "avatar fetch failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Treat a missing/expired avatar as "no picture" so the UI falls back to
		// its generated color disc, the same as an empty avatar URL would.
		http.NotFound(w, r)
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	// Avatars are content-addressed by hash, so a given URL never changes.
	w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, avatarMaxBytes))
}
