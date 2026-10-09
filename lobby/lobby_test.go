package lobby

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/econ"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/rating"
	"github.com/ftqo/costan.io/store"
)

func newLobby(t *testing.T) (*Lobby, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	mgr := game.NewManager(st, nil)
	t.Cleanup(func() { mgr.StopAll(); st.Close() })
	return New(st, mgr), st
}

func discordUser(t *testing.T, st *store.Store, id, name string) *store.User {
	t.Helper()
	u, err := st.UpsertDiscordUser(id, name, "")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestSummaryAttachesSeatRatings(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "rh", "Host")
	joiner := discordUser(t, st, "rj", "Joiner")

	// Host: a settled rating (sigma < ProvisionalSigma). Joiner: provisional.
	if err := st.SetRatingRow(host.ID, "base", 33, 3, 1000); err != nil {
		t.Fatal(err)
	}
	if err := st.SetRatingRow(joiner.ID, "base", 25, 8, 1000); err != nil {
		t.Fatal(err)
	}
	wantHost := rating.Display(rating.Player{Mu: 33, Sigma: 3})
	wantJoiner := rating.Display(rating.Player{Mu: 25, Sigma: 8})

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if _, err := l.Join(joiner, gid, ""); err != nil {
		t.Fatal(err)
	}
	// A bot (seated as a guest) must carry no rating.
	sum, err = l.AddBot(host, gid)
	if err != nil {
		t.Fatal(err)
	}

	byUser := map[int64]*store.Seat{}
	var bot *store.Seat
	for _, s := range sum.Seats {
		byUser[s.UserID] = s
		if s.IsGuest {
			bot = s
		}
	}
	if hs := byUser[host.ID]; hs == nil || hs.Rating != wantHost || hs.Provisional {
		t.Errorf("host seat rating = %v (provisional=%v), want %d non-provisional", seatRating(hs), seatProv(hs), wantHost)
	}
	if js := byUser[joiner.ID]; js == nil || js.Rating != wantJoiner || !js.Provisional {
		t.Errorf("joiner seat rating = %v (provisional=%v), want %d provisional", seatRating(js), seatProv(js), wantJoiner)
	}
	if bot == nil {
		t.Fatal("expected a bot/guest seat")
	}
	if bot.Rating != 0 || bot.Provisional {
		t.Errorf("bot/guest seat should carry no rating, got rating=%d provisional=%v", bot.Rating, bot.Provisional)
	}
}

// A registered player who has never finished a rated game for the ruleset has
// no rating row; the seat must stay unrated (rating 0) rather than showing the
// seeded 1000 default, so the waiting room renders "Unrated" like the profile.
func TestSummaryLeavesUnratedSeatsUnrated(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "ru", "Newcomer") // no SetRatingRow → unrated

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	var hs *store.Seat
	for _, s := range sum.Seats {
		if s.UserID == host.ID {
			hs = s
		}
	}
	if hs == nil {
		t.Fatal("host seat missing")
	}
	if hs.Rating != 0 || hs.Provisional {
		t.Errorf("unrated seat should carry no rating, got rating=%d provisional=%v", hs.Rating, hs.Provisional)
	}
}

func seatRating(s *store.Seat) any {
	if s == nil {
		return "<missing>"
	}
	return s.Rating
}

func seatProv(s *store.Seat) any {
	if s == nil {
		return "<missing>"
	}
	return s.Provisional
}

func TestCreateValidatesConfig(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	for _, cfg := range []engine.GameConfig{
		{Players: 1}, {Players: 11}, {Players: 3, TurnTimerSec: -1},
		{Players: 3, Ruleset: "islands"},
		{Players: 3, Preset: "no-such-map"},
		{Players: 5, Preset: "beginner"}, // beginner is a 3-4 player map
		{Players: 3, DiceMode: "loaded"},
		{Players: 3, BoardMode: "rigged"},
	} {
		if _, err := l.Create(host, cfg, false); !errors.Is(err, ErrBadConfig) {
			t.Errorf("config %+v err = %v, want ErrBadConfig", cfg, err)
		}
	}

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(sum.Seats) != 1 || sum.Seats[0].UserID != host.ID || sum.Seats[0].No != 0 {
		t.Errorf("host seat = %+v", sum.Seats)
	}
	// Since 0029 every table gets a code, public included, so the host can share
	// a direct link. `Public` is the flag.
	if !sum.Game.Public {
		t.Error("a table created with private=false is not public")
	}
	if len(sum.Game.InviteCode) != 8 {
		t.Errorf("public game invite code = %q, want one 8 chars long", sum.Game.InviteCode)
	}
	// An omitted turn timer is coerced to the default; no game is ever untimed.
	var stored engine.GameConfig
	if err := json.Unmarshal(sum.Game.Config, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.TurnTimerSec != defaultTurnTimerSec {
		t.Errorf("turn_timer_sec = %d, want default %d", stored.TurnTimerSec, defaultTurnTimerSec)
	}

	priv, _ := l.Create(host, engine.GameConfig{Players: 3}, true)
	if len(priv.Game.InviteCode) != 8 {
		t.Errorf("invite code = %q", priv.Game.InviteCode)
	}
	if priv.Game.Public {
		t.Error("a table created with private=true is public")
	}
}

func TestGuestCannotHost(t *testing.T) {
	l, st := newLobby(t)
	guest, _ := st.CreateGuest("guesty")

	// Hosting any table requires a registered account; guests only join via an
	// invite link.
	if _, err := l.Create(guest, engine.GameConfig{Players: 4}, false); !errors.Is(err, ErrGuestNeedsLink) {
		t.Errorf("guest public create err = %v, want ErrGuestNeedsLink", err)
	}
	if _, err := l.Create(guest, engine.GameConfig{Players: 4}, true); !errors.Is(err, ErrGuestNeedsLink) {
		t.Errorf("guest private create err = %v, want ErrGuestNeedsLink", err)
	}
}

func TestSetPrivacyGuestGuard(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	guest, _ := st.CreateGuest("guesty")

	// Private table, guest joins via invite link.
	priv, err := l.Create(host, engine.GameConfig{Players: 4}, true)
	if err != nil {
		t.Fatal(err)
	}
	gid := priv.Game.ID
	if _, err := l.Join(guest, gid, priv.Game.InviteCode); err != nil {
		t.Fatal(err)
	}

	// Can't go public while the guest is seated.
	if _, err := l.SetPrivacy(host, gid, false); !errors.Is(err, ErrGuestNeedsLink) {
		t.Errorf("public-with-guest err = %v, want ErrGuestNeedsLink", err)
	}
	// Only the host may change privacy.
	if _, err := l.SetPrivacy(guest, gid, false); !errors.Is(err, ErrNotHost) {
		t.Errorf("non-host privacy err = %v, want ErrNotHost", err)
	}

	// Guest leaves; a seated bot (also a guest account) must not block it.
	if _, err := l.Leave(guest, gid); err != nil {
		t.Fatal(err)
	}
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}
	code := priv.Game.InviteCode
	pub, err := l.SetPrivacy(host, gid, false)
	if err != nil {
		t.Fatalf("go public: %v", err)
	}
	if !pub.Game.Public {
		t.Error("table is not public after going public")
	}
	// Going public keeps the code: a listed table's link has nothing to protect.
	if pub.Game.InviteCode != code {
		t.Errorf("going public changed the invite code %q -> %q", code, pub.Game.InviteCode)
	}

	// Going private rotates it, so a published link stops working.
	again, err := l.SetPrivacy(host, gid, true)
	if err != nil {
		t.Fatalf("go private: %v", err)
	}
	if again.Game.Public {
		t.Error("table still public after going private")
	}
	if again.Game.InviteCode == code {
		t.Error("going private did not rotate the invite code")
	}
	if len(again.Game.InviteCode) != 8 {
		t.Errorf("rotated invite = %q, want 8 chars", again.Game.InviteCode)
	}
}

func TestAddAndRemoveBot(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	other := discordUser(t, st, "d2", "other")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	sum, err = l.AddBot(host, gid)
	if err != nil {
		t.Fatal(err)
	}
	var botSeat int
	found := false
	for _, s := range sum.Seats {
		if s.Status == "bot" {
			botSeat, found = s.No, true
		}
	}
	if !found {
		t.Fatal("no bot seat after AddBot")
	}

	// Only the host may kick a seat.
	if _, err := l.KickSeat(other, gid, botSeat); !errors.Is(err, ErrNotHost) {
		t.Errorf("non-host kick err = %v, want ErrNotHost", err)
	}
	// The host's own seat cannot be kicked.
	if _, err := l.KickSeat(host, gid, 0); !errors.Is(err, ErrCantKickHost) {
		t.Errorf("kick host seat err = %v, want ErrCantKickHost", err)
	}
	// An empty seat can't be kicked.
	if _, err := l.KickSeat(host, gid, 3); !errors.Is(err, ErrNotSeated) {
		t.Errorf("kick empty seat err = %v, want ErrNotSeated", err)
	}

	sum, err = l.KickSeat(host, gid, botSeat)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range sum.Seats {
		if s.No == botSeat {
			t.Errorf("bot seat %d still present after KickSeat", botSeat)
		}
	}
	if len(sum.Seats) != 1 {
		t.Errorf("seats after kick = %d, want 1 (host only)", len(sum.Seats))
	}
}

func TestKickHumanPlayer(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Fatal(err)
	}
	aliceSeat, err := st.SeatForUser(gid, alice.ID)
	if err != nil {
		t.Fatal(err)
	}

	sum, err = l.KickSeat(host, gid, aliceSeat.No)
	if err != nil {
		t.Fatalf("kick human: %v", err)
	}
	if _, err := st.SeatForUser(gid, alice.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("alice still seated after kick (err=%v)", err)
	}
	if len(sum.Seats) != 1 {
		t.Errorf("seats after kick = %d, want 1", len(sum.Seats))
	}
}

func newLobbyWithColors(t *testing.T) (*Lobby, *store.Store) {
	t.Helper()
	l, st := newLobby(t)
	l.SetColorGate(cosmetics.New(st, econ.New(st)))
	return l, st
}

func TestSetSeatColor(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Fatal(err)
	}

	// Host picks a free color; it shows as the effective hex on the wire.
	sum, err = l.SetSeatColor(host, gid, "color.ff0000")
	if err != nil {
		t.Fatalf("host pick red: %v", err)
	}
	if hostSeat := seatByUser(sum, host.ID); hostSeat == nil || hostSeat.ColorHex != "#ff0000" {
		t.Fatalf("host seat color = %+v, want #ff0000", hostSeat)
	}

	// A non-supporter can't pick a supporter-gated color.
	if _, err := l.SetSeatColor(alice, gid, "color.aa00aa"); !errors.Is(err, cosmetics.ErrNotOwned) {
		t.Errorf("supporter color err = %v, want ErrNotOwned", err)
	}
	// Unknown color id is rejected.
	if _, err := l.SetSeatColor(alice, gid, "color.zzzzzz"); !errors.Is(err, cosmetics.ErrUnknownColor) {
		t.Errorf("unknown color err = %v, want ErrUnknownColor", err)
	}
	// Alice can't take the same red the host already locked (distinctness).
	if _, err := l.SetSeatColor(alice, gid, "color.ff0000"); !errors.Is(err, ErrColorTaken) {
		t.Errorf("duplicate color err = %v, want ErrColorTaken", err)
	}
	// A different free color is fine.
	if _, err := l.SetSeatColor(alice, gid, "color.0000ff"); err != nil {
		t.Errorf("alice pick blue: %v", err)
	}
}

// assertSeatColorsDistinct is the table-wide invariant every seating path owes:
// no two seats within ColorThreshold of each other, whatever mix of picked,
// seeded, defaulted and carried colors they arrived at.
func assertSeatColorsDistinct(t *testing.T, where string, seats []*store.Seat) {
	t.Helper()
	for i, a := range seats {
		for _, b := range seats[i+1:] {
			ca, oka := cosmetics.ColorByHex(a.ColorHex)
			cb, okb := cosmetics.ColorByHex(b.ColorHex)
			if !oka || !okb {
				t.Fatalf("%s: seat color off the palette (%q, %q)", where, a.ColorHex, b.ColorHex)
			}
			if d := ca.DeltaE(cb); d < cosmetics.ColorThreshold {
				t.Errorf("%s: seat %d (%s) and seat %d (%s) are ΔE=%.2f apart, want >= %.1f",
					where, a.No, a.ColorHex, b.No, b.ColorHex, d, cosmetics.ColorThreshold)
			}
		}
	}
}

// TestAddBotAvoidsSimilarColor: a bot must not be seated on a color
// perceptually identical to an already-seated player's.
//
// The host picks the bot's own seat default, the only pick that exercises the
// guard. The color is derived from the seat rather than named as a hex, so
// reordering seatDefaultOrder cannot make the test pass without the guard.
func TestAddBotAvoidsSimilarColor(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "d1", "host")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	// The host is seat 0, so the bot fills seat 1. Wear seat 1's default.
	clash := cosmetics.DefaultSeatColor(1)
	if !clash.Free {
		t.Fatalf("seat 1 default %s is not free", clash.ID)
	}
	if _, err := l.SetSeatColor(host, gid, clash.ID); err != nil {
		t.Fatalf("host pick %s: %v", clash.ID, err)
	}

	sum, err = l.AddBot(host, gid)
	if err != nil {
		t.Fatalf("add bot: %v", err)
	}

	hostSeat := seatByUser(sum, host.ID)
	var botSeat *store.Seat
	for _, s := range sum.Seats {
		if s.Status == "bot" {
			botSeat = s
		}
	}
	if hostSeat == nil || botSeat == nil {
		t.Fatalf("missing host (%v) or bot (%v) seat", hostSeat, botSeat)
	}
	if botSeat.No != 1 {
		t.Fatalf("bot took seat %d, want 1", botSeat.No)
	}
	if hostSeat.ColorHex != clash.Hex {
		t.Fatalf("host color = %s, want the seat-1 default %s", hostSeat.ColorHex, clash.Hex)
	}
	hostCol, _ := cosmetics.ColorByHex(hostSeat.ColorHex)
	botCol, _ := cosmetics.ColorByHex(botSeat.ColorHex)
	if d := hostCol.DeltaE(botCol); d < cosmetics.ColorThreshold {
		t.Fatalf("bot color %s too close to host %s: ΔE=%.1f < %.1f",
			botSeat.ColorHex, hostSeat.ColorHex, d, cosmetics.ColorThreshold)
	}
}

// TestJoinerAvoidsPickedColor: a seat that never picked renders
// DefaultSeatColor(seat_no), which must also be checked against colors other
// seats already hold. Otherwise a host who picked seat 2's default is cloned by
// whoever joins seat 2, and Start pins the pair into the game.
func TestJoinerAvoidsPickedColor(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "j1", "host")
	alice := discordUser(t, st, "j2", "alice")
	bob := discordUser(t, st, "j3", "bob")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	// Wear the color seat 2 would otherwise default into. Seat 2 is the third
	// to fill, so nobody holds it at pick time and the pick is legal.
	clash := cosmetics.DefaultSeatColor(2)
	if _, err := l.SetSeatColor(host, gid, clash.ID); err != nil {
		t.Fatalf("host pick %s: %v", clash.ID, err)
	}
	for _, u := range []*store.User{alice, bob} {
		if sum, err = l.Join(u, gid, ""); err != nil {
			t.Fatal(err)
		}
	}
	assertSeatColorsDistinct(t, "lobby", sum.Seats)

	// The clash must not survive the start pin either.
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	started, err := l.Summary(gid)
	if err != nil {
		t.Fatal(err)
	}
	assertSeatColorsDistinct(t, "after start", started.Seats)
	if hs := seatByUser(started, host.ID); hs == nil || hs.ColorHex != clash.Hex {
		t.Errorf("host color = %v, want to keep the %s they picked", hs, clash.Hex)
	}
}

// TestDefaultColorAvoidsSeededLoadout: the same clash with no pick.
// A supporter's equipped color is seeded onto their seat on join, and supporter
// colors may sit close to the free presets (Ultraviolet is ΔE 4.1 from Blue),
// so a later joiner's default must be checked against it.
func TestDefaultColorAvoidsSeededLoadout(t *testing.T) {
	l, st := newLobbyWithColors(t)
	cos := cosmetics.New(st, econ.New(st))
	host := discordUser(t, st, "s1", "host")
	alice := discordUser(t, st, "s2", "alice")
	bob := discordUser(t, st, "s3", "bob")

	// Staff supporter: entitled to the supporter half without a purchase.
	if err := st.SetSupporter(host.ID, true, false, false, true, false, 0); err != nil {
		t.Fatal(err)
	}
	const ultraviolet = "color.5500ff"
	if err := cos.Equip(host.ID, string(cosmetics.SlotColor), ultraviolet); err != nil {
		t.Fatal(err)
	}
	uv, ok := cosmetics.ColorByID(ultraviolet)
	if !ok {
		t.Fatal("ultraviolet left the palette")
	}
	if d := uv.DeltaE(cosmetics.DefaultSeatColor(2)); d >= cosmetics.ColorThreshold {
		t.Skipf("ultraviolet is no longer near seat 2's default (ΔE=%.2f); pick another pair", d)
	}

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if hs := seatByUser(sum, host.ID); hs == nil || hs.ColorHex != uv.Hex {
		t.Fatalf("host seat = %v, want the seeded loadout color %s", hs, uv.Hex)
	}
	for _, u := range []*store.User{alice, bob} {
		if sum, err = l.Join(u, gid, ""); err != nil {
			t.Fatal(err)
		}
	}
	assertSeatColorsDistinct(t, "lobby", sum.Seats)
}

// TestRematchJoinerAvoidsCarriedColor: recreateLobby stamps every
// carried seat, but a new player joining the recreated table can land on a seat
// whose default is one of the carried colors.
func TestRematchJoinerAvoidsCarriedColor(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "r1", "host")
	alice := discordUser(t, st, "r2", "alice")
	bob := discordUser(t, st, "r3", "bob")
	carol := discordUser(t, st, "r4", "carol")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	for _, u := range []*store.User{alice, bob} {
		if _, err := l.Join(u, gid, ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}

	// Bob drops: the survivors renumber, so the colors they carry no longer
	// line up with their new seats' defaults.
	rs, err := l.ResetToLobby(host, gid, map[int64]bool{host.ID: true, alice.ID: true})
	if err != nil {
		t.Fatal(err)
	}
	assertSeatColorsDistinct(t, "after reset", rs.Seats)

	sum, err = l.Join(carol, rs.Game.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	assertSeatColorsDistinct(t, "after a new player joins the rematch", sum.Seats)
}

// TestConcurrentSeatColorPicksStayDistinct: SetSeatColor reads the table,
// checks, then writes, so two interleaved picks could both pass and leave two
// seats on one color.
//
// Without the lock this rarely fails on an idle machine (store round-trips
// happen to serialise the goroutines); widening the window by 5ms fails it
// every time. It guards the outcome; the lock is what guarantees it.
func TestConcurrentSeatColorPicksStayDistinct(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "k1", "host")
	alice := discordUser(t, st, "k2", "alice")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Fatal(err)
	}

	// Both reach for the same free color at once. Exactly one may have it; the
	// other is refused and keeps its current color.
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, u := range []*store.User{host, alice} {
		wg.Go(func() {
			_, errs[i] = l.SetSeatColor(u, gid, "color.00ff00")
		})
	}
	wg.Wait()

	won := 0
	for i, err := range errs {
		switch {
		case err == nil:
			won++
		case errors.Is(err, ErrColorTaken):
		default:
			t.Fatalf("pick %d: unexpected error %v", i, err)
		}
	}
	if won != 1 {
		t.Errorf("%d of 2 concurrent picks of one color succeeded, want exactly 1", won)
	}
	final, err := l.Summary(gid)
	if err != nil {
		t.Fatal(err)
	}
	assertSeatColorsDistinct(t, "after concurrent picks", final.Seats)
}

// TestConcurrentJoinsStayDistinct: the same race on the seating side. Two
// joins that both read an empty table could stamp one color twice.
//
// This one fails without the lock for another reason too: Join picks the next
// free seat from an earlier read and retries a PK collision only once, so five
// concurrent joins into six seats report ErrFull with seats open. The lock makes
// both "next free seat" and "colors at this table" current at insert time.
func TestConcurrentJoinsStayDistinct(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "q0", "host")
	sum, err := l.Create(host, engine.GameConfig{Players: 6}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	joiners := make([]*store.User, 5)
	for i := range joiners {
		joiners[i] = discordUser(t, st, fmt.Sprintf("q%d", i+1), fmt.Sprintf("j%d", i+1))
	}
	var wg sync.WaitGroup
	for _, u := range joiners {
		wg.Go(func() {
			if _, err := l.Join(u, gid, ""); err != nil {
				t.Errorf("join: %v", err)
			}
		})
	}
	wg.Wait()

	final, err := l.Summary(gid)
	if err != nil {
		t.Fatal(err)
	}
	if len(final.Seats) != 6 {
		t.Fatalf("seated %d, want 6", len(final.Seats))
	}
	assertSeatColorsDistinct(t, "after concurrent joins", final.Seats)
}

func seatByUser(s *Summary, userID int64) *store.Seat {
	for _, seat := range s.Seats {
		if seat.UserID == userID {
			return seat
		}
	}
	return nil
}

func TestJoinRules(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")
	bob := discordUser(t, st, "d3", "bob")
	carol := discordUser(t, st, "d4", "carol")
	dave := discordUser(t, st, "d5", "dave")
	guest, _ := st.CreateGuest("guesty")

	pub, _ := l.Create(host, engine.GameConfig{Players: 4}, false)

	if _, err := l.Join(guest, pub.Game.ID, ""); !errors.Is(err, ErrGuestNeedsLink) {
		t.Errorf("guest public join err = %v", err)
	}
	if _, err := l.Join(host, pub.Game.ID, ""); !errors.Is(err, ErrAlreadySeated) {
		t.Errorf("double join err = %v", err)
	}
	for _, u := range []*store.User{alice, bob, carol} {
		if _, err := l.Join(u, pub.Game.ID, ""); err != nil {
			t.Fatalf("%s join: %v", u.Name, err)
		}
	}
	if _, err := l.Join(dave, pub.Game.ID, ""); !errors.Is(err, ErrFull) {
		t.Errorf("join full err = %v", err)
	}

	priv, _ := l.Create(alice, engine.GameConfig{Players: 3}, true)
	if _, err := l.Join(guest, priv.Game.ID, "wrong"); !errors.Is(err, ErrBadInvite) {
		t.Errorf("bad invite err = %v", err)
	}
	if _, err := l.Join(guest, priv.Game.ID, priv.Game.InviteCode); err != nil {
		t.Errorf("guest invite join: %v", err)
	}
}

func TestLeaveAndSeatCompaction(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")
	bob := discordUser(t, st, "d3", "bob")
	carol := discordUser(t, st, "d4", "carol")

	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	for _, u := range []*store.User{alice, bob, carol} {
		l.Join(u, id, "")
	}
	if _, err := l.Leave(alice, id); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Leave(alice, id); !errors.Is(err, ErrNotSeated) {
		t.Errorf("double leave err = %v", err)
	}

	// Start with a gap at seat 1: seats must compact to 0..2.
	if err := l.Start(host, id); err != nil {
		t.Fatal(err)
	}
	seats, _ := st.Seats(id)
	if len(seats) != 3 {
		t.Fatalf("seats = %d", len(seats))
	}
	for i, s := range seats {
		if s.No != i {
			t.Errorf("seat %d has no %d", i, s.No)
		}
	}
	g, _ := st.GameByID(id)
	if g.Status != "active" {
		t.Errorf("status = %s", g.Status)
	}
}

func TestHostLeaveClosesLobby(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")

	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	// Only bots round out the table: no eligible human successor, so the host
	// leaving tears the table down rather than transferring it.
	l.AddBot(host, id)
	l.AddBot(host, id)

	// closed=true, every seat dropped, and the game abandoned (so it's no longer
	// rejoinable/browsable).
	closed, err := l.Leave(host, id)
	if err != nil {
		t.Fatal(err)
	}
	if !closed {
		t.Fatal("host leave should report the lobby closed")
	}
	g, _ := st.GameByID(id)
	if g.Status != "abandoned" {
		t.Errorf("status = %s, want abandoned", g.Status)
	}
	seats, _ := st.Seats(id)
	if len(seats) != 0 {
		t.Errorf("seats = %d, want 0 after close", len(seats))
	}
	// A second leave (by anyone) is a no-op conflict: the lobby is already gone.
	if _, err := l.Leave(alice, id); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("leave after close err = %v, want ErrNotInLobby", err)
	}
}

func TestStartRules(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")

	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID

	if err := l.Start(alice, id); !errors.Is(err, ErrNotHost) {
		t.Errorf("non-host start err = %v", err)
	}
	if err := l.Start(host, id); !errors.Is(err, ErrNotEnough) {
		t.Errorf("understaffed start err = %v", err)
	}

	bob := discordUser(t, st, "d3", "bob")
	l.Join(alice, id, "")
	l.Join(bob, id, "")
	if err := l.Start(host, id); err != nil {
		t.Fatal(err)
	}
	// Config shrank to 3 players.
	g, _ := st.GameByID(id)
	if want := `"players":3`; !strings.Contains(string(g.Config), want) {
		t.Errorf("config = %s, want %s", g.Config, want)
	}
	if err := l.Start(host, id); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("double start err = %v", err)
	}
	// Joining a started game fails.
	carol := discordUser(t, st, "d4", "carol")
	if _, err := l.Join(carol, id, ""); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("late join err = %v", err)
	}
}

// TestStartTwoSeats is the 2-player boundary. validateConfig, board generation,
// the engine and the sim all accept 2 players, so Start must too. The real floor
// is covered by the ErrNotEnough case in TestStartRules.
func TestStartTwoSeats(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")

	sum, err := l.Create(host, engine.GameConfig{Players: 2}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	if _, err := l.Join(alice, id, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, id); err != nil {
		t.Fatalf("two-seat start: %v", err)
	}
	g, _ := st.GameByID(id)
	if want := `"players":2`; !strings.Contains(string(g.Config), want) {
		t.Errorf("config = %s, want %s", g.Config, want)
	}
}

func TestBrowseShowsPublicLobbyOnly(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	l.Create(host, engine.GameConfig{Players: 3}, false)
	l.Create(host, engine.GameConfig{Players: 3}, true)

	games, err := l.Browse()
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 {
		t.Fatalf("browse = %d games, want 1", len(games))
	}
	if !games[0].Game.Public {
		t.Error("private game leaked into browse")
	}
}

func TestRematchRecreatesRoster(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	bob := discordUser(t, st, "b", "bob")

	sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base"}, true)
	if err != nil {
		t.Fatal(err)
	}
	gid, invite := sum.Game.ID, sum.Game.InviteCode
	if _, err := l.Join(alice, gid, invite); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(bob, gid, invite); err != nil {
		t.Fatal(err)
	}
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}
	if err := st.SetGameStatus(gid, "finished"); err != nil {
		t.Fatal(err)
	}

	// Non-host cannot rematch.
	if _, err := l.Rematch(alice, gid, map[int64]bool{alice.ID: true}); !errors.Is(err, ErrNotHost) {
		t.Errorf("non-host rematch err = %v, want ErrNotHost", err)
	}

	// Host + alice are still present; bob has left.
	rs, err := l.Rematch(host, gid, map[int64]bool{host.ID: true, alice.ID: true})
	if err != nil {
		t.Fatal(err)
	}
	if rs.Game.ID == gid {
		t.Fatal("rematch reused the finished game id")
	}
	if rs.Game.Status != "lobby" {
		t.Errorf("rematch status = %q, want lobby", rs.Game.Status)
	}
	if rs.Game.InviteCode == "" || rs.Game.InviteCode == invite {
		t.Errorf("rematch invite = %q (old %q): want a fresh code", rs.Game.InviteCode, invite)
	}

	// Expect: host@0, alice present, bob dropped, exactly one fresh bot.
	if len(rs.Seats) != 3 {
		t.Fatalf("rematch seats = %d, want 3 (%+v)", len(rs.Seats), rs.Seats)
	}
	if rs.Seats[0].No != 0 || rs.Seats[0].UserID != host.ID {
		t.Errorf("seat 0 = %+v, want host", rs.Seats[0])
	}
	var sawAlice, sawBob, bots int
	for _, s := range rs.Seats {
		switch {
		case s.UserID == alice.ID:
			sawAlice++
		case s.UserID == bob.ID:
			sawBob++
		case s.Status == "bot":
			bots++
		}
	}
	if sawAlice != 1 || sawBob != 0 || bots != 1 {
		t.Errorf("roster: alice=%d bob=%d bots=%d, want 1/0/1", sawAlice, sawBob, bots)
	}

	// Not-finished games are rejected.
	live, _ := l.Create(host, engine.GameConfig{Players: 3, Ruleset: "base"}, false)
	if _, err := l.Rematch(host, live.Game.ID, nil); !errors.Is(err, ErrNotFinished) {
		t.Errorf("rematch of lobby game err = %v, want ErrNotFinished", err)
	}
}

func TestResetToLobbyRecreatesRoster(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	bob := discordUser(t, st, "b", "bob")

	// A live 4-seat game: host, alice, bob, and one bot.
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
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}

	// Only the host can reset; the attempt must not disturb the live game.
	if _, err := l.ResetToLobby(alice, gid, map[int64]bool{alice.ID: true}); !errors.Is(err, ErrNotHost) {
		t.Errorf("non-host reset err = %v, want ErrNotHost", err)
	}
	if g, _ := st.GameByID(gid); g.Status != "active" {
		t.Fatalf("game status after failed reset = %q, want active", g.Status)
	}

	// A game that is not in progress (still a lobby) is rejected.
	lobbyGame, _ := l.Create(host, engine.GameConfig{Players: 3, Ruleset: "base"}, false)
	if _, err := l.ResetToLobby(host, lobbyGame.Game.ID, nil); !errors.Is(err, ErrNotActive) {
		t.Errorf("reset of lobby game err = %v, want ErrNotActive", err)
	}

	// Host resets the live game: host + alice still present, bob has dropped.
	rs, err := l.ResetToLobby(host, gid, map[int64]bool{host.ID: true, alice.ID: true})
	if err != nil {
		t.Fatal(err)
	}
	if rs.Game.ID == gid {
		t.Fatal("reset reused the live game id")
	}
	if rs.Game.Status != "lobby" {
		t.Errorf("reset status = %q, want lobby", rs.Game.Status)
	}

	// The old game is torn down (abandoned), so no one can rejoin it.
	if g, _ := st.GameByID(gid); g.Status != "abandoned" {
		t.Errorf("old game status = %q, want abandoned", g.Status)
	}

	// Expect: host@0, alice present, bob dropped, exactly one fresh bot.
	if len(rs.Seats) != 3 {
		t.Fatalf("reset seats = %d, want 3 (%+v)", len(rs.Seats), rs.Seats)
	}
	if rs.Seats[0].No != 0 || rs.Seats[0].UserID != host.ID {
		t.Errorf("seat 0 = %+v, want host", rs.Seats[0])
	}
	var sawAlice, sawBob, bots int
	for _, s := range rs.Seats {
		switch {
		case s.UserID == alice.ID:
			sawAlice++
		case s.UserID == bob.ID:
			sawBob++
		case s.Status == "bot":
			bots++
		}
	}
	if sawAlice != 1 || sawBob != 0 || bots != 1 {
		t.Errorf("roster: alice=%d bob=%d bots=%d, want 1/0/1", sawAlice, sawBob, bots)
	}
}

// A reset is the same table starting over, so returning players keep the color
// they were playing, not one derived from their new seat.
func TestResetToLobbyKeepsColors(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	bob := discordUser(t, st, "b", "bob")

	sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base"}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	for _, u := range []*store.User{alice, bob} {
		if _, err := l.Join(u, gid, ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}
	// Start pins every seat's color, including the ones still on a default, so
	// this is the color each player actually saw themselves as.
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	was := map[int64]string{}
	live, err := l.Summary(gid)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range live.Seats {
		was[s.UserID] = s.ColorHex
	}

	// Bob drops, so the seats renumber under whoever is left: the case where a
	// color tied to the seat rather than the player would visibly change.
	rs, err := l.ResetToLobby(host, gid, map[int64]bool{host.ID: true, alice.ID: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range rs.Seats {
		if s.Status == "bot" {
			continue
		}
		if got, want := s.ColorHex, was[s.UserID]; got != want {
			t.Errorf("seat %d (user %d) color = %q, want %q", s.No, s.UserID, got, want)
		}
	}

	// And the table still reads: no two seats share a color.
	seen := map[string]bool{}
	for _, s := range rs.Seats {
		if seen[s.ColorHex] {
			t.Errorf("color %q used twice (%+v)", s.ColorHex, rs.Seats)
		}
		seen[s.ColorHex] = true
	}
}

func TestSetSeatName(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "Bob")
	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID

	// Default: the seat shows the account name.
	if sum.Seats[0].UserName != "Bob" {
		t.Fatalf("default seat name = %q, want Bob", sum.Seats[0].UserName)
	}

	// A per-game override wins.
	out, err := l.SetSeatName(host, gid, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if out.Seats[0].UserName != "Alice" {
		t.Errorf("after set = %q, want Alice", out.Seats[0].UserName)
	}

	// Clearing reverts to the account name.
	out, err = l.SetSeatName(host, gid, "")
	if err != nil {
		t.Fatal(err)
	}
	if out.Seats[0].UserName != "Bob" {
		t.Errorf("after clear = %q, want Bob", out.Seats[0].UserName)
	}

	// A user with no seat cannot set a name.
	stranger := discordUser(t, st, "d2", "Stranger")
	if _, err := l.SetSeatName(stranger, gid, "X"); !errors.Is(err, ErrNotSeated) {
		t.Errorf("non-seated err = %v, want ErrNotSeated", err)
	}
}

func TestBrowseCachesWithinTTL(t *testing.T) {
	l, st := newLobby(t)
	now := time.Unix(1000, 0)
	l.now = func() time.Time { return now }

	host := discordUser(t, st, "h1", "host")
	if _, err := l.Create(host, engine.GameConfig{Players: 4}, false); err != nil {
		t.Fatal(err)
	}

	first, err := l.Browse()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 {
		t.Fatalf("first Browse = %d games, want 1", len(first))
	}

	// A second public game created within the TTL window is not yet visible:
	// Browse serves the cached snapshot.
	host2 := discordUser(t, st, "h2", "host2")
	if _, err := l.Create(host2, engine.GameConfig{Players: 4}, false); err != nil {
		t.Fatal(err)
	}
	now = now.Add(browseCacheTTL - time.Millisecond)
	cached, _ := l.Browse()
	if len(cached) != 1 {
		t.Errorf("Browse within TTL = %d games, want stale 1", len(cached))
	}

	// Past the TTL it refreshes and sees both.
	now = now.Add(2 * time.Millisecond)
	fresh, _ := l.Browse()
	if len(fresh) != 2 {
		t.Errorf("Browse after TTL = %d games, want 2", len(fresh))
	}
}

func TestStartRandomTurnOrderCarriesIdentity(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")
	bob := discordUser(t, st, "d3", "bob")

	sum, err := l.Create(host, engine.GameConfig{Players: 3, TurnOrder: engine.TurnOrderRandom}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	l.Join(alice, id, "")
	l.Join(bob, id, "")

	// Give each seat a distinct color (and alice a name override) so we can prove
	// the player's identity follows them to their shuffled seat.
	st.SetSeatColor(id, 0, "c-host")
	st.SetSeatColor(id, 1, "c-alice")
	st.SetSeatColor(id, 2, "c-bob")
	st.SetSeatDisplayName(id, 1, "AliceName")

	// Pin the shuffle to a reverse permutation so the assertion is deterministic.
	defer func(orig func(uint64, int) []int) { seatOrder = orig }(seatOrder)
	seatOrder = func(_ uint64, n int) []int {
		p := make([]int, n)
		for i := range p {
			p[i] = n - 1 - i
		}
		return p
	}

	if err := l.Start(host, id); err != nil {
		t.Fatal(err)
	}
	seats, _ := st.Seats(id)
	want := []struct {
		uid   int64
		color string
		name  string
	}{
		{bob.ID, "c-bob", "bob"},
		{alice.ID, "c-alice", "AliceName"},
		{host.ID, "c-host", "host"},
	}
	if len(seats) != len(want) {
		t.Fatalf("seats = %d, want %d", len(seats), len(want))
	}
	for i, w := range want {
		s := seats[i]
		if s.No != i || s.UserID != w.uid || s.Color != w.color || s.UserName != w.name {
			t.Errorf("seat %d = {no:%d uid:%d color:%q name:%q}, want {uid:%d color:%q name:%q}",
				i, s.No, s.UserID, s.Color, s.UserName, w.uid, w.color, w.name)
		}
	}
}

func TestStartLobbyOrderCarriesColorAcrossGap(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")
	bob := discordUser(t, st, "d3", "bob")
	carol := discordUser(t, st, "d4", "carol")

	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false) // default lobby order
	id := sum.Game.ID
	for _, u := range []*store.User{alice, bob, carol} {
		l.Join(u, id, "")
	}
	st.SetSeatColor(id, 2, "c-bob")
	st.SetSeatColor(id, 3, "c-carol")

	// alice (seat 1) leaves: bob 2->1 and carol 3->2 must keep their colors.
	if _, err := l.Leave(alice, id); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, id); err != nil {
		t.Fatal(err)
	}
	seats, _ := st.Seats(id)
	if len(seats) != 3 {
		t.Fatalf("seats = %d, want 3", len(seats))
	}
	if seats[1].UserID != bob.ID || seats[1].Color != "c-bob" {
		t.Errorf("seat 1 = {uid:%d color:%q}, want bob c-bob", seats[1].UserID, seats[1].Color)
	}
	if seats[2].UserID != carol.ID || seats[2].Color != "c-carol" {
		t.Errorf("seat 2 = {uid:%d color:%q}, want carol c-carol", seats[2].UserID, seats[2].Color)
	}
}

// TestStartPinsDefaultColorsToPlayers: a seat that never picked renders
// DefaultSeatColor(seat_no) at read time, so the start shuffle would hand the
// host whichever default their new index maps to (possibly a bot's color),
// while bots keep the explicit color from AddBot. Colors follow the player, so
// Start must pin each seat's effective color before renumbering.
func TestStartPinsDefaultColorsToPlayers(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	sum, err := l.Create(host, engine.GameConfig{Players: 3, TurnOrder: engine.TurnOrderRandom}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	for range 2 {
		if _, err := l.AddBot(host, id); err != nil {
			t.Fatal(err)
		}
	}
	// What the lobby showed the host before start: seat 0's order default (red).
	want := cosmetics.DefaultSeatColor(0)

	// Pin the shuffle to a reverse permutation: the host lands on seat 2, whose
	// order default is a different color entirely.
	defer func(orig func(uint64, int) []int) { seatOrder = orig }(seatOrder)
	seatOrder = func(_ uint64, n int) []int {
		p := make([]int, n)
		for i := range p {
			p[i] = n - 1 - i
		}
		return p
	}
	if err := l.Start(host, id); err != nil {
		t.Fatal(err)
	}

	seats, _ := st.Seats(id)
	hs := seatByUser(&Summary{Seats: seats}, host.ID)
	if hs == nil {
		t.Fatalf("host not seated after start: %v", seats)
	}
	if hs.No != 2 {
		t.Fatalf("host seat = %d, want 2 (shuffle not applied)", hs.No)
	}
	if got := effectiveColor(hs); got.ID != want.ID {
		t.Errorf("host color after start = %s, want %s", got.ID, want.ID)
	}
	// And no bot may share it, which would put two seats on one hue.
	for _, s := range seats {
		if s.UserID != host.ID && effectiveColor(s).ID == want.ID {
			t.Errorf("seat %d (uid %d) shares the host's color %s", s.No, s.UserID, want.ID)
		}
	}
}

// stubSupporter is a SupporterGate seam for tests: it reports a fixed status and
// records how many times the lobby consulted it.
type stubSupporter struct {
	ok    bool
	err   error
	calls int
}

func (s *stubSupporter) IsSupporter(int64) (bool, error) {
	s.calls++
	return s.ok, s.err
}

// TestStartBotOnlyRequiresSupporter covers the supporter gate on starting a game
// with no second human: a host playing alone against bots (or spectating an
// all-bot table) must be an active supporter, while any table with two or more
// humans starts for anyone.
func TestStartBotOnlyRequiresSupporter(t *testing.T) {
	t.Run("non-supporter blocked from host+bots", func(t *testing.T) {
		l, st := newLobby(t)
		gate := &stubSupporter{ok: false}
		l.SetSupporterGate(gate)
		host := discordUser(t, st, "d1", "host")
		gid := mustCreate(t, l, host, 3)
		if _, err := l.AddBot(host, gid); err != nil {
			t.Fatal(err)
		}
		if _, err := l.AddBot(host, gid); err != nil {
			t.Fatal(err)
		}
		if err := l.Start(host, gid); !errors.Is(err, ErrSupporterOnly) {
			t.Errorf("non-supporter all-bot start err = %v, want ErrSupporterOnly", err)
		}
		if gate.calls == 0 {
			t.Error("supporter gate was never consulted")
		}
	})

	t.Run("supporter allowed", func(t *testing.T) {
		l, st := newLobby(t)
		l.SetSupporterGate(&stubSupporter{ok: true})
		host := discordUser(t, st, "d1", "host")
		gid := mustCreate(t, l, host, 3)
		l.AddBot(host, gid)
		l.AddBot(host, gid)
		if err := l.Start(host, gid); err != nil {
			t.Errorf("supporter all-bot start err = %v, want nil", err)
		}
	})

	t.Run("second human bypasses the gate", func(t *testing.T) {
		l, st := newLobby(t)
		gate := &stubSupporter{ok: false}
		l.SetSupporterGate(gate)
		host := discordUser(t, st, "d1", "host")
		alice := discordUser(t, st, "d2", "alice")
		gid := mustCreate(t, l, host, 3)
		if _, err := l.Join(alice, gid, ""); err != nil {
			t.Fatal(err)
		}
		l.AddBot(host, gid) // host + alice + 1 bot: two humans, not bot-only
		if err := l.Start(host, gid); err != nil {
			t.Errorf("two-human start err = %v, want nil", err)
		}
		if gate.calls != 0 {
			t.Errorf("supporter gate consulted %d times for a two-human game", gate.calls)
		}
	})

	t.Run("no gate wired allows all-bot start", func(t *testing.T) {
		l, st := newLobby(t) // no SetSupporterGate
		host := discordUser(t, st, "d1", "host")
		gid := mustCreate(t, l, host, 3)
		l.AddBot(host, gid)
		l.AddBot(host, gid)
		if err := l.Start(host, gid); err != nil {
			t.Errorf("ungated all-bot start err = %v, want nil", err)
		}
	})
}

// A table created normally has memory mode off, and the host can turn it on.
// Ranked locks it on (ranked.ConfigFor); casual tables only get it on request.
func TestMemoryModeDefaultsOffAndIsHostSettable(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	var cfg engine.GameConfig
	if err := json.Unmarshal(sum.Game.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.MemoryMode {
		t.Fatal("a fresh lobby must have memory mode off")
	}
	if bytes.Contains(sum.Game.Config, []byte("memory_mode")) {
		t.Errorf("memory mode off should leave no key on the wire: %s", sum.Game.Config)
	}

	cfg.MemoryMode = true
	sum2, err := l.UpdateConfig(host, sum.Game.ID, cfg)
	if err != nil {
		t.Fatal(err)
	}
	var back engine.GameConfig
	if err := json.Unmarshal(sum2.Game.Config, &back); err != nil {
		t.Fatal(err)
	}
	if !back.MemoryMode {
		t.Errorf("host's memory mode = on was not stored: %s", sum2.Game.Config)
	}
}

// A link admits its holder to a listed table, and a listed table can still be
// joined without one. Before migration 0029 public tables had no code.
func TestPublicTableAcceptsBothCodeAndNoCode(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")
	bob := discordUser(t, st, "d3", "bob")

	pub, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := pub.Game.ID
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Errorf("joining a public table without a code: %v", err)
	}
	if _, err := l.Join(bob, gid, pub.Game.InviteCode); err != nil {
		t.Errorf("joining a public table WITH its code: %v", err)
	}
}

// Going private invalidates the link published while the table was public
// (the browser and the Discord feed both carry it). A link the host sent while
// public stops working at the flip; that is intended.
func TestGoingPrivateInvalidatesLink(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	scraper := discordUser(t, st, "d2", "scraper")
	invited := discordUser(t, st, "d3", "invited")
	stranger := discordUser(t, st, "d4", "stranger")

	pub, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid, published := pub.Game.ID, pub.Game.InviteCode

	priv, err := l.SetPrivacy(host, gid, true)
	if err != nil {
		t.Fatal(err)
	}
	// The code somebody took off the public listing is now dead.
	if _, err := l.Join(scraper, gid, published); !errors.Is(err, ErrBadInvite) {
		t.Errorf("a link published while public still works: err = %v", err)
	}
	// The host's fresh code is what admits people now.
	if _, err := l.Join(invited, gid, priv.Game.InviteCode); err != nil {
		t.Errorf("the rotated code does not admit its holder: %v", err)
	}
	// And the door really is closed to everyone else.
	if _, err := l.Join(stranger, gid, ""); !errors.Is(err, ErrBadInvite) {
		t.Errorf("codeless join of a private table err = %v, want ErrBadInvite", err)
	}
	if _, err := l.Join(stranger, gid, "wrongcode"); !errors.Is(err, ErrBadInvite) {
		t.Errorf("wrong-code join err = %v, want ErrBadInvite", err)
	}
}

// A guest may not join a listed table from the browser. Guest accounts exist
// only for invite links, and since public tables now carry codes, the check
// can't be "does this game have a code".
func TestGuestNeedsCodeOnPublicTable(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	guest, _ := st.CreateGuest("guesty")

	pub, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(guest, pub.Game.ID, ""); !errors.Is(err, ErrGuestNeedsLink) {
		t.Errorf("guest joined a public table codeless, err = %v", err)
	}
	if _, err := l.Join(guest, pub.Game.ID, pub.Game.InviteCode); err != nil {
		t.Errorf("guest with the code was refused: %v", err)
	}
}

// TestUnstampedSeatsSeparatedOnReseat covers the backstops for lobbies
// opened before seats were stamped: their seats have an empty Color and resolve
// to DefaultSeatColor(seat_no), so they can reach a reseat holding two of one
// color. Start and recreateLobby run them through keepDistinct.
//
// Both halves clear the stamps by hand, the only way to build such a table now.
func TestUnstampedSeatsSeparatedOnReseat(t *testing.T) {
	l, st := newLobbyWithColors(t)
	host := discordUser(t, st, "L1", "host")

	sum, err := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	for range 3 {
		if _, err := l.AddBot(host, gid); err != nil {
			t.Fatal(err)
		}
	}
	// The legacy shape: the host wearing seat 2's default by choice, everyone
	// else unstamped, so seat 2 renders it too.
	clash := cosmetics.DefaultSeatColor(2)
	if err := st.SetSeatColor(gid, 0, clash.ID); err != nil {
		t.Fatal(err)
	}
	for no := 1; no < 4; no++ {
		if err := st.SetSeatColor(gid, no, ""); err != nil {
			t.Fatal(err)
		}
	}
	pre, err := l.Summary(gid)
	if err != nil {
		t.Fatal(err)
	}
	if pre.Seats[0].ColorHex != pre.Seats[2].ColorHex {
		t.Fatalf("premise broken: seats 0 and 2 render %s and %s, wanted the same",
			pre.Seats[0].ColorHex, pre.Seats[2].ColorHex)
	}

	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}
	started, err := l.Summary(gid)
	if err != nil {
		t.Fatal(err)
	}
	assertSeatColorsDistinct(t, "start of a legacy table", started.Seats)
	if hs := seatByUser(started, host.ID); hs == nil || hs.ColorHex != clash.Hex {
		t.Errorf("host color = %v, want to keep the %s they were wearing", hs, clash.Hex)
	}

	// Same again through the reset path: unstamp the live game's seats and put
	// the host back on the color one of them now renders.
	for _, s := range started.Seats {
		if s.UserID == host.ID {
			continue
		}
		if err := st.SetSeatColor(gid, s.No, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.SetSeatColor(gid, 0, cosmetics.DefaultSeatColor(1).ID); err != nil {
		t.Fatal(err)
	}
	rs, err := l.ResetToLobby(host, gid, map[int64]bool{host.ID: true})
	if err != nil {
		t.Fatal(err)
	}
	assertSeatColorsDistinct(t, "reset of a legacy table", rs.Seats)
}

// A scenario that deals its own map (Explorers) must be creatable with no
// board. validateConfig refuses a supplied board for it, and must not invent a
// full-land hexagon when none is given and then validate that.
func TestCreateWithoutBoardGeneratesMap(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d-ownmap", "host")

	for _, ruleset := range []string{"explorers", "cak+explorers"} {
		sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: ruleset}, true)
		if err != nil {
			t.Fatalf("%s: %v", ruleset, err)
		}
		var stored engine.GameConfig
		if err := json.Unmarshal(sum.Game.Config, &stored); err != nil {
			t.Fatal(err)
		}
		if stored.Board != nil {
			t.Errorf("%s: stored a board of %d tiles, want none",
				ruleset, len(stored.Board.Tiles))
		}
		if stored.Ruleset != ruleset {
			t.Errorf("%s: stored ruleset %q", ruleset, stored.Ruleset)
		}
	}

	// A board is still refused for such a ruleset.
	cfg := engine.GameConfig{Players: 4, Ruleset: "explorers", Board: fullLandBoard(3)}
	if _, err := l.Create(host, cfg, true); !errors.Is(err, ErrBadConfig) {
		t.Errorf("an authored board was accepted for explorers: %v", err)
	}
}

// A ruleset with no robber stores no friendly-robber setting: the lobby hides
// the switch and the engine ignores it, so a stray true (an older client, a
// switch left on before Wagons was chosen) is cleared.
func TestFriendlyRobberClearedWithoutRobber(t *testing.T) {
	for rs, want := range map[string]bool{"base+wagons": false, "base+raiders": false, "base": true, "base+cak": true} {
		cfg := engine.GameConfig{Players: 4, Ruleset: rs, FriendlyRobber: true}
		if err := validateConfig(&cfg); err != nil {
			t.Fatalf("%s: %v", rs, err)
		}
		if cfg.FriendlyRobber != want {
			t.Errorf("%s: friendly_robber stored as %v, want %v", rs, cfg.FriendlyRobber, want)
		}
	}
}
