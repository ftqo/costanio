package ruletest

import (
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/harbormaster"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/engine/wagons"
)

// game/views.go builds a FullView on the actor goroutine and server/ws.go
// marshals it later on the caller's goroutine, while the actor folds the next
// command. NewFullView copies the base State's reference fields for that reason;
// each module's ViewExt must do the same. Without -race, a shared map is `fatal
// error: concurrent map iteration and map write`, which no recover catches and
// which kills every game on the server.
//
// For each module: fill a live ext, take its view, write over the live ext
// through its existing maps, slices and pointers, and require the view to be
// unchanged. A view that aliased changes under the writes, reproducing the race
// deterministically on one goroutine.
//
// Shares fillDistinct and mutateInPlace with TestCloneExtCarriesEveryField. The
// two are separate checks: Decide's clone and the client's view are different
// copies, and a field can be deep-copied in one and aliased in the other.
func TestViewExtSharesNothingWithLiveExt(t *testing.T) {
	// Zero extensions, not the modules' constructors, so fields a constructor
	// does not know about are reached too. Every registered module belongs
	// here.
	cases := []struct {
		name   string
		newExt func() engine.Extension
	}{
		{"knights.Ext", func() engine.Extension { return &knights.Ext{} }},
		{"islands.Ext", func() engine.Extension { return &islands.Ext{} }},
		{"explorers.Ext", func() engine.Extension { return &explorers.Ext{} }},
		{"scenarios.CaravansExt", func() engine.Extension { return &scenarios.CaravansExt{} }},
		{"scenarios.FishExt", func() engine.Extension { return &scenarios.FishExt{} }},
		{"harbormaster.Ext", func() engine.Extension { return &harbormaster.Ext{} }},
		{"raiders.Ext", func() engine.Extension { return &raiders.Ext{} }},
		{"wagons.WagonsExt", func() engine.Extension { return &wagons.WagonsExt{} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { checkViewExtCopies(t, tc.name, tc.newExt) })
	}
}

// viewerSeat must be 0: modules gate own-seat fields on `viewer`, and
// fillDistinct's two-element player slices have seat 0, so it reaches the most
// fields. fillDistinct's counter starts at 1, so SpyThief and MMThief never equal
// it and no filled PlayerID indexes out of range.
const viewerSeat = engine.PlayerID(0)

func checkViewExtCopies(t *testing.T, name string, newExt func() engine.Extension) {
	t.Helper()

	fill := func(x engine.Extension) engine.Extension {
		v := reflect.ValueOf(x).Elem()
		if v.Kind() != reflect.Struct {
			t.Fatalf("%s: expected a pointer to a struct, got %s", name, v.Kind())
		}
		seed := 0
		fillDistinct(v, &seed, 4)
		return x
	}
	subject := fill(newExt())

	// The reference is a second, identically filled ext's view (fillDistinct is
	// deterministic), so this needs no copying machinery of its own that could
	// share a bug with the code under test.
	reference := viewFor(t, name, fill(newExt()))
	view := viewFor(t, name, subject)
	if !reflect.DeepEqual(view, reference) {
		t.Fatalf("%s: identically filled exts produced different views\n  a: %#v\n  b: %#v",
			name, view, reference)
	}

	// Write over everything the live ext can reach, through its existing
	// headers, as the actor's next fold would. The view was taken first.
	seed := 0
	mutateInPlace(reflect.ValueOf(subject).Elem(), &seed, 4)

	if !reflect.DeepEqual(view, reference) {
		t.Errorf("%s: view shares a map, slice or pointer with the live ext; copy it in ViewExt\n  view was: %#v\n  view now: %#v",
			name, reference, view)
	}
}

// viewFor takes both views a module can publish, so a field reachable only
// through ViewExtIdle is covered too. knights.Ext is the only IdleViewable.
func viewFor(t *testing.T, name string, x engine.Extension) [2]any {
	t.Helper()
	v, ok := x.(engine.Viewable)
	if !ok {
		t.Fatalf("%s does not implement engine.Viewable", name)
	}
	out := [2]any{v.ViewExt(viewerSeat), nil}
	if idle, ok := x.(engine.IdleViewable); ok {
		out[1] = idle.ViewExtIdle(viewerSeat)
	}
	return out
}
