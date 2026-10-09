package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// discordClient is used for all outbound Discord calls. The timeout keeps a
// hung Discord endpoint from blocking the callback; per-request contexts also
// cancel on client disconnect.
var discordClient = &http.Client{Timeout: 10 * time.Second}

// Config holds OAuth endpoints; they are injectable so tests can stub Discord.
type Config struct {
	ClientID     string
	ClientSecret string
	AuthorizeURL string // default https://discord.com/oauth2/authorize
	TokenURL     string // default https://discord.com/api/oauth2/token
	IdentifyURL  string // default https://discord.com/api/users/@me
	// RelationshipsURL serves the friend list. It needs the restricted
	// relationships.read scope, which Discord must approve per app and which is
	// not requested by default; add it to Scopes to enable the friend-list
	// cache. Default https://discord.com/api/users/@me/relationships
	RelationshipsURL string
	Scopes           []string // default: identify (add relationships.read to enable friends)
	BaseURL          string   // public base URL of this server, for the redirect URI
}

func (c Config) withDefaults() Config {
	if c.AuthorizeURL == "" {
		c.AuthorizeURL = "https://discord.com/oauth2/authorize"
	}
	if c.TokenURL == "" {
		c.TokenURL = "https://discord.com/api/oauth2/token"
	}
	if c.IdentifyURL == "" {
		c.IdentifyURL = "https://discord.com/api/users/@me"
	}
	if c.RelationshipsURL == "" {
		c.RelationshipsURL = "https://discord.com/api/users/@me/relationships"
	}
	if len(c.Scopes) == 0 {
		// relationships.read needs Discord approval, so it is opt-in via Scopes.
		c.Scopes = []string{"identify"}
	}
	return c
}

const stateCookie = "costan_oauth_state"

// authQuery builds the standard authorization-code request parameters.
func authQuery(clientID, redirectURI, scope, state string) url.Values {
	return url.Values{
		"client_id":     {clientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"scope":         {scope},
		"state":         {state},
	}
}

// HandleActivityToken implements the Discord Activity OAuth exchange: the client
// posts the `code` from the Embedded App SDK's authorize(); we exchange it for a
// Discord identity, resolve/merge the user, and mint a session. We return the
// Discord access_token (for discordSdk.authenticate) and our opaque session
// token (used as a bearer credential since iframe cookies are unreliable).
func (s *Service) HandleActivityToken(w http.ResponseWriter, r *http.Request) {
	cfg := s.Config.withDefaults()
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var body struct {
		Code       string `json:"code"`
		InstanceID string `json:"instance_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		writeErr(w, http.StatusBadRequest, "OAUTH_CODE_REQUIRED", "Code required")
		return
	}
	identity, accessToken, err := s.exchange(r.Context(), cfg, body.Code, "")
	if err != nil {
		writeErr(w, http.StatusBadGateway, "OAUTH_FAILED", "Discord exchange failed")
		return
	}
	var userID int64
	avatarURL := discordAvatarURL(identity.ID, identity.Avatar)
	if cur := UserFrom(r.Context()); cur != nil && cur.IsGuest {
		merged, err := s.Store.MergeGuestIntoDiscord(cur.ID, identity.ID, identity.Username, avatarURL)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "Merge failed")
			return
		}
		userID = merged.ID
	} else {
		u, err := s.Store.UpsertDiscordUser(identity.ID, identity.Username, avatarURL)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "INTERNAL", "Upsert failed")
			return
		}
		userID = u.ID
	}
	s.grantSignup(userID) // one-time welcome Pips; idempotent per user
	s.syncRoles(userID)   // best-effort, background; reflects /setrole on next login
	token, err := s.Store.CreateSession(userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Session failed")
		return
	}
	s.setSessionCookie(w, token) // harmless; used if the iframe does accept cookies
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token":  accessToken,
		"session_token": token,
		"user":          map[string]any{"id": userID, "name": identity.Username, "guest": false},
	})
}

// fetchFriendIDs returns the Discord ids of the user's friends (relationship
// type 1).
func fetchFriendIDs(ctx context.Context, cfg Config, accessToken string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.RelationshipsURL, http.NoBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := discordClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("relationships endpoint: %s", resp.Status)
	}
	var rels []struct {
		Type int `json:"type"`
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rels); err != nil {
		return nil, err
	}
	var out []string
	for _, r := range rels {
		if r.Type == 1 && r.User.ID != "" {
			out = append(out, r.User.ID)
		}
	}
	return out, nil
}

type discordIdentity struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Avatar   string `json:"avatar"`
}

// exchange swaps an authorization code for an identity + access token. An empty
// redirectURI omits the parameter: the Discord Activity (embedded SDK) grant
// does not use a redirect URI, the web callback does.
func (s *Service) exchange(ctx context.Context, cfg Config, code, redirectURI string) (*discordIdentity, string, error) {
	form := url.Values{
		"client_id":     {cfg.ClientID},
		"client_secret": {cfg.ClientSecret},
		"grant_type":    {"authorization_code"},
		"code":          {code},
	}
	if redirectURI != "" {
		form.Set("redirect_uri", redirectURI)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := discordClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("token endpoint: %s", resp.Status)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return nil, "", err
	}

	req2, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.IdentifyURL, http.NoBody)
	if err != nil {
		return nil, "", err
	}
	req2.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	resp2, err := discordClient.Do(req2)
	if err != nil {
		return nil, "", err
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("identify endpoint: %s", resp2.Status)
	}
	var id discordIdentity
	if err := json.NewDecoder(resp2.Body).Decode(&id); err != nil {
		return nil, "", err
	}
	if id.ID == "" {
		return nil, "", errors.New("identify returned empty id")
	}
	return &id, tok.AccessToken, nil
}
