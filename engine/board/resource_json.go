package board

import (
	"encoding/json"
	"fmt"
)

// Resources travel as self-describing strings so the terrain vocabulary is
// append-only: old frontends render unknown strings as a generic tile instead
// of misreading renumbered ints. See docs/maps.md.
var resourceNames = map[Resource]string{
	ResNone: "none",
	Wood:    "wood",
	Brick:   "brick",
	Sheep:   "sheep",
	Wheat:   "wheat",
	Ore:     "ore",
	Gold:    "gold",
	Sea:     "sea",
	Lake:    "lake",
	Fog:     "fog",
	ResLand: "land",
	Border:  "border",
	Swamp:   "swamp",
}

var resourcesByName = func() map[string]Resource {
	out := make(map[string]Resource, len(resourceNames))
	for r, n := range resourceNames {
		out[n] = r
	}
	return out
}()

func (r Resource) String() string {
	if n, ok := resourceNames[r]; ok {
		return n
	}
	return fmt.Sprintf("resource(%d)", int8(r))
}

func (r Resource) MarshalJSON() ([]byte, error) {
	n, ok := resourceNames[r]
	if !ok {
		return nil, fmt.Errorf("board: unknown resource %d", int8(r))
	}
	return json.Marshal(n)
}

func (r *Resource) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		v, ok := resourcesByName[s]
		if !ok {
			return fmt.Errorf("board: unknown resource %q", s)
		}
		*r = v
		return nil
	}
	// Legacy numeric form. Validate against the known set so we never accept a
	// value MarshalJSON would refuse to emit.
	var n int8
	if err := json.Unmarshal(data, &n); err != nil {
		return fmt.Errorf("board: bad resource %s", data)
	}
	if _, ok := resourceNames[Resource(n)]; !ok {
		return fmt.Errorf("board: unknown resource %d", n)
	}
	*r = Resource(n)
	return nil
}
