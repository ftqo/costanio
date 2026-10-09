package discord

import "testing"

func TestModalShape(t *testing.T) {
	m := Modal{
		CustomID: "config:feedtitle:submit",
		Title:    "Edit feed title",
		Inputs: []TextInput{
			{CustomID: "title", Label: "Feed title", Style: TextShort, Value: "🎲 A game is starting", MaxLength: 100},
		},
	}
	mm := marshalMap(t, m)
	if mm["custom_id"] != "config:feedtitle:submit" || mm["title"] != "Edit feed title" {
		t.Fatalf("modal top = %v", mm)
	}
	rows := mm["components"].([]any)
	if len(rows) != 1 {
		t.Fatalf("want one action row per input; got %v", rows)
	}
	row := rows[0].(map[string]any)
	if row["type"] != float64(componentActionRow) {
		t.Fatalf("input must be wrapped in an action row; got %v", row)
	}
	input := row["components"].([]any)[0].(map[string]any)
	if input["type"] != float64(componentTextInput) {
		t.Fatalf("input type = %v; want %d", input["type"], componentTextInput)
	}
	if input["custom_id"] != "title" || input["label"] != "Feed title" || input["style"] != float64(TextShort) {
		t.Fatalf("input = %v", input)
	}
	if input["value"] != "🎲 A game is starting" || input["max_length"] != float64(100) {
		t.Fatalf("input prefill/max = %v", input)
	}
}
