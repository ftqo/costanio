// Package cosmetics is the presentational-cosmetics layer: a static catalog, the
// per-user ownership/loadout, supporter gating, and the color palette + perceptual
// distinctness check. engine/ and bot/ never import it, and game/ uses it only
// for seat colors and robber skins; cosmetics never reach the rules. See
// docs/cosmetics.md.
package cosmetics

import "errors"

// Slot is an equip slot. Each user equips at most one item per slot.
type Slot string

const (
	SlotDice       Slot = "dice"
	SlotPieces     Slot = "pieces"
	SlotBoard      Slot = "board"
	SlotColor      Slot = "color"
	SlotDecoration Slot = "decoration"
	// SlotRobber is the robber's model. The robber belongs to nobody, so it is
	// drawn in the skin of whoever most recently moved it (game/actor.go).
	SlotRobber Slot = "robber"
)

// Item is a catalog entry. The catalog is code (compiled in); ownership is data
// (the entitlements table). Item.ID is "<slot>.<name>", which is also its asset
// key in docs/cosmetics-assets.md.
type Item struct {
	ID    string `json:"id"`
	Slot  Slot   `json:"slot"`
	Name  string `json:"name"`
	Price int    `json:"price"` // Pips; 0 = not Pip-purchasable
	// Supporter-exclusive: not bought with Pips; owned only while supporter
	// status is active (the rotating set in monetization.md §4).
	Supporter bool `json:"supporter"`
	// Booster-exclusive: not bought with Pips; owned only while the user is
	// *currently boosting* the server (a narrower gate than Supporter).
	Booster bool `json:"booster"`
	// Kofi: gated on holding the Ko-fi role (the green decoration).
	Kofi bool `json:"kofi"`
	// Staff: gated on holding the staff role.
	Staff bool `json:"staff"`
	// Gift: gated on holding the gift role (`/gift @user`).
	//
	// Staff and Gift cannot be earned, so the store shows them as unavailable.
	Gift bool `json:"gift"`
	// Reserved: the id and price exist but the art does not (deferred to v2), so
	// it equips as nothing. A reserved item is Locked in the catalog view and
	// refused by Purchase (Purchase is reachable by API even when the store UI
	// hides the item). Clear the flag when the art and store section ship.
	Reserved bool `json:"reserved"`
}

// Catalog is the full set of cosmetic items: the name decorations, the robber
// skins, reserved ids for the art-heavy v2 slots, and one row per palette color
// on the shelf (generated from the palette; see cosmetics/color.go).
var Catalog = append(append([]Item{}, staticCatalog...), colorItems()...)

// colorItems is the shelf's slice of the palette as catalog rows, so a color is
// bought through the same path as any item: Purchase grants the "color.xxxxxx"
// entitlement that equipColor and UseColor check.
func colorItems() []Item {
	out := make([]Item, 0, len(shopColors))
	for _, hex := range shopColors {
		out = append(out, Item{
			ID:    colorID(hex),
			Slot:  SlotColor,
			Name:  cubeNames[hex],
			Price: ColorPrice,
		})
	}
	return out
}

var staticCatalog = []Item{
	// Name decorations (animated sparkle behind the username), one per support
	// method. Never Pip-purchasable. Booster = pink (gated on boosting), Supporter
	// = blue (any active Discord supporter). Ko-fi = green, granted via entitlement
	// only (no automatic Ko-fi signal yet).
	{ID: "decoration.booster", Slot: SlotDecoration, Name: "Booster", Price: 0, Booster: true},
	{ID: "decoration.supporter", Slot: SlotDecoration, Name: "Supporter", Price: 0, Supporter: true},
	{ID: "decoration.kofi", Slot: SlotDecoration, Name: "Ko-fi", Price: 0, Kofi: true},
	{ID: "decoration.staff", Slot: SlotDecoration, Name: "Staff", Price: 0, Staff: true},

	// The effects. All for sale except the monochrome fires (black, grey,
	// white), which belong to the gift role. Fires cost twice the sparkles.
	{ID: "decoration.fire_black", Slot: SlotDecoration, Name: "Black Fire", Price: 0, Gift: true},
	{ID: "decoration.fire_blue", Slot: SlotDecoration, Name: "Blue Fire", Price: 5000},
	{ID: "decoration.fire_green", Slot: SlotDecoration, Name: "Green Fire", Price: 5000},
	{ID: "decoration.fire_grey", Slot: SlotDecoration, Name: "Grey Fire", Price: 0, Gift: true},
	{ID: "decoration.fire_lime", Slot: SlotDecoration, Name: "Lime Fire", Price: 5000},
	{ID: "decoration.fire_orange", Slot: SlotDecoration, Name: "Orange Fire", Price: 5000},
	{ID: "decoration.fire_purple", Slot: SlotDecoration, Name: "Purple Fire", Price: 5000},
	{ID: "decoration.fire_teal", Slot: SlotDecoration, Name: "Teal Fire", Price: 5000},
	{ID: "decoration.fire_white", Slot: SlotDecoration, Name: "White Fire", Price: 0, Gift: true},
	{ID: "decoration.sparkle_blue_light", Slot: SlotDecoration, Name: "Blue Light Sparkle", Price: 2500},
	{ID: "decoration.sparkle_brown", Slot: SlotDecoration, Name: "Brown Sparkle", Price: 2500},
	{ID: "decoration.sparkle_green", Slot: SlotDecoration, Name: "Green Sparkle", Price: 2500},
	{ID: "decoration.sparkle_green_light", Slot: SlotDecoration, Name: "Green Light Sparkle", Price: 2500},
	{ID: "decoration.sparkle_grey", Slot: SlotDecoration, Name: "Grey Sparkle", Price: 2500},
	{ID: "decoration.sparkle_lime", Slot: SlotDecoration, Name: "Lime Sparkle", Price: 2500},
	{ID: "decoration.sparkle_orange", Slot: SlotDecoration, Name: "Orange Sparkle", Price: 2500},
	{ID: "decoration.sparkle_purple", Slot: SlotDecoration, Name: "Purple Sparkle", Price: 2500},
	{ID: "decoration.sparkle_red", Slot: SlotDecoration, Name: "Red Sparkle", Price: 2500},
	{ID: "decoration.sparkle_teal", Slot: SlotDecoration, Name: "Teal Sparkle", Price: 2500},
	{ID: "decoration.sparkle_white", Slot: SlotDecoration, Name: "White Sparkle", Price: 2500},
	{ID: "decoration.sparkle_yellow_light", Slot: SlotDecoration, Name: "Yellow Light Sparkle", Price: 2500},

	// Robber skins, built from the lathe profiles in
	// tools/blender/robber_designs.py by tools/robbers/export_skins.py.
	//
	// The brigand and sentinel are entry-priced (about a fortnight of casual
	// play); the rest cost three to five times that.
	//
	// Adding one needs a row here, an entry in frontend/src/lib/robbers.ts, the
	// glb, and the baked store tile (checked by the frontend's robbers.assets
	// test).
	// Brigand: free for staff, 350 for everyone else.
	{ID: "robber.brigand", Slot: SlotRobber, Name: "Brigand", Price: 350, Staff: true},
	{ID: "robber.sentinel", Slot: SlotRobber, Name: "Sentinel", Price: 400},
	// Not for sale: any of the three support routes (supporter, boost, Ko-fi)
	// grants the keg, and it reverts when the last one lapses.
	{ID: "robber.keg", Slot: SlotRobber, Name: "Keg", Price: 0, Supporter: true, Booster: true, Kofi: true},
	{ID: "robber.crow", Slot: SlotRobber, Name: "Crow", Price: 1200},
	{ID: "robber.hourglass", Slot: SlotRobber, Name: "Hourglass", Price: 1600},
	{ID: "robber.brazier", Slot: SlotRobber, Name: "Brazier", Price: 1800},
	{ID: "robber.shard", Slot: SlotRobber, Name: "Crystal", Price: 2400},
	// Chromas: the same crystal in another colourway, same price, bought
	// independently of the base design. A chroma is three colors applied to the
	// design's own model (frontend/src/lib/robbers.ts), so it needs no download.
	{ID: "robber.shard.verdant", Slot: SlotRobber, Name: "Crystal Verdant", Price: 2400},
	{ID: "robber.shard.rose", Slot: SlotRobber, Name: "Crystal Rose", Price: 2400},

	// Art-heavy, v2 (assets deferred in the manifest). Reserved; the prices are
	// the intended v2 numbers.
	{ID: "dice.bone", Slot: SlotDice, Name: "Bone Dice", Price: 300, Reserved: true},
	{ID: "dice.gem", Slot: SlotDice, Name: "Gem Dice", Price: 500, Reserved: true},
	{ID: "pieces.driftwood", Slot: SlotPieces, Name: "Driftwood Set", Price: 600, Reserved: true},
	{ID: "pieces.obsidian", Slot: SlotPieces, Name: "Obsidian Set", Price: 800, Reserved: true},
	{ID: "board.parchment", Slot: SlotBoard, Name: "Parchment", Price: 600, Reserved: true},
	{ID: "board.aurora", Slot: SlotBoard, Name: "Aurora Board", Price: 1000, Reserved: true},

	// art/pieces/cyclades.blend ships frontend/public/models/pieces/cyclades.glb,
	// a drop-in for pieces.glb: same node names (City_A_*, Settlement_A_*,
	// Road_*) and the same three Seat_ materials, so it tints per seat.
	{ID: "pieces.cyclades", Slot: SlotPieces, Name: "Cyclades Set", Price: 1000},
	// Not for sale. Gated on supporter status alone (unlike the keg, boosting
	// and Ko-fi do not grant it).
	{ID: "pieces.classic", Slot: SlotPieces, Name: "Classic Set", Price: 0, Supporter: true},
}

var catalogByID = func() map[string]Item {
	m := make(map[string]Item, len(Catalog))
	for _, it := range Catalog {
		m[it.ID] = it
	}
	return m
}()

// ItemByID looks up a catalog item.
func ItemByID(id string) (Item, bool) {
	it, ok := catalogByID[id]
	return it, ok
}

var (
	ErrUnknownItem        = errors.New("cosmetics: unknown item")
	ErrSupporterExclusive = errors.New("cosmetics: item is supporter-exclusive, not purchasable")
	ErrNotPurchasable     = errors.New("cosmetics: item is not purchasable")
	ErrNotOwned           = errors.New("cosmetics: item not owned")
	ErrWrongSlot          = errors.New("cosmetics: item does not belong in that slot")
	ErrUnknownColor       = errors.New("cosmetics: unknown color")
)
