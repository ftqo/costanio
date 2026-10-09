package board

import (
	"math"
	"sort"
)

// Issue is one advisory or structural problem found on a board. Severity is
// "error" (the board cannot or should not start as-is; the same conditions
// ValidateLayout rejects) or "warning" (a balance concern; still legal to
// start). Hexes names the offending tiles so the UI can highlight them. Codes
// are stable identifiers shared with the frontend. Debug is English reference
// wording for raw responses and operator logs; the client renders its own copy
// from Code (docs/user-facing-text.md).
type Issue struct {
	Severity string         `json:"severity"`
	Code     string         `json:"code"`
	Params   map[string]any `json:"params,omitempty"`
	Debug    string         `json:"debug"`
	Hexes    []Hex          `json:"hexes"`
}

const (
	sevError   = "error"
	sevWarning = "warning"
)

// Lint inspects a board and returns its problems: structural errors
// ValidateLayout would also reject, and balance warnings drawn from the fair
// generator's objectives (adjacent reds, touching duplicate numbers,
// per-resource pip imbalance, over-loaded spots, resource clumps). Output is
// sorted by code then hex, so equal boards lint identically. Advisory only.
func Lint(b *Board) []Issue {
	var out []Issue
	out = append(out, lintStructural(b)...)
	out = append(out, lintHarbors(b)...)
	out = append(out, lintAdjacentReds(b)...)
	out = append(out, lintAdjacentDuplicates(b)...)
	out = append(out, lintPipImbalance(b)...)
	out = append(out, lintBrokenSpots(b)...)
	out = append(out, lintResourceClumps(b)...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Code != out[j].Code {
			return out[i].Code < out[j].Code
		}
		return hexLess(firstHex(out[i].Hexes), firstHex(out[j].Hexes))
	})
	return out
}

func firstHex(h []Hex) Hex {
	if len(h) == 0 {
		return Hex{}
	}
	return h[0]
}

func hexLess(a, c Hex) bool {
	if a.Q != c.Q {
		return a.Q < c.Q
	}
	return a.R < c.R
}

func lintStructural(b *Board) []Issue {
	var out []Issue
	land, deserts, generic := 0, 0, 0
	for h, t := range b.Tiles {
		if t.Res != Sea && t.Res != Border {
			land++
		}
		switch t.Res {
		case ResNone:
			deserts++
		case ResLand:
			generic++
		default: // other resource types intentionally unhandled here
		}
		if !takesNumber(t.Res) && t.Number != 0 {
			out = append(out, Issue{Severity: sevError, Code: "number_on_nonproducing", Debug: "A non-producing tile has a number token.", Hexes: []Hex{h}})
		}
	}
	if land < 3 {
		out = append(out, Issue{Severity: sevError, Code: "few_land", Debug: "A map needs at least 3 land tiles.", Hexes: nil})
	}
	if deserts == 0 && generic == 0 {
		out = append(out, Issue{Severity: sevError, Code: "no_desert", Debug: "A map needs at least one desert for the robber to start on.", Hexes: nil})
	}
	if comps := landComponents(b); comps > 1 {
		out = append(out, Issue{Severity: sevWarning, Code: "disconnected", Debug: "The land is split into separate pieces; ships (Islands) are needed to connect them.", Hexes: nil})
	}
	return out
}

// lintHarbors mirrors validateHarbors as a UI-facing issue: two harbors whose
// docks stand on the same water hex. The hex is named so the builder can
// highlight the water. Reported once per hex.
func lintHarbors(b *Board) []Issue {
	var out []Issue
	seen := make(map[Hex]bool, len(b.Harbors))
	flagged := map[Hex]bool{}
	for _, h := range b.Harbors {
		sea, ok := b.HarborSeaHex(h)
		if !ok {
			continue
		}
		if seen[sea] && !flagged[sea] {
			flagged[sea] = true
			out = append(out, Issue{Severity: sevError, Code: "harbor_shared_hex", Debug: "Two harbors would put their docks on the same water hex.", Hexes: []Hex{sea}})
		}
		seen[sea] = true
	}
	return out
}

// landComponents counts connected groups of land tiles (4-resource, desert,
// gold, generic), joined by hex adjacency. Sea/Border do not connect.
func landComponents(b *Board) int {
	isLand := func(h Hex) bool {
		t, ok := b.Tiles[h]
		return ok && t.Res != Sea && t.Res != Border
	}
	seen := map[Hex]bool{}
	comps := 0
	for h := range b.Tiles {
		if !isLand(h) || seen[h] {
			continue
		}
		comps++
		stack := []Hex{h}
		seen[h] = true
		for len(stack) > 0 {
			cur := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, nb := range cur.Neighbors() {
				if isLand(nb) && !seen[nb] {
					seen[nb] = true
					stack = append(stack, nb)
				}
			}
		}
	}
	return comps
}

// adjacentNumberPairs returns the unordered neighboring tile pairs whose numbers
// satisfy f, each pair once (the smaller hex first).
func adjacentNumberPairs(b *Board, f func(n1, n2 int) bool) [][2]Hex {
	var out [][2]Hex
	for h, t := range b.Tiles {
		if t.Number == 0 {
			continue
		}
		for _, nb := range h.Neighbors() {
			nt, ok := b.Tiles[nb]
			if !ok || nt.Number == 0 {
				continue
			}
			if f(t.Number, nt.Number) && hexLess(h, nb) {
				out = append(out, [2]Hex{h, nb})
			}
		}
	}
	return out
}

func lintAdjacentReds(b *Board) []Issue {
	red := func(n int) bool { return n == 6 || n == 8 }
	var out []Issue
	for _, p := range adjacentNumberPairs(b, func(a, c int) bool { return red(a) && red(c) }) {
		out = append(out, Issue{Severity: sevWarning, Code: "adjacent_red", Debug: "Two high-probability numbers (6/8) are touching.", Hexes: []Hex{p[0], p[1]}})
	}
	return out
}

func lintAdjacentDuplicates(b *Board) []Issue {
	var out []Issue
	for _, p := range adjacentNumberPairs(b, func(a, c int) bool { return a == c }) {
		out = append(out, Issue{Severity: sevWarning, Code: "adjacent_duplicate", Debug: "Two tiles with the same number are touching.", Hexes: []Hex{p[0], p[1]}})
	}
	return out
}

func lintPipImbalance(b *Board) []Issue {
	var pipSum, count [6]int
	for _, t := range b.Tiles {
		if !t.Res.Producing() {
			continue
		}
		pipSum[t.Res] += pipValue(t.Number)
		count[t.Res]++
	}
	minAvg, maxAvg := math.Inf(1), math.Inf(-1)
	for _, r := range Resources {
		if count[r] == 0 {
			continue
		}
		avg := float64(pipSum[r]) / float64(count[r])
		minAvg = math.Min(minAvg, avg)
		maxAvg = math.Max(maxAvg, avg)
	}
	// Looser than fairPipBand: a hand-built map is flagged only when a resource is
	// clearly richer than the rest.
	if spread := maxAvg - minAvg; spread > 1.0 {
		return []Issue{{Severity: sevWarning, Code: "pip_imbalance",
			Debug: "Some resources are much richer than others."}}
	}
	return nil
}

// lintBrokenSpots reports the over-loaded settlement spots hotSpots scores: a
// vertex whose producing tiles together pay more pips than any spot on a
// balanced board would. Inland (three tiles) and coastal (two) are both checked.
func lintBrokenSpots(b *Board) []Issue {
	var out []Issue
	seen := map[Vertex]bool{}
	for h := range b.Tiles {
		for _, v := range h.Vertices() {
			if seen[v] {
				continue
			}
			seen[v] = true
			pips := 0
			var hexes []Hex
			for _, hh := range v.Hexes() {
				if t, ok := b.Tiles[hh]; ok && t.Res.Producing() {
					hexes = append(hexes, hh)
					pips += pipValue(t.Number)
				}
			}
			if (len(hexes) >= 3 && pips >= hotSpot3) || (len(hexes) == 2 && pips >= hotSpot2) {
				out = append(out, Issue{Severity: sevWarning, Code: "broken_spot", Debug: "A settlement spot collects more than its share of the board.", Hexes: hexes})
			}
		}
	}
	return out
}

// lintResourceClumps reports same-resource blocks larger than clumpMax, naming
// every hex in the block so the builder can highlight it.
func lintResourceClumps(b *Board) []Issue {
	var out []Issue
	seen := map[Hex]bool{}
	for _, h := range sortedHexes(b) {
		t := b.Tiles[h]
		if seen[h] || !t.Res.Producing() {
			continue
		}
		seen[h] = true
		stack, group := []Hex{h}, []Hex{h}
		for len(stack) > 0 {
			cur := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, nb := range cur.Neighbors() {
				if nt, ok := b.Tiles[nb]; ok && !seen[nb] && nt.Res == t.Res {
					seen[nb] = true
					stack = append(stack, nb)
					group = append(group, nb)
				}
			}
		}
		if len(group) > clumpMax {
			sort.Slice(group, func(i, j int) bool { return hexLess(group[i], group[j]) })
			out = append(out, Issue{Severity: sevWarning, Code: "resource_clump", Debug: "Several tiles of the same resource are bunched together.", Hexes: group})
		}
	}
	return out
}

// sortedHexes returns the board's hexes in a stable order, so lint output does
// not depend on map iteration order.
func sortedHexes(b *Board) []Hex {
	out := make([]Hex, 0, len(b.Tiles))
	for h := range b.Tiles {
		out = append(out, h)
	}
	sort.Slice(out, func(i, j int) bool { return hexLess(out[i], out[j]) })
	return out
}
