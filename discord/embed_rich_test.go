package discord

import "testing"

func TestEmbedAuthorThumbnailFooterIcon(t *testing.T) {
	e := Embed{
		Title:      "Avery's stats",
		Author:     EmbedAuthor{Name: "Avery", IconURL: "https://cdn/av.png", URL: "https://site/u/1"},
		Thumbnail:  "https://cdn/av.png",
		Footer:     "costan",
		FooterIcon: "https://cdn/logo.png",
		Color:      0x23a55a,
	}
	m := marshalMap(t, e)

	author, ok := m["author"].(map[string]any)
	if !ok || author["name"] != "Avery" || author["icon_url"] != "https://cdn/av.png" || author["url"] != "https://site/u/1" {
		t.Fatalf("author = %v; want name/icon_url/url set", m["author"])
	}
	thumb, ok := m["thumbnail"].(map[string]any)
	if !ok || thumb["url"] != "https://cdn/av.png" {
		t.Fatalf("thumbnail = %v; want {url:...}", m["thumbnail"])
	}
	footer, ok := m["footer"].(map[string]any)
	if !ok || footer["text"] != "costan" || footer["icon_url"] != "https://cdn/logo.png" {
		t.Fatalf("footer = %v; want text+icon_url", m["footer"])
	}
}

func TestEmbedOmitsEmptyRichFields(t *testing.T) {
	m := marshalMap(t, Embed{Title: "x"})
	for _, k := range []string{"author", "thumbnail"} {
		if _, present := m[k]; present {
			t.Fatalf("empty %q should be omitted; got %v", k, m)
		}
	}
	// A footer with no text must not emit an icon-only footer object.
	if _, present := m["footer"]; present {
		t.Fatalf("footer should be omitted when text is empty; got %v", m["footer"])
	}
}

func TestLinkButtonUsesURLNotCustomID(t *testing.T) {
	row := ActionRow{Buttons: []Button{
		{Label: "View profile", URL: "https://site/u/1", Style: ButtonLink},
	}}
	m := marshalMap(t, row)
	b := m["components"].([]any)[0].(map[string]any)

	if b["style"] != float64(ButtonLink) {
		t.Fatalf("style = %v; want %d (Link)", b["style"], ButtonLink)
	}
	if b["url"] != "https://site/u/1" {
		t.Fatalf("url = %v; want the link target", b["url"])
	}
	// Link buttons must not carry a custom_id (Discord rejects that combination).
	if _, present := b["custom_id"]; present {
		t.Fatalf("link button must not emit custom_id; got %v", b)
	}
}

func TestActionButtonUsesCustomID(t *testing.T) {
	row := ActionRow{Buttons: []Button{
		{Label: "Confirm", CustomID: "reset-user:1", Style: ButtonDanger},
	}}
	m := marshalMap(t, row)
	b := m["components"].([]any)[0].(map[string]any)
	if b["custom_id"] != "reset-user:1" {
		t.Fatalf("custom_id = %v", b["custom_id"])
	}
	if _, present := b["url"]; present {
		t.Fatalf("non-link button must not emit url; got %v", b)
	}
}
