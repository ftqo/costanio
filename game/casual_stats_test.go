package game

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/store"
)

// nPlayerLog is twoPlayerLog's shape at any seat count: a seq-valid finished
// log with seat 0 the winner. Only the player count matters here.
func nPlayerLog(players int) []engine.Event {
	b := &board.Board{
		Radius: 2,
		Tiles: map[board.Hex]board.Tile{
			{Q: 0, R: 0}:  {Res: board.Wheat, Number: 8},
			{Q: 0, R: -1}: {Res: board.ResNone, Number: 0},
			{Q: 1, R: -1}: {Res: board.ResNone, Number: 0},
		},
		Robber: board.Hex{Q: 0, R: -1},
	}
	return []engine.Event{
		ev(0, engine.EvGameCreated, engine.GameCreatedData{
			Config: engine.GameConfig{Players: players, TargetVP: 10, Ruleset: "base"},
		}),
		ev(1, engine.EvBoardGenerated, engine.BoardGeneratedData{Board: b}),
		ev(2, engine.EvTurnStarted, engine.TurnStartedData{Player: 0}),
		ev(3, engine.EvGameFinished, engine.GameFinishedData{Winner: 0, VP: 10}),
	}
}

// seedCasualTable creates a finished game with `players` seats: one human host
// and the rest bots with personality display names. It returns the seats. Bot
// seats matter: the casual population is games with bots, and the bot mirror
// is keyed by display name.
func seedCasualTable(t *testing.T, st *store.Store, id string, players int, ranked bool) []*store.Seat {
	t.Helper()
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(engine.GameConfig{Players: players})
	if err := st.CreateGame(&store.Game{
		ID: id, Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID, Ranked: ranked,
	}); err != nil {
		t.Fatalf("CreateGame: %v", err)
	}
	if err := st.AddSeat(id, 0, host.ID); err != nil {
		t.Fatalf("AddSeat 0: %v", err)
	}
	names := []string{"Bot Winston", "Bot William", "Bot Z", "Bot Moriarty", "Bot Bop"}
	for i := 1; i < players; i++ {
		u, _ := st.CreateGuest(names[(i-1)%len(names)])
		if err := st.AddSeatFull(id, store.SeatPlacement{No: i, UserID: u.ID, Status: "bot"}); err != nil {
			t.Fatalf("AddSeatFull %d: %v", i, err)
		}
	}
	if err := st.AppendEvents(id, nPlayerLog(players)); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}
	if err := st.SetGameStatus(id, "active"); err != nil {
		t.Fatalf("SetGameStatus: %v", err)
	}
	seats, err := st.Seats(id)
	if err != nil {
		t.Fatalf("Seats: %v", err)
	}
	return seats
}

// TestCasualStatsOnlyCountFourPlayerGames: with three, four and five seats,
// only the four-player game reaches either mirror. The others still count in
// games/wins; they are only excluded from the mirror.
func TestCasualStatsOnlyCountFourPlayerGames(t *testing.T) {
	for _, tc := range []struct {
		name       string
		players    int
		wantCasual int
	}{
		{"three players", 3, 0},
		{"four players", 4, 1},
		{"five players", 5, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st := openStore(t)
			seats := seedCasualTable(t, st, "g", tc.players, false)
			host := seats[0].UserID

			m := NewManager(st, &fakeClock{})
			defer m.StopAll()
			m.finish("g", 0)

			rows, err := st.StatsFor(host)
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != 1 {
				t.Fatalf("StatsFor = %d rows, want 1", len(rows))
			}
			// Every count still reaches the career total. Only the mirror is gated.
			if rows[0].Games != 1 || rows[0].Wins != 1 {
				t.Errorf("career total = %d/%d, want 1/1 at %d players", rows[0].Games, rows[0].Wins, tc.players)
			}
			if rows[0].CasualGames != tc.wantCasual {
				t.Errorf("casual_games = %d, want %d at %d players", rows[0].CasualGames, tc.wantCasual, tc.players)
			}

			bots, err := st.AllBotStats()
			if err != nil {
				t.Fatal(err)
			}
			wantBots := 0
			if tc.wantCasual == 1 {
				wantBots = tc.players - 1
			}
			if len(bots) != wantBots {
				t.Errorf("bot_stats holds %d rows, want %d at %d players: %+v", len(bots), wantBots, tc.players, bots)
			}
		})
	}
}

// TestRankedGamesSkipCasualMirror: a four-player ranked game passes
// the seat-count check and must still be excluded.
func TestRankedGamesSkipCasualMirror(t *testing.T) {
	st := openStore(t)
	seats := seedCasualTable(t, st, "r", 4, true)
	host := seats[0].UserID

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.finish("r", 0)

	rows, err := st.StatsFor(host)
	if err != nil || len(rows) != 1 {
		t.Fatalf("StatsFor: %v rows=%d", err, len(rows))
	}
	if rows[0].CasualGames != 0 {
		t.Errorf("casual_games = %d for a ranked game, want 0", rows[0].CasualGames)
	}
	// The game is still counted. (That the ranked mirror moved instead is
	// asserted in store.TestCasualStatsRoundTrip, which can see the column.)
	if rows[0].Games != 1 || rows[0].Wins != 1 {
		t.Errorf("career total = %d/%d, want 1/1", rows[0].Games, rows[0].Wins)
	}
	if bots, _ := st.AllBotStats(); len(bots) != 0 {
		t.Errorf("bot_stats holds %d rows for a ranked game, want 0", len(bots))
	}
}

// TestCasualStatsAreNotDoubleCounted: the counters are +1 upserts with no
// per-row idempotency, protected only by committing with the match-history row
// the recovery sweep keys on. This runs the sweep twice after an interrupted
// finalize, as a crash would leave it.
func TestCasualStatsAreNotDoubleCounted(t *testing.T) {
	st := openStore(t)
	seats := seedCasualTable(t, st, "c", 4, false)
	host := seats[0].UserID

	// The crash: the game transitions to finished, nothing else is written.
	won, err := st.FinishGameOnce("c", host)
	if err != nil || !won {
		t.Fatalf("FinishGameOnce = (%v, %v)", won, err)
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	m.recoverFinalization()
	m.recoverFinalization()

	rows, err := st.StatsFor(host)
	if err != nil || len(rows) != 1 {
		t.Fatalf("StatsFor: %v rows=%d", err, len(rows))
	}
	if rows[0].CasualGames != 1 || rows[0].CasualWins != 1 {
		t.Errorf("casual = %d/%d after two sweeps, want 1/1", rows[0].CasualGames, rows[0].CasualWins)
	}
	bots, err := st.AllBotStats()
	if err != nil {
		t.Fatal(err)
	}
	if len(bots) != 3 {
		t.Fatalf("bot_stats holds %d rows, want 3", len(bots))
	}
	for _, b := range bots {
		if b.Games != 1 {
			t.Errorf("%s counted %d games after two sweeps, want 1", b.Name, b.Games)
		}
	}
}
