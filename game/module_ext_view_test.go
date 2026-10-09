package game

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// TestEveryModuleReachesClientView checks the join between layers: a
// module's state is in State.Ext, NewFullView publishes it, and the key
// appears in the encoded view. Fishermen and Caravans once derived their state
// without storing it, so view.ext was empty and their board layers drew
// nothing. It asserts on the encoded view, because a module could be in
// State.Ext and still not implement engine.Viewable.
func TestEveryModuleReachesClientView(t *testing.T) {
	for _, tc := range []struct {
		ruleset string
		want    []string
	}{
		{"base+fishermen", []string{"fishermen"}},
		{"base+caravans", []string{"caravans"}},
		{"base+cak", []string{"cak"}},
		{"base+fishermen+caravans", []string{"fishermen", "caravans"}},
		{"base+harbormaster", []string{"harbormaster"}},
		{"base+cak+harbormaster", []string{"cak", "harbormaster"}},
		{"base+raiders", []string{"raiders"}},
		{"base+wagons", []string{"wagons"}},
		{engine.CanonicalRuleset("base+caravans+wagons"), []string{"caravans", "wagons"}},
	} {
		t.Run(tc.ruleset, func(t *testing.T) {
			log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: tc.ruleset}, engine.SeedsFrom(9))
			if err != nil {
				t.Fatal(err)
			}
			s := engine.Empty()
			for _, e := range log {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			// From the first frame, before anyone has acted: the board is drawn
			// then, and a layer appearing later would shift under the player.
			raw, err := json.Marshal(NewFullView(s, 0))
			if err != nil {
				t.Fatal(err)
			}
			var got struct {
				Ext map[string]json.RawMessage `json:"ext"`
			}
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatal(err)
			}
			for _, name := range tc.want {
				if _, ok := got.Ext[name]; !ok {
					t.Fatalf("%s: view ext %v has no %q",
						tc.ruleset, keys(got.Ext), name)
				}
			}
		})
	}
}

func keys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// TestFishermenViewHasBoardFactsAtStart checks the content the
// board needs; an empty ext object would pass the test above and draw nothing.
func TestFishermenViewHasBoardFactsAtStart(t *testing.T) {
	s := freshState(t, "base+fishermen")
	var got struct {
		Ext struct {
			Fish struct {
				Grounds []struct {
					V      []any               `json:"v"`
					Hex    *struct{ Q, R int } `json:"hex"`
					Number int                 `json:"number"`
				} `json:"grounds"`
				LakeNumbers []int `json:"lake_numbers"`
			} `json:"fishermen"`
		} `json:"ext"`
	}
	decodeView(t, s, &got)
	if len(got.Ext.Fish.Grounds) == 0 {
		t.Fatal("no fishing grounds in the first view")
	}
	for _, g := range got.Ext.Fish.Grounds {
		if g.Hex == nil {
			t.Fatalf("ground %d publishes no hex", g.Number)
		}
		if len(g.V) == 0 {
			t.Fatalf("ground %d publishes no corners", g.Number)
		}
	}
	if len(got.Ext.Fish.LakeNumbers) != len(scenarios.LakeNumbers) {
		t.Fatalf("lake_numbers = %v, want %v", got.Ext.Fish.LakeNumbers, scenarios.LakeNumbers)
	}
}

// TestCaravansViewHasBoardFactsAtStart is the same for
// Caravans: without the oasis and the camel supply the waypost and camel layers
// have nothing to place.
func TestCaravansViewHasBoardFactsAtStart(t *testing.T) {
	s := freshState(t, "base+caravans")
	var got struct {
		Ext struct {
			Caravans struct {
				Oasis      *struct{ Q, R int } `json:"oasis"`
				CamelsLeft int                 `json:"camels_left"`
			} `json:"caravans"`
		} `json:"ext"`
	}
	decodeView(t, s, &got)
	if got.Ext.Caravans.Oasis == nil {
		t.Fatal("no oasis in the first view")
	}
	if got.Ext.Caravans.CamelsLeft == 0 {
		t.Fatal("the camel supply reads empty in the first view")
	}
}

func freshState(t *testing.T, ruleset string) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: ruleset}, engine.SeedsFrom(9))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func decodeView(t *testing.T, s *engine.State, into any) {
	t.Helper()
	raw, err := json.Marshal(NewFullView(s, 0))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatal(err)
	}
}
