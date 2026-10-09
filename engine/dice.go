package engine

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
)

// SeedCommitment is published in the (public, redacted) game_created event:
// SHA-256 over the little-endian seed. The seed stays hidden until the game
// finishes and the unredacted replay reveals it (commit-reveal), so every roll
// and draw is verifiable afterwards. See docs/dice.md.
func SeedCommitment(seed uint64) string {
	var b [8]byte
	binary.LittleEndian.PutUint64(b[:], seed)
	sum := sha256.Sum256(b[:])
	return hex.EncodeToString(sum[:])
}

// rollDice produces the production roll for the state's dice mode.
//
//   - DiceRandom: independent seeded 2d6.
//   - DiceFair: a deck of all 36 ordered outcomes, shuffled per 36-roll epoch
//     and dealt without replacement, so every number comes up its exact
//     expected share.
//
// Both are pure functions of (public seed, position), and both streams are
// public: a player can re-derive every roll of a finished game from the
// revealed public seed.
func rollDice(s *State) (d1, d2 int) {
	if s.Config.DiceMode == DiceFair {
		epoch := s.RollCount / 36
		pos := s.RollCount % 36
		rng := rngFor(s.PublicSeed, -(epoch + 1)) // negative offsets reserve the deck-shuffle stream
		perm := rng.Perm(36)
		outcome := perm[pos]
		return outcome/6 + 1, outcome%6 + 1
	}
	rng := rngFor(s.PublicSeed, s.NextSeq)
	return rng.IntN(6) + 1, rng.IntN(6) + 1
}
