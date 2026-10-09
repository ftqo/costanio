package server

import (
	"strings"
	"testing"
)

func TestConfigPanelShowsBothSelects(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	if err := e.st.SetModChannel("rep123"); err != nil {
		t.Fatal(err)
	}

	resp := post(`{"type":2,"member":{"permissions":"8","user":{"id":"admin"}},"data":{"name":"config"},"channel_id":"here"}`)
	if resp["type"] != float64(responseMessage) {
		t.Fatalf("config → %v", resp)
	}
	data := resp["data"].(map[string]any)
	if data["flags"] != float64(flagEphemeral) {
		t.Fatalf("config panel must be ephemeral; flags=%v", data["flags"])
	}
	txt := fullResponseText(t, resp)
	for _, want := range []string{"config:ch:reports", "config:ch:feed", "config:off:reports", "config:off:feed"} {
		if !strings.Contains(txt, want) {
			t.Fatalf("panel missing %q; got %s", want, txt)
		}
	}
	// Current report channel is reflected (as a default value and/or a mention).
	if !strings.Contains(txt, "rep123") {
		t.Fatalf("panel should reflect current report channel; got %s", txt)
	}
}

func TestConfigRequiresAdmin(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)

	resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"nobody"}},"data":{"name":"config"},"channel_id":"here"}`)
	if _, hasComp := resp["data"].(map[string]any)["components"]; hasComp {
		t.Fatalf("non-admin /config must not render the panel")
	}
}

func TestConfigSelectStoresChannel(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)

	resp := post(`{"type":3,"member":{"permissions":"8","user":{"id":"admin"}},"data":{"custom_id":"config:ch:feed","component_type":8,"values":["feed777"]}}`)
	if resp["type"] != float64(responseUpdateMessage) {
		t.Fatalf("channel-select should update the panel in place; type=%v", resp["type"])
	}
	if ch, _ := e.st.FeedChannel(); ch != "feed777" {
		t.Fatalf("feed channel = %q; want feed777", ch)
	}
	// The refreshed panel reflects the new selection.
	if txt := fullResponseText(t, resp); !strings.Contains(txt, "feed777") {
		t.Fatalf("updated panel should reflect new feed channel; got %s", txt)
	}

	// Reports select routes to the report channel independently.
	post(`{"type":3,"member":{"permissions":"8","user":{"id":"admin"}},"data":{"custom_id":"config:ch:reports","component_type":8,"values":["rep888"]}}`)
	if ch, _ := e.st.ModChannel(); ch != "rep888" {
		t.Fatalf("report channel = %q; want rep888", ch)
	}
	if ch, _ := e.st.FeedChannel(); ch != "feed777" {
		t.Fatalf("feed channel clobbered by reports select: %q", ch)
	}
}

func TestConfigDisableButtonClears(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	if err := e.st.SetFeedChannel("feed777"); err != nil {
		t.Fatal(err)
	}

	post(`{"type":3,"member":{"permissions":"8","user":{"id":"admin"}},"data":{"custom_id":"config:off:feed"}}`)
	if ch, _ := e.st.FeedChannel(); ch != "" {
		t.Fatalf("disable button should clear feed channel; got %q", ch)
	}
}

func TestConfigComponentRequiresAdmin(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)

	post(`{"type":3,"member":{"permissions":"0","user":{"id":"x"}},"data":{"custom_id":"config:ch:feed","component_type":8,"values":["sneaky"]}}`)
	if ch, _ := e.st.FeedChannel(); ch == "sneaky" {
		t.Fatalf("non-admin must not set the feed channel")
	}
}

func adminPost(id string, body string) string {
	return `{"type":3,"member":{"permissions":"8","user":{"id":"admin"}},"data":` + body + `}`
}

func TestConfigDefaultPanelHasTabs(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	resp := post(`{"type":2,"member":{"permissions":"8","user":{"id":"admin"}},"data":{"name":"config"},"channel_id":"here"}`)
	txt := fullResponseText(t, resp)
	for _, want := range []string{"config:tab:channels", "config:tab:roles", "config:tab:feedtitle"} {
		if !strings.Contains(txt, want) {
			t.Fatalf("panel missing tab %q; got %s", want, txt)
		}
	}
}

func TestConfigRolesTabRendersKindsAndRoleSelect(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	resp := post(adminPost("admin", `{"custom_id":"config:tab:roles","component_type":2}`))
	if resp["type"] != float64(responseUpdateMessage) {
		t.Fatalf("tab switch should update in place; type=%v", resp["type"])
	}
	txt := fullResponseText(t, resp)
	if !strings.Contains(txt, "config:role:kind") {
		t.Fatalf("roles tab needs a kind select; got %s", txt)
	}
	// The role-select's custom_id is scoped to the active kind (first kind by default).
	if !strings.Contains(txt, "config:role:set:") {
		t.Fatalf("roles tab needs a role select; got %s", txt)
	}
}

func TestConfigRoleSelectionRewritesKindSet(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	// Seed: role r_old already maps to kofi.
	if err := e.st.SetPerkRole("r_old", "kofi"); err != nil {
		t.Fatal(err)
	}
	// Select {r_new} for kofi: r_new added, r_old (deselected) removed.
	resp := post(adminPost("admin", `{"custom_id":"config:role:set:kofi","component_type":6,"values":["r_new"]}`))
	if resp["type"] != float64(responseUpdateMessage) {
		t.Fatalf("role edit should update panel; type=%v", resp["type"])
	}
	roles, _ := e.st.PerkRoles()
	if roles["r_new"] != "kofi" {
		t.Fatalf("r_new should map to kofi; got %v", roles)
	}
	if _, still := roles["r_old"]; still {
		t.Fatalf("r_old should have been removed; got %v", roles)
	}
}

func TestConfigRoleSelectionReassignsAcrossKinds(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	if err := e.st.SetPerkRole("r1", "staff"); err != nil { // r1 currently staff
		t.Fatal(err)
	}
	// Select r1 under kofi → it moves to kofi.
	post(adminPost("admin", `{"custom_id":"config:role:set:kofi","component_type":6,"values":["r1"]}`))
	roles, _ := e.st.PerkRoles()
	if roles["r1"] != "kofi" {
		t.Fatalf("r1 should be reassigned to kofi; got %v", roles)
	}
}

func TestConfigRoleSelectionRequiresAdmin(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	post(`{"type":3,"member":{"permissions":"0","user":{"id":"x"}},"data":{"custom_id":"config:role:set:kofi","component_type":6,"values":["sneaky"]}}`)
	if roles, _ := e.st.PerkRoles(); roles["sneaky"] != "" {
		t.Fatalf("non-admin must not set perk roles; got %v", roles)
	}
}

func TestConfigFeedTitleEditOpensModal(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	resp := post(adminPost("admin", `{"custom_id":"config:feedtitle:edit","component_type":2}`))
	if resp["type"] != float64(responseModal) {
		t.Fatalf("edit button should open a modal; type=%v", resp["type"])
	}
	if !strings.Contains(fullResponseText(t, resp), "config:feedtitle:submit") {
		t.Fatalf("modal should submit to config:feedtitle:submit; got %s", fullResponseText(t, resp))
	}
}

func TestConfigFeedTitleModalSubmitStores(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	post(`{"type":5,"member":{"permissions":"8","user":{"id":"admin"}},"data":{"custom_id":"config:feedtitle:submit","components":[{"components":[{"custom_id":"title","value":"Match on!"}]}]}}`)
	if v, _ := e.st.FeedTitle(); v != "Match on!" {
		t.Fatalf("modal submit should store the title; got %q", v)
	}
}

func TestConfigFeedTitleModalRequiresAdmin(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	post(`{"type":5,"member":{"permissions":"0","user":{"id":"x"}},"data":{"custom_id":"config:feedtitle:submit","components":[{"components":[{"custom_id":"title","value":"sneaky"}]}]}}`)
	if v, _ := e.st.FeedTitle(); v == "sneaky" {
		t.Fatalf("non-admin must not set the feed title")
	}
}

func TestConfigFeedTitleReset(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	if err := e.st.SetFeedTitle("Custom"); err != nil {
		t.Fatal(err)
	}
	post(adminPost("admin", `{"custom_id":"config:feedtitle:reset","component_type":2}`))
	if v, _ := e.st.FeedTitle(); v != "" {
		t.Fatalf("reset should clear the title; got %q", v)
	}
}
