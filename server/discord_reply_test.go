package server

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/ftqo/costan.io/discord"
)

func decodeResp(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &m); err != nil {
		t.Fatalf("unmarshal response: %v (body=%q)", err, rr.Body.String())
	}
	return m
}

func TestReplyEmbedEphemeral(t *testing.T) {
	rr := httptest.NewRecorder()
	replyEmbed(rr, discord.Embed{Title: "Stats"}, true)

	m := decodeResp(t, rr)
	if m["type"] != float64(responseMessage) {
		t.Fatalf("type = %v; want %d", m["type"], responseMessage)
	}
	data := m["data"].(map[string]any)
	if data["flags"] != float64(flagEphemeral) {
		t.Fatalf("flags = %v; want %d", data["flags"], flagEphemeral)
	}
	embeds, ok := data["embeds"].([]any)
	if !ok || len(embeds) != 1 {
		t.Fatalf("embeds = %v; want 1", data["embeds"])
	}
	if embeds[0].(map[string]any)["title"] != "Stats" {
		t.Fatalf("embed title = %v", embeds[0])
	}
	if _, present := data["components"]; present {
		t.Fatalf("plain replyEmbed must not set components")
	}
}

func TestReplyEmbedNonEphemeralOmitsFlags(t *testing.T) {
	rr := httptest.NewRecorder()
	replyEmbed(rr, discord.Embed{Title: "Live"}, false)

	data := decodeResp(t, rr)["data"].(map[string]any)
	if _, present := data["flags"]; present {
		t.Fatalf("non-ephemeral reply should omit flags; got %v", data["flags"])
	}
}

func TestReplyEmbedWithButtons(t *testing.T) {
	rr := httptest.NewRecorder()
	row := discord.ActionRow{Buttons: []discord.Button{
		{Label: "Confirm reset", CustomID: "reset-user:7", Style: discord.ButtonDanger},
	}}
	replyEmbedWithButtons(rr, discord.Embed{Title: "Confirm"}, []discord.ActionRow{row}, true)

	data := decodeResp(t, rr)["data"].(map[string]any)
	comps, ok := data["components"].([]any)
	if !ok || len(comps) != 1 {
		t.Fatalf("components = %v; want 1 action row", data["components"])
	}
	rowMap := comps[0].(map[string]any)
	btn := rowMap["components"].([]any)[0].(map[string]any)
	if btn["custom_id"] != "reset-user:7" {
		t.Fatalf("button custom_id = %v", btn["custom_id"])
	}
}
