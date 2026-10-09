package discord

import "encoding/json"

// Message-component type numbers and button styles (Discord wire values).
const (
	componentActionRow     = 1
	componentButton        = 2
	componentStringSelect  = 3 // STRING_SELECT menu (fixed options)
	componentRoleSelect    = 6 // ROLE_SELECT menu
	componentChannelSelect = 8 // CHANNEL_SELECT menu

	channelTypeGuildText = 0 // channel_types filter value for text channels

	ButtonPrimary   = 1
	ButtonSecondary = 2
	ButtonSuccess   = 3
	ButtonDanger    = 4
	ButtonLink      = 5 // a link button carries a url instead of a custom_id
)

// Embed is a Discord message embed. It is built by hand and marshaled to the
// embed JSON Discord expects (no Discord library). Optional fields
// are omitted when empty. Author renders a small icon + name above the title;
// Thumbnail renders an image in the top-right corner; Footer/FooterIcon render a
// small line at the bottom.
type Embed struct {
	Title       string
	Description string
	Color       int
	Fields      []EmbedField
	Author      EmbedAuthor
	Thumbnail   string // image URL, rendered top-right
	Footer      string
	FooterIcon  string
}

// EmbedAuthor is the small icon + name shown at the top of an embed. Name can
// link out via URL; IconURL is the little circular image beside it.
type EmbedAuthor struct {
	Name    string
	IconURL string
	URL     string
}

func (a EmbedAuthor) empty() bool { return a.Name == "" && a.IconURL == "" && a.URL == "" }

// EmbedField is one name/value row in an embed.
type EmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

func (e Embed) MarshalJSON() ([]byte, error) {
	type imageObj struct {
		URL string `json:"url"`
	}
	type authorObj struct {
		Name    string `json:"name"`
		IconURL string `json:"icon_url,omitempty"`
		URL     string `json:"url,omitempty"`
	}
	type footerObj struct {
		Text    string `json:"text"`
		IconURL string `json:"icon_url,omitempty"`
	}
	// Control-character stripping and length limits are applied here for every
	// string. Player-authored text still needs escaping via Quote or
	// NameMention, since our own copy uses markdown.
	out := struct {
		Title       string       `json:"title,omitempty"`
		Description string       `json:"description,omitempty"`
		Color       int          `json:"color,omitempty"`
		Fields      []EmbedField `json:"fields,omitempty"`
		Author      *authorObj   `json:"author,omitempty"`
		Thumbnail   *imageObj    `json:"thumbnail,omitempty"`
		Footer      *footerObj   `json:"footer,omitempty"`
	}{
		Title:       safe(e.Title, limitTitle),
		Description: safe(e.Description, limitDescription),
		Color:       e.Color,
	}
	for _, f := range e.Fields {
		out.Fields = append(out.Fields, EmbedField{
			Name:   safe(f.Name, limitFieldName),
			Value:  safe(f.Value, limitFieldValue),
			Inline: f.Inline,
		})
	}
	if !e.Author.empty() {
		out.Author = &authorObj{Name: safe(e.Author.Name, limitAuthorName), IconURL: e.Author.IconURL, URL: e.Author.URL}
	}
	if e.Thumbnail != "" {
		out.Thumbnail = &imageObj{URL: e.Thumbnail}
	}
	if e.Footer != "" {
		out.Footer = &footerObj{Text: safe(e.Footer, limitFooter), IconURL: e.FooterIcon}
	}
	return json.Marshal(out)
}

// Button is a clickable message component. An action button carries a CustomID
// (echoed back as a MESSAGE_COMPONENT interaction when pressed); a link button
// (Style == ButtonLink) carries a URL instead and opens it in the browser.
// Discord rejects a button that sets both, so marshaling emits exactly one.
type Button struct {
	Label    string
	CustomID string
	URL      string
	Style    int
}

func (b Button) MarshalJSON() ([]byte, error) {
	out := map[string]any{
		"type":  componentButton,
		"style": b.Style,
		"label": b.Label,
	}
	if b.Style == ButtonLink {
		out["url"] = b.URL
	} else {
		out["custom_id"] = b.CustomID
	}
	return json.Marshal(out)
}

// SelectOption is one choice in a STRING_SELECT menu.
type SelectOption struct {
	Label   string
	Value   string
	Default bool
}

// SelectMenu is a select-menu component. Type is one of componentStringSelect (3),
// componentRoleSelect (6), or componentChannelSelect (8). When the user picks,
// Discord echoes a MESSAGE_COMPONENT interaction whose data.values holds the chosen
// value(s). Build via ChannelSelect/RoleSelect/StringSelect rather than by hand.
//   - String selects carry Options (each Value is echoed on pick).
//   - Role/channel selects carry DefaultIDs (pre-selected entities); channel selects
//     additionally filter to guild text channels.
//
// MinValues (nil = Discord default of 1) and MaxValues (0 = omit) bound multi-select.
type SelectMenu struct {
	Type        int
	CustomID    string
	Placeholder string
	Options     []SelectOption // string select only
	DefaultIDs  []string       // role/channel select only
	MinValues   *int
	MaxValues   int
}

// ChannelSelect is a text-channel picker pre-selecting the given channel ids.
func ChannelSelect(customID, placeholder string, defaults []string) SelectMenu {
	return SelectMenu{Type: componentChannelSelect, CustomID: customID, Placeholder: placeholder, DefaultIDs: defaults}
}

// RoleSelect is a multi-role picker (min 0 so all roles can be cleared) pre-selecting
// the given role ids, capped at maxValues.
func RoleSelect(customID, placeholder string, defaults []string, maxValues int) SelectMenu {
	zero := 0
	return SelectMenu{Type: componentRoleSelect, CustomID: customID, Placeholder: placeholder, DefaultIDs: defaults, MinValues: &zero, MaxValues: maxValues}
}

// StringSelect is a fixed-option dropdown.
func StringSelect(customID, placeholder string, options []SelectOption) SelectMenu {
	return SelectMenu{Type: componentStringSelect, CustomID: customID, Placeholder: placeholder, Options: options}
}

func (s SelectMenu) MarshalJSON() ([]byte, error) {
	out := map[string]any{"type": s.Type, "custom_id": s.CustomID}
	if s.Placeholder != "" {
		out["placeholder"] = s.Placeholder
	}
	if s.MinValues != nil {
		out["min_values"] = *s.MinValues
	}
	if s.MaxValues > 0 {
		out["max_values"] = s.MaxValues
	}
	switch s.Type {
	case componentStringSelect:
		opts := make([]map[string]any, 0, len(s.Options))
		for _, o := range s.Options {
			m := map[string]any{"label": o.Label, "value": o.Value}
			if o.Default {
				m["default"] = true
			}
			opts = append(opts, m)
		}
		out["options"] = opts
	case componentRoleSelect, componentChannelSelect:
		entity := "role"
		if s.Type == componentChannelSelect {
			entity = "channel"
			out["channel_types"] = []int{channelTypeGuildText}
		}
		if len(s.DefaultIDs) > 0 {
			dv := make([]map[string]any, 0, len(s.DefaultIDs))
			for _, id := range s.DefaultIDs {
				dv = append(dv, map[string]any{"id": id, "type": entity})
			}
			out["default_values"] = dv
		}
	}
	return json.Marshal(out)
}

// ActionRow is a row of components. A row holds exactly one component kind (Discord
// forbids mixing): message rows carry Buttons or a single Select; modal rows carry a
// single text Input. The set field takes precedence in that order.
type ActionRow struct {
	Buttons []Button
	Select  *SelectMenu
	Inputs  []TextInput
}

func (r ActionRow) MarshalJSON() ([]byte, error) {
	if r.Select != nil {
		return json.Marshal(struct {
			Type       int          `json:"type"`
			Components []SelectMenu `json:"components"`
		}{componentActionRow, []SelectMenu{*r.Select}})
	}
	if len(r.Inputs) > 0 {
		return json.Marshal(struct {
			Type       int         `json:"type"`
			Components []TextInput `json:"components"`
		}{componentActionRow, r.Inputs})
	}
	return json.Marshal(struct {
		Type       int      `json:"type"`
		Components []Button `json:"components"`
	}{componentActionRow, r.Buttons})
}

// safe is the marshal-time pass every embed string takes: control characters out,
// Discord's limit for that field enforced.
func safe(s string, limit int) string { return Clip(SanitizeText(s), limit) }
