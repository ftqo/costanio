package discord

import (
	"encoding/json"
	"strings"
)

// markdownEscaper backslash-escapes the markdown Discord honors in message text.
// Player-chosen names flow into components verbatim, so a name containing "**"
// or "#" must not be able to restyle the message around it.
//
// "<" and "@" are escaped too: "<@id>", "<@&role>", "<#channel>" and
// "<:emoji:id>" render as pills, and "@everyone" as a highlighted mention, so
// player text could otherwise name (or impersonate) a member or role.
var markdownEscaper = strings.NewReplacer(
	`\`, `\\`, "*", `\*`, "_", `\_`, "~", `\~`, "`", "\\`",
	">", `\>`, "#", `\#`, "|", `\|`, "[", `\[`, "]", `\]`,
	"<", `\<`, "@", `\@`,
)

// EscapeMarkdown renders untrusted text (a display name, say) as literal text.
func EscapeMarkdown(s string) string { return markdownEscaper.Replace(s) }

// Components V2 type numbers (Discord wire values). A message that opts into
// this system (see FlagComponentsV2) carries no content and no embeds: every
// piece of text, image, and control is a component, which is what lets one
// message show a per-player avatar instead of an embed's single thumbnail.
const (
	componentSection     = 9
	componentTextDisplay = 10
	componentThumbnail   = 11
	componentSeparator   = 14
	componentContainer   = 17

	// FlagComponentsV2 is the message flag that switches a message to the
	// components-only rendering above. Discord rejects the message if it is set
	// alongside content or embeds.
	FlagComponentsV2 = 1 << 15

	// Separator spacing values.
	SpacingSmall = 1
	SpacingLarge = 2
)

// Component is anything that can sit in a components array. Every component
// type in this package marshals itself with its own "type" discriminator, so a
// heterogeneous list marshals correctly without a wrapper.
type Component interface {
	json.Marshaler
}

// TextDisplay is a block of markdown. Unlike embed text it renders at full
// message width and honors headings ("## ").
type TextDisplay struct {
	Content string
}

func (t TextDisplay) MarshalJSON() ([]byte, error) {
	// Control characters are stripped as in Embed (player text reaches these
	// blocks, and bidi overrides reorder a line). Escaping is the call site's
	// job (see EscapeMarkdown), since our own copy is markdown.
	return json.Marshal(map[string]any{"type": componentTextDisplay, "content": SanitizeText(t.Content)})
}

// Thumbnail is a small image shown as a Section's accessory (right-hand side).
// URL must be reachable by Discord: an https URL or an attachment:// reference.
type Thumbnail struct {
	URL         string
	Description string // alt text
}

func (t Thumbnail) MarshalJSON() ([]byte, error) {
	out := map[string]any{"type": componentThumbnail, "media": map[string]any{"url": t.URL}}
	if t.Description != "" {
		out["description"] = t.Description
	}
	return json.Marshal(out)
}

// Section is one to three text blocks with a single accessory pinned beside
// them (a Thumbnail or a Button). This is the only layout that puts an image
// next to a specific line, which is what a per-player roster row needs.
type Section struct {
	Text      []TextDisplay
	Accessory Component
}

func (s Section) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{
		"type":       componentSection,
		"components": s.Text,
		"accessory":  s.Accessory,
	})
}

// Separator is vertical whitespace, optionally with a divider line.
type Separator struct {
	Divider bool
	Spacing int // SpacingSmall or SpacingLarge; 0 = Discord's default
}

func (s Separator) MarshalJSON() ([]byte, error) {
	out := map[string]any{"type": componentSeparator, "divider": s.Divider}
	if s.Spacing > 0 {
		out["spacing"] = s.Spacing
	}
	return json.Marshal(out)
}

// Container groups components behind an accent bar, giving a components-only
// message the same colored left edge an embed has.
type Container struct {
	AccentColor int
	Components  []Component
}

func (c Container) MarshalJSON() ([]byte, error) {
	out := map[string]any{"type": componentContainer, "components": c.Components}
	if c.AccentColor != 0 {
		out["accent_color"] = c.AccentColor
	}
	return json.Marshal(out)
}
