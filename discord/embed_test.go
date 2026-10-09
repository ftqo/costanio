package discord

import (
	"encoding/json"
	"testing"
)

// marshalMap round-trips a value through JSON into a generic map so tests can
// assert on the wire shape Discord receives without depending on field order.
func marshalMap(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return m
}

func TestEmbedMarshalsFullShape(t *testing.T) {
	e := Embed{
		Title:       "Stats",
		Description: "your record",
		Color:       0x5865F2,
		Fields: []EmbedField{
			{Name: "Rating", Value: "1200", Inline: true},
			{Name: "Wins", Value: "5", Inline: true},
		},
		Footer: "costan",
	}
	m := marshalMap(t, e)

	if m["title"] != "Stats" || m["description"] != "your record" {
		t.Fatalf("title/description wrong: %v", m)
	}
	if m["color"] != float64(0x5865F2) {
		t.Fatalf("color = %v; want %d", m["color"], 0x5865F2)
	}
	// Footer must be the nested object Discord expects: {"text": "..."}.
	footer, ok := m["footer"].(map[string]any)
	if !ok || footer["text"] != "costan" {
		t.Fatalf("footer = %v; want {text: costan}", m["footer"])
	}
	fields, ok := m["fields"].([]any)
	if !ok || len(fields) != 2 {
		t.Fatalf("fields = %v; want 2", m["fields"])
	}
	f0 := fields[0].(map[string]any)
	if f0["name"] != "Rating" || f0["value"] != "1200" || f0["inline"] != true {
		t.Fatalf("field[0] = %v", f0)
	}
}

func TestEmbedOmitsEmptyOptionalFields(t *testing.T) {
	m := marshalMap(t, Embed{Title: "x"})
	for _, k := range []string{"description", "color", "fields", "footer"} {
		if _, present := m[k]; present {
			t.Fatalf("empty %q should be omitted; got %v", k, m)
		}
	}
}

func TestActionRowWithDangerButton(t *testing.T) {
	row := ActionRow{Buttons: []Button{
		{Label: "Confirm reset", CustomID: "reset-user:42", Style: ButtonDanger},
	}}
	m := marshalMap(t, row)

	if m["type"] != float64(componentActionRow) {
		t.Fatalf("row type = %v; want %d", m["type"], componentActionRow)
	}
	comps, ok := m["components"].([]any)
	if !ok || len(comps) != 1 {
		t.Fatalf("components = %v", m["components"])
	}
	b := comps[0].(map[string]any)
	if b["type"] != float64(componentButton) {
		t.Fatalf("button type = %v; want %d", b["type"], componentButton)
	}
	if b["style"] != float64(ButtonDanger) || b["label"] != "Confirm reset" || b["custom_id"] != "reset-user:42" {
		t.Fatalf("button = %v", b)
	}
}

func TestActionRowWithChannelSelect(t *testing.T) {
	row := ActionRow{Select: new(ChannelSelect("config:ch:feed", "Set game-feed channel", []string{"chan9"}))}
	m := marshalMap(t, row)

	if m["type"] != float64(componentActionRow) {
		t.Fatalf("row type = %v; want %d", m["type"], componentActionRow)
	}
	comps, ok := m["components"].([]any)
	if !ok || len(comps) != 1 {
		t.Fatalf("components = %v", m["components"])
	}
	sel := comps[0].(map[string]any)
	if sel["type"] != float64(componentChannelSelect) {
		t.Fatalf("select type = %v; want %d", sel["type"], componentChannelSelect)
	}
	if sel["custom_id"] != "config:ch:feed" || sel["placeholder"] != "Set game-feed channel" {
		t.Fatalf("select = %v", sel)
	}
	// text-channel filter
	ct, ok := sel["channel_types"].([]any)
	if !ok || len(ct) != 1 || ct[0] != float64(0) {
		t.Fatalf("channel_types = %v", sel["channel_types"])
	}
	// default_values carries {id, type:"channel"}
	dv, ok := sel["default_values"].([]any)
	if !ok || len(dv) != 1 {
		t.Fatalf("default_values = %v", sel["default_values"])
	}
	d0 := dv[0].(map[string]any)
	if d0["id"] != "chan9" || d0["type"] != "channel" {
		t.Fatalf("default value = %v", d0)
	}
}

func TestChannelSelectOmitsEmptyDefaults(t *testing.T) {
	m := marshalMap(t, ChannelSelect("config:ch:reports", "pick", nil))
	if _, present := m["default_values"]; present {
		t.Fatalf("default_values should be omitted when empty: %v", m)
	}
}

func TestRoleSelectShape(t *testing.T) {
	m := marshalMap(t, RoleSelect("config:role:set:kofi", "Roles that grant kofi", []string{"r1", "r2"}, 25))
	if m["type"] != float64(componentRoleSelect) {
		t.Fatalf("type = %v; want %d", m["type"], componentRoleSelect)
	}
	if _, hasCT := m["channel_types"]; hasCT {
		t.Fatalf("role select must not carry channel_types: %v", m)
	}
	// A role select must allow clearing all roles (min_values 0) and multi-select.
	if m["min_values"] != float64(0) || m["max_values"] != float64(25) {
		t.Fatalf("min/max = %v/%v; want 0/25", m["min_values"], m["max_values"])
	}
	dv := m["default_values"].([]any)
	if len(dv) != 2 || dv[0].(map[string]any)["type"] != "role" {
		t.Fatalf("default_values = %v; want two role entries", dv)
	}
}

func TestStringSelectShape(t *testing.T) {
	m := marshalMap(t, StringSelect("config:role:kind", "Pick a kind", []SelectOption{
		{Label: "kofi", Value: "kofi", Default: true},
		{Label: "staff", Value: "staff"},
	}))
	if m["type"] != float64(componentStringSelect) {
		t.Fatalf("type = %v; want %d", m["type"], componentStringSelect)
	}
	opts := m["options"].([]any)
	if len(opts) != 2 {
		t.Fatalf("options = %v", opts)
	}
	o0 := opts[0].(map[string]any)
	if o0["label"] != "kofi" || o0["value"] != "kofi" || o0["default"] != true {
		t.Fatalf("option 0 = %v", o0)
	}
	if _, hasDefault := opts[1].(map[string]any)["default"]; hasDefault {
		t.Fatalf("non-default option must omit default: %v", opts[1])
	}
}
