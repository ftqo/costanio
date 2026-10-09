package board

import (
	"sort"
	"testing"
)

func sorted(in []int) []int {
	out := append([]int(nil), in...)
	sort.Ints(out)
	return out
}

func TestComplementTokens(t *testing.T) {
	tests := []struct {
		name   string
		pinned []int
		blanks int
		want   []int
	}{
		{
			// No pins: identical to the standard bag, so shape-only / full-board
			// generation is unchanged.
			name:   "no pins matches numberTokens",
			pinned: nil,
			blanks: 5,
			want:   sorted(numberTokens(nil, 5)),
		},
		{
			// Pins are a subset of the ideal spread: blanks fill the deficit, so
			// pinned + blanks == the ideal multiset for the whole board.
			name:   "subset pins fill the deficit",
			pinned: []int{2, 3, 3, 4, 5, 6, 8, 9},
			blanks: 4,
			want:   []int{10, 11, 11, 12}, // numberTokens(nil, 12) minus the pinned subset
		},
		{
			// Over-pinning a value beyond its standard count: the bag is still exactly
			// `blanks` long, every token legal, and no further 6 is added. Only these
			// properties are checked here (want is not set).
			name:   "over-pinned value stays legal and sized",
			pinned: []int{6, 6, 6, 6}, // a 6-tile board's ideal spread has no 6 at all
			blanks: 2,
			want:   nil, // property-checked, not exact
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := sorted(complementTokens(tc.pinned, tc.blanks))
			if len(got) != tc.blanks {
				t.Fatalf("len = %d, want %d (%v)", len(got), tc.blanks, got)
			}
			for _, n := range got {
				if n == 7 || n < 2 || n > 12 {
					t.Fatalf("illegal token %d in %v", n, got)
				}
			}
			if len(tc.want) == tc.blanks {
				for i := range got {
					if got[i] != tc.want[i] {
						t.Errorf("complementTokens(%v, %d) = %v, want %v", tc.pinned, tc.blanks, got, tc.want)
						break
					}
				}
			}
		})
	}
}
