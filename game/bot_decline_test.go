package game

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
)

// TestBotsAnswerEveryOfferPromptly: a human offering to a table of bots gets
// an answer from each, a decline where the bot will not deal, rather than
// silence until the offer expires. The offer (five of a resource for one card)
// is one no bot takes. The answers go through the normal persist-then-broadcast
// commit, so they are in the log.
func TestBotsAnswerEveryOfferPromptly(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	m := NewManager(st, clock)
	defer m.StopAll()
	a, _ := m.Get("g1")

	mirror := mirrorState(t, st, "g1")
	var offer engine.Command
	found := false
	for i := 0; i < 5000 && !found; i++ {
		if mirror.Phase == engine.PhasePlay && mirror.Cur == 0 && mirror.Rolled &&
			!mirror.RobberPending && len(mirror.PendingDiscards) == 0 {
			hand := mirror.Players[0].Hand
			for r := 1; r <= 5; r++ {
				if hand[r] > 0 {
					var give, want engine.Hand
					give[r] = 1
					want[r%5+1] = 5
					data, _ := json.Marshal(engine.TradeOfferedData{Give: give, Want: want})
					offer = engine.Command{Player: 0, Type: engine.CmdOfferTrade, Data: data}
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		evs, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror decide %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor.Do(%s): %v", cmd.Type, err)
		}
	}
	if !found {
		t.Fatal("never reached a seat-0 offerable state")
	}

	a.SetSeatBot(1, bot.NewStrong())
	a.SetSeatBot(2, bot.NewStrong())
	if err := a.Do(offer); err != nil {
		t.Fatalf("offer: %v", err)
	}

	// The fake clock never advances, so the offer cannot expire: any answer
	// came from the bots.
	deadline := time.Now().Add(5 * time.Second)
	for {
		var answered int
		var open bool
		a.call(func() {
			if o := a.state.ActiveOffer; o != nil {
				open = true
				for _, s := range []engine.PlayerID{1, 2} {
					if o.Responded(s) {
						answered++
					}
				}
			}
		})
		if !open {
			t.Fatal("the offer closed before the bots answered")
		}
		if answered == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("want both bots to answer the offer, %d did", answered)
		}
		time.Sleep(time.Millisecond)
	}

	// On the record, not just in memory.
	evs, err := st.LoadEvents("g1", 0)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, e := range evs {
		if e.Type == engine.EvTradeResponded || e.Type == engine.EvTradeCountered {
			n++
		}
	}
	if n != 2 {
		t.Fatalf("want 2 persisted answers, got %d", n)
	}
}
