package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// PostChannelMessage posts an embed (optionally with button rows) to a channel
// and returns the created message id. Used to surface moderation reports.
func (c Client) PostChannelMessage(ctx context.Context, channelID string, embed Embed, rows []ActionRow) (string, error) {
	payload := map[string]any{"embeds": []Embed{embed}}
	if len(rows) > 0 {
		payload["components"] = rows
	}
	body, err := c.postJSON(ctx, fmt.Sprintf("%s/channels/%s/messages", c.base(), channelID), payload)
	if err != nil {
		return "", err
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("discord: decode message: %w", err)
	}
	return out.ID, nil
}

// PostComponentsMessage posts a Components V2 message (no content, no embeds:
// see FlagComponentsV2) to a channel and returns the created message id.
// Mentions inside the components render as names but never ping, matching how
// an embed behaves, so a feed channel does not notify everyone it names.
func (c Client) PostComponentsMessage(ctx context.Context, channelID string, components []Component) (string, error) {
	payload := map[string]any{
		"flags":            FlagComponentsV2,
		"components":       components,
		"allowed_mentions": map[string]any{"parse": []string{}},
	}
	body, err := c.postJSON(ctx, fmt.Sprintf("%s/channels/%s/messages", c.base(), channelID), payload)
	if err != nil {
		return "", err
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("discord: decode message: %w", err)
	}
	return out.ID, nil
}

// SendDM opens (or reuses) the bot's DM channel with a user and posts a plain
// message. Best-effort: a user who blocks DMs yields a 403, surfaced as an error
// the caller logs but does not treat as fatal.
func (c Client) SendDM(ctx context.Context, discordUserID, content string) error {
	body, err := c.postJSON(ctx, c.base()+"/users/@me/channels", map[string]any{"recipient_id": discordUserID})
	if err != nil {
		return err
	}
	var ch struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &ch); err != nil {
		return fmt.Errorf("discord: decode dm channel: %w", err)
	}
	_, err = c.postJSON(ctx, fmt.Sprintf("%s/channels/%s/messages", c.base(), ch.ID), map[string]any{"content": content})
	return err
}

func (c Client) postJSON(ctx context.Context, url string, payload any) ([]byte, error) {
	buf, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bot "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpc().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("discord: POST %s: %s: %s", url, resp.Status, strings.TrimSpace(string(body)))
	}
	return body, nil
}
