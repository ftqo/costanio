package lobby

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
	"github.com/ftqo/costan.io/store"
)

// rankedFour queues four Discord users into a real ranked match and returns the
// game id and the roster in the order the matchmaker hands it over: ascending
// by rating, as formGroups produces.
func rankedFour(t *testing.T, l *Lobby, st *store.Store) (string, []int64) {
	t.Helper()
	ids := make([]int64, 4)
	for i, name := range []string{"weakest", "second", "third", "strongest"} {
		u := discordUser(t, st, "rk-"+name, name)
		ids[i] = u.ID
	}
	gid, err := l.CreateRankedMatch("base", ids)
	if err != nil {
		t.Fatal(err)
	}
	return gid, ids
}

// A ranked game's created_by names a player only because the column is a
// foreign key. Reset is the one host power that accepts a live game, and it
// would let that player void a rated match they were losing (the row goes to
// "abandoned", so finalize never runs).
func TestRankedGameCannotBeResetToLobby(t *testing.T) {
	l, st := newLobby(t)
	gid, _ := rankedFour(t, l, st)

	g, err := st.GameByID(gid)
	if err != nil {
		t.Fatal(err)
	}
	if !g.Ranked || g.Status != "active" {
		t.Fatalf("ranked match is ranked=%v status=%q, want true/active", g.Ranked, g.Status)
	}
	nominalHost, err := st.UserByID(g.CreatedBy)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := l.ResetToLobby(nominalHost, gid, map[int64]bool{}); !errors.Is(err, ErrRankedNoReset) {
		t.Fatalf("ranked reset err = %v, want ErrRankedNoReset", err)
	}
	after, err := st.GameByID(gid)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "active" {
		t.Errorf("game status after refused reset = %q, want active", after.Status)
	}
	seats, err := st.Seats(gid)
	if err != nil {
		t.Fatal(err)
	}
	if len(seats) != 4 {
		t.Errorf("seats after refused reset = %d, want 4", len(seats))
	}
}

// A ranked game's created_by is whoever the committed public seed seated
// first, not userIDs[0], which would always be the lowest-rated player.
func TestRankedMatchHostIsSeededNotWeakest(t *testing.T) {
	l, st := newLobby(t)

	// Pin the seating so seat 0 is not the first entry of the
	// (rating-ascending) roster. A reverse permutation seats the last one.
	defer func(orig func(uint64, int) []int) { seatOrder = orig }(seatOrder)
	seatOrder = func(_ uint64, n int) []int {
		p := make([]int, n)
		for i := range p {
			p[i] = n - 1 - i
		}
		return p
	}

	gid, ids := rankedFour(t, l, st)
	g, err := st.GameByID(gid)
	if err != nil {
		t.Fatal(err)
	}
	if g.CreatedBy == ids[0] {
		t.Errorf("created_by = the lowest-rated queued player (%d)", g.CreatedBy)
	}
	seats, err := st.Seats(gid)
	if err != nil {
		t.Fatal(err)
	}
	if len(seats) != 4 {
		t.Fatalf("ranked seats = %d, want 4", len(seats))
	}
	if g.CreatedBy != seats[0].UserID {
		t.Errorf("created_by = %d, want seat 0's player %d", g.CreatedBy, seats[0].UserID)
	}
}

// Start writes the config back to the row. Manager.Start canonicalises on the
// way into the engine, so a non-canonical row would be played as one ruleset
// and recorded (stats, leaderboard) as another.
func TestStartCanonicalisesStoredRuleset(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "sc-h", "host")
	alice := discordUser(t, st, "sc-a", "alice")

	sum, err := l.Create(host, engine.GameConfig{Players: 2, Ruleset: "base+cak+caravans"}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Fatal(err)
	}

	// Write the non-canonical spelling straight into the row, bypassing
	// validateConfig, as an older game might still be stored.
	var cfg engine.GameConfig
	if err := json.Unmarshal(sum.Game.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	cfg.Ruleset = "base+caravans+cak"
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateGameConfig(gid, raw); err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateGameRuleset(gid, cfg.Ruleset); err != nil {
		t.Fatal(err)
	}

	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}

	const want = "base+cak+caravans"
	g, err := st.GameByID(gid)
	if err != nil {
		t.Fatal(err)
	}
	var stored engine.GameConfig
	if err := json.Unmarshal(g.Config, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Ruleset != want {
		t.Errorf("config ruleset after start = %q, want %q", stored.Ruleset, want)
	}
	if g.Ruleset != want {
		t.Errorf("ruleset column after start = %q, want %q", g.Ruleset, want)
	}
}

// The rebuild runs before the teardown, so a failed rebuild leaves the live
// game intact.
func TestResetToLobbyKeepsGameWhenRebuildFails(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "rf-h", "host")

	// An active game whose config Create will refuse (TargetVP far above what
	// the board can pay out), built directly so it never passes validateConfig.
	g := &store.Game{
		ID:        "rebuildfail",
		Ruleset:   "base",
		Config:    []byte(`{"players":4,"target_vp":999,"ruleset":"base"}`),
		CreatedBy: host.ID,
	}
	if err := st.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	if err := st.AddSeat(g.ID, 0, host.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.SetGameStatus(g.ID, "active"); err != nil {
		t.Fatal(err)
	}

	if _, err := l.ResetToLobby(host, g.ID, map[int64]bool{host.ID: true}); !errors.Is(err, ErrBadConfig) {
		t.Fatalf("reset err = %v, want ErrBadConfig", err)
	}
	after, err := st.GameByID(g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "active" {
		t.Errorf("game status after a failed reset = %q, want active", after.Status)
	}
}
