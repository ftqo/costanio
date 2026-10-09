package board

import (
	"errors"
	"fmt"
)

// MaxRadius is the largest radius a board may be built at: ValidateLayout
// refuses a custom map beyond it, and presets and procedural boards are well
// inside it (RadiusFor tops out at 4, and the Islands ocean ring adds one).
// Frame can push a board one ring further (the coastal margin), so a board
// after New may stand at MaxRadius+1; Apply holds an uploaded log to that (see
// the EvBoardGenerated case).
const MaxRadius = 16

// ValidateLayout checks that a custom-built board is structurally sane before a
// game uses it. Sparse boards are allowed (any subset of the hex grid within
// the radius, bounded by tile count). It checks the radius, that every tile
// sits inside it, the robber on a real tile, at least 3 land tiles, at least
// one robber-neutral hex (or generic land Resolve can carve a desert from), and
// number tokens only on producing tiles. Balance rules (no adjacent 6/8, pip
// spread) are not enforced, and ruleset terrain is checked by
// engine.ValidateMap.
func (b *Board) ValidateLayout() error {
	if b.Radius < 1 || b.Radius > MaxRadius {
		return fmt.Errorf("board: radius must be 1-%d, got %d", MaxRadius, b.Radius)
	}
	land := 0
	deserts := 0
	generic := 0
	lakes := 0
	for h, t := range b.Tiles {
		if max(abs(h.Q), abs(h.R), abs(h.Q+h.R)) > b.Radius {
			return fmt.Errorf("board: tile (%d,%d) is outside radius %d", h.Q, h.R, b.Radius)
		}
		if t.Res != Sea && t.Res != Border {
			land++
		}
		switch t.Res {
		case ResNone:
			deserts++
		case ResLand:
			generic++
		case Lake, Swamp:
			// Both are non-producing land the robber may stand on. An authored map may
			// paint swamps and no desert, and must still validate.
			lakes++
		default: // other resource types intentionally unhandled here
		}
		// Producing tiles (incl. generic ResLand) may carry a token or leave it
		// blank (0 = randomized at game start); a pinned token must be valid.
		// Non-producing tiles carry no token.
		if takesNumber(t.Res) {
			if t.Number != 0 && (t.Number < 2 || t.Number > 12 || t.Number == 7) {
				return fmt.Errorf("board: tile (%d,%d) has invalid number %d", h.Q, h.R, t.Number)
			}
		} else if t.Number != 0 {
			return fmt.Errorf("board: non-producing tile (%d,%d) must have no number", h.Q, h.R)
		}
	}
	// The tile cap counts playable tiles only (Res neither Sea nor Border), so a
	// framed non-hexagon board with a large ocean ring still validates.
	if land > 300 {
		return fmt.Errorf("board: too many playable tiles (%d), max 300", land)
	}
	if land < 3 {
		return fmt.Errorf("board: need at least 3 land tiles, got %d", land)
	}
	// The robber must start on a hex that blocks nothing, so every map needs one.
	// Generic-land tiles count (Resolve carves deserts from them at game start).
	// A lake counts too: Fishermen turns every desert into one, and
	// board.RobberNeutral treats them alike, so generated Fishermen boards must
	// round-trip through share codes, POST /api/maps/* and the builder.
	if deserts == 0 && generic == 0 && lakes == 0 {
		return errors.New("board: need at least one desert tile")
	}
	// The robber is on a tile or beside the board. Fishermen starts it off the
	// board, and the two-fish spend sends it away again. Authored layouts never
	// carry that state, but it is legal and must not be rejected.
	if _, ok := b.Tiles[b.Robber]; !ok && b.RobberOnBoard() {
		return errors.New("board: robber is not on a tile")
	}
	if err := b.validateHarbors(); err != nil {
		return err
	}
	return nil
}

// validateHarbors rejects two harbors whose docks would stand on the same water
// hex (the hex on the seaward side of each harbor edge). Harbors with no single
// water side (both hexes land, or both water) have no dock hex and are skipped;
// rejecting them would break boards authors may already have saved.
func (b *Board) validateHarbors() error {
	seen := make(map[Hex]bool, len(b.Harbors))
	for _, h := range b.Harbors {
		sea, ok := b.HarborSeaHex(h)
		if !ok {
			continue
		}
		if seen[sea] {
			return fmt.Errorf("board: two harbors share the water hex (%d,%d); each harbor needs its own", sea.Q, sea.R)
		}
		seen[sea] = true
	}
	return nil
}
