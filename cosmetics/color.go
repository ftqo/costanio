package cosmetics

import (
	"fmt"
	"strings"
)

// ColorThreshold is the minimum CIEDE2000 distance two players' colors must keep
// in the same game. ~12 is above "just noticeable" and below "obviously
// different": two distinct reds pass, near-twins do not.
const ColorThreshold = 12.0

// Color is a palette entry. lab is the precomputed CIE L*a*b* used by the
// distinctness check.
type Color struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Hex  string `json:"hex"`
	Free bool   `json:"free"`
	// Price in Pips, 0 for a color that is not on the shelf (every free preset,
	// and the supporter colors that stay supporter-only). A priced color also
	// has a catalog Item, which is what Purchase actually charges against.
	Price int `json:"price"`
	lab   [3]float64
}

// DeltaE is the perceptual distance to another color.
func (c Color) DeltaE(o Color) float64 { return DeltaE2000(c.lab, o.lab) }

// FreeCount is how many palette colors are free (the rest are supporter-only).
const FreeCount = 10

// cubeLevels are the only per-channel values any palette color uses: 0x00, 0x55,
// 0xAA, 0xFF (i.e. 0, 85, 170, 255). The whole palette is the 4^3 = 64 cube of
// these, so every color's R, G, B is one of these four steps.
var cubeLevels = [4]int{0x00, 0x55, 0xAA, 0xFF}

// freeColors are the 10 free presets, in the order they lead the palette:
// cube colors mutually distinct enough for a full table (asserted by the
// tests).
var freeColors = []string{
	"#000000", // Black
	"#ffffff", // White
	"#ff0000", // Red
	"#ffaa00", // Orange
	"#ffff00", // Yellow
	"#00ff00", // Green
	"#00ffff", // Cyan
	"#0000ff", // Blue
	"#aa00ff", // Purple
	"#ff00ff", // Magenta
}

// cubeNames names every color in the cube, for purchase confirmations, ledger
// lines and store cards. In cube order (R, then G, then B); init panics on a
// missing entry.
var cubeNames = map[string]string{
	"#000000": "Black", "#000055": "Midnight", "#0000aa": "Navy", "#0000ff": "Blue",
	"#005500": "Forest", "#005555": "Deep Sea", "#0055aa": "Denim", "#0055ff": "Cobalt",
	"#00aa00": "Fern", "#00aa55": "Emerald", "#00aaaa": "Lagoon", "#00aaff": "Azure",
	"#00ff00": "Green", "#00ff55": "Shamrock", "#00ffaa": "Mint", "#00ffff": "Cyan",

	"#550000": "Oxblood", "#550055": "Plum", "#5500aa": "Violet", "#5500ff": "Ultraviolet",
	"#555500": "Olive", "#555555": "Graphite", "#5555aa": "Slate", "#5555ff": "Indigo",
	"#55aa00": "Grass", "#55aa55": "Sage", "#55aaaa": "Teal", "#55aaff": "Sky",
	"#55ff00": "Lime", "#55ff55": "Meadow", "#55ffaa": "Spring", "#55ffff": "Ice",

	"#aa0000": "Maroon", "#aa0055": "Wine", "#aa00aa": "Amethyst", "#aa00ff": "Purple",
	"#aa5500": "Rust", "#aa5555": "Brick", "#aa55aa": "Mauve", "#aa55ff": "Lilac",
	"#aaaa00": "Brass", "#aaaa55": "Sand", "#aaaaaa": "Ash", "#aaaaff": "Periwinkle",
	"#aaff00": "Chartreuse", "#aaff55": "Pistachio", "#aaffaa": "Honeydew", "#aaffff": "Frost",

	"#ff0000": "Red", "#ff0055": "Cerise", "#ff00aa": "Fuchsia", "#ff00ff": "Magenta",
	"#ff5500": "Tangerine", "#ff5555": "Salmon", "#ff55aa": "Rose", "#ff55ff": "Pink",
	"#ffaa00": "Orange", "#ffaa55": "Apricot", "#ffaaaa": "Blush", "#ffaaff": "Orchid",
	"#ffff00": "Yellow", "#ffff55": "Lemon", "#ffffaa": "Butter", "#ffffff": "White",
}

// ColorPrice is what a palette color on the shelf costs in Pips. One price for
// all of them.
const ColorPrice = 2000

// shopColors are the palette colors sold for Pips, in cube order. The rest of
// the supporter half stays supporter-only.
//
// Every color here is at least ColorThreshold from all ten free presets and
// from each other, so a buyer can wear it at any table (AllowedColor refuses a
// color too close to one already seated, and unpicked seats default to free
// presets). The tests assert both.
//
// They also cover hue families the free set lacks: brown, wine, pale warm, and
// the two greys.
var shopColors = []string{
	"#0055aa", // Denim
	"#005555", // Deep Sea
	"#00aa55", // Emerald
	"#aa0055", // Wine
	"#aa5500", // Rust
	"#aaaa55", // Sand
	"#aaaaaa", // Ash
	"#aaaaff", // Periwinkle
	"#55aaff", // Sky
	"#555555", // Graphite
	"#ffaaaa", // Blush
	"#ffaaff", // Orchid
}

// shopPrice is shopColors as a lookup, so the palette can carry each color's
// price without the two lists drifting.
var shopPrice = func() map[string]int {
	m := make(map[string]int, len(shopColors))
	for _, hex := range shopColors {
		m[hex] = ColorPrice
	}
	return m
}()

// colorID is a palette color's catalog/entitlement id: "color.ff00aa".
func colorID(hex string) string { return "color." + strings.TrimPrefix(hex, "#") }

// Palette is the full 64-color cube (10 free + 54 supporter), lab precomputed.
// The free colors lead the slice (Palette[:FreeCount]); the rest are the
// remaining cube colors, supporter-gated. In-game clashes are prevented at pick
// time by AllowedColor, so only the free set needs to be mutually separated
// (asserted by the tests).
var Palette []Color

var paletteByID map[string]Color

func init() {
	free := make(map[string]bool, len(freeColors))
	add := func(hex string, isFree bool) {
		name, ok := cubeNames[hex]
		if !ok {
			panic("cosmetics: unnamed palette color " + hex)
		}
		Palette = append(Palette, Color{
			ID: colorID(hex), Name: name, Hex: hex, Free: isFree,
			Price: shopPrice[hex], lab: hexToLab(hex),
		})
	}
	for _, hex := range freeColors {
		free[strings.ToLower(hex)] = true
		add(hex, true)
	}
	// The remaining cube colors, in R-major order. Supporter-gated, except the
	// shopColors subset, which is also sold for Pips.
	for _, r := range cubeLevels {
		for _, g := range cubeLevels {
			for _, b := range cubeLevels {
				hex := fmt.Sprintf("#%02x%02x%02x", r, g, b)
				if free[hex] {
					continue
				}
				add(hex, false)
			}
		}
	}
	paletteByID = make(map[string]Color, len(Palette))
	for _, c := range Palette {
		paletteByID[c.ID] = c
	}
}

// HasColor reports whether a user holding these entitlements and this supporter
// status may wear col.
//
// A free preset is everyone's, a supporter color comes with active status, and
// a shelf color (Price > 0) must be bought; supporter status does not grant it.
func HasColor(col Color, ent map[string]bool, supporterActive bool) bool {
	switch {
	case col.Free, ent[col.ID]:
		return true
	case col.Price > 0:
		return false // on the shelf: bought, granted, or not yours
	default:
		return supporterActive
	}
}

// ColorByID looks up a palette color.
func ColorByID(id string) (Color, bool) {
	c, ok := paletteByID[id]
	return c, ok
}

// ColorByHex looks up a palette color by its hex string ("#ff0000" or "ff0000").
func ColorByHex(hex string) (Color, bool) {
	return ColorByID("color." + strings.ToLower(strings.TrimPrefix(hex, "#")))
}

// seatDefaultOrder maps seat order onto the free presets (Palette[:FreeCount]),
// leading with the most board-readable hues and putting Black/White last (a
// white piece carries a white outline, so it reads poorly as a default). Every
// index is distinct, so an all-default table stays mutually distinct.
// Indices into Palette[:FreeCount]: 0 Black,1 White,2 Red,3 Orange,4 Yellow,
// 5 Green,6 Cyan,7 Blue,8 Purple,9 Magenta.
//
// The order is chosen for color-deficient vision; for normal vision every free
// pair is already >= ColorThreshold apart. Red, Orange and Green are nearly one
// color to a deuteranope, so they are kept apart in the early seats. Distinct
// colors a viewer can tell apart (old order -> this order):
//
//	                      4 seats            5 seats            6 seats
//	deuteranopia    2 of 4 -> 4 of 4    2 of 5 -> 5 of 5   3 of 6 -> 4 of 6
//	protanopia      3 of 4 -> 4 of 4    3 of 5 -> 4 of 5   4 of 6 -> 5 of 6
//	tritanopia      4 of 4 -> 4 of 4    5 of 5 -> 4 of 5   5 of 6 -> 5 of 6
//
// Tritanopia at five seats regresses; it is far rarer than deuteranomaly. No
// six free colors survive all three deficiencies, which is why the opt-in
// per-deficiency palettes exist (frontend lib/colorblind.ts).
//
// cvd_test.go asserts the table above.
var seatDefaultOrder = [FreeCount]int{2, 6, 7, 4, 9, 3, 5, 8, 0, 1}

// DefaultSeatColor is the color a seat renders with before anyone picks one:
// a free preset chosen by seat order so unpicked seats are mutually distinct
// (the free set is mutually >= ColorThreshold apart). seatNo wraps past the
// free count, which only repeats once a table exceeds FreeCount seats.
func DefaultSeatColor(seatNo int) Color {
	return Palette[seatDefaultOrder[((seatNo%FreeCount)+FreeCount)%FreeCount]]
}

// PickSeatColor chooses a free preset for a seat that stays at least
// ColorThreshold from every already-seated color, preferring the seat's order
// default. Unlike DefaultSeatColor (distinct only against other seat defaults),
// it also avoids colors players have actively picked or seeded. It falls back to
// the raw seat default when no free preset is far enough, so it always returns
// a color.
func PickSeatColor(seated []Color, seatNo int) Color {
	def := DefaultSeatColor(seatNo)
	if AllowedColor(seated, def, ColorThreshold) {
		return def
	}
	for _, i := range seatDefaultOrder {
		if c := Palette[i]; AllowedColor(seated, c, ColorThreshold) {
			return c
		}
	}
	return def
}

// AllowedColor reports whether cand is perceptually far enough (>= threshold)
// from every already-seated color. An empty seated list always allows.
func AllowedColor(seated []Color, cand Color, threshold float64) bool {
	for _, s := range seated {
		if cand.DeltaE(s) < threshold {
			return false
		}
	}
	return true
}
