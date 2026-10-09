package server

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ftqo/costan.io/store"
)

// discordPoster returns a helper that posts signed interactions to the test
// server and returns the decoded response. Shared by the ops command tests.
func discordPoster(t *testing.T, e *testEnv) func(body string) map[string]any {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	e.srv.SetDiscordInteractions(hex.EncodeToString(pub))
	e.srv.SetDiscordGuild(testHomeGuild)
	return func(body string) map[string]any {
		t.Helper()
		body = inHomeGuild(body)
		req, _ := http.NewRequest(http.MethodPost, e.ts.URL+"/discord/interactions", bytes.NewReader([]byte(body)))
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		req.Header.Set("X-Signature-Timestamp", ts)
		req.Header.Set("X-Signature-Ed25519", hex.EncodeToString(ed25519.Sign(priv, append([]byte(ts), body...))))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { resp.Body.Close() })
		var out map[string]any
		json.NewDecoder(resp.Body).Decode(&out)
		return out
	}
}

// testHomeGuild is the DISCORD_GUILD_ID the interaction tests run under.
const testHomeGuild = "g-home"

// inHomeGuild stamps an interaction body as coming from the home guild, as
// Discord does for every guild interaction, unless the body already names one.
func inHomeGuild(body string) string {
	if strings.Contains(body, `"guild_id"`) || !strings.HasPrefix(body, "{") {
		return body
	}
	return `{"guild_id":"` + testHomeGuild + `",` + body[1:]
}

// firstEmbedText concatenates an embed's title/description/field text for a
// loose "does the reply mention X" assertion.
func firstEmbedText(t *testing.T, resp map[string]any) string {
	t.Helper()
	data, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatalf("no data in response: %v", resp)
	}
	embeds, ok := data["embeds"].([]any)
	if !ok || len(embeds) == 0 {
		// Fall back to plain content for non-embed replies.
		if c, ok := data["content"].(string); ok {
			return c
		}
		t.Fatalf("no embeds/content in response: %v", resp)
	}
	raw, _ := json.Marshal(embeds[0])
	return string(raw)
}

func TestStatsSelf(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	u, _ := e.discordUser(t, "caller-1", "Cara")
	e.st.BumpStats(u.ID, "base", true, false, true, false)
	e.st.SetRatingRow(u.ID, "base", 30, 5, 1_700_000_000)

	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"caller-1"}},"data":{"name":"stats"}}`)
	if resp["type"] != float64(responseMessage) {
		t.Fatalf("stats → %v", resp)
	}
	// "Base" is the prettified label for the base ruleset.
	if txt := firstEmbedText(t, resp); !strings.Contains(txt, "Base") {
		t.Fatalf("stats embed should mention the ruleset; got %s", txt)
	}
}

func TestStatsUserArgIsAdminOnly(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	e.discordUser(t, "target-1", "Tom")

	// Non-admin passing user= is refused.
	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"caller-x"}},"data":{"name":"stats","options":[{"name":"user","value":"target-1"}]}}`)
	if txt := firstEmbedText(t, resp); !strings.Contains(strings.ToLower(txt), "your own") {
		t.Fatalf("non-admin /stats user= should be refused; got %s", txt)
	}
	// Admin passing user= sees the target.
	resp = post(`{"type":2,"member":{"permissions":"8","user":{"id":"caller-x"}},"data":{"name":"stats","options":[{"name":"user","value":"target-1"}]}}`)
	if txt := firstEmbedText(t, resp); !strings.Contains(txt, "Tom") {
		t.Fatalf("admin /stats user= should show target; got %s", txt)
	}
}

func seatUserInGame(t *testing.T, e *testEnv, gameID string, userID int64, private, active bool) {
	t.Helper()
	// As in production since 0029: every table has a code, and `public` says
	// whether it is listed.
	g := &store.Game{ID: gameID, Ruleset: "base", Config: []byte("{}"),
		InviteCode: "secret", Public: !private, CreatedBy: userID}
	if err := e.st.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	if err := e.st.AddSeat(gameID, 0, userID); err != nil {
		t.Fatal(err)
	}
	if active {
		if err := e.st.SetGameStatus(gameID, "active"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSpectatePublicGame(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	u, _ := e.discordUser(t, "player-1", "Pat")
	seatUserInGame(t, e, "pub-game", u.ID, false, true)

	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"x"}},"data":{"name":"spectate","options":[{"name":"user","value":"player-1"}]}}`)
	// The watch link now lives in a link button, so check the whole response.
	if txt := fullResponseText(t, resp); !strings.Contains(txt, "pub-game") {
		t.Fatalf("spectate of public game should link the game; got %s", txt)
	}
}

// fullResponseText is the entire interaction response JSON (embeds AND
// components), for assertions that span the watch-link button.
func fullResponseText(t *testing.T, resp map[string]any) string {
	t.Helper()
	raw, _ := json.Marshal(resp)
	return string(raw)
}

func TestSpectatePrivateGameNotDisclosed(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	u, _ := e.discordUser(t, "player-2", "Priv")
	seatUserInGame(t, e, "priv-game", u.ID, true, true)

	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"x"}},"data":{"name":"spectate","options":[{"name":"user","value":"player-2"}]}}`)
	// The private game id must appear nowhere: not in the embed, not in a button url.
	if txt := fullResponseText(t, resp); strings.Contains(txt, "priv-game") {
		t.Fatalf("private game id must never be disclosed; got %s", txt)
	}
}

// An admin gets the private game, invite code and all: the code passes the
// spectate gate, and a Manage-Server admin is already trusted with the server.
func TestSpectatePrivateGameDisclosedToAdmin(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	u, _ := e.discordUser(t, "player-4", "Priv")
	seatUserInGame(t, e, "priv-admin-game", u.ID, true, true)

	resp := post(`{"type":2,"member":{"permissions":"8","user":{"id":"x"}},"data":{"name":"spectate","options":[{"name":"user","value":"player-4"}]}}`)
	txt := fullResponseText(t, resp)
	if !strings.Contains(txt, "priv-admin-game") {
		t.Fatalf("admin spectate should link the private game; got %s", txt)
	}
	if !strings.Contains(txt, "inv=secret") {
		t.Fatalf("admin watch link should carry the invite code; got %s", txt)
	}
}

func TestSpectateNotInGame(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	e.discordUser(t, "player-3", "Idle")

	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"x"}},"data":{"name":"spectate","options":[{"name":"user","value":"player-3"}]}}`)
	if resp["type"] != float64(responseMessage) {
		t.Fatalf("spectate (not in game) → %v", resp)
	}
}

func TestLeaderboard(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	u, _ := e.discordUser(t, "lb-1", "Lana")
	e.st.SetRatingRow(u.ID, "base", 40, 2, 1_700_000_000)
	// The leaderboard reads the daily snapshot, so capture one before querying.
	e.st.RefreshLeaderboardSnapshot(1_700_000_000)

	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"x"}},"data":{"name":"leaderboard"}}`)
	if txt := firstEmbedText(t, resp); !strings.Contains(txt, "Lana") {
		t.Fatalf("leaderboard should list players; got %s", txt)
	}
}

func TestWhoisAdminOnly(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	e.discordUser(t, "who-1", "Wendy")

	// Non-admin is refused.
	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"x"}},"data":{"name":"whois","options":[{"name":"user","value":"who-1"}]}}`)
	if txt := firstEmbedText(t, resp); strings.Contains(txt, "Wendy") {
		t.Fatalf("non-admin must not see /whois output; got %s", txt)
	}
	// Admin sees the diagnostic.
	resp = post(`{"type":2,"member":{"permissions":"8","user":{"id":"x"}},"data":{"name":"whois","options":[{"name":"user","value":"who-1"}]}}`)
	if txt := firstEmbedText(t, resp); !strings.Contains(txt, "Wendy") {
		t.Fatalf("admin /whois should show the account; got %s", txt)
	}
}

func TestResetUserConfirmFlow(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	u, _ := e.discordUser(t, "reset-1", "Rhea")
	e.st.BumpStats(u.ID, "base", true, false, true, false)
	e.st.SetRatingRow(u.ID, "base", 30, 5, 1_700_000_000)

	// Non-admin cannot even prompt.
	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"x"}},"data":{"name":"reset-user","options":[{"name":"user","value":"reset-1"}]}}`)
	if _, hasComp := resp["data"].(map[string]any)["components"]; hasComp {
		t.Fatalf("non-admin reset-user must not present a confirm button")
	}

	// Admin gets a confirm button.
	resp = post(`{"type":2,"member":{"permissions":"8","user":{"id":"x"}},"data":{"name":"reset-user","options":[{"name":"user","value":"reset-1"}]}}`)
	comps, ok := resp["data"].(map[string]any)["components"].([]any)
	if !ok || len(comps) == 0 {
		t.Fatalf("admin reset-user should present a confirm button; got %v", resp)
	}

	// Pressing the button (component interaction, type 3) as admin executes.
	confirm := `{"type":3,"member":{"permissions":"8","user":{"id":"x"}},"data":{"custom_id":"reset-user:reset-1"}}`
	post(confirm)
	rows, _ := e.st.StatsFor(u.ID)
	if len(rows) != 0 {
		t.Fatalf("after confirmed reset, stats should be cleared; got %v", rows)
	}
}

func TestResetUserComponentRequiresAdmin(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	u, _ := e.discordUser(t, "reset-2", "Sam")
	e.st.BumpStats(u.ID, "base", true, false, true, false)

	// Non-admin button press must not reset.
	post(`{"type":3,"member":{"permissions":"0","user":{"id":"x"}},"data":{"custom_id":"reset-user:reset-2"}}`)
	rows, _ := e.st.StatsFor(u.ID)
	if len(rows) == 0 {
		t.Fatalf("non-admin component press must not reset the user")
	}
}
