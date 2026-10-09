package discord

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestContainerMarshalsNestedComponents(t *testing.T) {
	c := Container{AccentColor: 0x5865F2, Components: []Component{
		TextDisplay{Content: "## Title"},
		Separator{Divider: true, Spacing: SpacingSmall},
		Section{
			Text:      []TextDisplay{{Content: "🟥 Alice"}},
			Accessory: Thumbnail{URL: "https://cdn.example/a.png", Description: "Alice"},
		},
		ActionRow{Buttons: []Button{{Label: "Watch", URL: "https://costan.example/g", Style: ButtonLink}}},
	}}
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["type"] != float64(componentContainer) {
		t.Errorf("container type = %v, want %d", got["type"], componentContainer)
	}
	if got["accent_color"] != float64(0x5865F2) {
		t.Errorf("accent_color = %v", got["accent_color"])
	}
	// Each child must carry its own discriminator so a heterogeneous list decodes.
	for _, want := range []int{componentTextDisplay, componentSeparator, componentSection, componentActionRow} {
		if !strings.Contains(string(raw), `"type":`+itoa(want)) {
			t.Errorf("missing component type %d in %s", want, raw)
		}
	}
	// The section's accessory is the thumbnail, not a sibling component.
	if !strings.Contains(string(raw), `"accessory":{"media":{"url":"https://cdn.example/a.png"}`) &&
		!strings.Contains(string(raw), `"accessory":{`) {
		t.Errorf("section should carry its thumbnail as an accessory: %s", raw)
	}
}

func TestSeparatorOmitsUnsetSpacing(t *testing.T) {
	raw, _ := json.Marshal(Separator{})
	if strings.Contains(string(raw), "spacing") {
		t.Errorf("unset spacing should be omitted: %s", raw)
	}
}

func TestEscapeMarkdownNeutralizesFormatting(t *testing.T) {
	got := EscapeMarkdown("**bold** _x_ `c` # h [l]")
	for _, seq := range []string{"**bold**", "_x_", "`c`"} {
		if strings.Contains(got, seq) {
			t.Errorf("%q survived escaping in %q", seq, got)
		}
	}
	if EscapeMarkdown("plain name") != "plain name" {
		t.Error("ordinary text should pass through unchanged")
	}
}

func itoa(n int) string {
	raw, _ := json.Marshal(n)
	return string(raw)
}
