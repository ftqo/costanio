// Package scenarios implements the Fishermen and Caravans scenarios on a standard
// (procedural) board.
package scenarios

import (
	"encoding/gob"
	"encoding/json"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// noApply/noDecide helpers keep tiny modules tidy.
func notHandled() ([]engine.Event, bool, error) { return nil, false, nil }

func raw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func init() {
	engine.RegisterModule(FishermenName, func() engine.Module { return Fishermen{} })
	engine.RegisterModule(CaravansName, func() engine.Module { return Caravans{} })
	engine.RegisterTerrain(board.Lake, FishermenName)
	gob.Register(&FishExt{})
	gob.Register(&CaravansExt{})
}
