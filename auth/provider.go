package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/ftqo/costan.io/store"
)

// pkceCookie holds the PKCE code_verifier between the authorize redirect and the
// callback. HttpOnly + Path /auth so it is never exposed to JS or other routes.
const pkceCookie = "costan_pkce"

// newPKCE returns a fresh S256 PKCE (verifier, challenge) pair. The verifier is
// 43 base64url chars (32 random bytes, no padding), within RFC 7636's 43-128
// range; the challenge is base64url(sha256(verifier)) with no padding.
func newPKCE() (verifier, challenge string) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	verifier = base64.RawURLEncoding.EncodeToString(b)
	return verifier, pkceChallenge(verifier)
}

// pkceChallenge computes the S256 code challenge for a verifier.
func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// Identity is the normalized account info a provider returns after exchange.
type Identity struct {
	ProviderID string
	Name       string
	Avatar     string
	Email      string
}

// PostLogin is an optional side effect run after the user is resolved (Discord
// uses it to cache the friend list). May be nil.
type PostLogin func(ctx context.Context, userID int64)

// Provider is one OAuth login backend.
//
// codeChallenge / codeVerifier carry S256 PKCE: providers that use PKCE (Google)
// add the challenge to the authorize URL and the verifier to the token exchange;
// providers that do not (Discord) ignore both. Empty strings mean "no PKCE".
type Provider interface {
	Name() string
	AuthCodeURL(state, redirectURI, codeChallenge string) string
	Exchange(ctx context.Context, code, redirectURI, codeVerifier string) (Identity, PostLogin, error)
}

// redirectURI is the callback URL for a provider, derived from BaseURL.
func (s *Service) redirectURI(name string) string {
	return strings.TrimSuffix(s.Config.BaseURL, "/") + "/auth/" + name + "/callback"
}

// provider returns the configured provider by name, or nil if unconfigured.
func (s *Service) provider(name string) Provider {
	if s.testProviders != nil {
		if p, ok := s.testProviders[name]; ok {
			return p
		}
	}
	switch name {
	case "discord":
		if s.Config.ClientID == "" {
			return nil
		}
		return discordProvider{s: s, cfg: s.Config.withDefaults()}
	case "google":
		if s.Google.ClientID == "" {
			return nil
		}
		return googleProvider{cfg: s.Google.withDefaults()}
	default:
		return nil
	}
}

// discordProvider adapts the existing Discord exchange to the Provider interface.
type discordProvider struct {
	s   *Service
	cfg Config
}

func (d discordProvider) Name() string { return "discord" }

func (d discordProvider) AuthCodeURL(state, redirectURI, codeChallenge string) string {
	// Discord does not use PKCE; codeChallenge is ignored.
	return d.cfg.AuthorizeURL + "?" + authQuery(d.cfg.ClientID, redirectURI, strings.Join(d.cfg.Scopes, " "), state).Encode()
}

func (d discordProvider) Exchange(ctx context.Context, code, redirectURI, codeVerifier string) (Identity, PostLogin, error) {
	// codeVerifier is ignored: Discord's flow does not use PKCE.
	id, token, err := d.s.exchange(ctx, d.cfg, code, redirectURI)
	if err != nil {
		return Identity{}, nil, err
	}
	ident := Identity{ProviderID: id.ID, Name: id.Username, Avatar: discordAvatarURL(id.ID, id.Avatar)}
	cfg := d.cfg
	st := d.s.Store
	var post PostLogin
	if containsScope(cfg.Scopes, "relationships.read") {
		post = func(ctx context.Context, userID int64) {
			friends, err := fetchFriendIDs(ctx, cfg, token)
			if err != nil {
				slog.Warn("auth: friends fetch", "discord", ident.ProviderID, "err", err)
				return
			}
			if err := st.ReplaceFriends(userID, friends); err != nil {
				slog.Error("auth: friends cache", "user", userID, "err", err)
			}
		}
	}
	return ident, post, nil
}

func containsScope(scopes []string, want string) bool {
	return slices.Contains(scopes, want)
}

// stateFor generates a CSRF state token with intent prefix.
func stateFor(link bool) string {
	if link {
		return "link:" + newRandomHex(16)
	}
	return "login:" + newRandomHex(16)
}

// HandleUnlink removes a linked provider from the current user.
func (s *Service) HandleUnlink(w http.ResponseWriter, r *http.Request) {
	cur := UserFrom(r.Context())
	if cur == nil {
		writeErr(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Login required")
		return
	}
	provider := r.PathValue("provider")
	switch err := s.Store.UnlinkIdentity(cur.ID, provider); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, store.ErrLastIdentity):
		writeErr(w, http.StatusConflict, "LAST_IDENTITY", "Cannot unlink your only login method")
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "NOT_LINKED", "That provider is not linked")
	default:
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Unlink failed")
	}
}

// HandleAuthStart begins login or (when the path ends /link) a link flow.
func (s *Service) HandleAuthStart(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("provider")
	p := s.provider(name)
	if p == nil {
		http.NotFound(w, r)
		return
	}
	link := strings.HasSuffix(r.URL.Path, "/link")
	if link {
		// Linking attaches an identity to the current account. A guest must
		// promote via the normal /auth/{provider} login instead: a linked guest
		// row would later be deleted by MergeGuestIntoProvider on a same-provider
		// login (the found id is the guest's own).
		if cur := UserFrom(r.Context()); cur == nil || cur.IsGuest {
			writeErr(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Login required")
			return
		}
	}
	state := stateFor(link)
	http.SetCookie(w, &http.Cookie{
		Name: stateCookie, Value: state, Path: "/auth",
		HttpOnly: true, Secure: s.secureCookie(), SameSite: http.SameSiteLaxMode, MaxAge: 600,
	})
	// PKCE: generate a verifier, stash it (HttpOnly, /auth-scoped) for the
	// callback, and send only the S256 challenge to the provider. Providers that
	// do not use PKCE (Discord) ignore the challenge.
	verifier, challenge := newPKCE()
	http.SetCookie(w, &http.Cookie{
		Name: pkceCookie, Value: verifier, Path: "/auth",
		HttpOnly: true, Secure: s.secureCookie(), SameSite: http.SameSiteLaxMode, MaxAge: 600,
	})
	http.Redirect(w, r, p.AuthCodeURL(state, s.redirectURI(name), challenge), http.StatusFound)
}

// HandleAuthCallback finishes any provider's OAuth flow.
//
// Failures end a full-page navigation, so the player sees this response
// directly. They carry a code (OAUTH_STATE_INVALID, OAUTH_CODE_MISSING,
// OAUTH_EXCHANGE_FAILED, INTERNAL) in the standard JSON shape. TODO: redirect
// into the app instead (e.g. /login?error=OAUTH_EXCHANGE_FAILED), as the
// success and link paths do, once the frontend reads the param.
func (s *Service) HandleAuthCallback(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("provider")
	p := s.provider(name)
	if p == nil {
		http.NotFound(w, r)
		return
	}
	c, err := r.Cookie(stateCookie)
	got := r.URL.Query().Get("state")
	if err != nil || c.Value == "" || got == "" ||
		subtle.ConstantTimeCompare([]byte(got), []byte(c.Value)) != 1 {
		writeErr(w, http.StatusBadRequest, "OAUTH_STATE_INVALID", "Invalid oauth state")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: "", Path: "/auth", MaxAge: -1})
	link := strings.HasPrefix(c.Value, "link:")

	// PKCE: recover and clear the verifier. Missing is tolerated (Discord never
	// sets it); for Google the token exchange then fails.
	verifier := ""
	if pc, err := r.Cookie(pkceCookie); err == nil {
		verifier = pc.Value
	}
	http.SetCookie(w, &http.Cookie{Name: pkceCookie, Value: "", Path: "/auth", MaxAge: -1})

	code := r.URL.Query().Get("code")
	if code == "" {
		writeErr(w, http.StatusBadRequest, "OAUTH_CODE_MISSING", "Missing code")
		return
	}
	ident, post, err := p.Exchange(r.Context(), code, s.redirectURI(name), verifier)
	if err != nil {
		slog.Warn("auth: OAuth exchange failed", "provider", name, "err", err)
		writeErr(w, http.StatusBadGateway, "OAUTH_EXCHANGE_FAILED", "Oauth exchange failed")
		return
	}
	sid := store.Identity{Provider: name, ProviderID: ident.ProviderID, Name: ident.Name, Avatar: ident.Avatar, Email: ident.Email}

	if link {
		cur := UserFrom(r.Context())
		if cur == nil || cur.IsGuest {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		switch err := s.Store.LinkIdentity(cur.ID, sid); {
		case err == nil:
			http.Redirect(w, r, "/profile?linked=1", http.StatusFound)
		case errors.Is(err, store.ErrIdentityTaken):
			tok := s.mintMergeToken(cur.ID, sid.Provider, sid.ProviderID)
			http.Redirect(w, r, "/profile?merge="+url.QueryEscape(tok), http.StatusFound)
		default:
			http.Redirect(w, r, "/profile?link=error", http.StatusFound)
		}
		return
	}

	var userID int64
	if cur := UserFrom(r.Context()); cur != nil && cur.IsGuest {
		merged, err := s.Store.MergeGuestIntoProvider(cur.ID, sid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "Merge failed")
			return
		}
		userID = merged.ID
	} else {
		u, err := s.Store.UpsertUser(name, ident.ProviderID, ident.Name, ident.Avatar, ident.Email)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "User upsert failed")
			return
		}
		userID = u.ID
	}
	if post != nil {
		post(r.Context(), userID)
	}
	s.grantSignup(userID) // one-time welcome Pips; idempotent per user
	s.syncRoles(userID)   // best-effort, background; reflects /setrole on next login
	if err := s.setSession(w, userID); err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Session failed")
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}
