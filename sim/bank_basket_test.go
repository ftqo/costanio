package sim

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
)

// TestBankBasketTradesConserveCards plays full Strong-bot games and replays each
// transcript, checking per-resource conservation and a non-negative bank at
// every step, and asserting that a basket trade (more than one give kind in one
// bank_traded event) happened somewhere. The bot only uses a basket when no
// single resource can fund the shortfall, so without that assertion a green run
// proves nothing about the path.
func TestBankBasketTradesConserveCards(t *testing.T) {
	skipUnlessSlow(t, "plays full games")
	const (
		seeds   = 20
		players = 4
	)
	baseBank := engine.BankPerResource(players)
	trades, baskets, cards := 0, 0, 0

	for seed := uint64(1); seed <= seeds; seed++ {
		st := openStore(t)
		res, err := RunGame(st, Options{
			Players:  players,
			Seed:     seed,
			Ruleset:  "base",
			TargetVP: 8,
			Timeout:  60 * time.Second,
			Bots:     func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			if errors.Is(err, ErrStalemate) {
				continue // rare non-terminating seed
			}
			t.Fatalf("seed %d: %v", seed, err)
		}
		ev, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatalf("seed %d transcript: %v", seed, err)
		}

		s := engine.Empty()
		for _, e := range ev {
			if e.Type == engine.EvBankTraded {
				var d engine.BankTradedData
				if err := json.Unmarshal(e.Data, &d); err != nil {
					t.Fatalf("seed %d: decode bank trade: %v", seed, err)
				}
				trades++
				kinds := 0
				for _, r := range board.Resources {
					if d.Give[r] > 0 {
						kinds++
					}
				}
				if kinds > 1 {
					baskets++
					cards += d.Get.Count()
				}
			}
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("seed %d: replay apply %s: %v", seed, e.Type, err)
			}
			for _, r := range board.Resources {
				total := s.Bank[r]
				if total < 0 {
					t.Fatalf("seed %d: bank went negative on %v after %s", seed, r, e.Type)
				}
				for p := range s.Players {
					n := s.Players[p].Hand[r]
					if n < 0 {
						t.Fatalf("seed %d: player %d has negative %v after %s", seed, p, r, e.Type)
					}
					total += n
				}
				if total != baseBank {
					t.Fatalf("seed %d: %v not conserved after %s: %d (want %d)", seed, r, e.Type, total, baseBank)
				}
			}
		}
	}
	if baskets == 0 {
		t.Fatalf("no multi-kind bank trade in %d bank trades across %d seeds", trades, seeds)
	}
	t.Logf("%d bank trades, of which %d were baskets buying %d cards", trades, baskets, cards)
}
