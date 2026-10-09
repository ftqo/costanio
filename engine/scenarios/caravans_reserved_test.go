package scenarios

import (
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// finishOasis never puts the oasis on a hex another module reserves (the Wagons
// trade-hex candidates, engine.HexReserver). On a generated board those are outer
// corners the interior repair never reaches, and a cape cannot start three
// caravans, so the swap never picks one. Only the last-resort promotion can, when
// no interior hex starts three caravans: a thin authored map with a cape inside
// the ring, which this builds.
func TestOasisRepairAvoidsReservedHexes(t *testing.T) {
	// A radius-3 board whose land is ten scattered hexes inside the ring (found
	// by search): no desert, nothing that starts three caravans, and some of
	// the interior sites are capes.
	b := &board.Board{Radius: 3, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(3) {
		b.Tiles[h] = board.Tile{Res: board.Sea}
	}
	for _, h := range []board.Hex{{Q: -2, R: 0}, {Q: -2, R: 1}, {Q: -2, R: 2}, {Q: -1, R: -1}, {Q: -1, R: 0},
		{Q: -1, R: 2}, {Q: 0, R: -1}, {Q: 0, R: 2}, {Q: 1, R: 0}, {Q: 2, R: -1}} {
		b.Tiles[h] = board.Tile{Res: board.Wheat, Number: 5}
	}
	cfg := engine.GameConfig{Players: 4, Ruleset: "base+caravans+wagons"}
	reserved := engine.ReservedHexes(cfg, b)
	all := oasisSites(b)
	hit := 0
	for _, h := range all {
		if reserved[h] {
			hit++
		}
	}
	if hit == 0 || hit == len(all) {
		t.Fatalf("fixture: %d of %d repair sites reserved", hit, len(all))
	}
	for seed := range uint64(40) {
		bb := b.Clone()
		finishOasis(bb, cfg, rand.New(rand.NewPCG(seed, 3)))
		o, ok := pickOasis(bb)
		if !ok {
			t.Fatalf("seed %d: no oasis promoted", seed)
		}
		if reserved[o] {
			t.Fatalf("seed %d: the oasis was promoted onto reserved hex %v", seed, o)
		}
	}
}
