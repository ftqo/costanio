package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
)

// gameConfig is the minimal valid create-game config (other fields default
// server-side: target_vp=10, turn_timer_sec default). See lobby.validateConfig.
type gameConfig struct {
	Players int    `json:"players"`
	Ruleset string `json:"ruleset"`
}

// postJSON posts v as JSON to path and returns the body if status is in want.
func (c *Client) postJSON(path string, v any, want ...int) ([]byte, error) {
	var buf bytes.Buffer
	if v != nil {
		if err := json.NewEncoder(&buf).Encode(v); err != nil {
			return nil, err
		}
	}
	resp, err := c.HTTP.Post(c.BaseURL+path, "application/json", &buf)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if slices.Contains(want, resp.StatusCode) {
		return body, nil
	}
	return nil, fmt.Errorf("POST %s: status %d: %s", path, resp.StatusCode, body)
}

// CreateGame creates a lobby and returns the new game's id and invite code. When
// private is true the response carries an invite_code that guests use to
// spectate (public games would require a registered identity to watch).
func (c *Client) CreateGame(cfg gameConfig, private bool) (GameTarget, error) {
	body := map[string]any{"config": cfg, "private": private}
	b, err := c.postJSON("/api/games", body, http.StatusCreated)
	if err != nil {
		return GameTarget{}, err
	}
	var out struct {
		Game struct {
			ID         string `json:"id"`
			InviteCode string `json:"invite_code"`
		} `json:"game"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return GameTarget{}, fmt.Errorf("create: decode: %w", err)
	}
	if out.Game.ID == "" {
		return GameTarget{}, errors.New("create: empty game id")
	}
	if private && out.Game.InviteCode == "" {
		return GameTarget{}, fmt.Errorf("create: private game %s has no invite code", out.Game.ID)
	}
	return GameTarget{ID: out.Game.ID, Invite: out.Game.InviteCode}, nil
}

// AddBot adds one bot to the next empty seat.
func (c *Client) AddBot(gameID string) error {
	_, err := c.postJSON("/api/games/"+gameID+"/bots", nil, http.StatusOK)
	return err
}

// StartGame starts the game (host only; all seats must be filled).
func (c *Client) StartGame(gameID string) error {
	_, err := c.postJSON("/api/games/"+gameID+"/start", nil, http.StatusNoContent)
	return err
}

// FillAndStart creates a private game, fills the remaining seats with bots (the
// host occupies seat 0 and will auto-pass/escalate to a bot once play starts),
// and starts it. Returns the game id + invite code for spectators.
func (c *Client) FillAndStart(cfg gameConfig) (GameTarget, error) {
	g, err := c.CreateGame(cfg, true)
	if err != nil {
		return GameTarget{}, err
	}
	for i := range cfg.Players - 1 {
		if err := c.AddBot(g.ID); err != nil {
			return GameTarget{}, fmt.Errorf("game %s add bot %d: %w", g.ID, i, err)
		}
	}
	if err := c.StartGame(g.ID); err != nil {
		return GameTarget{}, fmt.Errorf("game %s start: %w", g.ID, err)
	}
	return g, nil
}

// buildPool fills and starts n games using the given host client, returning the
// game targets. Sequential: simplest, and the orchestrator is not on the hot path.
func buildPool(host *Client, n int, cfg gameConfig) ([]GameTarget, error) {
	games := make([]GameTarget, 0, n)
	for i := range n {
		g, err := host.FillAndStart(cfg)
		if err != nil {
			return games, fmt.Errorf("pool game %d/%d: %w", i+1, n, err)
		}
		games = append(games, g)
	}
	return games, nil
}
