package board

import "encoding/json"

// boardJSON is the wire form: Tiles as a slice, since JSON object keys cannot
// be structs.
type boardJSON struct {
	Radius  int        `json:"radius"`
	Tiles   []tileJSON `json:"tiles"`
	Robber  Hex        `json:"robber"`
	Harbors []Harbor   `json:"harbors"`
}

type tileJSON struct {
	Hex Hex      `json:"hex"`
	Res Resource `json:"res"`
	Num int      `json:"num"`
}

func (b *Board) MarshalJSON() ([]byte, error) {
	out := boardJSON{Radius: b.Radius, Robber: b.Robber, Harbors: b.Harbors}
	for _, h := range HexesInRadius(b.Radius) {
		if t, ok := b.Tiles[h]; ok {
			out.Tiles = append(out.Tiles, tileJSON{Hex: h, Res: t.Res, Num: t.Number})
		}
	}
	return json.Marshal(out)
}

func (b *Board) UnmarshalJSON(data []byte) error {
	var in boardJSON
	if err := json.Unmarshal(data, &in); err != nil {
		return err
	}
	b.Radius = in.Radius
	b.Robber = in.Robber
	b.Harbors = in.Harbors
	b.Tiles = make(map[Hex]Tile, len(in.Tiles))
	for _, t := range in.Tiles {
		b.Tiles[t.Hex] = Tile{Res: t.Res, Number: t.Num}
	}
	return nil
}
