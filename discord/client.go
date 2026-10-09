// Package discord is a minimal Discord REST client used outside the OAuth login
// path. Today it reads a guild member's roles so supporter status can be
// resolved by pull: plain request/response HTTP, with no gateway or persistent
// connection. See docs/cosmetics.md §7.
package discord

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const apiBase = "https://discord.com/api/v10"

// ErrNotMember means the user is not in the guild (HTTP 404). Callers treat this
// as "holds no granting roles" (not a supporter) rather than an error.
var ErrNotMember = errors.New("discord: user is not a member of the guild")

var defaultClient = &http.Client{Timeout: 10 * time.Second}

// Client calls the Discord REST API with a bot token for one guild.
type Client struct {
	Token   string // bot token (raw; the "Bot " prefix is added here)
	GuildID string
	BaseURL string       // overridable for tests; defaults to apiBase
	HTTP    *http.Client // overridable for tests; defaults to a 10s client
}

func (c Client) base() string {
	if c.BaseURL != "" {
		return strings.TrimSuffix(c.BaseURL, "/")
	}
	return apiBase
}

func (c Client) httpc() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return defaultClient
}

// GuildMemberRoles returns the role IDs the Discord user currently holds in the
// client's guild. ErrNotMember if they aren't in the guild (404).
func (c Client) GuildMemberRoles(ctx context.Context, discordUserID string) ([]string, error) {
	endpoint := fmt.Sprintf("%s/guilds/%s/members/%s", c.base(), c.GuildID, discordUserID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, http.NoBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bot "+c.Token)
	resp, err := c.httpc().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var m struct {
			Roles []string `json:"roles"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
			return nil, fmt.Errorf("discord: decode member: %w", err)
		}
		return m.Roles, nil
	case http.StatusNotFound:
		return nil, ErrNotMember
	default:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("discord: GET member: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
}

// ErrNoInstance means Discord does not know the activity instance (HTTP 404):
// it never existed, or every participant has left and it has ended.
var ErrNoInstance = errors.New("discord: no such activity instance")

// ActivityInstanceUsers returns the Discord user ids currently connected to one
// of the application's Activity instances, read from
// GET /applications/{app}/activity-instances/{instance} with the bot token.
//
// The instance id an Activity client reports is only a claim; this verifies
// server-side that the user is actually in that call.
func (c Client) ActivityInstanceUsers(ctx context.Context, appID, instanceID string) ([]string, error) {
	u := fmt.Sprintf("%s/applications/%s/activity-instances/%s", c.base(), url.PathEscape(appID), url.PathEscape(instanceID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, http.NoBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bot "+c.Token)
	resp, err := c.httpc().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		var inst struct {
			InstanceID string   `json:"instance_id"`
			Users      []string `json:"users"`
		}
		if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&inst); err != nil {
			return nil, fmt.Errorf("discord: decode activity instance: %w", err)
		}
		return inst.Users, nil
	case http.StatusNotFound:
		return nil, ErrNoInstance
	default:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("discord: GET activity instance: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
}
