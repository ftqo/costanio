package board

import (
	"sort"
	"testing"
)

func codes(issues []Issue) []string {
	var out []string
	for _, i := range issues {
		out = append(out, i.Code)
	}
	sort.Strings(out)
	return out
}

func has(issues []Issue, code string) bool {
	for _, i := range issues {
		if i.Code == code {
			return true
		}
	}
	return false
}

func TestLintAdjacentRed(t *testing.T) {
	// Two neighboring tiles, a 6 and an 8 → adjacent_red.
	b := &Board{Radius: 1, Robber: Hex{1, 0}, Tiles: map[Hex]Tile{
		{0, 0}:  {Res: Ore, Number: 6},
		{1, 0}:  {Res: ResNone},
		{0, 1}:  {Res: Wheat, Number: 8}, // neighbor of {0,0}
		{1, -1}: {Res: Wood, Number: 4},
		{-1, 1}: {Res: Sheep, Number: 5},
	}}
	got := Lint(b)
	if !has(got, "adjacent_red") {
		t.Fatalf("expected adjacent_red, got codes %v", codes(got))
	}
	// The issue references both offending hexes.
	for _, i := range got {
		if i.Code == "adjacent_red" {
			if len(i.Hexes) != 2 {
				t.Errorf("adjacent_red should name 2 hexes, got %v", i.Hexes)
			}
			if i.Severity != "warning" {
				t.Errorf("adjacent_red severity = %q, want warning", i.Severity)
			}
		}
	}
}

func TestLintCleanBoard(t *testing.T) {
	// A balanced hand-built board reports no warnings: every resource averages 3
	// or 4 pips, the two wood tiles are apart, equal numbers never touch, and no
	// 6/8 is used, so no spot reaches the hot-spot thresholds.
	b := &Board{Radius: 1, Robber: Hex{0, 0}, Tiles: map[Hex]Tile{
		{0, 0}:  {Res: ResNone},
		{1, 0}:  {Res: Wood, Number: 4},
		{1, -1}: {Res: Brick, Number: 9},
		{0, -1}: {Res: Wood, Number: 10},
		{-1, 0}: {Res: Sheep, Number: 5},
		{-1, 1}: {Res: Wheat, Number: 4},
		{0, 1}:  {Res: Ore, Number: 10},
	}}
	if got := Lint(b); len(got) != 0 {
		t.Fatalf("clean board reported issues: %v", codes(got))
	}
}

func TestLintStructural(t *testing.T) {
	// No desert + only 2 land + a number on a sea tile.
	b := &Board{Radius: 1, Robber: Hex{0, 0}, Tiles: map[Hex]Tile{
		{0, 0}: {Res: Wood, Number: 4},
		{1, 0}: {Res: Wheat, Number: 5},
		{0, 1}: {Res: Sea, Number: 6}, // illegal token on sea
	}}
	got := Lint(b)
	for _, want := range []string{"no_desert", "few_land", "number_on_nonproducing"} {
		if !has(got, want) {
			t.Errorf("expected %s, got %v", want, codes(got))
		}
	}
	for _, i := range got {
		if i.Code == "no_desert" || i.Code == "few_land" || i.Code == "number_on_nonproducing" {
			if i.Severity != "error" {
				t.Errorf("%s severity = %q, want error", i.Code, i.Severity)
			}
		}
	}
}

func TestLintDuplicateAdjacent(t *testing.T) {
	b := &Board{Radius: 1, Robber: Hex{1, 0}, Tiles: map[Hex]Tile{
		{0, 0}:  {Res: Wood, Number: 5},
		{0, 1}:  {Res: Brick, Number: 5}, // neighbor, same number
		{1, 0}:  {Res: ResNone},
		{-1, 0}: {Res: Sheep, Number: 9},
		{1, -1}: {Res: Wheat, Number: 3},
	}}
	if !has(Lint(b), "adjacent_duplicate") {
		t.Fatalf("expected adjacent_duplicate, got %v", codes(Lint(b)))
	}
}
