package scenarios

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// groundsFingerprint hashes the fishing grounds of every board ruleset rs
// generates for 2..10 players over 120 seeds, as stored in FishExt (vertex order
// included).
//
// It hashes the placement (corners and number), not fishGround's serialisation,
// so a wire-shape change to the struct does not move the goldens.
func groundsFingerprint(t *testing.T, rs string) string {
	t.Helper()
	h := sha256.New()
	for players := 2; players <= 10; players++ {
		for seed := uint64(1); seed <= 120; seed++ {
			log, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs}, engine.SeedsFrom(seed))
			if err != nil {
				t.Fatal(err)
			}
			s := engine.Empty()
			for _, e := range log {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			type placement struct {
				V      []board.Vertex `json:"v"`
				Number int            `json:"number"`
			}
			grounds := fishExtRO(s).Grounds
			flat := make([]placement, len(grounds))
			for i, g := range grounds {
				flat[i] = placement{V: g.V, Number: g.Number}
			}
			b, err := json.Marshal(flat)
			if err != nil {
				t.Fatal(err)
			}
			h.Write(b)
		}
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}
