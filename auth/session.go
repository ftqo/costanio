// Package auth provides Discord OAuth login, guest identities, and session
// middleware.
package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ftqo/costan.io/store"
)

// roleSyncTimeout bounds the background post-login Discord role pull.
const roleSyncTimeout = 10 * time.Second

const cookieName = "costan_session"

type ctxKey struct{}

type Service struct {
	Store  *store.Store
	Config Config
	// Google holds optional Google OIDC config; empty ClientID disables Google.
	Google GoogleConfig
	// Secure controls the cookie Secure flag; off in local dev/tests.
	Secure bool
	// DevAuth enables the GET /auth/dev one-click login (a registered test
	// account) for local testing. It is disabled whenever cookies are Secure.
	DevAuth bool
	// testProviders, when set, overrides provider lookup in tests.
	testProviders map[string]Provider
	// mergeSecret signs short-lived account-merge tokens; lazily seeded from
	// crypto/rand on first use (a restart safely invalidates pending merges).
	mergeSecret []byte
	mergeOnce   sync.Once
	// roleSync, when set, re-pulls a user's Discord-role-derived status after a
	// successful login. Wired from the supporter refresher in main; nil-safe.
	roleSync func(ctx context.Context, userID int64) error
	// signupGrant, when set, credits the one-time welcome Pip grant. It is
	// idempotent per user, so every login path calls it. Wired from the econ
	// ledger in main; nil-safe.
	signupGrant func(userID int64) error
}

// SetRoleSync wires the post-login Discord role refresh (the supporter
// Refresher). nil disables it (e.g. local dev with no bot token).
func (s *Service) SetRoleSync(fn func(ctx context.Context, userID int64) error) {
	s.roleSync = fn
}

// SetSignupGrant wires the one-time welcome Pip grant (econ.Ledger.Signup).
// nil disables it.
func (s *Service) SetSignupGrant(fn func(userID int64) error) {
	s.signupGrant = fn
}

// grantSignup credits the welcome grant, best effort: a ledger hiccup must not
// cost the player their login. No-op when unconfigured.
func (s *Service) grantSignup(userID int64) {
	if s.signupGrant == nil {
		return
	}
	if err := s.signupGrant(userID); err != nil {
		slog.Error("auth: signup grant", "user", userID, "err", err)
	}
}

// syncRoles re-pulls the user's Discord-role-derived status in the background
// after login, so a role change via /setrole takes effect on the next login. It
// uses a fresh context so it outlives the request. No-op when unconfigured.
func (s *Service) syncRoles(userID int64) {
	if s.roleSync == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), roleSyncTimeout)
		defer cancel()
		if err := s.roleSync(ctx, userID); err != nil {
			slog.Warn("auth: post-login role sync", "user", userID, "err", err)
		}
	}()
}

// devAuthEnabled reports whether the dev login route is active: it needs the
// explicit opt-in and a non-secure (local http) deployment.
func (s *Service) devAuthEnabled() bool {
	return s.DevAuth && !s.secureCookie()
}

// Production reports whether this is a real deployment rather than local dev:
// the -secure-cookies flag or an https base URL (the same rule as cmd/costan's
// prodLike). The server's production-only guards use it.
func (s *Service) Production() bool { return s.secureCookie() }

// secureCookie reports whether cookies carry the Secure flag: when Secure is
// set or BaseURL is https. Plain-http base URLs (local dev) keep it off so the
// browser does not drop the cookie.
func (s *Service) secureCookie() bool {
	if s.Secure {
		return true
	}
	return strings.HasPrefix(strings.ToLower(s.Config.BaseURL), "https://")
}

// UserFrom returns the authenticated user, or nil.
func UserFrom(ctx context.Context) *store.User {
	u, _ := ctx.Value(ctxKey{}).(*store.User)
	return u
}

// Middleware resolves the session into a user on the request context. The token
// comes from the session cookie (web) or an `Authorization: Bearer <token>`
// header (the Discord Activity, where iframe cookies are unreliable). Requests
// without a valid session pass through unauthenticated.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if c, err := r.Cookie(cookieName); err == nil {
			token = c.Value
		} else if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimPrefix(h, "Bearer ")
		}
		if token != "" {
			if u, err := s.Store.UserBySession(token); err == nil {
				r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// RequireUser wraps a handler, rejecting unauthenticated requests.
func RequireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if UserFrom(r.Context()) == nil {
			writeErr(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Login required")
			return
		}
		next(w, r)
	}
}

func (s *Service) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secureCookie(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   30 * 24 * 60 * 60,
	})
}

func (s *Service) setSession(w http.ResponseWriter, userID int64) error {
	token, err := s.Store.CreateSession(userID)
	if err != nil {
		return err
	}
	s.setSessionCookie(w, token)
	return nil
}

// HandleGuest mints a nameless anonymous guest + session. POST with no body.
// There is no "log in as guest" prompt: a guest is identified silently and names
// themselves later in the waiting room (a per-seat display name).
func (s *Service) HandleGuest(w http.ResponseWriter, r *http.Request) {
	if UserFrom(r.Context()) != nil {
		writeErr(w, http.StatusConflict, "ALREADY_AUTHED", "Already logged in")
		return
	}
	u, err := s.Store.CreateGuest("")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not create guest")
		return
	}
	s.grantSignup(u.ID)
	if err := s.setSession(w, u.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not create session")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"id": u.ID, "name": u.Name, "guest": true})
}

// HandleDevLogin mints (or reuses) a registered test account, so the
// registered-only surface (hosting, public tables) works without Discord, and
// redirects into the app. It is a GET so a browser can hit it directly (e.g.
// through the Vite dev proxy at /auth/dev). Returns 404 unless devAuthEnabled.
func (s *Service) HandleDevLogin(w http.ResponseWriter, r *http.Request) {
	if !s.devAuthEnabled() {
		http.NotFound(w, r)
		return
	}
	if UserFrom(r.Context()) != nil {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	// A stable fake Discord id, so repeated dev logins reuse one account.
	u, err := s.Store.UpsertDiscordUser("dev-tester", "Tester", "")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not create dev user")
		return
	}
	// Turn on every role-gated perk (supporter, boosting, kofi, staff, gift) so
	// all name decorations and colours are usable, and grant a large Pip
	// stipend. The stipend's stable idem key grants it once.
	if err := s.Store.SetSupporter(u.ID, true, true, true, true, true, 0); err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not grant dev supporter")
		return
	}
	s.grantSignup(u.ID)
	if _, err := s.Store.LedgerCredit(u.ID, 1_000_000, "grant", "grant:dev-stipend"); err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not grant dev pips")
		return
	}
	if err := s.setSession(w, u.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not create session")
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

// HandleLogout deletes the current session.
func (s *Service) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		// If the server-side delete fails the session is still valid for 30
		// days; surface a 500 instead of pretending logout succeeded.
		if err := s.Store.DeleteSession(c.Value); err != nil {
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not delete session")
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func newRandomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return hex.EncodeToString(b)
}
