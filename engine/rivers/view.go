package rivers

import (
	"slices"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// RiverView is one watercourse as a client draws it: which hex carries which
// tile, and which way round.
//
// The engine decides the shape (straight or bend) and which two edges its mouths
// sit on, since that comes from the chain and decides where bridges may stand.
// Which file holds the shape and what yaw puts its mouths on those edges is art,
// known only to the renderer (frontend/src/lib/board3d/layers/rivers.ts; see the
// Rivers section of art/README.md).
type RiverView struct {
	// Hexes is the chain in order.
	Hexes []board.Hex `json:"hexes"`
	// Mouth is the index in Hexes of the swamp.
	Mouth int `json:"mouth"`
	// In and Out are each hex's two channel edges, parallel to Hexes.
	In  []board.Edge `json:"in"`
	Out []board.Edge `json:"out"`
	// Shapes is which channel each hex draws, parallel to Hexes: one of the nine
	// two-mouth ids (`e_w`, `ne_sw`, `nw_se`, `ne_w`, `e_nw`, `e_sw`, `w_se`,
	// `ne_se`, `nw_sw`), one of the six headwater ids (`src_e` .. `src_se`), or
	// "" for a pair no tile has.
	//
	// Derivable from In and Out, but published so the client does not redo the
	// axial-to-direction mapping, which mirrors the board silently when reversed.
	// See ChannelShape.
	Shapes []Shape `json:"shapes"`
	// Sites is every bridge site of this river, in chain order.
	Sites []board.Edge `json:"sites"`
	// Variants is which authored meander of its shape each hex draws, parallel
	// to Hexes. Only `e_w` has more than one; see rivers.EWVariants. Published
	// rather than hashed client-side so it stays inside the fairness audit.
	Variants []int `json:"variants"`
}

// BridgeView is one built bridge.
type BridgeView struct {
	Player engine.PlayerID `json:"player"`
	E      board.Edge      `json:"e"`
}

// ExtView is what a client is handed. Nothing is redacted (coins and chains
// are public, and the module has no hidden state), so ViewExt ignores its viewer.
type ExtView struct {
	Rivers []RiverView `json:"rivers"`
	// Sites is every bridge site on the board, flat: redundant with the
	// per-river lists, but it is the set a road renderer tests an edge against.
	Sites   []board.Edge `json:"sites"`
	Bridges []BridgeView `json:"bridges"`
	// Coins, BridgesLeft and Poorest are per seat, indexed by seat number.
	Coins       []int  `json:"coins"`
	BridgesLeft []int  `json:"bridges_left"`
	Poorest     []bool `json:"poorest"`
	// Wealthiest is the seat holding the +1 tile, or -1 when a tie means
	// nobody does.
	Wealthiest engine.PlayerID `json:"wealthiest"`
	// PoorestInPlay is false alongside Wagons and Raiders, which drop the -2
	// tile entirely. Published so the seat rail can hide the row rather than
	// draw an award nobody in this game can hold.
	PoorestInPlay bool `json:"poorest_in_play"`
	// BridgeSupply and BridgeCost are rules constants, published so a client
	// can draw "2 of 3 built" and price the button without hardcoding them.
	BridgeSupply int         `json:"bridge_supply"`
	BridgeCost   engine.Hand `json:"bridge_cost"`
	CoinPerRes   int         `json:"coin_per_res"`
	SpendsLeft   int         `json:"spends_left"`
	WealthiestVP int         `json:"wealthiest_vp"`
	PoorestVP    int         `json:"poorest_vp"`
}

// ViewExt builds the per-viewer view.
//
// Every reference field is copied: the view is built on the actor goroutine
// and serialised later on a connection goroutine while the actor keeps folding
// into the same ext. A shared slice is a data race and a shared map can crash
// the process. See engine.Viewable.
func (x *Ext) ViewExt(viewer engine.PlayerID) any {
	v := &ExtView{
		Rivers:       make([]RiverView, 0, len(x.Rivers)),
		Sites:        []board.Edge{},
		Bridges:      []BridgeView{},
		Coins:        slices.Clone(x.Coins),
		BridgesLeft:  slices.Clone(x.BridgesLeft),
		Poorest:      slices.Clone(x.Poorest),
		Wealthiest:   x.Wealthiest,
		BridgeSupply: BridgeSupply,
		BridgeCost:   CostBridge,
		CoinPerRes:   CoinsPerResource,
		SpendsLeft:   max(0, SpendsPerTurn-x.SpentThisTurn),
		WealthiestVP: WealthiestVP,
		PoorestVP:    PoorestVP,
	}
	// PoorestInPlay comes from the derived tiles, since ViewExt has no
	// ruleset: with the tile off every flag is false, and with it on
	// someone always holds the fewest.
	for _, p := range x.Poorest {
		if p {
			v.PoorestInPlay = true
			break
		}
	}
	for _, r := range x.Rivers {
		shapes := make([]Shape, len(r.Hexes))
		for i, h := range r.Hexes {
			shapes[i] = ChannelShape(h, r.In[i], r.Out[i])
		}
		variants := slices.Clone(r.Variants)
		if variants == nil {
			// A layout recorded before the field existed, or an authored map
			// folded through POST /api/replay/frames without it: every hex
			// draws variant 0.
			variants = make([]int, len(r.Hexes))
		}
		v.Rivers = append(v.Rivers, RiverView{
			Hexes:    slices.Clone(r.Hexes),
			Mouth:    r.Mouth,
			In:       slices.Clone(r.In),
			Out:      slices.Clone(r.Out),
			Shapes:   shapes,
			Sites:    slices.Clone(r.Sites),
			Variants: variants,
		})
		v.Sites = append(v.Sites, r.Sites...)
	}
	for e, owner := range x.Bridges {
		v.Bridges = append(v.Bridges, BridgeView{Player: owner, E: e})
	}
	// Sorted so the order is stable across frames and a diffing client
	// does not redraw every bridge.
	sort.Slice(v.Bridges, func(i, j int) bool {
		a, b := v.Bridges[i].E, v.Bridges[j].E
		if a.A != b.A {
			return vertexLess(a.A, b.A)
		}
		return vertexLess(a.B, b.B)
	})
	return v
}
