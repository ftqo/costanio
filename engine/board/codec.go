package board

import (
	"encoding/base64"
	"errors"
	"strings"
)

// codecVersion is emitted for a harborless board (the common shape map).
// codecVersionHarbors is emitted only when a board carries harbors, which are
// appended after the per-hex bytes. Both decode; bump these (and add a branch)
// if a byte layout changes, so old codes are rejected rather than misread.
const (
	codecVersion        = 1
	codecVersionHarbors = 2

	// maxCodecHarbors caps the decoded harbor-count varint. It exceeds any
	// coastline a valid board can have (ValidateLayout caps tiles at 300) while
	// bounding allocation for hostile codes.
	maxCodecHarbors = 1024

	// codecAbsent is a reserved resource-nibble value (12) meaning the hex is
	// absent from the sparse Tiles map. Resources stop at Border (11), so old dense
	// codes never emitted 12 and no version bump was needed. Encode writes
	// codecAbsent<<4 for any hex of HexesInRadius missing from Tiles; Decode skips
	// such bytes. This keeps desert (ResNone=0, present) distinct from absent,
	// which framing relies on for non-hexagon boards.
	codecAbsent = 12
)

var errBadCode = errors.New("board: not a valid map code")

// EncodeBoard packs a board into a short, URL-safe code: a version byte, the
// radius, the robber hex, then one byte per hex (resource nibble | number
// nibble) in canonical hex order. A board with harbors is version 2, which
// appends a harbor count and one record per harbor (two vertices, ratio,
// resource); a harborless board stays version 1, since harbors are otherwise
// regenerated at game start.
func EncodeBoard(b *Board) string {
	ver := byte(codecVersion)
	if len(b.Harbors) > 0 {
		ver = codecVersionHarbors
	}
	buf := make([]byte, 0, 6+len(b.Tiles)+len(b.Harbors)*8)
	buf = append(buf, ver, byte(b.Radius))
	buf = appendVarint(buf, zigzag(b.Robber.Q))
	buf = appendVarint(buf, zigzag(b.Robber.R))
	for _, h := range HexesInRadius(b.Radius) {
		t, ok := b.Tiles[h]
		if !ok {
			buf = append(buf, byte(codecAbsent)<<4) // hex absent from the sparse map
			continue
		}
		buf = append(buf, uint8(t.Res)&0x0f<<4|uint8(t.Number)&0x0f)
	}
	if ver == codecVersionHarbors {
		buf = appendVarint(buf, uint64(len(b.Harbors)))
		for _, hb := range b.Harbors {
			buf = appendVertex(buf, hb.Verts[0])
			buf = appendVertex(buf, hb.Verts[1])
			buf = append(buf, byte(hb.Ratio), byte(hb.Res))
		}
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// DecodeBoard reverses EncodeBoard. The returned board still needs
// ValidateLayout / ValidateMap before a game uses it.
func DecodeBoard(code string) (*Board, error) {
	buf, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(code))
	if err != nil || len(buf) < 2 {
		return nil, errBadCode
	}
	ver := buf[0]
	if ver != codecVersion && ver != codecVersionHarbors {
		return nil, errBadCode
	}
	radius := int(buf[1])
	// Accept any radius the builder can produce (ValidateLayout allows 1..16);
	// the decoded board is re-validated by ValidateLayout/ValidateMap before use.
	if radius < 1 || radius > 16 {
		return nil, errBadCode
	}
	p := 2
	rq, n := readVarint(buf[p:])
	if n == 0 {
		return nil, errBadCode
	}
	p += n
	rr, n := readVarint(buf[p:])
	if n == 0 {
		return nil, errBadCode
	}
	p += n
	hexes := HexesInRadius(radius)
	if len(buf)-p < len(hexes) {
		return nil, errBadCode
	}
	tiles := make(map[Hex]Tile, len(hexes))
	for i, h := range hexes {
		bv := buf[p+i]
		if bv>>4 == codecAbsent { // absent hex: skip, leave out of the sparse map
			continue
		}
		tiles[h] = Tile{Res: Resource(bv >> 4), Number: int(bv & 0x0f)}
	}
	p += len(hexes)
	out := &Board{Radius: radius, Tiles: tiles, Robber: Hex{Q: unzigzag(rq), R: unzigzag(rr)}}
	if ver == codecVersionHarbors {
		count, n := readVarint(buf[p:])
		if n == 0 || count > maxCodecHarbors {
			return nil, errBadCode
		}
		p += n
		out.Harbors = make([]Harbor, 0, count)
		for range count {
			v0, n0 := readVertex(buf[p:])
			if n0 == 0 {
				return nil, errBadCode
			}
			p += n0
			v1, n1 := readVertex(buf[p:])
			if n1 == 0 {
				return nil, errBadCode
			}
			p += n1
			if len(buf)-p < 2 {
				return nil, errBadCode
			}
			out.Harbors = append(out.Harbors, Harbor{
				Verts: [2]Vertex{v0, v1},
				Ratio: int(buf[p]),
				Res:   Resource(buf[p+1]),
			})
			p += 2
		}
	}
	return out, nil
}

// appendVertex / readVertex pack a Vertex as zigzag-varint Q, R and a single
// side byte.
func appendVertex(buf []byte, v Vertex) []byte {
	buf = appendVarint(buf, zigzag(v.Q))
	buf = appendVarint(buf, zigzag(v.R))
	return append(buf, byte(v.Side))
}

func readVertex(buf []byte) (v Vertex, n int) {
	q, n0 := readVarint(buf)
	if n0 == 0 {
		return Vertex{}, 0
	}
	r, n1 := readVarint(buf[n0:])
	if n1 == 0 {
		return Vertex{}, 0
	}
	p := n0 + n1
	if p >= len(buf) {
		return Vertex{}, 0
	}
	side := buf[p]
	if side > uint8(S) {
		return Vertex{}, 0
	}
	return Vertex{Q: unzigzag(q), R: unzigzag(r), Side: Side(side)}, p + 1
}

func zigzag(n int) uint64   { return uint64((int64(n) << 1) ^ (int64(n) >> 63)) }
func unzigzag(u uint64) int { return int(int64(u>>1) ^ -int64(u&1)) }

func appendVarint(buf []byte, u uint64) []byte {
	for u >= 0x80 {
		buf = append(buf, byte(u)|0x80)
		u >>= 7
	}
	return append(buf, byte(u))
}

func readVarint(buf []byte) (u uint64, n int) {
	var s uint
	for i, b := range buf {
		if b < 0x80 {
			return u | uint64(b)<<s, i + 1
		}
		u |= uint64(b&0x7f) << s
		if s += 7; s >= 64 {
			return 0, 0
		}
	}
	return 0, 0
}
