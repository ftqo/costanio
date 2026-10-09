package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/store"
)

// feedJSON marshals a built feed message so tests can assert on the wire shape
// Discord actually receives.
func feedJSON(t *testing.T, comps []discord.Component) string {
	t.Helper()
	raw, err := json.Marshal(comps)
	if err != nil {
		t.Fatalf("marshal components: %v", err)
	}
	return string(raw)
}

func TestGameFeedComponentsRoster(t *testing.T) {
	g := &store.Game{ID: "g1", Ruleset: "base+islands"}
	seats := []*store.Seat{
		{No: 0, UserID: 1, Status: "active", UserName: "Alice", Avatar: "https://cdn.example/alice.png"},
		{No: 1, UserID: 2, Status: "active", UserName: "GuestBob", IsGuest: true},
		{No: 2, UserID: 3, Status: "bot", UserName: "Bot Carol"},
	}
	discordByUser := map[int64]string{1: "disc-alice"} // only Alice is linked
	body := feedJSON(t, gameFeedComponents(g, seats, discordByUser, "https://costan.example/game?g=g1", ""))

	// The wire body JSON-escapes '<', so match the mention's inner text.
	if !strings.Contains(body, "@disc-alice") {
		t.Errorf("linked player should be @-mentioned; body=%s", body)
	}
	if !strings.Contains(body, "GuestBob") || strings.Contains(body, "<@2>") {
		t.Errorf("guest should render by name, not mention; body=%s", body)
	}
	if !strings.Contains(body, "🤖") {
		t.Errorf("bot should render with a bot marker; body=%s", body)
	}
	if !strings.Contains(body, "Islands") {
		t.Errorf("feed should show the ruleset label; body=%s", body)
	}
	// Every seat gets its own avatar thumbnail: the linked player's real one,
	// and a stock Discord avatar for the guest and the bot.
	if !strings.Contains(body, "https://cdn.example/alice.png") {
		t.Errorf("linked player's avatar should be the section thumbnail; body=%s", body)
	}
	if n := strings.Count(body, `"type":11`); n != len(seats) {
		t.Errorf("want one thumbnail per seat (%d), got %d; body=%s", len(seats), n, body)
	}
	if n := strings.Count(body, `"type":9`); n != len(seats) {
		t.Errorf("want one section per seat (%d), got %d; body=%s", len(seats), n, body)
	}
	// Public game → a Watch link button carrying the watch URL.
	if !strings.Contains(body, "costan.example/game?g=g1") {
		t.Errorf("public game should carry a watch link; body=%s", body)
	}
}

func TestGameFeedComponentsNoButtonWithoutURL(t *testing.T) {
	g := &store.Game{ID: "p1", Ruleset: "base"}
	seats := []*store.Seat{{No: 0, UserID: 1, Status: "active", UserName: "Al"}}
	// No watch URL to offer → no link button, rather than one pointing nowhere.
	body := feedJSON(t, gameFeedComponents(g, seats, map[int64]string{}, "", ""))
	if strings.Contains(body, `"style":5`) {
		t.Errorf("an empty watch URL must not produce a link button; body=%s", body)
	}
}

// Every post carries the game id, so a game can be found and replayed, whether
// or not it has a watch link or a settings line.
func TestGameFeedComponentsCarryGameID(t *testing.T) {
	seats := []*store.Seat{{No: 0, UserID: 1, Status: "active", UserName: "Al"}}
	for _, g := range []*store.Game{
		{ID: "plain", Ruleset: "base"},
		{ID: "ranked-one", Ruleset: "base+cak", Ranked: true},
	} {
		body := feedJSON(t, gameFeedComponents(g, seats, map[int64]string{}, "", ""))
		if !strings.Contains(body, g.ID) {
			t.Errorf("post for %q does not name the game; body=%s", g.ID, body)
		}
	}
}

func TestGameFeedComponentsMarksRanked(t *testing.T) {
	seats := []*store.Seat{{No: 0, UserID: 1, Status: "active", UserName: "Al"}}
	ranked := feedJSON(t, gameFeedComponents(&store.Game{ID: "r1", Ruleset: "base", Ranked: true}, seats, map[int64]string{}, "", ""))
	if !strings.Contains(ranked, "Ranked") {
		t.Errorf("a ranked match should say so; body=%s", ranked)
	}
	casual := feedJSON(t, gameFeedComponents(&store.Game{ID: "c1", Ruleset: "base"}, seats, map[int64]string{}, "", ""))
	if strings.Contains(casual, "Ranked") {
		t.Errorf("a casual game must not claim to be ranked; body=%s", casual)
	}
}

func TestGameFeedComponentsUsesConfiguredTitle(t *testing.T) {
	g := &store.Game{ID: "g1", Ruleset: "base"}
	seats := []*store.Seat{{No: 0, UserID: 1, Status: "active", UserName: "Al"}}

	def := feedJSON(t, gameFeedComponents(g, seats, map[int64]string{}, "", ""))
	if !strings.Contains(def, defaultFeedTitle) {
		t.Errorf("empty title should fall back to default; body=%s", def)
	}
	custom := feedJSON(t, gameFeedComponents(g, seats, map[int64]string{}, "", "Match on!"))
	if !strings.Contains(custom, "Match on!") || strings.Contains(custom, defaultFeedTitle) {
		t.Errorf("configured title should be used; body=%s", custom)
	}
}

func TestGameFeedSettingsLine(t *testing.T) {
	cases := []struct {
		name   string
		config string
		want   []string
	}{
		{"goal and timer", `{"target_vp":10,"turn_timer_sec":90}`, []string{"10 VP", "1m 30s"}},
		{"fair dice", `{"target_vp":12,"dice_mode":"fair"}`, []string{"12 VP", "fair"}},
		{"short timer", `{"turn_timer_sec":45}`, []string{"45s"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := gameSettingsLine(&store.Game{Config: json.RawMessage(tc.config)})
			for _, want := range tc.want {
				if !strings.Contains(got, want) {
					t.Errorf("settings line %q missing %q", got, want)
				}
			}
		})
	}
}

func TestGameFeedSettingsLineEmptyOnDefaults(t *testing.T) {
	// Nothing worth saying → no line at all, since a components message may not
	// carry an empty text block.
	for _, cfg := range []string{`{}`, `not json`} {
		if got := gameSettingsLine(&store.Game{Config: json.RawMessage(cfg)}); got != "" {
			t.Errorf("config %s should yield no settings line; got %q", cfg, got)
		}
	}
	body := feedJSON(t, gameFeedComponents(
		&store.Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{}`)},
		[]*store.Seat{{No: 0, UserID: 1, Status: "active", UserName: "Al"}},
		map[int64]string{}, "", ""))
	if strings.Contains(body, `"content":""`) {
		t.Errorf("feed must not post an empty text block; body=%s", body)
	}
}

func TestGameFeedComponentsHaveNoMap(t *testing.T) {
	g := &store.Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{"preset":"beginner","target_vp":10}`)}
	seats := []*store.Seat{{No: 0, UserID: 1, Status: "active", UserName: "Al"}}
	body := feedJSON(t, gameFeedComponents(g, seats, map[int64]string{}, "", ""))
	if strings.Contains(body, "Map:") || strings.Contains(body, "beginner") {
		t.Errorf("the feed should not name the map; body=%s", body)
	}
}

func TestSeatColorSquaresUseEffectiveColor(t *testing.T) {
	// An explicit hex wins; an unpicked seat falls back to its seat-order default.
	got := seatColorSquares([]*store.Seat{{ColorHex: "#ff0000"}, {No: 1, ColorHex: "#0000ff"}})
	if got[0] != "🟥" || got[1] != "🟦" {
		t.Errorf("hexes should map to their nearest squares; got %v", got)
	}
	if sq := seatColorSquares([]*store.Seat{{No: 1}})[0]; sq == "" {
		t.Error("unpicked seat should still get a square from its default color")
	}
}

func TestSeatColorSquaresAreDistinct(t *testing.T) {
	// Seat defaults include both cyan and blue, which share a nearest square;
	// every seat on a full nine-player table must still read differently.
	seats := make([]*store.Seat, 9)
	for i := range seats {
		seats[i] = &store.Seat{No: i}
	}
	seen := map[string]bool{}
	for i, sq := range seatColorSquares(seats) {
		if seen[sq] {
			t.Errorf("seat %d reuses square %q", i, sq)
		}
		seen[sq] = true
	}
}

func TestRosterLineEscapesNames(t *testing.T) {
	line := rosterLine(&store.Seat{No: 0, UserName: "**boss**", Status: "active"}, "", "🟥")
	if strings.Contains(line, "****boss****") || !strings.Contains(line, `\*\*boss\*\*`) {
		t.Errorf("markdown in a display name must be escaped; got %q", line)
	}
	if !strings.HasPrefix(line, "`1.`") {
		t.Errorf("roster line should lead with the seat's turn-order number; got %q", line)
	}
}

// fakeChannelPost stands up an httptest server capturing the last channel-message
// POST, and returns a discord.Client aimed at it plus a pointer to the captured body.
func fakeChannelPost(t *testing.T) (*discord.Client, *string, *string) {
	t.Helper()
	var mu sync.Mutex
	var gotPath, gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Write([]byte(`{"id":"m1"}`))
	}))
	t.Cleanup(ts.Close)
	return &discord.Client{Token: "tok", GuildID: "g", BaseURL: ts.URL, HTTP: ts.Client()}, &gotPath, &gotBody
}

func TestPostGameFeedPostsWhenConfigured(t *testing.T) {
	e := newEnv(t)
	bot, gotPath, gotBody := fakeChannelPost(t)
	e.srv.discordBot = bot
	if err := e.st.SetFeedChannel("feedchan"); err != nil {
		t.Fatal(err)
	}
	u, _ := e.discordUser(t, "disc-9", "Nine")
	seatUserInGame(t, e, "feed-game", u.ID, false, true)

	e.srv.postGameFeed("feed-game")

	if !strings.HasSuffix(*gotPath, "/channels/feedchan/messages") {
		t.Fatalf("posted to wrong channel: %q", *gotPath)
	}
	var body struct {
		Flags           int             `json:"flags"`
		Components      json.RawMessage `json:"components"`
		Embeds          json.RawMessage `json:"embeds"`
		AllowedMentions struct {
			Parse []string `json:"parse"`
		} `json:"allowed_mentions"`
	}
	if err := json.Unmarshal([]byte(*gotBody), &body); err != nil {
		t.Fatalf("decode body: %v (%s)", err, *gotBody)
	}
	if body.Flags != discord.FlagComponentsV2 {
		t.Errorf("feed must opt into components v2; flags=%d", body.Flags)
	}
	if body.Embeds != nil {
		t.Errorf("a components-v2 message may not carry embeds; body=%s", *gotBody)
	}
	if len(body.AllowedMentions.Parse) != 0 {
		t.Errorf("mentions must not ping; parse=%v", body.AllowedMentions.Parse)
	}
	// The wire body JSON-escapes '<'; the linked id appears only inside a mention,
	// so its presence proves the player was rendered as a mention rather than named.
	if !strings.Contains(string(body.Components), "@disc-9") {
		t.Fatalf("feed should mention the linked player; components=%s", body.Components)
	}
}

// Tables are created private by default, so a private game's feed post must
// carry a usable watch link: the button needs the invite code to pass the
// spectate gate.
func TestPostGameFeedPrivateWatchLinkHasInvite(t *testing.T) {
	e := newEnv(t)
	bot, _, gotBody := fakeChannelPost(t)
	e.srv.discordBot = bot
	if err := e.st.SetFeedChannel("feedchan"); err != nil {
		t.Fatal(err)
	}
	u, _ := e.discordUser(t, "disc-p", "Priv")
	seatUserInGame(t, e, "priv-game", u.ID, true, true) // invite code "secret"

	e.srv.postGameFeed("priv-game")

	if !strings.Contains(*gotBody, `"style":5`) {
		t.Fatalf("private game should still get a watch button; body=%s", *gotBody)
	}
	if !strings.Contains(*gotBody, "/game?g=priv-game\\u0026inv=secret") &&
		!strings.Contains(*gotBody, "/game?g=priv-game&inv=secret") {
		t.Fatalf("watch link should carry the invite code; body=%s", *gotBody)
	}
}

// A public game's link carries the invite too: the table is open and the link
// lets a reader pass it on. Going private rotates the code (lobby.SetPrivacy),
// so an old feed post's link stops working.
func TestPostGameFeedPublicWatchLinkHasInvite(t *testing.T) {
	e := newEnv(t)
	bot, _, gotBody := fakeChannelPost(t)
	e.srv.discordBot = bot
	if err := e.st.SetFeedChannel("feedchan"); err != nil {
		t.Fatal(err)
	}
	u, _ := e.discordUser(t, "disc-q", "Pub")
	seatUserInGame(t, e, "pub-feed-game", u.ID, false, true)

	e.srv.postGameFeed("pub-feed-game")

	if !strings.Contains(*gotBody, "/game?g=pub-feed-game") {
		t.Fatalf("public game should carry a watch link; body=%s", *gotBody)
	}
	if !strings.Contains(*gotBody, "inv=secret") {
		t.Fatalf("public game link should carry the invite; body=%s", *gotBody)
	}
}

func TestPostGameFeedNoopWhenUnset(t *testing.T) {
	e := newEnv(t)
	bot, gotPath, _ := fakeChannelPost(t)
	e.srv.discordBot = bot
	// No feed channel configured.
	u, _ := e.discordUser(t, "disc-x", "Ex")
	seatUserInGame(t, e, "quiet-game", u.ID, false, true)

	e.srv.postGameFeed("quiet-game")
	if *gotPath != "" {
		t.Fatalf("no feed channel set → must not post; hit %q", *gotPath)
	}
}

func TestPostGameFeedNoopWithoutBot(t *testing.T) {
	e := newEnv(t)
	// discordBot stays nil.
	if err := e.st.SetFeedChannel("feedchan"); err != nil {
		t.Fatal(err)
	}
	u, _ := e.discordUser(t, "disc-y", "Why")
	seatUserInGame(t, e, "nobot-game", u.ID, false, true)
	e.srv.postGameFeed("nobot-game") // must not panic
}
