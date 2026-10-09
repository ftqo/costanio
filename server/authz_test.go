package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// Authorization tests. Each covers a case where authorization was read from the
// wrong place: a seat cached at subscribe time, presence measured site-wide
// instead of per table, a chat id taken on trust, an unsanitized summary.

// startActiveDuel starts a real two-human game and returns its id. No bots, so
// nothing moves except what the test sends.
func startActiveDuel(t *testing.T, e *testEnv, host, other *store.User) string {
	t.Helper()
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 2}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.Join(other, sum.Game.ID, ""); err != nil {
		t.Fatal(err)
	}
	if err := e.srv.lobby.Start(host, sum.Game.ID); err != nil {
		t.Fatal(err)
	}
	return sum.Game.ID
}

// TestCommandIsAttributedToTheSendersOwnSeat: a seat cached on the Conn at
// subscribe time does not survive lobby.Start, which rebuilds seat rows and
// re-deals turn order, so the conn could act as another player.
//
// Both directions are asserted from the same state: the off-turn player's
// command is refused as NOT_YOUR_TURN and the on-turn player's identical
// command is not. Checking only one could pass by luck of the shuffle.
func TestCommandIsAttributedToTheSendersOwnSeat(t *testing.T) {
	e := newEnv(t)
	alice, _ := e.discordUser(t, "a", "alice")
	bob, _ := e.discordUser(t, "b", "bob")
	id := startActiveDuel(t, e, alice, bob)

	cur := mirror(t, e.st, id).Cur
	aSeat, err := e.st.SeatForUser(id, alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	onTurn, offTurn := alice, bob
	if engine.PlayerID(aSeat.No) != cur {
		onTurn, offTurn = bob, alice
	}

	// A bare settlement placement: the engine checks the phase, then the seat,
	// before it looks at the (absent) payload, so the seat check is what decides.
	play := func(u *store.User) chan []byte {
		c := &Conn{srv: e.srv, user: u, userID: u.ID, send: make(chan []byte, 8), gameID: id}
		c.handleCmd(clientFrame{T: "cmd", ID: "p", Game: id,
			Cmd: &cmdPayload{Type: engine.CmdPlaceSettlement}})
		return c.send
	}

	if !drainHasCode(play(offTurn), "NOT_YOUR_TURN") {
		t.Errorf("%s played off turn and was not refused (seat %d belongs to %s)", offTurn.Name, cur, onTurn.Name)
	}
	if drainHasCode(play(onTurn), "NOT_YOUR_TURN") {
		t.Errorf("%s holds seat %d but got NOT_YOUR_TURN", onTurn.Name, cur)
	}
}

// Somebody with no seat in the game is a spectator, whatever else they are
// following.
func TestCommandFromUnseatedUserIsRefused(t *testing.T) {
	e := newEnv(t)
	alice, _ := e.discordUser(t, "a", "alice")
	bob, _ := e.discordUser(t, "b", "bob")
	watcher, _ := e.discordUser(t, "w", "watcher")
	id := startActiveDuel(t, e, alice, bob)

	c := &Conn{srv: e.srv, user: watcher, userID: watcher.ID,
		send: make(chan []byte, 8), gameID: id}
	c.handleCmd(clientFrame{T: "cmd", ID: "watch", Game: id,
		Cmd: &cmdPayload{Type: engine.CmdPlaceSettlement}})

	if !drainHasCode(c.send, "SPECTATOR_CANNOT_ACT") {
		t.Fatal("an unseated watcher was allowed to act")
	}
}

// actingSeat is the shared resolver behind handleCmd and Conn.close, and the
// only source of a seat for either.
func TestActingSeatComesFromTheSeatTable(t *testing.T) {
	e := newEnv(t)
	alice, _ := e.discordUser(t, "a", "alice")
	bob, _ := e.discordUser(t, "b", "bob")
	id := startActiveDuel(t, e, alice, bob)

	bSeat, err := e.st.SeatForUser(id, bob.ID)
	if err != nil {
		t.Fatal(err)
	}
	c := &Conn{srv: e.srv, userID: bob.ID, gameID: id}
	if got := c.actingSeat(id); got != engine.PlayerID(bSeat.No) {
		t.Errorf("actingSeat = %d, want %d (bob's seat in the store)", got, bSeat.No)
	}

	stranger, _ := e.discordUser(t, "s", "stranger")
	c2 := &Conn{srv: e.srv, userID: stranger.ID, gameID: id}
	if got := c2.actingSeat(id); got != game.Spectator {
		t.Errorf("actingSeat for an unseated user = %d, want Spectator (%d)", got, game.Spectator)
	}
	// And a seat is per game: bob's number in this game says nothing about another.
	if got := c.actingSeat("some-other-game"); got != game.Spectator {
		t.Errorf("actingSeat in an unrelated game = %d, want Spectator (%d)", got, game.Spectator)
	}
}

// TestClosingTableTabSuspendsWithOtherTabOpen: a player with the game
// in one tab and the homepage in another is hub.Online from both. Seat-absent
// and presence work must be per game (as anyHumanPresent is), so closing the
// table tab still suspends the game.
func TestClosingTableTabSuspendsWithOtherTabOpen(t *testing.T) {
	e := newEnv(t)
	clk := &fakeLeaveClock{}
	e.srv.clock = clk
	host, hostC := e.discordUser(t, "h", "host")
	// Playing alone against bots is a supporter perk.
	if err := e.st.SetSupporter(host.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	id := startActiveSolo(t, e, host)

	// Tab A: the table. A real socket, because only a real one runs Conn.close.
	tabA := dialWS(t, e.ts, hostC)
	tabA.send(map[string]any{"t": "sub", "game": id})
	tabA.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "state")

	// Tab B: the homepage. Online, following nothing.
	e.srv.hub.add(&Conn{srv: e.srv, userID: host.ID})

	// Close the table tab. Wait on the abandon timer rather than the follower
	// index: hub.remove is the first thing Conn.close does and the presence
	// reconcile nearly the last, so watching the index would race.
	_ = tabA.conn.CloseNow()
	waitFor(t, func() bool {
		e.srv.suspendMu.Lock()
		defer e.srv.suspendMu.Unlock()
		_, armed := e.srv.suspending[id]
		return armed
	}, "the abandon grace to be armed for a table with nobody at it")

	clk.fire()
	if g, _ := e.st.GameByID(id); g.Status != "abandoned" {
		t.Errorf("game status = %s, want abandoned", g.Status)
	}
}

// The per-game answer Conn.close now asks for.
func TestHubFollowingGameIsPerGameNotGlobal(t *testing.T) {
	h := NewHub()
	elsewhere := &Conn{userID: 7}
	h.add(elsewhere)
	if !h.Online(7) {
		t.Fatal("Online should see a connection following nothing")
	}
	if h.FollowingGame("g1", 7) {
		t.Error("FollowingGame said yes for a connection that follows no game")
	}
	h.setFollowing(elsewhere, "g1")
	if !h.FollowingGame("g1", 7) {
		t.Error("FollowingGame said no for a connection that follows the game")
	}
	if h.FollowingGame("g2", 7) {
		t.Error("FollowingGame said yes for a different game")
	}
}

// A subscribe that fails partway must not leave the connection indexed as a
// follower: it would count toward presence, receive broadcasts, and on close
// mark a seat absent.
func TestFailedSubscribeDoesNotFollow(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "h", "host")
	if err := e.st.SetSupporter(host.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	id := startActiveSolo(t, e, host)
	// Stopping the manager is what makes mgr.Get refuse; the game row stays
	// "active", so handleSub takes the branch that then fails.
	e.srv.mgr.StopAll()

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": id})
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["code"] == "INTERNAL" }, "subscribe failure")

	waitFor(t, func() bool { return len(e.srv.hub.GameFollowers(id)) == 0 }, "conn dropped from the follower index")
}

// TestReportRefusesUnseenMessage: chat.id is a sequential
// INTEGER PRIMARY KEY, so without a visibility check anyone could walk the ids
// and report strangers' messages. Each report posts a mod-channel embed with
// live Warn / Chat-ban buttons.
func TestReportRefusesUnseenMessage(t *testing.T) {
	e := newEnv(t)
	accused, _ := e.discordUser(t, "acc", "accused")
	reporter, _ := e.discordUser(t, "rep", "reporter")

	// A message in a game the reporter has nothing to do with.
	cid, err := e.srv.store.SaveChat("game:someone-elses-table", accused.ID, "in another game")
	if err != nil {
		t.Fatal(err)
	}

	c := &Conn{srv: e.srv, user: reporter, userID: reporter.ID,
		send: make(chan []byte, 8)}
	c.handleReport(clientFrame{T: "report", ID: "1", ChatID: cid})

	if !drainHasCode(c.send, "NOT_IN_THAT_GAME") {
		t.Fatal("a message from a game the reporter never joined was reportable")
	}
	if _, err := e.srv.store.OpenReportForChat(cid); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("a report row was created for an unseen message: %v", err)
	}
}

// The other side of the same gate: following the game makes its chat reportable,
// and lobby chat is reportable by anyone (everyone sees it).
func TestReportAcceptsScopesTheReporterCanSee(t *testing.T) {
	e := newEnv(t)
	accused, _ := e.discordUser(t, "acc", "accused")

	gameCID, err := e.srv.store.SaveChat("game:table-1", accused.ID, "in this game")
	if err != nil {
		t.Fatal(err)
	}
	inGame, _ := e.discordUser(t, "rep1", "in-game reporter")
	c1 := &Conn{srv: e.srv, user: inGame, userID: inGame.ID,
		send: make(chan []byte, 8), gameID: "table-1"}
	c1.handleReport(clientFrame{T: "report", ID: "1", ChatID: gameCID})
	waitFor(t, func() bool {
		_, err := e.srv.store.OpenReportForChat(gameCID)
		return err == nil
	}, "report on the game the reporter is following")

	lobbyCID, err := e.srv.store.SaveChat("lobby", accused.ID, "in the lobby")
	if err != nil {
		t.Fatal(err)
	}
	anyone, _ := e.discordUser(t, "rep2", "lobby reporter")
	c2 := &Conn{srv: e.srv, user: anyone, userID: anyone.ID,
		send: make(chan []byte, 8)}
	c2.handleReport(clientFrame{T: "report", ID: "2", ChatID: lobbyCID})
	waitFor(t, func() bool {
		_, err := e.srv.store.OpenReportForChat(lobbyCID)
		return err == nil
	}, "report on lobby chat")
}

// A chat-banned user must not be able to file reports either: each one puts an
// embed with live mod buttons in front of a moderator.
func TestChatBannedUserCannotReport(t *testing.T) {
	e := newEnv(t)
	accused, _ := e.discordUser(t, "acc", "accused")
	banned, _ := e.discordUser(t, "ban", "banned")
	if err := e.srv.store.BanChat(banned.ID, "test", nil, nil); err != nil {
		t.Fatal(err)
	}
	cid, err := e.srv.store.SaveChat("lobby", accused.ID, "bad message")
	if err != nil {
		t.Fatal(err)
	}

	c := &Conn{srv: e.srv, user: banned, userID: banned.ID,
		send: make(chan []byte, 8)}
	c.handleReport(clientFrame{T: "report", ID: "1", ChatID: cid})

	if !drainHasCode(c.send, "CHAT_BANNED") {
		t.Fatal("a chat-banned user was allowed to file a report")
	}
	if _, err := e.srv.store.OpenReportForChat(cid); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("chat-banned user's report was filed: %v", err)
	}
}

// activityLobby POSTs an instance id and returns the decoded body.
func activityLobby(t *testing.T, e *testEnv, cookie *http.Cookie, instance string) (*http.Response, map[string]any) {
	t.Helper()
	return e.req(t, "POST", "/api/activity/lobby", cookie, map[string]any{"instance_id": instance})
}

// An activity table is private, and its invite code is its access control. The
// spectator branch must not hand back the raw summary.
func TestActivityLobbyHidesInviteFromSpectator(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d0", "host")
	if resp, body := activityLobby(t, e, hostC, "i-1"); resp.StatusCode != http.StatusOK {
		t.Fatalf("host open = %d: %v", resp.StatusCode, body)
	}
	// Fill the remaining three seats of the default 4-player table.
	for _, id := range []string{"d1", "d2", "d3"} {
		_, c := e.discordUser(t, id, id)
		if resp, body := activityLobby(t, e, c, "i-1"); resp.StatusCode != http.StatusOK {
			t.Fatalf("%s join = %d: %v", id, resp.StatusCode, body)
		}
	}

	_, lateC := e.discordUser(t, "d4", "late")
	resp, body := activityLobby(t, e, lateC, "i-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("late open = %d: %v", resp.StatusCode, body)
	}
	if role, _ := body["role"].(string); role != "spectator" {
		t.Fatalf("role = %q, want spectator", role)
	}
	sum, _ := body["summary"].(map[string]any)
	g, _ := sum["game"].(map[string]any)
	if code, _ := g["invite_code"].(string); code != "" {
		t.Errorf("invite_code = %q, want empty for a spectator", code)
	}
}

// For an unseen instance id this endpoint creates a game, so it needs the same
// meter as POST /api/games.
func TestActivityLobbyIsRateLimited(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d0", "host")
	var limited bool
	for range 20 {
		resp, _ := activityLobby(t, e, hostC, "i-1")
		if resp.StatusCode == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Error("POST /api/activity/lobby was never rate limited")
	}
}

// instance_id is a client-supplied key that names (and creates) a table, so it
// is held to a shape rather than trusted.
func TestActivityLobbyRejectsAMalformedInstanceID(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d0", "host")
	for _, bad := range []string{"", "has space", "new\nline", string(make([]byte, maxInstanceIDLen+1))} {
		resp, _ := activityLobby(t, e, hostC, bad)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("instance_id %q = %d, want 400", bad, resp.StatusCode)
		}
	}
	if !validInstanceID("i-1234567890-abcDEF_x.y:z") {
		t.Error("a realistic Discord instance id was rejected")
	}
}

// The map-builder tools run the validator, fair solver and harbor placer on an
// arbitrary board, up to ~118 ms of single-core work per call.
func TestMapToolEndpointsAreMetered(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d0", "mapper")
	// No refill, no budget: the first call to each must be refused. All six
	// handlers are checked so none is missed.
	e.srv.mapToolLimit = newKeyedLimiter(0, 0)

	body := map[string]any{"board": map[string]any{}, "code": "x", "ruleset": "base"}
	for _, path := range []string{
		"/api/maps/lint", "/api/maps/randomize", "/api/maps/harbors",
		"/api/maps/encode", "/api/maps/decode", "/api/maps/frame",
		"/api/preview",
	} {
		resp, _ := e.req(t, "POST", path, c, body)
		if resp.StatusCode != http.StatusTooManyRequests {
			t.Errorf("POST %s = %d, want 429", path, resp.StatusCode)
		}
	}
}

// TestUnregisteredErrorNotIllegalMove: every rules refusal is
// registered (engine/ruletest sweeps the sentinels), so an unregistered error is
// a server failure, e.g. the store failing, and must not read as "That move
// isn't allowed".
func TestUnregisteredErrorNotIllegalMove(t *testing.T) {
	diskFull := errors.New("disk I/O error")
	if got := errCode(diskFull); got != storageErrorCode {
		t.Errorf("errCode(storage failure) = %q, want %q", got, storageErrorCode)
	}
	if got := errMessage(diskFull); got != storageErrorMessage {
		t.Errorf("errMessage(storage failure) = %q, want the server-failed wording", got)
	}
	// Registered refusals are untouched: the player still hears about the rule.
	if got := errCode(engine.ErrNotYourTurn); got != "NOT_YOUR_TURN" {
		t.Errorf("errCode(ErrNotYourTurn) = %q, want NOT_YOUR_TURN", got)
	}
	if got := errCode(game.ErrPaused); got != "PAUSED" {
		t.Errorf("errCode(ErrPaused) = %q, want PAUSED", got)
	}
}

// Every response needs nosniff: several endpoints echo player-supplied bytes,
// and a sniffed text/html would turn a JSON body into a same-origin script.
func TestEveryResponseCarriesNosniff(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d0", "user")
	for _, path := range []string{"/healthz", "/api/games", "/api/users/me"} {
		resp, _ := e.req(t, "GET", path, c, nil)
		if got := resp.Header.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("GET %s: X-Content-Type-Options = %q, want nosniff", path, got)
		}
	}
}

// Keep the payload the tests build in line with the real wire shape.
func TestCmdPayloadShape(t *testing.T) {
	raw, err := json.Marshal(cmdPayload{Type: engine.CmdPlaceSettlement})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"type":"place_settlement"}` {
		t.Errorf("cmd payload = %s", raw)
	}
}
