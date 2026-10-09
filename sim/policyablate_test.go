package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestPolicyAblation asks what each hand-written sub-policy is worth by
// replacing it with a poor version and measuring the loss. The weight space is
// exhausted; a policy whose removal costs nothing isn't earning its complexity,
// and one whose removal costs a lot is where further work belongs.
func TestPolicyAblation(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, name := range []string{"placement", "setup-road", "robber", "trade"} {
		st := openStore(t)
		l, err := Run(st, LadderOptions{
			Contenders: []Contender{
				{Name: "naive:" + name, New: func() game.CommandSource { return bot.NewStrong(bot.WithNaivePolicy(name)) }},
				{Name: "full", New: func() game.CommandSource { return bot.NewStrong() }},
			},
			Games: 1200, Players: 4, Seed: 6_600_000, Workers: 12,
		})
		if err != nil {
			t.Fatal(err)
		}
		r := l.Results[0]
		t.Logf("naive %-11s %5.1f%% [%.1f%%, %.1f%%]   (policy is worth %.1f points)",
			name, r.WinRate*100, r.CILow*100, r.CIHigh*100, 50-r.WinRate*100)
	}
}
