package discord

import "encoding/json"

// Text-input component type + styles (Discord wire values).
const (
	componentTextInput = 4

	TextShort     = 1 // single-line input
	TextParagraph = 2 // multi-line input
)

// TextInput is a single text field inside a Modal. Value pre-fills the field;
// Required and MaxLength are omitted from the wire when zero/false-by-default.
type TextInput struct {
	CustomID  string
	Label     string
	Style     int
	Value     string
	Required  bool
	MaxLength int
}

func (t TextInput) MarshalJSON() ([]byte, error) {
	out := map[string]any{
		"type":      componentTextInput,
		"custom_id": t.CustomID,
		"label":     t.Label,
		"style":     t.Style,
		"required":  t.Required,
	}
	if t.Value != "" {
		out["value"] = t.Value
	}
	if t.MaxLength > 0 {
		out["max_length"] = t.MaxLength
	}
	return json.Marshal(out)
}

// Modal is a popup form (the data payload of a type-9 MODAL interaction response).
// Each TextInput is wrapped in its own action row, as Discord requires. The submit
// arrives back as a MODAL_SUBMIT interaction carrying CustomID and the field values.
type Modal struct {
	CustomID string
	Title    string
	Inputs   []TextInput
}

func (m Modal) MarshalJSON() ([]byte, error) {
	rows := make([]ActionRow, 0, len(m.Inputs))
	for _, in := range m.Inputs {
		rows = append(rows, ActionRow{Inputs: []TextInput{in}})
	}
	return json.Marshal(struct {
		CustomID   string      `json:"custom_id"`
		Title      string      `json:"title"`
		Components []ActionRow `json:"components"`
	}{m.CustomID, m.Title, rows})
}
