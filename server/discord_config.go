package server

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/supporter"
)

// /config panel tabs and settings. The active tab is encoded in component
// custom_ids (config:tab:<tab>), so the panel is fully stateless between clicks.
const (
	tabChannels  = "channels"
	tabRoles     = "roles"
	tabFeedTitle = "feedtitle"

	// defaultFeedTitle is the game-feed heading when no override is set.
	defaultFeedTitle = "🎲 A game is starting"
	// roleSelectMax caps how many roles can grant one perk kind (Discord select cap).
	roleSelectMax = 25
)

// cmdConfig opens the ephemeral admin settings panel on its default (Channels) tab.
// Every setting lives here: channels (report log, game feed, player feedback), supporter-role
// mappings, and the feed title.
func (s *Server) cmdConfig(w http.ResponseWriter) {
	embed, rows := s.configPanel(tabChannels, "")
	replyEmbedWithButtons(w, embed, rows, true)
}

// configPanel builds the panel embed + rows for one tab. activeKind selects the
// supporter kind shown on the Roles tab (ignored on other tabs; defaults to the
// first kind). Row 1 is always the tab bar so any tab is one click away.
func (s *Server) configPanel(tab, activeKind string) (discord.Embed, []discord.ActionRow) {
	switch tab {
	case tabRoles:
		return s.rolesTab(activeKind)
	case tabFeedTitle:
		return s.feedTitleTab()
	default:
		return s.channelsTab()
	}
}

// configTabs is the row of tab buttons; the active tab is highlighted.
func configTabs(active string) discord.ActionRow {
	tab := func(id, label string) discord.Button {
		style := discord.ButtonSecondary
		if id == active {
			style = discord.ButtonPrimary
		}
		return discord.Button{Label: label, CustomID: "config:tab:" + id, Style: style}
	}
	return discord.ActionRow{Buttons: []discord.Button{
		tab(tabChannels, "Channels"),
		tab(tabRoles, "Supporter roles"),
		tab(tabFeedTitle, "Feed title"),
	}}
}

func selectRow(m discord.SelectMenu) discord.ActionRow { return discord.ActionRow{Select: &m} }

func (s *Server) channelsTab() (discord.Embed, []discord.ActionRow) {
	reportCh, _ := s.store.ModChannel()
	feedCh, _ := s.store.FeedChannel()
	feedbackCh, _ := s.store.FeedbackChannel()
	embed := discord.Embed{
		Title:       "Bot configuration · Channels",
		Description: "Pick a channel for each feature, or disable it.",
		Color:       colorBase,
		Fields: []discord.EmbedField{
			{Name: "Chat reports", Value: channelMention(reportCh), Inline: true},
			{Name: "Game feed", Value: channelMention(feedCh), Inline: true},
			{Name: "Player feedback", Value: channelMention(feedbackCh), Inline: true},
		},
	}
	rows := []discord.ActionRow{
		configTabs(tabChannels),
		selectRow(discord.ChannelSelect("config:ch:reports", "Set chat-report channel", nonEmpty(reportCh))),
		selectRow(discord.ChannelSelect("config:ch:feed", "Set game-feed channel", nonEmpty(feedCh))),
		selectRow(discord.ChannelSelect("config:ch:feedback", "Set player-feedback channel", nonEmpty(feedbackCh))),
		{Buttons: []discord.Button{
			{Label: "Disable reports", CustomID: "config:off:reports", Style: discord.ButtonSecondary},
			{Label: "Disable feed", CustomID: "config:off:feed", Style: discord.ButtonSecondary},
			{Label: "Disable feedback", CustomID: "config:off:feedback", Style: discord.ButtonSecondary},
		}},
	}
	return embed, rows
}

func (s *Server) rolesTab(activeKind string) (discord.Embed, []discord.ActionRow) {
	kinds := supporter.Kinds()
	if !supporter.ValidKind(supporter.Kind(activeKind)) {
		activeKind = kinds[0]
	}
	roles, _ := s.store.PerkRoles() // role id -> kind
	forKind := make([]string, 0)
	for id, k := range roles {
		if k == activeKind {
			forKind = append(forKind, id)
		}
	}
	sort.Strings(forKind)

	value := "*none*"
	if len(forKind) > 0 {
		mentions := make([]string, len(forKind))
		for i, id := range forKind {
			mentions[i] = fmt.Sprintf("<@&%s>", id)
		}
		value = strings.Join(mentions, " ")
	}
	embed := discord.Embed{
		Title:       "Bot configuration · Supporter roles",
		Description: "Pick a perk kind, then choose which Discord roles grant it. Changes apply on each member's next role sync.",
		Color:       colorBase,
		Fields:      []discord.EmbedField{{Name: "Roles granting " + activeKind, Value: value}},
	}

	kindOpts := make([]discord.SelectOption, len(kinds))
	for i, k := range kinds {
		kindOpts[i] = discord.SelectOption{Label: k, Value: k, Default: k == activeKind}
	}
	rows := []discord.ActionRow{
		configTabs(tabRoles),
		selectRow(discord.StringSelect("config:role:kind", "Which perk kind", kindOpts)),
		selectRow(discord.RoleSelect("config:role:set:"+activeKind, "Roles that grant "+activeKind, forKind, roleSelectMax)),
	}
	return embed, rows
}

func (s *Server) feedTitleTab() (discord.Embed, []discord.ActionRow) {
	title, _ := s.store.FeedTitle()
	shown := title
	if shown == "" {
		shown = defaultFeedTitle + "  *(default)*"
	}
	embed := discord.Embed{
		Title:       "Bot configuration · Feed title",
		Description: "The heading shown on the game-start feed message.",
		Color:       colorBase,
		Fields:      []discord.EmbedField{{Name: "Current title", Value: shown}},
	}
	rows := []discord.ActionRow{
		configTabs(tabFeedTitle),
		{Buttons: []discord.Button{
			{Label: "Edit title", CustomID: "config:feedtitle:edit", Style: discord.ButtonPrimary},
			{Label: "Reset to default", CustomID: "config:feedtitle:reset", Style: discord.ButtonSecondary},
		}},
	}
	return embed, rows
}

// handleConfigComponent routes a /config panel interaction. The admin gate in
// handleComponent has already passed. Each branch re-renders a tab in place
// (UPDATE_MESSAGE) or, for the feed title, opens a modal.
func (s *Server) handleConfigComponent(w http.ResponseWriter, customID string, values []string) {
	switch {
	case strings.HasPrefix(customID, "config:tab:"):
		embed, rows := s.configPanel(strings.TrimPrefix(customID, "config:tab:"), "")
		updatePanel(w, embed, rows)

	case strings.HasPrefix(customID, "config:ch:"), strings.HasPrefix(customID, "config:off:"):
		s.applyChannelConfig(w, customID, values)

	case customID == "config:role:kind":
		kind := ""
		if len(values) > 0 {
			kind = values[0]
		}
		embed, rows := s.configPanel(tabRoles, kind)
		updatePanel(w, embed, rows)

	case strings.HasPrefix(customID, "config:role:set:"):
		s.applyRoleSelection(w, strings.TrimPrefix(customID, "config:role:set:"), values)

	case customID == "config:feedtitle:edit":
		s.openFeedTitleModal(w)

	case customID == "config:feedtitle:reset":
		if err := s.store.SetFeedTitle(""); err != nil {
			reply(w, "Sorry, could not reset the title.")
			return
		}
		embed, rows := s.configPanel(tabFeedTitle, "")
		updatePanel(w, embed, rows)

	default:
		reply(w, "Unknown configuration action.")
	}
}

// applyChannelConfig sets or clears a channel and re-renders the Channels tab.
// customID is config:ch:{reports,feed,feedback} (values[0] is the picked
// channel) or config:off:{reports,feed,feedback} (clears).
func (s *Server) applyChannelConfig(w http.ResponseWriter, customID string, values []string) {
	var channelID string // "" clears (disable)
	if strings.HasPrefix(customID, "config:ch:") && len(values) > 0 {
		channelID = values[0]
	}
	var err error
	switch {
	case strings.HasSuffix(customID, ":reports"):
		err = s.store.SetModChannel(channelID)
	case strings.HasSuffix(customID, ":feed"):
		err = s.store.SetFeedChannel(channelID)
	case strings.HasSuffix(customID, ":feedback"):
		err = s.store.SetFeedbackChannel(channelID)
	default:
		reply(w, "Unknown configuration action.")
		return
	}
	if err != nil {
		reply(w, "Sorry, could not save that.")
		return
	}
	embed, rows := s.configPanel(tabChannels, "")
	updatePanel(w, embed, rows)
}

// applyRoleSelection rewrites the set of roles mapped to kind to exactly the
// selected role ids: newly-selected roles are mapped (reassigning any that were on
// another kind), and roles previously on this kind but now deselected are removed.
func (s *Server) applyRoleSelection(w http.ResponseWriter, kind string, selected []string) {
	if !supporter.ValidKind(supporter.Kind(kind)) {
		reply(w, "Unknown perk kind.")
		return
	}
	roles, err := s.store.PerkRoles()
	if err != nil {
		reply(w, "Sorry, could not read the role mappings.")
		return
	}
	sel := make(map[string]bool, len(selected))
	for _, id := range selected {
		sel[id] = true
		if roles[id] != kind {
			if err := s.store.SetPerkRole(id, kind); err != nil {
				reply(w, "Sorry, could not save that mapping.")
				return
			}
		}
	}
	for id, k := range roles {
		if k == kind && !sel[id] {
			if _, err := s.store.DeletePerkRole(id); err != nil {
				reply(w, "Sorry, could not save that mapping.")
				return
			}
		}
	}
	embed, rows := s.configPanel(tabRoles, kind)
	updatePanel(w, embed, rows)
}

// openFeedTitleModal opens the feed-title editor prefilled with the current title.
func (s *Server) openFeedTitleModal(w http.ResponseWriter) {
	cur, _ := s.store.FeedTitle()
	if cur == "" {
		cur = defaultFeedTitle
	}
	openModal(w, discord.Modal{
		CustomID: "config:feedtitle:submit",
		Title:    "Edit feed title",
		Inputs: []discord.TextInput{{
			CustomID:  "title",
			Label:     "Feed title",
			Style:     discord.TextShort,
			Value:     cur,
			MaxLength: 100,
		}},
	})
}

// handleModalSubmit applies a /config modal submission. Admin-gated (the modal is
// only reachable from an admin-only panel, but re-check defensively).
func (s *Server) handleModalSubmit(w http.ResponseWriter, customID string, fields map[string]string, admin bool) {
	if !admin {
		reply(w, "You need the Manage Server permission to use this.")
		return
	}
	switch customID {
	case "config:feedtitle:submit":
		title := strings.TrimSpace(fields["title"])
		if title == defaultFeedTitle {
			title = "" // storing the default is the same as unset
		}
		if err := s.store.SetFeedTitle(title); err != nil {
			reply(w, "Sorry, could not save the title.")
			return
		}
		// The modal was opened from a panel button, so we can refresh it in place.
		embed, rows := s.configPanel(tabFeedTitle, "")
		updatePanel(w, embed, rows)
	default:
		reply(w, "Unknown form.")
	}
}

// channelMention renders a channel id as a Discord <#id> mention, or an italic
// "not set" placeholder when unconfigured.
func channelMention(id string) string {
	if id == "" {
		return "*not set*"
	}
	return fmt.Sprintf("<#%s>", id)
}

// nonEmpty returns a single-element slice for a set id, or nil for ""; used to
// pre-select the current channel in a select menu's default_values.
func nonEmpty(id string) []string {
	if id == "" {
		return nil
	}
	return []string{id}
}
