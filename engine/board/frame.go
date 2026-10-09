package board

import "sort"

// Frame computes a board's ocean from its land and replaces the tile map in
// place. It is pure and deterministic: the result depends only on which hexes
// are ground in b.Tiles, never on existing Sea tiles.
//
// Hexes fall into three categories:
//
//   - solid: any ground hex (land/desert/gold/lake/producing/Border). Sea is not
//     solid. These keep their original tile.
//   - ocean: Sea, always computed here and never read from input, so framing an
//     already-framed board is a no-op.
//   - absent: everything else, omitted from the resulting Tiles map, which is
//     what lets a board be non-hexagonal.
//
// The ocean is the convex hull of the land plus a one-hex coastal margin, which
// is gap-free and connected. A full hexagon of ground (every hex in
// HexesInRadius present and solid) is returned unchanged, protecting the
// standard maps.
func (b *Board) Frame() {
	solid := b.solidSet()

	// Skip standard maps: a full hexagon of ground at the current radius.
	if isFullHexagon(solid, b.Radius) {
		return
	}

	inside := hullInside(solid)
	margin := setDiff(dilate(inside, 1), inside)

	// Compose the new tile map: land keeps its tile; the hull interior and the
	// one-hex margin become Sea; everything else is absent.
	newTiles := make(map[Hex]Tile, len(inside)+len(margin))
	for h := range solid {
		newTiles[h] = b.Tiles[h] // keep the original tile (resource + number)
	}
	for h := range inside {
		if _, isSolid := solid[h]; isSolid {
			continue
		}
		newTiles[h] = Tile{Res: Sea}
	}
	for h := range margin {
		if _, isSolid := solid[h]; isSolid {
			continue // solid wins; never overwrite ground with sea
		}
		newTiles[h] = Tile{Res: Sea}
	}

	// Plug any absent hex the land+ocean footprint encloses (e.g. a thin notch
	// beside a rasterized hull edge) so the sea has no holes.
	fillEnclosed(newTiles)

	// Guarantee one connected body: a thin hull (even a near-collinear triangle)
	// can fragment despite the fill. Bridge leftover components with sea, then
	// re-plug. Usually a no-op.
	connectComponents(newTiles)
	fillEnclosed(newTiles)

	b.Radius = max(extent(newTiles), 1)
	b.Tiles = newTiles

	// Relocate the robber if it fell off the board or onto a sea tile.
	if tl, ok := newTiles[b.Robber]; !ok || tl.Res == Sea {
		b.Robber = firstGroundHex(newTiles)
	}
}

// cross2 returns twice the signed area of triangle o→a→b in doubled axial
// coordinates (X=2q+r, Y=r). Hex centres sit at (X/2, Y·√3/2); the positive √3/2
// factor drops out, so the sign of this integer expression is the exact
// orientation. Positive = counter-clockwise, zero = collinear.
func cross2(o, a, b Hex) int {
	ox, oy := 2*o.Q+o.R, o.R
	ax, ay := 2*a.Q+a.R, a.R
	bx, by := 2*b.Q+b.R, b.R
	return (ax-ox)*(by-oy) - (ay-oy)*(bx-ox)
}

// convexHull returns the convex hull of the land hex centers via Andrew's
// monotone chain in doubled coords. The `<= 0` pop drops collinear points, so
// the result is strictly convex; collinear or <3-point input yields the ≤2
// extreme points (handled as a degenerate segment by the fill).
func convexHull(solid map[Hex]struct{}) []Hex {
	pts := make([]Hex, 0, len(solid))
	for h := range solid {
		pts = append(pts, h)
	}
	sort.Slice(pts, func(i, j int) bool {
		xi, xj := 2*pts[i].Q+pts[i].R, 2*pts[j].Q+pts[j].R
		if xi != xj {
			return xi < xj
		}
		return pts[i].R < pts[j].R
	})
	if len(pts) < 3 {
		return pts
	}
	var hull []Hex
	for _, p := range pts { // lower chain
		for len(hull) >= 2 && cross2(hull[len(hull)-2], hull[len(hull)-1], p) <= 0 {
			hull = hull[:len(hull)-1]
		}
		hull = append(hull, p)
	}
	lower := len(hull) + 1
	for i := len(pts) - 2; i >= 0; i-- { // upper chain
		p := pts[i]
		for len(hull) >= lower && cross2(hull[len(hull)-2], hull[len(hull)-1], p) <= 0 {
			hull = hull[:len(hull)-1]
		}
		hull = append(hull, p)
	}
	return hull[:len(hull)-1] // drop the duplicated start point
}

// hexDist is the cube distance between two hexes.
func hexDist(a, b Hex) int {
	return (abs(a.Q-b.Q) + abs(a.R-b.R) + abs(a.Q+a.R-b.Q-b.R)) / 2
}

// hexLine returns a connected chain of hexes from a to b (each consecutive pair
// adjacent). It steps greedily toward b, breaking ties by (Q,R) for
// determinism, and terminates in hexDist(a,b) steps. Used to rasterize the hull
// outline so a hull too thin to enclose anything still frames as one region.
func hexLine(a, b Hex) []Hex {
	out := []Hex{a}
	for cur := a; cur != b; {
		best := cur
		bestD := 1 << 30
		for _, n := range cur.Neighbors() {
			d := hexDist(n, b)
			if d < bestD || (d == bestD && (n.Q < best.Q || (n.Q == best.Q && n.R < best.R))) {
				best, bestD = n, d
			}
		}
		cur = best
		out = append(out, cur)
	}
	return out
}

func floorDiv(n, d int) int { // d > 0
	if n >= 0 {
		return n / d
	}
	return -((-n + d - 1) / d)
}

func ceilDiv(n, d int) int { // d > 0
	if n >= 0 {
		return (n + d - 1) / d
	}
	return -((-n) / d)
}

// scanlineFill returns every hex inside the convex hull, filling each row's
// span between the hull's left and right edges. In doubled coords a hex (q,r)
// sits at X=2q+r on row Y=r (so X≡r mod 2). For each row the hull meets one
// X-interval [xlo,xhi] (rational, where the edges cross Y=r) and every hex whose
// centre lies in it is filled. Rows are contiguous and overlap, so the result is
// solid and connected. Requires a hull with area (≥3 non-collinear vertices);
// the caller handles degenerate hulls.
func scanlineFill(hull []Hex) map[Hex]struct{} {
	out := map[Hex]struct{}{}
	xOf := func(h Hex) int { return 2*h.Q + h.R }
	minR, maxR := hull[0].R, hull[0].R
	for _, h := range hull {
		minR = min(minR, h.R)
		maxR = max(maxR, h.R)
	}
	n := len(hull)
	for r := minR; r <= maxR; r++ {
		// Row X-interval as rationals loN/loD .. hiN/hiD with loD,hiD > 0.
		have := false
		var loN, loD, hiN, hiD int
		consider := func(xn, xd int) {
			if xd < 0 {
				xn, xd = -xn, -xd
			}
			if !have {
				loN, loD, hiN, hiD, have = xn, xd, xn, xd, true
				return
			}
			if xn*loD < loN*xd {
				loN, loD = xn, xd
			}
			if xn*hiD > hiN*xd {
				hiN, hiD = xn, xd
			}
		}
		for i := range n {
			a, b := hull[i], hull[(i+1)%n]
			if a.R == b.R { // horizontal edge: both ends bound this row
				if a.R == r {
					consider(xOf(a), 1)
					consider(xOf(b), 1)
				}
				continue
			}
			if r < min(a.R, b.R) || r > max(a.R, b.R) {
				continue
			}
			// X where edge a→b crosses Y=r, as a rational num/den.
			consider(xOf(a)*(b.R-a.R)+(xOf(b)-xOf(a))*(r-a.R), b.R-a.R)
		}
		if !have {
			continue
		}
		for x := ceilDiv(loN, loD); x <= floorDiv(hiN, hiD); x++ {
			if (x-r)&1 != 0 { // X must share r's parity to be a real hex center
				continue
			}
			out[Hex{Q: (x - r) / 2, R: r}] = struct{}{}
		}
	}
	return out
}

// hullInside returns the land plus the solid interior of its convex hull. A
// hull with area (≥3 vertices; the monotone chain drops collinear points) is
// filled by scanlineFill, and its edges are rasterized as hex lines so a sliver
// too thin for any scanline row stays connected. A degenerate hull (a point or
// a line) just joins its two extreme vertices with a hex line. Gaps beside a
// rasterized edge are healed by Frame's enclosed-fill.
func hullInside(solid map[Hex]struct{}) map[Hex]struct{} {
	out := make(map[Hex]struct{}, len(solid))
	for h := range solid {
		out[h] = struct{}{}
	}
	hull := convexHull(solid)
	if len(hull) >= 3 {
		for h := range scanlineFill(hull) {
			out[h] = struct{}{}
		}
		n := len(hull)
		for i := range n {
			for _, h := range hexLine(hull[i], hull[(i+1)%n]) {
				out[h] = struct{}{}
			}
		}
		return out
	}
	// Degenerate hull: the land is collinear (or one hex). Connect the land hexes
	// in order along the line; joining only the two extremes could zig-zag past a
	// middle hex and strand it.
	pts := make([]Hex, 0, len(solid))
	for h := range solid {
		pts = append(pts, h)
	}
	sort.Slice(pts, func(i, j int) bool {
		xi, xj := 2*pts[i].Q+pts[i].R, 2*pts[j].Q+pts[j].R
		if xi != xj {
			return xi < xj
		}
		return pts[i].R < pts[j].R
	})
	for i := 1; i < len(pts); i++ {
		for _, h := range hexLine(pts[i-1], pts[i]) {
			out[h] = struct{}{}
		}
	}
	return out
}

// connectComponents bridges every connected component of the tile footprint
// into one with sea, joining the two closest hexes of two components with a
// hex line of Sea until one remains. It roots at the component holding the
// lexicographically smallest hex and picks the smallest closest pair, so the
// result never depends on map iteration order.
func connectComponents(tiles map[Hex]Tile) {
	for {
		comps := tileComponents(tiles)
		if len(comps) <= 1 {
			return
		}
		// Root = the component holding the lexicographically smallest hex.
		rootIdx := 0
		for i := range comps {
			if lessHex(minHex(comps[i]), minHex(comps[rootIdx])) {
				rootIdx = i
			}
		}
		// Bridge the closest (root hex, other-component hex) pair, ties broken
		// lexicographically so the framed board does not depend on map order (replay
		// must equal live).
		var ra, rb Hex
		best := 1 << 30
		found := false
		for i, c := range comps {
			if i == rootIdx {
				continue
			}
			for _, h := range c {
				for _, g := range comps[rootIdx] {
					d := hexDist(h, g)
					tie := d == best && (lessHex(g, ra) || (g == ra && lessHex(h, rb)))
					if !found || d < best || tie {
						best, ra, rb, found = d, g, h, true
					}
				}
			}
		}
		for _, h := range hexLine(ra, rb) {
			if _, ok := tiles[h]; !ok {
				tiles[h] = Tile{Res: Sea}
			}
		}
	}
}

// lessHex orders hexes lexicographically by (Q, R).
func lessHex(a, b Hex) bool { return a.Q < b.Q || (a.Q == b.Q && a.R < b.R) }

func minHex(hs []Hex) Hex {
	m := hs[0]
	for _, h := range hs[1:] {
		if lessHex(h, m) {
			m = h
		}
	}
	return m
}

// tileComponents returns the connected components (6-neighbor) of the tile
// footprint. Component contents are deterministic; their order is not.
func tileComponents(tiles map[Hex]Tile) [][]Hex {
	seen := map[Hex]bool{}
	var comps [][]Hex
	for start := range tiles {
		if seen[start] {
			continue
		}
		var comp []Hex
		stack := []Hex{start}
		seen[start] = true
		for len(stack) > 0 {
			cur := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			comp = append(comp, cur)
			for _, nb := range cur.Neighbors() {
				if _, ok := tiles[nb]; ok && !seen[nb] {
					seen[nb] = true
					stack = append(stack, nb)
				}
			}
		}
		comps = append(comps, comp)
	}
	return comps
}

// fillEnclosed adds every absent hex the tile footprint encloses. It
// flood-fills the exterior through absent hexes from the ring just past the
// footprint's extent; any in-range absent hex the flood cannot reach becomes
// Sea. The coastal margin is a complete ring around land and ocean, so the
// flood cannot reach a sealed interior. This plugs the thin notches edge
// rasterization leaves.
func fillEnclosed(tiles map[Hex]Tile) {
	present := func(h Hex) bool { _, ok := tiles[h]; return ok }
	limit := 0
	for h := range tiles {
		if d := cubeDistOrigin(h); d > limit {
			limit = d
		}
	}
	limit++

	exterior := map[Hex]struct{}{}
	var queue []Hex
	for _, h := range HexesInRadius(limit) {
		if cubeDistOrigin(h) == limit && !present(h) {
			exterior[h] = struct{}{}
			queue = append(queue, h)
		}
	}
	for len(queue) > 0 {
		cur := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		for _, nb := range cur.Neighbors() {
			if cubeDistOrigin(nb) > limit || present(nb) {
				continue
			}
			if _, seen := exterior[nb]; seen {
				continue
			}
			exterior[nb] = struct{}{}
			queue = append(queue, nb)
		}
	}
	for _, h := range HexesInRadius(limit - 1) {
		if present(h) {
			continue
		}
		if _, ext := exterior[h]; !ext {
			tiles[h] = Tile{Res: Sea} // enclosed
		}
	}
}

// isGround reports whether a resource is part of the land silhouette. Sea is not
// ground; absent hexes (not in the map) are not ground either.
func isGround(r Resource) bool {
	switch r {
	case ResLand, Wood, Brick, Sheep, Wheat, Ore, Gold, Lake, ResNone, Border:
		return true
	default: // Sea, Fog, and any unused value
		return false
	}
}

// solidSet returns the set of ground hexes currently in b.Tiles.
func (b *Board) solidSet() map[Hex]struct{} {
	out := make(map[Hex]struct{}, len(b.Tiles))
	for h, t := range b.Tiles {
		if isGround(t.Res) {
			out[h] = struct{}{}
		}
	}
	return out
}

// isFullHexagon reports whether solid is exactly HexesInRadius(radius): every
// hex of the radius-r hexagon is present and ground, with none missing.
func isFullHexagon(solid map[Hex]struct{}, radius int) bool {
	full := HexesInRadius(radius)
	if len(solid) != len(full) {
		return false
	}
	for _, h := range full {
		if _, ok := solid[h]; !ok {
			return false
		}
	}
	return true
}

// dilate returns the union over h∈s of { h + d : d ∈ HexesInRadius(k) }: every
// hex within cube-distance k of a member.
func dilate(s map[Hex]struct{}, k int) map[Hex]struct{} {
	deltas := HexesInRadius(k)
	out := make(map[Hex]struct{}, len(s))
	for h := range s {
		for _, d := range deltas {
			out[Hex{Q: h.Q + d.Q, R: h.R + d.R}] = struct{}{}
		}
	}
	return out
}

// setDiff returns a \ b.
func setDiff(a, b map[Hex]struct{}) map[Hex]struct{} {
	out := make(map[Hex]struct{}, len(a))
	for h := range a {
		if _, ok := b[h]; !ok {
			out[h] = struct{}{}
		}
	}
	return out
}

func cubeDistOrigin(h Hex) int { return max(abs(h.Q), abs(h.R), abs(h.Q+h.R)) }

// extent returns the max cube-distance of any tile hex from the origin.
func extent(tiles map[Hex]Tile) int {
	m := 0
	for h := range tiles {
		if d := cubeDistOrigin(h); d > m {
			m = d
		}
	}
	return m
}

// firstGroundHex returns the ground tile with the smallest (Q,R), a
// deterministic landing spot for a relocated robber.
func firstGroundHex(tiles map[Hex]Tile) Hex {
	first := true
	var best Hex
	for h, t := range tiles {
		if t.Res == Sea {
			continue
		}
		if first || h.Q < best.Q || (h.Q == best.Q && h.R < best.R) {
			best = h
			first = false
		}
	}
	return best
}
