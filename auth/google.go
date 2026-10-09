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

// GoogleConfig holds Google OIDC settings; endpoints default to Google's.
type GoogleConfig struct {
	ClientID     string
	ClientSecret string
	AuthorizeURL string
	TokenURL     string
	UserinfoURL  string
}

func (c GoogleConfig) withDefaults() GoogleConfig {
	if c.AuthorizeURL == "" {
		c.AuthorizeURL = "https://accounts.google.com/o/oauth2/v2/auth"
	}
	if c.TokenURL == "" {
		c.TokenURL = "https://oauth2.googleapis.com/token"
	}
	if c.UserinfoURL == "" {
		c.UserinfoURL = "https://openidconnect.googleapis.com/v1/userinfo"
	}
	return c
}

var googleClient = &http.Client{Timeout: 10 * time.Second}

type googleProvider struct{ cfg GoogleConfig }

func (g googleProvider) Name() string { return "google" }

func (g googleProvider) AuthCodeURL(state, redirectURI, codeChallenge string) string {
	q := authQuery(g.cfg.ClientID, redirectURI, "openid email profile", state)
	// PKCE (S256): bind this authorization request to the verifier we hold.
	if codeChallenge != "" {
		q.Set("code_challenge", codeChallenge)
		q.Set("code_challenge_method", "S256")
	}
	return g.cfg.AuthorizeURL + "?" + q.Encode()
}

func (g googleProvider) Exchange(ctx context.Context, code, redirectURI, codeVerifier string) (Identity, PostLogin, error) {
	form := url.Values{
		"client_id":     {g.cfg.ClientID},
		"client_secret": {g.cfg.ClientSecret},
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}
	// PKCE (S256): prove possession of the verifier matching the challenge.
	if codeVerifier != "" {
		form.Set("code_verifier", codeVerifier)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return Identity{}, nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := googleClient.Do(req)
	if err != nil {
		return Identity{}, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Identity{}, nil, fmt.Errorf("google token endpoint: %s", resp.Status)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return Identity{}, nil, err
	}

	req2, err := http.NewRequestWithContext(ctx, http.MethodGet, g.cfg.UserinfoURL, http.NoBody)
	if err != nil {
		return Identity{}, nil, err
	}
	req2.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	resp2, err := googleClient.Do(req2)
	if err != nil {
		return Identity{}, nil, err
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		return Identity{}, nil, fmt.Errorf("google userinfo endpoint: %s", resp2.Status)
	}
	var info struct {
		Sub     string `json:"sub"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
		Email   string `json:"email"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&info); err != nil {
		return Identity{}, nil, err
	}
	if info.Sub == "" {
		return Identity{}, nil, errors.New("google userinfo returned empty sub")
	}
	return Identity{ProviderID: info.Sub, Name: info.Name, Avatar: info.Picture, Email: info.Email}, nil, nil
}
