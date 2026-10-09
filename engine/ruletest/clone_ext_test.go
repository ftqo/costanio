package ruletest

import (
	"fmt"
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

// engine.Decide runs the rules against a clone of the state, so a field CloneExt
// does not carry reads as zero to every rule that validates a command while the
// real state keeps the true value, and conservation checks do not notice.
//
// So the guarantee is structural:
//   - Clones start from a shallow struct copy, so every value field is carried.
//     Only reference fields (maps, slices, pointers) need explicit work, because
//     a shallow copy aliases them and Decide's speculative writes would reach the
//     live game.
//   - This test enumerates fields by reflection and checks both that the clone
//     carries every value and that writing through the clone cannot reach the
//     original. A new field is covered as soon as it is added.

// fillDistinct writes a non-zero, position-dependent value into every settable
// field reachable from v, so a dropped field shows up as zero. seed increments so
// no two fields share a value and a mixed-up copy is visible too.
//
// depth stops the walk on self-referential types. Four levels covers the deepest
// module state (islands.Ext.Reached's map-of-maps, knights.Ext.Players'
// slice-of-structs-of-slices).
func fillDistinct(v reflect.Value, seed *int, depth int) {
	if depth < 0 || !v.CanSet() {
		return
	}
	*seed++
	n := *seed
	switch v.Kind() {
	case reflect.Bool:
		v.SetBool(true)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(int64(n))
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		v.SetUint(uint64(n))
	case reflect.Float32, reflect.Float64:
		v.SetFloat(float64(n))
	case reflect.String:
		v.SetString(fmt.Sprintf("v%d", n))
	case reflect.Pointer:
		p := reflect.New(v.Type().Elem())
		fillDistinct(p.Elem(), seed, depth-1)
		v.Set(p)
	case reflect.Slice:
		// Two elements, so a truncation is distinguishable from a copy.
		s := reflect.MakeSlice(v.Type(), 2, 2)
		for i := range 2 {
			fillDistinct(s.Index(i), seed, depth-1)
		}
		v.Set(s)
	case reflect.Map:
		m := reflect.MakeMap(v.Type())
		for range 2 {
			k := reflect.New(v.Type().Key()).Elem()
			fillDistinct(k, seed, depth-1)
			val := reflect.New(v.Type().Elem()).Elem()
			fillDistinct(val, seed, depth-1)
			m.SetMapIndex(k, val)
		}
		v.Set(m)
	case reflect.Array:
		for i := range v.Len() {
			fillDistinct(v.Index(i), seed, depth-1)
		}
	case reflect.Struct:
		for _, field := range v.Fields() {
			fillDistinct(field, seed, depth-1)
		}
	case reflect.Interface:
		// No module Ext holds an interface field today. Fail rather than
		// silently cover less if one ever does.
		panic(fmt.Sprintf("fillDistinct: interface-typed field of type %s is not covered", v.Type()))
	default:
		// Chan, Func, Complex, UnsafePointer, Invalid: no module Ext holds one,
		// and there is nothing meaningful to fill if one ever did.
	}
}

// mutateInPlace rewrites every value reachable from v without replacing any
// slice header, map or pointer, so the writes land in whatever backing store v
// points at. Writing through the existing header reaches the original's memory
// exactly when CloneExt failed to deep-copy it.
//
// It recurses, so it catches sharing at any depth (knights.Ext.Players holds slices
// inside structs inside a slice).
func mutateInPlace(v reflect.Value, seed *int, depth int) {
	if depth < 0 {
		return
	}
	*seed++
	n := *seed
	switch v.Kind() {
	case reflect.Bool:
		if v.CanSet() {
			v.SetBool(!v.Bool())
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		if v.CanSet() {
			v.SetInt(int64(n) + 5000)
		}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if v.CanSet() {
			v.SetUint(uint64(n) + 5000)
		}
	case reflect.Float32, reflect.Float64:
		if v.CanSet() {
			v.SetFloat(float64(n) + 5000)
		}
	case reflect.String:
		if v.CanSet() {
			v.SetString(fmt.Sprintf("m%d", n))
		}
	case reflect.Pointer:
		if !v.IsNil() {
			mutateInPlace(v.Elem(), seed, depth-1) // through the pointer, not over it
		}
	case reflect.Slice, reflect.Array:
		for i := range v.Len() {
			mutateInPlace(v.Index(i), seed, depth-1) // through the header
		}
	case reflect.Map:
		if v.IsNil() {
			return
		}
		// Rewrite the existing entries and add one; both reach the original if
		// the map was shared.
		for _, k := range v.MapKeys() {
			nv := reflect.New(v.Type().Elem()).Elem()
			nv.Set(v.MapIndex(k))
			mutateInPlace(nv, seed, depth-1)
			v.SetMapIndex(k, nv)
		}
		k := reflect.New(v.Type().Key()).Elem()
		val := reflect.New(v.Type().Elem()).Elem()
		fillDistinct(k, seed, depth-1)
		fillDistinct(val, seed, depth-1)
		v.SetMapIndex(k, val)
	case reflect.Struct:
		for _, field := range v.Fields() {
			mutateInPlace(field, seed, depth-1)
		}
	default:
		// Interface, Chan, Func, Complex, UnsafePointer, Invalid: nothing to
		// write through. fillDistinct panics on an interface field first.
	}
}

// checkCloneExt applies the contract to one module's Ext. newExt must return a
// pointer to a fresh zero extension; two are filled identically and the second
// is the reference.
func checkCloneExt(t *testing.T, name string, newExt func() engine.Extension) {
	t.Helper()

	// fillDistinct is deterministic, so `reference` is what `subject` must
	// still look like after the test writes all over its clone.
	fill := func(x engine.Extension) reflect.Value {
		v := reflect.ValueOf(x).Elem()
		if v.Kind() != reflect.Struct {
			t.Fatalf("%s: expected a pointer to a struct, got %s", name, v.Kind())
		}
		seed := 0
		fillDistinct(v, &seed, 4)
		return v
	}
	subject := newExt()
	orig := fill(subject)
	reference := fill(newExt())

	clone := reflect.ValueOf(subject.CloneExt()).Elem()
	if clone.Type() != orig.Type() {
		t.Fatalf("%s: CloneExt returned %s, want %s", name, clone.Type(), orig.Type())
	}

	// Nothing dropped. Field by field, so the failure names the field.
	for i := range orig.NumField() {
		f := orig.Type().Field(i)
		if !f.IsExported() {
			continue
		}
		if !reflect.DeepEqual(orig.Field(i).Interface(), clone.Field(i).Interface()) {
			t.Errorf("%s.%s: CloneExt did not copy this field\n  original: %v\n  clone:    %v",
				name, f.Name, orig.Field(i), clone.Field(i))
		}
	}

	// Nothing shared, at any depth: write through every map, slice and
	// pointer the clone can reach, then require the original untouched.
	seed := 0
	mutateInPlace(clone, &seed, 4)
	for i := range orig.NumField() {
		f := orig.Type().Field(i)
		if !f.IsExported() {
			continue
		}
		if !reflect.DeepEqual(orig.Field(i).Interface(), reference.Field(i).Interface()) {
			t.Errorf("%s.%s: clone shares this field with the original\n  was:  %v\n  now:  %v",
				name, f.Name, reference.Field(i), orig.Field(i))
		}
	}
}

func TestCloneExtCarriesEveryField(t *testing.T) {
	// Each entry builds a zero extension, not the module's own
	// constructor, which sets only the fields it knows about.
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
		t.Run(tc.name, func(t *testing.T) { checkCloneExt(t, tc.name, tc.newExt) })
	}
}
