package lobby

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/store"
)

// TestValidateConfigBranches drives the remaining validateConfig branches via
// Create: a bad turn-order value, a valid explicit turn order, and a custom
// inlined map (which clears any named preset and is layout-validated).
func TestValidateConfigBranches(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	// Bad turn order.
	if _, err := l.Create(host, engine.GameConfig{Players: 3, TurnOrder: "spiral"}, false); !errors.Is(err, ErrBadConfig) {
		t.Errorf("bad turn_order err = %v, want ErrBadConfig", err)
	}

	// A valid explicit turn order succeeds.
	if _, err := l.Create(host, engine.GameConfig{Players: 3, TurnOrder: engine.TurnOrderRandom}, false); err != nil {
		t.Errorf("valid random turn order create: %v", err)
	}

	// A custom inlined map: a valid board passes; it also clears any named preset.
	b, err := board.PresetBoard("beginner", 3, rand.New(rand.NewPCG(1, 2)))
	if err != nil {
		t.Fatal(err)
	}
	sum, err := l.Create(host, engine.GameConfig{Players: 3, Preset: "beginner", Board: b}, false)
	if err != nil {
		t.Fatalf("inline board create: %v", err)
	}
	var stored engine.GameConfig
	if err := json.Unmarshal(sum.Game.Config, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Preset != "" {
		t.Errorf("inline map should clear preset, got %q", stored.Preset)
	}
	if stored.Board == nil {
		t.Error("inline board not persisted")
	}

	// An invalid inlined map (empty board) fails layout validation.
	if _, err := l.Create(host, engine.GameConfig{Players: 3, Board: &board.Board{}}, false); !errors.Is(err, ErrBadConfig) {
		t.Errorf("empty inline board err = %v, want ErrBadConfig", err)
	}
}

// TestUpdateConfig exercises the host-only config edit path: success (config and
// ruleset persisted), the lobby/host/validation gates, and the "can't shrink
// below seated count" guard.
func TestUpdateConfig(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")

	sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base", TargetVP: 10}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	// Non-host cannot edit.
	if _, err := l.UpdateConfig(alice, gid, engine.GameConfig{Players: 4}); !errors.Is(err, ErrNotHost) {
		t.Errorf("non-host UpdateConfig err = %v, want ErrNotHost", err)
	}
	// Invalid config is rejected.
	if _, err := l.UpdateConfig(host, gid, engine.GameConfig{Players: 1}); !errors.Is(err, ErrBadConfig) {
		t.Errorf("bad UpdateConfig err = %v, want ErrBadConfig", err)
	}
	// Unknown game id surfaces the store error.
	if _, err := l.UpdateConfig(host, "nope", engine.GameConfig{Players: 4}); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game UpdateConfig err = %v, want ErrNotFound", err)
	}

	// Seat alice (2 seated). The seated-count guard (seated > players) is covered
	// separately in TestUpdateConfigBelowSeated.
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Fatal(err)
	}

	// A valid edit succeeds and persists the config.
	out, err := l.UpdateConfig(host, gid, engine.GameConfig{Players: 5, Ruleset: "base", TargetVP: 12})
	if err != nil {
		t.Fatalf("valid UpdateConfig: %v", err)
	}
	var stored engine.GameConfig
	if err := json.Unmarshal(out.Game.Config, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Players != 5 || stored.TargetVP != 12 {
		t.Errorf("stored config = %+v, want Players=5 TargetVP=12", stored)
	}

	// A game that has left the lobby refuses edits.
	bob := discordUser(t, st, "d3", "bob")
	if _, err := l.Join(bob, gid, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	if _, err := l.UpdateConfig(host, gid, engine.GameConfig{Players: 4, Ruleset: "base"}); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("UpdateConfig after start err = %v, want ErrNotInLobby", err)
	}
}

// TestUpdateConfigBelowSeated seats more players than the new config allows to
// hit the explicit "players below seated count" guard (which is reachable only
// when the seated count exceeds a still-valid player count, e.g. 4 seated -> 3).
func TestUpdateConfigBelowSeated(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	users := []*store.User{
		discordUser(t, st, "d2", "a"),
		discordUser(t, st, "d3", "b"),
		discordUser(t, st, "d4", "c"),
	}
	sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base"}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	for _, u := range users {
		if _, err := l.Join(u, gid, ""); err != nil {
			t.Fatal(err)
		}
	}
	// 4 seated; dropping to a valid 3-player config must be refused.
	if _, err := l.UpdateConfig(host, gid, engine.GameConfig{Players: 3, Ruleset: "base"}); !errors.Is(err, ErrBadConfig) {
		t.Errorf("shrink-below-seated err = %v, want ErrBadConfig", err)
	}
}

// TestSeedSeatColorFromLoadout proves Create/Join seed a freshly-seated player's
// preferred loadout color onto their seat, and that a collision with an
// already-seated color falls back to a distinct free preset. Every seat is
// stamped, so a collision gets another color rather than an unstamped seat
// that nothing checks.
func TestSeedSeatColorFromLoadout(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")

	// Host prefers blue; seeding should apply it at create time.
	if err := st.SetLoadoutSlot(host.ID, "color", "color.0000ff"); err != nil {
		t.Fatal(err)
	}
	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if hs := seatByUser(sum, host.ID); hs == nil || hs.Color != "color.0000ff" {
		t.Fatalf("host seat color = %+v, want seeded color.0000ff", hs)
	}

	// Alice also prefers blue, but it's already locked by host: she is stamped
	// with a distinct free preset instead, and the table stays readable.
	if err := st.SetLoadoutSlot(alice.ID, "color", "color.0000ff"); err != nil {
		t.Fatal(err)
	}
	out, err := l.Join(alice, gid, "")
	if err != nil {
		t.Fatal(err)
	}
	as := seatByUser(out, alice.ID)
	if as == nil || as.Color == "" || as.Color == "color.0000ff" {
		t.Errorf("alice seat color = %+v, want a stamped color that is not the host's blue", as)
	}
	assertSeatColorsDistinct(t, "loadout collision", out.Seats)
}

// TestSeedSeatColorNoColorGate: without a ColorGate (no cosmetics) there is no
// loadout, so a seat is stamped with its order default. It is still stamped,
// because color distinctness must not depend on cosmetics being enabled.
func TestSeedSeatColorNoColorGate(t *testing.T) {
	l, st := newLobby(t) // no SetColorGate
	host := discordUser(t, st, "d1", "host")
	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	if want := cosmetics.DefaultSeatColor(0).ID; sum.Seats[0].Color != want {
		t.Errorf("seat color = %q, want the seat-0 default %q", sum.Seats[0].Color, want)
	}
}

// TestSetSeatColorDisabled covers the "colors disabled" branch: without a
// ColorGate, SetSeatColor is unavailable and reports ErrColorTaken.
func TestSetSeatColorDisabled(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.SetSeatColor(host, sum.Game.ID, "color.ff0000"); !errors.Is(err, ErrColorTaken) {
		t.Errorf("disabled SetSeatColor err = %v, want ErrColorTaken", err)
	}
}

// TestSetSeatColorGates covers the not-in-lobby, not-seated, and missing-game
// gates on the color path.
func TestSetSeatColorGates(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "d1", "host")
	stranger := discordUser(t, st, "d2", "stranger")

	if _, err := l.SetSeatColor(host, "nope", "color.ff0000"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game color err = %v, want ErrNotFound", err)
	}

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	// A user with no seat can't set a color.
	if _, err := l.SetSeatColor(stranger, gid, "color.ff0000"); !errors.Is(err, ErrNotSeated) {
		t.Errorf("non-seated color err = %v, want ErrNotSeated", err)
	}

	// After start, the game is no longer in the lobby.
	a := discordUser(t, st, "d3", "a")
	b := discordUser(t, st, "d4", "b")
	if _, err := l.Join(a, gid, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(b, gid, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	if _, err := l.SetSeatColor(host, gid, "color.ff0000"); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("started-game color err = %v, want ErrNotInLobby", err)
	}
}

// TestSetSeatNameGates covers the not-in-lobby and missing-game gates on the
// seat-name path (the not-seated case is covered in lobby_test.go).
func TestSetSeatNameGates(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	if _, err := l.SetSeatName(host, "nope", "X"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game name err = %v, want ErrNotFound", err)
	}

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	a := discordUser(t, st, "d2", "a")
	b := discordUser(t, st, "d3", "b")
	if _, err := l.Join(a, gid, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(b, gid, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	if _, err := l.SetSeatName(host, gid, "X"); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("started-game name err = %v, want ErrNotInLobby", err)
	}
}

// TestSetSeatDecoration covers the decoration path: gates (missing game, not
// seated, cosmetics disabled), ownership rejection, and the equip/clear happy
// path reflecting on the seat in the rebuilt summary.
func TestSetSeatDecoration(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "d1", "host")
	stranger := discordUser(t, st, "d2", "stranger")

	if _, err := l.SetSeatDecoration(host, "nope", ""); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game decoration err = %v, want ErrNotFound", err)
	}

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	if _, err := l.SetSeatDecoration(stranger, gid, ""); !errors.Is(err, ErrNotSeated) {
		t.Errorf("non-seated decoration err = %v, want ErrNotSeated", err)
	}

	// A decoration the host doesn't own is rejected.
	if _, err := l.SetSeatDecoration(host, gid, "decoration.kofi"); !errors.Is(err, cosmetics.ErrNotOwned) {
		t.Errorf("unowned decoration err = %v, want ErrNotOwned", err)
	}

	// Once owned, equipping reflects on the seat; clearing reverts to none.
	if err := st.GrantEntitlement(host.ID, "decoration.kofi", "test"); err != nil {
		t.Fatal(err)
	}
	sum, err = l.SetSeatDecoration(host, gid, "decoration.kofi")
	if err != nil {
		t.Fatalf("equip owned decoration: %v", err)
	}
	if got := sum.Seats[0].Decoration; got != "decoration.kofi" {
		t.Errorf("seat decoration = %q, want decoration.kofi", got)
	}
	sum, err = l.SetSeatDecoration(host, gid, "")
	if err != nil {
		t.Fatalf("clear decoration: %v", err)
	}
	if got := sum.Seats[0].Decoration; got != "" {
		t.Errorf("cleared seat decoration = %q, want empty", got)
	}

	// Cosmetics disabled (no color gate) → unavailable.
	l2, st2 := newLobby(t)
	h2 := discordUser(t, st2, "x1", "h2")
	s2, err := l2.Create(h2, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l2.SetSeatDecoration(h2, s2.Game.ID, ""); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("disabled decoration err = %v, want ErrNotInLobby", err)
	}
}

// TestAddBotGates covers AddBot's non-host, not-in-lobby, full, and missing-game
// branches (the success path is covered in lobby_test.go).
func TestAddBotGates(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	other := discordUser(t, st, "d2", "other")

	if _, err := l.AddBot(host, "nope"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game AddBot err = %v, want ErrNotFound", err)
	}

	sum, err := l.Create(host, engine.GameConfig{Players: 3}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	if _, err := l.AddBot(other, gid); !errors.Is(err, ErrNotHost) {
		t.Errorf("non-host AddBot err = %v, want ErrNotHost", err)
	}

	// Fill the table (host + 2 bots = 3), then the next AddBot is full.
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}
	if _, err := l.AddBot(host, gid); !errors.Is(err, ErrFull) {
		t.Errorf("full AddBot err = %v, want ErrFull", err)
	}

	// After start, AddBot is rejected.
	gid2 := mustCreate(t, l, host, 3)
	a := discordUser(t, st, "d3", "a")
	b := discordUser(t, st, "d4", "b")
	if _, err := l.Join(a, gid2, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(b, gid2, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid2); err != nil {
		t.Fatal(err)
	}
	if _, err := l.AddBot(host, gid2); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("started-game AddBot err = %v, want ErrNotInLobby", err)
	}
}

// TestAddBotNames asserts bots are named from the fixed pool, distinctly within
// one game, rather than the old "Bot <random>" scheme.
func TestAddBotNames(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, err := l.Create(host, engine.GameConfig{Players: 6}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	pool := map[string]bool{}
	for _, n := range botNames() {
		pool[n] = true
	}
	seen := map[string]bool{}
	for i := range 5 { // host + 5 bots = 6 seats
		sum, err = l.AddBot(host, gid)
		if err != nil {
			t.Fatalf("AddBot %d: %v", i, err)
		}
	}
	for _, s := range sum.Seats {
		if s.Status != "bot" {
			continue
		}
		if !pool[s.UserName] {
			t.Errorf("bot name %q not in pool", s.UserName)
		}
		if seen[s.UserName] {
			t.Errorf("duplicate bot name %q within a game", s.UserName)
		}
		seen[s.UserName] = true
	}
	if len(seen) != 5 {
		t.Errorf("got %d distinct bot names, want 5", len(seen))
	}
}

// TestKickSeatGates covers the not-in-lobby and missing-game branches of
// KickSeat (non-host/host-self/empty-seat are covered in lobby_test.go).
func TestKickSeatGates(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	if _, err := l.KickSeat(host, "nope", 0); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game KickSeat err = %v, want ErrNotFound", err)
	}

	gid := mustCreate(t, l, host, 3)
	a := discordUser(t, st, "d2", "a")
	b := discordUser(t, st, "d3", "b")
	if _, err := l.Join(a, gid, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(b, gid, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	if _, err := l.KickSeat(host, gid, 1); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("started-game KickSeat err = %v, want ErrNotInLobby", err)
	}
}

// TestSetPrivacyIdempotentAndGates covers the already-in-state shortcut, the
// not-in-lobby gate, and the missing-game branch.
func TestSetPrivacyIdempotentAndGates(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	if _, err := l.SetPrivacy(host, "nope", true); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game SetPrivacy err = %v, want ErrNotFound", err)
	}

	// Public game asked to go public again: no-op, returns the current summary.
	sum, err := l.Create(host, engine.GameConfig{Players: 3}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	out, err := l.SetPrivacy(host, gid, false)
	if err != nil {
		t.Fatalf("idempotent public: %v", err)
	}
	if !out.Game.Public {
		t.Errorf("still public expected, public = %v", out.Game.Public)
	}

	// Private game asked to go private again: no-op, code unchanged.
	priv, err := l.Create(host, engine.GameConfig{Players: 3}, true)
	if err != nil {
		t.Fatal(err)
	}
	code := priv.Game.InviteCode
	out, err = l.SetPrivacy(host, priv.Game.ID, true)
	if err != nil {
		t.Fatalf("idempotent private: %v", err)
	}
	if out.Game.InviteCode != code {
		t.Errorf("idempotent private changed code %q -> %q", code, out.Game.InviteCode)
	}

	// After start, privacy can't be changed.
	a := discordUser(t, st, "d2", "a")
	b := discordUser(t, st, "d3", "b")
	if _, err := l.Join(a, gid, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(b, gid, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	if _, err := l.SetPrivacy(host, gid, true); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("started-game SetPrivacy err = %v, want ErrNotInLobby", err)
	}
}

// TestLeaveMissingGame covers Leave's store-error branch.
func TestLeaveMissingGame(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	if _, err := l.Leave(host, "nope"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game Leave err = %v, want ErrNotFound", err)
	}
}

// TestStartMissingGame covers Start's store-error branch.
func TestStartMissingGame(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	if err := l.Start(host, "nope"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game Start err = %v, want ErrNotFound", err)
	}
}

// TestCloseGates covers Close's not-in-lobby and missing-game branches (the
// success path runs via host Leave in lobby_test.go).
func TestCloseGates(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	if err := l.Close("nope"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game Close err = %v, want ErrNotFound", err)
	}

	gid := mustCreate(t, l, host, 3)
	a := discordUser(t, st, "d2", "a")
	b := discordUser(t, st, "d3", "b")
	if _, err := l.Join(a, gid, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(b, gid, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	if err := l.Close(gid); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("started-game Close err = %v, want ErrNotInLobby", err)
	}
}

// TestRematchMissingGame covers Rematch's store-error branch.
func TestRematchMissingGame(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	if _, err := l.Rematch(host, "nope", nil); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game Rematch err = %v, want ErrNotFound", err)
	}
}

// TestResetToLobbyMissingGame covers ResetToLobby's store-error branch.
func TestResetToLobbyMissingGame(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	if _, err := l.ResetToLobby(host, "nope", nil); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game ResetToLobby err = %v, want ErrNotFound", err)
	}
}

// TestSummaryMissingGame covers Summary's store-error branch.
func TestSummaryMissingGame(t *testing.T) {
	l, st := newLobby(t)
	_ = st
	if _, err := l.Summary("nope"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("missing-game Summary err = %v, want ErrNotFound", err)
	}
}

// TestActivityLobby walks the Discord-Activity flow: the first opener hosts a
// fresh private game; a second opener joins as a player; the host re-opening
// resolves back to "host"; an already-seated player resolves to "player"; and a
// late opener on a full table spectates.
func TestActivityLobby(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	// First opener creates and hosts.
	sum, role, err := l.ActivityLobby(host, "inst-1")
	if err != nil {
		t.Fatal(err)
	}
	if role != "host" {
		t.Fatalf("first opener role = %q, want host", role)
	}
	gid := sum.Game.ID
	if sum.Game.CreatedBy != host.ID {
		t.Errorf("created_by = %d, want host %d", sum.Game.CreatedBy, host.ID)
	}
	// Activity games are private (4-player default config).
	if sum.Game.InviteCode == "" {
		t.Error("activity game should be private")
	}
	// The Activity config names no board or preset; the lobby must still store a
	// land-bearing board, or the waiting room previews an empty "Custom map".
	var acfg engine.GameConfig
	if err := json.Unmarshal(sum.Game.Config, &acfg); err != nil {
		t.Fatal(err)
	}
	if acfg.Board == nil || len(acfg.Board.Tiles) == 0 {
		t.Errorf("activity game stored no board")
	}

	// Host re-opening the same instance resolves to host, same game.
	sum2, role, err := l.ActivityLobby(host, "inst-1")
	if err != nil {
		t.Fatal(err)
	}
	if role != "host" || sum2.Game.ID != gid {
		t.Errorf("host re-open role=%q id=%q, want host %q", role, sum2.Game.ID, gid)
	}

	// Second opener joins as a player.
	alice := discordUser(t, st, "d2", "alice")
	asum, role, err := l.ActivityLobby(alice, "inst-1")
	if err != nil {
		t.Fatal(err)
	}
	if role != "player" {
		t.Errorf("second opener role = %q, want player", role)
	}
	if asum.Game.ID != gid {
		t.Errorf("player joined id = %q, want %q", asum.Game.ID, gid)
	}

	// Already-seated player re-opening resolves to player (the seated-loop path).
	_, role, err = l.ActivityLobby(alice, "inst-1")
	if err != nil {
		t.Fatal(err)
	}
	if role != "player" {
		t.Errorf("seated re-open role = %q, want player", role)
	}
}

// TestActivityLobbySpectatorWhenFull verifies a late opener spectates once the
// table is full.
func TestActivityLobbySpectatorWhenFull(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	// Create the activity game, then shrink it to 1 seat by editing config so the
	// table is full with just the host.
	sum, _, err := l.ActivityLobby(host, "inst-full")
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	// Fill the remaining 3 seats with bots so the 4-player activity table is full.
	for i := range 3 {
		if _, err := l.AddBot(host, gid); err != nil {
			t.Fatalf("fill bot %d: %v", i, err)
		}
	}

	late := discordUser(t, st, "d2", "late")
	_, role, err := l.ActivityLobby(late, "inst-full")
	if err != nil {
		t.Fatal(err)
	}
	if role != "spectator" {
		t.Errorf("late opener on full table role = %q, want spectator", role)
	}
}

// TestActivityLobbySpectatorWhenStarted verifies an opener on an in-progress
// game spectates.
func TestActivityLobbySpectatorWhenStarted(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, _, err := l.ActivityLobby(host, "inst-live")
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	// Seat two more humans and start the game.
	a := discordUser(t, st, "d2", "a")
	b := discordUser(t, st, "d3", "b")
	if _, _, err := l.ActivityLobby(a, "inst-live"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := l.ActivityLobby(b, "inst-live"); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}

	late := discordUser(t, st, "d4", "late")
	_, role, err := l.ActivityLobby(late, "inst-live")
	if err != nil {
		t.Fatal(err)
	}
	if role != "spectator" {
		t.Errorf("opener on started game role = %q, want spectator", role)
	}
}

// TestRecreateLobbyStopsAtPlayerCap covers recreateLobby's "lobby full before the
// old roster is exhausted" break: a finished game whose config player count was
// reduced below its seated count leaves a trailing old seat that must be dropped.
func TestRecreateLobbyStopsAtPlayerCap(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	bob := discordUser(t, st, "b", "bob")

	// Seat host + 3 others in a 4-player game.
	sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base"}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(bob, gid, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}

	// Shrink the stored config to 3 players, then finish the game. Rematch now
	// reads Players=3 but sees 4 old seats: the new lobby fills host@0 + 2 more,
	// then breaks, dropping the trailing old seat.
	cfg := configForPlayers(t, st, gid, 3)
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateGameConfig(gid, cfgJSON); err != nil {
		t.Fatal(err)
	}
	if err := st.SetGameStatus(gid, "finished"); err != nil {
		t.Fatal(err)
	}

	rs, err := l.Rematch(host, gid, map[int64]bool{host.ID: true, alice.ID: true, bob.ID: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(rs.Seats) != 3 {
		t.Fatalf("rematch seats = %d, want 3 (capped at Players)", len(rs.Seats))
	}
	if rs.Seats[0].UserID != host.ID {
		t.Errorf("seat 0 = %d, want host", rs.Seats[0].UserID)
	}
}

// mustCreate creates a public lobby game and returns its id.
func mustCreate(t *testing.T, l *Lobby, host *store.User, players int) string {
	t.Helper()
	sum, err := l.Create(host, engine.GameConfig{Players: players}, false)
	if err != nil {
		t.Fatal(err)
	}
	return sum.Game.ID
}

// configForPlayers reads the stored config of a game and returns a copy with the
// player count overridden, used only to construct invalid-shrink configs.
func configForPlayers(t *testing.T, st *store.Store, gid string, players int) engine.GameConfig {
	t.Helper()
	g, err := st.GameByID(gid)
	if err != nil {
		t.Fatal(err)
	}
	var cfg engine.GameConfig
	if err := json.Unmarshal(g.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	cfg.Players = players
	return cfg
}

func TestValidateConfigRejectsHugeDiscardLimit(t *testing.T) {
	cfg := engine.GameConfig{Players: 4, Ruleset: "base", TargetVP: 10, DiscardLimit: 99}
	if err := validateConfig(&cfg); err == nil {
		t.Error("validateConfig accepted DiscardLimit=99; want rejection")
	}
	ok := engine.GameConfig{Players: 4, Ruleset: "base", TargetVP: 10, DiscardLimit: 12}
	if err := validateConfig(&ok); err != nil {
		t.Errorf("validateConfig rejected a reasonable DiscardLimit=12: %v", err)
	}
}

// A config with neither a custom board nor a named preset (as the Discord
// Activity lobby creates) must come out of validateConfig with a land-bearing
// board sized to the player count, or the waiting room previews an empty
// "Custom map". The radius must match what the engine generates, so the
// preview matches the dealt board.
func TestValidateConfigDefaultsBoardWhenNoneGiven(t *testing.T) {
	for _, players := range []int{3, 4, 6, 8} {
		cfg := engine.GameConfig{Players: players, Ruleset: "base", TargetVP: 10}
		if err := validateConfig(&cfg); err != nil {
			t.Fatalf("players=%d: validateConfig: %v", players, err)
		}
		if cfg.Board == nil {
			t.Fatalf("players=%d: validateConfig left a nil board", players)
		}
		if want := board.RadiusFor(players); cfg.Board.Radius != want {
			t.Errorf("players=%d: board radius=%d, want %d", players, cfg.Board.Radius, want)
		}
		land := 0
		for _, tile := range cfg.Board.Tiles {
			if tile.Res != board.Sea && tile.Res != board.Border {
				land++
			}
		}
		if land < 3 {
			t.Errorf("players=%d: board has %d land tiles, want a full-land board", players, land)
		}
	}
}

func TestTargetVPClampedToCeiling(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	// base ceiling is 13: 14 must be rejected, 13 accepted.
	if _, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base", TargetVP: 14}, false); err == nil {
		t.Fatal("base TargetVP=14 should be rejected (ceiling 13)")
	}
	if _, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base", TargetVP: 13}, false); err != nil {
		t.Fatalf("base TargetVP=13 should be accepted: %v", err)
	}
	// cak ceiling is 20: 18 accepted, 21 rejected.
	if _, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base+cak", TargetVP: 18}, false); err != nil {
		t.Fatalf("cak TargetVP=18 should be accepted: %v", err)
	}
	if _, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base+cak", TargetVP: 21}, false); err == nil {
		t.Fatal("cak TargetVP=21 should be rejected (ceiling 20)")
	}
}

// TestCustomBoardCheckedAgainstSeatCount: a named preset is range-checked
// by ValidatePreset(name, players), but ValidateLayout and engine.ValidateMap
// take no player count, so an inlined custom board (the path the browser uses)
// needs its own seat check.
func TestCustomBoardCheckedAgainstSeatCount(t *testing.T) {
	small := func() *board.Board {
		b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 0, R: 0}}
		for _, h := range board.HexesInRadius(2) {
			b.Tiles[h] = board.Tile{Res: board.ResLand}
		}
		return b
	}
	big := func() *board.Board {
		b := &board.Board{Radius: 4, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 0, R: 0}}
		for _, h := range board.HexesInRadius(4) {
			b.Tiles[h] = board.Tile{Res: board.ResLand}
		}
		return b
	}
	for _, tc := range []struct {
		name    string
		players int
		b       *board.Board
		wantErr bool
	}{
		{"ten players on 19 hexes", 10, small(), true},
		{"four players on 19 hexes", 4, small(), false},
		{"ten players on 61 hexes", 10, big(), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := engine.GameConfig{
				Players: tc.players, Ruleset: "base", TargetVP: 10, DiscardLimit: 7,
				DiceMode: "random", BoardMode: "fair", Board: tc.b,
			}
			err := validateConfig(&cfg)
			if tc.wantErr && !errors.Is(err, ErrBadConfig) {
				t.Errorf("err = %v, want ErrBadConfig", err)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("err = %v, want nil", err)
			}
		})
	}
}
