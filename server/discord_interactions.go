package server

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/ftqo/costan.io/discord"
)

// Discord interaction + response type numbers.
const (
	interactionPing        = 1  // Discord liveness ping
	interactionCommand     = 2  // a slash command was used
	interactionComponent   = 3  // a message component (e.g. button) was used
	interactionModalSubmit = 5  // a modal form was submitted
	responsePong           = 1  // reply to a ping
	responseMessage        = 4  // CHANNEL_MESSAGE_WITH_SOURCE
	responseUpdateMessage  = 7  // UPDATE_MESSAGE: replace the component's message
	responseModal          = 9  // MODAL: open a popup form
	responseLaunchActivity = 12 // LAUNCH_ACTIVITY: open the app's Activity
	flagEphemeral          = 64
)

// adminCommands are the slash commands gated behind the Manage-Server permission.
// They are also hidden from non-admins by default_member_permissions at
// registration; this set is the in-handler authorization boundary.
var adminCommands = map[string]bool{
	"whois":          true,
	"reset-user":     true,
	"config":         true,
	"unban-chat":     true,
	"unlock-name":    true,
	"report-strikes": true,
	"reports":        true,
	"undo-report":    true,
}

// handleDiscordInteractions is the Discord interactions webhook. It dispatches
// slash commands, message components (the /config panel, /reset-user confirm), and
// modal submissions. It is a public endpoint Discord POSTs to; every request is
// Ed25519-verified against the app's public key first. Disabled (404) when no key
// is set.
func (s *Server) handleDiscordInteractions(w http.ResponseWriter, r *http.Request) {
	if s.discordPubKey == "" {
		http.NotFound(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "BODY_READ_FAILED", "could not read body")
		return
	}
	if !discord.VerifyInteraction(s.discordPubKey, r.Header.Get("X-Signature-Ed25519"), r.Header.Get("X-Signature-Timestamp"), body) {
		http.Error(w, "invalid request signature", http.StatusUnauthorized)
		return
	}

	var it struct {
		Type int `json:"type"`
		Data struct {
			Name          string   `json:"name"`
			CustomID      string   `json:"custom_id"`      // set on component (button/select) + modal-submit
			ComponentType int      `json:"component_type"` // 8 = channel-select, etc.
			Values        []string `json:"values"`         // selected values on a select-menu interaction
			Options       []struct {
				Name  string          `json:"name"`
				Value json.RawMessage `json:"value"`
			} `json:"options"`
			// Components carries the submitted rows on a MODAL_SUBMIT interaction.
			Components []struct {
				Components []struct {
					CustomID string `json:"custom_id"`
					Value    string `json:"value"`
				} `json:"components"`
			} `json:"components"`
		} `json:"data"`
		Member struct {
			Permissions string `json:"permissions"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"member"`
		ChannelID string `json:"channel_id"`
		GuildID   string `json:"guild_id"`
	}
	if err := json.Unmarshal(body, &it); err != nil {
		writeErr(w, http.StatusBadRequest, "MALFORMED_INTERACTION", "malformed interaction")
		return
	}

	// Discord's required liveness handshake.
	if it.Type == interactionPing {
		writeJSON(w, http.StatusOK, map[string]any{"type": responsePong})
		return
	}

	// Manage Server counts only in our guild. The app is user-installable
	// (EnsureEntryPointCommand), so interactions also arrive from the caller's
	// own guilds and DMs, where they control the permissions bitfield. Every
	// admin path (commands, components, modals) reads this one flag.
	admin := discord.HasManageGuild(it.Member.Permissions) &&
		s.discordGuildID != "" && it.GuildID == s.discordGuildID
	// Message components (the /reset-user confirm button, the /config selects).
	// Admin-gated.
	if it.Type == interactionComponent {
		s.handleComponent(w, it.Data.CustomID, it.Data.Values, it.Member.User.ID, admin)
		return
	}
	// Modal submissions (the /config feed-title editor). Admin-gated.
	if it.Type == interactionModalSubmit {
		fields := map[string]string{}
		for _, row := range it.Data.Components {
			for _, c := range row.Components {
				fields[c.CustomID] = c.Value
			}
		}
		s.handleModalSubmit(w, it.Data.CustomID, fields, admin)
		return
	}
	if it.Type != interactionCommand {
		writeJSON(w, http.StatusOK, map[string]any{"type": responsePong})
		return
	}

	// Defense-in-depth: admin commands are also hidden by default_member_permissions
	// in Discord, but re-check the caller actually manages the guild.
	if adminCommands[it.Data.Name] && !admin {
		reply(w, "You need the Manage Server permission to use this.")
		return
	}

	opts := map[string]string{}
	for _, o := range it.Data.Options {
		var v string
		_ = json.Unmarshal(o.Value, &v) // role/user ids and string choices all arrive as JSON strings
		opts[o.Name] = v
	}
	callerID := it.Member.User.ID

	switch it.Data.Name {
	case "stats":
		s.cmdStats(w, opts["user"], callerID, admin)
	case "spectate":
		s.cmdSpectate(w, opts["user"], admin)
	case "leaderboard":
		s.cmdLeaderboard(w, opts["ruleset"])
	case "link":
		s.cmdLink(w, callerID)
	case "whois":
		s.cmdWhois(w, opts["user"])
	case "reset-user":
		s.cmdResetUserPrompt(w, opts["user"])
	case "play", "costanio":
		launchActivity(w)
	case "config":
		s.cmdConfig(w)
	case "unban-chat":
		s.cmdUnbanChat(w, opts["user"])
	case "unlock-name":
		s.cmdUnlockName(w, opts["user"])
	case "report-strikes":
		s.cmdReportStrikes(w, opts["user"])
	case "reports":
		s.cmdReports(w)
	case "undo-report":
		s.cmdUndoReport(w, opts["id"])
	default:
		reply(w, "Unknown command.")
	}
}

// updateMessage edits the message a button is attached to (clears its buttons).
func updateMessage(w http.ResponseWriter, embed discord.Embed) {
	writeJSON(w, http.StatusOK, map[string]any{
		"type": responseUpdateMessage,
		"data": map[string]any{"embeds": []discord.Embed{embed}, "components": []any{}},
	})
}

// updatePanel re-renders a component's message in place, keeping its components
// (used by the /config panel so the selects/buttons persist after each change).
func updatePanel(w http.ResponseWriter, embed discord.Embed, rows []discord.ActionRow) {
	writeJSON(w, http.StatusOK, map[string]any{
		"type": responseUpdateMessage,
		"data": map[string]any{"embeds": []discord.Embed{embed}, "components": rows},
	})
}

// openModal responds to a component interaction by opening a popup form.
func openModal(w http.ResponseWriter, modal discord.Modal) {
	writeJSON(w, http.StatusOK, map[string]any{"type": responseModal, "data": modal})
}

// launchActivity responds to /play and /costanio by opening the app's Discord
// Activity; Discord posts its own "started an activity" message and shows the user
// an error if the current context can't host an activity.
func launchActivity(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{"type": responseLaunchActivity})
}

// reply writes an ephemeral (only the invoker sees it) command response.
func reply(w http.ResponseWriter, content string) {
	writeJSON(w, http.StatusOK, map[string]any{
		"type": responseMessage,
		"data": map[string]any{"content": content, "flags": flagEphemeral},
	})
}

// replyEmbed writes a single-embed command response, ephemeral when requested.
func replyEmbed(w http.ResponseWriter, embed discord.Embed, ephemeral bool) {
	replyEmbedWithButtons(w, embed, nil, ephemeral)
}

// replyEmbedWithButtons writes an embed response optionally carrying message
// components (button rows), ephemeral when requested. Flags are omitted entirely
// for a non-ephemeral (publicly visible) reply.
func replyEmbedWithButtons(w http.ResponseWriter, embed discord.Embed, rows []discord.ActionRow, ephemeral bool) {
	data := map[string]any{"embeds": []discord.Embed{embed}}
	if len(rows) > 0 {
		data["components"] = rows
	}
	if ephemeral {
		data["flags"] = flagEphemeral
	}
	writeJSON(w, http.StatusOK, map[string]any{"type": responseMessage, "data": data})
}
