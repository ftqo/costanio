package sim

import (
	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// diversePool is a set of different strategies to play a candidate against,
// instead of three copies of itself.
//
// Against clones, Largest Army racing, blocking and expanding before a rival
// are zero-sum: they change who gets the thing, not whether that bot wins, so
// they read ~50% however good they are. The members differ along those axes
// (army pricing, city-upgrade timing), so a candidate has something to exploit
// or resist.
func diversePool() []Contender {
	cityRusher := bot.DefaultWeights()
	cityRusher.VP *= 2 // takes points early, upgrades fast
	cityRusher.Expansion *= 0.5

	wideExpander := bot.DefaultWeights()
	wideExpander.Expansion *= 2 // sprawls for spots
	wideExpander.Reach *= 2

	selfish := bot.DefaultWeights()
	selfish.Opp = 0 // ignores the field entirely, plays its own board

	return []Contender{
		{Name: "city-rusher", New: func() game.CommandSource { return bot.NewStrong(bot.WithWeights(cityRusher)) }},
		{Name: "wide-expander", New: func() game.CommandSource { return bot.NewStrong(bot.WithWeights(wideExpander)) }},
		{Name: "selfish", New: func() game.CommandSource { return bot.NewStrong(bot.WithWeights(selfish)) }},
	}
}

// vsPool plays a candidate in seat rotation against the diverse pool: one
// candidate seat against three different strategies, rather than four clones.
func vsPool(st *store.Store, name string, new func() game.CommandSource, games int, seed uint64) (Ladder, error) {
	cs := append([]Contender{{Name: name, New: new}}, diversePool()...)
	return Run(st, LadderOptions{
		Contenders: cs, Games: games, Players: 4, Seed: seed, Workers: 8,
	})
}
