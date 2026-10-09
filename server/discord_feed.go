package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// postGameFeed announces a freshly-started game to the configured feed channel.
// Best-effort and run off the start path: it must never block or fail the game
// start. With no bot or no feed channel it logs and returns. Linked players are
// @-mentioned and the message carries a watch link, including the invite code
// for private games.
func (s *Server) postGameFeed(gameID string) {
	if s.discordBot == nil {
		return
	}
	channel, err := s.store.FeedChannel()
	if err != nil {
		slog.Error("game feed: read channel", "game", gameID, "err", err)
		return
	}
	if channel == "" {
		return // feed disabled
	}

	g, err := s.store.GameByID(gameID)
	if err != nil {
		slog.Error("game feed: load game", "game", gameID, "err", err)
		return
	}
	seats, err := s.store.Seats(gameID)
	if err != nil {
		slog.Error("game feed: load seats", "game", gameID, "err", err)
		return
	}

	// Resolve linked Discord ids for human seats (bots/guests have none).
	discordByUser := make(map[int64]string, len(seats))
	for _, seat := range seats {
		if seat.Status == "bot" {
			continue
		}
		if u, err := s.store.UserByID(seat.UserID); err == nil && u.DiscordID != "" {
			discordByUser[seat.UserID] = u.DiscordID
		}
	}

	// A private game's watch link carries its invite code to pass the spectate
	// gate, which discloses the code to the feed channel. That is intended: the
	// channel is the operator's own, and its readers are trusted with it.
	// (/spectate gates the same disclosure behind server-admin.)
	watchURL := s.inviteSpectateLink(g)

	title, _ := s.store.FeedTitle()
	components := gameFeedComponents(g, seats, discordByUser, watchURL, title)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := s.discordBot.PostComponentsMessage(ctx, channel, components); err != nil {
		slog.Error("game feed: post", "game", gameID, "err", err)
	}
}

// gameFeedComponents builds the game-start feed message as a Components V2
// container: a heading, one roster row per seat (avatar beside seat color and
// name), the map/settings summary, and a Watch link button (omitted when there
// is no link).
//
// Roster rows are Sections because that is the only Discord layout that pins an
// image to a line; an embed has one thumbnail. Seats are listed and numbered in
// turn order. Linked humans render as <@id> mentions (names, not pings: see
// PostComponentsMessage), bots get a 🤖 marker, guests render by name. title
// overrides the heading; empty falls back to defaultFeedTitle.
func gameFeedComponents(g *store.Game, seats []*store.Seat, discordByUser map[int64]string, watchURL, title string) []discord.Component {
	if title == "" {
		title = defaultFeedTitle
	}

	summary := fmt.Sprintf("**%s** · %d players", rulesetLabel(g.Ruleset), len(seats))
	if g.Ranked {
		summary += " · 🏆 Ranked"
	}
	inner := []discord.Component{
		discord.TextDisplay{Content: "## " + title},
		discord.TextDisplay{Content: summary},
		discord.Separator{Divider: true, Spacing: discord.SpacingSmall},
	}
	squares := seatColorSquares(seats)
	for i, seat := range seats {
		inner = append(inner, discord.Section{
			Text:      []discord.TextDisplay{{Content: rosterLine(seat, discordByUser[seat.UserID], squares[i])}},
			Accessory: discord.Thumbnail{URL: seatAvatarURL(seat), Description: seat.UserName},
		})
	}
	if settings := gameSettingsLine(g); settings != "" {
		inner = append(inner,
			discord.Separator{Divider: true, Spacing: discord.SpacingSmall},
			discord.TextDisplay{Content: settings},
		)
	}
	// The game id, so a bug report can name the game; its replay
	// (GET /api/games/{id}/replay) reproduces the bug exactly. In a code span
	// so it copy-pastes intact.
	inner = append(inner, discord.TextDisplay{Content: "-# Game `" + g.ID + "`"})
	if watchURL != "" {
		inner = append(inner, discord.ActionRow{Buttons: []discord.Button{
			{Label: "Watch", URL: watchURL, Style: discord.ButtonLink},
		}})
	}

	return []discord.Component{discord.Container{AccentColor: moduleAccent(g.Ruleset), Components: inner}}
}

// rosterLine renders one seat: turn-order number, seat color, and identity.
func rosterLine(seat *store.Seat, discordID, square string) string {
	name := "**" + discord.EscapeMarkdown(seat.UserName) + "**"
	switch {
	case seat.Status == "bot":
		name += " 🤖"
	case discordID != "":
		name = fmt.Sprintf("<@%s>", discordID)
	}
	return fmt.Sprintf("`%d.` %s %s", seat.No+1, square, name)
}

// seatAvatarURL is the seat's profile picture, falling back to one of Discord's
// stock avatars (bots and guests have none). A Section accessory must carry an
// image, so this is always non-empty.
func seatAvatarURL(seat *store.Seat) string {
	if seat.Avatar != "" {
		return seat.Avatar
	}
	return fmt.Sprintf("https://cdn.discordapp.com/embed/avatars/%d.png", seat.No%6)
}

// squareEmoji is the colored-square emoji set with the approximate RGB each one
// renders as. A seat's palette color is shown as its nearest square, which is as
// close as Discord gets to an arbitrary hex inline in text.
var squareEmoji = []struct {
	emoji   string
	r, g, b int
}{
	{"🟥", 0xdd, 0x2e, 0x44},
	{"🟧", 0xf4, 0x90, 0x0c},
	{"🟨", 0xfd, 0xcb, 0x58},
	{"🟩", 0x78, 0xb1, 0x59},
	{"🟦", 0x55, 0xac, 0xee},
	{"🟪", 0xaa, 0x8e, 0xd6},
	{"🟫", 0xc1, 0x69, 0x4f},
	{"⬛", 0x31, 0x37, 0x3d},
	{"⬜", 0xe6, 0xe7, 0xe8},
}

// seatColorSquares picks one square emoji per seat, in seat order. Each seat
// takes the closest square no earlier seat claimed: the palette is finer than
// the emoji set, and two players sharing a square is worse than one being
// slightly off-hue. Only seats past the ninth can repeat.
func seatColorSquares(seats []*store.Seat) []string {
	out := make([]string, len(seats))
	used := make(map[string]bool, len(seats))
	for i, seat := range seats {
		out[i] = nearestSquare(effectiveSeatHex(seat), used)
		used[out[i]] = true
	}
	return out
}

// effectiveSeatHex is the color a seat renders with: its pick, or the seat-order
// default. Mirrors lobby.effectiveColor, since the feed reads raw store seats,
// which carry the pick but not the derived hex.
func effectiveSeatHex(seat *store.Seat) string {
	if seat.ColorHex != "" {
		return seat.ColorHex
	}
	if seat.Color != "" {
		if c, ok := cosmetics.ColorByID(seat.Color); ok {
			return c.Hex
		}
	}
	return cosmetics.DefaultSeatColor(seat.No).Hex
}

// nearestSquare is the closest square emoji to a hex color, preferring one that
// is not already taken and falling back to the closest overall when every square
// is spoken for.
func nearestSquare(hex string, taken map[string]bool) string {
	r, g, b, ok := parseHexRGB(hex)
	if !ok {
		return "⬜"
	}
	best, bestDist := "", 1<<30
	fallback, fallbackDist := squareEmoji[0].emoji, 1<<30
	for _, sq := range squareEmoji {
		dr, dg, db := sq.r-r, sq.g-g, sq.b-b
		d := dr*dr + dg*dg + db*db
		if d < fallbackDist {
			fallback, fallbackDist = sq.emoji, d
		}
		if !taken[sq.emoji] && d < bestDist {
			best, bestDist = sq.emoji, d
		}
	}
	if best == "" {
		return fallback
	}
	return best
}

// parseHexRGB splits a "#rrggbb" color into components.
func parseHexRGB(hex string) (r, g, b int, ok bool) {
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) != 6 {
		return 0, 0, 0, false
	}
	v, err := strconv.ParseUint(hex, 16, 32)
	if err != nil {
		return 0, 0, 0, false
	}
	return int(v>>16) & 0xff, int(v>>8) & 0xff, int(v) & 0xff, true
}

// gameSettingsLine summarizes the settings that change how the table plays.
// Returns "" when a game runs on nothing but defaults, in which case the feed
// omits the line rather than posting an empty one.
func gameSettingsLine(g *store.Game) string {
	var cfg engine.GameConfig
	_ = json.Unmarshal(g.Config, &cfg) // best-effort: an unreadable config just yields defaults

	var parts []string
	if cfg.TargetVP > 0 {
		parts = append(parts, fmt.Sprintf("**Goal:** %d VP", cfg.TargetVP))
	}
	if cfg.TurnTimerSec > 0 {
		parts = append(parts, "**Turn timer:** "+durationLabel(cfg.TurnTimerSec))
	}
	if cfg.DiceMode == "fair" {
		parts = append(parts, "**Dice:** fair")
	}
	return strings.Join(parts, " · ")
}

// durationLabel renders a turn budget compactly ("45s", "2m", "1m 30s").
func durationLabel(sec int) string {
	switch {
	case sec < 60:
		return fmt.Sprintf("%ds", sec)
	case sec%60 == 0:
		return fmt.Sprintf("%dm", sec/60)
	default:
		return fmt.Sprintf("%dm %ds", sec/60, sec%60)
	}
}
